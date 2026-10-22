import { validateRequest, validateResult, requestIdentity, resultArtifact } from "./publication-contract.mjs";
export { validateRequest, validateResult } from "./publication-contract.mjs";
import { digestPrefix } from "./upload-protocol.mjs";
// Host-side publishing primitives. Never imported by the OpenFolio server.
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { hostname } from "node:os";
import {
  validateManifest,
  validatePreviews,
  validateArtifact,
  currentPreview,
  safePath,
  hostedUrl,
  commitHash,
  entryPath,
} from "./contract.mjs";
import {
  validateChange,
  validateWorkflow,
} from "../../scripts/state-schema.mjs";
import { htmlIssues } from "./html.mjs";
const fail = (condition, message) => {
  if (!condition) throw Error(message);
};
export const git = (root, args) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
const json = (value) => JSON.stringify(value, null, 2) + "\n";
export function checkedPath(root, path) {
  fail(safePath(path), "Unsafe repository path");
  let at = root;
  for (const part of path.split("/")) {
    at = join(at, part);
    try {
      fail(!lstatSync(at).isSymbolicLink(), "Symbolic links are not allowed");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  return at;
}
export function artifactDigest(directory) {
  fail(
    !lstatSync(directory).isSymbolicLink() &&
      lstatSync(directory).isDirectory(),
    "Artifact directory must be regular",
  );
  const h = createHash("sha256"),
    files = [];
  let bytes = 0;
  const walk = (at, prefix = "") => {
    for (const name of readdirSync(at).sort()) {
      const path = prefix + name,
        full = join(at, name),
        stat = lstatSync(full);
      fail(safePath(path) && !stat.isSymbolicLink(), "Unsafe artifact file");
      if (stat.isDirectory()) walk(full, path + "/");
      else {
        fail(stat.isFile(), "Artifact must contain regular files");
        bytes += stat.size;
        files.push(path);
        fail(
          files.length <= 2000 && bytes <= 100 * 1024 * 1024,
          "Artifact exceeds limits",
        );
        const body = readFileSync(full);
        h.update(digestPrefix(path, body.length)).update(body);
      }
    }
  };
  walk(directory);
  fail(files.length > 0, "Artifact is empty");
  return { digest: `sha256:${h.digest("hex")}`, files };
}
function configuration(root) {
  const workflow = JSON.parse(
    readFileSync(checkedPath(root, "docs/project/workflow.json"), "utf8"),
  );
  fail(
    !validateWorkflow(workflow).length &&
      workflow.prototype?.status === "enabled",
    "Prototype collaboration must be enabled",
  );
  const path = workflow.prototype.packagePath + "/prototype.json",
    manifest = JSON.parse(readFileSync(checkedPath(root, path), "utf8"));
  fail(
    !validateManifest(manifest).length,
    validateManifest(manifest).join("; "),
  );
  for (const e of manifest.entries)
    fail(
      e.sourcePath.startsWith(workflow.prototype.packagePath + "/"),
      "Source must stay in the prototype package",
    );
  return { workflow, path, manifest };
}
export function prepare(root, directory, entries, repository) {
  root = realpathSync(root);
  const { manifest } = configuration(root);
  fail(
    !git(root, ["status", "--porcelain", "--untracked-files=normal"]),
    "Commit sources and metadata before preparing a publication",
  );
  const artifactDirectory = checkedPath(root, directory),
    { digest, files } = artifactDigest(artifactDirectory);
  const request = {
    schemaVersion: 1,
    repository,
    sourceCommit: git(root, ["rev-parse", "HEAD"]),
    artifactDirectory,
    digest,
    entries: [...entries].sort((a, b) => a.id.localeCompare(b.id)),
    requestId: "",
  };
  request.requestId = requestIdentity(request);
  validateRequest(request);
  for (const e of request.entries) {
    const entry = manifest.entries.find((p) => p.id === e.id);
    fail(
      entry && files.includes(e.entryPath),
      "Missing declared entry or output",
    );
    fail(
      /^100(?:644|755) blob /.test(
        git(root, ["ls-tree", request.sourceCommit, "--", entry.sourcePath]),
      ),
      "Source must be a committed regular file",
    );
  }
  return request;
}
function paths(root) {
  const common = git(root, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  return {
    lock: join(common, "spec-trail-state.lock"),
    journal: join(common, "spec-trail-prototype-transaction.json"),
  };
}
export function withLock(root, fn) {
  const { lock } = paths(root);
  try {
    mkdirSync(lock);
  } catch (error) {
    if (error.code === "EEXIST")
      throw Error(
        `Another state operation holds ${lock}. Inspect owner.json (if present), the owning process and worktree; only remove a confirmed stale lock, then run publish.mjs recover. Never remove an active or unverified lock.`,
      );
    throw error;
  }
  try {
    writeFileSync(join(lock, "owner.json"), json({
      pid: process.pid, hostname: hostname(), root: realpathSync(root), startedAt: new Date().toISOString(),
    }), { flag: "wx", mode: 0o600 });
    return fn();
  } finally {
    rmSync(lock, { recursive: true });
  }
}
function rollback(root, journal) {
  fail(
    journal.root === root && Array.isArray(journal.files),
    "Transaction belongs to another worktree",
  );
  // Check every file before restoring any, so concurrent edits are not overwritten.
  for (const f of journal.files) {
    const p = checkedPath(root, f.path),
      actual = existsSync(p) ? readFileSync(p).toString("base64") : null;
    fail(
      actual === f.before || actual === f.after,
      "Transaction recovery conflicts with newer edits",
    );
  }
  for (const f of journal.files) {
    const p = checkedPath(root, f.path);
    if (f.before === null) rmSync(p, { force: true });
    else writeFileSync(p, Buffer.from(f.before, "base64"));
  }
}
export function recover(root) {
  root = realpathSync(root);
  return withLock(root, () => {
    const { journal } = paths(root);
    fail(existsSync(journal), "No pending transaction");
    rollback(root, JSON.parse(readFileSync(journal, "utf8")));
    rmSync(journal);
  });
}
export function transaction(root, files) {
  const { journal } = paths(root);
  fail(
    !existsSync(journal),
    "Recover the unfinished prototype transaction first",
  );
  const changes = files.map((f) => {
    const p = checkedPath(root, f.path);
    fail(
      !existsSync(p) || lstatSync(p).isFile(),
      "Target is not a regular file",
    );
    return {
      ...f,
      before: existsSync(p) ? readFileSync(p).toString("base64") : null,
      after: Buffer.from(f.body).toString("base64"),
    };
  });
  writeFileSync(
    journal,
    json({
      root,
      files: changes.map(({ path, before, after }) => ({
        path,
        before,
        after,
      })),
    }),
    { flag: "wx", mode: 0o600 },
  );
  try {
    for (const f of changes) {
      const p = checkedPath(root, f.path);
      mkdirSync(dirname(p), { recursive: true });
      const tmp = p + `.${randomUUID()}.tmp`;
      try {
        writeFileSync(tmp, f.body);
        renameSync(tmp, p);
      } finally {
        rmSync(tmp, { force: true });
      }
    }
    rmSync(journal);
  } catch (e) {
    rollback(root, { root, files: changes });
    rmSync(journal);
    throw e;
  }
}
function assertSource(root, commit) {
  fail(
    commitHash(commit) && git(root, ["cat-file", "-t", commit]) === "commit",
    "Invalid source commit",
  );
  git(root, ["merge-base", "--is-ancestor", commit, "HEAD"]);
}
function changeRecord(root, id, branch) {
  fail(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id), "Invalid Change id");
  const path = `docs/project/changes/${id}/change.json`,
    state = JSON.parse(readFileSync(checkedPath(root, path), "utf8"));
  fail(
    !validateChange(state).length &&
      state.id === id &&
      state.status === "active" &&
      state.branch === branch,
    "Use the active Change's own branch",
  );
  return { path, state };
}
/** @param {string} root @param {{request?: any, result?: any, change?: string, gitEntry?: string}} options */
export function register(root, { request, result, change, gitEntry }) {
  root = realpathSync(root);
  return withLock(root, () => {
    fail(
      !existsSync(paths(root).journal),
      "Recover the unfinished prototype transaction first",
    );
    const { workflow, path, manifest } = configuration(root),
      branch = git(root, ["symbolic-ref", "--short", "HEAD"]);
    fail(
      workflow.releaseBranch !== branch,
      "Register on a working branch, not a protected branch",
    );
    // A cancelled record freezes its branch, even for a current-only publication.
    const activeDir = checkedPath(root, "docs/project/changes");
    if (existsSync(activeDir))
      for (const id of readdirSync(activeDir)) {
        const p = checkedPath(root, `docs/project/changes/${id}/change.json`);
        if (existsSync(p)) {
          const s = JSON.parse(readFileSync(p, "utf8"));
          fail(
            !(s.branch === branch && s.status === "cancelled"),
            "Cancelled Change branch is frozen",
          );
        }
      }
    const target = change ? changeRecord(root, change, branch) : null,
      files = [],
      updates = [];
    if (gitEntry) {
      const entry = manifest.entries.find((p) => p.id === gitEntry);
      fail(entry, "Unknown current entry");
      const sourceCommit = git(root, ["rev-parse", "HEAD"]);
      assertSource(root, sourceCommit);
      fail(
        /^100(?:644|755) blob /.test(
          git(root, ["ls-tree", sourceCommit, "--", entry.sourcePath]),
        ),
        "Commit the source before Git delivery",
      );
      fail(
        !git(root, [
          "status",
          "--porcelain",
          "--",
          ".",
          ":(exclude)docs/project",
          `:(exclude)${workflow.prototype.packagePath}/prototype.json`,
          `:(exclude)${workflow.prototype.packagePath}/preview`,
        ]),
        "Source or dependencies have uncommitted changes",
      );
      const artifact = {
        type: "git",
        path: `${workflow.prototype.packagePath}/preview/${entry.id}`,
        sourceCommit,
      };
      const full = checkedPath(root, artifact.path + "/index.html");
      fail(
        lstatSync(full).isFile() && lstatSync(full).size <= 10 * 1024 * 1024,
        "Invalid fallback HTML",
      );
      const body = readFileSync(full);
      fail(
        !htmlIssues(new TextDecoder("utf-8", { fatal: true }).decode(body))
          .length,
        "Git fallback requires self-contained UTF-8 HTML",
      );
      entry.artifact = artifact;
      const preview = currentPreview(entry);
      if (target) {
        preview.artifact = {
          ...artifact,
          path: `docs/project/changes/${change}/previews/${entry.id}`,
        };
        files.push({ path: preview.artifact.path + "/index.html", body });
      }
      updates.push(preview);
    } else {
      validateResult(request, result);
      assertSource(root, request.sourceCommit);
      const relativeDirectory = relative(
        root,
        resolve(request.artifactDirectory),
      );
      fail(
        artifactDigest(checkedPath(root, relativeDirectory)).digest ===
          request.digest,
        "Build output changed since publication request",
      );
      // Inspect all known historical references to reject known immutable URL collisions.
      const known = manifest.entries.map((e) => e.artifact);
      for (const folder of ["changes", "archive"]) {
        const dir = checkedPath(root, `docs/project/${folder}`);
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(dir)) {
          const p = checkedPath(
            root,
            `docs/project/${folder}/${name}/change.json`,
          );
          if (existsSync(p)) {
            const s = JSON.parse(readFileSync(p, "utf8"));
            for (const e of s.previews ?? []) known.push(e.artifact);
          }
        }
      }
      for (const e of result.entries) {
        const entry = manifest.entries.find((p) => p.id === e.id);
        fail(entry, "Unknown current entry");
        fail(
          /^100(?:644|755) blob /.test(
            git(root, [
              "ls-tree",
              request.sourceCommit,
              "--",
              entry.sourcePath,
            ]),
          ),
          "Missing source at publication commit",
        );
        const artifact = resultArtifact(result, e);
        for (const old of known)
          if (old?.type === "hosted" && old.url === artifact.url)
            fail(
              old.digest === artifact.digest &&
                old.version === artifact.version,
              "Cannot overwrite a known immutable URL",
            );
        entry.artifact = artifact;
        updates.push(currentPreview(entry));
      }
    }
    fail(
      !validateManifest(manifest).length,
      validateManifest(manifest).join("; "),
    );
    if (target) {
      target.state.previews = [
        ...(target.state.previews ?? []).filter(
          (p) => !updates.some((e) => e.id === p.id),
        ),
        ...updates,
      ];
      fail(
        !validateChange(target.state).length,
        validateChange(target.state).join("; "),
      );
      files.push({ path: target.path, body: json(target.state) });
    }
    files.push({ path, body: json(manifest) });
    transaction(root, files);
    return updates;
  });
}
