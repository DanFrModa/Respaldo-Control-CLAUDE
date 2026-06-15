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
import { ENTIDAD_MAPEO, guardarMapeo, type ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import {
  normalizarParaDedup,
  parsearBandera,
  parsearDinero,
  parsearTexto,
} from '../comun/valores.js';
import type { ResultadoLoader } from './clientes.js';

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
): Promise<ResultadoLoader> {
  const bd: ContextoBd = { cliente: cliente as PrismaClient };
  const idxProv = await indiceProveedores(cliente);
  const filas = leerCsv('Habilitacion.csv');
  let creados = 0;
  let existentes = 0;
  let omitidos = 0;

  for (const fila of filas) {
    const idViejo = fila.IdHabilitacion;
    const clave = parsearTexto(fila.Clave);
    if (clave === null) {
      omitidos += 1;
      reporte.agregar('Avíos con clave vacía (omitidos)', `Id=${idViejo ?? '?'}`);
      continue;
    }

    // Idempotencia por clave.
    const existeId = await idAvioPorClave(cliente, clave);
    if (existeId !== null) {
      existentes += 1;
      if (idViejo !== undefined) {
        await guardarMapeo(cliente, ENTIDAD_MAPEO.avio, idViejo, existeId, { clave });
      }
      continue;
    }

    let descripcion = parsearTexto(fila.Descripcion);
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

    const creado = await crearAvio(
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
    creados += 1;

    if (desactivado) {
      await actualizarAvio(sesion, { id: creado.id, activo: false }, bd);
    }

    if (idViejo !== undefined) {
      await guardarMapeo(cliente, ENTIDAD_MAPEO.avio, idViejo, creado.id, { clave });
    }
  }

  return { creados, existentes, omitidos };
}
