// Minimal static server for Playwright e2e — mirrors the vercel.json rewrites.
// API routes are not served here; tests stub them with page.route().
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT || 8788);
const ROOT = process.cwd();
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
const REWRITES = {
  "/": "/index.html",
  "/translate-powerpoint": "/translate-powerpoint.html",
  "/translate-word": "/translate-word.html",
};

http
  .createServer(async (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    pathname = REWRITES[pathname] || pathname;
    const filePath = normalize(join(ROOT, pathname));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const data = await readFile(filePath);
      res.writeHead(200, { "Content-Type": TYPES[extname(filePath)] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
    }
  })
  .listen(PORT, () => console.log(`static server on http://localhost:${PORT}`));
