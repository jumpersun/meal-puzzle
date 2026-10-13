import { WISH_KINDS, MAX_WISHES, wishTotals, exampleWishes } from './wish-planner.js';
import { formatMoney, unitsForCart } from './live-state.js';

export function createWishPlanner({ getPeople, getStore, getMenu, hasMenu, hasCart, api, cancel, onChange, onApply, picture, escape: esc }) {
  const $ = s => document.querySelector(s);
  let revision = 0, result = null, pending = false, error = '', expiry;
  const kindName = kind => WISH_KINDS.find(k => k.id === kind)?.name || kind;
  const describe = counts => counts.map(c => `${kindName(c.kind)} ×${c.quantity}`).join('、');
  const total = () => Object.values(wishTotals(getPeople())).reduce((a, b) => a + b, 0);
  function invalidate() {
    revision++; cancel(); result = null; pending = false; error = ''; clearTimeout(expiry); render();
  }
  function render() {
    const count = total();
    $('#wish-count').textContent = `${getPeople().length} 位搭子 · ${count}/${MAX_WISHES} 份心愿`;
    $('#wish-people').innerHTML = getPeople().map(p => `<article class="wish-person"><button class="wish-person-name" data-person="${p.id}">${esc(p.name)} <small>改名字</small></button><div class="wish-options">${WISH_KINDS.map(k => {
      const n = p.wants?.[k.id] || 0;
      return `<div class="wish-option ${n ? 'chosen' : ''}"><span>${k.icon} ${k.name}</span><div class="counter"><button data-wish-person="${p.id}" data-kind="${k.id}" data-delta="-1" aria-label="减少${esc(p.name)}的${k.name}" ${n ? '' : 'disabled'}>−</button><output aria-label="${esc(p.name)}的${k.name}份数">${n}</output><button data-wish-person="${p.id}" data-kind="${k.id}" data-delta="1" aria-label="增加${esc(p.name)}的${k.name}" ${n >= 3 || count >= MAX_WISHES ? 'disabled' : ''}>＋</button></div></div>`;
    }).join('')}</div></article>`).join('');
    $('#wish-add-person').disabled = getPeople().length >= 6;
    $('#generate-plans').disabled = !hasMenu() || !count || pending;
    $('#generate-plans').textContent = pending ? '正在拼餐并逐桌核价…' : result ? '重新拼一桌 ↻' : '帮我们拼一桌 ✦';
    $('#wish-status').textContent = error || (pending ? '正在查看套餐可换选项，并向麦当劳核清候选价格。通常需要几十秒，可继续调整心愿。' : !getStore() ? '先选上面的餐厅，再来拼这一桌。' : !count ? '点 ＋ 告诉我们每个人想吃什么，也可以先填入示例心愿。' : `${count} 份心愿已准备好，生成方案后仍可调整具体搭配。`);
    $('#wish-status').classList.toggle('error-message', Boolean(error));
    renderPlans();
  }
  function renderPlans() {
    if (!result) { $('#plan-results').innerHTML = ''; return; }
    const expired = result.expiresAt <= Date.now();
    const bestPrice = Math.min(...result.plans.filter(p => p.matched === Math.max(...result.plans.map(c => c.matched))).map(p => p.quote.total));
    $('#plan-results').innerHTML = `<p class="plan-scope">看过 ${result.scope.productsInspected} 款餐品或套餐，已核价 ${result.scope.candidatesQuoted} 个候选。按心愿满足度、实际总价排序，未遍历全菜单，不保证全局最低价。${result.scope.failedDetails || result.scope.failedQuotes ? '部分餐品或候选暂不可用，已跳过。' : ''}</p>${expired ? '<p class="error-message" role="status">候选报价已过期，请重新拼一桌。</p>' : ''}<div class="plan-grid">${result.plans.map((plan, index) => {
      const units = unitsForCart(plan.cart), assigned = plan.matched;
      const budget = result.budget === null ? '' : plan.quote.total <= result.budget ? `预算内 · 还余 ¥${formatMoney(result.budget - plan.quote.total)}` : `超预算 ¥${formatMoney(plan.quote.total - result.budget)}，可减少心愿再试`;
      return `<article class="plan-card"><div class="plan-topline"><span>方案 ${index + 1}</span><span class="plan-tag">${assigned === plan.wanted ? plan.quote.total === bestPrice ? '满足心愿 · 候选较低价' : '满足全部心愿' : '部分满足'}</span></div><div class="plan-pictures">${plan.cart.slice(0, 4).map(p => picture(p)).join('')}</div><h3>${plan.cart.map(c => `${esc(c.name)} ×${c.quantity}`).join(' + ')}</h3><div class="plan-price">${expired ? '报价已过期' : '¥' + formatMoney(plan.quote.total)}<small>${expired ? '重新生成后可选' : '本次官方整桌核价'}</small></div>${budget && !expired ? `<p class="plan-budget ${plan.quote.total > result.budget ? 'over-budget' : ''}">${budget}</p>` : ''}<p class="plan-coverage">已满足 ${assigned}/${plan.wanted} 份心愿 · 多出 ${plan.extraCount} 份</p>${plan.missing.length ? `<p class="plan-missing">还缺：${describe(plan.missing)}</p>` : ''}<details><summary>看具体搭配与优惠条件</summary><ul>${units.map(u => `<li>${esc(u.name)}</li>`).join('')}</ul>${plan.quote.conditions.map(c => `<p>${esc(c.name)}：${esc(c.condition || '菜单未标注额外优惠条件')}${c.requiresCard ? '；展示价含购卡条件，本方案未附加购卡' : ''}。</p>`).join('')}<p>核价时间：${new Date(plan.quote.quotedAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}。份数按一份餐品计，具体杯型、冷热及内容以上述选配为准。</p></details><button class="primary" data-apply-plan="${plan.id}" ${expired ? 'disabled' : ''}>${hasCart() ? '用这桌替换当前餐桌' : '选这桌，按心愿分好'} →</button></article>`;
    }).join('')}</div>`;
  }
  async function generate() {
    if (!hasMenu() || !total() || pending) return;
    const value = $('#wish-budget').value.trim();
    const budget = value ? Math.round(Number(value) * 100) : null;
    if (value && (!/^\d{1,4}(\.\d{1,2})?$/.test(value) || budget <= 0)) { error = '预算请输入 0.01–9999.99 元，或留空。'; render(); return; }
    const ticket = ++revision, storeCode = getStore().code;
    pending = true; result = null; error = ''; clearTimeout(expiry); render();
    try {
      const data = await api('plans', { storeCode, revision: ticket, people: getPeople().map(p => ({ id: p.id, wants: p.wants || {} })), budget }, 'plans');
      if (revision !== ticket || getStore()?.code !== storeCode || data.revision !== ticket || data.storeCode !== storeCode) return;
      result = data; expiry = setTimeout(renderPlans, Math.max(0, data.expiresAt - Date.now()) + 50);
    } catch (e) { if (ticket === revision && e.name !== 'AbortError') error = e.message; }
    finally { if (ticket === revision) { pending = false; render(); } }
  }
  $('#wish-panel').addEventListener('click', e => {
    const button = e.target.closest('button'); if (!button || button.disabled) return;
    if (button.dataset.wishPerson) {
      const person = getPeople().find(p => p.id === button.dataset.wishPerson), kind = button.dataset.kind;
      if (!person || !WISH_KINDS.some(k => k.id === kind)) return;
      person.wants ||= {}; person.wants[kind] = Math.max(0, Math.min(3, (person.wants[kind] || 0) + Number(button.dataset.delta)));
      invalidate(); onChange();
    } else if (button.id === 'wish-example') {
      const examples = exampleWishes(getMenu());
      getPeople().forEach((p, i) => { p.wants = { ...(examples[i] || {}) }; }); invalidate(); onChange();
    } else if (button.id === 'generate-plans') generate();
    else if (button.dataset.applyPlan) {
      if (!result || result.revision !== revision || result.storeCode !== getStore()?.code || result.expiresAt <= Date.now()) { invalidate(); error = '候选已变化或过期，请重新拼一桌。'; render(); return; }
      const plan = result.plans.find(p => p.id === button.dataset.applyPlan); if (!plan) return;
      onApply(structuredClone(plan.cart)); renderPlans();
    }
  });
  $('#wish-budget').addEventListener('input', invalidate);
  return { render, renderPlans, invalidate };
}
