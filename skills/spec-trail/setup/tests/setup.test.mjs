import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const checker = fileURLToPath(
  new URL("../scripts/check-setup.mjs", import.meta.url),
);
const skill = fileURLToPath(new URL("../../", import.meta.url));
const resourcePaths = [
  "setup/scripts/pre-commit.js",
  "scripts/state-schema.mjs",
  "scripts/routing.mjs",
  "prototype/scripts/contract.mjs",
];
const checkCommand =
  'node "$(git rev-parse --show-toplevel)/.agents/skills/spec-trail/setup/scripts/pre-commit.js"';
const validWorkflow = {
  schemaVersion: 3,
  integrationBranch: "develop",
  releaseBranch: "main",
};
const invalidWorkflow = { schemaVersion: 1, releaseBranch: [] };
const at = "2024-02-29T12:30:00.125+08:00";
const validChange = {
  schemaVersion: 1,
  id: "feature",
  title: "Test feature",
  size: "medium",
  status: "active",
  stage: "execution",
  branch: "change/feature",
  parent: "parent",
  children: ["child"],
  dependsOn: ["dependency"],
  confirmations: {
    requirement: { at, summary: "Confirmed", source: "User" },
    technical: { at, summary: "Confirmed" },
    plan: { at, summary: "Confirmed" },
    merge: {
      at,
      summary: "Confirmed",
      sourceCommit: "abcdef0",
      targetCommit: "0123456",
      baseCommit: "aaaaaaa",
    },
  },
  tasks: {
    T1: {
      title: "Implement",
      status: "done",
      branch: "task/feature/T1",
      verification: "Passed",
      commitTitle: "Implement feature",
    },
  },
  waitingFor: { kind: "confirmation", summary: "Await review" },
  rework: { at, reason: "Update", approach: "Revise" },
  closure: {
    verification: { at, summary: "Passed", result: "passed" },
    acceptance: { at, summary: "Accepted", result: "accepted", source: "User" },
    specs: { at, summary: "No change", result: "not_needed" },
    archive: {
      at,
      summary: "Archived",
      result: "done",
      path: "docs/project/archive/2026-10-02-feature",
    },
  },
};

function sandbox(t) {
  const base = mkdtempSync(join(tmpdir(), "spec-trail-hook-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const globalConfig = join(base, "gitconfig");
  writeFileSync(globalConfig, "");
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    XDG_CONFIG_HOME: join(base, "xdg"),
  };
  for (const name of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
  ])
    delete env[name];
  function run(cmd, args, cwd, expected = 0) {
    const result = spawnSync(cmd, args, { cwd, env, encoding: "utf8" });
    if (result.error) throw result.error;
    assert.equal(
      result.status,
      expected,
      `${cmd} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
    );
    return `${result.stdout}${result.stderr}`;
  }
  const git = (repo, args, expected = 0) =>
    run("git", ["-C", repo, ...args], base, expected);
  function identity(repo) {
    git(repo, ["config", "user.name", "SpecTrail test"]);
    git(repo, ["config", "user.email", "spec-trail-test@example.invalid"]);
  }
  function makeRepo(name) {
    const repo = join(base, name);
    mkdirSync(repo);
    git(repo, ["init", "--initial-branch=main"]);
    identity(repo);
    git(repo, ["commit", "--allow-empty", "-m", "Initial repository"]);
    git(repo, ["branch", "develop"]);
    return repo;
  }
  const check = (repo, expected = 0) =>
    JSON.parse(run(process.execPath, [checker, repo], base, expected));
  function write(repo, relative, value) {
    const path = join(repo, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      typeof value === "string" ? value : `${JSON.stringify(value)}\n`,
    );
  }
  function commit(repo) {
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "Initialize hook"]);
  }
  function provision(repo) {
    for (const path of resourcePaths) {
      const target = join(repo, ".agents/skills/spec-trail", path);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(skill, path), target);
    }
    write(repo, "docs/project/workflow.json", validWorkflow);
  }
  // Business-owned integration is explicit; the checker never creates this entry.
  function integrate(repo, path = ".project-hooks/pre-commit") {
    write(repo, path, `#!/bin/sh\n${checkCommand} || exit $?\n`);
    chmodSync(join(repo, path), 0o755);
    if (dirname(path) !== ".git/hooks")
      git(repo, ["config", "core.hooksPath", dirname(path)]);
  }
  function prepare(repo) {
    provision(repo);
    check(repo);
    integrate(repo);
  }
  function snapshot(repo) {
    const entries = [];
    function visit(path, relative = "") {
      for (const entry of readdirSync(path, { withFileTypes: true }).sort(
        (a, b) => a.name.localeCompare(b.name),
      )) {
        const file = join(path, entry.name),
          name = join(relative, entry.name);
        entries.push([
          name,
          statSync(file).mode,
          entry.isDirectory() ? null : readFileSync(file).toString("base64"),
        ]);
        if (entry.isDirectory()) visit(file, name);
      }
    }
    visit(repo);
    return entries;
  }
  function clone(repo, name) {
    const target = join(base, name);
    run("git", ["clone", "--quiet", repo, target], base);
    identity(target);
    return target;
  }
  return {
    base,
    run,
    git,
    makeRepo,
    check,
    provision,
    integrate,
    prepare,
    snapshot,
    write,
    commit,
    clone,
  };
}

test("business-owned hook validates clone, worktree and partial commits without dependencies", (t) => {
  const s = sandbox(t);
  const repo = s.makeRepo("original project's checkout");
  s.prepare(repo);
  const report = s.check(repo);
  assert.equal(report.readiness, "ready");
  assert.equal(report.hook.status, "unverified");
  assert.ok(!existsSync(join(repo, "package.json")));
  assert.ok(!existsSync(join(repo, "package-lock.json")));
  assert.ok(!existsSync(join(repo, "scripts")));
  s.write(repo, "docs/project/workflow.json", validWorkflow);
  s.write(repo, "note.txt", "Initial note\n");
  s.commit(repo);
  const cloned = s.clone(repo, "fresh clone's checkout");
  s.git(cloned, ["config", "--get", "core.hooksPath"], 1);
  s.git(cloned, ["config", "--local", "core.hooksPath", ".project-hooks"]);
  const head = s.git(cloned, ["rev-parse", "HEAD"]).trim();
  s.write(cloned, "docs/project/workflow.json", invalidWorkflow);
  s.git(cloned, ["add", "docs/project/workflow.json"]);
  s.write(cloned, "docs/project/workflow.json", validWorkflow);
  assert.match(
    s.git(cloned, ["commit", "-m", "Reject invalid staged configuration"], 1),
    /\/releaseBranch/,
  );
  assert.equal(s.git(cloned, ["rev-parse", "HEAD"]).trim(), head);
  s.write(cloned, "docs/project/workflow.json", {
    ...validWorkflow,
    releaseBranch: "release",
  });
  s.git(cloned, ["add", "docs/project/workflow.json"]);
  s.write(cloned, "docs/project/workflow.json", invalidWorkflow);
  s.git(cloned, [
    "commit",
    "-m",
    "Accept valid index despite invalid working copy",
  ]);
  assert.deepEqual(
    JSON.parse(s.git(cloned, ["show", "HEAD:docs/project/workflow.json"]))
      .releaseBranch,
    "release",
  );
  s.git(cloned, ["add", "docs/project/workflow.json"]);
  s.write(cloned, "note.txt", "Updated note\n");
  s.git(cloned, ["add", "note.txt"]);
  s.git(cloned, [
    "commit",
    "--only",
    "note.txt",
    "-m",
    "Partial commit excludes other staged state",
  ]);
  s.git(cloned, ["commit", "-m", "Remaining invalid index still rejected"], 1);
  s.git(cloned, ["restore", "--staged", "docs/project/workflow.json"]);
  s.git(cloned, ["restore", "docs/project/workflow.json"]);
  const worktree = join(s.base, "linked worktree");
  s.git(cloned, ["worktree", "add", "--detach", worktree]);
  s.write(worktree, "docs/project/workflow.json", invalidWorkflow);
  s.git(worktree, ["add", "docs/project/workflow.json"]);
  s.git(worktree, ["commit", "-m", "Reject invalid worktree state"], 1);
  assert.equal(s.git(cloned, ["status", "--porcelain"]).trim(), "");
});

test("field rules reject invalid workflow and Change state with precise paths", (t) => {
  const s = sandbox(t);
  const repo = s.makeRepo("field rules");
  s.prepare(repo);
  s.write(repo, "docs/project/workflow.json", validWorkflow);
  s.write(repo, "docs/project/changes/feature/change.json", validChange);
  s.commit(repo);
  const head = s.git(repo, ["rev-parse", "HEAD"]).trim();
  for (const [value, field] of [
    [null, "/"],
    [{ ...validWorkflow, schemaVersion: "1" }, "/schemaVersion"],
    [invalidWorkflow, "/releaseBranch"],
    [
      { ...validWorkflow, releaseBranch: ["main", "main"] },
      "/releaseBranch",
    ],
    [{ ...validWorkflow, releaseBranch: "*" }, "/releaseBranch"],
    ["{ invalid JSON", "/"],
  ]) {
    s.write(repo, "docs/project/workflow.json", value);
    s.git(repo, ["add", "docs/project/workflow.json"]);
    assert.ok(
      s
        .git(repo, ["commit", "-m", "Invalid workflow"], 1)
        .includes(`: ${field}:`),
    );
  }
  s.write(repo, "docs/project/workflow.json", validWorkflow);
  s.git(repo, ["add", "docs/project/workflow.json"]);
  const cases = [
    [(v) => delete v.title, "/title"],
    [(v) => (v.title = " \n "), "/title"],
    [(v) => (v.size = "huge"), "/size"],
    [(v) => (v.stage = "unknown"), "/stage"],
    [(v) => (v.branch = "bad branch"), "/branch"],
    [(v) => (v.id = "Bad_ID"), "/id"],
    [(v) => (v.dependsOn = ["dependency", "dependency"]), "/dependsOn"],
    [(v) => (v.children = null), "/children"],
    [(v) => (v["unknown/key~"] = true), "/unknown~1key~0"],
    [(v) => (v.tasks.T0 = v.tasks.T1), "/tasks/T0"],
    [(v) => (v.tasks.T1.status = "blocked"), "/tasks/T1/reason"],
    [(v) => (v.tasks.T1.reason = ""), "/tasks/T1/reason"],
    [(v) => (v.status = "cancelled"), "/cancellation"],
    [(v) => (v.confirmations = []), "/confirmations"],
    [
      (v) => (v.confirmations.merge.sourceCommit = "ABCDEF0"),
      "/confirmations/merge/sourceCommit",
    ],
    [
      (v) => (v.closure.verification.extra = true),
      "/closure/verification/extra",
    ],
    [
      (v) => (v.closure.acceptance.result = "passed"),
      "/closure/acceptance/result",
    ],
    [(v) => delete v.closure.archive.path, "/closure/archive/path"],
    [(v) => (v.waitingFor.kind = "other"), "/waitingFor/kind"],
    ...[
      "2023-02-29T12:00:00Z",
      "2100-02-29T12:00:00Z",
      "2024-04-31T12:00:00Z",
      "2024-01-01T24:00:00Z",
      "2024-01-01T12:60:00Z",
      "2024-01-01T12:00:00+24:00",
      "2024-01-01T12:00:00",
      "2024-01-01T12:00:60Z",
    ].map((value) => [
      (v) => (v.confirmations.requirement.at = value),
      "/confirmations/requirement/at",
    ]),
  ];
  for (const [mutate, field] of cases) {
    const value = structuredClone(validChange);
    mutate(value);
    s.write(repo, "docs/project/changes/feature/change.json", value);
    s.git(repo, ["add", "docs/project/changes/feature/change.json"]);
    const output = s.git(repo, ["commit", "-m", "Invalid Change"], 1);
    assert.ok(
      output.includes(`docs/project/changes/feature/change.json: ${field}:`),
      output,
    );
    assert.equal(s.git(repo, ["rev-parse", "HEAD"]).trim(), head);
  }
  const valid = structuredClone(validChange);
  valid.tasks.T1.status = "blocked";
  valid.tasks.T1.reason = "Await a dependency";
  valid.status = "cancelled";
  valid.cancellation = { at: "2016-12-31T23:59:60Z", reason: "Cancelled" };
  valid.confirmations.requirement.at = "2000-02-29T00:00:00Z";
  s.write(repo, "docs/project/changes/feature/change.json", valid);
  s.git(repo, ["add", "docs/project/changes/feature/change.json"]);
  s.git(repo, ["commit", "-m", "Valid optional and conditional fields"]);
});

test("archive renames are checked and deletions need no validation", (t) => {
  const s = sandbox(t);
  const repo = s.makeRepo("renames and deletions");
  s.prepare(repo);
  const before = "docs/project/changes/feature/change.json";
  const after = "docs/project/archive/2026-10-02-feature/change.json";
  s.write(repo, before, validChange);
  s.commit(repo);
  mkdirSync(dirname(join(repo, after)), { recursive: true });
  renameSync(join(repo, before), join(repo, after));
  s.write(repo, after, { ...validChange, status: "invalid" });
  s.git(repo, ["add", "-A"]);
  assert.match(
    s.git(repo, ["commit", "-m", "Invalid archive rename"], 1),
    /archive\/2026-10-02-feature\/change\.json: \/status/,
  );
  s.write(repo, after, validChange);
  s.git(repo, ["add", after]);
  s.git(repo, ["commit", "-m", "Valid rename"]);
  s.git(repo, ["rm", after]);
  s.git(repo, ["commit", "-m", "Delete state"]);
});

test("existing hook manager and ESM package remain unchanged", (t) => {
  const s = sandbox(t);
  const repo = s.makeRepo("existing ESM project");
  const hook = join(repo, ".hooks/pre-commit");
  mkdirSync(dirname(hook));
  const original = "#!/bin/sh\nset -e\nprintf 'existing-check\\n' >&2\n";
  writeFileSync(hook, original);
  chmodSync(hook, 0o755);
  s.git(repo, ["config", "core.hooksPath", ".hooks"]);
  const pkg =
    '{"type":"module","scripts":{"prepare":"existing-command","build":"existing-build"}}\n';
  s.write(repo, "package.json", pkg);
  s.provision(repo);
  const before = s.snapshot(repo);
  assert.equal(s.check(repo).readiness, "ready");
  assert.deepEqual(s.snapshot(repo), before);
  writeFileSync(hook, `${original}${checkCommand}\n`);
  assert.equal(s.check(repo).hook.status, "unverified");
  assert.equal(readFileSync(join(repo, "package.json"), "utf8"), pkg);
  assert.equal(
    s.git(repo, ["config", "--get", "core.hooksPath"]).trim(),
    ".hooks",
  );
  s.write(repo, "docs/project/workflow.json", validWorkflow);
  s.commit(repo);
  s.write(repo, "docs/project/workflow.json", invalidWorkflow);
  s.git(repo, ["add", "docs/project/workflow.json"]);
  assert.match(
    s.git(
      repo,
      ["commit", "-m", "Existing hook plus native ESM validation"],
      1,
    ),
    /existing-check/,
  );
});

test("setup is read-only before and after native hook integration", (t) => {
  const s = sandbox(t);
  const repo = s.makeRepo("existing default hooks");
  const hook = join(repo, ".git/hooks/pre-push");
  const body = "#!/bin/sh\nexit 0\n";
  writeFileSync(hook, body);
  chmodSync(hook, 0o755);
  s.provision(repo);
  const before = s.snapshot(repo);
  const report = s.check(repo);
  assert.equal(report.readiness, "ready");
  assert.equal(report.hook.configuredPath, null);
  assert.equal(report.hook.gitEntryPath, join(repo, ".git/hooks/pre-commit"));
  assert.equal(report.hook.status, "unverified");
  assert.deepEqual(s.snapshot(repo), before);
  assert.ok(!existsSync(join(repo, ".githooks")));
  s.git(repo, ["config", "--get", "core.hooksPath"], 1);
  s.integrate(repo, ".git/hooks/pre-commit");
  const integrated = s.snapshot(repo);
  s.check(repo);
  s.check(repo);
  assert.deepEqual(s.snapshot(repo), integrated);
  s.commit(repo);
  s.write(repo, "docs/project/workflow.json", invalidWorkflow);
  s.git(repo, ["add", "docs/project/workflow.json"]);
  assert.match(
    s.git(repo, ["commit", "-m", "Native hook rejects invalid state"], 1),
    /\/releaseBranch/,
  );
});

test("explicit empty and global hook configuration are preserved", (t) => {
  const s = sandbox(t);
  const emptyConfig = s.makeRepo("explicit empty hook configuration");
  s.git(emptyConfig, ["config", "core.hooksPath", ""]);
  s.provision(emptyConfig);
  const before = s.snapshot(emptyConfig);
  assert.equal(s.check(emptyConfig).hook.configuredPath, "");
  assert.deepEqual(s.snapshot(emptyConfig), before);
  assert.equal(
    s.git(emptyConfig, ["config", "--get", "core.hooksPath"]).trim(),
    "",
  );
  const globalRepo = s.makeRepo("global hook configuration");
  s.provision(globalRepo);
  s.git(globalRepo, ["config", "--global", "core.hooksPath", ".company-hooks"]);
  const globalBefore = readFileSync(join(s.base, "gitconfig"), "utf8");
  const localBefore = s.snapshot(globalRepo);
  assert.equal(s.check(globalRepo).hook.configuredPath, ".company-hooks");
  assert.deepEqual(s.snapshot(globalRepo), localBefore);
  assert.equal(readFileSync(join(s.base, "gitconfig"), "utf8"), globalBefore);
});

test("setup reports missing resources and invalid configuration without repairing them", (t) => {
  const s = sandbox(t);
  const repo = s.makeRepo("unprepared project");
  const before = s.snapshot(repo);
  const missing = s.check(repo, 1);
  assert.equal(missing.readiness, "not_ready");
  assert.equal(
    missing.resources.filter((resource) => resource.status === "not_ready")
      .length,
    4,
  );
  assert.deepEqual(s.snapshot(repo), before);
  s.provision(repo);
  s.write(repo, "docs/project/workflow.json", invalidWorkflow);
  const invalidBefore = s.snapshot(repo);
  const invalid = s.check(repo, 1);
  assert.equal(invalid.workflow.status, "not_ready");
  assert.ok(
    invalid.issues.some((issue) => issue.includes("/releaseBranch")),
  );
  assert.deepEqual(s.snapshot(repo), invalidBefore);
  s.write(repo, "docs/project/workflow.json", validWorkflow);
  rmSync(join(repo, "docs/project/workflow.json"));
  const missingWorkflowBefore = s.snapshot(repo);
  assert.equal(s.check(repo, 1).workflow.status, "not_ready");
  assert.deepEqual(s.snapshot(repo), missingWorkflowBefore);
});

test("setup rejects broken script syntax and unusable shared modules", (t) => {
  const s = sandbox(t);
  const repo = s.makeRepo("broken resources");
  s.provision(repo);
  s.write(
    repo,
    ".agents/skills/spec-trail/setup/scripts/pre-commit.js",
    "const = broken;\n",
  );
  const before = s.snapshot(repo);
  const broken = s.check(repo, 1);
  assert.equal(broken.resources[0].status, "not_ready");
  assert.deepEqual(s.snapshot(repo), before);
  s.provision(repo);
  s.write(
    repo,
    ".agents/skills/spec-trail/scripts/state-schema.mjs",
    "export const validateWorkflow = null;\n",
  );
  const moduleBefore = s.snapshot(repo);
  const brokenModule = s.check(repo, 1);
  assert.equal(brokenModule.readiness, "not_ready");
  assert.equal(brokenModule.resources[1].status, "not_ready");
  assert.ok(
    brokenModule.issues.some((issue) =>
      issue.startsWith(".agents/skills/spec-trail/scripts/state-schema.mjs:"),
    ),
  );
  assert.deepEqual(s.snapshot(repo), moduleBefore);
  s.provision(repo);
  s.write(
    repo,
    ".agents/skills/spec-trail/prototype/scripts/contract.mjs",
    "export const entryPath = () => null;\n",
  );
  s.write(repo, "docs/project/changes/feature/change.json", {
    ...validChange,
    previews: [],
  });
  s.git(repo, ["add", "docs/project"]);
  const contractBefore = s.snapshot(repo);
  const brokenContract = s.check(repo, 1);
  assert.equal(
    brokenContract.resources.find((r) =>
      r.path.endsWith("prototype/scripts/contract.mjs"),
    ).status,
    "not_ready",
  );
  assert.deepEqual(s.snapshot(repo), contractBefore);
  s.run(
    process.execPath,
    [join(repo, ".agents/skills/spec-trail/setup/scripts/pre-commit.js")],
    repo,
    1,
  );
  s.provision(repo);
  assert.equal(s.check(repo).readiness, "ready");
  s.run(
    process.execPath,
    [join(repo, ".agents/skills/spec-trail/setup/scripts/pre-commit.js")],
    repo,
  );
});

test("delegated hook integration survives regeneration and remains unverified by setup", (t) => {
  const s = sandbox(t);
  const repo = s.makeRepo("delegated hooks");
  s.provision(repo);
  s.git(repo, ["config", "core.hooksPath", ".husky/_"]);
  // Husky 9 uses a generated Git entry and dispatcher to invoke the maintained hook.
  const entry = '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n';
  s.write(repo, ".husky/_/pre-commit", entry);
  chmodSync(join(repo, ".husky/_/pre-commit"), 0o755);
  s.write(
    repo,
    ".husky/_/h",
    '#!/usr/bin/env sh\ns=$(dirname "$(dirname "$0")")/$(basename "$0")\n[ ! -f "$s" ] && exit 0\nsh -e "$s" "$@"\n',
  );
  s.write(repo, ".husky/pre-commit", "printf 'existing-check\\n' >&2\n");
  const pkg = '{"type":"module","scripts":{"prepare":"husky"}}\n';
  s.write(repo, "package.json", pkg);
  const before = s.snapshot(repo);
  assert.equal(s.check(repo).hook.status, "unverified");
  assert.deepEqual(s.snapshot(repo), before);
  s.write(
    repo,
    ".husky/pre-commit",
    `printf 'existing-check\\n' >&2\n${checkCommand} || exit $?\nprintf 'after-validation\\n' >&2\n`,
  );
  // A manager can regenerate the dispatcher without losing business-owned integration.
  s.write(repo, ".husky/_/pre-commit", entry);
  const integrated = s.snapshot(repo);
  s.check(repo);
  s.check(repo);
  assert.deepEqual(s.snapshot(repo), integrated);
  s.git(repo, ["add", "."]);
  const accepted = s.git(repo, ["commit", "-m", "Valid delegated hook"]);
  assert.match(accepted, /existing-check/);
  assert.match(accepted, /after-validation/);
  assert.equal(readFileSync(join(repo, "package.json"), "utf8"), pkg);
  const head = s.git(repo, ["rev-parse", "HEAD"]).trim();
  s.write(repo, "docs/project/workflow.json", invalidWorkflow);
  s.git(repo, ["add", "docs/project/workflow.json"]);
  const rejected = s.git(repo, ["commit", "-m", "Invalid delegated hook"], 1);
  assert.match(rejected, /existing-check/);
  assert.match(rejected, /\/releaseBranch/);
  assert.doesNotMatch(rejected, /after-validation/);
  assert.equal(s.git(repo, ["rev-parse", "HEAD"]).trim(), head);
});

test("setup requires a configured integration branch and reports permissions without modifying refs", (t) => {
  const s = sandbox(t),
    repo = s.makeRepo("integration setup");
  s.provision(repo);
  const before = s.snapshot(repo),
    ready = s.check(repo);
  assert.equal(ready.integration.branch, "develop");
  assert.equal(ready.integration.defaultMergeTarget, "develop");
  assert.equal(ready.integration.remotePermissions, "unverified");
  assert.deepEqual(s.snapshot(repo), before);
  s.git(repo, ["branch", "-D", "develop"]);
  assert.match(
    s.check(repo, 1).issues.join("\n"),
    /prepare integration branch develop/,
  );
  s.write(repo, "docs/project/workflow.json", {
    schemaVersion: 1,
    releaseBranch: "main",
  });
  assert.match(s.check(repo, 1).issues.join("\n"), /complete SpecTrail Setup/);
});

test("inherited preview records skip local artifact checks but still require valid staged structure", (t) => {
  const s = sandbox(t),
    repo = s.makeRepo("inherited previews");
  s.provision(repo);
  s.git(repo, ["switch", "develop"]);
  s.write(repo, "docs/project/workflow.json", {
    ...validWorkflow,
    prototype: { status: "enabled", packagePath: "packages/prototype" },
  });
  const path = "docs/project/changes/feature/change.json";
  const value = {
    ...validChange,
    previews: [
      {
        id: "card",
        title: "Card",
        kind: "component",
        viewport: { width: 400, height: 300 },
        artifact: {
          type: "git",
          path: "packages/prototype/preview/card",
          sourceCommit: "a".repeat(40),
        },
      },
    ],
  };
  s.write(repo, path, value);
  s.git(repo, ["add", "docs/project"]);
  const validator = join(
    repo,
    ".agents/skills/spec-trail/setup/scripts/pre-commit.js",
  );
  s.run(process.execPath, [validator], repo);
  s.write(repo, path, { ...value, title: "" });
  s.git(repo, ["add", path]);
  assert.match(s.run(process.execPath, [validator], repo, 1), /\/title/);
  s.write(repo, path, { ...value, branch: "develop" });
  s.git(repo, ["add", path]);
  assert.match(
    s.run(process.execPath, [validator], repo, 1),
    /unknown source commit/,
  );
});

test("setup accepts subdirectories and rejects bare or non-Git directories", (t) => {
  const s = sandbox(t);
  const repo = s.makeRepo("nested checker invocation");
  s.provision(repo);
  assert.equal(s.check(join(repo, "docs/project")).repository, repo);
  const plain = join(s.base, "plain");
  mkdirSync(plain);
  s.run(process.execPath, [checker, plain], s.base, 1);
  s.run("git", ["init", "--bare", join(s.base, "bare")], s.base);
  s.run(process.execPath, [checker, join(s.base, "bare")], s.base, 1);
});
