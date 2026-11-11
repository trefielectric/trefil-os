-- Replace email-based workforce identities with irreversible cedula fingerprints.
-- The full document number is never sent to or stored by the database.
alter table workforce.people alter column email drop not null;
alter table workforce.people add column identifier_hash text;
alter table workforce.people add column identifier_last_four text;

update workforce.people
set identifier_hash = encode(sha256(convert_to('legacy:' || id::text, 'utf8')), 'hex'),
    identifier_last_four = '0000'
where identifier_hash is null;

alter table workforce.people
  alter column identifier_hash set not null,
  alter column identifier_last_four set not null,
  add constraint workforce_people_identifier_hash_format
    check (identifier_hash ~ '^[0-9a-f]{64}$'),
  add constraint workforce_people_identifier_last_four_format
    check (identifier_last_four ~ '^[0-9]{4}$'),
  add constraint workforce_people_identifier_hash_unique unique (identifier_hash);

create or replace function workforce.require_person() returns workforce.people
language plpgsql security definer set search_path='' as $$
declare actor workforce.people; auth_email text; auth_hash text;
begin
  if auth.uid() is null then raise exception 'Inicia sesión.' using errcode='42501'; end if;
  select * into actor from workforce.people where user_id = auth.uid();
  if not found then
    select lower(u.email) into auth_email from auth.users u
      where u.id=auth.uid() and u.email_confirmed_at is not null;
    if auth_email ~ '^[0-9a-f]{64}@identidad\.trefielectric\.internal$' then
      auth_hash := split_part(auth_email,'@',1);
      update workforce.people p set user_id=auth.uid()
        where p.user_id is null and p.active and p.identifier_hash=auth_hash
        returning * into actor;
      if not found then select * into actor from workforce.people where user_id=auth.uid(); end if;
    end if;
  end if;
  if actor.id is null or not actor.active then
    raise exception 'Tu cuenta no tiene acceso activo a Equipo.' using errcode='42501';
  end if;
  return actor;
end;
$$;

create or replace function workforce.day_snapshot(p_day date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor workforce.people := workforce.require_person();
  stamp timestamptz := statement_timestamp();
  today date := (stamp at time zone 'America/Bogota')::date;
  day date := coalesce(p_day, today);
  start_at timestamptz := day::timestamp at time zone 'America/Bogota';
  end_at timestamptz := (day + 1)::timestamp at time zone 'America/Bogota';
  privileged boolean := coalesce(auth.jwt()->>'aal' = 'aal2', false) and actor.access_role in ('admin','supervisor');
begin
  if not isfinite(day) then raise exception 'Selecciona una fecha válida.' using errcode='22023'; end if;
  return jsonb_build_object(
    'me',jsonb_build_object('id',actor.id,'full_name',actor.full_name,'job_title',actor.job_title,'area',actor.area,'access_role',actor.access_role),
    'can_manage',privileged,'day',day,'today',today,'server_now',stamp,
    'people',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'full_name',p.full_name,'job_title',p.job_title,'area',p.area,
      'access_role',p.access_role,'active',p.active,'registered',p.user_id is not null,
      'supervisor_id',p.supervisor_id,'identifier_hash',case when actor.access_role='admin' then p.identifier_hash end,
      'identifier_last_four',case when actor.access_role='admin' then p.identifier_last_four end
    ) order by p.active desc,p.full_name,p.id)
      from workforce.people p where privileged and workforce.can_manage(actor,p)),'[]'::jsonb),
    'shifts',coalesce((select jsonb_agg(to_jsonb(s) order by s.arrived_at desc)
      from workforce.shifts s join workforce.people p on p.id=s.person_id
      where (p.id=actor.id or (privileged and workforce.can_manage(actor,p)))
        and ((s.arrived_at<end_at and coalesce(s.left_at,stamp)>=start_at) or (day=today and s.left_at is null))),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(to_jsonb(t) order by t.due_at nulls last,t.created_at,t.id)
      from workforce.tasks t join workforce.people p on p.id=t.person_id
      where t.scheduled_on=day and (p.id=actor.id or (privileged and workforce.can_manage(actor,p)))),'[]'::jsonb)
  );
end;
$$;

drop function public.workforce_save_person(uuid,text,text,text,text,text,uuid,boolean);
drop function workforce.save_person(uuid,text,text,text,text,text,uuid,boolean);

create function workforce.save_person(
  p_id uuid,p_identifier_hash text,p_identifier_last_four text,p_name text,p_title text,p_area text,
  p_role text,p_supervisor uuid,p_active boolean
) returns uuid language plpgsql security definer set search_path='' as $$
declare actor workforce.people; existing workforce.people;
begin
  perform pg_advisory_xact_lock(727714,1);
  actor := workforce.require_person();
  if actor.access_role<>'admin' or coalesce(auth.jwt()->>'aal','')<>'aal2' then
    raise exception 'Se requiere un administrador con doble factor.' using errcode='42501';
  end if;
  if p_id is null or p_role is null or p_active is null or p_identifier_hash !~ '^[0-9a-f]{64}$'
    or p_identifier_last_four !~ '^[0-9]{4}$' then
    raise exception 'Completa los datos de la persona.' using errcode='22023';
  end if;
  select * into existing from workforce.people where id=p_id for update;
  if actor.id=p_id and (p_role<>'admin' or not p_active) then
    raise exception 'Otro administrador debe cambiar tu propio acceso.' using errcode='22023';
  end if;
  if existing.user_id is not null and existing.identifier_hash<>p_identifier_hash then
    raise exception 'La cédula de una cuenta vinculada no se puede cambiar.' using errcode='22023';
  end if;
  if (not p_active or p_role='employee') and exists (
    select 1 from workforce.people p where p.supervisor_id=p_id and p.active
  ) then raise exception 'Reasigna primero a las personas de este equipo.' using errcode='22023'; end if;
  if p_supervisor is not null and (p_supervisor=p_id or not exists (
    select 1 from workforce.people p where p.id=p_supervisor and p.active and p.access_role in ('admin','supervisor')
  )) then raise exception 'Selecciona un coordinador activo.' using errcode='22023'; end if;
  if not p_active and exists (select 1 from workforce.shifts where person_id=p_id and left_at is null) then
    raise exception 'La persona debe registrar la salida antes de desactivar su acceso.' using errcode='22023';
  end if;
  insert into workforce.people(id,email,identifier_hash,identifier_last_four,full_name,job_title,area,access_role,supervisor_id,active)
    values(p_id,null,p_identifier_hash,p_identifier_last_four,btrim(p_name),btrim(p_title),btrim(p_area),p_role,p_supervisor,p_active)
  on conflict (id) do update set identifier_hash=excluded.identifier_hash,identifier_last_four=excluded.identifier_last_four,
    full_name=excluded.full_name,job_title=excluded.job_title,area=excluded.area,access_role=excluded.access_role,
    supervisor_id=excluded.supervisor_id,active=excluded.active;
  return p_id;
end;
$$;

drop function public.workforce_invite_target(uuid);
drop function workforce.invite_target(uuid);

create function workforce.invite_target(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor workforce.people := workforce.require_person(); target workforce.people;
begin
  if actor.access_role<>'admin' or coalesce(auth.jwt()->>'aal','')<>'aal2' then
    raise exception 'Se requiere un administrador con doble factor.' using errcode='42501';
  end if;
  select * into target from workforce.people where id=p_id and active;
  if target.id is null then raise exception 'La persona no tiene acceso activo.' using errcode='22023'; end if;
  return jsonb_build_object('identifier_hash',target.identifier_hash,'registered',target.user_id is not null);
end;
$$;

create function workforce.bootstrap_admin(p_hash text,p_last_four text,p_name text,p_title text,p_area text)
returns uuid language plpgsql security definer set search_path='' as $$
declare created uuid; auth_email text;
begin
  perform pg_advisory_xact_lock(727714,2);
  if auth.uid() is null or p_hash !~ '^[0-9a-f]{64}$' or p_last_four !~ '^[0-9]{4}$' then
    raise exception 'No fue posible crear la cuenta inicial.' using errcode='42501';
  end if;
  select lower(u.email) into auth_email from auth.users u
    where u.id=auth.uid() and u.email_confirmed_at is not null;
  if auth_email is distinct from p_hash || '@identidad.trefielectric.internal' then
    raise exception 'No fue posible crear la cuenta inicial.' using errcode='42501';
  end if;
  if exists(select 1 from workforce.people) then
    raise exception 'Equipo ya tiene un administrador.' using errcode='22023';
  end if;
  insert into workforce.people(user_id,email,identifier_hash,identifier_last_four,full_name,job_title,area,access_role,active)
    values(auth.uid(),null,p_hash,p_last_four,btrim(p_name),btrim(p_title),btrim(p_area),'admin',true)
    returning id into created;
  return created;
end;
$$;

create function workforce.bootstrap_available() returns boolean
language sql stable security invoker set search_path='' as $$
  select not exists(select 1 from workforce.people)
$$;

create function public.workforce_save_person(p_id uuid,p_identifier_hash text,p_identifier_last_four text,p_name text,p_title text,p_area text,p_role text,p_supervisor uuid,p_active boolean)
returns uuid language sql security invoker set search_path='' as $$
  select workforce.save_person(p_id,p_identifier_hash,p_identifier_last_four,p_name,p_title,p_area,p_role,p_supervisor,p_active)
$$;
create function public.workforce_invite_target(p_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select workforce.invite_target(p_id) $$;
create function public.workforce_bootstrap_admin(p_hash text,p_last_four text,p_name text,p_title text,p_area text)
returns uuid language sql security invoker set search_path='' as $$ select workforce.bootstrap_admin(p_hash,p_last_four,p_name,p_title,p_area) $$;
create function public.workforce_bootstrap_available()
returns boolean language sql security invoker set search_path='' as $$ select workforce.bootstrap_available() $$;

revoke all on function workforce.save_person(uuid,text,text,text,text,text,text,uuid,boolean),
  workforce.bootstrap_admin(text,text,text,text,text), workforce.invite_target(uuid) from public,anon,authenticated;
revoke all on function workforce.bootstrap_available() from public,anon,authenticated;
revoke all on function public.workforce_save_person(uuid,text,text,text,text,text,text,uuid,boolean),
  public.workforce_bootstrap_admin(text,text,text,text,text), public.workforce_invite_target(uuid) from public,anon;
revoke all on function public.workforce_bootstrap_available() from public,anon,authenticated;
grant execute on function public.workforce_save_person(uuid,text,text,text,text,text,text,uuid,boolean),
  public.workforce_bootstrap_admin(text,text,text,text,text), public.workforce_invite_target(uuid) to authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    execute 'grant usage on schema workforce to service_role';
    execute 'grant select on table workforce.people to service_role';
    execute 'grant execute on function workforce.bootstrap_available(), public.workforce_bootstrap_available() to service_role';
  end if;
end $$;
