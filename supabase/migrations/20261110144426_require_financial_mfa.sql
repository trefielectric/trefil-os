-- Financial data requires verified second factor on every read and mutation.
-- Membership is still read from PostgreSQL, not copied from editable JWT metadata.
create or replace function private.has_access(p_org uuid,p_location uuid default null,p_roles text[] default null)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and coalesce(auth.jwt()->>'aal','')='aal2' and exists (
  select 1 from public.organization_members m join public.profiles p on p.id=m.user_id
  where m.organization_id=p_org and m.user_id=auth.uid() and m.active and p.active
  and (p_roles is null or m.role_code=any(p_roles))
  and (p_location is null or m.all_locations or p_location=any(m.location_ids))
 )
$$;
revoke all on function private.has_access(uuid,uuid,text[]) from public,anon,authenticated;
grant execute on function private.has_access(uuid,uuid,text[]) to authenticated;
