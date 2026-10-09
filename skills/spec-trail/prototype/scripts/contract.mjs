// Shared, dependency-free contract for the hook, local tooling and OpenFolio.
export const devices = ["pc-web", "ipad", "mobile"];
export const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const safePath = (v) => typeof v === "string" && v.length <= 1024 &&
  !/[\\\s%?#:\u0000-\u001f\u007f]/u.test(v) &&
  v.split("/").every(p => p && p !== "." && p !== ".." && !p.startsWith(".") && !["node_modules", "vendor"].includes(p));
export const packagePath = (v) => safePath(v) && !/^docs(?:\/|$)/.test(v);
const nonempty = v => typeof v === "string" && /\S/.test(v);
const identity = v => typeof v === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v);
const fields = (v, allowed, required, path, errors) => {
  if (!isObject(v)) { errors.push(`${path}: must be an object`); return false; }
  for (const k of Object.keys(v)) if (!allowed.includes(k)) errors.push(`${path}/${k}: unknown field`);
  for (const k of required) if (!Object.hasOwn(v, k)) errors.push(`${path}/${k}: is required`);
  return true;
};
export function validatePrototype(value, path = "/prototype") {
  const errors = [];
  if (!fields(value, ["status", "packagePath", "decision"], ["status", "decision"], path, errors)) return errors;
  if (!["disabled", "pending", "enabled"].includes(value.status)) errors.push(`${path}/status: invalid state`);
  if (value.status === "disabled") {
    if (Object.hasOwn(value, "packagePath")) errors.push(`${path}/packagePath: omitted when disabled`);
  } else if (!packagePath(value.packagePath)) errors.push(`${path}/packagePath: requires a safe repository package directory`);
  const d = value.decision;
  if (fields(d, ["at", "summary", "source"], ["at", "summary"], `${path}/decision`, errors)) {
    const match = typeof d.at === "string" && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(d.at);
    if (!match || !Number.isFinite(Date.parse(d.at)) || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59 || Number(match[3]) > new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate()) errors.push(`${path}/decision/at: requires a valid timestamp with timezone`);
    if (!nonempty(d.summary)) errors.push(`${path}/decision/summary: must contain text`);
    if (Object.hasOwn(d, "source") && !nonempty(d.source)) errors.push(`${path}/decision/source: must contain text`);
  }
  return errors;
}
export function validatePreviews(value, path = "/previews") {
  const errors = [];
  if (!Array.isArray(value)) return [`${path}: must be an array`];
  const ids = new Set();
  value.forEach((p, i) => {
    const at = `${path}/${i}`;
    if (!fields(p, ["id", "title", "path", "kind", "devices", "viewport"], ["id", "title", "path", "kind"], at, errors)) return;
    if (!identity(p.id) || ids.has(p.id)) errors.push(`${at}/id: requires a unique lowercase kebab-case id`);
    ids.add(p.id);
    if (!nonempty(p.title)) errors.push(`${at}/title: must contain text`);
    if (!safePath(p.path)) errors.push(`${at}/path: requires a safe repository-relative directory`);
    if (!["page", "component"].includes(p.kind)) errors.push(`${at}/kind: expected page or component`);
    const hasDevices = Object.hasOwn(p, "devices"), hasViewport = Object.hasOwn(p, "viewport");
    if (hasDevices === hasViewport || (p.kind === "page" && !hasDevices)) errors.push(`${at}: pages require devices; components require exactly one of devices or viewport`);
    if (hasDevices && (!Array.isArray(p.devices) || !p.devices.length || p.devices.some(d => !devices.includes(d)) || new Set(p.devices).size !== p.devices.length)) errors.push(`${at}/devices: requires unique supported devices`);
    if (hasViewport && fields(p.viewport, ["width", "height"], ["width", "height"], `${at}/viewport`, errors))
      for (const key of ["width", "height"]) if (!Number.isInteger(p.viewport[key]) || p.viewport[key] < 1 || p.viewport[key] > 4096) errors.push(`${at}/viewport/${key}: expected integer CSS pixels from 1 to 4096`);
  });
  return errors;
}
export function entryPath(preview, config) {
  if (validatePrototype(config).length || config.status !== "enabled" || validatePreviews([preview]).length || !preview.path.startsWith(`${config.packagePath}/preview/`)) return null;
  return `${preview.path}/index.html`;
}
