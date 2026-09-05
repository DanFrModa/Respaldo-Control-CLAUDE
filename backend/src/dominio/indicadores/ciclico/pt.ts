/**
 * ADAPTADOR de PRODUCTO TERMINADO del inventario cíclico (fila 0.099; el motor era originalmente
 * SÓLO esto, F7-E5). La llave es la granularidad REAL del kardex de PT:
 * `modelo × color × talla × ORDEN` (`idOrden` NULL = bucket «sin orden»; F6-E2, ADR-0014), y las
 * cantidades son PIEZAS ENTERAS (escala 0).
 *
 * Es la ÚNICA dimensión con CONTEO CIEGO (D6): el capturista no ve el teórico ni en pantalla ni en
 * la hoja impresa. Telas y avíos capturan con el saldo a la vista (§Post-F9.193 punto 4); PT se
 * queda como estaba — eso no lo cambió ninguna decisión.
 */
import { Prisma } from '../../../datos/index.js';
import type { DatosCiclicoRenglonAgregar, DatosInventarioCiclicoCrear } from '../../../contrato/index.js';
import { ErrorNoEncontrado, ErrorValidacion } from '../../../comun/errores.js';
import {
  bloquearArticuloPt,
  existenciaPtBloqueada,
  registrarMovimientoPt,
  type LineaMovimientoPt,
} from '../../../comun/kardex.js';
import { ORIGEN } from '../../../comun/origenes.js';
import type { ClienteLectura } from '../../../comun/transaccion.js';

import { COD_AJUSTE_ENTRADA, COD_AJUSTE_SALIDA, tipoPorCodigo } from './comun.js';
import {
  textoClave,
  type AdaptadorCiclico,
  type CapturaRenglon,
  type ClaveArticulo,
  type Componentes,
  type LineaAjuste,
  type RenglonCiclico,
} from './tipos.js';

/** La llave de PT, ya desarmada (lo que el adaptador guarda dentro de una {@link ClaveArticulo}). */
interface ClavePt {
  idModelo: number;
  idColor: number;
  idTalla: number;
  idOrden: number | null;
}

/** Lee una {@link ClaveArticulo} como llave de PT (el motor nunca la interpreta; aquí sí). */
function comoPt(clave: ClaveArticulo): ClavePt {
  const idModelo = clave['idModelo'];
  const idColor = clave['idColor'];
  const idTalla = clave['idTalla'];
  if (idModelo == null || idColor == null || idTalla == null) {
    throw new ErrorValidacion('Llave de artículo de producto terminado incompleta.');
  }
  return { idModelo, idColor, idTalla, idOrden: clave['idOrden'] ?? null };
}

/** Orden DETERMINISTA de los locks — el MISMO que usa `exigirExistenciaPt` en el motor de kardex. */
function ordenar(claves: readonly ClaveArticulo[]): ClavePt[] {
  return claves
    .map(comoPt)
    .sort(
      (a, b) =>
        a.idModelo - b.idModelo ||
        a.idColor - b.idColor ||
        a.idTalla - b.idTalla ||
        (a.idOrden ?? -1) - (b.idOrden ?? -1),
    );
}

/** Vuelve a armar la llave opaca a partir de la llave de PT. */
function aClave(pt: ClavePt): ClaveArticulo {
  return { idModelo: pt.idModelo, idColor: pt.idColor, idTalla: pt.idTalla, idOrden: pt.idOrden };
}

export const adaptadorPt: AdaptadorCiclico = {
  dimension: 'PT',
  tipoAlmacen: 'PT',
  conteoCiego: true,
  escala: 0,
  nombreArticulo: 'modelo',
  permisoAjuste: null,

  alcance(datos: DatosInventarioCiclicoCrear): number[] | undefined {
    if (datos.idsTela !== undefined || datos.idsAvio !== undefined) {
      throw new ErrorValidacion(
        'Este almacén es de producto terminado: el alcance se acota con modelos, no con telas ni avíos.',
      );
    }
    return datos.idsModelo;
  },

  async enumerar(tx, ctx, alcance) {
    // La vista `existencia_pt` agrega por …×orden×almacén: aquí SÍ se usa, porque es una CONSULTA
    // para ENUMERAR. El valor que se congela se re-lee DIRECTO y bajo lock (ADR-0010 §3).
    const condiciones: Prisma.Sql[] = [
      Prisma.sql`e."id_empresa" = ${ctx.idEmpresa}`,
      Prisma.sql`e."id_almacen" = ${ctx.idAlmacen}`,
      Prisma.sql`e."existencia" <> 0`,
    ];
    if (alcance !== undefined && alcance.length > 0) {
      condiciones.push(Prisma.sql`e."id_modelo" IN (${Prisma.join(alcance)})`);
    }
    const filas = await tx.$queryRaw<ClavePt[]>(Prisma.sql`
      SELECT e."id_modelo" AS "idModelo", e."id_color" AS "idColor", e."id_talla" AS "idTalla",
             e."id_orden" AS "idOrden"
      FROM "existencia_pt" e
      WHERE ${Prisma.join(condiciones, ' AND ')}
    `);
    return filas.map(aClave);
  },

  async leerExistenciasBloqueadas(tx, ctx, claves) {
    const mapa = new Map<string, Componentes>();
    for (const art of ordenar(claves)) {
      await bloquearArticuloPt(
        tx,
        ctx.idEmpresa,
        ctx.idAlmacen,
        art.idModelo,
        art.idColor,
        art.idTalla,
        art.idOrden,
      );
      const cuerpo = await existenciaPtBloqueada(
        tx,
        ctx.idEmpresa,
        ctx.idAlmacen,
        art.idModelo,
        art.idColor,
        art.idTalla,
        art.idOrden,
      );
      mapa.set(textoClave(aClave(art)), { cuerpo, complemento: null });
    }
    return mapa;
  },

  async sembrar(tx, sesion, idInventario, renglones) {
    if (renglones.length === 0) return;
    await tx.inventarioCiclicoDet.createMany({
      data: renglones.map((r) => {
        const pt = comoPt(r.clave);
        return {
          idInventarioCiclico: idInventario,
          idModelo: pt.idModelo,
          idColor: pt.idColor,
          idTalla: pt.idTalla,
          idOrden: pt.idOrden,
          cantTeorica: r.teorico.cuerpo,
          creadoPorId: sesion.id,
          modificadoPorId: sesion.id,
        };
      }),
    });
  },

  async resolverClaveNueva(tx, ctx, entrada: DatosCiclicoRenglonAgregar) {
    if (entrada.idTelaColor !== undefined || entrada.idAvio !== undefined) {
      throw new ErrorValidacion(
        'Esta hoja cuenta producto terminado: el renglón se agrega con modelo, color y talla.',
      );
    }
    const { idModelo, idColor, idTalla } = entrada;
    if (idModelo === undefined || idColor === undefined || idTalla === undefined) {
      throw new ErrorValidacion('Para agregar un renglón de producto terminado indica modelo, color y talla.');
    }
    const [modelo, color, talla] = await Promise.all([
      tx.modelo.findUnique({ where: { id: idModelo }, select: { id: true } }),
      tx.color.findUnique({ where: { id: idColor }, select: { id: true } }),
      tx.talla.findUnique({ where: { id: idTalla }, select: { id: true } }),
    ]);
    if (modelo === null) throw new ErrorNoEncontrado('Modelo', idModelo);
    if (color === null) throw new ErrorNoEncontrado('Color', idColor);
    if (talla === null) throw new ErrorNoEncontrado('Talla', idTalla);
    const idOrden = entrada.idOrden ?? null;
    if (idOrden !== null) {
      // La orden tiene que ser de la MISMA empresa que la hoja (A9): el bucket de PT por orden
      // vive dentro de la empresa, y colgar el renglón de una orden ajena partiría el kardex.
      const orden = await tx.orden.findFirst({
        where: { id: idOrden, idEmpresa: ctx.idEmpresa },
        select: { id: true },
      });
      if (orden === null) throw new ErrorNoEncontrado('Orden', idOrden);
    }
    return { idModelo, idColor, idTalla, idOrden };
  },

  async leer(cliente: ClienteLectura, idInventario) {
    const filas = await cliente.inventarioCiclicoDet.findMany({
      where: { idInventarioCiclico: idInventario },
      select: {
        id: true,
        idModelo: true,
        idColor: true,
        idTalla: true,
        idOrden: true,
        cantTeorica: true,
        cantReal: true,
        modelo: { select: { codigo: true } },
        color: { select: { nombre: true } },
        talla: { select: { etiqueta: true, orden: true } },
        orden: { select: { folio: true } },
        movimientoAjuste: { select: { id: true, folio: true, tipoMov: { select: { direccion: true } } } },
      },
      orderBy: [
        { modelo: { codigo: 'asc' } },
        { color: { nombre: 'asc' } },
        { talla: { orden: 'asc' } },
        { id: 'asc' },
      ],
    });
    return filas.map<RenglonCiclico>((d) => ({
      idDet: d.id,
      clave: { idModelo: d.idModelo, idColor: d.idColor, idTalla: d.idTalla, idOrden: d.idOrden },
      titulo: d.modelo.codigo,
      subtitulo: `${d.color.nombre} · ${d.talla.etiqueta}${
        d.orden === null ? ' · Sin orden' : ` · Orden #${d.orden.folio.toString()}`
      }`,
      unidad: null,
      nombreComplemento: null,
      cantTeorica: d.cantTeorica,
      cantTeoricaComplemento: null,
      cantReal: d.cantReal,
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

  async guardarConteo(tx, sesion, idInventario, capturas: readonly CapturaRenglon[]) {
    if (capturas.length === 0) return;
    for (const c of capturas) {
      if (!Number.isInteger(c.cantReal)) {
        throw new ErrorValidacion(
          `El producto terminado se cuenta en piezas enteras (se recibió ${String(c.cantReal)}).`,
        );
      }
      if (c.cantRealComplemento !== null) {
        throw new ErrorValidacion('El producto terminado no tiene segundo componente que contar.');
      }
    }
    // Una SOLA sentencia para todos los renglones (esta pantalla carga inventarios completos):
    // `UPDATE … FROM (VALUES …)`. `modificado_en` se escribe A MANO porque `@updatedAt` lo pone
    // Prisma en el cliente, y el SQL crudo no pasa por ahí.
    const ahora = new Date();
    const valores = capturas.map((c) => Prisma.sql`(${c.idDet}::int, ${c.cantReal}::int)`);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "inventario_ciclico_det" AS d
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
      cliente.inventarioCiclicoDet.count({ where: { idInventarioCiclico: idInventario } }),
      cliente.inventarioCiclicoDet.count({
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
    const movimiento = await registrarMovimientoPt(
      sesion,
      {
        idEmpresa: ctx.idEmpresa,
        idTipoMov: tipo.id,
        idAlmacen: ctx.idAlmacen,
        fecha: datos.fecha,
        origenTipo: ORIGEN.ajusteCiclico,
        origenId: String(datos.idCiclico),
        lineas: lineas.map<LineaMovimientoPt>((l: LineaAjuste) => {
          const pt = comoPt(l.clave);
          return { ...pt, cantidad: l.cuerpo };
        }),
        observaciones: datos.observaciones,
      },
      { tx },
    );
    return movimiento.id;
  },

  async enlazar(tx, sesion, idsDet, idMovimiento) {
    if (idsDet.length === 0) return;
    await tx.inventarioCiclicoDet.updateMany({
      where: { id: { in: [...idsDet] } },
      data: { idMovimientoAjuste: idMovimiento, modificadoPorId: sesion.id },
    });
  },
};
