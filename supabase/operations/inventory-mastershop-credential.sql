-- Provider-specific infrastructure, installed after inventory-feeds.sql.
-- An authorized administrator may set the private credential, never read it.
create or replace function inventory_hub.can_configure() returns boolean
language plpgsql stable security definer set search_path='' as $$
declare actor workforce.people:=workforce.require_person();
begin
  return actor.access_role='admin' and workforce.has_permission(actor,'integrations_manage');
end $$;
create or replace function inventory_hub.connect_mastershop(p_credential text) returns integer
language plpgsql security definer set search_path='' as $$
declare secret_id uuid; original_id text; imported integer; previous_evidence text;
begin
  if not inventory_hub.can_configure() then
    raise exception 'Solo un administrador de integraciones puede conectar la tienda.' using errcode='42501';
  end if;
  p_credential:=btrim(p_credential);
  if p_credential is null or length(p_credential) not between 8 and 1024 or p_credential ~ '[[:space:][:cntrl:]]' then
    raise exception 'Revisa la llave de Wired Colombia.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('trefil:feed:mastershop',0));
  select external_id into original_id from inventory_hub.offers where source='mastershop' and active order by external_id limit 1;
  select evidence into previous_evidence from inventory_hub.sources where source='mastershop';
  select id into secret_id from vault.secrets where name='mastershop_wired_api_key';
  if secret_id is null then
    perform vault.create_secret(p_credential,'mastershop_wired_api_key','Credencial de inventario de Wired Colombia');
  else
    perform vault.update_secret(secret_id,p_credential);
  end if;
  imported:=inventory_hub.refresh_mastershop();
  if imported is null then
    raise exception 'Mastershop no validó la lectura. Revisa la llave de la tienda y vuelve a intentar.';
  end if;
  if previous_evidence='panel' and original_id is not null and not exists(
    select 1 from inventory_hub.offers where source='mastershop' and active and external_id=original_id
  ) then
    raise exception 'La cuenta no coincide con el catálogo observado de Wired Colombia.';
  end if;
  return imported;
end $$;
create or replace function public.central_inventory_can_configure() returns boolean
language sql stable security invoker set search_path='' as $$ select inventory_hub.can_configure() $$;
create or replace function public.central_inventory_connect_mastershop(p_credential text) returns integer
language sql security invoker set search_path='' as $$ select inventory_hub.connect_mastershop(p_credential) $$;
revoke all on function inventory_hub.can_configure(),inventory_hub.connect_mastershop(text),
  public.central_inventory_can_configure(),public.central_inventory_connect_mastershop(text) from public,anon,authenticated;
grant execute on function inventory_hub.can_configure(),inventory_hub.connect_mastershop(text),
  public.central_inventory_can_configure(),public.central_inventory_connect_mastershop(text) to authenticated;
notify pgrst,'reload schema';
