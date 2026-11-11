// Executable audit of the end-to-end encryption. These tests run the REAL browser
// functions from public/js/app.js (extracted from the source text and evaluated against
// Node's WebCrypto — the same API the browser uses), so they fail if the shipped crypto
// code ever changes in a way that weakens it. Nothing here is a re-implementation.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { webcrypto as crypto } from "node:crypto";
import { TextEncoder, TextDecoder } from "node:util";

const root = path.resolve(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "public/js/app.js"), "utf8");
const start = appJs.indexOf("function buf2b64url(buf)");
const endFn = appJs.indexOf("async function decryptString");
const end = appJs.indexOf("\n}\n", endFn) + 3;
const C = new Function("crypto", "btoa", "atob", "TextEncoder", "TextDecoder",
  appJs.slice(start, end) +
  ";return {genAesKey,exportKeyB64url,importKeyB64url,encryptBuffer,decryptBuffer,encryptString,decryptString,b64url2buf,b642buf,buf2b64};"
)(crypto, globalThis.btoa, globalThis.atob, TextEncoder, TextDecoder);

const bytes = (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i += 65536) crypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536))); return b; };
const rejects = async (p) => { try { await p; } catch { return true; } return false; };

describe("key generation", () => {
  it("is AES-256: exports 32 random bytes as a 43-char URL-safe string (fits a #fragment without escaping)", async () => {
    const s = await C.exportKeyB64url(await C.genAesKey());
    expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Uint8Array(C.b64url2buf(s)).length).toBe(32);
  });
  it("keys are unique and statistically balanced (sanity check on the CSPRNG, not a proof)", async () => {
    const keys = await Promise.all(Array.from({ length: 300 }, async () => C.exportKeyB64url(await C.genAesKey())));
    expect(new Set(keys).size).toBe(300);
    let ones = 0; for (const k of keys) for (const b of new Uint8Array(C.b64url2buf(k))) ones += b.toString(2).replace(/0/g, "").length;
    const frac = ones / (300 * 256);
    expect(frac).toBeGreaterThan(0.48); expect(frac).toBeLessThan(0.52);
  });
  it("export → import round-trips to a working key", async () => {
    const k = await C.genAesKey(); const k2 = await C.importKeyB64url(await C.exportKeyB64url(k));
    const { ciphertext, ivB64 } = await C.encryptBuffer(k, new TextEncoder().encode("hi"));
    expect(new TextDecoder().decode(await C.decryptBuffer(k2, ciphertext, ivB64))).toBe("hi");
  });
});

describe("confidentiality", () => {
  it("round-trips every size boundary, including empty", async () => {
    const k = await C.genAesKey();
    for (const n of [0, 1, 15, 16, 17, 4096, 1_000_000]) {
      const plain = bytes(n);
      const { ciphertext, ivB64 } = await C.encryptBuffer(k, plain);
      expect(new Uint8Array(await C.decryptBuffer(k, ciphertext, ivB64))).toEqual(plain);
    }
  });
  it("ciphertext is exactly plaintext + 16-byte tag, and does not contain the plaintext", async () => {
    const k = await C.genAesKey(); const marker = "TOP-SECRET-MARKER-0123456789";
    const plain = new TextEncoder().encode(marker.repeat(50));
    const { ciphertext } = await C.encryptBuffer(k, plain);
    expect(ciphertext.byteLength).toBe(plain.length + 16);
    expect(Buffer.from(ciphertext).includes(Buffer.from(marker))).toBe(false);
  });
  it("the same plaintext never encrypts to the same bytes twice (fresh IV every time)", async () => {
    const k = await C.genAesKey(); const plain = bytes(256);
    const a = await C.encryptBuffer(k, plain), b = await C.encryptBuffer(k, plain);
    expect(a.ivB64).not.toBe(b.ivB64);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
  });
  it("IVs are 96-bit and never repeat under one key (20,000 encryptions; a repeat would break GCM)", async () => {
    const k = await C.genAesKey(); const seen = new Set();
    for (let i = 0; i < 20000; i++) {
      const { ivB64 } = await C.encryptBuffer(k, new Uint8Array(1));
      expect(new Uint8Array(C.b642buf(ivB64)).length).toBe(12);
      seen.add(ivB64);
    }
    expect(seen.size).toBe(20000);
  });
  it("name and MIME type each get their own IV, never the content's", async () => {
    const k = await C.genAesKey();
    for (let i = 0; i < 500; i++) {
      const c = await C.encryptBuffer(k, new Uint8Array(8)), n = await C.encryptString(k, "report.pdf"), m = await C.encryptString(k, "application/pdf");
      expect(new Set([c.ivB64, n.ivB64, m.ivB64]).size).toBe(3);
    }
  });
});

describe("integrity: anything the server could change is detected, not silently accepted", () => {
  const setup = async () => { const k = await C.genAesKey(); const plain = bytes(2048); const e = await C.encryptBuffer(k, plain); return { k, plain, ...e }; };
  it("flipping a bit anywhere in the ciphertext or the tag is rejected", async () => {
    const { k, ciphertext, ivB64 } = await setup(); const len = ciphertext.byteLength;
    for (const pos of [0, 1, 1000, len - 17, len - 16, len - 1]) {
      const t = new Uint8Array(ciphertext.slice(0)); t[pos] ^= 1;
      expect(await rejects(C.decryptBuffer(k, t.buffer, ivB64)), `byte ${pos}`).toBe(true);
    }
  });
  it("a modified IV is rejected", async () => {
    const { k, ciphertext, ivB64 } = await setup(); const iv = new Uint8Array(C.b642buf(ivB64)); iv[0] ^= 1;
    expect(await rejects(C.decryptBuffer(k, ciphertext, C.buf2b64(iv)))).toBe(true);
  });
  it("truncated or extended data is rejected", async () => {
    const { k, ciphertext, ivB64 } = await setup();
    expect(await rejects(C.decryptBuffer(k, ciphertext.slice(0, ciphertext.byteLength - 1), ivB64))).toBe(true);
    const longer = new Uint8Array(ciphertext.byteLength + 1); longer.set(new Uint8Array(ciphertext));
    expect(await rejects(C.decryptBuffer(k, longer.buffer, ivB64))).toBe(true);
  });
  it("a wrong key — even one bit away from the right one — decrypts nothing", async () => {
    const { k, ciphertext, ivB64 } = await setup();
    const raw = new Uint8Array(C.b64url2buf(await C.exportKeyB64url(k))); raw[31] ^= 1;
    const near = await C.importKeyB64url((await import("buffer")).Buffer.from(raw).toString("base64url"));
    expect(await rejects(C.decryptBuffer(near, ciphertext, ivB64))).toBe(true);
    expect(await rejects(C.decryptBuffer(await C.genAesKey(), ciphertext, ivB64))).toBe(true);
  });
  it("a tampered filename is rejected", async () => {
    const k = await C.genAesKey(); const { cipherB64, ivB64 } = await C.encryptString(k, "salary.xlsx");
    const raw = Buffer.from(cipherB64, "base64"); raw[0] ^= 1;
    expect(await rejects(C.decryptString(k, raw.toString("base64"), ivB64))).toBe(true);
  });
});

// ── Tracked limitations (documented in SECURITY.md) ─────────────────────────────
// These pin down what is NOT protected today so nobody assumes more than is true. When the
// v2 format (AAD-bound, chunk-aware) lands, flip these to assert the opposite.
describe("known limitation (tracked): ciphertexts are not bound to their role or to each other", () => {
  it("a name ciphertext can be swapped into another slot under the same key and still decrypts", async () => {
    const k = await C.genAesKey();
    const name = await C.encryptString(k, "report.pdf");
    // a server (or anyone who can write the database) could move this into the MIME-type slot of another
    // file in the same vault; GCM accepts it because no associated data ties it to its role
    expect(await C.decryptString(k, name.cipherB64, name.ivB64)).toBe("report.pdf");
  });
});

describe("server never handles a key", () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const serverFiles = ["controllers", "routes", "middleware", "models", "utils"].flatMap((d) => walk(path.join(root, d))).concat(path.join(root, "index.js"));
  it("no server code reads a key / secret from a request", () => {
    for (const f of serverFiles) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/req\.(body|query|params)\.(key|decryptionKey|aesKey|secret)\b/i);
      expect(src, f).not.toMatch(/req\.(body|query|params)\[\s*['"](key|decryptionKey|aesKey)['"]/i);
    }
  });
  it("no database model has a field that could hold a key", () => {
    for (const f of walk(path.join(root, "models"))) expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/^\s*(decryptionKey|aesKey|encKey|keyB64|secretKey)\s*:/im);
  });
});

describe("links keep their key", () => {
  it("the legacy /?token= redirect forwards the #fragment too (it used to drop the key and strand the file)", () => {
    const home = fs.readFileSync(path.join(root, "public/js/home.js"), "utf8");
    expect(home).toMatch(/window\.location\.replace\('\/app'\+window\.location\.search\+window\.location\.hash\)/);
  });
  it("the key is read from the fragment and scrubbed from the address bar once it has been used", () => {
    expect(appJs).toMatch(/new URLSearchParams\(window\.location\.hash\.slice\(1\)\)\.get\('key'\)/);
    expect(appJs).toMatch(/function scrubKeyFromUrl\(\)\{[^}]*history\.replaceState/);
  });
});
