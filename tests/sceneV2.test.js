// Static guards for the v2 hero + features illustrations (see "Hero · v2" and
// "Features scene · v2" in public/css/home.css). The generic perf rules (compositor-only
// keyframes, no filters, off-screen pause) live in homepagePerf.test.js and already cover
// every new vs*/fs* keyframe; these tests pin the pieces specific to the new design.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const pub = path.resolve(__dirname, "../public");
const read = (p) => fs.readFileSync(path.join(pub, p), "utf8");
const html = read("index.html"), css = read("css/home.css"), js = read("js/home.js");
const scene = (id) => { const i = html.indexOf(`id="${id}"`); return html.slice(i, i + 6000); };

describe("hero v2", () => {
  const hero = scene("vsScene");
  it("has the scan beam, the server tile with its track, and three ciphertext blocks", () => {
    expect(hero).toMatch(/class="vs-scanwrap"><i class="vs-scan">/);
    expect(hero).toMatch(/class="vs-srv"/);
    expect(hero).toMatch(/class="vs-trk"/);
    expect(hero.match(/class="vs-blk"/g)).toHaveLength(3);
    expect(hero).toContain("Ciphertext only");
  });
  it("the lock badge is placed clear of the state pill (it used to cover 'Encrypted')", () => {
    expect(css).toMatch(/\.vs-i-lock\{left:31em;top:1\.9em\}/);
  });
  it("depth: the tilt layer is 3D and items get translateZ through the independent `translate` property", () => {
    expect(css).toMatch(/\.vs-tilt\{[^}]*transform-style:preserve-3d/);
    // `translate` (not `transform`) so it composes with the entrance + float animations instead of being overridden by them
    expect(css).toMatch(/\.vs-item\{position:absolute;translate:0 0 var\(--z,0em\)\}/);
    expect(hero).toMatch(/vs-i-lock" style="[^"]*--z:/);
  });
  it("new animations are keyed to the shared 9s loop", () => {
    for (const n of ["vsScan", "vsShip", "vsLand", "vsKey"]) expect(css).toMatch(new RegExp(`@keyframes ${n}\\{`));
    expect(css).toMatch(/animation:vsScan 9s/);
    expect(css).toMatch(/animation:vsShip 9s/);
  });
});

describe("features v2", () => {
  const fsHtml = scene("fsScene");
  it("each layer carries content: public files, a share token, AES-256-GCM", () => {
    expect(fsHtml.match(/class="fs-doc"/g)).toHaveLength(3);
    expect(fsHtml).toMatch(/class="fs-tok"[\s\S]*k3x9a2/);
    expect(fsHtml).toMatch(/class="fs-aes"[\s\S]*256-GCM/);
    expect(fsHtml.match(/class="fs-veil"/g)).toHaveLength(3);
    expect(fsHtml.match(/class="fs-pkt"/g)).toHaveLength(2);
  });
  it("the layer highlight composes with the running animations: it uses `translate` and an opacity veil, never `transform`", () => {
    expect(css).toMatch(/\.fs-plate\{translate:0 0 var\(--lift,0em\)/);
    const hl = css.match(/\.fs-scene\[data-hl[^{]*\{[^}]*\}/g) || [];
    expect(hl.length).toBeGreaterThan(4);
    for (const rule of hl) {
      // only the token chip scales (it is not animated); plates/labels move via translate/--lift
      if (/\.fs-tok/.test(rule)) continue;
      expect(rule, rule).not.toMatch(/[^-]transform\s*:/);
    }
  });
  it("every highlight value used by the list has matching CSS", () => {
    for (const v of ["enc", "priv", "tok", "pub"]) expect(css).toContain(`.fs-scene[data-hl="${v}"]`);
  });
  it("the plate colours match their labels (middle layer is the same blue as the 'Private' dot)", () => {
    expect(css).toMatch(/\.fs-p2\{background:linear-gradient\(145deg,rgba\(59,125,242/);
    expect(css).toMatch(/\.fs-dot-blu\{background:var\(--blu\)\}/);
  });
});

describe("feature list ↔ layers link", () => {
  const rows = (html.match(/class="feat-row[ "]/g) || []).length;
  it("home.js maps every feature row to a layer (or none) and only toggles an attribute", () => {
    const m = js.match(/const LAYER=\[([^\]]*)\]/);
    expect(m, "LAYER map").toBeTruthy();
    expect(m[1].split(",").length).toBe(rows);
    expect(js).toMatch(/setAttribute\('data-hl',v\)/);
    expect(js).toMatch(/removeAttribute\('data-hl'\)/);
  });
  it("is skipped on touch devices (no hover)", () => {
    expect(js).toMatch(/matchMedia\('\(hover:hover\)'\)\.matches\)return;\s*\/\/ row order/);
  });
});

describe("reduced motion / theming for the new parts", () => {
  it("the moving extras are hidden and the finished composition stays", () => {
    expect(css).toMatch(/\.fs-pkt,\.fs-wave,\.vs-blk,\.vs-scan\{display:none\}/);
  });
  it("dark theme has its own surfaces for the new tiles", () => {
    for (const sel of ['[data-theme="dark"] .vs-srv', '[data-theme="dark"] .fs-doc', '[data-theme="dark"] .fs-tok']) expect(css).toContain(sel);
  });
});
