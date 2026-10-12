import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { root } from './build.mjs';

export const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8' };
export function startServer({ port = 4175, directory = join(root, 'dist/website'), prefix = '' } = {}) {
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (prefix && !path.startsWith(`${prefix}/`)) { response.writeHead(404); response.end(); return; }
      const relative = (prefix ? path.slice(prefix.length) : path).replace(/^\/+/, '') || 'index.html';
      const file = resolve(directory, relative);
      if (!file.startsWith(`${resolve(directory)}/`)) throw Error('Invalid path');
      const data = await readFile(file);
      response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  return new Promise(resolveServer => server.listen(port, '127.0.0.1', () => resolveServer(server)));
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const server = await startServer({ port: Number(process.argv[2] || 4175) });
  console.log(`Local: http://127.0.0.1:${server.address().port}/`);
}
