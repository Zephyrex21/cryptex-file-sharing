import { describe, it, expect, vi, beforeEach } from "vitest";

const session = {
  withTransaction: vi.fn(async (fn) => { await fn(); }),
  endSession: vi.fn(async () => {}),
};
const remove = vi.fn(async () => ({ error: null }));
vi.mock("mongoose", () => ({ default: { startSession: vi.fn(async () => session) } }));
vi.mock("../config/supabase.js", () => ({ default: { storage: { from: () => ({ remove }) } } }));
vi.mock("../models/File.js", () => ({ default: { findById: vi.fn() } }));
vi.mock("../models/Folder.js", () => ({ default: { findByIdAndUpdate: vi.fn() } }));

const File = (await import("../models/File.js")).default;
const Folder = (await import("../models/Folder.js")).default;
const { deleteFile } = await import("../controllers/fileUpload.js");

const mockRes = () => { const r = {}; r.status = vi.fn().mockReturnValue(r); r.json = vi.fn().mockReturnValue(r); return r; };

beforeEach(() => {
  vi.clearAllMocks();
  session.withTransaction.mockImplementation(async (fn) => { await fn(); });
  remove.mockResolvedValue({ error: null });
});

describe("deleteFile — storage removal is best-effort; the two DB writes are one transaction", () => {
  it("removes from storage, then pulls from the folder and deletes the record atomically", async () => {
    const deleteOne = vi.fn(async () => {});
    File.findById.mockResolvedValue({ _id: "f1", visibility: "public", filePath: "x/y.png", folderId: "fo", deleteOne });
    const res = mockRes();
    await deleteFile({ params: { id: "f1" }, headers: {}, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(remove).toHaveBeenCalledWith(["x/y.png"]);
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(Folder.findByIdAndUpdate).toHaveBeenCalledWith("fo", { $pull: { files: "f1" } }, { session });
    expect(deleteOne).toHaveBeenCalledWith({ session });
    // storage call must happen BEFORE the transaction opens (no network I/O inside it)
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(session.withTransaction.mock.invocationCallOrder[0]);
  });

  it("a storage error does NOT block deleting the DB record (otherwise the file reappears on refresh)", async () => {
    remove.mockResolvedValue({ error: { message: "bucket hiccup" } });
    const deleteOne = vi.fn(async () => {});
    File.findById.mockResolvedValue({ _id: "f1", visibility: "public", filePath: "x/y.png", folderId: null, deleteOne });
    const res = mockRes();
    await deleteFile({ params: { id: "f1" }, headers: {}, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(deleteOne).toHaveBeenCalled();
    expect(Folder.findByIdAndUpdate).not.toHaveBeenCalled(); // no folder to pull from
  });

  it("deleting a private file needs its token (and does nothing without it)", async () => {
    const deleteOne = vi.fn();
    File.findById.mockResolvedValue({ _id: "f1", visibility: "private", shareToken: "abc123", filePath: "p", deleteOne });
    const denied = mockRes();
    await deleteFile({ params: { id: "f1" }, headers: {}, query: {} }, denied);
    expect(denied.status).toHaveBeenCalledWith(403);
    expect(remove).not.toHaveBeenCalled();
    expect(deleteOne).not.toHaveBeenCalled();

    const ok = mockRes();
    await deleteFile({ params: { id: "f1" }, headers: {}, query: { token: "abc123" } }, ok);
    expect(ok.status).toHaveBeenCalledWith(200);
    expect(deleteOne).toHaveBeenCalled();
  });
});
