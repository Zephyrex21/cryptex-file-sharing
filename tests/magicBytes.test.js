import { describe, it, expect } from "vitest";
import { verifyMagicBytes, sanitizeOriginalName } from "../controllers/fileUpload.js";

const buf = (...bytes) => Buffer.from(bytes);
const strBuf = (s) => Buffer.from(s, "utf8");

describe("verifyMagicBytes — real signatures pass", () => {
  it("PNG", () => expect(verifyMagicBytes(buf(0x89,0x50,0x4E,0x47,1,2,3), "image/png")).toBe(true));
  it("JPEG", () => expect(verifyMagicBytes(buf(0xFF,0xD8,0xFF,1,2), "image/jpeg")).toBe(true));
  it("GIF", () => expect(verifyMagicBytes(buf(0x47,0x49,0x46,0x38,1), "image/gif")).toBe(true));
  it("PDF", () => expect(verifyMagicBytes(buf(0x25,0x50,0x44,0x46,1), "application/pdf")).toBe(true));
  it("ZIP", () => expect(verifyMagicBytes(buf(0x50,0x4B,0x03,0x04,1), "application/zip")).toBe(true));
  it("WEBP (RIFF....WEBP)", () => {
    const b = Buffer.concat([buf(0x52,0x49,0x46,0x46), buf(0,0,0,0), strBuf("WEBP")]);
    expect(verifyMagicBytes(b, "image/webp")).toBe(true);
  });
  it("MP4 (....ftyp)", () => {
    const b = Buffer.concat([buf(0,0,0,0x20), strBuf("ftyp"), strBuf("isom")]);
    expect(verifyMagicBytes(b, "video/mp4")).toBe(true);
  });
  it("legacy .doc (OLE2)", () =>
    expect(verifyMagicBytes(buf(0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1), "application/msword")).toBe(true));
});

describe("verifyMagicBytes — mismatches are rejected", () => {
  it("PNG bytes claimed as PDF", () =>
    expect(verifyMagicBytes(buf(0x89,0x50,0x4E,0x47), "application/pdf")).toBe(false));
  it("plain text claimed as ZIP", () =>
    expect(verifyMagicBytes(strBuf("hello world"), "application/zip")).toBe(false));
  it("empty buffer claimed as JPEG", () =>
    expect(verifyMagicBytes(Buffer.alloc(0), "image/jpeg")).toBe(false));
});

describe("verifyMagicBytes — text-like types (no fixed signature)", () => {
  it("plain UTF-8 text passes as text/plain", () =>
    expect(verifyMagicBytes(strBuf("just some plain text\nline two"), "text/plain")).toBe(true));
  it("a null byte fails the text check (binary posing as text)", () => {
    const b = Buffer.concat([strBuf("looks fine"), Buffer.from([0x00]), strBuf("but isn't")]);
    expect(verifyMagicBytes(b, "text/plain")).toBe(false);
  });
  it("invalid UTF-8 fails the text check", () =>
    expect(verifyMagicBytes(buf(0xFF,0xFE,0xFD,0xFC), "text/csv")).toBe(false));
});

describe("verifyMagicBytes — JSON / XML content sniffing", () => {
  it("valid JSON object passes", () => expect(verifyMagicBytes(strBuf('{"a":1}'), "application/json")).toBe(true));
  it("valid JSON array passes", () => expect(verifyMagicBytes(strBuf("[1,2,3]"), "application/json")).toBe(true));
  it("non-JSON text fails as application/json", () =>
    expect(verifyMagicBytes(strBuf("not json at all"), "application/json")).toBe(false));
  it("XML starting with < passes", () => expect(verifyMagicBytes(strBuf("<root/>"), "application/xml")).toBe(true));
  it("non-XML text fails as text/xml", () => expect(verifyMagicBytes(strBuf("no angle brackets"), "text/xml")).toBe(false));
});

describe("verifyMagicBytes — OOXML (docx/xlsx/pptx) vs plain ZIP", () => {
  const zipSig = buf(0x50,0x4B,0x03,0x04);
  const docxType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  it("a real docx (zip + word/document.xml entry name present) passes", () => {
    const b = Buffer.concat([zipSig, strBuf("junk header word/document.xml more junk")]);
    expect(verifyMagicBytes(b, docxType)).toBe(true);
  });
  it("a plain ZIP renamed to .docx is rejected — has zip signature but not the internal path", () => {
    const b = Buffer.concat([zipSig, strBuf("just some other zip contents, e.g. photos/a.jpg")]);
    expect(verifyMagicBytes(b, docxType)).toBe(false);
  });
  it("something with the right filename text but no zip signature is rejected", () => {
    expect(verifyMagicBytes(strBuf("word/document.xml"), docxType)).toBe(false);
  });
});

describe("sanitizeOriginalName", () => {
  it("strips control characters", () => expect(sanitizeOriginalName("bad\x00name\x1F.txt")).toBe("badname.txt"));
  it("trims and falls back to 'file' for empty input", () => expect(sanitizeOriginalName("   ")).toBe("file"));
  it("caps length at 255 characters", () => expect(sanitizeOriginalName("a".repeat(300)).length).toBe(255));
  it("leaves a normal filename untouched", () => expect(sanitizeOriginalName("report_final (2).pdf")).toBe("report_final (2).pdf"));
});
