const validCode = code => typeof code === 'string' && /^\d{1,24}$/.test(code);
function officialImage(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'menu-img.mcd.cn' && !url.port && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// Child selections often omit pictures in MCP combo details. Resolve only current-table
// children, independently of pricing, so a slow image cannot invalidate a good quote.
export function createProductImages({ load, onChange = () => {}, now = Date.now }) {
  const cache = new Map(), pending = new Map();
  let currentStore = null, wanted = new Set(), active = 0;
  const keyFor = (store, code) => `${store}:${code}`;
  function cached(key) {
    const entry = cache.get(key);
    if (entry && entry.expiresAt <= now()) { cache.delete(key); return null; }
    return entry;
  }
  function remember(key, image) {
    cache.delete(key);
    if (cache.size >= 300) cache.delete(cache.keys().next().value);
    cache.set(key, { image, expiresAt: now() + (image ? 300000 : 30000) });
  }
  function isCurrent(job) {
    return !job.controller.signal.aborted && currentStore === job.storeCode && wanted.has(job.code);
  }
  async function run(job) {
    try {
      job.controller.signal.throwIfAborted();
      const detail = await load({ storeCode: job.storeCode, code: job.code, signal: job.controller.signal });
      if (!isCurrent(job)) return;
      const image = detail?.code === job.code && (!detail.storeCode || detail.storeCode === job.storeCode) ? officialImage(detail.image) : null;
      remember(job.key, image);
      if (image) onChange(job.code);
    } catch {
      if (isCurrent(job)) remember(job.key, null);
    } finally {
      active--;
      if (pending.get(job.key) === job) pending.delete(job.key);
      pump();
    }
  }
  function pump() {
    for (const job of pending.values()) {
      if (active >= 4) break;
      if (job.started) continue;
      job.started = true; active++; void run(job);
    }
  }
  function sync(storeCode, codes) {
    currentStore = validCode(storeCode) ? storeCode : null;
    wanted = new Set(currentStore ? [...new Set(codes.filter(validCode))].slice(0, 60) : []);
    for (const [key, job] of pending) {
      if (job.storeCode !== currentStore || !wanted.has(job.code)) {
        pending.delete(key); job.controller.abort();
      }
    }
    for (const code of wanted) {
      const key = keyFor(currentStore, code);
      if (!cached(key) && !pending.has(key)) pending.set(key, { key, storeCode: currentStore, code, controller: new AbortController(), started: false });
    }
    pump();
  }
  function clear(storeCode) {
    if (currentStore === storeCode) sync(null, []);
    for (const key of cache.keys()) if (key.startsWith(`${storeCode}:`)) cache.delete(key);
  }
  return { sync, clear, get: (storeCode, code) => cached(keyFor(storeCode, code))?.image || null };
}
