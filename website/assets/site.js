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
  skill: '示例 · Skill：Agent 在你的仓库里写下需求、任务、进度和验证记录。',
  workbench: '示例 · 工作台：OpenFolio 只读展示已推送的任务进度与验证记录。',
  prototype: '示例 · 原型：用示例数据演示界面，版本固定在对应的改动中。',
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
      if (status) status.textContent = button.closest('.prompt') ? "已复制提示词。请在这个项目的 Codex 或 Claude Code 对话中粘贴并发送。" : "已复制命令。请在终端中进入说明的目录，粘贴并执行。";
    } catch {
      if (status) status.textContent = "未能自动复制，请手动复制下方文本：手机上长按文本选择“复制”，电脑上按 Ctrl+C（Mac 为 ⌘C）。";
      const fallback = document.createElement('textarea');
      fallback.className = 'copy-fallback'; fallback.readOnly = true;
      fallback.setAttribute('aria-label', '待复制的内容'); fallback.value = target.textContent.trim();
      region?.append(fallback); fallback.focus(); fallback.select();
    }
  });
});
