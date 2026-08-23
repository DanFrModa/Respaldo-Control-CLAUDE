-- Rediseño R2 · Búsqueda sin acentos (requisito de Daniel §4.4.1: "oscar" debe encontrar a
-- "Óscar"). El `contains mode: 'insensitive'` de Prisma (ILIKE) ignora mayúsculas pero NO
-- acentos; la extensión contrib `unaccent` (estándar de PostgreSQL, incluida en la imagen
-- oficial) da la función `unaccent()` que usan las búsquedas de PROVEEDORES y CLIENTES
-- (`comun/busqueda.ts`). Migración ADITIVA pura (solo crea la extensión; no toca datos).

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS unaccent;
