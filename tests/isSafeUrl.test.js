import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dns/promises BEFORE importing the module under test, so isSafeUrl's
// internal `dns.lookup` calls never touch the real network — this makes the
// tests fast, deterministic, and runnable with no network access at all.
vi.mock("dns/promises", () => ({
  default: { lookup: vi.fn() },
}));
const dns = (await import("dns/promises")).default;
const { isSafeUrl } = await import("../controllers/linkPreview.js");

const mockResolves = (addresses) => dns.lookup.mockResolvedValue(addresses);

beforeEach(() => { dns.lookup.mockReset(); });

describe("isSafeUrl — rejected before any DNS lookup happens", () => {
  it("rejects malformed URLs", async () => {
    expect(await isSafeUrl("not a url")).toBe(false);
    expect(dns.lookup).not.toHaveBeenCalled();
  });
  it("rejects non-http(s) protocols", async () => {
    expect(await isSafeUrl("ftp://example.com/file")).toBe(false);
    expect(await isSafeUrl("file:///etc/passwd")).toBe(false);
    expect(await isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(dns.lookup).not.toHaveBeenCalled();
  });
  it("rejects bare 'localhost' directly, without needing DNS", async () => {
    expect(await isSafeUrl("http://localhost/admin")).toBe(false);
    expect(dns.lookup).not.toHaveBeenCalled();
  });
});

describe("isSafeUrl — resolved address is a private/reserved range", () => {
  it("rejects loopback (127.0.0.1)", async () => {
    mockResolves([{ address: "127.0.0.1", family: 4 }]);
    expect(await isSafeUrl("http://not-localhost-but-resolves-there.example/")).toBe(false);
  });
  it("rejects the cloud metadata address (169.254.169.254)", async () => {
    mockResolves([{ address: "169.254.169.254", family: 4 }]);
    expect(await isSafeUrl("http://metadata.example/latest/meta-data")).toBe(false);
  });
  it("rejects private LAN ranges (10.x, 172.16-31.x, 192.168.x)", async () => {
    for (const ip of ["10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1"]) {
      mockResolves([{ address: ip, family: 4 }]);
      expect(await isSafeUrl("https://internal.example/")).toBe(false);
    }
  });
  it("rejects IPv6 loopback (::1)", async () => {
    mockResolves([{ address: "::1", family: 6 }]);
    expect(await isSafeUrl("https://ipv6-internal.example/")).toBe(false);
  });
  it("rejects IPv6 unique-local (fd00::/8)", async () => {
    mockResolves([{ address: "fd12:3456::1", family: 6 }]);
    expect(await isSafeUrl("https://ipv6-ula.example/")).toBe(false);
  });
  it("rejects an IPv4-mapped IPv6 address pointing at a private IP", async () => {
    mockResolves([{ address: "::ffff:127.0.0.1", family: 6 }]);
    expect(await isSafeUrl("https://mapped.example/")).toBe(false);
  });
  it("rejects if ANY resolved address is private, even when others are public", async () => {
    mockResolves([{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    expect(await isSafeUrl("https://mixed.example/")).toBe(false);
  });
  it("rejects when DNS resolution fails entirely", async () => {
    dns.lookup.mockRejectedValue(new Error("ENOTFOUND"));
    expect(await isSafeUrl("https://does-not-exist.invalid/")).toBe(false);
  });
});

describe("isSafeUrl — genuinely public addresses are allowed", () => {
  it("allows a normal public IPv4 address", async () => {
    mockResolves([{ address: "93.184.216.34", family: 4 }]); // example.com's real IP
    expect(await isSafeUrl("https://example.com/page")).toBe(true);
  });
  it("allows a normal public IPv6 address", async () => {
    mockResolves([{ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }]);
    expect(await isSafeUrl("https://example.com/page")).toBe(true);
  });
});
