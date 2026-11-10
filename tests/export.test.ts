import test from 'node:test';
import assert from 'node:assert/strict';
import {csvCell,transactionsCSV} from '../src/lib/export';
import {createDemoState} from '../src/lib/finance';

test('CSV neutralizes spreadsheet formulas including leading whitespace and BOM',()=>{
  for(const value of ['=1+1','+1','-1','@SUM(A1)','  =HYPERLINK("x")','\uFEFF=1','\t1','\n=1'])assert.equal(csvCell(value),'"\''+value.replaceAll('"','""')+'"');
  assert.equal(csvCell('Factura; "Demo"'),'"Factura; ""Demo"""');
});
test('CSV exports one exact decimal row per journal entry and labels its status',()=>{
  const state=createDemoState();const tx=state.transactions.find(t=>t.status==='pending')!;
  const csv=transactionsCSV(state,[tx]);
  assert.ok(csv.startsWith('\uFEFF"Referencia";"Fecha"'));
  assert.equal(csv.split('\r\n').length,tx.entries.length+1);
  assert.ok(csv.includes('"pending"'));
  assert.ok(csv.includes('"6200000.00"'));
  assert.ok(!csv.includes('6200000.000000'));
});
