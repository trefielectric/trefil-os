import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const ids = {
  org: '10000000-0000-4000-8000-000000000001', otherOrg: '10000000-0000-4000-8000-000000000002',
  location: '20000000-0000-4000-8000-000000000001', otherLocation: '20000000-0000-4000-8000-000000000002',
  secondLocation: '20000000-0000-4000-8000-000000000003',
  owner: '30000000-0000-4000-8000-000000000001', approver: '30000000-0000-4000-8000-000000000002',
  treasury: '30000000-0000-4000-8000-000000000003', auditor: '30000000-0000-4000-8000-000000000004',
  outsider: '30000000-0000-4000-8000-000000000005',
  cash: '40000000-0000-4000-8000-000000000001', bank: '40000000-0000-4000-8000-000000000002',
  income: '40000000-0000-4000-8000-000000000003', equity: '40000000-0000-4000-8000-000000000004',
  otherAccount: '40000000-0000-4000-8000-000000000005', secondAccount: '40000000-0000-4000-8000-000000000006',
  liability: '40000000-0000-4000-8000-000000000007', expense: '40000000-0000-4000-8000-000000000008',
};

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create schema auth; create schema storage;
    create role anon; create role authenticated;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',coalesce(nullif(current_setting('request.jwt.claim.aal',true),''),'aal1'))$$;
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    grant select,insert on storage.objects to authenticated;
  `);
  const files = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort();
  assert.ok(files.length >= 2, 'Versioned schema and storage migrations exist');
  for (const file of files) await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  await db.exec(`
    insert into auth.users(id,email) values
      ('${ids.owner}','owner@example.test'),('${ids.approver}','approver@example.test'),('${ids.treasury}','treasury@example.test'),
      ('${ids.auditor}','auditor@example.test'),('${ids.outsider}','outsider@example.test');
    insert into public.profiles(id,display_name) select id,'Persona ficticia de prueba' from auth.users;
    insert into public.organizations(id,name,slug) values ('${ids.org}','Empresa ficticia A','fixture-a'),('${ids.otherOrg}','Empresa ficticia B','fixture-b');
    insert into public.locations(id,organization_id,name) values
      ('${ids.location}','${ids.org}','Sede ficticia A'),('${ids.otherLocation}','${ids.otherOrg}','Sede ficticia B'),('${ids.secondLocation}','${ids.org}','Sede ficticia C');
    insert into public.organization_members(organization_id,user_id,role_code,all_locations,location_ids) values
      ('${ids.org}','${ids.owner}','owner',true,'{}'),('${ids.org}','${ids.approver}','admin',true,'{}'),
      ('${ids.org}','${ids.treasury}','treasury',false,'{${ids.location}}'),('${ids.org}','${ids.auditor}','auditor',true,'{}'),
      ('${ids.otherOrg}','${ids.outsider}','owner',true,'{}');
    insert into public.accounts(id,organization_id,location_id,name,kind,ledger_class,custodian) values
      ('${ids.cash}','${ids.org}','${ids.location}','Caja ficticia','cash','asset','Tesorería ficticia'),
      ('${ids.bank}','${ids.org}','${ids.location}','Banco ficticio','bank','asset','Tesorería ficticia'),
      ('${ids.income}','${ids.org}','${ids.location}','Ingreso ficticio','ledger','income','Contabilidad ficticia'),
      ('${ids.equity}','${ids.org}','${ids.location}','Patrimonio ficticio','ledger','equity','Contabilidad ficticia'),
      ('${ids.liability}','${ids.org}','${ids.location}','Obligaciones ficticias','ledger','liability','Contabilidad ficticia'),
      ('${ids.expense}','${ids.org}','${ids.location}','Intereses ficticios','ledger','expense','Contabilidad ficticia'),
      ('${ids.otherAccount}','${ids.otherOrg}','${ids.otherLocation}','Cuenta otra empresa','cash','asset','Responsable ficticio'),
      ('${ids.secondAccount}','${ids.org}','${ids.secondLocation}','Cuenta otra sede','cash','asset','Responsable ficticio');
  `);
  return db;
}

async function asUser(db: PGlite, id: string | null, role = 'authenticated', aal = 'aal2') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? '']);
  await db.query("select set_config('request.jwt.claim.aal',$1,false)", [aal]);
  await db.exec(`set role ${role}`);
}

function lines(amount = '100.01', cash = ids.cash, opposite = ids.income) {
  return [{ account_id: cash, debit: amount, credit: '0.00' }, { account_id: opposite, debit: '0.00', credit: amount }];
}

async function submit(db: PGlite, key: string, entries = lines(), kind = 'income', reversal: string | null = null) {
  const result = await db.query<{ id: string }>(`select public.submit_financial_transaction($1,$2,$3,$4,'2026-01-02','Operación ficticia de prueba','Contraparte ficticia','Clasificado',$5,null,$6) id`, [ids.org, ids.location, key, kind, JSON.stringify(entries), reversal]);
  return result.rows[0].id;
}

test('PostgreSQL: RLS, append-only ledger, approval and idempotency invariants', async t => {
  const db = await setup();
  try {
    await t.test('every exposed business table has RLS and no anonymous access', async () => {
      const result = await db.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' and not rowsecurity");
      assert.deepEqual(result.rows, []);
      await asUser(db, null, 'anon');
      await assert.rejects(db.query('select * from public.accounts'), /permission denied/);
      await assert.rejects(submit(db, 'anon-reject-0001'), /permission denied/);
    });

    await t.test('organization and location policies prevent cross-scope reads and writes', async () => {
      await asUser(db, ids.treasury);
      const result = await db.query<{ id: string }>('select id from public.accounts');
      assert.equal(result.rows.length, 6);
      assert.equal(result.rows.some(r => r.id === ids.otherAccount || r.id === ids.secondAccount), false);
      await assert.rejects(submit(db, 'scope-cross-0001', lines('10.00', ids.otherAccount)), /fuera de la sede/);
      await assert.rejects(submit(db, 'scope-cross-0002', lines('10.00', ids.secondAccount)), /fuera de la sede/);
      await assert.rejects(db.query("select public.create_financial_account($1,$2,'No autorizada','cash','Prueba')", [ids.org, ids.secondLocation]), /Acceso no autorizado/);
    });

    await t.test('financial read and write access requires verified AAL2, even for the owner', async () => {
      await asUser(db, ids.owner, 'authenticated', 'aal1');
      assert.equal((await db.query('select * from public.accounts')).rows.length, 0);
      assert.equal((await db.query('select * from public.financial_transactions')).rows.length, 0);
      assert.equal((await db.query('select * from public.account_balances')).rows.length, 0);
      await assert.rejects(submit(db, 'aal1-reject-0001'), /Acceso no autorizado/);
      await asUser(db, ids.owner);
      assert.ok((await db.query('select * from public.accounts')).rows.length > 0);
    });

    await t.test('direct writes are forbidden even to an owner; API validates money and balance', async () => {
      await asUser(db, ids.owner);
      await assert.rejects(db.query("update public.accounts set name='Alterado' where id=$1", [ids.cash]), /permission denied/);
      await assert.rejects(submit(db, 'unbalanced-0001', [lines()[0], { ...lines()[1], credit: '99.00' }]), /no equilibrado/);
      await assert.rejects(submit(db, 'decimal-reject-0001', lines('0.001')), /decimal inválido/);
      await assert.rejects(submit(db, 'decimal-reject-0002', lines('1e5')), /decimal inválido/);
      await assert.rejects(submit(db, 'single-entry-0001', [lines()[0]]), /2 a 100 partidas/);
      await assert.rejects(submit(db, 'false-income-0001', lines('10.00', ids.cash, ids.equity)), /clasificación contable inválida/);
      await submit(db, 'loan-incoming-0001', lines('10.00', ids.cash, ids.liability), 'loan');
      await db.exec('reset role');
      await assert.rejects(db.exec(`begin;
        insert into public.financial_transactions(id,organization_id,location_id,kind,occurred_on,description,idempotency_key,request_fingerprint,requested_by)
        values('60000000-0000-4000-8000-000000000001','${ids.org}','${ids.location}','adjustment','2026-01-02','Asiento ficticio inválido','deferred-balance-0001','{}','${ids.owner}');
        insert into public.transaction_entries(organization_id,location_id,transaction_id,account_id,debit,credit) values
        ('${ids.org}','${ids.location}','60000000-0000-4000-8000-000000000001','${ids.cash}',10,0),
        ('${ids.org}','${ids.location}','60000000-0000-4000-8000-000000000001','${ids.equity}',0,9);
        commit;`), /no equilibrado/);
      await db.exec('rollback');
    });

    let posted: string;
    await t.test('exact decimal posting and duplicate retries produce one journal', async () => {
      await asUser(db, ids.treasury);
      posted = await submit(db, 'idempotency-0001');
      assert.equal(await submit(db, 'idempotency-0001'), posted);
      await assert.rejects(submit(db, 'idempotency-0001', lines('100.02')), /otro contenido/);
      const balance = await db.query<{ balance: string }>('select balance::text from public.account_balances where account_id=$1', [ids.cash]);
      assert.equal(balance.rows[0].balance, '110.01');
    });

    await t.test('large and sensitive operations require a different authorized approver', async () => {
      await asUser(db, ids.owner);
      const pending = await submit(db, 'large-payment-0001', lines('5000000.00'));
      const status = await db.query<{ status: string }>('select status from public.financial_transactions where id=$1', [pending]);
      assert.equal(status.rows[0].status, 'pending');
      await assert.rejects(db.query('select public.decide_financial_transaction($1,true,$2)', [pending, 'Aprobación propia']), /su propia solicitud/);
      await asUser(db, ids.treasury);
      await assert.rejects(db.query('select public.decide_financial_transaction($1,true,$2)', [pending, 'Aprobación tesorero']), /Acceso no autorizado/);
      await asUser(db, ids.approver);
      await db.query('select public.decide_financial_transaction($1,true,$2)', [pending, 'Soporte verificado por segunda persona']);
      await assert.rejects(db.query('select public.decide_financial_transaction($1,true,$2)', [pending, 'Repetida aprobación']), /ya decidida/);
    });

    await t.test('transfer requires compensating cash or bank accounts', async () => {
      await asUser(db, ids.treasury);
      await assert.rejects(submit(db, 'bad-transfer-0001', lines('10.00'), 'transfer'), /dos cuentas de tesorería/);
      await submit(db, 'good-transfer-0001', lines('10.00', ids.cash, ids.bank), 'transfer');
    });

    await t.test('posted journal and evidence cannot be edited or deleted, even by operator SQL', async () => {
      await db.exec('reset role');
      await assert.rejects(db.query('delete from public.financial_transactions where id=$1', [posted!]), /inmutable/);
      await assert.rejects(db.query("update public.financial_transactions set description='Nueva descripción' where id=$1", [posted!]), /inmutable/);
      await assert.rejects(db.query('update public.transaction_entries set debit=999 where transaction_id=$1 and debit>0', [posted!]), /inmutable/);
      await assert.rejects(db.query('insert into public.transaction_entries(organization_id,location_id,transaction_id,account_id,debit,credit) values($1,$2,$3,$4,1,0)', [ids.org, ids.location, posted!, ids.bank]), /agregar partidas/);
      await assert.rejects(db.query('delete from public.audit_events'), /inmutable/);
    });

    await t.test('reversal must exactly offset the original and is unique', async () => {
      await asUser(db, ids.treasury);
      const reversed = lines().map(e => ({ account_id: e.account_id, debit: e.credit, credit: e.debit }));
      await assert.rejects(submit(db, 'bad-reversal-0001', lines('1.00'), 'reversal', posted!), /compensar exactamente/);
      const reversalId = await submit(db, 'good-reversal-0001', reversed, 'reversal', posted!);
      assert.equal((await db.query<{ status: string }>('select status from public.financial_transactions where id=$1', [reversalId])).rows[0].status, 'pending');
      await assert.rejects(submit(db, 'dup-reversal-0001', reversed, 'reversal', posted!), /one_reversal/);
      await asUser(db, ids.approver);
      await db.query('select public.decide_financial_transaction($1,true,$2)', [reversalId, 'Reverso revisado independientemente']);
      const original = await db.query<{ status: string }>('select status from public.financial_transactions where id=$1', [posted!]);
      assert.equal(original.rows[0].status, 'posted', 'Original remains immutable; balance includes compensating posting');
    });

    await t.test('auditor is read-only; revoked members and disabled profiles lose access immediately', async () => {
      await asUser(db, ids.auditor);
      assert.ok((await db.query('select * from public.account_balances')).rows.length > 0);
      await assert.rejects(submit(db, 'auditor-reject-0001'), /Acceso no autorizado/);
      await db.exec('reset role');
      await db.query('update public.organization_members set active=false where user_id=$1', [ids.treasury]);
      await asUser(db, ids.treasury);
      assert.equal((await db.query('select * from public.accounts')).rows.length, 0);
      await assert.rejects(submit(db, 'revoked-reject-0001'), /Acceso no autorizado/);
      await db.exec('reset role');
      await db.query('update public.organization_members set active=true where user_id=$1', [ids.treasury]);
      await db.query('update public.profiles set active=false where id=$1', [ids.treasury]);
      await asUser(db, ids.treasury);
      assert.equal((await db.query('select * from public.accounts')).rows.length, 0);
      await db.exec('reset role');
      await db.query('update public.profiles set active=true where id=$1', [ids.treasury]);
    });

    await t.test('debt allocations are atomic, pending until approved, and cannot overpay principal', async () => {
      await asUser(db, ids.owner);
      const debtResult = await db.query<{ id: string }>("select public.create_debt($1,$2,'Acreedor ficticio','loan','1000.00','2026-01-01','1.5',12,15,'fixed_payment') id", [ids.org, ids.location]);
      const debt = debtResult.rows[0].id;
      await assert.rejects(db.query("select public.record_debt_payment($1,$2,$3,$4,'2025-12-31','100.00','0.00','before-debt-0001','Pago cronológicamente inválido')", [debt, ids.cash, ids.liability, ids.expense]), /preceder al desembolso/);
      const args = [debt, ids.cash, ids.liability, ids.expense, '100.00', '15.00', 'debt-payment-0001'];
      const payResult = await db.query<{ id: string }>("select public.record_debt_payment($1,$2,$3,$4,'2026-01-02',$5,$6,$7,'Cuota ficticia') id", args);
      const payment = payResult.rows[0].id;
      const duplicate = await db.query<{ id: string }>("select public.record_debt_payment($1,$2,$3,$4,'2026-01-02',$5,$6,$7,'Cuota ficticia') id", args);
      assert.equal(duplicate.rows[0].id, payment);
      const row = (await db.query<{ transaction_id: string; status: string; total: string }>('select dp.transaction_id,dp.status,sum(pa.amount)::text total from public.debt_payments dp join public.payment_allocations pa on pa.payment_id=dp.id where dp.id=$1 group by dp.id', [payment])).rows[0];
      assert.equal(row.status, 'pending');assert.equal(row.total, '115.00');
      await assert.rejects(db.query("select public.record_debt_payment($1,$2,$3,$4,'2026-01-02','950.00','0.00','debt-overpay-0001','Pago ficticio')", [debt, ids.cash, ids.liability, ids.expense]), /excede el saldo/);
      await asUser(db, ids.approver);
      await db.query('select public.decide_financial_transaction($1,true,$2)', [row.transaction_id, 'Distribución y soporte revisados']);
      assert.equal((await db.query<{ status: string }>('select status from public.debt_payments where id=$1', [payment])).rows[0].status, 'posted');
      await asUser(db, ids.owner);
      await assert.rejects(submit(db, 'orphan-debtpay-0001', lines(), 'debt_payment'), /sin obligación ni distribución/);
      const finalPayment = (await db.query<{ id: string }>("select public.record_debt_payment($1,$2,$3,$4,'2026-01-02','900.00','0.00','debt-settle-0001','Pago final ficticio') id", [debt, ids.cash, ids.liability, ids.expense])).rows[0].id;
      const finalTx = (await db.query<{ transaction_id: string }>('select transaction_id from public.debt_payments where id=$1', [finalPayment])).rows[0].transaction_id;
      await asUser(db, ids.approver);
      await db.query('select public.decide_financial_transaction($1,true,$2)', [finalTx, 'Liquidación revisada y autorizada']);
      assert.equal((await db.query<{ status: string }>('select status from public.debts where id=$1', [debt])).rows[0].status, 'paid');
      assert.equal((await db.query<{ outstanding_principal: string }>('select outstanding_principal::text from public.debt_balances where debt_id=$1', [debt])).rows[0].outstanding_principal, '0.00');
      await asUser(db, ids.owner);
      const reverseLines = (await db.query<{ account_id: string; debit: string; credit: string }>('select account_id,credit::text debit,debit::text credit from public.transaction_entries where transaction_id=$1', [finalTx])).rows;
      const reverseFinal = await submit(db, 'debt-reverse-final-0001', reverseLines, 'reversal', finalTx);
      await asUser(db, ids.approver);
      await db.query('select public.decide_financial_transaction($1,true,$2)', [reverseFinal, 'Reverso de liquidación con revisión']);
      assert.equal((await db.query<{ status: string }>('select status from public.debts where id=$1', [debt])).rows[0].status, 'active');
      assert.equal((await db.query<{ outstanding_principal: string }>('select outstanding_principal::text from public.debt_balances where debt_id=$1', [debt])).rows[0].outstanding_principal, '900.00');
    });

    await t.test('reconciliation snapshots and permission changes retain audit evidence', async () => {
      await asUser(db, ids.owner);
      await db.query("select public.reconcile_account($1,'2026-01-02','-20.10','Extracto ficticio revisado')", [ids.cash]);
      await assert.rejects(db.query('select public.manage_member($1,$2,$3,true,true,$4,$5)', [ids.org, ids.owner, 'admin', [], 'Auto escalamiento']), /autopermiso/);
      const events = await db.query<{ count: number }>('select count(*)::int count from public.audit_events');
      assert.ok(events.rows[0].count > 10);
    });

    await t.test('private Storage policies enforce organization, location and immutable objects', async () => {
      await asUser(db, ids.treasury);
      const document = '50000000-0000-4000-8000-000000000001';
      const ownPath = `${ids.org}/${ids.location}/${document}/support.pdf`;
      const otherPath = `${ids.otherOrg}/${ids.otherLocation}/${document}/support.pdf`;
      await db.query("insert into storage.objects(bucket_id,name) values('financial-supports',$1)", [ownPath]);
      await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('financial-supports',$1)", [otherPath]), /row-level security/);
      await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('financial-supports','invalid/path.pdf')"), /row-level security/);
      await db.query("select public.register_financial_support($1,$2,$3,'Soporte ficticio.pdf','application/pdf',100,$4)", [ids.org, ids.location, ownPath, 'a'.repeat(64)]);
      await asUser(db, ids.outsider);
      assert.equal((await db.query('select * from storage.objects')).rows.length, 0);
      await asUser(db, ids.auditor);
      assert.equal((await db.query('select * from storage.objects')).rows.length, 1);
      await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('financial-supports',$1)", [ownPath.replace('support.pdf', 'second.pdf')]), /row-level security/);
    });

    await t.test('no SECURITY DEFINER function is exposed in public and anonymous cannot execute wrappers', async () => {
      await db.exec('reset role');
      const functions = await db.query('select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=\'public\' and p.prosecdef');
      assert.deepEqual(functions.rows, []);
      const balance = await db.query('select t.id from public.financial_transactions t left join public.transaction_entries e on e.transaction_id=t.id group by t.id having count(e.id)<2 or sum(e.debit)<>sum(e.credit)');
      assert.deepEqual(balance.rows, []);
    });
  } finally { await db.close(); }
});
