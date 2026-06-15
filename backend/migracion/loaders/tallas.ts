/**
 * Loader de TALLAS y CURVAS (F1-E6, D4). `Ordenes.csv` (5451) columna `Tallas` (texto de
 * ANCHO FIJO de 2) → catálogo `Talla` + `CurvaTalla` + `CurvaTallaItem` (ORDENADO).
 *
 * Carga VÍA el dominio (A1): `crearTalla` (una por etiqueta única) + `crearCurva` (una por
 * combinación ORDENADA distinta de tallas). Las cadenas raras (longitud impar, separadores
 * `--`, saltos de línea) van al REPORTE y NO se cargan (§7). Idempotente: las etiquetas son
 * únicas (se reusa la existente); las curvas se nombran de forma DETERMINISTA por su
 * contenido ("Curva CH-M-G-EX"), así re-ejecutar no crea curvas nuevas.
 *
 * NO se persiste un mapeo IdOrdenes→curva aquí (el VALOR de tallas por orden es de F2/E7);
 * este loader solo SEMBRA los catálogos `Talla`/`CurvaTalla` que esas fases necesitarán.
 */
import { crearCurva, crearTalla } from '../../src/dominio/catalogos/tallas-curvas.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import { ErrorConflicto } from '../../src/comun/errores.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import type { ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { parsearTallasAnchoFijo } from '../comun/tallas.js';
import type { ResultadoLoader } from './clientes.js';

/** Resultado de tallas: tallas creadas + curvas creadas + cadenas raras reportadas. */
export interface ResultadoTallas {
  tallas: ResultadoLoader;
  curvas: ResultadoLoader;
  cadenasRaras: number;
}

/** Etiqueta → idTalla (cache; se llena al crear/leer). */
async function asegurarTalla(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cliente: ClienteMapeo,
  cache: Map<string, number>,
  etiqueta: string,
  contador: { creados: number; existentes: number },
): Promise<number> {
  const clave = etiqueta.toLowerCase();
  const enCache = cache.get(clave);
  if (enCache !== undefined) {
    return enCache;
  }
  const existe = await cliente.talla.findFirst({
    where: { etiqueta: { equals: etiqueta, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existe !== null) {
    cache.set(clave, existe.id);
    contador.existentes += 1;
    return existe.id;
  }
  const creada = await crearTalla(sesion, { etiqueta }, bd);
  cache.set(clave, creada.id);
  contador.creados += 1;
  return creada.id;
}

/** Nombre determinista de una curva por su contenido ORDENADO (idempotencia por nombre @unique). */
function nombreCurva(etiquetas: string[]): string {
  return `Curva ${etiquetas.join('-')}`;
}

export async function cargarTallas(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoTallas> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const filas = leerCsv('Ordenes.csv');

  const cacheTalla = new Map<string, number>();
  const contTallas = { creados: 0, existentes: 0 };
  const contCurvas = { creados: 0, existentes: 0 };
  let cadenasRaras = 0;

  // Cadenas de talla distintas ya vistas (para no re-procesar las 5451 órdenes una a una).
  const combinacionesVistas = new Set<string>();
  const raras = new Set<string>();

  for (const fila of filas) {
    const crudo = fila.Tallas ?? '';
    if (crudo.trim() === '') {
      continue;
    }
    if (combinacionesVistas.has(crudo)) {
      continue;
    }
    combinacionesVistas.add(crudo);

    const parsed = parsearTallasAnchoFijo(crudo);
    if (parsed.rara || parsed.etiquetas.length === 0) {
      if (!raras.has(parsed.original)) {
        raras.add(parsed.original);
        cadenasRaras += 1;
        reporte.agregar(
          'Cadenas de talla raras (NO cargadas — decisión)',
          `"${parsed.original}" (len=${String(parsed.original.length)})`,
        );
      }
      continue;
    }

    // Asegurar cada talla del catálogo.
    const idsTalla: number[] = [];
    for (const etiqueta of parsed.etiquetas) {
      const id = await asegurarTalla(sesion, bd, cliente, cacheTalla, etiqueta, contTallas);
      idsTalla.push(id);
    }

    // Crear la curva (nombre determinista por contenido). Idempotente: si ya existe, se cuenta.
    const nombre = nombreCurva(parsed.etiquetas);
    const yaExiste = await cliente.curvaTalla.findFirst({
      where: { nombre: { equals: nombre, mode: 'insensitive' } },
      select: { id: true },
    });
    if (yaExiste !== null) {
      contCurvas.existentes += 1;
      continue;
    }
    try {
      await crearCurva(sesion, { nombre, items: idsTalla }, bd);
      contCurvas.creados += 1;
    } catch (error) {
      if (error instanceof ErrorConflicto) {
        contCurvas.existentes += 1; // carrera: ya la creó otra orden con la misma combinación
      } else {
        throw error;
      }
    }
  }

  return {
    tallas: { creados: contTallas.creados, existentes: contTallas.existentes, omitidos: 0 },
    curvas: { creados: contCurvas.creados, existentes: contCurvas.existentes, omitidos: 0 },
    cadenasRaras,
  };
}
