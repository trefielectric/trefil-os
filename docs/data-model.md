# Modelo de datos — Trefil OS

Esta entrega incluye cuatro migraciones aditivas probadas en PostgreSQL local mediante PGlite. Las cuatro se aplicaron el 10 de noviembre de 2026 al proyecto institucional `trefil-os` (`kifmqoolaerepvlzrqnk`) desde el editor SQL. La cuarta limita EXECUTE de la función de auto-RLS del proveedor sin desactivar el evento: se comprobó en la base real que `anon` y `authenticated` ya no pueden ejecutarla y que una nueva tabla administrativa sigue recibiendo RLS automático. La tabla de prueba se revirtió y no quedó almacenada. Una consulta real confirmó 28 tablas de negocio con RLS, permisos anónimos de lectura denegados y Storage privado. **La vista web continúa usando datos ficticios locales; todavía no es un cliente financiero conectado a Supabase.** No se importaron datos empresariales. La aplicación manual no registró automáticamente el historial de Supabase CLI; antes de una futura migración remota debe reconciliarse según [el estado de seguridad e implementación](security.md).

## Límites y relaciones

| Área | Entidades y reglas |
| --- | --- |
| Identidad | `organizations` → `locations`; `profiles` referencia `auth.users`; `roles`, `permissions`, `role_permissions`; `organization_members` asigna rol, estado y sedes autorizadas desde la base. |
| Libro de tesorería | `accounts` → `transaction_entries` → `financial_transactions`. Cada asiento pertenece a una empresa y sede; las FK compuestas impiden mezclar cuentas, soportes o deudas de otro ámbito. |
| Aprobaciones | `approvals` referencia un movimiento; autor y decisor distintos. Aperturas, ajustes, gastos personales, pagos de deuda, reversos y operaciones desde COP 5.000.000 requieren aprobación. El monto es política inicial versionada, pendiente de ratificación empresarial. |
| Conciliaciones | `reconciliations` conserva saldo contable a fecha de corte, saldo del extracto, diferencia, autor y explicación. Una diferencia no ajusta dinero automáticamente. |
| Contrapartes | `counterparties` permite acreedores, inversionistas, proveedores y clientes; `investors` amplía la contraparte del tipo inversión. No importa contactos de otras empresas. |
| Deuda | `debts` registra capital original y desembolso; `debt_terms` conserva versiones efectivas, tasa mensual efectiva, método, plazo, cuota/fechas y condiciones. `debt_payments` vincula un asiento; `payment_allocations` separa interés, capital y mora. |
| Evidencias | `attachments` registra ruta privada, SHA-256, tamaño y tipo; no almacena claves ni enlaces públicos. Soportes inmutables. |
| Alertas | `alerts` contiene regla, evidencia, severidad, responsable, vencimiento y resolución; `alert_comments` es un historial inmutable. Sus cambios quedan en auditoría. |
| Operación | `tasks`, `audit_events`, `backup_runs`. Un respaldo verificado por checksum no implica una restauración verificada. |
| Límites futuros | `integration_connections`, `inbound_events`, `ai_runs`, `ai_recommendations` quedan sin permisos de escritura para el navegador. Son límites de extensión, sin integraciones ni agentes activados. |

`numeric(18,2)` es el tipo monetario; las APIs reciben importes como cadenas decimales con máximo dos decimales. No se utiliza punto flotante en PostgreSQL. Las tasas son `numeric(9,6)` y se expresan como porcentaje efectivo mensual, por ejemplo `1.5` = 1,5 % mensual. Conversión de otras convenciones, tasas diarias o nominales exige definir y validar esas condiciones antes de importar contratos.

Los identificadores son UUID. Los instantes son `timestamptz`; las fechas de negocio son `date` y la interfaz presenta `America/Bogota`. La empresa mantiene `COP` como moneda. Las tablas operativas conservan origen, actor y fechas. Los hechos inmutables tienen fecha de creación y usan nuevos eventos para corregirse.

## Libro y correcciones

No se almacena un saldo inicial en la cuenta. El saldo inicial es un asiento de apertura compensado contra patrimonio, sujeto a aprobación. La vista `account_balances` calcula exclusivamente movimientos `posted`, con `security_invoker=true` para respetar RLS.

Una partida debe tener débito positivo o crédito positivo, nunca ambos; un asiento tiene al menos dos cuentas distintas y débitos exactamente iguales a créditos. Triggers de restricción diferidos vuelven a verificarlo al terminar la transacción. Los traslados usan exactamente dos cuentas de tesorería. Ingresos, aperturas, gastos, salarios, reembolsos, gastos personales, anticipos y préstamos verifican su clase contable. Los anticipos usan cuenta de activo por cobrar. El tipo `loan` representa un préstamo recibido: debita tesorería y acredita una cuenta de pasivo; no es ingreso de ventas. Los préstamos concedidos a empleados requieren su categoría y flujo específico antes de conectarse en producción.

Ninguna API borra movimientos. El original contabilizado queda intacto; `reversal_of` identifica un nuevo asiento que invierte exactamente sus partidas. Solo puede existir un reverso pendiente o contabilizado por original. Una solicitud rechazada no altera saldos. Los soportes, conciliaciones, asignaciones de pagos, condiciones anteriores y auditoría tampoco tienen API de eliminación o modificación destructiva.

El capital pagado de una deuda incluye pagos contabilizados y excluye pagos cuyo asiento tiene un reverso contabilizado. Las cuotas de una tabla de amortización son proyecciones; nunca se insertan como `debt_payments`. El capital de pagos pendientes se reserva para impedir que dos aprobaciones sobrepasen el saldo. La API de pago requiere cuenta de tesorería, pasivo de capital y gasto de intereses y registra el asiento y su distribución en una única transacción. Todos esos pagos quedan pendientes de segunda revisión.

## Contrato de API preparado

Lectura: tablas expuestas en `public`, filtradas por RLS y nivel de autenticación `aal2` para datos financieros. No se debe exponer el esquema `private` en Data API.

| RPC pública (todas `SECURITY INVOKER`) | Comportamiento |
| --- | --- |
| `submit_financial_transaction` | Valida ámbito, cuentas, decimales, fecha no futura, soporte e idempotencia; registra asiento pendiente o contabilizado. |
| `decide_financial_transaction` | Aprueba/rechaza una solicitud de otro usuario autorizado, con justificación. |
| `create_financial_account` | Crea una cuenta sin saldo; las cuentas contables exigen contabilidad/administración. |
| `reconcile_account` | Crea fotografía de conciliación, sin ajustar el libro. |
| `create_debt` | Registra contraparte, deuda y condiciones iniciales. No mueve dinero por sí sola. |
| `record_debt_payment` | Registra pago y reparto atómicos, siempre con aprobación independiente. |
| `manage_member` | Cambia rol, sedes o actividad con auditoría; prohíbe cambios propios y protege al último propietario. |
| `resolve_alert`, `comment_alert` | Conservan explicación e historial de alertas. |
| `register_financial_support` | Registra metadatos de un objeto ya cargado en Storage privado. |

Ejemplo de `submit_financial_transaction` (identificadores de ejemplo, no credenciales):

```json
{
  "p_organization_id": "UUID_EMPRESA",
  "p_location_id": "UUID_SEDE",
  "p_idempotency_key": "UUID_PETICION",
  "p_kind": "income",
  "p_date": "2026-11-10",
  "p_description": "Descripción y referencia del soporte",
  "p_party": "Contraparte",
  "p_category": "Venta",
  "p_entries": [
    { "account_id": "UUID_BANCO", "debit": "100000.00", "credit": "0.00" },
    { "account_id": "UUID_INGRESO_CONTABLE", "debit": "0.00", "credit": "100000.00" }
  ],
  "p_support_id": null,
  "p_reversal_of": null
}
```

La misma clave y contenido devuelve el mismo UUID. Reutilizar la clave con otro contenido falla; un bloqueo transaccional y la restricción única evitan la duplicación. No se deben reintentar peticiones con una clave nueva cuando su resultado sea incierto.

## Pendiente para una operación empresarial real

La vista local no es un cliente conectado a estas RPC. Antes de usar dinero real faltan el adaptador completo, aprovisionamiento institucional, pruebas de permisos mediante Data API después de la revisión estructural de Advisors ya ejecutada, reconciliación del historial de migraciones, invitaciones personales, prueba de Auth/Storage/Data API con usuarios de cada rol, auditoría de accesos desde Auth, despliegue de reglas de alerta, acuerdos de deuda y renegociaciones aprobados, respaldo remoto diario y ensayo de restauración. El simulador local cubre proyecciones; la persistencia de renegociaciones y los flujos reales se deben conectar y verificar antes de uso empresarial.

Las migraciones se generaron con CLI 3.1.0 mediante `supabase migration new`; no se ejecutó `db reset`, ni `db push` remoto. PGlite ejecuta PostgreSQL real para constraints/RLS; no ejecuta GoTrue, Storage HTTP ni PostgREST. Esas conexiones permanecen pendientes de una prueba real en Supabase.
