// SpecTrail staged validation. Node.js built-ins only.

async function main() {
  const prototypeContract = await import(
    "../../prototype/scripts/contract.mjs"
  );
  const { validateChange, validateWorkflow } = await import(
    "../../scripts/state-schema.mjs"
  );
  // Dynamic import works in both CommonJS and ESM projects.
  const { execFileSync } = await import("node:child_process");
  const { isDeepStrictEqual } = await import("node:util");
  const git = (args) =>
    execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });
  // Preserve GIT_INDEX_FILE so partial commits validate the index Git actually commits.
  process.chdir(git(["rev-parse", "--show-toplevel"]).trim());
  const paths = git([
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMT",
    "--no-renames",
    "-z",
    "--",
    "docs/project/",
  ])
    .split("\0")
    .filter(Boolean);
  let count = 0;
  let failed = false;
  for (const path of paths) {
    const validate =
      path === "docs/project/workflow.json"
        ? validateWorkflow
        : /^docs\/project\/(changes|archive)\/[^/]+\/change\.json$/.test(path)
          ? validateChange
          : undefined;
    if (!validate) continue;
    count++;
    const errors = [];
    let value;
    try {
      value = JSON.parse(git(["show", `:${path}`]));
    } catch {
      errors.push("/: cannot read valid JSON from the index");
    }
    if (!errors.length) errors.push(...validate(value));
    for (const error of errors) console.error(`${path}: ${error}`);
    failed ||= errors.length > 0;
  }
  // Cross-file checks always use the index, including GIT_INDEX_FILE for partial commits.
  const rows = git(["ls-files", "--stage", "-z"]).split("\0").filter(Boolean);
  const indexed = new Map(
    rows.map((row) => {
      const tab = row.indexOf("\t");
      return [row.slice(tab + 1), row.slice(0, tab).split(" ")];
    }),
  );
  const readState = (ref) => {
    try {
      return JSON.parse(git(["show", ref]));
    } catch {
      return null;
    }
  };
  const workflow = readState(":docs/project/workflow.json");
  const config = workflow?.prototype;
  let branch;
  try {
    branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"]).trim();
  } catch {}
  for (const [path] of indexed) {
    if (!/^docs\/project\/changes\/[^/]+\/change\.json$/.test(path)) continue;
    const value = readState(`:${path}`);
    // Inherited entries retain old preview metadata. Their authoritative files
    // live on another branch, so local cross-file checks cannot validate them.
    if (workflow && branch && value?.branch !== branch)
      continue;
    if (!Array.isArray(value?.previews) || !value.previews.length) continue;
    const changed = paths.includes(path);
    const previous = readState(`HEAD:${path}`)?.previews;
    const errors = [];
    if (config?.status !== "enabled") {
      if (
        changed &&
        (!Array.isArray(previous) ||
          !value.previews.every((preview) =>
            previous.some((old) => isDeepStrictEqual(old, preview)),
          ))
      )
        errors.push(
          "/previews: project prototype tracking is not enabled; remove associations or complete setup first",
        );
    } else {
      for (const [i, preview] of value.previews.entries()) {
        if (prototypeContract.validatePreviews([preview]).length) {
          errors.push(`/previews/${i}: invalid reference`);
          continue;
        }
        if (preview.artifact) {
          try {
            if (
              git(["cat-file", "-t", preview.artifact.sourceCommit]).trim() !==
              "commit"
            )
              throw Error();
          } catch {
            errors.push(`/previews/${i}/sourceCommit: unknown source commit`);
          }
          if (preview.artifact.type === "hosted") continue;
        }
        const entry = prototypeContract.entryPath(
          preview,
          config,
          path.slice(0, -12),
        );
        const indexedEntry = entry && indexed.get(entry);
        if (
          !entry ||
          !indexedEntry ||
          !["100644", "100755"].includes(indexedEntry[0]) ||
          indexedEntry[2] !== "0"
        )
          errors.push(
            `/previews/${i}/path: entry must be a staged regular index.html inside the configured preview directory`,
          );
      }
    }
    for (const error of errors) console.error(`${path}: ${error}`);
    failed ||= errors.length > 0;
  }
  if (config?.status === "enabled") {
    const manifestPath = `${config.packagePath}/prototype.json`;
    if (indexed.has(manifestPath)) {
      const manifest = readState(`:${manifestPath}`),
        issues = prototypeContract.validateManifest(manifest);
      if (!issues.length)
        for (const entry of manifest.entries) {
          if (!entry.sourcePath.startsWith(config.packagePath + "/"))
            issues.push("Source must stay in prototype package");
          if (entry.artifact?.type === "git") {
            const file = prototypeContract.entryPath(
              prototypeContract.currentPreview(entry),
              config,
            );
            if (!file || !["100644", "100755"].includes(indexed.get(file)?.[0]))
              issues.push("Current Git entry must be a staged regular file");
          }
        }
      for (const issue of issues) console.error(`${manifestPath}: ${issue}`);
      failed ||= issues.length > 0;
    }
  }
  if (failed) {
    console.error(
      "SpecTrail: fix the reported state files and stage the corrections before committing.",
    );
    process.exitCode = 1;
  } else {
    console.log(
      count
        ? `SpecTrail: ${count} staged state file(s) passed rule validation.`
        : "SpecTrail: no staged state files to validate.",
    );
  }
}

main().catch((error) => {
  console.error(`SpecTrail: ${error.message}`);
  process.exitCode = 1;
});
