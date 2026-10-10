#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { validatePreviews, entryPath } from "./contract.mjs";
const args = process.argv.slice(2),
  options = {};
for (let i = 0; i < args.length; i++) {
  const k = args[i];
  if (!["--repo", "--change", "--remote", "--push"].includes(k))
    throw Error(`Unknown option ${k}`);
  options[k] = k === "--push" ? true : args[++i];
}
try {
  const cwd = resolve(options["--repo"] || ".");
  const git = (args) =>
    execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 20 * 1024 * 1024,
    }).trim();
  const id = options["--change"],
    remote = options["--remote"] || "origin";
  if (
    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id || "") ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(remote)
  )
    throw Error("Provide a valid --change and --remote");
  if (git(["status", "--porcelain"]))
    throw Error(
      "Commit the completed archive and outputs before pinning; worktree must be clean.",
    );
  const files = git([
    "ls-tree",
    "-r",
    "--name-only",
    "HEAD",
    "--",
    "docs/project/archive",
  ])
    .split("\n")
    .filter((p) => p.endsWith(`-${id}/change.json`));
  if (files.length !== 1)
    throw Error("Expected one archive record for this Change");
  const state = JSON.parse(git(["show", `HEAD:${files[0]}`]));
  if (
    state.id !== id ||
    state.status !== "completed" ||
    state.stage !== "close" ||
    state.closure?.verification?.result !== "passed" ||
    state.closure?.acceptance?.result !== "accepted" ||
    !["synced", "not_needed"].includes(state.closure?.specs?.result) ||
    state.closure?.archive?.path !== files[0].slice(0, -12) ||
    state.closure?.archive?.result !== "done"
  )
    throw Error("Archive is not completed with all closure evidence.");
  if (!state.previews?.length) {
    console.log("No previews: no archive tag required.");
    process.exit(0);
  }
  if (validatePreviews(state.previews).length)
    throw Error("Invalid preview associations");
  const config = JSON.parse(
    git(["show", "HEAD:docs/project/workflow.json"]),
  ).prototype;
  if (config?.status === "enabled")
    for (const preview of state.previews) {
      if (preview.artifact?.type === "hosted") continue;
      const path = entryPath(preview, config, files[0].slice(0, -12));
      if (
        !path ||
        !/^100(?:644|755) blob /.test(git(["ls-tree", "HEAD", "--", path]))
      )
        throw Error("Archive preview entry is missing or invalid.");
    }
  const revision = git(["rev-parse", "HEAD"]),
    branch = git(["symbolic-ref", "--short", "HEAD"]);
  const tag = `spec-trail/archive-v2/${id}`,
    ref = `refs/tags/${tag}`;
  let existing;
  try {
    existing = git(["rev-parse", "--verify", `${ref}^{commit}`]);
  } catch {}
  const remoteRows = git(["ls-remote", remote, ref, `${ref}^{}`]).split("\n");
  const remoteValue =
    remoteRows.find((r) => r.endsWith(`${ref}^{}`))?.split("\t")[0] ||
    remoteRows.find((r) => r.endsWith(ref))?.split("\t")[0];
  if (
    (existing && existing !== revision) ||
    (remoteValue && remoteValue !== revision)
  )
    throw Error(
      "Archive tag already names a different commit; never overwrite it.",
    );
  if (!existing) git(["tag", tag, revision]);
  if (options["--push"]) {
    const refspecs = [`HEAD:refs/heads/${branch}`, `${ref}:${ref}`];
    const result = spawnSync(
      "git",
      ["-C", cwd, "push", "--atomic", remote, ...refspecs],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      if (
        /does not support.*atomic|atomic.*not supported/i.test(
          result.stderr || "",
        )
      ) {
        git(["push", remote, refspecs[0]]);
        git(["push", remote, refspecs[1]]);
      } else
        throw Error(
          "Atomic archive push failed; local tag is retained for retry.",
        );
    }
    const heads = git([
      "ls-remote",
      remote,
      `refs/heads/${branch}`,
      ref,
      `${ref}^{}`,
    ]).split("\n");
    const pinned =
      heads.find((r) => r.endsWith(`${ref}^{}`))?.split("\t")[0] ||
      heads.find((r) => r.endsWith(`\t${ref}`))?.split("\t")[0];
    if (
      !heads.includes(`${revision}\trefs/heads/${branch}`) ||
      pinned !== revision
    )
      throw Error(
        "Remote branch/tag verification failed; archive delivery is incomplete.",
      );
    console.log(`Archive branch and ${tag} published at ${revision}.`);
  } else
    console.log(
      `Local tag ${tag} created; archive delivery is NOT complete until --push succeeds.`,
    );
} catch (e) {
  console.error(`Prototype archive: ${e.message}`);
  process.exitCode = 1;
}
