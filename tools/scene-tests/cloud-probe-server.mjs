import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const output = path.resolve(process.env.CLOUD_PROBE_RUN_DIR ?? 'artifacts/cloud-feasibility/manual', 'build');
if (!process.env.CLOUD_PROBE_BUILD_DIR) {
  const build = spawnSync(process.execPath, ['node_modules/@angular/cli/bin/ng.js', 'build', 'demo-app', '--configuration', 'development', '--source-map=false', '--output-path', output], { stdio: 'inherit', windowsHide: true });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const root = process.env.CLOUD_PROBE_BUILD_DIR ? path.resolve(process.env.CLOUD_PROBE_BUILD_DIR) : path.join(output, 'browser');
if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('Built demo index.html missing');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400).end(); return; }
  if (pathname === '/__cloud-probe-load') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end('<!doctype html><title>Bounded GPU load</title><body></body>');
    return;
  }
  let file = path.resolve(root, `.${pathname}`);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  if (!path.extname(file) || file === root) file = path.join(root, 'index.html');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
server.listen(Number(process.env.CLOUD_PROBE_PORT ?? 4233), '127.0.0.1', () => {
  fs.writeFileSync(path.resolve(process.env.CLOUD_PROBE_RUN_DIR ?? 'artifacts/cloud-feasibility/manual', 'server.json'), JSON.stringify({ pid: process.pid, port: server.address().port, root }, null, 2));
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
