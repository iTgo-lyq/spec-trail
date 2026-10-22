// Only the final standalone metadata paragraph associates PRs; prose and code do not.
export function trailingFields(message) {
  const paragraphs = message.trimEnd().split(/\r?\n\s*\r?\n/);
  if (paragraphs.length < 2) return [];
  const prefix = paragraphs.slice(0, -1).join('\n\n');
  let fence;
  for (const line of prefix.split(/\r?\n/)) {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!match) continue;
    if (!fence) fence = match[1];
    else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = undefined;
  }
  if (fence) return [];
  const fields = [];
  for (const line of paragraphs.at(-1).split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && fields.length) { fields.at(-1).value += '\n' + line.trim(); continue; }
    const match = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (!match) return [];
    fields.push({key:match[1], value:match[2].trim()});
  }
  return fields;
}

/** @returns {{kind:'change',id:string}|{kind:'release',version:string,includes:string[]}|{kind:'none'|'invalid'}} */
export function prMarker(body) {
  const fields = trailingFields(body).filter(field => field.key.startsWith('SpecTrail-'));
  if (!fields.length) return {kind:'none'};
  const ids = fields.filter(field => field.key === 'SpecTrail-Change').map(field => field.value);
  const versions = fields.filter(field => field.key === 'SpecTrail-Version').map(field => field.value);
  const includes = fields.filter(field => field.key === 'SpecTrail-Includes').map(field => field.value);
  const valid = id => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
  if (fields.length === 1 && ids.length === 1 && valid(ids[0])) return {kind:'change',id:ids[0]};
  if (!ids.length && versions.length === 1 && /^[^\s]+$/.test(versions[0]) && includes.length &&
      fields.length === includes.length + 1 && includes.every(valid) && new Set(includes).size === includes.length)
    return {kind:'release',version:versions[0],includes};
  return {kind:'invalid'};
}
