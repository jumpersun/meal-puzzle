import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { Readable } from 'node:stream';
import { handleApi } from './server/api.mjs';
const root = fileURLToPath(new URL('./public/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
export function createLocalServer(api = handleApi, env = process.env) {
return createServer(async (req,res) => {
  try {
    const port = req.socket.localPort;
    const host = req.headers.host || `127.0.0.1:${port}`;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) { res.writeHead(403); res.end('Forbidden'); return; }
    const url = new URL(req.url, `http://${host}`);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('/api/')) {
      const controller = new AbortController();
      const disconnect = () => { if (!res.writableEnded) controller.abort(new DOMException('Client disconnected', 'AbortError')); };
      req.once('aborted', disconnect); res.once('close', disconnect);
      try {
        const request=new Request(url,{method:req.method,headers:req.headers,signal:controller.signal,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{} )});
        const response=await api(request,env);
        const body=Buffer.from(await response.arrayBuffer());
        if (!res.destroyed) { res.writeHead(response.status,Object.fromEntries(response.headers));res.end(body); }
      } finally { req.removeListener('aborted', disconnect); res.removeListener('close', disconnect); }
      return;
    }
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep) || !['GET','HEAD'].includes(req.method)) { res.writeHead(404); res.end(); return; }
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { if (!res.destroyed) { res.writeHead(404); res.end('Not found'); } }
});
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const port = Number(process.env.PORT || 4317);
  createLocalServer().listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
}
