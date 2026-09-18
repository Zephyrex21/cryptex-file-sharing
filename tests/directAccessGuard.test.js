import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../models/File.js", () => ({
  default: { findById: vi.fn() },
}));
vi.mock("../models/Folder.js", () => ({
  default: { findById: vi.fn() },
}));
const File = (await import("../models/File.js")).default;
const Folder = (await import("../models/Folder.js")).default;
const { getSingleFile } = await import("../controllers/fileUpload.js");
const { getFolderById } = await import("../controllers/folderController.js");
const { OWNER_KEY } = await import("../middleware/auth.js");

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

// Folder.findById(id).populate(...) — chainable, resolves to the folder doc
const chainableFolder = (folder) => ({ populate: vi.fn().mockResolvedValue(folder) });

beforeEach(() => {
  File.findById.mockReset();
  Folder.findById.mockReset();
});

describe("getSingleFile — direct-id access now respects visibility/token/expiry", () => {
  it("404s when the file doesn't exist", async () => {
    File.findById.mockResolvedValue(null);
    const req = { params: { id: "missing" }, headers: {}, query: {} };
    const res = mockRes();
    await getSingleFile(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("serves a public file with no token or key at all", async () => {
    File.findById.mockResolvedValue({ visibility: "public", encrypted: false });
    const req = { params: { id: "f1" }, headers: {}, query: {} };
    const res = mockRes();
    await getSingleFile(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("403s a private file with no token — this is the bug: it used to just serve it", async () => {
    File.findById.mockResolvedValue({ visibility: "private", encrypted: false, shareToken: "tok" });
    const req = { params: { id: "f1" }, headers: {}, query: {} };
    const res = mockRes();
    await getSingleFile(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("serves a private file when the matching token is supplied", async () => {
    File.findById.mockResolvedValue({ visibility: "private", encrypted: false, shareToken: "tok", tokenExpiresAt: null });
    const req = { params: { id: "f1" }, headers: {}, query: { token: "tok" } };
    const res = mockRes();
    await getSingleFile(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("serves a private ENCRYPTED file by bare id — ciphertext, no gate needed", async () => {
    File.findById.mockResolvedValue({ visibility: "private", encrypted: true, shareToken: "tok" });
    const req = { params: { id: "f1" }, headers: {}, query: {} };
    const res = mockRes();
    await getSingleFile(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("serves a private file when the owner key is supplied", async () => {
    File.findById.mockResolvedValue({ visibility: "private", encrypted: false, shareToken: "tok" });
    const req = { params: { id: "f1" }, headers: { "x-owner-key": OWNER_KEY }, query: {} };
    const res = mockRes();
    await getSingleFile(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("getFolderById — now also enforces token expiry (previously only /token/:token did)", () => {
  it("403s a private folder whose token has expired", async () => {
    Folder.findById.mockReturnValue(chainableFolder({
      visibility: "private",
      shareToken: "tok",
      tokenExpiresAt: new Date(Date.now() - 1000),
    }));
    const req = { params: { id: "fo1" }, headers: {}, query: { token: "tok" } };
    const res = mockRes();
    await getFolderById(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("200s a private folder with a valid, unexpired token", async () => {
    Folder.findById.mockReturnValue(chainableFolder({
      visibility: "private",
      shareToken: "tok",
      tokenExpiresAt: null,
    }));
    const req = { params: { id: "fo1" }, headers: {}, query: { token: "tok" } };
    const res = mockRes();
    await getFolderById(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
