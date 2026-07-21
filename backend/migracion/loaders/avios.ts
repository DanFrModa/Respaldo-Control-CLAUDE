/**
 * Loader de AVÍOS (F1-E6, R1 — ADR-0009). `Habilitacion.csv` (629) → catálogo `Avio`
 * (clave, descripcion, favorito, cantFav, activo=!Desactivado; unidad/presentacion quedan
 * NULL — ADR-0009). Carga VÍA el dominio (A1): `crearAvio` (+ `actualizarAvio` para desactivar).
 *
 * El campo `Proveedor` del viejo es TEXTO LIBRE → se hace **match difuso** (por nombre
 * normalizado) contra el catálogo `Proveedor`:
 *  • SI hay match → se crea el renglón `AvioProveedor` con `precio` = `Precio`.
 *  • SI NO hay match → el precio NO se pierde: va a `Avio.precioReferencia` (fallback
 *    ADR-0009, decisión 3). El proveedor texto no-mapeado se REPORTA.
 *
 * `Descripcion` puede venir VACÍA en el viejo, pero el dominio la exige (min 1): cuando
 * falta, se rellena con la `clave` (y se reporta). Idempotente por `clave` (única global).
 * Persiste `IdHabilitacion → idAvio`.
 */
import { actualizarAvio, crearAvio } from '../../src/dominio/catalogos/avios.js';
import type { SesionUsuario } from '../../src/comun/permisos.js';
import type { ContextoBd } from '../../src/comun/transaccion.js';
import type { PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import { decidirPrecioAvio } from '../comun/decisiones.js';
import { CONCURRENCIA_ETL, enLotes } from '../comun/lotes.js';
import { ENTIDAD_MAPEO, guardarMapeo, type ClienteMapeo } from '../comun/mapeo.js';
import { prescanUso, type PrescanUso } from '../comun/prescan-uso.js';
import type { Reporte } from '../comun/reporte.js';
import { intentarCrear, LIMITES, truncarYReportar } from '../comun/saneo.js';
import {
  normalizarParaDedup,
  parsearBandera,
  parsearDinero,
  parsearTexto,
} from '../comun/valores.js';
import { resolverVentana } from '../comun/ventana.js';
import type { ResultadoLoader } from './clientes.js';
import { ErrorConflicto } from '../../src/comun/errores.js';

/** Desenlace de procesar una fila (para agregar conteos tras los lotes). */
type Desenlace = 'creado' | 'existente' | 'omitido' | 'omitidoValidacion' | 'fueraVentana';

/** Índice nombreNormalizado → idProveedor (para el match difuso del texto `Proveedor`). */
async function indiceProveedores(cliente: ClienteMapeo): Promise<Map<string, number>> {
  const filas = await cliente.proveedor.findMany({ select: { id: true, nombre: true } });
  const idx = new Map<string, number>();
  for (const f of filas) {
    idx.set(normalizarParaDedup(f.nombre), f.id);
  }
  return idx;
}

async function idAvioPorClave(cliente: ClienteMapeo, clave: string): Promise<number | null> {
  const fila = await cliente.avio.findFirst({
    where: { clave: { equals: clave, mode: 'insensitive' } },
    select: { id: true },
  });
  return fila?.id ?? null;
}

export async function cargarAvios(
  sesion: SesionUsuario,
  cliente: ClienteMapeo,
  reporte: Reporte,
  prescan?: PrescanUso | null,
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const idxProv = await indiceProveedores(cliente);
  const filas = leerCsv('Habilitacion.csv');
  // Prescan de USO: con ventana activa solo migran los avíos del BOM de modelos usados.
  const pre = prescan === undefined ? prescanUso(resolverVentana()) : prescan;

  // Filas INDEPENDIENTES → carga concurrente acotada.
  const resultados = await enLotes(
    filas,
    (fila): Promise<Desenlace> => procesarAvio(sesion, bd, cliente, reporte, idxProv, pre, fila),
    CONCURRENCIA_ETL,
  );

  let creados = 0;
  let existentes = 0;
  let omitidos = 0;
  let omitidosValidacion = 0;
  let fueraVentana = 0;
  for (const r of resultados) {
    const d = r.ok ? r.valor : 'omitidoValidacion';
    if (d === 'creado') creados += 1;
    else if (d === 'existente') existentes += 1;
    else if (d === 'omitido') omitidos += 1;
    else if (d === 'fueraVentana') fueraVentana += 1;
    else omitidosValidacion += 1;
  }
  if (fueraVentana > 0) {
    reporte.nota(
      `Avíos fuera de ventana (sin uso en BOM de modelos usados): ${String(fueraVentana)} NO migrados.`,
    );
  }
  return { creados, existentes, omitidos, omitidosValidacion, fueraVentana };
}

/** Procesa UNA fila de Habilitacion (idempotente por `clave`, tolerante a carreras). */
async function procesarAvio(
  sesion: SesionUsuario,
  bd: ContextoBd,
  cliente: ClienteMapeo,
  reporte: Reporte,
  idxProv: Map<string, number>,
  pre: PrescanUso | null,
  fila: Record<string, string>,
): Promise<Desenlace> {
  const idViejo = fila.IdHabilitacion;
  const claveCruda = parsearTexto(fila.Clave);
  if (claveCruda === null) {
    reporte.agregar('Avíos con clave vacía (omitidos)', `Id=${idViejo ?? '?'}`);
    return 'omitido';
  }
  // Ventana por USO: avío sin uso → fuera, con su propio bucket (muestra en el reporte).
  if (pre !== null && (idViejo === undefined || !pre.aviosId.has(idViejo.trim()))) {
    reporte.agregar(
      'Avíos FUERA de ventana (sin uso — NO migrados)',
      `clave="${claveCruda}" (IdHabilitacion=${idViejo ?? '?'})`,
    );
    return 'fueraVentana';
  }
  const clave =
    truncarYReportar(reporte, 'Avio', idViejo, 'clave', claveCruda, LIMITES.avio.clave) ??
    claveCruda;

  // Idempotencia por clave.
  const existeId = await idAvioPorClave(cliente, clave);
  if (existeId !== null) {
    if (idViejo !== undefined) {
      await guardarMapeo(cliente, ENTIDAD_MAPEO.avio, idViejo, existeId, { clave });
    }
    return 'existente';
  }

  let descripcion = truncarYReportar(
    reporte,
    'Avio',
    idViejo,
    'descripcion',
    parsearTexto(fila.Descripcion),
    LIMITES.avio.descripcion,
  );
  if (descripcion === null) {
    descripcion = clave; // el dominio exige descripción; se rellena con la clave.
    reporte.agregar(
      'Avíos sin descripción (rellenada con la clave)',
      `clave="${clave}" (Id=${idViejo ?? '?'})`,
    );
  }

  const favorito = parsearBandera(fila.Favorito);
  const cantFavRaw = parsearDinero(fila.CantFav);
  // favorito ⇒ cantFav>0 (regla del dominio). Si es favorito sin cantFav válida → 1 + reporte.
  let cantFav = cantFavRaw === null || cantFavRaw <= 0 ? undefined : cantFavRaw;
  if (favorito && cantFav === undefined) {
    cantFav = 1;
    reporte.agregar(
      'Avíos favoritos sin CantFav válida (clavada a 1)',
      `clave="${clave}" (Id=${idViejo ?? '?'})`,
    );
  }
  const desactivado = parsearBandera(fila.Desactivado);

  // Match difuso del proveedor texto → renglón AvioProveedor con precio; si no, fallback.
  const provTexto = parsearTexto(fila.Proveedor);
  const precio = parsearDinero(fila.Precio);
  const idProv = provTexto === null ? undefined : idxProv.get(normalizarParaDedup(provTexto));

  // Decisión PURA (probada en decisiones.test.ts): match → AvioProveedor; sin match →
  // precioReferencia (fallback ADR-0009, decisión 3 — el precio no se pierde).
  const decision = decidirPrecioAvio(idProv, precio);
  const proveedores = decision.proveedor === null ? undefined : [decision.proveedor];
  const precioReferencia = decision.precioReferencia;

  if (provTexto !== null && idProv === undefined) {
    reporte.agregar(
      'Avíos: proveedor (texto) sin match → precio a precioReferencia',
      `clave="${clave}" proveedor="${provTexto}"${precio === null ? '' : ` precio=${String(precio)}`}`,
    );
  }

  // Tolerante a carrera por la `clave` @unique: si otra tarea concurrente creó el mismo avío
  // entre el chequeo y el create, el dominio lanza ErrorConflicto → re-leer y mapear al existente.
  const resuelto = await intentarCrear(
    reporte,
    'Avio',
    idViejo,
    async (): Promise<{ id: number; carrera: boolean }> => {
      try {
        const avio = await crearAvio(
          sesion,
          {
            clave,
            descripcion,
            favorito,
            ...(cantFav === undefined ? {} : { cantFav }),
            ...(precioReferencia === undefined ? {} : { precioReferencia }),
            ...(proveedores === undefined ? {} : { proveedores }),
          },
          bd,
        );
        return { id: avio.id, carrera: false };
      } catch (error) {
        if (error instanceof ErrorConflicto) {
          const yaId = await idAvioPorClave(cliente, clave);
          if (yaId !== null) {
            return { id: yaId, carrera: true };
          }
        }
        throw error;
      }
    },
  );
  if (resuelto === null) {
    return 'omitidoValidacion';
  }

  // Solo desactiva si lo creamos nosotros (en carrera, el ganador ya lo dejó como toca).
  if (desactivado && !resuelto.carrera) {
    await actualizarAvio(sesion, { id: resuelto.id, activo: false }, bd);
  }

  if (idViejo !== undefined) {
    await guardarMapeo(cliente, ENTIDAD_MAPEO.avio, idViejo, resuelto.id, { clave });
  }
  return resuelto.carrera ? 'existente' : 'creado';
}
