/**
 * Loader de COLORES (F1-E6). El color es TEXTO LIBRE en el viejo (`TelasColores.Color`,
 * `OrdenesDet.Color`). Aquí se construye el catálogo `Color` y el mapeo **texto→idColor**
 * (entregable clave, reusado por el loader de telas-colores y por F2/F4).
 *
 * Reglas (ficha F1-E6):
 *  • La normalización a nombre canónico es DETERMINISTA: usa `normalizarNombreColor` del
 *    dominio (trim + colapsar espacios). NO se inventa nada más aquí (A1).
 *  • Las variantes tipo 'NEGRO A' / 'NEGRO B' **NO se fusionan automáticamente**: quedan
 *    como colores DISTINTOS y se LISTAN al reporte para que Daniel decida (la fusión real
 *    la hace CoderFusion con su feature + Gabriel/Daniel a mano).
 *  • Carga VÍA el dominio (A1): `crearColor`. Idempotente (case-insensitive por el dominio).
 *
 * El mapeo se guarda con `entidad="Color"` y `claveVieja = texto ORIGINAL del viejo` (sin
 * normalizar), para que un loader posterior pueda traducir el texto crudo de cualquier tabla
 * vieja al `idColor` correcto. Varios textos crudos ("Negro", "  negro ") pueden mapear al
 * MISMO idColor (el del nombre canónico).
 */
import { crearColor, normalizarNombreColor } from '../../src/dominio/catalogos/colores.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import { ErrorConflicto } from '../../src/comun/errores.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { ENTIDAD_MAPEO, guardarMapeo, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import type { ResultadoLoader } from './clientes.js';

/** Detecta variantes A/B/C… de un mismo color base (p. ej. "NEGRO A"): nombre + letra suelta. */
function baseDeVarianteAB(nombreCanonico: string): string | null {
  const m = /^(.+?)\s+([A-Z])$/.exec(nombreCanonico);
  return m ? (m[1] ?? null) : null;
}

/**
 * Recolecta todos los textos de color crudos de las fuentes (TelasColores.Color +
 * OrdenesDet.Color), descartando vacíos. Devuelve el conjunto único de textos ORIGINALES.
 */
export function recolectarTextosColor(): Set<string> {
  const textos = new Set<string>();
  for (const archivo of ['TelasColores.csv', 'OrdenesDet.csv'] as const) {
    let filas: Record<string, string>[];
    try {
      filas = leerCsv(archivo);
    } catch {
      continue; // si una fuente falta, se sigue con la otra (se nota en el cuadre)
    }
    for (const fila of filas) {
      const crudo = (fila.Color ?? '').trim();
      if (crudo !== '') {
        textos.add(crudo);
      }
    }
  }
  return textos;
}

export async function cargarColores(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const textos = recolectarTextosColor();

  let creados = 0;
  let existentes = 0;
  const omitidos = 0;

  // canónico → idColor (cache en memoria para no consultar la BD por cada texto crudo).
  const idPorCanonico = new Map<string, number>();
  // base AB → set de nombres canónicos variantes (para el reporte).
  const variantesAB = new Map<string, Set<string>>();

  for (const textoCrudo of textos) {
    const canonico = normalizarNombreColor(textoCrudo);
    if (canonico === '') {
      continue;
    }

    let idColor = idPorCanonico.get(canonico.toLowerCase());
    if (idColor === undefined) {
      // ¿Ya existe en BD (idempotencia / corrida previa)?
      const existe = await cliente.color.findFirst({
        where: { nombre: { equals: canonico, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existe !== null) {
        idColor = existe.id;
        existentes += 1;
      } else {
        try {
          const creado = await crearColor(sesion, { nombre: canonico }, bd);
          idColor = creado.id;
          creados += 1;
        } catch (error) {
          if (error instanceof ErrorConflicto) {
            // Carrera: lo crea otro; re-leer.
            const reintento = await cliente.color.findFirst({
              where: { nombre: { equals: canonico, mode: 'insensitive' } },
              select: { id: true },
            });
            if (reintento === null) {
              throw error;
            }
            idColor = reintento.id;
            existentes += 1;
          } else {
            throw error;
          }
        }
      }
      idPorCanonico.set(canonico.toLowerCase(), idColor);
    }

    // Mapeo texto ORIGINAL → idColor (varios crudos pueden ir al mismo idColor).
    await guardarMapeo(cliente, ENTIDAD_MAPEO.color, textoCrudo, idColor, { canonico });

    // Acumular variantes A/B/C para el reporte (NO se fusionan aquí).
    const base = baseDeVarianteAB(canonico.toUpperCase());
    if (base !== null) {
      const set = variantesAB.get(base) ?? new Set<string>();
      set.add(canonico);
      variantesAB.set(base, set);
    }
  }

  // Reporte de colores dudosos (A/B): solo cuando hay 2+ variantes del mismo base, o el base
  // existe también como color "pelado" (p. ej. "NEGRO" + "NEGRO A").
  for (const [base, set] of variantesAB) {
    const hayBasePelado = idPorCanonico.has(base.toLowerCase());
    if (set.size >= 2 || hayBasePelado) {
      const lista = [...set].sort().join(', ');
      reporte.agregar(
        'Colores dudosos A/B (NO fusionados — decisión de Daniel)',
        `base "${base}": ${lista}${hayBasePelado ? ` (+ "${base}" pelado)` : ''}`,
      );
    }
  }

  return { creados, existentes, omitidos };
}
