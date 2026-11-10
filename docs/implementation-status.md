# Estado de implementación · 10 de noviembre de 2026

Trefil OS inicia ahora con un **espacio local limpio y en cero**, por solicitud del usuario. No se cargan cuentas, movimientos, deudas, pagos, conciliaciones, soportes, respaldos ni eventos de auditoría de ejemplo. **La primera fase conectada todavía no está terminada ni habilitada para dinero real.** El logo institucional original azul y amarillo se conserva.

## Reinicio local solicitado

`createEmptyState` conserva únicamente la empresa, una sede principal y el perfil técnico `local-owner`, sin crear un usuario real ni iniciar una sesión institucional. La aplicación utiliza la clave nueva `trefil-os:local:v1` y un Web Lock independiente del escenario anterior. Los datos antiguos bajo `trefil-os:demo:v1` permanecen conservados, pero no se cargan ni se migran al espacio limpio. Los formularios empiezan sin valores financieros ficticios precargados.

La limpieza afecta al punto de partida local de la interfaz. No elimina datos ni recursos de GitHub, Supabase o Vercel y no introduce secretos ni conexiones nuevas. Los fixtures con COP 128.000.000 se mantienen para las pruebas automatizadas y no son saldos de la aplicación ni de Trefil Electric. La revisión del inicio limpio aprobó 95 pruebas automatizadas, TypeScript y build estático. El navegador mostró cero indicadores, cuentas, movimientos, obligaciones y eventos iniciales, y conservó el estado vacío tras recargar.

## Recursos institucionales comprobados

- El usuario confirmó explícitamente que cambió la contraseña expuesta y activó doble factor. Las contraseñas y códigos posteriores se introducen directamente en el navegador; no se guardan ni se solicitan por chat.
- GitHub: organización institucional `trefielectric` y repositorio privado `trefielectric/trefil-os`, ID `1452781216`, verificados desde el navegador por el agente principal. El código fuente, las migraciones, pruebas y documentación se versionan en ese repositorio privado. El conector GitHub disponible pertenece a otra cuenta y no tiene acceso; la sincronización institucional se realizó mediante el navegador autorizado.
- Supabase: proyecto `trefil-os`, referencia `kifmqoolaerepvlzrqnk`, organización `Trefielectric` (`qsbgnwwoghrvrtmlvdsj`). El agente principal aplicó las cuatro migraciones mediante el editor SQL de la sesión institucional autorizada. Una consulta real comprobó **28 tablas de negocio y RLS activo en todas**. No se importaron datos empresariales.
- La ejecución SQL quedó guardada en el panel con ID `440fa303-9ee0-4ffc-8ef7-dde3fa897538`. Ejecutar SQL en el editor **no registra automáticamente las versiones en `supabase_migrations.schema_migrations`**. Antes de usar CLI para nuevos cambios, comparar el esquema y registrar/reparar el historial mediante el flujo soportado y revisado; no volver a ejecutar a ciegas las migraciones ya aplicadas.
- Storage: bucket `financial-supports` creado privado, con límite de 10 MiB y tipos PDF, PNG y JPEG. La consulta SQL real comprobó sus dos políticas de acceso y ausencia de lectura anónima de tablas. La carga y descarga por HTTP con sesiones reales permanecen pendientes.
- Vercel: proyecto renombrado a `trefil-os` bajo el espacio `administrativo914`. La conexión al repositorio privado de organización fue rechazada por el proveedor porque esa combinación no está admitida en Hobby y requiere Pro. No se compró un plan, no se cambió la visibilidad del repositorio y no se desplegó producción para eludir esa restricción.
- Preparación posterior de Vercel: el panel institucional sigue en Hobby y sin despliegues. Se guardó Next.js como framework, Node `24.x` y autenticación Vercel en **All Deployments**. La raíz remota es la del repositorio, sin subcarpeta. No se activaron complementos pagados ni enlaces de bypass. La publicación protegida y la conexión Git siguen pendientes de resolver el plan con aprobación explícita.

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
6. Resolver el alojamiento compatible sin compras ni cambios de plan no aprobados. Crear primero un preview verificado. Solo después de seguridad, funcionamiento y respaldo comprobados, considerar producción e importación autorizada de datos reales.

Un recurso creado o un panel que diga “conectado” no acredita una conexión completa. Este estado registra las operaciones comprobadas y conserva las limitaciones pendientes.
