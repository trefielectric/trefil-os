-- Delegated access for MCP clients. Plaintext credentials never enter Postgres:
-- the browser creates a random token and stores only its SHA-256 fingerprint.

create schema if not exists developer;
revoke all on schema developer from public,anon,authenticated;
grant usage on schema developer to authenticated,service_role;

insert into workforce.permissions(code,name,description,category,sort_order)
values ('integrations_manage','Administrar integraciones e IA','Crear, limitar y revocar accesos MCP para asistentes externos.','administration',130);
insert into workforce.role_permissions(role_code,permission_code) values ('admin','integrations_manage');

create table developer.scopes (
  code text primary key check (code ~ '^[a-z][a-z0-9_.]{2,63}$'),
  name text not null check (length(btrim(name)) between 2 and 80),
  description text not null check (length(btrim(description)) between 2 and 240),
  module text not null check (module in ('system','workforce','finance','cash','inventory','sales','debts','audit')),
  access text not null check (access in ('read','write')),
  implemented boolean not null default false,
  sort_order smallint not null unique
);

insert into developer.scopes(code,name,description,module,access,implemented,sort_order) values
  ('system.read','Estado de conexión','Consultar versión, módulos disponibles y límites del servidor.','system','read',true,10),
  ('workforce.read','Consultar mi jornada y tareas','Leer únicamente la persona propietaria de la clave y sus tareas del día.','workforce','read',true,20),
  ('workforce.tasks.write','Programar tareas del equipo','Crear tareas solo para reportes directos permitidos por el rol del propietario.','workforce','write',true,30),
  ('finance.read','Consultar resumen financiero','Pendiente del adaptador institucional de Finanzas.','finance','read',false,40),
  ('cash.read','Consultar Caja','Pendiente del adaptador institucional de Caja.','cash','read',false,50),
  ('inventory.read','Consultar Inventarios','Pendiente del adaptador institucional de Inventarios.','inventory','read',false,60),
  ('sales.read','Consultar Ventas','Pendiente del adaptador institucional de Ventas.','sales','read',false,70),
  ('debts.read','Consultar Deudas','Pendiente del adaptador institucional de Deudas.','debts','read',false,80),
  ('audit.read','Consultar auditoría','Pendiente de unificar la auditoría institucional.','audit','read',false,90);

create table developer.keys (
  id uuid primary key,
  name text not null check (length(btrim(name)) between 2 and 80),
  token_prefix text not null unique check (token_prefix ~ '^tos_[a-z0-9]{8}$'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null check (cardinality(scopes) between 1 and 32),
  allowed_origins text[] not null default '{}',
  rate_limit_per_minute smallint not null default 60 check (rate_limit_per_minute between 1 and 300),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint developer_key_expiry check (expires_at is null or expires_at > created_at)
);

create table developer.usage_log (
  id bigint generated always as identity primary key,
  key_id uuid not null references developer.keys(id) on delete restrict,
  request_id uuid not null,
  protocol_method text not null check (length(protocol_method) between 2 and 80),
  tool_name text,
  outcome text not null check (outcome in ('allowed','denied','success','error')),
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 600000),
  occurred_at timestamptz not null default clock_timestamp(),
  unique(key_id,request_id,outcome)
);
create index developer_usage_key_time on developer.usage_log(key_id,occurred_at desc);

alter table developer.scopes enable row level security;
alter table developer.keys enable row level security;
alter table developer.usage_log enable row level security;
revoke all on all tables in schema developer from public,anon,authenticated;

create function developer.require_manager() returns workforce.people
language plpgsql security definer set search_path='' as $$
declare actor workforce.people:=workforce.require_person();
begin
  if coalesce(auth.jwt()->>'aal','')<>'aal2' or not workforce.has_permission(actor,'integrations_manage') then
    raise exception 'Se requiere doble factor y permiso para administrar integraciones.' using errcode='42501';
  end if;
  return actor;
end;
$$;

create function developer.snapshot() returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor workforce.people:=developer.require_manager();
begin
  return jsonb_build_object(
    'me',jsonb_build_object('id',actor.id,'full_name',actor.full_name,'job_title',actor.job_title,'area',actor.area,'access_role',actor.access_role),
    'endpoint','https://kifmqoolaerepvlzrqnk.supabase.co/functions/v1/trefil-mcp/mcp',
    'scopes',coalesce((select jsonb_agg(to_jsonb(s) order by s.sort_order) from developer.scopes s),'[]'::jsonb),
    'keys',coalesce((select jsonb_agg(jsonb_build_object(
      'id',k.id,'name',k.name,'token_prefix',k.token_prefix,'scopes',k.scopes,
      'rate_limit_per_minute',k.rate_limit_per_minute,'created_at',k.created_at,
      'expires_at',k.expires_at,'last_used_at',k.last_used_at,'revoked_at',k.revoked_at,
      'calls_24h',(select count(*) from developer.usage_log u where u.key_id=k.id and u.outcome='success' and u.occurred_at>=clock_timestamp()-interval '24 hours')
    ) order by k.created_at desc) from developer.keys k),'[]'::jsonb)
  );
end;
$$;

create function developer.create_key(
  p_id uuid,p_name text,p_prefix text,p_hash text,p_scopes text[],p_expires_at timestamptz,p_rate_limit smallint
) returns uuid language plpgsql security definer set search_path='' as $$
declare actor workforce.people:=developer.require_manager();
begin
  if p_id is null or p_name is null or p_prefix !~ '^tos_[a-z0-9]{8}$' or p_hash !~ '^[0-9a-f]{64}$'
    or p_rate_limit not between 1 and 300 or cardinality(p_scopes) not between 1 and 32
    or exists(select 1 from unnest(p_scopes) value left join developer.scopes s on s.code=value where s.code is null)
    or cardinality(p_scopes)<>(select count(distinct value) from unnest(p_scopes) value)
    or (p_expires_at is not null and p_expires_at<=clock_timestamp()) then
    raise exception 'La configuración de la clave no es válida.' using errcode='22023';
  end if;
  insert into developer.keys(id,name,token_prefix,token_hash,scopes,rate_limit_per_minute,created_by,expires_at)
  values(p_id,btrim(p_name),p_prefix,p_hash,p_scopes,p_rate_limit,auth.uid(),p_expires_at);
  return p_id;
end;
$$;

create function developer.revoke_key(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform developer.require_manager();
  update developer.keys set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p_id;
  if not found then raise exception 'La clave no existe.' using errcode='22023'; end if;
end;
$$;

create function developer.authorize_key(p_hash text,p_method text,p_tool text,p_origin text,p_request uuid)
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
  if person.id is null then return null; end if;
  update developer.keys set last_used_at=clock_timestamp() where id=record.id;
  insert into developer.usage_log(key_id,request_id,protocol_method,tool_name,outcome)
  values(record.id,p_request,left(coalesce(p_method,'unknown'),80),p_tool,'allowed') on conflict do nothing;
  return jsonb_build_object('key_id',record.id,'person_id',person.id,'scopes',record.scopes,'actor_role',person.access_role);
end;
$$;

create function developer.log_call(p_key uuid,p_request uuid,p_method text,p_tool text,p_outcome text,p_duration integer)
returns void language sql security definer set search_path='' as $$
  insert into developer.usage_log(key_id,request_id,protocol_method,tool_name,outcome,duration_ms)
  values(p_key,p_request,left(coalesce(p_method,'unknown'),80),p_tool,p_outcome,p_duration)
  on conflict do nothing
$$;

create function developer.workforce_today(p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare record developer.keys; actor workforce.people; stamp timestamptz:=clock_timestamp(); day date:=(stamp at time zone 'America/Bogota')::date;
begin
  select * into record from developer.keys k where k.id=p_key and k.revoked_at is null and 'workforce.read'=any(k.scopes);
  select * into actor from workforce.people p where p.user_id=record.created_by and p.active;
  if actor.id is null or not workforce.has_permission(actor,'tasks_view_own') then raise exception 'not_allowed' using errcode='42501'; end if;
  return jsonb_build_object(
    'person',jsonb_build_object('id',actor.id,'name',actor.full_name,'job_title',actor.job_title,'area',actor.area),
    'day',day,'server_now',stamp,
    'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'details',t.details,'due_at',t.due_at,'status',t.status) order by t.due_at nulls last,t.created_at)
      from workforce.tasks t where t.person_id=actor.id and t.scheduled_on=day),'[]'::jsonb)
  );
end;
$$;

create function developer.assign_task(p_key uuid,p_id uuid,p_person uuid,p_day date,p_time time,p_title text,p_details text)
returns uuid language plpgsql security definer set search_path='' as $$
declare record developer.keys; actor workforce.people; subject workforce.people;
begin
  select * into record from developer.keys k where k.id=p_key and k.revoked_at is null and 'workforce.tasks.write'=any(k.scopes);
  select * into actor from workforce.people p where p.user_id=record.created_by and p.active;
  select * into subject from workforce.people p where p.id=p_person and p.active;
  if actor.id is null or subject.id is null or not workforce.has_permission(actor,'tasks_assign')
    or not (actor.access_role='admin' or subject.supervisor_id=actor.id) then
    raise exception 'not_allowed' using errcode='42501';
  end if;
  if p_id is null or p_day is null or not isfinite(p_day) or length(btrim(p_title)) not between 2 and 120 then
    raise exception 'invalid_task' using errcode='22023';
  end if;
  insert into workforce.tasks(id,person_id,assigned_by,scheduled_on,due_at,title,details)
  values(p_id,subject.id,actor.id,p_day,p_time,btrim(p_title),btrim(coalesce(p_details,'')));
  return p_id;
end;
$$;

create function developer.team_targets(p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare record developer.keys; actor workforce.people;
begin
  select * into record from developer.keys k where k.id=p_key and k.revoked_at is null and 'workforce.tasks.write'=any(k.scopes);
  select * into actor from workforce.people p where p.user_id=record.created_by and p.active;
  if actor.id is null or not workforce.has_permission(actor,'tasks_assign') then raise exception 'not_allowed' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'job_title',p.job_title,'area',p.area) order by p.full_name)
    from workforce.people p where p.active and (actor.access_role='admin' or p.supervisor_id=actor.id)),'[]'::jsonb);
end;
$$;

create function public.developer_snapshot() returns jsonb language sql security invoker set search_path='' as $$ select developer.snapshot() $$;
create function public.developer_create_key(p_id uuid,p_name text,p_prefix text,p_hash text,p_scopes text[],p_expires_at timestamptz,p_rate_limit smallint)
returns uuid language sql security invoker set search_path='' as $$ select developer.create_key(p_id,p_name,p_prefix,p_hash,p_scopes,p_expires_at,p_rate_limit) $$;
create function public.developer_revoke_key(p_id uuid) returns void language sql security invoker set search_path='' as $$ select developer.revoke_key(p_id) $$;
create function public.developer_authorize_key(p_hash text,p_method text,p_tool text,p_origin text,p_request uuid)
returns jsonb language sql security invoker set search_path='' as $$ select developer.authorize_key(p_hash,p_method,p_tool,p_origin,p_request) $$;
create function public.developer_log_call(p_key uuid,p_request uuid,p_method text,p_tool text,p_outcome text,p_duration integer)
returns void language sql security invoker set search_path='' as $$ select developer.log_call(p_key,p_request,p_method,p_tool,p_outcome,p_duration) $$;
create function public.developer_workforce_today(p_key uuid) returns jsonb language sql security invoker set search_path='' as $$ select developer.workforce_today(p_key) $$;
create function public.developer_assign_task(p_key uuid,p_id uuid,p_person uuid,p_day date,p_time time,p_title text,p_details text)
returns uuid language sql security invoker set search_path='' as $$ select developer.assign_task(p_key,p_id,p_person,p_day,p_time,p_title,p_details) $$;
create function public.developer_team_targets(p_key uuid) returns jsonb language sql security invoker set search_path='' as $$ select developer.team_targets(p_key) $$;

revoke execute on all functions in schema developer from public,anon,authenticated,service_role;
grant execute on function developer.snapshot(),developer.create_key(uuid,text,text,text,text[],timestamptz,smallint),developer.revoke_key(uuid) to authenticated;
grant execute on function developer.authorize_key(text,text,text,text,uuid),developer.log_call(uuid,uuid,text,text,text,integer),developer.workforce_today(uuid),developer.assign_task(uuid,uuid,uuid,date,time,text,text),developer.team_targets(uuid) to service_role;

revoke all on function public.developer_snapshot() from public,anon;
revoke all on function public.developer_create_key(uuid,text,text,text,text[],timestamptz,smallint) from public,anon;
revoke all on function public.developer_revoke_key(uuid) from public,anon;
grant execute on function public.developer_snapshot(),public.developer_create_key(uuid,text,text,text,text[],timestamptz,smallint),public.developer_revoke_key(uuid) to authenticated;

revoke all on function public.developer_authorize_key(text,text,text,text,uuid),public.developer_log_call(uuid,uuid,text,text,text,integer),public.developer_workforce_today(uuid),public.developer_assign_task(uuid,uuid,uuid,date,time,text,text),public.developer_team_targets(uuid) from public,anon,authenticated;
grant execute on function public.developer_authorize_key(text,text,text,text,uuid),public.developer_log_call(uuid,uuid,text,text,text,integer),public.developer_workforce_today(uuid),public.developer_assign_task(uuid,uuid,uuid,date,time,text,text),public.developer_team_targets(uuid) to service_role;
