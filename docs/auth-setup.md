# Acceso institucional y doble factor

La ruta `/acceso/` es una integración de identidad separada de la demostración de tesorería. No autoriza ni ejecuta operaciones financieras. Mientras falten las variables públicas, muestra “Supabase pendiente de configurar” y deshabilita inicio de sesión y recuperación; no simula una autenticación exitosa.

## Configuración autorizada

El proyecto institucional identificado es `kifmqoolaerepvlzrqnk`, organización Supabase `qsbgnwwoghrvrtmlvdsj`. La aplicación admite únicamente su origen HTTPS en producción. No conectar recursos de otros negocios. En desarrollo admite además un origen HTTP de loopback para una instancia aislada local.

Configurar mediante el administrador del entorno de preview y el archivo local **no versionado** cuando corresponda:

- `NEXT_PUBLIC_SUPABASE_URL`: origen público del proyecto institucional.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: clave con prefijo `sb_publishable_` obtenida directamente del panel institucional.

Ambos valores son públicos por diseño y se incorporan al build estático; cambiarlos exige volver a construir la aplicación. No usar `service_role`, claves `sb_secret_`, contraseña PostgreSQL ni credenciales de Microsoft. El módulo rechaza claves que no sean publicables. Nunca solicitar valores secretos por chat, leerlos en una captura ni escribirlos en Git.

Antes de iniciar una sesión institucional, conservar la confirmación del usuario de que cambió la contraseña expuesta y activó doble factor en la cuenta Microsoft. La autenticación TOTP de Supabase es un control independiente; no reemplaza ese requisito.

## Panel de Supabase

1. Habilitar Email/Password y TOTP MFA. Deshabilitar el registro público de usuarios; esta aplicación no ofrece `signUp` ni concede roles por correo o por metadatos de usuario.
2. Configurar Site URL y permitir únicamente el origen autorizado de preview y `/acceso/?recuperacion=1` como destino de recuperación. Para pruebas locales, permitir el origen local concreto. No usar comodines de producción ni aceptar un `returnTo` controlado por el visitante.
3. Configurar política de contraseñas de al menos 12 caracteres y protección frente a contraseñas filtradas si está disponible en el plan. No cambiar el plan sin aprobación. El cliente exige 12 caracteres; el proveedor debe imponer la política real.
4. Crear o invitar usuarios mediante el flujo administrativo autorizado. El propietario inicial necesita un perfil y membresía activa en `organizations.slug='trefielectric'` usando el procedimiento operador revisado. Posteriormente usar cuentas personales para la operación cotidiana.
5. Aplicar y probar RLS. Las decisiones de rol, actividad y sede deben consultarse en `profiles`, `organization_members`, `organizations` y `locations`; nunca en `user_metadata`. Las políticas y RPC financieras deben exigir `auth.jwt()->>'aal'='aal2'` en el servidor, además de la membresía y la sede. La comprobación de interfaz por sí sola no es autorización.

## Flujos implementados

- Inicio con correo y contraseña mediante `signInWithPassword`, sin creación automática de usuarios.
- Validación de la identidad con `getUser` y consulta de factores TOTP verificados y nivel de autenticación.
- Si falta AAL2, exige verificar un factor existente o configurar uno nuevo. El enrolamiento se inicia solo al pulsar su botón. Presenta únicamente el QR privado dentro del navegador del usuario; no guarda el secreto/URI en el estado de la aplicación, archivos, telemetría o registros. El QR contiene material secreto y no debe capturarse.
- La confirmación usa `challengeAndVerify`; el código se lee del formulario y se limpia después del intento. Cancelar una configuración solo elimina el factor no verificado de esa configuración, nunca un factor verificado. Al completar el enrolamiento, el proveedor eleva la sesión a AAL2 e invalida otras sesiones según su comportamiento documentado.
- Tras AAL2, consulta perfil activo, rol, membresía y sedes mediante las tablas con RLS. Una identidad sin perfil/membresía/sede o con errores de consulta conserva el bloqueo. No obtiene roles desde datos editables del usuario.
- La sesión se presenta como comprobada únicamente después de consultar la identidad real y la membresía. Muestra expresamente “La operación financiera institucional aún está en validación”; no redirige al libro ficticio ni carga datos de demostración.
- Recuperación mediante `resetPasswordForEmail`, destino construido desde el mismo origen y PKCE. Abrir el enlace en el mismo navegador donde se solicitó. Solo el evento `PASSWORD_RECOVERY` habilita la pantalla para cambiar contraseña. Si existe un factor verificado y falta AAL2, requiere ese factor antes del cambio. Si no hay factor, permite recuperar la contraseña y después obliga a enrolar MFA antes de comprobar la membresía.
- Actualización de contraseña mediante `updateUser`. No se muestran contraseñas ni se guardan en estado React; los campos se limpian al completar el intento. No se registran sesiones, tokens, respuestas del proveedor, códigos o secretos.
- Cierre de la sesión local mediante `signOut({scope:'local'})`. El alta/baja administrativa, revocación global y recuperación por pérdida del autenticador deben realizarse en flujos autorizados aparte; no se omite MFA desde esta pantalla.

El cliente conserva la sesión a través del almacenamiento del SDK bajo una clave institucional distinta del almacenamiento de la demostración. Esto exige TLS, protección frente a XSS, dependencias fijadas y dispositivos autorizados. Esta entrega estática no implementa sesiones HttpOnly ni sustituye una revisión de seguridad de producción. No servir scripts de analítica o grabación de sesiones en `/acceso/`.

## Verificación pendiente con el usuario

Se verificaron los tipos contra el SDK instalado y ocho comprobaciones aisladas de configuración y autorización, sin conexión externa. El agente principal completó el build estático de Next.js con webpack. Todavía hace falta probar el flujo real con el usuario introduciendo directamente contraseñas, correos de verificación y códigos en el navegador. No tomar capturas de la pantalla mientras contenga contraseñas, códigos o el QR. Comprobar correo/contraseña incorrectos, correo sin confirmar, recuperación válida y vencida, código TOTP incorrecto, MFA enrolado, sesión renovada, cierre, usuario inactivo, membresía revocada y sede no autorizada. Verificar también que las consultas y RPC directas a Supabase fallen con AAL1 y con identidades ajenas aunque se omita la interfaz.

No declarar este acceso operativo ni habilitar finanzas reales hasta completar esas comprobaciones y la recuperación aislada de respaldos.

Documentación consultada: [contraseña](https://supabase.com/docs/reference/javascript/auth-signinwithpassword), [recuperación](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail), [eventos de autenticación](https://supabase.com/docs/reference/javascript/auth-onauthstatechange), [enrolar MFA](https://supabase.com/docs/reference/javascript/auth-mfa-enroll), [nivel de autenticación](https://supabase.com/docs/reference/javascript/auth-mfa-getauthenticatorassurancelevel), [factores](https://supabase.com/docs/reference/javascript/auth-mfa-listfactors).
