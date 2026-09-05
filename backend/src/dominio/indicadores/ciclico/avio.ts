/**
 * ADAPTADOR de AVÍOS del inventario cíclico (fila 0.099, §Post-F9.193 punto 5). La llave es la
 * dimensión REAL de la existencia de avíos: **AVÍO × ALMACÉN** (el LOTE NO entra — R4; el almacén
 * sale del encabezado). Cantidades DECIMALES (escala 4, la misma de `movimiento_det_avio`): un avío
 * se mide en metros, kilos o piezas según su unidad de consumo.
 *
 * Es la dimensión donde la queja de la fila estaba entera: «Ajuste de materiales» pedía capturar el
 * MOVIMIENTO (entrada o salida) sobre lo existente, sin enseñar el saldo. Aquí se captura lo
 * CONTADO, con el saldo del sistema a la vista, y el sistema calcula y aplica la diferencia.
 *
 * Un avío no tiene segundo componente: `complemento` es SIEMPRE `null` (ver {@link Componentes}).
 */
import { Prisma } from '../../../datos/index.js';
import type { DatosCiclicoRenglonAgregar, DatosInventarioCiclicoCrear } from '../../../contrato/index.js';
import { ErrorNoEncontrado, ErrorValidacion } from '../../../comun/errores.js';
import {
  bloquearAvio,
  existenciaAvioBloqueada,
  registrarMovimientoAvio,
  type LineaMovimientoAvio,
} from '../../../comun/kardex.js';
import { ORIGEN } from '../../../comun/origenes.js';
import type { ClienteLectura } from '../../../comun/transaccion.js';

import { COD_AJUSTE_ENTRADA, COD_AJUSTE_SALIDA, tipoPorCodigo } from './comun.js';
import {
  textoClave,
  type AdaptadorCiclico,
  type ClaveArticulo,
  type Componentes,
  type RenglonCiclico,
} from './tipos.js';

/** Lee una {@link ClaveArticulo} como llave de avío. */
function idAvioDe(clave: ClaveArticulo): number {
  const id = clave['idAvio'];
  if (id == null) throw new ErrorValidacion('Llave de avío incompleta.');
  return id;
}

export const adaptadorAvio: AdaptadorCiclico = {
  dimension: 'AVIO',
  tipoAlmacen: 'AVIO',
  conteoCiego: false,
  escala: 4,
  nombreArticulo: 'avío',
  permisoAjuste: 'inventario-avios.mover',

  alcance(datos: DatosInventarioCiclicoCrear): number[] | undefined {
    if (datos.idsModelo !== undefined || datos.idsTela !== undefined) {
      throw new ErrorValidacion(
        'Este almacén es de avíos: el alcance se acota con avíos, no con modelos ni telas.',
      );
    }
    return datos.idsAvio;
  },

  async enumerar(tx, ctx, alcance) {
    // Vista `existencia_avio` para ENUMERAR (consulta); el valor congelado se re-lee DIRECTO y bajo
    // lock (ADR-0010 §3).
    const condiciones: Prisma.Sql[] = [
      Prisma.sql`e."id_empresa" = ${ctx.idEmpresa}`,
      Prisma.sql`e."id_almacen" = ${ctx.idAlmacen}`,
      Prisma.sql`e."existencia" <> 0`,
    ];
    if (alcance !== undefined && alcance.length > 0) {
      condiciones.push(Prisma.sql`e."id_avio" IN (${Prisma.join(alcance)})`);
    }
    const filas = await tx.$queryRaw<{ idAvio: number }[]>(Prisma.sql`
      SELECT e."id_avio" AS "idAvio"
      FROM "existencia_avio" e
      WHERE ${Prisma.join(condiciones, ' AND ')}
    `);
    return filas.map((f) => ({ idAvio: f.idAvio }));
  },

  async leerExistenciasBloqueadas(tx, ctx, claves) {
    // Locks en orden ASCENDENTE por `idAvio` — el mismo orden que toman las salidas de avío.
    const ids = [...new Set(claves.map(idAvioDe))].sort((a, b) => a - b);
    const mapa = new Map<string, Componentes>();
    for (const id of ids) {
      await bloquearAvio(tx, ctx.idEmpresa, ctx.idAlmacen, id);
      const cuerpo = await existenciaAvioBloqueada(tx, ctx.idEmpresa, ctx.idAlmacen, id);
      mapa.set(textoClave({ idAvio: id }), { cuerpo, complemento: null });
    }
    return mapa;
  },

  async sembrar(tx, sesion, idInventario, renglones) {
    if (renglones.length === 0) return;
    await tx.inventarioCiclicoDetAvio.createMany({
      data: renglones.map((r) => ({
        idInventarioCiclico: idInventario,
        idAvio: idAvioDe(r.clave),
        cantTeorica: r.teorico.cuerpo,
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      })),
    });
  },

  async resolverClaveNueva(tx, _ctx, entrada: DatosCiclicoRenglonAgregar) {
    if (
      entrada.idModelo !== undefined ||
      entrada.idColor !== undefined ||
      entrada.idTalla !== undefined ||
      entrada.idTelaColor !== undefined
    ) {
      throw new ErrorValidacion('Esta hoja cuenta avíos: el renglón se agrega con un avío.');
    }
    const { idAvio } = entrada;
    if (idAvio === undefined) {
      throw new ErrorValidacion('Para agregar un renglón de avíos indica el avío.');
    }
    const avio = await tx.avio.findUnique({ where: { id: idAvio }, select: { id: true } });
    if (avio === null) throw new ErrorNoEncontrado('Avio', idAvio);
    return { idAvio };
  },

  async leer(cliente: ClienteLectura, idInventario) {
    const filas = await cliente.inventarioCiclicoDetAvio.findMany({
      where: { idInventarioCiclico: idInventario },
      select: {
        id: true,
        idAvio: true,
        cantTeorica: true,
        cantReal: true,
        avio: { select: { clave: true, descripcion: true, unidad: true } },
        movimientoAjuste: { select: { id: true, folio: true, tipoMov: { select: { direccion: true } } } },
      },
      orderBy: [{ avio: { clave: 'asc' } }, { id: 'asc' }],
    });
    return filas.map<RenglonCiclico>((d) => ({
      idDet: d.id,
      clave: { idAvio: d.idAvio },
      titulo: d.avio.clave,
      subtitulo: d.avio.descripcion,
      unidad: d.avio.unidad,
      nombreComplemento: null,
      cantTeorica: Number(d.cantTeorica),
      cantTeoricaComplemento: null,
      cantReal: d.cantReal === null ? null : Number(d.cantReal),
      cantRealComplemento: null,
      ajustes:
        d.movimientoAjuste === null
          ? []
          : [
              {
                id: d.movimientoAjuste.id,
                folio: Number(d.movimientoAjuste.folio),
                direccion:
                  d.movimientoAjuste.tipoMov.direccion === 'entrada' ? 'entrada' : 'salida',
              },
            ],
    }));
  },

  async guardarConteo(tx, sesion, idInventario, capturas) {
    if (capturas.length === 0) return;
    for (const c of capturas) {
      if (c.cantRealComplemento !== null) {
        throw new ErrorValidacion('Un avío no tiene segundo componente que contar.');
      }
    }
    const ahora = new Date();
    const valores = capturas.map((c) => Prisma.sql`(${c.idDet}::int, ${c.cantReal}::decimal(14,4))`);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "inventario_ciclico_det_avio" AS d
      SET "cant_real" = v."cant_real",
          "contado_en" = ${ahora},
          "contado_por_id" = ${sesion.id},
          "modificado_por_id" = ${sesion.id},
          "modificado_en" = ${ahora}
      FROM (VALUES ${Prisma.join(valores)}) AS v("id", "cant_real")
      WHERE d."id" = v."id" AND d."id_inventario_ciclico" = ${idInventario}
    `);
  },

  async contar(cliente: ClienteLectura, idInventario) {
    const [total, contados] = await Promise.all([
      cliente.inventarioCiclicoDetAvio.count({ where: { idInventarioCiclico: idInventario } }),
      cliente.inventarioCiclicoDetAvio.count({
        where: { idInventarioCiclico: idInventario, cantReal: { not: null } },
      }),
    ]);
    return { total, contados };
  },

  async registrarAjuste(tx, sesion, ctx, direccion, lineas, datos) {
    const tipo = await tipoPorCodigo(
      tx,
      direccion === 'entrada' ? COD_AJUSTE_ENTRADA : COD_AJUSTE_SALIDA,
    );
    // `esGenerico` se COPIA del catálogo al renglón de kardex (R4: consultas sin join).
    const ids = lineas.map((l) => idAvioDe(l.clave));
    const avios = await tx.avio.findMany({
      where: { id: { in: ids } },
      select: { id: true, esGenerico: true },
    });
    const generico = new Map(avios.map((a) => [a.id, a.esGenerico]));
    const movimiento = await registrarMovimientoAvio(
      sesion,
      {
        idEmpresa: ctx.idEmpresa,
        idTipoMov: tipo.id,
        idAlmacen: ctx.idAlmacen,
        fecha: datos.fecha,
        origenTipo: ORIGEN.ajusteCiclico,
        origenId: String(datos.idCiclico),
        lineas: lineas.map<LineaMovimientoAvio>((l) => {
          const idAvio = idAvioDe(l.clave);
          return { idAvio, esGenerico: generico.get(idAvio) ?? false, cantidad: l.cuerpo };
        }),
        observaciones: datos.observaciones,
      },
      { tx },
    );
    return movimiento.id;
  },

  async enlazar(tx, sesion, idsDet, idMovimiento) {
    if (idsDet.length === 0) return;
    await tx.inventarioCiclicoDetAvio.updateMany({
      where: { id: { in: [...idsDet] } },
      data: { idMovimientoAjuste: idMovimiento, modificadoPorId: sesion.id },
    });
  },
};
