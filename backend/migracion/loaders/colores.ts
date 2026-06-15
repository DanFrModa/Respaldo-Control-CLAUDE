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
import { ErrorConflicto, ErrorDominio } from '../../src/comun/errores.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { CONCURRENCIA_ETL, enLotes } from '../comun/lotes.js';
import { ENTIDAD_MAPEO, guardarMapeo, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { LIMITES, truncarYReportar } from '../comun/saneo.js';
import type { ResultadoLoader } from './clientes.js';

/** Desenlace de procesar un color (para agregar conteos tras los lotes). */
type DesenlaceColor = 'creado' | 'existente' | 'omitidoValidacion';

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
  const textos = [...recolectarTextosColor()];

  // canónico (lowercase) → idColor: cache COMPARTIDA entre tareas concurrentes (evita crear
  // dos veces el mismo color). En single-thread JS las escrituras del Map son atómicas entre
  // awaits; la carrera real (dos tareas crean el mismo color a la vez) la cubre el
  // ErrorConflicto + re-lectura de abajo. Una promesa por canónico serializa el primer create.
  const idPorCanonico = new Map<string, number>();
  const creandoCanonico = new Map<string, Promise<number>>();

  /** Resuelve el idColor de un nombre canónico (cache → BD → create → carrera). */
  async function resolverIdColor(canonico: string): Promise<number> {
    const clave = canonico.toLowerCase();
    const enCache = idPorCanonico.get(clave);
    if (enCache !== undefined) {
      return enCache;
    }
    // Si otra tarea ya está creando este canónico, espera su promesa (no lo dupliques).
    const enVuelo = creandoCanonico.get(clave);
    if (enVuelo !== undefined) {
      return enVuelo;
    }
    const promesa = (async (): Promise<number> => {
      const existe = await cliente.color.findFirst({
        where: { nombre: { equals: canonico, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existe !== null) {
        return existe.id;
      }
      try {
        const creado = await crearColor(sesion, { nombre: canonico }, bd);
        return creado.id;
      } catch (error) {
        if (error instanceof ErrorConflicto) {
          // Carrera: lo creó otro; re-leer.
          const reintento = await cliente.color.findFirst({
            where: { nombre: { equals: canonico, mode: 'insensitive' } },
            select: { id: true },
          });
          if (reintento !== null) {
            return reintento.id;
          }
        }
        throw error;
      }
    })();
    creandoCanonico.set(clave, promesa);
    const id = await promesa;
    idPorCanonico.set(clave, id);
    return id;
  }

  /** Procesa UN texto crudo de color: resuelve su idColor y guarda el mapeo texto→idColor. */
  async function procesarColor(textoCrudo: string): Promise<DesenlaceColor | null> {
    const canonicoCrudo = normalizarNombreColor(textoCrudo);
    if (canonicoCrudo === '') {
      return null; // texto vacío tras normalizar: no cuenta
    }
    const yaEnCache = idPorCanonico.has(canonicoCrudo.toLowerCase());
    // El color es texto libre del viejo: trunca al máximo del esquema (80) + reporta.
    const canonico =
      truncarYReportar(
        reporte,
        'Color',
        textoCrudo,
        'nombre',
        canonicoCrudo,
        LIMITES.color.nombre,
      ) ?? canonicoCrudo;

    let idColor: number;
    try {
      idColor = await resolverIdColor(canonico);
    } catch (error) {
      const detalle =
        error instanceof ErrorDominio ? `${error.codigo}: ${error.message}` : String(error);
      reporte.agregar('Color: fila OMITIDA por error (data sucia)', `"${canonico}" · ${detalle}`);
      return 'omitidoValidacion';
    }

    // Mapeo texto ORIGINAL → idColor (varios crudos pueden ir al mismo idColor).
    await guardarMapeo(cliente, ENTIDAD_MAPEO.color, textoCrudo, idColor, { canonico });
    // "creado" solo el primero que materializó el canónico; los demás cuentan como existentes.
    return yaEnCache ? 'existente' : 'creado';
  }

  const resultados = await enLotes(textos, (t) => procesarColor(t), CONCURRENCIA_ETL);

  let creados = 0;
  let existentes = 0;
  const omitidos = 0;
  let omitidosValidacion = 0;
  for (const r of resultados) {
    const d = r.ok ? r.valor : 'omitidoValidacion';
    if (d === null) continue;
    if (d === 'creado') creados += 1;
    else if (d === 'existente') existentes += 1;
    else omitidosValidacion += 1;
  }

  // base AB → set de nombres canónicos variantes (para el reporte). Se calcula al final,
  // DETERMINISTA, sobre todos los canónicos resueltos (independiente del orden de los lotes).
  const variantesAB = new Map<string, Set<string>>();
  for (const textoCrudo of textos) {
    const canonicoCrudo = normalizarNombreColor(textoCrudo);
    if (canonicoCrudo === '') continue;
    const canonico =
      canonicoCrudo.length > LIMITES.color.nombre
        ? canonicoCrudo.slice(0, LIMITES.color.nombre)
        : canonicoCrudo;
    if (!idPorCanonico.has(canonico.toLowerCase())) continue; // omitido por error: no listar
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

  return { creados, existentes, omitidos, omitidosValidacion };
}
