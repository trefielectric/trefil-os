# Trefil OS · Trefil Electric

Base modular para el control empresarial exclusivo de Trefil Electric. Esta entrega permite revisar y probar la primera fase financiera con datos ficticios. El libro de demostración se guarda en el navegador; todavía no existe un adaptador financiero que lo conecte a Supabase. No introducir operaciones, documentos ni información empresarial real.

## Ejecutar y verificar

Usar Node.js 24 y npm. Las versiones de dependencias están fijadas en `package.json` y `package-lock.json`.

```sh
npm ci
npm run dev
```

Abrir [la aplicación local](http://127.0.0.1:3000). La ruta `/` contiene la demostración financiera; `/acceso/` contiene el acceso institucional separado. Para comprobar el código:

```sh
npm run typecheck
npm test
npm run build
```

La compilación produce `out/` mediante la exportación estática de Next.js App Router. `npm run dev` sirve la versión de desarrollo; `next start` no sirve esta exportación. No se necesita ninguna credencial institucional para ejecutar las pruebas o la demostración. El CI ejecuta esos mismos controles sin secretos, migraciones remotas ni despliegues.

## Primera fase disponible para revisión

- Tablero con saldos calculados, ingresos y gastos operativos, deuda, alertas y proyección de caja identificada como tal.
- Cuentas por sede y responsable, con autorización temporal para cuentas personales. Aperturas mediante asientos aprobados.
- Ingresos, gastos, traslados, anticipos, reembolsos, salarios, préstamos recibidos, gastos personales, ajustes y reversos equilibrados.
- Aprobación independiente desde COP 5.000.000 y para toda apertura, ajuste, gasto personal, pago de deuda y reverso. Los pendientes nunca cambian saldos.
- Obligaciones, distribución real de pagos entre capital e interés, tabla de amortización y simulador con gracia a capital, cambios de tasa y abonos extraordinarios.
- Conciliaciones, evidencias ficticias, alertas con seguimiento y auditoría de operaciones y accesos de demostración.
- Migraciones PostgreSQL con RLS, RPC validadas, políticas para soportes privados y herramientas de respaldo cifrado y restauración aislada.

El escenario está fechado al 10 de noviembre de 2026. Las personas, cuentas, importes y soportes de ejemplo son ficticios. El selector de perfil prueba las reglas de interfaz y los reductores; cualquier persona con acceso al navegador puede cambiarlo. **No es autenticación empresarial**. El almacenamiento local puede editarse o borrarse y no equivale a una base auditable ni a un respaldo empresarial.

Los importes se transportan como cadenas decimales y se calculan con centavos `BigInt`; PostgreSQL usa `numeric(18,2)`. Las tasas del simulador son porcentajes **mensuales vencidos**, con redondeo a centavos por período. El plan contractual y las proyecciones no representan pagos realizados ni una liquidación diaria del acreedor. Los anticipos y préstamos recibidos se distinguen de los ingresos y gastos operativos; el flujo de caja sí refleja sus entradas o salidas efectivas.

## Recursos institucionales identificados

| Recurso | Destino autorizado |
| --- | --- |
| GitHub privado | [trefielectric/trefil-os](https://github.com/trefielectric/trefil-os) |
| Supabase | Organización `Trefielectric`, proyecto `trefil-os`, referencia `kifmqoolaerepvlzrqnk`, región São Paulo `sa-east-1` |
| Vercel | Cuenta verificada en navegador `administrativo914`; proyecto objetivo `trefil-os`; acceso GitHub limitado a este repositorio |
| Administración | `administracion@Trefielectric.onmicrosoft.com` |

La existencia de estos recursos no demuestra que Auth, RLS, Storage, el libro, respaldo o recuperación estén conectados y verificados. El estado operativo y las evidencias vigentes se registran en [Estado de implementación](docs/implementation-status.md). Los conectores de cuentas personales ajenas a este ámbito no autorizan cambios en los recursos institucionales.

## Acceso institucional

`/acceso/` usa Supabase Auth para inicio, recuperación, TOTP MFA y comprobación de membresía. Sin configuración pública válida mantiene los controles deshabilitados. Una identidad comprobada permanece en su pantalla separada; no obtiene una sesión financiera ni convierte la demostración en información real.

La configuración prevista utiliza únicamente `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, introducidas directamente en el administrador del entorno autorizado. Se incorporan al build estático y requieren recompilar al cambiarlas. Nunca usar una clave `service_role`, `sb_secret_`, una contraseña PostgreSQL o una llave de respaldo en variables del navegador. El procedimiento y las pruebas reales pendientes se detallan en [Acceso y doble factor](docs/auth-setup.md).

## Preview y producción

`vercel.json` deshabilita los despliegues Git de `main` y habilita la rama `codex/finance-preview`. La condición `ignoreCommand` ejecuta `scripts/vercel-build-gate.mjs`: un entorno `preview` retorna **1**, que permite construir; `production`, un entorno desconocido o una variable ausente retornan **0**, que omite el build según la convención de Vercel. Estos códigos no son los de una prueba convencional. [Referencia de Vercel](https://vercel.com/docs/project-configuration/vercel-json#ignorecommand).

Antes de vincular o importar Git, configurar y comprobar el proyecto vacío, el destino, la rama de producción y la protección de previews en el panel. La primera importación puede no ejecutar la condición de omisión. Este control de build tampoco impide que un administrador promueva un despliegue o use una salida precompilada: no autoriza ninguna de esas acciones. No publicar en producción hasta verificar Auth, permisos por sede y rol, Storage privado, movimientos reales de prueba, respaldo diario y restauración aislada. Mantener los previews protegidos y solo con datos ficticios durante la validación.

Las cabeceras limitan conexiones al origen institucional de Supabase y bloquean inclusión en marcos y objetos. La CSP admite `'unsafe-inline'` en scripts y estilos para la exportación estática de Next.js; **no es una política estricta con nonces**. Deben probarse sus cabeceras reales y los flujos de recuperación y MFA en el preview. No se incluyen analítica, grabación de sesiones ni scripts externos de negocio.

## Respaldo y continuidad

Las herramientas manuales están disponibles mediante `npm run backup`, `npm run backup:verify` y `npm run backup:restore`; exigen destinos y credenciales fuera de Git. [Recuperación](docs/recovery.md) contiene los requisitos, argumentos, copia al disco seleccionado y comprobaciones de seguridad. El workflow diario es optativo y no prueba que exista una copia. No activarlo hasta verificar una ejecución manual, el registro en `backup_runs`, su copia cifrada y una restauración aislada. El tablero debe conservar las alertas pendientes mientras falte evidencia.

## Documentación

- [Arquitectura y secuencia de puesta en marcha](docs/architecture.md)
- [Modelo de datos y contratos financieros](docs/data-model.md)
- [Seguridad y límites de verificación](docs/security.md)
- [Acceso institucional y MFA](docs/auth-setup.md)
- [Respaldo, retención y recuperación](docs/recovery.md)
- [Estado de implementación](docs/implementation-status.md)

No se han conectado Microsoft Graph, Outlook, OneDrive ni Google Drive. La importación de documentos históricos requiere identificar su propietario y autorización específica. El repositorio contiene código y ejemplos ficticios; los secretos, respaldos y registros reales permanecen fuera de él.
