/**
 * BORRADO de los datos ficticios de inventarios (`--limpiar`).
 *
 * ## Por qué esto NO rompe D3
 *
 * D3 dice que lo ASENTADO no se edita ni se borra: una cancelación es un movimiento INVERSO
 * auditado. Esa regla gobierna **a la aplicación** —lo que un usuario puede hacer con un documento
 * real— y aquí no se toca: el sembrador siembra por el dominio y el dominio sigue igual de estricto.
 *
 * Lo de aquí es otra cosa: un **mantenimiento de la base de `prueba`** que retira un juego de datos
 * que nunca fue del negocio, entero y por su marca. No corrige nada ni reinterpreta un asiento: lo
 * quita. Y va con tres cinturones para que no pueda hacer de más:
 *
 *  1. **Sólo toca lo que el sembrador anotó** en `mapeo_migracion` bajo `Demo:*` (más lo que cuelga
 *     de ello: partidas del color demo, recepciones de la OC demo, movimientos del material demo).
 *     Nada se busca «por texto que empiece con DEMO-».
 *  2. **Todo en UNA transacción.** Si algo falla a media lista, no queda medio borrado.
 *  3. **Las llaves foráneas son el guardia.** Si alguien ya operó ENCIMA de los datos ficticios —una
 *     nota de salida, un conteo cíclico, un pago aplicado a un cargo, una orden de producción que
 *     consumió la tela— el `RESTRICT` de la base aborta el borrado entero y el script lo dice con
 *     nombre y apellido. Esa es, literalmente, la alternativa que pide el enunciado: **la limpieza
 *     sólo es posible mientras nadie haya operado encima**.
 *
 * ⚠️ **La BITÁCORA no se borra.** Los renglones de `Bitacora` no tienen FK (guardan entidad + id
 * como texto) y son la huella de auditoría (A7): que el rastro de «se sembró y se limpió» sobreviva
 * es correcto, y borrarlo sí sería pisar la auditoría.
 */
import type { PrismaClient } from '../../src/datos/index.js';

import { ENTIDAD_DEMO, type EntidadDemo } from './datos.js';

/** Qué se borró (lo imprime el script). */
export interface ResultadoLimpieza {
  movimientosTercero: number;
  recepciones: number;
  entradasTela: number;
  movimientos: number;
  partidas: number;
  ordenesCompra: number;
  telas: number;
  avios: number;
  proveedores: number;
  almacenes: number;
  direcciones: number;
  mapeos: number;
}

/** Lee los ids anotados bajo una entidad `Demo:*`. */
async function idsDe(cliente: PrismaClient, entidad: EntidadDemo): Promise<number[]> {
  const filas = await cliente.mapeoMigracion.findMany({
    where: { entidad },
    select: { idNuevo: true },
  });
  return filas.map((f) => Number(f.idNuevo)).filter((n) => Number.isFinite(n));
}

/** Cuenta lo que HAY hoy de datos ficticios, sin borrar nada (para el ensayo en seco). */
export async function contarDemo(cliente: PrismaClient): Promise<Record<string, number>> {
  const conteos: Record<string, number> = {};
  for (const [nombre, entidad] of Object.entries(ENTIDAD_DEMO)) {
    conteos[nombre] = (await idsDe(cliente, entidad)).length;
  }
  return conteos;
}

/**
 * Borra TODO lo sembrado, en una sola transacción y en orden de dependencia (de lo que cuelga hacia
 * lo que sostiene). Si algo no se puede borrar porque otra cosa lo usa, la transacción entera se
 * revierte y el error sube con el detalle.
 */
export async function limpiarDemoInventarios(cliente: PrismaClient): Promise<ResultadoLimpieza> {
  const idsProveedor = await idsDe(cliente, ENTIDAD_DEMO.proveedor);
  const idsAlmacen = await idsDe(cliente, ENTIDAD_DEMO.almacen);
  const idsTela = await idsDe(cliente, ENTIDAD_DEMO.tela);
  const idsTelaColor = await idsDe(cliente, ENTIDAD_DEMO.telaColor);
  const idsAvio = await idsDe(cliente, ENTIDAD_DEMO.avio);
  const idsOc = await idsDe(cliente, ENTIDAD_DEMO.ordenCompra);
  const idsDireccion = await idsDe(cliente, ENTIDAD_DEMO.direccionEntrega);

  // Los MOVIMIENTOS no se leen sólo del mapeo: los de las recepciones y las entradas de tela los
  // creó el dominio por dentro. Se derivan del material ficticio que tocan (que es lo exacto: todo
  // movimiento del material DEMO es del sembrador) más los que cuelgan de sus almacenes.
  const idsMovimiento = (
    await cliente.movimiento.findMany({
      where: {
        OR: [
          { detallesTela: { some: { idTela: { in: idsTela } } } },
          { detallesAvio: { some: { idAvio: { in: idsAvio } } } },
          { idAlmacen: { in: idsAlmacen } },
        ],
      },
      select: { id: true, idMovimientoInverso: true },
    })
  ).map((mv) => ({ id: mv.id, esInverso: mv.idMovimientoInverso !== null }));

  const idsRecepcion = (
    await cliente.recepcionCompra.findMany({
      where: { idOrdenCompra: { in: idsOc } },
      select: { id: true },
    })
  ).map((r) => r.id);

  const idsEntrada = await idsDe(cliente, ENTIDAD_DEMO.entradaTela);

  const idsMovTercero = (
    await cliente.movimientoTercero.findMany({
      where: { idProveedor: { in: idsProveedor } },
      select: { id: true, idMovimientoInverso: true, idMovimientoCorregido: true },
    })
  ).map((mt) => ({
    id: mt.id,
    derivado: mt.idMovimientoInverso !== null || mt.idMovimientoCorregido !== null,
  }));

  const idsPartida = (
    await cliente.partidaTela.findMany({
      where: { idTelaColor: { in: idsTelaColor } },
      select: { id: true },
    })
  ).map((p) => p.id);

  return cliente.$transaction(async (tx) => {
    // 1. Cuenta corriente del proveedor: primero los DERIVADOS (inversos/correcciones), que apuntan
    //    a su original con RESTRICT, y luego los originales.
    const mtDerivados = idsMovTercero.filter((x) => x.derivado).map((x) => x.id);
    const mtOriginales = idsMovTercero.filter((x) => !x.derivado).map((x) => x.id);
    const borradosMtA = await tx.movimientoTercero.deleteMany({
      where: { id: { in: mtDerivados } },
    });
    const borradosMtB = await tx.movimientoTercero.deleteMany({
      where: { id: { in: mtOriginales } },
    });

    // 2. Documentos de compra/entrada (sus renglones caen en cascada).
    const borradasRec = await tx.recepcionCompra.deleteMany({
      where: { id: { in: idsRecepcion } },
    });
    const borradasEnt = await tx.entradaTela.deleteMany({ where: { id: { in: idsEntrada } } });

    // 3. Kardex: primero los movimientos INVERSOS (apuntan al original con RESTRICT).
    const movInversos = idsMovimiento.filter((x) => x.esInverso).map((x) => x.id);
    const movNormales = idsMovimiento.filter((x) => !x.esInverso).map((x) => x.id);
    const borradosMovA = await tx.movimiento.deleteMany({ where: { id: { in: movInversos } } });
    const borradosMovB = await tx.movimiento.deleteMany({ where: { id: { in: movNormales } } });

    // 4. Partidas (lotes de entrada de tela) y órdenes de compra.
    const borradasPart = await tx.partidaTela.deleteMany({ where: { id: { in: idsPartida } } });
    const borradasOc = await tx.ordenCompra.deleteMany({ where: { id: { in: idsOc } } });

    // 5. Catálogos, de lo más colgado a lo más básico.
    const borradasTelas = await tx.tela.deleteMany({ where: { id: { in: idsTela } } });
    const borradosAvios = await tx.avio.deleteMany({ where: { id: { in: idsAvio } } });
    const borradosProv = await tx.proveedor.deleteMany({ where: { id: { in: idsProveedor } } });
    const borradosAlm = await tx.almacen.deleteMany({ where: { id: { in: idsAlmacen } } });
    const borradasDir = await tx.direccionEntrega.deleteMany({
      where: { id: { in: idsDireccion } },
    });

    // 6. Y el inventario de lo sembrado.
    const borradosMapeos = await tx.mapeoMigracion.deleteMany({
      where: { entidad: { in: Object.values(ENTIDAD_DEMO) } },
    });

    return {
      movimientosTercero: borradosMtA.count + borradosMtB.count,
      recepciones: borradasRec.count,
      entradasTela: borradasEnt.count,
      movimientos: borradosMovA.count + borradosMovB.count,
      partidas: borradasPart.count,
      ordenesCompra: borradasOc.count,
      telas: borradasTelas.count,
      avios: borradosAvios.count,
      proveedores: borradosProv.count,
      almacenes: borradosAlm.count,
      direcciones: borradasDir.count,
      mapeos: borradosMapeos.count,
    };
  });
}
