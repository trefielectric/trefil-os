import type { AmortizationInput, AmortizationRow } from './types';
import { divideRounded, fromCents, rateFraction, toCents } from './money';

export function validateDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('La fecha debe tener formato AAAA-MM-DD.');
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('La fecha no existe.');
}

export function monthDate(startDate: string, monthOffset: number, dueDay?: number): string {
  validateDate(startDate);
  const [year, month, day] = startDate.split('-').map(Number);
  const base = new Date(Date.UTC(year, month - 1 + monthOffset, 1, 12));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0, 12)).getUTCDate();
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(dueDay ?? day, lastDay)).padStart(2, '0')}`;
}

function annuity(principal: bigint, numerator: bigint, denominator: bigint, periods: number): bigint {
  if (numerator === 0n) return divideRounded(principal, BigInt(periods));
  const growth = (denominator + numerator) ** BigInt(periods);
  const base = denominator ** BigInt(periods);
  return divideRounded(principal * numerator * growth, denominator * (growth - base));
}

/** Projections are separate from ledger payments. Currency rounding occurs per period. */
export function buildAmortization(input: AmortizationInput): AmortizationRow[] {
  const initialPrincipal = toCents(input.principal);
  if (initialPrincipal <= 0n) throw new Error('El capital debe ser mayor que cero.');
  if (!Number.isInteger(input.installments) || input.installments < 1 || input.installments > 600) throw new Error('El plazo debe ser de 1 a 600 cuotas.');
  if (!['fixed_payment', 'fixed_principal', 'interest_only'].includes(input.method)) throw new Error('Método de amortización inválido.');
  validateDate(input.startDate);
  if (input.dueDay !== undefined && (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 31)) throw new Error('El día de vencimiento debe estar entre 1 y 31.');
  const grace = input.graceMonths ?? 0;
  if (!Number.isInteger(grace) || grace < 0 || grace >= input.installments) throw new Error('La gracia debe ser menor que el plazo y no negativa.');
  let currentRate = input.monthlyRate;
  let rate = rateFraction(currentRate);
  const extras = new Map<number, bigint>();
  for (const extra of input.extraPayments ?? []) {
    if (!Number.isInteger(extra.period) || extra.period < 1 || extra.period > input.installments) throw new Error('El periodo del pago extraordinario está fuera del plazo.');
    const amount = toCents(extra.amount);
    if (amount < 0n) throw new Error('El pago extraordinario no puede ser negativo.');
    extras.set(extra.period, (extras.get(extra.period) ?? 0n) + amount);
  }
  const changes = new Map<number, string>();
  for (const change of input.rateChanges ?? []) {
    if (!Number.isInteger(change.period) || change.period < 1 || change.period > input.installments || changes.has(change.period)) throw new Error('El periodo del cambio de tasa es inválido o está duplicado.');
    rateFraction(change.monthlyRate);
    changes.set(change.period, change.monthlyRate);
  }
  let balance = initialPrincipal;
  let fixedPayment = annuity(balance, rate.numerator, rate.denominator, input.installments - grace);
  let fixedPrincipal = divideRounded(initialPrincipal, BigInt(input.installments - grace));
  const rows: AmortizationRow[] = [];
  for (let period = 1; period <= input.installments && balance > 0n; period++) {
    if (changes.has(period)) {
      currentRate = changes.get(period)!;
      rate = rateFraction(currentRate);
      fixedPayment = annuity(balance, rate.numerator, rate.denominator, input.installments - Math.max(period - 1, grace));
    }
    const interest = divideRounded(balance * rate.numerator, rate.denominator);
    let principal = 0n;
    if (period > grace) {
      principal = input.method === 'interest_only' ? (period === input.installments ? balance : 0n) : input.method === 'fixed_principal' ? fixedPrincipal : fixedPayment - interest;
      if (principal < 0n) throw new Error('La cuota no cubre los intereses.');
    }
    if (period === input.installments || principal > balance) principal = balance;
    const requestedExtra = extras.get(period) ?? 0n;
    const extra = requestedExtra > balance - principal ? balance - principal : requestedExtra;
    const openingBalance = balance;
    balance -= principal + extra;
    rows.push({ period, date: monthDate(input.startDate, period, input.dueDay), openingBalance: fromCents(openingBalance), payment: fromCents(principal + interest + extra), interest: fromCents(interest), principal: fromCents(principal + extra), extraPayment: fromCents(extra), balance: fromCents(balance), monthlyRate: currentRate, projected: true });
    if (extra > 0n && balance > 0n && period >= grace && period < input.installments) {
      fixedPayment = annuity(balance, rate.numerator, rate.denominator, input.installments - period);
      fixedPrincipal = divideRounded(balance, BigInt(input.installments - period));
    }
  }
  return rows;
}
