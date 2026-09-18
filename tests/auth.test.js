import { describe, it, expect, vi } from "vitest";
import { OWNER_KEY, requireOwner, canAccessFile, canAccessFolder } from "../middleware/auth.js";

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe("requireOwner", () => {
  it("rejects a request with no owner key", () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = vi.fn();
    requireOwner(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong owner key", () => {
    const req = { headers: { "x-owner-key": "definitely-not-it" } };
    const res = mockRes();
    const next = vi.fn();
    requireOwner(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows a request with the correct owner key", () => {
    const req = { headers: { "x-owner-key": OWNER_KEY } };
    const res = mockRes();
    const next = vi.fn();
    requireOwner(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("canAccessFile", () => {
  it("always allows a public file, no token or key needed", () => {
    const req = { headers: {}, query: {} };
    const file = { visibility: "public", encrypted: false, shareToken: "abc" };
    expect(canAccessFile(req, file)).toBe(true);
  });

  it("always allows a private ENCRYPTED file by bare id — content is ciphertext, the key is the real gate", () => {
    const req = { headers: {}, query: {} };
    const file = { visibility: "private", encrypted: true, shareToken: "abc" };
    expect(canAccessFile(req, file)).toBe(true);
  });

  it("blocks a private, unencrypted file with no token and no owner key", () => {
    const req = { headers: {}, query: {} };
    const file = { visibility: "private", encrypted: false, shareToken: "abc" };
    expect(canAccessFile(req, file)).toBe(false);
  });

  it("blocks a private file when the supplied token doesn't match — this is the core fix: a leaked/old id no longer works on its own", () => {
    const req = { headers: {}, query: { token: "wrong-token" } };
    const file = { visibility: "private", encrypted: false, shareToken: "abc" };
    expect(canAccessFile(req, file)).toBe(false);
  });

  it("allows a private file when the supplied token matches and hasn't expired", () => {
    const req = { headers: {}, query: { token: "abc" } };
    const file = { visibility: "private", encrypted: false, shareToken: "abc", tokenExpiresAt: null };
    expect(canAccessFile(req, file)).toBe(true);
  });

  it("blocks a private file once its token has expired, even with the right token string", () => {
    const req = { headers: {}, query: { token: "abc" } };
    const file = { visibility: "private", encrypted: false, shareToken: "abc", tokenExpiresAt: new Date(Date.now() - 1000) };
    expect(canAccessFile(req, file)).toBe(false);
  });

  it("blocks a private file whose token was regenerated (revoked) — matches against the CURRENT shareToken", () => {
    const req = { headers: {}, query: { token: "old-token" } };
    const file = { visibility: "private", encrypted: false, shareToken: "new-token", tokenExpiresAt: null };
    expect(canAccessFile(req, file)).toBe(false);
  });

  it("allows a private file when the owner key is supplied, regardless of token", () => {
    const req = { headers: { "x-owner-key": OWNER_KEY }, query: {} };
    const file = { visibility: "private", encrypted: false, shareToken: "abc" };
    expect(canAccessFile(req, file)).toBe(true);
  });
});

describe("canAccessFolder", () => {
  it("always allows a public folder", () => {
    const req = { headers: {}, query: {} };
    const folder = { visibility: "public", shareToken: "abc" };
    expect(canAccessFolder(req, folder)).toBe(true);
  });

  it("does NOT exempt encrypted (vault) folders — folder metadata is always plain text", () => {
    const req = { headers: {}, query: {} };
    const folder = { visibility: "private", encrypted: true, shareToken: "abc" };
    expect(canAccessFolder(req, folder)).toBe(false);
  });

  it("blocks a private folder with no token and no owner key", () => {
    const req = { headers: {}, query: {} };
    const folder = { visibility: "private", shareToken: "abc" };
    expect(canAccessFolder(req, folder)).toBe(false);
  });

  it("allows a private folder with a matching, unexpired token", () => {
    const req = { headers: {}, query: { token: "abc" } };
    const folder = { visibility: "private", shareToken: "abc", tokenExpiresAt: null };
    expect(canAccessFolder(req, folder)).toBe(true);
  });

  it("blocks a private folder once its token has expired — this was previously never checked on this path", () => {
    const req = { headers: {}, query: { token: "abc" } };
    const folder = { visibility: "private", shareToken: "abc", tokenExpiresAt: new Date(Date.now() - 1000) };
    expect(canAccessFolder(req, folder)).toBe(false);
  });

  it("allows a private folder when the owner key is supplied", () => {
    const req = { headers: { "x-owner-key": OWNER_KEY }, query: {} };
    const folder = { visibility: "private", shareToken: "abc" };
    expect(canAccessFolder(req, folder)).toBe(true);
  });
});
