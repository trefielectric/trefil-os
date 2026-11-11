# Agenda Financiera · alcance implementado

Esta implementación traduce el documento funcional de Agenda Financiera a un módulo local y auditable. El espacio nuevo comienza sin obligaciones, avisos, pagos, solicitudes ni expedientes de ejemplo. Agenda es la fuente de planificación y seguimiento; **Caja sigue siendo la única fuente de pagos reales, soportes y conciliación monetaria**.

## Registro y calendario

- Registros fijos recurrentes, variables recurrentes, ocasionales y de proveedores.
- Ningún registro se crea automáticamente desde Compras, Nómina, Deudas u otro módulo.
- Las variables pueden permanecer “valor por confirmar” hasta recibir factura, sin sumar un importe inexistente.
- Los proveedores tienen su sección propia. Si no existe vencimiento pactado pueden llevar fecha interna de revisión, pero nunca se clasifican automáticamente como vencidos.
- Se conservan por separado el vencimiento contractual y la fecha operativa. Para servicios públicos en día no hábil se anticipa al hábil anterior; para los demás compromisos se traslada al hábil siguiente. Los festivos y excepciones quedan configurables en el estado del módulo.

## Pagos y control

- Un pago se vincula solo a un egreso registrado, confirmado y soportado en Caja.
- Un egreso puede distribuirse entre varias obligaciones, pero la suma de aplicaciones nunca puede superar su valor real.
- Los abonos parciales conservan el saldo y la novedad de vencimiento. Solo un saldo totalmente cubierto con comprobante alcanza “pagada y soportada”.
- Adjuntar un documento a la Agenda no registra ni certifica un desembolso.

## Autorizaciones, avisos y expediente

- Una solicitud de cambio no sustituye el valor o vencimiento vigente mientras espera decisión.
- Solo Gerencia/Creador (`admin`/`owner` en el espacio local) decide cambios confirmados y cierres excepcionales.
- Leer una novedad no la resuelve. Los avisos permanecen hasta corregir su causa o registrar un cierre excepcional justificado.
- El cierre excepcional no elimina la obligación ni cambia su saldo; queda en el expediente y en auditoría.

## Pantallas

El apartado principal incluye Panel general, Calendario, Obligaciones, Pendientes proveedores, Verificación, Seguimiento de pagos, Historial y Configuración. La versión actual utiliza una vista calendario en lista y filtros por sede. La matriz institucional completa de permisos, los festivos administrables desde interfaz y las vistas mensual/semanal pueden añadirse cuando el backend multiusuario esté conectado.

## Límites de esta etapa

Los datos se guardan en la misma instantánea local validada que los demás módulos. No se han creado tablas remotas de Agenda ni sincronización con Supabase. El perfil local identifica eventos, pero no equivale a una sesión personal ni a una autorización institucional. No introducir información empresarial real hasta completar Auth, permisos, RPC, soportes privados, concurrencia y respaldo verificado.

Las pruebas automatizadas comprueban inicio vacío, días hábiles, valores variables, proveedores sin vencimiento, abonos parciales, distribución de un egreso, rechazo de pagos sin soporte, autorización de cambios, cierres excepcionales y detección de asignaciones corruptas.
