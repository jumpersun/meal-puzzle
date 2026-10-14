import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker } from '../worker/index.js';

const worker = createWorker({
  '/index.html': { type: 'text/html; charset=utf-8', body: '<html><script type="module" src="./live.js"></script></html>' },
  '/demo.html': { type: 'text/html', body: '<html><script type="module" src="./app.js"></script></html>' },
  '/live.js': { type: 'text/javascript', body: 'export {};' },
});
const get = (path = '/', method = 'GET') => worker.fetch(new Request(`https://site.test${path}`, { method }), {});

test('HTML advertises a fresh nonce for the CDN-injected detection script without permitting arbitrary inline code', async () => {
  const seen = new Set();
  for (const path of ['/', '/', '/demo.html']) {
    const response = await get(path), body = await response.text();
    const csp = response.headers.get('Content-Security-Policy');
    const scriptPolicy = csp.split(';').find(part => part.trim().startsWith('script-src ')).trim();
    const nonce = scriptPolicy.match(/'nonce-([A-Za-z0-9+/]{22}==)'/)?.[1];
    assert.ok(nonce, 'Cloudflare detection needs a nonce in the CSP response header');
    assert.equal(Buffer.from(nonce, 'base64').length, 16);
    assert.ok(!seen.has(nonce), 'never reuse an HTML nonce'); seen.add(nonce);
    assert.equal(scriptPolicy, `script-src 'self' 'nonce-${nonce}'`);
    assert.match(body, new RegExp(`<script nonce="${nonce.replace(/[+]/g, '\\+')}" type="module"`));
    assert.match(response.headers.get('Cache-Control'), /no-store/);
    assert.match(csp, /connect-src 'self'; base-uri 'self'; form-action 'self'/);
  }
});

test('non-HTML assets stay byte-identical; HEAD stays bodyless', async () => {
  const asset = await get('/live.js');
  assert.equal(await asset.text(), 'export {};');
  assert.doesNotMatch(asset.headers.get('Content-Security-Policy'), /nonce-/);
  const head = await get('/', 'HEAD');
  assert.equal(await head.text(), '');
  assert.match(head.headers.get('Content-Security-Policy'), /'nonce-/);
});
