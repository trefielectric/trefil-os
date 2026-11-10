# Trefil OS · Trefil Electric

Base modular para el control empresarial exclusivo de Trefil Electric. El espacio local empieza **limpio y en cero**, sin cuentas, movimientos, obligaciones, pagos, conciliaciones, documentos ni auditoría de ejemplo. Conserva el logo institucional original azul y amarillo. Todavía no existe un adaptador financiero que conecte este libro local a Supabase; no introducir información empresarial real hasta verificar esa conexión, los permisos y el respaldo.

## Inicio limpio

`createEmptyState` inicializa solamente Trefil Electric, una sede principal y un perfil técnico `local-owner`. Ese perfil identifica cambios en el navegador: **no representa una cuenta autenticada ni un propietario aprovisionado en Supabase**. Los formularios no precargan acreedores, cuentas, importes, tasas o cuotas ficticias.

El espacio nuevo utiliza `trefil-os:local:v1` y un bloqueo de escritura independiente. Los datos del escenario anterior, bajo `trefil-os:demo:v1`, se conservan sin cargarse, migrarse ni mezclarse con el libro nuevo. Este cambio no borra ni modifica recursos remotos. Los fixtures con COP 128.000.000 siguen disponibles exclusivamente para las pruebas automatizadas; no se usan como estado inicial de la aplicación.

## Ejecutar y verificar

Usar Node.js 24 y npm. Las versiones de dependencias están fijadas en `package.json` y `package-lock.json`.

```sh
npm ci
npm run dev
```

Abrir [la aplicación local](http://127.0.0.1:3000). La ruta `/` contiene el espacio financiero local vacío; `/acceso/` contiene el acceso institucional separado. Para comprobar el código:

```sh
npm run typecheck
npm test
npm run build
```

La compilación produce `out/` mediante la exportación estática de Next.js App Router. `npm run dev` sirve la versión de desarrollo; `next start` no sirve esta exportación. No se necesita ninguna credencial institucional para ejecutar las pruebas o abrir el espacio local. El CI ejecuta esos mismos controles sin secretos, migraciones remotas ni despliegues. El resultado final de las verificaciones del inicio limpio se registra en [Verificación](docs/verification.md); los resultados del escenario anterior son evidencia histórica.

## Primera fase disponible para revisión

- Tablero con saldos calculados, ingresos y gastos operativos, deuda, alertas y proyección de caja identificada como tal.
- Cuentas por sede y responsable, con autorización temporal para cuentas personales. Aperturas mediante asientos aprobados.
- Ingresos, gastos, traslados, anticipos, reembolsos, salarios, préstamos recibidos, gastos personales, ajustes y reversos equilibrados.
- Aprobación independiente desde COP 5.000.000 y para toda apertura, ajuste, gasto personal, pago de deuda y reverso. Los pendientes nunca cambian saldos.
- Obligaciones, distribución real de pagos entre capital e interés, tabla de amortización y simulador con gracia a capital, cambios de tasa y abonos extraordinarios.
- Conciliaciones, soportes, alertas con seguimiento y auditoría de las operaciones registradas; sin historial ficticio precargado.
- Migraciones PostgreSQL con RLS, RPC validadas, políticas para soportes privados y herramientas de respaldo cifrado y restauración aislada.

Los indicadores financieros arrancan en cero y las listas sin registros. La ausencia de un respaldo o de conexión institucional puede seguir generando avisos legítimos de configuración pendiente; no se inventan ejecuciones verificadas para ocultarlos. El almacenamiento local puede editarse o borrarse y no equivale a una base auditable ni a un respaldo empresarial. La autorización y aprobación empresarial requieren usuarios personales, sesiones y controles del backend verificados.

## Módulo Caja

La implementación de Caja incorpora turnos de efectivo, arqueo por denominaciones, registro y documentación de movimientos, seguimiento de legalizaciones, recepción de traslados, cierre mensual local, conciliación manual de extractos CSV e informes PDF/Excel. Las plantillas de ocho cuentas y cuatro pasarelas solo completan formularios: no crean cuentas, responsables ni dinero automáticamente. Bancos y billeteras registran operaciones directamente; los turnos corresponden exclusivamente a efectivo.

Las cinco decisiones que dejaba abiertas la especificación fueron confirmadas por el usuario. Las solicitudes de corrección y cierre excepcional permanecen pendientes de autorización institucional; no se simula MFA ni se acepta un PIN local como autorización empresarial. El alcance detallado, las decisiones y sus límites se describen en [Módulo Caja](docs/caja-module.md). La integración nueva está en verificación: no hereda automáticamente la evidencia de las 95 pruebas del inicio limpio.

Los importes se transportan como cadenas decimales y se calculan con centavos `BigInt`; PostgreSQL usa `numeric(18,2)`. Las tasas del simulador son porcentajes **mensuales vencidos**, con redondeo a centavos por período. El plan contractual y las proyecciones no representan pagos realizados ni una liquidación diaria del acreedor. Los anticipos y préstamos recibidos se distinguen de los ingresos y gastos operativos; el flujo de caja sí refleja sus entradas o salidas efectivas.

## Recursos institucionales identificados

| Recurso | Destino autorizado |
| --- | --- |
| GitHub público | [trefielectric/trefil-os](https://github.com/trefielectric/trefil-os), visibilidad autorizada expresamente por el usuario |
| Supabase | Organización `Trefielectric`, proyecto `trefil-os`, referencia `kifmqoolaerepvlzrqnk`, región São Paulo `sa-east-1` |
| Vercel | Cuenta verificada en navegador `administrativo914`; proyecto objetivo `trefil-os`; acceso GitHub limitado a este repositorio |
| Administración | `administracion@Trefielectric.onmicrosoft.com` |

La existencia de estos recursos no demuestra que Auth, RLS, Storage, el libro, respaldo o recuperación estén conectados y verificados. El estado operativo y las evidencias vigentes se registran en [Estado de implementación](docs/implementation-status.md). Los conectores de cuentas personales ajenas a este ámbito no autorizan cambios en los recursos institucionales.

## Acceso institucional

`/acceso/` usa Supabase Auth para inicio, recuperación, TOTP MFA y comprobación de membresía. Sin configuración pública válida mantiene los controles deshabilitados. Una identidad comprobada permanece en su pantalla separada; no obtiene una sesión financiera ni convierte los registros del navegador en información institucional.

La configuración prevista utiliza únicamente `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, introducidas directamente en el administrador del entorno autorizado. Se incorporan al build estático y requieren recompilar al cambiarlas. Nunca usar una clave `service_role`, `sb_secret_`, una contraseña PostgreSQL o una llave de respaldo en variables del navegador. El procedimiento y las pruebas reales pendientes se detallan en [Acceso y doble factor](docs/auth-setup.md).

## Preview y producción

El proyecto Vercel `administrativo914/trefil-os` está conectado al repositorio público y dispone de [un enlace de vista previa](https://trefil-os-git-codex-finance-preview-administrativo914.vercel.app/) en Hobby, sin contratar Pro. La última base publicada y verificada antes de integrar Caja fue `f62989b`, con estado Ready y CI aprobado. La nueva versión de Caja requiere su propia validación y publicación; ese enlace no acredita que todos los cambios de la copia de trabajo ya estén desplegados.

La configuración utiliza Next.js, raíz de repositorio vacía (el `package.json` remoto está en la raíz), Node `24.x`, instalación `npm ci` y build `npm run build`. Se eliminó el override `outputDirectory`: el adaptador de Vercel detecta `.next`, lee los manifiestos y procesa la exportación estática `out/`. Forzar `out` como directorio del adaptador causaba un error al buscar `routes-manifest.json`. `engines.node` fija la misma versión mayor que CI. La autenticación de Vercel está activada para **All Deployments**, sin enlaces de bypass. No se habilitó producción ni se contrataron complementos pagados. Cambiar el origen de localhost a Vercel crea un almacenamiento local separado y no sincroniza registros ni los conecta a PostgreSQL.

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
- [Módulo Caja: alcance, decisiones y verificación](docs/caja-module.md)

No se han conectado Microsoft Graph, Outlook, OneDrive ni Google Drive. La importación de documentos históricos requiere identificar su propietario y autorización específica. El repositorio contiene código y fixtures ficticios de pruebas; los secretos, respaldos y registros reales permanecen fuera de él.
