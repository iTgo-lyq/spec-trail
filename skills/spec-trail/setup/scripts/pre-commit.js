// SpecTrail staged validation. Node.js built-ins only.

async function main() {
  const prototypeContract = await import("../../prototype/scripts/contract.mjs");
  const { validateChange, validateWorkflow } = await import("../../scripts/state-schema.mjs");
  // Dynamic import works in both CommonJS and ESM projects.
  const { execFileSync } = await import("node:child_process");
  const { isDeepStrictEqual } = await import("node:util");
  const git = (args) => execFileSync("git", args, {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024,
  });
  // Preserve GIT_INDEX_FILE so partial commits validate the index Git actually commits.
  process.chdir(git(["rev-parse", "--show-toplevel"]).trim());
  const paths = git([
    "diff", "--cached", "--name-only", "--diff-filter=ACMT", "--no-renames", "-z", "--", "docs/project/",
  ]).split("\0").filter(Boolean);
  let count = 0;
  let failed = false;
  for (const path of paths) {
    const validate = path === "docs/project/workflow.json" ? validateWorkflow
      : /^docs\/project\/(changes|archive)\/[^/]+\/change\.json$/.test(path) ? validateChange : undefined;
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
  const indexed = new Map(rows.map(row => { const tab = row.indexOf("\t"); return [row.slice(tab + 1), row.slice(0, tab).split(" ")]; }));
  const readState = (ref) => { try { return JSON.parse(git(["show", ref])); } catch { return null; } };
  const config = readState(":docs/project/workflow.json")?.prototype;
  for (const [path] of indexed) {
    if (!/^docs\/project\/changes\/[^/]+\/change\.json$/.test(path)) continue;
    const value = readState(`:${path}`);
    if (!Array.isArray(value?.previews) || !value.previews.length) continue;
    const changed = paths.includes(path);
    const previous = readState(`HEAD:${path}`)?.previews;
    const errors = [];
    if (config?.status !== "enabled") {
      if (changed && (!Array.isArray(previous) || !value.previews.every(preview => previous.some(old => isDeepStrictEqual(old, preview))))) errors.push("/previews: project prototype tracking is not enabled; remove associations or complete setup first");
    } else {
      for (const [i, preview] of value.previews.entries()) {
        const entry = prototypeContract.entryPath(preview, config);
        const indexedEntry = entry && indexed.get(entry);
        if (!entry || !indexedEntry || !["100644", "100755"].includes(indexedEntry[0]) || indexedEntry[2] !== "0") errors.push(`/previews/${i}/path: entry must be a staged regular index.html inside the configured preview directory`);
      }
    }
    for (const error of errors) console.error(`${path}: ${error}`);
    failed ||= errors.length > 0;
  }
  if (failed) {
    console.error("SpecTrail: fix the reported state files and stage the corrections before committing.");
    process.exitCode = 1;
  } else {
    console.log(count ? `SpecTrail: ${count} staged state file(s) passed rule validation.` : "SpecTrail: no staged state files to validate.");
  }
}

main().catch((error) => {
  console.error(`SpecTrail: ${error.message}`);
  process.exitCode = 1;
});
