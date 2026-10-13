export const formatMoney = cents => Number.isSafeInteger(cents) ? (cents / 100).toFixed(2) : '—';
export function selectionsFor(detail) {
  return detail.rounds.map(r => ({ roundId: r.id, choices: r.choices.filter(c => c.quantity > 0).map(c => ({ code: c.code, quantity: c.quantity })) }));
}
export function selectionError(detail, selections) {
  for (const r of detail.rounds) {
    const selected = selections.find(s => s.roundId === r.id)?.choices || [];
    const count = selected.reduce((n, c) => n + c.quantity, 0);
    if (count < r.min || count > r.max) return `${r.name}需要选择 ${r.min === r.max ? r.min : `${r.min}–${r.max}`} 份，现在是 ${count} 份。`;
  }
  return '';
}
export function invalidateQuote(state) { state.revision += 1; state.quote = null; }
export function acceptQuote(state, result) {
  if (result.storeCode !== state.store?.code || result.revision !== state.revision) return false;
  state.quote = result; return true;
}
export function isQuoteCurrent(state, now = Date.now()) {
  return Boolean(state.quote && state.quote.revision === state.revision && state.quote.storeCode === state.store?.code && state.quote.expiresAt > now);
}
export function unitsForCart(cart) {
  return cart.flatMap(line => {
    const units = [];
    for (const round of line.detail.rounds) {
      const chosen = line.selections.find(s => s.roundId === round.id)?.choices || [];
      for (const c of chosen) {
        const choice = round.choices.find(x => x.code === c.code);
        if (!choice) continue;
        for (let i = 0; i < c.quantity * line.quantity; i++) units.push({ code: c.code, name: choice.name, image: choice.image, source: line.name });
      }
    }
    if (!line.detail.rounds.length) for (let i = 0; i < line.quantity; i++) units.push({ code: line.code, name: line.name, image: line.detail.image, source: line.name });
    return units.map((u, i) => ({ ...u, id: `${line.id}-${i}` }));
  });
}
export function makeShareText(state, people, units, confirmed, now = Date.now()) {
  const valid = isQuoteCurrent(state, now), q = state.quote;
  const lines = ['🍔 套餐拼图 · 真实餐单', `门店：${state.store?.name || '未选择'}（到店自取）`, state.store?.address || '', ''];
  for (const p of people) lines.push(`${confirmed.includes(p.id) ? '✓' : '○'} ${p.name}：${units.filter(u => u.owner === p.id).map(u => u.name).join('、') || '暂未分到餐品'}`);
  const spare = units.filter(u => !u.owner);
  if (spare.length) lines.push(`待分配：${spare.map(u => u.name).join('、')}`);
  lines.push('', '餐单：', ...state.cart.map(c => `${c.name} ×${c.quantity}`));
  if (valid) lines.push(`官方核价合计：¥${formatMoney(q.total)}`, `核价时间：${new Date(q.quotedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`, '报价为当时快照，不锁价。');
  else lines.push('尚无当前有效报价，请回到页面重新核价。');
  const conditions = state.cart.filter(c => c.condition || c.requiresCard);
  if (conditions.length) lines.push('', '菜单优惠条件：', ...conditions.map(c => `${c.name}：${c.condition || '含购卡条件'}；展示价不代表本次核价。`));
  lines.push('', '未附加购卡、未指定优惠券；特调使用门店默认选项。', '本清单未下单、未支付；餐盘确认由本机操作者记录。');
  return lines.filter((line, i) => line || lines[i - 1]).join('\n');
}
