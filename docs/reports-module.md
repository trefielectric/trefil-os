# Módulo Informes · alcance local

El panel **Informes** centraliza las definiciones ya aprobadas de Caja, Inventarios y Deudas. No crea un cálculo paralelo: la vista previa, el PDF y el XLSX reciben el mismo objeto de reporte, período, sede y corte. Cada archivo conserva el identificador de su versión y la identidad gráfica azul y amarilla de Trefil Electric.

## Controles implementados

- Períodos por día, mes, trimestre, año o fechas personalizadas, siempre con corte no posterior a la fecha actual.
- Caja se presenta como movimientos del período y saldos al corte. Inventarios se presenta como fotografía al corte; sus valores mensuales no se suman entre sí. Deudas conserva saldos reconocidos, movimientos y pagos documentados.
- Los valores desconocidos se muestran como **Sin dato**. La ausencia de historia no se convierte en cero ni se rellena con estimaciones.
- La descarga está restringida a los roles locales Creador, Gerencia, Tesorería y Contabilidad. Los demás roles pueden recibir una vista previa, pero no el archivo.
- Cada solicitud y resultado de descarga registra usuario, hora, módulo, período, sede, formato, identificador y estado en la auditoría local. No se almacena una copia permanente del archivo.
- Solo se permite una generación simultánea en la pestaña; el botón permanece bloqueado durante el trabajo para evitar duplicados accidentales.

## Límites conservados

El motor funciona en el navegador y no sustituye una cola institucional, almacenamiento temporal de servidor ni autorización remota. La bitácora depende del control de escritura local; si no puede registrarse la solicitud, la descarga no comienza. Producción, Reportes generales y Control Administrativo no aparecen como informes disponibles porque esos módulos todavía no han definido contenido, filtros, permisos y fuente de datos. No se ofrecen Word o CSV.

La cobertura histórica comienza únicamente cuando existan registros reales cargados. El panel no modifica las operaciones de origen y no conserva los archivos generados. La publicación actual es una vista previa protegida para validación y no autoriza usarla como sistema empresarial conectado.
