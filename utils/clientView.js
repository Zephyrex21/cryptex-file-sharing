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

export const toClientFile = (doc) => {
  const o = plain(doc);
  if (o && typeof o === "object" && o.visibility === "private") {
    for (const k of PRIVATE_HIDDEN) delete o[k];
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
