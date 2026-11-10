#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BackupError, assert, copyToExternal, downloadStorage, encryptionKey, hashFile,
  isolatedRestoreEnv, listStorage, packArchive, postgresEnv, psql, recordBackup,
  requireUuid, requireValue, run, institutionalStorageUrl, sourceIdentitySQL, verifyBackup, withPrivateTemp, encryptFile,
} from './lib.mjs';

const HELP = `Trefil OS · copias cifradas (solo operador)

node scripts/backup/cli.mjs backup --output /ruta/fuera-del-repositorio
node scripts/backup/cli.mjs verify --file /ruta/trefil-UUID.trefilenc
node scripts/backup/cli.mjs restore --file /ruta/trefil-UUID.trefilenc
node scripts/backup/cli.mjs copy-external --file /ruta/trefil-UUID.trefilenc --directory /Volumes/DISCO/TrefilOS
node scripts/backup/cli.mjs prune --directory /ruta/fuera-del-repositorio --days 30

Credenciales y llave: exclusivamente variables del entorno o su administrador
de secretos; nunca argumentos. Consulte docs/recovery.md. Restore admite solo
una base local vacía trefil_restore_* y nunca limpia ni reemplaza una base.
`;

function options(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    assert(['--output', '--file', '--directory', '--days'].includes(argv[i]) && argv[i + 1] && !argv[i + 1].startsWith('--'), 'INVALID_ARGUMENTS');
    assert(!Object.hasOwn(result, argv[i].slice(2)), 'DUPLICATE_ARGUMENT');
    result[argv[i].slice(2)] = argv[i + 1];
  }
  return result;
}
function safeCode(error) { return error instanceof BackupError ? error.code : 'BACKUP_OPERATION_FAILED'; }
export async function outputDirectory(value) {
  const directory = path.resolve(requireValue(value, 'OUTPUT_DIRECTORY'));
  // Never create a business archive in any checkout, including ignored paths.
  async function rejectCheckout(candidate) {
    let current = candidate;
    while (true) {
      try { await lstat(path.join(current, '.git')); throw new BackupError('BACKUPS_FORBIDDEN_IN_GIT_CHECKOUT'); }
      catch (error) { if (error instanceof BackupError) throw error; assert(error.code === 'ENOENT', 'OUTPUT_DIRECTORY_UNREADABLE'); }
      if (current === path.dirname(current)) break;
      current = path.dirname(current);
    }
  }
  await rejectCheckout(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const canonical = await realpath(directory);
  // macOS system aliases such as /tmp -> /private/tmp are legitimate. Check
  // the resolved ancestry too so an alias into a checkout cannot bypass Git.
  await rejectCheckout(canonical);
  return canonical;
}
async function storageClient(env) {
  const url = institutionalStorageUrl(env.TREFIL_SUPABASE_URL);
  const secret = requireValue(env.TREFIL_SUPABASE_BACKUP_SECRET, 'TREFIL_SUPABASE_BACKUP_SECRET');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
// Keep ACLs: omitting them would lose reviewed REVOKE/GRANT rules during restore.
// Infrastructure roles must already exist on the isolated destination cluster.
export const DUMP_FLAGS = ['--format=custom', '--no-owner', '--no-password'];
export const RESTORE_FLAGS = ['--exit-on-error', '--single-transaction', '--no-owner'];
const retentionDate = (startedAt, days) => new Date(Date.parse(startedAt) + days * 86_400_000).toISOString();

export async function makeBackup(opts, env = process.env) {
  const key = encryptionKey(env);
  const organizationId = requireUuid(env.TREFIL_BACKUP_ORGANIZATION_ID);
  const sourceEnv = postgresEnv(env, 'TREFIL_BACKUP_');
  const buckets = requireValue(env.TREFIL_BACKUP_BUCKETS, 'TREFIL_BACKUP_BUCKETS').split(',').map(value => value.trim());
  const output = await outputDirectory(opts.output ?? env.TREFIL_BACKUP_OUTPUT);
  const days = Number(env.TREFIL_BACKUP_RETENTION_DAYS ?? 30);
  assert(Number.isSafeInteger(days) && days >= 7 && days <= 3650, 'INVALID_RETENTION_DAYS');
  const id = randomUUID(); const startedAt = new Date().toISOString();
  const record = { id, organizationId, startedAt, status: 'running', retentionUntil: retentionDate(startedAt, days) };
  const filename = path.join(output, `trefil-${id}.trefilenc`);
  let recordCreated = false;
  try {
    assert((await psql(sourceIdentitySQL(organizationId), sourceEnv)).trim() === 'true', 'SOURCE_DATABASE_NOT_EXCLUSIVE_TREFIL');
    await recordBackup(env, record); recordCreated = true;
    // These commands verify installed tools before downloading business files.
    const dumpVersion = (await run('pg_dump', ['--version'], { capture: true, env: sourceEnv })).trim();
    await run('pg_restore', ['--version'], { env: sourceEnv });
    const client = await storageClient(env);
    await withPrivateTemp(async directory => {
      const storageBefore = await listStorage(client, buckets, organizationId);
      const documents = await downloadStorage(client, storageBefore, directory);
      const dump = path.join(directory, 'database.dump');
      await run('pg_dump', [...DUMP_FLAGS, '--file', dump], { env: sourceEnv });
      await run('pg_restore', ['--list', dump], { env: sourceEnv });
      const storageAfter = await listStorage(client, buckets, organizationId);
      assert(JSON.stringify(storageBefore) === JSON.stringify(storageAfter), 'STORAGE_CHANGED_DURING_BACKUP');
      const files = [{ path: 'database.dump', source: dump, sha256: await hashFile(dump), size: (await stat(dump)).size }, ...documents];
      const manifest = {
        formatVersion: 1, runId: id, organizationId, createdAt: startedAt,
        displayTimezone: 'America/Bogota', algorithm: 'AES-256-GCM', fullDatabase: true, preservesPrivileges: true,
        sourceDatabase: (await psql('select current_database();', sourceEnv)).trim(),
        sourceHost: sourceEnv.PGHOST ?? 'service-profile', pgDumpVersion: dumpVersion,
        storageBuckets: buckets, storagePrefix: organizationId, documentCount: documents.length,
        storageStableDuringCapture: true, retentionDays: days,
        files: files.map(({ path: filePath, sha256, size }) => ({ path: filePath, sha256, size })),
      };
      const manifestPath = path.join(directory, 'manifest.json');
      await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600, flag: 'wx' });
      const archive = path.join(directory, 'archive.bin');
      await packArchive([{ path: 'manifest.json', source: manifestPath }, ...files], archive);
      const encrypted = await encryptFile(archive, filename, key);
      const receipt = { formatVersion: 1, runId: id, createdAt: startedAt, algorithm: 'AES-256-GCM', retentionDays: days, ...encrypted };
      await writeFile(`${filename}.json`, JSON.stringify(receipt, null, 2), { mode: 0o600, flag: 'wx' });
      await verifyBackup(filename, key, async ({ directory: restored }) => {
        await run('pg_restore', ['--list', path.join(restored, 'database.dump')], { env: sourceEnv });
      });
      Object.assign(record, { status: 'verified', completedAt: new Date().toISOString(), ...encrypted,
        // Do not expose file paths, filenames, source host or DB name in the UI registry.
        manifest: { formatVersion: 1, runId: id, algorithm: manifest.algorithm, documentCount: documents.length, storageStableDuringCapture: true, dumpValidated: true, retentionDays: days } });
      await recordBackup(env, record);
    });
    return { runId: id, status: 'verified', file: filename, restorationVerified: false, externalCopyVerified: false };
  } catch (error) {
    if (recordCreated) {
      Object.assign(record, { status: 'failed', completedAt: new Date().toISOString(), errorCode: safeCode(error) });
      try { await recordBackup(env, record); } catch { process.stderr.write('BACKUP_REGISTRY_UNAVAILABLE\n'); }
    }
    throw error;
  } finally { key.fill(0); }
}

export async function verify(opts, env = process.env) {
  const key = encryptionKey(env);
  try {
    const { manifest } = await verifyBackup(path.resolve(requireValue(opts.file, 'BACKUP_FILE')), key, async ({ directory }) => {
      await run('pg_restore', ['--list', path.join(directory, 'database.dump')]);
    });
    return { runId: manifest.runId, status: 'verified', restorationVerified: false };
  } finally { key.fill(0); }
}

export const RESTORE_INTEGRITY_SQL = `
select case when exists (
  select t.id from public.financial_transactions t
  left join public.transaction_entries e on e.transaction_id=t.id
  where t.status='posted' group by t.id
  having count(e.id)<2 or coalesce(sum(e.debit),0)<>coalesce(sum(e.credit),0)
) then 'unbalanced' else 'balanced' end;
`;

export async function restore(opts, env = process.env) {
  // All target checks run before decrypting or connecting anywhere.
  const targetEnv = isolatedRestoreEnv(env);
  requireValue(env.TREFIL_RESTORE_DOCUMENTS_DIRECTORY, 'TREFIL_RESTORE_DOCUMENTS_DIRECTORY');
  const key = encryptionKey(env);
  try {
    const filename = path.resolve(requireValue(opts.file, 'BACKUP_FILE'));
    const { manifest } = await verifyBackup(filename, key, async ({ manifest: data, directory, files }) => {
      assert(data.sourceDatabase !== targetEnv.PGDATABASE, 'RESTORE_TARGET_EQUALS_SOURCE');
      const database = (await psql('select current_database();', targetEnv)).trim();
      assert(database === targetEnv.PGDATABASE, 'RESTORE_TARGET_DATABASE_MISMATCH');
      // Use a NEW empty database on an isolated local PostgreSQL/Supabase
      // instance with matching extension libraries and prerequisite cluster
      // roles. A stack's populated default database is deliberately rejected.
      const objects = (await psql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname !~ '^pg_' and n.nspname<>'information_schema' and c.relkind in ('r','p','v','m','S','f');", targetEnv)).trim();
      assert(objects === '0', 'RESTORE_APPLICATION_DATABASE_NOT_EMPTY');
      assert(data.preservesPrivileges === true, 'BACKUP_PRIVILEGES_NOT_PRESERVED');
      await run('pg_restore', [...RESTORE_FLAGS, '--dbname', database, path.join(directory, 'database.dump')], { env: targetEnv });
      assert((await psql(RESTORE_INTEGRITY_SQL, targetEnv)).trim() === 'balanced', 'RESTORED_LEDGER_UNBALANCED');
      const foreignKeys = (await psql("select count(*) from pg_constraint where contype='f' and not convalidated;", targetEnv)).trim();
      assert(foreignKeys === '0', 'RESTORED_FOREIGN_KEY_NOT_VALIDATED');
      // Downloaded documents were already independently hashed and authenticated.
      // Preserve an isolated copy for inspection, never upload them to production.
      const documentsOutput = await outputDirectory(requireValue(env.TREFIL_RESTORE_DOCUMENTS_DIRECTORY, 'TREFIL_RESTORE_DOCUMENTS_DIRECTORY'));
      const runDirectory = path.join(documentsOutput, data.runId);
      await mkdir(runDirectory, { mode: 0o700 });
      for (const file of files.filter(entry => entry.path.startsWith('documents/'))) {
        const { copyFile } = await import('node:fs/promises');
        const target = path.join(runDirectory, ...file.path.split('/'));
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        await copyFile(file.source, target, 1);
        assert(await hashFile(target) === file.sha256, 'RESTORED_DOCUMENT_CHECKSUM_MISMATCH');
      }
      await recordBackup(env, { id: data.runId, organizationId: data.organizationId, startedAt: data.createdAt, status: 'verified', restorationVerifiedAt: new Date().toISOString() });
    });
    return { runId: manifest.runId, status: 'restoration_verified', productionModified: false };
  } finally { key.fill(0); }
}

export async function externalCopy(opts, env = process.env) {
  const key = encryptionKey(env);
  try {
    const filename = path.resolve(requireValue(opts.file, 'BACKUP_FILE'));
    const { manifest } = await verifyBackup(filename, key);
    const destination = await copyToExternal(filename, requireValue(opts.directory, 'EXTERNAL_DIRECTORY'), env.TREFIL_EXTERNAL_VOLUME);
    await recordBackup(env, { id: manifest.runId, organizationId: manifest.organizationId, startedAt: manifest.createdAt, status: 'verified', externalCopyVerifiedAt: new Date().toISOString() });
    return { runId: manifest.runId, status: 'external_copy_verified', file: destination };
  } finally { key.fill(0); }
}

export async function prune(opts, env = process.env) {
  assert(env.TREFIL_RETENTION_ACK === 'expired-encrypted-backups-only', 'RETENTION_REQUIRES_ACK');
  const directory = await outputDirectory(requireValue(opts.directory, 'RETENTION_DIRECTORY'));
  const days = Number(opts.days ?? 30);
  assert(Number.isSafeInteger(days) && days >= 7 && days <= 3650, 'INVALID_RETENTION_DAYS');
  const key = encryptionKey(env);
  try {
    const candidates = [];
    for (const name of await readdir(directory)) {
      if (!/^trefil-[0-9a-f-]{36}\.trefilenc$/.test(name)) continue;
      const filename = path.join(directory, name);
      assert((await lstat(filename)).isFile(), 'RETENTION_REFUSES_NON_FILE');
      // Corrupt, unknown or unauthenticated material is never auto-deleted.
      const { manifest } = await verifyBackup(filename, key);
      candidates.push({ filename, createdAt: Date.parse(manifest.createdAt) });
    }
    candidates.sort((a, b) => b.createdAt - a.createdAt);
    const latest = candidates[0]; let removed = 0;
    for (const entry of candidates) {
      if (entry === latest || !Number.isFinite(entry.createdAt) || entry.createdAt >= Date.now() - days * 86_400_000) continue;
      await rm(entry.filename); await rm(`${entry.filename}.json`); removed++;
    }
    return { status: 'retention_applied', removed, latestVerifiedPreserved: Boolean(latest) };
  } finally { key.fill(0); }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const [command, ...args] = argv;
  if (!command || ['help', '--help', '-h'].includes(command)) { process.stdout.write(HELP); return; }
  const handlers = { backup: makeBackup, verify, restore, 'copy-external': externalCopy, prune };
  assert(Object.hasOwn(handlers, command), 'UNKNOWN_COMMAND');
  const result = await handlers[command](options(args), env);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${safeCode(error)}\n`); process.exitCode = 1; });
}
