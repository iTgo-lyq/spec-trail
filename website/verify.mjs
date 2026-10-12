import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, pages, installation } from './build.mjs';
import { startServer } from './serve.mjs';
import { check } from './check.mjs';

await check();
const modulePath = join(process.env.SPEC_TRAIL_PLAYWRIGHT || join(root, 'node_modules/playwright'), 'index.mjs');
const { chromium } = await import(pathToFileURL(modulePath).href);
const directory = join(root, '.cache/website');
await mkdir(directory, { recursive: true });
const server = await startServer({ port: 0 });
const prefixServer = await startServer({ port: 0, prefix: '/spec-trail' });
const base = `http://127.0.0.1:${server.address().port}`;
const prefixBase = `http://127.0.0.1:${prefixServer.address().port}/spec-trail/`;
const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
const failures = [];
const evidence = { pages: [], interactions: [], failures };
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  for (const name of pages) {
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${base}/${name}`);
      await page.waitForFunction(() => document.documentElement.classList.contains('js-enabled'));
      assert.equal(await page.locator('h1').count(), 1);
      assert(await page.locator('h1').isVisible());
      const size = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
      assert(size.content <= size.viewport + 1, `${name} overflows at ${width}px: ${size.content}`);
      evidence.pages.push({ name, width, horizontalOverflow: false });
      if (width === 1440 || width === 390) await page.screenshot({ path: join(directory, `${name.replace('.html', '')}-${width}.png`), fullPage: true });
    }
  }
  await page.goto(`${base}/`);
  for (const mode of ['workbench', 'prototype', 'skill']) {
    await page.locator(`[data-demo="${mode}"]`).click();
    assert.equal(await page.locator(`[data-demo="${mode}"]`).getAttribute('aria-pressed'), 'true');
    assert(await page.locator(`[data-demo-panel="${mode}"]`).isVisible());
    assert.equal(await page.locator('[data-demo-panel]:visible').count(), 1);
  }
  evidence.interactions.push('homepage: three module examples');
  for (const name of ['index.html', 'skill.html']) {
    await page.goto(`${base}/${name}`);
    await page.locator('[data-client="claude-code"]').click();
    assert.equal((await page.locator('[data-client-panel="claude-code"] code').textContent()).trim(), installation('claude-code'));
    assert(await page.locator('[data-client-panel="claude-code"]').isVisible());
    assert(!(await page.locator('[data-client-panel="codex"]').isVisible()));
    await page.locator('[data-client="codex"]').click();
    assert.equal((await page.locator('[data-client-panel="codex"] code').textContent()).trim(), installation('codex'));
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copiedText = value; } } }); });
    await page.locator('[data-client-panel="codex"] [data-copy]').click();
    assert.equal(await page.evaluate(() => window.copiedText), installation('codex'));
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('Clipboard unavailable'); } } }); });
    await page.locator('[data-client-panel="codex"] [data-copy]').click();
    await page.locator('.copy-fallback').waitFor();
    assert.equal(await page.locator('.copy-fallback').inputValue(), installation('codex'));
    assert(await page.locator('.copy-fallback').evaluate(element => element === document.activeElement));
    await page.locator('[data-client="claude-code"]').click();
    assert.equal(await page.locator('.copy-fallback').count(), 0);
    evidence.interactions.push(`${name}: client switch, copy success and denied-copy fallback`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/`);
  const menu = page.locator('#menu-toggle');
  assert(await menu.isVisible());
  assert(!(await page.locator('#site-nav').isVisible()));
  await menu.click();
  assert(await page.locator('#site-nav').isVisible());
  await page.keyboard.press('Escape');
  assert.equal(await menu.getAttribute('aria-expanded'), 'false');
  assert(await menu.evaluate(element => element === document.activeElement));
  await menu.click();
  await page.locator('#site-nav a[href="workbench.html"]').click();
  await page.waitForURL('**/workbench.html');
  evidence.interactions.push('mobile: open menu, Escape restores focus, module navigation');
  await page.goto(`${base}/`);
  const question = page.locator('.faq-list summary').first();
  await question.focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('.faq-list details').first().getAttribute('open'), '');
  evidence.interactions.push('keyboard: FAQ toggle');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
  evidence.interactions.push('reduced motion');
  for (const name of pages) {
    await page.goto(new URL(name, prefixBase).href);
    assert(await page.locator('h1').isVisible());
    assert.equal(await page.locator('.site-header .brand img').evaluate(image => image.complete && image.naturalWidth > 0), true);
  }
  evidence.interactions.push('four pages and assets served under a subpath');
  const noScript = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const plain = await noScript.newPage();
  await plain.goto(`${base}/`);
  assert(await plain.locator('#site-nav').isVisible());
  assert.equal(await plain.locator('[data-demo-panel]:visible').count(), 3);
  assert.equal(await plain.locator('[data-client-panel]:visible').count(), 2);
  await plain.locator('#site-nav a[href="skill.html"]').click();
  assert(await plain.locator('#setup').isVisible());
  evidence.interactions.push('no JavaScript: navigation, all module examples and both installation commands');
  await noScript.close();
  assert.deepEqual(failures, []);
  await writeFile(join(directory, 'verification.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ responsiveChecks: evidence.pages.length, interactions: evidence.interactions, screenshots: directory }));
} finally {
  await browser.close();
  await Promise.all([new Promise(resolveClose => server.close(resolveClose)), new Promise(resolveClose => prefixServer.close(resolveClose))]);
}
