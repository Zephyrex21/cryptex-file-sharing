// Performance budget for the homepage animations.
//
// The hero/feature visuals used to be SVGs running ~45 simultaneous animations
// with Gaussian-blur / drop-shadow filters on the moving parts — that kept the
// raster thread ~96% busy on an idle page (measured with Chrome tracing) and
// made the page jitter. They're now layered HTML where only compositor-driven
// properties move. These tests are static guards (no browser needed) so that
// can't quietly regress: anything that animates layout or forces a per-frame
// repaint fails the build.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const pub = path.resolve(__dirname, "../public");
const read = (p) => fs.readFileSync(path.join(pub, p), "utf8");
const home = read("css/home.css");
const shared = read("css/shared.css");
const indexHtml = read("index.html");
const appHtml = read("app.html");

// Pull every @keyframes block (with brace matching) → { name: [property, ...] }
const keyframes = (css) => {
  const out = {};
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1, i = re.lastIndex;
    while (i < css.length && depth) { if (css[i] === "{") depth++; else if (css[i] === "}") depth--; i++; }
    const body = css.slice(re.lastIndex, i - 1);
    const props = new Set();
    for (const decl of body.matchAll(/([a-z-]+)\s*:[^;{}]+(?=[;}]|$)/gi)) props.add(decl[1].toLowerCase());
    out[m[1]] = [...props];
  }
  return out;
};

// Only these can be animated on the compositor (no layout, no repaint)
const COMPOSITOR_ONLY = new Set(["transform", "opacity"]);

describe("animations only move compositor properties", () => {
  const all = { ...keyframes(shared), ...keyframes(home) };
  // Keyframes that belong to the loader, the backdrop and the home scenes
  const budgeted = Object.keys(all).filter((n) =>
    /^(vs|fs|lb|preloader|driftGrid|rise|fadeIn|markerIn)/.test(n));

  it("finds the keyframes it is supposed to police", () => {
    for (const n of ["vsBar", "vsFloat", "vsIn", "lbShackle", "fsAssemble", "fsLayer", "preloaderSlide", "preloaderPulse", "driftGrid", "rise"]) {
      expect(budgeted, `${n} should be covered`).toContain(n);
    }
  });
  for (const name of Object.keys({ ...keyframes(shared), ...keyframes(home) })) {
    if (!/^(vs|fs|lb|preloader|driftGrid|rise|fadeIn|markerIn)/.test(name)) continue;
    it(`@keyframes ${name} animates only transform/opacity`, () => {
      const bad = all[name].filter((p) => !COMPOSITOR_ONLY.has(p));
      expect(bad, `${name} animates ${bad.join(", ")}`).toEqual([]);
    });
  }
  it("the old repaint-every-frame / layout-every-frame animations are gone", () => {
    expect(shared).not.toMatch(/@keyframes\s+driftGrid[^}]*background-position/);
    expect(shared).not.toMatch(/@keyframes\s+preloaderFill/);
    expect(shared).not.toMatch(/\.preloader-fill\{[^}]*(margin-left|animation:[^;}]*Fill)/);
  });
});

describe("no filter effects on animated homepage content", () => {
  it("the home scenes use no CSS filter / backdrop-filter", () => {
    const a = home.indexOf("Hero + feature visuals"), b = home.indexOf("Entrance choreography");
    expect(a).toBeGreaterThan(-1); expect(b).toBeGreaterThan(a);
    expect(home.slice(a, b)).not.toMatch(/(^|[^-])filter\s*:/m);
    expect(home.slice(a, b)).not.toMatch(/backdrop-filter/);
  });
  it("the backdrop glows no longer use blur()", () => {
    expect(shared).not.toMatch(/\.cglow\{[^}]*blur\(/);
  });
  it("index.html has no SVG filters (feGaussianBlur / feDropShadow / <filter>)", () => {
    expect(indexHtml).not.toMatch(/<filter\b|feGaussianBlur|feDropShadow/);
  });
  it("the scenes are plain HTML, not SVG illustrations with animated internals", () => {
    expect(indexHtml).toContain('id="vsScene"');
    expect(indexHtml).toContain('id="fsScene"');
    expect(indexHtml).not.toMatch(/class="hero-illo"[\s\S]{0,400}<svg viewBox="0 0 520 440"/);
  });
  it("scene loops pause when off-screen (the .is-playing gate exists)", () => {
    expect(home).toMatch(/\.js \.vs-scene:not\(\.is-playing\)[^{]*\{[^}]*animation-play-state:paused/);
    expect(home).toMatch(/\.js \.fs-scene:not\(\.is-playing\)[^{]*\{[^}]*animation-play-state:paused/);
  });
});

describe("loading screen", () => {
  it("honours reduced motion and has a no-JS escape (the loader is lifted by JS)", () => {
    expect(shared).toMatch(/@media\(prefers-reduced-motion:reduce\)\{[^}]*preloader/);
    expect(indexHtml).toMatch(/<noscript>\s*<style>\s*\.preloader\{display:none/);
    expect(appHtml).toMatch(/<noscript>\s*<style>\s*\.preloader\{display:none/);
  });
  it("scroll lock is paired with scrollbar-gutter so lifting it can't shift the page", () => {
    expect(shared).toMatch(/html\{[^}]*scrollbar-gutter:stable/);
    expect(shared).toMatch(/html\.is-loading\{overflow:hidden\}/);
  });
  it("waits for fonts as well as the load event, and can never get stuck", () => {
    const js = read("js/shared.js");
    expect(js).toMatch(/document\.fonts\.load/);
    expect(js).toMatch(/MAX_MS/);
    expect(js).toMatch(/cryptex:ready/);
  });
});

describe("fonts are self-hosted (no third-party request, no late swap)", () => {
  for (const [name, html] of [["index.html", indexHtml], ["app.html", appHtml]]) {
    it(`${name} makes no Google Fonts request and preloads the local fonts`, () => {
      expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
      expect(html).toMatch(/rel="preload"[^>]*inter-latin-opsz-normal\.woff2[^>]*crossorigin/);
      expect(html).toMatch(/rel="preload"[^>]*jetbrains-mono-latin-wght-normal\.woff2[^>]*crossorigin/);
    });
  }
  it("every @font-face file exists on disk, and the OFL licences ship with them", () => {
    const urls = [...shared.matchAll(/url\("\/(fonts\/[^"]+)"\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThanOrEqual(2);
    for (const u of urls) expect(fs.existsSync(path.join(pub, u)), u).toBe(true);
    expect(fs.existsSync(path.join(pub, "fonts/Inter-OFL.txt"))).toBe(true);
    expect(fs.existsSync(path.join(pub, "fonts/JetBrainsMono-OFL.txt"))).toBe(true);
  });
  it("has a metric-matched fallback so a swap before the font arrives moves almost nothing", () => {
    expect(shared).toMatch(/font-family:"Inter Fallback"[^}]*size-adjust/);
    expect(shared).toMatch(/--font:"Inter","Inter Fallback"/);
  });
});

describe("headline animation can't re-flow the page", () => {
  const js = read("js/home.js");
  it("pins every character to its measured width and restores the original text", () => {
    expect(js).toMatch(/getBoundingClientRect\(\)\.width/);
    expect(js).toMatch(/s\.style\.width/);
    expect(js).toMatch(/line\.el\.textContent=line\.text/);
  });
  it("no longer swaps the headline into a different font or types headings character by character", () => {
    expect(home).not.toMatch(/#heroLine\d\.scrambling/);
    expect(js).not.toMatch(/function\s+(typewriter|scrambleReveal)\b/);
    expect(js).not.toMatch(/classList\.\w+\(['"]tw-typing/);
    expect(js).not.toMatch(/setTimeout\([^)]*\)[^;]*textContent\s*=\s*[^;]*\.slice\(/);
  });
});
