// Shared, filesystem-independent source rules for the CLI, hook and workbench.
export const validBranchName = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value !== "@" &&
  value !== "HEAD" &&
  !value.startsWith("-") &&
  !value.startsWith("refs/") &&
  !value.startsWith("origin/") &&
  !/[\s\x00-\x1f\x7f~^:?*\[\\]|\.\.|@\{|\/\/|^\/|\/$|\.$/.test(value) &&
  value
    .split("/")
    .every((part) => !part.startsWith(".") && !part.endsWith(".lock"));

export function workflowRoutingIssues(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return errors;
  if (value.schemaVersion !== 3)
    errors.push("/schemaVersion: only workflow version 3 is supported; complete SpecTrail Setup");
  if (!validBranchName(value.integrationBranch))
    errors.push("/integrationBranch: a valid local branch name is required");
  if (!validBranchName(value.releaseBranch))
    errors.push("/releaseBranch: a valid local branch name is required");
  if (value.releaseBranch === value.integrationBranch)
    errors.push("/integrationBranch: integration and release branches must be distinct");
  return errors;
}

export function changeLocation(path) {
  const match =
    /^docs\/project\/(changes|archive)\/([^/]+)\/change\.json$/.exec(path);
  if (!match) return null;
  const archived = match[1] === "archive";
  const date = archived ? match[2].slice(0, 10) : null;
  const id = archived ? match[2].slice(11) : match[2];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return null;
  if (
    archived &&
    (!/^\d{4}-\d{2}-\d{2}-/.test(match[2]) ||
      !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
  )
    return null;
  return { id, archived, directory: path.slice(0, -12) };
}

export function closedRecord(state, directory) {
  const steps = ["verification", "acceptance", "specs", "archive"];
  return (
    !!state &&
    state.status === "completed" &&
    state.stage === "close" &&
    !state.waitingFor &&
    state.closure?.verification?.result === "passed" &&
    state.closure?.acceptance?.result === "accepted" &&
    ["synced", "not_needed"].includes(state.closure?.specs?.result) &&
    state.closure?.archive?.result === "done" &&
    state.closure.archive.path === directory &&
    steps.every(
      (key, i) =>
        Number.isFinite(Date.parse(state.closure[key]?.at)) &&
        (!i ||
          Date.parse(state.closure[key].at) >=
            Date.parse(state.closure[steps[i - 1]].at)),
    ) &&
    !!state.tasks &&
    Object.values(state.tasks).every((task) => task?.status === "done")
  );
}

/** @typedef {{ id: string, entryPath: string, branch: string|null, kind: 'planning'|'target'|'archive'|'invalid', errors: string[] }} ChangeRoute */
/**
 * Read only identity/ownership from live entries; their other fields may be stale.
 * @param {{path: string, state: any, error?: string}[]} entries
 * @param {string} integrationBranch
 * @param {string} [releaseBranch]
 * @returns {ChangeRoute[]}
 */
export function routeCatalog(
  entries,
  integrationBranch,
  releaseBranch,
) {
  const groups = new Map();
  for (const entry of entries) {
    const location = changeLocation(entry.path);
    if (!location) continue;
    const group = groups.get(location.id) ?? [];
    group.push({ ...entry, ...location });
    groups.set(location.id, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, group]) => {
      const entry = group[0],
        state = entry.state;
      const errors =
        group.length === 1
          ? []
          : [
              "The collaboration branch contains duplicate live/archive entries for this id",
            ];
      if (entry.error) errors.push(entry.error);
      if (state?.id !== id)
        errors.push("The directory id does not match change.json.id");
      if (!validBranchName(state?.branch))
        errors.push("Invalid change.json.branch");
      /** @type {ChangeRoute['kind']} */
      const kind = entry.archived
        ? "archive"
        : state?.branch === integrationBranch
          ? "planning"
          : "target";
      if (entry.archived && !closedRecord(state, entry.directory))
        errors.push(
          "The collaboration archive does not contain a valid completed record",
        );
      if (!entry.archived && releaseBranch && releaseBranch === state?.branch)
        errors.push("A live Change cannot be owned by the release branch");
      return {
        id,
        entryPath: entry.path,
        branch: errors.length
          ? null
          : kind === "archive"
            ? integrationBranch
            : state.branch,
        kind: errors.length ? "invalid" : kind,
        errors,
      };
    });
}
