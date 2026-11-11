import { cashLogoDataUrl, excelMoney } from './cash-report-export';
import { add, formatCOP, fromCents, toCents } from './finance/money';
import type { DebtCategory, DebtModuleReport, DebtReportTotals } from './debts/types';

const NAVY = '1D3D6A',
  YELLOW = 'F8E62B',
  WHITE = 'FFFFFF';
export const debtReportCategoryLabels: Record<DebtCategory, string> = {
  bank: 'Entidades y fondos',
  investment: 'Inversionistas',
  supplier: 'Proveedores',
  recurring: 'Control de pagos',
};
export const debtReportRowStatusLabels = {
  pending_funding: 'Desembolso pendiente de confirmar',
  pending_authorization: 'Autorización institucional pendiente',
  current: 'Vigente',
  upcoming: 'Próxima a vencer',
  overdue: 'Vencida',
  partially_paid: 'Pagada parcialmente',
  paid: 'Cancelada',
};
export interface DebtReportExportOptions {
  companyName?: string;
  logoDataUrl?: string;
  closedByName?: string;
}
type Cell = string | number | null;
export interface DebtExportTable {
  name: string;
  headers: string[];
  rows: Cell[][];
  moneyColumns: number[];
  dateColumns?: number[];
}
const moneyFormat = '"$" #,##0.00;[Red]("$" #,##0.00);"$" 0.00';
export function debtReportIdentity(report: DebtModuleReport): string {
  let hash = 2166136261;
  const text = JSON.stringify(report);
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `DEUDAS-${report.startDate.slice(0, 7)}-V${report.version}-${report.category ?? 'consolidado'}-${(hash >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;
}
export function debtReportBridge(totals: DebtReportTotals) {
  const calculatedClosing = fromCents(
    toCents(totals.openingBalance) +
      toCents(totals.newObligations) -
      toCents(totals.principalPaid) -
      toCents(totals.noncashScrap) -
      toCents(totals.acceptedReturns) +
      toCents(totals.documentedAdjustments),
  );
  const componentTotal = add(
    totals.principalPaid,
    totals.interestPaid,
    totals.insurancePaid,
    totals.commissionPaid,
    totals.lateFeePaid,
  );
  return {
    calculatedClosing,
    difference: fromCents(toCents(totals.closingBalance) - toCents(calculatedClosing)),
    cashComponentDifference: fromCents(toCents(totals.cashPaid) - toCents(componentTotal)),
  };
}
export function debtReportStatus(report: DebtModuleReport): string {
  const prefix = report.status === 'closed' ? 'Cierre local conservado' : 'Borrador local';
  if (!report.reconciled) return `${prefix} · Con novedades por conciliar`;
  if (report.rows.some((row) => ['pending_funding', 'pending_authorization'].includes(row.status)))
    return `${prefix} · Documentación o autorización pendiente`;
  if (report.calendar.some((row) => toCents(row.remaining) > 0n))
    return `${prefix} · Pendientes por pagar conservados`;
  return `${prefix} · Sin pagos pendientes registrados`;
}
export function debtReportSummary(report: DebtModuleReport): [string, string][] {
  const totals = report.totals,
    bridge = debtReportBridge(totals);
  return [
    ['Saldo reconocido al inicio', totals.openingBalance],
    ['Altas / ORIGEN documentado del período', totals.newObligations],
    ['Capital o saldo de recibos pagado desde Caja', totals.principalPaid],
    ['Chatarra aplicada sin efectivo', totals.noncashScrap],
    ['Devoluciones aceptadas por el proveedor', totals.acceptedReturns],
    ['Ajustes documentados aplicados', totals.documentedAdjustments],
    ['Saldo reconocido al cierre', totals.closingBalance],
    ['Diferencia de comprobación de saldos', bridge.difference],
    ['Intereses pagados', totals.interestPaid],
    ['Seguros pagados', totals.insurancePaid],
    ['Comisiones y cargos pagados', totals.commissionPaid],
    ['Mora pagada', totals.lateFeePaid],
    ['Total de pagos reales aplicados desde Caja', totals.cashPaid],
    ['Diferencia entre pagos y sus componentes', bridge.cashComponentDifference],
  ];
}
export function debtReportTables(
  report: DebtModuleReport,
  options: DebtReportExportOptions = {},
): DebtExportTable[] {
  const rows = new Map(report.rows.map((row) => [row.debtId ?? row.billId ?? row.id, row]));
  const calendarLabels = {
    upcoming: 'Próxima a vencer',
    overdue: 'Vencida',
    partially_paid: 'Pagada parcialmente',
    paid: 'Cancelada',
    future: 'Programada según documento',
  };
  const sourceLabels = {
    official_installment: 'Cuota de plan oficial',
    supplier_invoice: 'Factura de proveedor',
    recurring_bill: 'Recibo recurrente recibido',
  };
  const requestLabels = {
    bank_origin: 'ORIGEN de entidad',
    investment_renegotiation: 'Renegociación de inversión',
    correction: 'Corrección',
    exceptional_adjustment: 'Ajuste excepcional',
    closed_period_change: 'Cambio de período cerrado',
  };
  const movementLabels = {
    cash_payment: 'Pago confirmado en Caja',
    scrap_offset: 'Chatarra aplicada sin efectivo',
    accepted_return: 'Devolución reconocida',
    new_obligation: 'Alta / ORIGEN documentado',
    opening: 'ORIGEN documentado',
    recurring_bill: 'Recibo recurrente recibido',
  };
  const tables: DebtExportTable[] = [
    {
      name: 'Resumen',
      headers: ['Concepto', 'Valor COP'],
      rows: debtReportSummary(report),
      moneyColumns: [2],
    },
    {
      name: 'Saldos por acreedor',
      headers: [
        'Categoría',
        'Acreedor',
        'Documento origen',
        'Concepto',
        'Saldo inicial COP',
        'Altas / ORIGEN COP',
        'Capital / recibos pagados COP',
        'Chatarra aplicada COP',
        'Devoluciones aceptadas COP',
        'Ajustes aplicados COP',
        'Saldo final COP',
        'Comprobación COP',
        'Estado',
      ],
      rows: report.rows.map((row) => [
        debtReportCategoryLabels[row.category],
        row.creditor,
        row.documentReference,
        row.concept,
        row.openingBalance,
        row.newObligations,
        row.principalPaid,
        row.noncashScrap,
        row.acceptedReturns,
        row.documentedAdjustments,
        row.closingBalance,
        debtReportBridge({ ...row }).difference,
        debtReportRowStatusLabels[row.status],
      ]),
      moneyColumns: [5, 6, 7, 8, 9, 10, 11, 12],
    },
    {
      name: 'Pagos y componentes',
      headers: [
        'Categoría',
        'Acreedor',
        'Documento origen',
        'Capital / recibos COP',
        'Intereses COP',
        'Seguros COP',
        'Comisiones y cargos COP',
        'Mora COP',
        'Total Caja aplicado COP',
        'Comprobación COP',
      ],
      rows: report.rows.map((row) => [
        debtReportCategoryLabels[row.category],
        row.creditor,
        row.documentReference,
        row.principalPaid,
        row.interestPaid,
        row.insurancePaid,
        row.commissionPaid,
        row.lateFeePaid,
        row.cashPaid,
        debtReportBridge({ ...row }).cashComponentDifference,
      ]),
      moneyColumns: [4, 5, 6, 7, 8, 9, 10],
    },
    {
      name: 'Movimientos',
      headers: [
        'Fecha efectiva',
        'Categoría',
        'Acreedor',
        'Documento origen',
        'Aplicación',
        'Referencia fuente',
        'Capital / abono COP',
        'Intereses COP',
        'Seguros COP',
        'Comisiones COP',
        'Mora COP',
        'Total aplicado COP',
        'Comprobante',
      ],
      rows: report.movements.map((row) => [
        row.date,
        debtReportCategoryLabels[row.category],
        row.creditor,
        row.documentReference,
        movementLabels[row.kind],
        row.sourceReference,
        row.principal,
        row.interest,
        row.insurance,
        row.commission,
        row.lateFee,
        row.total,
        row.supportName ?? null,
      ]),
      moneyColumns: [7, 8, 9, 10, 11, 12],
      dateColumns: [1],
    },
    {
      name: 'Vencimientos oficiales',
      headers: [
        'Categoría',
        'Acreedor',
        'Obligación / recibo',
        'Fuente documentada',
        'Vencimiento',
        'Valor programado COP',
        'Aplicado al corte COP',
        'Pendiente al corte COP',
        'Estado',
      ],
      rows: report.calendar.map((row) => [
        debtReportCategoryLabels[row.category],
        row.creditor,
        row.concept,
        sourceLabels[row.source],
        row.dueDate,
        row.amount,
        row.paidAmount,
        row.remaining,
        calendarLabels[row.status],
      ]),
      moneyColumns: [6, 7, 8],
      dateColumns: [5],
    },
    {
      name: 'Novedades',
      headers: [
        'Fecha',
        'Categoría',
        'Acreedor / documento',
        'Novedad',
        'Descripción',
        'Valor COP',
        'Estado',
      ],
      rows: report.issues.map((row) => [
        row.date,
        debtReportCategoryLabels[row.category],
        rows.get(row.debtId ?? row.billId ?? '')?.creditor ?? 'Obligación por identificar',
        row.title,
        row.description,
        row.amount ?? null,
        row.status === 'resolved' ? 'Resuelta' : 'Abierta',
      ]),
      moneyColumns: [6],
      dateColumns: [1],
    },
    {
      name: 'Conciliaciones',
      headers: [
        'Fecha',
        'Acreedor',
        'Extracto / referencia',
        'Capital según extracto COP',
        'Capital en libro COP',
        'Diferencia COP',
        'Estado',
        'Comprobante',
        'Observaciones',
      ],
      rows: report.reconciliations.map((row) => [
        row.date,
        rows.get(row.debtId)?.creditor ?? 'Acreedor registrado',
        row.reference,
        row.statementPrincipal,
        row.bookPrincipal,
        row.difference,
        row.status === 'matched' ? 'Sin diferencia registrada' : 'Diferencia abierta',
        row.support.name,
        row.notes,
      ]),
      moneyColumns: [4, 5, 6],
      dateColumns: [1],
    },
    {
      name: 'Planes documentados',
      headers: [
        'Acreedor',
        'Documento del plan',
        'Versión',
        'Vigente desde',
        'Cuota',
        'Vencimiento',
        'Capital COP',
        'Intereses COP',
        'Seguros COP',
        'Comisiones COP',
        'Mora COP',
        'Cuota total COP',
        'Comprobante',
        'Justificación de versión',
      ],
      rows: report.plans.flatMap((plan) =>
        plan.installments.map((row) => [
          rows.get(plan.debtId)?.creditor ?? 'Acreedor registrado',
          plan.reference,
          plan.version,
          plan.effectiveDate,
          row.number,
          row.dueDate,
          row.principal,
          row.interest,
          row.insurance,
          row.commission,
          row.lateFee,
          row.amount,
          plan.support.name,
          plan.reason,
        ]),
      ),
      moneyColumns: [7, 8, 9, 10, 11, 12],
      dateColumns: [4, 6],
    },
    {
      name: 'Autorizaciones pendientes',
      headers: [
        'Fecha efectiva',
        'Acreedor / recibo',
        'Solicitud',
        'Motivo',
        'Autoridad requerida',
        'Capital propuesto COP',
        'Comprobante',
        'Estado',
      ],
      rows: report.requests.map((row) => [
        row.effectiveDate,
        rows.get(row.debtId ?? row.billId ?? '')?.creditor ?? 'Origen pendiente',
        requestLabels[row.kind],
        row.reason,
        row.requiredAuthority === 'creator_or_manager'
          ? 'Creador o Gerente'
          : 'Matriz de autorización pendiente',
        row.proposedPrincipal ?? null,
        row.support.name,
        'Pendiente institucional; no aplicada',
      ]),
      moneyColumns: [6],
      dateColumns: [1],
    },
  ];
  if (report.status === 'closed')
    tables.push({
      name: 'Cierre local',
      headers: ['Dato', 'Registro'],
      rows: [
        ['Estado', debtReportStatus(report)],
        ['Período', `${report.startDate} al ${report.endDate}`],
        ['Versión', report.version],
        ['Fecha del cierre', report.closedAt ?? null],
        ['Responsable del cierre', options.closedByName ?? 'Responsable registrado'],
        ['Alcance', 'Cierre local; no equivale a autorización institucional autenticada'],
      ],
      moneyColumns: [],
    });
  return tables;
}

export async function createDebtsWorkbook(report: DebtModuleReport, options: DebtReportExportOptions = {}) {
  const module = await import('exceljs'),
    Workbook = module.Workbook ?? module.default.Workbook;
  const workbook = new Workbook();
  workbook.creator = options.companyName ?? 'TrefiElectric';
  workbook.title = debtReportIdentity(report);
  workbook.subject = 'Deudas y obligaciones documentadas';
  workbook.created = new Date(report.generatedAt);
  workbook.calcProperties.fullCalcOnLoad = true;
  const logo = options.logoDataUrl ?? (typeof window === 'undefined' ? undefined : await cashLogoDataUrl());
  const logoId = logo ? workbook.addImage({ base64: logo, extension: 'jpeg' }) : undefined;
  for (const table of debtReportTables(report, options)) {
    const sheet = workbook.addWorksheet(table.name, {
      views: [{ state: 'frozen', ySplit: 5 }],
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    for (const [rowIndex, text] of [
      [1, `${options.companyName ?? 'TrefiElectric'} · Deudas`],
      [2, `${report.startDate} al ${report.endDate} · ${debtReportStatus(report)}`],
      [3, debtReportIdentity(report)],
    ] as const) {
      sheet.mergeCells(rowIndex, 1, rowIndex, table.headers.length);
      sheet.getCell(rowIndex, 1).value = text;
      sheet.getRow(rowIndex).height = rowIndex === 1 ? 30 : 25;
      sheet.getRow(rowIndex).font = {
        name: 'Arial',
        size: rowIndex === 1 ? 16 : 10,
        bold: rowIndex === 1,
        color: { argb: rowIndex === 1 ? WHITE : NAVY },
      };
      if (rowIndex === 1)
        sheet.getCell(rowIndex, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    }
    sheet.getRow(5).values = table.headers;
    sheet.getRow(5).height = 38;
    sheet.getRow(5).font = { name: 'Arial', size: 10, bold: true, color: { argb: NAVY } };
    sheet.getRow(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } };
    sheet.getRow(5).alignment = { vertical: 'middle', wrapText: true };
    for (const [index, values] of table.rows.entries()) {
      const at = index + 6,
        row = sheet.getRow(at);
      row.values = values.map((value, column) =>
        value === null
          ? null
          : table.moneyColumns.includes(column + 1)
            ? excelMoney(String(value))
            : table.dateColumns?.includes(column + 1)
              ? new Date(String(value) + 'T12:00:00Z')
              : value,
      );
      row.font = { name: 'Arial', size: 10 };
      row.alignment = { vertical: 'top', wrapText: true };
      row.height = 36;
      if (index % 2 === 1) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F2F5F9' } };
      for (const column of table.moneyColumns) row.getCell(column).numFmt = moneyFormat;
      for (const column of table.dateColumns ?? []) row.getCell(column).numFmt = 'dd/mm/yyyy';
      if (table.name === 'Saldos por acreedor')
        row.getCell(12).value = {
          formula: `ROUND(K${at}-(E${at}+F${at}-G${at}-H${at}-I${at}+J${at}),2)`,
          result: excelMoney(String(values[11])),
        };
      if (table.name === 'Pagos y componentes')
        row.getCell(10).value = {
          formula: `ROUND(I${at}-SUM(D${at}:H${at}),2)`,
          result: excelMoney(String(values[9])),
        };
    }
    sheet.autoFilter = {
      from: { row: 5, column: 1 },
      to: { row: Math.max(5, table.rows.length + 5), column: table.headers.length },
    };
    sheet.columns.forEach((column, index) => {
      column.width = table.moneyColumns.includes(index + 1)
        ? 25
        : table.headers[index].includes('Motivo') ||
            table.headers[index].includes('Descripción') ||
            table.headers[index] === 'Concepto'
          ? 48
          : 31;
    });
    if (table.name === 'Resumen') {
      sheet.getColumn(1).width = 85;
      sheet.getRow(2).alignment = { vertical: 'middle', wrapText: true };
      sheet.getRow(2).height = 34;
    }
    if (logoId !== undefined)
      sheet.addImage(logoId, {
        tl: { col: table.headers.length - 1, row: 0 },
        ext: { width: 78, height: (78 * 631) / 628 },
        editAs: 'absolute',
      });
    sheet.headerFooter.oddFooter = '&LTrefiElectric · Deudas · COP&R Página &P de &N';
  }
  const summary = workbook.getWorksheet('Resumen')!,
    last = Math.max(6, report.rows.length + 5);
  for (const [cell, column, field] of [
    ['B6', 'E', 'openingBalance'],
    ['B7', 'F', 'newObligations'],
    ['B8', 'G', 'principalPaid'],
    ['B9', 'H', 'noncashScrap'],
    ['B10', 'I', 'acceptedReturns'],
    ['B11', 'J', 'documentedAdjustments'],
    ['B12', 'K', 'closingBalance'],
  ] as const)
    summary.getCell(cell).value = {
      formula: `ROUND(SUM('Saldos por acreedor'!${column}6:${column}${last}),2)`,
      result: excelMoney(report.totals[field]),
    };
  for (const [cell, column, field] of [
    ['B14', 'E', 'interestPaid'],
    ['B15', 'F', 'insurancePaid'],
    ['B16', 'G', 'commissionPaid'],
    ['B17', 'H', 'lateFeePaid'],
    ['B18', 'I', 'cashPaid'],
  ] as const)
    summary.getCell(cell).value = {
      formula: `ROUND(SUM('Pagos y componentes'!${column}6:${column}${last}),2)`,
      result: excelMoney(report.totals[field]),
    };
  summary.getCell('B13').value = {
    formula: 'ROUND(B12-(B6+B7-B8-B9-B10+B11),2)',
    result: excelMoney(debtReportBridge(report.totals).difference),
  };
  summary.getCell('B19').value = {
    formula: 'ROUND(B18-(B8+B14+B15+B16+B17),2)',
    result: excelMoney(debtReportBridge(report.totals).cashComponentDifference),
  };
  return workbook;
}

function saveDebtBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadDebtsExcel(report: DebtModuleReport, options: DebtReportExportOptions = {}) {
  const workbook = await createDebtsWorkbook(report, options),
    buffer = await workbook.xlsx.writeBuffer();
  saveDebtBlob(
    `${debtReportIdentity(report)}.xlsx`,
    new Blob([new Uint8Array(buffer)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
}

export async function createDebtsPdf(report: DebtModuleReport, options: DebtReportExportOptions = {}) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' }),
    logo = options.logoDataUrl ?? (await cashLogoDataUrl()),
    identity = debtReportIdentity(report);
  doc.setProperties({
    title: identity,
    subject: 'Deudas y obligaciones documentadas',
    author: options.companyName ?? 'TrefiElectric',
  });
  const header = () => {
    doc.setFillColor('#' + NAVY);
    doc.rect(0, 0, 297, 28, 'F');
    doc.setFillColor('#' + YELLOW);
    doc.rect(0, 28, 297, 2, 'F');
    doc.setFillColor('#FFFFFF');
    doc.roundedRect(12, 3, 22, 22, 1, 1, 'F');
    doc.addImage(logo, 'JPEG', 13, 4, 20, (20 * 631) / 628);
    doc.setTextColor('#FFFFFF');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Deudas y obligaciones', 40, 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(`${report.startDate} al ${report.endDate} · ${debtReportStatus(report)}`, 40, 21);
  };
  const all = debtReportTables(report, options),
    tables = all.filter(
      (table) =>
        table.rows.length ||
        ['Resumen', 'Saldos por acreedor', 'Vencimientos oficiales', 'Novedades'].includes(table.name),
    );
  const cashPayments = report.movements.filter((row) => row.kind === 'cash_payment');
  if (cashPayments.length) {
    const at = tables.findIndex((table) => table.name === 'Movimientos');
    tables.splice(at + 1, 0, {
      name: 'Detalle de pagos reales',
      headers: [
        'Fecha / fuente Caja',
        'Acreedor / documento',
        'Capital COP',
        'Intereses COP',
        'Seguros COP',
        'Comisiones COP',
        'Mora COP',
        'Total COP',
      ],
      rows: cashPayments.map((row) => [
        `${row.date}\n${row.sourceReference}`,
        `${row.creditor}\n${row.documentReference}`,
        row.principal,
        row.interest,
        row.insurance,
        row.commission,
        row.lateFee,
        row.total,
      ]),
      moneyColumns: [3, 4, 5, 6, 7, 8],
    });
  }
  for (const [index, source] of tables.entries()) {
    let startY =
      index === 0
        ? 43
        : ((doc as typeof doc & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 150) + 14;
    if (startY > 163) {
      doc.addPage();
      startY = 43;
    }
    const table: DebtExportTable =
      source.name === 'Saldos por acreedor'
        ? {
            ...source,
            headers: [
              'Acreedor / categoría',
              'Documento / concepto',
              'Inicial COP',
              'Altas / ORIGEN COP',
              'Capital pagado COP',
              'Chatarra COP',
              'Devolución COP',
              'Ajustes COP',
              'Final COP',
              'Estado',
            ],
            rows: source.rows.map((row) => [
              `${row[1]}\n${row[0]}`,
              `${row[2]}\n${row[3]}`,
              row[4],
              row[5],
              row[6],
              row[7],
              row[8],
              row[9],
              row[10],
              row[12],
            ]),
            moneyColumns: [3, 4, 5, 6, 7, 8, 9],
          }
        : source.name === 'Pagos y componentes'
          ? {
              ...source,
              headers: [
                'Acreedor / categoría',
                'Documento',
                'Capital / recibos COP',
                'Intereses COP',
                'Seguros COP',
                'Comisiones COP',
                'Mora COP',
                'Caja aplicado COP',
              ],
              rows: source.rows.map((row) => [
                `${row[1]}\n${row[0]}`,
                row[2],
                row[3],
                row[4],
                row[5],
                row[6],
                row[7],
                row[8],
              ]),
              moneyColumns: [3, 4, 5, 6, 7, 8],
            }
          : source.name === 'Movimientos'
            ? {
                ...source,
                headers: [
                  'Fecha',
                  'Acreedor / documento',
                  'Aplicación',
                  'Fuente documental',
                  'Capital / abono COP',
                  'Total COP',
                  'Comprobante',
                ],
                rows: source.rows.map((row) => [
                  row[0],
                  `${row[2]}\n${row[3]}`,
                  row[4],
                  row[5],
                  row[6],
                  row[11],
                  row[12],
                ]),
                moneyColumns: [5, 6],
              }
            : source.name === 'Planes documentados'
              ? {
                  ...source,
                  headers: [
                    'Acreedor / plan',
                    'Versión / cuota',
                    'Vencimiento',
                    'Capital COP',
                    'Intereses COP',
                    'Seguros COP',
                    'Comisiones COP',
                    'Mora COP',
                    'Total COP',
                    'Comprobante',
                  ],
                  rows: source.rows.map((row) => [
                    `${row[0]}\n${row[1]}`,
                    `V${row[2]} · ${row[4]}`,
                    row[5],
                    row[6],
                    row[7],
                    row[8],
                    row[9],
                    row[10],
                    row[11],
                    row[12],
                  ]),
                  moneyColumns: [4, 5, 6, 7, 8, 9],
                }
              : source;
    autoTable(doc, {
      startY,
      columnStyles: Object.fromEntries(
        table.moneyColumns.map((column) => [column - 1, { halign: 'right' as const }]),
      ),
      margin: { left: 12, right: 12, top: 43, bottom: 17 },
      head: [table.headers],
      body: table.rows.length
        ? table.rows.map((row) =>
            row.map((value, column) =>
              value === null
                ? '-'
                : table.moneyColumns.includes(column + 1)
                  ? formatCOP(String(value), { decimals: true }).replace('−', '-')
                  : String(value),
            ),
          )
        : [['Sin registros documentados en este alcance', ...table.headers.slice(1).map(() => '-')]],
      styles: {
        font: 'helvetica',
        fontSize: 7.5,
        cellPadding: 2.2,
        overflow: 'linebreak',
        lineColor: '#E0E5EC',
        lineWidth: 0.1,
        textColor: '#223249',
      },
      headStyles: { fillColor: '#' + NAVY, textColor: '#FFFFFF' },
      alternateRowStyles: { fillColor: '#F2F5F9' },
      rowPageBreak: 'avoid',
      showHead: 'everyPage',
      willDrawPage: (data) => {
        header();
        doc.setFont('helvetica', 'bold');
        doc.setTextColor('#' + NAVY);
        doc.setFontSize(12);
        doc.text(table.name, 12, data.pageNumber === 1 ? startY - 5 : 38);
      },
    });
  }
  for (let page = 1; page <= doc.getNumberOfPages(); page++) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor('#64748B');
    doc.setFontSize(7);
    doc.text(identity, 12, 202);
    doc.text(`Página ${page} de ${doc.getNumberOfPages()}`, 285, 202, { align: 'right' });
  }
  return doc;
}
export async function downloadDebtsPdf(report: DebtModuleReport, options: DebtReportExportOptions = {}) {
  const doc = await createDebtsPdf(report, options);
  doc.save(`${debtReportIdentity(report)}.pdf`);
}
