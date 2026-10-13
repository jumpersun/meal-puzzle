import { handleApi } from '../server/api.mjs';

export function createWorker(assets) {
  return { async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    // Sites Dispatch enforces the existing owner-private audience before requests reach this Worker.
    if (pathname.startsWith('/api/')) return handleApi(request, env);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    const asset = assets[pathname === '/' ? '/index.html' : pathname];
    if (!asset) return new Response('Not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : asset.body, { headers: {
      'Content-Type': asset.type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://menu-img.mcd.cn; connect-src 'self'; base-uri 'self'; form-action 'self'",
    } });
  } };
}
