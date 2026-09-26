import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url)),
  types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css",
    ".mjs": "text/javascript",
    ".js": "text/javascript",
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json",
  };
http
  .createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(
          new URL(req.url, "http://localhost").pathname,
        ),
        file = path.resolve(
          root,
          "." + (pathname === "/" ? "/index.html" : pathname),
        );
      if (!file.startsWith(root + path.sep)) throw new Error("invalid path");
      const content = await fs.readFile(file);
      res.writeHead(200, {
        "content-type": types[path.extname(file)] || "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(4173, "127.0.0.1", () =>
    console.log("ParkCaddy http://127.0.0.1:4173"),
  );
