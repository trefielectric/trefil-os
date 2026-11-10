/** Approved Caja catalogue, specification dated 10 November 2026. */
export const CASH_CATALOG_VERSION = '2026-11-10';

export type CashCategoryDirection = 'income' | 'expense' | 'transfer';

export interface CashExpenseCategory {
  readonly id: string;
  readonly name: string;
  readonly groupId: string;
  readonly direction: 'expense' | 'transfer';
}

export interface CashCategoryGroup {
  readonly id: string;
  readonly name: string;
  readonly categories: readonly CashExpenseCategory[];
}

export interface CashIncomeCategory {
  readonly id: string;
  readonly name: string;
  readonly direction: 'income' | 'transfer';
  readonly enabled: boolean;
  readonly decisionStatus: 'approved' | 'pending';
  readonly semantic?: 'receivable_collection';
  readonly pendingReason?: string;
}

function group(id: string, name: string, rows: readonly (readonly [string, string])[], direction: 'expense' | 'transfer' = 'expense'): CashCategoryGroup {
  return Object.freeze({
    id,
    name,
    categories: Object.freeze(rows.map(([categoryId, categoryName]) => Object.freeze({ id: categoryId, name: categoryName, groupId: id, direction }))),
  });
}

/** The 11 approved groups and 67 definitive outflow categories, without balances or sample movements. */
export const CASH_CATALOG: readonly CashCategoryGroup[] = Object.freeze([
  group('produccion-insumos', 'Producción e insumos', [
    ['adquisicion-insumos', 'Adquisición de insumos'],
    ['compra-nylon', 'Compra de nylon'],
    ['compra-pigmentos', 'Compra de pigmentos'],
    ['compra-amarres', 'Compra de amarres'],
    ['compra-bolsas-centel', 'Compra de bolsas Centel'],
    ['compra-etiquetas-centel', 'Compra de etiquetas Centel'],
    ['compra-pvc-segunda', 'Compra de PVC de segunda'],
    ['compra-pvc-original', 'Compra de PVC original'],
    ['compras-cobre-aluminio', 'Compras de cobre y aluminio'],
    ['insumos-empaque', 'Insumos de empaque'],
    ['insumos-varios', 'Insumos varios'],
    ['repuestos-maquinas', 'Repuestos de máquinas'],
    ['tiner-sustancias', 'Tíner y sustancias'],
  ]),
  group('personal-obligaciones-laborales', 'Personal y obligaciones laborales', [
    ['adelantos-nomina', 'Adelantos de nómina'],
    ['alimentacion-extras', 'Alimentación extras'],
    ['alimentacion-general', 'Alimentación general'],
    ['bonificaciones', 'Bonificaciones'],
    ['comisiones-ventas', 'Comisiones de ventas'],
    ['dotacion', 'Dotación'],
    ['nomina-aseo', 'Nómina de aseo'],
    ['nomina-seguridad', 'Nómina de seguridad'],
    ['nomina-administrativa', 'Nómina administrativa'],
    ['nomina-operativa', 'Nómina operativa'],
    ['pagos-salud', 'Pagos de salud'],
  ]),
  group('administracion-funcionamiento', 'Administración y funcionamiento', [
    ['agua', 'Agua'],
    ['arreglos-locativos', 'Arreglos locativos'],
    ['arriendo', 'Arriendo'],
    ['botellones-agua', 'Botellones de agua'],
    ['documentacion', 'Documentación'],
    ['gas', 'Gas'],
    ['insumos-aseo', 'Insumos de aseo'],
    ['internet', 'Internet'],
    ['luz', 'Luz'],
    ['mantenimiento-tecnologico', 'Mantenimiento tecnológico'],
    ['papeleria-varios', 'Papelería y varios'],
    ['seguridad', 'Seguridad'],
    ['sistema-alegra', 'Sistema Alegra'],
  ]),
  group('publicidad-ventas', 'Publicidad y ventas', [
    ['patrocinio-donaciones', 'Patrocinio y donaciones'],
    ['publicidad-digital', 'Publicidad digital'],
    ['publicidad-fisica', 'Publicidad física'],
  ]),
  group('vehiculos-transporte', 'Vehículos y transporte', [
    ['combustibles', 'Combustibles'],
    ['impuesto-vehiculos', 'Impuesto de vehículos'],
    ['mantenimiento-vehiculos', 'Mantenimiento de vehículos'],
    ['pagos-vehiculos', 'Pagos de vehículos'],
    ['repuestos-vehiculos', 'Repuestos de vehículos'],
    ['transporte', 'Transporte'],
  ]),
  group('impuestos-gastos-financieros', 'Impuestos y gastos financieros', [
    ['camara-comercio', 'Cámara de Comercio'],
    ['gastos-bancarios', 'Gastos bancarios'],
    ['gmf-cargos-nequi', 'GMF y cargos de Nequi'],
    ['impuestos', 'Impuestos'],
  ]),
  group('compras-adquisiciones', 'Compras y adquisiciones', [
    ['mercury', 'Mercury'],
    ['nuevas-adquisiciones', 'Nuevas adquisiciones'],
  ]),
  group('financiacion-fondos', 'Financiación y fondos', [
    ['abonos-capital-fondeprinter', 'Abonos a capital Fondeprinter'],
    ['abonos-capital-inversionistas', 'Abonos a capital de inversionistas'],
    ['cuota-fondeprinter', 'Cuota Fondeprinter'],
    ['cuota-inversionistas', 'Cuota de inversionistas'],
    ['cuotas-creditos-bancarios', 'Cuotas de créditos bancarios'],
    ['pago-davivienda-credito-fijo', 'Pago deuda bancaria – Davivienda crédito fijo'],
    ['pago-davivienda-rotativo', 'Pago deuda bancaria – Davivienda rotativo'],
  ]),
  group('otros-activos', 'Otros activos', [
    ['ahorro-fondetrefil', 'Ahorro Fondetrefil'],
    ['prestamos-el-lloradero', 'Préstamos a El Lloradero'],
  ]),
  group('otros-movimientos', 'Otros movimientos', [
    ['abonos-clemente', 'Abonos Clemente'],
    ['salidas-devoluciones', 'Devoluciones'],
    ['especial-estrefi', 'Especial Estrefi'],
    ['especiales-trefil', 'Especiales Trefil'],
    ['salidas-varias', 'Salidas varias'],
  ]),
  group('movimientos-internos', 'Movimientos internos', [
    ['retiro-entre-cuentas', 'Retiro entre cuentas'],
  ], 'transfer'),
]);

export const CASH_EXPENSE_CATEGORIES: readonly CashExpenseCategory[] = Object.freeze(CASH_CATALOG.flatMap(item => item.categories));

/** Incoming labels; internal withdrawals remain transfers rather than external income. */
export const CASH_INCOME_CATALOG: readonly CashIncomeCategory[] = Object.freeze([
  { id: 'ventas-regulares', name: 'Ventas regulares', direction: 'income', enabled: true, decisionStatus: 'approved' },
  { id: 'abono-trabajos', name: 'Abono a trabajos', direction: 'income', enabled: true, decisionStatus: 'approved' },
  { id: 'entradas-devoluciones', name: 'Devoluciones', direction: 'income', enabled: true, decisionStatus: 'approved' },
  { id: 'inversiones', name: 'Inversiones', direction: 'income', enabled: true, decisionStatus: 'approved' },
  { id: 'prestamos', name: 'Préstamos', direction: 'income', enabled: true, decisionStatus: 'approved' },
  { id: 'venta-activos', name: 'Venta de activos', direction: 'income', enabled: true, decisionStatus: 'approved' },
  { id: 'pago-deudas', name: 'Pago de deudas', direction: 'income', enabled: true, decisionStatus: 'approved', semantic: 'receivable_collection' },
  { id: 'retiro-cuenta', name: 'Retiro de cuenta', direction: 'transfer', enabled: true, decisionStatus: 'approved' },
  { id: 'retiro-pasarela-pagos', name: 'Retiro desde pasarela de pagos', direction: 'transfer', enabled: true, decisionStatus: 'approved' },
].map(item => Object.freeze(item)) as CashIncomeCategory[]);

export const CASH_OUTFLOW_GROUPS = CASH_CATALOG;
export const CASH_INFLOW_CATEGORIES = CASH_INCOME_CATALOG;

/** A temporary legalization state, never one of the 67 definitive categories. */
export const CASH_TEMPORARY_CATEGORY = Object.freeze({ id: 'por-legalizar', name: 'POR LEGALIZAR', definitive: false as const });

function comparable(value: string): string {
  return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toLocaleLowerCase('es-CO');
}

export function findCashCategory(idOrName: string): CashExpenseCategory | undefined {
  const candidate = comparable(idOrName);
  return CASH_EXPENSE_CATEGORIES.find(item => comparable(item.id) === candidate || comparable(item.name) === candidate);
}

export function findCashIncomeCategory(idOrName: string): CashIncomeCategory | undefined {
  const candidate = comparable(idOrName);
  return CASH_INCOME_CATALOG.find(item => comparable(item.id) === candidate || comparable(item.name) === candidate);
}

/** The sole approved automatic classification rule; it never overwrites a supplied category. */
export function suggestCashCategory(category: string | null | undefined, observations: string): CashExpenseCategory | undefined {
  if (category?.trim()) return findCashCategory(category);
  if (comparable(observations) === 'gastos bancarios') return findCashCategory('gastos-bancarios');
  return undefined;
}
