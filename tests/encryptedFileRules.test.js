import { describe, it, expect, vi, beforeEach } from "vitest";

// File.findById / findByIdAndUpdate are mocked so these tests exercise the
// real exported handlers' request/response logic — the actual security
// rules we added — without needing a live MongoDB connection.
vi.mock("../models/File.js", () => ({
  default: { findById: vi.fn(), findByIdAndUpdate: vi.fn() },
}));
const File = (await import("../models/File.js")).default;
const { renameFile, setVisibility } = await import("../controllers/fileUpload.js");

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => { File.findById.mockReset(); File.findByIdAndUpdate.mockReset(); });

describe("renameFile — encrypted files can't be renamed", () => {
  it("rejects with 400 when the file is encrypted", async () => {
    File.findById.mockResolvedValue({ encrypted: true });
    const req = { params: { id: "abc" }, body: { name: "new-name.txt" } };
    const res = mockRes();
    await renameFile(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(File.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("allows renaming a normal (unencrypted) file", async () => {
    File.findById.mockResolvedValue({ encrypted: false });
    File.findByIdAndUpdate.mockResolvedValue({ _id: "abc", originalName: "new-name.txt" });
    const req = { params: { id: "abc" }, body: { name: "new-name.txt" } };
    const res = mockRes();
    await renameFile(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(File.findByIdAndUpdate).toHaveBeenCalled();
  });

  it("rejects an empty name before ever touching the database", async () => {
    const req = { params: { id: "abc" }, body: { name: "   " } };
    const res = mockRes();
    await renameFile(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(File.findById).not.toHaveBeenCalled();
  });
});

describe("setVisibility — encrypted files must stay private", () => {
  it("rejects making an encrypted file public", async () => {
    File.findById.mockResolvedValue({ encrypted: true });
    const req = { params: { id: "abc" }, body: { visibility: "public" } };
    const res = mockRes();
    await setVisibility(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(File.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("allows making a normal (unencrypted) file public", async () => {
    File.findById.mockResolvedValue({ encrypted: false });
    File.findByIdAndUpdate.mockResolvedValue({ _id: "abc", visibility: "public" });
    const req = { params: { id: "abc" }, body: { visibility: "public" } };
    const res = mockRes();
    await setVisibility(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("allows setting an encrypted file to private (no-op on the rule, but a valid request)", async () => {
    File.findByIdAndUpdate.mockResolvedValue({ _id: "abc", visibility: "private" });
    const req = { params: { id: "abc" }, body: { visibility: "private" } };
    const res = mockRes();
    await setVisibility(req, res);
    // Private doesn't need the existing-file lookup at all — only public does.
    expect(File.findById).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("rejects an invalid visibility value", async () => {
    const req = { params: { id: "abc" }, body: { visibility: "sort-of-public" } };
    const res = mockRes();
    await setVisibility(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("converts expiresIn minutes into a future tokenExpiresAt date", async () => {
    File.findByIdAndUpdate.mockImplementation((id, update) => Promise.resolve({ _id: id, ...update }));
    const req = { params: { id: "abc" }, body: { visibility: "private", expiresIn: 60 } };
    const res = mockRes();
    await setVisibility(req, res);
    const [, update] = File.findByIdAndUpdate.mock.calls[0];
    expect(update.tokenExpiresAt).toBeInstanceOf(Date);
    expect(update.tokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("expiresIn of 0 clears the expiry (never expires)", async () => {
    File.findByIdAndUpdate.mockImplementation((id, update) => Promise.resolve({ _id: id, ...update }));
    const req = { params: { id: "abc" }, body: { visibility: "private", expiresIn: 0 } };
    const res = mockRes();
    await setVisibility(req, res);
    const [, update] = File.findByIdAndUpdate.mock.calls[0];
    expect(update.tokenExpiresAt).toBeNull();
  });
});
