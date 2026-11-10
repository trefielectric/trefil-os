-- OPERATOR ONLY, after security confirmation and invitation/verified email in Auth.
-- Not a migration and never called by the browser. Contains no password or user key.
-- Execute once against the selected, isolated Trefil OS project using SQL Editor.
begin;
do $$
declare owner_id uuid;org uuid;loc uuid;matches integer;
begin
 select count(*),min(id::text)::uuid into matches,owner_id from auth.users
 where lower(email)='administracion@trefielectric.onmicrosoft.com' and email_confirmed_at is not null;
 if matches<>1 then raise exception 'Requiere exactamente un usuario institucional con correo verificado';end if;
 if exists(select 1 from public.organizations) then raise exception 'La base ya contiene una empresa; revisar manualmente para evitar duplicados';end if;
 insert into public.profiles(id,display_name) values(owner_id,'Administración institucional Trefil Electric');
 insert into public.organizations(name,slug) values('Trefil Electric','trefielectric') returning id into org;
 insert into public.locations(organization_id,name) values(org,'Sede principal') returning id into loc;
 insert into public.organization_members(organization_id,user_id,role_code,all_locations) values(org,owner_id,'owner',true);
 insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,reason,source)
 values(org,owner_id,'bootstrap','organization',org::text,'Cuenta institucional verificada e invitada por operador','operator');
 -- Zero balances only. Opening amounts must be new balanced, approved journals.
 insert into public.accounts(organization_id,location_id,name,kind,ledger_class,custodian,created_by,source) values
 (org,loc,'Patrimonio inicial','ledger','equity','Contabilidad',owner_id,'operator'),
 (org,loc,'Ingresos operacionales','ledger','income','Contabilidad',owner_id,'operator'),
 (org,loc,'Gastos operacionales','ledger','expense','Contabilidad',owner_id,'operator'),
 (org,loc,'Obligaciones financieras','ledger','liability','Contabilidad',owner_id,'operator'),
 (org,loc,'Intereses financieros','ledger','expense','Contabilidad',owner_id,'operator'),
 (org,loc,'Anticipos a empleados','ledger','asset','Contabilidad',owner_id,'operator'),
 (org,loc,'Préstamos a empleados','ledger','asset','Contabilidad',owner_id,'operator');
end $$;
commit;
