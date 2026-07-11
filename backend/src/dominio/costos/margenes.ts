/**
 * COSTOS Y MÁRGENES POR PEDIDO (F7-E1; doc 06-Costos-y-EDR §5, ex `MargenesPorPedido`/
 * `CostoPedidosPromedio`; DECISIONES.md D2 #6). Toda la lógica vive AQUÍ (A1); la ruta solo valida
 * permiso + Zod y delega. Cálculo con SQL AGREGADO (§1 permite SQL para reportes) — NUNCA N+1.
 *
 * Fórmula de MARGEN de Daniel (D2 #6), por orden con costo ≠ 0:
 *     margen = 1 − ( costoUnitario ÷ ( precio − bonificacionesCliente ) )
 * donde `precio` = precio pactado del renglón del pedido y `costoUnitario` = `costoTotal` ÷ base de
 * prorrateo de la orden (cortado por defecto). Las BONIFICACIONES del cliente (logística, publicidad)
 * RESTAN de la venta (precio neto), no del costo. ⚠️ Deuda: en F7-E1 NO existe fuente de las
 * bonificaciones por cliente (llegan con Finanzas/F9), así que `bonificaciones = 0` (precio neto =
 * precio); la fórmula ya las contempla y el día que haya dato se enchufa aquí sin tocar el resto.
 *
 * Agregados por pedido (solo órdenes con `costoTotal` ≠ 0 — ex `OrdenesConCosto`):
 *  • importe             = Σ ( precio × cantidadPedida )
 *  • margenPromedio      = AVG( margen )                          (promedio simple por orden)
 *  • margenPonderado     = Σ ( cantidadPedida × margen ) ÷ Σ cantidadPedida
 *  • margenPesosPorPieza = Σ ( (precioNeto − costoUnit) × cantidadPedida ) ÷ Σ cantidadPedida
 *
 * ⚠️ Grano (como el legacy): una orden = un renglón de pedido; si un renglón tiene VARIAS órdenes
 * (resurtidos), su `cantidadPedida` se cuenta por cada orden (igual que `MargenesPorPedido` del viejo).
 * Se documenta para validar el cuadre con los números de Daniel.
 *
 * Innegociables: A1, A4 (`costos.ver`), A9 (órdenes de la empresa activa), D2/D3 (base derivada por
 * suma de `EtapaMovimientoDet`, nunca acumulador). Importes/márgenes en `null` sin
 * `consultas.ver-importes` (revelan costo/precio).
 */
import { esquemaMargenesQuery, type MargenesSalida } from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { redondear2 } from './decimales.js';

/** Redondeo a 4 decimales para los márgenes (fracciones); los importes usan `redondear2`. */
function redondear4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Fila cruda del `$queryRaw` (importes/márgenes ya como `float8` → number | null). */
interface FilaCruda {
  idPedido: number;
  folio: bigint;
  idCliente: number;
  cliente: string;
  fechaHasta: Date | null;
  cantidad: number;
  importe: number;
  margenPromedio: number | null;
  margenPonderado: number | null;
  margenPesosPorPieza: number | null;
}

/**
 * Costos y márgenes por pedido de la empresa activa (A9), agregado en SQL. `costos.ver`; oculta
 * importes/márgenes sin `consultas.ver-importes`. Filtros por año/mes (sobre `fechaHasta`) y cliente.
 */
export async function margenesPorPedido(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaMargenesQuery> = {},
  bd?: ContextoBd,
): Promise<MargenesSalida> {
  verificarPermiso(sesion, 'costos.ver');
  const filtros = validarEntrada(esquemaMargenesQuery, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;

  // Filtros opcionales del SELECT final (sobre el pedido).
  const fAnio =
    filtros.anio === undefined
      ? Prisma.empty
      : Prisma.sql`AND EXTRACT(YEAR FROM p."fecha_hasta") = ${filtros.anio}`;
  const fMes =
    filtros.mes === undefined
      ? Prisma.empty
      : Prisma.sql`AND EXTRACT(MONTH FROM p."fecha_hasta") = ${filtros.mes}`;
  const fCliente =
    filtros.idCliente === undefined
      ? Prisma.empty
      : Prisma.sql`AND p."id_cliente" = ${filtros.idCliente}`;

  const filasCrudas = await cliente.$queryRaw<FilaCruda[]>(Prisma.sql`
    WITH orden_base AS (
      SELECT
        o."id"                 AS id_orden,
        pl."id_pedido"         AS id_pedido,
        pl."precio"            AS precio,
        pl."cantidad_pedida"   AS cantidad,
        co."costo_total"       AS costo_total,
        co."base_prorrateo"    AS base,
        COALESCE((
          SELECT SUM(d."cantidad") FROM "etapa_movimiento_det" d
          JOIN "etapa_movimiento" e ON e."id" = d."id_etapa_mov"
          WHERE e."id_orden" = o."id" AND e."tipo" = 'corte' AND e."cancelado_en" IS NULL
        ), 0) AS cortado,
        COALESCE((
          SELECT SUM(d."cantidad") FROM "etapa_movimiento_det" d
          JOIN "etapa_movimiento" e ON e."id" = d."id_etapa_mov"
          JOIN "tipos_proceso" tp ON tp."id" = e."id_tipo_proceso"
          WHERE e."id_orden" = o."id" AND e."tipo" = 'recibo_maquila'
            AND e."cancelado_en" IS NULL AND tp."genera_entrada_pt" = TRUE
        ), 0) AS recibido,
        COALESCE((
          SELECT SUM(d."cantidad") FROM "etapa_movimiento_det" d
          JOIN "etapa_movimiento" e ON e."id" = d."id_etapa_mov"
          WHERE e."id_orden" = o."id" AND e."tipo" = 'entrega_cliente' AND e."cancelado_en" IS NULL
        ), 0) AS vendido
      FROM "ordenes" o
      JOIN "pedido_linea" pl ON pl."id" = o."id_pedido_linea"
      JOIN "costo_orden" co ON co."id_orden" = o."id"
      WHERE o."id_empresa" = ${idEmpresa}
        AND co."costo_total" IS NOT NULL AND co."costo_total" <> 0
    ),
    orden_calc AS (
      SELECT
        ob.id_pedido,
        ob.precio,
        ob.cantidad,
        CASE ob.base
          WHEN 'recibido' THEN ob.recibido
          WHEN 'vendido'  THEN ob.vendido
          ELSE ob.cortado
        END AS base_cant,
        ob.costo_total
      FROM orden_base ob
    ),
    orden_margen AS (
      SELECT
        oc.id_pedido,
        oc.precio,
        oc.cantidad,
        oc.precio AS precio_neto,  -- bonificaciones = 0 (sin fuente en F7-E1; ver TSDoc)
        CASE WHEN oc.base_cant > 0 THEN oc.costo_total / oc.base_cant ELSE NULL END AS costo_unit
      FROM orden_calc oc
    ),
    orden_final AS (
      SELECT
        om.id_pedido,
        om.precio,
        om.cantidad,
        om.precio_neto,
        om.costo_unit,
        CASE WHEN om.precio_neto > 0 AND om.costo_unit IS NOT NULL
             THEN 1 - (om.costo_unit / om.precio_neto) ELSE NULL END AS margen,
        CASE WHEN om.costo_unit IS NOT NULL
             THEN om.precio_neto - om.costo_unit ELSE NULL END AS margen_pesos
      FROM orden_margen om
    )
    SELECT
      p."id"                                            AS "idPedido",
      p."folio"                                         AS "folio",
      p."id_cliente"                                    AS "idCliente",
      c."nombre"                                        AS "cliente",
      p."fecha_hasta"                                   AS "fechaHasta",
      COALESCE(SUM(ofn.cantidad), 0)::int                AS "cantidad",
      COALESCE(SUM(ofn.precio * ofn.cantidad), 0)::float8 AS "importe",
      AVG(ofn.margen)::float8                            AS "margenPromedio",
      -- Cada promedio PONDERADO divide SOLO entre la cantidad de las órdenes que aportan al
      -- numerador (margen/margen_pesos no NULL): si el divisor contara la cantidad de las órdenes
      -- con margen NULL (base 0 o precio ≤ 0), el ponderado saldría diluido. Se alinea POR COLUMNA
      -- porque margen y margen_pesos tienen condición de NULL distinta (una orden con precio 0 deja
      -- margen NULL pero margen_pesos no). NULLIF evita el div-por-cero (todas NULL → NULL).
      (COALESCE(SUM(ofn.cantidad * ofn.margen), 0)
        / NULLIF(SUM(CASE WHEN ofn.margen IS NOT NULL THEN ofn.cantidad ELSE 0 END), 0))::float8
        AS "margenPonderado",
      (COALESCE(SUM(ofn.margen_pesos * ofn.cantidad), 0)
        / NULLIF(SUM(CASE WHEN ofn.margen_pesos IS NOT NULL THEN ofn.cantidad ELSE 0 END), 0))::float8
        AS "margenPesosPorPieza"
    FROM orden_final ofn
    JOIN "pedidos" p   ON p."id" = ofn.id_pedido
    JOIN "clientes" c  ON c."id" = p."id_cliente"
    WHERE TRUE ${fAnio} ${fMes} ${fCliente}
    GROUP BY p."id", p."folio", p."id_cliente", c."nombre", p."fecha_hasta"
    ORDER BY p."fecha_hasta" DESC NULLS LAST, p."folio" DESC
  `);

  const verImportes = tienePermiso(sesion, 'consultas.ver-importes');
  const money = (v: number | null): number | null =>
    verImportes ? (v === null ? null : redondear2(v)) : null;
  const frac = (v: number | null): number | null =>
    verImportes ? (v === null ? null : redondear4(v)) : null;

  const filas = filasCrudas.map((f) => ({
    idPedido: f.idPedido,
    folio: Number(f.folio),
    idCliente: f.idCliente,
    cliente: f.cliente,
    fechaHasta: f.fechaHasta === null ? null : f.fechaHasta.toISOString().slice(0, 10),
    cantidad: f.cantidad,
    importe: money(f.importe),
    margenPromedio: frac(f.margenPromedio),
    margenPonderado: frac(f.margenPonderado),
    margenPesosPorPieza: money(f.margenPesosPorPieza),
  }));

  const totalImporte = verImportes
    ? redondear2(filasCrudas.reduce((s, f) => s + f.importe, 0))
    : null;
  const totalPiezas = filasCrudas.reduce((s, f) => s + f.cantidad, 0);

  return { filas, totalImporte, totalPiezas };
}
