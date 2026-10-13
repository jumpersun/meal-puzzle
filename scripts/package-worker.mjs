import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['index.html', 'live.js', 'live-state.js', 'wish-planner.js', 'wishes.js', 'live.css', 'style.css', 'art.js', 'demo.html', 'app.js', 'engine.js'];
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };
const assets = {};
for (const file of files) assets[`/${file}`] = { body: await readFile(resolve(root, 'public', file), 'utf8'), type: types[file.split('.').pop()] };
const shared = (await readFile(resolve(root, 'public/live-state.js'), 'utf8')).replace(/^export /gm, '');
const planner = (await readFile(resolve(root, 'public/wish-planner.js'), 'utf8')).replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const api = (await readFile(resolve(root, 'server/api.mjs'), 'utf8')).replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const worker = (await readFile(resolve(root, 'worker/index.js'), 'utf8')).replace("import { handleApi } from '../server/api.mjs';", '').replace(/^export /gm, '');
const manifest = JSON.parse(await readFile(resolve(root, '.openai/hosting.json'), 'utf8'));
if (manifest.static) throw new Error('Worker manifest must not declare static output');
// Only the explicit public-file allowlist and server source enter the deployment. Never traverse .env or artifacts/.
await rm(resolve(root, 'dist'), { recursive: true, force: true });
await mkdir(resolve(root, 'dist/server'), { recursive: true });
await mkdir(resolve(root, 'dist/.openai'), { recursive: true });
await writeFile(resolve(root, 'dist/server/index.js'), `${shared}\n${planner}\n${api}\n${worker}\nexport default createWorker(${JSON.stringify(assets)});\n`);
await writeFile(resolve(root, 'dist/.openai/hosting.json'), JSON.stringify(manifest, null, 2) + '\n');
const built = (await import(new URL('../dist/server/index.js', import.meta.url))).default;
const home = await built.fetch(new Request('https://site.test/'), {});
const hidden = await built.fetch(new Request('https://site.test/.env'), {});
if (home.status !== 200 || hidden.status !== 404) throw new Error('Worker artifact validation failed');
console.log('Worker artifact prepared and validated (no dependencies).');
