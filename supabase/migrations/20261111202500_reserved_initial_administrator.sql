-- Reserve the one-time bootstrap for the owner profile requested for Trefil OS.
-- Authentication remains cedula-based; the email is stored only as contact data.
create or replace function workforce.bootstrap_admin(
  p_hash text,p_last_four text,p_name text,p_title text,p_area text
) returns uuid language plpgsql security definer set search_path='' as $$
declare created uuid; auth_email text;
begin
  perform pg_advisory_xact_lock(727714,2);
  if auth.uid() is null or p_hash !~ '^[0-9a-f]{64}$' or p_last_four !~ '^[0-9]{4}$'
    or p_name is distinct from 'Federico Velásquez Perdomo'
    or p_title is distinct from 'Administrador general'
    or p_area is distinct from 'Administración' then
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
  insert into workforce.people(
    user_id,email,identifier_hash,identifier_last_four,
    full_name,job_title,area,access_role,active
  ) values (
    auth.uid(),'fevepe1510@gmail.com',p_hash,p_last_four,
    'Federico Velásquez Perdomo','Administrador general','Administración','admin',true
  ) returning id into created;
  return created;
end;
$$;
