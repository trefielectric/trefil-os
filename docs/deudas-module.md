# Módulo 03 · Deudas

El módulo organiza entidades y fondos, inversionistas, proveedores y compromisos recurrentes. Parte vacío y conserva los saldos documentados, su procedencia y los pagos reales de Caja. Registrar una obligación, una factura o un plan de cuotas no crea dinero ni un egreso.

Los préstamos nuevos toman su desembolso de la transacción vinculada de Caja. El ORIGEN bancario histórico queda pendiente de autorización institucional; el perfil local no puede aprobarlo. Los planes oficiales se documentan por versión y sus cuotas se distinguen de las proyecciones del simulador. Los pagos separan capital, intereses, seguros, comisiones y mora. Una solicitud de corrección o renegociación conserva el saldo anterior hasta que exista la autorización correspondiente.

Para proveedores, cada factura confirma manualmente su fecha de vencimiento. Una compra a crédito aumenta la obligación y, cuando corresponde, el inventario, sin simular un pago. La chatarra aplicada y las devoluciones aceptadas reducen la deuda sin efectivo. Las devoluciones pendientes o en disputa conservan la obligación hasta documentar la aceptación y el importe reconocido por el proveedor.

Los compromisos recurrentes distinguen plantilla, recibo mensual recibido y abonos reales. El día orientativo de una plantilla no sustituye el vencimiento del recibo. El consumo se guarda únicamente cuando se informa con su unidad. No se generan promedios ni análisis de variaciones: pertenecen al futuro módulo de Reportes.

El ORIGEN histórico distingue el capital original y el saldo documentado con su fecha de corte; reconocer ese saldo en el mes no lo convierte en un préstamo nuevo ni crea un ingreso. El informe mensual presenta el puente entre saldo inicial, altas y ORIGEN documentado del período, capital pagado, cruces sin efectivo, devoluciones aceptadas, ajustes aplicados y saldo final. Incluye los cinco componentes de pago, sus referencias de Caja o documento, vencimientos oficiales, pendientes, conciliaciones, soportes y solicitudes institucionales. PDF y Excel usan el mismo cálculo, período, versión e identidad. Excel conserva importes numéricos, fechas, filtros y fórmulas de comprobación; un importe desconocido queda en blanco y en PDF aparece como un guion.

El cierre conserva una copia del informe. Un recibo reconocido y todavía pendiente puede quedar en el cierre con su saldo explícito; el pago en otro mes no reescribe ese informe. Las diferencias y soportes pendientes mantienen su observación y no se presentan como conciliados. Las solicitudes excepcionales conservan la matriz de autorización pendiente; no se amplían los roles locales para ejecutarlas.

El alcance actual es local al navegador. El cierre local y el responsable registrado no equivalen a una sesión institucional con MFA ni a una autorización remota. La conexión institucional, la sincronización entre usuarios y la ejecución autenticada de excepciones requieren completar la integración de servidor.

TypeScript, la compilación estática y las 207 pruebas aprobaron. La prueba de navegador conservó un cierre mensual con un recibo sintético pendiente. El informe PDF y el libro Excel se revisaron con datos de prueba. La evidencia está en [Verificación](verification.md).
