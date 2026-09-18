import crypto from "crypto";

// ── Owner authentication ─────────────────────────────────────────────────────
// Every mutating route (rename, delete, visibility, folder membership) used to
// have zero access control — any visitor who saw an item's Mongo _id (trivial,
// since it's returned in every listing and every token lookup) could rename,
// delete, or re-share ANY file or folder, public or private. This is the fix:
// a single shared secret, sent as the X-Owner-Key header, required before any
// of those actions are allowed.
//
// If OWNER_KEY isn't set in .env, one is generated at startup instead of
// falling back to "no check at all" — that keeps a fresh deploy secure by
// default (nobody outside your own server logs knows the generated key)
// without ever silently reopening the hole this exists to close. The
// trade-off: a generated key doesn't survive a restart, so anything typed
// into the app's "Owner key" prompt before a restart stops working — copy
// the printed key into OWNER_KEY in your .env once you're happy with it so
// it stays stable.
export const OWNER_KEY = process.env.OWNER_KEY || crypto.randomBytes(24).toString("hex");

if (!process.env.OWNER_KEY && !process.env.VITEST) {
  console.warn(
    `\n⚠️  OWNER_KEY is not set — generated a temporary one for this run only:\n\n` +
    `    ${OWNER_KEY}\n\n` +
    `   Paste it into the app (nav bar → key icon) to unlock rename/delete/\n` +
    `   sharing actions. Set OWNER_KEY="${OWNER_KEY}" in your .env to keep the\n` +
    `   same key across restarts — otherwise a new random one is generated\n` +
    `   every time the server starts, and you'll need to re-enter it.\n`
  );
}

// Route middleware for mutating endpoints. Rejects anything without the
// correct X-Owner-Key header.
export const requireOwner = (req, res, next) => {
  const provided = req.headers["x-owner-key"];
  if (provided && provided === OWNER_KEY) return next();
  return res.status(401).json({ message: "Owner key required for this action" });
};

const isOwner = (req) => {
  const provided = req.headers["x-owner-key"];
  return !!provided && provided === OWNER_KEY;
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
