import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import swaggerUi from "swagger-ui-express";
import connectDB from "./config/database.js";
import fileUploadRoutes from "./routes/FileUpload.js";
import folderRoutes     from "./routes/folder.js";
import File from "./models/File.js";
import Folder from "./models/Folder.js";
import supabase from "./config/supabase.js";
import { purgeExpiredPrivateFiles } from "./utils/purgeExpired.js";

const require = createRequire(import.meta.url);
const openapiSpec = require("./openapi.json");

dotenv.config();

const app  = express();
app.disable("x-powered-by"); // don't advertise the framework
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

connectDB();

// Behind a reverse proxy / PaaS (Render, Heroku, nginx, Cloudflare...) every
// request arrives from the proxy's IP, so every per-IP rate limit in this app
// would silently become ONE shared bucket for all visitors — one noisy client
// could lock everyone else out, and the limits would mean nothing per-person.
// Set TRUST_PROXY to the number of proxy hops in front of the app (almost
// always 1 on a PaaS) so req.ip reflects the real client. Left unset by
// default on purpose: trusting X-Forwarded-For when there ISN'T a proxy lets
// any client spoof its IP and sidestep the limiters entirely.
if (process.env.TRUST_PROXY) {
  const hops = Number(process.env.TRUST_PROXY);
  app.set("trust proxy", Number.isNaN(hops) ? process.env.TRUST_PROXY : hops);
}

app.use(express.json());

// ── Security headers & CORS ─────────────────────────────────────────────────
// CORS is intentionally restrictive: the frontend is served same-origin via
// express.static below, so the API needs zero cross-origin access for normal
// operation. Set ALLOWED_ORIGIN in .env only if you split frontend/backend
// across different domains in the future — until then, this stays locked down.
app.use((req, res, next) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Share-Token, X-Source-Token, X-File-Token");
  }
  // Clickjacking protection — this app has no legitimate reason to ever be framed.
  res.setHeader("X-Frame-Options", "DENY");
  // No <base>/forms are used, so pinning them costs nothing and removes two
  // injection pivots. (A full script-src policy needs the inline handlers gone.)
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
  // Stops browsers from "sniffing" a file's real content and overriding the
  // Content-Type we declare — relevant since uploaded-file MIME types
  // ultimately come from the client at upload time.
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Share links carry their token in the URL (?token=...) — never let that
  // leak to another site via the Referer header when someone follows a link
  // out of the app (e.g. a saved link's preview card).
  res.setHeader("Referrer-Policy", "no-referrer");
  // Tells browsers to only ever use HTTPS for this site once they've seen it
  // over HTTPS (ignored over plain http://, so harmless in local dev).
  res.setHeader("Strict-Transport-Security", "max-age=15552000");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── Static frontend ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

// ── API Routes ─────────────────────────────────────────────────────────────
app.use("/api/files",   fileUploadRoutes);
app.use("/api/folders", folderRoutes);
// (The old server-side /api/qr route is gone: QR codes are generated in the
// browser, and a route that received share links — encryption key included —
// had no reason to exist.)

// ── API docs ───────────────────────────────────────────────────────────────
// On by default; set DISABLE_API_DOCS=true to stop serving the Swagger UI in
// production if you'd rather not publish your route map.
if (process.env.DISABLE_API_DOCS !== "true") {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));
}

// ── Pages ──────────────────────────────────────────────────────────────────
// Two-page site: "/" is the marketing homepage, "/app" is the actual file
// manager. express.static above already serves /css/*, /js/*, and would even
// serve /app.html directly — these two routes just give clean URLs for the
// pages people actually type/bookmark/link to.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.get("/app", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app.html"));
});

// ── 404 ────────────────────────────────────────────────────────────────────
// Catches anything that didn't match a static file, an API route, or one of
// the two page routes above. Uses app.use() with no path argument rather
// than a wildcard string — Express 5's stricter path-to-regexp rejects the
// old bare "*" syntax, but a path-less middleware works identically on both
// Express 4 and 5 since it isn't doing pattern matching at all.
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
});

// Last-resort error handler: JSON, never an HTML stack trace, never internals.
// (Catches things that happen before a controller — e.g. a malformed JSON body.)
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err?.type === "entity.parse.failed") return res.status(400).json({ message: "Invalid JSON body" });
  if (err?.type === "entity.too.large") return res.status(413).json({ message: "Request body too large" });
  console.error(err);
  res.status(500).json({ message: "Something went wrong — please try again" });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);

  // Opt-in: delete private files whose token expired more than N days ago.
  // Does nothing unless PURGE_EXPIRED_AFTER_DAYS is set to a positive number.
  const purgeDays = Number(process.env.PURGE_EXPIRED_AFTER_DAYS);
  if (purgeDays > 0) {
    const run = () =>
      purgeExpiredPrivateFiles({
        File, Folder, supabase, bucket: process.env.SUPABASE_BUCKET || "cloudvault-files", olderThanDays: purgeDays,
      })
        .then((r) => { if (r.purged || r.failed) console.log(`🧹 Expired-file purge: ${r.purged} removed, ${r.failed} failed`); })
        .catch((e) => console.warn(`Expired-file purge error: ${e.message}`));
    setTimeout(run, 60_000).unref();            // let the DB connection settle first
    setInterval(run, 6 * 60 * 60 * 1000).unref();
  }
});
