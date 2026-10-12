import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { root, files } from './build.mjs';
import { check } from './check.mjs';
import { mime } from './serve.mjs';

export function target(env) {
  if (!['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) || env.GITHUB_REF_TYPE !== 'branch') return { mode: 'check' };
  const branch = env.GITHUB_REF_NAME;
  if (branch === 'main') return { mode: 'production', branch };
  if (/^codex\/[A-Za-z0-9._/-]+$/.test(branch || '')) return { mode: 'preview', branch };
  return { mode: 'check' };
}
async function request(url, options = {}, fetchImpl = fetch) {
  try { return await fetchImpl(url, { ...options, signal: AbortSignal.timeout(30_000) }); }
  catch { throw Error('Network request failed or timed out; check the existing deployment before retrying.'); }
}
export async function ensureProject({ accountId, apiToken, projectName }, fetchImpl = fetch) {
  assert.match(accountId || '', /^[a-f0-9]{32}$/i, 'Missing or invalid CLOUDFLARE_ACCOUNT_ID');
  assert(apiToken, 'Missing CLOUDFLARE_API_TOKEN');
  assert.match(projectName || '', /^[a-z0-9][a-z0-9-]{0,56}[a-z0-9]$|^[a-z0-9]$/, 'Invalid Pages project name');
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`;
  const headers = { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' };
  let response = await request(`${url}/${projectName}`, { headers }, fetchImpl);
  let created = false;
  if (response.status === 404) {
    created = true;
    response = await request(url, { method: 'POST', headers, body: JSON.stringify({ name: projectName, production_branch: 'main' }) }, fetchImpl);
  }
  assert([200, 201].includes(response.status), `Pages ${created ? 'creation' : 'lookup'} failed: HTTP ${response.status}; verify the account and Pages Edit permission`);
  const result = await response.json();
  assert(result.success === true && result.result, 'Pages API did not confirm success');
  const project = result.result;
  assert.equal(project.name, projectName, 'Pages project mismatch');
  assert.equal(project.production_branch, 'main', 'Existing project has another production branch');
  assert(!project.source, 'Existing project uses Git integration; choose a dedicated Direct Upload project');
  assert.match(project.subdomain || '', /^[a-z0-9-]+\.pages\.dev$/, 'Invalid project subdomain');
  return { project: project.name, subdomain: project.subdomain, created };
}
export async function currentProduction(env, fetchImpl = fetch) {
  if (target(env).mode !== 'production') return;
  assert.match(env.GITHUB_REPOSITORY || '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.match(env.GITHUB_SHA || '', /^[a-f0-9]{40}$/);
  assert(env.GH_TOKEN, 'Missing GitHub token for main verification');
  const response = await request(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/git/ref/heads/main`, { headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: 'application/vnd.github+json' } }, fetchImpl);
  assert.equal(response.status, 200, 'Cannot verify current main');
  assert.equal((await response.json()).object.sha, env.GITHUB_SHA, 'This run is outdated; publish the latest main commit');
}
export async function verifyDeployment({ url, subdomain, mode, environment, directory = join(root, 'dist/website'), fetchImpl = fetch, retryDelay = 5000, propagationMs = 180000 }) {
  assert.equal(environment, mode, 'Unexpected Pages environment');
  const base = new URL(url);
  assert.equal(base.protocol, 'https:');
  assert(!base.username && !base.password && !base.search && !base.hash);
  assert(base.hostname !== subdomain && base.hostname.endsWith(`.${subdomain}`), 'Expected the unique deployment URL returned by Cloudflare');
  const results = [];
  const deadline = Date.now() + propagationMs;
  for (const file of files.filter(name => name !== '_headers')) {
    const expected = await readFile(join(directory, file));
    const expectedHash = createHash('sha256').update(expected).digest('hex');
    let passed = false;
    do {
      let response;
      try { response = await request(new URL(file, `${base.origin}/`), { redirect: 'manual' }, fetchImpl); }
      catch (error) {
        if (Date.now() >= deadline) throw error;
        await new Promise(resolveWait => setTimeout(resolveWait, retryDelay));
        continue;
      }
      const canonical = response.headers.get('location');
      let final = response;
      if (response.status >= 300 && response.status < 400 && canonical) {
        const normalized = new URL(canonical, `${base.origin}/${file}`);
        assert.equal(normalized.origin, base.origin, 'Unexpected deployment redirect');
        final = await request(normalized, { redirect: 'error' }, fetchImpl);
      }
      const received = Buffer.from(await final.arrayBuffer());
      const hash = createHash('sha256').update(received).digest('hex');
      if (final.status === 200 && hash === expectedHash) {
        const expectedTypes = file.endsWith('.js') ? ['text/javascript', 'application/javascript'] : [mime[extname(file)].split(';')[0]];
        assert(expectedTypes.includes(final.headers.get('content-type')?.split(';')[0]), `${file}: incorrect MIME`);
        results.push({ file, bytes: expected.length, sha256: hash }); passed = true; break;
      }
      if (Date.now() < deadline) await new Promise(resolveWait => setTimeout(resolveWait, retryDelay));
    } while (Date.now() < deadline);
    assert(passed, `Online content mismatch: ${file}; inspect ${base.origin} before publishing again`);
  }
  return { url: base.origin, productionUrl: `https://${subdomain}`, mode, files: results };
}
async function output(name, value) { if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`); }
const evidenceDirectory = join(root, '.cache/website-pages');
async function evidence(value) { await mkdir(evidenceDirectory, { recursive: true }); await writeFile(join(evidenceDirectory, 'deployment.json'), JSON.stringify(value, null, 2) + '\n'); }
async function main() {
  const env = process.env;
  if (process.argv[2] === 'prepare') {
    await check();
    const chosen = target(env);
    if (chosen.mode === 'check') { await output('deploy', 'false'); return; }
    if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
      assert(chosen.mode === 'preview' && env.GITHUB_EVENT_NAME === 'push', 'Cloudflare publication credentials are missing');
      await output('deploy', 'false');
      if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, 'Website checks passed; no deployment because Cloudflare credentials are missing.\n');
      return;
    }
    await currentProduction(env);
    const project = await ensureProject({ accountId: env.CLOUDFLARE_ACCOUNT_ID, apiToken: env.CLOUDFLARE_API_TOKEN, projectName: env.CLOUDFLARE_PAGES_PROJECT || 'spec-trail' });
    const toolDirectory = await mkdtemp(join(env.RUNNER_TEMP || tmpdir(), 'spec-trail-wrangler-'));
    await writeFile(join(toolDirectory, 'package.json'), '{"name":"spec-trail-publisher","private":true}\n');
    const preparation = { ...chosen, ...project, commit: env.GITHUB_SHA };
    await evidence({ status: 'prepared', ...preparation });
    for (const [name, value] of Object.entries({ deploy: 'true', project: project.project, subdomain: project.subdomain, branch: chosen.branch, mode: chosen.mode, tool_directory: toolDirectory, site_directory: join(root, 'dist/website') })) await output(name, value);
    console.log(JSON.stringify(preparation));
  } else if (process.argv[2] === 'verify') {
    const prepared = JSON.parse(await readFile(join(evidenceDirectory, 'deployment.json'), 'utf8'));
    await evidence({ ...prepared, status: 'uploaded', url: env.PAGES_DEPLOYMENT_URL, environment: env.PAGES_ENVIRONMENT });
    const result = await verifyDeployment({ url: env.PAGES_DEPLOYMENT_URL, environment: env.PAGES_ENVIRONMENT, subdomain: prepared.subdomain, mode: prepared.mode });
    await evidence({ ...prepared, status: 'verified', ...result });
    console.log(JSON.stringify(result));
    if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `### SpecTrail website published\n\n- Environment: ${result.mode}\n- Unique deployment: ${result.url}\n- Project address: ${result.productionUrl}\n- Commit: ${prepared.commit}\n- Verified ${result.files.length} public files by SHA-256 and MIME.\n`);
  } else throw Error('Use prepare or verify');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
