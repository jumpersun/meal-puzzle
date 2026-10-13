import { WISH_KINDS, MAX_WISHES, wishTotals, selectPlannerProducts, buildCandidateCarts } from '../public/wish-planner.js';

const MCP_ENDPOINT = 'https://mcp.mcd.cn';
const READ_TOOLS = new Set(['query-nearby-stores', 'query-meals', 'query-meal-detail', 'calculate-price']);
const MAX_BODY = 32000;
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const invalid = message => { throw new ApiError(400, 'INVALID_INPUT', message); };
const textValue = (value, max = 160) => typeof value === 'string' ? value.slice(0, max) : '';
const numericCode = value => typeof value === 'string' && /^\d{1,24}$/.test(value) ? value : invalid('餐厅或餐品编码无效，请重新选择。');
const integer = (value, min, max, message) => Number.isSafeInteger(value) && value >= min && value <= max ? value : invalid(message);

export function yuanToCents(value) {
  if (typeof value !== 'string' || !/^\d{1,7}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, decimal = ''] = value.split('.');
  return Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
}
export function productImage(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'menu-img.mcd.cn' && !url.port && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function normalizeMenu(data) {
  if (!data || !Array.isArray(data.categories) || !data.meals || typeof data.meals !== 'object') throw new ApiError(502, 'INVALID_RESPONSE', '菜单格式有变化，请稍后重试。');
  const products = Object.entries(data.meals).map(([code, meal]) => ({
    code, name: textValue(meal.name), image: productImage(meal.image), displayPrice: yuanToCents(meal.currentPrice), originalPrice: yuanToCents(meal.originalPrice),
    condition: textValue(meal.discountType), requiresCard: meal.canWithOrder === true || Boolean(meal.withOrder),
  })).filter(p => /^\d{1,24}$/.test(p.code) && p.name);
  const codes = new Set(products.map(p => p.code));
  return {
    products,
    categories: data.categories.map(c => ({ name: textValue(c.name, 50).replace(/\s+/g, ' '), codes: (c.meals || []).map(m => m.code).filter(code => codes.has(code)) })),
  };
}
export function normalizeDetail(data) {
  if (!data || !data.code || !data.name) throw new ApiError(502, 'INVALID_RESPONSE', '餐品详情暂不可用，请重新选择。');
  return { code: data.code, name: textValue(data.name), image: productImage(data.image), supportModify: data.supportModify === true,
    rounds: (data.rounds || []).map(r => ({ id: String(r.id), name: textValue(r.name), min: r.minQuantity, max: r.maxQuantity,
      choices: (r.choices || []).map(c => ({ code: c.code, name: textValue(c.name), image: productImage(c.image), max: c.maxQuantity, quantity: c.isDefault === 1 ? c.quantity : 0, difference: textValue(c.diffPrice, 60), supportModify: c.supportModify === true })),
    })),
  };
}
function defaultModifications(modification) {
  const values = (modification?.items || []).flatMap(group => group.values || []).flatMap(v => {
    if (v.selectedQuantity > 0) return [{ code: v.code, key: v.selectedKey, quantity: v.selectedQuantity }];
    return v.unselectedKey ? [{ code: v.code, key: v.unselectedKey, quantity: 0 }] : [];
  });
  return values.length ? { modification: { values } } : {};
}

// Rebuild provider arguments from fresh details. Browser prices, coupon IDs and card purchases are never forwarded.
export function prepareItem(item, detail) {
  const quantity = integer(item.quantity, 1, 6, '每个餐品或套餐最多选 6 份。');
  if (item.code !== detail.code) invalid('餐品详情不匹配，请重新选择。');
  if (Object.keys(item).some(key => !['id', 'code', 'quantity', 'selections'].includes(key))) invalid('餐单包含不支持的选项。');
  if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id)) invalid('餐单行标识无效。');
  const selections = item.selections;
  if (!Array.isArray(selections) || selections.length > 20) invalid('套餐选项无效。');
  const rounds = detail.rounds || [];
  if (selections.length !== rounds.length || new Set(selections.map(s => s.roundId)).size !== selections.length) invalid('请完成每一组套餐选择。');
  const units = [];
  const roundList = rounds.map(round => {
    const selected = selections.find(s => s.roundId === String(round.id));
    if (!selected || !Array.isArray(selected.choices) || selected.choices.length > 20) invalid('请完成每一组套餐选择。');
    if (new Set(selected.choices.map(c => c.code)).size !== selected.choices.length) invalid('同一选配项不能重复提交。');
    const comboItemList = selected.choices.map(c => {
      const choice = round.choices.find(option => option.code === c.code);
      if (!choice) invalid('套餐选项已变化，请重新打开餐品。');
      const max = choice.maxQuantity >= 0 ? Math.min(choice.maxQuantity, round.maxQuantity) : round.maxQuantity;
      const q = integer(c.quantity, 1, Math.min(max, 20), '套餐选配数量不正确。');
      for (let i = 0; i < q * quantity; i++) units.push({ code: choice.code, name: textValue(choice.name), image: productImage(choice.image), source: textValue(detail.name) });
      return { code: choice.code, quantity: q, ...defaultModifications(choice.modification) };
    });
    const sum = comboItemList.reduce((n, c) => n + c.quantity, 0);
    if (sum < round.minQuantity || sum > round.maxQuantity) invalid(`${textValue(round.name, 40)}需要选择 ${round.minQuantity}–${round.maxQuantity} 份。`);
    return { round: String(round.id), comboItemList };
  });
  if (!rounds.length) for (let i = 0; i < quantity; i++) units.push({ code: detail.code, name: textValue(detail.name), image: productImage(detail.image), source: textValue(detail.name) });
  if (units.length > 60) invalid('这一桌最多容纳 60 份餐品，请减少数量。');
  return { providerItem: { productCode: detail.code, quantity, ...(roundList.length ? { roundList } : {}), ...defaultModifications(detail.modification) }, units };
}

async function readRpc(response, id) {
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(502, 'EMPTY_RESPONSE', '麦当劳服务返回为空，请重试。');
  const decoder = new TextDecoder(), sse = response.headers.get('content-type')?.includes('text/event-stream');
  let pending = '', size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) throw new ApiError(502, 'RESPONSE_LIMIT', '菜单数据过大，请缩小查询范围。');
      pending += decoder.decode(value, { stream: true });
      if (!sse) continue;
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(pending))) {
        const event = pending.slice(0, boundary.index); pending = pending.slice(boundary.index + boundary[0].length);
        const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        const parsed = JSON.parse(data), reply = (Array.isArray(parsed) ? parsed : [parsed]).find(m => m.id === id);
        if (reply) return reply;
      }
    }
    if (!sse) { const parsed = JSON.parse(pending + decoder.decode()); if (parsed.id === id) return parsed; }
    throw new ApiError(502, 'INVALID_RESPONSE', '麦当劳服务响应不完整，请重试。');
  } finally { await reader.cancel().catch(() => {}); }
}

async function readRequestBody(request) {
  if (!request.body) invalid('请求格式不正确。');
  const reader = request.body.getReader(), decoder = new TextDecoder();
  let total = 0, body = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return body + decoder.decode();
      total += value.byteLength;
      if (total > MAX_BODY) throw new ApiError(413, 'BODY_LIMIT', '餐单过大，请减少数量。');
      body += decoder.decode(value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => {}); }
}

export async function createMcpClient(token, fetcher = fetch) {
  let session, sequence = 0, protocol = '2025-03-26';
  async function rpc(method, params, notification = false) {
    const id = notification ? undefined : ++sequence;
    // The hosted edge runtime supports manual/follow only. Reject 3xx below so credentials never follow redirects.
    const response = await fetcher(MCP_ENDPOINT, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(18000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': protocol, ...(session ? { 'Mcp-Session-Id': session } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403].includes(response.status)) throw new ApiError(503, 'TOKEN_INVALID', '麦当劳连接已失效，请在服务端更新 Token 后重试。');
      if (response.status === 429) throw new ApiError(429, 'RATE_LIMITED', '查询较频繁，请稍等片刻再试。');
      throw new ApiError(502, 'UPSTREAM_HTTP', '麦当劳服务暂不可用，请稍后重试。');
    }
    if (method === 'initialize') session = response.headers.get('mcp-session-id');
    if (notification) { await response.body?.cancel(); return; }
    const reply = await readRpc(response, id);
    if (reply.error || !reply.result) throw new ApiError(502, 'UPSTREAM_RPC', '麦当劳服务未完成请求，请重试。');
    return reply.result;
  }
  const init = await rpc('initialize', { protocolVersion: protocol, capabilities: {}, clientInfo: { name: 'meal-puzzle', version: '0.2.0' } });
  if (init.protocolVersion !== protocol) throw new ApiError(502, 'PROTOCOL_CHANGED', '麦当劳连接协议已更新，请稍后重试。');
  await rpc('notifications/initialized', {}, true);
  return { async call(name, args) {
    if (!READ_TOOLS.has(name)) throw new ApiError(403, 'TOOL_NOT_ALLOWED', '不支持此操作。');
    const result = await rpc('tools/call', { name, arguments: args });
    const body = result.structuredContent;
    if (result.isError || body?.success !== true || !('data' in body)) throw new ApiError(502, 'UPSTREAM_BUSINESS', '餐品可能已停售或当前选项不可用，请刷新菜单后重试。');
    return body.data;
  } };
}

export function createApi(clientFactory = createMcpClient, now = () => Date.now()) {
  return async function api(request, env) {
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
    try {
      const url = new URL(request.url), route = url.pathname;
      if (route === '/api/status' && request.method === 'GET') return json({ configured: Boolean(env.MCD_MCP_TOKEN), diningMode: 'pickup', source: 'mcd-mcp' });
      if (!['/api/stores', '/api/menu', '/api/detail', '/api/quote', '/api/plans'].includes(route)) throw new ApiError(404, 'NOT_FOUND', '没有这个接口。');
      if (request.method !== 'POST') throw new ApiError(405, 'METHOD_NOT_ALLOWED', '请使用页面按钮发起查询。');
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) throw new ApiError(403, 'ORIGIN_DENIED', '请从本站页面发起查询。');
      if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError(415, 'INVALID_CONTENT_TYPE', '请求格式不正确。');
      if (Number(request.headers.get('content-length')) > MAX_BODY) throw new ApiError(413, 'BODY_LIMIT', '餐单过大，请减少数量。');
      const body = await readRequestBody(request);
      let args; try { args = JSON.parse(body); } catch { invalid('请求格式不正确。'); }
      if (!args || typeof args !== 'object' || Array.isArray(args)) invalid('请求格式不正确。');
      if (!env.MCD_MCP_TOKEN) throw new ApiError(503, 'NOT_CONFIGURED', '真实菜单连接尚未配置，请联系站点主人。');
      if (route === '/api/stores') {
        const city = textValue(args.city, 40).trim(), keyword = textValue(args.keyword, 80).trim();
        if (!city || !keyword) invalid('请输入城市和餐厅附近的位置。');
        const client = await clientFactory(env.MCD_MCP_TOKEN);
        const result = await client.call('query-nearby-stores', { city, keyword, searchType: 2, beType: 1 });
        if (!Array.isArray(result)) throw new ApiError(502, 'INVALID_RESPONSE', '餐厅信息暂不可用。');
        return json({ stores: result.slice(0, 20).map(s => ({ code: s.storeCode, name: textValue(s.storeName), address: textValue(s.address), open: s.businessStatus === true, hours: `${textValue(s.businessStartTime, 8)}–${textValue(s.businessEndTime, 8)}` })), fetchedAt: now() });
      }
      const storeCode = numericCode(args.storeCode), context = { storeCode, orderType: 1, beType: 1 };
      if (route === '/api/detail') numericCode(args.code);
      if (route === '/api/quote') {
        integer(args.revision, 0, 1000000000, '餐单版本无效。');
        if (!Array.isArray(args.items) || args.items.length < 1 || args.items.length > 8) invalid('请选择 1–8 种餐品或套餐。');
        if (args.items.some(i => !i || typeof i !== 'object')) invalid('餐单格式无效。');
        if (new Set(args.items.map(i => i.id)).size !== args.items.length) invalid('餐单行标识不能重复。');
        args.items.forEach(i => { numericCode(i.code); integer(i.quantity, 1, 6, '每种餐品最多 6 份。'); });
        if (Object.keys(args).some(k => !['storeCode', 'revision', 'items'].includes(k))) invalid('仅支持餐品核价，不接受购卡或优惠券操作。');
      }
      if (route === '/api/plans') validatePlanInput(args);
      const client = await clientFactory(env.MCD_MCP_TOKEN);
      if (route === '/api/menu') return json({ ...normalizeMenu(await client.call('query-meals', context)), storeCode, fetchedAt: now() });
      if (route === '/api/detail') return json({ ...normalizeDetail(await client.call('query-meal-detail', { ...context, code: args.code })), storeCode });
      const catalog = normalizeMenu(await client.call('query-meals', context));
      if (route === '/api/plans') return json(await createPlans(client, context, args, catalog, now));
      return json(await calculateCart(client, context, args, catalog, now));
    } catch (error) {
      if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message } }, error.status);
      if (['TimeoutError', 'AbortError'].includes(error?.name)) return json({ error: { code: 'TIMEOUT', message: '麦当劳服务响应较慢，请稍后重试。本次没有生成新报价。' } }, 504);
      return json({ error: { code: 'SERVICE_UNAVAILABLE', message: '真实菜单服务暂时无法连接，请重试。本次没有生成新报价。' } }, 502);
    }
  };
}
export const handleApi = createApi();

function validatePlanInput(args) {
  if (Object.keys(args).some(k => !['storeCode', 'revision', 'people', 'budget'].includes(k))) invalid('拼餐仅接受心愿、人数与整桌预算。');
  integer(args.revision, 0, 1000000000, '心愿版本无效。');
  if (!Array.isArray(args.people) || args.people.length < 1 || args.people.length > 6) invalid('请添加 1–6 位饭搭子。');
  const ids = new Set(), kinds = new Set(WISH_KINDS.map(k => k.id));
  for (const p of args.people) {
    if (!p || typeof p !== 'object' || Object.keys(p).some(k => !['id', 'wants'].includes(k)) || typeof p.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(p.id) || ids.has(p.id)) invalid('饭搭子信息无效，请重新生成。');
    ids.add(p.id);
    if (!p.wants || typeof p.wants !== 'object' || Array.isArray(p.wants)) invalid('请填写餐品心愿。');
    for (const [kind, quantity] of Object.entries(p.wants)) {
      if (!kinds.has(kind)) invalid('暂不支持这类心愿。');
      integer(quantity, 0, 3, '每人每类心愿最多 3 份。');
    }
  }
  const count = Object.values(wishTotals(args.people)).reduce((a, b) => a + b, 0);
  if (count < 1 || count > MAX_WISHES) invalid(`请填写 1–${MAX_WISHES} 份餐品心愿。`);
  if (args.budget !== null && args.budget !== undefined) integer(args.budget, 1, 999999, '预算需在 0.01–9999.99 元之间。');
}

async function createPlans(client, context, args, catalog, now) {
  const products = selectPlannerProducts(catalog, args.people), rawDetails = new Map(), details = new Map();
  let failedDetails = 0;
  // Bound both the provider fan-out and the search space; one click cannot scan the entire menu.
  for (let i = 0; i < products.length; i += 4) await Promise.all(products.slice(i, i + 4).map(async product => {
    try {
      const raw = await client.call('query-meal-detail', { ...context, code: product.code });
      if (raw.code !== product.code) throw new ApiError(502, 'INVALID_RESPONSE', '餐品详情不匹配。');
      rawDetails.set(product.code, raw); details.set(product.code, normalizeDetail(raw));
    } catch (error) {
      if (['TOKEN_INVALID', 'RATE_LIMITED', 'PROTOCOL_CHANGED'].includes(error.code) || ['AbortError', 'TimeoutError'].includes(error.name)) throw error;
      failedDetails++;
    }
  }));
  const candidates = buildCandidateCarts(catalog, details, args.people), plans = [], failures = [];
  for (const candidate of candidates) {
    try {
      const items = candidate.cart.map(({ id, code, quantity, selections }) => ({ id, code, quantity, selections }));
      const quote = await calculateCart(client, context, { ...args, items }, catalog, now, rawDetails);
      plans.push({ id: `option${plans.length + 1}`, cart: candidate.cart, matched: candidate.matched, wanted: candidate.wanted, missing: candidate.missing, extraCount: candidate.extraCount, quote });
    } catch (error) {
      if (['TOKEN_INVALID', 'RATE_LIMITED', 'PROTOCOL_CHANGED'].includes(error.code)) throw error;
      failures.push('有一个候选暂时无法核价，未作为可选方案展示。');
    }
  }
  if (!plans.length) throw new ApiError(502, 'NO_PLANS', '当前未能生成可核价方案，请减少心愿、稍后重试，或手动选餐。');
  plans.sort((a, b) => b.matched - a.matched || a.quote.total - b.quote.total || a.extraCount - b.extraCount);
  return { storeCode: context.storeCode, revision: args.revision, budget: args.budget ?? null, plans,
    scope: { productsInspected: details.size, candidatesQuoted: plans.length, failedDetails, failedQuotes: failures.length },
    expiresAt: Math.min(...plans.map(p => p.quote.expiresAt)),
  };
}

async function calculateCart(client, context, args, catalog, now, details = new Map()) {
  const prepared = [], conditions = [];
  for (const item of args.items) {
    const product = catalog.products.find(p => p.code === item.code);
    if (!product) invalid('有餐品已不在当前菜单，请刷新菜单重新选择。');
    const detail = details.get(item.code) || await client.call('query-meal-detail', { ...context, code: item.code });
    const result = prepareItem(item, detail);
    prepared.push(result);
    conditions.push({ lineId: item.id, name: product.name, displayPrice: product.displayPrice, condition: product.condition, requiresCard: product.requiresCard });
  }
  const units = prepared.flatMap((p, index) => p.units.map((unit, n) => ({ ...unit, id: `${args.items[index].id}-${n}` })));
  if (units.length > 60) invalid('这一桌最多容纳 60 份餐品，请减少数量。');
  const result = await client.call('calculate-price', { ...context, items: prepared.map(p => p.providerItem), needTableware: false });
  if (!Number.isSafeInteger(result.price) || result.price < 0 || !Array.isArray(result.productList)) throw new ApiError(502, 'INVALID_QUOTE', '核价结果不完整，请重新核价。');
  const expected = new Map(), actual = new Map();
  for (const item of args.items) expected.set(item.code, (expected.get(item.code) || 0) + item.quantity);
  for (const item of result.productList) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || !Number.isSafeInteger(item.subtotal) || item.subtotal < 0) throw new ApiError(502, 'INVALID_QUOTE', '核价明细不完整，请重试。');
    actual.set(item.productCode, (actual.get(item.productCode) || 0) + item.quantity);
  }
  if (actual.size !== expected.size || [...expected].some(([code, count]) => actual.get(code) !== count)) throw new ApiError(502, 'QUOTE_MISMATCH', '核价餐品与当前餐单不一致，请重新核价。');
  const fees = { packing: result.packingPrice ?? 0, delivery: result.deliveryPrice ?? 0, tableware: result.tablewarePrice ?? 0 };
  if (Object.values(fees).some(value => !Number.isSafeInteger(value) || value < 0)) throw new ApiError(502, 'INVALID_QUOTE', '核价费用格式有变化，请重试。');
  // Only show server-calculated savings and amounts. Menu promotional prices are informational.
  return { storeCode: context.storeCode, revision: args.revision, quotedAt: now(), expiresAt: now() + 120000, total: result.price,
    originalTotal: Number.isSafeInteger(result.originalPrice) ? result.originalPrice : null,
    discount: Number.isSafeInteger(result.discount) ? result.discount : 0,
    fees,
    products: result.productList.map(p => ({ code: p.productCode, name: textValue(p.productName), quantity: p.quantity, subtotal: p.subtotal })),
    conditions, units, purchasePolicy: '未附加购卡、未指定优惠券；特调使用门店默认选项。',
  };
}
