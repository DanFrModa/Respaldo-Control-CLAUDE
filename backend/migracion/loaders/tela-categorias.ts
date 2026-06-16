/**
 * Loader de CATEGORÍAS DE TELA (F1-E6). `TelasCategorias.csv` (21) → catálogo `TelaCategoria`.
 * Limpia la de nombre vacío (el viejo tiene una con `CategoriaTela=''`). Carga VÍA el dominio
 * (A1): `crearTelaCategoria`. Idempotente por nombre. Persiste `IdTelasCategorias → idCategoria`.
 */
import { crearTelaCategoria } from '../../src/dominio/catalogos/telas.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { ENTIDAD_MAPEO, guardarMapeo, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear, LIMITES, truncarYReportar } from '../comun/saneo.js';
import { parsearTexto } from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

async function idPorNombre(cliente: ClienteMapeo, nombre: string): Promise<number | null> {
  const fila = await cliente.telaCategoria.findFirst({
    where: { nombre: { equals: nombre, mode: 'insensitive' } },
    select: { id: true },
  });
  return fila?.id ?? null;
}

export async function cargarTelaCategorias(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const filas = leerCsv('TelasCategorias.csv');
  let creados = 0;
  let existentes = 0;
  let omitidos = 0;
  let omitidosValidacion = 0;

  for (const fila of filas) {
    const idViejo = fila.IdTelasCategorias;
    const nombreCrudo = parsearTexto(fila.CategoriaTela);
    if (nombreCrudo === null) {
      // El viejo tiene una categoría sin nombre: se limpia (no se migra), se reporta.
      omitidos += 1;
      reporte.agregar(
        'Categorías de tela con nombre vacío (limpiadas, NO migradas)',
        `Id=${idViejo ?? '?'} · descripción="${parsearTexto(fila.Descripcion) ?? ''}"`,
      );
      continue;
    }
    const nombre =
      truncarYReportar(
        reporte,
        'TelaCategoria',
        idViejo,
        'nombre',
        nombreCrudo,
        LIMITES.telaCategoria.nombre,
      ) ?? nombreCrudo;

    let idNuevo = await idPorNombre(cliente, nombre);
    if (idNuevo === null) {
      const creado = await intentarCrear(reporte, 'TelaCategoria', idViejo, () =>
        crearTelaCategoria(sesion, { nombre }, bd),
      );
      if (creado === null) {
        omitidosValidacion += 1;
        continue;
      }
      idNuevo = creado.id;
      creados += 1;
    } else {
      existentes += 1;
    }

    if (idViejo !== undefined) {
      await guardarMapeo(cliente, ENTIDAD_MAPEO.telaCategoria, idViejo, idNuevo, { nombre });
    }
  }

  return { creados, existentes, omitidos, omitidosValidacion };
}
