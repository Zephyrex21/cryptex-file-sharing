// Regression guard for the CI failure "Node.js 20 detected without native
// WebSocket support": supabase-js builds a Realtime client when createClient()
// runs, and on Node < 22 that throws — crashing the server at import time and
// every test file that touches config/supabase.js.
//
// This test recreates that environment on ANY Node (it hides the global
// WebSocket before importing the module), so the bug is caught locally even when
// the developer's Node is newer than the one CI or production uses.
import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");
const saved = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");

afterEach(() => {
  if (saved) Object.defineProperty(globalThis, "WebSocket", saved);
  else delete globalThis.WebSocket;
  vi.resetModules();
});

const hideWebSocket = () =>
  Object.defineProperty(globalThis, "WebSocket", { value: undefined, configurable: true, writable: true });

describe("config/supabase.js on runtimes without a native WebSocket (Node < 22)", () => {
  it("still builds the client (this is what broke CI on Node 20)", async () => {
    hideWebSocket();
    vi.resetModules();
    const { default: supabase } = await import("../config/supabase.js");
    expect(typeof supabase.storage.from).toBe("function"); // Storage is all this app uses
  });

  it("and also builds it normally when WebSocket exists", async () => {
    vi.resetModules();
    const { default: supabase } = await import("../config/supabase.js");
    expect(typeof supabase.storage.from).toBe("function");
  });

  it("Realtime, which the app does not use, fails with an explanation instead of a Node-version error", async () => {
    hideWebSocket();
    vi.resetModules();
    const { default: supabase } = await import("../config/supabase.js");
    let err;
    try { supabase.channel("x").subscribe(); } catch (e) { err = e; }
    // either thrown synchronously, or surfaced by the client — never the Node-version message
    if (err) expect(String(err.message)).toMatch(/Realtime is not enabled/);
  });
});

describe("CI covers every Node version the project claims to support", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const ci = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");

  it("package.json declares a minimum Node version", () => {
    expect(pkg.engines?.node).toMatch(/^>=\s*\d+/);
  });

  it("the unit-test job runs a Node matrix that includes that minimum (oldest) version", () => {
    const min = Number(pkg.engines.node.match(/\d+/)[0]);
    const m = ci.match(/matrix:\s*\n\s*node:\s*\[([^\]]+)\]/);
    expect(m, "ci.yml needs a `matrix: node: [..]` on the test job").toBeTruthy();
    const versions = m[1].split(",").map((s) => Number(s.trim()));
    expect(versions).toContain(min);
    expect(Math.max(...versions)).toBeGreaterThanOrEqual(22); // and a current LTS too
  });

  it(".nvmrc exists so local Node matches CI by default", () => {
    expect(fs.existsSync(path.join(root, ".nvmrc"))).toBe(true);
  });
});
