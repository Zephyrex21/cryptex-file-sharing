import { describe, it, expect } from "vitest";
import { canAccessFile, canMutateFile, canAccessFolder } from "../middleware/auth.js";

describe("canAccessFile — reading a file (getSingleFile/preview/download)", () => {
  it("always allows a public file, no token needed", () => {
    const req = { headers: {}, query: {} };
    const file = { visibility: "public", encrypted: false, shareToken: "abc" };
    expect(canAccessFile(req, file)).toBe(true);
  });

  it("always allows a private ENCRYPTED file by bare id — content is ciphertext, the key is the real gate", () => {
    const req = { headers: {}, query: {} };
    const file = { visibility: "private", encrypted: true, shareToken: "abc" };
    expect(canAccessFile(req, file)).toBe(true);
  });

  it("blocks a private, unencrypted file with no token", () => {
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

  it("accepts the token via the X-Share-Token header too, not just the query param", () => {
    const req = { headers: { "x-share-token": "abc" }, query: {} };
    const file = { visibility: "private", encrypted: false, shareToken: "abc", tokenExpiresAt: null };
    expect(canAccessFile(req, file)).toBe(true);
  });
});

describe("canMutateFile — rename/delete/visibility on a file", () => {
  it("allows mutating a public file with no token at all — that's what public means here", () => {
    const req = { headers: {}, query: {} };
    const file = { visibility: "public", encrypted: false, shareToken: "abc" };
    expect(canMutateFile(req, file)).toBe(true);
  });

  it("does NOT exempt encrypted files — unlike canAccessFile, being unreadable doesn't make deleting it free", () => {
    const req = { headers: {}, query: {} };
    const file = { visibility: "private", encrypted: true, shareToken: "abc" };
    expect(canMutateFile(req, file)).toBe(false);
  });

  it("blocks mutating a private file with no token", () => {
    const req = { headers: {}, query: {} };
    const file = { visibility: "private", encrypted: false, shareToken: "abc" };
    expect(canMutateFile(req, file)).toBe(false);
  });

  it("allows mutating a private file with its matching, unexpired token", () => {
    const req = { headers: {}, query: { token: "abc" } };
    const file = { visibility: "private", encrypted: false, shareToken: "abc", tokenExpiresAt: null };
    expect(canMutateFile(req, file)).toBe(true);
  });

  it("blocks mutating a private file once its token has expired", () => {
    const req = { headers: {}, query: { token: "abc" } };
    const file = { visibility: "private", encrypted: false, shareToken: "abc", tokenExpiresAt: new Date(Date.now() - 1000) };
    expect(canMutateFile(req, file)).toBe(false);
  });
});

describe("canAccessFolder — reading AND mutating a folder", () => {
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

  it("blocks a private folder with no token", () => {
    const req = { headers: {}, query: {} };
    const folder = { visibility: "private", shareToken: "abc" };
    expect(canAccessFolder(req, folder)).toBe(false);
  });

  it("allows a private folder with a matching, unexpired token", () => {
    const req = { headers: {}, query: { token: "abc" } };
    const folder = { visibility: "private", shareToken: "abc", tokenExpiresAt: null };
    expect(canAccessFolder(req, folder)).toBe(true);
  });

  it("blocks a private folder once its token has expired — this was previously never checked on the by-id path", () => {
    const req = { headers: {}, query: { token: "abc" } };
    const folder = { visibility: "private", shareToken: "abc", tokenExpiresAt: new Date(Date.now() - 1000) };
    expect(canAccessFolder(req, folder)).toBe(false);
  });

  it("blocks a private folder whose token was regenerated (revoked)", () => {
    const req = { headers: {}, query: { token: "old-token" } };
    const folder = { visibility: "private", shareToken: "new-token", tokenExpiresAt: null };
    expect(canAccessFolder(req, folder)).toBe(false);
  });
});
