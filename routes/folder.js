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
import { requireOwner } from "../middleware/auth.js";

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

// Visibility/rename/delete/membership all mutate an existing folder, so —
// same reasoning as the file routes — they need the owner key regardless of
// visibility, not just a token. See middleware/auth.js.
router.patch("/:id/visibility",     requireOwner, setFolderVisibility);
router.patch("/:id",                requireOwner, renameFolder);

router.delete("/:id",               requireOwner, deleteFolder);

// File membership
router.post("/:id/files",           requireOwner, addFileToFolder);
router.delete("/:id/files/:fileId", requireOwner, removeFileFromFolder);

export default router;
