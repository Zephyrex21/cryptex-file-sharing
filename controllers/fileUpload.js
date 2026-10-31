import path from "path";
import mongoose from "mongoose";
import File from "../models/File.js";
import Folder from "../models/Folder.js";
import supabase from "../config/supabase.js";
import { Readable } from "stream";
import { ZipArchive } from "archiver";
import { isSafeUrl, safeFetchHtml, safeFetchImage, extractMeta } from "./linkPreview.js";
import { checkKnownMalwareHash, isScanConfigured } from "../utils/malwareScan.js";
import { appendFilesToZip } from "./folderController.js";
import { canAccessFile, canMutateFile, canAccessFolder, canDeleteFile } from "../middleware/auth.js";
import { generateToken } from "../utils/token.js";
import { newObjectPath, rotateObjectPath, undoRotation } from "../utils/storagePaths.js";
import { toClientFile } from "../utils/clientView.js";
import { serverError } from "../utils/httpError.js";
import { hasStorageRoom } from "../utils/storageQuota.js";
import { withTokenRetry } from "../utils/tokenRetry.js";

const BUCKET = process.env.SUPABASE_BUCKET || "cloudvault-files";

// ── Magic-byte verification ─────────────────────────────────────────────────
// The MIME type multer sees comes straight from the client and is trivially
// spoofable (rename evil.html to photo.jpg, lie about Content-Type). This
// checks the file's actual leading bytes against its claimed type so a
// content/type mismatch is rejected before it ever reaches storage.
// Verified against real sample files of every type in ALLOWED — see test run.
//
// Document types don't fit the simple "check the first few bytes" pattern:
//   - Plain text (.txt/.csv) has no magic bytes at all — anything can start
//     with any byte. Verified instead by confirming the content looks like
//     text (no null bytes, valid UTF-8) rather than a binary blob wearing a
//     text extension.
//   - Legacy .doc uses the OLE2 Compound File signature — a fixed byte match
//     like everything else above.
//   - .docx/.xlsx/.pptx are secretly ZIP files (same magic bytes as .zip
//     itself), so a plain .zip renamed to .docx would pass a bytes-only
//     check. Verified by requiring BOTH the ZIP signature AND the presence
//     of that format's specific internal path (e.g. word/document.xml) —
//     ZIP local file headers store entry names uncompressed, so this is a
//     cheap, dependency-free way to confirm which kind of OOXML file it is.
const ZIP_SIGNATURES = [[0x50,0x4B,0x03,0x04],[0x50,0x4B,0x05,0x06],[0x50,0x4B,0x07,0x08]];
const MAGIC_BYTES = {
  "image/jpeg": [[0xFF, 0xD8, 0xFF]],
  "image/png":  [[0x89, 0x50, 0x4E, 0x47]],
  "image/gif":  [[0x47, 0x49, 0x46, 0x38]],
  "image/webp": "webp",
  "video/webm": [[0x1A, 0x45, 0xDF, 0xA3]],
  "video/ogg":  [[0x4F, 0x67, 0x67, 0x53]],
  "video/x-msvideo": "avi",
  "video/mp4":       "ftyp",
  "video/quicktime": "ftyp",
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]],
  "application/zip":             ZIP_SIGNATURES,
  "application/x-zip-compressed": ZIP_SIGNATURES,
  "text/plain": "text",
  "text/csv":   "text",
  "application/xml": "xml",
  "text/xml":        "xml",
  "application/msword": [[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]],
  "application/vnd.ms-powerpoint": [[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "ooxml:word/document.xml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":       "ooxml:xl/workbook.xml",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "ooxml:ppt/presentation.xml",
  // code/dev files — text-based, verified via looksLikeText; JSON-shaped
  // ones (.json/.ipynb — a notebook file IS a JSON document) get the
  // slightly stricter looksLikeJson check
  "text/x-python": "text", "text/javascript": "text", "text/jsx": "text",
  "text/typescript": "text", "text/tsx": "text", "text/markdown": "text",
  "text/x-java": "text", "text/x-c": "text", "text/x-c++": "text",
  "text/x-c-header": "text", "text/x-c++-header": "text",
  "text/css": "text", "text/html": "text", "application/sql": "text",
  "text/yaml": "text", "application/x-sh": "text",
  "application/json": "json", "application/x-ipynb+json": "json",
};
const bufferStartsWith = (buffer, bytes) => {
  if (buffer.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (buffer[i] !== bytes[i]) return false;
  return true;
};
const isZipSignature = (buffer) => ZIP_SIGNATURES.some(bytes => bufferStartsWith(buffer, bytes));
// No null bytes + valid UTF-8 in a leading sample = looks like real text.
// A renamed binary (exe, image, etc.) will almost always contain a null
// byte or invalid UTF-8 sequences within the first few KB.
const looksLikeText = (buffer) => {
  const sample = buffer.subarray(0, 8000);
  if (sample.includes(0x00)) return false;
  return !sample.toString("utf8").includes("\uFFFD");
};
export const verifyMagicBytes = (buffer, mimetype) => {
  const sig = MAGIC_BYTES[mimetype];
  if (!sig) return true; // type not in our table — fileFilter already restricts to ALLOWED, so this shouldn't occur
  if (sig === "webp") return bufferStartsWith(buffer, [0x52,0x49,0x46,0x46]) && buffer.slice(8,12).toString("ascii") === "WEBP";
  if (sig === "avi")  return bufferStartsWith(buffer, [0x52,0x49,0x46,0x46]) && buffer.slice(8,12).toString("ascii") === "AVI ";
  if (sig === "ftyp") return buffer.length >= 8 && buffer.slice(4,8).toString("ascii") === "ftyp";
  if (sig === "text") return looksLikeText(buffer);
  if (sig === "json") return looksLikeText(buffer) && /^[{[]/.test(buffer.subarray(0, 200).toString("utf8").trimStart());
  if (sig === "xml") return looksLikeText(buffer) && buffer.subarray(0, 200).toString("utf8").trimStart().startsWith("<");
  if (typeof sig === "string" && sig.startsWith("ooxml:")) {
    const internalPath = sig.slice(6);
    return isZipSignature(buffer) && buffer.includes(Buffer.from(internalPath));
  }
  return sig.some(bytes => bufferStartsWith(buffer, bytes));
};

// Defense in depth: the frontend's esc() already prevents the displayed name
// from causing HTML/script injection, but strip control characters and cap
// length here too, so nothing odd ever lands in storage or logs in the first place.
export const sanitizeOriginalName = (name) =>
  // eslint-disable-next-line no-control-regex -- intentional: stripping control chars is the point
  String(name).replace(/[\x00-\x1F\x7F]/g, "").slice(0, 255).trim() || "file";

// Most OSes have no registered MIME type for these extensions, so the
// browser-reported file.mimetype is unreliable (often an empty string) —
// the extension is the trustworthy signal here, not the claimed type. Only
// used to pick which canonical type to verify/store; the actual bytes are
// still checked against that type via verifyMagicBytes below, so a
// mismatched upload (e.g. a binary renamed to .py) is still rejected.
const CODE_EXT_TO_MIME = {
  ".py": "text/x-python", ".ipynb": "application/x-ipynb+json",
  ".js": "text/javascript", ".jsx": "text/jsx",
  ".ts": "text/typescript", ".tsx": "text/tsx",
  ".json": "application/json", ".md": "text/markdown",
  ".java": "text/x-java", ".c": "text/x-c", ".cpp": "text/x-c++",
  ".h": "text/x-c-header", ".hpp": "text/x-c++-header",
  ".css": "text/css", ".html": "text/html", ".sql": "application/sql",
  ".yml": "text/yaml", ".yaml": "text/yaml", ".sh": "application/x-sh",
};
const resolveEffectiveMimetype = (originalname, reportedMimetype) => {
  const ext = path.extname(originalname).toLowerCase();
  return CODE_EXT_TO_MIME[ext] || reportedMimetype;
};

// ── Upload buffer to Supabase Storage ─────────────────────────────────────
const uploadToSupabase = async (buffer, originalname, mimetype) => {
  // Unguessable 128-bit random object path (see utils/storagePaths.js) — the
  // original name only lives in the DB, never in the storage URL.
  const filePath = newObjectPath(originalname);

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, buffer, { contentType: mimetype, upsert: false });

  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(data.path);

  return { publicUrl: urlData.publicUrl, filePath: data.path };
};

// ── UPLOAD ─────────────────────────────────────────────────────────────────
export const uploadFile = async (req, res) => {
  let filePath = null;

  try {
    if (!req.file) return res.status(400).json({ message: "No file provided" });

    // Optional global storage cap (MAX_TOTAL_STORAGE_MB) — off unless configured.
    if (!(await hasStorageRoom(req.file.size, File)).ok) {
      return res.status(507).json({ message: "Storage is full right now — please try again later" });
    }

    const isEncrypted = req.body.encrypted === "true";

    // ── Client-side-encrypted (zero-knowledge) upload ─────────────────────
    // req.file.buffer is AES-256-GCM ciphertext produced entirely in the
    // browser — the plaintext bytes, real filename, and real MIME type never
    // reach this server. That makes verifyMagicBytes structurally impossible
    // to run here (ciphertext will never match a known signature, by
    // definition — that's expected, not a gap). What we validate instead is
    // that the required encryption metadata was actually sent, so this path
    // can't be used as a backdoor around content validation for *unencrypted*
    // uploads pretending to be octet-stream.
    if (isEncrypted) {
      const { iv, encryptedName, encryptedNameIV, encryptedMimeType, encryptedMimeTypeIV, vaultFolderId } = req.body;
      if (!iv || !encryptedName || !encryptedNameIV || !encryptedMimeType || !encryptedMimeTypeIV) {
        return res.status(400).json({ message: "Missing encryption metadata for encrypted upload" });
      }
      // multer expands `field[$gt]=x` into objects. Every field must be a plain
      // string, otherwise an attacker can smuggle Mongo operators into the
      // folder lookup below (and non-string metadata is never legitimate).
      const metaFields = [iv, encryptedName, encryptedNameIV, encryptedMimeType, encryptedMimeTypeIV];
      if (metaFields.some((v) => typeof v !== "string") ||
          (vaultFolderId !== undefined && typeof vaultFolderId !== "string")) {
        return res.status(400).json({ message: "Invalid upload fields" });
      }
      if (req.file.mimetype !== "application/octet-stream") {
        return res.status(400).json({ message: "Encrypted uploads must be sent as application/octet-stream" });
      }

      // Uploading directly into a vault folder: the client already used
      // that folder's shared key to encrypt (we have no way to check that —
      // the key never reaches us — but we DO verify the target actually is
      // an encrypted vault, so this can't be used to sneak a file into an
      // arbitrary ordinary folder's file list under false pretenses).
      let vaultFolder = null;
      if (vaultFolderId) {
        vaultFolder = await Folder.findById(vaultFolderId);
        if (!vaultFolder || !vaultFolder.encrypted) {
          return res.status(400).json({ message: "Target vault folder not found" });
        }
        // The vault's _id is not a secret, so it can't authorize writes. The
        // vault's own current, unexpired share token must accompany the upload
        // (?token= or X-Share-Token) — otherwise anyone could drop junk
        // ciphertext into somebody else's vault.
        if (!canAccessFolder(req, vaultFolder)) {
          return res.status(403).json({ message: "This vault is private — a valid share token is required to upload into it" });
        }
      }

      const result = await uploadToSupabase(
        req.file.buffer,
        "encrypted.bin", // extension hint only — the storage path itself is random
        "application/octet-stream"
      );
      filePath = result.filePath;

      const file = await withTokenRetry(() => File.create({
        originalName: "Encrypted file", // placeholder; the real name only exists as ciphertext below
        fileUrl:      result.publicUrl,
        filePath:     result.filePath,
        fileType:     "application/octet-stream",
        fileSize:     req.file.size,
        storageType:  "supabase",
        shareToken:   generateToken(),
        // Always private: a public gallery entry nobody can decrypt (no key
        // ever reaches this server) has no purpose and can't be displayed
        // meaningfully anyway. See setVisibility below for the same rule
        // enforced against later attempts to flip this to public.
        visibility:   "private",
        encrypted:         true,
        encryptionIV:      iv,
        encryptedName,
        encryptedNameIV,
        encryptedMimeType,
        encryptedMimeTypeIV,
        folderId:     vaultFolder ? vaultFolder._id : null,
      }));

      if (vaultFolder) {
        vaultFolder.files.push(file._id);
        await vaultFolder.save();
      }

      return res.status(201).json({ message: "Uploaded (end-to-end encrypted)!", file: toClientFile(file) });
    }

    // ── Ordinary upload — unchanged ─────────────────────────────────────────
    // Browser-reported mimetype is unreliable for code/dev extensions (see
    // CODE_EXT_TO_MIME above) — resolve the canonical type once, up front,
    // and use it consistently everywhere below instead of the raw claim.
    const effectiveMimetype = resolveEffectiveMimetype(req.file.originalname, req.file.mimetype);

    if (!verifyMagicBytes(req.file.buffer, effectiveMimetype)) {
      return res.status(400).json({
        message: `File content doesn't match its declared type (${effectiveMimetype}) — upload rejected`,
      });
    }

    // Best-effort malware pre-screen (see utils/malwareScan.js for what this
    // does and doesn't catch). Runs after the free local magic-byte check,
    // before paying for a network round-trip. checked=false means no
    // verdict was possible — fail open, don't block the upload over a
    // third-party outage or missing API key.
    const scan = await checkKnownMalwareHash(req.file.buffer);
    if (scan.flagged) {
      return res.status(400).json({ message: `Upload rejected: ${scan.reason}` });
    }
    if (!scan.checked && isScanConfigured()) {
      // A key is configured but no verdict was reached (VT down / rate-limited).
      // Default: fail open and say so in the log. Set VIRUSTOTAL_FAIL_CLOSED=true
      // if you'd rather refuse uploads than accept them unchecked.
      console.warn("Malware pre-screen could not reach a verdict for an upload (VirusTotal unavailable or rate-limited)");
      if (process.env.VIRUSTOTAL_FAIL_CLOSED === "true") {
        return res.status(503).json({ message: "Couldn't run the malware check right now — please try again shortly" });
      }
    }

    const result = await uploadToSupabase(
      req.file.buffer,
      req.file.originalname,
      effectiveMimetype
    );
    filePath = result.filePath;

    // Explicitly generate shareToken — don't rely on schema default,
    // which can silently fail on some Mongoose versions with sparse unique indexes.
    const file = await withTokenRetry(() => File.create({
      originalName: sanitizeOriginalName(req.file.originalname),
      fileUrl:      result.publicUrl,
      filePath:     result.filePath,
      fileType:     effectiveMimetype,
      fileSize:     req.file.size,
      storageType:  "supabase",
      shareToken:   generateToken(),
      visibility:   "public",
    }));

    res.status(201).json({ message: "Uploaded!", file: toClientFile(file) });
  } catch (e) {
    if (filePath) {
      await supabase.storage.from(BUCKET).remove([filePath]).catch(() => {});
    }
    serverError(res, e);
  }
};

// ── CREATE LINK ──────────────────────────────────────────────────────────────
// Saves a URL as a shareable item — same token/visibility/folder system as a
// real upload, just no Supabase object behind it. Best-effort fetches a
// title/image/description from the page (see linkPreview.js for the SSRF
// protections on that fetch); if the fetch fails, we still save the link
// with just the URL itself — the person typed a real address, that's enough
// to be useful even without a rich preview.
const THUMB_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
const mirrorLinkImage = async (imageUrl) => {
  try {
    const { buffer, contentType } = await safeFetchImage(imageUrl);
    const path = newObjectPath(`thumb.${THUMB_EXT[contentType]}`);
    const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: false });
    if (error) throw new Error(error.message);
    return { path, url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl };
  } catch (e) {
    console.warn(`Link preview image not mirrored: ${e.message}`);
    return null;
  }
};

export const createLink = async (req, res) => {
  let mirroredPath = null;
  try {
    const { url, visibility } = req.body;
    if (!url || typeof url !== "string" || !url.trim()) {
      return res.status(400).json({ message: "A URL is required" });
    }

    let parsed;
    try { parsed = new URL(url.trim()); }
    catch { return res.status(400).json({ message: "That doesn't look like a valid URL" }); }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return res.status(400).json({ message: "Only http and https links are supported" });
    }
    if (!(await isSafeUrl(parsed.toString()))) {
      return res.status(400).json({ message: "That URL can't be reached" });
    }

    let meta = { title: null, image: null, description: null, siteName: null };
    try {
      const html = await safeFetchHtml(parsed.toString());
      meta = extractMeta(html);
    } catch (err) {
      console.warn(`Link preview fetch failed for ${parsed.toString()}: ${err.message}`);
    }

    // Only trust https images — an http image on an https page gets blocked
    // by the browser as mixed content anyway, so there's no point saving it.
    const safeImage = meta.image && meta.image.startsWith("https://") ? meta.image : null;
    const domain = parsed.hostname.replace(/^www\./, "");
    const title = sanitizeOriginalName(meta.title || domain);

    // Mirror the preview image into OUR storage instead of hot-linking it: a
    // third-party <img> makes every viewer's browser contact the linked site
    // (IP/UA tracking by whoever controls it). Best-effort — no image is fine.
    const mirrored = safeImage ? await mirrorLinkImage(safeImage) : null;
    mirroredPath = mirrored ? mirrored.path : null;

    const file = await withTokenRetry(() => File.create({
      itemType:        "link",
      originalName:    title,
      linkUrl:         parsed.toString(),
      linkTitle:       meta.title ? sanitizeOriginalName(meta.title) : null,
      linkDescription: meta.description ? sanitizeOriginalName(meta.description) : null,
      linkImage:       mirrored ? mirrored.url : null,
      filePath:        mirrored ? mirrored.path : undefined, // lets delete/purge clean the thumbnail up too
      linkDomain:      sanitizeOriginalName(domain),
      fileType:        "text/x-url",
      shareToken:      generateToken(),
      visibility:      visibility === "private" ? "private" : "public",
    }));

    res.status(201).json({ message: "Link added!", file: toClientFile(file) });
  } catch (e) {
    if (mirroredPath) await supabase.storage.from(BUCKET).remove([mirroredPath]).catch(() => {}); // don't orphan the thumbnail
    serverError(res, e);
  }
};

// ── GET ALL ────────────────────────────────────────────
const GALLERY_MAX_ITEMS = Math.max(1, Number(process.env.GALLERY_MAX_ITEMS) || 1000);
export const getAllFiles = async (req, res) => {
  try {
    // Find IDs of all private folders so we can hide their files from the gallery.
    const privateFolderIds = await Folder.find({ visibility: 'private' }, '_id').lean();
    const privateFolderIdArr = privateFolderIds.map(f => f._id);

    // Build the query:
    //   - exclude individually-private files
    //   - exclude files that belong to a private folder
    const query = { visibility: { $ne: 'private' } };
    if (privateFolderIdArr.length > 0) {
      // $nin correctly handles null/undefined folderId (they're not in the array → included)
      query.folderId = { $nin: privateFolderIdArr };
    }

    // Pagination is opt-in via ?page=&limit= — omitting both keeps the exact
    // existing behavior (every matching file, one response) so the current
    // frontend gallery keeps working unchanged. Provide either param to get
    // a bounded page back instead, which is what a client built for scale
    // (or just a much bigger library than a demo ever has) would use.
    const hasPaging = req.query.page !== undefined || req.query.limit !== undefined;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const total = hasPaging ? await File.countDocuments(query) : undefined;
    let filesQuery = File.find(query).sort({ createdAt: -1 });
    if (hasPaging) filesQuery = filesQuery.skip((page - 1) * limit).limit(limit);
    else filesQuery = filesQuery.limit(GALLERY_MAX_ITEMS); // safety cap — see below
    const files = await filesQuery;

    // One-time migration: assign tokens to any legacy docs that don't have one.
    const needsToken = files.filter(f => !f.shareToken);
    if (needsToken.length > 0) {
      await Promise.all(needsToken.map(f => withTokenRetry(() => { f.shareToken = generateToken(); return f.save(); })));
    }

    const clientFiles = files.map(toClientFile);
    // Unpaged requests keep their old shape (one response, newest first) but are
    // bounded so a huge library can't turn one GET into an unbounded memory and
    // bandwidth hit. `truncated` is only present when the cap actually bit; use
    // ?page=&limit= to walk the rest. Raise it with GALLERY_MAX_ITEMS.
    const truncated = !hasPaging && files.length >= GALLERY_MAX_ITEMS;
    if (hasPaging) {
      return res.status(200).json({
        count: files.length, files: clientFiles, total, page, limit,
        hasMore: page * limit < total,
      });
    }
    res.status(200).json({ count: files.length, files: clientFiles, ...(truncated ? { truncated: true } : {}) });
  } catch (e) { serverError(res, e); }
};

// ── GET BY TOKEN ── (no auth needed — used for shared links) ───────────────
export const getFileByToken = async (req, res) => {
  try {
    const file = await File.findOne({ shareToken: req.params.token });
    if (!file) return res.status(404).json({ message: "Invalid token — file not found" });
    if (file.tokenExpiresAt && file.tokenExpiresAt < new Date()) {
      return res.status(410).json({ message: "This token has expired" });
    }
    // Atomic: only increments if still under the limit at update time, so two
    // near-simultaneous requests on the very last remaining view can't both
    // slip through (a plain read-then-write here would allow exactly that).
    if (file.maxViews) {
      const updated = await File.findOneAndUpdate(
        { _id: file._id, viewCount: { $lt: file.maxViews } },
        { $inc: { viewCount: 1 } },
        { new: true }
      );
      if (!updated) {
        return res.status(410).json({ message: "This link has reached its view limit and is no longer available" });
      }
      return res.status(200).json({ file: toClientFile(updated) });
    }
    res.status(200).json({ file: toClientFile(file) });
  } catch (e) { serverError(res, e); }
};

// ── GET ONE ────────────────────────────────────────────────────────────────
export const getSingleFile = async (req, res) => {
  try {
    const file = await File.findById(req.params.id);
    if (!file) return res.status(404).json({ message: "Not found" });
    // Private + unencrypted: bare id access used to work forever, even after
    // the token expired or was regenerated. Now it needs the item's current
    // token. See middleware/auth.js for why encrypted files are exempt.
    if (!canAccessFile(req, file)) {
      return res.status(403).json({ message: "This file is private — a valid share token is required" });
    }
    res.status(200).json({ file: toClientFile(file) });
  } catch (e) { serverError(res, e); }
};

// ── RENAME ─────────────────────────────────────────────────────────────────
export const renameFile = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Name cannot be empty" });

    const existing = await File.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Not found" });
    // A public file can be renamed by anyone (see middleware/auth.js) — a
    // private one needs its own current, unexpired share token. This used
    // to be completely unchecked here.
    if (!canMutateFile(req, existing)) {
      return res.status(403).json({ message: "This file is private — a valid share token is required" });
    }
    // The real name of an encrypted file only exists as ciphertext the server
    // can't read — writing a plaintext name here would leak exactly the
    // metadata the encryption is meant to hide, so renaming is disabled.
    if (existing.encrypted) {
      return res.status(400).json({ message: "Encrypted files can't be renamed — the filename is end-to-end encrypted" });
    }

    const file = await File.findByIdAndUpdate(
      req.params.id,
      { originalName: sanitizeOriginalName(name) },
      { new: true }
    );
    if (!file) return res.status(404).json({ message: "Not found" });
    res.status(200).json({ message: "Renamed!", file: toClientFile(file) });
  } catch (e) { serverError(res, e); }
};

// ── SET VISIBILITY ─────────────────────────────────────────────────────────
// Body: { visibility: "public" | "private" }
export const setVisibility = async (req, res) => {
  try {
    const { visibility, expiresIn, maxViews, regenerateToken } = req.body;
    if (!["public", "private"].includes(visibility)) {
      return res.status(400).json({ message: "visibility must be 'public' or 'private'" });
    }

    // Always fetch first now — not just for the "going public" encrypted
    // check below, but because auth depends on the CURRENT (pre-mutation)
    // state: a public file can be freely made private by anyone (that's
    // what "public" means here), but changing anything about an ALREADY
    // private file — including flipping it back to public — needs that
    // file's own current, unexpired token. Checking against `existing`
    // rather than the target state is what stops a stranger from quietly
    // privatizing someone else's public file and keeping the new token for
    // themselves.
    const existing = await File.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Not found" });
    if (!canMutateFile(req, existing)) {
      return res.status(403).json({ message: "This file is private — a valid share token is required" });
    }

    if (visibility === "public") {
      // An encrypted file can never usefully be "public" — nobody browsing
      // the gallery has the key, so it would just be an inert, unlabeled
      // entry. Keeping this server-enforced (not just hidden in the UI)
      // means the rule holds even if a request is crafted by hand.
      if (existing.encrypted) {
        return res.status(400).json({ message: "Encrypted files must stay private — share via the encrypted link instead" });
      }
    }

    const update = { visibility };
    if (visibility === "public") {
      // Expiry/view-limits only mean something while a token is actually
      // gating access.
      update.tokenExpiresAt = null;
      update.maxViews = null;
      update.viewCount = 0;
    } else {
      // expiresIn is in minutes. 0/null/falsy → never expires.
      if (expiresIn !== undefined) {
        update.tokenExpiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 60000) : null;
      }
      // A new view limit always restarts the count from zero — setting
      // "3 views" should mean 3 views from now, not 3 minus however many
      // this link already had before the setting changed.
      if (maxViews !== undefined) {
        update.maxViews = maxViews > 0 ? maxViews : null;
        update.viewCount = 0;
      }
    }
    if (regenerateToken) {
      update.shareToken = generateToken();
      update.viewCount = 0; // a rotated token is a clean slate for its view budget too
    }

    // Revoke any storage URL that was ever exposed: going public → private, or
    // rotating the token of a private file, moves the object to a fresh random
    // path. Fails closed — if storage can't be rotated we do NOT report success.
    let rotated = null;
    const needsRotation =
      (visibility === "private" && existing.visibility === "public") ||
      (visibility === "private" && regenerateToken);
    if (needsRotation) {
      try {
        rotated = await rotateObjectPath(supabase, BUCKET, existing);
      } catch {
        return res.status(502).json({ message: "Couldn't secure the file in storage — nothing was changed, please try again" });
      }
      if (rotated) {
        update.filePath = rotated.filePath;
        update.fileUrl = rotated.fileUrl;
      }
    }

    let file;
    try {
      file = await withTokenRetry(() => {
        if (update.shareToken) update.shareToken = generateToken(); // fresh token if the last one collided
        return File.findByIdAndUpdate(req.params.id, update, { new: true });
      });
    } catch (e) {
      if (rotated) await undoRotation(supabase, BUCKET, existing.filePath, rotated.filePath);
      throw e;
    }
    if (!file) {
      if (rotated) await undoRotation(supabase, BUCKET, existing.filePath, rotated.filePath);
      return res.status(404).json({ message: "Not found" });
    }
    res.status(200).json({ message: `Visibility set to ${visibility}`, file: toClientFile(file) });
  } catch (e) { serverError(res, e); }
};

// ── Shared streaming helper ────────────────────────────────────────────────
const INLINE_SAFE_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "video/mp4", "video/webm", "video/ogg", "video/quicktime", "video/x-msvideo",
  "application/pdf",
]);
const streamFile = async (req, res, disposition) => {
  const file = await File.findById(req.params.id);
  if (!file) return res.status(404).json({ message: "Not found" });
  // Same rule as getSingleFile: a private, unencrypted file's bytes now
  // require that file's own current, unexpired token — this was the actual
  // hole that let a leaked/old _id keep downloading a "private" file
  // forever, expiry and token regeneration notwithstanding.
  if (!canAccessFile(req, file)) {
    return res.status(403).json({ message: "This file is private — a valid share token is required" });
  }

  const sourceUrl = file.fileUrl || file.cloudinaryUrl;
  if (!sourceUrl) return res.status(404).json({ message: "File URL missing" });

  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Storage returned ${response.status}`);
  if (!response.body) throw new Error("Empty response body from storage");

  const encoded  = encodeURIComponent(file.originalName).replace(/'/g, "%27");
  const fallback = file.originalName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");

  // Only formats a browser can't execute script from may render inline on our
  // origin. Everything else (html, xml, svg, js, text…) is forced to download
  // and sandboxed — an uploaded .html served inline here would be same-origin
  // stored XSS with access to every visitor's saved share tokens.
  const mime = (file.fileType || "application/octet-stream").toLowerCase();
  const inlineOk = disposition === "inline" && INLINE_SAFE_TYPES.has(mime);
  res.setHeader("Content-Disposition",
    `${inlineOk ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encoded}`);
  res.setHeader("Content-Type", mime);
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Chrome's built-in PDF viewer refuses to render sandboxed documents, and PDF
  // can't script our origin anyway; everything else gets a full sandbox.
  if (mime !== "application/pdf") res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");

  const cl = response.headers.get("content-length");
  if (cl) res.setHeader("Content-Length", cl);
  // Token-gated bytes must not sit in shared caches after the token is revoked.
  res.setHeader("Cache-Control", file.visibility === "private" ? "private, no-store" : "public, max-age=3600");

  const stream = Readable.fromWeb(response.body);
  stream.on("error", (err) => {
    if (!res.headersSent) serverError(res, err);
    else res.destroy();
  });
  stream.pipe(res);
};

// ── PREVIEW ────────────────────────────────────────────────────────────────
export const previewFile = async (req, res) => {
  try {
    await streamFile(req, res, "inline");
  } catch (e) {
    if (!res.headersSent) serverError(res, e);
  }
};

// ── DOWNLOAD ───────────────────────────────────────────────────────────────
export const downloadFile = async (req, res) => {
  try {
    await streamFile(req, res, "attachment");
  } catch (e) {
    if (!res.headersSent) serverError(res, e);
  }
};

// ── DELETE ─────────────────────────────────────────────────────────────────
export const deleteFile = async (req, res) => {
  try {
    const file = await File.findById(req.params.id);
    if (!file) return res.status(404).json({ message: "Not found" });
    // Tolerates an EXPIRED token (still must be the current one) so an owner can
    // always remove their own file — see canDeleteFile in middleware/auth.js.
    if (!canDeleteFile(req, file)) {
      return res.status(403).json({ message: "This file is private — a valid share token is required" });
    }

    // Order matters: the DB record goes FIRST, the storage object AFTER. If the
    // transaction fails nothing has been touched (the file is intact and can be
    // retried). The old order removed the bytes first, so a failing transaction
    // left a record pointing at a file that no longer existed — a broken entry.
    // The reverse failure (record gone, object removal fails) only strands an
    // unreferenced object, which is logged and harmless to users.
    const storagePath = file.filePath || file.cloudinaryId;

    // Pull this file's id out of its folder's files array AND delete the
    // file record as one atomic unit — otherwise a failure between the two
    // could leave the Folder document with a dangling reference to a File
    // that no longer exists (or vice versa: file gone, folder still thinks
    // it's there).
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (file.folderId) {
          await Folder.findByIdAndUpdate(file.folderId, { $pull: { files: file._id } }, { session });
        }
        await file.deleteOne({ session });
      });
    } finally {
      await session.endSession();
    }

    // Best-effort and outside the transaction: an external network call has no
    // business inside a DB transaction, and a storage hiccup must not make a
    // successful delete look like a failure.
    if (storagePath) {
      try {
        const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
        if (error) console.warn(`Supabase remove warning (non-fatal, object orphaned): ${error.message}`);
      } catch (e) {
        console.warn(`Supabase remove warning (non-fatal, object orphaned): ${e.message}`);
      }
    }

    res.status(200).json({ message: "Deleted!" });
  } catch (e) { serverError(res, e); }
};

// ── BULK: DOWNLOAD SELECTED FILES AS ZIP ────────────────────────────────────
// Same streaming-archive approach as downloadFolderZip in folderController.js
// (no temp files, piped straight through), just driven by an arbitrary list
// of file IDs from the bulk-select UI instead of a folder's membership.
// Encrypted files are silently skipped — bundling raw ciphertext into a zip
// with no key attached isn't useful, same reasoning as the folder version.
export const downloadFilesZip = async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.slice(0, 200) : [];
    if (!ids.length) return res.status(400).json({ message: "No file IDs provided" });

    const files = await File.find({
      _id: { $in: ids },
      visibility: { $ne: "private" },
      encrypted: { $ne: true },
      itemType: "file",
    });
    if (!files.length) return res.status(404).json({ message: "No downloadable files found for the given IDs" });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="cryptex-selected-${Date.now()}.zip"`);

    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on("error", (err) => {
      if (!res.headersSent) serverError(res, err);
      else res.destroy();
    });
    archive.pipe(res);

    await appendFilesToZip(archive, files);
    await archive.finalize();
  } catch (e) {
    if (!res.headersSent) serverError(res, e);
  }
};
