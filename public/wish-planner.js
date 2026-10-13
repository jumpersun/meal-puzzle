import { selectionsFor, unitsForCart } from './live-state.js';

export const WISH_KINDS = [
  { id: 'chicken', name: '鸡肉堡 / 卷', icon: '🍔' },
  { id: 'beef', name: '牛肉堡', icon: '🍔' },
  { id: 'fries', name: '薯条', icon: '🍟' },
  { id: 'nuggets', name: '麦乐鸡', icon: '🍗' },
  { id: 'cola', name: '可乐', icon: '🥤' },
  { id: 'coffee', name: '咖啡', icon: '☕' },
  { id: 'breakfast', name: '早餐堡 / 卷', icon: '🥪' },
  { id: 'hashbrown', name: '薯饼', icon: '🥔' },
  { id: 'porridge', name: '粥', icon: '🥣' },
];
export const MAX_WISHES = 18;
const emptyCounts = () => Object.fromEntries(WISH_KINDS.map(k => [k.id, 0]));
const sumCounts = counts => Object.values(counts).reduce((a, b) => a + b, 0);
const comboName = name => /套餐|组合|件套|双人餐|乐园餐|亲子|随心|拼|盒|四宫格/.test(name);

// These broad food wishes are not dietary, ingredient or allergy guarantees.
// Classify individual portions only; a box whose name mentions chicken is not one chicken burger.
export function foodKind(name) {
  if (typeof name !== 'string' || comboName(name)) return null;
  if (/麦乐鸡/.test(name)) return 'nuggets';
  if (/薯条|[大中小]薯|扭扭薯/.test(name)) return 'fries';
  if (/可乐/.test(name)) return 'cola';
  if (/美式|鲜萃.*咖|浓缩咖啡|卡布奇诺|奶铁|拿铁/.test(name)) return 'coffee';
  if (/鸡.*(?:堡|卷)|麦香鸡|板烧.*堡/.test(name)) return 'chicken';
  if (/牛.*堡|巨无霸|吉士汉堡|安格斯.*堡/.test(name)) return 'beef';
  if (/薯饼/.test(name)) return 'hashbrown';
  if (/粥/.test(name)) return 'porridge';
  if (/麦满分|厚松饼.*堡|火腿.*堡|炒双蛋堡|早安.*卷/.test(name)) return 'breakfast';
  return null;
}
export function exampleWishes(menu) {
  const breakfast = menu?.products.some(p => foodKind(p.name) === 'breakfast') && !menu.products.some(p => foodKind(p.name) === 'fries');
  return breakfast ? [{ breakfast: 1, hashbrown: 1, coffee: 1 }, { breakfast: 1, coffee: 1 }, { porridge: 1, hashbrown: 1 }]
    : [{ chicken: 1, fries: 1, coffee: 1 }, { beef: 1, cola: 1 }, { nuggets: 1, fries: 1 }];
}
export function wishTotals(people) {
  const counts = emptyCounts();
  for (const person of people) for (const k of WISH_KINDS) counts[k.id] += person.wants?.[k.id] || 0;
  return counts;
}
export function assessWishes(units, people) {
  const target = wishTotals(people), actual = emptyCounts();
  for (const unit of units) { const kind = foodKind(unit.name); if (kind) actual[kind]++; }
  const missing = WISH_KINDS.flatMap(k => target[k.id] > actual[k.id] ? [{ kind: k.id, quantity: target[k.id] - actual[k.id] }] : []);
  const matched = WISH_KINDS.reduce((n, k) => n + Math.min(target[k.id], actual[k.id]), 0);
  return { wanted: sumCounts(target), matched, missing, extraCount: units.length - matched };
}
export function assignWishes(units, people) {
  const assigned = units.map(unit => ({ ...unit, owner: null }));
  for (const person of people) for (const k of WISH_KINDS) {
    let remaining = person.wants?.[k.id] || 0;
    for (const unit of assigned) if (remaining && !unit.owner && foodKind(unit.name) === k.id) { unit.owner = person.id; remaining--; }
  }
  return assigned;
}
export function personWishStatus(units, person) {
  return assessWishes(units.filter(u => u.owner === person.id), [person]);
}
export function preserveOwners(units, previous, people) {
  const pools = new Map(), validOwners = new Set(people.map(p => p.id));
  for (const unit of previous) {
    const key = `${unit.id.slice(0, unit.id.lastIndexOf('-'))}:${unit.code}`;
    if (!pools.has(key)) pools.set(key, []);
    pools.get(key).push(validOwners.has(unit.owner) ? unit.owner : null);
  }
  return units.map(unit => {
    const key = `${unit.id.slice(0, unit.id.lastIndexOf('-'))}:${unit.code}`;
    return { ...unit, owner: pools.get(key)?.shift() || null };
  });
}

const referencePrice = p => p.originalPrice ?? p.displayPrice ?? 999999;
export function selectPlannerProducts(menu, people) {
  const target = wishTotals(people), chosen = new Map();
  for (const k of WISH_KINDS) if (target[k.id]) {
    // Retain alternatives when a menu product's detail is temporarily unavailable.
    for (const p of menu.products.filter(p => foodKind(p.name) === k.id).sort((a, b) => referencePrice(a) - referencePrice(b)).slice(0, 2)) chosen.set(p.code, p);
  }
  const size = sumCounts(target);
  const relevance = p => (/双人|分享|随心拼/.test(p.name) && size >= 5 ? 5 : 0)
    + (target.chicken && /鸡腿|麦香鸡|板烧/.test(p.name) ? 3 : 0)
    + (target.beef && /牛|巨无霸|吉士|安格斯/.test(p.name) ? 3 : 0)
    + (target.breakfast && /麦满分|厚松饼|火腿|炒双蛋/.test(p.name) ? 3 : 0)
    + (target.porridge && /粥/.test(p.name) ? 3 : 0)
    + (/随心选|单人餐|随心配/.test(p.name) ? 2 : 0);
  for (const p of menu.products.filter(p => comboName(p.name)).sort((a, b) => relevance(b) - relevance(a) || referencePrice(a) - referencePrice(b)).slice(0, 8)) chosen.set(p.code, p);
  return [...chosen.values()].slice(0, 20);
}
function countsFor(line) {
  const counts = emptyCounts();
  for (const u of unitsForCart([line])) { const kind = foodKind(u.name); if (kind) counts[kind]++; }
  return counts;
}
function remainingAfter(target, counts) { return Object.fromEntries(WISH_KINDS.map(k => [k.id, Math.max(0, target[k.id] - counts[k.id])])); }
const coverage = (target, counts) => WISH_KINDS.reduce((n, k) => n + Math.min(target[k.id], counts[k.id]), 0);
function difference(value) { const n = String(value).match(/[0-9]+(?:\.[0-9]+)?/); return n ? Number(n[0]) : 0; }

function makeVariant(product, detail, target) {
  const line = { ...product, id: 'candidate', quantity: 1, detail, selections: selectionsFor(detail) };
  let remaining = { ...target };
  if (!detail.rounds.length) return line;
  const selections = [];
  for (const round of detail.rounds) {
    if (!Number.isInteger(round.min) || !Number.isInteger(round.max) || round.min < 0 || round.min > round.max || round.max > 20) return null;
    const selected = new Map();
    for (let slot = 0; slot < round.min; slot++) {
      const choices = round.choices.filter(c => (selected.get(c.code) || 0) < (c.max >= 0 ? Math.min(c.max, round.max) : round.max));
      choices.sort((a, b) => {
        const ak = foodKind(a.name), bk = foodKind(b.name);
        const am = ak ? remaining[ak] : 0, bm = bk ? remaining[bk] : 0;
        return Number(bm > 0) - Number(am > 0) || bm - am || difference(a.difference) - difference(b.difference) || Number(b.quantity > 0) - Number(a.quantity > 0);
      });
      const chosen = choices[0]; if (!chosen) return null;
      selected.set(chosen.code, (selected.get(chosen.code) || 0) + 1);
      const kind = foodKind(chosen.name); if (kind) remaining[kind] = Math.max(0, remaining[kind] - 1);
    }
    selections.push({ roundId: round.id, choices: [...selected].map(([code, quantity]) => ({ code, quantity })) });
  }
  line.selections = selections;
  return line;
}
function selectionKey(line) { return `${line.code}:${JSON.stringify(line.selections)}`; }
function appendLine(cart, line) {
  const existing = cart.find(c => selectionKey(c) === selectionKey(line) && c.quantity < 6);
  if (existing) existing.quantity++;
  else if (cart.length < 8) cart.push(structuredClone(line));
  else return false;
  return true;
}
export function buildCandidateCarts(catalog, details, people) {
  const target = wishTotals(people);
  if (!sumCounts(target)) return [];
  const products = catalog.products.filter(p => details.has(p.code));
  const singles = products.filter(p => !comboName(p.name) && foodKind(p.name));
  const combos = products.filter(p => comboName(p.name));
  function build(seed, repeat = false) {
    const cart = []; let remaining = { ...target };
    if (seed) for (let step = 0; step < (repeat ? 3 : 1); step++) {
      const line = makeVariant(seed, details.get(seed.code), remaining);
      if (!line || !coverage(remaining, countsFor(line)) || !appendLine(cart, line)) break;
      remaining = remainingAfter(remaining, countsFor(line));
      if (!sumCounts(remaining)) break;
    }
    for (const k of WISH_KINDS) while (remaining[k.id] > 0) {
      const wanted = { ...emptyCounts(), [k.id]: remaining[k.id] };
      const options = singles.filter(p => foodKind(p.name) === k.id).map(p => makeVariant(p, details.get(p.code), wanted)).filter(Boolean)
        .filter(line => countsFor(line)[k.id] > 0)
        .sort((a, b) => unitsForCart([a]).length - unitsForCart([b]).length || referencePrice(a) - referencePrice(b));
      const line = options[0]; if (!line || !appendLine(cart, line)) break;
      remaining = remainingAfter(remaining, countsFor(line));
    }
    cart.forEach((line, i) => { line.id = `plan${i + 1}`; });
    const units = unitsForCart(cart);
    if (!cart.length || units.length > 60) return null;
    return { cart, ...assessWishes(units, people), reference: cart.reduce((n, c) => n + referencePrice(c) * c.quantity, 0) };
  }
  const unique = new Map();
  for (const candidate of [build(null), ...combos.flatMap(p => [build(p), build(p, true)])].filter(Boolean)) {
    const key = candidate.cart.map(c => `${selectionKey(c)}:${c.quantity}`).sort().join('|');
    if (!unique.has(key)) unique.set(key, candidate);
  }
  const options = [...unique.values()].sort((a, b) => b.matched - a.matched || a.extraCount - b.extraCount || a.reference - b.reference);
  // Only shortlisted plans are quoted. Reference prices select candidates; they never become payable totals.
  const selected = options.slice(0, 1);
  const complete = options.filter(p => p.matched === (options[0]?.matched || 0)).sort((a, b) => a.reference - b.reference || a.extraCount - b.extraCount);
  for (const candidate of [...complete, ...options]) if (selected.length < 3 && !selected.includes(candidate)) selected.push(candidate);
  return selected;
}
