import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WISH_KINDS, foodKind, exampleWishes, wishTotals, selectPlannerProducts, buildCandidateCarts, assessWishes, assignWishes, preserveOwners, personWishStatus } from '../public/wish-planner.js';
import { unitsForCart } from '../public/live-state.js';
import { createApi, normalizeDetail, normalizeMenu, prepareItem, ApiError } from '../server/api.mjs';

const sample = JSON.parse(await readFile(new URL('./fixtures/mcd-sample.json', import.meta.url)));
const singleNames = [['1440', '麦辣鸡腿汉堡'], ['1100', '巨无霸'], ['4810', '中薯条'], ['515106', '麦乐鸡4块'], ['3050', '可乐中杯'], ['507411', '麦咖啡™冰美式中杯']];
const rawDetails = new Map(singleNames.map(([code, name]) => [code, { code, name, rounds: [] }]));
rawDetails.set(sample.detail.code, sample.detail);
const rawMenu = { categories: [{ name: '餐品', meals: [...rawDetails.keys()].map(code => ({ code })) }], meals: Object.fromEntries([...rawDetails].map(([code, d]) => [code, { name: d.name, currentPrice: code === sample.detail.code ? '49.90' : '20.00', originalPrice: code === sample.detail.code ? '114.50' : '20.00', ...(code === sample.detail.code ? { canWithOrder: true, discountType: '随单购麦金卡优惠' } : {}) }])) };
const catalog = normalizeMenu(rawMenu), details = new Map([...rawDetails].map(([code, d]) => [code, normalizeDetail(d)]));
const people = [{ id: 'a', wants: { chicken: 1, fries: 1, coffee: 1 } }, { id: 'b', wants: { chicken: 1, cola: 1 } }, { id: 'c', wants: { nuggets: 1, fries: 1 } }];
const input = () => ({ storeCode: '1450713', revision: 5, people: structuredClone(people), budget: 10000 });
const request = body => new Request('https://site.test/api/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function provider({ failDetail, failQuote, failAllQuotes = false } = {}) {
  const calls = [];
  const api = createApi(async () => ({ async call(name, args) {
    calls.push({ name, args });
    if (name === 'query-meals') return rawMenu;
    if (name === 'query-meal-detail') { if (args.code === failDetail) throw new ApiError(502, 'UPSTREAM_BUSINESS', '停售'); return rawDetails.get(args.code); }
    if (name === 'calculate-price') {
      if (failAllQuotes || args.items.some(i => i.productCode === failQuote)) throw new ApiError(502, 'UPSTREAM_BUSINESS', '无法核价');
      const productList = args.items.map(i => ({ productCode: i.productCode, productName: rawDetails.get(i.productCode).name, quantity: i.quantity, subtotal: i.quantity * (i.productCode === sample.detail.code ? 12350 : 1700) }));
      return { price: productList.reduce((n, p) => n + p.subtotal, 0), productList };
    }
    throw new Error('Unexpected tool');
  } }), () => 1000);
  return { calls, run: body => api(request(body), { MCD_MCP_TOKEN: 'test-only' }) };
}

test('food wishes match individual portions without treating a meal or coffee dessert as a drink', () => {
  for (const [name, kind] of [['麦咖啡™冰美式中杯', 'coffee'], ['燕麦奶铁', 'coffee'], ['麦辣鸡腿堡', 'chicken'], ['中薯条', 'fries'], ['麦乐鸡4块', 'nuggets']]) assert.equal(foodKind(name), kind);
  for (const name of ['麦辣鸡腿汉堡三件套', '全明星双人分享餐八件套', '咖啡阿芙佳朵', '牛奶', '韩式烟熏芝士风味酱']) assert.equal(foodKind(name), null);
});
test('real eight-piece combo is configured for one cola and one coffee and every candidate satisfies provider quantities', () => {
  const plans = buildCandidateCarts(catalog, details, people);
  assert.ok(plans.length >= 2 && plans.length <= 3);
  const combo = plans.flatMap(p => p.cart).find(c => c.code === sample.detail.code);
  assert.ok(combo);
  const prepared = prepareItem({ id: combo.id, code: combo.code, quantity: combo.quantity, selections: combo.selections }, sample.detail);
  assert.equal(prepared.units.filter(u => foodKind(u.name) === 'coffee').length, 1);
  assert.equal(prepared.units.filter(u => foodKind(u.name) === 'cola').length, 1);
  for (const plan of plans) {
    assert.equal(plan.matched, 7);
    assert.equal(plan.missing.length, 0);
    for (const c of plan.cart) prepareItem({ id: c.id, code: c.code, quantity: c.quantity, selections: c.selections }, rawDetails.get(c.code));
  }
});
test('assignment conserves all portions, fulfils each person and keeps surplus in the shared tray', () => {
  for (const plan of buildCandidateCarts(catalog, details, people)) {
    const units = unitsForCart(plan.cart), before = structuredClone(units), assigned = assignWishes(units, people);
    assert.deepEqual(units, before);
    assert.deepEqual(assigned.map(({ owner, ...u }) => u), units);
    assert.equal(assigned.filter(u => !u.owner).length, plan.extraCount);
    for (const person of people) assert.equal(personWishStatus(assigned, person).missing.length, 0);
  }
});
test('unavailable kinds stay visibly missing and cannot be replaced with an unrelated food', () => {
  const target = [{ id: 'a', wants: { beef: 1, coffee: 1 } }];
  const partial = { products: catalog.products.filter(p => p.code === '1100') };
  const plan = buildCandidateCarts(partial, details, target)[0];
  assert.equal(plan.matched, 1);
  assert.deepEqual(plan.missing, [{ kind: 'coffee', quantity: 1 }]);
  assert.deepEqual(assessWishes(unitsForCart(plan.cart), target).missing, plan.missing);
});
test('breakfast menus offer breakfast wishes and distribute a full table without pretending lunch food is available', () => {
  const products = ['猪柳蛋麦满分', '薯饼', '皮蛋鸡肉粥', '麦咖啡™美式'].map((name, i) => ({ code: `b${i}`, name, displayPrice: 1500 }));
  const breakfastMenu = { products }, target = exampleWishes(breakfastMenu).map((wants, i) => ({ id: `b${i}`, wants }));
  const breakfastDetails = new Map(products.map(p => [p.code, { ...p, rounds: [] }]));
  assert.equal(foodKind('猪柳蛋麦满分套餐'), null);
  assert.equal(foodKind('芝芝火腿扒堡组合'), null);
  assert.equal(foodKind('板烧鸡腿早安营养卷'), 'chicken');
  const candidate = buildCandidateCarts(breakfastMenu, breakfastDetails, target)[0];
  assert.equal(candidate.matched, 7); assert.equal(candidate.extraCount, 0);
  assert.deepEqual(candidate.missing, []);
  for (const person of target) assert.deepEqual(personWishStatus(assignWishes(unitsForCart(candidate.cart), target), person).missing, []);
  assert.ok(exampleWishes(catalog).some(w => w.fries));
});
test('detail selection and generated carts remain bounded for a full six-person request', () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, wants: { chicken: 1, fries: 1, cola: 1 } }));
  assert.equal(Object.values(wishTotals(six)).reduce((a, b) => a + b), 18);
  assert.ok(selectPlannerProducts(catalog, six).length <= 20);
  for (const plan of buildCandidateCarts(catalog, details, six)) {
    assert.ok(plan.cart.length <= 8);
    assert.ok(plan.cart.every(c => c.quantity <= 6));
    assert.ok(unitsForCart(plan.cart).length <= 60);
    assert.equal(plan.matched, 18);
  }
});
test('replacing one drink preserves the owners of unchanged portions, even when indices shift', () => {
  const previous = [{ id: 'l1-0', code: '3050', owner: 'a' }, { id: 'l1-1', code: '3050', owner: 'b' }, { id: 'l2-0', code: '4810', owner: 'c' }];
  const next = [{ id: 'l1-0', code: '507411' }, { id: 'l1-1', code: '3050' }, { id: 'l2-0', code: '4810' }];
  assert.deepEqual(preserveOwners(next, previous, people).map(u => u.owner), [null, 'a', 'c']);
  assert.deepEqual(preserveOwners(next, previous, [{ id: 'b' }]).map(u => u.owner), [null, null, null]);
});
test('plans use official quoted totals, carry conditions and never send names or purchase add-ons upstream', async () => {
  const mock = provider(), response = await mock.run(input());
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.revision, 5); assert.equal(data.budget, 10000);
  assert.ok(data.plans.length >= 2);
  assert.ok(data.plans[0].quote.total <= data.plans[1].quote.total);
  const comboPlan = data.plans.find(p => p.cart.some(c => c.code === sample.detail.code));
  assert.ok(comboPlan.quote.total >= 12350);
  assert.ok(comboPlan.quote.conditions.some(c => c.requiresCard && c.displayPrice === 4990));
  assert.equal(data.expiresAt, 121000);
  for (const call of mock.calls.filter(c => c.name === 'calculate-price')) {
    assert.equal(call.args.people, undefined); assert.equal(call.args.withOrder, undefined); assert.equal(call.args.coupon, undefined);
    assert.ok(call.args.items.every(i => i.withOrder === undefined));
  }
});
test('bad wish inputs reject before connecting to MCP, including injection and excessive search sizes', async () => {
  for (const mutate of [b => { b.people = []; }, b => { b.people[0].wants.chicken = 99; }, b => { b.people[0].wants = { unknown: 1 }; }, b => { b.people[0].name = 'private name'; }, b => { b.withOrder = {}; }, b => { b.budget = -1; }, b => { b.people.forEach(p => p.wants = {}); }, b => { b.people[1].id = b.people[0].id; }]) {
    const mock = provider(), body = input(); mutate(body);
    assert.equal((await mock.run(body)).status, 400);
    assert.equal(mock.calls.length, 0);
  }
});
test('partial provider failures are disclosed, and no plan is selectable without a successful quote', async () => {
  const partial = provider({ failDetail: '1440' });
  const data = await (await partial.run(input())).json();
  assert.equal(data.scope.failedDetails, 1); assert.ok(data.plans.length);
  const failure = provider({ failAllQuotes: true });
  const response = await failure.run(input());
  assert.equal(response.status, 502); assert.equal((await response.json()).error.code, 'NO_PLANS');
});
