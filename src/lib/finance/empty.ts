import type { State } from './types';

/** A fresh local workspace has no sample accounts, people, money or documents. */
export function createEmptyState(): State {
  return {
    version: 1,
    organization: { id: 'local-trefil-electric', name: 'Trefil Electric', taxId: 'Pendiente de configurar' },
    locations: [{ id: 'sede-principal', name: 'Sede principal' }],
    // This identifies browser edits only; it does not represent an authenticated user.
    members: [{ id: 'local-owner', name: 'Propietario local', role: 'owner', email: 'propietario@local.invalid', active: true, locationIds: ['sede-principal'] }],
    accounts: [],
    transactions: [],
    debts: [],
    debtPayments: [],
    reconciliations: [],
    alerts: [],
    audit: [],
    backups: [],
  };
}
