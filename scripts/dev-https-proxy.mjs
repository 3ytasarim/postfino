// Local development only: HTTPS front for the API so networks that require an HTTPS redirect URI (Meta) can send the
// browser back to this machine: https://puffer.127.0.0.1.nip.io (443) and https://localhost:3612 → http://localhost:3611.
// Meta rejects "localhost" redirect URIs, so a nip.io name is used: public wildcard DNS that resolves to 127.0.0.1,
// i.e. the browser still talks only to this machine. Self-signed certificate (.data/dev-cert, generated once with
// openssl) covers both names. Nothing is exposed to the internet.
import https from "node:https";
import http from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const DEV_HOST = process.env.DEV_HOST ?? "puffer.127.0.0.1.nip.io";
const dir = path.resolve(".data/dev-cert");
const key = path.join(dir, `${DEV_HOST}-key.pem`);
const cert = path.join(dir, `${DEV_HOST}.pem`);
if (!existsSync(key) || !existsSync(cert)) {
  mkdirSync(dir, { recursive: true });
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "825", "-subj", `/CN=${DEV_HOST}`, "-addext", `subjectAltName=DNS:${DEV_HOST},DNS:localhost,IP:127.0.0.1`], {
    stdio: "ignore",
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
  });
}

const target = { host: "127.0.0.1", port: Number(process.env.API_PORT ?? 3611) };
const ports = (process.env.HTTPS_PORTS ?? "443,3612").split(",").map(Number);
const tls = { key: readFileSync(key), cert: readFileSync(cert) };

/** Pipes the request to the plain-HTTP API and streams the response back. */
function handler(req, res) {
  const up = http.request({ ...target, method: req.method, path: req.url, headers: { ...req.headers, host: `localhost:${target.port}`, "x-forwarded-proto": "https" } }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on("error", () => {
    res.writeHead(502);
    res.end("API not reachable");
  });
  req.pipe(up);
}

for (const port of ports)
  https
    .createServer(tls, handler)
    .on("error", (e) => console.error(`port ${port}: ${e.code}`))
    .listen(port, "127.0.0.1", () => console.log(`HTTPS dev proxy: https://${DEV_HOST}${port === 443 ? "" : `:${port}`} -> http://${target.host}:${target.port}`));
