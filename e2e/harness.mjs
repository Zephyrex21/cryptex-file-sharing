// End-to-end harness: the REAL public/app.html + public/js/*.js running in jsdom,
// talking to an in-memory fake API. The fake API is deliberately thin: every
// authorization decision goes through the project's REAL middleware/auth.js
// functions and the REAL token generator — so if the UI ever sends a request the
// real server would reject (a missing token, say), this fake rejects it too.
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");

export const PROJECT = process.env.PROJECT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const auth = await import(pathToFileURL(path.join(PROJECT, "middleware/auth.js")));
const { generateToken } = await import(pathToFileURL(path.join(PROJECT, "utils/token.js")));

// ── in-memory "database" ────────────────────────────────────────────────────
export const db = { files: new Map(), folders: new Map(), seq: 0, log: [] };
const oid = () => (++db.seq).toString(16).padStart(24, "0");

export const mkFile = (o = {}) => {
  const f = {
    _id: oid(), originalName: "photo.png", fileType: "image/png", fileUrl: "https://storage.test/photo.png",
    fileSize: 1234, visibility: "public", shareToken: generateToken(), tokenExpiresAt: null, maxViews: null,
    viewCount: 0, encrypted: false, folderId: null, createdAt: new Date().toISOString(), ...o,
  };
  db.files.set(f._id, f);
  return f;
};
export const mkFolder = (o = {}) => {
  const f = {
    _id: oid(), name: "Folder", visibility: "public", shareToken: generateToken(), tokenExpiresAt: null,
    maxViews: null, viewCount: 0, encrypted: false, files: [], createdAt: new Date().toISOString(), ...o,
  };
  db.folders.set(f._id, f);
  return f;
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const folderView = (f) => ({ ...clone(f), files: f.files.map((id) => db.files.get(id)).filter(Boolean).map(clone), fileCount: f.files.length });

// ── fake HTTP layer ─────────────────────────────────────────────────────────
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Map() });

async function route(method, urlStr, init = {}) {
  const url = new URL(urlStr, "http://localhost:3000");
  const p = url.pathname.replace(/^\/api/, "");
  const req = {
    query: Object.fromEntries(url.searchParams), headers: {}, params: {},
    body: init.body ? JSON.parse(init.body) : {},
  };
  db.log.push(`${method} ${url.pathname}${url.search}`);
  let m;

  // ---- files ----
  if (method === "GET" && p === "/files") {
    const privFolders = new Set([...db.folders.values()].filter((f) => f.visibility === "private").map((f) => f._id));
    return json(200, { files: [...db.files.values()].filter((f) => f.visibility !== "private" && !privFolders.has(f.folderId)).map(clone) });
  }
  if (method === "GET" && (m = p.match(/^\/files\/token\/([^/]+)$/))) {
    const f = [...db.files.values()].find((x) => x.shareToken === decodeURIComponent(m[1]) && x.visibility === "private");
    if (!f) return json(404, { message: "Invalid token — file not found" });
    if (f.tokenExpiresAt && new Date(f.tokenExpiresAt) < new Date()) return json(410, { message: "This token has expired" });
    return json(200, { file: clone(f) });
  }
  if ((m = p.match(/^\/files\/([^/]+)(\/visibility|\/download|\/preview)?$/))) {
    const f = db.files.get(m[1]);
    if (!f) return json(404, { message: "Not found" });
    const sub = m[2];
    if (method === "GET") {
      if (!auth.canAccessFile(req, f)) return json(403, { message: "private" });
      return json(200, { file: clone(f) });
    }
    if (method === "PATCH" && sub === "/visibility") {
      if (!auth.canMutateFile(req, f)) return json(403, { message: "private" });
      const { visibility, expiresIn, maxViews, regenerateToken } = req.body;
      if (visibility === "public") {
        if (f.encrypted) return json(400, { message: "Encrypted files must stay private" });
        Object.assign(f, { visibility: "public", tokenExpiresAt: null, maxViews: null, viewCount: 0 });
      } else {
        f.visibility = "private";
        if (regenerateToken) { f.shareToken = generateToken(); f.viewCount = 0; }
        if (expiresIn !== undefined) f.tokenExpiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 60000).toISOString() : null;
        if (maxViews !== undefined) { f.maxViews = maxViews > 0 ? maxViews : null; f.viewCount = 0; }
      }
      return json(200, { file: clone(f) });
    }
    if (method === "PATCH") {
      if (!auth.canMutateFile(req, f)) return json(403, { message: "private" });
      f.originalName = req.body.name;
      return json(200, { file: clone(f) });
    }
    if (method === "DELETE") {
      if (!auth.canMutateFile(req, f)) return json(403, { message: "private" });
      if (f.folderId && db.folders.get(f.folderId)) { const fo = db.folders.get(f.folderId); fo.files = fo.files.filter((i) => i !== f._id); }
      db.files.delete(f._id);
      return json(200, { message: "Deleted!" });
    }
  }

  // ---- folders ----
  if (method === "GET" && p === "/folders") {
    return json(200, { folders: [...db.folders.values()].filter((f) => f.visibility !== "private").map(folderView) });
  }
  if (method === "POST" && p === "/folders") {
    const f = mkFolder({ name: req.body.name, encrypted: !!req.body.encrypted, visibility: req.body.encrypted ? "private" : "public" });
    return json(201, { folder: folderView(f) });
  }
  if (method === "GET" && (m = p.match(/^\/folders\/token\/([^/]+)$/))) {
    const f = [...db.folders.values()].find((x) => x.shareToken === decodeURIComponent(m[1]) && x.visibility === "private");
    if (!f) return json(404, { message: "Invalid token — folder not found" });
    return json(200, { folder: folderView(f) });
  }
  if ((m = p.match(/^\/folders\/([^/]+)(\/visibility|\/files(?:\/([^/]+))?|\/zip)?$/))) {
    const folder = db.folders.get(m[1]);
    if (!folder) return json(404, { message: "Folder not found" });
    const sub = m[2] || "";
    if (method === "GET" && sub === "") {
      if (!auth.canAccessFolder(req, folder)) return json(403, { message: "private folder" });
      return json(200, { folder: folderView(folder) });
    }
    if (method === "PATCH" && sub === "/visibility") {
      if (!auth.canAccessFolder(req, folder)) return json(403, { message: "private folder" });
      const { visibility, regenerateToken, expiresIn, maxViews } = req.body;
      if (visibility === "public") Object.assign(folder, { visibility: "public", tokenExpiresAt: null, maxViews: null });
      else {
        folder.visibility = "private";
        if (regenerateToken) folder.shareToken = generateToken();
        if (expiresIn !== undefined) folder.tokenExpiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 60000).toISOString() : null;
        if (maxViews !== undefined) folder.maxViews = maxViews > 0 ? maxViews : null;
      }
      return json(200, { folder: folderView(folder) });
    }
    if (method === "PATCH" && sub === "") {
      if (!auth.canAccessFolder(req, folder)) return json(403, { message: "private folder" });
      folder.name = req.body.name;
      return json(200, { folder: folderView(folder) });
    }
    if (method === "DELETE" && sub === "") {
      if (!auth.canAccessFolder(req, folder)) return json(403, { message: "private folder" });
      folder.files.forEach((id) => { const f = db.files.get(id); if (f) f.folderId = null; });
      db.folders.delete(folder._id);
      return json(200, { message: "Folder deleted!" });
    }
    if (method === "POST" && sub === "/files") {
      const file = db.files.get(req.body.fileId);
      if (!file) return json(404, { message: "File not found" });
      if (!auth.canAccessFolder(req, folder)) return json(403, { message: "private folder" });
      if (!auth.canMutateFile(req, file)) return json(403, { message: "private file" });
      if (file.folderId && file.folderId !== folder._id) {
        const src = db.folders.get(file.folderId);
        if (src && !auth.canLeaveFolder(req, src)) return json(403, { message: "source folder private" });
        if (src) src.files = src.files.filter((i) => i !== file._id);
      }
      folder.files.push(file._id); file.folderId = folder._id;
      return json(200, { folder: folderView(folder) });
    }
    if (method === "DELETE" && sub.startsWith("/files/")) {
      const file = db.files.get(m[3]);
      if (!auth.canAccessFolder(req, folder)) return json(403, { message: "private folder" });
      folder.files = folder.files.filter((i) => i !== m[3]); if (file) file.folderId = null;
      return json(200, { folder: folderView(folder) });
    }
  }
  return json(404, { message: `fake API: no route for ${method} ${p}` });
}

// ── boot the real page ──────────────────────────────────────────────────────
export async function boot() {
  const pub = path.join(PROJECT, "public");
  let html = fs.readFileSync(path.join(pub, "app.html"), "utf8");
  html = html.replace(/<script src="[^"]+"><\/script>/g, ""); // we inject these ourselves below
  const dom = new JSDOM(html, { url: "http://localhost:3000/app", runScripts: "dangerously", pretendToBeVisual: true });
  const w = dom.window;
  const errors = [];
  w.addEventListener("error", (e) => errors.push(e.error?.stack || e.message));
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.URL.createObjectURL = () => "blob:fake";
  w.confirm = () => true;
  w.prompt = () => null;
  const clip = { text: "", writeText: async (t) => { clip.text = t; } };
  Object.defineProperty(w.navigator, "clipboard", { value: clip, configurable: true });
  w.fetch = (u, init = {}) => route((init.method || "GET").toUpperCase(), String(u), init);
  // The UI's 5s "undo" window would make delete scenarios slow — shrink any long timer.
  const realST = w.setTimeout.bind(w);
  w.setTimeout = (fn, ms, ...a) => realST(fn, ms >= 4000 ? 20 : ms, ...a);
  // jsdom lacks WebCrypto/TextEncoder; Node's are the real thing the browser provides.
  Object.defineProperty(w, "crypto", { value: require("crypto").webcrypto, configurable: true });
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;

  for (const f of ["js/vendor/qrcode.js", "js/shared.js", "js/app.js"]) {
    const s = w.document.createElement("script");
    s.textContent = fs.readFileSync(path.join(pub, f), "utf8");
    w.document.body.appendChild(s);
  }
  const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
  await tick(30);
  return { w, dom, errors, clip, tick, $: (sel) => w.document.querySelector(sel), $$: (sel) => [...w.document.querySelectorAll(sel)], ev: (code) => w.eval(code) };
}
