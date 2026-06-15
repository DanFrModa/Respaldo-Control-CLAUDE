/**
 * Loader del GRID de COLORES de las telas (F1-E6). `TelasColores.csv` (4566): IdTelas, Color,
 * Precio → renglones `TelaColor` (N:N tela↔color con precio). Corre DESPUÉS de telas + colores
 * (necesita ambos mapeos). Carga VÍA el dominio (A1): `actualizarTela` con el set `colores`.
 *
 * Traducciones:
 *  • `IdTelas` (viejo) → idTela nuevo, vía el mapeo `Tela:IdTelas`.
 *  • `Color` (texto libre) → idColor, vía el mapeo `Color` (texto original → idColor).
 *  • `Precio` (`57.00`) → number.
 *
 * Se AGRUPA por tela y se aplica el grid COMPLETO con un solo `actualizarTela` por tela
 * (idempotente: el diff del dominio no duplica). Un color repetido en la misma tela (el viejo
 * podría traerlo) se queda con el ÚLTIMO precio y se reporta. Las filas cuyo `IdTelas` o
 * `Color` no mapean se REPORTAN y se omiten (§7, no inventar).
 */
import { actualizarTela } from '../../src/dominio/catalogos/telas.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { cargarMapaNumerico, ENTIDAD_MAPEO, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { parsearDinero } from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

/** Resultado del grid: telas tocadas (creados), renglones omitidos, etc. */
export async function cargarTelasColores(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };

  // Mapeos: IdTelas → idTela ; textoColor(original) → idColor.
  const mapaTela = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.telaPorIdTelas);
  const mapaColor = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.color);

  const filas = leerCsv('TelasColores.csv');

  // Agrupar por idTela nuevo: idColor → precio (último gana).
  const porTela = new Map<number, Map<number, number | undefined>>();
  let omitidos = 0;

  for (const fila of filas) {
    const idTelasViejo = (fila.IdTelas ?? '').trim();
    const colorTexto = (fila.Color ?? '').trim();
    const idTela = mapaTela.get(idTelasViejo);
    const idColor = colorTexto === '' ? undefined : mapaColor.get(colorTexto);

    if (idTela === undefined) {
      omitidos += 1;
      reporte.agregar(
        'TelasColores: IdTelas sin mapeo de tela (omitidos)',
        `IdTelas=${idTelasViejo} color="${colorTexto}"`,
      );
      continue;
    }
    if (idColor === undefined) {
      omitidos += 1;
      reporte.agregar(
        'TelasColores: color sin mapeo (omitidos)',
        `IdTelas=${idTelasViejo} color="${colorTexto}"`,
      );
      continue;
    }

    const precioRaw = parsearDinero(fila.Precio);
    const precio = precioRaw === null ? undefined : Math.max(0, precioRaw);

    const grid = porTela.get(idTela) ?? new Map<number, number | undefined>();
    if (grid.has(idColor)) {
      reporte.agregar(
        'TelasColores: color repetido en la misma tela (último precio gana)',
        `idTela=${String(idTela)} idColor=${String(idColor)}`,
      );
    }
    grid.set(idColor, precio);
    porTela.set(idTela, grid);
  }

  // Aplicar el grid completo por tela (un actualizarTela por tela).
  let telasTocadas = 0;
  for (const [idTela, grid] of porTela) {
    const colores = [...grid.entries()].map(([idColor, precio]) => ({
      idColor,
      ...(precio === undefined ? {} : { precio }),
    }));
    await actualizarTela(sesion, { id: idTela, colores }, bd);
    telasTocadas += 1;
  }

  return { creados: telasTocadas, existentes: 0, omitidos };
}
