#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import {
  repository,
  collaborationCatalog,
  routedRecord,
  recordsAt,
  revision,
  remoteBranch,
  fetchBranch,
} from "./repository.mjs";
import { closedRecord, validBranchName } from "./routing.mjs";
import { validateChange } from "./state-schema.mjs";
import { parseTaskOrder } from "./task-order.mjs";

const assert = (value, message) => {
  if (!value) throw Error(message);
};
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const at = (path, args) =>
  execFileSync("git", ["-C", path, "--literal-pathspecs", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  }).trimEnd();
function worktrees(repo) {
  return repo
    .git(["worktree", "list", "--porcelain", "-z"])
    .split("\0\0")
    .filter(Boolean)
    .map((block) => {
      const fields = block.split("\0");
      const value = (name) =>
        fields
          .find((field) => field.startsWith(name + " "))
          ?.slice(name.length + 1);
      return {
        path: value("worktree"),
        branch: value("branch")?.replace(/^refs\/heads\//, ""),
        commit: value("HEAD"),
        detached: fields.includes("detached"),
        prunable: fields.some((field) => field.startsWith("prunable")),
      };
    });
}
function defaultPath(repo, id) {
  const primary = worktrees(repo)[0]?.path ?? repo.root;
  return join(dirname(primary), `${basename(primary)}-worktrees`, id);
}
function clean(path) {
  return !at(path, ["status", "--porcelain", "--untracked-files=all"]);
}
function ownedWorktree(repo, branch) {
  const matches = worktrees(repo).filter((tree) => tree.branch === branch);
  assert(
    matches.length <= 1,
    "Multiple worktrees claim this branch; inspect Git worktree registration",
  );
  const tree = matches[0];
  if (tree) {
    assert(
      !tree.prunable && existsSync(tree.path),
      `The registered worktree is unavailable: ${tree.path}; inspect it without pruning`,
    );
    assert(
      at(tree.path, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]) === repo.common &&
        at(tree.path, ["symbolic-ref", "--short", "HEAD"]) === branch,
      "The worktree does not match the repository and branch",
    );
  }
  return tree;
}
function textAt(repo, commit, path) {
  const row = repo.git(["ls-tree", commit, "--", path]);
  assert(
    /^(100644|100755) blob [a-f0-9]+\t/.test(row),
    `Missing regular file: ${path}`,
  );
  return repo.git(["show", `${commit}:${path}`]);
}
function ready(repo, catalog, record, note, refresh) {
  const state = record.state;
  assert(!validateChange(state).length, "The planning record is invalid");
  assert(
    state.status === "active" &&
      (state.size === "xlarge"
        ? ["plan", "execution", "close"].includes(state.stage)
        : ["requirement", "technical", "plan"].includes(state.stage)),
    "Handoff requires ordinary planning or an xlarge parent ready to close",
  );
  assert(
    !state.waitingFor,
    "Resolve the actual waiting condition before handoff",
  );
  if (state.size !== "xlarge") assert(Object.keys(state.tasks).length, "Define tasks before handoff");
  for (const name of state.size === "small"
    ? ["requirement"]
    : ["requirement", "technical", "plan"])
    textAt(repo, record.commit, `${record.directory}/${name}.md`);
  if (state.size !== "small")
    for (const phase of ["requirement", "technical", "plan"])
      assert(state.confirmations[phase], `Missing ${phase} confirmation`);
  let plan;
  try {
    plan = textAt(repo, record.commit, `${record.directory}/plan.md`);
  } catch (error) {
    if (state.size !== "small") throw error;
  }
  if (state.size === "xlarge") {
    assert(state.children?.length, "Define children before parent closing handoff");
    for (const id of state.children) {
      const child = routedRecord(repo,catalog,id,{refresh});
      assert(!child.errors.length && child.state.parent === state.id &&
        (child.state.status === "cancelled" ||
          (child.archived && child.branch === catalog.branch && closedRecord(child.state,child.directory))),
        `Child ${id} must be cancelled or centrally archived before parent closing handoff`);
    }
  } else {
    const order = parseTaskOrder(state, plan);
    assert(order.status === "valid", "The task execution order is not valid");
  }
  for (const id of state.dependsOn ?? []) {
    const source = routedRecord(repo, catalog, id, { refresh });
    assert(
      !source.errors.length &&
        source.archived &&
        closedRecord(source.state, source.directory),
      `Dependency ${id} is not closed`,
    );
    try {
      repo.git(["merge-base", "--is-ancestor", source.commit, catalog.commit]);
    } catch {
      assert(
        note?.trim(),
        `Dependency ${id} has not been integrated; verify delivery and provide --availability-note when ancestry cannot prove it`,
      );
    }
  }
}
function prepared(repo, catalog, id, branch, commit) {
  const entries = recordsAt(repo, commit, id),
    original = catalog.entries.find((entry) => entry.id === id);
  assert(
    entries.length === 1 && original,
    "Prepared target must contain one planning record",
  );
  const target = entries[0];
  const registered = isDeepStrictEqual(target.state, {
    ...original.state,
    branch,
  });
  assert(
    !target.archived &&
      (registered || isDeepStrictEqual(target.state, original.state)),
    "Prepared target differs from the current planning input; inspect the changes before retrying",
  );
  const base = repo.git(["merge-base", catalog.commit, commit]);
  assert(
    !repo.git([
      "diff",
      "--name-only",
      base,
      catalog.commit,
      "--",
      original.directory,
    ]),
    "Planning directory changed since preparation; inspect the prose and assets before retrying",
  );
  const paths = repo
    .git(["diff", "--name-only", base, commit])
    .split("\n")
    .filter(Boolean);
  assert(
    registered
      ? paths.length === 1 && paths[0] === original.path
      : paths.length === 0,
    "Unregistered target contains changes beyond branch registration; inspect it instead of overwriting",
  );
  return registered;
}
function prepareWorktree(repo, branch, path, start) {
  const existing = ownedWorktree(repo, branch);
  if (existing) return { path: existing.path, reused: true };
  assert(!existsSync(path), `Worktree path already exists: ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  if (revision(repo, `refs/heads/${branch}`))
    repo.git(["worktree", "add", path, branch]);
  else repo.git(["worktree", "add", "-b", branch, path, start]);
  return { path, reused: false };
}
function syncPlanningWorktree(repo, branch, commit) {
  const tree = ownedWorktree(repo, branch);
  if (!tree) return "No local collaboration worktree";
  if (!clean(tree.path))
    return "Collaboration worktree has local changes; left untouched";
  try {
    at(tree.path, ["merge", "--ff-only", commit]);
    return "Collaboration worktree fast-forwarded";
  } catch {
    return "Collaboration worktree has diverged; left untouched";
  }
}

function handoff(repo, id, options) {
  let catalog = collaborationCatalog(repo, { refresh: !options["dry-run"] });
  if (options["dry-run"])
    assert(
      remoteBranch(repo, catalog.branch) === catalog.commit,
      "Fetch the collaboration branch before dry-run",
    );
  let record = routedRecord(repo, catalog, id, {
    refresh: !options["dry-run"],
  });
  assert(
    !record.errors.length &&
      !record.archived &&
      record.state.status === "active",
    "Only an active live Change can be handed off",
  );
  const branch = options.branch ?? `change/${id}`,
    path = resolve(options.path ?? defaultPath(repo, id));
  assert(
    validBranchName(branch) &&
      branch !== catalog.branch &&
      !catalog.config.protectedBranches.includes(branch),
    "Choose an independent, non-protected work branch",
  );
  if (record.branch !== catalog.branch) {
    assert(
      !options.branch || options.branch === record.branch,
      `This Change is already registered on ${record.branch}`,
    );
    const existing = ownedWorktree(repo, record.branch);
    if (options["dry-run"])
      return {
        command: "handoff",
        dryRun: true,
        phase: "registered",
        id,
        branch: record.branch,
        commit: record.commit,
        worktree: existing?.path ?? path,
      };
    const local = revision(repo, `refs/heads/${record.branch}`);
    const tree = prepareWorktree(
      repo,
      record.branch,
      path,
      `refs/remotes/origin/${record.branch}`,
    );
    return {
      command: "handoff",
      phase: "registered",
      id,
      branch: record.branch,
      commit: record.commit,
      worktree: tree.path,
      reused: tree.reused,
      note:
        local && local !== record.commit
          ? "Local commits preserved; inspect ahead/behind and working changes before continuing"
          : "Existing registration reused; verify the execution session before writing",
    };
  }
  ready(
    repo,
    catalog,
    record,
    options["availability-note"],
    !options["dry-run"],
  );
  const remote = remoteBranch(repo, branch);
  if (remote && !options["dry-run"]) fetchBranch(repo, branch);
  const local = revision(repo, `refs/heads/${branch}`);
  const candidate =
    local ?? (remote ? revision(repo, `refs/remotes/origin/${branch}`) : null);
  if (remote && options["dry-run"])
    assert(candidate === remote, "Fetch the work branch before dry-run");
  const registered =
    candidate && prepared(repo, catalog, id, branch, candidate);
  const existing = ownedWorktree(repo, branch);
  if (existing && !clean(existing.path)) {
    const pending = at(existing.path, [
      "status",
      "--porcelain",
      "--untracked-files=all",
    ]);
    assert(
      !registered &&
        pending.split("\n").length === 1 &&
        pending.slice(3) === record.path &&
        isDeepStrictEqual(
          JSON.parse(readFileSync(join(existing.path, record.path), "utf8")),
          { ...record.state, branch },
        ),
      "Prepared worktree has unrelated local changes; leave them intact and inspect before retrying",
    );
  }
  if (options["dry-run"])
    return {
      command: "handoff",
      dryRun: true,
      phase: candidate ? "prepared" : "planning",
      id,
      branch,
      worktree: existing?.path ?? path,
      sourceCommit: catalog.commit,
      changes: [`${record.path}: branch = ${branch}`],
      publishOrder: [branch, catalog.branch],
    };

  const tree = prepareWorktree(repo, branch, path, candidate ?? catalog.commit);
  if (!registered) {
    const file = join(tree.path, record.path),
      original = readFileSync(file, "utf8");
    assert(
      isDeepStrictEqual(JSON.parse(original), record.state) ||
        isDeepStrictEqual(JSON.parse(original), { ...record.state, branch }),
      "Planning input changed before registration",
    );
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, json({ ...record.state, branch }), { flag: "wx" });
      renameSync(temp, file);
    } finally {
      rmSync(temp, { force: true });
    }
    at(tree.path, [
      "commit",
      "--only",
      "-m",
      `${id}: register work branch`,
      "--",
      record.path,
    ]);
  }
  // A shared registration commit is the recovery record. No mirror state or journal.
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = collaborationCatalog(repo, { refresh: true });
    const current = latest.routes.find((entry) => entry.id === id);
    assert(
      current && !current.errors.length,
      "The collaboration entry disappeared or became invalid",
    );
    if (current.branch !== latest.branch) {
      assert(
        current.branch === branch,
        `Another handoff registered ${current.branch}; the prepared branch was left untouched`,
      );
      const published = routedRecord(repo, latest, id, { refresh: true });
      return {
        command: "handoff",
        phase: "registered",
        id,
        branch,
        commit: published.commit,
        worktree: tree.path,
        reused: true,
      };
    }
    assert(
      isDeepStrictEqual(
        latest.entries.find((entry) => entry.id === id)?.state,
        record.state,
      ),
      "Planning changed during handoff; inspect both inputs before retrying",
    );
    prepared(repo, latest, id, branch, at(tree.path, ["rev-parse", "HEAD"]));
    at(tree.path, ["merge", "--no-edit", latest.commit]);
    catalog = latest;
    const commit = at(tree.path, ["rev-parse", "HEAD"]);
    at(tree.path, ["push", "origin", `HEAD:refs/heads/${branch}`]);
    assert(
      remoteBranch(repo, branch) === commit,
      "Published target changed; verify it before registering the entry",
    );
    try {
      at(tree.path, [
        "push",
        "origin",
        `${commit}:refs/heads/${catalog.branch}`,
      ]);
    } catch (error) {
      if (attempt < 2) continue;
      throw Error(
        `Could not publish collaboration entry; target retained for retry: ${error.message}`,
      );
    }
    const verified = collaborationCatalog(repo, { refresh: true });
    assert(
      verified.routes.find((entry) => entry.id === id)?.branch === branch,
      "The published entry changed; inspect it before execution",
    );
    return {
      command: "handoff",
      phase: "registered",
      id,
      branch,
      commit,
      entryCommit: verified.commit,
      worktree: tree.path,
      reused: tree.reused,
      planningWorkspace: syncPlanningWorktree(
        repo,
        catalog.branch,
        verified.commit,
      ),
      next: "Open or continue a session bound to this worktree; verify its actual cwd and branch, then use change.mjs execute",
    };
  }
}

function locate(repo, id, refresh = false) {
  const catalog = collaborationCatalog(repo, { refresh });
  const record = routedRecord(repo, catalog, id, { refresh });
  const tree = worktrees(repo).find((item) => item.branch === record.branch);
  const diagnostics = [...record.errors];
  let localCommit = revision(repo, `refs/heads/${record.branch}`),
    dirty = null,
    ahead = null,
    behind = null;
  if (localCommit) {
    [ahead, behind] = repo
      .git([
        "rev-list",
        "--left-right",
        "--count",
        `${localCommit}...${record.commit}`,
      ])
      .split(/\s+/)
      .map(Number);
  }
  if (tree) {
    if (tree.prunable || !existsSync(tree.path))
      diagnostics.push(
        "Registered worktree is unavailable; inspect before repairing Git registration",
      );
    else {
      ownedWorktree(repo, record.branch);
      dirty = !clean(tree.path);
    }
  }
  const writable =
    !record.archived && record.state.status === "active" && !diagnostics.length;
  return {
    command: "locate",
    id,
    branch: record.branch,
    sourceCommit: record.commit,
    entryCommit: catalog.commit,
    entryPath: record.entryPath,
    recordPath: record.path,
    freshness: record.freshness,
    worktree: tree?.path ?? null,
    localCommit,
    ahead,
    behind,
    diverged: ahead !== null && ahead > 0 && behind > 0,
    dirty,
    diagnostics,
    writable,
    current: {
      path: repo.root,
      branch: repo.branch,
      detached: repo.branch === null,
    },
    session: {
      binding: "unverified",
      action: tree ? "continue-or-open" : "prepare-worktree",
      prompt: `继续 Change ${id}。在 ${tree?.path ?? defaultPath(repo, id)} 打开或复用绑定该工作区的会话，先核对实际 cwd、仓库 common-dir 和分支 ${record.branch}；从 ${catalog.branch} 的 ${record.entryPath} 重新定位，再读取 ${record.path} 及相关正文。比较本地与 ${record.commit} 的差异后按未完成任务继续。创建工作区或 shell cd 不代表会话已绑定。`,
    },
  };
}
function prepare(repo, id, options) {
  const result = locate(repo, id, !options["dry-run"]);
  assert(
    result.writable,
    "This Change is not writable; inspect locate diagnostics",
  );
  assert(
    result.branch !== repo.config.collaborationBranch,
    "Use handoff for a planning Change",
  );
  const path = resolve(options.path ?? defaultPath(repo, id));
  if (options["dry-run"])
    return {
      ...result,
      command: "prepare",
      dryRun: true,
      proposedWorktree: result.worktree ?? path,
    };
  const tree = prepareWorktree(
    repo,
    result.branch,
    path,
    `refs/remotes/origin/${result.branch}`,
  );
  return { ...locate(repo, id), command: "prepare", reused: tree.reused };
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || ["--help", "help"].includes(command)) {
    console.log(
      "Usage: node workspace.mjs <locate|prepare|handoff> --change <id> [--repo <path>] [--branch <name>] [--path <worktree>] [--dry-run] [--availability-note <evidence>]",
    );
    return;
  }
  assert(
    ["handoff", "locate", "prepare"].includes(command),
    `Unknown command: ${command}`,
  );
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      repo: { type: "string" },
      change: { type: "string" },
      branch: { type: "string" },
      path: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "availability-note": { type: "string" },
    },
  });
  assert(
    typeof values.change === "string" &&
      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(values.change),
    "--change requires a valid Change id",
  );
  const repo = repository(values.repo);
  if (command === "locate") {
    console.log(json(locate(repo, values.change)));
    return;
  }
  const operation = command === "handoff" ? handoff : prepare;
  const lock = join(repo.common, "spec-trail-state.lock");
  if (values["dry-run"]) {
    console.log(json(operation(repo, values.change, values)));
    return;
  }
  try {
    mkdirSync(lock);
  } catch {
    throw Error(
      `Another state operation holds ${lock}; inspect it before retrying`,
    );
  }
  try {
    console.log(json(operation(repo, values.change, values)));
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
try {
  main();
} catch (error) {
  console.error(`SpecTrail workspace: ${error.message}`);
  process.exitCode = 1;
}
