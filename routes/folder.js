import express from "express";
import rateLimit from "express-rate-limit";
import {
  createFolder,
  getAllFolders,
  getFolderById,
  getFolderByToken,
  renameFolder,
  setFolderVisibility,
  deleteFolder,
  addFileToFolder,
  removeFileFromFolder,
  downloadFolderZip,
} from "../controllers/folderController.js";

const router = express.Router();

// Same brute-force defense as the file routes' token lookup.
const tokenLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many token attempts — please wait a moment and try again" },
});

// ── Folder routes ──────────────────────────────────────────────────────────

router.post("/",                    createFolder);
router.get("/",                     getAllFolders);

// Token lookup — specific before /:id (same rule as file routes)
router.get("/token/:token",         tokenLookupLimiter, getFolderByToken);

// GET /:id?token=... is the OTHER way a private folder's token gets checked
// (the app itself uses this one, not /token/:token, once it already knows a
// folder's id) — it needs the same brute-force throttling, or an attacker
// with a folder's (non-secret) _id could guess tokens against this route all
// day with no rate limit at all.
router.get("/:id",                  tokenLookupLimiter, getFolderById);
router.get("/:id/zip",               downloadFolderZip);

// Visibility/rename/delete/membership all mutate an existing folder.
// setFolderVisibility/renameFolder/deleteFolder/addFileToFolder/
// removeFileFromFolder now each check the folder's own private-token state
// inside the controller (see canAccessFolder in middleware/auth.js) — a
// public folder is open to anyone, a private one needs its current token.
// Same rate limiter as the read routes above: with a token now checked
// per-request here too, these are just as much a guessing target as GET
// /:id is.
router.patch("/:id/visibility",     tokenLookupLimiter, setFolderVisibility);
router.patch("/:id",                tokenLookupLimiter, renameFolder);

router.delete("/:id",               tokenLookupLimiter, deleteFolder);

// File membership
router.post("/:id/files",           tokenLookupLimiter, addFileToFolder);
router.delete("/:id/files/:fileId", tokenLookupLimiter, removeFileFromFolder);

export default router;
