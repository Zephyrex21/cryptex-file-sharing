// What the API is allowed to tell a client about a stored file.
//
// For PRIVATE items the storage location (`fileUrl`, `filePath`, legacy
// cloudinary fields) is withheld: bytes are only reachable through the
// token-checked /preview and /download routes, so revoking/regenerating a token
// really does revoke access. Public items keep their URL (the gallery uses it).
const PRIVATE_HIDDEN = ["fileUrl", "cloudinaryUrl", "filePath", "cloudinaryId"];

const plain = (doc) => {
  if (!doc) return doc;
  if (typeof doc.toObject === "function") return doc.toObject();
  return { ...doc };
};

// Link-preview images are mirrored into OUR storage when a link is added. Links
// saved before that still point at the third party's server, and rendering them
// would make every gallery viewer's browser contact that host (IP/UA tracking
// by whoever controls the linked page). Withhold any image that isn't ours —
// the card falls back to its icon.
const storageOrigin = () => {
  try { return new URL(process.env.SUPABASE_URL).origin; } catch { return null; }
};
const isOurImage = (url, origin) => {
  try { return new URL(url).origin === origin; } catch { return false; }
};

export const toClientFile = (doc) => {
  const o = plain(doc);
  if (o && typeof o === "object") {
    if (o.visibility === "private") for (const k of PRIVATE_HIDDEN) delete o[k];
    const origin = storageOrigin();
    if (o.linkImage && origin && !isOurImage(o.linkImage, origin)) delete o.linkImage;
  }
  return o;
};

// Folder docs carry virtuals (fileCount) via toJSON; populated files are
// scrubbed individually. Un-populated ids pass through untouched.
export const toClientFolder = (folder) => {
  if (!folder) return folder;
  const o = typeof folder.toJSON === "function" ? folder.toJSON() : { ...folder };
  if (Array.isArray(o.files)) {
    o.files = o.files.map((f) => (f && typeof f === "object" && !f._bsontype && f.visibility !== undefined ? toClientFile(f) : f));
  }
  return o;
};
