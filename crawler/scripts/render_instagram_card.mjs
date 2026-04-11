import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const FONT_CANDIDATES = [
  {
    regular: "C:/Windows/Fonts/malgun.ttf",
    bold: "C:/Windows/Fonts/malgunbd.ttf",
  },
  {
    regular: "/Library/Fonts/NanumGothic.ttf",
    bold: "/Library/Fonts/NanumGothicBold.ttf",
  },
  {
    regular: "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
    bold: "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
  },
  {
    regular: "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    bold: "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
  },
];

const CANVAS_SIZE = 1080;

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith("--") || value === undefined) {
      continue;
    }
    args[key.slice(2)] = value;
    index += 1;
  }

  return args;
}

async function ensureFileExists(filePath) {
  await access(filePath);
  return filePath;
}

async function resolveFontPair() {
  for (const candidate of FONT_CANDIDATES) {
    try {
      await Promise.all([
        ensureFileExists(candidate.regular),
        ensureFileExists(candidate.bold),
      ]);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error("No compatible font pair found for Instagram renderer");
}

function toBase64(buffer) {
  return buffer.toString("base64");
}

async function loadFonts() {
  const fontPair = await resolveFontPair();
  const [regular, bold] = await Promise.all([
    readFile(fontPair.regular),
    readFile(fontPair.bold),
  ]);

  return `
    @font-face {
      font-family: 'RendererSans';
      src: url(data:font/truetype;charset=utf-8;base64,${toBase64(regular)}) format('truetype');
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: 'RendererSans';
      src: url(data:font/truetype;charset=utf-8;base64,${toBase64(bold)}) format('truetype');
      font-weight: 700;
      font-style: normal;
    }
  `;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildFrameMask(frame) {
  return Buffer.from(`
    <svg width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="${frame.x}"
        y="${frame.y}"
        width="${frame.width}"
        height="${frame.height}"
        rx="${frame.radius}"
        ry="${frame.radius}"
        fill="#ffffff"
      />
    </svg>
  `);
}

function buildBaseBackground(colors) {
  return Buffer.from(`
    <svg width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${colors.backgroundTop}" />
          <stop offset="100%" stop-color="${colors.backgroundBottom}" />
        </linearGradient>
      </defs>
      <rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" fill="url(#bg)" />
    </svg>
  `);
}

function buildShadowLayer(frame, colors) {
  return Buffer.from(`
    <svg width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="${frame.x + 8}"
        y="${frame.y + 12}"
        width="${frame.width}"
        height="${frame.height}"
        rx="${frame.radius}"
        ry="${frame.radius}"
        fill="${colors.shadow}"
        opacity="0.46"
      />
    </svg>
  `);
}

function validateImageUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Blocked protocol: ${parsed.protocol}`);
  }
  const hostname = parsed.hostname.toLowerCase();
  const blockedHosts = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"];
  if (
    blockedHosts.includes(hostname) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname.startsWith("169.254.")
  ) {
    throw new Error(`Blocked host: ${hostname}`);
  }
}

async function fetchPhotoBuffer(imageUrl, frame) {
  if (!imageUrl) {
    return null;
  }

  validateImageUrl(imageUrl);

  const response = await fetch(imageUrl, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Photo fetch failed with status ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();

  return sharp(Buffer.from(arrayBuffer))
    .resize({
      width: frame.width,
      height: frame.height,
      fit: "cover",
      position: sharp.strategy.attention,
    })
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function buildPhotoLayer(photoBuffer, frame, colors) {
  if (!photoBuffer) {
    return null;
  }

  const frameMask = await sharp({
    create: {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      channels: 4,
      background: colors.backgroundTop,
    },
  })
    .composite([
      {
        input: buildFrameMask(frame),
        top: 0,
        left: 0,
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      channels: 4,
      background: colors.backgroundTop,
    },
  })
    .composite([
      {
        input: photoBuffer,
        top: frame.y,
        left: frame.x,
      },
      {
        input: frameMask,
        top: 0,
        left: 0,
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
}

function buildFallbackPhotoSvg(frame, colors) {
  return Buffer.from(`
    <svg width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fallbackPhoto" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${colors.fallbackTop}" />
          <stop offset="100%" stop-color="${colors.fallbackBottom}" />
        </linearGradient>
      </defs>
      <rect
        x="${frame.x}"
        y="${frame.y}"
        width="${frame.width}"
        height="${frame.height}"
        rx="${frame.radius}"
        ry="${frame.radius}"
        fill="url(#fallbackPhoto)"
      />
    </svg>
  `);
}

function buildOverlaySvg(payload, fontCss, colors, frame, brandChip, hasPhoto) {
  const eyebrow = payload.eyebrow || "\uC624\uB298\uC758 \uAE09\uC0C1\uC2B9 \uC74C\uC2DD";
  const badge =
    payload.badge ||
    (payload.status === "active" ? "\uC778\uAE30" : "\uAE09\uC0C1\uC2B9");
  const subtitle =
    payload.subtitle ||
    `${payload.category || "\uAC04\uC2DD"} \uCE74\uD14C\uACE0\uB9AC\uC5D0\uC11C \uAC80\uC0C9\uB7C9\uC774 \uC624\uB978 \uBA54\uB274\uC608\uC694.`;
  const title = payload.title;
  const photoFadeOpacity = hasPhoto ? 0.72 : 0.16;
  const panelFillOpacity = hasPhoto ? 0.58 : 0.82;

  return Buffer.from(`
    <svg width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          ${fontCss}
          text {
            font-family: 'RendererSans', 'Malgun Gothic', 'Segoe UI', sans-serif;
          }
        </style>
        <linearGradient id="photoFade" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#000000" stop-opacity="0" />
          <stop offset="58%" stop-color="#000000" stop-opacity="0" />
          <stop offset="100%" stop-color="#000000" stop-opacity="${photoFadeOpacity}" />
        </linearGradient>
      </defs>

      <rect
        x="${frame.x}"
        y="${frame.y}"
        width="${frame.width}"
        height="${frame.height}"
        rx="${frame.radius}"
        fill="url(#photoFade)"
      />

      <text x="92" y="118" font-size="26" font-weight="700" fill="${colors.eyebrow}" fill-opacity="0.96">${escapeXml(eyebrow)}</text>

      <rect
        x="80"
        y="708"
        width="920"
        height="244"
        rx="34"
        fill="${colors.panel}"
        fill-opacity="${panelFillOpacity}"
        stroke="${colors.stroke}"
        stroke-opacity="0.12"
        stroke-width="1.5"
      />

      <rect
        x="104"
        y="734"
        width="144"
        height="54"
        rx="27"
        fill="${colors.badge}"
        fill-opacity="0.98"
      />
      <text x="176" y="769" font-size="26" font-weight="700" fill="${colors.white}" text-anchor="middle">${escapeXml(badge)}</text>

      <text
        x="104"
        y="870"
        font-size="96"
        font-weight="700"
        fill="${colors.white}"
        letter-spacing="-4"
      >${escapeXml(title)}</text>

      <text
        x="104"
        y="930"
        font-size="34"
        font-weight="400"
        fill="${colors.subtitle}"
        fill-opacity="0.96"
      >${escapeXml(subtitle)}</text>

      <rect
        x="${brandChip.x}"
        y="${brandChip.y}"
        width="${brandChip.width}"
        height="${brandChip.height}"
        rx="24"
        fill="${colors.white}"
        fill-opacity="0.88"
      />
      <text
        x="${brandChip.x + brandChip.width / 2}"
        y="${brandChip.y + 42}"
        font-size="28"
        font-weight="700"
        text-anchor="middle"
        fill="${colors.brand}"
      >${escapeXml(payload.brandLabel || "\uC694\uC998\uBB50\uBA39")}</text>

      <rect
        x="${frame.x}"
        y="${frame.y}"
        width="${frame.width}"
        height="${frame.height}"
        rx="${frame.radius}"
        fill="none"
        stroke="${colors.stroke}"
        stroke-opacity="0.28"
        stroke-width="2"
      />
    </svg>
  `);
}

function resolvePayload(rawPayload) {
  if (!rawPayload.outputPath) {
    throw new Error("Renderer payload requires outputPath");
  }
  if (!rawPayload.title) {
    throw new Error("Renderer payload requires title");
  }

  return {
    title: String(rawPayload.title),
    subtitle: rawPayload.subtitle ? String(rawPayload.subtitle) : "",
    badge: rawPayload.badge ? String(rawPayload.badge) : "",
    eyebrow: rawPayload.eyebrow ? String(rawPayload.eyebrow) : "",
    category: rawPayload.category ? String(rawPayload.category) : "",
    status: rawPayload.status ? String(rawPayload.status) : "rising",
    imageUrl: rawPayload.imageUrl ? String(rawPayload.imageUrl) : "",
    outputPath: path.resolve(rootDir, String(rawPayload.outputPath)),
    brandLabel: rawPayload.brandLabel
      ? String(rawPayload.brandLabel)
      : "\uC694\uC998\uBB50\uBA39",
  };
}

async function readJsonPayload(payloadPath) {
  const raw = await readFile(payloadPath, "utf8");
  return JSON.parse(raw.replace(/^\uFEFF/, ""));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.payload) {
    throw new Error("Usage: node scripts/render_instagram_card.mjs --payload <json-path>");
  }

  const payload = resolvePayload(
    await readJsonPayload(path.resolve(rootDir, args.payload))
  );
  const fontCss = await loadFonts();

  const frame = {
    x: 52,
    y: 52,
    width: 976,
    height: 976,
    radius: 48,
  };

  const brandChip = {
    x: 794,
    y: 84,
    width: 186,
    height: 60,
  };

  const colors = {
    backgroundTop: "#FBF7F2",
    backgroundBottom: "#F2ECE4",
    fallbackTop: "#F3E8FF",
    fallbackBottom: "#E7DDF6",
    shadow: "#DDD4CA",
    panel: "#171311",
    badge: "#8E76C8",
    eyebrow: "#2D2622",
    subtitle: "#F3ECE4",
    brand: "#8E76C8",
    white: "#FFFFFF",
    stroke: "#FFFFFF",
  };

  let photoBuffer = null;
  let photoLoadError = null;

  try {
    photoBuffer = await fetchPhotoBuffer(payload.imageUrl, frame);
  } catch (error) {
    photoLoadError = error;
  }

  const photoLayer = photoBuffer
    ? await buildPhotoLayer(photoBuffer, frame, colors)
    : buildFallbackPhotoSvg(frame, colors);

  await mkdir(path.dirname(payload.outputPath), { recursive: true });

  await sharp({
    create: {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      channels: 4,
      background: colors.backgroundTop,
    },
  })
    .composite([
      {
        input: buildBaseBackground(colors),
        top: 0,
        left: 0,
      },
      {
        input: buildShadowLayer(frame, colors),
        top: 0,
        left: 0,
      },
      {
        input: photoLayer,
        top: 0,
        left: 0,
      },
      {
        input: buildOverlaySvg(payload, fontCss, colors, frame, brandChip, Boolean(photoBuffer)),
        top: 0,
        left: 0,
      },
    ])
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toFile(payload.outputPath);

  const result = {
    outputPath: payload.outputPath,
    usedFallback: !photoBuffer,
    photoLoadError: photoLoadError ? String(photoLoadError.message || photoLoadError) : null,
  };
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error("Failed to render Instagram card");
  console.error(error);
  process.exitCode = 1;
});
