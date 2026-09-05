/**
 * ADAPTADOR de TELAS del inventario cíclico (fila 0.099, §Post-F9.193 punto 5). La llave es la
 * dimensión REAL de la existencia de tela del flujo nuevo: **TELA × COLOR** (`existencia_tela_color`
 * agrega por tela×color×almacén; el almacén sale del encabezado). Cantidades DECIMALES (escala 4,
 * la misma de `movimiento_det_tela`): se cuentan metros y kilos, no piezas.
 *
 * ⭐ **DOS COMPONENTES POR RENGLÓN (D5).** Una tela puede llevar COMPLEMENTO (el cardigan) y ambos
 * viajan JUNTOS en el mismo renglón de kardex, cada uno con su propia existencia. Por eso el conteo
 * pide DOS números y un mismo renglón puede necesitar a la vez una ENTRADA (el componente que
 * faltó) y una SALIDA (el que sobró) — los cuatro cuadrantes que la fila 0.098 ya documentó en
 * `dominio/inventarios/partidas-telas.ts`. `complemento` NULL = la tela NO lleva: entonces no se
 * pide, no se congela y no se mueve (inventar ese número sería inventar un dato que nadie contó).
 *
 * El conteo NO es ciego: se captura lo contado CON EL SALDO DEL SISTEMA A LA VISTA (decisión de
 * Daniel, §Post-F9.193 punto 4).
 *
 * ⚠️ El ajuste de ENTRADA **no crea partida** (a diferencia del conteo por color de la fila 0.098).
 * La partida es la unidad de ENTRADA del inventario de telas —nace de una compra o de una carga
 * inicial, con su factura y su lote del proveedor—, y una hoja de conteo cíclico no tiene ninguno de
 * esos datos: fabricar una partida vacía por cada faltante ensuciaría la traza de entradas con
 * documentos que no existen. El renglón de kardex del ajuste va sin partida, igual que las salidas.
 */
import { Prisma } from '../../../datos/index.js';
import type { DatosCiclicoRenglonAgregar, DatosInventarioCiclicoCrear } from '../../../contrato/index.js';
import { ErrorNoEncontrado, ErrorValidacion } from '../../../comun/errores.js';
import {
  bloquearTelaColor,
  existenciasTelaColorPorColor,
  registrarMovimientoTela,
  type LineaMovimientoTela,
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

/** Lee una {@link ClaveArticulo} como llave de tela (el color de la tela). */
function idColorDe(clave: ClaveArticulo): number {
  const id = clave['idTelaColor'];
  if (id == null) throw new ErrorValidacion('Llave de color de tela incompleta.');
  return id;
}

/** Decimal de Prisma → `number` (las cantidades de tela son `Decimal(14,4)`). */
function aNumero(valor: Prisma.Decimal | null): number | null {
  return valor === null ? null : Number(valor);
}

export const adaptadorTela: AdaptadorCiclico = {
  dimension: 'TELA',
  tipoAlmacen: 'TELA',
  conteoCiego: false,
  escala: 4,
  nombreArticulo: 'color de tela',
  permisoAjuste: 'inventario-telas.mover',

  alcance(datos: DatosInventarioCiclicoCrear): number[] | undefined {
    if (datos.idsModelo !== undefined || datos.idsAvio !== undefined) {
      throw new ErrorValidacion(
        'Este almacén es de telas: el alcance se acota con telas, no con modelos ni avíos.',
      );
    }
    return datos.idsTela;
  },

  async enumerar(tx, ctx, alcance) {
    // Vista `existencia_tela_color` para ENUMERAR (consulta); el valor congelado se re-lee DIRECTO
    // y bajo lock (ADR-0010 §3). Un color entra si se movió CUALQUIERA de sus dos componentes.
    const condiciones: Prisma.Sql[] = [
      Prisma.sql`e."id_empresa" = ${ctx.idEmpresa}`,
      Prisma.sql`e."id_almacen" = ${ctx.idAlmacen}`,
      Prisma.sql`(e."existencia_cuerpo" <> 0 OR e."existencia_complemento" <> 0)`,
    ];
    if (alcance !== undefined && alcance.length > 0) {
      condiciones.push(Prisma.sql`e."id_tela" IN (${Prisma.join(alcance)})`);
    }
    const filas = await tx.$queryRaw<{ idTelaColor: number }[]>(Prisma.sql`
      SELECT e."id_tela_color" AS "idTelaColor"
      FROM "existencia_tela_color" e
      WHERE ${Prisma.join(condiciones, ' AND ')}
    `);
    return filas.map((f) => ({ idTelaColor: f.idTelaColor }));
  },

  async leerExistenciasBloqueadas(tx, ctx, claves) {
    const ids = [...new Set(claves.map(idColorDe))].sort((a, b) => a - b);
    const mapa = new Map<string, Componentes>();
    if (ids.length === 0) return mapa;
    // Locks en orden ASCENDENTE por `idTelaColor` — el MISMO orden que toman
    // `validarNoNegativoTelaColor` y el conteo por color de la fila 0.098; sin eso, dos
    // operaciones cruzadas sobre los mismos colores podrían interbloquearse.
    for (const id of ids) {
      await bloquearTelaColor(tx, ctx.idEmpresa, ctx.idAlmacen, id);
    }
    // Ya con TODOS los locks tomados, UNA sola Σ agrupada (la hoja del arranque son cientos de
    // renglones). Comparte el fragmento SQL con el lector bajo lock del motor de kardex.
    const existencias = await existenciasTelaColorPorColor(tx, ctx.idEmpresa, ctx.idAlmacen, ids);
    const porColor = new Map(existencias.map((e) => [e.idTelaColor, e]));
    // Qué colores llevan complemento: `nombreComplemento` de la TELA (NULL = no lleva).
    const colores = await tx.telaColor.findMany({
      where: { id: { in: ids } },
      select: { id: true, tela: { select: { nombreComplemento: true } } },
    });
    const llevaComplemento = new Map(colores.map((c) => [c.id, c.tela.nombreComplemento !== null]));
    for (const id of ids) {
      const e = porColor.get(id);
      mapa.set(textoClave({ idTelaColor: id }), {
        cuerpo: e?.cuerpo ?? 0,
        // Una tela SIN complemento no tiene complemento que congelar ni que mover, aunque una fila
        // vieja hubiera dejado un saldo fantasma ahí (se TOLERA, no se compensa — REGLA 0-B).
        complemento: llevaComplemento.get(id) === true ? (e?.complemento ?? 0) : null,
      });
    }
    return mapa;
  },

  async sembrar(tx, sesion, idInventario, renglones) {
    if (renglones.length === 0) return;
    await tx.inventarioCiclicoDetTela.createMany({
      data: renglones.map((r) => ({
        idInventarioCiclico: idInventario,
        idTelaColor: idColorDe(r.clave),
        cantTeorica: r.teorico.cuerpo,
        cantTeoricaComplemento: r.teorico.complemento,
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
      entrada.idAvio !== undefined
    ) {
      throw new ErrorValidacion('Esta hoja cuenta telas: el renglón se agrega con un color de tela.');
    }
    const { idTelaColor } = entrada;
    if (idTelaColor === undefined) {
      throw new ErrorValidacion('Para agregar un renglón de telas indica el color de la tela.');
    }
    const color = await tx.telaColor.findUnique({ where: { id: idTelaColor }, select: { id: true } });
    if (color === null) throw new ErrorNoEncontrado('TelaColor', idTelaColor);
    return { idTelaColor };
  },

  async leer(cliente: ClienteLectura, idInventario) {
    const filas = await cliente.inventarioCiclicoDetTela.findMany({
      where: { idInventarioCiclico: idInventario },
      select: {
        id: true,
        idTelaColor: true,
        cantTeorica: true,
        cantReal: true,
        cantTeoricaComplemento: true,
        cantRealComplemento: true,
        telaColor: {
          select: {
            nombre: true,
            tela: { select: { nombre: true, nombreComplemento: true, unidadMedida: true } },
          },
        },
        movimientoAjusteEntrada: { select: { id: true, folio: true } },
        movimientoAjusteSalida: { select: { id: true, folio: true } },
      },
      orderBy: [{ telaColor: { tela: { nombre: 'asc' } } }, { telaColor: { nombre: 'asc' } }, { id: 'asc' }],
    });
    return filas.map<RenglonCiclico>((d) => ({
      idDet: d.id,
      clave: { idTelaColor: d.idTelaColor },
      titulo: d.telaColor.tela.nombre,
      subtitulo: d.telaColor.nombre,
      unidad: d.telaColor.tela.unidadMedida === 'KG' ? 'kg' : 'm',
      nombreComplemento: d.telaColor.tela.nombreComplemento,
      cantTeorica: Number(d.cantTeorica),
      cantTeoricaComplemento: aNumero(d.cantTeoricaComplemento),
      cantReal: aNumero(d.cantReal),
      cantRealComplemento: aNumero(d.cantRealComplemento),
      ajustes: [
        ...(d.movimientoAjusteEntrada === null
          ? []
          : [
              {
                id: d.movimientoAjusteEntrada.id,
                folio: Number(d.movimientoAjusteEntrada.folio),
                direccion: 'entrada' as const,
              },
            ]),
        ...(d.movimientoAjusteSalida === null
          ? []
          : [
              {
                id: d.movimientoAjusteSalida.id,
                folio: Number(d.movimientoAjusteSalida.folio),
                direccion: 'salida' as const,
              },
            ]),
      ],
    }));
  },

  async guardarConteo(tx, sesion, idInventario, capturas) {
    if (capturas.length === 0) return;
    const ahora = new Date();
    // UNA sentencia para todos los renglones (la hoja del arranque son cientos). `modificado_en`
    // va a mano: `@updatedAt` lo escribe el cliente de Prisma, y esto es SQL crudo.
    const valores = capturas.map(
      (c) =>
        Prisma.sql`(${c.idDet}::int, ${c.cantReal}::decimal(14,4), ${c.cantRealComplemento}::decimal(14,4))`,
    );
    await tx.$executeRaw(Prisma.sql`
      UPDATE "inventario_ciclico_det_tela" AS d
      SET "cant_real" = v."cant_real",
          "cant_real_complemento" = v."cant_real_complemento",
          "contado_en" = ${ahora},
          "contado_por_id" = ${sesion.id},
          "modificado_por_id" = ${sesion.id},
          "modificado_en" = ${ahora}
      FROM (VALUES ${Prisma.join(valores)}) AS v("id", "cant_real", "cant_real_complemento")
      WHERE d."id" = v."id" AND d."id_inventario_ciclico" = ${idInventario}
    `);
  },

  async contar(cliente: ClienteLectura, idInventario) {
    const [total, contados] = await Promise.all([
      cliente.inventarioCiclicoDetTela.count({ where: { idInventarioCiclico: idInventario } }),
      cliente.inventarioCiclicoDetTela.count({
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
    // `MovimientoDetTela` guarda la TELA además del color (el color es hijo de la tela, pero el
    // renglón de kardex lleva las dos para consultarse sin join). Se resuelve de una sola consulta.
    const ids = lineas.map((l) => idColorDe(l.clave));
    const colores = await tx.telaColor.findMany({
      where: { id: { in: ids } },
      select: { id: true, idTela: true },
    });
    const telaDe = new Map(colores.map((c) => [c.id, c.idTela]));
    const movimiento = await registrarMovimientoTela(
      sesion,
      {
        idEmpresa: ctx.idEmpresa,
        idTipoMov: tipo.id,
        idAlmacen: ctx.idAlmacen,
        fecha: datos.fecha,
        origenTipo: ORIGEN.ajusteCiclico,
        origenId: String(datos.idCiclico),
        lineas: lineas.map<LineaMovimientoTela>((l) => {
          const idTelaColor = idColorDe(l.clave);
          const idTela = telaDe.get(idTelaColor);
          if (idTela === undefined) throw new ErrorNoEncontrado('TelaColor', idTelaColor);
          return {
            idTela,
            idTelaColor,
            cantidad: l.cuerpo,
            cantidadComplemento: l.complemento,
          };
        }),
        observaciones: datos.observaciones,
      },
      { tx },
    );
    return movimiento.id;
  },

  async enlazar(tx, sesion, idsDet, idMovimiento, direccion) {
    if (idsDet.length === 0) return;
    await tx.inventarioCiclicoDetTela.updateMany({
      where: { id: { in: [...idsDet] } },
      data:
        direccion === 'entrada'
          ? { idMovimientoAjusteEntrada: idMovimiento, modificadoPorId: sesion.id }
          : { idMovimientoAjusteSalida: idMovimiento, modificadoPorId: sesion.id },
    });
  },
};
