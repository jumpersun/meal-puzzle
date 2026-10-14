import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductImages } from '../public/product-images.js';
import { createApi, normalizeDetail } from '../server/api.mjs';
import { selectionsFor, unitsForCart } from '../public/live-state.js';

const store = '1450713';
const image = code => `https://menu-img.mcd.cn/pcm/prod/menu/ProductPool/product/MS_${code}_600.png`;
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => Promise.withResolvers();

test('combo children absent from the root menu get their own official detail images', async () => {
  // These four children reproduce the live MCP response: choices have no image field.
  const children = [['3050', '可乐中杯'], ['1010', '吉士汉堡包'], ['2846', '麦乐鸡-4块'], ['521991', '海绵宝宝×航海王系列玩具']];
  const detail = normalizeDetail({ code: '9900016055', name: '开心亲子双人餐', rounds: children.map(([code, name], i) => ({ id: i + 1, minQuantity: 1, maxQuantity: 1, choices: [{ code, name, isDefault: 1, quantity: 1, maxQuantity: 1 }] })) });
  const units = unitsForCart([{ id: 'l1', code: detail.code, name: detail.name, detail, quantity: 1, selections: selectionsFor(detail) }]);
  assert.ok(units.every(unit => unit.image === null));
  const calls = [], updates = [];
  const api = createApi(async () => ({ async call(name, args) {
    assert.equal(name, 'query-meal-detail'); calls.push(args.code);
    return { code: args.code, name: children.find(([code]) => code === args.code)[1], image: image(args.code), rounds: [] };
  } }));
  const pictures = createProductImages({ async load({ storeCode, code, signal }) {
    const response = await api(new Request('https://site.test/api/detail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeCode, code }), signal }), { MCD_MCP_TOKEN: 'test-only' });
    assert.equal(response.status, 200); return response.json();
  }, onChange: code => updates.push(code) });
  pictures.sync(store, [...units.map(unit => unit.code), '3050']);
  await flush(); await flush();
  assert.deepEqual(calls.sort(), children.map(([code]) => code).sort());
  for (const [code] of children) assert.equal(pictures.get(store, code), image(code));
  assert.equal(updates.length, 4);
  pictures.sync(store, units.map(unit => unit.code)); await flush();
  assert.equal(calls.length, 4, 'rendering again reuses the same images');
});

test('image reads are deduplicated and bounded to four while requested codes wait', async () => {
  const jobs = [], codes = Array.from({ length: 7 }, (_, i) => String(100 + i));
  let active = 0, peak = 0;
  const pictures = createProductImages({ async load(args) {
    const finish = deferred(); jobs.push({ ...args, finish }); active++; peak = Math.max(peak, active);
    await finish.promise; active--; return { code: args.code, image: image(args.code) };
  } });
  pictures.sync(store, [...codes, codes[0]]); pictures.sync(store, codes); await flush();
  assert.equal(jobs.length, 4); assert.equal(active, 4);
  jobs[0].finish.resolve(); await flush();
  assert.equal(jobs.length, 5); assert.equal(active, 4);
  for (const job of jobs) job.finish.resolve(); await flush();
  for (const job of jobs) job.finish.resolve(); await flush();
  assert.equal(jobs.length, 7); assert.equal(peak, 4);
  assert.deepEqual(jobs.map(job => job.code), codes);
});

test('removed dishes and previous-store late responses never update the current table', async () => {
  const jobs = [], updates = [];
  const pictures = createProductImages({ async load(args) {
    const finish = deferred(); jobs.push({ ...args, finish }); await finish.promise;
    return { code: args.code, image: image(args.code) };
  }, onChange: code => updates.push(code) });
  pictures.sync(store, ['3050', '1010']); await flush();
  pictures.sync(store, ['1010']);
  assert.equal(jobs[0].signal.aborted, true); assert.equal(jobs[1].signal.aborted, false);
  pictures.sync('1450999', ['3050']); await flush();
  assert.equal(jobs[1].signal.aborted, true);
  jobs[0].finish.resolve(); jobs[1].finish.resolve(); await flush();
  assert.equal(pictures.get(store, '3050'), null); assert.equal(pictures.get(store, '1010'), null);
  assert.deepEqual(updates, []);
  jobs[2].finish.resolve(); await flush();
  assert.equal(pictures.get('1450999', '3050'), image('3050'));
  assert.deepEqual(updates, ['3050']);
});

test('invalid images, mismatched identities and failed reads stay isolated and retry after a cooldown', async () => {
  let clock = 1000, calls = 0;
  const codes = ['1', '2', '3', '4', '5', '6'];
  const pictures = createProductImages({ now: () => clock, async load({ code }) {
    calls++;
    if (code === '1') throw new Error('Image details unavailable');
    if (code === '2') return { code: '999', image: image(code) };
    const unsafe = { '3': 'https://menu-img.mcd.cn.evil.test/image.png', '4': 'http://menu-img.mcd.cn/image.png', '5': 'https://user@menu-img.mcd.cn/image.png', '6': 'data:image/png;base64,xyz' };
    return { code, image: unsafe[code] };
  } });
  pictures.sync(store, codes); await flush(); await flush();
  assert.equal(calls, 6); assert.ok(codes.every(code => pictures.get(store, code) === null));
  pictures.sync(store, codes); await flush(); assert.equal(calls, 6);
  clock += 30001; pictures.sync(store, ['1']); await flush(); assert.equal(calls, 7);
});

test('cache is scoped to a store and refreshing or leaving the table cancels pending work', async () => {
  const jobs = [];
  const pictures = createProductImages({ async load(args) {
    const finish = deferred(); jobs.push({ ...args, finish }); await finish.promise;
    return { code: args.code, image: image(args.code) };
  } });
  pictures.sync(store, ['3050']); await flush(); jobs[0].finish.resolve(); await flush();
  assert.equal(pictures.get(store, '3050'), image('3050'));
  assert.equal(pictures.get('1450999', '3050'), null);
  pictures.clear(store); assert.equal(pictures.get(store, '3050'), null);
  pictures.sync(store, ['3050']); await flush(); assert.equal(jobs.length, 2);
  pictures.sync(null, []); assert.equal(jobs[1].signal.aborted, true);
  jobs[1].finish.resolve(); await flush(); assert.equal(pictures.get(store, '3050'), null);
});

test('removing and immediately restoring a dish cannot let its old request overwrite the new one', async () => {
  const jobs = [], updates = [];
  const pictures = createProductImages({ async load(args) {
    const finish = deferred(); jobs.push({ ...args, finish }); return finish.promise;
  }, onChange: code => updates.push(code) });
  pictures.sync(store, ['3050']); await flush();
  pictures.sync(store, []); pictures.sync(store, ['3050']); await flush();
  assert.equal(jobs.length, 2); assert.equal(jobs[0].signal.aborted, true);
  jobs[0].finish.resolve({ code: '3050', image: image('old') }); await flush();
  assert.equal(pictures.get(store, '3050'), null); assert.deepEqual(updates, []);
  jobs[1].finish.resolve({ code: '3050', image: image('3050'), storeCode: '1450999' }); await flush();
  assert.equal(pictures.get(store, '3050'), null, 'wrong-store detail also remains unusable');
  assert.deepEqual(updates, []);
});

test('only valid codes from at most sixty current table units can trigger detail reads', async () => {
  const calls = [];
  const pictures = createProductImages({ async load({ code }) { calls.push(code); return { code, image: image(code) }; } });
  pictures.sync(store, ['../secret', '', null, ...Array.from({ length: 70 }, (_, i) => String(1000 + i))]);
  for (let i = 0; i < 20; i++) await flush();
  assert.equal(calls.length, 60); assert.ok(calls.every(code => /^\d+$/.test(code)));
});
