#!/usr/bin/env node
import { parseArgs } from "node:util";
import { repository, recordsAt, revision } from "../../scripts/repository.mjs";
import { validBranchName, closedRecord } from "../../scripts/routing.mjs";
import { validateChange } from "../../scripts/state-schema.mjs";

// Read only known local/tracking refs. No fetching, branch enumeration or writes.
try {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      baseline: { type: "string" },
      "work-branch": { type: "string", multiple: true, default: [] },
    },
  });
  const repo = repository(values.repo);
  const baseline =
    values.baseline ?? repo.config.collaborationBranch;
  const collaborationBranch = repo.config.collaborationBranch;
  const errors = [],
    sources = [],
    proposals = [];
  if (!validBranchName(baseline))
    throw Error("--baseline requires a branch name");
  const knownTrees = repo
    .git(["worktree", "list", "--porcelain", "-z"])
    .split("\0")
    .filter((field) => field.startsWith("branch refs/heads/"))
    .map((field) => field.slice("branch refs/heads/".length));
  const known = new Set(values["work-branch"]);
  for (const branch of knownTrees)
    if (branch !== baseline && !repo.config.protectedBranches.includes(branch))
      known.add(branch);
  const read = (branch) => {
    if (!validBranchName(branch)) throw Error(`Invalid work branch: ${branch}`);
    const local = revision(repo, `refs/heads/${branch}`),
      remote = revision(repo, `refs/remotes/origin/${branch}`);
    const commit = remote ?? local;
    if (!commit) {
      errors.push(
        `Known branch ${branch} has no local or tracking ref; fetch it explicitly before preview`,
      );
      return [];
    }
    sources.push({
      branch,
      commit,
      localCommit: local,
      trackingCommit: remote,
      freshness: remote ? "cached-tracking-ref" : "local-only",
      differsFromTracking: !!local && !!remote && local !== remote,
    });
    if (local && remote && local !== remote)
      errors.push(
        `Branch ${branch} has local/tracking differences; inspect them before migration`,
      );
    return recordsAt(repo, commit).map((record) => {
      if (record.error)
        errors.push(`${branch}:${record.path}: ${record.error}`);
      return { ...record, sourceBranch: branch, sourceCommit: commit };
    });
  };
  const baselineRecords = read(baseline);
  for (const record of baselineRecords)
    if (
      validBranchName(record.state?.branch) &&
      record.state.branch !== baseline &&
      !record.archived
    )
      known.add(record.state.branch);
  known.delete(baseline);
  const candidates = [...known]
    .sort()
    .flatMap((branch) =>
      read(branch).filter((record) => record.state?.branch === branch),
    );
  const ids = [
    ...new Set([...baselineRecords, ...candidates].map((record) => record.id)),
  ].sort();
  for (const id of ids) {
    const base = baselineRecords.filter((record) => record.id === id),
      owned = candidates.filter((record) => record.id === id);
    const history =
      base.length === 1 &&
      base[0].archived &&
      !validateChange(base[0].state).length &&
      closedRecord(base[0].state, base[0].directory);
    const problems = [];
    if (base.length > 1 || owned.length > 1)
      problems.push("Multiple known live/archive sources claim this id");
    if (
      !history &&
      base.length === 1 &&
      owned.length === 1 &&
      base[0].state?.branch !== owned[0].sourceBranch
    )
      problems.push(
        "Baseline ownership conflicts with the known work branch; resolve the intended owner first",
      );
    if (
      history &&
      owned.some(
        (record) =>
          !record.archived || !closedRecord(record.state, record.directory),
      )
    )
      problems.push("Integrated historical id conflicts with current work");
    const record = history ? base[0] : (owned[0] ?? base[0]);
    if (record?.error || !record?.state || validateChange(record.state).length)
      problems.push("Source Change state is invalid");
    if (record?.state?.id !== id)
      problems.push("Source identity differs from its directory");
    if (
      record &&
      !history &&
      !owned.length &&
      record.state?.branch !== baseline
    )
      problems.push("Registered owner was not found among known sources");
    if (record?.archived && !closedRecord(record.state, record.directory))
      problems.push("Archive is not a complete closed record");
    if (record?.state?.status === "completed" && !record.archived)
      problems.push(
        "Completed record must be in its closed archive directory before migration",
      );
    if (
      !history &&
      owned.length &&
      repo.config.protectedBranches.includes(record.sourceBranch)
    )
      problems.push("Protected branch cannot own an execution entry");
    if (!history && owned.length && record.archived)
      problems.push(
        "Integrate the completed delivery before importing its archive as collaboration history",
      );
    if (
      !history &&
      !owned.length &&
      record?.state?.status === "active" &&
      record.state.size !== "xlarge" &&
      ["execution", "close"].includes(record.state.stage)
    )
      problems.push(
        "Active implementation requires an independent work branch before migration",
      );
    if (problems.length) {
      errors.push(...problems.map((message) => `${id}: ${message}`));
      proposals.push({ id, action: "resolve", errors: problems });
      continue;
    }
    proposals.push({
      id,
      action: history
        ? "keep-archive"
        : owned.length
          ? "register-owner"
          : "keep-planning",
      sourceBranch: record.sourceBranch,
      sourceCommit: record.sourceCommit,
      path: record.path,
      branch: history
        ? record.state.branch
        : owned.length
          ? record.sourceBranch
          : collaborationBranch,
      files: record.directory,
    });
  }
  console.log(
    JSON.stringify(
      {
        readonly: true,
        collaborationBranch,
        baseline,
        coverage: {
          worktreeBranches: knownTrees,
          explicitBranches: values["work-branch"],
          note: "Only baseline entries, registered worktrees and explicitly supplied branches were checked; unknown remote work was not discovered.",
        },
        sources,
        proposals,
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) process.exitCode = 1;
} catch (error) {
  console.error(`SpecTrail migration preview: ${error.message}`);
  process.exitCode = 1;
}
