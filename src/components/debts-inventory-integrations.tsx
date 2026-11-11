'use client';
import { useState, type FormEvent } from 'react';
import { getDebtBalance, formatCOP, money, todayBogota, type Support } from '@/lib/finance';
import { getDebtModuleState } from '@/lib/debts/engine';
import {
  acceptSupplierReturn,
  dispatchSupplierReturn,
  disputeSupplierReturn,
  receiveSupplierCreditPurchase,
} from '@/lib/debts/inventory-integrations';
import { getInventoryState } from '@/lib/inventory';
import { InventoryProofInput } from './inventory-view';
import { Empty, Field } from './ui';
import type { ViewProps } from './view-helpers';

const amountPattern = '\\d+(\\.\\d{1,2})?';
const quantityPattern = '\\d+(\\.\\d{1,6})?';
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Revisa los datos del documento.';
const blank = () => ({ itemId: '', warehouseId: '', quantity: '', unitValue: '', totalValue: '' });
export function DebtsInventoryIntegrations(props: ViewProps) {
  const { state, actor, mutate, location } = props;
  const module = getDebtModuleState(state);
  const inventory = getInventoryState(state);
  const suppliers = module.suppliers.filter(
    (row) => row.active && (location === 'all' || row.locationId === location),
  );
  const items = inventory.items.filter(
    (row) => row.active && ['raw_material', 'supply'].includes(row.inventoryType),
  );
  const [supplierId, setSupplierId] = useState('');
  const [date, setDate] = useState(todayBogota());
  const [dueDate, setDueDate] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState([blank()]);
  const [proof, setProof] = useState<Support>();
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [proofKey, setProofKey] = useState(0);
  const [error, setError] = useState('');
  const supplier = suppliers.find((row) => row.id === supplierId);
  const purchases = module.supplierPurchases.filter((row) =>
    suppliers.some((supplier) => supplier.id === row.supplierId),
  );
  const [purchaseId, setPurchaseId] = useState('');
  const purchase = purchases.find((row) => row.id === purchaseId);
  const [returnLine, setReturnLine] = useState('');
  const [returnQuantity, setReturnQuantity] = useState('');
  const [returnDate, setReturnDate] = useState(todayBogota());
  const [returnReference, setReturnReference] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [returnProof, setReturnProof] = useState<Support>();
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnKey, setReturnKey] = useState(() => crypto.randomUUID());
  const returns = module.supplierReturns.filter((row) =>
    suppliers.some((supplier) => supplier.id === row.supplierId),
  );
  const [returnId, setReturnId] = useState('');
  const [acceptedDate, setAcceptedDate] = useState(todayBogota());
  const [amount, setAmount] = useState('');
  const [acceptanceReference, setAcceptanceReference] = useState('');
  const [acceptanceProof, setAcceptanceProof] = useState<Support>();
  const [acceptanceBusy, setAcceptanceBusy] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  function submitPurchase(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      if (!proof) throw new Error('Adjunta la factura de compra a crédito.');
      if (
        mutate(
          (current) =>
            receiveSupplierCreditPurchase(
              current,
              {
                idempotencyKey: key,
                supplierId,
                date,
                dueDate,
                reference,
                support: proof,
                lines: lines.map((row) => ({
                  ...row,
                  unitValue: money(row.unitValue),
                  totalValue: money(row.totalValue),
                })),
              },
              actor,
            ),
          'Compra a crédito incorporada: deuda y existencias aumentaron; Caja no cambió.',
        )
      ) {
        setReference('');
        setLines([blank()]);
        setProof(undefined);
        setProofKey((value) => value + 1);
        setKey(crypto.randomUUID());
      }
    } catch (error) {
      setError(message(error));
    }
  }
  function submitReturn(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const line = purchase?.lines[Number(returnLine)];
      if (returnLine === '' || !line || !returnProof)
        throw new Error('Selecciona el renglón original y adjunta el acta de devolución.');
      if (
        mutate(
          (current) =>
            dispatchSupplierReturn(
              current,
              {
                idempotencyKey: returnKey,
                purchaseId,
                date: returnDate,
                reference: returnReference,
                lines: [{ itemId: line.itemId, warehouseId: line.warehouseId, quantity: returnQuantity }],
                reason: returnReason,
                support: returnProof,
              },
              actor,
            ),
          'Devolución despachada. La deuda permanece igual hasta la aceptación documentada.',
        )
      ) {
        setReturnReference('');
        setReturnQuantity('');
        setReturnReason('');
        setReturnProof(undefined);
        setProofKey((value) => value + 1);
        setReturnKey(crypto.randomUUID());
      }
    } catch (error) {
      setError(message(error));
    }
  }
  function submitAcceptance(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      if (!acceptanceProof) throw new Error('Adjunta la aceptación o nota crédito del proveedor.');
      if (
        mutate(
          (current) =>
            acceptSupplierReturn(
              current,
              {
                returnId,
                date: acceptedDate,
                amount: money(amount),
                reference: acceptanceReference,
                support: acceptanceProof,
              },
              actor,
            ),
          'Devolución aplicada por el valor reconocido. Caja no cambió.',
        )
      ) {
        setReturnId('');
        setAmount('');
        setAcceptanceReference('');
        setAcceptanceProof(undefined);
        setProofKey((value) => value + 1);
      }
    } catch (error) {
      setError(message(error));
    }
  }
  return (
    <div className="debts-inventory-integrations">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Compras a crédito e Inventarios</h2>
            <p>
              Una factura crea la obligación y la recepción de materiales. El vencimiento se registra desde el
              documento, sin plazo supuesto.
            </p>
          </div>
        </div>
        {!suppliers.length || !items.length ? (
          <Empty
            title="Prepara el proveedor y las referencias"
            description="Registra el proveedor en su directorio y las referencias de materia prima o insumos en Inventarios. Sella su ORIGEN documentado, incluso si comienza en cero."
          />
        ) : (
          <form onSubmit={submitPurchase} className="debt-form">
            <div className="form-grid">
              <Field label="Proveedor de la compra">
                <select required value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                  <option value="">Selecciona el proveedor</option>
                  {suppliers.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name} · {row.identification}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Factura de compra a crédito">
                <input
                  required
                  maxLength={200}
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                />
              </Field>
              <Field label="Fecha de factura y recepción">
                <input
                  required
                  type="date"
                  max={todayBogota()}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </Field>
              <Field label="Vencimiento de esta factura">
                <input
                  required
                  type="date"
                  min={date}
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
              </Field>
            </div>
            {lines.map((row, index) => (
              <fieldset className="debt-line-group" key={index}>
                <legend>Renglón {index + 1}</legend>
                <div className="form-grid">
                  <Field label={`Material o insumo ${index + 1}`}>
                    <select
                      required
                      value={row.itemId}
                      onChange={(event) =>
                        setLines(
                          lines.map((r, i) => (i === index ? { ...r, itemId: event.target.value } : r)),
                        )
                      }
                    >
                      <option value="">Selecciona la referencia</option>
                      {items.map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.code} · {item.description}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={`Bodega receptora ${index + 1}`}>
                    <select
                      required
                      value={row.warehouseId}
                      onChange={(event) =>
                        setLines(
                          lines.map((r, i) => (i === index ? { ...r, warehouseId: event.target.value } : r)),
                        )
                      }
                    >
                      <option value="">Selecciona la bodega</option>
                      {inventory.warehouses
                        .filter((row) => row.active && (!supplier || row.locationId === supplier.locationId))
                        .map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label={`Cantidad recibida ${index + 1}`}>
                    <input
                      required
                      inputMode="decimal"
                      pattern={quantityPattern}
                      value={row.quantity}
                      onChange={(event) =>
                        setLines(
                          lines.map((r, i) => (i === index ? { ...r, quantity: event.target.value } : r)),
                        )
                      }
                    />
                  </Field>
                  <Field label={`Precio unitario documentado ${index + 1} · COP`}>
                    <input
                      required
                      inputMode="decimal"
                      pattern={amountPattern}
                      value={row.unitValue}
                      onChange={(event) =>
                        setLines(
                          lines.map((r, i) => (i === index ? { ...r, unitValue: event.target.value } : r)),
                        )
                      }
                    />
                  </Field>
                  <Field label={`Total con impuestos ${index + 1} · COP`}>
                    <input
                      required
                      inputMode="decimal"
                      pattern={amountPattern}
                      value={row.totalValue}
                      onChange={(event) =>
                        setLines(
                          lines.map((r, i) => (i === index ? { ...r, totalValue: event.target.value } : r)),
                        )
                      }
                    />
                  </Field>
                </div>
                {lines.length > 1 && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setLines(lines.filter((_, i) => i !== index))}
                  >
                    Quitar renglón {index + 1}
                  </button>
                )}
              </fieldset>
            ))}
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setLines([...lines, blank()])}
            >
              Añadir renglón de compra
            </button>
            <InventoryProofInput
              key={'purchase-' + proofKey}
              label="Factura y soporte de recepción"
              onChange={setProof}
              onBusy={setBusy}
            />
            <div className="modal-actions">
              <button type="submit" className="button button-primary" disabled={busy}>
                Recibir compra a crédito sin mover Caja
              </button>
            </div>
          </form>
        )}
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Devolver materiales al proveedor</h2>
            <p>
              El despacho descuenta existencias; la deuda conserva su saldo mientras el proveedor no reconozca
              el abono.
            </p>
          </div>
        </div>
        {!purchases.length ? (
          <Empty
            title="Sin compras a crédito para devolver"
            description="Las recepciones registradas desde este módulo aparecerán aquí con sus materiales y bodegas originales."
          />
        ) : (
          <form onSubmit={submitReturn} className="debt-form">
            <div className="form-grid">
              <Field label="Compra original">
                <select
                  required
                  value={purchaseId}
                  onChange={(event) => {
                    setPurchaseId(event.target.value);
                    setReturnLine('');
                  }}
                >
                  <option value="">Selecciona la factura original</option>
                  {purchases.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.reference} ·{' '}
                      {module.suppliers.find((supplier) => supplier.id === row.supplierId)?.name} ·{' '}
                      {formatCOP(row.totalValue)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Material y bodega de origen">
                <select required value={returnLine} onChange={(event) => setReturnLine(event.target.value)}>
                  <option value="">Selecciona el renglón recibido</option>
                  {purchase?.lines.map((row, index) => (
                    <option key={index} value={String(index)}>
                      {inventory.items.find((item) => item.id === row.itemId)?.description} ·{' '}
                      {inventory.warehouses.find((w) => w.id === row.warehouseId)?.name} · Recibido{' '}
                      {row.quantity}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Cantidad realmente despachada">
                <input
                  required
                  inputMode="decimal"
                  pattern={quantityPattern}
                  value={returnQuantity}
                  onChange={(event) => setReturnQuantity(event.target.value)}
                />
              </Field>
              <Field label="Fecha del despacho de devolución">
                <input
                  required
                  type="date"
                  min={purchase?.date}
                  max={todayBogota()}
                  value={returnDate}
                  onChange={(event) => setReturnDate(event.target.value)}
                />
              </Field>
              <Field label="Acta de devolución">
                <input
                  required
                  maxLength={200}
                  value={returnReference}
                  onChange={(event) => setReturnReference(event.target.value)}
                />
              </Field>
              <Field label="Motivo de devolución">
                <textarea
                  required
                  maxLength={2000}
                  value={returnReason}
                  onChange={(event) => setReturnReason(event.target.value)}
                />
              </Field>
            </div>
            <InventoryProofInput
              key={'return-' + proofKey}
              label="Soporte de despacho al proveedor"
              onChange={setReturnProof}
              onBusy={setReturnBusy}
            />
            <button className="button button-primary" disabled={returnBusy}>
              Despachar devolución pendiente de aceptación
            </button>
          </form>
        )}
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Aceptación y disputas de devoluciones</h2>
            <p>
              Solo el importe efectivamente reconocido reduce la obligación. Una disputa conserva la deuda y
              la evidencia.
            </p>
          </div>
        </div>
        {!returns.length ? (
          <Empty
            title="Sin devoluciones registradas"
            description="Aquí consultarás cada despacho, su aceptación o disputa y el valor reconocido por el proveedor."
          />
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Devolución / proveedor</th>
                    <th>Estado</th>
                    <th>Reconocimiento</th>
                    <th className="numeric">Saldo de factura</th>
                  </tr>
                </thead>
                <tbody>
                  {returns.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.reference}
                        <small>
                          {module.suppliers.find((supplier) => supplier.id === row.supplierId)?.name} ·{' '}
                          {row.date}
                        </small>
                      </td>
                      <td>
                        {row.status === 'accepted'
                          ? 'Aceptación documentada'
                          : row.status === 'disputed'
                            ? 'En disputa'
                            : 'Pendiente de aceptación'}
                      </td>
                      <td>
                        {row.acceptedAmount === undefined
                          ? 'Sin importe reconocido'
                          : formatCOP(row.acceptedAmount)}
                        <small>{row.acceptanceReference ?? row.reason}</small>
                      </td>
                      <td className="numeric">{formatCOP(getDebtBalance(state, row.debtId))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <form onSubmit={submitAcceptance} className="debt-form">
              <div className="form-grid">
                <Field label="Devolución pendiente de proveedor">
                  <select required value={returnId} onChange={(event) => setReturnId(event.target.value)}>
                    <option value="">Selecciona la devolución</option>
                    {returns
                      .filter((row) => row.status !== 'accepted')
                      .map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.reference} ·{' '}
                          {module.suppliers.find((supplier) => supplier.id === row.supplierId)?.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Fecha de aceptación del proveedor">
                  <input
                    required
                    type="date"
                    max={todayBogota()}
                    value={acceptedDate}
                    onChange={(event) => setAcceptedDate(event.target.value)}
                  />
                </Field>
                <Field label="Importe realmente reconocido · COP">
                  <input
                    required
                    inputMode="decimal"
                    pattern={amountPattern}
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </Field>
                <Field label="Nota crédito o aceptación">
                  <input
                    required
                    maxLength={200}
                    value={acceptanceReference}
                    onChange={(event) => setAcceptanceReference(event.target.value)}
                  />
                </Field>
              </div>
              <InventoryProofInput
                key={'acceptance-' + proofKey}
                label="Aceptación documentada del proveedor"
                onChange={setAcceptanceProof}
                onBusy={setAcceptanceBusy}
              />
              <button className="button button-primary" disabled={acceptanceBusy || !returnId}>
                Aplicar únicamente el valor reconocido
              </button>
              <div className="form-grid">
                <Field label="Motivo documentado de disputa">
                  <textarea
                    maxLength={2000}
                    value={disputeReason}
                    onChange={(event) => setDisputeReason(event.target.value)}
                  />
                </Field>
                <div>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={!returnId || !disputeReason.trim()}
                    onClick={() => {
                      if (
                        mutate(
                          (current) =>
                            disputeSupplierReturn(current, { returnId, reason: disputeReason }, actor),
                          'Disputa conservada; el saldo de la deuda no cambió.',
                        )
                      )
                        setDisputeReason('');
                    }}
                  >
                    Registrar disputa sin reducir deuda
                  </button>
                </div>
              </div>
            </form>
          </>
        )}
      </section>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
