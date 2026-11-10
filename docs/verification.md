# Verificación del 10 de noviembre de 2026

El espacio local empieza ahora limpio y en cero. La evidencia histórica del escenario de prueba y la estructura institucional de Supabase se conservan por separado. **No hay todavía una operación financiera real de navegador a PostgreSQL.**

## Revisión actual: inicio limpio

La revisión del código confirma que `/` inicializa `createEmptyState`: sin cuentas, movimientos, deudas, pagos, conciliaciones, documentos, respaldos ni auditoría precargados. Solo conserva la empresa, la sede principal y un perfil técnico `local-owner`, que no representa una sesión ni un usuario real de Supabase. Los formularios dejan vacíos los valores financieros y el logo institucional original azul y amarillo se conserva.

La clave del espacio nuevo es `trefil-os:local:v1`, con un bloqueo escritor separado. El escenario anterior `trefil-os:demo:v1` queda conservado sin cargarse ni migrarse. Los fixtures con COP 128.000.000 siguen dentro de las pruebas automatizadas; no se cargan en la interfaz ni prueban saldos empresariales.

Verificación final completada en esta revisión:

- `npm test`: **95 pruebas aprobadas** (80 TypeScript/PostgreSQL y 15 de respaldos/despliegue), incluidas ocho nuevas de inicialización vacía, preservación de datos existentes, separación del legado y errores de almacenamiento.
- `npm run typecheck` y `npm run build`: correctos; exportación estática de `/` y `/acceso/` generada.
- Navegador: cuatro indicadores en `$ 0`, cero cuentas, obligaciones, movimientos y eventos de auditoría. Tras recargar siguen vacíos y no reaparecen los ejemplos anteriores.
- Formulario de primera cuenta abierto y cancelado: campos sin datos de ejemplo y saldo inicial cero. Simulador abierto y cancelado: sin capital, tasa ni cuotas precargados. No se guardaron registros durante esta revisión.
- Móvil: ancho de contenido igual al viewport, sin desbordamiento horizontal y cuatro indicadores en cero. Consola sin errores ni advertencias. Pestaña duplicada de revisión cerrada; vista final activa sin aviso de bloqueo de escritura.
- Permanecen dos avisos legítimos: respaldo y restauración pendientes. No se simularon verificaciones ni se hicieron operaciones remotas.

Captura de la revisión: `/tmp/trefil-os-en-cero.png`.

## Evidencia histórica: código y compilación anteriores al reinicio

- TypeScript estricto aprobado.
- En la revisión anterior se aprobaron 87 pruebas: motor financiero, validación de copias, concurrencia local, PostgreSQL/RLS, exportación CSV, cifrado/restauración y protección de despliegues. No es todavía el resultado final de la revisión del inicio limpio.
- `npm run build` genera las rutas estáticas `/` y `/acceso/`. Se usa Webpack mediante una opción comprobada en la ayuda de Next.js 16.4.6: Turbopack de producción encontró una restricción de puertos del entorno de ejecución.
- Los fixtures PostgreSQL se ejecutan con PGlite. Auth y Storage allí son fixtures mínimos; no prueban los servicios HTTP de Supabase.

## Evidencia histórica: recorridos del escenario retirado

Estos recorridos corresponden a la demostración con fixtures anterior al reinicio. Se conservan como historial de validación del motor; **no describen el estado actual de la aplicación**, que ya no carga esas cuentas, personas, importes ni soportes.

1. Un gasto ficticio de COP 250.000,50 descontó exactamente ese valor de caja y del consolidado: COP 128.000.000 pasó a COP 127.749.999,50. El gasto y sus centavos permanecieron al recargar.
2. Una solicitud ficticia de COP 6.000.000 quedó pendiente sin descontar saldo. El intento de autoaprobación mostró «La aprobación requiere otra persona autorizada» dentro del diálogo.
3. Una segunda pestaña abrió en lectura. Un intento de guardar COP 1 fue rechazado con el motivo visible y sin crear el movimiento.
4. Se comprobó la presentación móvil a un ancho efectivo de 375 px. No hubo desbordamiento horizontal de la página ni recorte de los cuatro indicadores monetarios. Las tablas conservan desplazamiento propio.
5. La búsqueda encontró el movimiento ficticio y la exportación de la vista descargó un CSV de tres filas: encabezado y dos asientos, con COP 250000.50 exactos.
6. El simulador proyectó un préstamo de COP 30.000.000 a 1,5 % mensual en 12 cuotas: primera cuota COP 2.750.399,79, última COP 2.750.399,76 e intereses COP 3.004.797,45. La pantalla conserva la advertencia de que no registra pagos.
7. La consola de la pestaña de comprobación no devolvió errores ni advertencias.

La aprobación por otra persona, los reversos y las asignaciones de deuda también tienen pruebas automatizadas de los reductores y PostgreSQL. No se presentan como pruebas remotas con usuarios institucionales.

## Evidencia institucional conservada: Supabase

Destino observado: `kifmqoolaerepvlzrqnk`, organización Trefielectric, región São Paulo. Se inspeccionó primero el esquema público vacío y luego se aplicaron las tres migraciones iniciales dentro de una transacción desde SQL Editor. Una cuarta migración restringió EXECUTE del evento del proveedor; otra transacción de prueba confirmó que crear una tabla sigue activando RLS automáticamente y fue revertida sin dejar la tabla.

La consulta consolidada de `supabase/operations/verify.sql` devolvió:

| Control | Resultado |
|---|---|
| Tablas de negocio | 28 |
| RLS en todas | Sí |
| Lectura anónima de tablas | Denegada |
| Funciones públicas de aplicación | 10, todas SECURITY INVOKER |
| Ejecución anónima de esas funciones | Denegada |
| Bucket financial-supports | Privado, 10 MiB, PDF/PNG/JPEG |
| Políticas de soportes | 2 |
| Control consolidado | true |
| Evento automático de RLS del proveedor | rls_auto_enable, activo O, EXECUTE denegado a anon/authenticated |
| Security Advisor después del ajuste | 0 errores, 0 advertencias |
| Registro público / sesiones anónimas | Desactivados; confirmación de correo activa |

La función del proveedor devuelve `event_trigger` y usa `search_path=pg_catalog`. Se distingue de las RPC de aplicación. No se desactivó la RLS automática. Las versiones aplicadas desde el editor deben reconciliarse con el historial CLI antes de nuevas migraciones remotas. El cambio de inicio local vacío no modifica ni elimina esta infraestructura institucional.

## Pendientes que impiden habilitar dinero real

Adaptador financiero por RPC; usuarios personales y propietario verificado en Auth; pruebas HTTP de MFA, RLS y Storage; alta de deudas idempotente y límites UI/SQL unificados; respaldo diario real, restauración aislada y copia externa verificadas. Vercel rechazó enlazar el repositorio privado de organización en Hobby; requiere resolver el plan con aprobación del propietario. No se compró un plan ni se desplegó producción.
