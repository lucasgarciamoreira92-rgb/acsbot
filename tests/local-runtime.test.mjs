import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

async function freePort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve)); return port;
}

test('local panel: HTTP boundaries, encrypted persistence and restart', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'acs-local-http-'));
  const port = await freePort(), origin = `http://127.0.0.1:${port}`;
  let child, cookie;
  async function start() {
    child = spawn(process.execPath, ['local/server.mjs'], { env: { ...process.env, ACS_PORT: String(port), ACS_DATA_DIR: directory, ACS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      let output = '', errors = '';
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Server did not start: ' + errors)); }, 10000);
      child.stderr.on('data', b => { errors += b; });
      child.stdout.on('data', b => { output += b; if (output.includes('ACS Pilot em execução:')) { clearTimeout(timeout); resolve(); } });
      child.once('exit', code => { clearTimeout(timeout); if (!output.includes('ACS Pilot em execução:')) reject(new Error('Startup failed: ' + code + ' ' + errors)); });
    });
    const entry = await fetch(origin);
    assert.equal(entry.status, 200);
    assert.match(await entry.text(), /ACS Pilot/);
    cookie = entry.headers.get('set-cookie').split(';')[0];
  }
  async function stop() { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  const request = (url, options = {}) => fetch(origin + url, { ...options, headers: { cookie, origin, 'content-type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(5000) });
  try {
    await start();
    await t.test('serves the built panel and rejects unauthenticated, forged and cross-origin API requests', async () => {
      assert.equal((await fetch(origin + '/api/state', { headers: { 'oai-authenticated-user-id': 'forged' } })).status, 401);
      assert.equal((await request('/api/state', { headers: { origin: 'https://outside.example' } })).status, 403);
      const wrongHost = await new Promise((resolve, reject) => {
        const req = http.get(origin + '/api/state', { headers: { host: 'outside.example', cookie } }, response => { response.resume(); resolve(response.statusCode); });
        req.on('error', reject);
      });
      assert.equal(wrongHost, 403);
      assert.equal((await request('/api/state', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
      assert.equal((await request('/local/server.mjs')).status, 404);
      assert.equal((await request('/.acs-local/data/vault.key')).status, 404);
    });
    let state, keyBefore, oldCookie;
    await t.test('saves operational credentials encrypted and rejects stale edits', async () => {
      const response = await request('/api/state'); assert.equal(response.status, 200);
      state = await response.json(); assert.equal(state.revision, 1);
      state.state.groups[0].name = 'Operação local persistente';
      state.state.groups[0].entries.push({ id: 'local-cred', label: 'Credencial local', username: 'local-operator', password: 'local-secret-example' });
      assert.equal((await request('/api/state', { method: 'PUT', body: JSON.stringify(state) })).status, 200);
      assert.equal((await request('/api/state', { method: 'PUT', body: JSON.stringify(state) })).status, 409);
      const db = new DatabaseSync(path.join(directory, 'acsbot.sqlite'), { readOnly: true });
      try {
        const raw = db.prepare('SELECT owner, encrypted FROM workspaces').get();
        assert.equal(raw.owner, 'local-operator');
        assert.ok(!raw.encrypted.includes('local-secret-example'));
      } finally { db.close(); }
      keyBefore = await readFile(path.join(directory, 'vault.key'), 'utf8');
      assert.equal((await stat(path.join(directory, 'vault.key'))).mode & 0o777, 0o600);
      oldCookie = cookie;
    });
    await t.test('reopens the same database and key after a restart, with a fresh browser session', async () => {
      await stop(); await start();
      const current = await (await request('/api/state')).json();
      assert.equal(current.revision, 2);
      assert.equal(current.state.groups[0].name, 'Operação local persistente');
      assert.equal(current.state.groups[0].entries[0].password, '');
      assert.equal(current.state.groups[0].entries[0].hasPassword, true);
      assert.equal(await readFile(path.join(directory, 'vault.key'), 'utf8'), keyBefore);
      assert.equal((await request('/api/state', { headers: { cookie: oldCookie } })).status, 401);
      assert.equal((await request('/api/jobs')).status, 200);
      assert.equal((await request('/api/jobs', { method: 'POST', body: JSON.stringify({ name: 'Exemplo', mode: 'validate', deviceIds: [current.state.devices[0].id] }) })).status, 400);
    });
  } finally { if (child && child.exitCode === null && !child.killed) await stop(); await rm(directory, { recursive: true, force: true }); }
});
