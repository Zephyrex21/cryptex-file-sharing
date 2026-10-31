// Regression tests for the "medium" findings of the second security audit.
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import http from "http";
import express from "express";
import mongoose from "mongoose";

const sb = vi.hoisted(() => ({
  upload: vi.fn(async (p) => ({ data: { path: p }, error: null })),
  getPublicUrl: vi.fn((p) => ({ data: { publicUrl: `https://dummy.supabase.co/storage/v1/object/public/b/${p}` } })),
  move: vi.fn(async () => ({ error: null })),
  remove: vi.fn(async () => ({ error: null })),
}));
vi.mock("../config/supabase.js", () => ({ default: { storage: { from: () => sb } } }));
vi.mock("dns/promises", () => ({ default: { lookup: vi.fn() }, lookup: vi.fn() }));
vi.mock("../models/File.js", () => ({
  default: { create: vi.fn(), findById: vi.fn(), findOne: vi.fn(), find: vi.fn(), countDocuments: vi.fn() },
}));
vi.mock("../models/Folder.js", () => ({ default: { find: vi.fn(), findById: vi.fn(), findByIdAndUpdate: vi.fn() } }));
// createLink's network helpers are mocked here; their real behaviour is covered below via real local servers.
const lp = vi.hoisted(() => ({
  isSafeUrl: vi.fn(async () => true), safeFetchHtml: vi.fn(), safeFetchImage: vi.fn(), extractMeta: vi.fn(),
}));
vi.mock("../controllers/linkPreview.js", async (orig) => ({ ...(await orig()), ...lp }));

const dns = (await import("dns/promises")).default;
const File = (await import("../models/File.js")).default;
const Folder = (await import("../models/Folder.js")).default;
const real = await vi.importActual("../controllers/linkPreview.js");
const { createLink, getAllFiles } = await import("../controllers/fileUpload.js");
const { toClientFile } = await import("../utils/clientView.js");
const { serverError } = await import("../utils/httpError.js");
const fileRoutes = (await import("../routes/FileUpload.js")).default;

const mockRes = () => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; } };
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};
const statusOf = (r) => r.status.mock.calls[0]?.[0];
const jsonOf = (r) => r.json.mock.calls[0]?.[0];
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

beforeEach(() => {
  for (const m of [File, Folder]) Object.values(m).forEach((fn) => fn.mockReset?.());
  Object.values(sb).forEach((fn) => fn.mockClear());
  lp.isSafeUrl.mockResolvedValue(true);
  mongoose.startSession = async () => ({ withTransaction: async (fn) => fn(), endSession: async () => {} });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.LINK_FETCH_TIMEOUT_MS; });

// ─────────────────────────── M8 ───────────────────────────
describe("M8 — bulk actions aren't throttled by the wrong-token limiter (but guessing still is)", () => {
  let srv, base;
  beforeAll(async () => {
    const app = express(); app.use(express.json()); app.use("/api/files", fileRoutes);
    srv = app.listen(0); base = `http://127.0.0.1:${srv.address().port}/api/files`;
  });
  afterAll(() => srv?.close());
  const tally = (rs) => rs.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});

  it("40 successful deletes in parallel (what 'delete selected' does) all go through — was 30 ok + 10 × 429", async () => {
    File.findById.mockResolvedValue({ _id: "f", visibility: "public", filePath: null, folderId: null, deleteOne: async () => {} });
    const rs = await Promise.all(Array.from({ length: 40 }, (_, i) => fetch(`${base}/65f00000000000000000${String(i).padStart(4, "0")}`, { method: "DELETE" })));
    expect(tally(rs)).toEqual({ 200: 40 });
  });
  it("…while token GUESSING is still capped: 30 failures then 429", async () => {
    File.findOne.mockResolvedValue(null);
    const rs = [];
    for (let i = 0; i < 36; i++) rs.push(await fetch(`${base}/token/guess${i}`));
    const t = tally(rs);
    expect(t[404]).toBe(30);
    expect(t[429]).toBe(6);
  });
});

// ─────────────────────────── M9 ───────────────────────────
describe("M9 — link preview images are mirrored into our storage, never hot-linked", () => {
  const mkReq = () => ({ body: { url: "https://example.com/post", visibility: "public" } });
  beforeEach(() => {
    lp.safeFetchHtml.mockResolvedValue("<html/>");
    lp.extractMeta.mockReturnValue({ title: "Post", image: "https://tracker.example/pixel.png", description: "d", siteName: "S" });
    File.create.mockImplementation(async (d) => ({ _id: "l1", ...d }));
  });

  it("stores the image under a random path in OUR bucket and points linkImage at it", async () => {
    lp.safeFetchImage.mockResolvedValue({ buffer: PNG, contentType: "image/png" });
    const res = mockRes(); await createLink(mkReq(), res);
    expect(statusOf(res)).toBe(201);
    const created = File.create.mock.calls[0][0];
    expect(created.linkImage).toMatch(/^https:\/\/dummy\.supabase\.co\/storage\/.+\/[a-f0-9]{32}\.png$/);
    expect(created.linkImage).not.toContain("tracker.example");
    expect(created.filePath).toMatch(/^[a-f0-9]{32}\.png$/);
    expect(sb.upload).toHaveBeenCalledWith(created.filePath, PNG, { contentType: "image/png", upsert: false });
  });
  it("image fetch failure → link is still saved, just without an image", async () => {
    lp.safeFetchImage.mockRejectedValue(new Error("Not a supported image"));
    const res = mockRes(); await createLink(mkReq(), res);
    expect(statusOf(res)).toBe(201);
    expect(File.create.mock.calls[0][0].linkImage).toBeNull();
    expect(File.create.mock.calls[0][0].filePath).toBeUndefined();
    expect(sb.upload).not.toHaveBeenCalled();
  });
  it("storage upload failure → link still saved without an image", async () => {
    lp.safeFetchImage.mockResolvedValue({ buffer: PNG, contentType: "image/png" });
    sb.upload.mockResolvedValueOnce({ data: null, error: { message: "quota" } });
    const res = mockRes(); await createLink(mkReq(), res);
    expect(statusOf(res)).toBe(201);
    expect(File.create.mock.calls[0][0].linkImage).toBeNull();
  });
  it("DB failure after the thumbnail was stored → thumbnail is removed (no orphan)", async () => {
    lp.safeFetchImage.mockResolvedValue({ buffer: PNG, contentType: "image/png" });
    File.create.mockRejectedValue(new Error("db down"));
    const res = mockRes(); await createLink(mkReq(), res);
    expect(statusOf(res)).toBe(500);
    expect(sb.remove).toHaveBeenCalledWith([sb.upload.mock.calls[0][0]]);
  });
  it("no og:image → no fetch, no upload", async () => {
    lp.extractMeta.mockReturnValue({ title: "Post", image: null, description: null, siteName: null });
    const res = mockRes(); await createLink(mkReq(), res);
    expect(statusOf(res)).toBe(201);
    expect(lp.safeFetchImage).not.toHaveBeenCalled();
  });

  describe("client view hides third-party images saved before mirroring existed", () => {
    it("drops foreign linkImage, keeps ours, keeps everything when the storage origin is unknown", () => {
      expect(toClientFile({ visibility: "public", linkImage: "https://tracker.example/p.png" }).linkImage).toBeUndefined();
      expect(toClientFile({ visibility: "public", linkImage: "https://dummy.supabase.co/storage/v1/object/public/b/x.png" }).linkImage).toBeDefined();
      expect(toClientFile({ visibility: "public", linkImage: "not a url" }).linkImage).toBeUndefined();
      const saved = process.env.SUPABASE_URL; delete process.env.SUPABASE_URL;
      expect(toClientFile({ visibility: "public", linkImage: "https://x.test/p.png" }).linkImage).toBeDefined();
      process.env.SUPABASE_URL = saved;
    });
    it("the gallery list goes through the same filter", async () => {
      File.find.mockReturnValue({ sort: () => ({ limit: () => Promise.resolve([
        { _id: "a", visibility: "public", shareToken: "t1", linkImage: "https://tracker.example/p.png" },
        { _id: "b", visibility: "public", shareToken: "t2", linkImage: "https://dummy.supabase.co/storage/x.png" },
      ]) }) });
      Folder.find.mockReturnValue({ lean: async () => [] });
      const res = mockRes(); await getAllFiles({ query: {} }, res);
      const files = jsonOf(res).files;
      expect(files[0].linkImage).toBeUndefined();
      expect(files[1].linkImage).toContain("dummy.supabase.co");
    });
  });
});

describe("M9 — safeFetchImage (real local servers)", () => {
  let server;
  const serve = (handler) => new Promise((resolve) => { server = http.createServer(handler).listen(0, () => resolve(`http://127.0.0.1:${server.address().port}/i`)); });
  beforeEach(() => { dns.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]); process.env.LINK_FETCH_TIMEOUT_MS = "400"; });
  afterEach(() => { server?.closeAllConnections?.(); server?.close(); });

  it("accepts a real PNG and reports the type from its BYTES", async () => {
    const url = await serve((q, r) => { r.writeHead(200, { "content-type": "image/png" }); r.end(PNG); });
    const out = await real.safeFetchImage(url);
    expect(out.contentType).toBe("image/png"); expect(out.buffer.equals(PNG)).toBe(true);
  });
  it("rejects a Content-Type that isn't a supported image (svg, html, octet-stream)", async () => {
    for (const ct of ["image/svg+xml", "text/html", "application/octet-stream"]) {
      const url = await serve((q, r) => { r.writeHead(200, { "content-type": ct }); r.end(PNG); });
      await expect(real.safeFetchImage(url)).rejects.toThrow(/supported image/);
      server.close();
    }
  });
  it("rejects HTML/script disguised with an image Content-Type (bytes don't match)", async () => {
    const url = await serve((q, r) => { r.writeHead(200, { "content-type": "image/png" }); r.end("<script>alert(1)</script>"); });
    await expect(real.safeFetchImage(url)).rejects.toThrow(/doesn't match/);
  });
  it("rejects an image over the size cap", async () => {
    const url = await serve((q, r) => { r.writeHead(200, { "content-type": "image/png" }); r.end(Buffer.concat([PNG, Buffer.alloc(2_000_000)])); });
    await expect(real.safeFetchImage(url)).rejects.toThrow(/too large|incomplete/);
  });
  it("a stalled download fails instead of returning a truncated (corrupt) image", async () => {
    const url = await serve((q, r) => { r.writeHead(200, { "content-type": "image/png" }); r.write(PNG); });
    await expect(real.safeFetchImage(url)).rejects.toThrow();
  });
  it("still refuses internal addresses (SSRF guard is shared)", async () => {
    dns.lookup.mockResolvedValue([{ address: "::ffff:7f00:1", family: 6 }]);
    const url = await serve((q, r) => { r.writeHead(200, { "content-type": "image/png" }); r.end(PNG); });
    await expect(real.safeFetchImage(url)).rejects.toThrow(/disallowed/);
  });
  it("sniffImageType recognises png/jpeg/gif/webp and nothing else", () => {
    expect(real.sniffImageType(PNG)).toBe("image/png");
    expect(real.sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(real.sniffImageType(Buffer.from("GIF89a"))).toBe("image/gif");
    expect(real.sniffImageType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]))).toBe("image/webp");
    expect(real.sniffImageType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(real.sniffImageType(Buffer.alloc(0))).toBeNull();
  });
  it("HTML fetching is unchanged by the refactor (partial body still OK)", async () => {
    const url = await serve((q, r) => { r.writeHead(200, { "content-type": "text/html" }); r.write("<title>ok</title>"); });
    expect(await real.safeFetchHtml(url)).toContain("<title>ok</title>");
  });
});

// ─────────────────────────── M10 ───────────────────────────
describe("M10 — an unavailable malware scan is visible, and can optionally block uploads", () => {
  const png = () => ({ file: { buffer: PNG, size: PNG.length, mimetype: "image/png", originalname: "a.png" }, body: {}, query: {}, headers: {} });
  const load = async (key) => {
    vi.resetModules();
    if (key) process.env.VIRUSTOTAL_API_KEY = key; else delete process.env.VIRUSTOTAL_API_KEY;
    return import("../controllers/fileUpload.js");
  };
  afterEach(() => { delete process.env.VIRUSTOTAL_API_KEY; delete process.env.VIRUSTOTAL_FAIL_CLOSED; });

  it("key configured but VirusTotal rate-limited: default fails OPEN (201) and logs a warning", async () => {
    const { uploadFile: up } = await load("k");
    const F = (await import("../models/File.js")).default; F.create.mockImplementation(async (d) => ({ _id: "f", ...d }));
    global.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 429 }));
    const res = mockRes(); await up(png(), res);
    expect(statusOf(res)).toBe(201);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("could not reach a verdict"));
  });
  it("VIRUSTOTAL_FAIL_CLOSED=true: same situation → 503 and nothing is stored", async () => {
    const { uploadFile: up } = await load("k");
    process.env.VIRUSTOTAL_FAIL_CLOSED = "true";
    global.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 429 }));
    const res = mockRes(); await up(png(), res);
    expect(statusOf(res)).toBe(503);
    expect(sb.upload).not.toHaveBeenCalled();
  });
  it("no key configured = feature off: never blocks, never warns", async () => {
    const { uploadFile: up } = await load(null);
    process.env.VIRUSTOTAL_FAIL_CLOSED = "true";
    const F = (await import("../models/File.js")).default; F.create.mockImplementation(async (d) => ({ _id: "f", ...d }));
    const res = mockRes(); await up(png(), res);
    expect(statusOf(res)).toBe(201);
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("verdict"));
  });
  it("a clean verdict (404 = never seen) is a normal upload even when fail-closed", async () => {
    const { uploadFile: up } = await load("k");
    process.env.VIRUSTOTAL_FAIL_CLOSED = "true";
    const F = (await import("../models/File.js")).default; F.create.mockImplementation(async (d) => ({ _id: "f", ...d }));
    global.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 404 }));
    const res = mockRes(); await up(png(), res);
    expect(statusOf(res)).toBe(201);
  });
});

// ─────────────────────────── M11 ───────────────────────────
describe("M11 — errors never leak internals", () => {
  it("serverError: generic 500, CastError/ValidationError → 400, real error only logged", () => {
    const secret = new Error("connect ECONNREFUSED mongodb://admin:hunter2@cluster0.example.net/db");
    const r1 = mockRes(); serverError(r1, secret);
    expect(statusOf(r1)).toBe(500);
    expect(JSON.stringify(jsonOf(r1))).not.toMatch(/hunter2|mongodb|ECONNREFUSED/);
    expect(console.error).toHaveBeenCalledWith(secret);
    const cast = Object.assign(new Error('Cast to ObjectId failed for value "zz" at path "_id"'), { name: "CastError" });
    const r2 = mockRes(); serverError(r2, cast);
    expect(statusOf(r2)).toBe(400); expect(jsonOf(r2).message).toBe("Invalid id");
    const val = Object.assign(new Error("File validation failed: visibility: `x` is not a valid enum value"), { name: "ValidationError" });
    const r3 = mockRes(); serverError(r3, val);
    expect(statusOf(r3)).toBe(400); expect(jsonOf(r3).message).not.toMatch(/enum|File validation/);
  });
  it("a controller that hits a DB error no longer echoes it to the client", async () => {
    File.findOne.mockRejectedValue(new Error("E11000 duplicate key index: shareToken_1 dup key: { shareToken: \"abc123\" }"));
    const { getFileByToken } = await import("../controllers/fileUpload.js");
    const res = mockRes(); await getFileByToken({ params: { token: "abc123" }, query: {}, headers: {} }, res);
    expect(statusOf(res)).toBe(500);
    expect(JSON.stringify(jsonOf(res))).not.toMatch(/E11000|shareToken|dup key/);
  });
  it("a malformed id is the caller's mistake → 400, not 500", async () => {
    File.findById.mockRejectedValue(Object.assign(new Error("Cast to ObjectId failed"), { name: "CastError" }));
    const { getSingleFile } = await import("../controllers/fileUpload.js");
    const res = mockRes(); await getSingleFile({ params: { id: "not-an-id" }, query: {}, headers: {} }, res);
    expect(statusOf(res)).toBe(400);
  });
});
