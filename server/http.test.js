import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import app from './app.js';

let server; let baseUrl;
before(async () => {
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); });

test('malformed JSON produces a safe JSON error and leaves the API healthy', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":"private-input"' });
  assert.equal(response.status, 400); assert.deepEqual(await response.json(), { message: 'Invalid JSON request body' });
  assert.equal((await fetch(`${baseUrl}/api/health`)).status, 200);
});

test('the JSON body limit and unsupported encodings fail with appropriate statuses', async () => {
  const large = await fetch(`${baseUrl}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x'.repeat(110 * 1024) }) });
  assert.equal(large.status, 413); assert.deepEqual(Object.keys(await large.json()), ['message']);
  const encoding = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'unsupported' }, body: '{}' });
  assert.equal(encoding.status, 415); assert.deepEqual(Object.keys(await encoding.json()), ['message']);
});

for (const encoding of ['gzip', 'deflate']) {
  test(`trailing bytes after a ${encoding} request cannot terminate the API process`, async () => {
    // Isolate the server: an uncaught decompressor error must fail this assertion,
    // rather than crash this file's test runner before it can report the regression.
    const source = `
      import app from ${JSON.stringify(new URL('./app.js', import.meta.url).href)};
      import http from 'node:http';
      import { gzipSync, deflateSync } from 'node:zlib';
      import { once } from 'node:events';
      const server = app.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const bytes = Buffer.concat([
        ${encoding === 'gzip' ? 'gzipSync' : 'deflateSync'}(Buffer.from('{}')),
        Buffer.from([0]), Buffer.alloc(100 * 1024, 0x58),
      ]);
      await new Promise((resolve, reject) => {
        const request = http.request({
          hostname: '127.0.0.1', port: server.address().port, path: '/not-a-route', method: 'POST', agent: false,
          headers: { 'Content-Type': 'application/json', 'Content-Encoding': '${encoding}', 'Content-Length': bytes.length },
        }, (response) => { response.resume(); response.once('end', resolve); response.once('error', reject); });
        request.once('error', reject);
        request.setTimeout(2000, () => request.destroy(new Error('Request timed out')));
        request.end(bytes);
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      const health = await fetch('http://127.0.0.1:' + server.address().port + '/api/health');
      if (health.status !== 200) throw new Error('API stopped responding');
      await health.arrayBuffer();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    `;
    const child = spawn(process.execPath, ['--input-type=module', '--eval', source], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      const [code, signal] = await once(child, 'exit');
      assert.equal(code, 0, `API process failed (${signal || code}): ${stderr}`);
    } finally { clearTimeout(timeout); }
  });
}
