# ADR-0005 — Campos de auditoría sin FK físico hacia Usuario

- **Estado:** Aceptado
- **Fecha:** 2026-06-10
- **Decisores:** team-lead F0 (arbitraje surgido de la review del modelo de datos)

## Contexto

El plan maestro exige **"llaves foráneas reales con integridad referencial (A2)"** (§4). El
schema de F0 (`backend/prisma/schema.prisma`) implementa la auditoría uniforme (A7) con
campos `creadoPorId`/`modificadoPorId` en toda entidad de dominio — más `Bitacora.idUsuario`
y `Archivo.subidoPorId` — que referencian al usuario **sin constraint FK físico** en la base
de datos. A primera vista parece contradecir A2, así que la regla queda arbitrada y escrita
aquí de una vez para todo el sistema.

Hechos que pesan:

- Los usuarios **jamás se borran físicamente**: el patrón es borrado suave (`activo`,
  plan §4 — patrón conservado del sistema viejo), así que el escenario que un FK previene
  (apuntar a un usuario inexistente) no ocurre por operación normal.
- Un FK formal por cada campo de auditoría generaría **decenas de relaciones inversas en
  `Usuario`** (dos por cada tabla de dominio, en todas las fases) sin ningún valor de
  consulta: nadie navega "todas las filas de todas las tablas que tocó este usuario" por
  ORM; eso lo responde la `Bitacora`.
- El **único escritor** de estos campos es la capa de dominio del backend (A1:
  `backend/src/dominio` apoyado en `backend/src/comun/auditoria`): toma el id de la **sesión
  validada** (`SesionUsuario`), nunca de entrada del cliente — la validez del valor está
  garantizada en la capa que escribe.
- La trazabilidad fina (quién cambió qué y cuándo) la complementa la **`Bitacora`** (A7),
  que registra el historial de cambios de lo crítico.

## Decisión

Se acepta como **estándar para todo el sistema**:

1. **A2 aplica íntegro a las relaciones de DOMINIO:** toda relación con significado de
   negocio lleva FK real con `onDelete: Restrict` (ej. `Almacen.idEmpresa`,
   `UsuarioRol.idUsuario`, `RolPermiso`, `Secuencia.idEmpresa`).
2. **Los campos de auditoría son metadatos transversales EXENTOS de FK físico:**
   `creadoPorId`/`modificadoPorId` en entidades de dominio, `Bitacora.idUsuario` (log
   inmutable) y `Archivo.subidoPorId`. Se pueblan exclusivamente desde la capa de dominio del
   backend con el id de la sesión.
3. La distinción es por **semántica del campo**, no por tabla: si un campo de usuario tiene
   significado de negocio (p. ej. "responsable de un proceso de la Ruta Crítica"), es
   relación de dominio y **sí** lleva FK.

## Consecuencias

- (+) Toda fase futura (F1–F9) replica este criterio **sin re-discutirlo**: los reviews lo
  citan como ADR-0005 en lugar de re-litigar A2.
- (+) El modelo `Usuario` se mantiene limpio (solo relaciones con significado), y las
  migraciones no cargan con índices/constraints sin valor.
- (−) La base de datos no impide, por sí sola, un id de usuario inválido en un campo de
  auditoría; la garantía vive en la capa de dominio (A1). Asumido: es la misma capa que ya
  garantiza permisos y transacciones.
- **Si algún día se decidiera borrar usuarios físicamente, este ADR se revisita PRIMERO**
  (los campos de auditoría quedarían colgando y habría que elegir: FKs `SET NULL`,
  usuario-fantasma, o archivado).

## Alternativas consideradas

- **FK físico en todos los campos de auditoría:** cumple A2 literal, pero infla `Usuario`
  con decenas de relaciones inversas sin uso y encarece cada migración futura. Descartada.
- **FK físico sin relación inversa:** Prisma exige declarar ambos lados de una `@relation`;
  no existe FK "de un solo lado" en su modelo. Descartada por imposible con la herramienta.
- **Guardar username en vez de id:** rompería la trazabilidad al renombrar y duplica datos.
  Descartada.

## Vuelta atrás

Reversible con una migración: agregar los constraints (`ALTER TABLE … ADD FOREIGN KEY`) es
seguro porque los valores existentes son ids de sesiones válidas. El costo es solo el ruido
de relaciones inversas en el schema Prisma.

## Referencias cruzadas

- Header de `backend/prisma/schema.prisma` (convenciones) y comentarios de los modelos
  `Bitacora` y `Archivo`.
- Plan maestro §4 (reglas globales del modelo de datos: A2, borrado suave, A7) y §3 (A1:
  el dominio del backend como único escritor).
