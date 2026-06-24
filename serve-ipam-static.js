const fs = require("fs");
const http = require("http");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 8082);
const indexFile = path.join(root, ".next", "server", "app", "index.html");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function sendFile(response, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
    response.end(data);
  });
}

function resolveRequest(url) {
  const requestPath = decodeURIComponent(new URL(url, `http://127.0.0.1:${port}`).pathname);
  if (requestPath === "/" || requestPath === "") {
    return indexFile;
  }
  if (requestPath.startsWith("/_next/static/")) {
    return path.join(root, ".next", "static", requestPath.replace("/_next/static/", ""));
  }
  const publicPath = path.join(root, "public", requestPath.replace(/^\/+/, ""));
  if (fs.existsSync(publicPath) && fs.statSync(publicPath).isFile()) {
    return publicPath;
  }
  return indexFile;
}

http.createServer((request, response) => {
  if (!["GET", "HEAD"].includes(request.method || "")) {
    response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Method not allowed");
    return;
  }
  sendFile(response, resolveRequest(request.url || "/"));
}).listen(port, "127.0.0.1", () => {
  console.log(`IPAM static UI running at http://127.0.0.1:${port}`);
});
