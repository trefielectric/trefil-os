# Respaldo y recuperación de Trefil OS

Estado: herramientas implementadas y pruebas locales de cifrado ejecutadas. El agente principal aplicó las cuatro migraciones mediante el editor SQL institucional a `kifmqoolaerepvlzrqnk`; una consulta comprobó 28 tablas de negocio con RLS activo. Esa aplicación manual no registra automáticamente el historial de migraciones. La captura lógica real, ejecución diaria activa, restauración real y copia externa todavía no están comprobadas. El panel debe conservar esas advertencias hasta recibir evidencia real. Véase `implementation-status.md` para los recursos y bloqueos actuales.

## Qué contiene una copia

`backup` crea un `pg_dump` lógico completo en formato custom, sin propietarios y **conservando las ACL de permisos y revocaciones**. No se usa `--no-privileges`: perder esos permisos impediría una recuperación fiel de las políticas de acceso. Incluye los datos y esquemas que pueda leer la credencial PostgreSQL; esta debe tener lectura suficiente también sobre Auth y Storage. La instancia aislada de restauración debe tener los roles de infraestructura requeridos antes de empezar.

Antes de capturar, la herramienta comprueba que la base contiene exactamente una empresa, con el UUID configurado, `slug='trefielectric'` y nombre `Trefil Electric`; rechaza una base de otro negocio o con varias empresas. El origen Storage remoto debe corresponder a `kifmqoolaerepvlzrqnk.supabase.co`; una instancia HTTP de loopback se admite para ensayos aislados. Descarga todos los objetos de los buckets privados configurados bajo el prefijo UUID de la empresa. No se permite omitir los documentos: una configuración vacía, bucket público, error de descarga, objeto de más de 100 MiB o cambio de objetos durante la captura hace fallar la copia.

El manifiesto interior incluye fecha UTC, zona de presentación America/Bogota, origen, versión de `pg_dump`, tamaño y SHA-256 de cada archivo, alcance documental y retención. Una comparación de listados antes y después de la captura detecta cambios concurrentes en los documentos; los soportes deben ser inmutables. No se considera una captura consistente si los listados cambian.

Un contenedor de archivos propio evita extraer symlinks o rutas de archivos arbitrarias. Se cifra mediante AES-256-GCM con llave aleatoria de 256 bits y nonce aleatorio de 96 bits. El encabezado queda autenticado. El archivo `.trefilenc.json` contiene un recibo sin información empresarial, con SHA-256 y tamaño de la copia cifrada. El manifiesto empresarial permanece dentro del cifrado.

La verificación vuelve a comprobar el recibo, autentica el cifrado, extrae en un directorio temporal privado, verifica cada archivo y ejecuta `pg_restore --list`. Eso permite marcar `backup_runs.status='verified'`; **no verifica una restauración**. `restoration_verified_at` se completa únicamente después de restaurar realmente y pasar las comprobaciones de integridad.

## Preparación del operador

1. La confirmación de contraseña institucional cambiada y doble factor ya fue recibida. Mantener ese control y introducir secretos directamente en los administradores autorizados, nunca en el chat o en Git.
2. Instalar Node.js 24 y clientes PostgreSQL `pg_dump`, `pg_restore`, `psql` de versión compatible con el servidor. Conservar las extensiones y roles de infraestructura necesarios para una recuperación de Supabase en una instancia aislada.
3. Crear la credencial PostgreSQL de respaldo con lectura suficiente y una credencial de registro con los permisos mínimos documentados en `supabase/operations`. No usar la clave administrativa de Supabase en el navegador.
4. Crear una llave aleatoria de 32 bytes **en el administrador de secretos**, representada en base64. Configurar `TREFIL_BACKUP_KEY` y custodiar una segunda copia de esa llave fuera del equipo y fuera del repositorio. Una copia cifrada sin su llave no se puede recuperar. Rotar las llaves conservando las antiguas mientras existan copias cifradas con ellas.
5. Configurar las variables siguientes en el entorno del proceso, sin poner valores en los argumentos de terminal ni en archivos versionados.

| Variable | Uso |
| --- | --- |
| `TREFIL_BACKUP_ORGANIZATION_ID` | UUID de Trefil Electric; no inferirlo de otra empresa. |
| `TREFIL_BACKUP_KEY` | Llave base64 de 32 bytes. Solo operador. |
| `TREFIL_BACKUP_PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` | Agregar el prefijo `TREFIL_BACKUP_` a **cada** nombre (`TREFIL_BACKUP_PGPORT`, etc.). También se admiten `PGSERVICE` y `PGSERVICEFILE` con ese prefijo. |
| `TREFIL_BACKUP_PGPASSWORD` o `TREFIL_BACKUP_PGPASSFILE` | Secreto de conexión; el archivo externo debe tener permisos privados. |
| `TREFIL_BACKUP_PGSSLMODE`, `TREFIL_BACKUP_PGSSLROOTCERT` | Para origen remoto, `verify-full` y certificado del proveedor. La herramienta establece `verify-full` si falta y rechaza otros modos remotos. Nunca desactivar TLS para resolver errores. |
| `TREFIL_RECORD_PG*` | Conexión opcional separada para registrar estados; si falta se usa la de respaldo. Mismos sufijos que arriba. |
| `TREFIL_SUPABASE_URL` | Origen HTTPS del proyecto correcto. |
| `TREFIL_SUPABASE_BACKUP_SECRET` | Clave administrativa del servicio o secreto dedicado con lectura de Storage. Solo proceso de respaldo. |
| `TREFIL_BACKUP_BUCKETS` | Nombres exactos de buckets privados, separados por comas. |
| `TREFIL_BACKUP_OUTPUT` | Directorio privado fuera de cualquier checkout Git. |
| `TREFIL_BACKUP_RETENTION_DAYS` | Entre 7 y 3650; predeterminado 30. |

Los procesos PostgreSQL reciben solamente las variables PG seleccionadas; la llave de cifrado y secretos de Supabase no pasan a ellos. Sus errores se reportan mediante códigos estables sin volcar consultas, documentos ni cadenas de conexión.

## Respaldo manual y comprobación

Desde la raíz del proyecto, con el entorno ya configurado:

```sh
node scripts/backup/cli.mjs backup --output /ruta/privada/fuera-del-repositorio
node scripts/backup/cli.mjs verify --file /ruta/privada/trefil-UUID.trefilenc
```

Se genera un ID único por ejecución. El estado pasa de `running` a `verified` únicamente tras la comprobación completa; cualquier fallo posterior a crear el registro cambia su estado a `failed`. Si el propio registro no está disponible se emite `BACKUP_REGISTRY_UNAVAILABLE` y el proceso termina con error. Una tarea de supervisión externa y el estado del job deben detectar también ese caso; el monitor del panel debe alertar si transcurren 24 horas sin copia verificada.

Los archivos temporales en claro se crean con permisos privados y se eliminan al cerrar la operación. No hay garantía de borrado físico en SSD; ejecutar los procesos en un disco/runner con cifrado de volumen. Nunca conservar respaldos, recibos empresariales, volcados ni llaves en Git.

## Recuperación aislada

Crear previamente una **base vacía nueva** en una instancia local aislada compatible con la versión PostgreSQL, extensiones y roles de infraestructura del origen. Puede ser una instancia local Supabase, pero no su base predeterminada ya poblada. No conectar esa instancia a integraciones, correo ni webhooks reales. Los volcados ejecutan código del origen: usar únicamente copias propias verificadas y una instancia sin acceso a producción.

Configurar `TREFIL_RESTORE_ACK=isolated-local-database`, `TREFIL_RESTORE_PGHOST` como `127.0.0.1`, `localhost` o `::1`, `TREFIL_RESTORE_PGDATABASE` con prefijo `trefil_restore_` y los demás `TREFIL_RESTORE_PG*` necesarios. No se admiten servicios, hosts remotos ni URL como nombre de base. Configurar además `TREFIL_RESTORE_DOCUMENTS_DIRECTORY` fuera de Git.

```sh
node scripts/backup/cli.mjs restore --file /ruta/privada/trefil-UUID.trefilenc
```

El comando rechaza una base con relaciones existentes, el nombre de la base de origen, o un destino que no cumpla las restricciones. Nunca usa `--clean` ni `--create`. Ejecuta `pg_restore --single-transaction --exit-on-error`, comprueba que todos los asientos contabilizados estén equilibrados y que las claves foráneas estén validadas. Verifica y conserva una copia aislada de los documentos para inspección. Solo entonces registra `restoration_verified_at` en el registro institucional usando la credencial específica de registro.

No realiza una recuperación de producción ni sube archivos a Storage. Para aprobar una recuperación empresarial hacen falta además pruebas de inicio de sesión, permisos y sedes, lectura de soportes desde un **Storage aislado**, comparación de saldos contra evidencia contable y confirmación de integraciones desactivadas. Una restauración fallida exige una nueva base vacía; la herramienta no limpia la anterior. No declarar continuidad empresarial comprobada solo por ejecutar este comando.

## Copia al disco externo

Solicitar al usuario que conecte y seleccione el disco. Enumerar volúmenes únicamente entonces, confirmar el destino concreto y configurar `TREFIL_EXTERNAL_VOLUME` con ese volumen montado. El comando exige un montaje real distinto del sistema, con ruta explícita en `/Volumes`, `/media` o `/mnt`, sin symlinks. No selecciona ni formatea un disco.

```sh
node scripts/backup/cli.mjs copy-external --file /ruta/privada/trefil-UUID.trefilenc --directory /Volumes/DISCO_ELEGIDO/TrefilOS
```

Verifica la copia de origen, copia únicamente el archivo cifrado y su recibo sin sobrescribir, sincroniza ambos archivos con el sistema de archivos y compara sus checksums de destino. Solo después registra `external_copy_verified_at`. El disco puede permanecer desconectado tras expulsarlo de forma segura; esa desconexión mejora la separación ante incidentes.

## Ejecución diaria y retención

El workflow `backup.yml` está preparado para las **03:00 de Colombia (08:00 UTC)**, con exclusión mutua para evitar ejecuciones simultáneas. No se activa hasta que `TREFIL_BACKUP_ENABLED=true`, existan todos los secretos en el entorno `backups`, el proyecto sea la raíz del repositorio privado y se compruebe una ejecución manual. Los horarios de GitHub Actions pueden retrasarse; por eso se requiere el control de antigüedad de 24 horas y notificaciones de fallos del repositorio. Una contingencia local necesita su propio planificador si GitHub no está disponible.

Las acciones externas están fijadas al SHA verificado de sus releases oficiales. El cliente PostgreSQL se selecciona por `TREFIL_POSTGRES_CLIENT_MAJOR` (predeterminado 18); el runner debe tener esa versión instalada y alcanzar la base. Solo se suben los dos archivos cifrados a un artifact privado con retención de 30 días. No hay caché ni artifact de archivos en claro. Conservar al menos una copia adicional independiente; no depender únicamente de artifacts de GitHub para retención empresarial.

La retención local exige un comando explícito y `TREFIL_RETENTION_ACK=expired-encrypted-backups-only`. Solo elimina archivos de la herramienta cuya autenticidad pueda verificar y preserva siempre la copia verificada más reciente. Nunca elimina material desconocido o corrupto ni una base de datos:

```sh
node scripts/backup/cli.mjs prune --directory /ruta/privada/fuera-del-repositorio --days 30
```

Antes de activar el cron, probar fallo de conexión, llave incorrecta, alteración del archivo cifrado, caída de Storage, copia al disco elegido y recuperación aislada. Registrar evidencias y responsables. Objetivo inicial propuesto: RPO de 24 horas, RTO pendiente de medir en la primera restauración real. La periodicidad y capacidad de retención final se deben validar con el volumen de documentos y la política empresarial.

Referencias consultadas: [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html), [Storage privado](https://supabase.com/docs/guides/storage/buckets/fundamentals), [listar objetos](https://supabase.com/docs/reference/javascript/storage-from-list), [descargar objetos](https://supabase.com/docs/reference/javascript/storage-from-download).
