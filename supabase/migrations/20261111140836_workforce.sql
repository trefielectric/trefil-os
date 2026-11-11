-- The institutional project serves one company. Keep workforce records outside
-- the Data API schemas, with access only through explicitly granted RPCs.
create schema workforce;
revoke all on schema workforce from public, anon, authenticated;
grant usage on schema workforce to authenticated;

create table workforce.people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete restrict,
  email text not null unique check (email = lower(btrim(email)) and length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  full_name text not null check (length(btrim(full_name)) between 2 and 120),
  job_title text not null check (length(btrim(job_title)) between 2 and 120),
  area text not null check (length(btrim(area)) between 2 and 120),
  access_role text not null check (access_role in ('admin','supervisor','employee')),
  supervisor_id uuid references workforce.people(id),
  active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  check (supervisor_id is distinct from id)
);
create index workforce_people_supervisor on workforce.people(supervisor_id);

create table workforce.shifts (
  id uuid primary key,
  person_id uuid not null references workforce.people(id),
  arrived_at timestamptz not null,
  left_at timestamptz,
  check (left_at >= arrived_at)
);
create unique index workforce_one_open_shift on workforce.shifts(person_id) where left_at is null;
create index workforce_shifts_person_arrival on workforce.shifts(person_id, arrived_at desc);

create table workforce.arrival_requests (
  person_id uuid not null references workforce.people(id),
  request_id uuid not null,
  shift_id uuid not null references workforce.shifts(id),
  primary key(person_id, request_id)
);
create index workforce_arrival_shift on workforce.arrival_requests(shift_id);

create table workforce.tasks (
  id uuid primary key,
  person_id uuid not null references workforce.people(id),
  assigned_by uuid not null references workforce.people(id),
  scheduled_on date not null,
  due_at time,
  title text not null check (length(btrim(title)) between 2 and 140),
  details text not null default '' check (length(details) <= 1500),
  status text not null default 'pending' check (status in ('pending','in_progress','done','cancelled')),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  check ((status = 'done') = (completed_at is not null))
);
create index workforce_tasks_day_person on workforce.tasks(scheduled_on, person_id);
create index workforce_tasks_assigned_by on workforce.tasks(assigned_by);

alter table workforce.people enable row level security;
alter table workforce.shifts enable row level security;
alter table workforce.tasks enable row level security;
alter table workforce.arrival_requests enable row level security;
revoke all on all tables in schema workforce from public, anon, authenticated;
alter default privileges in schema workforce revoke execute on functions from public;

-- Bind the first verified login to the directory entry. Once linked, neither a
-- caller-supplied email nor a change of Auth email can transfer the entry.
create function workforce.require_person() returns workforce.people
language plpgsql security definer set search_path='' as $$
declare actor workforce.people;
begin
  if auth.uid() is null then raise exception 'Inicia sesión.' using errcode='42501'; end if;
  select * into actor from workforce.people where user_id = auth.uid();
  if not found then
    update workforce.people p set user_id = auth.uid()
    where p.user_id is null and p.active
      and p.email = (select lower(u.email) from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null)
    returning * into actor;
    if not found then select * into actor from workforce.people where user_id = auth.uid(); end if;
  end if;
  if actor.id is null or not actor.active then
    raise exception 'Tu cuenta no tiene acceso activo a Equipo.' using errcode='42501';
  end if;
  return actor;
end;
$$;

create function workforce.can_manage(actor workforce.people, subject workforce.people)
returns boolean language sql stable set search_path='' as $$
  select coalesce(auth.jwt()->>'aal' = 'aal2', false) and (
    actor.access_role = 'admin' or (actor.access_role = 'supervisor' and subject.supervisor_id is not distinct from actor.id)
  )
$$;

create function workforce.day_snapshot(p_day date) returns jsonb
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
    'me', jsonb_build_object('id',actor.id,'full_name',actor.full_name,'job_title',actor.job_title,'area',actor.area,'access_role',actor.access_role),
    'can_manage',privileged,
    'day',day,'today',today,'server_now',stamp,
    'people',coalesce((
      select jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'job_title',p.job_title,'area',p.area,
        'access_role',p.access_role,'active',p.active,'registered',p.user_id is not null,
        'supervisor_id',p.supervisor_id,'email',case when actor.access_role = 'admin' then p.email end)
        order by p.active desc,p.full_name,p.id)
      from workforce.people p where privileged and workforce.can_manage(actor,p)
    ),'[]'::jsonb),
    'shifts',coalesce((
      select jsonb_agg(to_jsonb(s) order by s.arrived_at desc) from workforce.shifts s
      join workforce.people p on p.id=s.person_id
      where (p.id=actor.id or (privileged and workforce.can_manage(actor,p)))
        and ((s.arrived_at < end_at and coalesce(s.left_at, stamp) >= start_at)
          or (day=today and s.left_at is null))
    ),'[]'::jsonb),
    'tasks',coalesce((
      select jsonb_agg(to_jsonb(t) order by t.due_at nulls last,t.created_at,t.id) from workforce.tasks t
      join workforce.people p on p.id=t.person_id
      where t.scheduled_on=day and (p.id=actor.id or (privileged and workforce.can_manage(actor,p)))
    ),'[]'::jsonb)
  );
end;
$$;

create function workforce.save_person(
  p_id uuid, p_email text, p_name text, p_title text, p_area text,
  p_role text, p_supervisor uuid, p_active boolean
) returns uuid language plpgsql security definer set search_path='' as $$
declare actor workforce.people; existing workforce.people;
begin
  -- Serialize changes to directory roles, including administrator demotions.
  perform pg_advisory_xact_lock(727714, 1);
  actor := workforce.require_person();
  if actor.access_role <> 'admin' or coalesce(auth.jwt()->>'aal','') <> 'aal2' then
    raise exception 'Se requiere un administrador con doble factor.' using errcode='42501';
  end if;
  if p_id is null or p_role is null or p_active is null then
    raise exception 'Completa los datos de la persona.' using errcode='22023';
  end if;
  select * into existing from workforce.people where id=p_id for update;
  if actor.id = p_id and (p_role <> 'admin' or not p_active) then
    raise exception 'Otro administrador debe cambiar tu propio acceso.' using errcode='22023';
  end if;
  if existing.user_id is not null and existing.email <> lower(btrim(p_email)) then
    raise exception 'El correo de una cuenta vinculada se actualiza mediante el proceso de identidad.' using errcode='22023';
  end if;
  if (not p_active or p_role='employee') and exists (
    select 1 from workforce.people p where p.supervisor_id=p_id and p.active
  ) then raise exception 'Reasigna primero a las personas de este equipo.' using errcode='22023'; end if;
  if p_supervisor is not null and (p_supervisor = p_id or not exists (
    select 1 from workforce.people p where p.id=p_supervisor and p.active and p.access_role in ('admin','supervisor')
  )) then raise exception 'Selecciona un coordinador activo.' using errcode='22023'; end if;
  if not p_active and exists (select 1 from workforce.shifts where person_id=p_id and left_at is null) then
    raise exception 'La persona debe registrar la salida antes de desactivar su acceso.' using errcode='22023';
  end if;
  insert into workforce.people(id,email,full_name,job_title,area,access_role,supervisor_id,active)
    values(p_id,lower(btrim(p_email)),btrim(p_name),btrim(p_title),btrim(p_area),p_role,p_supervisor,p_active)
  on conflict (id) do update set
    email=excluded.email,full_name=excluded.full_name,job_title=excluded.job_title,area=excluded.area,
    access_role=excluded.access_role,supervisor_id=excluded.supervisor_id,active=excluded.active;
  return p_id;
end;
$$;

create function workforce.mark_shift(p_action text,p_id uuid) returns workforce.shifts
language plpgsql security definer set search_path='' as $$
declare actor workforce.people := workforce.require_person(); shift workforce.shifts;
begin
  -- Serializes marks from different devices and rechecks a concurrent deactivation.
  perform 1 from workforce.people where id=actor.id and active for update;
  if not found then raise exception 'Tu acceso está inactivo.' using errcode='42501'; end if;
  if p_action = 'arrival' then
    select s.* into shift from workforce.arrival_requests r
    join workforce.shifts s on s.id=r.shift_id
    where r.request_id=p_id and r.person_id=actor.id;
    if found then return shift; end if;
    select * into shift from workforce.shifts where person_id=actor.id and left_at is null;
    if not found then
      insert into workforce.shifts(id,person_id,arrived_at)
      values(gen_random_uuid(),actor.id,clock_timestamp()) returning * into shift;
    end if;
    insert into workforce.arrival_requests(person_id,request_id,shift_id) values(actor.id,p_id,shift.id);
  elsif p_action = 'departure' then
    update workforce.shifts set left_at=greatest(arrived_at,clock_timestamp())
    where id=p_id and person_id=actor.id and left_at is null returning * into shift;
    if not found then select * into shift from workforce.shifts where id=p_id and person_id=actor.id; end if;
    if shift.id is null then raise exception 'La jornada no está disponible.' using errcode='42501'; end if;
  else raise exception 'Marcación inválida.' using errcode='22023';
  end if;
  return shift;
end;
$$;

create function workforce.assign_task(p_id uuid,p_person uuid,p_day date,p_time time,p_title text,p_details text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor workforce.people; subject workforce.people; existing workforce.tasks; previous workforce.people;
begin
  perform pg_advisory_xact_lock(727714, 1);
  actor := workforce.require_person();
  select * into subject from workforce.people where id=p_person and active;
  if subject.id is null or not workforce.can_manage(actor,subject) then
    raise exception 'Solo puedes asignar tareas dentro de tu equipo.' using errcode='42501';
  end if;
  if p_day is null or not isfinite(p_day) then raise exception 'Selecciona una fecha válida.' using errcode='22023'; end if;
  select * into existing from workforce.tasks where id=p_id for update;
  if found then
    select * into previous from workforce.people where id=existing.person_id;
    if not workforce.can_manage(actor,previous) then
      raise exception 'Solo puedes editar tareas dentro de tu equipo.' using errcode='42501';
    end if;
    if existing.status <> 'pending' then
      raise exception 'Solo puedes reprogramar una tarea pendiente.' using errcode='22023';
    end if;
    update workforce.tasks set person_id=subject.id,scheduled_on=p_day,due_at=p_time,
      title=btrim(p_title),details=btrim(coalesce(p_details,'')),updated_at=clock_timestamp()
    where id=p_id;
  else
    insert into workforce.tasks(id,person_id,assigned_by,scheduled_on,due_at,title,details)
      values(p_id,subject.id,actor.id,p_day,p_time,btrim(p_title),btrim(coalesce(p_details,'')));
  end if;
  return p_id;
end;
$$;

create function workforce.set_task_status(p_id uuid,p_status text) returns void
language plpgsql security definer set search_path='' as $$
declare actor workforce.people; task workforce.tasks; subject workforce.people;
begin
  perform pg_advisory_xact_lock(727714, 1);
  actor := workforce.require_person();
  select * into task from workforce.tasks where id=p_id for update;
  select * into subject from workforce.people where id=task.person_id;
  if task.id is null or p_status is null or not (
    (p_status='cancelled' and workforce.can_manage(actor,subject)) or
    (task.person_id=actor.id and p_status in ('in_progress','done'))
  ) then raise exception 'No puedes cambiar esta tarea.' using errcode='42501'; end if;
  if task.status=p_status then return; end if;
  if task.status in ('done','cancelled') then
    raise exception 'Esta tarea ya está cerrada.' using errcode='22023';
  end if;
  update workforce.tasks set status=p_status,updated_at=clock_timestamp(),
    completed_at=case when p_status='done' then clock_timestamp() end where id=p_id;
end;
$$;

create function workforce.invite_target(p_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare actor workforce.people := workforce.require_person(); address text;
begin
  if actor.access_role <> 'admin' or coalesce(auth.jwt()->>'aal','') <> 'aal2' then
    raise exception 'Se requiere un administrador con doble factor.' using errcode='42501';
  end if;
  select email into address from workforce.people where id=p_id and active and user_id is null;
  if address is null then raise exception 'La persona ya ingresó o su acceso está inactivo.' using errcode='22023'; end if;
  return address;
end;
$$;

create function public.workforce_day(p_day date default null) returns jsonb
language sql security invoker set search_path='' as $$ select workforce.day_snapshot(p_day) $$;
create function public.workforce_save_person(p_id uuid,p_email text,p_name text,p_title text,p_area text,p_role text,p_supervisor uuid,p_active boolean)
returns uuid language sql security invoker set search_path='' as $$ select workforce.save_person(p_id,p_email,p_name,p_title,p_area,p_role,p_supervisor,p_active) $$;
create function public.workforce_mark_shift(p_action text,p_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select to_jsonb(workforce.mark_shift(p_action,p_id)) $$;
create function public.workforce_assign_task(p_id uuid,p_person uuid,p_day date,p_time time,p_title text,p_details text)
returns uuid language sql security invoker set search_path='' as $$ select workforce.assign_task(p_id,p_person,p_day,p_time,p_title,p_details) $$;
create function public.workforce_set_task_status(p_id uuid,p_status text)
returns void language sql security invoker set search_path='' as $$ select workforce.set_task_status(p_id,p_status) $$;
create function public.workforce_invite_target(p_id uuid)
returns text language sql security invoker set search_path='' as $$ select workforce.invite_target(p_id) $$;

revoke execute on all functions in schema workforce from public,anon,authenticated;
grant execute on function
  workforce.day_snapshot(date), workforce.save_person(uuid,text,text,text,text,text,uuid,boolean),
  workforce.mark_shift(text,uuid), workforce.assign_task(uuid,uuid,date,time,text,text),
  workforce.set_task_status(uuid,text), workforce.invite_target(uuid)
to authenticated;

revoke execute on function
  public.workforce_day(date), public.workforce_save_person(uuid,text,text,text,text,text,uuid,boolean),
  public.workforce_mark_shift(text,uuid), public.workforce_assign_task(uuid,uuid,date,time,text,text),
  public.workforce_set_task_status(uuid,text), public.workforce_invite_target(uuid)
from public,anon,authenticated;
grant execute on function
  public.workforce_day(date), public.workforce_save_person(uuid,text,text,text,text,text,uuid,boolean),
  public.workforce_mark_shift(text,uuid), public.workforce_assign_task(uuid,uuid,date,time,text,text),
  public.workforce_set_task_status(uuid,text), public.workforce_invite_target(uuid)
to authenticated;
