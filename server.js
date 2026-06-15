/**
 * server.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Minimal static HTTP server for the Password Strength Analyzer.
 * Zero dependencies — uses only Node.js built-in modules.
 *
 * Usage:  node server.js
 *         node server.js 3000   (custom port)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const http = require("http");
const fs   = require("fs");
const path = require("path");
const url  = require("url");

const PORT    = parseInt(process.argv[2], 10) || 5500;
const ROOT    = __dirname;  // serve from this directory

/** Map file extensions to MIME types */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico":  "image/x-icon",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".svg":  "image/svg+xml",
  ".zip":  "application/zip",
  ".woff2":"font/woff2",
  ".woff": "font/woff",
  ".ttf":  "font/ttf",
};

const server = http.createServer((req, res) => {
  // Parse the request URL
  let pathname = url.parse(req.url).pathname;

  // Redirect root to /app/index.html so relative paths work correctly
  if (pathname === "/") {
    res.writeHead(302, { "Location": "/app/index.html" });
    return res.end();
  }

  // Resolve to an absolute path and make sure it stays within ROOT
  const absPath = path.normalize(path.join(ROOT, pathname));
  if (!absPath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  // Read and serve the file
  fs.readFile(absPath, (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end(`404 Not Found: ${pathname}`);
      }
      res.writeHead(500);
      return res.end("Internal Server Error");
    }

    const ext  = path.extname(absPath).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type":  mime,
      // Allow ES module imports from the same origin
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  const addr = `http://localhost:${PORT}`;
  console.log("");
  console.log("  ╔══════════════════════════════════════════╗");
  console.log("  ║        PassGuard — Local Server          ║");
  console.log("  ╠══════════════════════════════════════════╣");
  console.log(`  ║  Running at: ${addr.padEnd(28)}║`);
  console.log("  ║  Press Ctrl+C to stop.                   ║");
  console.log("  ╚══════════════════════════════════════════╝");
  console.log("");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n   Port ${PORT} is already in use. Try: node server.js ${PORT + 1}\n`);
  } else {
    console.error("\n   Server error:", err.message, "\n");
  }
  process.exit(1);
});
