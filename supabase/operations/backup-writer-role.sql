-- OPTIONAL OPERATOR PROVISIONING, never executed automatically.
-- Run only in the verified Trefil project after bootstrap-owner.sql.
-- This NOLOGIN group has no credential and cannot read/write the financial book.
-- Provision a dedicated login through the provider/credential manager, then grant
-- membership to this group. Its separate pg_dump read permissions must be reviewed.
begin;
do $$ declare org uuid;begin
 select id into strict org from public.organizations where slug='trefielectric' and name='Trefil Electric';
 if not exists(select 1 from pg_roles where rolname='trefil_backup_writer') then create role trefil_backup_writer nologin;end if;
 execute format('create policy backup_worker_read on public.backup_runs for select to trefil_backup_writer using(organization_id=%L::uuid)',org);
 execute format('create policy backup_worker_insert on public.backup_runs for insert to trefil_backup_writer with check(organization_id=%L::uuid)',org);
 execute format('create policy backup_worker_update on public.backup_runs for update to trefil_backup_writer using(organization_id=%L::uuid) with check(organization_id=%L::uuid)',org,org);
end $$;
grant usage on schema public to trefil_backup_writer;
grant select,insert on public.backup_runs to trefil_backup_writer;
grant update(status,completed_at,encrypted_sha256,encrypted_size_bytes,manifest,restoration_verified_at,external_copy_verified_at,error_code,retention_until,updated_at) on public.backup_runs to trefil_backup_writer;
commit;
