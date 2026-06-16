/**
 * Loader de ETIQUETAS DE MARCA (F1-E6). `EtiquetasM.csv` (81) → catálogo `EtiquetaMarca`
 * (nombre, regalias, activo). Carga VÍA el dominio (A1): `crearEtiquetaMarca`. Idempotente
 * por nombre. Persiste el mapeo `IdEtiquetasM → idEtiquetaMarca`.
 *
 * `Regalias` viejo es un porcentaje 0–100 (el dominio lo valida). `Activa` → tras crear
 * (siempre nace activa), si el viejo la traía inactiva se desactiva con `actualizar`.
 */
import {
  actualizarEtiquetaMarca,
  crearEtiquetaMarca,
} from '../../src/dominio/catalogos/etiquetas-marca.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { ENTIDAD_MAPEO, guardarMapeo, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear, LIMITES, truncarYReportar } from '../comun/saneo.js';
import { parsearBandera, parsearDinero, parsearTexto } from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

async function idPorNombre(cliente: ClienteMapeo, nombre: string): Promise<number | null> {
  const fila = await cliente.etiquetaMarca.findFirst({
    where: { nombre: { equals: nombre, mode: 'insensitive' } },
    select: { id: true },
  });
  return fila?.id ?? null;
}

export async function cargarEtiquetasMarca(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const filas = leerCsv('EtiquetasM.csv');
  let creados = 0;
  let existentes = 0;
  let omitidos = 0;
  let omitidosValidacion = 0;

  for (const fila of filas) {
    const idViejo = fila.IdEtiquetasM;
    const nombreCrudo = parsearTexto(fila.EtiquetaM);
    if (nombreCrudo === null) {
      omitidos += 1;
      reporte.agregar('Etiquetas de marca con nombre vacío (omitidas)', `Id=${idViejo ?? '?'}`);
      continue;
    }
    const nombre =
      truncarYReportar(
        reporte,
        'EtiquetaMarca',
        idViejo,
        'nombre',
        nombreCrudo,
        LIMITES.etiquetaMarca.nombre,
      ) ?? nombreCrudo;
    // Regalías: porcentaje; si no parsea o es <0/>100, se clava a 0 y se reporta.
    let regalias = parsearDinero(fila.Regalias) ?? 0;
    if (regalias < 0 || regalias > 100) {
      reporte.agregar(
        'Etiquetas de marca con regalías fuera de 0–100 (clavadas a 0)',
        `${nombre}: ${String(regalias)}`,
      );
      regalias = 0;
    }
    const activa = parsearBandera(fila.Activa);

    let idNuevo = await idPorNombre(cliente, nombre);
    if (idNuevo === null) {
      const creado = await intentarCrear(reporte, 'EtiquetaMarca', idViejo, () =>
        crearEtiquetaMarca(sesion, { nombre, regalias }, bd),
      );
      if (creado === null) {
        omitidosValidacion += 1;
        continue;
      }
      idNuevo = creado.id;
      creados += 1;
      if (!activa) {
        await actualizarEtiquetaMarca(sesion, { id: idNuevo, activo: false }, bd);
      }
    } else {
      existentes += 1;
    }

    if (idViejo !== undefined) {
      await guardarMapeo(cliente, ENTIDAD_MAPEO.etiquetaMarca, idViejo, idNuevo, { nombre });
    }
  }

  return { creados, existentes, omitidos, omitidosValidacion };
}
