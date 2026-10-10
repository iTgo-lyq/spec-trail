// Example host adapter, explicitly run by the repository owner/CI. Not a server.
import { mkdirSync, existsSync, renameSync, cpSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  validateRequest,
  artifactDigest,
  validateResult,
} from "../scripts/publishing.mjs";
import { hostedUrl } from "../scripts/contract.mjs";
export function publishToDirectory(request, storageDirectory, baseUrl) {
  validateRequest(request);
  if (!hostedUrl(baseUrl) || new URL(baseUrl).hash)
    throw Error("Provide a credential-free HTTPS static host base URL");
  if (artifactDigest(request.artifactDirectory).digest !== request.digest)
    throw Error("Artifact changed after preparation");
  const root = resolve(storageDirectory),
    version = request.digest.slice(7),
    target = join(root, version);
  mkdirSync(root, { recursive: true });
  if (!existsSync(target)) {
    const staging = join(root, `.upload-${randomUUID()}`);
    try {
      cpSync(request.artifactDirectory, staging, {
        recursive: true,
        dereference: false,
      });
      if (artifactDigest(staging).digest !== request.digest)
        throw Error("Incomplete upload");
      try {
        renameSync(staging, target);
      } catch (e) {
        if (!["EEXIST", "ENOTEMPTY"].includes(e.code)) throw e;
      }
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
  if (artifactDigest(target).digest !== request.digest)
    throw Error("Immutable version collision; refusing overwrite");
  const result = {
    schemaVersion: 1,
    status: "published",
    requestId: request.requestId,
    sourceCommit: request.sourceCommit,
    digest: request.digest,
    version,
    entries: request.entries.map((e) => ({
      id: e.id,
      url: new URL(
        `${version}/${e.entryPath}${e.hash ?? ""}`,
        baseUrl.replace(/\/?$/, "/"),
      ).href,
    })),
  };
  validateResult(request, result);
  return result;
}
