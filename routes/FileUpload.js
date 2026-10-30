import express from "express";
import multer from "multer";
import { createUploadGuard } from "../middleware/uploadGuard.js";
import rateLimit from "express-rate-limit";
import path from "path";
import {
  uploadFile,
  createLink,
  getAllFiles,
  getSingleFile,
  getFileByToken,
  setVisibility,
  renameFile,
  previewFile,
  downloadFile,
  deleteFile,
  downloadFilesZip,
} from "../controllers/fileUpload.js";

const router = express.Router();

// Token lookup is the one endpoint where brute-forcing matters most — a token
// IS the access control here, so this limiter is the main defense against
// scripted guessing. With 6-character tokens (~2.18 billion possibilities,
// see utils/token.js) this limiter is doing real work, not just closing a
// theoretical gap — it's what makes guessing impractical from one source.
const tokenLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many token attempts — please wait a moment and try again" },
});

// Read-by-id routes (metadata/preview/download) also check a private item's
// token now, so they're a brute-force target just like /token/:token — they
// used to have no limiter at all, which meant an attacker could simply
// guess tokens against the unprotected route instead of the protected one.
// Looser than the token-lookup limiter since these are hit more often in
// normal use (opening several files in a row), but still far too low to
// guess a token with.
const fileReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests — please wait a moment and try again" },
});

// ZIP generation pulls real bytes from storage and compresses them — a lot
// more expensive per request than anything else here, and previously had no
// limiter at all.
const zipLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many ZIP downloads in a short time — please wait a moment" },
});

// Loose cap on uploads to blunt basic storage/bandwidth abuse, well above
// anything a real person would trigger by hand.
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many uploads in a short time — please slow down" },
});

// Stricter than uploads — this endpoint makes an outbound server-side fetch
// per request, which is a more valuable target for abuse than a plain upload.
const linkLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many links added in a short time — please slow down" },
});

const ALLOWED = [
  "image/jpeg","image/png","image/gif","image/webp",
  "video/mp4","video/webm","video/ogg","video/quicktime","video/x-msvideo",
  "application/pdf",
  "application/zip","application/x-zip-compressed",
  "text/plain","text/csv",
  "application/xml","text/xml",
  "application/msword",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // code/dev files — see CODE_EXT_TO_MIME in the controller for the
  // canonical type each extension resolves to
  "text/x-python","application/x-ipynb+json","text/javascript","text/jsx",
  "text/typescript","text/tsx","application/json","text/markdown",
  "text/x-java","text/x-c","text/x-c++","text/x-c-header","text/x-c++-header",
  "text/css","text/html","application/sql","text/yaml","application/x-sh",
];

// Most OSes have no registered MIME type for .py/.ipynb/.cpp/etc, so browsers
// commonly report an empty string or a generic fallback for these — trusting
// file.mimetype alone would silently reject every code file a student
// actually uploads. Falling back to the extension here is safe because the
// magic-byte stage afterward still verifies the content actually looks like
// text/JSON before anything is trusted or stored.
const CODE_EXTENSIONS = [
  ".py",".ipynb",".js",".jsx",".ts",".tsx",".json",".md",
  ".java",".c",".cpp",".h",".hpp",".css",".html",".sql",".yml",".yaml",".sh",
];

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const uploadGuard = createUploadGuard({ maxFileBytes: MAX_UPLOAD_BYTES });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES }, // flat 50MB cap, all file types
  fileFilter: (req, file, cb) => {
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    if (CODE_EXTENSIONS.includes(path.extname(file.originalname).toLowerCase())) return cb(null, true);
    // Client-side-encrypted uploads arrive as opaque ciphertext, always typed
    // application/octet-stream — there's no real MIME type to check here by
    // definition. We let it through at this layer and push the real
    // validation (encryption metadata must actually be present and complete)
    // into the controller, where req.body is guaranteed fully parsed. This
    // avoids relying on multipart field ordering inside fileFilter itself.
    if (file.mimetype === "application/octet-stream") return cb(null, true);
    cb(new Error(`"${file.mimetype}" is not supported`));
  },
});

const handleUpload = (req, res, next) =>
  upload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ message: `Upload error: ${err.message}` });
    if (err) return res.status(400).json({ message: err.message });
    next();
  });

// ── File routes ────────────────────────────────────────────────────────────

router.post("/upload",            uploadLimiter, uploadGuard, handleUpload, uploadFile);
router.post("/link",              linkLimiter, createLink);
router.post("/batch-zip",         zipLimiter, downloadFilesZip);
router.get("/",                   getAllFiles);

// Token lookup — must come before /:id routes (specific before generic)
router.get("/token/:token",       tokenLookupLimiter, getFileByToken);

router.get("/:id/preview",        fileReadLimiter, previewFile);
router.get("/:id/download",       fileReadLimiter, downloadFile);
router.get("/:id",                fileReadLimiter, getSingleFile);

// Visibility toggle — must come before /:id (PATCH) to avoid swallowing it
// Rename/visibility/delete now check the item's own private-token state
// inside the controller itself (see canMutateFile in middleware/auth.js) —
// a public file is open to anyone, a private one needs its current token.
// Same limiter as token lookup: with a token now checked per-request here
// too, these are just as much a guessing target.
router.patch("/:id/visibility",   tokenLookupLimiter, setVisibility);
router.patch("/:id",              tokenLookupLimiter, renameFile);

router.delete("/:id",             tokenLookupLimiter, deleteFile);

export default router;
