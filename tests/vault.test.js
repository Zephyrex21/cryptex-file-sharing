import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../models/Folder.js", () => ({
  default: { create: vi.fn(), findById: vi.fn(), findByIdAndUpdate: vi.fn() },
}));
vi.mock("../models/File.js", () => ({
  default: { create: vi.fn(), findById: vi.fn() },
}));
const Folder = (await import("../models/Folder.js")).default;
const File = (await import("../models/File.js")).default;
const { createFolder, setFolderVisibility } = await import("../controllers/folderController.js");
const { uploadFile } = await import("../controllers/fileUpload.js");

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  Object.values(Folder).forEach((fn) => fn.mockReset?.());
  Object.values(File).forEach((fn) => fn.mockReset?.());
});

describe("createFolder — vault creation", () => {
  it("forces visibility to private when encrypted is true, regardless of what's requested", async () => {
    Folder.create.mockImplementation((doc) => Promise.resolve({ _id: "f1", ...doc }));
    const req = { body: { name: "My Vault", visibility: "public", encrypted: true } };
    const res = mockRes();
    await createFolder(req, res);
    const created = Folder.create.mock.calls[0][0];
    expect(created.encrypted).toBe(true);
    expect(created.visibility).toBe("private");
  });

  it("ordinary (non-encrypted) folders keep requested visibility", async () => {
    Folder.create.mockImplementation((doc) => Promise.resolve({ _id: "f1", ...doc }));
    const req = { body: { name: "Regular", visibility: "public" } };
    const res = mockRes();
    await createFolder(req, res);
    const created = Folder.create.mock.calls[0][0];
    expect(created.encrypted).toBe(false);
    expect(created.visibility).toBe("public");
  });
});

describe("setFolderVisibility — vaults can't be made public", () => {
  it("rejects making an encrypted vault public", async () => {
    Folder.findById.mockResolvedValue({ encrypted: true });
    const req = { params: { id: "f1" }, body: { visibility: "public" } };
    const res = mockRes();
    await setFolderVisibility(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(Folder.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("allows making a non-encrypted folder public", async () => {
    Folder.findById.mockResolvedValue({ encrypted: false });
    Folder.findByIdAndUpdate.mockResolvedValue({ _id: "f1", visibility: "public" });
    const req = { params: { id: "f1" }, body: { visibility: "public" } };
    const res = mockRes();
    await setFolderVisibility(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("uploadFile — encrypted upload directly into a vault", () => {
  it("rejects when the target vaultFolderId isn't actually an encrypted vault", async () => {
    Folder.findById.mockResolvedValue({ _id: "f1", encrypted: false });
    const req = {
      file: { buffer: Buffer.from("ciphertext"), mimetype: "application/octet-stream", size: 10 },
      body: { encrypted: "true", iv: "a", encryptedName: "b", encryptedNameIV: "c", encryptedMimeType: "d", encryptedMimeTypeIV: "e", vaultFolderId: "f1" },
    };
    const res = mockRes();
    await uploadFile(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(File.create).not.toHaveBeenCalled();
  });

  it("rejects when the target vaultFolderId doesn't exist", async () => {
    Folder.findById.mockResolvedValue(null);
    const req = {
      file: { buffer: Buffer.from("ciphertext"), mimetype: "application/octet-stream", size: 10 },
      body: { encrypted: "true", iv: "a", encryptedName: "b", encryptedNameIV: "c", encryptedMimeType: "d", encryptedMimeTypeIV: "e", vaultFolderId: "doesnotexist" },
    };
    const res = mockRes();
    await uploadFile(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
