import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../models/File.js", () => ({
  default: { find: vi.fn(), findOne: vi.fn(), findById: vi.fn(), findByIdAndUpdate: vi.fn(), findOneAndUpdate: vi.fn(), countDocuments: vi.fn() },
}));
vi.mock("../models/Folder.js", () => ({
  default: { find: vi.fn(), findOne: vi.fn(), findByIdAndUpdate: vi.fn(), findOneAndUpdate: vi.fn() },
}));
const File = (await import("../models/File.js")).default;
const Folder = (await import("../models/Folder.js")).default;
const { getAllFiles, getFileByToken, setVisibility, downloadFilesZip } = await import("../controllers/fileUpload.js");

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn();
  return res;
};
// Chainable mock for File.find(...).sort(...).skip(...).limit(...)
const chainable = (resolveWith) => {
  const q = {};
  q.sort = vi.fn().mockReturnValue(q);
  q.skip = vi.fn().mockReturnValue(q);
  q.limit = vi.fn().mockReturnValue(q);
  q.then = (resolve) => Promise.resolve(resolveWith).then(resolve);
  return q;
};

beforeEach(() => {
  Object.values(File).forEach((fn) => fn.mockReset?.());
  Object.values(Folder).forEach((fn) => fn.mockReset?.());
  Folder.find.mockReturnValue({ lean: () => Promise.resolve([]) });
});

describe("getAllFiles — pagination is opt-in", () => {
  it("returns the plain legacy shape when no page/limit given", async () => {
    File.find.mockReturnValue(chainable([{ _id: "1", shareToken: "tok" }]));
    const req = { query: {} };
    const res = mockRes();
    await getAllFiles(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body).toHaveProperty("count");
    expect(body).toHaveProperty("files");
    expect(body).not.toHaveProperty("page");
    expect(File.countDocuments).not.toHaveBeenCalled();
  });

  it("returns page/limit/total/hasMore when paging params are given", async () => {
    File.find.mockReturnValue(chainable([{ _id: "1", shareToken: "tok" }]));
    File.countDocuments.mockResolvedValue(45);
    const req = { query: { page: "2", limit: "20" } };
    const res = mockRes();
    await getAllFiles(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body.page).toBe(2);
    expect(body.limit).toBe(20);
    expect(body.total).toBe(45);
    expect(body.hasMore).toBe(true); // 2*20=40 < 45
  });

  it("caps limit at 100 even if a larger value is requested", async () => {
    File.find.mockReturnValue(chainable([]));
    File.countDocuments.mockResolvedValue(0);
    const req = { query: { limit: "9999" } };
    const res = mockRes();
    await getAllFiles(req, res);
    expect(res.json.mock.calls[0][0].limit).toBe(100);
  });
});

describe("getFileByToken — view-limit self-destruct", () => {
  it("serves normally when maxViews is not set", async () => {
    File.findOne.mockResolvedValue({ _id: "f1", tokenExpiresAt: null, maxViews: null });
    const res = mockRes();
    await getFileByToken({ params: { token: "abc" } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(File.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("increments and serves when still under the limit", async () => {
    File.findOne.mockResolvedValue({ _id: "f1", tokenExpiresAt: null, maxViews: 3, viewCount: 1 });
    File.findOneAndUpdate.mockResolvedValue({ _id: "f1", viewCount: 2 });
    const res = mockRes();
    await getFileByToken({ params: { token: "abc" } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(File.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "f1", viewCount: { $lt: 3 } },
      { $inc: { viewCount: 1 } },
      { new: true }
    );
  });

  it("rejects with 410 once the atomic update finds the limit already reached", async () => {
    File.findOne.mockResolvedValue({ _id: "f1", tokenExpiresAt: null, maxViews: 3, viewCount: 3 });
    File.findOneAndUpdate.mockResolvedValue(null); // condition didn't match — limit hit
    const res = mockRes();
    await getFileByToken({ params: { token: "abc" } }, res);
    expect(res.status).toHaveBeenCalledWith(410);
  });

  it("expiry is still checked before view-limit logic even runs", async () => {
    File.findOne.mockResolvedValue({ _id: "f1", tokenExpiresAt: new Date(Date.now() - 1000), maxViews: 5, viewCount: 0 });
    const res = mockRes();
    await getFileByToken({ params: { token: "abc" } }, res);
    expect(res.status).toHaveBeenCalledWith(410);
    expect(File.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe("setVisibility — maxViews handling", () => {
  it("resets viewCount to 0 whenever maxViews is changed", async () => {
    File.findByIdAndUpdate.mockImplementation((id, update) => Promise.resolve({ _id: id, ...update }));
    const req = { params: { id: "abc" }, body: { visibility: "private", maxViews: 5 } };
    const res = mockRes();
    await setVisibility(req, res);
    const [, update] = File.findByIdAndUpdate.mock.calls[0];
    expect(update.maxViews).toBe(5);
    expect(update.viewCount).toBe(0);
  });

  it("clears maxViews when set to 0", async () => {
    File.findByIdAndUpdate.mockImplementation((id, update) => Promise.resolve({ _id: id, ...update }));
    const req = { params: { id: "abc" }, body: { visibility: "private", maxViews: 0 } };
    const res = mockRes();
    await setVisibility(req, res);
    const [, update] = File.findByIdAndUpdate.mock.calls[0];
    expect(update.maxViews).toBeNull();
  });

  it("clears maxViews and resets viewCount when going public", async () => {
    File.findById.mockResolvedValue({ encrypted: false });
    File.findByIdAndUpdate.mockImplementation((id, update) => Promise.resolve({ _id: id, ...update }));
    const req = { params: { id: "abc" }, body: { visibility: "public" } };
    const res = mockRes();
    await setVisibility(req, res);
    const [, update] = File.findByIdAndUpdate.mock.calls[0];
    expect(update.maxViews).toBeNull();
    expect(update.viewCount).toBe(0);
  });

  it("regenerating the token also resets viewCount", async () => {
    File.findByIdAndUpdate.mockImplementation((id, update) => Promise.resolve({ _id: id, ...update }));
    const req = { params: { id: "abc" }, body: { visibility: "private", regenerateToken: true } };
    const res = mockRes();
    await setVisibility(req, res);
    const [, update] = File.findByIdAndUpdate.mock.calls[0];
    expect(update.viewCount).toBe(0);
    expect(update.shareToken).toBeDefined();
  });
});

describe("downloadFilesZip — input validation", () => {
  it("rejects with 400 when ids is missing or empty", async () => {
    const res = mockRes();
    await downloadFilesZip({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects with 404 when none of the ids match a downloadable file", async () => {
    File.find.mockResolvedValue([]);
    const res = mockRes();
    await downloadFilesZip({ body: { ids: ["a", "b"] } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("queries File.find excluding private and encrypted files", async () => {
    File.find.mockResolvedValue([]);
    const res = mockRes();
    await downloadFilesZip({ body: { ids: ["a"] } }, res);
    const query = File.find.mock.calls[0][0];
    expect(query.visibility).toEqual({ $ne: "private" });
    expect(query.encrypted).toEqual({ $ne: true });
  });
});
