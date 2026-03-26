"use client";

const INSTAGRAM_RESERVED_PATHS = new Set([
  "accounts",
  "developer",
  "direct",
  "explore",
  "legal",
  "p",
  "policies",
  "reel",
  "reels",
  "stories",
  "tv",
]);

function isMobileDevice() {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function openWebUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function openDeepLinkWithFallback(deepLink: string, webUrl: string) {
  if (typeof window === "undefined") {
    return;
  }

  if (!isMobileDevice()) {
    openWebUrl(webUrl);
    return;
  }

  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pagehide", handlePageHide);
    window.clearTimeout(fallbackTimer);
  };

  const handleVisibilityChange = () => {
    if (document.hidden) {
      cleanup();
    }
  };

  const handlePageHide = () => {
    cleanup();
  };

  const fallbackTimer = window.setTimeout(() => {
    cleanup();

    if (!document.hidden) {
      openWebUrl(webUrl);
    }
  }, 1600);

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pagehide", handlePageHide, { once: true });
  window.location.href = deepLink;
}

function getInstagramTargetsFromUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname.replace(/^www\./, "").toLowerCase();

    if (host !== "instagram.com" && host !== "m.instagram.com") {
      return null;
    }

    const segments = parsedUrl.pathname.split("/").filter(Boolean);
    if (segments.length === 0) {
      return null;
    }

    if (segments[0] === "explore" && segments[1] === "tags" && segments[2]) {
      const tag = decodeURIComponent(segments[2]);
      const encodedTag = encodeURIComponent(tag);

      return {
        deepLink: `instagram://tag?name=${encodedTag}`,
        webUrl: `https://www.instagram.com/explore/tags/${encodedTag}/`,
      };
    }

    const username = decodeURIComponent(segments[0]);
    if (!INSTAGRAM_RESERVED_PATHS.has(username.toLowerCase())) {
      const encodedUsername = encodeURIComponent(username);

      return {
        deepLink: `instagram://user?username=${encodedUsername}`,
        webUrl: `https://www.instagram.com/${encodedUsername}/`,
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function openInstagramTag(tag: string) {
  const normalizedTag = tag.replace(/^#/, "").replace(/\s+/g, "");
  const encodedTag = encodeURIComponent(normalizedTag);

  openDeepLinkWithFallback(
    `instagram://tag?name=${encodedTag}`,
    `https://www.instagram.com/explore/tags/${encodedTag}/`
  );
}

export function openBaemin(storeName: string) {
  const encoded = encodeURIComponent(storeName);
  openDeepLinkWithFallback(
    `baemin://search?query=${encoded}`,
    `https://www.baemin.com/search?query=${encoded}`
  );
}

export function openCoupangEats(storeName: string) {
  const encoded = encodeURIComponent(storeName);
  openDeepLinkWithFallback(
    `coupangeats://search?query=${encoded}`,
    `https://www.coupangeats.com/search?query=${encoded}`
  );
}

export function openExternalUrl(url: string) {
  const instagramTargets = getInstagramTargetsFromUrl(url);

  if (instagramTargets) {
    openDeepLinkWithFallback(instagramTargets.deepLink, instagramTargets.webUrl);
    return;
  }

  openWebUrl(url);
}
