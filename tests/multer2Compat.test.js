// Proves the multer 1.x → 2.x upgrade didn't change real multipart behaviour:
// drives the ACTUAL router (multer + fileFilter + size limits + controllers) over HTTP.
/* global FormData, Blob */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";

vi.mock("../config/supabase.js", () => ({
  default: { storage: { from: () => ({
    upload: async (p) => ({ data: { path: p }, error: null }),
    getPublicUrl: (p) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/b/${p}` } }),
    move: async () => ({ error: null }), remove: async () => ({ error: null }),
  }) } },
}));
vi.mock("../models/File.js", () => ({ default: { create: vi.fn(async (d) => ({ _id: "f1", ...d })), findById: vi.fn() } }));
vi.mock("../models/Folder.js", () => ({
  default: { findById: vi.fn(async () => ({ _id: "v1", encrypted: true, visibility: "private", shareToken: "vaulttok", tokenExpiresAt: null, files: [], save: async () => {} })) },
}));

let srv, base;
beforeAll(async () => {
  const router = (await import("../routes/FileUpload.js")).default;
  const app = express();
  app.use(express.json());
  app.use("/api/files", router);
  srv = app.listen(0);
  base = `http://127.0.0.1:${srv.address().port}/api/files`;
});
afterAll(() => srv?.close());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const post = (fd, qs = "") => fetch(`${base}/upload${qs}`, { method: "POST", body: fd });

describe("real multipart through the real router (multer 2)", () => {
  it("plain PNG upload → 201 with a random object path and public URL", async () => {
    const fd = new FormData();
    fd.append("file", new Blob([PNG], { type: "image/png" }), "photo.png");
    const r = await post(fd);
    const j = await r.json();
    expect(r.status).toBe(201);
    expect(j.file.filePath).toMatch(/^[a-f0-9]{32}\.png$/);
    expect(j.file.fileUrl).toContain(j.file.filePath);
  });
  it("disallowed type is still rejected by the fileFilter", async () => {
    const fd = new FormData();
    fd.append("file", new Blob(["MZ"], { type: "application/x-msdownload" }), "a.exe");
    expect((await post(fd)).status).toBeGreaterThanOrEqual(400);
  });
  it("vault-attack from the audit: bracket-operator vaultFolderId → 400", async () => {
    const fd = new FormData();
    fd.append("encrypted", "true"); fd.append("iv", "a"); fd.append("encryptedName", "b"); fd.append("encryptedNameIV", "c");
    fd.append("encryptedMimeType", "d"); fd.append("encryptedMimeTypeIV", "e");
    fd.append("vaultFolderId[$gt]", "000000000000000000000000");
    fd.append("file", new Blob(["cipher"], { type: "application/octet-stream" }), "e.bin");
    expect((await post(fd)).status).toBe(400);
  });
  const vaultForm = () => {
    const fd = new FormData();
    fd.append("encrypted", "true"); fd.append("iv", "a"); fd.append("encryptedName", "b"); fd.append("encryptedNameIV", "c");
    fd.append("encryptedMimeType", "d"); fd.append("encryptedMimeTypeIV", "e"); fd.append("vaultFolderId", "v1");
    fd.append("file", new Blob(["cipher"], { type: "application/octet-stream" }), "e.bin");
    return fd;
  };
  it("vault upload with only the vault id → 403; with its token → 201", async () => {
    expect((await post(vaultForm())).status).toBe(403);
    expect((await post(vaultForm(), "?token=vaulttok")).status).toBe(201);
  });
});
