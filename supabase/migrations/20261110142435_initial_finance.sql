-- Trefil OS — additive initial schema. Apply only to an isolated Supabase project.
-- No production records, credentials, user bootstrap or permissive development policies.
create schema if not exists private;
revoke create on schema public from public,anon,authenticated;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null check (length(name) between 2 and 160),
  slug text not null unique, tax_id text,
  timezone text not null default 'America/Bogota' check (timezone='America/Bogota'),
  currency text not null default 'COP' check (currency='COP'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.locations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  name text not null, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,id), unique(organization_id,name)
);
create table public.profiles (
  id uuid primary key references auth.users(id), display_name text not null,
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.roles (code text primary key, name text not null);
insert into public.roles(code,name) values
 ('owner','Propietario'),('admin','Administrador general'),('treasury','Tesorería'),('accounting','Contabilidad'),
 ('inventory','Inventarios'),('production','Producción'),('sales','Ventas'),('hr','Recursos humanos'),
 ('employee','Empleado'),('auditor','Auditor de solo lectura');
create table public.permissions (code text primary key, description text not null);
insert into public.permissions values
 ('finance.read','Consultar tesorería y obligaciones'),('finance.write','Solicitar movimientos financieros'),
 ('finance.approve','Aprobar solicitudes de otro usuario'),('members.manage','Administrar membresías'),
 ('audit.read','Consultar auditoría'),('documents.read','Consultar soportes privados');
create table public.role_permissions (
 role_code text not null references public.roles(code), permission_code text not null references public.permissions(code),
 primary key(role_code,permission_code)
);
insert into public.role_permissions
 select r.code,p.code from public.roles r cross join public.permissions p
 where r.code in ('owner','admin')
 or (r.code in ('treasury','accounting') and p.code in ('finance.read','finance.write','audit.read','documents.read'))
 or (r.code='auditor' and p.code in ('finance.read','audit.read','documents.read'));
create table public.organization_members (
 organization_id uuid not null references public.organizations(id), user_id uuid not null references public.profiles(id),
 role_code text not null references public.roles(code), active boolean not null default true,
 all_locations boolean not null default false, location_ids uuid[] not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(organization_id,user_id), check(all_locations or cardinality(location_ids)>0)
);
create index organization_members_user on public.organization_members(user_id,organization_id) where active;

-- Authorization is looked up on each statement. User-editable JWT metadata is never trusted.
create function private.has_access(p_org uuid,p_location uuid default null,p_roles text[] default null)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists (
  select 1 from public.organization_members m join public.profiles p on p.id=m.user_id
  where m.organization_id=p_org and m.user_id=auth.uid() and m.active and p.active
  and (p_roles is null or m.role_code=any(p_roles))
  and (p_location is null or m.all_locations or p_location=any(m.location_ids))
 )
$$;
revoke all on function private.has_access(uuid,uuid,text[]) from public,anon;
grant execute on function private.has_access(uuid,uuid,text[]) to authenticated;


create function private.require_access(p_org uuid,p_location uuid,p_roles text[])
returns uuid language plpgsql stable security definer set search_path='' as $$
begin
 if not private.has_access(p_org,p_location,p_roles) then raise exception 'Acceso no autorizado' using errcode='42501'; end if;
 if p_location is not null and not exists(select 1 from public.locations where id=p_location and organization_id=p_org and active) then
  raise exception 'Sede no autorizada' using errcode='42501';
 end if;
 return auth.uid();
end $$;
revoke all on function private.require_access(uuid,uuid,text[]) from public,anon,authenticated;
create function private.validate_member_locations() returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from unnest(new.location_ids) x where not exists(select 1 from public.locations l where l.id=x and l.organization_id=new.organization_id)) then
  raise exception 'Membresía con sede de otra empresa' using errcode='23514';
 end if;
 return new;
end $$;
create trigger member_locations before insert or update on public.organization_members for each row execute function private.validate_member_locations();

create table public.accounts (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 location_id uuid not null, name text not null check(length(name) between 2 and 120),
 kind text not null check(kind in ('bank','cash','wallet','personal','ledger')),
 ledger_class text not null check(ledger_class in ('asset','liability','equity','income','expense')),
 bank text, last_four text check(last_four is null or last_four ~ '^[0-9]{4}$'),
 custodian text not null, responsible_user_id uuid references public.profiles(id),
 business_use_authorized_until date, active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid references public.profiles(id), source text not null default 'web',
 unique(organization_id,location_id,id), unique(organization_id,location_id,name),
 foreign key(organization_id,location_id) references public.locations(organization_id,id),
 check(kind='ledger' or ledger_class='asset'), check(kind<>'personal' or business_use_authorized_until is not null)
);
create index accounts_scope on public.accounts(organization_id,location_id);
create table public.counterparties (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),location_id uuid not null,
 name text not null, kind text not null check(kind in ('creditor','investor','supplier','customer','employee','other')),
 document_number text, active boolean not null default true,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references public.profiles(id),source text not null default 'web',
 unique(organization_id,location_id,id),foreign key(organization_id,location_id) references public.locations(organization_id,id)
);
create table public.investors (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,location_id uuid not null,counterparty_id uuid not null,
 notes text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references public.profiles(id),source text not null default 'web',
 unique(organization_id,location_id,id),foreign key(organization_id,location_id,counterparty_id) references public.counterparties(organization_id,location_id,id)
);
create table public.attachments (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),location_id uuid not null,
 bucket text not null default 'financial-supports' check(bucket='financial-supports'),object_path text not null unique,
 name text not null,mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg')),
 size_bytes bigint not null check(size_bytes between 1 and 10485760),sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 uploaded_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),source text not null default 'web',
 unique(organization_id,location_id,id),foreign key(organization_id,location_id) references public.locations(organization_id,id),
 check(object_path like organization_id::text || '/' || location_id::text || '/%')
);
create table public.financial_transactions (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),location_id uuid not null,
 reference bigint generated always as identity,kind text not null check(kind in ('income','expense','transfer','opening','advance','reimbursement','salary','loan','adjustment','reversal','debt_payment','personal_expense')),
 occurred_on date not null,description text not null check(length(description) between 3 and 500),party text not null default '',category text not null default '',
 status text not null default 'pending' check(status in ('pending','posted','rejected')),
 idempotency_key text not null check(length(idempotency_key) between 8 and 180),request_fingerprint jsonb not null,
 requested_by uuid not null references public.profiles(id),approved_by uuid references public.profiles(id),
 support_id uuid,reversal_of uuid,source text not null default 'web',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(organization_id,idempotency_key),unique(organization_id,location_id,id),
 foreign key(organization_id,location_id) references public.locations(organization_id,id),
 foreign key(organization_id,location_id,support_id) references public.attachments(organization_id,location_id,id),
 foreign key(organization_id,location_id,reversal_of) references public.financial_transactions(organization_id,location_id,id),
 check(approved_by is null or approved_by<>requested_by),check((kind='reversal')=(reversal_of is not null))
);
create unique index one_reversal on public.financial_transactions(reversal_of) where reversal_of is not null and status<>'rejected';
create index financial_transactions_scope on public.financial_transactions(organization_id,location_id,occurred_on desc);
create table public.transaction_entries (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,location_id uuid not null,transaction_id uuid not null,account_id uuid not null,
 debit numeric(18,2) not null default 0,credit numeric(18,2) not null default 0,
 created_at timestamptz not null default now(),
 foreign key(organization_id,location_id,transaction_id) references public.financial_transactions(organization_id,location_id,id),
 foreign key(organization_id,location_id,account_id) references public.accounts(organization_id,location_id,id),
 check((debit>0 and credit=0) or (credit>0 and debit=0)),unique(transaction_id,account_id)
);
create index entries_account on public.transaction_entries(organization_id,location_id,account_id,transaction_id);
create table public.approvals (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,location_id uuid not null,transaction_id uuid not null unique,
 reason_required text not null,status text not null default 'pending' check(status in ('pending','approved','rejected')),
 requested_by uuid not null references public.profiles(id),decided_by uuid references public.profiles(id),decision_reason text,decided_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),source text not null default 'web',
 foreign key(organization_id,location_id,transaction_id) references public.financial_transactions(organization_id,location_id,id),
 check(decided_by is null or decided_by<>requested_by),check((status='pending')=(decided_by is null))
);
create table public.reconciliations (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,location_id uuid not null,account_id uuid not null,as_of date not null,
 book_balance numeric(18,2) not null,statement_balance numeric(18,2) not null,difference numeric(18,2) generated always as(statement_balance-book_balance) stored,
 status text not null check(status in ('matched','difference')),notes text not null,created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),source text not null default 'web',
 foreign key(organization_id,location_id,account_id) references public.accounts(organization_id,location_id,id)
);

create table public.debts (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),location_id uuid not null,
 counterparty_id uuid not null,kind text not null check(kind in ('loan','investment')),principal numeric(18,2) not null check(principal>0),
 disbursed_on date not null,status text not null default 'active' check(status in ('active','paid')),guarantee text,contract_id uuid,notes text,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),source text not null default 'web',
 unique(organization_id,location_id,id),foreign key(organization_id,location_id) references public.locations(organization_id,id),
 foreign key(organization_id,location_id,counterparty_id) references public.counterparties(organization_id,location_id,id),
 foreign key(organization_id,location_id,contract_id) references public.attachments(organization_id,location_id,id)
);
create table public.debt_terms (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,location_id uuid not null,debt_id uuid not null,
 effective_on date not null,monthly_rate numeric(9,6) not null check(monthly_rate between 0 and 100),
 interest_type text not null default 'effective_monthly' check(interest_type='effective_monthly'),
 method text not null check(method in ('fixed_payment','fixed_principal','interest_only')),
 installments integer not null check(installments between 1 and 600),frequency text not null default 'monthly' check(frequency='monthly'),
 due_day integer not null check(due_day between 1 and 28),grace_months integer not null default 0 check(grace_months between 0 and 120),
 renegotiation_reason text,approved_by uuid references public.profiles(id),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),source text not null default 'web',
 foreign key(organization_id,location_id,debt_id) references public.debts(organization_id,location_id,id),unique(debt_id,effective_on)
);
create table public.debt_payments (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,location_id uuid not null,debt_id uuid not null,transaction_id uuid not null unique,
 paid_on date not null,amount numeric(18,2) not null check(amount>0),status text not null check(status in ('pending','posted','rejected')),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),source text not null default 'web',
 unique(organization_id,location_id,id),foreign key(organization_id,location_id,debt_id) references public.debts(organization_id,location_id,id),
 foreign key(organization_id,location_id,transaction_id) references public.financial_transactions(organization_id,location_id,id)
);
create table public.payment_allocations (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,location_id uuid not null,payment_id uuid not null,
 kind text not null check(kind in ('interest','principal','late_fee')),amount numeric(18,2) not null check(amount>0),created_at timestamptz not null default now(),
 foreign key(organization_id,location_id,payment_id) references public.debt_payments(organization_id,location_id,id),unique(payment_id,kind)
);
create index debts_scope on public.debts(organization_id,location_id,status);
create index debt_terms_debt on public.debt_terms(debt_id,effective_on desc);
create index debt_payments_debt on public.debt_payments(debt_id,status);

create table public.alerts (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),location_id uuid,
 rule_code text not null,deduplication_key text not null,severity text not null check(severity in ('info','warning','critical')),
 title text not null,evidence jsonb not null default '{}',responsible_user_id uuid references public.profiles(id),
 status text not null default 'open' check(status in ('open','in_progress','resolved')),due_at timestamptz,
 resolution text,resolved_by uuid references public.profiles(id),resolved_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),source text not null default 'rules',
 unique(organization_id,deduplication_key),unique(organization_id,id),foreign key(organization_id,location_id) references public.locations(organization_id,id),
 check(status<>'resolved' or (length(resolution)>=8 and resolved_by is not null and resolved_at is not null))
);
create table public.alert_comments (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,alert_id uuid not null,
 body text not null check(length(body) between 3 and 2000),created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 foreign key(organization_id,alert_id) references public.alerts(organization_id,id)
);
create table public.tasks (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),location_id uuid,
 title text not null,status text not null default 'open' check(status in ('open','in_progress','done')),responsible_user_id uuid references public.profiles(id),due_at timestamptz,
 created_by uuid references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),source text not null default 'web',
 foreign key(organization_id,location_id) references public.locations(organization_id,id)
);
create table public.audit_events (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),location_id uuid,
 actor_id uuid,action text not null,entity_type text not null,entity_id text,reason text,before_data jsonb,after_data jsonb,
 created_at timestamptz not null default now(),source text not null default 'database',
 foreign key(organization_id,location_id) references public.locations(organization_id,id)
);
create index audit_scope on public.audit_events(organization_id,location_id,created_at desc);
create table public.integration_connections (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),location_id uuid,
 provider text not null,status text not null default 'disconnected' check(status in ('disconnected','pending','verified','error')),
 secret_reference text,verified_at timestamptz,created_by uuid references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),source text not null default 'operator',
 foreign key(organization_id,location_id) references public.locations(organization_id,id),unique(organization_id,provider)
);
create table public.inbound_events (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),location_id uuid,
 provider text not null,external_id text not null,payload_hash text not null,status text not null default 'received' check(status in ('received','processed','rejected','failed')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),source text not null default 'integration',
 foreign key(organization_id,location_id) references public.locations(organization_id,id),unique(organization_id,provider,external_id)
);
create table public.ai_runs (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),location_id uuid,
 status text not null check(status in ('proposed','running','completed','failed')),model text,purpose text not null,
 created_by uuid references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),source text not null default 'ai',
 unique(organization_id,id),foreign key(organization_id,location_id) references public.locations(organization_id,id)
);
create table public.ai_recommendations (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,location_id uuid,run_id uuid not null,
 recommendation jsonb not null,status text not null default 'proposed' check(status in ('proposed','approved','rejected')),
 approved_by uuid references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),source text not null default 'ai',
 foreign key(organization_id,run_id) references public.ai_runs(organization_id,id),foreign key(organization_id,location_id) references public.locations(organization_id,id)
);
create table public.backup_runs (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),location_id uuid,
 status text not null check(status in ('running','verified','failed')),started_at timestamptz not null default now(),completed_at timestamptz,
 encrypted_sha256 text check(encrypted_sha256 is null or encrypted_sha256 ~ '^[a-f0-9]{64}$'),encrypted_size_bytes bigint,
 manifest jsonb not null default '{}',restoration_verified_at timestamptz,external_copy_verified_at timestamptz,error_code text,retention_until timestamptz,
 created_by uuid references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),source text not null default 'backup_worker',
 foreign key(organization_id,location_id) references public.locations(organization_id,id),
 check(status<>'verified' or (completed_at is not null and encrypted_sha256 is not null and encrypted_size_bytes>0))
);
create index backup_runs_scope on public.backup_runs(organization_id,started_at desc);

create view public.account_balances with(security_invoker=true) as
 select a.id account_id,a.organization_id,a.location_id,
 coalesce(sum(case when t.status='posted' then e.debit-e.credit else 0 end),0)::numeric(18,2) balance
 from public.accounts a left join public.transaction_entries e on e.account_id=a.id
 left join public.financial_transactions t on t.id=e.transaction_id group by a.id;
create view public.debt_balances with(security_invoker=true) as
 select d.id debt_id,d.organization_id,d.location_id,d.principal,
 (d.principal-coalesce((select sum(pa.amount) from public.debt_payments p
 join public.payment_allocations pa on pa.payment_id=p.id
 join public.financial_transactions t on t.id=p.transaction_id
 where p.debt_id=d.id and pa.kind='principal' and t.status='posted'
 and not exists(select 1 from public.financial_transactions r where r.reversal_of=t.id and r.status='posted')),0))::numeric(18,2) outstanding_principal
 from public.debts d;

-- Immutable journal: corrections are new compensating entries; no hard-delete path.
create function private.prevent_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Registro inmutable: utilice reverso o nuevo evento' using errcode='23514'; end $$;
create function private.guard_transaction() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or old.status<>'pending' or new.status not in ('posted','rejected')
 or (to_jsonb(new)-array['status','approved_by','updated_at'])<>(to_jsonb(old)-array['status','approved_by','updated_at']) then
  raise exception 'Movimiento inmutable: utilice reverso' using errcode='23514';
 end if;
 return new;
end $$;
create trigger transaction_immutable before update or delete on public.financial_transactions for each row execute function private.guard_transaction();
create function private.guard_entry_insert() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.financial_transactions where id=new.transaction_id and status='pending') then
  raise exception 'No se pueden agregar partidas a un movimiento contabilizado' using errcode='23514';
 end if;
 return new;
end $$;
create trigger entry_insert_guard before insert on public.transaction_entries for each row execute function private.guard_entry_insert();
create trigger entries_immutable before update or delete on public.transaction_entries for each row execute function private.prevent_mutation();
create trigger audit_immutable before update or delete on public.audit_events for each row execute function private.prevent_mutation();
create trigger allocations_immutable before update or delete on public.payment_allocations for each row execute function private.prevent_mutation();
create trigger reconciliation_immutable before update or delete on public.reconciliations for each row execute function private.prevent_mutation();
create trigger terms_immutable before update or delete on public.debt_terms for each row execute function private.prevent_mutation();
create trigger comments_immutable before update or delete on public.alert_comments for each row execute function private.prevent_mutation();
create trigger attachments_immutable before update or delete on public.attachments for each row execute function private.prevent_mutation();
create function private.guard_payment_change() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or old.status<>'pending' or new.status not in ('posted','rejected')
 or (to_jsonb(new)-array['status','updated_at'])<>(to_jsonb(old)-array['status','updated_at']) then
  raise exception 'Pago inmutable: utilice reverso del asiento' using errcode='23514';
 end if;
 return new;
end $$;
create trigger payment_immutable before update or delete on public.debt_payments for each row execute function private.guard_payment_change();
create function private.guard_approval_change() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or old.status<>'pending' or new.status not in ('approved','rejected')
 or (to_jsonb(new)-array['status','decided_by','decision_reason','decided_at','updated_at'])<>(to_jsonb(old)-array['status','decided_by','decision_reason','decided_at','updated_at']) then
  raise exception 'Aprobación inmutable' using errcode='23514';
 end if;
 return new;
end $$;
create trigger approval_immutable before update or delete on public.approvals for each row execute function private.guard_approval_change();

create function private.check_journal() returns trigger language plpgsql set search_path='' as $$
declare tx uuid; n integer; debit_sum numeric; credit_sum numeric; k text; s text;
begin
 if tg_table_name='financial_transactions' then tx:=new.id;else tx:=new.transaction_id;end if;
 select kind,status into k,s from public.financial_transactions where id=tx;
 select count(*),coalesce(sum(debit),0),coalesce(sum(credit),0) into n,debit_sum,credit_sum from public.transaction_entries where transaction_id=tx;
 if n<2 or debit_sum<=0 or debit_sum<>credit_sum then raise exception 'Asiento no equilibrado' using errcode='23514'; end if;
 if k='transfer' and (n<>2 or exists(select 1 from public.transaction_entries e join public.accounts a on a.id=e.account_id where e.transaction_id=tx and a.kind='ledger')) then
  raise exception 'Traslado requiere dos cuentas de tesorería' using errcode='23514';
 end if;
 if k in ('income','opening','loan') and (
  n<>2 or not exists(select 1 from public.transaction_entries e join public.accounts a on a.id=e.account_id where e.transaction_id=tx and a.kind<>'ledger' and e.debit=debit_sum)
  or not exists(select 1 from public.transaction_entries e join public.accounts a on a.id=e.account_id where e.transaction_id=tx and a.kind='ledger' and a.ledger_class=case when k='income' then 'income' when k='loan' then 'liability' else 'equity' end and e.credit=credit_sum)
 ) then raise exception 'Ingreso o apertura con clasificación contable inválida' using errcode='23514';end if;
 if k in ('expense','salary','reimbursement','personal_expense','advance') and (
  n<>2 or not exists(select 1 from public.transaction_entries e join public.accounts a on a.id=e.account_id where e.transaction_id=tx and a.kind<>'ledger' and e.credit=credit_sum)
  or not exists(select 1 from public.transaction_entries e join public.accounts a on a.id=e.account_id where e.transaction_id=tx and a.kind='ledger' and a.ledger_class=case when k='advance' then 'asset' else 'expense' end and e.debit=debit_sum)
 ) then raise exception 'Salida con clasificación contable inválida' using errcode='23514';end if;
 if k='debt_payment' and not exists(select 1 from public.debt_payments where transaction_id=tx) then raise exception 'Pago sin obligación ni distribución' using errcode='23514'; end if;
 return null;
end $$;
create constraint trigger journal_balanced after insert or update on public.financial_transactions deferrable initially deferred for each row execute function private.check_journal();
create constraint trigger entries_balanced after insert on public.transaction_entries deferrable initially deferred for each row execute function private.check_journal();

create function private.audit_change() returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb; org uuid; loc uuid;
begin
 row_data:=to_jsonb(new);org:=(row_data->>'organization_id')::uuid;loc:=(row_data->>'location_id')::uuid;
 insert into public.audit_events(organization_id,location_id,actor_id,action,entity_type,entity_id,before_data,after_data)
 values(org,loc,auth.uid(),lower(tg_op),tg_table_name,coalesce(row_data->>'id',row_data->>'user_id'),case when tg_op='UPDATE' then to_jsonb(old) else null end,row_data);
 return new;
end $$;
do $$ declare tab text; begin
 foreach tab in array array['locations','organization_members','accounts','counterparties','investors','attachments','financial_transactions','approvals','reconciliations','debts','debt_terms','debt_payments','alerts','alert_comments','tasks','integration_connections','inbound_events','ai_runs','ai_recommendations','backup_runs'] loop
 execute format('create trigger audit_change after insert or update on public.%I for each row execute function private.audit_change()',tab);
 end loop;
end $$;

-- Enable RLS even on inert future modules. No browser writes, including owners.
do $$ declare tab text; begin
 foreach tab in array array['organizations','locations','profiles','roles','permissions','role_permissions','organization_members','accounts','counterparties','investors','attachments','financial_transactions','transaction_entries','approvals','reconciliations','debts','debt_terms','debt_payments','payment_allocations','alerts','alert_comments','tasks','audit_events','integration_connections','inbound_events','ai_runs','ai_recommendations','backup_runs'] loop
 execute format('alter table public.%I enable row level security',tab);
 execute format('revoke all on public.%I from anon,authenticated',tab);
 execute format('grant select on public.%I to authenticated',tab);
 end loop;
end $$;
revoke all on public.account_balances from anon;
grant select on public.account_balances to authenticated;
revoke all on public.debt_balances from anon;
grant select on public.debt_balances to authenticated;
create policy organization_read on public.organizations for select to authenticated using(private.has_access(id));
create policy location_read on public.locations for select to authenticated using(private.has_access(organization_id,id));
create policy profile_read on public.profiles for select to authenticated using(id=(select auth.uid()));
create policy role_read on public.roles for select to authenticated using((select auth.uid()) is not null);
create policy permission_read on public.permissions for select to authenticated using((select auth.uid()) is not null);
create policy role_permission_read on public.role_permissions for select to authenticated using((select auth.uid()) is not null);
create policy member_read on public.organization_members for select to authenticated using(user_id=(select auth.uid()) or private.has_access(organization_id,null,array['owner','admin','auditor']));
do $$ declare tab text; begin
 foreach tab in array array['accounts','counterparties','investors','attachments','financial_transactions','transaction_entries','approvals','reconciliations','debts','debt_terms','debt_payments','payment_allocations','alerts','tasks','audit_events','backup_runs'] loop
 execute format('create policy financial_read on public.%I for select to authenticated using(private.has_access(organization_id,location_id,array[''owner'',''admin'',''treasury'',''accounting'',''auditor'']))',tab);
 end loop;
 foreach tab in array array['integration_connections','inbound_events','ai_runs','ai_recommendations'] loop
 execute format('create policy administrative_read on public.%I for select to authenticated using(private.has_access(organization_id,location_id,array[''owner'',''admin'',''auditor'']))',tab);
 end loop;
end $$;
create policy alert_comment_read on public.alert_comments for select to authenticated using(exists(select 1 from public.alerts a where a.id=alert_id));

-- Trigger/internal functions are not API methods.
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.has_access(uuid,uuid,text[]) to authenticated;


create function private.parse_money(p_value text,p_zero boolean default false) returns numeric language plpgsql immutable set search_path='' as $$
declare v numeric;
begin
 if p_value is null or p_value !~ '^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$' then raise exception 'Importe decimal inválido' using errcode='22023'; end if;
 v:=p_value::numeric(18,2);
 if v<0 or (not p_zero and v=0) then raise exception 'Importe debe ser positivo' using errcode='22023'; end if;
 return v;
end $$;

create function private.submit_financial_transaction(
 p_organization_id uuid,p_location_id uuid,p_idempotency_key text,p_kind text,p_date date,p_description text,p_party text,p_category text,
 p_entries jsonb,p_support_id uuid default null,p_reversal_of uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid;tx uuid; existing public.financial_transactions;fingerprint jsonb; item jsonb;acc uuid;debit numeric;credit numeric;total numeric:=0;
 approval_needed boolean;original public.financial_transactions;expected jsonb;
begin
 actor:=private.require_access(p_organization_id,p_location_id,array['owner','admin','treasury','accounting']);
 if length(p_idempotency_key) not between 8 and 180 or p_idempotency_key is null then raise exception 'Llave de idempotencia inválida' using errcode='22023'; end if;
 if p_kind not in ('income','expense','transfer','opening','advance','reimbursement','salary','loan','adjustment','reversal','debt_payment','personal_expense') then raise exception 'Tipo de operación inválido' using errcode='22023'; end if;
 if p_date is null or p_date>(now() at time zone 'America/Bogota')::date then raise exception 'Fecha futura: una proyección no es un pago' using errcode='22023'; end if;
 if p_description is null or length(trim(p_description)) not between 3 and 500 then raise exception 'Descripción requerida' using errcode='22023'; end if;
 if jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries) not between 2 and 100 then raise exception 'Se requieren de 2 a 100 partidas' using errcode='22023'; end if;
 fingerprint:=jsonb_build_object('location',p_location_id,'kind',p_kind,'date',p_date,'description',trim(p_description),'party',coalesce(p_party,''),'category',coalesce(p_category,''),'entries',p_entries,'support',p_support_id,'reversal',p_reversal_of);
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||p_idempotency_key,0));
 select * into existing from public.financial_transactions where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
 if found then
  if existing.request_fingerprint<>fingerprint then raise exception 'Llave de idempotencia reutilizada con otro contenido' using errcode='22023'; end if;
  return existing.id;
 end if;
 if p_support_id is not null and not exists(select 1 from public.attachments where id=p_support_id and organization_id=p_organization_id and location_id=p_location_id) then raise exception 'Soporte fuera de la sede' using errcode='42501'; end if;
 if p_kind='reversal' then
  select * into original from public.financial_transactions where id=p_reversal_of and organization_id=p_organization_id and location_id=p_location_id for update;
  if not found or original.status<>'posted' or original.kind='reversal' then raise exception 'El original no admite reverso' using errcode='22023'; end if;
  select jsonb_agg(jsonb_build_object('account_id',e.account_id,'debit',e.credit::text,'credit',e.debit::text) order by e.account_id) into expected from public.transaction_entries e where e.transaction_id=original.id;
  if (select jsonb_agg(jsonb_build_object('account_id',(v->>'account_id')::uuid,'debit',private.parse_money(v->>'debit',true)::text,'credit',private.parse_money(v->>'credit',true)::text) order by (v->>'account_id')::uuid) from jsonb_array_elements(p_entries) v)<>expected then
   raise exception 'El reverso debe compensar exactamente el original' using errcode='23514';
  end if;
 elsif p_reversal_of is not null then raise exception 'Referencia de reverso inválida' using errcode='22023';
 end if;
 insert into public.financial_transactions(organization_id,location_id,kind,occurred_on,description,party,category,idempotency_key,request_fingerprint,requested_by,support_id,reversal_of)
 values(p_organization_id,p_location_id,p_kind,p_date,trim(p_description),coalesce(p_party,''),coalesce(p_category,''),p_idempotency_key,fingerprint,actor,p_support_id,p_reversal_of) returning id into tx;
 for item in select value from jsonb_array_elements(p_entries) loop
  acc:=(item->>'account_id')::uuid;debit:=private.parse_money(item->>'debit',true);credit:=private.parse_money(item->>'credit',true);
  if not exists(select 1 from public.accounts where id=acc and organization_id=p_organization_id and location_id=p_location_id and active
    and (kind<>'personal' or business_use_authorized_until>=p_date)) then raise exception 'Cuenta inactiva o fuera de la sede' using errcode='42501'; end if;
  insert into public.transaction_entries(organization_id,location_id,transaction_id,account_id,debit,credit) values(p_organization_id,p_location_id,tx,acc,debit,credit);
  total:=total+debit;
 end loop;
 if (select sum(e.debit)-sum(e.credit) from public.transaction_entries e where e.transaction_id=tx)<>0 then raise exception 'Asiento no equilibrado' using errcode='23514'; end if;
 approval_needed:=total>=5000000 or p_kind in ('opening','adjustment','personal_expense','debt_payment','reversal');
 if approval_needed then
  insert into public.approvals(organization_id,location_id,transaction_id,reason_required,requested_by)
  values(p_organization_id,p_location_id,tx,'Monto >= COP 5.000.000, ajuste, gasto personal o pago de deuda',actor);
 else update public.financial_transactions set status='posted',updated_at=now() where id=tx;
 end if;
 return tx;
end $$;

create function private.decide_financial_transaction(p_id uuid,p_approve boolean,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare tx public.financial_transactions;actor uuid;
begin
 select * into tx from public.financial_transactions where id=p_id for update;
 if not found then raise exception 'Solicitud no encontrada' using errcode='42501'; end if;
 actor:=private.require_access(tx.organization_id,tx.location_id,array['owner','admin']);
 if actor=tx.requested_by then raise exception 'No puede aprobar ni rechazar su propia solicitud' using errcode='42501'; end if;
 if p_reason is null or length(trim(p_reason))<8 then raise exception 'Justificación de al menos 8 caracteres requerida' using errcode='22023'; end if;
 if tx.status<>'pending' then raise exception 'Solicitud ya decidida' using errcode='22023'; end if;
 update public.approvals set status=case when p_approve then 'approved' else 'rejected' end,decided_by=actor,decision_reason=trim(p_reason),decided_at=now(),updated_at=now() where transaction_id=p_id and status='pending';
 if not found then raise exception 'Solicitud sin aprobación registrada' using errcode='23514'; end if;
 update public.financial_transactions set status=case when p_approve then 'posted' else 'rejected' end,approved_by=actor,updated_at=now() where id=p_id;
 update public.debt_payments set status=case when p_approve then 'posted' else 'rejected' end,updated_at=now() where transaction_id=p_id;
 return p_id;
end $$;

create function private.create_financial_account(p_organization_id uuid,p_location_id uuid,p_name text,p_kind text,p_custodian text,p_bank text default null,p_last_four text default null,p_authorized_until date default null,p_ledger_class text default 'asset')
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid;id uuid;
begin
 actor:=private.require_access(p_organization_id,p_location_id,array['owner','admin','treasury','accounting']);
 if p_kind='ledger' then perform private.require_access(p_organization_id,p_location_id,array['owner','admin','accounting']);
 else perform private.require_access(p_organization_id,p_location_id,array['owner','admin','treasury']);end if;
 insert into public.accounts(organization_id,location_id,name,kind,ledger_class,custodian,bank,last_four,business_use_authorized_until,created_by)
 values(p_organization_id,p_location_id,p_name,p_kind,p_ledger_class,p_custodian,p_bank,p_last_four,p_authorized_until,actor) returning accounts.id into id;
 return id;
end $$;

create function private.reconcile_account(p_account_id uuid,p_as_of date,p_statement_balance text,p_notes text) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.accounts;actor uuid;book numeric;statement numeric;id uuid;
begin
 select * into a from public.accounts where accounts.id=p_account_id;
 if not found then raise exception 'Cuenta no encontrada' using errcode='42501'; end if;
 actor:=private.require_access(a.organization_id,a.location_id,array['owner','admin','treasury','accounting']);
 if p_as_of is null or p_as_of>(now() at time zone 'America/Bogota')::date or length(trim(p_notes))<8 then raise exception 'Fecha o notas inválidas' using errcode='22023'; end if;
 -- Negative statements are permitted for overdrafts; parse without floating point.
 statement:=case when left(p_statement_balance,1)='-' then -private.parse_money(substr(p_statement_balance,2),true) else private.parse_money(p_statement_balance,true) end;
 select coalesce(sum(e.debit-e.credit),0) into book from public.transaction_entries e join public.financial_transactions t on t.id=e.transaction_id where e.account_id=p_account_id and t.status='posted' and t.occurred_on<=p_as_of;
 insert into public.reconciliations(organization_id,location_id,account_id,as_of,book_balance,statement_balance,status,notes,created_by)
 values(a.organization_id,a.location_id,p_account_id,p_as_of,book,statement,case when book=statement then 'matched' else 'difference' end,trim(p_notes),actor) returning reconciliations.id into id;
 return id;
end $$;

create function private.create_debt(p_organization_id uuid,p_location_id uuid,p_creditor text,p_kind text,p_principal text,p_disbursed_on date,p_monthly_rate text,p_installments integer,p_due_day integer,p_method text,p_guarantee text default null,p_notes text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid;party uuid;debt uuid;rate numeric;
begin
 actor:=private.require_access(p_organization_id,p_location_id,array['owner','admin','treasury','accounting']);
 if p_disbursed_on>(now() at time zone 'America/Bogota')::date then raise exception 'No registrar desembolsos futuros como realizados' using errcode='22023'; end if;
 if p_monthly_rate !~ '^(0|[1-9][0-9]?|100)(\.[0-9]{1,6})?$' then raise exception 'Tasa inválida' using errcode='22023'; end if;
 rate:=p_monthly_rate::numeric;
 if length(trim(p_creditor))<3 then raise exception 'Acreedor requerido' using errcode='22023'; end if;
 insert into public.counterparties(organization_id,location_id,name,kind,created_by) values(p_organization_id,p_location_id,trim(p_creditor),case when p_kind='investment' then 'investor' else 'creditor' end,actor) returning id into party;
 insert into public.debts(organization_id,location_id,counterparty_id,kind,principal,disbursed_on,guarantee,notes,created_by)
 values(p_organization_id,p_location_id,party,p_kind,private.parse_money(p_principal),p_disbursed_on,p_guarantee,p_notes,actor) returning id into debt;
 insert into public.debt_terms(organization_id,location_id,debt_id,effective_on,monthly_rate,method,installments,due_day,created_by)
 values(p_organization_id,p_location_id,debt,p_disbursed_on,rate,p_method,p_installments,p_due_day,actor);
 if p_kind='investment' then insert into public.investors(organization_id,location_id,counterparty_id,created_by) values(p_organization_id,p_location_id,party,actor); end if;
 return debt;
end $$;

create function private.record_debt_payment(p_debt_id uuid,p_cash_account uuid,p_principal_account uuid,p_interest_account uuid,p_paid_on date,p_principal text,p_interest text,p_idempotency_key text,p_description text)
returns uuid language plpgsql security definer set search_path='' as $$
declare d public.debts;actor uuid;principal numeric;interest numeric;paid numeric;tx uuid;payment uuid;lines jsonb;existing public.debt_payments;
begin
 select * into d from public.debts where id=p_debt_id for update;
 if not found then raise exception 'Deuda no encontrada' using errcode='42501'; end if;
 actor:=private.require_access(d.organization_id,d.location_id,array['owner','admin','treasury','accounting']);
 if p_paid_on<d.disbursed_on then raise exception 'El pago no puede preceder al desembolso' using errcode='22023';end if;
 principal:=private.parse_money(p_principal,true);interest:=private.parse_money(p_interest,true);
 if principal+interest<=0 then raise exception 'Pago vacío' using errcode='22023'; end if;
 if not exists(select 1 from public.accounts where id=p_cash_account and organization_id=d.organization_id and location_id=d.location_id and kind<>'ledger')
 or not exists(select 1 from public.accounts where id=p_principal_account and organization_id=d.organization_id and location_id=d.location_id and ledger_class='liability' and kind='ledger')
 or not exists(select 1 from public.accounts where id=p_interest_account and organization_id=d.organization_id and location_id=d.location_id and ledger_class='expense' and kind='ledger') then raise exception 'Cuentas de pago inválidas' using errcode='22023'; end if;
 lines:=jsonb_build_array(jsonb_build_object('account_id',p_cash_account,'debit','0.00','credit',(principal+interest)::text));
 if principal>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account_id',p_principal_account,'debit',principal::text,'credit','0.00')); end if;
 if interest>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account_id',p_interest_account,'debit',interest::text,'credit','0.00')); end if;
 tx:=private.submit_financial_transaction(d.organization_id,d.location_id,p_idempotency_key,'debt_payment',p_paid_on,p_description,'','Pago de deuda',lines,null,null);
 select * into existing from public.debt_payments where transaction_id=tx;
 if found then
  if existing.debt_id<>p_debt_id then raise exception 'Pago vinculado a otra deuda' using errcode='22023'; end if;
  return existing.id;
 end if;
 -- Reserve pending principal too, so two approvals cannot repay the same balance twice.
 select coalesce(sum(pa.amount),0) into paid from public.debt_payments dp join public.payment_allocations pa on pa.payment_id=dp.id
 where dp.debt_id=d.id and dp.status<>'rejected' and pa.kind='principal'
 and not exists(select 1 from public.financial_transactions r where r.reversal_of=dp.transaction_id and r.status='posted');
 if principal>d.principal-paid then raise exception 'Capital excede el saldo de la deuda' using errcode='23514'; end if;
 insert into public.debt_payments(organization_id,location_id,debt_id,transaction_id,paid_on,amount,status,created_by)
 values(d.organization_id,d.location_id,d.id,tx,p_paid_on,principal+interest,'pending',actor) returning id into payment;
 if principal>0 then insert into public.payment_allocations(organization_id,location_id,payment_id,kind,amount) values(d.organization_id,d.location_id,payment,'principal',principal); end if;
 if interest>0 then insert into public.payment_allocations(organization_id,location_id,payment_id,kind,amount) values(d.organization_id,d.location_id,payment,'interest',interest); end if;
 return payment;
end $$;

create function private.check_payment() returns trigger language plpgsql set search_path='' as $$
declare pay uuid;p public.debt_payments;allocated numeric;cash numeric;tx_status text;
begin
 if tg_table_name='debt_payments' then pay:=new.id;else pay:=new.payment_id;end if;
 select * into p from public.debt_payments where id=pay;
 select coalesce(sum(amount),0) into allocated from public.payment_allocations where payment_id=pay;
 select coalesce(sum(e.credit),0) into cash from public.transaction_entries e join public.accounts a on a.id=e.account_id where e.transaction_id=p.transaction_id and a.kind<>'ledger';
 select status into tx_status from public.financial_transactions where id=p.transaction_id;
 if allocated<>p.amount or cash<>p.amount or p.status<>tx_status then raise exception 'Pago sin distribución completa o distinto al asiento' using errcode='23514'; end if;
 return null;
end $$;
create constraint trigger payment_distributed after insert or update on public.debt_payments deferrable initially deferred for each row execute function private.check_payment();
create constraint trigger allocation_distributed after insert on public.payment_allocations deferrable initially deferred for each row execute function private.check_payment();

create function private.refresh_debt_status() returns trigger language plpgsql security definer set search_path='' as $$
declare debt uuid;outstanding numeric;
begin
 select p.debt_id into debt from public.debt_payments p where p.transaction_id=new.id or p.transaction_id=new.reversal_of limit 1;
 if debt is not null then
  select outstanding_principal into outstanding from public.debt_balances where debt_id=debt;
  update public.debts set status=case when outstanding=0 then 'paid' else 'active' end,updated_at=now() where id=debt;
 end if;
 return new;
end $$;
create trigger debt_status_from_journal after update of status on public.financial_transactions for each row execute function private.refresh_debt_status();
revoke all on function private.refresh_debt_status() from public,anon,authenticated;

create function private.manage_member(p_organization_id uuid,p_user_id uuid,p_role text,p_active boolean,p_all_locations boolean,p_locations uuid[],p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid;current_role text;old_role text;
begin
 actor:=private.require_access(p_organization_id,null,array['owner','admin']);
 select role_code into current_role from public.organization_members where organization_id=p_organization_id and user_id=actor;
 select role_code into old_role from public.organization_members where organization_id=p_organization_id and user_id=p_user_id;
 if actor=p_user_id or (current_role<>'owner' and (p_role='owner' or old_role='owner')) then raise exception 'Cambio de propietario o autopermiso no autorizado' using errcode='42501'; end if;
 if p_reason is null or length(trim(p_reason))<8 then raise exception 'Justificación requerida' using errcode='22023'; end if;
 if old_role='owner' and (not p_active or p_role<>'owner') and not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id<>p_user_id and role_code='owner' and active) then raise exception 'La empresa requiere propietario activo' using errcode='23514'; end if;
 insert into public.organization_members(organization_id,user_id,role_code,active,all_locations,location_ids)
 values(p_organization_id,p_user_id,p_role,p_active,p_all_locations,coalesce(p_locations,'{}'))
 on conflict(organization_id,user_id) do update set role_code=excluded.role_code,active=excluded.active,all_locations=excluded.all_locations,location_ids=excluded.location_ids,updated_at=now();
 insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,reason) values(p_organization_id,actor,'permission_change','organization_members',p_user_id::text,trim(p_reason));
end $$;

create function private.resolve_alert(p_alert_id uuid,p_resolution text) returns void language plpgsql security definer set search_path='' as $$
declare a public.alerts;actor uuid;
begin
 select * into a from public.alerts where id=p_alert_id for update;
 if not found then raise exception 'Alerta no encontrada' using errcode='42501'; end if;
 actor:=private.require_access(a.organization_id,a.location_id,array['owner','admin','treasury','accounting']);
 if p_resolution is null or length(trim(p_resolution))<8 then raise exception 'Resolución requerida' using errcode='22023'; end if;
 update public.alerts set status='resolved',resolution=trim(p_resolution),resolved_by=actor,resolved_at=now(),updated_at=now() where id=p_alert_id;
end $$;
create function private.comment_alert(p_alert_id uuid,p_body text) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.alerts;actor uuid;id uuid;
begin
 select * into a from public.alerts where alerts.id=p_alert_id;
 if not found then raise exception 'Alerta no encontrada' using errcode='42501'; end if;
 actor:=private.require_access(a.organization_id,a.location_id,array['owner','admin','treasury','accounting']);
 insert into public.alert_comments(organization_id,alert_id,body,created_by) values(a.organization_id,p_alert_id,trim(p_body),actor) returning alert_comments.id into id;
 return id;
end $$;

-- Public wrappers are SECURITY INVOKER. Only these reviewed private implementations
-- receive execute permission; private schema must not be added to Data API exposure.
create function public.submit_financial_transaction(p_organization_id uuid,p_location_id uuid,p_idempotency_key text,p_kind text,p_date date,p_description text,p_party text,p_category text,p_entries jsonb,p_support_id uuid default null,p_reversal_of uuid default null)
returns uuid language sql security invoker set search_path='' as $$ select private.submit_financial_transaction(p_organization_id,p_location_id,p_idempotency_key,p_kind,p_date,p_description,p_party,p_category,p_entries,p_support_id,p_reversal_of) $$;
create function public.decide_financial_transaction(p_id uuid,p_approve boolean,p_reason text) returns uuid language sql security invoker set search_path='' as $$select private.decide_financial_transaction(p_id,p_approve,p_reason)$$;
create function public.create_financial_account(p_organization_id uuid,p_location_id uuid,p_name text,p_kind text,p_custodian text,p_bank text default null,p_last_four text default null,p_authorized_until date default null,p_ledger_class text default 'asset') returns uuid language sql security invoker set search_path='' as $$select private.create_financial_account(p_organization_id,p_location_id,p_name,p_kind,p_custodian,p_bank,p_last_four,p_authorized_until,p_ledger_class)$$;
create function public.reconcile_account(p_account_id uuid,p_as_of date,p_statement_balance text,p_notes text) returns uuid language sql security invoker set search_path='' as $$select private.reconcile_account(p_account_id,p_as_of,p_statement_balance,p_notes)$$;
create function public.create_debt(p_organization_id uuid,p_location_id uuid,p_creditor text,p_kind text,p_principal text,p_disbursed_on date,p_monthly_rate text,p_installments integer,p_due_day integer,p_method text,p_guarantee text default null,p_notes text default null) returns uuid language sql security invoker set search_path='' as $$select private.create_debt(p_organization_id,p_location_id,p_creditor,p_kind,p_principal,p_disbursed_on,p_monthly_rate,p_installments,p_due_day,p_method,p_guarantee,p_notes)$$;
create function public.record_debt_payment(p_debt_id uuid,p_cash_account uuid,p_principal_account uuid,p_interest_account uuid,p_paid_on date,p_principal text,p_interest text,p_idempotency_key text,p_description text) returns uuid language sql security invoker set search_path='' as $$select private.record_debt_payment(p_debt_id,p_cash_account,p_principal_account,p_interest_account,p_paid_on,p_principal,p_interest,p_idempotency_key,p_description)$$;
create function public.manage_member(p_organization_id uuid,p_user_id uuid,p_role text,p_active boolean,p_all_locations boolean,p_locations uuid[],p_reason text) returns void language sql security invoker set search_path='' as $$select private.manage_member(p_organization_id,p_user_id,p_role,p_active,p_all_locations,p_locations,p_reason)$$;
create function public.resolve_alert(p_alert_id uuid,p_resolution text) returns void language sql security invoker set search_path='' as $$select private.resolve_alert(p_alert_id,p_resolution)$$;
create function public.comment_alert(p_alert_id uuid,p_body text) returns uuid language sql security invoker set search_path='' as $$select private.comment_alert(p_alert_id,p_body)$$;

do $$ declare f record;begin
 for f in select p.oid::regprocedure signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname in ('submit_financial_transaction','decide_financial_transaction','create_financial_account','reconcile_account','create_debt','record_debt_payment','manage_member','resolve_alert','comment_alert') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
revoke all on function private.parse_money(text,boolean) from public,anon,authenticated;
revoke all on function private.check_payment() from public,anon,authenticated;
