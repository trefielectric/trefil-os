import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

const ENCRYPTED_MAGIC = Buffer.from('TREFIL-ENC-1\n');
const ARCHIVE_MAGIC = Buffer.from('TREFIL-ARCHIVE-1\n');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_MAX_BYTES = 10 * 1024 ** 3;

export class BackupError extends Error {
  constructor(code) { super(code); this.name = 'BackupError'; this.code = code; }
}
export function assert(condition, code) { if (!condition) throw new BackupError(code); }
export function requireValue(value, name) { assert(typeof value === 'string' && value.length > 0, `MISSING_${name}`); return value; }
export function requireUuid(value) { assert(UUID.test(value ?? ''), 'INVALID_ORGANIZATION_ID'); return value; }
export function institutionalStorageUrl(value) {
  const parsed = new URL(requireValue(value, 'TREFIL_SUPABASE_URL'));
  const institutional = parsed.protocol === 'https:' && parsed.hostname === 'kifmqoolaerepvlzrqnk.supabase.co';
  const local = parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  assert((institutional || local) && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && ['', '/'].includes(parsed.pathname), 'STORAGE_PROJECT_NOT_AUTHORIZED');
  return parsed.origin;
}
export function sourceIdentitySQL(organizationId) {
  requireUuid(organizationId);
  // Backups are full-database: reject a mixed-business database, even if one
  // of its organizations happens to be the requested company.
  return `select (count(*)=1 and coalesce(bool_and(id=${sqlLiteral(organizationId)}::uuid and slug='trefielectric' and name='Trefil Electric'),false))::text from public.organizations;`;
}
export function safeObjectPath(value) {
  assert(typeof value === 'string' && value.length > 0 && value.length <= 2048, 'INVALID_ARCHIVE_PATH');
  assert(!value.includes('\\') && !/[\x00-\x1f\x7f]/.test(value) && !path.posix.isAbsolute(value), 'INVALID_ARCHIVE_PATH');
  assert(value.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..' && !segment.includes(':')), 'INVALID_ARCHIVE_PATH');
  return value;
}
export function containedPath(directory, entryPath) {
  safeObjectPath(entryPath);
  const result = path.resolve(directory, ...entryPath.split('/'));
  assert(result.startsWith(`${path.resolve(directory)}${path.sep}`), 'PATH_ESCAPES_DIRECTORY');
  return result;
}
export function encryptionKey(env = process.env) {
  const encoded = requireValue(env.TREFIL_BACKUP_KEY, 'TREFIL_BACKUP_KEY');
  assert(/^[A-Za-z0-9+/]{43}=$/.test(encoded), 'INVALID_ENCRYPTION_KEY');
  const key = Buffer.from(encoded, 'base64');
  assert(key.length === 32, 'INVALID_ENCRYPTION_KEY');
  return key;
}
export async function hashFile(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}
export async function privateTemp() {
  const directory = await mkdtemp(path.join(tmpdir(), 'trefil-backup-'));
  await chmod(directory, 0o700);
  return directory;
}
export async function withPrivateTemp(callback) {
  const directory = await privateTemp();
  try { return await callback(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

// The authenticated envelope binds its format header and nonce as AAD.
// A fresh 96-bit nonce is generated for every encryption with the 256-bit key.
export async function encryptFile(source, destination, key) {
  assert(key.length === 32, 'INVALID_ENCRYPTION_KEY');
  const nonce = randomBytes(12);
  const header = Buffer.concat([ENCRYPTED_MAGIC, nonce]);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(header);
  let created = false;
  const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  output.on('open', () => { created = true; });
  try {
    await pipeline(createReadStream(source), cipher, async function* (chunks) {
      yield header;
      for await (const chunk of chunks) yield chunk;
      yield cipher.getAuthTag();
    }, output);
    const handle = await open(destination, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    if (created) await rm(destination, { force: true });
    throw error;
  }
  return { encryptedSha256: await hashFile(destination), encryptedSizeBytes: (await stat(destination)).size };
}
export async function decryptFile(source, destination, key) {
  const handle = await open(source, 'r');
  let created = false;
  try {
    const size = (await handle.stat()).size;
    const header = Buffer.alloc(ENCRYPTED_MAGIC.length + 12);
    assert(size > header.length + 16, 'INVALID_ENCRYPTED_FILE');
    await handle.read(header, 0, header.length, 0);
    assert(header.subarray(0, ENCRYPTED_MAGIC.length).equals(ENCRYPTED_MAGIC), 'INVALID_ENCRYPTED_FILE');
    const tag = Buffer.alloc(16);
    await handle.read(tag, 0, 16, size - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(ENCRYPTED_MAGIC.length));
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
    output.on('open', () => { created = true; });
    await pipeline(createReadStream(source, { start: header.length, end: size - 17 }), decipher, output);
  } catch {
    if (created) await rm(destination, { force: true });
    throw new BackupError('AUTHENTICATION_FAILED');
  } finally { await handle.close(); }
}

export async function packArchive(entries, destination) {
  const handle = await open(destination, 'wx', 0o600);
  const names = new Set();
  try {
    await handle.write(ARCHIVE_MAGIC);
    for (const entry of entries) {
      safeObjectPath(entry.path);
      assert(!names.has(entry.path), 'DUPLICATE_ARCHIVE_PATH'); names.add(entry.path);
      const sourceStat = await lstat(entry.source);
      assert(sourceStat.isFile() && !sourceStat.isSymbolicLink(), 'ARCHIVE_SOURCE_NOT_REGULAR_FILE');
      const header = { path: entry.path, size: sourceStat.size, sha256: await hashFile(entry.source) };
      await handle.write(`${JSON.stringify(header)}\n`);
      for await (const chunk of createReadStream(entry.source)) await handle.write(chunk);
      await handle.write('\n');
    }
    await handle.write('{"end":true}\n');
    await handle.sync();
  } finally { await handle.close(); }
}

// Parse frames ourselves rather than extracting arbitrary tar paths or symlinks.
export async function extractArchive(source, destination, maxBytes = DEFAULT_MAX_BYTES) {
  const handle = await open(source, 'r');
  let position = 0; let totalBytes = 0;
  const entries = []; const names = new Set();
  const line = async () => {
    const bytes = [];
    while (bytes.length < 8192) {
      const one = Buffer.alloc(1);
      const { bytesRead } = await handle.read(one, 0, 1, position++);
      assert(bytesRead === 1, 'TRUNCATED_ARCHIVE');
      if (one[0] === 10) return Buffer.from(bytes).toString('utf8');
      bytes.push(one[0]);
    }
    throw new BackupError('ARCHIVE_HEADER_TOO_LONG');
  };
  try {
    const magic = Buffer.alloc(ARCHIVE_MAGIC.length);
    await handle.read(magic, 0, magic.length, 0); position = magic.length;
    assert(magic.equals(ARCHIVE_MAGIC), 'INVALID_ARCHIVE');
    while (true) {
      let header;
      try { header = JSON.parse(await line()); } catch { throw new BackupError('INVALID_ARCHIVE_HEADER'); }
      if (header.end === true) {
        assert(Object.keys(header).length === 1 && position === (await handle.stat()).size, 'ARCHIVE_TRAILING_DATA');
        return entries;
      }
      safeObjectPath(header.path);
      assert(!names.has(header.path), 'DUPLICATE_ARCHIVE_PATH'); names.add(header.path);
      assert(Number.isSafeInteger(header.size) && header.size >= 0 && /^[a-f0-9]{64}$/.test(header.sha256 ?? ''), 'INVALID_ARCHIVE_HEADER');
      totalBytes += header.size;
      assert(totalBytes <= maxBytes && entries.length < 100_002, 'ARCHIVE_LIMIT_EXCEEDED');
      const outputPath = containedPath(destination, header.path);
      await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
      const output = await open(outputPath, 'wx', 0o600);
      try {
        let remaining = header.size;
        const buffer = Buffer.alloc(1024 * 1024);
        while (remaining > 0) {
          const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, remaining), position);
          assert(bytesRead > 0, 'TRUNCATED_ARCHIVE');
          await output.write(buffer.subarray(0, bytesRead));
          position += bytesRead; remaining -= bytesRead;
        }
      } finally { await output.close(); }
      assert(await line() === '', 'INVALID_ARCHIVE_SEPARATOR');
      assert(await hashFile(outputPath) === header.sha256, 'ARCHIVE_FILE_CHECKSUM_MISMATCH');
      entries.push({ ...header, source: outputPath });
    }
  } finally { await handle.close(); }
}

export async function verifyBackup(filename, key, callback = async () => {}) {
  const receipt = JSON.parse(await readFile(`${filename}.json`, 'utf8'));
  assert(receipt.formatVersion === 1 && UUID.test(receipt.runId ?? ''), 'INVALID_RECEIPT');
  assert(receipt.encryptedSha256 === await hashFile(filename), 'ENCRYPTED_CHECKSUM_MISMATCH');
  assert(receipt.encryptedSizeBytes === (await stat(filename)).size, 'ENCRYPTED_SIZE_MISMATCH');
  return withPrivateTemp(async directory => {
    const archive = path.join(directory, 'archive.bin');
    await decryptFile(filename, archive, key);
    const unpacked = path.join(directory, 'unpacked');
    await mkdir(unpacked, { mode: 0o700 });
    const files = await extractArchive(archive, unpacked);
    const manifestFile = files.find(entry => entry.path === 'manifest.json');
    assert(manifestFile, 'MISSING_MANIFEST');
    const manifest = JSON.parse(await readFile(manifestFile.source, 'utf8'));
    assert(manifest.formatVersion === 1 && manifest.runId === receipt.runId && Array.isArray(manifest.files), 'INVALID_MANIFEST');
    requireUuid(manifest.organizationId);
    const payload = files.filter(entry => entry.path !== 'manifest.json');
    assert(payload.some(entry => entry.path === 'database.dump') && manifest.files.length === payload.length, 'MANIFEST_INCOMPLETE');
    for (const entry of payload) {
      const metadata = manifest.files.find(file => file.path === entry.path);
      assert(metadata && metadata.sha256 === entry.sha256 && metadata.size === entry.size, 'MANIFEST_CHECKSUM_MISMATCH');
    }
    await callback({ manifest, files: payload, directory: unpacked, receipt });
    return { manifest, receipt };
  });
}

// Child stderr is intentionally not copied: libpq and remote servers can include
// connection details or business data in error messages. Return stable codes.
export async function run(program, args, { env, input, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const selectedEnv = env ?? Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG') && !key.startsWith('TREFIL_') && !key.startsWith('SUPABASE_')));
    const child = spawn(program, args, { env: selectedEnv, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let outputBytes = 0;
    child.stdout.on('data', chunk => {
      outputBytes += chunk.length;
      if (capture && outputBytes <= 16 * 1024 * 1024) stdout += chunk.toString();
      if (outputBytes > 16 * 1024 * 1024 && capture) child.kill();
    });
    child.stderr.on('data', () => {});
    child.on('error', () => reject(new BackupError(`TOOL_UNAVAILABLE_${path.basename(program).toUpperCase()}`)));
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new BackupError(`COMMAND_FAILED_${path.basename(program).toUpperCase()}`)));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
export function postgresEnv(env, prefix) {
  const result = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('PG') && !key.startsWith('TREFIL_') && !key.startsWith('SUPABASE_')));
  for (const key of ['HOST', 'PORT', 'DATABASE', 'USER', 'PASSWORD', 'PASSFILE', 'SSLMODE', 'SSLROOTCERT', 'SERVICE', 'SERVICEFILE']) {
    if (env[`${prefix}PG${key}`]) result[`PG${key}`] = env[`${prefix}PG${key}`];
  }
  assert(result.PGSERVICE || (result.PGHOST && result.PGDATABASE && result.PGUSER), `MISSING_${prefix}POSTGRES_CONFIGURATION`);
  assert(!result.PGDATABASE || (!result.PGDATABASE.includes('://') && !result.PGDATABASE.includes('=')), 'DATABASE_MUST_BE_A_NAME');
  const loopback = !result.PGSERVICE && ['127.0.0.1', '::1', 'localhost'].includes(result.PGHOST);
  if (!loopback) {
    result.PGSSLMODE ??= 'verify-full';
    assert(result.PGSSLMODE === 'verify-full', 'REMOTE_POSTGRES_REQUIRES_VERIFY_FULL');
  }
  result.PGCONNECT_TIMEOUT = '15';
  return result;
}
export function isolatedRestoreEnv(env) {
  assert(env.TREFIL_RESTORE_ACK === 'isolated-local-database', 'RESTORE_REQUIRES_ISOLATED_ACK');
  const result = postgresEnv(env, 'TREFIL_RESTORE_');
  assert(!result.PGSERVICE && ['127.0.0.1', '::1', 'localhost'].includes(result.PGHOST), 'RESTORE_TARGET_MUST_BE_LOOPBACK');
  assert(/^trefil_restore_[a-z0-9_]{1,48}$/.test(result.PGDATABASE ?? ''), 'RESTORE_DATABASE_NAME_UNSAFE');
  // Local explicitly named database only; production hosts and service aliases
  // are deliberately unsupported, even when an operator supplies an ACK.
  return result;
}
export function sqlLiteral(value) { return value === null || value === undefined ? 'null' : `'${String(value).replaceAll("'", "''")}'`; }
export async function psql(sql, env) { return run('psql', ['-X', '--no-password', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-q'], { env, input: sql, capture: true }); }
export async function recordBackup(env, record) {
  const recordEnv = postgresEnv(env, env.TREFIL_RECORD_PGHOST || env.TREFIL_RECORD_PGSERVICE ? 'TREFIL_RECORD_' : 'TREFIL_BACKUP_');
  requireUuid(record.organizationId); requireUuid(record.id);
  if (record.restorationVerifiedAt || record.externalCopyVerifiedAt) {
    const evidence = [];
    if (record.restorationVerifiedAt) evidence.push(`restoration_verified_at=${sqlLiteral(record.restorationVerifiedAt)}`);
    if (record.externalCopyVerifiedAt) evidence.push(`external_copy_verified_at=${sqlLiteral(record.externalCopyVerifiedAt)}`);
    const result = await psql(`update public.backup_runs set ${evidence.join(',')},updated_at=now() where id=${sqlLiteral(record.id)} and organization_id=${sqlLiteral(record.organizationId)} and status='verified' returning id;`, recordEnv);
    assert(result.trim() === record.id, 'VERIFIED_BACKUP_RUN_NOT_FOUND');
    return;
  }
  const manifest = record.manifest ? sqlLiteral(JSON.stringify(record.manifest)) : "'{}'::jsonb";
  const updateFields = ['status', 'completed_at', 'encrypted_sha256', 'encrypted_size_bytes', 'manifest', 'restoration_verified_at', 'external_copy_verified_at', 'error_code', 'retention_until'];
  const values = {
    id: sqlLiteral(record.id), organization_id: sqlLiteral(record.organizationId), status: sqlLiteral(record.status),
    started_at: sqlLiteral(record.startedAt), completed_at: sqlLiteral(record.completedAt), encrypted_sha256: sqlLiteral(record.encryptedSha256),
    encrypted_size_bytes: Number.isSafeInteger(record.encryptedSizeBytes) ? String(record.encryptedSizeBytes) : 'null', manifest,
    restoration_verified_at: sqlLiteral(record.restorationVerifiedAt), external_copy_verified_at: sqlLiteral(record.externalCopyVerifiedAt),
    error_code: sqlLiteral(record.errorCode), retention_until: sqlLiteral(record.retentionUntil), source: "'backup-cli'",
  };
  const updates = updateFields.map(field => `${field}=coalesce(excluded.${field},public.backup_runs.${field})`).join(',');
  await psql(`insert into public.backup_runs (${Object.keys(values).join(',')}) values (${Object.values(values).join(',')}) on conflict (id) do update set ${updates},updated_at=now();`, recordEnv);
}

export async function listStorage(client, buckets, organizationId) {
  requireUuid(organizationId);
  assert(Array.isArray(buckets) && buckets.length > 0 && buckets.every(bucket => /^[a-z0-9][a-z0-9._-]{0,99}$/.test(bucket)), 'INVALID_BACKUP_BUCKETS');
  const files = [];
  for (const bucket of buckets) {
    const { data: bucketInfo, error: bucketError } = await client.storage.getBucket(bucket);
    assert(!bucketError && bucketInfo && bucketInfo.public === false, 'STORAGE_BUCKET_MISSING_OR_PUBLIC');
    const walk = async (prefix, depth) => {
      assert(depth <= 32, 'STORAGE_PATH_TOO_DEEP');
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
        assert(!error && Array.isArray(data), 'STORAGE_LIST_FAILED');
        for (const item of data) {
          assert(typeof item.name === 'string' && !item.name.includes('/'), 'INVALID_STORAGE_OBJECT_NAME');
          const objectPath = safeObjectPath(`${prefix}/${item.name}`);
          if (item.id === null) await walk(objectPath, depth + 1);
          else {
            assert(item.id && item.metadata && Number.isSafeInteger(item.metadata.size) && item.metadata.size >= 0, 'INVALID_STORAGE_METADATA');
            files.push({ bucket, objectPath, id: item.id, updatedAt: item.updated_at, size: item.metadata.size });
            assert(files.length <= 100_000, 'TOO_MANY_STORAGE_OBJECTS');
          }
        }
        if (data.length < 100) break;
      }
    };
    await walk(organizationId, 0);
  }
  return files.sort((a, b) => `${a.bucket}/${a.objectPath}`.localeCompare(`${b.bucket}/${b.objectPath}`, 'en'));
}
export async function downloadStorage(client, files, directory, maxBytes = DEFAULT_MAX_BYTES) {
  let total = 0; const entries = [];
  for (const file of files) {
    assert(file.size <= 100 * 1024 ** 2, 'STORAGE_OBJECT_TOO_LARGE');
    total += file.size; assert(total <= maxBytes, 'STORAGE_LIMIT_EXCEEDED');
    const relativePath = safeObjectPath(`documents/${file.bucket}/${file.objectPath}`);
    const destination = containedPath(directory, relativePath);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const { data, error } = await client.storage.from(file.bucket).download(file.objectPath);
    assert(!error && data && data.size === file.size, 'STORAGE_DOWNLOAD_FAILED');
    await writeFile(destination, Buffer.from(await data.arrayBuffer()), { flag: 'wx', mode: 0o600 });
    entries.push({ path: relativePath, source: destination, sha256: await hashFile(destination), size: file.size });
  }
  return entries;
}

export async function copyToExternal(filename, destinationDirectory, selectedVolume) {
  requireValue(selectedVolume, 'TREFIL_EXTERNAL_VOLUME');
  const volume = await realpath(selectedVolume);
  assert(volume === path.resolve(selectedVolume) && /^\/(Volumes|media|mnt)\/.+/.test(volume), 'EXTERNAL_VOLUME_MUST_BE_EXPLICIT_MOUNT');
  assert((await stat(volume)).dev !== (await stat('/')).dev, 'EXTERNAL_VOLUME_NOT_MOUNTED');
  const destination = path.resolve(destinationDirectory);
  assert(destination.startsWith(`${volume}${path.sep}`), 'EXTERNAL_DESTINATION_OUTSIDE_VOLUME');
  await mkdir(destination, { recursive: true, mode: 0o700 });
  assert((await realpath(destination)) === destination, 'EXTERNAL_SYMLINK_NOT_ALLOWED');
  const target = path.join(destination, path.basename(filename));
  await copyFile(filename, target, 1); // COPYFILE_EXCL, never overwrite.
  await chmod(target, 0o600);
  const encryptedHandle = await open(target, 'r+');
  try { await encryptedHandle.sync(); } finally { await encryptedHandle.close(); }
  assert(await hashFile(filename) === await hashFile(target), 'EXTERNAL_COPY_CHECKSUM_MISMATCH');
  await copyFile(`${filename}.json`, `${target}.json`, 1);
  await chmod(`${target}.json`, 0o600);
  const receiptHandle = await open(`${target}.json`, 'r+');
  try { await receiptHandle.sync(); } finally { await receiptHandle.close(); }
  assert(await hashFile(`${filename}.json`) === await hashFile(`${target}.json`), 'EXTERNAL_RECEIPT_CHECKSUM_MISMATCH');
  return target;
}
