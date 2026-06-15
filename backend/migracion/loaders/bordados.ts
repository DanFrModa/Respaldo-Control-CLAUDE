/**
 * Loader de BORDADOS (F1-E6, R2). `Bordados.csv` (2964) → catálogo `Bordado`
 * (nombre, descripcion, puntadas, precio, tipo). Carga VÍA el dominio (A1): `crearBordado`.
 *
 * SOLO el catálogo — **NO sube fotos** (las fotos masivas son E7; la columna `Foto` se
 * ignora aquí). `Bordado.nombre` es @unique → se desambiguan los duplicados con sufijo
 * `(2)`, `(3)`… y se REPORTAN (ADR-0009, riesgo menor anotado para E6).
 *
 * `BorEst` → tipo (BORDADO/ESTAMPADO); `Precio` viejo (`$2.50`) → number; `Puntadas` → int.
 * Idempotente: el nombre desambiguado se mapea por `IdBordados`, así re-ejecutar reusa el
 * mismo nombre (no genera `(2)` nuevos). Persiste `IdBordados → idBordado`.
 */
import { crearBordado } from '../../src/dominio/catalogos/bordados.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { mapearTipoBordado } from '../comun/mapeos-enum.js';
import { ENTIDAD_MAPEO, guardarMapeo, leerMapeo, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { parsearDinero, parsearEntero, parsearTexto } from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

async function idPorNombre(cliente: ClienteMapeo, nombre: string): Promise<number | null> {
  const fila = await cliente.bordado.findFirst({
    where: { nombre: { equals: nombre, mode: 'insensitive' } },
    select: { id: true },
  });
  return fila?.id ?? null;
}

/** Devuelve un nombre libre (case-insensitive) agregando sufijo `(n)` si hace falta. */
async function nombreLibre(cliente: ClienteMapeo, base: string): Promise<string> {
  if ((await idPorNombre(cliente, base)) === null) {
    return base;
  }
  for (let n = 2; n < 1000; n += 1) {
    const candidato = `${base} (${String(n)})`;
    if ((await idPorNombre(cliente, candidato)) === null) {
      return candidato;
    }
  }
  // Fallback extremo: nombre con timestamp (no debería pasar con 2964 filas).
  return `${base} (${String(Date.now())})`;
}

export async function cargarBordados(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const filas = leerCsv('Bordados.csv');
  let creados = 0;
  let existentes = 0;
  let omitidos = 0;

  for (const fila of filas) {
    const idViejo = fila.IdBordados;
    const nombreOriginal = parsearTexto(fila.Nombre);
    if (nombreOriginal === null) {
      omitidos += 1;
      reporte.agregar('Bordados con nombre vacío (omitidos)', `Id=${idViejo ?? '?'}`);
      continue;
    }

    // Idempotencia: si ya migramos ESTE IdBordados, reusar su id (no generar (2) nuevos).
    if (idViejo !== undefined) {
      const yaMapeado = await leerMapeo(cliente, ENTIDAD_MAPEO.bordado, idViejo);
      if (yaMapeado !== null) {
        existentes += 1;
        continue;
      }
    }

    const tipo = mapearTipoBordado(fila.BorEst);
    const descripcion = parsearTexto(fila.Descripcion) ?? undefined;
    const puntadasRaw = parsearEntero(fila.Puntadas);
    const puntadas = puntadasRaw === null ? undefined : Math.max(0, puntadasRaw);
    const precioRaw = parsearDinero(fila.Precio);
    const precio = precioRaw === null ? undefined : Math.max(0, precioRaw);

    // Desambiguar el nombre @unique (case-insensitive) — reportar el duplicado.
    const nombre = await nombreLibre(cliente, nombreOriginal);
    if (nombre !== nombreOriginal) {
      reporte.agregar(
        'Bordados con nombre duplicado (desambiguados con sufijo)',
        `"${nombreOriginal}" → "${nombre}" (IdBordados=${idViejo ?? '?'})`,
      );
    }

    const creado = await crearBordado(
      sesion,
      {
        nombre,
        tipo,
        ...(descripcion === undefined ? {} : { descripcion }),
        ...(puntadas === undefined ? {} : { puntadas }),
        ...(precio === undefined ? {} : { precio }),
      },
      bd,
    );
    creados += 1;

    if (idViejo !== undefined) {
      await guardarMapeo(cliente, ENTIDAD_MAPEO.bordado, idViejo, creado.id, {
        nombre,
        ...(nombre !== nombreOriginal ? { nombreOriginal } : {}),
      });
    }
  }

  return { creados, existentes, omitidos };
}
