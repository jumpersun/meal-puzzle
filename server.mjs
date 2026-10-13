import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { handleApi } from './server/api.mjs';
try { process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const root = fileURLToPath(new URL('./public/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT || 4317);
createServer(async (req,res) => {
  try {
    const host = req.headers.host || `127.0.0.1:${port}`;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) { res.writeHead(403); res.end('Forbidden'); return; }
    const url = new URL(req.url, `http://${host}`);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('/api/')) {
      const chunks=[]; let size=0;
      for await (const chunk of req) { size+=chunk.length; if(size>32000){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk); }
      const body=Buffer.concat(chunks);
      const request=new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body}:{} )});
      const response=await handleApi(request,process.env);
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep) || !['GET','HEAD'].includes(req.method)) { res.writeHead(404); res.end(); return; }
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
