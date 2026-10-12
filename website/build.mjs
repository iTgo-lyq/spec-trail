import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const pages = ['index.html', 'skill.html', 'workbench.html', 'prototypes.html'];
export const files = [...pages, 'assets/mark.svg', 'assets/style.css', 'assets/site.js', 'assets/openfolio.png', '_headers', 'site.json'];
export const installation = agent => `npx skills add iTgo-lyq/spec-trail --skill spec-trail --agent ${agent} --copy -y`;
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function header(page) {
  const item = (href, title) => `<a href="${href}"${page === href ? ' aria-current="page"' : ''}>${title}</a>`;
  return `<a class="skip-link" href="#main">跳到主要内容</a><header class="site-header"><div class="container header-inner"><a class="brand" href="./" aria-label="SpecTrail 首页"><img src="assets/mark.svg" width="32" height="32" alt=""><span>SpecTrail</span></a><button id="menu-toggle" class="menu-toggle" aria-expanded="false" aria-controls="site-nav" hidden>菜单 <span aria-hidden="true">☰</span></button><nav id="site-nav" class="site-nav" aria-label="主导航">${item('skill.html', 'Skill')}${item('workbench.html', '工作台')}${item('prototypes.html', '原型管理')}<a href="https://github.com/iTgo-lyq/spec-trail">GitHub ↗</a><a class="button button-small" href="skill.html#install">开始使用</a></nav></div></header>`;
}
const footer = `<footer class="container site-footer"><a class="brand" href="./"><img src="assets/mark.svg" width="25" height="25" alt=""><span>SpecTrail</span></a><span>Git 中的工程记录 · MIT License</span><nav aria-label="页脚导航"><a href="https://github.com/iTgo-lyq/spec-trail">Skill 源码</a><a href="workbench.html">OpenFolio 工作台</a><a href="https://github.com/iTgo-lyq/spec-trail/issues">反馈</a><a href="https://runweft.pages.dev/">Runweft</a></nav></footer>`;
function install(page) {
  const id = page.split('.')[0];
  return `<div data-install-group><div class="install-tabs" role="group" aria-label="选择 Agent" hidden><button data-client="codex" aria-pressed="true">Codex</button><button data-client="claude-code" aria-pressed="false">Claude Code</button></div>${['codex', 'claude-code'].map(agent => `<div class="terminal" data-client-panel="${agent}"><div class="terminal-head"><span class="terminal-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${agent === 'codex' ? 'Codex' : 'Claude Code'} · 项目内安装</span><button class="copy-button" data-copy="${id}-${agent}-command" hidden>复制</button></div><pre tabindex="0"><code id="${id}-${agent}-command">${escape(installation(agent))}</code></pre><div class="terminal-foot">在目标 Git 项目根目录执行</div></div>`).join('')}<p class="copy-status" role="status" aria-live="polite"></p></div>`;
}

export async function build() {
  const output = join(root, 'dist/website');
  await mkdir(dirname(output), { recursive: true });
  const staging = await mkdtemp(join(dirname(output), '.website-'));
  const backup = `${staging}-previous`;
  let moved = false;
  try {
    await cp(join(root, 'website/assets'), join(staging, 'assets'), { recursive: true });
    for (const page of pages) {
      const source = await readFile(join(root, 'website', page), 'utf8');
      const replacements = { HEADER: header(page), FOOTER: footer, INSTALL: install(page) };
      const html = source.replace(/\{\{([A-Z_]+)\}\}/g, (_, name) => {
        if (!(name in replacements)) throw Error(`Unknown placeholder: ${name}`);
        return replacements[name];
      });
      await writeFile(join(staging, page), html);
    }
    await cp(join(root, 'website/_headers'), join(staging, '_headers'));
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const assets = {};
    for (const file of files.filter(name => name !== 'site.json')) {
      const data = await readFile(join(staging, file));
      assets[file] = { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
    }
    await writeFile(join(staging, 'site.json'), JSON.stringify({ product: 'SpecTrail', commit, modules: ['skill', 'workbench', 'prototypes'], files: assets }, null, 2) + '\n');
    try { await rename(output, backup); moved = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await rename(staging, output); } catch (error) { if (moved) await rename(backup, output); moved = false; throw error; }
    if (moved) await rm(backup, { recursive: true });
    return { directory: output, commit, files: files.length };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await build())); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
