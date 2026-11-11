-- Operator only. Run once after the designated administrator personally creates
-- their Supabase Auth identity. Supply that verified identity's work email,
-- display name and actual job title. Never put a password here.
do $$
declare
  operator_email text := 'reemplazar@example.invalid';
  operator_name text := 'Reemplazar nombre';
  operator_title text := 'Reemplazar cargo';
  operator_area text := 'Administración';
  operator_id uuid;
begin
  select id into strict operator_id from auth.users
  where lower(email)=lower(btrim(operator_email)) and email_confirmed_at is not null;

  perform pg_advisory_xact_lock(727714, 1);
  if exists(select 1 from workforce.people where access_role='admin' and active) then
    raise exception 'Equipo ya tiene un administrador activo.';
  end if;

  insert into workforce.people(user_id,email,full_name,job_title,area,access_role)
    values(operator_id,lower(btrim(operator_email)),btrim(operator_name),btrim(operator_title),btrim(operator_area),'admin');
end;
$$;
