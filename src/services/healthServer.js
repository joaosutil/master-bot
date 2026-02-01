import http from "node:http";

export function startHealthServer() {
  const rawPort = process.env.PORT ?? process.env.HEALTH_PORT;
  const port = Number.parseInt(rawPort ?? "", 10);
  if (!Number.isFinite(port) || port <= 0) return null;

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/" || url === "/health" || url.startsWith("/health?")) {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`Health server listening on :${port}`);
  });

  return server;
}

