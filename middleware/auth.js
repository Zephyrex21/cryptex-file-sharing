// ── Private-item access ──────────────────────────────────────────────────────
// This app has no login/user system — it's a personal, share-by-link drop
// box. "Public" means exactly that: anyone who can reach the API can see,
// rename, delete, or re-share a public file/folder, same as they can already
// see it in the gallery. That's an intentional trade-off (see README →
// Security Considerations), not an oversight.
//
// "Private" is the one thing that's actually gated, and the fix here is
// about making that gate consistent: a private item's own current,
// unexpired share token is now required everywhere its _id could be used —
// reading it, downloading it, AND mutating it (rename/delete/visibility/
// folder membership) — not just on the one endpoint that happened to check
// it before. Previously, a private item's _id (handed out the moment
// anyone opened its share link) worked forever on most of these routes with
// no token check at all; regenerating or expiring the token didn't help,
// because nothing was actually looking at it.

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
// then download/preview/manage what it unlocked) the moment maxViews was
// set to 1.
const tokenMatches = (token, doc) => {
  if (!token || token !== doc.shareToken) return false;
  if (doc.tokenExpiresAt && doc.tokenExpiresAt < new Date()) return false;
  return true;
};
const hasValidToken = (req, doc) =>
  tokenMatches(req.query.token || req.headers["x-share-token"], doc);

// FILES — reading (getSingleFile/previewFile/downloadFile).
// A private file's real protection for its CONTENT is the client-side AES
// key when it's encrypted (the server only ever holds ciphertext, so there's
// nothing meaningful to gate at this layer). A private, UNENCRYPTED file
// needs its own current, unexpired share token.
export const canAccessFile = (req, file) => {
  if (file.visibility !== "private" || file.encrypted) return true;
  return hasValidToken(req, file);
};

// FILES — mutating (rename/delete/visibility). Unlike canAccessFile above,
// there's no encrypted bypass here: the content being unreadable doesn't
// make deleting or re-sharing it a harmless, free-for-all action. A private
// file — encrypted or not — needs its own current, unexpired token to be
// changed, exactly like reading a private, unencrypted one does.
export const canMutateFile = (req, file) => {
  if (file.visibility !== "private") return true;
  return hasValidToken(req, file);
};

// FOLDERS — used for both reading (getFolderById/downloadFolderZip) AND
// mutating (rename/delete/visibility/file membership). A folder's
// name/metadata is always plain text, even for an encrypted vault (only
// what's *inside* it is per-file encrypted), so there's no encrypted
// bypass here either — a private folder always needs a real token match.
export const canAccessFolder = (req, folder) => {
  if (folder.visibility !== "private") return true;
  return hasValidToken(req, folder);
};

// FOLDERS — the folder a file is being moved OUT of. Moving a file between
// two private folders involves two different tokens, but a request only has
// one ?token= — so the source folder's token can arrive separately as
// ?sourceToken= (or an X-Source-Token header). The normal token is accepted
// for the source too, which covers the common case of one token being
// enough (e.g. the destination is public).
export const canLeaveFolder = (req, folder) => {
  if (canAccessFolder(req, folder)) return true;
  return tokenMatches(req.query.sourceToken || req.headers["x-source-token"], folder);
};
