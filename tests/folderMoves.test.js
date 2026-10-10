import { describe, it, expect, vi, beforeEach } from "vitest";

// A fake session whose withTransaction just runs the callback — lets us
// assert WHAT happens inside the transaction without a live MongoDB.
const session = {
  withTransaction: vi.fn(async (fn) => { await fn(); }),
  endSession: vi.fn(async () => {}),
};
vi.mock("mongoose", () => ({ default: { startSession: vi.fn(async () => session) } }));
vi.mock("../models/File.js", () => ({
  default: { findById: vi.fn(), findByIdAndUpdate: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("../models/Folder.js", () => ({
  default: { findById: vi.fn(), findByIdAndUpdate: vi.fn() },
}));

const mongoose = (await import("mongoose")).default;
const File = (await import("../models/File.js")).default;
const Folder = (await import("../models/Folder.js")).default;
const { addFileToFolder, removeFileFromFolder, deleteFolder } = await import("../controllers/folderController.js");

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};
// A folder/file doc whose save() is observable
const doc = (fields) => ({ save: vi.fn(async () => {}), ...fields });

beforeEach(() => {
  vi.clearAllMocks();
  session.withTransaction.mockImplementation(async (fn) => { await fn(); });
});

describe("addFileToFolder — moving a file requires permission on the folder it's LEAVING", () => {
  // The file sits in a PRIVATE source folder; the destination is a public one anyone can write to.
  const setup = ({ srcToken = "srctok", fileVisibility = "public" } = {}) => {
    const dest = doc({ _id: "dest", visibility: "public", files: [] });
    const src  = doc({ _id: "src", visibility: "private", shareToken: srcToken, files: ["f1"] });
    const file = doc({ _id: "f1", visibility: fileVisibility, shareToken: "ftok", folderId: "src" });
    Folder.findById.mockImplementation(async (id) => (id === "dest" ? dest : id === "src" ? src : null));
    File.findById.mockResolvedValue(file);
    return { dest, src, file };
  };

  it("403s pulling a file out of a private folder with no token for it — THE BUG: this used to succeed", async () => {
    const { dest, src, file } = setup();
    const req = { params: { id: "dest" }, headers: {}, query: {}, body: { fileId: "f1" } };
    const res = mockRes();
    await addFileToFolder(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mongoose.startSession).not.toHaveBeenCalled(); // never even began writing
    expect(src.save).not.toHaveBeenCalled();
    expect(dest.save).not.toHaveBeenCalled();
    expect(file.save).not.toHaveBeenCalled();
  });

  it("403s when only a WRONG source token is supplied", async () => {
    setup();
    const req = { params: { id: "dest" }, headers: {}, query: { sourceToken: "nope" }, body: { fileId: "f1" } };
    const res = mockRes();
    await addFileToFolder(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("allows the move with the source folder's token (sourceToken), updating all three docs in ONE transaction", async () => {
    const { dest, src, file } = setup();
    const req = { params: { id: "dest" }, headers: {}, query: { sourceToken: "srctok" }, body: { fileId: "f1" } };
    const res = mockRes();
    await addFileToFolder(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(src.files).toEqual([]);              // pulled out of source
    expect(dest.files).toContain("f1");         // pushed into destination
    expect(file.folderId).toBe(dest._id);       // file re-pointed
    for (const d of [src, dest, file]) expect(d.save).toHaveBeenCalledWith({ session });
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it("also accepts the normal ?token= as the source token (one token covers a public destination)", async () => {
    setup();
    const req = { params: { id: "dest" }, headers: {}, query: { token: "srctok" }, body: { fileId: "f1" } };
    const res = mockRes();
    await addFileToFolder(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("two private folders: needs BOTH tokens (token for the destination, sourceToken for the source)", async () => {
    const dest = doc({ _id: "dest", visibility: "private", shareToken: "desttok", files: [] });
    const src  = doc({ _id: "src",  visibility: "private", shareToken: "srctok",  files: ["f1"] });
    const file = doc({ _id: "f1", visibility: "public", folderId: "src" });
    Folder.findById.mockImplementation(async (id) => (id === "dest" ? dest : src));
    File.findById.mockResolvedValue(file);

    const onlyDest = mockRes();
    await addFileToFolder({ params: { id: "dest" }, headers: {}, query: { token: "desttok" }, body: { fileId: "f1" } }, onlyDest);
    expect(onlyDest.status).toHaveBeenCalledWith(403);

    const both = mockRes();
    await addFileToFolder({ params: { id: "dest" }, headers: {}, query: { token: "desttok", sourceToken: "srctok" }, body: { fileId: "f1" } }, both);
    expect(both.status).toHaveBeenCalledWith(200);
  });

  it("403s moving a PRIVATE file without that file's own token, even into a public folder", async () => {
    const dest = doc({ _id: "dest", visibility: "public", files: [] });
    const file = doc({ _id: "f1", visibility: "private", shareToken: "ftok", folderId: null });
    Folder.findById.mockResolvedValue(dest);
    File.findById.mockResolvedValue(file);
    const res = mockRes();
    await addFileToFolder({ params: { id: "dest" }, headers: {}, query: {}, body: { fileId: "f1" } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(file.save).not.toHaveBeenCalled();
  });

  it("a file in no folder, or a stale folder reference, moves freely (nothing to be denied permission on)", async () => {
    const dest = doc({ _id: "dest", visibility: "public", files: [] });
    const file = doc({ _id: "f1", visibility: "public", folderId: "gone" });
    Folder.findById.mockImplementation(async (id) => (id === "dest" ? dest : null)); // source deleted
    File.findById.mockResolvedValue(file);
    const res = mockRes();
    await addFileToFolder({ params: { id: "dest" }, headers: {}, query: {}, body: { fileId: "f1" } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("surfaces a failure inside the transaction as a 500 and still ends the session", async () => {
    setup();
    session.withTransaction.mockRejectedValueOnce(new Error("write conflict"));
    const res = mockRes();
    await addFileToFolder({ params: { id: "dest" }, headers: {}, query: { sourceToken: "srctok" }, body: { fileId: "f1" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });
});

describe("removeFileFromFolder / deleteFolder — multi-document writes are transactional", () => {
  it("removeFileFromFolder updates folder + file inside one transaction", async () => {
    const folder = doc({ _id: "fo", visibility: "public", files: ["f1", "f2"] });
    const file = doc({ _id: "f1", folderId: "fo" });
    Folder.findById.mockResolvedValue(folder);
    File.findById.mockResolvedValue(file);
    const res = mockRes();
    await removeFileFromFolder({ params: { id: "fo", fileId: "f1" }, headers: {}, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(folder.files).toEqual(["f2"]);
    expect(file.folderId).toBeNull();
    expect(folder.save).toHaveBeenCalledWith({ session });
    expect(file.save).toHaveBeenCalledWith({ session });
  });

  it("deleteFolder unlinks files and deletes the folder inside one transaction", async () => {
    const deleteOne = vi.fn(async () => {});
    const folder = doc({ _id: "fo", visibility: "public", files: ["f1", "f2"], deleteOne });
    Folder.findById.mockResolvedValue(folder);
    File.updateMany.mockResolvedValue({});
    const res = mockRes();
    await deleteFolder({ params: { id: "fo" }, headers: {}, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(File.updateMany).toHaveBeenCalledWith({ _id: { $in: ["f1", "f2"] } }, { $set: { folderId: null } }, { session });
    expect(deleteOne).toHaveBeenCalledWith({ session });
  });
});
