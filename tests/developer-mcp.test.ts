import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createDeveloperCredential } from '../src/lib/developer';

const migration=new URL('../supabase/migrations/20261111164415_developer_mcp_access.sql',import.meta.url);
const server=new URL('../supabase/functions/trefil-mcp/index.ts',import.meta.url);
const ui=new URL('../src/components/developer-app.tsx',import.meta.url);

test('MCP credentials are random, prefixed and represented by a separate fingerprint',async()=>{
  const first=await createDeveloperCredential();const second=await createDeveloperCredential();
  assert.match(first.token,/^tos_[a-z0-9]{8}\.[A-Za-z0-9_-]{43}$/);
  assert.match(first.hash,/^[0-9a-f]{64}$/);
  assert.notEqual(first.token,second.token);assert.notEqual(first.hash,second.hash);assert.ok(!first.token.includes(first.hash));
});
test('database stores fingerprints only, requires AAL2 and restricts machine RPCs to service_role',async()=>{
  const sql=await readFile(migration,'utf8');
  assert.match(sql,/token_hash text not null unique/);assert.doesNotMatch(sql,/plaintext|token_secret/);
  assert.match(sql,/auth\.jwt\(\)->>'aal',''\)<>'aal2'/);assert.match(sql,/integrations_manage/);
  assert.match(sql,/grant execute on function public\.developer_authorize_key[\s\S]*to service_role/);
  assert.match(sql,/revoke all on function public\.developer_authorize_key[\s\S]*from public,anon,authenticated/);
  assert.match(sql,/revoked_at is not null/);assert.match(sql,/expires_at<=clock_timestamp/);assert.match(sql,/rate_limit_per_minute/);
});
test('MCP server implements scoped Streamable HTTP calls without exposing a service key',async()=>{
  const source=await readFile(server,'utf8');
  assert.match(source,/protocolVersion = "2025-06-18"/);assert.match(source,/method === "tools\/list"/);assert.match(source,/method === "tools\/call"/);
  assert.match(source,/developer_authorize_key/);assert.match(source,/Authorization/);assert.match(source,/WWW-Authenticate/);
  assert.doesNotMatch(source,/service_role\s*[:=]\s*["'][A-Za-z0-9]/);assert.match(source,/pendingAdapters/);
});
test('developer console labels unavailable adapters and never retrieves an existing plaintext key',async()=>{
  const source=await readFile(ui,'utf8');
  assert.match(source,/Nueva clave MCP/);assert.match(source,/Pendiente/);assert.match(source,/no puede volver a mostrarla/i);
  assert.match(source,/developer_create_key/);assert.doesNotMatch(source,/select\([^)]*token_hash/);
});

test('an administrator can create, scope, authorize and revoke a key end to end',async()=>{
  const db=new PGlite();
  await db.exec(`
    create schema auth;
    create role anon;create role authenticated;create role service_role;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',coalesce(nullif(current_setting('request.jwt.claim.aal',true),''),'aal1'))$$;
    grant usage on schema auth to authenticated,service_role;
    grant execute on function auth.uid(),auth.jwt() to authenticated,service_role;
  `);
  for(const file of ['20261111140836_workforce.sql','20261111144203_cedula_identity.sql','20261111153246_workforce_roles_permissions.sql','20261111164415_developer_mcp_access.sql'])
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
  const user='10000000-0000-4000-8000-000000000001';
  const person='20000000-0000-4000-8000-000000000001';
  const key='30000000-0000-4000-8000-000000000001';
  const hash='a'.repeat(64);
  await db.exec(`
    insert into auth.users(id,email,email_confirmed_at) values('${user}','${'b'.repeat(64)}@identidad.trefielectric.internal',clock_timestamp());
    insert into workforce.people(id,user_id,email,identifier_hash,identifier_last_four,full_name,job_title,area,access_role,active)
    values('${person}','${user}',null,'${'b'.repeat(64)}','1234','Administración de prueba','Gerencia','Administración','admin',true);
    select set_config('request.jwt.claim.sub','${user}',false);
    select set_config('request.jwt.claim.aal','aal2',false);
    set role authenticated;
  `);
  const created=await db.query<{developer_create_key:string}>(`select public.developer_create_key($1::uuid,'Cursor de prueba','tos_1234abcd',$2,array['system.read'],clock_timestamp()+interval '30 days',15::smallint)`,[key,hash]);
  assert.equal(created.rows[0].developer_create_key,key);
  const snapshot=await db.query<{developer_snapshot:{keys:Array<Record<string,unknown>>}}>('select public.developer_snapshot()');
  assert.equal(snapshot.rows[0].developer_snapshot.keys.length,1);
  assert.ok(!('token_hash' in snapshot.rows[0].developer_snapshot.keys[0]));

  await db.exec('reset role;set role service_role');
  const allowed=await db.query<{developer_authorize_key:{key_id:string}|null}>(`select public.developer_authorize_key($1,'tools/call','trefil_system_status',null,$2)`,[hash,'40000000-0000-4000-8000-000000000001']);
  assert.equal(allowed.rows[0].developer_authorize_key?.key_id,key);
  const denied=await db.query<{developer_authorize_key:unknown}>(`select public.developer_authorize_key($1,'tools/call','trefil_workforce_today',null,$2)`,[hash,'40000000-0000-4000-8000-000000000002']);
  assert.equal(denied.rows[0].developer_authorize_key,null);

  await db.exec(`reset role;select set_config('request.jwt.claim.sub','${user}',false);select set_config('request.jwt.claim.aal','aal2',false);set role authenticated`);
  await db.query('select public.developer_revoke_key($1)',[key]);
  await db.exec('reset role;set role service_role');
  const revoked=await db.query<{developer_authorize_key:unknown}>(`select public.developer_authorize_key($1,'tools/call','trefil_system_status',null,$2)`,[hash,'40000000-0000-4000-8000-000000000003']);
  assert.equal(revoked.rows[0].developer_authorize_key,null);
  await db.close();
});
