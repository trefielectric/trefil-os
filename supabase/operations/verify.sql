-- Read-only operational checks, using SQL Editor/isolated restore operator.
-- This first statement returns one consolidated live summary. It never mutates data.
with expected(name) as (values
 ('submit_financial_transaction'),('decide_financial_transaction'),('create_financial_account'),
 ('reconcile_account'),('create_debt'),('record_debt_payment'),('manage_member'),
 ('resolve_alert'),('comment_alert'),('register_financial_support')
), rpc as (
 select e.name,p.oid,p.prosecdef from expected e
 left join pg_namespace n on n.nspname='public'
 left join pg_proc p on p.pronamespace=n.oid and p.proname=e.name
), provider_events as (
 select p.proname,pg_get_userbyid(p.proowner) as owner,
        pg_get_function_result(p.oid) as return_type,p.proconfig,t.evtname,t.evtenabled,
        has_function_privilege('anon',p.oid,'EXECUTE') as anonymous_execute
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 left join pg_event_trigger t on t.evtfoid=p.oid
 where n.nspname='public' and p.prosecdef
)
select
 (select count(*) from pg_tables where schemaname='public') as business_tables,
 (select bool_and(rowsecurity) from pg_tables where schemaname='public') as all_business_tables_rls,
 (select not exists(select 1 from pg_tables where schemaname='public' and has_table_privilege('anon',format('%I.%I',schemaname,tablename),'SELECT'))) as anonymous_reads_denied,
 (select count(distinct name) filter(where oid is not null) from rpc) as application_wrappers_found,
 (select count(*)=10 and bool_and(oid is not null and not prosecdef) from rpc) as application_wrappers_all_invoker,
 (select count(*)=10 and bool_and(oid is not null and not has_function_privilege('anon',oid,'EXECUTE')) from rpc) as application_wrappers_no_anonymous_execute,
 (select public is false from storage.buckets where id='financial-supports') as supports_private,
 (select file_size_limit from storage.buckets where id='financial-supports') as support_max_bytes,
 (select allowed_mime_types from storage.buckets where id='financial-supports') as support_mime_types,
 (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('trefil_private_support_read','trefil_private_support_insert')) as support_policies,
 (select coalesce(jsonb_agg(to_jsonb(provider_events)),'[]'::jsonb) from provider_events) as provider_definer_inventory;

-- Each financial invariant query below must return zero rows.
select t.id from public.financial_transactions t
left join public.transaction_entries e on e.transaction_id=t.id
group by t.id having count(e.id)<2 or coalesce(sum(e.debit),0)<>coalesce(sum(e.credit),0);

select p.id from public.debt_payments p
left join public.payment_allocations a on a.payment_id=p.id
group by p.id having p.amount<>coalesce(sum(a.amount),0);

select t.id from public.financial_transactions t
where t.approved_by=t.requested_by;

select tablename from pg_tables where schemaname='public' and not rowsecurity;

-- Application RPCs must exist, remain SECURITY INVOKER and deny anonymous EXECUTE.
-- Do not confuse provider-managed SECURITY DEFINER event triggers with app RPCs.
with expected(name) as (values
 ('submit_financial_transaction'),('decide_financial_transaction'),('create_financial_account'),
 ('reconcile_account'),('create_debt'),('record_debt_payment'),('manage_member'),
 ('resolve_alert'),('comment_alert'),('register_financial_support')
)
select e.name,p.oid::regprocedure as signature,p.prosecdef,
       case when p.oid is not null then has_function_privilege('anon',p.oid,'EXECUTE') end as anonymous_execute
from expected e left join pg_namespace n on n.nspname='public'
left join pg_proc p on p.pronamespace=n.oid and p.proname=e.name
where p.oid is null or p.prosecdef or has_function_privilege('anon',p.oid,'EXECUTE');

-- Informational inventory, not a zero-row invariant. Supabase may install its own
-- automatic-RLS event-trigger function in public. Inspect and identify each row;
-- never disable the automatic RLS event trigger to satisfy a blanket check.
select p.oid::regprocedure as signature,pg_get_userbyid(p.proowner) as owner,
       pg_get_function_result(p.oid) as return_type,p.proconfig,
       t.evtname,t.evtenabled,
       has_function_privilege('anon',p.oid,'EXECUTE') as anonymous_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
left join pg_event_trigger t on t.evtfoid=p.oid
where n.nspname='public' and p.prosecdef;

-- Informational: status must be private; create/check bucket through Storage API.
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='financial-supports';

-- Informational: never interpret checksum verification as restoration verification.
select organization_id,status,started_at,completed_at,encrypted_size_bytes,
       restoration_verified_at,external_copy_verified_at
from public.backup_runs order by started_at desc limit 10;
