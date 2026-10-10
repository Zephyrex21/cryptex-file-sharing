import { describe, it, expect, vi } from "vitest";

// The routers import controllers → models/supabase; none of that is exercised
// here, only the middleware wiring, so stub the pieces that need a live env.
vi.mock("../config/supabase.js", () => ({ default: {} }));

const fileRouter = (await import("../routes/FileUpload.js")).default;
const folderRouter = (await import("../routes/folder.js")).default;

// express-rate-limit's middleware exposes resetKey(); nothing else in these
// stacks does — a reliable way to tell a limiter from a controller.
const isLimiter = (layer) => typeof layer.handle?.resetKey === "function";
const routesOf = (router) =>
  router.stack.filter((l) => l.route).map((l) => ({
    path: l.route.path,
    method: Object.keys(l.route.methods)[0].toUpperCase(),
    limited: l.route.stack.some(isLimiter),
  }));
const find = (routes, method, path) => routes.find((r) => r.method === method && r.path === path);

describe("every route that checks a private item's token is rate limited", () => {
  const files = routesOf(fileRouter);
  const folders = routesOf(folderRouter);

  const mustBeLimited = [
    [files, "GET", "/token/:token"],
    [files, "GET", "/:id"],          // was unlimited — an attacker could guess tokens here instead
    [files, "GET", "/:id/preview"],  // was unlimited
    [files, "GET", "/:id/download"], // was unlimited
    [files, "PATCH", "/:id"],
    [files, "PATCH", "/:id/visibility"],
    [files, "DELETE", "/:id"],
    [files, "POST", "/batch-zip"],   // was unlimited, and the most expensive route
    [folders, "GET", "/token/:token"],
    [folders, "GET", "/:id"],
    [folders, "GET", "/:id/zip"],    // was unlimited
    [folders, "PATCH", "/:id"],
    [folders, "PATCH", "/:id/visibility"],
    [folders, "DELETE", "/:id"],
    [folders, "POST", "/:id/files"],
    [folders, "DELETE", "/:id/files/:fileId"],
  ];

  it.each(mustBeLimited.map(([set, m, p]) => [set === files ? "files" : "folders", m, p, set]))(
    "%s %s %s",
    (_label, method, path, set) => {
      const r = find(set, method, path);
      expect(r, `route ${method} ${path} should exist`).toBeTruthy();
      expect(r.limited, `${method} ${path} must have a rate limiter`).toBe(true);
    }
  );
});
