import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { relative } from "node:path";
import { prepare, register, checkedPath, artifactDigest } from "./publishing.mjs";
import { validateRequest, validateResult } from "./publication-contract.mjs";
import { encodeUploadHeader, uploadType } from "./upload-protocol.mjs";
import { serviceUrl } from "./contract.mjs";
import { validateWorkflow } from "../../scripts/state-schema.mjs";

const read = (path) => {
  const text = readFileSync(path, "utf8");
  try { return JSON.parse(text); } catch { throw Error("Invalid publication or workflow JSON file"); }
};
const endpoint = (base, path) => new URL(path, base.replace(/\/?$/, "/")).href;
async function jsonResponse(response) {
  if (!response.ok) throw Error(`OpenFolio request failed (HTTP ${response.status}); existing references retained`);
  if (!response.body) throw Error("Empty OpenFolio response");
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) throw Error("OpenFolio response exceeds limits");
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw Error("Invalid OpenFolio JSON response"); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function send(url, options) {
  try { return await fetch(url, { ...options, redirect: "error" }); }
  catch { throw Error("OpenFolio request failed or redirected; check the configured address and retry. Existing references retained."); }
}
export async function discoverUpload(base) {
  if (!serviceUrl(base)) throw Error("Provide an HTTP/HTTPS OpenFolio service URL");
  const password = process.env.OPENFOLIO_ADMIN_PASSWORD;
  if (!password) throw Error("Set OPENFOLIO_ADMIN_PASSWORD locally to retrieve the upload address");
  const signal = AbortSignal.timeout(30_000);
  const login = await send(endpoint(base, "api/access"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: password }), signal });
  await jsonResponse(login);
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => /^openfolio-admin=[A-Za-z0-9_-]+$/.test(c));
  if (!cookie) throw Error("OpenFolio did not return an administrator session");
  const info = await jsonResponse(await send(endpoint(base, "api/prototype-hosting"), { headers: { cookie }, signal }));
  if (!/^\/api\/prototype-uploads\/[A-Za-z0-9_-]{43}$/.test(info?.uploadPath)) throw Error("Invalid OpenFolio upload response");
  return endpoint(base, info.uploadPath.slice(1));
}

export async function uploadToOpenFolio(root, { requestPath, resultPath, change }) {
  if (!requestPath || !resultPath) throw Error("Provide --request and --result paths; keep them outside the repository");
  const workflow = read(checkedPath(root, "docs/project/workflow.json"));
  if (validateWorkflow(workflow).length || workflow.prototype?.status !== "enabled" || workflow.prototype.hosting?.provider !== "openfolio")
    throw Error("Choose enabled OpenFolio hosting in workflow.json before uploading");
  const request = read(requestPath);
  validateRequest(request);
  const directory = relative(root, request.artifactDirectory).split("\\").join("/");
  const prepared = prepare(root, directory, request.entries, request.repository);
  if (prepared.requestId !== request.requestId) throw Error("Sources or artifact changed after prepare; prepare a new request");
  const { files } = artifactDigest(prepared.artifactDirectory);
  const inventory = files.map((path) => ({ path, size: statSync(checkedPath(root, `${directory}/${path}`)).size }));
  const signal = AbortSignal.timeout(120_000);
  async function* body() {
    yield encodeUploadHeader(request, inventory);
    for (const file of inventory) {
      const handle = await open(checkedPath(root, `${directory}/${file.path}`), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if (!(await handle.stat()).isFile()) throw Error("Artifact must contain regular files");
        for await (const chunk of handle.createReadStream({ autoClose: false, signal })) yield chunk;
      } finally { await handle.close(); }
    }
  }
  const wire = await jsonResponse(await send(workflow.prototype.hosting.uploadUrl, { method: "POST", headers: { "content-type": uploadType }, body: body(), duplex: "half", signal }));
  if (!Array.isArray(wire.entries) || wire.version !== request.requestId) throw Error("Invalid OpenFolio publication response");
  const result = { ...wire, entries: wire.entries.map((entry) => {
    const source = request.entries.find((e) => e.id === entry.id);
    if (!source || entry.path !== `prototype-assets/${request.requestId}/${source.entryPath}${source.hash ?? ""}` || Object.keys(entry).sort().join() !== "id,path")
      throw Error("OpenFolio returned an unexpected entry path");
    return { id: entry.id, url: endpoint(workflow.openfolioUrl, entry.path) };
  }) };
  validateResult(request, result);
  if (existsSync(resultPath)) {
    const prior = read(resultPath);
    validateResult(request, prior);
    if (JSON.stringify(prior) !== JSON.stringify(result)) throw Error("Result file belongs to a different publication; refusing overwrite");
  } else writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  // Saved request/result allow a standalone register retry if the local repository changed during upload.
  register(root, { request, result, change });
  return result;
}
