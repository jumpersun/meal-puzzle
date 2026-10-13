// Fictional catalogue for a self-contained experience. These are not McDonald's offers.
export const FOODS = [
  { id: 'beef', name: '经典牛肉堡', short: '牛肉堡', price: 2200, color: '#f4ba4e' },
  { id: 'chicken', name: '香酥鸡腿堡', short: '鸡腿堡', price: 2000, color: '#eaaa53' },
  { id: 'fries', name: '金黄薯条', short: '薯条', price: 1200, color: '#f4c852' },
  { id: 'coffee', name: '醇香咖啡', short: '咖啡', price: 1400, color: '#b08465' },
  { id: 'cola', name: '清爽可乐', short: '可乐', price: 900, color: '#cc6152' },
  { id: 'nuggets', name: '酥脆鸡块', short: '鸡块', price: 1300, color: '#dea853' },
];
export const DEALS = [
  ...FOODS.map(f => ({ id: `single-${f.id}`, name: f.name, price: f.price, items: { [f.id]: 1 }, single: true })),
  { id: 'coffee-pair', name: '早安咖啡搭子', price: 3000, items: { beef: 1, coffee: 1 } },
  { id: 'chicken-meal', name: '鸡腿堡快乐餐', price: 3200, items: { chicken: 1, fries: 1, cola: 1 } },
  { id: 'snack-box', name: '午后小食盒', price: 2900, items: { fries: 1, nuggets: 1, cola: 1 } },
  { id: 'friends-box', name: '好朋友分享盒', price: 5800, items: { beef: 1, chicken: 1, fries: 1, cola: 1, nuggets: 1 } },
  { id: 'big-box', name: '搭子大满足', price: 6900, items: { beef: 1, chicken: 1, fries: 2, cola: 2, nuggets: 1, coffee: 1 } },
];
export const SCENARIOS = [
  { name: '午后搭子', caption: '你爱咖啡，我爱薯条。', people: [
    { id: 'p1', name: '阿橙', wants: { beef: 1, coffee: 1 } },
    { id: 'p2', name: '小蓝', wants: { chicken: 1, fries: 1 } },
    { id: 'p3', name: '小满', wants: { cola: 1, nuggets: 1 } },
  ] },
  { name: '双人分享', caption: '两个人的小小快乐。', people: [
    { id: 'p1', name: '阿橙', wants: { chicken: 1, cola: 1 } },
    { id: 'p2', name: '小蓝', wants: { fries: 1, nuggets: 1 } },
  ] },
  { name: '周五小聚', caption: '四个口味，也能拼在一起。', people: [
    { id: 'p1', name: '阿橙', wants: { beef: 1, coffee: 1 } },
    { id: 'p2', name: '小蓝', wants: { chicken: 1, fries: 1 } },
    { id: 'p3', name: '小满', wants: { nuggets: 1, cola: 1 } },
    { id: 'p4', name: '小桃', wants: { chicken: 1, fries: 1, cola: 1 } },
  ] },
];
export const money = cents => (cents / 100).toFixed(cents % 100 ? 2 : 0);
export function demandFor(people) {
  return FOODS.map(f => people.reduce((sum, p) => sum + (p.wants[f.id] || 0), 0));
}

// Dynamic programming over fulfilled quantities. Overflow is never hidden or added to a person's wishes.
export function solve(people, mode = 'exact') {
  if (!['exact', 'budget', 'singles'].includes(mode)) throw new Error('Unknown mode');
  const target = demandFor(people);
  if (people.length > 6 || target.some(q => !Number.isInteger(q) || q < 0 || q > 8) || target.reduce((a,b) => a+b,0) > 20) {
    throw new Error('这桌最多 6 人、20 份餐品，每种餐品最多 8 份。');
  }
  const baseline = target.reduce((sum, q, i) => sum + q * FOODS[i].price, 0);
  const deals = DEALS.filter(d => mode !== 'singles' || d.single);
  const memo = new Map();
  function visit(remaining) {
    if (remaining.every(q => q === 0)) return { cost: 0, excess: 0, packages: 0, picks: [] };
    const key = remaining.join(',');
    if (memo.has(key)) return memo.get(key);
    let best;
    for (const d of deals) {
      const amounts = FOODS.map(f => d.items[f.id] || 0);
      if (mode !== 'budget' && amounts.some((q,i) => q > remaining[i])) continue;
      const next = remaining.map((q,i) => Math.max(0, q - amounts[i]));
      if (next.every((q,i) => q === remaining[i])) continue;
      const tail = visit(next);
      if (!tail) continue;
      const candidate = { cost: d.price + tail.cost, excess: tail.excess + amounts.reduce((n,q,i) => n + Math.max(0,q-remaining[i]),0), packages: tail.packages + 1, picks: [d.id, ...tail.picks] };
      if (!best || candidate.cost < best.cost || (candidate.cost === best.cost && (candidate.excess < best.excess || (candidate.excess === best.excess && candidate.packages < best.packages)))) best = candidate;
    }
    memo.set(key, best);
    return best;
  }
  const result = visit(target);
  if (!result) throw new Error('没有找到可用的演示组合。');
  const counts = new Map();
  for (const id of result.picks) counts.set(id, (counts.get(id) || 0) + 1);
  const bundles = [...counts].map(([id, quantity]) => ({ ...DEALS.find(d => d.id === id), quantity }));
  const units = [];
  for (const bundle of bundles) {
    for (let n = 0; n < bundle.quantity; n++) {
      for (const [foodId, quantity] of Object.entries(bundle.items)) {
        for (let q = 0; q < quantity; q++) units.push({ id: `u${units.length+1}`, foodId, bundleId: bundle.id, owner: null });
      }
    }
  }
  return { mode, cost: result.cost, baseline, saving: baseline - result.cost, extraCount: result.excess, bundles, units };
}
export function distribute(plan, people) {
  const units = plan.units.map(u => ({ ...u, owner: null }));
  for (const p of people) for (const f of FOODS) {
    let count = p.wants[f.id] || 0;
    for (const u of units) if (count > 0 && !u.owner && u.foodId === f.id) { u.owner = p.id; count--; }
  }
  return units;
}
export function needsFor(person, units) {
  return FOODS.flatMap(f => {
    const count = units.filter(u => u.owner === person.id && u.foodId === f.id).length;
    const want = person.wants[f.id] || 0;
    return count !== want ? [{ foodId: f.id, missing: Math.max(0, want-count), extra: Math.max(0,count-want) }] : [];
  });
}
export function moveUnit(units, unitId, owner, people) {
  if (owner !== null && !people.some(p => p.id === owner)) throw new Error('Unknown person');
  if (!units.some(u => u.id === unitId)) throw new Error('Unknown food');
  return units.map(u => u.id === unitId ? { ...u, owner } : { ...u });
}
export function shareText(plan, people, units, confirmed) {
  const names = foodId => FOODS.find(f => f.id === foodId).short;
  const describe = items => FOODS.map(f => { const q = items.filter(u => u.foodId === f.id).length; return q ? `${f.short} ×${q}` : null; }).filter(Boolean).join('、') || '还没有餐品';
  const lines = ['🍔 套餐拼图 · 这一桌刚刚好', '【演示清单】虚构菜单与示例价格，未连接麦当劳 MCP，不能用于实际下单。', ''];
  for (const p of people) {
    lines.push(`${confirmed.includes(p.id) ? '✓' : '○'} ${p.name}：${describe(units.filter(u => u.owner === p.id))}`);
    const missing = needsFor(p, units).filter(n => n.missing);
    if (missing.length) lines.push(`  待补：${missing.map(n => `${names(n.foodId)} ×${n.missing}`).join('、')}`);
  }
  lines.push('', '演示购买组合：', ...plan.bundles.map(b => `${b.name} ×${b.quantity} · ¥${money(b.price*b.quantity)}`));
  lines.push(`示例合计 ¥${money(plan.cost)}（单点示例 ¥${money(plan.baseline)}）`);
  const spare = units.filter(u => !u.owner);
  if (spare.length) lines.push(`待分配：${describe(spare)}`);
  lines.push('确认标记由本机操作者记录，不代表其他人已在线确认。');
  return lines.join('\n');
}
