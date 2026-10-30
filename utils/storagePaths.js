// Storage-object paths for Supabase.
//
// Uploaded objects used to be named `<original-name>-<Date.now()>.<ext>`, which is
// guessable (name + millisecond timestamp) and — worse — was handed back to
// every token holder as `fileUrl`, so a recipient kept permanent access to the
// bytes after the owner regenerated the token, made the file private again, or
// let the link expire.
//
// New objects get an unguessable 128-bit random path, `fileUrl`/`filePath` are
// never sent to clients for private items (utils/clientView.js), and the path
// is *rotated* (object moved to a fresh random path) whenever a file goes
// public → private or its token is regenerated, which kills any URL that was
// previously exposed.
import { randomBytes } from "crypto";

const safeExt = (name = "") => {
  const m = /\.([a-zA-Z0-9]{1,10})$/.exec(String(name));
  return m ? `.${m[1].toLowerCase()}` : "";
};

export const newObjectPath = (originalname = "") =>
  `${randomBytes(16).toString("hex")}${safeExt(originalname)}`;

// Only plain uploaded objects can be rotated: encrypted blobs never expose their
// URL (ciphertext only), links have no object, and legacy docs without a
// filePath have nothing we can move.
export const canRotate = (file) =>
  !!file && !file.encrypted && file.itemType !== "link" && !!file.filePath;

const MISSING = /not found|does not exist|no such|404/i;

// Moves the object to a fresh random path. Returns { filePath, fileUrl } to
// persist, or null when rotation doesn't apply (or the object is already gone).
// THROWS on any other storage failure — callers fail closed so a privacy action
// never silently succeeds while the old URL is still live.
export const rotateObjectPath = async (supabase, bucket, file) => {
  if (!canRotate(file)) return null;
  const to = newObjectPath(file.filePath);
  const { error } = await supabase.storage.from(bucket).move(file.filePath, to);
  if (error) {
    if (MISSING.test(error.message || "")) return null;
    throw new Error(`Storage rotation failed: ${error.message}`);
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(to);
  return { filePath: to, fileUrl: data.publicUrl };
};

// Best-effort undo when the DB write that follows a successful move fails.
export const undoRotation = async (supabase, bucket, from, to) => {
  try { await supabase.storage.from(bucket).move(to, from); } catch { /* best effort */ }
};
