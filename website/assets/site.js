document.documentElement.classList.add('js-enabled');
const menu = document.querySelector('#menu-toggle');
const nav = document.querySelector('#site-nav');
if (menu && nav) {
  menu.hidden = false;
  nav.dataset.open = 'false';
  const setMenu = open => { nav.dataset.open = String(open); menu.setAttribute('aria-expanded', String(open)); };
  menu.addEventListener('click', () => setMenu(menu.getAttribute('aria-expanded') !== 'true'));
  nav.addEventListener('click', event => { if (event.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') { setMenu(false); menu.focus(); }
  });
}
const demoButtons = [...document.querySelectorAll('[data-demo]')];
const demoPanels = [...document.querySelectorAll('[data-demo-panel]')];
const demoCaptions = {
  skill: '示例工程记录 · Agent 在仓库中维护需求、任务和验证证据。',
  workbench: '示例阅读视图 · OpenFolio 展示已推送的 Specs 与 Changes。',
  prototype: '示例设计版本 · 原型引用保留在当前清单和对应 Change 中。',
};
if (demoButtons.length) {
  document.querySelector('.demo-tabs').hidden = false;
  demoPanels.forEach(panel => { panel.hidden = panel.dataset.demoPanel !== 'skill'; panel.classList.remove('no-js-panel'); });
  demoButtons.forEach(button => button.addEventListener('click', () => {
    demoButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    demoPanels.forEach(panel => { panel.hidden = panel.dataset.demoPanel !== button.dataset.demo; });
    document.querySelector('#demo-caption').textContent = demoCaptions[button.dataset.demo];
  }));
}
document.querySelectorAll('[data-install-group]').forEach(group => {
  const controls = group.querySelector('.install-tabs');
  if (!controls) return;
  controls.hidden = false;
  const panels = [...group.querySelectorAll('[data-client-panel]')];
  panels.forEach(panel => { panel.hidden = panel.dataset.clientPanel !== 'codex'; });
  controls.querySelectorAll('[data-client]').forEach(button => button.addEventListener('click', () => {
    controls.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    panels.forEach(panel => { panel.hidden = panel.dataset.clientPanel !== button.dataset.client; });
    const status = group.querySelector('.copy-status');
    if (status) status.textContent = '';
    group.querySelector('.copy-fallback')?.remove();
  }));
});
document.querySelectorAll('[data-copy]').forEach(button => {
  button.hidden = false;
  button.addEventListener('click', async () => {
    const target = document.getElementById(button.dataset.copy);
    const region = button.closest('[data-copy-region]') || button.closest('[data-install-group]');
    const status = region?.querySelector('.copy-status');
    region?.querySelector('.copy-fallback')?.remove();
    try {
      await navigator.clipboard.writeText(target.textContent.trim());
      if (status) status.textContent = '已复制，可以粘贴到终端或 Agent 对话中。';
    } catch {
      if (status) status.textContent = '浏览器未允许复制，请选中下方内容手动复制。';
      const fallback = document.createElement('textarea');
      fallback.className = 'copy-fallback'; fallback.readOnly = true;
      fallback.setAttribute('aria-label', '手动复制内容'); fallback.value = target.textContent.trim();
      region?.append(fallback); fallback.focus(); fallback.select();
    }
  });
});
