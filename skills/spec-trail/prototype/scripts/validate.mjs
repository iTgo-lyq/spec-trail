#!/usr/bin/env node
import { readFile, readdir, realpath, lstat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import {
  validatePrototype,
  validateManifest,
  currentPreview,
  entryPath,
} from "./contract.mjs";
import { git, checkedPath } from "./publishing.mjs";
import { htmlIssues, sandboxCsp } from "./html.mjs";
let browser, server;
try {
  const { values: o } = parseArgs({
    options: {
      repo: { type: "string" },
      browser: { type: "boolean" },
      playwright: { type: "string" },
    },
    strict: true,
  });
  const root = await realpath(resolve(o.repo ?? ".")),
    cfg = JSON.parse(
      await readFile(checkedPath(root, "docs/project/workflow.json"), "utf8"),
    ).prototype;
  if (validatePrototype(cfg).length || cfg.status !== "enabled")
    throw Error("原型配置未启用或不合法");
  const entries = [],
    manifestPath = checkedPath(root, cfg.packagePath + "/prototype.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")),
      issues = validateManifest(manifest);
    if (issues.length) throw Error(issues.join("; "));
    for (const entry of manifest.entries)
      if (entry.artifact) entries.push(currentPreview(entry));
  }
  // Check explicit Git build output before registration as well.
  const preview = checkedPath(root, cfg.packagePath + "/preview");
  if (existsSync(preview))
    for (const name of await readdir(preview)) {
      const item = {
        id: name,
        title: name,
        artifact: { type: "git", path: `${cfg.packagePath}/preview/${name}`, sourceCommit: git(root, ["rev-parse", "HEAD"]) },
        kind: "page",
        devices: ["pc-web"],
      };
      if (
        entryPath(item, cfg) &&
        !entries.some((e) => e.id === name) &&
        existsSync(checkedPath(root, item.artifact.path + "/index.html"))
      )
        entries.push(item);
    }
  for (const entry of entries) {
    if (entry.artifact?.type === "hosted") continue;
    const path = entryPath(entry, cfg);
    if (!path) throw Error("非法 Git 入口路径");
    const full = checkedPath(root, path),
      stat = await lstat(full);
    if (!stat.isFile() || stat.size > 10 * 1024 * 1024)
      throw Error("入口必须是 10 MiB 内的常规文件");
    entry.html = new TextDecoder("utf-8", { fatal: true }).decode(
      await readFile(full),
    );
    const issues = htmlIssues(entry.html);
    if (issues.length) throw Error(`${entry.id}: ${issues.join("; ")}`);
  }
  if (!entries.length)
    throw Error("没有已交付的原型入口；请构建并登记发布结果");
  if (o.browser) {
    const req = createRequire(join(root, "package.json"));
    const mod = await import(
      pathToFileURL(resolve(o.playwright ?? req.resolve("@playwright/test")))
        .href
    );
    browser = await (mod.chromium ?? mod.default.chromium).launch({
      headless: true,
      chromiumSandbox: true,
    });
    let current;
    server = createServer((request, response) => {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      if (request.url === "/") {
        response.end(
          `<iframe sandbox="allow-scripts" referrerpolicy="no-referrer" src="${current.artifact?.type === "hosted" ? current.artifact.url.replaceAll("&", "&amp;").replaceAll('"', "&quot;") : "/preview"}"></iframe>`,
        );
        return;
      }
      if (request.url === "/preview" && current.html) {
        response.setHeader("Content-Security-Policy", sandboxCsp);
        response.end(current.html);
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const entry of entries) {
      current = entry;
      const page = await browser.newPage(),
        errors = [];
      const hosted =
        entry.artifact?.type === "hosted"
          ? new URL(entry.artifact.url).origin
          : null;
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      page.on("response", (r) => {
        if (r.status() >= 400) errors.push(`HTTP ${r.status()}`);
      });
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (
          url === origin + "/" ||
          (!hosted && url === origin + "/preview") ||
          (hosted && new URL(url).origin === hosted)
        )
          return route.continue();
        errors.push("Unexpected external resource");
        return route.abort();
      });
      await page.goto(origin);
      await page.frameLocator("iframe").locator("body").waitFor();
      await page.waitForTimeout(150);
      await page.close();
      if (errors.length) throw Error(`${entry.id}: ${errors.join("; ")}`);
    }
  }
  console.log(
    `Validated ${entries.length} entry(s)${o.browser ? " in Chromium sandbox" : " (metadata/static checks only)"}. Host interactions and retention still require verification.`,
  );
} catch (e) {
  console.error(`Prototype validation: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((r) => server.close(r));
}
