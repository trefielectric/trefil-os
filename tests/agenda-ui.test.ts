import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../src/components/agenda-module.tsx',import.meta.url),'utf8');

test('Agenda Financiera exposes every official workspace section',()=>{for(const label of ['Panel general','Calendario','Obligaciones','Pendientes proveedores','Verificación','Seguimiento de pagos','Historial','Configuración'])assert(source.includes(label),label);});
test('the empty interface states that no obligations are fabricated by other modules',()=>{assert(source.includes('La Agenda empieza limpia'));assert(source.includes('no se crean compromisos desde Compras, Nómina u otros módulos'));});
test('the interface identifies Caja as the real payment source and preserves contractual dates',()=>{assert(source.includes('Vincular Caja'));assert(source.includes('egreso real'));assert(source.includes('La fecha contractual se conserva'));});
