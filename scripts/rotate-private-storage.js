// One-off migration: re-key the storage objects of files that are ALREADY private.
//
// Before the C4 fix, every private file's storage URL (`fileUrl`) was returned
// to anyone holding its token and never changed, so a former recipient could
// keep downloading after the owner regenerated the token / let it expire. New
// uploads now get random paths and rotate automatically on privatize/regenerate;
// this script does the same one-time rotation for what's already in the bucket.
//
//   node scripts/rotate-private-storage.js --dry-run   # list what would move
//   node scripts/rotate-private-storage.js             # do it
//
// Needs the same .env as the server (MONGO_URI, SUPABASE_URL, SUPABASE_SERVICE_KEY,
// optional SUPABASE_BUCKET). Safe to re-run: already-random paths are skipped, and
// each file is moved-then-saved with the move undone if the DB write fails.
import dotenv from "dotenv";
import mongoose from "mongoose";
import File from "../models/File.js";
import supabase from "../config/supabase.js";
import { rotateObjectPath, undoRotation } from "../utils/storagePaths.js";

dotenv.config();
const BUCKET = process.env.SUPABASE_BUCKET || "cloudvault-files";
const DRY = process.argv.includes("--dry-run");
const ALREADY_RANDOM = /^[a-f0-9]{32}(\.[a-z0-9]{1,10})?$/;

await mongoose.connect(process.env.MONGO_URI);
const files = await File.find({
  visibility: "private",
  encrypted: { $ne: true },
  itemType: { $ne: "link" },
  filePath: { $exists: true, $ne: null },
});

let moved = 0, skipped = 0, failed = 0;
for (const file of files) {
  if (ALREADY_RANDOM.test(file.filePath)) { skipped++; continue; }
  if (DRY) { console.log(`[dry-run] would rotate ${file._id}  ${file.filePath}`); moved++; continue; }
  let rotated = null;
  try {
    rotated = await rotateObjectPath(supabase, BUCKET, file);
    if (!rotated) { skipped++; continue; }
    await File.updateOne({ _id: file._id }, { $set: { filePath: rotated.filePath, fileUrl: rotated.fileUrl } });
    console.log(`rotated ${file._id}  ${file.filePath} -> ${rotated.filePath}`);
    moved++;
  } catch (e) {
    if (rotated) await undoRotation(supabase, BUCKET, file.filePath, rotated.filePath);
    console.error(`FAILED ${file._id}: ${e.message}`);
    failed++;
  }
}
console.log(`\n${DRY ? "would rotate" : "rotated"}: ${moved}   skipped: ${skipped}   failed: ${failed}`);
await mongoose.disconnect();
process.exit(failed ? 1 : 0);
