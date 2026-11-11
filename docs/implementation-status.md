# Estado de implementación · 10 de noviembre de 2026

Trefil OS inicia ahora con un **espacio local limpio y en cero**, por solicitud del usuario. No se cargan cuentas, movimientos, deudas, pagos, conciliaciones, soportes, respaldos ni eventos de auditoría de ejemplo. **La primera fase conectada todavía no está terminada ni habilitada para dinero real.** El logo institucional original azul y amarillo se conserva.

## Reinicio local solicitado

`createEmptyState` conserva únicamente la empresa, una sede principal y el perfil técnico `local-owner`, sin crear un usuario real ni iniciar una sesión institucional. La aplicación utiliza la clave nueva `trefil-os:local:v1` y un Web Lock independiente del escenario anterior. Los datos antiguos bajo `trefil-os:demo:v1` permanecen conservados, pero no se cargan ni se migran al espacio limpio. Los formularios empiezan sin valores financieros ficticios precargados.

La limpieza afecta al punto de partida local de la interfaz. No elimina datos ni recursos de GitHub, Supabase o Vercel y no introduce secretos ni conexiones nuevas. Los fixtures con COP 128.000.000 se mantienen para las pruebas automatizadas y no son saldos de la aplicación ni de Trefil Electric. La revisión del inicio limpio aprobó 95 pruebas automatizadas, TypeScript y build estático. El navegador mostró cero indicadores, cuentas, movimientos, obligaciones y eventos iniciales, y conservó el estado vacío tras recargar.

## Recursos institucionales comprobados

- El usuario confirmó explícitamente que cambió la contraseña expuesta y activó doble factor. Las contraseñas y códigos posteriores se introducen directamente en el navegador; no se guardan ni se solicitan por chat.
- GitHub: organización institucional `trefielectric` y repositorio **público** `trefielectric/trefil-os`, ID `1452781216`, verificados desde el navegador por el agente principal. El usuario autorizó expresamente publicar código, documentación, historial y sus metadatos institucionales. Esa autorización no convierte futuros registros empresariales, credenciales o respaldos en material publicable. El conector GitHub disponible pertenece a otra cuenta; la sincronización institucional se realizó mediante el navegador autorizado.
- Supabase: proyecto `trefil-os`, referencia `kifmqoolaerepvlzrqnk`, organización `Trefielectric` (`qsbgnwwoghrvrtmlvdsj`). El agente principal aplicó las cuatro migraciones mediante el editor SQL de la sesión institucional autorizada. Una consulta real comprobó **28 tablas de negocio y RLS activo en todas**. No se importaron datos empresariales.
- La ejecución SQL quedó guardada en el panel con ID `440fa303-9ee0-4ffc-8ef7-dde3fa897538`. Ejecutar SQL en el editor **no registra automáticamente las versiones en `supabase_migrations.schema_migrations`**. Antes de usar CLI para nuevos cambios, comparar el esquema y registrar/reparar el historial mediante el flujo soportado y revisado; no volver a ejecutar a ciegas las migraciones ya aplicadas.
- Storage: bucket `financial-supports` creado privado, con límite de 10 MiB y tipos PDF, PNG y JPEG. La consulta SQL real comprobó sus dos políticas de acceso y ausencia de lectura anónima de tablas. La carga y descarga por HTTP con sesiones reales permanecen pendientes.
- Vercel: proyecto `trefil-os` bajo el espacio `administrativo914`, conectado a GitHub tras la publicación del repositorio autorizada por el usuario. Se creó y verificó un Preview en Hobby, sin contratar Pro ni complementos pagados. La base `f62989b` quedó Ready y aprobó CI; [la vista previa](https://trefil-os-git-codex-finance-preview-administrativo914.vercel.app/) abrió el tablero en cero con el logo original y sin errores de consola. No se publicó producción.
- Configuración de Vercel: Next.js, Node `24.x`, raíz del repositorio sin subcarpeta, `npm ci` y `npm run build`. La autenticación de Vercel continúa en **All Deployments**, sin enlaces de bypass. Se retiró el override de salida `out`: Vercel debe detectar `.next` y procesar la exportación estática. El primer intento quedó cancelado por el control de producción; otro Preview falló por el override de salida y fue corregido. Esa evidencia corresponde a la base previa a Caja, no certifica los cambios nuevos todavía en verificación.

## Caja local implementada

El usuario pidió ejecutar el módulo Caja de su especificación funcional y confirmó sus cinco decisiones abiertas. La nueva copia de trabajo incorpora turnos de efectivo, arqueos por billetes y monedas separados, categorías aprobadas, documentación posterior y legalizaciones, control de recepción de traslados, cierre mensual local, extractos CSV con vinculación manual e informes PDF/XLSX desde una fuente de cálculo común. Las cuentas y pasarelas se ofrecen como plantillas de formulario; no se crean saldos ni registros de ejemplo.

Las operaciones en bancos y billeteras son directas; los turnos solo se aplican a efectivo. Las diferencias conservan su evidencia y no crean ajustes para forzar el saldo. Las correcciones, reclasificaciones sujetas a autorización y cierres excepcionales generan solicitudes pendientes de la conexión institucional. No existe un código compartido ni MFA empresarial simulado. Un cierre local no es la aprobación formal de un informe institucional.

TypeScript, build y **141/141 pruebas** de la entrega de Caja aprobaron. Se comprobó en navegador el ciclo de apertura, movimiento, arqueo, bloqueo por faltante, cierre ordinario y recarga; las dos descargas reales comparten versión. Se revisó el PDF de QA completo de cuatro páginas y el XLSX con comprobación global y por cuenta igual a cero. El origen de QA está aislado y los datos del Preview del usuario se conservan sin ejemplos. El detalle se encuentra en [el alcance de Caja](caja-module.md).

## Inventarios local implementado

El usuario autorizó implementar el PDF del módulo Inventarios y confirmó tres criterios: dos conformidades documentadas de Producción y Ventas con cantidades idénticas; actas de conteo con responsable y soporte; precios de cierre manuales por período con referencia a compras de Caja, sin elegir automáticamente entre precios distintos.

La copia de trabajo incorpora cinco inventarios, ORIGEN único, cantidades exactas, dos bodegas vacías, lotes documentales, garantías en cuarentena, control de pesos de chatarra, precios por período, informes PDF/XLSX y cierres independientes. Las integraciones enlazan egresos e ingresos reales del libro local y permiten compensar chatarra con una factura documentada de proveedor sin movimiento ficticio de dinero. Se conservan los datos válidos anteriores; no se reinicia el almacenamiento del usuario al incorporar el módulo.

Las conformidades departamentales son documentos, no sesiones institucionales. Omisiones, ajustes excepcionales, reclasificaciones/pérdidas y cambios de facturas o lotes cerrados generan solicitudes pendientes. No se han añadido tablas de stock a Supabase ni conectado Caja/Inventarios con bancos, facturación fiscal o cuentas institucionales. El alcance y las limitaciones se describen en [Inventarios](inventory-module.md); la validación integrada y la publicación tienen evidencia independiente en [Verificación](verification.md).

## Deudas local: integración del Módulo 03

El usuario pidió continuar con el PDF de Deudas y confirmó vencimiento manual por factura, devoluciones en disputa sin disminuir deuda hasta su aceptación documentada y excepciones pendientes de autorización institucional, sin otorgar permisos nuevos. Se implementan cuatro categorías con expedientes, planes oficiales separados del simulador, pagos por componentes, proveedores, compras a crédito, devoluciones, recibos recurrentes, agenda, informes y cierres locales conservados.

La arquitectura mantiene `State.debts` y el libro de Caja como fuentes existentes. Los vínculos documentales y no monetarios evitan duplicar compras, pagos y cruces. El saldo histórico de ORIGEN tiene fecha de corte propia; no se presenta como si todos los pagos anteriores hubieran ocurrido dentro del sistema. La operación continúa en el navegador; no se han creado tablas remotas ni simulado usuarios institucionales. La verificación integrada y la publicación se registran de manera independiente de las 183 pruebas de Inventarios.

## Ventas local: integración del Módulo 04

El corte funcional de Ventas del 11 de noviembre de 2026 se incorporó como un apartado principal. Incluye clientes, listas versionadas, cotizaciones convertibles por categoría, OP directas y de servicio, TFI con guía, facturación unificada, vendedores externos con DV y cierre semanal, pagos reportados, garantías GAR, lotes, inventario disponible, conteos/cierres y el apartado de comisiones pendiente de parámetros reales.

Facturar no registra cobros; los comprobantes externos no reducen cartera hasta cruzarse con un ingreso real de Caja. Cotizar no reserva inventario. TFM/TFMP esperan el estado de Producción y GAR no genera una segunda venta. El despacho crea una sola salida en el libro local de Inventarios y la DV verificada crea un solo reingreso; la factura no repite el movimiento. La sincronización remota continúa pendiente de la integración institucional. Los detalles están en [Ventas](sales-module.md).

## Agenda Financiera local

El documento funcional de Agenda Financiera se incorporó como apartado principal con Panel, Calendario, Obligaciones, Proveedores, Verificación, Pagos, Historial y Configuración. El estado inicial conserva cero obligaciones y no crea compromisos desde otros módulos.

Las fechas contractuales y operativas se almacenan separadas. Los servicios públicos vencidos en día no hábil se anticipan al hábil anterior; los demás pasan al hábil siguiente. Una factura de proveedor sin fecha pactada conserva su saldo y revisión interna, pero no se declara vencida automáticamente.

El módulo nunca registra un pago: enlaza únicamente egresos reales, confirmados y soportados de Caja. Un egreso puede distribuirse entre varias obligaciones sin excederse; los abonos parciales conservan saldo y aviso. Los cambios confirmados mantienen el dato anterior hasta decisión de Gerencia/Creador. Las novedades no se resuelven por lectura y un cierre excepcional no altera la obligación ni su saldo. El alcance detallado está en [Agenda Financiera](agenda-financiera-module.md). La persistencia sigue siendo local y todavía no existe un adaptador remoto de Agenda.

## Qué está implementado y qué sigue pendiente

La web conserva las funciones para movimientos equilibrados, aprobaciones independientes, reversos, cuentas, conciliaciones, obligaciones, pagos separados entre capital e interés, simulaciones, alertas y auditoría. Sus listas empiezan vacías. El perfil local **no es autenticación ni autorización institucional** y no sustituye a las personas distintas que exige una aprobación empresarial. Cualquier dato del navegador puede ser editado por su usuario y nunca debe usarse como autoridad empresarial.

La ruta `/acceso/` implementa inicio/cierre de sesión Supabase, recuperación y TOTP, con comprobación AAL2 y consulta de perfiles, membresías y sedes de base de datos. Su flujo remoto completo aún no fue verificado con usuarios reales. La operación financiera institucional sigue bloqueada: falta el adaptador que lea y escriba mediante las RPC revisadas, la asociación de soportes privados y las pruebas de extremo a extremo. No hay sincronización entre el libro local y PostgreSQL; los movimientos del navegador no se envían a la empresa.

La persistencia local guarda una instantánea por origen de navegador. Las copias se validan profundamente antes de usarlas y Web Locks permite una sola pestaña escritora; las otras reciben cambios en lectura. Una copia dañada se conserva sin sobrescribirla. El espacio limpio y el escenario histórico tienen claves y bloqueos distintos. Esto es coordinación local cooperativa y no convierte el navegador en un libro contable multiusuario. No usar varios navegadores/dispositivos para coordinar operaciones reales ni interpretar el perfil técnico local como aprobación empresarial. El backend conectado deberá resolver concurrencia e idempotencia en PostgreSQL, no en localStorage.

El inicio limpio se comprobó con 95 pruebas automatizadas del núcleo, persistencia, PostgreSQL aislado, exportación, respaldos y bloqueo de despliegue, además de TypeScript y build estático. Se verificaron en navegador la persistencia del cero tras recargar, los formularios sin ejemplos, la auditoría vacía y la vista móvil sin desbordamiento. El historial y sus límites constan en [Verificación](verification.md). Las pruebas de PGlite usan fixtures mínimos de Auth/Storage y no sustituyen a GoTrue, Data API, Storage HTTP, Security Advisor ni pruebas concurrentes con sesiones reales.

Las herramientas de respaldo cifrado, manifiesto, checksum, verificación, copia externa y restauración aislada están implementadas. El workflow diario está preparado y desactivado. Todavía faltan credenciales de operador, una captura lógica real, ejecución diaria comprobada, destino independiente, restauración real y copia al disco externo seleccionado por el usuario. Ningún indicador debe declarar esos procesos verificados sin evidencia.

Microsoft Graph, Outlook, OneDrive y Google Drive permanecen sin conectar. No se mezclaron archivos de otros negocios. No importar documentos de Drive antes de identificar la cuenta propietaria y obtener autorización específica.

## Condiciones antes de operar con datos reales

1. Conciliar el historial local/remoto de las cuatro migraciones. Security Advisor ya devuelve cero errores y cero advertencias; el registro público y las sesiones anónimas están desactivados y la confirmación de correo sigue activa. Faltan verificar TOTP, correos, URLs de retorno, propietarios y usuarios personales.
2. Probar inicio/cierre, recuperación y MFA reales; comprobar por HTTP la denegación AAL1, usuario ajeno, rol sin permiso, sede no autorizada y membresía revocada.
3. Probar el bucket privado ya creado; cargar/descargar soportes ficticios con sesiones reales y comprobar rechazo de acceso ajeno, sobrescritura y borrado.
4. Implementar y verificar el adaptador financiero por RPC, incluyendo traslado equilibrado, aprobación con personas distintas, pago de deuda, reverso, idempotencia y concurrencia. Alinear los límites de los formularios con el contrato SQL antes de habilitarlos.
5. Ejecutar respaldo real cifrado, alerta por fallo y antigüedad mayor de 24 horas, recuperación aislada y copia al disco externo expresamente elegido; medir tiempos y documentar evidencia.
6. Mantener la vista previa protegida y verificar por separado cada cambio nuevo. El Preview gratuito ya existe en Hobby, sin compras ni cambios de plan. Solo después de seguridad, funcionamiento y respaldo comprobados, considerar producción e importación autorizada de datos reales.

Un recurso creado o un panel que diga “conectado” no acredita una conexión completa. Este estado registra las operaciones comprobadas y conserva las limitaciones pendientes.
