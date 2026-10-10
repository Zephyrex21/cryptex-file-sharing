import mongoose from "mongoose";
import { generateToken } from "../utils/token.js";

const folderSchema = new mongoose.Schema(
  {
    name: {
      type:     String,
      required: true,
      trim:     true,
    },

    // Same token pattern as File — short 6-char token (see utils/token.js), auto-generated
    shareToken: {
      type:    String,
      unique:  true,
      sparse:  true,
      index:   true,
      default: generateToken,
    },

    // public  → visible in folders list
    // private → only accessible via shareToken
    // Indexed: every gallery load looks up private folders to hide their files.
    visibility: {
      type:    String,
      enum:    ["public", "private"],
      default: "public",
      index:   true,
    },

    // Same expiry rule as File — null means never expires.
    tokenExpiresAt: { type: Date, default: null },

    // Same view-count self-destruct rule as File — see models/File.js for
    // the full reasoning.
    maxViews:  { type: Number, default: null },
    viewCount: { type: Number, default: 0 },

    // A "vault" folder: every file inside is encrypted client-side under
    // ONE shared AES-256-GCM key (each file still gets its own random IV —
    // GCM requires that regardless of key reuse). The key itself never
    // reaches this server, same zero-knowledge rule as encrypted files.
    // Always forced private — see setFolderVisibility.
    encrypted: { type: Boolean, default: false },

    // Array of File _ids that belong to this folder
    files: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref:  "File",
      },
    ],
  },
  {
    timestamps: true,
    toJSON:     { virtuals: true }, // include virtuals in responses
  }
);

// Convenience virtual — avoids populating just to get a count
folderSchema.virtual("fileCount").get(function () {
  return this.files.length;
});

export default mongoose.model("Folder", folderSchema);
