import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  containedPath, decryptFile, downloadStorage, encryptFile, encryptionKey,
  extractArchive, hashFile, isolatedRestoreEnv, listStorage, packArchive,
  postgresEnv, safeObjectPath, verifyBackup, withPrivateTemp,
  institutionalStorageUrl, sourceIdentitySQL,
} from '../scripts/backup/lib.mjs';
import { makeBackup, restore, outputDirectory, DUMP_FLAGS, RESTORE_FLAGS } from '../scripts/backup/cli.mjs';

const org = '11111111-1111-4111-8111-111111111111';
const sourceEnv = { PATH: process.env.PATH, TREFIL_BACKUP_PGHOST: 'db.example.test', TREFIL_BACKUP_PGDATABASE: 'postgres', TREFIL_BACKUP_PGUSER: 'backup', TREFIL_BACKUP_PGPASSWORD: 'not-a-real-password' };
const targetEnv = { TREFIL_RESTORE_ACK: 'isolated-local-database', TREFIL_RESTORE_PGHOST: '127.0.0.1', TREFIL_RESTORE_PGDATABASE: 'trefil_restore_test', TREFIL_RESTORE_PGUSER: 'operator' };

test('AES-256-GCM authenticates plaintext, nonce and ciphertext; permissions are private', async () => {
  await withPrivateTemp(async directory => {
    const key = randomBytes(32); const plaintext = path.join(directory, 'plain');
    const encrypted = path.join(directory, 'encrypted'); const decoded = path.join(directory, 'decoded');
    await writeFile(plaintext, Buffer.concat([Buffer.from('fictitious database\n'), randomBytes(2 * 1024 * 1024)]));
    const result = await encryptFile(plaintext, encrypted, key);
    assert.equal(result.encryptedSha256, await hashFile(encrypted));
    assert.equal((await stat(encrypted)).mode & 0o777, 0o600);
    await decryptFile(encrypted, decoded, key);
    assert.deepEqual(await readFile(decoded), await readFile(plaintext));
    const bytes = await readFile(encrypted); bytes[40] ^= 0xff;
    const tampered = path.join(directory, 'tampered'); await writeFile(tampered, bytes);
    const output = path.join(directory, 'bad-output');
    await assert.rejects(decryptFile(tampered, output, key), /AUTHENTICATION_FAILED/);
    await assert.rejects(stat(output), { code: 'ENOENT' });
    await assert.rejects(decryptFile(encrypted, path.join(directory, 'wrong-key'), randomBytes(32)), /AUTHENTICATION_FAILED/);
  });
});

test('paths reject traversal, absolute paths, Windows paths, control characters and ambiguous components', () => {
  for (const value of ['../secret', '/secret', 'a/../../secret', 'a//file', 'a/./file', 'a/..', 'C:\\secret', 'x\u0000y', 'x\ny', 'C:/secret', 'a\\..\\secret']) {
    assert.throws(() => safeObjectPath(value), /INVALID_ARCHIVE_PATH/);
  }
  assert.equal(containedPath('/tmp/isolated', 'documents/bucket/a.pdf'), '/tmp/isolated/documents/bucket/a.pdf');
});

test('archive frames enforce file checksums, duplicate paths and bounded extraction', async () => {
  await withPrivateTemp(async directory => {
    const source = path.join(directory, 'data'); await writeFile(source, 'demo-data');
    const archive = path.join(directory, 'archive');
    await packArchive([{ path: 'nested/data', source }], archive);
    const output = path.join(directory, 'out'); await mkdir(output);
    const files = await extractArchive(archive, output);
    assert.equal(files.length, 1); assert.equal(await readFile(files[0].source, 'utf8'), 'demo-data');
    await assert.rejects(packArchive([{ path: 'x', source }, { path: 'x', source }], path.join(directory, 'duplicate')), /DUPLICATE_ARCHIVE_PATH/);
    const small = path.join(directory, 'small'); await mkdir(small);
    await assert.rejects(extractArchive(archive, small, 2), /ARCHIVE_LIMIT_EXCEEDED/);
    const malicious = path.join(directory, 'malicious');
    await writeFile(malicious, 'TREFIL-ARCHIVE-1\n' + JSON.stringify({ path: '../escape', size: 0, sha256: 'a'.repeat(64) }) + '\n\n{"end":true}\n');
    await assert.rejects(extractArchive(malicious, small), /INVALID_ARCHIVE_PATH/);
  });
});

test('a receipt, authenticated manifest and every payload checksum must agree', async () => {
  await withPrivateTemp(async directory => {
    const id = randomUUID(); const key = randomBytes(32);
    const dump = path.join(directory, 'database.dump'); await writeFile(dump, 'fictional dump fixture');
    const manifest = { formatVersion: 1, runId: id, organizationId: org, createdAt: new Date().toISOString(), files: [{ path: 'database.dump', size: (await stat(dump)).size, sha256: await hashFile(dump) }] };
    const manifestPath = path.join(directory, 'manifest'); await writeFile(manifestPath, JSON.stringify(manifest));
    const archive = path.join(directory, 'archive');
    await packArchive([{ path: 'manifest.json', source: manifestPath }, { path: 'database.dump', source: dump }], archive);
    const encrypted = path.join(directory, `trefil-${id}.trefilenc`);
    const receipt = { formatVersion: 1, runId: id, ...await encryptFile(archive, encrypted, key) };
    await writeFile(`${encrypted}.json`, JSON.stringify(receipt));
    let callbackCalled = false;
    const result = await verifyBackup(encrypted, key, async ({ files }) => { callbackCalled = true; assert.equal(files.length, 1); });
    assert.equal(result.manifest.runId, id); assert.equal(callbackCalled, true);
    receipt.encryptedSha256 = '0'.repeat(64); await writeFile(`${encrypted}.json`, JSON.stringify(receipt));
    await assert.rejects(verifyBackup(encrypted, key), /ENCRYPTED_CHECKSUM_MISMATCH/);
  });
});

test('restore rejects remote hosts, nonisolated database names, services and absent acknowledgement before any connection', async () => {
  assert.equal(isolatedRestoreEnv(targetEnv).PGDATABASE, 'trefil_restore_test');
  for (const env of [
    { ...targetEnv, TREFIL_RESTORE_ACK: undefined },
    { ...targetEnv, TREFIL_RESTORE_PGHOST: 'production.supabase.co' },
    { ...targetEnv, TREFIL_RESTORE_PGDATABASE: 'postgres' },
    { ...targetEnv, TREFIL_RESTORE_PGDATABASE: 'postgres://user:password@localhost/db' },
    { ...targetEnv, TREFIL_RESTORE_PGSERVICE: 'production' },
  ]) assert.throws(() => isolatedRestoreEnv(env));
  await assert.rejects(restore({ file: '/does-not-exist' }, {}), /RESTORE_REQUIRES_ISOLATED_ACK/);
});

test('no implicit database connection or encryption key is accepted; subprocess environment excludes application secrets', async () => {
  assert.throws(() => encryptionKey({}), /MISSING_TREFIL_BACKUP_KEY/);
  assert.throws(() => encryptionKey({ TREFIL_BACKUP_KEY: 'short' }), /INVALID_ENCRYPTION_KEY/);
  assert.throws(() => postgresEnv({ PGHOST: 'ambient-production' }, 'TREFIL_BACKUP_'), /POSTGRES_CONFIGURATION/);
  const result = postgresEnv({ ...sourceEnv, PGPASSWORD: 'ambient-secret', TREFIL_BACKUP_KEY: 'key', SUPABASE_SERVICE_ROLE_KEY: 'secret' }, 'TREFIL_BACKUP_');
  assert.equal(result.PGPASSWORD, 'not-a-real-password');
  assert.equal(result.TREFIL_BACKUP_KEY, undefined); assert.equal(result.SUPABASE_SERVICE_ROLE_KEY, undefined);
  await assert.rejects(makeBackup({}, {}), /MISSING_TREFIL_BACKUP_KEY/);
});

test('private Storage backup handles recursion and pagination and rejects changed or oversized downloads', async () => {
  const pages = [];
  const files = Array.from({ length: 101 }, (_, index) => ({ id: String(index + 1), name: `${String(index).padStart(3, '0')}.pdf`, updated_at: '2026-11-10', metadata: { size: 3 } }));
  const client = { storage: {
    getBucket: async () => ({ data: { public: false }, error: null }),
    from: () => ({
      list: async (prefix, { offset }) => { pages.push([prefix, offset]); return { data: prefix === org ? [{ id: null, name: 'contracts' }] : files.slice(offset, offset + 100), error: null }; },
      download: async () => ({ data: new Blob(['pdf']), error: null }),
    }),
  } };
  const result = await listStorage(client, ['private-documents'], org);
  assert.equal(result.length, 101);
  assert.ok(pages.some(([prefix, offset]) => prefix.endsWith('/contracts') && offset === 100));
  await withPrivateTemp(async directory => {
    const downloads = await downloadStorage(client, result.slice(0, 2), directory);
    assert.equal(downloads.length, 2);
    await assert.rejects(downloadStorage(client, [{ ...result[0], size: 4 }], directory), /STORAGE_DOWNLOAD_FAILED/);
    await assert.rejects(downloadStorage(client, [{ ...result[0], size: 101 * 1024 ** 2 }], directory), /STORAGE_OBJECT_TOO_LARGE/);
  });
  const publicClient = { storage: { ...client.storage, getBucket: async () => ({ data: { public: true } }) } };
  await assert.rejects(listStorage(publicClient, ['private-documents'], org), /STORAGE_BUCKET_MISSING_OR_PUBLIC/);
});

test('backups preserve database privileges and reject unsafe remote database transport', () => {
  // Removing ACLs on capture OR restore would silently discard the reviewed
  // grants and revokes. Preserve both sides of the recovery contract.
  for (const flags of [DUMP_FLAGS, RESTORE_FLAGS]) {
    assert.ok(!flags.includes('--no-privileges') && !flags.includes('--no-acl') && !flags.includes('-x'));
    assert.ok(flags.includes('--no-owner'));
  }
  assert.equal(postgresEnv(sourceEnv, 'TREFIL_BACKUP_').PGSSLMODE, 'verify-full');
  for (const insecure of ['disable', 'allow', 'prefer', 'require', 'verify-ca']) {
    assert.throws(() => postgresEnv({ ...sourceEnv, TREFIL_BACKUP_PGSSLMODE: insecure }, 'TREFIL_BACKUP_'), /VERIFY_FULL/);
  }
});

test('institutional source guards reject another business and bind a full dump to one organization', async () => {
  assert.equal(institutionalStorageUrl('https://kifmqoolaerepvlzrqnk.supabase.co/'), 'https://kifmqoolaerepvlzrqnk.supabase.co');
  for (const value of ['https://another-business.supabase.co', 'https://kifmqoolaerepvlzrqnk.supabase.co.attacker.test', 'https://name:password@kifmqoolaerepvlzrqnk.supabase.co', 'https://kifmqoolaerepvlzrqnk.supabase.co/path']) {
    assert.throws(() => institutionalStorageUrl(value), /STORAGE_PROJECT_NOT_AUTHORIZED/);
  }
  assert.throws(() => sourceIdentitySQL("'; drop table public.organizations;--"), /INVALID_ORGANIZATION_ID/);
  // Execute the source guard against isolated PostgreSQL, rather than treating
  // a string containing an organization UUID as proof of tenant separation.
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec('create table public.organizations(id uuid primary key,slug text,name text)');
    const matches = async () => (await db.query(sourceIdentitySQL(org))).rows[0].text;
    assert.equal(await matches(), 'false');
    await db.query('insert into public.organizations values($1,$2,$3)', [org, 'trefielectric', 'Trefil Electric']);
    assert.equal(await matches(), 'true');
    await db.query('insert into public.organizations values($1,$2,$3)', [randomUUID(), 'another-business', 'Another fictional company']);
    assert.equal(await matches(), 'false');
    await db.query('delete from public.organizations where id<>$1', [org]);
    await db.query('update public.organizations set slug=$1 where id=$2', ['wrong-business', org]);
    assert.equal(await matches(), 'false');
  } finally { await db.close(); }
});

test('encryption and decryption never remove or overwrite an existing destination', async () => {
  await withPrivateTemp(async directory => {
    const key = randomBytes(32); const source = path.join(directory, 'source');
    const target = path.join(directory, 'existing'); const encrypted = path.join(directory, 'encrypted');
    await writeFile(source, 'fictitious source'); await writeFile(target, 'preserve-me');
    await encryptFile(source, encrypted, key);
    await assert.rejects(encryptFile(source, target, key));
    assert.equal(await readFile(target, 'utf8'), 'preserve-me');
    await assert.rejects(decryptFile(encrypted, target, key));
    assert.equal(await readFile(target, 'utf8'), 'preserve-me');
  });
});

test('backup output resolves system aliases but cannot use a symlink to bypass the no-Git rule', async () => {
  await withPrivateTemp(async directory => {
    const outside = path.join(directory, 'private-storage'); await mkdir(outside);
    const alias = path.join(directory, 'storage-alias'); await symlink(outside, alias);
    assert.equal(await outputDirectory(path.join(alias, 'daily')), await realpath(path.join(outside, 'daily')));
    const checkout = path.join(directory, 'repository'); await mkdir(path.join(checkout, '.git'), { recursive: true });
    const nested = path.join(checkout, 'nested'); await mkdir(nested);
    const disguised = path.join(directory, 'disguised-storage'); await symlink(nested, disguised);
    await assert.rejects(outputDirectory(path.join(disguised, 'daily')), /BACKUPS_FORBIDDEN_IN_GIT_CHECKOUT/);
  });
});
