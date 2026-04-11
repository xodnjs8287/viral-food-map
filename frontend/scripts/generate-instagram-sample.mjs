import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const outputPath = path.join(
  rootDir,
  "public",
  "instagram-samples",
  "gyeranppang-sample.png"
);
const brandLogoPath = path.join(rootDir, "public", "logo-title.png");

const photoUrl =
  "https://imgnews.naver.net/image/003/2025/10/20/NISI20251020_0001969740_web_20251020094048_20251020191222825.jpg";

const canvas = {
  width: 1080,
  height: 1350,
};

const frame = {
  x: 56,
  y: 56,
  width: 968,
  height: 1238,
  radius: 56,
};

const brandChip = {
  x: 772,
  y: 96,
  width: 208,
  height: 72,
};

const card = {
  eyebrow: "\uC624\uB298\uC758 \uAC04\uC2DD \uD53D",
  badge: "\uAE09\uC0C1\uC2B9",
  title: "\uACC4\uB780\uBE75",
  subtitle: "\uB2EC\uCF64\uD558\uACE0 \uD3EC\uADFC\uD55C \uACA8\uC6B8 \uAC04\uC2DD",
};

const colors = {
  backgroundTop: "#FBF7F2",
  backgroundBottom: "#F2ECE4",
  shadow: "#DDD4CA",
  white: "#FFFFFF",
  purple: "#8E76C8",
  purpleDark: "#2D2622",
  cream: "#F3ECE4",
  panel: "#171311",
  glassStroke: "#FFFFFF",
};

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

function toBase64(buffer) {
  return buffer.toString("base64");
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

  throw new Error("No compatible font pair found for Instagram sample generator");
}

async function loadFonts() {
  const fontPair = await resolveFontPair();
  const [regular, bold] = await Promise.all([
    readFile(fontPair.regular),
    readFile(fontPair.bold),
  ]);

  return `
    @font-face {
      font-family: 'SampleMalgun';
      src: url(data:font/truetype;charset=utf-8;base64,${toBase64(regular)}) format('truetype');
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: 'SampleMalgun';
      src: url(data:font/truetype;charset=utf-8;base64,${toBase64(bold)}) format('truetype');
      font-weight: 700;
      font-style: normal;
    }
  `;
}

async function loadPhoto() {
  const response = await fetch(photoUrl, { redirect: "follow" });

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

function buildBackgroundSvg() {
  return Buffer.from(`
    <svg width="${canvas.width}" height="${canvas.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${colors.backgroundTop}" />
          <stop offset="100%" stop-color="${colors.backgroundBottom}" />
        </linearGradient>
      </defs>
      <rect width="${canvas.width}" height="${canvas.height}" fill="url(#bg)" />
    </svg>
  `);
}

function buildShadowSvg() {
  return Buffer.from(`
    <svg width="${canvas.width}" height="${canvas.height}" xmlns="http://www.w3.org/2000/svg">
      <rect
        x="${frame.x + 10}"
        y="${frame.y + 16}"
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

function buildMaskSvg() {
  return Buffer.from(`
    <svg width="${canvas.width}" height="${canvas.height}" xmlns="http://www.w3.org/2000/svg">
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

function buildOverlaySvg(fontCss) {
  return Buffer.from(`
    <svg width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          ${fontCss}
          text {
            font-family: 'SampleMalgun', 'Malgun Gothic', 'Segoe UI', sans-serif;
          }
        </style>
        <linearGradient id="photoFade" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#000000" stop-opacity="0" />
          <stop offset="60%" stop-color="#000000" stop-opacity="0" />
          <stop offset="100%" stop-color="#000000" stop-opacity="0.68" />
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

      <text x="98" y="126" font-size="27" font-weight="700" fill="${colors.purpleDark}" fill-opacity="0.92">${card.eyebrow}</text>

      <rect
        x="88"
        y="920"
        width="904"
        height="336"
        rx="40"
        fill="${colors.panel}"
        fill-opacity="0.56"
        stroke="${colors.glassStroke}"
        stroke-opacity="0.12"
        stroke-width="1.5"
      />

      <rect
        x="110"
        y="952"
        width="150"
        height="56"
        rx="28"
        fill="${colors.purple}"
        fill-opacity="0.96"
      />
      <text x="185" y="989" font-size="27" font-weight="700" fill="${colors.white}" text-anchor="middle">${card.badge}</text>

      <text
        x="108"
        y="1150"
        font-size="100"
        font-weight="700"
        fill="${colors.white}"
        letter-spacing="-4"
      >${card.title}</text>

      <text x="110" y="1230" font-size="36" font-weight="400" fill="${colors.cream}" fill-opacity="0.94">${card.subtitle}</text>

      <rect
        x="${brandChip.x + 8}"
        y="${brandChip.y + 4}"
        width="${brandChip.width - 16}"
        height="${brandChip.height - 8}"
        rx="26"
        fill="${colors.white}"
        fill-opacity="0.84"
      />

      <rect
        x="${frame.x}"
        y="${frame.y}"
        width="${frame.width}"
        height="${frame.height}"
        rx="${frame.radius}"
        fill="none"
        stroke="${colors.white}"
        stroke-opacity="0.38"
        stroke-width="2"
      />
    </svg>
  `);
}

async function buildPhotoLayer(photoBuffer) {
  const frameMask = await sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
      channels: 4,
      background: colors.backgroundTop,
    },
  })
    .composite([
      {
        input: buildMaskSvg(),
        top: 0,
        left: 0,
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
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

async function main() {
  const [fontCss, photoBuffer, brandLogoBuffer] = await Promise.all([
    loadFonts(),
    loadPhoto(),
    sharp(brandLogoPath).trim().resize({ height: 34 }).png().toBuffer(),
  ]);

  const brandLogoMeta = await sharp(brandLogoBuffer).metadata();
  const brandLogoLeft =
    brandChip.x + Math.round((brandChip.width - (brandLogoMeta.width ?? 0)) / 2);
  const brandLogoTop =
    brandChip.y + Math.round((brandChip.height - (brandLogoMeta.height ?? 0)) / 2);

  const photoLayer = await buildPhotoLayer(photoBuffer);

  await mkdir(path.dirname(outputPath), { recursive: true });

  await sharp({
    create: {
      width: canvas.width,
      height: canvas.height,
      channels: 4,
      background: colors.backgroundTop,
    },
  })
    .composite([
      {
        input: buildBackgroundSvg(),
        top: 0,
        left: 0,
      },
      {
        input: buildShadowSvg(),
        top: 0,
        left: 0,
      },
      {
        input: photoLayer,
        top: 0,
        left: 0,
      },
      {
        input: buildOverlaySvg(fontCss),
        top: 0,
        left: 0,
      },
      {
        input: brandLogoBuffer,
        top: brandLogoTop,
        left: brandLogoLeft,
      },
    ])
    .png()
    .toFile(outputPath);

  console.log(`Instagram sample generated: ${outputPath}`);
}

main().catch((error) => {
  console.error("Failed to generate Instagram sample");
  console.error(error);
  process.exitCode = 1;
});
