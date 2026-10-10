import { describe, it, expect } from "vitest";
import { generateToken } from "../utils/token.js";

describe("generateToken — short, human-friendly share tokens", () => {
  it("is exactly 6 characters by default", () => {
    for (let i = 0; i < 200; i++) expect(generateToken()).toHaveLength(6);
  });

  it("only uses lowercase letters and digits (no ambiguous capital I / lowercase l mixups, nothing needing URL-encoding)", () => {
    for (let i = 0; i < 500; i++) expect(generateToken()).toMatch(/^[0-9a-z]{6}$/);
  });

  it("doesn't repeat across a large sample (sanity check that it's actually random)", () => {
    const seen = new Set();
    for (let i = 0; i < 5000; i++) seen.add(generateToken());
    // 5000 draws from ~2.18 billion: a collision is astronomically unlikely
    expect(seen.size).toBeGreaterThan(4990);
  });

  it("uses the whole alphabet, not a biased subset", () => {
    const seenChars = new Set();
    for (let i = 0; i < 2000; i++) for (const c of generateToken()) seenChars.add(c);
    expect(seenChars.size).toBe(36);
  });

  it("honours an explicit length", () => {
    expect(generateToken(10)).toHaveLength(10);
  });
});
