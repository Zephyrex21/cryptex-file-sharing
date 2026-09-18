import crypto from "crypto";

// ── Owner authentication ─────────────────────────────────────────────────────
// Every mutating route (rename, delete, visibility, folder membership) used to
// have zero access control — any visitor who saw an item's Mongo _id (trivial,
// since it's returned in every listing and every token lookup) could rename,
// delete, or re-share ANY file or folder, public or private. This is the fix:
// a single shared secret that has to be presented before any of those
// actions are allowed.
//
// The secret travels two ways:
//   1. A long-lived, HttpOnly cookie, set automatically the moment a request
//      arrives with a matching ?ownerkey=... query param (see
//      pickUpOwnerKeyFromQuery below). Visit the app once with that param on
//      the URL — e.g. bookmark https://yoursite.com/app?ownerkey=<key> — and
//      every request after that from the same browser just works. No form,
//      no prompt, nothing to paste; the browser carries the cookie for you.
//      HttpOnly also means page JS can never read it, which is strictly
//      better than a token sitting in localStorage.
//   2. An X-Owner-Key header, for scripts/curl/Postman — not used by the
//      app's own frontend, but handy for testing or automation.
//
// If OWNER_KEY isn't set in .env, one is generated at startup instead of
// falling back to "no check at all" — that keeps a fresh deploy secure by
// default (nobody outside your own server logs knows the generated key)
// without ever silently reopening the hole this exists to close. The
// trade-off: a generated key doesn't survive a restart, so the magic link
// changes too — set OWNER_KEY in your .env once you're happy with it so the
// link (and the cookie it sets) stays valid across restarts.
export const OWNER_KEY = process.env.OWNER_KEY || crypto.randomBytes(24).toString("hex");

if (!process.env.OWNER_KEY && !process.env.VITEST) {
  console.warn(
    `\n⚠️  OWNER_KEY is not set — generated a temporary one for this run only:\n\n` +
    `    ${OWNER_KEY}\n\n` +
    `   Open the app once with it on the URL to silently authorize this browser:\n\n` +
    `    http://localhost:${process.env.PORT || 3000}/app?ownerkey=${OWNER_KEY}\n\n` +
    `   Set OWNER_KEY="${OWNER_KEY}" in your .env to keep the same key (and link)\n` +
    `   valid across restarts — otherwise a new random one is generated every\n` +
    `   time the server starts, and the old link/cookie stops working.\n`
  );
}

const COOKIE_NAME = "cv_owner_key";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year, in seconds

const parseCookies = (header) => {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((pair) => {
    const i = pair.indexOf("=");
    if (i === -1) return;
    const k = pair.slice(0, i).trim();
    const v = pair.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
};

// Global middleware (mounted once, early, in index.js): if this request's
// URL includes ?ownerkey=<the real key>, silently set a long-lived HttpOnly
// cookie carrying it and strip nothing else about the request — completely
// invisible to whoever's browsing, no UI, no response body change. Safe to
// run on every request; it's a no-op unless the query param is present AND
// correct.
export const pickUpOwnerKeyFromQuery = (req, res, next) => {
  const provided = req.query?.ownerkey;
  if (provided && provided === OWNER_KEY) {
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=${encodeURIComponent(OWNER_KEY)}; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}; Path=/`
    );
  }
  next();
};

const isOwner = (req) => {
  const headerKey = req.headers["x-owner-key"];
  if (headerKey && headerKey === OWNER_KEY) return true;
  const cookies = parseCookies(req.headers.cookie);
  return cookies[COOKIE_NAME] === OWNER_KEY;
};

// Route middleware for mutating endpoints. Rejects anything without the
// owner's cookie or X-Owner-Key header.
export const requireOwner = (req, res, next) => {
  if (isOwner(req)) return next();
  return res.status(401).json({ message: "Owner key required for this action" });
};

// Token match + expiry re-check against a *specific, freshly-loaded*
// document — freshly-loaded matters, because it means a regenerated token
// (the app's own "revoke" mechanism) is compared against the CURRENT
// shareToken, not a stale one a caller might be holding on to.
//
// Deliberately does NOT re-check maxViews here. maxViews is a limit on how
// many times the *share link itself* can be opened (enforced atomically in
// getFileByToken/getFolderByToken, where viewCount is incremented) — not a
// cap on how many follow-up requests one legitimately-opened view is allowed
// to make. Re-checking it here would break the normal flow (open the link,
// then download/preview what it unlocked) the moment maxViews was set to 1.
const hasValidToken = (req, doc) => {
  const token = req.query.token || req.headers["x-share-token"];
  if (!token || token !== doc.shareToken) return false;
  if (doc.tokenExpiresAt && doc.tokenExpiresAt < new Date()) return false;
  return true;
};

// FILES — used by getSingleFile/previewFile/downloadFile.
// A private file's real protection for its CONTENT is the client-side AES
// key when it's encrypted (the server only ever holds ciphertext, so there's
// nothing meaningful to gate at this layer) — that's unchanged and correct.
// But a private, UNENCRYPTED file was being served to anyone who had its
// _id, with no check at all: no token, no expiry, nothing. This closes that
// — direct-id access to a private, unencrypted file now needs either the
// owner key or that file's own current, unexpired share token, exactly like
// the token-lookup endpoint already requires.
export const canAccessFile = (req, file) => {
  if (file.visibility !== "private" || file.encrypted) return true;
  return isOwner(req) || hasValidToken(req, file);
};

// FOLDERS — used by getFolderById/downloadFolderZip.
// Unlike file content, a folder's name/metadata is always plain text, even
// for an encrypted vault (only what's *inside* it is per-file encrypted) —
// so folders always need a real token match, encrypted or not. This mirrors
// the token-match check getFolderById already had, and adds the expiry
// re-check it was missing (only the separate /token/:token route enforced
// that before).
export const canAccessFolder = (req, folder) => {
  if (folder.visibility !== "private") return true;
  return isOwner(req) || hasValidToken(req, folder);
};
