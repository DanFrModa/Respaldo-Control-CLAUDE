# ADR-0008 — `schema.prisma` archivo único (no `prismaSchemaFolder`) en F1

- **Estado:** Aceptado
- **Fecha:** 2026-06-12
- **Decisores:** team-lead F1 (decisión técnica; la otra decisión temprana de F1-E1)

## Contexto

`PLANMAESTRO.md` §3 menciona el esquema "por dominios". Prisma 7 ofrece la opción
`prismaSchemaFolder` (carpeta `prisma/schema/` con varios `.prisma` por dominio) en lugar de
un único `schema.prisma`. F0 entregó **un archivo único** (`backend/prisma/schema.prisma`, 14
modelos). F1 agrega muchas tablas (catálogos, materiales, modelos+BOM) repartidas entre
varios coders, así que la ficha de F1-E1 pide decidir al arrancar si se activa
`prismaSchemaFolder` o se mantiene el archivo único con el protocolo de integración.

## Decisión

**Se mantiene el `schema.prisma` único** durante F1, gobernado por el **protocolo de
integración** de cada etapa: el esquema de las tablas de la etapa se diseña junto al arrancar
y **una sola migración consolidada** la produce el coder integrador (no una migración por
pieza). El archivo se mantiene ordenado por **secciones comentadas por dominio**
(`// ─── Catálogos ───`, etc.).

## Consecuencias

- (+) Cero cambios de tooling/CI en la fase que **consolida el patrón** CRUD; menos
  superficie de error.
- (+) Una migración por etapa (no varias en conflicto) → historial de migraciones limpio.
- (−) `schema.prisma` crece de tamaño; se mitiga con las secciones por dominio y el índice de
  modelos al inicio del archivo.
- Se **reevalúa activar `prismaSchemaFolder`** si el archivo se vuelve difícil de manejar
  (candidato natural: al entrar F2/F3, que agregan los dominios operativos pesados).

## Alternativas consideradas

- **Activar `prismaSchemaFolder` ahora:** alinea con el "por dominios" del plan, pero cambia
  la estructura justo en la fase donde se afina el patrón y donde varios coders integran;
  riesgo sin beneficio inmediato. Pospuesta, no descartada.

## Vuelta atrás

Activar `prismaSchemaFolder` es **transparente para las migraciones** (no cambia el SQL
generado): se mueve cada bloque de modelos a su archivo bajo `prisma/schema/` y se ajusta la
config del generador. Reversible en cualquier fase.

## Referencias cruzadas

- `PLANMAESTRO.md` §3 (estructura "por dominios") y §9.1 (protocolo de integración).
- `docs/hoja-de-ruta/F1-etapas.md`, F1-E1 (decisión temprana) y "Notas de la fase".
- `backend/prisma/schema.prisma`.
