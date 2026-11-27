create table workforce.public_preview (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null, changed_by uuid references workforce.people, changed_at timestamptz not null default statement_timestamp()
);
alter table workforce.public_preview enable row level security;
revoke all on workforce.public_preview from public,anon,authenticated;
insert into workforce.public_preview(singleton,enabled) values(true,true);

-- The public getter only returns the on/off switch. Workforce tables stay private.
create function jornada.preview_enabled() returns boolean language sql stable security definer set search_path=''
as $$ select enabled from workforce.public_preview where singleton $$;
create function public.workforce_preview_enabled() returns boolean language sql stable security invoker set search_path=''
as $$ select jornada.preview_enabled() $$;
revoke all on function jornada.preview_enabled(),public.workforce_preview_enabled() from public,anon,authenticated;
grant execute on function jornada.preview_enabled(),public.workforce_preview_enabled() to anon,authenticated;

create function workforce.set_preview(p_enabled boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare actor workforce.people:=workforce.require_person();
begin
 if p_enabled is null or actor.access_role<>'admin' or nullif(auth.jwt()->>'client_id','') is not null
   or not exists(select from plant_ops.access where person=actor.id and profile='CREADOR') then
   raise exception 'Solo la cuenta creadora puede cambiar el acceso público.' using errcode='42501'; end if;
 update workforce.public_preview set enabled=p_enabled,changed_by=actor.id,changed_at=statement_timestamp() where singleton;
 return p_enabled;
end $$;
create function public.workforce_set_preview(p_enabled boolean) returns boolean language sql security invoker set search_path=''
as $$ select workforce.set_preview(p_enabled) $$;
revoke all on function workforce.set_preview(boolean),public.workforce_set_preview(boolean) from public,anon;
grant execute on function workforce.set_preview(boolean),public.workforce_set_preview(boolean) to authenticated;
-- Credential resolution is private to the login service. The password is always
-- verified by Supabase Auth against the already linked identity.
create function workforce.login_address(p_email text) returns text
language sql stable security definer set search_path='' as $$
  with candidates as (
    select distinct u.id,u.email
    from workforce.people p join auth.users u on u.id=p.user_id
    where p.active and p.removed_at is null and u.email_confirmed_at is not null
      and (lower(u.email)=lower(btrim(p_email)) or lower(p.contact_email)=lower(btrim(p_email))
        or lower(p.email)=lower(btrim(p_email)))
  )
  select case when count(*)=1 then min(email) end from candidates
$$;
create function public.workforce_login_address(p_email text) returns text
language sql security invoker set search_path='' as $$ select workforce.login_address(p_email) $$;
revoke all on function workforce.login_address(text),public.workforce_login_address(text) from public,anon,authenticated;
grant execute on function workforce.login_address(text),public.workforce_login_address(text) to service_role;

create function workforce.my_account() returns jsonb
language plpgsql security definer set search_path='' as $$
declare p workforce.people:=workforce.require_person();
begin
  if nullif(auth.jwt()->>'client_id','') is not null then raise exception 'Utiliza tu sesión personal.' using errcode='42501'; end if;
  return jsonb_build_object('name',p.full_name,'contact',coalesce(p.contact_email,p.email),
    'preview_enabled',jornada.preview_enabled(),'last_four',p.identifier_last_four,'role',p.access_role,
    'creator',exists(select from plant_ops.access a where a.person=p.id and a.profile='CREADOR'));
end $$;
create function public.workforce_my_account() returns jsonb language sql security invoker set search_path=''
as $$ select workforce.my_account() $$;
revoke all on function workforce.my_account(),public.workforce_my_account() from public,anon;
grant execute on function workforce.my_account(),public.workforce_my_account() to authenticated;

-- Only directory administration and personal credentials are independent of a shift.
-- Existing RPCs still check each role and permission before reading or writing.
create or replace function jornada.check_request() returns void language plpgsql security invoker set search_path='' as $$
declare path text:=current_setting('request.path',true);
begin
 if current_user<>'authenticated' then return; end if;
 if path='/rpc/workforce_preview_enabled' then return; end if;
 if path in ('/rpc/workforce_set_preview','/rpc/jornada_access','/rpc/jornada_snapshot','/rpc/jornada_command','/rpc/jornada_history','/rpc/jornada_control',
   '/rpc/workforce_my_account','/rpc/workforce_save_person','/rpc/workforce_save_role','/rpc/workforce_save_member_access',
   '/rpc/workforce_invite_target','/rpc/workforce_remove_person','/rpc/workforce_save_availability') then
   if nullif(auth.jwt()->>'client_id','') is not null then raise exception 'Usa tu sesión personal.' using errcode='42501'; end if;
   return;
 end if;
 if path='/rpc/workforce_day' and nullif(auth.jwt()->>'client_id','') is null then
   if (jornada.entry()->'capabilities') ?| array['access_manage','people_manage','roles_manage'] then return; end if;
 end if;
 if path in ('/rpc/workforce_bootstrap_admin','/rpc/workforce_bootstrap_available') then return; end if;
 if not jornada.self_ready() then raise exception 'Abre Mi jornada y confirma tu plan antes de entrar.' using errcode='42501'; end if;
end $$;

create or replace function workforce.invite_target(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor workforce.people:=workforce.require_person(); target workforce.people;
begin
 if not workforce.has_permission(actor,'access_manage') then raise exception 'Se requiere autorización para administrar accesos.' using errcode='42501'; end if;
 select * into target from workforce.people where id=p_id and active and removed_at is null;
 if target.id is null then raise exception 'La persona no tiene acceso activo.' using errcode='22023'; end if;
 if target.id<>actor.id and exists(select from plant_ops.access a where a.person=target.id and a.profile='CREADOR') then
   raise exception 'La cuenta creadora administra sus propias credenciales.' using errcode='42501'; end if;
 return jsonb_build_object('identifier_hash',target.identifier_hash,'registered',target.user_id is not null);
end $$;
notify pgrst,'reload schema';
