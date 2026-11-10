import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261110151745_harden_provider_rls_execute.sql', import.meta.url), 'utf8');

test('provider auto-RLS keeps protecting administrator DDL after API EXECUTE is revoked', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;
      create function public.rls_auto_enable() returns event_trigger language plpgsql security definer
      set search_path=pg_catalog as $$
      declare command record;
      begin
        for command in select * from pg_event_trigger_ddl_commands()
          where command_tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
            and object_type in ('table','partitioned table')
        loop
          if command.schema_name='public' then
            execute format('alter table if exists %s enable row level security',command.object_identity);
          end if;
        end loop;
      end $$;
      create event trigger ensure_rls on ddl_command_end
      when tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
      execute function public.rls_auto_enable();
      grant execute on function public.rls_auto_enable() to anon,authenticated;
      create table public.before_acl_hardening(id integer primary key);`);
    const before = (await db.query<{ definition: string; owner: number; function_oid: number; event_oid: number; enabled: string }>(`select pg_get_functiondef(p.oid) definition,p.proowner owner,p.oid function_oid,t.oid event_oid,t.evtenabled enabled
      from pg_proc p join pg_event_trigger t on t.evtfoid=p.oid where p.oid='public.rls_auto_enable()'::regprocedure`)).rows[0];
    assert.equal((await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid='public.before_acl_hardening'::regclass")).rows[0].relrowsecurity, true);
    await db.exec(migration);
    // ACL change is idempotent and never replaces the function or event trigger.
    await db.exec(migration);
    const after = (await db.query<{ definition: string; owner: number; function_oid: number; event_oid: number; enabled: string }>(`select pg_get_functiondef(p.oid) definition,p.proowner owner,p.oid function_oid,t.oid event_oid,t.evtenabled enabled
      from pg_proc p join pg_event_trigger t on t.evtfoid=p.oid where p.oid='public.rls_auto_enable()'::regprocedure`)).rows[0];
    assert.deepEqual(after, before);
    const rights = (await db.query<{ anon: boolean; authenticated: boolean; owner: boolean }>(`select
      has_function_privilege('anon','public.rls_auto_enable()','EXECUTE') anon,
      has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE') authenticated,
      has_function_privilege(current_user,'public.rls_auto_enable()','EXECUTE') owner`)).rows[0];
    assert.deepEqual(rights, { anon: false, authenticated: false, owner: true });
    await db.exec('set role anon');
    await assert.rejects(db.query('select public.rls_auto_enable()'), /permission denied/);
    await db.exec('reset role;set role authenticated');
    await assert.rejects(db.query('select public.rls_auto_enable()'), /permission denied/);
    await db.exec('reset role;create table public.after_acl_hardening(id integer primary key)');
    const protectedTable = (await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid='public.after_acl_hardening'::regclass")).rows[0];
    assert.equal(protectedTable.relrowsecurity, true, 'Administrator CREATE TABLE still invokes auto-RLS');
  } finally { await db.close(); }
});

test('provider ACL migration is a no-op without the exact provider helper', async () => {
  const db = new PGlite();
  try {
    await db.exec(migration);
    assert.equal((await db.query<{ target: string | null }>("select to_regprocedure('public.rls_auto_enable()')::text target")).rows[0].target, null);
  } finally { await db.close(); }
});

test('provider ACL migration refuses an unexpected ordinary function of the same name', async () => {
  const db = new PGlite();
  try {
    await db.exec('create function public.rls_auto_enable() returns integer language sql as $$select 1$$');
    await assert.rejects(db.exec(migration), /no coincide con el evento de seguridad esperado/);
    assert.equal((await db.query<{ n: number }>('select public.rls_auto_enable() n')).rows[0].n, 1);
  } finally { await db.close(); }
});
