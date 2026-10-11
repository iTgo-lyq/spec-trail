// Pure publication identity and result validation, shared by clients and the service.
import { createHash } from "node:crypto";
import { hostedUrl, commitHash, safePath, validateArtifact } from "./contract.mjs";
const fail = (condition, message) => { if (!condition) throw Error(message); };
const sha = (value) => createHash("sha256").update(value).digest("hex");
function exact(value, keys, required = keys) {
  fail(
    value && typeof value === "object" && !Array.isArray(value),
    "Expected an object",
  );
  fail(
    Object.keys(value).every((k) => keys.includes(k)) &&
      required.every((k) => Object.hasOwn(value, k)),
    "Unexpected or missing protocol fields",
  );
}
export const requestIdentity = (r) =>
  sha(JSON.stringify([r.repository, r.sourceCommit, r.digest, r.entries]));
export function validateRequest(r) {
  exact(r, [
    "schemaVersion",
    "repository",
    "sourceCommit",
    "artifactDirectory",
    "digest",
    "entries",
    "requestId",
  ]);
  fail(
    r.schemaVersion === 1 &&
      hostedUrl(r.repository) &&
      !new URL(r.repository).hash &&
      commitHash(r.sourceCommit),
    "Invalid repository/source identity",
  );
  fail(
    typeof r.artifactDirectory === "string" &&
      r.artifactDirectory.length > 0 &&
      /^sha256:[a-f0-9]{64}$/.test(r.digest),
    "Invalid artifact identity",
  );
  fail(
    Array.isArray(r.entries) &&
      r.entries.length > 0 &&
      r.entries.length <= 2000,
    "Invalid publish entries",
  );
  const ids = new Set();
  for (const e of r.entries) {
    exact(e, ["id", "entryPath", "hash"], ["id", "entryPath"]);
    fail(
      typeof e.id === "string" &&
        /^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id) &&
        !ids.has(e.id) &&
        safePath(e.entryPath),
      "Invalid or duplicate entry",
    );
    ids.add(e.id);
    if (e.hash !== undefined)
      fail(
        typeof e.hash === "string" && /^#[^\s\u0000-\u001f]*$/.test(e.hash),
        "Invalid route hash",
      );
  }
  fail(r.requestId === requestIdentity(r), "Request identity mismatch");
}
export function validateResult(request, result) {
  validateRequest(request);
  if (result?.status === "failed") {
    exact(result, [
      "schemaVersion",
      "status",
      "requestId",
      "code",
      "message",
      "retryable",
    ]);
    fail(
      result.schemaVersion === 1 &&
        result.requestId === request.requestId &&
        typeof result.retryable === "boolean" &&
        typeof result.code === "string" &&
        result.code.length > 0 &&
        typeof result.message === "string" &&
        result.message.length > 0,
      "Invalid failed result",
    );
    throw Error(
      `Host publication failed (${result.code}); existing references retained`,
    );
  }
  exact(result, [
    "schemaVersion",
    "status",
    "requestId",
    "sourceCommit",
    "digest",
    "version",
    "entries",
  ]);
  fail(
    result.status === "published" &&
      result.schemaVersion === 1 &&
      result.requestId === request.requestId &&
      result.sourceCommit === request.sourceCommit &&
      result.digest === request.digest,
    "Publish result does not match request",
  );
  fail(
    Array.isArray(result.entries) &&
      result.entries.length === request.entries.length,
    "Incomplete publication",
  );
  const seen = new Set();
  for (const e of result.entries) {
    exact(e, ["id", "url", "thumbnails"], ["id", "url"]);
    fail(
      request.entries.some((p) => p.id === e.id) && !seen.has(e.id),
      "Duplicate or unknown result entry",
    );
    seen.add(e.id);
    const artifact = resultArtifact(result, e);
    fail(
      !validateArtifact(artifact).length,
      validateArtifact(artifact).join("; "),
    );
  }
}
export const resultArtifact = (result, e) => ({
  type: "hosted",
  version: result.version,
  url: e.url,
  sourceCommit: result.sourceCommit,
  digest: result.digest,
  ...(e.thumbnails ? { thumbnails: e.thumbnails } : {}),
});
