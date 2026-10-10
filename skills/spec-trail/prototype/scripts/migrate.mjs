#!/usr/bin/env node
// One-time legacy conversion. The workbench and shared contract accept only artifacts.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { git, checkedPath, withLock, transaction } from "./publishing.mjs";
import { validatePreviews, commitHash, safePath } from "./contract.mjs";
import { htmlIssues } from "./html.mjs";
const { values: o } = parseArgs({ options: { repo: { type: "string", default: "." }, change: { type: "string" }, revision: { type: "string" } } });
try {
  const root = realpathSync(resolve(o.repo)), id = o.change;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id ?? "")) throw Error("Provide --change");
  const revision = o.revision ?? git(root, ["rev-parse", `refs/tags/spec-trail/archive/${id}^{commit}`]);
  if (!commitHash(revision) || git(root, ["cat-file", "-t", revision]) !== "commit") throw Error("Provide a full source --revision commit");
  const branch = git(root, ["symbolic-ref", "--short", "HEAD"]);
  const workflow = JSON.parse(readFileSync(checkedPath(root, "docs/project/workflow.json"), "utf8"));
  if (workflow.protectedBranches.includes(branch)) throw Error("Migrate on a Change branch, not a protected branch");
  withLock(root, () => {
    const files = git(root, ["ls-tree", "-r", "--name-only", revision, "--", "docs/project"])
      .split("\n").filter(p => p === `docs/project/changes/${id}/change.json` || new RegExp(`^docs/project/archive/\\d{4}-\\d{2}-\\d{2}-${id}/change.json$`).test(p));
    if (files.length !== 1) throw Error("Expected one original Change record");
    const file = files[0], directory = file.slice(0, -12);
    const original = JSON.parse(git(root, ["show", `${revision}:${file}`]));
    const state = JSON.parse(readFileSync(checkedPath(root, file), "utf8"));
    if (state.id !== id || !Array.isArray(original.previews) || !original.previews.length) throw Error("No matching legacy previews");
    const config = JSON.parse(git(root, ["show", `${revision}:docs/project/workflow.json`])).prototype;
    const writes = [];
    const previews = original.previews.map(entry => {
      const { path, ...rest } = entry;
      if (!safePath(path) || !path.startsWith(`${config.packagePath}/preview/`) || rest.artifact) throw Error("Invalid legacy path reference");
      const input = `${path}/index.html`;
      if (!/^100(?:644|755) blob /.test(git(root, ["ls-tree", revision, "--", input]))) throw Error("Original HTML is missing or a symlink");
      const bytes = execFileSync("git", ["-C", root, "show", `${revision}:${input}`], { maxBuffer: 10 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
      const html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (htmlIssues(html).length) throw Error("Original HTML is not self-contained");
      const target = `${directory}/previews/${entry.id}`;
      const output = checkedPath(root, `${target}/index.html`);
      if (existsSync(output) && !readFileSync(output).equals(bytes)) throw Error("Migration would overwrite different snapshot bytes");
      writes.push({ path: `${target}/index.html`, body: bytes });
      return { ...rest, artifact: { type: "git", path: target, sourceCommit: revision } };
    });
    if (validatePreviews(previews).length) throw Error("Legacy metadata cannot be converted to the current contract");
    if (JSON.stringify(state.previews) !== JSON.stringify(original.previews) && JSON.stringify(state.previews) !== JSON.stringify(previews)) throw Error("Change previews diverged; refusing to overwrite later edits");
    writes.push({ path: file, body: JSON.stringify({ ...state, previews }, null, 2) + "\n" });
    transaction(root, writes);
    console.log(`Migrated ${previews.length} preview(s) from ${revision}. Commit and push, then use archive.mjs for the new immutable archive-v2 tag. Old fixed links are not supported by the new reader.`);
  });
} catch (e) { console.error(`Prototype migration: ${e.message}`); process.exitCode = 1; }
