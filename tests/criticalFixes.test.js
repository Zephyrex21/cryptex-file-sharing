/* global Response, performance */
// Regression tests for the five critical findings of the second security audit.
// Each block reproduces the original attack and asserts it no longer works —
// plus that the legitimate path right next to it still does.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PassThrough } from "stream";

const sb = vi.hoisted(() => ({
  upload: vi.fn(async (p) => ({ data: { path: p }, error: null })),
  getPublicUrl: vi.fn((p) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/b/${p}` } })),
  move: vi.fn(async () => ({ error: null })),
  remove: vi.fn(async () => ({ error: null })),
}));
vi.mock("../config/supabase.js", () => ({ default: { storage: { from: () => sb } } }));
vi.mock("../models/File.js", () => ({
  default: { create: vi.fn(), findById: vi.fn(), findOne: vi.fn(), findByIdAndUpdate: vi.fn(), findOneAndUpdate: vi.fn() },
}));
vi.mock("../models/Folder.js", () => ({
  default: { create: vi.fn(), findById: vi.fn(), findOne: vi.fn() },
}));

const File = (await import("../models/File.js")).default;
const Folder = (await import("../models/Folder.js")).default;
const { extractMeta } = await import("../controllers/linkPreview.js");
const { uploadFile, previewFile, setVisibility, getFileByToken } = await import("../controllers/fileUpload.js");
const { addFileToFolder } = await import("../controllers/folderController.js");
const { toClientFile, toClientFolder } = await import("../utils/clientView.js");
const { newObjectPath } = await import("../utils/storagePaths.js");

const mockRes = () => {
  const res = new PassThrough();
  res.headers = {};
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};
const jsonOf = (res) => res.json.mock.calls[0]?.[0];

beforeEach(() => {
  for (const m of [File, Folder]) Object.values(m).forEach((fn) => fn.mockReset?.());
  sb.upload.mockClear(); sb.move.mockClear(); sb.remove.mockClear(); sb.getPublicUrl.mockClear();
  sb.move.mockImplementation(async () => ({ error: null }));
});

// ───────────────────────────── C1 ─────────────────────────────
describe("C1 — link-preview HTML scanner is linear-time", () => {
  const hostile = {
    "many unterminated <meta": "<meta ".repeat(10000),
    "many <meta name= without content": '<meta name="x" '.repeat(4000),
    "one meta with huge attribute run": "<meta " + 'name="description" '.repeat(3000),
    "many unterminated <title": "<title ".repeat(9000),
    "one giant attribute name": "<meta " + "a".repeat(59000),
  };
  for (const [label, html] of Object.entries(hostile)) {
    it(`${label} finishes fast (was up to ~8s)`, () => {
      const t = performance.now();
      extractMeta(html);
      expect(performance.now() - t).toBeLessThan(250);
    });
  }

  it("still extracts og/meta/title correctly, any attribute order, any case", () => {
    const out = extractMeta(
      `<html><head><title> Fallback &amp; co </title>
       <meta content="Desc here" name="description">
       <meta property="og:image" content="https://x.test/y.png">
       <META PROPERTY="og:title" CONTENT="OG Title">
       <meta property='og:site_name' content='Site &quot;X&quot;'/></head>`
    );
    expect(out).toEqual({ title: "OG Title", image: "https://x.test/y.png", description: "Desc here", siteName: 'Site "X"' });
  });
  it("falls back to <title> and handles empty/garbage input", () => {
    expect(extractMeta("<title>Only Title</title>").title).toBe("Only Title");
    expect(extractMeta("").title).toBeNull();
    expect(extractMeta(undefined).title).toBeNull();
  });
  it("caps description at 200 chars", () => {
    expect(extractMeta(`<meta name="description" content="${"a".repeat(500)}">`).description).toHaveLength(200);
  });
});

// ───────────────────────────── C2 ─────────────────────────────
describe("C2 — uploaded active content can never render inline on our origin", () => {
  const stream = async (file, query = {}) => {
    File.findById.mockResolvedValue({ encrypted: false, originalName: "x", visibility: "public", ...file });
    global.fetch = vi.fn().mockResolvedValue(new Response("body", { status: 200 }));
    const res = mockRes();
    await previewFile({ params: { id: "1" }, headers: {}, query }, res);
    return res.headers;
  };

  for (const [type, name] of [["text/html", "evil.html"], ["application/xml", "a.xml"], ["text/xml", "b.xml"], ["text/javascript", "a.js"], ["image/svg+xml", "a.svg"], ["text/plain", "a.txt"]]) {
    it(`${type} preview is forced to attachment + sandboxed`, async () => {
      const h = await stream({ fileType: type, originalName: name, fileUrl: "https://s/x" });
      expect(h["content-disposition"]).toMatch(/^attachment;/);
      expect(h["content-security-policy"]).toContain("sandbox");
      expect(h["x-content-type-options"]).toBe("nosniff");
    });
  }
  for (const type of ["image/png", "image/jpeg", "video/mp4", "image/webp"]) {
    it(`${type} still previews inline`, async () => {
      const h = await stream({ fileType: type, originalName: "ok", fileUrl: "https://s/x" });
      expect(h["content-disposition"]).toMatch(/^inline;/);
    });
  }
  it("PDF previews inline and is not sandboxed (Chrome's viewer needs that)", async () => {
    const h = await stream({ fileType: "application/pdf", originalName: "a.pdf", fileUrl: "https://s/x" });
    expect(h["content-disposition"]).toMatch(/^inline;/);
    expect(h["content-security-policy"]).toBeUndefined();
  });
  it("private bytes are never cached publicly; public ones still are", async () => {
    const priv = await stream({ fileType: "application/pdf", fileUrl: "https://s/x", visibility: "private", shareToken: "abc123", tokenExpiresAt: null }, { token: "abc123" });
    expect(priv["cache-control"]).toBe("private, no-store");
    const pub = await stream({ fileType: "image/png", fileUrl: "https://s/x" });
    expect(pub["cache-control"]).toBe("public, max-age=3600");
  });
  it("quotes in the filename can't break out of the header", async () => {
    const h = await stream({ fileType: "image/png", originalName: 'a".png', fileUrl: "https://s/x" });
    expect(h["content-disposition"]).toContain('filename="a_.png"');
  });
});

// ───────────────────────────── C3 ─────────────────────────────
describe("C3 — vaults can't be written to (or poisoned) without their token", () => {
  const encBody = (extra = {}) => ({ encrypted: "true", iv: "a", encryptedName: "b", encryptedNameIV: "c", encryptedMimeType: "d", encryptedMimeTypeIV: "e", ...extra });
  const encReq = (body, query = {}) => ({
    file: { buffer: Buffer.from("cipher"), size: 6, mimetype: "application/octet-stream", originalname: "e.bin" },
    body, query, headers: {},
  });
  const vault = (over = {}) => ({ _id: "v1", encrypted: true, visibility: "private", shareToken: "vaulttok", tokenExpiresAt: null, maxViews: null, files: [], save: vi.fn(), ...over });
  beforeEach(() => { File.create.mockImplementation(async (d) => ({ _id: "f1", ...d })); });

  it("multer-style operator object as vaultFolderId is rejected before any DB lookup", async () => {
    const res = mockRes();
    await uploadFile(encReq(encBody({ vaultFolderId: { $gt: "000000000000000000000000" } })), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(Folder.findById).not.toHaveBeenCalled();
    expect(File.create).not.toHaveBeenCalled();
    expect(sb.upload).not.toHaveBeenCalled();
  });
  it("non-string encryption metadata is rejected", async () => {
    const res = mockRes();
    await uploadFile(encReq(encBody({ iv: { $ne: 1 } })), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(sb.upload).not.toHaveBeenCalled();
  });
  it("vault _id alone (no token) → 403, nothing stored", async () => {
    Folder.findById.mockResolvedValue(vault());
    const res = mockRes();
    await uploadFile(encReq(encBody({ vaultFolderId: "v1" })), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(File.create).not.toHaveBeenCalled();
    expect(sb.upload).not.toHaveBeenCalled();
  });
  it("wrong token → 403", async () => {
    Folder.findById.mockResolvedValue(vault());
    const res = mockRes();
    await uploadFile(encReq(encBody({ vaultFolderId: "v1" }), { token: "nope00" }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
  it("expired vault token → 403", async () => {
    Folder.findById.mockResolvedValue(vault({ tokenExpiresAt: new Date(Date.now() - 1000) }));
    const res = mockRes();
    await uploadFile(encReq(encBody({ vaultFolderId: "v1" }), { token: "vaulttok" }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
  it("correct token → 201 and the file lands in the vault (legit path unbroken)", async () => {
    const v = vault(); Folder.findById.mockResolvedValue(v);
    const res = mockRes();
    await uploadFile(encReq(encBody({ vaultFolderId: "v1" }), { token: "vaulttok" }), res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(v.files).toHaveLength(1);
    expect(File.create.mock.calls[0][0].folderId).toBe("v1");
  });
  it("standalone encrypted upload (no vault) still needs no token", async () => {
    const res = mockRes();
    await uploadFile(encReq(encBody()), res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  describe("addFileToFolder can't plant undecryptable files", () => {
    const body = (b) => ({ params: { id: "fo1" }, body: b, query: {}, headers: {} });
    it("operator object as fileId → 400, no lookup", async () => {
      const res = mockRes();
      await addFileToFolder(body({ fileId: { $ne: null } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(File.findById).not.toHaveBeenCalled();
    });
    it("adding an existing file into a vault → 400", async () => {
      Folder.findById.mockResolvedValue(vault());
      File.findById.mockResolvedValue({ _id: "p1", visibility: "public", encrypted: false, folderId: null });
      const res = mockRes();
      await addFileToFolder(body({ fileId: "p1" }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
    it("moving an encrypted file into an ordinary folder → 400", async () => {
      Folder.findById.mockResolvedValue({ _id: "fo1", encrypted: false, visibility: "public", files: [] });
      File.findById.mockResolvedValue({ _id: "e1", visibility: "private", encrypted: true, shareToken: "t", folderId: null });
      const res = mockRes();
      await addFileToFolder(body({ fileId: "e1" }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});

// ───────────────────────────── C4 ─────────────────────────────
describe("C4 — private files' storage location is unguessable, hidden, and revocable", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const plainReq = (name = "Secret Report.png") => ({
    file: { buffer: png, size: png.length, mimetype: "image/png", originalname: name }, body: {}, query: {}, headers: {},
  });

  it("new object paths are 128-bit random and never contain the original name", async () => {
    File.create.mockImplementation(async (d) => ({ _id: "f1", ...d }));
    await uploadFile(plainReq(), mockRes());
    await uploadFile(plainReq(), mockRes());
    const [p1, p2] = sb.upload.mock.calls.map((c) => c[0]);
    expect(p1).toMatch(/^[a-f0-9]{32}\.png$/);
    expect(p2).toMatch(/^[a-f0-9]{32}\.png$/);
    expect(p1).not.toBe(p2);
    expect(p1.toLowerCase()).not.toContain("secret");
  });
  it("hostile extensions can't smuggle path/quote characters into the object key", () => {
    expect(newObjectPath('a.png"onerror="x')).toMatch(/^[a-f0-9]{32}$/);
    expect(newObjectPath("a/../../b.png")).toMatch(/^[a-f0-9]{32}\.png$/);
    expect(newObjectPath("noext")).toMatch(/^[a-f0-9]{32}$/);
  });
  it("public upload response keeps fileUrl (gallery needs it)", async () => {
    File.create.mockImplementation(async (d) => ({ _id: "f1", ...d }));
    const res = mockRes();
    await uploadFile(plainReq(), res);
    expect(jsonOf(res).file.fileUrl).toMatch(/^https:\/\//);
  });
  it("encrypted (private) upload response exposes no storage location", async () => {
    File.create.mockImplementation(async (d) => ({ _id: "f1", ...d }));
    const res = mockRes();
    await uploadFile({
      file: { buffer: Buffer.from("c"), size: 1, mimetype: "application/octet-stream", originalname: "e" },
      body: { encrypted: "true", iv: "a", encryptedName: "b", encryptedNameIV: "c", encryptedMimeType: "d", encryptedMimeTypeIV: "e" },
      query: {}, headers: {},
    }, res);
    const f = jsonOf(res).file;
    expect(f.fileUrl).toBeUndefined();
    expect(f.filePath).toBeUndefined();
  });
  it("token lookup of a PRIVATE file returns no fileUrl/filePath; public keeps them", async () => {
    const priv = { _id: "p", visibility: "private", shareToken: "abc123", fileUrl: "https://s/secret", filePath: "secret", cloudinaryUrl: "c", maxViews: null, tokenExpiresAt: null };
    File.findOne.mockResolvedValue(priv);
    const res = mockRes();
    await getFileByToken({ params: { token: "abc123" }, query: {}, headers: {} }, res);
    const f = jsonOf(res).file;
    expect(f._id).toBe("p");
    expect(f.fileUrl).toBeUndefined();
    expect(f.filePath).toBeUndefined();
    expect(f.cloudinaryUrl).toBeUndefined();
    expect(toClientFile({ visibility: "public", fileUrl: "u" }).fileUrl).toBe("u");
  });
  it("toClientFolder scrubs populated private (encrypted) files but keeps public ones", () => {
    const out = toClientFolder({ _id: "fo", files: [
      { _id: "1", visibility: "private", encrypted: true, fileUrl: "x", filePath: "y" },
      { _id: "2", visibility: "public", fileUrl: "keep" },
      "507f1f77bcf86cd799439011",
    ] });
    expect(out.files[0].fileUrl).toBeUndefined();
    expect(out.files[1].fileUrl).toBe("keep");
    expect(out.files[2]).toBe("507f1f77bcf86cd799439011");
  });

  describe("setVisibility rotates the object so previously-exposed URLs die", () => {
    const pubFile = () => ({ _id: "f1", visibility: "public", encrypted: false, itemType: "file", filePath: "oldpath.pdf", fileUrl: "https://s/oldpath.pdf" });
    const privFile = () => ({ ...pubFile(), visibility: "private", shareToken: "tok123", tokenExpiresAt: null });
    const req = (body, query = {}) => ({ params: { id: "f1" }, body, query, headers: {} });
    beforeEach(() => { File.findByIdAndUpdate.mockImplementation(async (_id, upd) => ({ _id: "f1", ...pubFile(), ...upd })); });

    it("public → private moves the object to a new random path and stores it", async () => {
      File.findById.mockResolvedValue(pubFile());
      const res = mockRes();
      await setVisibility(req({ visibility: "private" }), res);
      expect(sb.move).toHaveBeenCalledTimes(1);
      const [from, to] = sb.move.mock.calls[0];
      expect(from).toBe("oldpath.pdf");
      expect(to).toMatch(/^[a-f0-9]{32}\.pdf$/);
      const upd = File.findByIdAndUpdate.mock.calls[0][1];
      expect(upd.filePath).toBe(to);
      expect(upd.fileUrl).toContain(to);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(jsonOf(res).file.fileUrl).toBeUndefined(); // now private → not disclosed
    });
    it("regenerating a private file's token also rotates (revokes legacy-exposed URLs)", async () => {
      File.findById.mockResolvedValue(privFile());
      const res = mockRes();
      await setVisibility(req({ visibility: "private", regenerateToken: true }, { token: "tok123" }), res);
      expect(sb.move).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
    });
    it("fails closed: storage error → 502, DB untouched, visibility not changed", async () => {
      File.findById.mockResolvedValue(pubFile());
      sb.move.mockResolvedValue({ error: { message: "storage exploded" } });
      const res = mockRes();
      await setVisibility(req({ visibility: "private" }), res);
      expect(res.status).toHaveBeenCalledWith(502);
      expect(File.findByIdAndUpdate).not.toHaveBeenCalled();
    });
    it("object already missing in storage is not fatal", async () => {
      File.findById.mockResolvedValue(pubFile());
      sb.move.mockResolvedValue({ error: { message: "Object not found" } });
      const res = mockRes();
      await setVisibility(req({ visibility: "private" }), res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(File.findByIdAndUpdate.mock.calls[0][1].filePath).toBeUndefined();
    });
    it("DB failure after a successful move → move is undone", async () => {
      File.findById.mockResolvedValue(pubFile());
      File.findByIdAndUpdate.mockRejectedValue(new Error("db down"));
      const res = mockRes();
      await setVisibility(req({ visibility: "private" }), res);
      expect(sb.move).toHaveBeenCalledTimes(2);
      const [first, second] = sb.move.mock.calls;
      expect(second).toEqual([first[1], first[0]]); // moved back
      expect(res.status).toHaveBeenCalledWith(500);
    });
    it("no needless rotation: private→private (expiry change), public→public, encrypted, legacy without filePath", async () => {
      File.findById.mockResolvedValue(privFile());
      await setVisibility(req({ visibility: "private", expiresIn: 60 }, { token: "tok123" }), mockRes());
      File.findById.mockResolvedValue(pubFile());
      await setVisibility(req({ visibility: "public" }), mockRes());
      File.findById.mockResolvedValue({ ...pubFile(), encrypted: true });
      await setVisibility(req({ visibility: "private" }), mockRes());
      File.findById.mockResolvedValue({ ...pubFile(), filePath: undefined });
      await setVisibility(req({ visibility: "private" }), mockRes());
      expect(sb.move).not.toHaveBeenCalled();
    });
  });
});
