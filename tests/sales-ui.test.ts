import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SalesModule } from '../src/components/sales-module';
import { createEmptyState } from '../src/lib/finance';
import * as sales from '../src/lib/sales';

const state=createEmptyState();
const props={state,actor:state.members[0],location:'all',mutate:()=>{throw new Error('El render no escribe.');},notify:()=>{throw new Error('El render no notifica.');}};

test('Ventas renders every official area, empty metrics and direct creation actions without fabricated data',()=>{const before=JSON.stringify(state);const html=renderToStaticMarkup(createElement(SalesModule,props));for(const label of ['Resumen','Órdenes de pedido','Facturación','Cotizaciones','Vendedores externos','Garantías','Lotes','Listas de precios','Inventario de cierre','Comisiones','Clientes','Inventario disponible'])assert.match(html,new RegExp(label));for(const action of ['Nueva OP','Nueva cotización','Crear cliente'])assert.match(html,new RegExp(action));assert.match(html,/Cartera documentada/);assert.match(html,/\$ 0/);assert.equal(JSON.stringify(state),before);assert.equal(sales.getSalesState(state).orders.length,0);});

test('Ventas explains that invoices, quotes, payments and warranties do not silently affect Caja or Inventarios',()=>{const html=renderToStaticMarkup(createElement(SalesModule,props));for(const rule of ['Facturar nunca registra un cobro','Una cotización no reserva inventario','Los pagos externos no bajan cartera sin Caja','GAR no genera una segunda venta'])assert.match(html,new RegExp(rule));});

test('commercial navigation is accessible as a tablist with an explicit selected tab',()=>{const html=renderToStaticMarkup(createElement(SalesModule,props));assert.match(html,/role="tablist"/);assert.match(html,/role="tab"/);assert.match(html,/aria-selected="true"/);});
