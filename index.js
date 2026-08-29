import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import swaggerUi from "swagger-ui-express";
import connectDB from "./config/database.js";
import fileUploadRoutes from "./routes/FileUpload.js";
import folderRoutes     from "./routes/folder.js";
import { generateQr }   from "./controllers/qrController.js";

const require = createRequire(import.meta.url);
const openapiSpec = require("./openapi.json");

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

connectDB();

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
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  // Clickjacking protection — this app has no legitimate reason to ever be framed.
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'");
  // Stops browsers from "sniffing" a file's real content and overriding the
  // Content-Type we declare — relevant since uploaded-file MIME types
  // ultimately come from the client at upload time.
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── Static frontend ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

// ── API Routes ─────────────────────────────────────────────────────────────
app.use("/api/files",   fileUploadRoutes);
app.use("/api/folders", folderRoutes);
app.get("/api/qr",      generateQr);

// ── API docs ───────────────────────────────────────────────────────────────
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));

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

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
