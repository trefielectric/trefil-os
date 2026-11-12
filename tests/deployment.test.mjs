import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { ignoredBuildExitCode } from '../scripts/vercel-build-gate.mjs';

const gate = fileURLToPath(new URL('../scripts/vercel-build-gate.mjs', import.meta.url));
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const workforceInvite = readFileSync(new URL('../supabase/functions/workforce-invite/index.js', import.meta.url), 'utf8');
const workforceApp = readFileSync(new URL('../src/components/workforce-app.tsx', import.meta.url), 'utf8');
const reservedOwnerMigration = readFileSync(new URL('../supabase/migrations/20261111202500_reserved_initial_administrator.sql', import.meta.url), 'utf8');

test('Vercel ignore command continues production and preview, skipping other environments', () => {
  for (const environment of ['development', 'custom', '', undefined]) assert.equal(ignoredBuildExitCode(environment), 0);
  assert.equal(ignoredBuildExitCode('production'), 1);
  assert.equal(ignoredBuildExitCode('preview'), 1);
  assert.equal(ignoredBuildExitCode('PREVIEW'), 0);
});

test('actual gate subprocess uses Vercel inverted exit convention and logs no environment content', () => {
  for (const [environment, expected] of [['production', 1], ['preview', 1], ['unexpected-private-value', 0]]) {
    const result = spawnSync(process.execPath, [gate], { env: { PATH: process.env.PATH, VERCEL_ENV: environment }, encoding: 'utf8' });
    assert.equal(result.status, expected);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, expected === 1 ? 'TREFIL_PREVIEW_BUILD_ALLOWED\n' : 'TREFIL_NON_PREVIEW_BUILD_SKIPPED\n');
    assert(!result.stdout.includes(environment));
  }
  const absent = spawnSync(process.execPath, [gate], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
  assert.equal(absent.status, 0);
});

test('deployment configuration enables main and the preview gate, using automatic Next.js output', () => {
  assert.equal(config.ignoreCommand, 'node scripts/vercel-build-gate.mjs');
  assert.equal(config.git.deploymentEnabled.main, true);
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

test('Equipo invite endpoint accepts the exact production domains', () => {
  assert.match(workforceInvite, /https:\/\/trefil-os-git-main-administrativo914\.vercel\.app/);
  assert.match(workforceInvite, /https:\/\/project-kmpca\.vercel\.app/);
  assert.doesNotMatch(workforceInvite, /https:\/\/\*\.vercel\.app/);
});

test('the one-time Equipo setup activates the reserved control-total owner', () => {
  for (const source of [workforceInvite, workforceApp, reservedOwnerMigration]) {
    assert.match(source, /Federico Velásquez Perdomo/);
    assert.match(source, /fevepe1510@gmail\.com/);
    assert.match(source, /Administrador general/);
  }
  assert.match(workforceApp, /Activa tu usuario de control total/);
  assert.doesNotMatch(workforceApp, /Crea la cuenta administradora/);
  assert.doesNotMatch(workforceApp, /Mínimo 12 caracteres/);
  assert.match(workforceApp, /minLength=\{activation \|\| setup \? 6 : undefined\}/);
  assert.match(workforceInvite, /payload\.password\.length < 6/);
});
