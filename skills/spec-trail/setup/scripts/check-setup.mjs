#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const skillPath = ".agents/skills/spec-trail";
const validatorPath = `${skillPath}/setup/scripts/pre-commit.js`;
const schemaPath = `${skillPath}/scripts/state-schema.mjs`;
const routingPath = `${skillPath}/scripts/routing.mjs`;
const contractPath = `${skillPath}/prototype/scripts/contract.mjs`;
const workflowPath = "docs/project/workflow.json";
const command = `node "$(git rev-parse --show-toplevel)/${validatorPath}"`;

try {
  const [repoArg = ".", ...extra] = process.argv.slice(2);
  if (extra.length) throw Error("Usage: node check-setup.mjs [repo-dir]");
  if (Number(process.versions.node.split(".")[0]) < 20)
    throw Error("Node.js 20 or newer is required.");
  const cwd = resolve(repoArg);
  const git = (args) =>
    execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  if (git(["rev-parse", "--is-bare-repository"]) === "true")
    throw Error("Choose a repository with a working tree.");
  const root = git(["rev-parse", "--show-toplevel"]);
  const issues = [];
  const resources = [validatorPath, schemaPath, routingPath, contractPath].map(
    (path) => {
      try {
        if (!statSync(join(root, path)).isFile()) throw Error("must be a file");
        const check = spawnSync(
          process.execPath,
          ["--check", join(root, path)],
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        if (check.error || check.status !== 0)
          throw Error(
            check.error?.message ||
              check.stderr.trim() ||
              "syntax check failed",
          );
        return { path, status: "ready" };
      } catch (error) {
        issues.push(
          `${path}: ${error.code === "ENOENT" ? "missing file" : error.message}`,
        );
        return { path, status: "not_ready" };
      }
    },
  );
  let schema;
  for (const [path, exports] of [
    [schemaPath, ["validateWorkflow", "validateChange"]],
    [routingPath, ["validBranchName", "routeCatalog"]],
    [contractPath, ["entryPath", "validatePrototype", "validatePreviews"]],
  ]) {
    const resource = resources.find((resource) => resource.path === path);
    if (resource.status !== "ready") continue;
    try {
      const module = await import(pathToFileURL(join(root, path)).href);
      for (const name of exports)
        if (typeof module[name] !== "function")
          throw Error(`must export ${name} as a function`);
      if (path === schemaPath) schema = module;
    } catch (error) {
      resource.status = "not_ready";
      issues.push(`${path}: ${error.message}`);
    }
  }
  const workflow = { path: workflowPath, status: "not_ready" };
  let collaboration;
  try {
    const value = JSON.parse(readFileSync(join(root, workflowPath), "utf8"));
    if (schema) {
      const errors = schema.validateWorkflow(value);
      issues.push(...errors.map((error) => `${workflowPath}: ${error}`));
      if (!errors.length) {
        const refs = [
          `refs/heads/${value.collaborationBranch}`,
          `refs/remotes/origin/${value.collaborationBranch}`,
        ];
        const available = refs.filter((ref) => {
          try {
            git(["show-ref", "--verify", ref]);
            return true;
          } catch {
            return false;
          }
        });
        collaboration = {
          branch: value.collaborationBranch,
          defaultMergeTarget: value.collaborationBranch,
          protectedBranches: value.protectedBranches,
          knownRefs: available,
          remotePermissions: "unverified",
        };
        if (!available.length)
          issues.push(
            `${workflowPath}: prepare collaboration branch ${value.collaborationBranch} before starting Changes`,
          );
        else workflow.status = "ready";
      }
    }
  } catch (error) {
    issues.push(
      `${workflowPath}: ${error.code === "ENOENT" ? "missing file" : error.message}`,
    );
  }
  const config = spawnSync(
    "git",
    ["-C", root, "config", "--get", "core.hooksPath"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (config.error || ![0, 1].includes(config.status))
    throw Error(
      config.error?.message ||
        config.stderr.trim() ||
        "Could not read core.hooksPath.",
    );
  // The Git entry can delegate to another file. Only execution evidence verifies integration.
  const hook = {
    status: "unverified",
    configuredPath: config.status === 0 ? config.stdout.trim() : null,
    gitEntryPath: git([
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "hooks/pre-commit",
    ]),
  };
  console.log(
    JSON.stringify(
      {
        repository: root,
        environment: { node: process.versions.node, git: git(["--version"]) },
        readiness: issues.length ? "not_ready" : "ready",
        resources,
        workflow,
        collaboration,
        hook,
        command,
        issues,
      },
      null,
      2,
    ),
  );
  if (issues.length) process.exitCode = 1;
} catch (error) {
  console.error(`SpecTrail setup: ${error.message}`);
  process.exitCode = 1;
}
