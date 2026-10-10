import { describe, it, expect, vi, afterEach } from "vitest";
import { ReadableStream } from "stream/web";

vi.mock("../models/File.js", () => ({ default: {} }));
vi.mock("../models/Folder.js", () => ({ default: {} }));
vi.mock("mongoose", () => ({ default: {} }));
const { appendFilesToZip } = await import("../controllers/folderController.js");

const body = () => new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.close(); } });
const file = (n, extra = {}) => ({ originalName: n, fileUrl: `https://storage.test/${n}`, ...extra });

afterEach(() => vi.unstubAllGlobals());

describe("appendFilesToZip — batched parallel fetching, same output as the old serial loop", () => {
  it("keeps the original file order in the archive even when fetches finish out of order", async () => {
    // earlier files respond SLOWER than later ones
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const delay = url.endsWith("a.txt") ? 30 : url.endsWith("b.txt") ? 20 : 1;
      await new Promise((r) => setTimeout(r, delay));
      return { ok: true, body: body() };
    }));
    const archive = { append: vi.fn() };
    await appendFilesToZip(archive, [file("a.txt"), file("b.txt"), file("c.txt")]);
    expect(archive.append.mock.calls.map((c) => c[1].name)).toEqual(["a.txt", "b.txt", "c.txt"]);
  });

  it("de-duplicates identical names exactly like before: a.txt, a (2).txt, a (3).txt", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, body: body() })));
    const archive = { append: vi.fn() };
    await appendFilesToZip(archive, [file("a.txt", { fileUrl: "https://s/1" }), file("a.txt", { fileUrl: "https://s/2" }), file("a.txt", { fileUrl: "https://s/3" })]);
    expect(archive.append.mock.calls.map((c) => c[1].name)).toEqual(["a.txt", "a (2).txt", "a (3).txt"]);
  });

  it("skips files that fail to fetch (network error, non-OK, no URL) without aborting the zip", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url.endsWith("boom.txt")) throw new Error("network");
      if (url.endsWith("404.txt")) return { ok: false, body: null };
      return { ok: true, body: body() };
    }));
    const archive = { append: vi.fn() };
    await appendFilesToZip(archive, [file("ok1.txt"), file("boom.txt"), file("404.txt"), { originalName: "nourl.txt" }, file("ok2.txt")]);
    expect(archive.append.mock.calls.map((c) => c[1].name)).toEqual(["ok1.txt", "ok2.txt"]);
  });

  it("never has more than 4 fetches in flight at once, but does overlap them (it's actually parallel)", async () => {
    let inFlight = 0, peak = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return { ok: true, body: body() };
    }));
    const archive = { append: vi.fn() };
    await appendFilesToZip(archive, Array.from({ length: 11 }, (_, i) => file(`f${i}.txt`)));
    expect(archive.append).toHaveBeenCalledTimes(11);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("falls back to the legacy cloudinaryUrl when a file has no fileUrl", async () => {
    const f = vi.fn(async () => ({ ok: true, body: body() }));
    vi.stubGlobal("fetch", f);
    const archive = { append: vi.fn() };
    await appendFilesToZip(archive, [{ originalName: "old.pdf", cloudinaryUrl: "https://legacy/old.pdf" }]);
    expect(f).toHaveBeenCalledWith("https://legacy/old.pdf");
  });
});
