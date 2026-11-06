// Static guards for the Ctrl/⌘+K command palette and the premium hover / flow
// animations. (The behaviour itself is covered end-to-end in e2e scenario S23.)
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const pub = path.resolve(__dirname, "../public");
const read = (p) => fs.readFileSync(path.join(pub, p), "utf8");
const appHtml = read("app.html"), indexHtml = read("index.html");
const shared = read("js/shared.js"), appJs = read("js/app.js"), homeJs = read("js/home.js");
const sharedCss = read("css/shared.css"), homeCss = read("css/home.css");

describe("command palette", () => {
  it("the keyboard-shortcuts modal is gone from the app", () => {
    expect(appHtml).not.toMatch(/shortcutsModal|toggleShortcuts|closeShortcuts/);
    expect(appJs).not.toMatch(/toggleShortcuts|closeShortcuts|shortcutsModal/);
    expect(read("css/app.css")).not.toMatch(/shortcut-row|shortcuts-box/);
  });
  it("both pages have a nav button that opens it (no inline handler needed)", () => {
    for (const html of [appHtml, indexHtml]) expect(html).toMatch(/class="cmdk-btn"[^>]*data-cmdk-open/);
  });
  it("shared.js exposes the engine; each page registers its own commands", () => {
    expect(shared).toMatch(/window\.CryptexPalette\s*=/);
    expect(appJs).toMatch(/CryptexPalette[\s\S]*register\(\{commands,dynamic,onOpen\}\)/);
    expect(homeJs).toMatch(/P\.register\(\{commands,dynamic\}\)/);
  });
  it("Esc is handled in the capture phase so it closes the palette before any dialog", () => {
    expect(shared).toMatch(/stopImmediatePropagation\(\)/);
    expect(shared).toMatch(/,true\);\s*document\.addEventListener\('click'/);
  });
  it("focus is never left parked in the hidden field (single-key hotkeys ignore inputs)", () => {
    expect(shared).toMatch(/activeElement===input\)input\.blur\(\)/);
  });
  it("user-controlled text is escaped before it reaches innerHTML", () => {
    expect(shared).toMatch(/const esc=/);
    expect(shared).toMatch(/hl\(c\.label,tokens\)/);   // labels (file names!) go through hl(), which escapes
    expect(shared).not.toMatch(/innerHTML\s*=\s*[^;]*c\.label(?!,)/);
  });
  it("its CSS only moves transform/opacity", () => {
    const block = sharedCss.slice(sharedCss.indexOf("Command palette"));
    expect(block).not.toMatch(/@keyframes/);
    expect(block).not.toMatch(/transition:[^;}]*(width|height|top|left|margin)\b/);
  });
});

describe("feature hover + encryption flow animation", () => {
  const frames = (css) => {
    const out = {}; const re = /@keyframes\s+([\w-]+)\s*\{/g; let m;
    while ((m = re.exec(css))) {
      let d = 1, i = re.lastIndex;
      while (i < css.length && d) { if (css[i] === "{") d++; else if (css[i] === "}") d--; i++; }
      out[m[1]] = [...new Set([...css.slice(re.lastIndex, i - 1).matchAll(/([a-z-]+)\s*:[^;{}]+(?=[;}]|$)/gi)].map((x) => x[1].toLowerCase()))];
    }
    return out;
  };
  const enc = Object.entries(frames(homeCss)).filter(([n]) => /^enc/.test(n));
  it("finds the encryption keyframes", () => {
    expect(enc.map(([n]) => n)).toEqual(expect.arrayContaining(["encPacket", "encStepOn", "encScan", "encCipher", "encPlain", "encShip", "encLane"]));
  });
  for (const [name, props] of enc) {
    it(`@keyframes ${name} animates only transform/opacity`, () => {
      expect(props.filter((p) => !["transform", "opacity"].includes(p))).toEqual([]);
    });
  }
  it("feature rows no longer slide sideways on hover", () => {
    expect(homeCss).not.toMatch(/\.feat-row:hover>\*\{transform:translate3d\(\d+px,0,0\)/);
  });
  it("the encryption loops pause off-screen like the other scenes", () => {
    expect(homeCss).toMatch(/\.js \.enc-steps:not\(\.is-playing\)[^{]*\{[^}]*animation-play-state:paused/);
    expect(homeJs).toMatch(/watchScene\(document\.getElementById\('encSteps'\)\)/);
  });
  it("reduced motion shows the finished state instead of nothing", () => {
    const rm = homeCss.slice(homeCss.lastIndexOf("@media(prefers-reduced-motion:reduce){", homeCss.indexOf(".ev-cipher{animation:none;opacity:1}")));
    expect(rm).toMatch(/\.ev-cipher\{animation:none;opacity:1\}/);
    expect(rm).toMatch(/\.ev-lane\{animation:none;opacity:1\}/);
  });
});
