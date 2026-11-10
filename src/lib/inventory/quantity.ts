import { fromCents, toCents } from '../finance/money';
import type { Money } from '../finance/types';
import type { InventoryItem, Quantity } from './types';
const SCALE=1000000n;
export function quantity(value:string|bigint):Quantity {if(typeof value==='bigint')return fromMicros(value);if(typeof value!=='string'||! /^-?\d+(?:\.\d{1,6})?$/.test(value.trim()))throw new Error('La cantidad debe ser decimal exacta con máximo seis decimales.');const raw=value.trim();const negative=raw.startsWith('-');const [whole,fraction='']=raw.replace(/^-/,'').split('.');return fromMicros((BigInt(whole)*SCALE+BigInt(fraction.padEnd(6,'0')))*(negative?-1n:1n));}
export function toMicros(value:Quantity):bigint {const normalized=quantity(value);const negative=normalized.startsWith('-');return BigInt(normalized.replace('-','').replace('.',''))*(negative?-1n:1n);}
export function fromMicros(value:bigint):Quantity {const negative=value<0n;const absolute=negative?-value:value;if(absolute>999999999999999999999n)throw new Error('La cantidad excede el límite admitido.');return `${negative?'-':''}${absolute/SCALE}.${String(absolute%SCALE).padStart(6,'0')}`;}
export function addQuantity(...values:Quantity[]):Quantity{return fromMicros(values.reduce((sum,value)=>sum+toMicros(value),0n));}
export function subtractQuantity(left:Quantity,right:Quantity):Quantity{return fromMicros(toMicros(left)-toMicros(right));}
export function validateItemQuantity(item:Pick<InventoryItem,'inventoryType'|'unit'>,value:Quantity,positive=true):Quantity {const result=quantity(value);const units=toMicros(result);if(positive?units<=0n:units<0n)throw new Error('La cantidad debe ser positiva o cero únicamente en conteos físicos.');if((item.inventoryType==='asset'||item.inventoryType==='finished'||item.unit==='unit')&&units%SCALE!==0n)throw new Error('Este producto o activo requiere unidades enteras.');return result;}
export function quantityValue(value:Quantity,unitPrice:Money):Money {const product=toMicros(value)*toCents(unitPrice);const sign=product<0n?-1n:1n;const absolute=product<0n?-product:product;return fromCents(((absolute+SCALE/2n)/SCALE)*sign);}
