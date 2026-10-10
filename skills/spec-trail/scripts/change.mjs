#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { validateChange, validateWorkflow } from "./state-schema.mjs";
import { entryPath } from "../prototype/scripts/contract.mjs";
import { parseTaskOrder, unfinishedPredecessors } from "./task-order.mjs";

const commands = {
  create: ["title", "size", "depends-on", "parent", "children"],
  show: [],
  retitle: ["title"],
  confirm: [
    "phase",
    "summary",
    "source",
    "source-commit",
    "target-commit",
    "base-commit",
  ],
  "task-add": ["task", "title", "branch"],
  "task-start": ["task"],
  "task-block": ["task", "reason"],
  "task-complete": ["task", "verification", "commit-title"],
  "task-retry": ["task"],
  execute: ["availability-note"],
  wait: ["kind", "summary"],
  resume: [],
  rework: ["stage", "reason", "approach"],
  verify: ["result", "summary", "availability-note"],
  accept: ["summary", "source", "mode", "availability-note"],
  specs: ["result", "summary"],
  archive: ["summary", "date", "availability-note"],
  cancel: ["reason"],
  "previews-set": ["file"],
};
const stages = ["requirement", "technical", "plan", "execution", "close"];
const steps = ["verification", "acceptance", "specs", "archive"];
const assert = (value, message) => {
  if (!value) throw Error(message);
};
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const list = (value) => (value ? value.split(",") : []);

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "help") {
    console.log(
      "Usage: node change.mjs <command> --change <id> [--repo <path>] [--dry-run] [command options]\n" +
        Object.entries(commands)
          .map(
            ([name, flags]) =>
              `${name}: ${flags.map((f) => `--${f} <value>`).join(" ")}`,
          )
          .join("\n") +
        "\nSee ../references/state-commands.md for evidence, phase and publishing requirements.",
    );
    return;
  }
  assert(Object.hasOwn(commands, command), `Unknown command: ${command}`);
  const { values: opts } = parseArgs({
    args,
    options: Object.fromEntries([
      ...["repo", "change", ...commands[command]].map((k) => [
        k,
        { type: "string" },
      ]),
      ["dry-run", { type: "boolean", default: false }],
    ]),
    strict: true,
  });
  const need = (key) => {
    assert(
      typeof opts[key] === "string" && opts[key].trim(),
      `--${key} is required`,
    );
    return opts[key];
  };
  const id = need("change");
  assert(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id), "Invalid Change id");
  const cwd = resolve(opts.repo || ".");
  const git = (args) =>
    execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  const root = git(["rev-parse", "--show-toplevel"]);
  // Reject symlinks in every component, not only the final JSON file.
  const safe = (path) => {
    const absolute = resolve(root, path),
      rel = relative(root, absolute);
    assert(
      rel && !rel.startsWith("..") && !isAbsolute(rel),
      "Path must stay inside the repository",
    );
    let at = root;
    for (const part of rel.split("/")) {
      at = join(at, part);
      try {
        assert(
          !lstatSync(at).isSymbolicLink(),
          `Symlinks are not supported: ${relative(root, at)}`,
        );
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    return absolute;
  };
  const liveDir = safe(`docs/project/changes/${id}`);
  const archiveRoot = safe("docs/project/archive");
  const records = () =>
    ["changes", "archive"].flatMap((kind) => {
      const dir = safe(`docs/project/${kind}`);
      return existsSync(dir)
        ? readdirSync(dir).flatMap((name) => {
            const file = safe(`docs/project/${kind}/${name}/change.json`);
            return existsSync(file)
              ? [{ file, state: read(file), archived: kind === "archive" }]
              : [];
          })
        : [];
    });
  const matches = records().filter((r) => r.state.id === id);
  assert(
    matches.length <= 1,
    "Duplicate Change id; resolve the source records first",
  );
  if (command === "show") {
    assert(matches.length === 1, "Change not found");
    console.log(
      json({
        path: relative(root, matches[0].file),
        state: matches[0].state,
        errors: validateChange(matches[0].state),
      }),
    );
    return;
  }
  const lock = resolve(
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    "spec-trail-state.lock",
  );
  try {
    mkdirSync(lock);
  } catch (error) {
    if (error.code === "EEXIST")
      throw Error(
        `Another state operation holds ${lock}; inspect the owning process before removing a stale lock.`,
      );
    throw error;
  }
  try {
    const branch = git(["symbolic-ref", "--short", "HEAD"]);
    const config = read(safe("docs/project/workflow.json"));
    assert(!validateWorkflow(config).length, "Invalid workflow.json");
    assert(
      !config.protectedBranches.includes(branch),
      "Use the Change branch, not a protected branch",
    );
    const all = records();
    assert(
      !all.some(
        (r) =>
          !r.archived &&
          r.state.branch === branch &&
          r.state.status === "cancelled",
      ),
      "This branch contains a cancelled Change and is frozen",
    );
    const found = all.filter((r) => r.state.id === id);
    assert(found.length <= 1, "Duplicate Change id");
    if (command === "create")
      assert(
        !found.length && !existsSync(liveDir),
        "Change already exists; create never overwrites",
      );
    else
      assert(
        found.length === 1 && !found[0].archived,
        "Change not found or archived; archive is read-only",
      );
    const file =
      command === "create" ? join(liveDir, "change.json") : found[0].file;
    assert(
      command === "create" || file === join(liveDir, "change.json"),
      "Change directory does not match its id",
    );
    const original = command === "create" ? null : readFileSync(file, "utf8");
    const state =
      original === null
        ? {
            schemaVersion: 1,
            id,
            title: need("title"),
            size: need("size"),
            status: "active",
            stage: "requirement",
            branch,
            confirmations: {},
            tasks: {},
            closure: {},
            ...(opts["depends-on"]
              ? { dependsOn: list(opts["depends-on"]) }
              : {}),
            ...(opts.parent ? { parent: opts.parent } : {}),
            ...(opts.children ? { children: list(opts.children) } : {}),
          }
        : JSON.parse(original);
    assert(
      !validateChange(state).length,
      `Invalid input Change: ${validateChange(state).join("; ")}`,
    );
    assert(
      state.branch === branch,
      `Switch to the Change branch ${state.branch}`,
    );
    assert(state.status === "active", "Only active Changes can be modified");
    const now = new Date().toISOString();
    const requireStage = (...allowed) =>
      assert(
        allowed.includes(state.stage),
        `${command} requires stage ${allowed.join("/")} (currently ${state.stage})`,
      );
    const unblocked = () =>
      assert(
        !state.waitingFor,
        "Clear the actual waiting condition, then use resume",
      );
    const requireDocs = () => {
      for (const name of state.size === "small"
        ? ["requirement"]
        : ["requirement", "technical", "plan"])
        assert(
          existsSync(safe(`${relative(root, liveDir)}/${name}.md`)),
          `Missing ${name}.md`,
        );
    };
    const requireConfirmations = () => {
      if (state.size !== "small")
        for (const phase of ["requirement", "technical", "plan"])
          assert(state.confirmations[phase], `Missing ${phase} confirmation`);
    };
    const requireTaskOrder = () => {
      const plan = safe(`${relative(root, liveDir)}/plan.md`);
      const order = parseTaskOrder(
        state,
        existsSync(plan) ? readFileSync(plan, "utf8") : undefined,
      );
      assert(
        ["valid", "not-applicable"].includes(order.status),
        order.status === "missing"
          ? "Missing plan.md"
          : order.diagnostics
              .map((d) => `${d.message}${d.line ? ` (line ${d.line})` : ""}`)
              .join("; "),
      );
      return order;
    };
    const requirePredecessors = (taskId) => {
      const order = requireTaskOrder();
      const pending = unfinishedPredecessors(state.tasks, order.edges, taskId);
      assert(
        !pending.length,
        `Complete predecessor tasks before ${taskId}: ${pending.join(", ")}`,
      );
    };
    const uniqueActive = () =>
      assert(
        !all.some(
          (r) =>
            !r.archived &&
            r.state.id !== id &&
            r.state.branch === branch &&
            r.state.status === "active" &&
            ["execution", "close"].includes(r.state.stage),
        ),
        "Another Change is already executing/closing on this branch",
      );
    const availability = [];
    const dependency = (target, allowCancelled = false) => {
      const candidates = all.filter((r) => r.state.id === target);
      assert(
        candidates.length === 1,
        `Dependency/child ${target} is missing or ambiguous`,
      );
      const record = candidates[0],
        source = record.state;
      assert(
        (allowCancelled && source.status === "cancelled") ||
          (record.archived &&
            source.status === "completed" &&
            !validateChange(source).length &&
            source.closure?.verification?.result === "passed" &&
            steps.every((key) => source.closure[key]) &&
            source.closure.archive.path ===
              relative(root, dirname(record.file)) &&
            !source.waitingFor &&
            steps.every(
              (key, i) =>
                !i ||
                Date.parse(source.closure[key].at) >=
                  Date.parse(source.closure[steps[i - 1]].at),
            )),
        `Dependency/child ${target} is not closed`,
      );
      const remote = `refs/remotes/origin/${source.branch}`;
      const remoteState = JSON.parse(
        git(["show", `${remote}:${relative(root, record.file)}`]),
      );
      assert(
        isDeepStrictEqual(remoteState, source),
        `Dependency/child ${target} has unpushed or divergent state; fetch origin and inspect`,
      );
      if (source.status !== "cancelled") {
        try {
          git(["merge-base", "--is-ancestor", remote, "HEAD"]);
        } catch {
          assert(
            opts["availability-note"]?.trim(),
            `Cannot establish ${target} by ancestry (for example after squash). Verify its delivery in this branch, document the evidence, then pass --availability-note.`,
          );
          availability.push({
            change: target,
            sourceCommit: git(["rev-parse", remote]),
            targetCommit: git(["rev-parse", "HEAD"]),
            evidence: opts["availability-note"],
          });
        }
      }
    };
    const completeTasks = () => {
      if (state.size === "xlarge") {
        assert(state.children?.length, "xlarge requires child Changes");
        for (const child of state.children) dependency(child, true);
      } else
        assert(
          Object.keys(state.tasks).length &&
            Object.values(state.tasks).every((t) => t.status === "done"),
          "All tasks must be done",
        );
    };
    const recordStep = (key, result, extra = {}) => {
      assert(
        !state.closure[key],
        `${key} already recorded; use rework for a new cycle`,
      );
      const previous = state.closure[steps[steps.indexOf(key) - 1]];
      if (key !== "verification") {
        assert(
          previous && state.closure.verification?.result === "passed",
          "Previous successful closure step is required",
        );
        assert(
          Date.parse(now) >= Date.parse(previous.at),
          "Clock precedes the previous closure step; correct the clock or the source record",
        );
      }
      state.closure[key] = {
        result,
        at: now,
        summary: need("summary"),
        ...extra,
      };
    };
    let archiveDir, indexRecovery;
    switch (command) {
      case "create":
        break;
      case "retitle":
        state.title = need("title");
        break;
      case "confirm": {
        const phase = need("phase");
        assert(
          ["requirement", "technical", "plan", "merge"].includes(phase),
          "Invalid confirmation phase",
        );
        assert(
          !state.confirmations[phase],
          "Confirmation already recorded; use rework first",
        );
        if (phase !== "merge") {
          assert(
            state.size !== "small",
            "Small Changes do not record phase confirmations",
          );
          requireStage(
            phase === "plan" && state.size !== "large" ? "technical" : phase,
          );
          if (phase === "plan")
            assert(
              state.confirmations.technical,
              "Technical confirmation is required",
            );
          assert(
            existsSync(safe(`${relative(root, liveDir)}/${phase}.md`)),
            `Missing ${phase}.md`,
          );
        }
        state.confirmations[phase] = {
          at: now,
          summary: need("summary"),
          source: need("source"),
        };
        if (phase === "merge")
          for (const part of ["source", "target", "base"]) {
            if (opts[`${part}-commit`])
              state.confirmations.merge[`${part}Commit`] =
                opts[`${part}-commit`];
          }
        if (phase === "requirement") state.stage = "technical";
        if (phase === "technical" && state.size === "large")
          state.stage = "plan";
        break;
      }
      case "task-add": {
        requireStage("requirement", "technical", "plan", "execution");
        assert(state.size !== "xlarge", "xlarge uses children, not tasks");
        const taskId =
          opts.task ||
          `T${Math.max(0, ...Object.keys(state.tasks).map((k) => Number(k.slice(1)))) + 1}`;
        assert(/^T[1-9][0-9]*$/.test(taskId), "Invalid task id");
        assert(
          !Object.hasOwn(state.tasks, taskId),
          "Task already exists; completed task definitions are immutable",
        );
        state.tasks[taskId] = {
          title: need("title"),
          status: "todo",
          ...(opts.branch ? { branch: opts.branch } : {}),
        };
        break;
      }
      case "task-retry": {
        requireStage("execution");
        const taskId = need("task");
        assert(
          Object.hasOwn(state.tasks, taskId) &&
            state.tasks[taskId].status === "done",
          "Only an uncommitted done task can be retried",
        );
        let committed;
        try {
          committed = JSON.parse(git(["show", `HEAD:${relative(root, file)}`]));
        } catch (e) {
          assert(
            !git([
              "ls-tree",
              "--name-only",
              "HEAD",
              "--",
              relative(root, file),
            ]),
            "Cannot read committed state",
          );
        }
        assert(
          committed?.tasks?.[taskId]?.status !== "done",
          "Committed completed tasks are immutable",
        );
        state.tasks[taskId].status = "doing";
        delete state.tasks[taskId].verification;
        delete state.tasks[taskId].commitTitle;
        const indexed = git([
          "ls-files",
          "--stage",
          "--",
          relative(root, file),
        ]);
        if (indexed) {
          const rows = indexed.split("\n");
          const [mode, blob, stage] = rows[0].split(/\s+/);
          assert(
            rows.length === 1 &&
              stage === "0" &&
              ["100644", "100755"].includes(mode),
            "Resolve the index conflict before retrying a task",
          );
          const staged = JSON.parse(git(["show", `:${relative(root, file)}`]));
          assert(
            !validateChange(staged).length,
            "Invalid staged Change; inspect the index first",
          );
          // Preserve partial staging: change this task only, never stage the whole working file.
          if (
            Object.hasOwn(staged.tasks, taskId) &&
            staged.tasks[taskId].status === "done"
          ) {
            staged.tasks[taskId].status = "doing";
            delete staged.tasks[taskId].verification;
            delete staged.tasks[taskId].commitTitle;
            indexRecovery = { indexed, mode, blob, content: json(staged) };
          }
        }
        break;
      }
      case "task-start":
      case "task-block":
      case "task-complete": {
        requireStage("execution");
        unblocked();
        const taskId = need("task");
        assert(Object.hasOwn(state.tasks, taskId), "Task not found");
        const task = state.tasks[taskId];
        assert(
          task.status !== "done",
          "Completed tasks are immutable; append a repair task",
        );
        if (command === "task-start") {
          assert(
            ["todo", "blocked"].includes(task.status),
            "Task is already running",
          );
          requirePredecessors(taskId);
          task.status = "doing";
          delete task.reason;
        }
        if (command === "task-block") {
          task.status = "blocked";
          task.reason = need("reason");
        }
        if (command === "task-complete") {
          assert(
            task.status === "doing",
            "Start the task before completing it",
          );
          requirePredecessors(taskId);
          task.status = "done";
          task.verification = need("verification");
          if (opts["commit-title"]) task.commitTitle = opts["commit-title"];
          delete task.reason;
        }
        break;
      }
      case "execute":
        requireStage("requirement", "technical", "plan");
        unblocked();
        requireDocs();
        requireConfirmations();
        uniqueActive();
        requireTaskOrder();
        if (state.size !== "xlarge")
          assert(
            Object.keys(state.tasks).length,
            "Define tasks before execution",
          );
        for (const target of state.dependsOn || []) dependency(target);
        state.stage = "execution";
        break;
      case "wait":
        state.waitingFor = { kind: need("kind"), summary: need("summary") };
        break;
      case "resume":
        delete state.waitingFor;
        break;
      case "rework": {
        const stage = need("stage");
        assert(
          ["requirement", "technical", "plan", "execution"].includes(stage) &&
            stages.indexOf(stage) <= stages.indexOf(state.stage),
          "Rework must return to an earlier/current non-close stage",
        );
        if (stage === "execution") {
          requireConfirmations();
          uniqueActive();
        }
        for (const phase of ["requirement", "technical", "plan"])
          if (stages.indexOf(phase) >= stages.indexOf(stage))
            delete state.confirmations[phase];
        delete state.confirmations.merge;
        state.rework = {
          at: now,
          reason: need("reason"),
          approach: need("approach"),
        };
        state.stage = stage;
        state.closure = {};
        delete state.waitingFor;
        break;
      }
      case "verify":
        requireStage("execution");
        unblocked();
        requireDocs();
        requireConfirmations();
        completeTasks();
        requireTaskOrder();
        assert(
          ["passed", "failed"].includes(need("result")),
          "Invalid verification result",
        );
        recordStep("verification", opts.result);
        state.stage = "close";
        break;
      case "accept":
        requireStage("close");
        unblocked();
        completeTasks();
        requireTaskOrder();
        assert(
          ["user", "agent"].includes(need("mode")),
          "--mode must be user or agent",
        );
        assert(
          opts.mode !== "agent" || state.size === "small",
          "Only small Changes may self-accept",
        );
        recordStep("acceptance", "accepted", { source: need("source") });
        break;
      case "specs":
        requireStage("close");
        unblocked();
        requireTaskOrder();
        assert(
          ["synced", "not_needed"].includes(need("result")),
          "Invalid Specs result",
        );
        recordStep("specs", opts.result);
        break;
      case "archive": {
        requireStage("close");
        unblocked();
        completeTasks();
        requireTaskOrder();
        const date = need("date");
        assert(
          /^\d{4}-\d{2}-\d{2}$/.test(date) &&
            Number.isFinite(Date.parse(`${date}T00:00:00.000Z`)) &&
            new Date(`${date}T00:00:00.000Z`).toISOString().startsWith(date),
          "Use a valid YYYY-MM-DD date in the user timezone",
        );
        archiveDir = safe(`docs/project/archive/${date}-${id}`);
        assert(!existsSync(archiveDir), "Archive destination already exists");
        recordStep("archive", "done", { path: relative(root, archiveDir) });
        for (const entry of state.previews ?? []) {
          if (
            entry.artifact?.type === "git" &&
            entry.artifact.path.startsWith(
              relative(root, liveDir) + "/previews/",
            )
          )
            entry.artifact.path =
              relative(root, archiveDir) +
              entry.artifact.path.slice(relative(root, liveDir).length);
        }
        state.status = "completed";
        break;
      }
      case "cancel":
        state.status = "cancelled";
        state.cancellation = { at: now, reason: need("reason") };
        delete state.waitingFor;
        break;
      case "previews-set": {
        requireStage("requirement", "technical", "plan", "execution");
        const previews = read(resolve(cwd, need("file")));
        assert(Array.isArray(previews), "--file must contain a preview array");
        if (config.prototype?.status !== "enabled")
          assert(
            previews.every((p) =>
              state.previews?.some((old) => isDeepStrictEqual(p, old)),
            ),
            "Enable prototype tracking before adding/updating associations",
          );
        else
          for (const p of previews) {
            if (p.artifact) {
              assert(
                git(["cat-file", "-t", p.artifact.sourceCommit]) === "commit",
                "Unknown source commit",
              );
              if (p.artifact.type === "hosted") continue;
            }
            const path = entryPath(
              p,
              config.prototype,
              relative(root, liveDir),
            );
            assert(
              path && existsSync(safe(path)) && lstatSync(safe(path)).isFile(),
              "Preview requires a regular index.html inside the configured preview directory",
            );
          }
        state.previews = previews;
        break;
      }
    }
    const errors = validateChange(state);
    assert(!errors.length, errors.join("; "));
    assert(
      !(state.dependsOn || []).includes(id) &&
        !(state.children || []).includes(id) &&
        state.parent !== id,
      "A Change cannot depend on, parent or contain itself",
    );
    if (state.size === "xlarge")
      assert(
        !Object.keys(state.tasks).length &&
          !state.dependsOn?.length &&
          state.children?.length,
        "xlarge requires children, no tasks or dependsOn",
      );
    else assert(!state.children?.length, "Only xlarge can have children");
    const result = {
      command,
      dryRun: opts["dry-run"],
      path: relative(root, archiveDir ? join(archiveDir, "change.json") : file),
      state,
      ...(availability.length ? { availability } : {}),
    };
    if (opts["dry-run"]) {
      console.log(json(result));
      return;
    }
    assert(
      original === null
        ? !existsSync(file)
        : readFileSync(file, "utf8") === original,
      "Change changed concurrently; retry after inspecting",
    );
    if (original === null) mkdirSync(liveDir, { recursive: true });
    const temporary = join(dirname(file), `.change-${randomUUID()}.tmp`);
    let updatedBlob;
    try {
      writeFileSync(temporary, json(state), {
        flag: "wx",
        mode: original === null ? 0o644 : lstatSync(file).mode & 0o777,
      });
      assert(
        git(["symbolic-ref", "--short", "HEAD"]) === branch,
        "Branch changed during the operation",
      );
      if (indexRecovery) {
        assert(
          git(["ls-files", "--stage", "--", relative(root, file)]) ===
            indexRecovery.indexed,
          "Index changed during task recovery",
        );
        const blob = execFileSync(
          "git",
          ["-C", cwd, "hash-object", "-w", "--stdin"],
          {
            input: indexRecovery.content,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
          },
        ).trim();
        git([
          "update-index",
          "--cacheinfo",
          indexRecovery.mode,
          blob,
          relative(root, file),
        ]);
        updatedBlob = blob;
      }
      if (archiveDir) {
        mkdirSync(archiveRoot, { recursive: true });
        renameSync(liveDir, archiveDir);
        try {
          renameSync(
            join(archiveDir, relative(liveDir, temporary)),
            join(archiveDir, "change.json"),
          );
        } catch (error) {
          renameSync(archiveDir, liveDir);
          throw error;
        }
      } else renameSync(temporary, file);
    } catch (error) {
      if (
        updatedBlob &&
        git(["rev-parse", `:${relative(root, file)}`]) === updatedBlob
      )
        git([
          "update-index",
          "--cacheinfo",
          indexRecovery.mode,
          indexRecovery.blob,
          relative(root, file),
        ]);
      throw error;
    } finally {
      rmSync(temporary, { force: true });
    }
    result.next =
      archiveDir && state.previews?.length
        ? "Commit archive and outputs, then run prototype/scripts/archive.mjs --change <id> --push; verify the remote branch and retained tag."
        : "Review the local diff, commit and push. A local command is not a published workflow fact.";
    console.log(json(result));
  } finally {
    rmSync(lock, { recursive: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`SpecTrail state: ${error.message}`);
  process.exitCode = 1;
}
