import { trailingFields } from './pr-markers.mjs';
import { changeLocation, closedRecord } from './routing.mjs';
import { validateChange } from './state-schema.mjs';

export const INTEGRATION_VERSION = 1;
export const validChangeId = (id) => typeof id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
const sha = (value) => /^[a-f0-9]{40,64}$/.test(value);
const format = '%H%x00%P%x00%cI%x00%s%x00%B%x00';
/** @typedef {{status:'found', commit:string, base:string, source:string, archivePath:string, title:string, committedAt:string}} IntegrationRecord */
/** @typedef {IntegrationRecord | {status:'missing'|'invalid'|'unavailable', message:string, candidates?:string[]}} IntegrationResult */
/** @typedef {{version:number, tip:string|null, complete:boolean, records:Record<string,IntegrationResult>, issues:string[], message?:string}} IntegrationIndex */
/** @typedef {(args:string[]) => Promise<Buffer|string>} GitRun */

export function changeTrailers(message) {
  return trailingFields(message).filter(field => field.key === 'SpecTrail-Change').map(field => field.value);
}

function commits(output) {
  const parts = output.toString().split('\0');
  if (parts.pop().trim()) throw Error('Incomplete commit metadata');
  if (parts.length % 5) throw Error('Invalid commit metadata');
  const result = [];
  for (let i = 0; i < parts.length; i += 5) {
    const commit = parts[i].trim(), parents = parts[i + 1].split(' ').filter(Boolean);
    if (!sha(commit) || !parents.every(sha)) throw Error('Invalid commit identity');
    result.push({commit, parents, committedAt:parts[i + 2], title:parts[i + 3], message:parts[i + 4]});
  }
  return result;
}

/** @param {GitRun} run */
function validator(run) {
  const catalogs = new Map();
  async function catalog(commit) {
    if (catalogs.has(commit)) return catalogs.get(commit);
    const rows = (await run(['ls-tree', '-rz', '--full-tree', commit, '--', 'docs/project/changes/', 'docs/project/archive/'])).toString().split('\0');
    const records = rows.flatMap(row => {
      const tab = row.indexOf('\t'); if (tab < 0) return [];
      const path = row.slice(tab + 1), location = changeLocation(path);
      if (!location) return [];
      const [mode, type, blob] = row.slice(0, tab).split(' ');
      return [{...location, path, mode, type, blob}];
    });
    catalogs.set(commit, records); return records;
  }
  async function validArchive(entry, id) {
    if (!entry.archived || entry.type !== 'blob' || !['100644','100755'].includes(entry.mode)) return false;
    const buffer = await run(['cat-file', 'blob', entry.blob]);
    try {
      const state = JSON.parse(typeof buffer === 'string' ? buffer : new TextDecoder('utf-8',{fatal:true}).decode(buffer));
      return state.id === id && !validateChange(state).length && closedRecord(state, entry.directory) &&
        (state.previews ?? []).every(preview => preview.artifact.type !== 'git' || preview.artifact.path === `${entry.directory}/previews/${preview.id}`);
    } catch { return false; }
  }
  /** @returns {Promise<IntegrationResult>} */
  return async (meta, id) => {
    const invalid = (message) => ({status: /** @type {const} */('invalid'), message, candidates:[meta.commit]});
    if (meta.parents.length !== 2) return invalid('正式合入必须是恰有两个父提交的合并提交。');
    const markers = changeTrailers(meta.message);
    if (markers.length !== 1 || markers[0] !== id) return invalid('合入提交的 Change 标记必须唯一且合法。');
    try {
      const [base, source] = meta.parents;
      const merged = await catalog(meta.commit), before = await catalog(base), delivered = await catalog(source);
      const own = merged.filter(entry => entry.id === id), original = delivered.filter(entry => entry.id === id);
      if (own.length !== 1 || !(await validArchive(own[0], id))) return invalid('合并提交缺少唯一有效归档，或同时保留了同 id 的活动入口。');
      const priorIds = new Set(before.filter(entry => entry.archived).map(entry => entry.id));
      const addedIds = new Set(merged.filter(entry => entry.archived && !priorIds.has(entry.id)).map(entry => entry.id));
      if (priorIds.has(id) || addedIds.size !== 1 || !addedIds.has(id)) return invalid('一次正式合入只能首次引入目标 Change 的归档。');
      if (original.length !== 1 || !(await validArchive(original[0], id)) || original[0].directory !== own[0].directory) return invalid('第二父提交不包含同一份有效交付归档。');
      const path = own[0].directory;
      const a = (await run(['rev-parse','--verify',`${meta.commit}:${path}`])).toString().trim();
      const b = (await run(['rev-parse','--verify',`${source}:${path}`])).toString().trim();
      if (a !== b) return invalid('合入过程修改了已归档的交付内容。');
      return {status:'found',commit:meta.commit,base,source,archivePath:path,title:meta.title,committedAt:meta.committedAt};
    } catch {
      return {status:'unavailable', message:'合入记录所需的 Git 对象暂不可读取，请重新获取历史后重试。', candidates:[meta.commit]};
    }
  };
}

/** Validate one unpublished merge candidate before pushing it.
 * @param {GitRun} run @param {string} commit @param {string} id
 * @returns {Promise<IntegrationResult>}
 */
export async function inspectIntegration(run, commit, id) {
  if (!sha(commit) || !validChangeId(id)) throw Error('Invalid integration identity');
  try {
    const [meta] = commits(await run(['log','-1',`--format=${format}`,commit,'--']));
    return await validator(run)(meta, id);
  } catch { return {status:'unavailable',message:'合入提交暂不可读取。',candidates:[commit]}; }
}

/** @param {GitRun} run @param {string} tip @returns {Promise<IntegrationIndex>} */
export async function scanIntegrations(run, tip) {
  /** @type {IntegrationIndex} */
  const index = {version:INTEGRATION_VERSION,tip,complete:false,records:{},issues:[]};
  const groups = new Map(), validate = validator(run);
  try {
    if (!sha(tip)) throw Error('Invalid collaboration commit');
    if ((await run(['rev-parse','--is-shallow-repository'])).toString().trim() !== 'false') throw Error('Shallow history');
    for (let offset = 0; ; offset += 256) {
      const batch = commits(await run(['log','--first-parent','--max-count=256',`--skip=${offset}`,`--format=${format}`,tip,'--']));
      for (const meta of batch) {
        const markers = changeTrailers(meta.message);
        if (markers.some(id => !validChangeId(id))) index.issues.push(`${meta.commit}: Change 标记包含非法 id。`);
        for (const id of new Set(markers.filter(validChangeId))) {
          const list = groups.get(id) ?? []; list.push(meta); groups.set(id, list);
        }
      }
      if (batch.length < 256) break;
    }
    for (const [id, list] of groups) {
      const result = list.length > 1
        ? {status: /** @type {const} */('invalid'), message:'集成分支主链中存在重复的 Change 合入标记。', candidates:list.map(meta => meta.commit)}
        : await validate(list[0], id);
      // IDs may be valid object prototype names (e.g. constructor).
      Object.defineProperty(index.records,id,{value:result,enumerable:true,writable:true,configurable:true});
    }
    index.complete = true;
  } catch { index.message = '集成分支历史读取未完成，请获取完整历史后重试。'; }
  return index;
}

/** @param {IntegrationIndex} index @param {string} id @returns {IntegrationResult} */
export function integrationFor(index, id) {
  if (!validChangeId(id)) throw Error('Invalid Change id');
  if (!index?.complete) return {status:'unavailable',message:index?.message ?? '合入索引暂不可读取。'};
  return Object.hasOwn(index.records,id) ? index.records[id] : {status:'missing',message:'暂无合入记录'};
}
