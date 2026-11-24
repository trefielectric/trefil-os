# Inventarios · Operación e informes locales

La especificación funcional del Módulo 02 distingue cinco inventarios: Propiedad, planta y equipo; Materia prima; Insumos de fabricación; Chatarra; Producto terminado. Cada uno conserva su informe mensual y un nombre de archivo diferente. Los documentos de prueba utilizados durante el desarrollo no se incorporan al espacio del usuario.

## Fuente única y alcance

`getInventoryReport` calcula el informe por inventario, fechas, sede y ubicación. La interfaz, el PDF y el Excel reciben ese mismo objeto, con identificación, período y versión comunes. Si existe un cierre local del mes, se utiliza su instantánea conservada; aplicar un filtro de ubicación conserva la fecha de generación y la versión del cierre. Una venta posterior no reescribe las existencias del informe cerrado.

Los archivos contienen saldos iniciales, entradas, salidas, existencias teóricas, conteo físico, diferencias, disponibilidad, reservas, cuarentena y valoración cuando existen datos suficientes. Los movimientos conservan referencia documental, responsable, comprobante y observaciones. Las actas de conteo, los precios documentados y las solicitudes de autorización se incluyen cuando forman parte del informe.

No se suman kilogramos, metros, litros y unidades para fabricar una cantidad consolidada. El valor consolidado permanece desconocido si alguna referencia carece de la valoración necesaria; no se presenta una suma parcial como valor total.

## Cantidades, precios y ausencias

Las cantidades se conservan como decimales exactos de hasta seis posiciones. El PDF utiliza formato colombiano. Los artículos o activos expresados en unidades enteras y el producto terminado se presentan sin fracciones. Excel conserva números nativos, fechas, filtros y fórmulas para saldo teórico y diferencia física.

Un conteo pendiente, un precio ausente o un valor desconocido permanecen vacíos en Excel y se muestran con un guion en PDF. No se convierten en cero. Un cero registrado de forma expresa sí conserva su significado. Las diferencias mantienen su signo: un conteo inferior al teórico no modifica automáticamente las existencias.

La valoración de materiales e insumos utiliza el precio manual registrado para el mes, con sus referencias de compra en Caja, comprobante, responsable y versiones. Los informes no calculan promedios de compras ni trasladan silenciosamente un precio de otro período. Las operaciones de chatarra conservan sus precios individuales; el informe no les impone un precio único de existencias.

La exportación a Excel rechaza importes o cantidades que excedan su precisión admitida, en lugar de redondearlos silenciosamente. Los textos proporcionados por el usuario se escriben como texto, incluso si comienzan por un signo igual.

## Estado de revisión y cierre

El documento distingue borrador local y cierre local conservado. Las novedades abiertas, los conteos pendientes y las valoraciones incompletas permanecen visibles. Un cierre local no acredita por sí mismo la identidad de Creador o Gerente ni equivale a aprobación institucional autenticada.

Las solicitudes de ajuste, omisión histórica, pérdida de chatarra y modificación de documentos cerrados conservan su motivo y autorización requerida. Los cambios de facturas o lotes de períodos cerrados requieren exclusivamente Creador. El exportador muestra el estado pendiente; no ejecuta estas solicitudes ni simula un segundo factor.

Los comparativos anuales usan meses calendario completos. El mes en curso y los meses futuros no se presentan como períodos completos. Las diferencias y valores ausentes mantienen su estado en la comparación.

## PDF y Excel

El PDF conserva el logo original de TrefiElectric, los colores azul, amarillo y blanco, encabezados repetidos, títulos y paginación. Excel separa resumen, existencias, disponibilidad, valoración, movimientos y novedades, y añade actas, precios, autorizaciones y comparación anual cuando corresponden. La identificación del informe permite relacionar ambos archivos.

El espacio sigue siendo local al navegador y no representa una conexión operativa institucional a Supabase. La emisión de documentos no sustituye la verificación de permisos, soportes privados, respaldo y recuperación. Las integraciones remotas y la matriz completa de permisos deben validarse antes de usar registros empresariales reales.

## Verificación de desarrollo

Las seis pruebas específicas de exportación comprobaron precisión de cantidades, conservación de ausencias, diferencias físicas, referencias originales, tipos nativos de Excel e instantáneas mensuales inmutables utilizando el motor real. Se generó un PDF aislado de cuatro páginas con diferencias, valoración pendiente, acta, precio y solicitud, y se revisaron visualmente todas sus páginas. Estas comprobaciones corresponden a informes; la verificación integrada y el despliegue del módulo completo deben registrarse por separado.

## Operación implementada

- ORIGEN histórico único por inventario, con cantidades explícitas, acta y responsable; no se fabrica a partir de un saldo supuesto.
- Activos con identificación individual, condición y fotografía. Las compras se reciben desde una salida de Caja; bajas por daño requieren fotografía y las de hurto, relato.
- Materiales e insumos con recepciones de compra, consumos documentales de Producción y precios manuales por período vinculados a compras reales del libro local.
- Producto terminado: lotes con dos conformidades documentales coincidentes. Producción entrega, Ventas confirma y Bodega incorpora; la plataforma muestra el responsable de cada etapa. Las órdenes despachadas desde Ventas descuentan la bodega indicada una sola vez. Las muestras, uso interno, donaciones, daños y traslados usan un flujo separado con causa, responsable, referencia, soporte y observaciones. Los conteos diarios mantienen faltantes críticos de prioridad 2. Las devoluciones por garantía se conservan separadas del disponible; el reemplazo utiliza stock aceptado y no genera una segunda venta.
- Chatarra: generación, preparación para venta, despacho, peso reconocido, devolución y diferencias; el documento original conserva su historia junto a la factura definitiva.
- Compras, cobros parciales y compensaciones con facturas documentadas de proveedor. Recibir una compra o vincular un cobro no genera otro asiento. Compensar chatarra reduce el pendiente de venta y proveedor, sin crear ingreso o egreso de Caja; se reserva el capital de pagos pendientes de aprobación.
- Abastecimiento para activos, materia prima e insumos: mínimos por referencia y bodega, cantidad sugerida, proveedor preferido, plazo, costo estimado y responsable. La alerta se activa al llegar o caer por debajo del mínimo; no crea automáticamente una compra.
- Pedidos de compra programados con proveedor, fecha requerida, renglones y valor aproximado. Cada pedido separa responsable de compra, responsable de aprobación y responsable de recepción. Al recibirlo se vincula con el egreso real de Caja y deja de contarse como compromiso estimado.
- Análisis de compras de los últimos seis meses: gasto real total, promedio mensual, compromisos todavía abiertos y desglose mensual. Solo cuenta recepciones reales de Caja o compras a crédito; los pedidos estimados se muestran por separado.
- Cierres independientes por inventario, con controles de ORIGEN, acta mensual vigente, diferencias, valoración cuando corresponde y solicitudes pendientes. Los informes cerrados conservan su instantánea.

Las reclasificaciones sujetas a autorización se documentan como solicitudes pendientes; no existe una operación local que cambie existencias bajo una autorización fingida. La integración actual con Ventas descuenta las órdenes al confirmar su despacho y el flujo local de lotes incorpora producto terminado desde Producción; no existe todavía un módulo institucional remoto completo de Producción. Los usuarios departamentales auténticos, la matriz completa de permisos, las devoluciones de dinero de canales externos y la persistencia institucional siguen pendientes. Las 28 tablas remotas anteriores corresponden a la fase financiera; esta implementación no añadió un esquema remoto de inventario ni conectó el libro local a Supabase.

## Inventario central institucional

La ruta `/inventario-central/` utiliza la sesión del equipo y la base institucional. La consulta con permiso `inventory_view` muestra los SKU de la tienda, el último catálogo de Mastershop y el catálogo histórico de Alegra. El saldo físico se administra por referencia y bodega. Un administrador con `inventory_approve` confirma la equivalencia, la unidad y el factor de cada presentación, y registra el conteo inicial. Cada reserva o despacho cita el pedido original. El módulo conserva la cantidad física, la cantidad reservada y el disponible.

Wired se consulta cada cinco minutos mediante el usuario dedicado de lectura definido en `supabase/operations/inventory-wired-transport.sql`. El esquema de intercambio se encuentra en el repositorio de la tienda. Mastershop consulta su API cada quince minutos con la credencial `mastershop_wired_api_key` en Supabase Vault. La consulta conserva la lectura anterior si el proveedor responde con error. El panel muestra el origen y la fecha de actualización. Los permisos de la conexión, las tareas y las funciones de lectura se encuentran en `supabase/operations/inventory-feeds.sql`.

Los informes locales de los cinco inventarios y sus cierres utilizan el libro descrito en las secciones anteriores. La importación histórica de Alegra conserva sus identificadores originales.

Mastershop informa el total de productos en `resultsCount.totalProducts`. El lector verifica el total de páginas y la identidad de la tienda. Cuando hay variantes habilitadas, cada variante usa la combinación del ID de producto y el ID de variante. Así se muestra la cantidad de productos y de presentaciones por separado. La tabla compara el saldo del canal con las presentaciones completas disponibles en las bodegas que tienen conteo, descontando las reservas y aplicando la conversión aprobada.
