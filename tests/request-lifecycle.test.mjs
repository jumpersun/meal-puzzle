import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { ApiError, createApi, createMcpClient } from '../server/api.mjs';
import { createLocalServer } from '../server.mjs';

const env = { MCD_MCP_TOKEN: 'test-only' };
const codes = Array.from({ length: 7 }, (_, i) => String(100 + i));
const menu = {
  categories: [{ name: '餐品', meals: codes.map(code => ({ code })) }],
  meals: Object.fromEntries(codes.map(code => [code, { name: '麦辣鸡腿汉堡', currentPrice: '10.00' }])),
};
const item = (code, i) => ({ id: `l${i}`, code, quantity: 1, selections: [] });
const quoteInput = (items = [item(codes[0], 0)]) => ({ storeCode: '1450713', revision: 1, items });
const planInput = () => ({ storeCode: '1450713', revision: 1, people: [{ id: 'p1', wants: { chicken: 1 } }], budget: null });
const request = (route, body, signal) => new Request(`https://site.test/api/${route}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
});
const detail = code => ({ code, name: menu.meals[code].name, rounds: [] });
const quote = items => ({
  price: items.reduce((sum, line) => sum + line.quantity * 1000, 0),
  productList: items.map(line => ({ productCode: line.productCode, productName: '麦辣鸡腿汉堡', quantity: line.quantity, subtotal: line.quantity * 1000 })),
});
function untilAborted(signal, onAbort = () => {}) {
  return new Promise((resolve, reject) => {
    const abort = () => { onAbort(); reject(signal.reason); };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

test('MCP forwards request cancellation through the active RPC and starts no later RPC', async () => {
  const controller = new AbortController(), started = Promise.withResolvers(), calls = [];
  let rpcSignal;
  const client = await createMcpClient('test-only', async (_url, options) => {
    const body = JSON.parse(options.body); calls.push(body.method);
    if (body.method === 'initialize') return Response.json({ id: body.id, result: { protocolVersion: '2025-03-26' } });
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    rpcSignal = options.signal; started.resolve();
    return untilAborted(options.signal);
  }, { signal: controller.signal });
  const pending = client.call('query-meals', {});
  await started.promise; controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(rpcSignal.aborted, true);
  await assert.rejects(client.call('calculate-price', {}), { name: 'AbortError' });
  assert.deepEqual(calls, ['initialize', 'notifications/initialized', 'tools/call']);
});

test('cancelling while an MCP response is streaming stops reading and cancels its body', async () => {
  const controller = new AbortController(), reading = Promise.withResolvers();
  let cancelled = false;
  const client = await createMcpClient('test-only', async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.method === 'initialize') return Response.json({ id: body.id, result: { protocolVersion: '2025-03-26' } });
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    return new Response(new ReadableStream({ pull() { reading.resolve(); }, cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } });
  }, { signal: controller.signal });
  const pending = client.call('query-meals', {});
  await reading.promise; controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancelled, true);
});

test('aborting during menu retrieval prevents details and calculation even if a provider finishes late', async () => {
  const controller = new AbortController(), started = Promise.withResolvers(), finish = Promise.withResolvers(), calls = [];
  const api = createApi(async (_token, { signal }) => ({ async call(name) {
    calls.push(name); assert.equal(signal.aborted, false);
    started.resolve(); await finish.promise; return menu;
  } }));
  const pending = api(request('quote', quoteInput(), controller.signal), env);
  await started.promise; controller.abort(); finish.resolve();
  const response = await pending;
  assert.equal(response.status, 499);
  assert.equal((await response.json()).error.code, 'CANCELLED');
  assert.deepEqual(calls, ['query-meals']);
});

for (const route of ['quote', 'plans']) test(`${route} deadline aborts upstream work and returns TIMEOUT without continuing`, async () => {
  const calls = [];
  let signal;
  const api = createApi(async (_token, options) => {
    signal = options.signal;
    return { async call(name) { calls.push(name); return untilAborted(signal); } };
  }, Date.now, { timeoutMs: 20, plansTimeoutMs: 20 });
  const response = await api(request(route, route === 'plans' ? planInput() : quoteInput()), env);
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error.code, 'TIMEOUT');
  assert.equal(signal.aborted, true);
  assert.deepEqual(calls, ['query-meals']);
});

test('request deadline also cancels an incomplete body before opening MCP', async () => {
  let cancelled = false, connected = false;
  const api = createApi(async () => { connected = true; }, Date.now, { timeoutMs: 20 });
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true; } });
  const incoming = new Request('https://site.test/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half' });
  const response = await api(incoming, env);
  assert.equal(response.status, 504);
  assert.equal(cancelled, true);
  assert.equal(connected, false);
});

test('quote reads each unique product once with at most four parallel details and preserves every cart line', async () => {
  const firstBatch = Promise.withResolvers(), secondBatch = Promise.withResolvers(), releases = [], calls = [];
  let active = 0, peak = 0;
  const api = createApi(async () => ({ async call(name, args) {
    calls.push({ name, args });
    if (name === 'query-meals') return menu;
    if (name === 'calculate-price') return quote(args.items);
    active++; peak = Math.max(peak, active);
    const release = Promise.withResolvers(); releases.push(release);
    if (releases.length === 4) firstBatch.resolve();
    if (releases.length === 7) secondBatch.resolve();
    await release.promise; active--; return detail(args.code);
  } }));
  const items = [...codes.map(item), item(codes[0], 7)];
  const pending = api(request('quote', quoteInput(items)), env);
  await firstBatch.promise;
  assert.equal(active, 4); assert.equal(releases.length, 4);
  for (const release of releases) release.resolve();
  await secondBatch.promise;
  for (const release of releases) release.resolve();
  const response = await pending, data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(peak, 4);
  assert.equal(calls.filter(call => call.name === 'query-meal-detail').length, 7);
  assert.deepEqual(calls.at(-1).args.items.map(line => line.productCode), items.map(line => line.code));
  assert.equal(data.units.length, 8);
  assert.equal(data.total, 8000);
});

for (const code of ['TOKEN_INVALID', 'RATE_LIMITED', 'PROTOCOL_CHANGED']) test(`${code} stops a detail pool and cancels active siblings`, async () => {
  const started = Promise.withResolvers(), fail = Promise.withResolvers(), calls = [];
  let cancelled = 0;
  const api = createApi(async (_token, { signal }) => ({ async call(name, args) {
    calls.push({ name, args });
    if (name === 'query-meals') return menu;
    const count = calls.filter(call => call.name === 'query-meal-detail').length;
    if (count === 4) started.resolve();
    if (args.code === codes[0]) { await fail.promise; throw new ApiError(code === 'RATE_LIMITED' ? 429 : 503, code, 'test provider failure'); }
    return untilAborted(signal, () => { cancelled++; });
  } }));
  const pending = api(request('quote', quoteInput(codes.map(item))), env);
  await started.promise; fail.resolve();
  const response = await pending;
  assert.equal((await response.json()).error.code, code);
  assert.equal(cancelled, 3);
  assert.equal(calls.filter(call => call.name === 'query-meal-detail').length, 4);
  assert.ok(!calls.some(call => call.name === 'calculate-price'));
});

test('a detail transport failure cancels siblings without being misreported as user cancellation', async () => {
  const api = createApi(async () => ({ async call(name) {
    if (name === 'query-meals') return menu;
    throw new TypeError('provider transport unavailable');
  } }));
  const response = await api(request('quote', quoteInput()), env);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'SERVICE_UNAVAILABLE');
});

function planningProvider(onQuote) {
  const planningMenu = structuredClone(menu);
  for (const code of codes.slice(1)) planningMenu.meals[code].name += `套餐${code}`;
  let quotes = 0;
  return {
    get quotes() { return quotes; },
    factory: async (_token, { signal }) => ({ async call(name, args) {
      if (name === 'query-meals') return planningMenu;
      if (name === 'query-meal-detail') return args.code === codes[0] ? detail(args.code) : {
        code: args.code, name: planningMenu.meals[args.code].name,
        rounds: [{ id: '1', name: '汉堡', minQuantity: 1, maxQuantity: 1, choices: [{ code: codes[0], name: '麦辣鸡腿汉堡', maxQuantity: 1, isDefault: 1, quantity: 1 }] }],
      };
      quotes++; await onQuote(quotes, signal); return quote(args.items);
    } }),
  };
}

test('a single RPC timeout can use a reserve but request cancellation cannot', async () => {
  const partial = planningProvider(n => { if (n === 1) throw new DOMException('RPC timeout', 'TimeoutError'); });
  const success = await createApi(partial.factory)(request('plans', planInput()), env);
  assert.equal(success.status, 200);
  assert.equal((await success.json()).plans.length, 3);
  assert.equal(partial.quotes, 4);
  const controller = new AbortController(), cancelled = planningProvider(() => controller.abort());
  const stopped = await createApi(cancelled.factory)(request('plans', planInput(), controller.signal), env);
  assert.equal(stopped.status, 499);
  assert.equal(cancelled.quotes, 1);
});

for (const code of ['TOKEN_INVALID', 'RATE_LIMITED', 'PROTOCOL_CHANGED']) test(`${code} during candidate quoting stops before reserves`, async () => {
  const provider = planningProvider(() => { throw new ApiError(503, code, 'provider failure'); });
  const response = await createApi(provider.factory)(request('plans', planInput()), env);
  assert.equal((await response.json()).error.code, code);
  assert.equal(provider.quotes, 1);
});

test('deadline during candidate quoting does not try remaining reserves', async () => {
  const provider = planningProvider((_n, signal) => untilAborted(signal));
  const response = await createApi(provider.factory, Date.now, { plansTimeoutMs: 20 })(request('plans', planInput()), env);
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error.code, 'TIMEOUT');
  assert.equal(provider.quotes, 1);
});

test('Node client disconnect aborts the request and the active upstream call', async t => {
  const started = Promise.withResolvers(), aborted = Promise.withResolvers();
  const api = createApi(async (_token, { signal }) => ({ async call() {
    started.resolve(); return untilAborted(signal, () => aborted.resolve());
  } }));
  const server = createLocalServer(api, env);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const outgoing = httpRequest(`http://127.0.0.1:${server.address().port}/api/quote`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  outgoing.on('error', () => {});
  outgoing.end(JSON.stringify(quoteInput()));
  await started.promise; outgoing.destroy();
  await aborted.promise;
});

test('Node adapter preserves the body limit error for a chunked request', async t => {
  let connected = false;
  const server = createLocalServer(createApi(async () => { connected = true; }), env);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ padding: 'x'.repeat(33000) }))); controller.close(); } });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/quote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half' });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'BODY_LIMIT');
  assert.equal(connected, false);
});
