/**
 * CONSULTAS SEMANALES de EsMa (F6-E5; doc 07-EsMa §4, ex `EsMa_PagosSem` y `RecibosSemanalesMaq`,
 * menú 3.8). Dos consultas de solo lectura por periodo (la navegación semana-actual/anterior la
 * resuelve el frontend pasando el rango):
 *
 *  • {@link pagosSemanales} — pagos del periodo (encabezado) con su total.
 *  • {@link recibosSemanalesMaquilaEsMa} — recibos de maquila del periodo por maquilero/modelo,
 *    valuados al precio pactado del recibo (importes visibles solo con `consultas.ver-importes`).
 *
 * Innegociables: A1 (lógica aquí), A4 (`esma.ver-pagos`), A9 (empresa activa). Los importes se ocultan
 * (null) si falta `consultas.ver-importes`.
 */
import {
  esquemaPagosSemanalesQuery,
  esquemaRecibosSemanalesEsMaQuery,
  type PagosSemanalesSalida,
  type RecibosSemanalesEsMaSalida,
} from '../../contrato/index.js';
import { TipoEtapaMovimiento } from '../../datos/index.js';
import type { z } from 'zod';

import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Convierte un `YYYY-MM-DD` al `Date` UTC que Prisma guarda en `@db.Date`. */
function aDateColumna(valor: string): Date {
  return new Date(`${valor}T00:00:00.000Z`);
}

/** Redondeo monetario a 2 decimales. */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Rango sobre una columna `@db.Date` (fecha del movimiento), inclusivo en ambos extremos. */
function rangoFecha(
  desde: string | undefined,
  hasta: string | undefined,
): { fecha?: { gte?: Date; lte?: Date } } {
  if (desde === undefined && hasta === undefined) {
    return {};
  }
  return {
    fecha: {
      ...(desde === undefined ? {} : { gte: aDateColumna(desde) }),
      ...(hasta === undefined ? {} : { lte: aDateColumna(hasta) }),
    },
  };
}

/**
 * PAGOS del periodo (encabezado, sin el detalle de aplicaciones) con su total. Más recientes primero.
 * Permiso `esma.ver-pagos`; oculta importes sin `consultas.ver-importes`.
 */
export async function pagosSemanales(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaPagosSemanalesQuery> = {},
  bd?: ContextoBd,
): Promise<PagosSemanalesSalida> {
  verificarPermiso(sesion, 'esma.ver-pagos');
  const filtros = validarEntrada(esquemaPagosSemanalesQuery, parametros);
  const cliente = clienteLectura(bd);
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');

  // ⚠️ A PROPÓSITO SIN el filtro de revisión (V1, fila 0.115). Esta consulta responde "¿qué pagos se
  // CAPTURARON esta semana?" —el corte de caja del que paga—, no "¿cuánto se le debe al maquilero?".
  // Son dos preguntas distintas: al saldo sólo entra lo revisado (`formula-saldo.ts`), pero un pago
  // recién capturado ya salió de la chequera y tiene que verse aquí el mismo día. Cada renglón trae
  // su `estadoRevision`, así que quien lee la semana ve cuáles siguen sin autorizar.
  // NO "arreglar" esto copiándole el criterio al saldo: cambiaría la pregunta.
  const pagos = await cliente.pagoMaquilero.findMany({
    where: { idEmpresa: sesion.idEmpresaActiva, ...rangoFecha(filtros.desde, filtros.hasta) },
    orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      idMaquilero: true,
      maquilero: { select: { nombre: true } },
      monto: true,
      fecha: true,
      conFactura: true,
      estadoRevision: true,
      _count: { select: { aplicaciones: true } },
    },
  });

  const filas = pagos.map((p) => ({
    id: p.id,
    idMaquilero: p.idMaquilero,
    maquilero: p.maquilero.nombre,
    fecha: p.fecha.toISOString().slice(0, 10),
    monto: puedeVerImportes ? p.monto.toNumber() : null,
    conFactura: p.conFactura,
    estadoRevision: p.estadoRevision,
    numAplicaciones: p._count.aplicaciones,
  }));

  const total = puedeVerImportes
    ? redondear2(pagos.reduce((s, p) => s + p.monto.toNumber(), 0))
    : null;

  return { desde: filtros.desde ?? null, hasta: filtros.hasta ?? null, filas, total };
}

/**
 * RECIBOS de maquila del periodo (por maquilero/modelo), valuados al precio pactado del recibo. Lee
 * los recibos vivos (`EtapaMovimiento` tipo `recibo_maquila`, no cancelados) de F3. Un renglón por
 * recibo. Permiso `esma.ver-pagos`; los IMPORTES se ocultan sin `consultas.ver-importes` (aquí SÍ hay
 * importes, a diferencia de la consulta de producción — que solo maneja cantidades).
 */
export async function recibosSemanalesMaquilaEsMa(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaRecibosSemanalesEsMaQuery> = {},
  bd?: ContextoBd,
): Promise<RecibosSemanalesEsMaSalida> {
  verificarPermiso(sesion, 'esma.ver-pagos');
  const filtros = validarEntrada(esquemaRecibosSemanalesEsMaQuery, parametros);
  const cliente = clienteLectura(bd);
  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');

  const recibos = await cliente.etapaMovimiento.findMany({
    where: {
      idEmpresa: sesion.idEmpresaActiva,
      tipo: TipoEtapaMovimiento.recibo_maquila,
      canceladoEn: null,
      ...(filtros.idMaquilero === undefined ? {} : { idTercero: filtros.idMaquilero }),
      ...rangoFecha(filtros.desde, filtros.hasta),
    },
    orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      folio: true,
      fecha: true,
      idTercero: true,
      precioPactado: true,
      tercero: { select: { nombre: true } },
      orden: { select: { folio: true, modelo: { select: { codigo: true } } } },
      tipoProceso: { select: { nombre: true } },
      detalles: { select: { cantidad: true } },
    },
  });

  let totalCantidad = 0;
  let totalImporte = 0;
  const filas = recibos.map((r) => {
    const cantidad = r.detalles.reduce((s, d) => s + d.cantidad, 0);
    const precio = r.precioPactado === null ? null : r.precioPactado.toNumber();
    const importeBruto = precio === null ? null : redondear2(cantidad * precio);
    totalCantidad += cantidad;
    if (importeBruto !== null) {
      totalImporte += importeBruto;
    }
    return {
      idRecibo: r.id,
      folioRecibo: Number(r.folio),
      fecha: r.fecha.toISOString().slice(0, 10),
      idMaquilero: r.idTercero,
      maquilero: r.tercero?.nombre ?? 'Sin asignar',
      folioOrden: Number(r.orden.folio),
      codigoModelo: r.orden.modelo.codigo,
      tipoProceso: r.tipoProceso?.nombre ?? '',
      cantidad,
      importe: importeBruto === null ? null : puedeVerImportes ? importeBruto : null,
    };
  });

  return {
    desde: filtros.desde ?? null,
    hasta: filtros.hasta ?? null,
    filas,
    totalCantidad,
    totalImporte: puedeVerImportes ? redondear2(totalImporte) : null,
  };
}
