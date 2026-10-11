import { safePath } from "./contract.mjs";
import { validateRequest } from "./publication-contract.mjs";
export const uploadType = "application/vnd.openfolio.prototype";
export const uploadMagic = Buffer.from("OFPA1\n");
export const maxHeaderBytes = 1024 * 1024;
export const maxArtifactBytes = 100 * 1024 * 1024;
export const maxArtifactFiles = 2000;
export function digestPrefix(path, size) {
  const name = Buffer.from(path), lengths = Buffer.alloc(16);
  lengths.writeBigUInt64BE(BigInt(name.length));
  lengths.writeBigUInt64BE(BigInt(size), 8);
  return Buffer.concat([lengths, name]);
}
// Match the existing sorted, depth-first artifact digest traversal.
function comparePaths(a, b) {
  const left = a.split("/"), right = b.split("/");
  for (let i = 0; i < Math.min(left.length, right.length); i++)
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  return left.length - right.length;
}
export function validateUpload(header) {
  if (!header || Object.keys(header).sort().join() !== "files,request") throw Error("Invalid upload header");
  validateRequest(header.request);
  const files = header.files;
  if (!Array.isArray(files) || !files.length || files.length > maxArtifactFiles) throw Error("Invalid file count");
  let total = 0;
  const paths = new Set();
  for (const [index, file] of files.entries()) {
    if (!file || Object.keys(file).sort().join() !== "path,size" || !safePath(file.path) ||
        !Number.isSafeInteger(file.size) || file.size < 0 || paths.has(file.path) ||
        (index && comparePaths(files[index - 1].path, file.path) >= 0)) throw Error("Invalid file inventory");
    total += file.size;
    if (total > maxArtifactBytes) throw Error("Artifact exceeds limits");
    paths.add(file.path);
  }
  for (const path of paths) {
    const parts = path.split("/");
    while (parts.length > 1) { parts.pop(); if (paths.has(parts.join("/"))) throw Error("Conflicting file paths"); }
  }
  if (header.request.entries.some((e) => !paths.has(e.entryPath))) throw Error("Missing entry file");
  return total;
}
export function encodeUploadHeader(request, files) {
  const header = { request, files };
  validateUpload(header);
  const body = Buffer.from(JSON.stringify(header));
  if (body.length > maxHeaderBytes) throw Error("Upload header exceeds limits");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length);
  return Buffer.concat([uploadMagic, size, body]);
}
