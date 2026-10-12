import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureProject, target, currentProduction, verifyDeployment } from './publish.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { files } from './build.mjs';
import { mime } from './serve.mjs';
import { extname } from 'node:path';

const credentials = { accountId: 'a'.repeat(32), apiToken: 'test-only', projectName: 'spec-trail' };
const project = { name: 'spec-trail', production_branch: 'main', subdomain: 'spec-trail.pages.dev' };
const response = (status, body) => new Response(JSON.stringify(body), { status });
test('production, preview and check-only events select the correct audience', () => {
  const env = { GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' };
  assert.deepEqual(target(env), { mode: 'production', branch: 'main' });
  assert.deepEqual(target({ ...env, GITHUB_REF_NAME: 'codex/spec-trail-website' }), { mode: 'preview', branch: 'codex/spec-trail-website' });
  for (const changed of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF_TYPE: 'tag' }, { GITHUB_REF_NAME: 'other' }]) assert.equal(target({ ...env, ...changed }).mode, 'check');
});
test('only a confirmed missing project is created; existing projects are read once', async () => {
  let calls = [];
  assert.equal((await ensureProject(credentials, async (url, options) => { calls.push(options.method || 'GET'); return response(200, { success: true, result: project }); })).created, false);
  assert.deepEqual(calls, ['GET']);
  calls = [];
  const created = await ensureProject(credentials, async (url, options) => {
    calls.push(options.method || 'GET');
    if (calls.length === 1) return response(404, {});
    assert.deepEqual(JSON.parse(options.body), { name: 'spec-trail', production_branch: 'main' });
    return response(200, { success: true, result: project });
  });
  assert.equal(created.created, true); assert.deepEqual(calls, ['GET', 'POST']);
});
test('authorization failures do not create a project or expose credentials', async () => {
  let calls = 0;
  await assert.rejects(ensureProject(credentials, async () => { calls++; return response(403, { errors: [{ message: credentials.apiToken }] }); }), error => error.message.includes('HTTP 403') && !error.message.includes(credentials.apiToken));
  assert.equal(calls, 1);
  await assert.rejects(ensureProject(credentials, async () => { throw Error(credentials.apiToken); }), error => !error.message.includes(credentials.apiToken));
});
test('existing Git integration or a different production branch is preserved', async () => {
  for (const changed of [{ source: { type: 'github' } }, { production_branch: 'other' }]) {
    let calls = 0;
    await assert.rejects(ensureProject(credentials, async () => { calls++; return response(200, { success: true, result: { ...project, ...changed } }); }));
    assert.equal(calls, 1);
  }
});
test('outdated production runs cannot replace the current website', async () => {
  const env = { GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main', GITHUB_REPOSITORY: 'iTgo-lyq/spec-trail', GITHUB_SHA: 'a'.repeat(40), GH_TOKEN: 'test-only' };
  await assert.rejects(currentProduction(env, async () => response(200, { object: { sha: 'b'.repeat(40) } })), /outdated/);
  await currentProduction(env, async () => response(200, { object: { sha: env.GITHUB_SHA } }));
});
test('new-domain network propagation is retried and HTML normalization stays on the deployment', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spec-trail-publishing-'));
  let calls = 0;
  try {
    for (const file of files) { await mkdir(dirname(join(directory, file)), { recursive: true }); await writeFile(join(directory, file), file); }
    const result = await verifyDeployment({
      url: 'https://abc.spec-trail.pages.dev', subdomain: 'spec-trail.pages.dev', mode: 'preview', environment: 'preview', directory, retryDelay: 0,
      fetchImpl: async input => {
        if (++calls === 1) throw Error('TLS propagation');
        const path = new URL(input).pathname.slice(1) || 'index.html';
        if (path === 'index.html' && new URL(input).pathname !== '/') return new Response(null, { status: 308, headers: { location: '/' } });
        return new Response(path, { headers: { 'content-type': path.endsWith('.js') ? 'application/javascript' : mime[extname(path)] } });
      },
    });
    assert.equal(result.files.length, files.length - 1);
    assert.equal(calls, files.length + 1);
    await assert.rejects(verifyDeployment({ url: 'https://other.pages.dev', subdomain: 'spec-trail.pages.dev', mode: 'preview', environment: 'preview', directory }), /unique deployment/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
