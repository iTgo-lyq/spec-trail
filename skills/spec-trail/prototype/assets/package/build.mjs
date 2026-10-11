import { readFile, readdir, realpath, mkdir, writeFile, lstat } from 'node:fs/promises';
import { dirname, join, relative, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = await realpath(dirname(fileURLToPath(import.meta.url)));
const mime = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
async function read(path) {
  const actual = await realpath(path), rel = relative(root, actual);
  if (rel.startsWith('..') || rel.startsWith('/')) throw Error('资源必须在当前原型包内');
  return readFile(actual);
}
async function expand(path, parents = []) {
  const absolute = resolve(path);
  if (parents.includes(absolute) || parents.length > 20) throw Error('循环或过深的 include');
  let text = (await read(absolute)).toString();
  const matches = [...text.matchAll(/\{\{(include|data):([^}]+)\}\}/g)];
  for (const [token, kind, value] of matches) {
    const target = resolve(dirname(absolute), value.trim());
    let replacement;
    if (kind === 'include') replacement = await expand(target, [...parents, absolute]);
    else {
      const type = mime[extname(target).toLowerCase()];
      if (!type) throw Error(`不支持内联素材类型：${target}`);
      replacement = `data:${type};base64,${(await read(target)).toString('base64')}`;
    }
    text = text.replace(token, () => replacement);
  }
  return text;
}
let count = 0;
for (const file of await readdir(join(root, 'src/pages'))) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.html$/.test(file)) continue;
  const output = join(root, process.argv.includes('--hosted') ? 'dist' : 'preview', file.slice(0, -5));
  const html = await expand(join(root, 'src/pages', file));
  await mkdir(output, { recursive: true });
  const actual = await realpath(output);
  if (relative(root, actual).startsWith('..')) throw Error('输出目录不能越过原型包');
  const target = join(output, 'index.html');
  const prior = await lstat(target).catch(e => { if(e.code === 'ENOENT') return null; throw e; });
  if(prior && (!prior.isFile() || prior.isSymbolicLink())) throw Error('输出入口不能是符号链接或特殊文件');
  await writeFile(target, html);
  count++;
}
if (!count) throw Error('src/pages 下没有可导出的 HTML 入口');
console.log(`Exported ${count} self-contained preview(s).`);
