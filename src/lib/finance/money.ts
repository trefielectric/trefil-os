import type { Money } from './types';

const MAX_CENTS = 999999999999999999n;

/** Canonical decimal strings only; never convert financial input through Number. */
export function toCents(value: Money): bigint {
  if (typeof value !== 'string' || !/^-?\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error('El valor debe ser un decimal válido con máximo dos decimales.');
  const normalized = value.trim();
  const negative = normalized.startsWith('-');
  const [whole, fraction = ''] = normalized.replace(/^-/, '').split('.');
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (result > MAX_CENTS) throw new Error('El valor excede numeric(18,2).');
  return negative ? -result : result;
}

export function fromCents(value: bigint): Money {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  if (abs > MAX_CENTS) throw new Error('El resultado excede numeric(18,2).');
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

export function money(value: Money | bigint): Money { return typeof value === 'bigint' ? fromCents(value) : fromCents(toCents(value)); }
export function add(...values: Money[]): Money { return fromCents(values.reduce((sum, value) => sum + toCents(value), 0n)); }
export function sub(left: Money, right: Money): Money { return fromCents(toCents(left) - toCents(right)); }
export function compare(left: Money, right: Money): -1 | 0 | 1 { const difference = toCents(left) - toCents(right); return difference < 0n ? -1 : difference > 0n ? 1 : 0; }
export function abs(value: Money): Money { const cents = toCents(value); return fromCents(cents < 0n ? -cents : cents); }

/** Integer quotient rounded to the nearest cent, halves away from zero. */
export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('El divisor debe ser positivo.');
  const negative = numerator < 0n;
  const value = negative ? -numerator : numerator;
  const result = (value + denominator / 2n) / denominator;
  return negative ? -result : result;
}

export function rateFraction(rate: string): { numerator: bigint; denominator: bigint } {
  if (typeof rate !== 'string' || !/^\d+(\.\d{1,8})?$/.test(rate)) throw new Error('La tasa mensual debe ser un porcentaje decimal positivo.');
  const [whole, fraction = ''] = rate.split('.');
  const scale = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole) * scale + BigInt(fraction || '0');
  if (numerator > 100n * scale) throw new Error('La tasa mensual no puede superar el 100 %.');
  return { numerator, denominator: scale * 100n };
}

export function calculateInterest(principal: Money, monthlyRate: string): Money {
  const rate = rateFraction(monthlyRate);
  return fromCents(divideRounded(toCents(principal) * rate.numerator, rate.denominator));
}

export function formatCOP(value: Money, options: { decimals?: boolean } = {}): string {
  const cents = toCents(value);
  const negative = cents < 0n;
  const positive = negative ? -cents : cents;
  const integer = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(positive / 100n);
  const fractional = positive % 100n;
  return `${negative ? '−' : ''}$ ${integer}${options.decimals || fractional !== 0n ? `,${fractional.toString().padStart(2, '0')}` : ''}`;
}
