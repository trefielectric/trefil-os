-- Keep legacy clients from closing shifts without a personal report.
create or replace function workforce.mark_shift(p_action text,p_id uuid) returns workforce.shifts
language plpgsql security definer set search_path='' as $$
begin raise exception 'Abre Mi jornada para registrar la apertura o el cierre con sus pendientes.' using errcode='22023'; end $$;

create or replace function developer.authorize_key(p_hash text,p_method text,p_tool text,p_origin text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare record developer.keys; person workforce.people; required_scope text;
begin
  if p_hash !~ '^[0-9a-f]{64}$' or p_request is null then return null; end if;
  select * into record from developer.keys k where k.token_hash=p_hash for update;
  if record.id is null or record.revoked_at is not null or (record.expires_at is not null and record.expires_at<=clock_timestamp()) then return null; end if;
  if p_origin is not null and p_origin<>'' and (cardinality(record.allowed_origins)=0 or not p_origin=any(record.allowed_origins)) then return null; end if;
  if (select count(*) from developer.usage_log u where u.key_id=record.id and u.outcome='allowed' and u.occurred_at>=clock_timestamp()-interval '1 minute')>=record.rate_limit_per_minute then
    raise exception 'rate_limited' using errcode='P0001';
  end if;
  required_scope:=case p_tool
    when 'trefil_system_status' then 'system.read'
    when 'trefil_workforce_today' then 'workforce.read'
    when 'trefil_team_targets' then 'workforce.tasks.write'
    when 'trefil_assign_task' then 'workforce.tasks.write'
    else null end;
  if p_tool is not null and (required_scope is null or not required_scope=any(record.scopes)) then return null; end if;
  select * into person from workforce.people p where p.user_id=record.created_by and p.active;
  if person.id is null or not jornada.ready(person.id) then return null; end if;
  update developer.keys set last_used_at=clock_timestamp() where id=record.id;
  insert into developer.usage_log(key_id,request_id,protocol_method,tool_name,outcome)
  values(record.id,p_request,left(coalesce(p_method,'unknown'),80),p_tool,'allowed') on conflict do nothing;
  return jsonb_build_object('key_id',record.id,'person_id',person.id,'scopes',record.scopes,'actor_role',person.access_role);
end;
$$;


-- pg_cron is installed in the institutional project.
do $$
begin
 if exists(select from pg_roles where rolname='authenticator') then
   create extension if not exists pg_cron;
   perform cron.schedule('trefil-usuario-alertas','* * * * *','select jornada.refresh_alerts()');
   alter role authenticator set pgrst.db_pre_request='jornada.check_request';
 end if;
end $$;
-- Keep the finance and storage authorization checks in place outside PostgREST.
create or replace function private.has_access(p_org uuid,p_location uuid default null,p_roles text[] default null)
returns boolean language sql stable security definer set search_path='' as $$
 select jornada.self_ready() and coalesce(auth.jwt()->>'aal','')='aal2' and exists (
  select 1 from public.organization_members m join public.profiles p on p.id=m.user_id
  where m.organization_id=p_org and m.user_id=auth.uid() and m.active and p.active
  and (p_roles is null or m.role_code=any(p_roles))
  and (p_location is null or m.all_locations or p_location=any(m.location_ids))
 )
$$;
notify pgrst,'reload config';
notify pgrst,'reload schema';
