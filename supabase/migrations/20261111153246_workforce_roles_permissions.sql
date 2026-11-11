-- Role-based access control for Equipo. Authorization remains server-owned:
-- the browser receives capabilities for presentation, while every mutation and
-- every cross-person read is rechecked in PostgreSQL.

create table workforce.permissions (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{2,47}$'),
  name text not null check (length(btrim(name)) between 2 and 80),
  description text not null check (length(btrim(description)) between 2 and 240),
  category text not null check (category in ('personal','team','administration')),
  sort_order smallint not null unique
);

insert into workforce.permissions(code,name,description,category,sort_order) values
  ('attendance_view_own','Ver mi asistencia','Consultar mis horas de llegada y salida.','personal',10),
  ('attendance_mark','Marcar asistencia','Registrar mi hora de llegada y salida.','personal',20),
  ('tasks_view_own','Ver mis tareas','Consultar las tareas que me fueron programadas.','personal',30),
  ('tasks_update_own','Actualizar mis tareas','Iniciar y completar mis propias tareas.','personal',40),
  ('team_view','Ver personas a cargo','Consultar el directorio básico de mis reportes directos.','team',50),
  ('attendance_view_team','Ver asistencia del equipo','Consultar las marcaciones de mis reportes directos.','team',60),
  ('tasks_view_team','Ver tareas del equipo','Consultar las tareas de mis reportes directos.','team',70),
  ('tasks_assign','Programar tareas','Crear y reprogramar tareas de mis reportes directos.','team',80),
  ('tasks_cancel','Cancelar tareas','Cancelar tareas abiertas de mis reportes directos.','team',90),
  ('people_manage','Administrar personas','Crear, editar, activar, desactivar y asignar roles.','administration',100),
  ('access_manage','Administrar accesos','Crear enlaces de activación y recuperación.','administration',110),
  ('roles_manage','Administrar funciones y roles','Crear roles y definir sus permisos.','administration',120);

create table workforce.roles (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,31}$'),
  name text not null unique check (length(btrim(name)) between 2 and 60),
  description text not null check (length(btrim(description)) between 2 and 240),
  system boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

insert into workforce.roles(code,name,description,system) values
  ('admin','Administrador','Control total de Equipo y su configuración.',true),
  ('supervisor','Coordinador','Coordina personas, asistencia y tareas de sus reportes directos.',true),
  ('employee','Colaborador','Gestiona su asistencia y sus tareas personales.',true);

create table workforce.role_permissions (
  role_code text not null references workforce.roles(code) on delete cascade,
  permission_code text not null references workforce.permissions(code) on delete restrict,
  primary key(role_code,permission_code)
);

insert into workforce.role_permissions(role_code,permission_code)
select 'admin',code from workforce.permissions;
insert into workforce.role_permissions(role_code,permission_code) values
  ('supervisor','attendance_view_own'),('supervisor','attendance_mark'),
  ('supervisor','tasks_view_own'),('supervisor','tasks_update_own'),
  ('supervisor','team_view'),('supervisor','attendance_view_team'),
  ('supervisor','tasks_view_team'),('supervisor','tasks_assign'),('supervisor','tasks_cancel'),
  ('employee','attendance_view_own'),('employee','attendance_mark'),
  ('employee','tasks_view_own'),('employee','tasks_update_own');

alter table workforce.people drop constraint people_access_role_check;
alter table workforce.people add constraint workforce_people_role_fk
  foreign key(access_role) references workforce.roles(code) on update cascade on delete restrict;

alter table workforce.permissions enable row level security;
alter table workforce.roles enable row level security;
alter table workforce.role_permissions enable row level security;
revoke all on table workforce.permissions,workforce.roles,workforce.role_permissions
  from public,anon,authenticated;

create function workforce.has_permission(p_actor workforce.people,p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from workforce.roles r
    join workforce.role_permissions rp on rp.role_code=r.code
    where r.code=p_actor.access_role and r.active and rp.permission_code=p_permission
  )
$$;

create or replace function workforce.can_manage(actor workforce.people,subject workforce.people)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(auth.jwt()->>'aal'='aal2',false) and (
    (workforce.has_permission(actor,'people_manage') and actor.access_role='admin')
    or (workforce.has_permission(actor,'team_view') and subject.supervisor_id=actor.id)
  )
$$;

create or replace function workforce.day_snapshot(p_day date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor workforce.people := workforce.require_person();
  stamp timestamptz := statement_timestamp();
  today date := (stamp at time zone 'America/Bogota')::date;
  day date := coalesce(p_day,today);
  start_at timestamptz := day::timestamp at time zone 'America/Bogota';
  end_at timestamptz := (day+1)::timestamp at time zone 'America/Bogota';
  verified boolean := coalesce(auth.jwt()->>'aal','')='aal2';
  manage_people boolean := workforce.has_permission(actor,'people_manage');
  manage_roles boolean := workforce.has_permission(actor,'roles_manage');
  view_team boolean := workforce.has_permission(actor,'team_view');
  view_team_attendance boolean := workforce.has_permission(actor,'attendance_view_team');
  view_team_tasks boolean := workforce.has_permission(actor,'tasks_view_team');
begin
  if not isfinite(day) then raise exception 'Selecciona una fecha válida.' using errcode='22023'; end if;
  return jsonb_build_object(
    'me',jsonb_build_object('id',actor.id,'full_name',actor.full_name,'job_title',actor.job_title,'area',actor.area,'access_role',actor.access_role),
    'capabilities',coalesce((select jsonb_agg(rp.permission_code order by p.sort_order)
      from workforce.role_permissions rp join workforce.permissions p on p.code=rp.permission_code
      join workforce.roles r on r.code=rp.role_code where rp.role_code=actor.access_role and r.active),'[]'::jsonb),
    'can_manage',verified and (manage_people or manage_roles or view_team or view_team_attendance or view_team_tasks
      or workforce.has_permission(actor,'tasks_assign') or workforce.has_permission(actor,'tasks_cancel')),
    'day',day,'today',today,'server_now',stamp,
    'roles',coalesce((select jsonb_agg(jsonb_build_object(
      'code',r.code,'name',r.name,'description',r.description,'system',r.system,'active',r.active,
      'permissions',coalesce((select jsonb_agg(rp.permission_code order by p.sort_order)
        from workforce.role_permissions rp join workforce.permissions p on p.code=rp.permission_code where rp.role_code=r.code),'[]'::jsonb)
      ) order by case r.code when 'admin' then 0 when 'supervisor' then 1 when 'employee' then 2 else 3 end,r.name,r.code)
      from workforce.roles r where r.code=actor.access_role or (manage_people and r.active) or manage_roles),'[]'::jsonb),
    'permissions',coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order)
      from workforce.permissions p where manage_roles),'[]'::jsonb),
    'people',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'full_name',p.full_name,'job_title',p.job_title,'area',p.area,
      'access_role',p.access_role,'active',p.active,'registered',p.user_id is not null,
      'supervisor_id',p.supervisor_id,
      'identifier_hash',case when workforce.has_permission(actor,'access_manage') then p.identifier_hash end,
      'identifier_last_four',case when workforce.has_permission(actor,'access_manage') then p.identifier_last_four end
    ) order by p.active desc,p.full_name,p.id)
      from workforce.people p where verified and (
        manage_people or (view_team and p.supervisor_id=actor.id)
      )),'[]'::jsonb),
    'shifts',coalesce((select jsonb_agg(to_jsonb(s) order by s.arrived_at desc)
      from workforce.shifts s join workforce.people p on p.id=s.person_id
      where ((p.id=actor.id and workforce.has_permission(actor,'attendance_view_own'))
        or (verified and view_team_attendance and (manage_people or p.supervisor_id=actor.id)))
        and ((s.arrived_at<end_at and coalesce(s.left_at,stamp)>=start_at) or (day=today and s.left_at is null))),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(to_jsonb(t) order by t.due_at nulls last,t.created_at,t.id)
      from workforce.tasks t join workforce.people p on p.id=t.person_id
      where t.scheduled_on=day and ((p.id=actor.id and workforce.has_permission(actor,'tasks_view_own'))
        or (verified and view_team_tasks and (manage_people or p.supervisor_id=actor.id)))),'[]'::jsonb)
  );
end;
$$;

create or replace function workforce.save_person(
  p_id uuid,p_identifier_hash text,p_identifier_last_four text,p_name text,p_title text,p_area text,
  p_role text,p_supervisor uuid,p_active boolean
) returns uuid language plpgsql security definer set search_path='' as $$
declare actor workforce.people; existing workforce.people;
begin
  perform pg_advisory_xact_lock(727714,1);
  actor:=workforce.require_person();
  if not workforce.has_permission(actor,'people_manage') or coalesce(auth.jwt()->>'aal','')<>'aal2' then
    raise exception 'Se requiere autorización para administrar personas y doble factor.' using errcode='42501';
  end if;
  if p_id is null or p_role is null or p_active is null or p_identifier_hash !~ '^[0-9a-f]{64}$'
    or p_identifier_last_four !~ '^[0-9]{4}$' or not exists(
      select 1 from workforce.roles r where r.code=p_role and r.active
    ) then raise exception 'Completa los datos y selecciona un rol activo.' using errcode='22023'; end if;
  select * into existing from workforce.people where id=p_id for update;
  if actor.id=p_id and (p_role<>actor.access_role or not p_active) then
    raise exception 'Otra persona autorizada debe cambiar tu propio acceso.' using errcode='22023';
  end if;
  if actor.access_role<>'admin' and (p_role='admin' or existing.access_role='admin') then
    raise exception 'Solo un administrador puede modificar administradores.' using errcode='42501';
  end if;
  if existing.access_role='admin' and (p_role<>'admin' or not p_active) and not exists(
    select 1 from workforce.people p where p.id<>p_id and p.active and p.access_role='admin'
  ) then raise exception 'Equipo requiere por lo menos un administrador activo.' using errcode='22023'; end if;
  if existing.user_id is not null and existing.identifier_hash<>p_identifier_hash then
    raise exception 'La cédula de una cuenta vinculada no se puede cambiar.' using errcode='22023';
  end if;
  if (not p_active or not exists(select 1 from workforce.role_permissions rp where rp.role_code=p_role and rp.permission_code='team_view'))
    and exists(select 1 from workforce.people p where p.supervisor_id=p_id and p.active) then
    raise exception 'Reasigna primero a las personas de este equipo.' using errcode='22023';
  end if;
  if p_supervisor is not null and (p_supervisor=p_id or not exists(
    select 1 from workforce.people p join workforce.role_permissions rp on rp.role_code=p.access_role
    where p.id=p_supervisor and p.active and rp.permission_code='team_view'
  )) then raise exception 'Selecciona una persona activa con permiso para coordinar.' using errcode='22023'; end if;
  if not p_active and exists(select 1 from workforce.shifts where person_id=p_id and left_at is null) then
    raise exception 'La persona debe registrar la salida antes de desactivar su acceso.' using errcode='22023'; end if;
  insert into workforce.people(id,email,identifier_hash,identifier_last_four,full_name,job_title,area,access_role,supervisor_id,active)
    values(p_id,null,p_identifier_hash,p_identifier_last_four,btrim(p_name),btrim(p_title),btrim(p_area),p_role,p_supervisor,p_active)
  on conflict(id) do update set identifier_hash=excluded.identifier_hash,identifier_last_four=excluded.identifier_last_four,
    full_name=excluded.full_name,job_title=excluded.job_title,area=excluded.area,access_role=excluded.access_role,
    supervisor_id=excluded.supervisor_id,active=excluded.active;
  return p_id;
end;
$$;

create or replace function workforce.mark_shift(p_action text,p_id uuid) returns workforce.shifts
language plpgsql security definer set search_path='' as $$
declare actor workforce.people:=workforce.require_person(); shift workforce.shifts;
begin
  if not workforce.has_permission(actor,'attendance_mark') then
    raise exception 'Tu rol no permite registrar asistencia.' using errcode='42501'; end if;
  perform 1 from workforce.people where id=actor.id and active for update;
  if not found then raise exception 'Tu acceso está inactivo.' using errcode='42501'; end if;
  if p_action='arrival' then
    select s.* into shift from workforce.arrival_requests r join workforce.shifts s on s.id=r.shift_id
      where r.request_id=p_id and r.person_id=actor.id;
    if found then return shift; end if;
    select * into shift from workforce.shifts where person_id=actor.id and left_at is null;
    if not found then insert into workforce.shifts(id,person_id,arrived_at)
      values(gen_random_uuid(),actor.id,clock_timestamp()) returning * into shift; end if;
    insert into workforce.arrival_requests(person_id,request_id,shift_id) values(actor.id,p_id,shift.id);
  elsif p_action='departure' then
    update workforce.shifts set left_at=greatest(arrived_at,clock_timestamp())
      where id=p_id and person_id=actor.id and left_at is null returning * into shift;
    if not found then select * into shift from workforce.shifts where id=p_id and person_id=actor.id; end if;
    if shift.id is null then raise exception 'La jornada no está disponible.' using errcode='42501'; end if;
  else raise exception 'Marcación inválida.' using errcode='22023'; end if;
  return shift;
end;
$$;

create or replace function workforce.assign_task(p_id uuid,p_person uuid,p_day date,p_time time,p_title text,p_details text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor workforce.people; subject workforce.people; existing workforce.tasks; previous workforce.people;
begin
  perform pg_advisory_xact_lock(727714,1);
  actor:=workforce.require_person();
  if coalesce(auth.jwt()->>'aal','')<>'aal2' or not workforce.has_permission(actor,'tasks_assign') then
    raise exception 'Tu rol no permite programar tareas o falta doble factor.' using errcode='42501'; end if;
  select * into subject from workforce.people where id=p_person and active;
  if subject.id is null or not (actor.access_role='admin' or subject.supervisor_id=actor.id) then
    raise exception 'Solo puedes asignar tareas dentro de tu equipo.' using errcode='42501'; end if;
  if p_day is null or not isfinite(p_day) then raise exception 'Selecciona una fecha válida.' using errcode='22023'; end if;
  select * into existing from workforce.tasks where id=p_id for update;
  if found then
    select * into previous from workforce.people where id=existing.person_id;
    if not (actor.access_role='admin' or previous.supervisor_id=actor.id) then
      raise exception 'Solo puedes editar tareas dentro de tu equipo.' using errcode='42501'; end if;
    if existing.status<>'pending' then raise exception 'Solo puedes reprogramar una tarea pendiente.' using errcode='22023'; end if;
    update workforce.tasks set person_id=subject.id,scheduled_on=p_day,due_at=p_time,
      title=btrim(p_title),details=btrim(coalesce(p_details,'')),updated_at=clock_timestamp() where id=p_id;
  else insert into workforce.tasks(id,person_id,assigned_by,scheduled_on,due_at,title,details)
    values(p_id,subject.id,actor.id,p_day,p_time,btrim(p_title),btrim(coalesce(p_details,''))); end if;
  return p_id;
end;
$$;

create or replace function workforce.set_task_status(p_id uuid,p_status text) returns void
language plpgsql security definer set search_path='' as $$
declare actor workforce.people; task workforce.tasks; subject workforce.people;
begin
  perform pg_advisory_xact_lock(727714,1);
  actor:=workforce.require_person();
  select * into task from workforce.tasks where id=p_id for update;
  select * into subject from workforce.people where id=task.person_id;
  if task.id is null or p_status is null or not (
    (p_status='cancelled' and coalesce(auth.jwt()->>'aal','')='aal2'
      and workforce.has_permission(actor,'tasks_cancel') and (actor.access_role='admin' or subject.supervisor_id=actor.id))
    or (task.person_id=actor.id and p_status in ('in_progress','done') and workforce.has_permission(actor,'tasks_update_own'))
  ) then raise exception 'No puedes cambiar esta tarea.' using errcode='42501'; end if;
  if task.status=p_status then return; end if;
  if task.status in ('done','cancelled') then raise exception 'Esta tarea ya está cerrada.' using errcode='22023'; end if;
  update workforce.tasks set status=p_status,updated_at=clock_timestamp(),
    completed_at=case when p_status='done' then clock_timestamp() end where id=p_id;
end;
$$;

create or replace function workforce.invite_target(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor workforce.people:=workforce.require_person(); target workforce.people;
begin
  if not workforce.has_permission(actor,'access_manage') or coalesce(auth.jwt()->>'aal','')<>'aal2' then
    raise exception 'Se requiere autorización de accesos y doble factor.' using errcode='42501'; end if;
  select * into target from workforce.people where id=p_id and active;
  if target.id is null then raise exception 'La persona no tiene acceso activo.' using errcode='22023'; end if;
  return jsonb_build_object('identifier_hash',target.identifier_hash,'registered',target.user_id is not null);
end;
$$;

create function workforce.save_role(p_code text,p_name text,p_description text,p_permissions text[],p_active boolean)
returns text language plpgsql security definer set search_path='' as $$
declare actor workforce.people; existing workforce.roles; normalized text:=lower(btrim(p_code));
begin
  perform pg_advisory_xact_lock(727714,3);
  actor:=workforce.require_person();
  if not workforce.has_permission(actor,'roles_manage') or coalesce(auth.jwt()->>'aal','')<>'aal2' then
    raise exception 'Se requiere autorización para administrar roles y doble factor.' using errcode='42501'; end if;
  if normalized='admin' then raise exception 'El rol Administrador está protegido.' using errcode='22023'; end if;
  if normalized !~ '^[a-z][a-z0-9_]{1,31}$' or length(btrim(p_name)) not between 2 and 60
    or length(btrim(p_description)) not between 2 and 240 or p_active is null or p_permissions is null
    or exists(select 1 from unnest(p_permissions) x where not exists(select 1 from workforce.permissions p where p.code=x)) then
    raise exception 'Revisa el nombre, la descripción y los permisos del rol.' using errcode='22023'; end if;
  select * into existing from workforce.roles where code=normalized for update;
  if existing.system and normalized in ('supervisor','employee') and not p_active then
    raise exception 'Los roles base no se pueden desactivar.' using errcode='22023'; end if;
  if not p_active and exists(select 1 from workforce.people where access_role=normalized and active) then
    raise exception 'Reasigna primero a las personas que usan este rol.' using errcode='22023'; end if;
  insert into workforce.roles(code,name,description,system,active)
    values(normalized,btrim(p_name),btrim(p_description),false,p_active)
  on conflict(code) do update set name=excluded.name,description=excluded.description,
    active=excluded.active,updated_at=clock_timestamp();
  delete from workforce.role_permissions where role_code=normalized;
  insert into workforce.role_permissions(role_code,permission_code)
    select normalized,x from (select distinct unnest(p_permissions) x) selected;
  return normalized;
end;
$$;

create function public.workforce_save_role(p_code text,p_name text,p_description text,p_permissions text[],p_active boolean)
returns text language sql security invoker set search_path='' as $$
  select workforce.save_role(p_code,p_name,p_description,p_permissions,p_active)
$$;

revoke execute on function workforce.has_permission(workforce.people,text),
  workforce.save_role(text,text,text,text[],boolean) from public,anon,authenticated;
grant execute on function workforce.save_person(uuid,text,text,text,text,text,text,uuid,boolean),
  workforce.invite_target(uuid),workforce.bootstrap_admin(text,text,text,text,text),
  workforce.save_role(text,text,text,text[],boolean) to authenticated;
revoke all on function public.workforce_save_role(text,text,text,text[],boolean) from public,anon;
grant execute on function public.workforce_save_role(text,text,text,text[],boolean) to authenticated;
