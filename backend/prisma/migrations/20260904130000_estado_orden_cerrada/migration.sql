-- 0.061 · «Cerrar la orden» (§Post-F9.154(c), DANIEL) — PASO 1 DE 2: sólo el valor del enum.
--
-- Va SOLO en su propia migración a propósito: Postgres no deja USAR un valor de enum en la misma
-- transacción en que se agrega ("unsafe use of new value of enum type"), y Prisma corre cada
-- migración en una transacción. Separarlo deja libre a la siguiente (y a cualquier futura) para
-- referirse a 'cerrada' sin sorpresas. Mismo precedente que `20260710240000_rc_eventos_enums`.
--
-- `cerrada` es el único valor de `estado_orden` que NO se deriva de los requisitos: lo ponen los
-- actos explícitos `cerrarOrden`/`reabrirOrden` (permiso `ordenes.cerrar`). NO redefine `completa`
-- —que sigue significando completitud de CAPTURA— ni se confunde con `CierreMaquilaOrden`, que
-- cierra la orden con UN maquilero. Ver el TSDoc del enum en `schema.prisma`.
--
-- Aditiva y sin reescribir NADA: ninguna orden existente cambia de estado (REGLA 0-B).

-- AlterEnum
ALTER TYPE "estado_orden" ADD VALUE 'cerrada';
