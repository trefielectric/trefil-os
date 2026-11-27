-- Módulo 00. All business dates use the company's timezone.
create schema jornada;
revoke all on schema jornada from public, anon, authenticated;
grant usage on schema jornada to authenticated;
alter default privileges in schema jornada revoke execute on functions from public;
alter table workforce.shifts add column reviewed_at timestamptz, add column plan jsonb,
  add column closed_summary jsonb, add column scheduled_start timestamptz, add column scheduled_end timestamptz;
alter table workforce.tasks add column estimate_minutes integer check(estimate_minutes between 1 and 525600),
  add column deadline date;
create table jornada.intervals (
  id bigint generated always as identity primary key, task uuid not null references workforce.tasks,
  shift uuid not null references workforce.shifts, started timestamptz not null, stopped timestamptz check(stopped>=started)
);
create unique index jornada_running on jornada.intervals(task) where stopped is null;
create index jornada_intervals_shift on jornada.intervals(shift);
create index jornada_intervals_task on jornada.intervals(task);
create table jornada.events (
  id bigint generated always as identity primary key, task uuid not null references workforce.tasks,
  actor uuid references workforce.people, shift uuid references workforce.shifts,
  at_time timestamptz not null default statement_timestamp(), action text not null, detail jsonb not null
);
create index jornada_events_task on jornada.events(task,id);
create table jornada.absences (
  person uuid not null references workforce.people, day date not null, kind text not null check(kind in ('Vacaciones','Permiso','Día no laborable')),
  approved_by uuid not null references workforce.people, recorded timestamptz not null default statement_timestamp(), primary key(person,day)
);
create table jornada.alerts (
  person uuid not null references workforce.people, day date not null, kind text not null check(kind in ('apertura','cierre')),
  scheduled timestamptz not null, triggered timestamptz not null, resolved timestamptz, primary key(person,day,kind)
);
create table jornada.alert_reads (
 person uuid not null, day date not null, kind text not null, reader uuid not null references workforce.people,
 read_at timestamptz not null default statement_timestamp(), primary key(person,day,kind,reader),
 foreign key(person,day,kind) references jornada.alerts(person,day,kind)
);
create table jornada.monitor (singleton boolean primary key default true check(singleton), launch timestamptz not null, last_day date not null);
insert into jornada.monitor values(true,statement_timestamp(),(statement_timestamp() at time zone 'America/Bogota')::date);
create function jornada.day_of(t timestamptz) returns date language sql immutable strict set search_path='' as $$
  select (t at time zone 'America/Bogota')::date
$$;
create function jornada.schedule(p uuid,d date) returns table(starts timestamptz, ends timestamptz)
language sql stable set search_path='' as $$
  select (d+min(start_time)) at time zone 'America/Bogota',(d+max(end_time)) at time zone 'America/Bogota'
  from workforce.availability where person_id=p and active and weekday=extract(isodow from d)
    and not exists(select from jornada.absences where person=p and day=d)
$$;
create function jornada.ready(p uuid) returns boolean language sql stable set search_path='' as $$
  select exists(select from workforce.shifts where person_id=p and left_at is null and reviewed_at is not null
    and jornada.day_of(arrived_at)=jornada.day_of(statement_timestamp()))
$$;
create function jornada.leader(p uuid) returns boolean language sql stable set search_path='' as $$
  select exists(select from plant_ops.access where person=p and profile in ('CREADOR','GERENTE'))
$$;
create function jornada.scope(a workforce.people, p workforce.people, capability text) returns boolean
language sql stable set search_path='' as $$
 select (capability<>'people_manage' and jornada.leader(a.id)) or
   (workforce.has_permission(a,capability) and (a.access_role='admin' or p.supervisor_id is not distinct from a.id or p.id=a.id))
$$;
create function jornada.trace_task() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid; sid uuid;
begin
  select id into actor from workforce.people where user_id=auth.uid();
  select id into sid from workforce.shifts where person_id=new.person_id and left_at is null;
  if tg_op='UPDATE' and new.status='cancelled' and old.status<>'cancelled' and actor=old.person_id and actor<>old.assigned_by then
    raise exception 'Una tarea asignada debe conservarse para el seguimiento.' using errcode='42501'; end if;
  if tg_op='UPDATE' and (new.status in ('done','cancelled') or new.person_id<>old.person_id) then
    update jornada.intervals set stopped=greatest(started,statement_timestamp()) where task=new.id and stopped is null;
  end if;
  insert into jornada.events(task,actor,shift,action,detail)
  values(new.id,coalesce(actor,new.assigned_by),sid,case tg_op when 'INSERT' then 'Creación' else 'Cambio' end,
    jsonb_build_object('antes',case when tg_op='UPDATE' then to_jsonb(old) end,'despues',to_jsonb(new)));
  return new;
end $$;
create trigger jornada_task_trace after insert or update on workforce.tasks for each row execute function jornada.trace_task();

create function jornada.tasks_for(p uuid,s workforce.shifts,d date) returns setof jsonb
language sql stable set search_path='' as $$
 select to_jsonb(t)||jsonb_build_object('creator',c.full_name,'owner',o.full_name,
   'due_day',coalesce(t.deadline,case when t.due_at is not null then t.scheduled_on end),
   'seconds',r.total,'shift_seconds',r.portion,'running',r.running,
   'over',coalesce(r.total>60*t.estimate_minutes,false),
   'carried',t.scheduled_on<d or exists(select from workforce.shifts past where past.person_id=p
      and past.id is distinct from s.id and past.closed_summary->'tasks' ? t.id::text))
 from workforce.tasks t join workforce.people c on c.id=t.assigned_by join workforce.people o on o.id=t.person_id
 cross join lateral (select coalesce(sum(extract(epoch from (coalesce(i.stopped,statement_timestamp())-i.started))),0) total,
    coalesce(sum(extract(epoch from (coalesce(i.stopped,statement_timestamp())-i.started))) filter(where i.shift=s.id),0) portion,
    coalesce(bool_or(i.stopped is null),false) running from jornada.intervals i where i.task=t.id) r
 where t.person_id=p and t.scheduled_on<=d and t.status<>'cancelled' and
 (t.status<>'done' or s.id is not null and t.completed_at>=s.arrived_at and t.completed_at<=coalesce(s.left_at,statement_timestamp()))
 order by t.scheduled_on,t.created_at,t.id
$$;
create function jornada.refresh_alerts() returns void language plpgsql security definer set search_path='' as $$
declare checkpoint jornada.monitor; today date:=jornada.day_of(statement_timestamp());
begin
 select * into checkpoint from jornada.monitor where singleton for update;
 with days as (select checkpoint.last_day-1+i d from generate_series(0,today-checkpoint.last_day+1) i),
 planned as (
   select p.id,d,coalesce(min(s.scheduled_start),min(sc.starts)) starts,coalesce(max(s.scheduled_end),max(sc.ends)) ends,
     min(s.arrived_at) arrived,case when bool_or(s.id is not null and s.left_at is null) then null else max(s.left_at) end departed
   from days cross join workforce.people p cross join lateral jornada.schedule(p.id,d) sc
   left join workforce.shifts s on s.person_id=p.id and s.arrived_at>=d::timestamp at time zone 'America/Bogota'
     and s.arrived_at<(d+1)::timestamp at time zone 'America/Bogota'
   where p.active and p.user_id is not null and not exists(select from jornada.absences x where x.day=d and x.person=p.id)
   group by p.id,d
 ), incidents as (
   select id,d,v.* from planned cross join lateral(values
     ('apertura',starts,arrived,true),('cierre',ends,departed,exists(select from workforce.shifts w
         where w.person_id=planned.id and jornada.day_of(w.arrived_at)=planned.d and w.arrived_at<=ends+interval '15 minutes'
           and (w.left_at is null or w.left_at>=ends+interval '15 minutes')))) v(kind,scheduled,actual,applicable)
 )
 insert into jornada.alerts(person,day,kind,scheduled,triggered,resolved)
 select id,d,kind,scheduled,scheduled+interval '15 minutes',actual from incidents
 where applicable and scheduled+interval '15 minutes' between checkpoint.launch and statement_timestamp()
   and (actual is null or actual>=scheduled+interval '15 minutes')
 on conflict(person,day,kind) do update set resolved=coalesce(jornada.alerts.resolved,excluded.resolved)
 where jornada.alerts.resolved is null and excluded.resolved is not null;
 update jornada.monitor set last_day=today where singleton and last_day<>today;
end $$;

create function jornada.snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare a workforce.people:=workforce.require_person(); s workforce.shifts; today date:=jornada.day_of(statement_timestamp()); d date; last_shift workforce.shifts;
begin
 select * into s from workforce.shifts where person_id=a.id and left_at is null;
 select * into last_shift from workforce.shifts where person_id=a.id and closed_summary is not null order by left_at desc limit 1;
 d:=coalesce(jornada.day_of(s.arrived_at),today);
 return jsonb_build_object('person',a.id,'name',a.full_name,'today',today,'day',d,'server_now',statement_timestamp(),'ready',jornada.ready(a.id),
 'shift',case when s.id is not null then to_jsonb(s) end,
 'schedule',(select to_jsonb(sc) from jornada.schedule(a.id,d) sc),
 'exception',(select kind from jornada.absences where person=a.id and day=d),
 'last_close',case when last_shift.id is not null then jsonb_build_object('at',last_shift.left_at,'summary',last_shift.closed_summary) end,
 'notifications',case when jornada.ready(a.id) and jornada.leader(a.id) then coalesce((select jsonb_agg(z order by z.triggered desc) from
   (select al.*,p.full_name as name from jornada.alerts al join workforce.people p on p.id=al.person
    where not exists(select from jornada.alert_reads r where (r.person,r.day,r.kind,r.reader)=(al.person,al.day,al.kind,a.id))
    order by al.triggered desc limit 100) z),'[]') else '[]'::jsonb end,
 'tasks',coalesce((select jsonb_agg(x) from jornada.tasks_for(a.id,s,d) x),'[]'),
 'targets',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name) order by p.full_name)
   from workforce.people p where p.active and (p.id=a.id or jornada.ready(a.id) and jornada.scope(a,p,'tasks_assign'))),'[]'),
 'can_control',jornada.ready(a.id) and (jornada.leader(a.id) or workforce.has_permission(a,'attendance_view_team') or workforce.has_permission(a,'tasks_view_team') or workforce.has_permission(a,'people_manage')));
end $$;
create table jornada.requests (
 person uuid not null references workforce.people, request uuid not null, action text not null, data jsonb not null,
 primary key(person,request)
);
create function jornada.command(op text, payload jsonb, request_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare
 a workforce.people; target workforce.people; s workforce.shifts; t workforce.tasks;
 stamp timestamptz; today date; d date; snapshot_tasks jsonb; x jsonb; reasons jsonb;
 unfinished text; excess text; n_done int:=0; n_progress int:=0; n_pending int:=0; results jsonb:='{}';
 confirmation jsonb; sc record; log_action text; older boolean; cached jornada.requests;
begin
 perform pg_advisory_xact_lock(727714,1);
 a:=workforce.require_person();
 perform 1 from workforce.people where id=a.id and active for update;
 if not found or payload is null or jsonb_typeof(payload)<>'object' or request_id is null then
   raise exception 'Solicitud incompleta.' using errcode='22023'; end if;
 select * into cached from jornada.requests where person=a.id and request=request_id;
 if found then
   if cached.action=op and cached.data=payload then return; end if;
   raise exception 'La solicitud ya fue utilizada.' using errcode='22023';
 end if;
 stamp:=clock_timestamp(); today:=jornada.day_of(stamp);
 select * into s from workforce.shifts where person_id=a.id and left_at is null for update;
 d:=coalesce(jornada.day_of(s.arrived_at),today); older:=d<today;
 if op='open' then
   if s.id is not null then raise exception 'Ya tienes una jornada abierta. Revisa su estado.' using errcode='22023'; end if;
   select * into sc from jornada.schedule(a.id,today);
   insert into workforce.shifts(id,person_id,arrived_at,scheduled_start,scheduled_end)
     values(gen_random_uuid(),a.id,stamp,sc.starts,sc.ends);
   update jornada.alerts set resolved=stamp where person=a.id and day=today and kind='apertura' and resolved is null;
 elsif op='read_alert' then
   if not jornada.ready(a.id) or not jornada.leader(a.id) then raise exception 'Sin acceso a esta alerta.' using errcode='42501'; end if;
   insert into jornada.alert_reads(person,day,kind,reader)
     values((payload->>'person')::uuid,(payload->>'day')::date,payload->>'kind',a.id) on conflict do nothing;
 elsif op='absence' then
   select * into target from workforce.people where id=(payload->>'person')::uuid and active;
   if not jornada.ready(a.id) or target.id is null or not jornada.scope(a,target,'people_manage') then
     raise exception 'Sin permiso para programar esta excepción.' using errcode='42501'; end if;
   if (payload->>'day')::date<today then raise exception 'Las excepciones se programan para hoy o una fecha futura.' using errcode='22023'; end if;
   insert into jornada.absences(person,day,kind,approved_by) values(target.id,(payload->>'day')::date,payload->>'kind',a.id)
     on conflict(person,day) do update set kind=excluded.kind,approved_by=a.id,recorded=stamp;
 else
   if s.id is null or s.id is distinct from (payload->>'shift')::uuid then raise exception 'Actualiza la jornada antes de continuar.' using errcode='22023'; end if;
   if older and op<>'close' then raise exception 'Primero completa el cierre de tu jornada anterior.' using errcode='22023'; end if;
   if op='task' then
     select * into target from workforce.people where id=(payload->>'person')::uuid and active;
     if target.id is null or (target.id<>a.id and (not jornada.ready(a.id) or not jornada.scope(a,target,'tasks_assign'))) then
       raise exception 'No puedes asignar esta tarea.' using errcode='42501'; end if;
     if nullif(payload->>'day','')::date<d or nullif(payload->>'deadline','')::date<coalesce(nullif(payload->>'day','')::date,d) then
     raise exception 'Revisa la fecha programada y el vencimiento.' using errcode='22023'; end if;
   insert into workforce.tasks(id,person_id,assigned_by,scheduled_on,title,details,deadline,estimate_minutes)
       values(gen_random_uuid(),target.id,a.id,coalesce(nullif(payload->>'day','')::date,d),btrim(payload->>'title'),
         btrim(coalesce(payload->>'details','')),nullif(payload->>'deadline','')::date,nullif(payload->>'estimate','')::int);
   elsif op='review' then
     select coalesce(jsonb_agg(item->>'id' order by item->>'id'),'[]') into snapshot_tasks from jornada.tasks_for(a.id,s,d) item;
     select coalesce(jsonb_agg(v order by v),'[]') into confirmation from jsonb_array_elements_text(payload->'tasks') v;
     if snapshot_tasks<>confirmation or payload->'reviewed' is distinct from 'true'::jsonb or payload->>'new_plan' is null
       or payload->>'new_plan'<>(case when exists(select from jornada.tasks_for(a.id,s,d) j where not (j->>'carried')::boolean) then 'confirmed' else 'none' end) then
       raise exception 'Actualiza los pendientes y confirma las actividades del día.' using errcode='22023'; end if;
     update workforce.shifts set reviewed_at=stamp,plan=payload-'shift' where id=s.id and reviewed_at is null;
   elsif op in ('start','pause','finish','note') then
     if not jornada.ready(a.id) then raise exception 'Confirma primero tu plan del día.' using errcode='42501'; end if;
     select * into t from workforce.tasks where id=(payload->>'task')::uuid and person_id=a.id and scheduled_on<=d for update;
     if t.id is null or t.status in ('done','cancelled') then raise exception 'Esta actividad no está disponible.' using errcode='22023'; end if;
     if op='start' then
       if not exists(select from jornada.intervals where task=t.id and stopped is null) then
         if exists(select from jornada.intervals where shift=s.id and stopped is null) then raise exception 'Pausa la actividad en curso antes de iniciar otra.' using errcode='22023'; end if;
         insert into jornada.intervals(task,shift,started) values(t.id,s.id,stamp); log_action:='Inicio de intervalo';
       end if;
       update workforce.tasks set status='in_progress',updated_at=stamp where id=t.id and status='pending';
     elsif op='pause' then
       update jornada.intervals set stopped=stamp where task=t.id and shift=s.id and stopped is null;
       if found then log_action:='Pausa'; end if;
     elsif op='finish' then
       update workforce.tasks set status='done',completed_at=stamp,updated_at=stamp where id=t.id;
     else
       if nullif(btrim(payload->>'note'),'') is null or length(payload->>'note')>1500 then raise exception 'Escribe un avance de hasta 1500 caracteres.' using errcode='22023'; end if;
       log_action:='Avance';
     end if;
     if log_action is not null then insert into jornada.events(task,shift,actor,action,detail) values(t.id,s.id,a.id,log_action,jsonb_strip_nulls(jsonb_build_object('nota',payload->>'note'))); end if;
   elsif op='close' then
     if older and nullif(btrim(payload->>'late_reason'),'') is null then raise exception 'Explica el cierre de la jornada anterior.' using errcode='22023'; end if;
     -- Stop and validate in one transaction. A failed close leaves all intervals running.
     update jornada.intervals set stopped=stamp where shift=s.id and stopped is null;
     reasons:=payload->'reasons';
     for x in select * from jornada.tasks_for(a.id,s,d) loop
       unfinished:=nullif(btrim(reasons#>>array[x->>'id','unfinished']),''); excess:=nullif(btrim(reasons#>>array[x->>'id','excess']),'');
       if x->>'status'<>'done' and unfinished is null then raise exception 'Explica qué quedó pendiente en «%».',x->>'title' using errcode='22023'; end if;
       if (x->>'over')::boolean and excess is null then raise exception 'Justifica el tiempo excedido en «%».',x->>'title' using errcode='22023'; end if;
       if (x->>'over')::boolean and x->>'status'<>'done' and lower(excess)=lower(unfinished) then
         raise exception 'Registra por separado el avance pendiente y el motivo del exceso en «%».',x->>'title' using errcode='22023'; end if;
       results:=results||jsonb_build_object(x->>'id',x||jsonb_build_object('unfinished',unfinished,'excess',excess));
       case x->>'status' when 'done' then n_done:=n_done+1; when 'in_progress' then n_progress:=n_progress+1; else n_pending:=n_pending+1; end case;
       insert into jornada.events(task,actor,shift,action,detail) values((x->>'id')::uuid,a.id,s.id,'Cierre de jornada',
       jsonb_build_object('estado',x->>'status','pendiente',unfinished,'exceso',excess,'segundos_jornada',x->'shift_seconds'));
     end loop;
     update workforce.shifts set left_at=stamp,closed_summary=jsonb_build_object('person',a.id,'tasks',results,'done',n_done,
       'progress',n_progress,'pending',n_pending,'unfinished',n_progress+n_pending,'late_reason',nullif(btrim(payload->>'late_reason'),'')) where id=s.id;
     update jornada.alerts set resolved=stamp where person=a.id and day=d and kind='cierre' and resolved is null;
   else raise exception 'Acción desconocida.' using errcode='22023'; end if;
 end if;
 if op in ('close','open') then perform jornada.refresh_alerts(); end if;
 insert into jornada.requests values(a.id,request_id,op,payload);
end $$;
create function jornada.control(d date) returns jsonb language plpgsql security definer set search_path='' as $$
declare a workforce.people:=workforce.require_person(); items jsonb;
begin
 if not jornada.ready(a.id) or not (jornada.leader(a.id) or workforce.has_permission(a,'attendance_view_team')
   or workforce.has_permission(a,'tasks_view_team') or workforce.has_permission(a,'people_manage')) then
   raise exception 'Sin acceso al control de usuarios.' using errcode='42501'; end if;
 if d is null or not isfinite(d) then raise exception 'Selecciona una fecha.' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'manage',rights.manage,'attendance',rights.att,
   'schedule',case when rights.att or rights.manage then to_jsonb(sc) end,'absence',case when rights.att or rights.manage then ab.kind end,
   'blocked',rights.att and exists(select from workforce.shifts prior where prior.person_id=p.id and jornada.day_of(prior.arrived_at)<d
          and (prior.left_at is null or prior.left_at>=(d+1)::timestamp at time zone 'America/Bogota')),
   'shifts',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'arrived',s.arrived_at,'left',s.left_at,'start',s.scheduled_start,
     'end',s.scheduled_end,'review',s.reviewed_at,'summary',case when rights.tasks then s.closed_summary end) order by s.arrived_at)
     from workforce.shifts s where rights.att and s.person_id=p.id and jornada.day_of(s.arrived_at)=d),'[]'),
   'alerts',coalesce((select jsonb_agg(to_jsonb(z) order by z.triggered) from jornada.alerts z where rights.att and z.person=p.id and z.day=d),'[]'),
   'tasks',case when rights.tasks then coalesce((select jsonb_agg(row_data) from (
     select distinct on (q->>'id') q row_data from (
       select entry.value q, 1 rank from workforce.shifts s cross join lateral jsonb_each(s.closed_summary->'tasks') entry
       where s.person_id=p.id and jornada.day_of(s.arrived_at)=d
       union all
       select j,2 from jornada.tasks_for(p.id,(select s from workforce.shifts s where s.person_id=p.id and s.left_at is null),d) j
       where d=jornada.day_of(statement_timestamp()) or exists(select from workforce.shifts open_shift where open_shift.person_id=p.id
          and open_shift.left_at is null and jornada.day_of(open_shift.arrived_at)=d)
     ) all_tasks order by q->>'id',rank desc,(q->>'shift_seconds')::numeric desc) selected),'[]') end
   ) order by p.full_name),'[]') into items
 from workforce.people p cross join lateral (select jornada.scope(a,p,'attendance_view_team') att,
    jornada.scope(a,p,'tasks_view_team') tasks,jornada.scope(a,p,'people_manage') manage) rights
 cross join lateral jornada.schedule(p.id,d) sc left join jornada.absences ab on ab.person=p.id and ab.day=d
 where (rights.att or rights.tasks or rights.manage) and (p.active or exists(select from workforce.shifts s where s.person_id=p.id and jornada.day_of(s.arrived_at)=d));
 return items;
end $$;
create function jornada.history(task_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a workforce.people:=workforce.require_person(); subject workforce.people;
begin
 select p.* into subject from workforce.tasks t join workforce.people p on p.id=t.person_id where t.id=task_id;
 if subject.id is null or (a.id<>subject.id and (not jornada.ready(a.id) or not jornada.scope(a,subject,'tasks_view_team'))) then
   raise exception 'Sin acceso a este historial.' using errcode='42501'; end if;
 return jsonb_build_object('events',coalesce((select jsonb_agg(jsonb_build_object('when',e.at_time,'who',p.full_name,'action',e.action,'detail',e.detail,'shift',e.shift) order by e.id)
 from jornada.events e left join workforce.people p on p.id=e.actor where e.task=task_id),'[]'),
 'intervals',coalesce((select jsonb_agg(jsonb_build_object('start',i.started,'stop',i.stopped,'shift',i.shift) order by i.id) from jornada.intervals i where i.task=task_id),'[]'));
end $$;
create function public.jornada_snapshot() returns jsonb language sql security invoker set search_path='' as $$ select jornada.snapshot() $$;
create function public.jornada_control(p_day date) returns jsonb language sql security invoker set search_path='' as $$ select jornada.control(p_day) $$;
create function public.jornada_history(p_task uuid) returns jsonb language sql security invoker set search_path='' as $$ select jornada.history(p_task) $$;
create function public.jornada_command(op text,payload jsonb,request_id uuid) returns void language sql security invoker set search_path='' as $$ select jornada.command(op,payload,request_id) $$;

create function jornada.self_ready() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select from workforce.people p where p.user_id=auth.uid() and p.active and jornada.ready(p.id))
$$;
create function jornada.entry() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('ready',jornada.ready(p.id),'capabilities',workforce.effective_permissions(p),
 'unread',case when jornada.ready(p.id) and jornada.leader(p.id) then
 (select count(*) from jornada.alerts a where not exists(select from jornada.alert_reads r where
 (r.person,r.day,r.kind,r.reader)=(a.person,a.day,a.kind,p.id))) else 0 end)
 from workforce.require_person() p
$$;
create function public.jornada_access() returns jsonb language sql stable security invoker set search_path='' as $$ select jornada.entry() $$;
create function jornada.check_request() returns void language plpgsql security invoker set search_path='' as $$
declare path text:=current_setting('request.path',true);
begin
 if current_user<>'authenticated' then return; end if;
 if path in ('/rpc/jornada_access','/rpc/jornada_snapshot','/rpc/jornada_command','/rpc/jornada_history','/rpc/jornada_control') then
   if nullif(auth.jwt()->>'client_id','') is not null then raise exception 'Usa tu sesión personal para gestionar la jornada.' using errcode='42501'; end if;
   return;
 end if;
 if path in ('/rpc/workforce_bootstrap_admin','/rpc/workforce_bootstrap_available') then return; end if;
 if not jornada.self_ready() then raise exception 'Abre Mi jornada y confirma tu plan antes de entrar.' using errcode='42501'; end if;
end $$;
alter table jornada.intervals enable row level security;
alter table jornada.events enable row level security;
alter table jornada.absences enable row level security;
alter table jornada.alerts enable row level security;
alter table jornada.alert_reads enable row level security;
alter table jornada.monitor enable row level security;
alter table jornada.requests enable row level security;
revoke all on all tables in schema jornada from public,anon,authenticated;
revoke all on all functions in schema jornada from public,anon,authenticated;
grant execute on function jornada.snapshot(),jornada.command(text,jsonb,uuid),jornada.history(uuid),jornada.control(date),
 jornada.check_request(),jornada.self_ready(),jornada.entry() to authenticated;
grant usage on schema jornada to anon,service_role;
grant execute on function jornada.check_request() to anon,service_role;
revoke all on function public.jornada_snapshot(),public.jornada_command(text,jsonb,uuid),public.jornada_history(uuid),public.jornada_access(),public.jornada_control(date) from public,anon;
grant execute on function public.jornada_snapshot(),public.jornada_command(text,jsonb,uuid),public.jornada_history(uuid),public.jornada_access(),public.jornada_control(date) to authenticated;
