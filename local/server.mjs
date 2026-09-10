import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { openDatabase } from './database.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.ACS_PORT || 8787);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('ACS_PORT deve ser uma porta entre 1024 e 65535.');
const host = `127.0.0.1:${port}`;
const origin = `http://${host}`;
const client = path.join(project, '.acs-local/build/client');
await readFile(path.join(client, 'index.html')); // Fail before creating a database if there is no build.
const storage = await openDatabase(path.resolve(process.env.ACS_DATA_DIR || path.join(project, '.acs-local/data')), project);
globalThis.__acsLocalBindings = { DB: storage.db, VAULT_KEY: storage.key, APP_ORIGIN: origin };
const routes = {};
for (const name of ['state', 'jobs', 'results']) routes[`/api/${name}`] = await import(pathToFileURL(path.join(project, '.acs-local/build/server', name + '.mjs')).href);
const token = randomBytes(32).toString('hex');
const cookieName = `acs_local_${port}`;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.zip': 'application/zip', '.json': 'application/json' };
let pending = Promise.resolve();
function respond(res, status, data, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', ...headers });
  res.end(data);
}
function authenticated(req) {
  const cookies = (req.headers.cookie || '').split(';').map(x => x.trim());
  const value = cookies.find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || '';
  return /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
}
async function dispatch(req, res) {
  if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== origin) || ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) return respond(res, 403, 'Origem local inválida.');
  const url = new URL(req.url, origin);
  if (url.pathname === '/api/local/health' && req.method === 'GET') return respond(res, 200, JSON.stringify({ app: 'acsbot-local', status: 'ready' }), { 'Content-Type': 'application/json' });
  const isEntry = url.pathname === '/' && req.method === 'GET';
  if (!isEntry && !authenticated(req)) return respond(res, 401, 'Abra o painel local para iniciar a sessão.');
  if (url.pathname.startsWith('/api/')) {
    const route = routes[url.pathname];
    if (!route) return respond(res, 404, '{}', { 'Content-Type': 'application/json' });
    const handler = route[req.method];
    if (!handler) return respond(res, 405, '{}', { 'Content-Type': 'application/json' });
    const buffers = []; let size = 0;
    for await (const buffer of req) {
      size += buffer.length;
      if (size > 4_000_000) return respond(res, 413, JSON.stringify({ error: 'Arquivo grande demais.' }), { 'Content-Type': 'application/json' });
      buffers.push(buffer);
    }
    const headers = new Headers();
    // Local identity is created only here; caller-supplied proxy headers are ignored.
    headers.set('oai-authenticated-user-id', 'local-operator');
    if (req.headers.origin) headers.set('origin', req.headers.origin);
    if (req.headers['content-type']) headers.set('content-type', req.headers['content-type']);
    const request = new Request(url, { method: req.method, headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(buffers) }) });
    // One shared SQLite connection: serialize API work, including transaction awaits.
    const task = pending.then(() => handler(request));
    pending = task.then(() => {}, () => {});
    const result = await task;
    return respond(res, result.status, Buffer.from(await result.arrayBuffer()), Object.fromEntries(result.headers));
  }
  if (!['GET', 'HEAD'].includes(req.method)) return respond(res, 405, 'Método inválido.');
  let relative;
  try { relative = decodeURIComponent(url.pathname); } catch { return respond(res, 400, 'Caminho inválido.'); }
  const asset = isEntry ? path.join(client, 'index.html') : path.resolve(client, '.' + relative);
  if (!asset.startsWith(client + path.sep) || relative.includes('\\') || relative.includes('\0')) return respond(res, 404, 'Não encontrado.');
  try {
    const data = await readFile(asset);
    const headers = { 'Content-Type': mime[path.extname(asset)] || 'application/octet-stream' };
    if (isEntry) headers['Set-Cookie'] = `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict`;
    return respond(res, 200, req.method === 'HEAD' ? undefined : data, headers);
  } catch (error) { if (['ENOENT', 'EISDIR'].includes(error.code)) return respond(res, 404, 'Não encontrado.'); throw error; }
}
const server = http.createServer((req, res) => { dispatch(req, res).catch(error => { console.error('Solicitação local não concluída:', error.name); if (!res.headersSent) respond(res, 500, JSON.stringify({ error: 'Não foi possível concluir a solicitação local.' }), { 'Content-Type': 'application/json' }); else res.end(); }); });
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `A porta ${port} já está em uso. Feche a outra execução ou escolha ACS_PORT.` : error.message);
  storage.close(); process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`ACS Pilot em execução: ${origin}`);
  console.log('Cadastros salvos neste computador. Mantenha este Terminal aberto; Ctrl+C encerra.');
  if (process.platform === 'darwin' && process.env.ACS_NO_OPEN !== '1') {
    const opener = spawn('open', [origin], { stdio: 'ignore' }); opener.on('error', () => {});
  }
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (stopping) return; stopping = true;
  server.close(async () => { await pending; storage.close(); process.exit(0); });
  server.closeIdleConnections();
});
