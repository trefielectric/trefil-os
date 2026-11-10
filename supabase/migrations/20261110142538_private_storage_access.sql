-- Bucket creation is an operator step through Storage API/dashboard, not SQL writes
-- into Supabase-managed schemas. Bucket must be private, max 10 MB, PDF/JPEG/PNG.
create function private.support_path_access(p_bucket text,p_path text,p_write boolean default false)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare org uuid;loc uuid;parts text[];
begin
 if auth.uid() is null or p_bucket<>'financial-supports' or p_path is null then return false;end if;
 parts:=string_to_array(p_path,'/');
 if cardinality(parts)<>4 or parts[1] !~ '^[a-f0-9-]{36}$' or parts[2] !~ '^[a-f0-9-]{36}$'
 or parts[3] !~ '^[a-f0-9-]{36}$' or parts[4] !~ '^[A-Za-z0-9_-]+\.(pdf|png|jpg|jpeg)$' then return false;end if;
 begin org:=parts[1]::uuid;loc:=parts[2]::uuid;exception when invalid_text_representation then return false;end;
 return private.has_access(org,loc,case when p_write then array['owner','admin','treasury','accounting'] else array['owner','admin','treasury','accounting','auditor'] end);
end $$;
revoke all on function private.support_path_access(text,text,boolean) from public,anon,authenticated;
grant execute on function private.support_path_access(text,text,boolean) to authenticated;
create policy trefil_private_support_read on storage.objects for select to authenticated
 using(private.support_path_access(bucket_id,name,false));
create policy trefil_private_support_insert on storage.objects for insert to authenticated
 with check(private.support_path_access(bucket_id,name,true));
-- No UPDATE/DELETE policy: supports are append-only, never upserted or overwritten.

create function private.register_financial_support(p_organization_id uuid,p_location_id uuid,p_object_path text,p_name text,p_mime_type text,p_size_bytes bigint,p_sha256 text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid;id uuid;
begin
 actor:=private.require_access(p_organization_id,p_location_id,array['owner','admin','treasury','accounting']);
 if not private.support_path_access('financial-supports',p_object_path,true)
 or split_part(p_object_path,'/',1)<>p_organization_id::text or split_part(p_object_path,'/',2)<>p_location_id::text
 or not exists(select 1 from storage.objects where bucket_id='financial-supports' and name=p_object_path) then
  raise exception 'Soporte no cargado o fuera de la sede' using errcode='42501';
 end if;
 insert into public.attachments(organization_id,location_id,object_path,name,mime_type,size_bytes,sha256,uploaded_by)
 values(p_organization_id,p_location_id,p_object_path,p_name,p_mime_type,p_size_bytes,p_sha256,actor) returning attachments.id into id;
 return id;
end $$;
create function public.register_financial_support(p_organization_id uuid,p_location_id uuid,p_object_path text,p_name text,p_mime_type text,p_size_bytes bigint,p_sha256 text)
returns uuid language sql security invoker set search_path='' as $$select private.register_financial_support(p_organization_id,p_location_id,p_object_path,p_name,p_mime_type,p_size_bytes,p_sha256)$$;
revoke all on function public.register_financial_support(uuid,uuid,text,text,text,bigint,text) from public,anon,authenticated;
revoke all on function private.register_financial_support(uuid,uuid,text,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.register_financial_support(uuid,uuid,text,text,text,bigint,text) to authenticated;
grant execute on function private.register_financial_support(uuid,uuid,text,text,text,bigint,text) to authenticated;
