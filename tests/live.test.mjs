import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApi, createMcpClient, normalizeMenu, normalizeDetail, prepareItem, yuanToCents, productImage } from '../server/api.mjs';
import { selectionsFor, unitsForCart, selectionError, invalidateQuote, acceptQuote, isQuoteCurrent, makeShareText } from '../public/live-state.js';
import { createWorker } from '../worker/index.js';

const sample = JSON.parse(await readFile(new URL('./fixtures/mcd-sample.json', import.meta.url)));
const detail = normalizeDetail(sample.detail);
const item = () => ({ id: 'l1', code: detail.code, quantity: 1, selections: selectionsFor(detail) });
const input = () => ({ storeCode: '1450713', revision: 2, items: [item()] });
const request = (path, body, headers = {}) => new Request(`https://site.test/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
function mockApi(quote = sample.quote) {
  const calls = [];
  const api = createApi(async () => ({ async call(name, args) {
    calls.push({ name, args });
    if (name === 'query-meals') return sample.menu;
    if (name === 'query-meal-detail') return sample.detail;
    if (name === 'calculate-price') return quote;
    throw new Error('Unexpected tool');
  } }), () => 1000);
  return { calls, run: body => api(request('quote', body), { MCD_MCP_TOKEN: 'test-only' }), api };
}

test('promotion display price stays distinct from payable price and retains card condition', () => {
  const product = normalizeMenu(sample.menu).products.find(p => p.code === detail.code);
  assert.equal(product.displayPrice, 4990);
  assert.equal(product.originalPrice, 11450);
  assert.equal(product.requiresCard, true);
  assert.equal(product.condition, '随单购麦金卡优惠');
  assert.equal(yuanToCents('25.5'), 2550);
  assert.equal(yuanToCents('25.555'), null);
});
test('official images are preserved by product code, including drink variants and quote units', () => {
  const image = 'https://menu-img.mcd.cn/pcm/prod/menu/product/milk.png';
  const raw = structuredClone(sample.detail);
  raw.rounds[5].choices[0].image = image;
  const normalized = normalizeDetail(raw);
  const selected = { ...item(), selections: selectionsFor(normalized) };
  assert.equal(normalizeMenu(sample.menu).products.find(p => p.code === detail.code).image, sample.menu.meals[detail.code].image);
  assert.equal(normalized.image, raw.image);
  assert.equal(prepareItem(selected, raw).units.find(u => u.code === '3050').image, image);
  assert.deepEqual(unitsForCart([{ ...selected, name: normalized.name, detail: normalized }]).map(({ id, ...u }) => u), prepareItem(selected, raw).units);
  for (const url of ['http://menu-img.mcd.cn/a.png', 'https://menu-img.mcd.cn.evil.test/a.png', 'https://secret@menu-img.mcd.cn/a.png', 'data:image/svg+xml,test', '', null]) assert.equal(productImage(url), null);
  assert.equal(productImage(image), image);
});
test('eight-piece default keeps two colas and exact provider default modifications', () => {
  const selected = item();
  assert.equal(selectionError(detail, selected.selections), '');
  const prepared = prepareItem(selected, sample.detail);
  assert.deepEqual(prepared.providerItem, sample.request.items[0]);
  assert.equal(prepared.units.length, 8);
  assert.equal(prepared.units.filter(u => u.code === '3050').length, 2);
  assert.deepEqual(unitsForCart([{ ...selected, name: detail.name, detail }]).map(({ id, ...u }) => u), prepared.units);
});
test('one of two colas can become an americano without losing the other cola', () => {
  const selected = item();
  selected.selections.find(r => r.roundId === '6').choices = [{ code: '3050', quantity: 1 }, { code: '507411', quantity: 1 }];
  const prepared = prepareItem(selected, sample.detail);
  assert.equal(prepared.units.length, 8);
  assert.equal(prepared.units.filter(u => u.code === '3050').length, 1);
  assert.equal(prepared.units.filter(u => u.code === '507411').length, 1);
  assert.deepEqual(prepared.providerItem.roundList.at(-1).comboItemList.map(c => [c.code, c.quantity]), [['3050', 1], ['507411', 1]]);
});
test('incomplete rounds, invented options and injected purchases cannot reach calculation', async () => {
  for (const mutate of [
    body => { body.items[0].selections.pop(); },
    body => { body.items[0].selections[0].choices[0].code = '999999'; },
    body => { body.items[0].selections[5].choices[0].quantity = 3; },
    body => { body.items[0].withOrder = { membershipCode: '106' }; },
    body => { body.coupon = 'fake'; },
  ]) {
    const mock = mockApi(), body = input(); mutate(body);
    const response = await mock.run(body);
    assert.equal(response.status, 400);
    assert.ok(!mock.calls.some(c => c.name === 'calculate-price'));
  }
});
test('real quote comes only from calculate-price, bound to store and revision', async () => {
  const mock = mockApi(), response = await mock.run(input()), result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.total, 11450);
  assert.equal(result.conditions[0].displayPrice, 4990);
  assert.equal(result.conditions[0].requiresCard, true);
  assert.equal(result.units.length, 8);
  assert.equal(result.storeCode, '1450713');
  assert.equal(result.revision, 2);
  assert.equal(result.expiresAt, 121000);
  assert.deepEqual(mock.calls.at(-1).args, sample.request);
});
test('invalid quote products, quantities and monetary fields fail closed', async () => {
  for (const mutate of [
    q => { q.price = 114.5; },
    q => { q.productList[0].productCode = '1100'; },
    q => { q.productList[0].quantity = 2; },
    q => { q.packingPrice = '2'; },
  ]) {
    const quote = structuredClone(sample.quote); mutate(quote);
    const response = await mockApi(quote).run(input()), result = await response.json();
    assert.equal(response.status, 502);
    assert.ok(result.error);
    assert.equal(result.total, undefined);
  }
});
test('missing token, cross-origin, oversized requests and non-JSON requests reject before MCP', async () => {
  const mock = mockApi();
  assert.equal((await mock.api(request('quote', input()), {})).status, 503);
  assert.equal((await mock.api(request('quote', input(), { Origin: 'https://other.test' }), { MCD_MCP_TOKEN: 'test' })).status, 403);
  assert.equal((await mock.api(request('quote', { padding: 'x'.repeat(33000) }), { MCD_MCP_TOKEN: 'test' })).status, 413);
  assert.equal((await mock.api(request('quote', input(), { 'Content-Type': 'text/plain' }), { MCD_MCP_TOKEN: 'test' })).status, 415);
  assert.deepEqual(mock.calls, []);
});
test('MCP uses authenticated session, parses SSE and rejects HTTP 200 business failures', async () => {
  const calls = [];
  const client = await createMcpClient('test-secret', async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, options, body });
    if (body.method === 'initialize') return Response.json({ id: body.id, result: { protocolVersion: '2025-03-26' } }, { headers: { 'mcp-session-id': 'test-session' } });
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const response = { id: body.id, result: { structuredContent: { success: false, message: 'private provider error' } } };
    return new Response(`event: message\r\ndata: ${JSON.stringify(response)}\r\n\r\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  await assert.rejects(client.call('calculate-price', {}), e => e.code === 'UPSTREAM_BUSINESS' && !e.message.includes('private'));
  await assert.rejects(client.call('create-order', {}), e => e.code === 'TOOL_NOT_ALLOWED');
  assert.equal(calls.length, 3);
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer test-secret');
  assert.equal(calls.at(-1).options.headers['Mcp-Session-Id'], 'test-session');
  assert.ok(calls.every(c => c.url === 'https://mcp.mcd.cn' && c.options.redirect === 'manual'));
});
test('edge fetch accepts only manual/follow and a redirect cannot forward the credential', async () => {
  let calls = 0;
  await assert.rejects(createMcpClient('test-secret', async (_url, options) => {
    calls++;
    if (!['manual', 'follow'].includes(options.redirect)) throw new TypeError('Invalid redirect value');
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://other.test' } });
  }), e => e.code === 'UPSTREAM_HTTP');
  assert.equal(calls, 1);
});
test('MCP HTTP authentication failure and thrown errors never return secret text', async () => {
  await assert.rejects(createMcpClient('test-secret', async () => new Response('secret', { status: 401 })), e => e.code === 'TOKEN_INVALID');
  const api = createApi(async () => { throw new Error('secret provider payload'); });
  const response = await api(request('quote', input()), { MCD_MCP_TOKEN: 'test-secret' });
  const text = await response.text();
  assert.equal(response.status, 502);
  assert.ok(!text.includes('secret'));
});
test('stale or different-store responses cannot become current; expired sharing omits price', async () => {
  const result = await (await mockApi().run(input())).json();
  const state = { store: { code: '1450713', name: '示例餐厅' }, revision: 2, cart: [{ ...item(), name: detail.name, condition: '随单购麦金卡优惠', requiresCard: true }], quote: null };
  assert.equal(acceptQuote(state, { ...result, storeCode: '999' }), false);
  assert.equal(acceptQuote(state, result), true);
  assert.equal(isQuoteCurrent(state, 1001), true);
  const text = makeShareText(state, [], result.units, [], 1001);
  assert.match(text, /114\.50/);
  assert.match(text, /随单购麦金卡优惠/);
  assert.match(text, /未下单、未支付/);
  assert.ok(!makeShareText(state, [], result.units, [], 121000).includes('114.50'));
  invalidateQuote(state);
  assert.equal(state.quote, null);
  assert.equal(acceptQuote(state, result), false);
});
test('Worker serves only allowlisted assets and never exposes credentials or filesystem paths', async () => {
  const worker = createWorker({ '/index.html': { type: 'text/html', body: 'test home' } });
  for (const path of ['/.env', '/server/api.mjs', '/artifacts/mcp-report.json']) assert.equal((await worker.fetch(new Request(`https://site.test${path}`), {})).status, 404);
  const home = await worker.fetch(new Request('https://site.test/'), { MCD_MCP_TOKEN: 'test-secret' });
  assert.equal(home.status, 200);
  assert.match(home.headers.get('Content-Security-Policy'), /connect-src 'self'/);
  assert.match(home.headers.get('Content-Security-Policy'), /img-src 'self' data: https:\/\/menu-img\.mcd\.cn;/);
  assert.equal(await home.text(), 'test home');
});
