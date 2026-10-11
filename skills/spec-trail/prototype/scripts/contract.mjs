// Shared, dependency-free contract for the hook, local tooling and OpenFolio.
export const devices = ["pc-web", "ipad", "mobile"];
export const isObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export const safePath = (v) =>
  typeof v === "string" &&
  v.length <= 1024 &&
  !/[\\\s%?#:\u0000-\u001f\u007f]/u.test(v) &&
  v
    .split("/")
    .every(
      (p) =>
        p &&
        p !== "." &&
        p !== ".." &&
        !p.startsWith(".") &&
        !["node_modules", "vendor"].includes(p),
    );
export const packagePath = (v) => safePath(v) && !/^docs(?:\/|$)/.test(v);
const nonempty = (v) => typeof v === "string" && /\S/.test(v);
const identity = (v) =>
  typeof v === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v);
const fields = (v, allowed, required, path, errors) => {
  if (!isObject(v)) {
    errors.push(`${path}: must be an object`);
    return false;
  }
  for (const k of Object.keys(v))
    if (!allowed.includes(k)) errors.push(`${path}/${k}: unknown field`);
  for (const k of required)
    if (!Object.hasOwn(v, k)) errors.push(`${path}/${k}: is required`);
  return true;
};
export function validatePrototype(value, path = "/prototype") {
  const errors = [];
  if (!fields(value, ["status", "packagePath", "hosting"], ["status"], path, errors))
    return errors;
  if (!["disabled", "pending", "enabled"].includes(value.status))
    errors.push(`${path}/status: invalid state`);
  if (value.status === "disabled") {
    if (Object.hasOwn(value, "packagePath"))
      errors.push(`${path}/packagePath: omitted when disabled`);
  } else if (!packagePath(value.packagePath))
    errors.push(
      `${path}/packagePath: requires a safe repository package directory`,
    );
  if (Object.hasOwn(value, "hosting")) {
    const h = value.hosting, at = `${path}/hosting`;
    if (fields(h, ["provider", "uploadUrl"], ["provider"], at, errors)) {
      if (!["openfolio", "custom", "git"].includes(h.provider))
        errors.push(`${at}/provider: expected openfolio, custom or git`);
      if (h.provider === "git" && Object.hasOwn(h, "uploadUrl"))
        errors.push(`${at}/uploadUrl: omitted for git`);
      if ((h.provider === "openfolio" || Object.hasOwn(h, "uploadUrl")) && !serviceUrl(h.uploadUrl))
        errors.push(`${at}/uploadUrl: requires an HTTP/HTTPS URL without credentials, query or hash`);
    }
  }
  return errors;
}
export function serviceUrl(value) {
  return hostedUrl(value) && !new URL(value).hash;
}
export function workflowHostingIssues(value) {
  const errors = [];
  if (value?.openfolioUrl !== undefined && value.openfolioUrl !== null && !serviceUrl(value.openfolioUrl))
    errors.push("/openfolioUrl: expected HTTP/HTTPS service URL or null");
  if (value?.prototype?.hosting?.provider === "openfolio" && !serviceUrl(value.openfolioUrl))
    errors.push("/openfolioUrl: required for OpenFolio hosting");
  return errors;
}
export const commitHash = (v) =>
  typeof v === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v);
export function hostedUrl(value) {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    /[\s\\\u0000-\u001f\u007f]/u.test(value)
  )
    return false;
  try {
    const u = new URL(value);
    return (
      ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      !u.search &&
      u.origin !== "null"
    );
  } catch {
    return false;
  }
}
export function validateArtifact(value, path = "/artifact") {
  const errors = [];
  if (!isObject(value)) return [`${path}: must be an object`];
  const hosted = value.type === "hosted";
  if (
    !fields(
      value,
      hosted
        ? ["type", "version", "url", "sourceCommit", "digest", "thumbnails"]
        : ["type", "path", "sourceCommit"],
      hosted
        ? ["type", "version", "url", "sourceCommit", "digest"]
        : ["type", "path", "sourceCommit"],
      path,
      errors,
    )
  )
    return errors;
  if (!["hosted", "git"].includes(value.type))
    errors.push(`${path}/type: expected hosted or git`);
  if (!commitHash(value.sourceCommit))
    errors.push(`${path}/sourceCommit: requires a full Git commit`);
  if (hosted) {
    if (
      !nonempty(value.version) ||
      value.version.length > 200 ||
      /[\s\u0000-\u001f]/u.test(value.version)
    )
      errors.push(`${path}/version: invalid version`);
    if (!hostedUrl(value.url))
      errors.push(`${path}/url: requires credential-free HTTP/HTTPS without query`);
    if (!/^sha256:[a-f0-9]{64}$/.test(value.digest ?? ""))
      errors.push(`${path}/digest: requires SHA-256`);
    if (Object.hasOwn(value, "thumbnails")) {
      if (!Array.isArray(value.thumbnails) || value.thumbnails.length > 3)
        errors.push(`${path}/thumbnails: invalid array`);
      else {
        const seen = new Set();
        for (const [i, t] of value.thumbnails.entries()) {
          const at = `${path}/thumbnails/${i}`;
          if (!fields(t, ["device", "url"], ["url"], at, errors)) continue;
          if (
            (Object.hasOwn(t, "device") && !devices.includes(t.device)) ||
            seen.has(t.device)
          )
            errors.push(`${at}/device: invalid or duplicate device`);
          seen.add(t.device);
          if (
            !hostedUrl(t.url) ||
            !/\.(png|webp)$/.test(new URL(t.url).pathname) ||
            new URL(t.url).hash
          )
            errors.push(`${at}/url: requires a fixed PNG/WebP HTTP/HTTPS URL`);
        }
      }
    }
  } else if (!safePath(value.path))
    errors.push(`${path}/path: requires a safe repository-relative directory`);
  return errors;
}
function entryIssues(p, at, current) {
  const errors = [],
    common = ["id", "title", "kind", "devices", "viewport"];
  if (
    !fields(
      p,
      [
        ...common,
        ...(current
          ? ["sourcePath", "description", "artifact"]
          : ["artifact"]),
      ],
      [
        "id",
        "title",
        "kind",
        ...(current ? ["sourcePath"] : ["artifact"]),
      ],
      at,
      errors,
    )
  )
    return errors;
  if (!identity(p.id) || p.id.length > 160)
    errors.push(`${at}/id: requires a lowercase kebab-case id`);
  if (!nonempty(p.title) || p.title.length > 256)
    errors.push(`${at}/title: must contain at most 256 characters`);
  if (current) {
    if (!safePath(p.sourcePath))
      errors.push(`${at}/sourcePath: requires a safe source path`);
    if (
      Object.hasOwn(p, "description") &&
      (!nonempty(p.description) || p.description.length > 2000)
    )
      errors.push(`${at}/description: invalid text`);
  }
  if (Object.hasOwn(p, "artifact"))
    errors.push(...validateArtifact(p.artifact, `${at}/artifact`));
  if (!["page", "component"].includes(p.kind))
    errors.push(`${at}/kind: expected page or component`);
  const hasDevices = Object.hasOwn(p, "devices"),
    hasViewport = Object.hasOwn(p, "viewport");
  if (hasDevices === hasViewport || (p.kind === "page" && !hasDevices))
    errors.push(
      `${at}: pages require devices; components require exactly one of devices or viewport`,
    );
  if (
    hasDevices &&
    (!Array.isArray(p.devices) ||
      !p.devices.length ||
      p.devices.some((d) => !devices.includes(d)) ||
      new Set(p.devices).size !== p.devices.length)
  )
    errors.push(`${at}/devices: requires unique supported devices`);
  if (
    hasViewport &&
    fields(
      p.viewport,
      ["width", "height"],
      ["width", "height"],
      `${at}/viewport`,
      errors,
    )
  )
    for (const key of ["width", "height"])
      if (
        !Number.isInteger(p.viewport[key]) ||
        p.viewport[key] < 1 ||
        p.viewport[key] > 4096
      )
        errors.push(
          `${at}/viewport/${key}: expected integer CSS pixels from 1 to 4096`,
        );
  if (p.artifact?.type === "hosted" && Array.isArray(p.artifact.thumbnails))
    for (const t of p.artifact.thumbnails) {
      if (
        Array.isArray(p.devices)
          ? !p.devices.includes(t?.device)
          : t?.device !== undefined
      )
        errors.push(`${at}/artifact/thumbnails: must match declared viewports`);
    }
  return errors;
}
function entriesIssues(value, path, current) {
  if (!Array.isArray(value)) return [`${path}: must be an array`];
  const errors = [],
    ids = new Set();
  if (value.length > 2000) errors.push(`${path}: too many entries`);
  for (const [i, p] of value.entries()) {
    errors.push(...entryIssues(p, `${path}/${i}`, current));
    if (ids.has(p?.id)) errors.push(`${path}/${i}/id: duplicate id`);
    ids.add(p?.id);
  }
  return errors;
}
export function validatePreviews(value, path = "/previews") {
  return entriesIssues(value, path, false);
}
export function validateManifest(value, path = "/prototype") {
  const errors = [];
  if (
    !fields(
      value,
      ["schemaVersion", "entries"],
      ["schemaVersion", "entries"],
      path,
      errors,
    )
  )
    return errors;
  if (value.schemaVersion !== 1)
    errors.push(`${path}/schemaVersion: expected 1`);
  errors.push(...entriesIssues(value.entries, `${path}/entries`, true));
  return errors;
}
export function entryPath(preview, config, changeDirectory) {
  if (
    validatePrototype(config).length ||
    config.status !== "enabled" ||
    validatePreviews([preview]).length
  )
    return null;
  const path =
    preview.artifact?.type === "git" ? preview.artifact.path : undefined;
  if (!path) return null;
  if (path.startsWith(`${config.packagePath}/preview/`))
    return `${path}/index.html`;
  if (
    preview.artifact?.type === "git" &&
    changeDirectory &&
    /^docs\/project\/(?:changes\/[a-z0-9-]+|archive\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+)$/.test(
      changeDirectory,
    ) &&
    path === `${changeDirectory}/previews/${preview.id}`
  )
    return `${path}/index.html`;
  return null;
}
export function currentPreview(entry) {
  const { sourcePath, description, ...preview } = entry;
  return preview;
}
