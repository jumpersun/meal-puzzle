import { handleApi } from '../server/api.mjs';

export function createWorker(assets) {
  return { async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    // Sites Dispatch enforces the existing owner-private audience before requests reach this Worker.
    if (pathname.startsWith('/api/')) return handleApi(request, env);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    const asset = assets[pathname === '/' ? '/index.html' : pathname];
    if (!asset) return new Response('Not found', { status: 404 });
    // Cloudflare reads the response nonce for its injected JavaScript Detection script.
    // Issue it per HTML response; cached markup must never reuse a previous nonce.
    const html = asset.type.startsWith('text/html');
    const nonce = html ? btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))) : null;
    const body = html ? asset.body.replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`) : asset.body;
    return new Response(request.method === 'HEAD' ? null : body, { headers: {
      'Content-Type': asset.type, 'Cache-Control': html ? 'private, no-store' : 'no-cache', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin', 'Content-Security-Policy': `default-src 'self'; script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://menu-img.mcd.cn; connect-src 'self'; base-uri 'self'; form-action 'self'`,
    } });
  } };
}
