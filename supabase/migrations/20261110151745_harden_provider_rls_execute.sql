-- Restrict ordinary API-role EXECUTE on the existing Supabase auto-RLS function.
-- Preserve the function body, owner, SECURITY DEFINER, search_path and event trigger.
-- A local database without the provider helper needs no change.
do $$
declare target oid;
begin
 target:=to_regprocedure('public.rls_auto_enable()');
 if target is null then return;end if;
 if not exists(select 1 from pg_proc where oid=target and prorettype='pg_catalog.event_trigger'::regtype and prosecdef)
 or not exists(select 1 from pg_event_trigger where evtfoid=target and evtenabled in ('O','A')) then
  raise exception 'rls_auto_enable no coincide con el evento de seguridad esperado; no se modificaron permisos';
 end if;
 revoke execute on function public.rls_auto_enable() from public,anon,authenticated;
end $$;
