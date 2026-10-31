// Regression tests for the "low" findings of the second security audit, plus
// schema-contract tests that run the REAL Mongoose models (no DB connection
// needed) — the other suites mock the models entirely, so without these nothing
// checks the actual unique/sparse indexes, enums and defaults.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import mongoose from "mongoose";

const sb = vi.hoisted(() => ({
  upload: vi.fn(async (p) => ({ data: { path: p }, error: null })),
  getPublicUrl: vi.fn((p) => ({ data: { publicUrl: `https://dummy.supabase.co/storage/v1/object/public/b/${p}` } })),
  move: vi.fn(async () => ({ error: null })),
  remove: vi.fn(async () => ({ error: null })),
}));
vi.mock("../config/supabase.js", () => ({ default: { storage: { from: () => sb } } }));

// The model mocks are only active for the controller tests (see the describe
// blocks below); the schema-contract block imports the real models via importActual.
vi.mock("../models/File.js", () => ({
  default: { create: vi.fn(), findById: vi.fn(), findByIdAndUpdate: vi.fn(), find: vi.fn(), countDocuments: vi.fn() },
}));
vi.mock("../models/Folder.js", () => ({
  default: { create: vi.fn(), findById: vi.fn(), findByIdAndUpdate: vi.fn(), find: vi.fn() },
}));

const File = (await import("../models/File.js")).default;
const Folder = (await import("../models/Folder.js")).default;
const { withTokenRetry, isTokenCollision } = await import("../utils/tokenRetry.js");
const { uploadFile, setVisibility } = await import("../controllers/fileUpload.js");
const { createFolder, setFolderVisibility } = await import("../controllers/folderController.js");

const mockRes = () => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; } };
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};
const statusOf = (r) => r.status.mock.calls[0]?.[0];
const jsonOf = (r) => r.json.mock.calls[0]?.[0];
const collision = () => Object.assign(new Error('E11000 duplicate key error collection: x index: shareToken_1 dup key: { shareToken: "abc123" }'), { code: 11000, keyPattern: { shareToken: 1 } });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const pngReq = () => ({ file: { buffer: PNG, size: PNG.length, mimetype: "image/png", originalname: "a.png" }, body: {}, query: {}, headers: {} });

beforeEach(() => {
  for (const m of [File, Folder]) Object.values(m).forEach((fn) => fn.mockReset?.());
  Object.values(sb).forEach((fn) => fn.mockClear());
  mongoose.startSession = async () => ({ withTransaction: async (fn) => fn(), endSession: async () => {} });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.GALLERY_MAX_ITEMS; });

// ───────────────────────── L1: token collisions retry ─────────────────────────
describe("L1 — a duplicate share token is retried instead of failing the request", () => {
  describe("withTokenRetry", () => {
    it("recognises only duplicate-key errors on shareToken", () => {
      expect(isTokenCollision(collision())).toBe(true);
      expect(isTokenCollision({ code: 11000, message: "E11000 ... index: shareToken_1 dup key" })).toBe(true);
      expect(isTokenCollision({ code: 11000, keyPattern: { email: 1 }, message: "E11000 ... email_1" })).toBe(false);
      expect(isTokenCollision(new Error("boom"))).toBe(false);
      expect(isTokenCollision(null)).toBe(false);
    });
    it("retries on collision and returns the first success", async () => {
      const fn = vi.fn().mockRejectedValueOnce(collision()).mockRejectedValueOnce(collision()).mockResolvedValue("ok");
      expect(await withTokenRetry(fn)).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(3);
    });
    it("does NOT retry other errors (including duplicates on other fields)", async () => {
      const other = Object.assign(new Error("E11000 email_1"), { code: 11000, keyPattern: { email: 1 } });
      for (const err of [new Error("db down"), other]) {
        const fn = vi.fn().mockRejectedValue(err);
        await expect(withTokenRetry(fn)).rejects.toBe(err);
        expect(fn).toHaveBeenCalledTimes(1);
      }
    });
    it("gives up after 5 genuine collisions and throws the last one", async () => {
      const fn = vi.fn().mockRejectedValue(collision());
      await expect(withTokenRetry(fn)).rejects.toMatchObject({ code: 11000 });
      expect(fn).toHaveBeenCalledTimes(5);
    });
  });

  describe("wired into the controllers", () => {
    it("file upload: collision once → still 201, with a DIFFERENT token the second time", async () => {
      File.create.mockRejectedValueOnce(collision()).mockImplementation(async (d) => ({ _id: "f1", ...d }));
      const res = mockRes(); await uploadFile(pngReq(), res);
      expect(statusOf(res)).toBe(201);
      expect(File.create).toHaveBeenCalledTimes(2);
      const [t1, t2] = File.create.mock.calls.map((c) => c[0].shareToken);
      expect(t1).toMatch(/^[a-z0-9]{6}$/); expect(t2).toMatch(/^[a-z0-9]{6}$/);
      expect(t1).not.toBe(t2);
      expect(sb.upload).toHaveBeenCalledTimes(1); // the object is uploaded once, not once per attempt
    });
    it("file upload: persistent collisions → generic 500 and the stored object is cleaned up", async () => {
      File.create.mockRejectedValue(collision());
      const res = mockRes(); await uploadFile(pngReq(), res);
      expect(statusOf(res)).toBe(500);
      expect(JSON.stringify(jsonOf(res))).not.toMatch(/E11000|shareToken/);
      expect(sb.remove).toHaveBeenCalledWith([sb.upload.mock.calls[0][0]]);
    });
    it("folder creation: collision once → 201", async () => {
      Folder.create.mockRejectedValueOnce(collision()).mockImplementation(async (d) => ({ _id: "fo1", ...d }));
      const res = mockRes(); await createFolder({ body: { name: "Docs" } }, res);
      expect(statusOf(res)).toBe(201);
      expect(Folder.create).toHaveBeenCalledTimes(2);
    });
    it("file token regeneration: collision once → 200, second attempt uses a new token", async () => {
      File.findById.mockResolvedValue({ _id: "f1", visibility: "private", encrypted: false, shareToken: "oldtok", tokenExpiresAt: null, filePath: null });
      const seen = []; // snapshot the token at call time — the controller reuses one `update` object
      File.findByIdAndUpdate.mockImplementation(async (_id, upd) => {
        seen.push(upd.shareToken);
        if (seen.length === 1) throw collision();
        return { _id: "f1", visibility: "private", ...upd };
      });
      const res = mockRes();
      await setVisibility({ params: { id: "f1" }, body: { visibility: "private", regenerateToken: true }, query: { token: "oldtok" }, headers: {} }, res);
      expect(statusOf(res)).toBe(200);
      expect(seen).toHaveLength(2);
      expect(seen[0]).toMatch(/^[a-z0-9]{6}$/); expect(seen[1]).toMatch(/^[a-z0-9]{6}$/);
      expect(seen[0]).not.toBe(seen[1]);
    });
    it("folder token regeneration: collision once → 200, second attempt uses a new token", async () => {
      Folder.findById.mockResolvedValue({ _id: "fo1", visibility: "private", encrypted: false, shareToken: "oldtok", tokenExpiresAt: null });
      const seen = [];
      Folder.findByIdAndUpdate.mockImplementation(async (_id, upd) => {
        seen.push(upd.shareToken);
        if (seen.length === 1) throw collision();
        return { _id: "fo1", ...upd };
      });
      const res = mockRes();
      await setFolderVisibility({ params: { id: "fo1" }, body: { visibility: "private", regenerateToken: true }, query: { token: "oldtok" }, headers: {} }, res);
      expect(statusOf(res)).toBe(200);
      expect(seen).toHaveLength(2);
      expect(seen[0]).not.toBe(seen[1]);
    });
  });
});

// ───────────────────────── L2: gallery cap ─────────────────────────
describe("L2 — the unpaged gallery response is bounded", () => {
  const chain = (files) => {
    const q = {}; q.sort = vi.fn().mockReturnValue(q); q.skip = vi.fn().mockReturnValue(q);
    q.limit = vi.fn().mockReturnValue(q); q.then = (res, rej) => Promise.resolve(files).then(res, rej);
    return q;
  };
  const load = async () => { vi.resetModules(); return (await import("../controllers/fileUpload.js")).getAllFiles; };
  const docs = (n) => Array.from({ length: n }, (_, i) => ({ _id: String(i), visibility: "public", shareToken: `t${i}` }));
  beforeEach(() => {
    vi.doMock("../models/Folder.js", () => ({ default: { find: () => ({ lean: async () => [] }) } }));
  });

  it("default cap is 1000 and the old response shape is untouched below it", async () => {
    const q = chain(docs(3));
    vi.doMock("../models/File.js", () => ({ default: { find: () => q, countDocuments: vi.fn() } }));
    const getAll = await load();
    const res = mockRes(); await getAll({ query: {} }, res);
    expect(q.limit).toHaveBeenCalledWith(1000);
    expect(jsonOf(res)).toEqual({ count: 3, files: expect.any(Array) });
    expect("truncated" in jsonOf(res)).toBe(false);
  });
  it("when the cap bites, the response says so (and the cap is configurable)", async () => {
    process.env.GALLERY_MAX_ITEMS = "2";
    const q = chain(docs(2));
    vi.doMock("../models/File.js", () => ({ default: { find: () => q, countDocuments: vi.fn() } }));
    const getAll = await load();
    const res = mockRes(); await getAll({ query: {} }, res);
    expect(q.limit).toHaveBeenCalledWith(2);
    expect(jsonOf(res).truncated).toBe(true);
  });
  it("opt-in paging is unchanged: uses the page limit, never reports truncation", async () => {
    const q = chain(docs(5));
    vi.doMock("../models/File.js", () => ({ default: { find: () => q, countDocuments: vi.fn().mockResolvedValue(12) } }));
    const getAll = await load();
    const res = mockRes(); await getAll({ query: { page: "2", limit: "5" } }, res);
    expect(q.skip).toHaveBeenCalledWith(5); expect(q.limit).toHaveBeenCalledWith(5);
    expect(jsonOf(res)).toMatchObject({ total: 12, page: 2, limit: 5, hasMore: true });
    expect("truncated" in jsonOf(res)).toBe(false);
  });
});

// ───────────────────────── L4: real-schema contracts ─────────────────────────
describe("schema contracts (real Mongoose models, no database)", () => {
  let RealFile, RealFolder;
  beforeEach(async () => {
    RealFile = (await vi.importActual("../models/File.js")).default;
    RealFolder = (await vi.importActual("../models/Folder.js")).default;
  });

  it("shareToken is unique + sparse on both models (the index that makes collisions real — and that L1 handles)", () => {
    for (const M of [RealFile, RealFolder]) {
      const opts = M.schema.path("shareToken").options;
      expect(opts.unique).toBe(true);
      expect(opts.sparse).toBe(true);
    }
  });
  it("the gallery's hot paths are indexed (visibility, folderId, createdAt desc)", () => {
    const idx = RealFile.schema.indexes().map(([spec]) => JSON.stringify(spec));
    expect(idx).toContain(JSON.stringify({ createdAt: -1 }));
    expect(RealFile.schema.path("visibility").options.index).toBe(true);
    expect(RealFile.schema.path("folderId").options.index).toBe(true);
    expect(RealFolder.schema.path("visibility").options.index).toBe(true);
  });
  it("new documents get safe defaults and a fresh 6-char token each", () => {
    const a = new RealFile({ originalName: "a" }), b = new RealFile({ originalName: "b" });
    expect(a.visibility).toBe("public"); expect(a.encrypted).toBe(false); expect(a.itemType).toBe("file");
    expect(a.viewCount).toBe(0); expect(a.maxViews).toBeNull(); expect(a.tokenExpiresAt).toBeNull(); expect(a.folderId).toBeNull();
    expect(a.shareToken).toMatch(/^[a-z0-9]{6}$/);
    expect(a.shareToken).not.toBe(b.shareToken);
    const f = new RealFolder({ name: "x" });
    expect(f.visibility).toBe("public"); expect(f.encrypted).toBe(false); expect(f.shareToken).toMatch(/^[a-z0-9]{6}$/);
  });
  it("validation rejects bad visibility / itemType / missing names", () => {
    expect(new RealFile({ originalName: "a", visibility: "secret" }).validateSync()?.errors.visibility).toBeDefined();
    expect(new RealFile({ originalName: "a", itemType: "folder" }).validateSync()?.errors.itemType).toBeDefined();
    expect(new RealFile({}).validateSync()?.errors.originalName).toBeDefined();
    expect(new RealFolder({}).validateSync()?.errors.name).toBeDefined();
    expect(new RealFolder({ name: "x", visibility: "secret" }).validateSync()?.errors.visibility).toBeDefined();
  });
  it("valid file, link and folder documents pass validation; folder names are trimmed", () => {
    expect(new RealFile({ originalName: "a.png", fileType: "image/png" }).validateSync()).toBeUndefined();
    expect(new RealFile({ originalName: "T", itemType: "link", linkUrl: "https://e.com", fileType: "text/x-url" }).validateSync()).toBeUndefined();
    expect(new RealFolder({ name: "  Docs  " }).name).toBe("Docs");
  });
  it("folder JSON includes the fileCount virtual", () => {
    const f = new RealFolder({ name: "x", files: [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()] });
    expect(f.toJSON().fileCount).toBe(2);
  });
});
