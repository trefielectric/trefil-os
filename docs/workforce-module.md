# Equipo

Desde `/equipo/`, cada persona ve su ficha, las tareas de la fecha elegida y sus marcaciones. El cargo y el área identifican su trabajo. Los permisos del módulo se asignan por separado.

- **Colaborador**. Consulta sus registros, marca llegada y salida y actualiza sus tareas.
- **Coordinador**. Con doble factor, consulta asistencia y programa tareas para sus personas asignadas.
- **Administrador**. Con doble factor, crea fichas, edita cargos y permisos, asigna coordinadores, administra invitaciones y consulta todo el equipo.

La base de datos asigna las marcas de tiempo. Solo hay una jornada abierta por persona. Un nuevo ingreso tras la salida abre otro tramo. Se conserva la llegada original al cerrar después de medianoche, y la vista por día cuenta solo el tiempo correspondiente a esa fecha en Bogotá. El sistema registra la marcación de la cuenta. La ubicación, el control físico de acceso y los cálculos de nómina quedan fuera de este módulo.

## Habilitar el primer administrador

1. Aplica la migración `20261111140836_workforce.sql` en el proyecto institucional. El módulo empieza vacío.
2. En Supabase Auth, el operador crea la identidad verificada del primer administrador. El titular define y guarda su contraseña personalmente. Mantén desactivado el registro público.
3. Ejecuta `supabase/operations/bootstrap-workforce-admin.sql` con el correo, nombre, cargo y área confirmados. La operación vincula una identidad existente y no otorga permisos financieros.
4. Inicia sesión en `/equipo/` y usa **Verificar para gestionar** para configurar o verificar TOTP. Regresa a Equipo, abre **Gestionar equipo** y entra a **Personas**.

## Invitar personas y programar tareas

Crea la ficha con nombre, correo de trabajo, cargo, área, permiso y coordinador si corresponde. Pulsa **Crear invitación** y comparte el enlace de un solo uso por un canal privado. Cada colaborador define su propia contraseña. Si ya tiene cuenta, entra con su contraseña existente. La primera sesión con correo confirmado vincula la identidad a su ficha.

En **Plan del día**, elige fecha y persona. **Programar tarea** permite definir un título, instrucciones y una hora límite opcional. Puedes editar una tarea pendiente o cancelar una tarea abierta. Las personas pueden marcar sus tareas como en curso y completadas.

## Conexión

- El frontend usa las variables públicas institucionales `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Despliega `workforce-invite` en el proyecto institucional. Su RPC comprueba la firma de la sesión, el doble factor y el rol activo antes de emitir un enlace. La clave privada permanece en el entorno de Supabase.
- La función admite el dominio de la vista previa y los orígenes adicionales explícitos de `WORKFORCE_APP_ORIGINS` si se configura otro dominio. La recuperación de contraseña requiere un remitente SMTP apto para los destinatarios y el redireccionamiento permitido a `/acceso/?recuperacion=1`.
- Los datos se guardan en Supabase. El esquema `workforce` queda fuera de la lista de esquemas expuestos y los permisos no usan metadatos editables ni los perfiles locales de Finanzas.
