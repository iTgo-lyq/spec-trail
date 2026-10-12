import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { root, files, pages, installation } from './build.mjs';

export async function check(directory = join(root, 'dist/website')) {
  const actual = [];
  async function walk(path = '') {
    for (const entry of await readdir(join(directory, path), { withFileTypes: true })) {
      const name = path ? `${path}/${entry.name}` : entry.name;
      assert(!entry.isSymbolicLink(), `Symlink in static output: ${name}`);
      if (entry.isDirectory()) await walk(name);
      else { assert(entry.isFile(), `Invalid static file: ${name}`); actual.push(name); }
    }
  }
  await walk();
  assert.deepEqual(actual.sort(), [...files].sort(), 'Website must contain only its declared public files');
  const documents = new Map();
  const ids = new Map();
  for (const page of pages) {
    const html = await readFile(join(directory, page), 'utf8');
    assert(html.includes('<html lang="zh-CN">'), `${page}: language`);
    assert(!/\{\{[A-Z_]+\}\}/.test(html), `${page}: unresolved template`);
    assert.equal([...html.matchAll(/<h1(?:\s[^>]*)?>/g)].length, 1, `${page}: single main heading`);
    assert(html.includes('id="main"'), `${page}: skip link target`);
    const identifiers = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(identifiers).size, identifiers.length, `${page}: duplicate IDs`);
    documents.set(page, html); ids.set(page, new Set(identifiers));
  }
  for (const [page, html] of documents) {
    for (const [, raw] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const url = new URL(raw, `https://static.example/${page}`);
      if (url.origin !== 'https://static.example') {
        assert.equal(url.protocol, 'https:', `${page}: external links must use HTTPS`);
        assert(!url.username && !url.password, `${page}: credential-bearing link`); continue;
      }
      const target = url.pathname.slice(1) || 'index.html';
      assert(files.includes(target), `${page}: missing local file ${target}`);
      if (url.hash) assert(ids.get(target)?.has(decodeURIComponent(url.hash.slice(1))), `${page}: missing anchor ${target}${url.hash}`);
    }
    for (const [, target] of html.matchAll(/\bdata-copy="([^"]+)"/g)) assert(ids.get(page).has(target), `${page}: invalid copy target ${target}`);
  }
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  for (const page of ['index.html', 'skill.html']) {
    for (const agent of ['codex', 'claude-code']) {
      assert(readme.includes(installation(agent)), 'Installation must match the distribution README');
      assert(documents.get(page).includes(installation(agent)), `${page}: installation`);
    }
  }
  const metadata = JSON.parse(await readFile(join(directory, 'site.json'), 'utf8'));
  assert.equal(metadata.product, 'SpecTrail');
  assert.match(metadata.commit, /^[a-f0-9]{40}$/);
  assert.deepEqual(metadata.modules, ['skill', 'workbench', 'prototypes']);
  for (const file of files) {
    assert((await stat(join(directory, file))).size < 25 * 1024 * 1024, `Pages file too large: ${file}`);
    if (file === 'site.json') continue;
    const bytes = await readFile(join(directory, file));
    assert.deepEqual(metadata.files[file], { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return { pages: pages.length, files: files.length, commit: metadata.commit };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await check())); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
