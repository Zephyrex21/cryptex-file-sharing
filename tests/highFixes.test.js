// Regression tests for the "high" findings of the second security audit.
// Each block reproduces the original problem and asserts it's gone, next to a
// check that the legitimate behaviour is untouched.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "http";
import { EventEmitter } from "events";
import mongoose from "mongoose";

const sb = vi.hoisted(() => ({
  upload: vi.fn(async (p) => ({ data: { path: p }, error: null })),
  getPublicUrl: vi.fn((p) => ({ data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/b/${p}` } })),
  move: vi.fn(async () => ({ error: null })),
  remove: vi.fn(async () => ({ error: null })),
}));
vi.mock("../config/supabase.js", () => ({ default: { storage: { from: () => sb } } }));
vi.mock("dns/promises", () => ({ default: { lookup: vi.fn() }, lookup: vi.fn() }));
vi.mock("../models/File.js", () => ({
  default: { create: vi.fn(), findById: vi.fn(), find: vi.fn(), aggregate: vi.fn(), findOne: vi.fn(), findByIdAndUpdate: vi.fn() },
}));
vi.mock("../models/Folder.js", () => ({ default: { findById: vi.fn(), findByIdAndUpdate: vi.fn() } }));

const dns = (await import("dns/promises")).default;
const File = (await import("../models/File.js")).default;
const Folder = (await import("../models/Folder.js")).default;
const { isSafeUrl, safeFetchHtml } = await import("../controllers/linkPreview.js");
const { removeFileFromFolder, deleteFolder } = await import("../controllers/folderController.js");
const { deleteFile, uploadFile } = await import("../controllers/fileUpload.js");
const { canDeleteFile, canDeleteFolder, canMutateFile, canAccessFolder, canMoveFile } = await import("../middleware/auth.js");
const { createUploadGuard } = await import("../middleware/uploadGuard.js");
const { hasStorageRoom, resetStorageQuotaCache } = await import("../utils/storageQuota.js");
const { purgeExpiredPrivateFiles } = await import("../utils/purgeExpired.js");

const mockRes = () => {
  const res = new EventEmitter();
  res.headers = {};
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};
const statusOf = (res) => res.status.mock.calls[0]?.[0];

beforeEach(() => {
  for (const m of [File, Folder]) Object.values(m).forEach((fn) => fn.mockReset?.());
  sb.upload.mockClear(); sb.remove.mockClear();
  mongoose.startSession = async () => ({ withTransaction: async (fn) => fn(), endSession: async () => {} });
  resetStorageQuotaCache();
  delete process.env.MAX_TOTAL_STORAGE_MB;
});
afterEach(() => { delete process.env.LINK_FETCH_TIMEOUT_MS; });

// ───────────────────────────── H1 ─────────────────────────────
describe("H1 — SSRF guard classifies every IPv6 notation by value, not by string prefix", () => {
  const verdict = async (addr, family = 6) => {
    dns.lookup.mockResolvedValue([{ address: addr, family }]);
    return isSafeUrl("http://attacker.example/");
  };
  const blocked = [
    "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:c0a8:101", "::ffff:a00:1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254",
    "0:0:0:0:0:ffff:7f00:1", "::FFFF:7F00:1",
    "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "64:ff9b:1::1",
    "::127.0.0.1", "::7f00:1", "::1", "::", "0:0:0:0:0:0:0:1",
    "2002:7f00:1::", "2002:a9fe:a9fe::1", "2002:c0a8:101::5",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001:db8::1", "2001:2::1",
    "fe80::1", "febf::1", "fc00::1", "fd12:3456::1", "fec0::1", "ff02::1", "100::1",
    "zzzz::1", "1:2:3:4:5:6:7:8:9", ":::", "1::2::3",
  ];
  for (const addr of blocked) {
    it(`blocks ${addr}`, async () => { expect(await verdict(addr)).toBe(false); });
  }
  const allowed = ["2606:4700:4700::1111", "2a00:1450:4001:81b::200e", "::ffff:8.8.8.8", "::ffff:808:808", "64:ff9b::808:808", "2002:808:808::1"];
  for (const addr of allowed) {
    it(`still allows public ${addr}`, async () => { expect(await verdict(addr)).toBe(true); });
  }
  it("IPv4 behaviour unchanged", async () => {
    expect(await verdict("8.8.8.8", 4)).toBe(true);
    expect(await verdict("127.0.0.1", 4)).toBe(false);
    expect(await verdict("169.254.169.254", 4)).toBe(false);
  });
  it("one bad address among several blocks the host", async () => {
    dns.lookup.mockResolvedValue([{ address: "2606:4700:4700::1111", family: 6 }, { address: "::ffff:7f00:1", family: 6 }]);
    expect(await isSafeUrl("http://attacker.example/")).toBe(false);
  });
});

// ───────────────────────────── H2 ─────────────────────────────
describe("H2 — the fetch deadline covers the body, so a stalling server can't hold a request open", () => {
  let server;
  const serve = (handler) => new Promise((resolve) => {
    server = http.createServer(handler).listen(0, () => resolve(`http://127.0.0.1:${server.address().port}/`));
  });
  beforeEach(() => { dns.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]); process.env.LINK_FETCH_TIMEOUT_MS = "400"; });
  afterEach(() => { server?.closeAllConnections?.(); server?.close(); });

  it("headers then total silence → fails fast instead of hanging (was: forever)", async () => {
    const url = await serve((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.flushHeaders(); });
    const t = Date.now();
    await expect(safeFetchHtml(url)).rejects.toThrow();
    expect(Date.now() - t).toBeLessThan(3000);
  });
  it("head arrives, then the server stalls → returns the partial page (preview still works)", async () => {
    const url = await serve((req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.write("<html><head><title>Partial but useful</title>");
    });
    const t = Date.now();
    const html = await safeFetchHtml(url);
    expect(html).toContain("Partial but useful");
    expect(Date.now() - t).toBeLessThan(3000);
  });
  it("normal page is unaffected", async () => {
    const url = await serve((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<title>Fine</title>"); });
    expect(await safeFetchHtml(url)).toBe("<title>Fine</title>");
  });
  it("non-HTML is still rejected", async () => {
    const url = await serve((req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
    await expect(safeFetchHtml(url)).rejects.toThrow(/Not HTML/);
  });
});

// ───────────────────────────── H3 ─────────────────────────────
describe("H3 — removing a file from a folder respects the file's own rules and real membership", () => {
  const run = (params, query = {}) => {
    const res = mockRes();
    return removeFileFromFolder({ params, query, headers: {} }, res).then(() => res);
  };
  const folder = (o = {}) => ({ _id: "A", visibility: "public", shareToken: "foldtok", tokenExpiresAt: null, files: ["F"], save: vi.fn(), ...o });
  const file = (o = {}) => ({ _id: "F", visibility: "public", encrypted: false, shareToken: "filetok", tokenExpiresAt: null, folderId: "A", save: vi.fn(), ...o });

  it("(the audit's attack) private file + unrelated public folder + no tokens → 403, nothing written", async () => {
    const f = file({ visibility: "private", folderId: "B" });
    const fo = folder({ files: [] });
    Folder.findById.mockResolvedValue(fo); File.findById.mockResolvedValue(f);
    const res = await run({ id: "A", fileId: "F" });
    expect(statusOf(res)).toBe(403);
    expect(f.save).not.toHaveBeenCalled(); expect(fo.save).not.toHaveBeenCalled();
    expect(f.folderId).toBe("B");
  });
  it("a file that isn't in this folder → 404 (can't use folder A to pull a file out of folder B)", async () => {
    const f = file({ folderId: "B" });
    Folder.findById.mockResolvedValue(folder({ files: [] })); File.findById.mockResolvedValue(f);
    const res = await run({ id: "A", fileId: "F" });
    expect(statusOf(res)).toBe(404);
    expect(f.folderId).toBe("B"); expect(f.save).not.toHaveBeenCalled();
  });
  it("normal case: public file in a public folder is removed (legit path unbroken)", async () => {
    const f = file(); const fo = folder();
    Folder.findById.mockResolvedValue(fo); File.findById.mockResolvedValue(f);
    const res = await run({ id: "A", fileId: "F" });
    expect(statusOf(res)).toBe(200);
    expect(fo.files).toEqual([]); expect(f.folderId).toBeNull();
  });
  it("private file works when its own token is supplied as ?fileToken= (folder token stays in ?token=)", async () => {
    const f = file({ visibility: "private" }); const fo = folder({ visibility: "private" });
    Folder.findById.mockResolvedValue(fo); File.findById.mockResolvedValue(f);
    expect(statusOf(await run({ id: "A", fileId: "F" }, { token: "foldtok" }))).toBe(403); // folder token alone isn't enough
    expect(statusOf(await run({ id: "A", fileId: "F" }, { token: "foldtok", fileToken: "wrong1" }))).toBe(403);
    expect(statusOf(await run({ id: "A", fileId: "F" }, { token: "foldtok", fileToken: "filetok" }))).toBe(200);
  });
  it("stale data: folder lists the file but file points elsewhere → removed from this folder only, file's own folderId untouched", async () => {
    const f = file({ folderId: "B" }); const fo = folder();
    Folder.findById.mockResolvedValue(fo); File.findById.mockResolvedValue(f);
    const res = await run({ id: "A", fileId: "F" });
    expect(statusOf(res)).toBe(200);
    expect(fo.files).toEqual([]); expect(f.folderId).toBe("B");
  });
  it("canMoveFile: public always; private needs token or fileToken", () => {
    const pub = { visibility: "public" }, priv = { visibility: "private", shareToken: "t12345" };
    expect(canMoveFile({ query: {}, headers: {} }, pub)).toBe(true);
    expect(canMoveFile({ query: {}, headers: {} }, priv)).toBe(false);
    expect(canMoveFile({ query: { token: "t12345" }, headers: {} }, priv)).toBe(true);
    expect(canMoveFile({ query: { fileToken: "t12345" }, headers: {} }, priv)).toBe(true);
    expect(canMoveFile({ query: { fileToken: "nope" }, headers: {} }, priv)).toBe(false);
  });
});

// ───────────────────────────── H4 ─────────────────────────────
describe("H4 — expiry can no longer strand private data", () => {
  const past = () => new Date(Date.now() - 3600_000);
  const priv = (o = {}) => ({ visibility: "private", encrypted: false, shareToken: "tok123", tokenExpiresAt: past(), filePath: "obj.pdf", folderId: null, deleteOne: vi.fn(), ...o });
  const req = (token) => ({ params: { id: "1" }, query: token ? { token } : {}, headers: {} });

  it("expired-but-current token may delete; reading/mutating with it is still refused (expiry semantics intact)", () => {
    const f = priv();
    expect(canDeleteFile(req("tok123"), f)).toBe(true);
    expect(canMutateFile(req("tok123"), f)).toBe(false);
    const fo = { visibility: "private", shareToken: "tok123", tokenExpiresAt: past() };
    expect(canDeleteFolder(req("tok123"), fo)).toBe(true);
    expect(canAccessFolder(req("tok123"), fo)).toBe(false);
  });
  it("wrong / regenerated token still can't delete; public items need no token", () => {
    expect(canDeleteFile(req("oldtok"), priv())).toBe(false);
    expect(canDeleteFile(req(), priv())).toBe(false);
    expect(canDeleteFile(req(), { visibility: "public" })).toBe(true);
    expect(canDeleteFolder(req("x"), { visibility: "private", shareToken: "tok123", tokenExpiresAt: null })).toBe(false);
  });
  it("deleteFile endpoint: expired private file is deletable with its token, and its storage object is removed", async () => {
    const f = priv(); File.findById.mockResolvedValue(f);
    const res = mockRes();
    await deleteFile(req("tok123"), res);
    expect(statusOf(res)).toBe(200);
    expect(sb.remove).toHaveBeenCalledWith(["obj.pdf"]);
    expect(f.deleteOne).toHaveBeenCalled();
  });
  it("deleteFile endpoint: still 403 without the token", async () => {
    File.findById.mockResolvedValue(priv());
    const res = mockRes();
    await deleteFile(req(), res);
    expect(statusOf(res)).toBe(403);
    expect(sb.remove).not.toHaveBeenCalled();
  });
  it("deleteFolder endpoint: expired private folder deletable with its token", async () => {
    const fo = { _id: "A", visibility: "private", shareToken: "tok123", tokenExpiresAt: past(), files: [], deleteOne: vi.fn() };
    Folder.findById.mockResolvedValue(fo);
    const res = mockRes();
    await deleteFolder({ params: { id: "A" }, query: { token: "tok123" }, headers: {} }, res);
    expect(statusOf(res)).toBe(200);
    expect(fo.deleteOne).toHaveBeenCalled();
  });

  describe("opt-in purge job", () => {
    const find = (docs) => File.find.mockReturnValue({ limit: () => Promise.resolve(docs) });
    it("only selects PRIVATE files expired longer ago than the cutoff", async () => {
      find([]);
      const now = new Date("2026-10-30T00:00:00Z");
      await purgeExpiredPrivateFiles({ File, Folder, supabase: { storage: { from: () => sb } }, bucket: "b", olderThanDays: 7, now });
      const q = File.find.mock.calls[0][0];
      expect(q.visibility).toBe("private");
      expect(q.tokenExpiresAt.$lt.toISOString()).toBe("2026-10-23T00:00:00.000Z");
      expect(q.tokenExpiresAt.$ne).toBeNull();
    });
    it("removes storage first, then the record, and unlinks it from its folder", async () => {
      const d = priv({ _id: "x1", folderId: "fo1" });
      find([d]);
      const r = await purgeExpiredPrivateFiles({ File, Folder, supabase: { storage: { from: () => sb } }, bucket: "b", olderThanDays: 1 });
      expect(r).toEqual({ purged: 1, failed: 0 });
      expect(sb.remove).toHaveBeenCalledWith(["obj.pdf"]);
      expect(Folder.findByIdAndUpdate).toHaveBeenCalledWith("fo1", { $pull: { files: "x1" } });
      expect(d.deleteOne).toHaveBeenCalled();
    });
    it("storage failure → record kept (retried next run), counted as failed", async () => {
      const d = priv(); find([d]);
      sb.remove.mockResolvedValueOnce({ error: { message: "boom" } });
      const r = await purgeExpiredPrivateFiles({ File, Folder, supabase: { storage: { from: () => sb } }, bucket: "b", olderThanDays: 1 });
      expect(r).toEqual({ purged: 0, failed: 1 });
      expect(d.deleteOne).not.toHaveBeenCalled();
    });
  });
});

// ───────────────────────────── H6 ─────────────────────────────
describe("H6 — upload memory/storage abuse backstops", () => {
  const guardReq = (len) => ({ headers: len === undefined ? {} : { "content-length": String(len) } });

  describe("uploadGuard", () => {
    it("caps concurrent uploads with 503 + Retry-After, and frees a slot when one finishes", () => {
      const guard = createUploadGuard({ maxConcurrent: 2, maxFileBytes: 1000 });
      const next = vi.fn();
      const [r1, r2, r3] = [mockRes(), mockRes(), mockRes()];
      guard(guardReq(10), r1, next); guard(guardReq(10), r2, next);
      expect(next).toHaveBeenCalledTimes(2); expect(guard.inFlight()).toBe(2);
      guard(guardReq(10), r3, next);
      expect(statusOf(r3)).toBe(503); expect(r3.headers["retry-after"]).toBe("5");
      expect(next).toHaveBeenCalledTimes(2);
      r1.emit("finish");
      const r4 = mockRes(); guard(guardReq(10), r4, next);
      expect(next).toHaveBeenCalledTimes(3);
    });
    it("finish + close on the same response only free ONE slot (no negative counter)", () => {
      const guard = createUploadGuard({ maxConcurrent: 1 });
      const r = mockRes(); guard(guardReq(1), r, vi.fn());
      r.emit("finish"); r.emit("close");
      expect(guard.inFlight()).toBe(0);
    });
    it("an aborted upload (close without finish) frees its slot", () => {
      const guard = createUploadGuard({ maxConcurrent: 1 });
      const r = mockRes(); guard(guardReq(1), r, vi.fn());
      r.emit("close");
      expect(guard.inFlight()).toBe(0);
    });
    it("declared size over the limit → 413 before any body is read", () => {
      const guard = createUploadGuard({ maxConcurrent: 4, maxFileBytes: 1000 });
      const next = vi.fn(); const r = mockRes();
      guard(guardReq(1000 + 1024 * 1024 + 1), r, next);
      expect(statusOf(r)).toBe(413); expect(next).not.toHaveBeenCalled(); expect(guard.inFlight()).toBe(0);
    });
    it("within limit, or no content-length (chunked) → passes through", () => {
      const guard = createUploadGuard({ maxConcurrent: 4, maxFileBytes: 1000 });
      const next = vi.fn();
      guard(guardReq(1000), mockRes(), next); guard(guardReq(undefined), mockRes(), next);
      expect(next).toHaveBeenCalledTimes(2);
    });
  });

  describe("optional global storage cap", () => {
    it("off by default — never touches the database", async () => {
      expect((await hasStorageRoom(10 ** 9, File)).ok).toBe(true);
      expect(File.aggregate).not.toHaveBeenCalled();
    });
    it("enforces MAX_TOTAL_STORAGE_MB, counting admitted uploads within the cache window", async () => {
      process.env.MAX_TOTAL_STORAGE_MB = "1";
      File.aggregate.mockResolvedValue([{ total: 900 * 1024 }]);
      expect((await hasStorageRoom(50 * 1024, File)).ok).toBe(true);   // 950 KB used
      expect((await hasStorageRoom(100 * 1024, File)).ok).toBe(false); // would be 1050 KB
      expect(File.aggregate).toHaveBeenCalledTimes(1);                  // cached
    });
    it("empty database counts as zero", async () => {
      process.env.MAX_TOTAL_STORAGE_MB = "1";
      File.aggregate.mockResolvedValue([]);
      expect((await hasStorageRoom(500 * 1024, File)).ok).toBe(true);
    });
    it("fails OPEN if the aggregate errors (a DB hiccup must not block every upload)", async () => {
      process.env.MAX_TOTAL_STORAGE_MB = "1";
      File.aggregate.mockRejectedValue(new Error("db down"));
      expect((await hasStorageRoom(1, File)).ok).toBe(true);
    });
    it("uploadFile answers 507 and stores nothing when full", async () => {
      process.env.MAX_TOTAL_STORAGE_MB = "1";
      File.aggregate.mockResolvedValue([{ total: 1024 * 1024 }]);
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]);
      const res = mockRes();
      await uploadFile({ file: { buffer: png, size: png.length, mimetype: "image/png", originalname: "a.png" }, body: {}, query: {}, headers: {} }, res);
      expect(statusOf(res)).toBe(507);
      expect(sb.upload).not.toHaveBeenCalled(); expect(File.create).not.toHaveBeenCalled();
    });
  });
});
