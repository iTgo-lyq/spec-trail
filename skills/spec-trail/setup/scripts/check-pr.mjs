#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { recordsAt } from '../../scripts/repository.mjs';
import { validateChange, validateWorkflow } from '../../scripts/state-schema.mjs';
import { closedRecord, validBranchName } from '../../scripts/routing.mjs';
import { prMarker } from '../../scripts/pr-markers.mjs';
import { integrationFor, scanIntegrations } from '../../scripts/integration-records.mjs';

const assert = (value, message) => { if (!value) throw Error(message); };
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value);

function archive(records, id) {
  const rows = records.filter(record => record.id === id), record = rows[0];
  assert(rows.length === 1 && !record.error && record.archived && record.state?.id === id &&
    !validateChange(record.state).length && closedRecord(record.state, record.directory),
  `Change ${id}: merge requires one valid completed archive with verification, acceptance and Specs recorded`);
  return record;
}

/** Read only the PR's fixed Git objects; never fetch, execute project code or change state. */
export async function checkPullRequest(git, event) {
  const pr = event?.pull_request;
  assert(pr && sha(pr.head?.sha) && sha(pr.base?.sha) &&
    validBranchName(pr.head?.ref) && validBranchName(pr.base?.ref), 'Invalid PR source or target');
  assert(Number.isSafeInteger(event.repository?.id) && event.repository.id > 0 &&
    pr.head.repo?.id === event.repository.id && pr.base.repo?.id === event.repository.id,
  'SpecTrail delivery requires a same-repository PR');
  assert(git(['rev-parse', 'HEAD']) === pr.head.sha, 'Check out the exact PR head SHA before validation');
  const config = JSON.parse(git(['show', `${pr.head.sha}:docs/project/workflow.json`]));
  const issues = validateWorkflow(config);
  assert(!issues.length, `Invalid workflow.json: ${issues.join('; ')}`);
  const marker = prMarker(pr.body ?? '');
  const records = recordsAt({git}, pr.head.sha);
  if (pr.base.ref === config.integrationBranch) {
    assert(marker.kind === 'change', 'Change PR requires one trailing SpecTrail-Change marker');
    assert(pr.head.ref !== config.integrationBranch && pr.head.ref !== config.releaseBranch,
      'Change PR must come from its registered work branch');
    const record = archive(records, marker.id);
    assert(record.state.branch === pr.head.ref, 'Archive ownership does not match the PR source branch');
    const before = recordsAt({git}, pr.base.sha);
    const registration = before.filter(row => row.id === marker.id);
    assert(registration.length === 1 && !registration[0].error && !registration[0].archived &&
      registration[0].state?.id === marker.id && registration[0].state.branch === pr.head.ref,
    'Register this Change source branch on the integration branch before merging');
    const existing = new Set(before.filter(row => row.archived).map(row => row.id));
    const added = records.filter(row => row.archived && !existing.has(row.id));
    assert(added.length === 1 && added[0].id === marker.id,
      'A Change PR must introduce exactly its own archive');
    return {kind:'change', changes:[marker.id], source:pr.head.sha};
  }
  assert(pr.base.ref === config.releaseBranch, 'PR target does not match a configured delivery branch');
  assert(marker.kind === 'release', 'Release PR requires trailing SpecTrail-Version and SpecTrail-Includes markers');
  const integrationTip = git(['rev-parse', '--verify', `refs/remotes/origin/${config.integrationBranch}^{commit}`]);
  const index = await scanIntegrations(async args => git(args), integrationTip);
  for (const id of marker.includes) {
    const record = archive(records, id);
    const integration = integrationFor(index, id);
    assert(integration.status === 'found', `Change ${id}: release requires verified integration history`);
    assert(git(['merge-base', integration.commit, pr.head.sha]) === integration.commit,
      `Change ${id}: integrated delivery is not in the release candidate`);
    assert(record.directory === integration.archivePath &&
      git(['rev-parse', `${pr.head.sha}:${record.directory}`]) ===
      git(['rev-parse', `${integration.commit}:${record.directory}`]),
    `Change ${id}: release candidate modified its integrated archive`);
  }
  return {kind:'release', changes:marker.includes, source:pr.head.sha};
}

async function main() {
  const {values} = parseArgs({options:{repo:{type:'string',default:'.'},event:{type:'string'}}});
  const eventPath = values.event ?? process.env.GITHUB_EVENT_PATH;
  assert(eventPath, 'Provide --event <PR event JSON> or GITHUB_EVENT_PATH');
  const git = args => execFileSync('git', ['-C', resolve(values.repo), '--literal-pathspecs', ...args], {
    encoding:'utf8', stdio:['ignore','pipe','pipe'], maxBuffer:32 * 1024 * 1024,
  }).trimEnd();
  const result = await checkPullRequest(git, JSON.parse(readFileSync(eventPath, 'utf8')));
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write(`SpecTrail: ${error.message}\n`); process.exitCode = 1; });
