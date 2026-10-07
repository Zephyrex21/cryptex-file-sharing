import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../models/File.js", () => ({
  default: { findById: vi.fn(), findByIdAndUpdate: vi.fn() },
}));
vi.mock("../models/Folder.js", () => ({
  default: { findById: vi.fn(), findByIdAndUpdate: vi.fn() },
}));
const File = (await import("../models/File.js")).default;
const Folder = (await import("../models/Folder.js")).default;
const { getSingleFile, deleteFile, renameFile } = await import("../controllers/fileUpload.js");
const { getFolderById, renameFolder, deleteFolder, addFileToFolder, removeFileFromFolder } =
  await import("../controllers/folderController.js");

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
  File.findByIdAndUpdate.mockReset();
  Folder.findById.mockReset();
  Folder.findByIdAndUpdate.mockReset();
});

describe("getSingleFile — direct-id access respects visibility/token/expiry", () => {
  it("404s when the file doesn't exist", async () => {
    File.findById.mockResolvedValue(null);
    const req = { params: { id: "missing" }, headers: {}, query: {} };
    const res = mockRes();
    await getSingleFile(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("serves a public file with no token at all", async () => {
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
});

describe("getFolderById — enforces token expiry (previously only /token/:token did)", () => {
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

describe("Mutations — public items are open, private ones need their own token", () => {
  it("deleteFile: 403s a private file with no token, without ever touching storage/DB deletion", async () => {
    const deleteOne = vi.fn();
    File.findById.mockResolvedValue({ visibility: "private", encrypted: false, shareToken: "tok", deleteOne });
    const req = { params: { id: "f1" }, headers: {}, query: {} };
    const res = mockRes();
    await deleteFile(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(deleteOne).not.toHaveBeenCalled();
  });

  it("renameFile: allows renaming a public file with no token", async () => {
    File.findById.mockResolvedValue({ visibility: "public", encrypted: false });
    File.findByIdAndUpdate.mockResolvedValue({ _id: "f1", originalName: "new.txt" });
    const req = { params: { id: "f1" }, headers: {}, query: {}, body: { name: "new.txt" } };
    const res = mockRes();
    await renameFile(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("renameFile: 403s a private file with no token", async () => {
    File.findById.mockResolvedValue({ visibility: "private", encrypted: false, shareToken: "tok" });
    const req = { params: { id: "f1" }, headers: {}, query: {}, body: { name: "new.txt" } };
    const res = mockRes();
    await renameFile(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(File.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("renameFolder: 403s a private folder with no token", async () => {
    Folder.findById.mockResolvedValue({ visibility: "private", shareToken: "tok" });
    const req = { params: { id: "fo1" }, headers: {}, query: {}, body: { name: "New" } };
    const res = mockRes();
    await renameFolder(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(Folder.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("renameFolder: allows renaming a public folder with no token", async () => {
    Folder.findById.mockResolvedValue({ visibility: "public" });
    Folder.findByIdAndUpdate.mockResolvedValue({ _id: "fo1", name: "New" });
    const req = { params: { id: "fo1" }, headers: {}, query: {}, body: { name: "New" } };
    const res = mockRes();
    await renameFolder(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("deleteFolder: 403s a private folder with no token, without unlinking files or deleting", async () => {
    const deleteOne = vi.fn();
    Folder.findById.mockResolvedValue({ visibility: "private", shareToken: "tok", files: [], deleteOne });
    const req = { params: { id: "fo1" }, headers: {}, query: {} };
    const res = mockRes();
    await deleteFolder(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(deleteOne).not.toHaveBeenCalled();
  });

  it("addFileToFolder: 403s adding to a private folder with no token", async () => {
    Folder.findById.mockResolvedValue({ visibility: "private", shareToken: "tok", files: [] });
    File.findById.mockResolvedValue({ _id: "f1" });
    const req = { params: { id: "fo1" }, headers: {}, query: {}, body: { fileId: "f1" } };
    const res = mockRes();
    await addFileToFolder(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("removeFileFromFolder: 403s removing from a private folder with no token", async () => {
    Folder.findById.mockResolvedValue({ visibility: "private", shareToken: "tok", files: [] });
    File.findById.mockResolvedValue({ _id: "f1" });
    const req = { params: { id: "fo1", fileId: "f1" }, headers: {}, query: {} };
    const res = mockRes();
    await removeFileFromFolder(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
