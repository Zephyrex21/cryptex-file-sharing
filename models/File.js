import mongoose from "mongoose";
import { generateToken } from "../utils/token.js";

const fileSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },

    // ── Item kind ─────────────────────────────────────────────────────────
    // "file" = a real uploaded file in Supabase Storage (the original, default
    // behavior). "link" = a saved URL with a fetched title/preview — same
    // sharing/token/folder/visibility system, no Supabase object behind it.
    itemType: { type: String, enum: ["file", "link"], default: "file" },

    // ── Link-only fields (unused when itemType === "file") ──────────────────
    linkUrl:         { type: String },
    linkTitle:       { type: String },
    linkDescription: { type: String },
    linkImage:       { type: String }, // only ever set from an https:// source — see linkPreview.js
    linkDomain:      { type: String },

    // ── Storage fields (storage-agnostic; old cloudinary* kept for compat) ──
    fileUrl:       { type: String },
    filePath:      { type: String },
    cloudinaryUrl: { type: String },
    cloudinaryId:  { type: String },

    fileType:    { type: String },
    fileSize:    { type: Number },
    storageType: { type: String, default: "supabase" },

    // ── End-to-end encryption ────────────────────────────────────────────────
    // Zero-knowledge design: everything stored below is CIPHERTEXT. The AES key
    // itself is generated in the browser, never leaves it except inside a URL
    // *fragment* (#key=...), which browsers never transmit in HTTP requests —
    // so it never reaches this server, Supabase, or any log. If a user loses
    // the link, the file is permanently unrecoverable; there is no reset path,
    // by design. See controllers/fileUpload.js for the upload-time contract.
    encrypted: { type: Boolean, default: false },

    // Base64 12-byte GCM IV used for the file *content*. Required if encrypted.
    encryptionIV: { type: String, default: null },

    // originalName/fileType above are set to harmless placeholders for
    // encrypted files (see controller). The real name/MIME type only exist
    // here, as AES-GCM ciphertext — each with its OWN IV. This is not
    // optional: reusing an IV across two different plaintexts under the same
    // GCM key breaks the algorithm's authentication guarantee entirely (it
    // leaks enough to forge ciphertexts), so content, name, and MIME type
    // each get a fresh, independent 12-byte IV.
    encryptedName:       { type: String, default: null },
    encryptedNameIV:     { type: String, default: null },
    encryptedMimeType:   { type: String, default: null },
    encryptedMimeTypeIV: { type: String, default: null },

    // ── Sharing ─────────────────────────────────────────────────────────────
    // sparse: true → unique index ignores existing docs where token is null/undefined
    shareToken: {
      type:    String,
      unique:  true,
      sparse:  true,
      index:   true,
      // Wrapped on purpose: Mongoose calls a default function with the DOCUMENT as its
      // first argument, and generateToken's first parameter is `length` — passing the
      // function bare made it loop zero times and return an empty string.
      default: () => generateToken(),
    },

    // public  → appears in main gallery
    // private → hidden from gallery; accessible only via shareToken
    // Indexed: every gallery load filters on this.
    visibility: {
      type:    String,
      enum:    ["public", "private"],
      default: "public",   // existing files stay visible — no disruption
      index:   true,
    },

    // Optional self-destruct for the token. null = never expires.
    // Enforced on token-lookup (getFileByToken) AND on every by-id access
    // path (see middleware/auth.js) — going public clears it, since expiry
    // is meaningless once something isn't gated behind a token.
    tokenExpiresAt: { type: Date, default: null },

    // Optional self-destruct by ACCESS COUNT rather than time. null = unlimited.
    // viewCount only increments while maxViews is actually set (see
    // getFileByToken) — no point writing on every access for the common
    // unlimited case. Reset to 0 whenever maxViews changes or the token is
    // regenerated, so a fresh limit always starts from a clean slate.
    maxViews:  { type: Number, default: null },
    viewCount: { type: Number, default: 0 },

    // Optional — which folder this file belongs to (null = not in any folder)
    // Indexed: the gallery excludes files by folder membership on every load.
    folderId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "Folder",
      default: null,
      index:   true,
    },
  },
  { timestamps: true }
);

// The gallery always sorts newest-first — without this, every load sorts the
// whole collection in memory.
fileSchema.index({ createdAt: -1 });

export default mongoose.model("File", fileSchema);
