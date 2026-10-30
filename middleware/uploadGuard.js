// Protects the process from upload abuse BEFORE multer buffers anything.
//
// Uploads are held fully in memory (multer.memoryStorage, up to 50 MB each), so
// N parallel uploads cost N × 50 MB of RAM — a handful of concurrent requests
// could OOM a small instance (e.g. Render's 512 MB) and take the whole app down.
// This (1) rejects a request whose declared size is already over the limit
// without reading its body, and (2) caps how many uploads are in flight at once,
// answering 503 + Retry-After instead of buffering more. The per-IP rate limiter
// stays in front of it; this is the global, memory-based backstop.
const BODY_OVERHEAD_BYTES = 1024 * 1024; // multipart boundaries + text fields

export const createUploadGuard = ({ maxConcurrent, maxFileBytes } = {}) => {
  let active = 0;
  const guard = (req, res, next) => {
    const limit = maxConcurrent ?? (Number(process.env.MAX_CONCURRENT_UPLOADS) || 4);
    const declared = Number(req.headers["content-length"]);
    if (maxFileBytes && declared > maxFileBytes + BODY_OVERHEAD_BYTES) {
      return res.status(413).json({ message: "Upload error: File too large" });
    }
    if (active >= limit) {
      res.setHeader("Retry-After", "5");
      return res.status(503).json({ message: "Server is busy with other uploads — please retry in a few seconds" });
    }
    active++;
    let released = false;
    const release = () => { if (!released) { released = true; active--; } };
    res.on("finish", release);
    res.on("close", release);
    next();
  };
  guard.inFlight = () => active;
  return guard;
};
