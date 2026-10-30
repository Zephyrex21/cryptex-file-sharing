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
// Parses ANY textual IPv6 form into 8 numeric hextets (handles "::" compression,
// dotted-quad tails, bracketed literals and zone ids), or null if malformed.
// The old string-prefix checks missed forms like "::ffff:7f00:1" — the very same
// address as 127.0.0.1 written in hex — so classification now works on numbers.
const parseIPv6 = (input) => {
  let s = String(input).toLowerCase().trim().split("%")[0];
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  if (s.includes(".")) {
    const cut = s.lastIndexOf(":");
    const v4 = ipv4ToInt(s.slice(cut + 1));
    if (v4 === null) return null;
    s = `${s.slice(0, cut + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (str) => (str === "" ? [] : str.split(":"));
  let groups;
  if (halves.length === 1) {
    groups = toGroups(halves[0]);
    if (groups.length !== 8) return null;
  } else {
    const head = toGroups(halves[0]), tail = toGroups(halves[1]);
    if (head.length + tail.length > 7) return null;
    groups = [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
  }
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
};
const v4FromHextets = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

const isPrivateOrReservedIPv6 = (ip) => {
  const h = parseIPv6(ip);
  if (!h) return true; // can't parse → unsafe
  const zero = (from, to) => h.slice(from, to).every((x) => x === 0);
  if (zero(0, 8)) return true;                                   // ::
  if (zero(0, 7) && h[7] === 1) return true;                     // ::1
  if (zero(0, 5) && h[5] === 0xffff)                             // ::ffff:a.b.c.d  IPv4-mapped (any notation)
    return isPrivateOrReservedIPv4(v4FromHextets(h[6], h[7]));
  if (zero(0, 4) && h[4] === 0xffff && h[5] === 0) return true;  // ::ffff:0:a.b.c.d  IPv4-translated (SIIT)
  if (zero(0, 6)) return true;                                   // ::a.b.c.d  deprecated IPv4-compatible
  if (h[0] === 0x64 && h[1] === 0xff9b) {                        // 64:ff9b::/96 NAT64 — judge the embedded IPv4
    if (zero(2, 6)) return isPrivateOrReservedIPv4(v4FromHextets(h[6], h[7]));
    return true;                                                 // 64:ff9b:1::/48 local-use NAT64
  }
  if (h[0] === 0x2002) return isPrivateOrReservedIPv4(v4FromHextets(h[1], h[2])); // 6to4 — embedded IPv4
  if (h[0] === 0x2001 && h[1] === 0) return true;                // Teredo
  if (h[0] === 0x2001 && h[1] === 0xdb8) return true;            // documentation
  if (h[0] === 0x2001 && h[1] === 0x2 && h[2] === 0) return true;// benchmarking
  if (h[0] === 0x100 && zero(1, 4)) return true;                 // 100::/64 discard-only
  if ((h[0] & 0xfe00) === 0xfc00) return true;                   // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfe80) return true;                   // fe80::/10 link-local
  if ((h[0] & 0xffc0) === 0xfec0) return true;                   // fec0::/10 site-local (deprecated)
  if ((h[0] & 0xff00) === 0xff00) return true;                   // ff00::/8 multicast
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
  // Overridable for tests; production default is FETCH_TIMEOUT_MS.
  const timeoutMs = Number(process.env.LINK_FETCH_TIMEOUT_MS) || FETCH_TIMEOUT_MS;
  let currentUrl = urlString;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isSafeUrl(currentUrl))) throw new Error("URL resolves to a disallowed address");

    // ONE deadline per hop covering headers AND body. It used to be cleared as
    // soon as headers arrived, so a server that sent headers and then stalled
    // (or trickled bytes) held the request — and its socket — open forever.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "CryptexLinkPreview/1.0 (+link unfurling bot)" },
      });

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        res.body?.cancel().catch(() => {});
        const loc = res.headers.get("location");
        if (!loc) throw new Error("Redirect with no location header");
        currentUrl = new URL(loc, currentUrl).toString(); // resolves relative redirects too
        continue; // loop re-validates the NEW url before following it
      }
      if (!res.ok) { res.body?.cancel().catch(() => {}); throw new Error(`Fetch failed with status ${res.status}`); }
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) { res.body?.cancel().catch(() => {}); throw new Error(`Not HTML (${contentType})`); }
      if (!res.body) throw new Error("Empty response body");

      const reader = res.body.getReader();
      let received = 0; const chunks = [];
      try {
        while (received < MAX_BODY_BYTES) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value); received += value.length;
        }
      } catch (err) {
        // Deadline hit / connection dropped mid-body: the <head> (all we need)
        // usually arrived already — use what we have, only fail if nothing did.
        if (chunks.length === 0) throw err;
      }
      reader.cancel().catch(() => {});
      return Buffer.concat(chunks).toString("utf8");
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("Too many redirects");
};

// ── Lightweight OG/meta extraction ──────────────────────────────────────────
// Linear-time scanner, NOT regexes with `[^>]+` between attributes: those
// backtrack quadratically on hostile pages (a 60 KB crafted page froze the
// event loop for ~8 s). Every loop here is bounded by an explicit cap, and
// each tag is parsed from a length-capped slice, so worst-case work is O(n).
const MAX_SCAN_CHARS = 60000;
const MAX_META_SCANS = 2000;
const MAX_META_TAGS = 300;
const MAX_TAG_LEN = 2000;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]{0,40})\s{0,8}=\s{0,8}(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

const isTagBoundary = (c) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 47;

const collectMetaTags = (head, lower) => {
  const tags = [];
  let pos = 0;
  for (let scans = 0; scans < MAX_META_SCANS && tags.length < MAX_META_TAGS; scans++) {
    const start = lower.indexOf("<meta", pos);
    if (start === -1) break;
    pos = start + 5;
    if (!isTagBoundary(lower.charCodeAt(start + 5))) continue;
    const chunk = head.slice(start + 5, start + 5 + MAX_TAG_LEN);
    const end = chunk.indexOf(">");
    if (end === -1) continue;
    const attrs = {};
    const body = chunk.slice(0, end);
    ATTR_RE.lastIndex = 0;
    let m;
    while ((m = ATTR_RE.exec(body)) !== null) {
      const k = m[1].toLowerCase();
      if (!(k in attrs)) attrs[k] = m[2] ?? m[3] ?? m[4] ?? "";
    }
    const key = (attrs.property ?? attrs.name);
    if (key !== undefined && attrs.content !== undefined) tags.push({ key: key.toLowerCase(), content: attrs.content });
  }
  return tags;
};

const findTitle = (head, lower) => {
  let pos = 0;
  for (let i = 0; i < 20; i++) {
    const s = lower.indexOf("<title", pos);
    if (s === -1) return null;
    pos = s + 6;
    const chunk = head.slice(s, s + 1500);
    const gt = chunk.indexOf(">");
    if (gt === -1) continue;
    const close = chunk.toLowerCase().indexOf("</title", gt);
    if (close === -1) continue;
    const inner = chunk.slice(gt + 1, close);
    if (inner.includes("<")) continue;
    return inner;
  }
  return null;
};

export const extractMeta = (html) => {
  const head = String(html || "").slice(0, MAX_SCAN_CHARS); // tags are always near the top
  const lower = head.toLowerCase();
  const tags = collectMetaTags(head, lower);
  const getMeta = (prop) => {
    const hit = tags.find((t) => t.key === prop);
    return hit ? hit.content : null;
  };
  const decodeEntities = (s) =>
    s ? s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : s;

  let title = getMeta("og:title");
  if (!title) title = findTitle(head, lower);
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
