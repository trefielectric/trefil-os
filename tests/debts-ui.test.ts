import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DebtsModule, DebtModuleModal, DebtDossierDetail } from '../src/components/debts-module';
import { SimulatorModal } from '../src/components/debt-view';
import { createEmptyState } from '../src/lib/finance/empty';
import { createDebt, todayBogota } from '../src/lib/finance/engine';
import { getDebtModuleState } from '../src/lib/debts';
import type { State } from '../src/lib/finance/types';

const noWrite = () => {
  throw new Error('Rendering may not write records or announce success');
};
const props = (state: State) => ({
  state,
  actor: state.members[0],
  location: 'all',
  mutate: noWrite,
  notify: noWrite,
});
const modal = (
  state: State,
  action: Parameters<typeof DebtModuleModal>[0]['action'],
  category: Parameters<typeof DebtModuleModal>[0]['category'] = 'entities',
) =>
  renderToStaticMarkup(
    createElement(DebtModuleModal, {
      ...props(state),
      category,
      action,
      month: todayBogota().slice(0, 7),
      onClose: () => {},
    }),
  );
function legacyDebt() {
  const empty = createEmptyState();
  return createDebt(
    empty,
    {
      creditor: 'Acreedor aislado para contrato UI',
      kind: 'loan',
      principal: '1000.00',
      monthlyRate: '1.00',
      installments: 2,
      startDate: '2026-10-01',
      dueDay: 15,
      method: 'fixed_principal',
      locationId: 'sede-principal',
    },
    empty.members[0],
  );
}

test('Deudas starts with four empty categories and accessible tabs without creating an obligation', () => {
  const state = createEmptyState();
  const before = JSON.stringify(state);
  const html = renderToStaticMarkup(
    createElement(DebtsModule, {
      ...props(state),
      integrations: createElement('p', null, 'Puente de documentos'),
      reports: createElement('p', null, 'Informes por corte'),
    }),
  );
  for (const label of [
    'Entidades financieras',
    'Inversionistas',
    'Proveedores',
    'Control de pagos',
    'Cartera y fichas',
    'ORIGEN y planes',
    'Pagos y conciliación',
    'Agenda de vencimientos',
    'Cierre mensual',
    'Informes',
    'Integraciones',
  ])
    assert.ok(html.includes(label), label);
  assert.match(html, /Todavía no hay obligaciones en esta categoría/);
  assert.match(html, /registro local|Registro local/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /role="tabpanel"/);
  assert.match(html, /aria-controls=/);
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.debts.length, 0);
  assert.equal(state.debtPayments.length, 0);
  assert.equal(state.transactions.length, 0);
  assert.equal(state.audit.length, 0);
  assert.equal(getDebtModuleState(state).officialPlans.length, 0);
});

test('bank dossier requires statement and official plan and never presents local historical authorization', () => {
  const state = createEmptyState();
  const html = modal(state, 'dossier');
  assert.match(html, /Extracto obligatorio de la entidad/);
  assert.match(html, /Plan de amortización oficial obligatorio/);
  assert.match(html, /ORIGEN bancario histórico: solicitar autorización/);
  assert.match(html, /no crea otro desembolso/);
  assert.doesNotMatch(html, /Aprobar con código|PIN|Cambiar perfil|Autorizar ahora/);
  assert.doesNotMatch(html, /name="principal"[^>]*value="0/);
});

test('investor dossier preserves initial receipt and contract as separate required documents', () => {
  const html = modal(createEmptyState(), 'dossier', 'investors');
  assert.match(html, /Contrato o acuerdo original/);
  assert.match(html, /Recibo inicial del dinero obligatorio/);
  assert.match(html, /Regla contractual de intereses/);
  assert.match(html, /Fecha pactada de terminación/);
  assert.match(html, /no duplica el ingreso de dinero/);
});

test('official plan editor leaves all five component amounts absent until explicitly entered', () => {
  const html = modal(legacyDebt(), 'plan');
  for (const label of ['Capital COP', 'Interés COP', 'Seguro COP', 'Comisión COP', 'Mora COP'])
    assert.ok(html.includes(label));
  assert.equal((html.match(/placeholder="Sin informar"/g) ?? []).length, 5);
  assert.doesNotMatch(html, /value="0(?:\.00)?"/);
  assert.match(html, /no calcula ni inventa intereses/);
  assert.match(html, /Conservar nueva versión oficial/);
  assert.match(html, /Añadir cuota documentada/);
});

test('monthly receipts require manual amount and due date and do not equate missing consumption to zero', () => {
  const html = modal(createEmptyState(), 'bill', 'recurring');
  assert.match(html, /Valor realmente cobrado/);
  assert.match(html, /Vencimiento consignado en el recibo/);
  assert.match(html, /Sin dato si no aplica/);
  assert.match(html, /Fecha de recepción confirmada/);
  assert.match(html, /Factura o recibo mensual recibido/);
  assert.doesNotMatch(html, /name="consumption"[^>]*value="0/);
  assert.doesNotMatch(html, /name="amount"[^>]*value="0/);
});

test('renegotiation captures a pending proposal without editing original principal or offering fake approval', () => {
  const state = legacyDebt();
  const before = JSON.stringify(state);
  const html = modal(state, 'renegotiate', 'investors');
  assert.match(html, /Guardar solicitud pendiente/);
  assert.match(html, /autorización institucional de Creador o Gerente/);
  assert.match(html, /no cambia capital/);
  assert.match(html, /Vigencia|vigencia/);
  assert.doesNotMatch(html, /Aplicar renegociación|Aprobar ahora|PIN/);
  assert.equal(JSON.stringify(state), before);
});

test('linking an existing cash payment has an explicit empty source and separate capital and interest', () => {
  const html = modal(legacyDebt(), 'cashlink');
  assert.match(html, /Capital pagado/);
  assert.match(html, /Interés pagado/);
  assert.match(html, /Seguro pagado/);
  assert.match(html, /Comisión o cargos pagados/);
  assert.match(html, /Mora pagada/);
  assert.match(html, /Selecciona el comprobante/);
  assert.match(html, /sin duplicarlo/);
  assert.match(html, /disabled=""/);
});

test('legacy obligations remain visible without being relabeled as officially documented', () => {
  const state = legacyDebt();
  const before = JSON.stringify(state);
  const html = renderToStaticMarkup(createElement(DebtsModule, props(state)));
  assert.match(html, /Acreedor aislado para contrato UI/);
  assert.match(html, /Expediente incompleto/);
  assert.match(html, /Sin vencimiento oficial pendiente registrado/);
  assert.equal(JSON.stringify(state), before);
});

test('unsafe legacy evidence cannot become an executable download link', () => {
  const state = legacyDebt();
  state.debts[0].contract = {
    name: 'Documento no confiable.pdf',
    type: 'application/pdf',
    size: 1,
    dataUrl: 'javascript:alert(1)',
  };
  const html = renderToStaticMarkup(
    createElement(DebtDossierDetail, {
      ...props(state),
      debtId: state.debts[0].id,
      onClose: () => {},
      onPlan: () => {},
      onRenegotiate: () => {},
    }),
  );
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /Archivo no disponible/);
});

test('simulator remains a separate projection and never writes a real debt', () => {
  const state = createEmptyState();
  const before = JSON.stringify(state);
  const html = renderToStaticMarkup(createElement(SimulatorModal, { notify: noWrite, onClose: () => {} }));
  assert.match(html, /Simulador de financiación/);
  assert.match(html, /Calcular proyección/);
  assert.doesNotMatch(html, /Registrar obligación|Aplicar pago|Guardar plan oficial/);
  assert.equal(JSON.stringify(state), before);
});

test('supplier directory captures a real unique identity and contact without any automatic balance', () => {
  const html = modal(createEmptyState(), 'supplier', 'suppliers');
  for (const label of [
    'Identificación tributaria o documento',
    'Nombre legal del proveedor',
    'Persona de contacto',
    'Correo de contacto',
    'Teléfono',
    'Sede de la obligación',
  ])
    assert.ok(html.includes(label));
  assert.match(html, /Registrar tercero sin crear saldo/);
  assert.doesNotMatch(html, /name="principal"|name="amount"/);
});

test('historical supplier origin requires a manual maturity, evidence and the separate balance cutoff', () => {
  const html = modal(createEmptyState(), 'supplier_origin', 'suppliers');
  assert.match(html, /Vencimiento pactado de esta factura/);
  assert.match(html, /Saldo realmente pendiente al ORIGEN/);
  assert.match(html, /Fecha de corte del saldo histórico/);
  assert.match(html, /Soporte del saldo inicial de proveedor/);
  assert.match(html, /Documentar ORIGEN sin Caja ni stock/);
  assert.doesNotMatch(html, /name="principal"[^>]*value="0/);
});
