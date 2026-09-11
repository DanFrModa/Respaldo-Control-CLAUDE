/**
 * ⭐ FILA 0.180 — helper de PRUEBA: ¿el motivo llegó a las `observaciones` del inverso?
 *
 * Cancelar es el único movimiento que deshace a otro, y el sistema OBLIGA a escribir un motivo
 * para hacerlo. Desde la 0.180 ese motivo se guarda en las `observaciones` del movimiento INVERSO
 * (`comun/kardex.ts`, `textoCancelacion`) para que se lea en el kardex, no sólo en la bitácora.
 *
 * 🔴 POR QUÉ EXISTE ESTE HELPER Y NO UNA SOLA PRUEBA EN EL MOTOR. Al motor le llegan NUEVE
 * caminos de dominio, y ocho de ellos no hacen más que reenviar su `datos.motivo`. Una prueba
 * que sólo mida el motor deja los nueve reenvíos sin red: se comprobó cambiando `datos.motivo`
 * por un literal dentro de `revertirMovimientosDeHecho` (`produccion/transito.ts`) y corriendo los
 * siete archivos de integración de esos flujos — **195 pruebas, todas verdes**. O sea que el
 * kardex podía escribir un motivo INVENTADO en la cancelación de un recibo de maquila y nada
 * chillaba. El reenvío parece trivial de leer, pero `revertirMovimientosDeHecho` tiene un salto
 * intermedio y sirve a DOS llamadores (`recibos.ts` y `etapas.ts`): es justo donde se cuela el
 * motivo equivocado.
 *
 * Se lee de la BASE, que es la columna que pinta el kardex, y NUNCA del objeto que devuelve el
 * dominio (ése suele traer el `motivoCancelacion` del documento, que es otro campo y otra tabla:
 * mirarlo daría verde aunque el kardex se quedara en blanco).
 */
import { expect } from 'vitest';

import type { PrismaClient } from '../datos/index.js';

/**
 * Exige que TODOS los movimientos inversos vivos digan `Cancelación del folio N: <motivo>`, con
 * el folio de SU original — no el suyo.
 *
 * @param cliente            cliente Prisma de la prueba.
 * @param motivo             el motivo tal como lo escribió el usuario, YA recortado.
 * @param inversosEsperados  cuántos inversos debe haber. Es la guarda ANTI-VACUIDAD: sin ella,
 *                           un flujo que dejara de generar inversos pasaría en verde sin medir
 *                           nada (la trampa que dejó documentada la fila 0.176).
 *
 * ⚠️ Barre TODOS los inversos de la base, sin filtrar por empresa ni por origen, y es a propósito:
 * así es MÁS estricto (ni uno solo puede quedarse sin motivo) y no hay que acertarle al filtro. La
 * contrapartida es que cuenta con que la prueba arranque de una base limpia — si alguien añade
 * antes otro caso que deje inversos, esto se pone ROJO señalando el conteo, que es el modo de
 * fallo correcto: ruidoso, no silencioso.
 */
export async function esperarMotivoEnLosInversos(
  cliente: PrismaClient,
  motivo: string,
  inversosEsperados: number,
): Promise<void> {
  const inversos = await cliente.movimiento.findMany({
    where: { idMovimientoInverso: { not: null } },
    select: {
      id: true,
      observaciones: true,
      movimientoOriginal: { select: { folio: true } },
    },
    orderBy: { id: 'asc' },
  });

  // Anti-vacuidad: si no hay inversos, el `for` de abajo no comprueba nada.
  expect(inversos).toHaveLength(inversosEsperados);

  for (const inverso of inversos) {
    const folio = inverso.movimientoOriginal?.folio;
    expect(folio).toBeDefined();
    expect(inverso.observaciones).toBe(`Cancelación del folio ${String(folio)}: ${motivo}`);
  }
}
