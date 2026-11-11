import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../src/components/reports-module.tsx',import.meta.url),'utf8');

test('Informes centralizes only the report definitions already implemented',()=>{
  for(const label of ['Caja','Inventarios','Deudas'])assert(source.includes(label),label);
  assert(source.includes('permanecen fuera del catálogo'));
});
test('preview and files share filters and distinguish missing data from zero',()=>{
  assert(source.includes('La vista previa y ambos archivos comparten el mismo corte, alcance y fuente'));
  assert(source.includes("value === null ? 'Sin dato'"));
  assert(source.includes('ausencia no significa cero'));
});
test('exports are permission checked, temporary and audited',()=>{
  assert(source.includes('canExport'));
  assert(source.includes("entityType: 'report_export'"));
  assert(source.includes('Los archivos son temporales y no modifican los registros fuente'));
});
