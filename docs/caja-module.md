# Caja · Alcance de la implementación local

La referencia funcional es la especificación del Módulo 01, Manejo de Caja, con corte del 10 de noviembre de 2026. El usuario pidió implementar este módulo y confirmó las cinco decisiones que el documento dejaba abiertas. Esta entrega amplía el espacio local de Trefil OS; todavía no conecta sus registros a la operación institucional de Supabase.

## Datos iniciales y cuentas

El espacio conserva sus cuentas, movimientos y registros existentes; una instalación nueva comienza en cero y con listas vacías. La extensión opcional `State.cash` conserva turnos, arqueos, metadatos, legalizaciones, solicitudes, recepciones, extractos y cierres. Las instantáneas anteriores sin esa extensión siguen siendo compatibles y no reciben movimientos de ejemplo.

La creación de cuentas ofrece las ocho plantillas del documento: Caja Principal en Efectivo, Cuenta Trefielectric, Cuenta Juan, Cuenta Edgar, Cuenta Valentina, Cuenta Andrea, Cuenta Federico y Nequi Federico. Se añaden plantillas para MasterShop, Heka, Skydropx y Mercado Libre. Seleccionar una plantilla no crea una cuenta automáticamente ni completa responsable, autorización personal o saldo. Se pueden crear otras cuentas.

Una cuenta bancaria puede registrar su número o referencia en el navegador; las tarjetas e informes no exponen el número completo. Los números completos y documentos reales no deben incorporarse al código público. El uso empresarial de una cuenta personal mantiene su autorización temporal expresa y no convierte en dinero empresarial sus movimientos privados.

## Turnos y arqueos de efectivo

- Los turnos corresponden a cajas de tipo efectivo. Los bancos y billeteras registran movimientos directamente, sin simular un arqueo de billetes.
- La apertura registra fecha, responsable, cuenta, saldo calculado y observaciones. Abrir un turno no crea dinero ni reemplaza un asiento de saldo inicial.
- No se abre otro turno mientras el anterior siga abierto. Los movimientos de efectivo deben corresponder a un turno abierto; el período cerrado impide nuevas contabilizaciones silenciosas.
- El arqueo distingue los billetes de 100.000, 50.000, 20.000, 10.000, 5.000, 2.000 y 1.000 de las monedas de 1.000, 500, 200, 100 y 50. Se calculan cantidad, total, saldo teórico y diferencia en centavos exactos.
- El cierre ordinario verifica arqueo y pendientes. Un faltante o sobrante conserva la novedad y no se transforma en un ajuste automático. Una solicitud de cierre excepcional no autoriza ni ejecuta el cierre por sí misma.

## Movimientos, clasificación y soportes

El registro reúne fecha efectiva, cuenta, responsable o beneficiario, importe, descripción, categoría, soporte y referencias funcionales. El catálogo incluye los once grupos de salidas del documento y las entradas definidas. La regla de Gastos bancarios solo se aplica cuando la categoría está vacía y la observación corresponde a esa regla; GMF y cargos de Nequi permanecen separados. POR LEGALIZAR no se utiliza como clasificación definitiva del gasto.

Los soportes pueden ser documentos o enlaces HTTPS validados. Su incorporación posterior conserva la referencia al movimiento, la evidencia anterior y el historial. La operación monetaria original no se reescribe al añadir un comprobante. Las solicitudes de reclasificación o corrección conservan lo anterior, lo propuesto y el motivo; su aplicación empresarial exige autorización institucional.

Las entradas operativas, préstamos, inversiones, activos y traslados tienen naturaleza diferenciada. Las referencias a Ventas, Inventarios, Producción, Deudas, Calendario y Activos son vínculos funcionales, no una integración remota ya ejecutada. Registrar una referencia de factura o activo no crea automáticamente ese documento ni da de baja inventario.

## Traslados y pasarelas

El traslado conserva una salida y una entrada vinculadas por el mismo valor. No se contabiliza como ingreso externo ni gasto operativo. La recepción registra lo efectivamente recibido y su diferencia con el importe esperado. El retiro hacia efectivo requiere su comprobante fotográfico y la falta de documentación genera una novedad.

Las diferencias de traslado bloquean el cierre de las cuentas implicadas y no se borran para permitir cuadrar el libro. Un pago directo al proveedor desde una pasarela se registra en esa pasarela; no se inventa un paso por caja o banco.

## Extractos y conciliación

La importación es manual mediante CSV, con previsualización y plantilla de seis columnas: `id`, `fecha`, `descripcion`, `direccion`, `valor` y `naturaleza`. Admite períodos mensuales, trimestrales o fechas personalizadas, hasta 3.000 líneas y 2 MB por archivo. El archivo original se conserva sin modificación; importarlo no publica otro ingreso o salida.

La vinculación requiere cuenta, fecha, dirección e importe coincidentes y un movimiento no asociado a otra línea. Los identificadores y archivos repetidos se controlan para evitar duplicados. Las comisiones y envíos confirmados pueden incorporarse una vez; si su importe requiere aprobación, el cargo queda pendiente y se vincula después de su aprobación.

La revisión permanece abierta mientras haya líneas sin conciliar. La revisión local por el responsable de cuenta, Creador o Gerente se registra con auditoría. No hay conexión automática a bancos ni a las API de las cuatro pasarelas.

## Cierre mensual e informes

El cierre utiliza meses calendario, recalcula desde movimientos registrados y conserva una instantánea versionada. Evalúa turnos, arqueos, movimientos pendientes, legalizaciones, soportes, diferencias, recepciones y conciliaciones antes del cierre ordinario. Las solicitudes excepcionales mantienen sus novedades abiertas. El registro de cierre local no constituye aprobación institucional definitiva.

Los informes permiten fechas inicial y final y períodos habituales. El saldo disponible se calcula al corte y el consolidado corresponde a la suma de cuentas. Se distinguen operación, financiación, activos, traslados y partidas fuera del informe operativo. La clasificación de salidas presenta los grupos y categorías; no transforma toda cuota de financiación en gasto operativo.

PDF y Excel utilizan el mismo `CashPeriodReport`, identificación, período y versión. El PDF conserva el logo original y los colores azul, amarillo y blanco, con encabezados y paginación. Excel contiene resumen, saldos, grupos, categorías, traslados, detalle, financiación y activos, novedades y comparación mensual cuando corresponde. Conserva números y fechas nativas, filtros y fórmulas de totales pertinentes; no suma como un único total las entradas, salidas y traslados positivos del detalle. Los campos ausentes de componentes financieros se conservan vacíos.

Las comparaciones usan meses completos. Los meses en curso o futuros aparecen sin dato en la comparación anual. Los movimientos personales, excluidos o no verificados no aparecen en el detalle operativo. Las partidas que afectan dinero empresarial conservan su rastro en el libro, aunque se separen del informe operativo.

No se aplicó la tolerancia histórica de COP 50.000 al libro vivo ni se importaron los conjuntos históricos o controles privados. Cualquier importación histórica requiere su propio lote autorizado y reglas verificadas de inclusión.

## Cinco decisiones confirmadas

1. La entrada «Pago de deudas» significa cobro de un préstamo otorgado; los pagos a bancos, inversionistas y proveedores siguen siendo salidas.
2. Una diferencia de traslado bloquea el cierre de las cuentas implicadas.
3. El pago a proveedores desde una pasarela sale directamente de su saldo, sin tránsito ficticio por banco o efectivo.
4. Creador y Gerente son quienes autorizan correcciones y excepciones.
5. Un cierre excepcional conserva las novedades abiertas y no extingue el faltante ni crea un movimiento para corregirlo.

## Autorización, despliegue y verificación

El perfil local identifica cambios en este navegador; no acredita la identidad de Creador o Gerente ni verifica un segundo factor. Las solicitudes `pending_institutional` no pueden aprobarse mediante un PIN compartido, cambio de rol o código ficticio. El flujo de autorización real y su ejecución requieren conectar Auth/MFA y el adaptador financiero institucional con comprobaciones del servidor.

La base publicada antes de Caja es `f62989b`, verificada en [Preview de Vercel](https://trefil-os-git-codex-finance-preview-administrativo914.vercel.app/). El repositorio es público por autorización expresa; Vercel continúa en Hobby y protegido por Vercel Authentication. No se contrató Pro ni se publicó producción. Se quitó el override de salida: Vercel detecta `.next` y procesa la exportación `out/`.

Verificación local de la entrega: TypeScript, compilación estática y 141 pruebas aprobadas (126 de TypeScript y 15 de JavaScript). Incluye 28 pruebas de dominio Caja, 8 de exportación, 6 de contrato UI y 4 de extractos. Se revisaron las cuatro páginas del PDF de QA y las fórmulas con resultado cero del XLSX. La revisión de navegador verificó alta sin saldo ficticio, apertura, entrada con soporte, arqueo faltante persistente, cierre bloqueado, reconteo exacto, cierre ordinario, recarga y descargas PDF/Excel. Las pruebas se ejecutaron en un origen local aislado; no se añadieron registros a la plataforma del usuario. El acceso directo del módulo es el Preview anterior con `/#caja/operations`. Auth, permisos, Storage, respaldo y restauración reales siguen siendo condiciones previas para operar con información empresarial.
