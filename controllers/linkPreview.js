import dns from "dns/promises";

// ── SSRF protection ──────────────────────────────────────────────────────────
// This module fetches URLs a user supplies. Without safeguards, that's a
// classic SSRF hole — someone could point it at internal infrastructure or a
// cloud metadata endpoint (169.254.169.254, the address every major cloud
// provider uses to serve instance credentials) and use this server as a
// proxy to probe/reach things it should never be able to reach. Every check
// below exists because of that, not as generic hardening for its own sake.

const ipv4ToInt = (ip) => {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return (parts[0] << 24 | parts[1] << 16 | parts[2] << 8 | parts[3]) >>> 0;
};
const inRange = (intIp, base, bits) => {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (intIp & mask) === (ipv4ToInt(base) & mask);
};
// Private, loopback, link-local (incl. cloud metadata), and other reserved ranges.
const PRIVATE_V4_RANGES = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
];
const isPrivateOrReservedIPv4 = (ip) => {
  const intIp = ipv4ToInt(ip);
  if (intIp === null) return true; // malformed → treat as unsafe
  return PRIVATE_V4_RANGES.some(([base, bits]) => inRange(intIp, base, bits));
};
const isPrivateOrReservedIPv6 = (ip) => {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (/^fe[89ab]/.test(lower)) return true;       // fe80::/10 link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 unique local
  if (lower.startsWith("::ffff:")) {               // IPv4-mapped — unwrap and re-check
    const v4 = lower.split(":").pop();
    if (v4.includes(".")) return isPrivateOrReservedIPv4(v4);
  }
  return false;
};

const resolvesSafely = async (hostname) => {
  let addresses;
  try { addresses = await dns.lookup(hostname, { all: true, verbatim: true }); }
  catch { return false; }
  if (addresses.length === 0) return false;
  return addresses.every(({ address, family }) =>
    family === 4 ? !isPrivateOrReservedIPv4(address) : !isPrivateOrReservedIPv6(address)
  );
};

export const isSafeUrl = async (urlString) => {
  let url;
  try { url = new URL(urlString); } catch { return false; }
  if (!["http:", "https:"].includes(url.protocol)) return false;
  if (!url.hostname || url.hostname === "localhost") return false;
  return resolvesSafely(url.hostname);
};

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 6000;
const MAX_BODY_BYTES = 700_000; // OG tags live in <head> — no need to read a whole page

// Fetches a URL and returns its HTML, re-validating isSafeUrl at EVERY
// redirect hop (not just the original URL) — a server could otherwise
// resolve safely on the first request and redirect to an internal address,
// bypassing a check done only once up front.
export const safeFetchHtml = async (urlString) => {
  let currentUrl = urlString;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isSafeUrl(currentUrl))) throw new Error("URL resolves to a disallowed address");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "CryptexLinkPreview/1.0 (+link unfurling bot)" },
      });
    } finally { clearTimeout(timeout); }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("Redirect with no location header");
      currentUrl = new URL(loc, currentUrl).toString(); // resolves relative redirects too
      continue; // loop re-validates the NEW url before following it
    }
    if (!res.ok) throw new Error(`Fetch failed with status ${res.status}`);
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) throw new Error(`Not HTML (${contentType})`);

    const reader = res.body.getReader();
    let received = 0; const chunks = [];
    while (received < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); received += value.length;
    }
    reader.cancel().catch(() => {});
    return Buffer.concat(chunks).toString("utf8");
  }
  throw new Error("Too many redirects");
};

// ── Lightweight OG/meta extraction ──────────────────────────────────────────
// Regex-based rather than a full HTML parser — we only need a handful of
// specific tags, and this keeps the project dependency-free for it (no
// cheerio/jsdom just for a few <meta> reads).
export const extractMeta = (html) => {
  const head = html.slice(0, 60000); // tags are always near the top; cap the scan
  const getMeta = (prop) => {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i");
    const m = head.match(re1) || head.match(re2);
    return m ? m[1] : null;
  };
  const decodeEntities = (s) =>
    s ? s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : s;

  let title = getMeta("og:title");
  if (!title) { const m = head.match(/<title[^>]*>([^<]*)<\/title>/i); title = m ? m[1] : null; }
  const image = getMeta("og:image");
  const description = getMeta("og:description") || getMeta("description");
  const siteName = getMeta("og:site_name");

  return {
    title: decodeEntities(title)?.trim() || null,
    image: image?.trim() || null,
    description: decodeEntities(description)?.trim().slice(0, 200) || null,
    siteName: decodeEntities(siteName)?.trim() || null,
  };
};
