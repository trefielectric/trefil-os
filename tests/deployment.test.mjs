import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { ignoredBuildExitCode } from '../scripts/vercel-build-gate.mjs';

const gate = fileURLToPath(new URL('../scripts/vercel-build-gate.mjs', import.meta.url));
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

test('Vercel ignore command skips production and only continues an explicit preview', () => {
  for (const environment of ['production', 'development', 'custom', '', undefined]) assert.equal(ignoredBuildExitCode(environment), 0);
  assert.equal(ignoredBuildExitCode('preview'), 1);
  assert.equal(ignoredBuildExitCode('PREVIEW'), 0);
});

test('actual gate subprocess uses Vercel inverted exit convention and logs no environment content', () => {
  for (const [environment, expected] of [['production', 0], ['preview', 1], ['unexpected-private-value', 0]]) {
    const result = spawnSync(process.execPath, [gate], { env: { PATH: process.env.PATH, VERCEL_ENV: environment }, encoding: 'utf8' });
    assert.equal(result.status, expected);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, expected === 1 ? 'TREFIL_PREVIEW_BUILD_ALLOWED\n' : 'TREFIL_NON_PREVIEW_BUILD_SKIPPED\n');
    assert(!result.stdout.includes(environment));
  }
  const absent = spawnSync(process.execPath, [gate], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.equal(absent.status, 0);
});

test('deployment configuration disables main, retains the preview gate, and uses automatic Next.js output', () => {
  assert.equal(config.ignoreCommand, 'node scripts/vercel-build-gate.mjs');
  assert.equal(config.git.deploymentEnabled.main, false);
  assert.equal(config.git.deploymentEnabled['codex/finance-preview'], true);
  assert.equal(Object.hasOwn(config, 'outputDirectory'), false);
});

test('response policy restricts network access to the institutional project and denies embedding', () => {
  const headers = new Map(config.headers.find(rule => rule.source === '/(.*)').headers.map(header => [header.key.toLowerCase(), header.value]));
  const policy = headers.get('content-security-policy');
  assert(policy.includes("connect-src 'self' https://kifmqoolaerepvlzrqnk.supabase.co;"));
  assert(!policy.includes('https://*.supabase.co'));
  assert(!policy.includes("'unsafe-eval'"));
  assert(policy.includes("frame-ancestors 'none'"));
  assert(policy.includes("object-src 'none'"));
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
});
