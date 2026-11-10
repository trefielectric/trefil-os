import type { State, Transaction } from './finance';

export function csvCell(value: string): string {
  const safe = /^[\s\uFEFF]*[=+\-@]/u.test(value)||/^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function transactionsCSV(state: State, transactions: Transaction[]): string {
  const rows = [['Referencia','Fecha','Tipo','Descripción','Tercero','Categoría','Sede','Estado','Valor COP','Cuenta','Débito COP','Crédito COP','Solicitante','Aprobador','Reverso de']];
  for (const tx of transactions) for (const entry of tx.entries) rows.push([
    tx.reference,tx.date,tx.kind,tx.description,tx.party,tx.category,
    state.locations.find(l=>l.id===tx.locationId)?.name??tx.locationId,tx.status,tx.amount,
    state.accounts.find(a=>a.id===entry.accountId)?.name??entry.accountId,entry.debit,entry.credit,
    tx.requestedBy,tx.approvedBy??'',tx.reversalOf??'',
  ]);
  return '\uFEFF'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n');
}
export function downloadFile(name: string, content: string, type = 'text/csv;charset=utf-8') {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const anchor=document.createElement('a'); anchor.href=url; anchor.download=name; anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
