/**
 * Loader del GRID de COLORES de las telas (F1-E6; reestructura A1 §Post-F9.11).
 * `TelasColores.csv` (4566): IdTelas, Color, Precio → renglones `TelaColor`, que desde
 * §Post-F9.11 son HIJOS de la tela: `nombre` PROPIO (= el texto del CSV) + `idColor` como
 * LIGA LEGACY al catálogo de color de PRENDA (la que el N:N viejo usaba; el MRP/precosto
 * la siguen resolviendo en lo migrado). Corre DESPUÉS de telas + colores (necesita ambos
 * mapeos).
 *
 * Carga VÍA el dominio (A1): `reconciliarColoresTelaMigracion` — el merge ADITIVO del ETL
 * (R2-1, lección del PR #153): re-correr NUNCA borra la depuración manual. La invariante
 * vive en el DOMINIO, no aquí: claves ya existentes conservan nombre (casing)/pantone/
 * precioComplemento/liga y solo actualizan el `precio` del CSV si difiere; claves nuevas se
 * crean; filas de la tela que el CSV no trae (capturadas a mano) NO se tocan. Por eso este
 * loader NO usa `actualizarTela` (ese reemplaza el grid completo y pisaría todo). La LIGA
 * legacy `idColor` NO viaja por el contrato: se fija en un paso DATA-ONLY posterior por
 * (idTela, nombre), solo donde siga NULL (idempotente).
 *
 * Traducciones:
 *  • `IdTelas` (viejo) → idTela nuevo, vía el mapeo `Tela:IdTelas`.
 *  • `Color` (texto libre) → nombre PROPIO del color de la tela (truncado a 80 si excede)
 *    + idColor legacy vía el mapeo `Color` (texto original → idColor).
 *  • `Precio` (`57.00`) → number.
 *
 * Se AGRUPA por tela y se aplica el grid COMPLETO con un solo `actualizarTela` por tela
 * (idempotente: el diff del dominio no duplica). Un color repetido en la misma tela — por
 * nombre normalizado, la identidad nueva — se queda con el ÚLTIMO precio y se reporta.
 * Las filas cuyo `IdTelas` o `Color` no mapean se REPORTAN y se omiten (§7, no inventar;
 * mismo criterio que F1-E6 para que el cuadre siga comparando peras con peras).
 */
import { reconciliarColoresTelaMigracion } from '../../src/dominio/catalogos/telas.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { CONCURRENCIA_ETL, enLotes } from '../comun/lotes.js';
import { cargarMapaNumerico, ENTIDAD_MAPEO, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear, LIMITES, truncarYReportar } from '../comun/saneo.js';
import { parsearDinero } from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

/** Un renglón del grid de una tela: nombre propio + liga legacy + precio. */
interface RenglonGrid {
  nombre: string;
  idColor: number;
  precio: number | undefined;
}

/** Resultado del grid: telas tocadas (creados), renglones omitidos, etc. */
export async function cargarTelasColores(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoLoader> {
  const prisma = cliente as PrismaClient;
  const bd: ContextoBd = { cliente: prisma };

  // Mapeos: IdTelas → idTela ; textoColor(original) → idColor.
  const mapaTela = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.telaPorIdTelas);
  const mapaColor = await cargarMapaNumerico(cliente, ENTIDAD_MAPEO.color);

  const filas = leerCsv('TelasColores.csv');

  // Agrupar por idTela nuevo: nombre normalizado (la identidad §Post-F9.11) → renglón.
  const porTela = new Map<number, Map<string, RenglonGrid>>();
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
    const nombre =
      truncarYReportar(
        reporte,
        'TelaColor',
        idTelasViejo,
        'nombre',
        colorTexto,
        LIMITES.color.nombre,
      ) ?? colorTexto;

    const grid = porTela.get(idTela) ?? new Map<string, RenglonGrid>();
    const clave = nombre.toLowerCase();
    if (grid.has(clave)) {
      reporte.agregar(
        'TelasColores: color repetido en la misma tela (último precio gana)',
        `idTela=${String(idTela)} nombre="${nombre}"`,
      );
    }
    grid.set(clave, { nombre, idColor, precio });
    porTela.set(idTela, grid);
  }

  // Aplicar el grid completo por tela (un actualizarTela por tela) y luego la LIGA legacy
  // data-only. Cada tela es INDEPENDIENTE (renglones distintos) → carga concurrente acotada.
  // Tolerante por tela: si una falla (data sucia), se reporta y se sigue con las demás.
  const entradas = [...porTela.entries()];
  const resultados = await enLotes(
    entradas,
    ([idTela, grid]) => {
      const renglones = [...grid.values()];
      return intentarCrear(reporte, 'TelaColor', idTela, async () => {
        // 1) Vía dominio (A1): merge ADITIVO de los renglones del CSV (no pisa depuración).
        const tela = await reconciliarColoresTelaMigracion(
          sesion,
          {
            id: idTela,
            colores: renglones.map((r) => ({
              nombre: r.nombre,
              ...(r.precio === undefined ? {} : { precio: r.precio }),
            })),
          },
          bd,
        );
        // 2) DATA-ONLY (solo migración): la liga legacy al color de PRENDA, por
        //    (idTela, nombre) y solo donde siga NULL — idempotente y sin pisar depuración.
        for (const r of renglones) {
          await prisma.telaColor.updateMany({
            where: { idTela, nombre: r.nombre, idColor: null },
            data: { idColor: r.idColor },
          });
        }
        return tela;
      });
    },
    CONCURRENCIA_ETL,
  );

  let telasTocadas = 0;
  let omitidosValidacion = 0;
  for (const r of resultados) {
    // `intentarCrear` ya captura errores de fila → devuelve null; `enLotes` solo fallaría por
    // algo inesperado fuera de `intentarCrear` (también se cuenta como omitido por validación).
    if (r.ok && r.valor !== null) {
      telasTocadas += 1;
    } else {
      omitidosValidacion += 1;
    }
  }

  return { creados: telasTocadas, existentes: 0, omitidos, omitidosValidacion };
}
