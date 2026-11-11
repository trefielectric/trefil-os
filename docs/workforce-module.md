# Equipo

Desde `/equipo/`, cada persona ve su ficha, las tareas de la fecha elegida y sus marcaciones. El cargo y el área identifican su trabajo. Los permisos del módulo se asignan por separado.

- **Colaborador**. Consulta sus registros, marca llegada y salida y actualiza sus tareas.
- **Coordinador**. Con doble factor, consulta asistencia y programa tareas para sus personas asignadas.
- **Administrador**. Con doble factor, crea fichas, edita cargos y permisos, asigna coordinadores, administra invitaciones y consulta todo el equipo.

La base de datos asigna las marcas de tiempo. Solo hay una jornada abierta por persona. Un nuevo ingreso tras la salida abre otro tramo. Se conserva la llegada original al cerrar después de medianoche, y la vista por día cuenta solo el tiempo correspondiente a esa fecha en Bogotá. El sistema registra la marcación de la cuenta. La ubicación, el control físico de acceso y los cálculos de nómina quedan fuera de este módulo.

## Habilitar el primer administrador

1. Aplica las migraciones y despliega `workforce-invite`. El módulo empieza vacío.
2. Abre `/equipo/`. La pantalla inicial permite registrar cédula, nombre, cargo, área y contraseña sin entrar al panel de Supabase.
3. Usa **Verificar para gestionar** para configurar o verificar TOTP. Regresa a Equipo, abre **Gestionar equipo** y entra a **Personas**.
4. En **Funciones y roles**, crea roles propios o ajusta Coordinador y Colaborador. Cada función controla una acción o una lectura concreta; Administrador permanece protegido con todas las funciones.

La cédula completa se normaliza y convierte en una huella SHA-256 en el navegador. Supabase recibe la huella y conserva únicamente sus últimos cuatro dígitos para identificación visual; la cédula completa no se almacena.

## Invitar personas y programar tareas

Crea la ficha con nombre, cédula, cargo, área, permiso y coordinador si corresponde. Pulsa **Crear acceso** y comparte el enlace de un solo uso por un canal privado. Cada colaborador define su propia contraseña y después ingresa con cédula. Para una cuenta vinculada, **Restablecer acceso** emite un enlace de recuperación desde la misma plataforma.

En **Plan del día**, elige fecha y persona. **Programar tarea** permite definir un título, instrucciones y una hora límite opcional. Puedes editar una tarea pendiente o cancelar una tarea abierta. Las personas pueden marcar sus tareas como en curso y completadas.

## Conexión

- El frontend usa las variables públicas institucionales `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Despliega `workforce-invite` en el proyecto institucional. La creación inicial está limitada a un único administrador mediante bloqueo transaccional. Para los demás enlaces, su RPC comprueba la firma de la sesión, el doble factor y el rol activo. La clave privada permanece en el entorno de Supabase.
- La función admite el dominio de la vista previa y los orígenes adicionales explícitos de `WORKFORCE_APP_ORIGINS` si se configura otro dominio. Los enlaces de activación y recuperación se entregan directamente al administrador y no dependen de correo SMTP.
- Los datos se guardan en Supabase. El esquema `workforce` queda fuera de la lista de esquemas expuestos y los permisos no usan metadatos editables ni los perfiles locales de Finanzas.
- La matriz de funciones vive en `workforce.roles`, `workforce.permissions` y `workforce.role_permissions`. La interfaz usa las capacidades devueltas para mostrar controles, pero PostgreSQL vuelve a comprobar el rol, la función, el alcance sobre reportes directos y AAL2 en cada RPC.
- Los roles personalizados pueden controlar asistencia propia, tareas propias, consulta del equipo, asistencia del equipo, programación/cancelación de tareas, personas, accesos y administración de roles. Los roles base Coordinador y Colaborador se pueden ajustar; Administrador no se puede desactivar ni vaciar.
