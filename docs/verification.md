# Verificación del 10 de noviembre de 2026

La demostración financiera y la estructura institucional de Supabase se verificaron por separado. **No hay todavía una operación financiera real de navegador a PostgreSQL.**

## Código y compilación

- TypeScript estricto aprobado.
- 87 pruebas aprobadas: motor financiero, validación de copias, concurrencia local, PostgreSQL/RLS, exportación CSV, cifrado/restauración y protección de despliegues.
- `npm run build` genera las rutas estáticas `/` y `/acceso/`. Se usa Webpack mediante una opción comprobada en la ayuda de Next.js 16.4.6: Turbopack de producción encontró una restricción de puertos del entorno de ejecución.
- Los fixtures PostgreSQL se ejecutan con PGlite. Auth y Storage allí son fixtures mínimos; no prueban los servicios HTTP de Supabase.

## Recorridos en el navegador

1. Un gasto ficticio de COP 250.000,50 descontó exactamente ese valor de caja y del consolidado: COP 128.000.000 pasó a COP 127.749.999,50. El gasto y sus centavos permanecieron al recargar.
2. Una solicitud ficticia de COP 6.000.000 quedó pendiente sin descontar saldo. El intento de autoaprobación mostró «La aprobación requiere otra persona autorizada» dentro del diálogo.
3. Una segunda pestaña abrió en lectura. Un intento de guardar COP 1 fue rechazado con el motivo visible y sin crear el movimiento.
4. Se comprobó la presentación móvil a un ancho efectivo de 375 px. No hubo desbordamiento horizontal de la página ni recorte de los cuatro indicadores monetarios. Las tablas conservan desplazamiento propio.
5. La búsqueda encontró el movimiento ficticio y la exportación de la vista descargó un CSV de tres filas: encabezado y dos asientos, con COP 250000.50 exactos.
6. El simulador proyectó un préstamo de COP 30.000.000 a 1,5 % mensual en 12 cuotas: primera cuota COP 2.750.399,79, última COP 2.750.399,76 e intereses COP 3.004.797,45. La pantalla conserva la advertencia de que no registra pagos.
7. La consola de la pestaña de comprobación no devolvió errores ni advertencias.

La aprobación por otra persona, los reversos y las asignaciones de deuda también tienen pruebas automatizadas de los reductores y PostgreSQL. No se presentan como pruebas remotas con usuarios institucionales.

## Supabase institucional

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

La función del proveedor devuelve `event_trigger` y usa `search_path=pg_catalog`. Se distingue de las RPC de aplicación. No se desactivó la RLS automática. Las versiones aplicadas desde el editor deben reconciliarse con el historial CLI antes de nuevas migraciones remotas.

## Pendientes que impiden habilitar dinero real

Adaptador financiero por RPC; usuarios personales y propietario verificado en Auth; pruebas HTTP de MFA, RLS y Storage; alta de deudas idempotente y límites UI/SQL unificados; respaldo diario real, restauración aislada y copia externa verificadas. Vercel rechazó enlazar el repositorio privado de organización en Hobby; requiere resolver el plan con aprobación del propietario. No se compró un plan ni se desplegó producción.
