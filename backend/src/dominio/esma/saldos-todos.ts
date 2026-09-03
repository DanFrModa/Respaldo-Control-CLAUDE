/**
 * SALDOS DE TODOS LOS MAQUILEROS (F6-E5; doc 07-EsMa §1, ex `EsMa_SaldosMaq`): el tablero con el saldo
 * de cada maquilero ACTIVO con saldo ≠ 0 (o con algo pendiente de revisión), para el drill-down al
 * estado de cuenta. Misma fórmula que {@link saldoDeMaquilero} pero calculada de una vez con **SQL
 * agregado** (A1/§1 permite SQL para reportes) — NUNCA N+1 llamando el saldo por cada maquilero.
 *
 * ⭐ El criterio de cada concepto (qué renglones cuentan al saldo y cuáles siguen pendientes) NO se
 * escribe aquí: los fragmentos `WHERE` salen de `formula-saldo.ts`, la definición ÚNICA que
 * comparten las tres implementaciones de la fórmula (ésta, la del lote de CxP de más abajo y la de
 * Prisma en `saldos.ts`). Antes estaba escrita tres veces y sólo una respetaba el estado de
 * revisión: arreglar un archivo pasaba en verde (fila 0.115).
 *
 * Innegociables: A1 (lógica aquí), A4 (`esma.ver-pagos`), A9 (los movimientos se acotan a la empresa
 * activa; el catálogo de proveedores es global — ADR-0007), D3 (el saldo se DERIVA, no se persiste).
 * Los IMPORTES se ocultan (todo en null) si falta `consultas.ver-importes`.
 */
import { esquemaSaldosTodosQuery, type SaldosTodosSalida } from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd, type Tx } from '../../comun/transaccion.js';
import type { PrismaClient } from '../../datos/index.js';
import { validarEntrada } from '../../comun/validacion.js';

import {
  armarPendiente,
  hayPendiente,
  netoPendiente,
  pendienteParaSalida,
  redondear2,
  saldoDeTotales,
  sqlCuenta,
  sqlPendiente,
  tieneSaldo,
  type PendienteRevision,
} from './formula-saldo.js';
import { ROLES_MAQUILA_ESMA } from './maquileros.js';

/**
 * Fila cruda del `$queryRaw`. Los subtotales viajan en `::numeric` (→ `Decimal`), NO en `float8`:
 * así el redondeo por subtotal se hace en JS con la MISMA función que la implementación de Prisma y
 * los dos caminos no se separan ni un centavo (la prueba de no-regresión los compara).
 */
interface FilaCruda {
  idMaquilero: number;
  maquilero: string;
  nombreCorto: string | null;
  totalCargos: Prisma.Decimal;
  totalAbonos: Prisma.Decimal;
  totalPagos: Prisma.Decimal;
  totalDescuentos: Prisma.Decimal;
  pendienteAbonos: Prisma.Decimal;
  pendientePagos: Prisma.Decimal;
  pendienteDescuentos: Prisma.Decimal;
  /** CUÁNTAS partidas esperan revisión (bigint en Postgres → se castea a int en el SELECT). */
  pendientePartidas: number;
}

/**
 * Calcula el saldo de todos los maquileros activos con saldo ≠ 0 —o con importes pendientes de
 * revisión— (SQL agregado; misma fórmula que `saldoDeMaquilero`). `conFactura = 'con' | 'sin'`
 * segmenta ese lado (los movimientos sin definir NO entran en ningún segmento). Permiso
 * `esma.ver-pagos`; oculta importes sin `consultas.ver-importes`.
 *
 * ⚠️ El corte de la lista NO puede ser sólo `saldo <> 0`: un maquilero cuyo ÚNICO movimiento esté
 * capturado sin revisar tendría saldo 0 y se volvería INVISIBLE — justo el caso que hay que ver
 * (alguien tiene que decidir sobre ese dinero). Entra si tiene saldo ≠ 0 **o** pendiente ≠ 0.
 */
export async function saldosDeTodosMaquileros(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaSaldosTodosQuery> = {},
  bd?: ContextoBd,
): Promise<SaldosTodosSalida> {
  verificarPermiso(sesion, 'esma.ver-pagos');
  const filtros = validarEntrada(esquemaSaldosTodosQuery, parametros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;

  // Filtro de facturación (mismo para cargos y movimientos): solo cuando se segmenta.
  const factura =
    filtros.conFactura === undefined
      ? Prisma.empty
      : Prisma.sql`AND "con_factura" = ${filtros.conFactura === 'con'}`;

  // Los cuatro criterios salen de la definición ÚNICA (formula-saldo.ts): aquí no se escribe ninguno
  // a mano. Los movimientos planos traen las DOS sumas de un tiro (lo revisado y lo pendiente) con
  // `FILTER`, para no volver a recorrer las tablas.
  const filasCrudas = await cliente.$queryRaw<FilaCruda[]>(Prisma.sql`
    SELECT
      p."id"     AS "idMaquilero",
      p."nombre" AS "maquilero",
      p."nombre_corto" AS "nombreCorto",
      COALESCE(c."total", 0)::numeric      AS "totalCargos",
      COALESCE(a."total", 0)::numeric      AS "totalAbonos",
      COALESCE(pg."total", 0)::numeric     AS "totalPagos",
      COALESCE(d."total", 0)::numeric      AS "totalDescuentos",
      COALESCE(a."pendiente", 0)::numeric  AS "pendienteAbonos",
      COALESCE(pg."pendiente", 0)::numeric AS "pendientePagos",
      COALESCE(d."pendiente", 0)::numeric  AS "pendienteDescuentos",
      (COALESCE(a."partidas", 0) + COALESCE(pg."partidas", 0)
        + COALESCE(d."partidas", 0))::int  AS "pendientePartidas"
    FROM "proveedores" p
    LEFT JOIN (
      SELECT "id_maquilero", SUM("cantidad_real" * "precio_real") AS "total"
      FROM "esma_cargo"
      WHERE "id_empresa" = ${idEmpresa} AND ${sqlCuenta('cargo')} ${factura}
      GROUP BY "id_maquilero"
    ) c ON c."id_maquilero" = p."id"
    LEFT JOIN (
      SELECT "id_maquilero",
        SUM("monto") FILTER (WHERE ${sqlCuenta('abono')})    AS "total",
        SUM("monto") FILTER (WHERE ${sqlPendiente('abono')}) AS "pendiente",
        COUNT(*) FILTER (WHERE ${sqlPendiente('abono')})     AS "partidas"
      FROM "abono_maquilero"
      WHERE "id_empresa" = ${idEmpresa} ${factura}
      GROUP BY "id_maquilero"
    ) a ON a."id_maquilero" = p."id"
    LEFT JOIN (
      SELECT "id_maquilero",
        SUM("monto") FILTER (WHERE ${sqlCuenta('pago')})    AS "total",
        SUM("monto") FILTER (WHERE ${sqlPendiente('pago')}) AS "pendiente",
        COUNT(*) FILTER (WHERE ${sqlPendiente('pago')})     AS "partidas"
      FROM "pago_maquilero"
      WHERE "id_empresa" = ${idEmpresa} ${factura}
      GROUP BY "id_maquilero"
    ) pg ON pg."id_maquilero" = p."id"
    LEFT JOIN (
      SELECT "id_maquilero",
        SUM("monto") FILTER (WHERE ${sqlCuenta('descuento')})    AS "total",
        SUM("monto") FILTER (WHERE ${sqlPendiente('descuento')}) AS "pendiente",
        COUNT(*) FILTER (WHERE ${sqlPendiente('descuento')})     AS "partidas"
      FROM "descuento_maquilero"
      WHERE "id_empresa" = ${idEmpresa} ${factura}
      GROUP BY "id_maquilero"
    ) d ON d."id_maquilero" = p."id"
    WHERE p."activo" = TRUE
      AND EXISTS (
        SELECT 1 FROM "proveedor_rol" prr
        JOIN "roles_proveedor" rp ON rp."id" = prr."id_rol_proveedor"
        WHERE prr."id_proveedor" = p."id" AND rp."codigo" IN (${Prisma.join([...ROLES_MAQUILA_ESMA])})
      )
    ORDER BY p."nombre" ASC
  `);

  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');
  const oculto = (valor: number): number | null => (puedeVerImportes ? valor : null);

  // El saldo y el neto pendiente se ARMAN con las mismas funciones que la implementación de Prisma
  // (mismo redondeo por subtotal y mismos signos) → los dos caminos dan idénticos, sin cero-drift.
  const calculadas = filasCrudas.map((f) => {
    const totales = {
      totalCargos: redondear2(f.totalCargos.toNumber()),
      totalAbonos: redondear2(f.totalAbonos.toNumber()),
      totalPagos: redondear2(f.totalPagos.toNumber()),
      totalDescuentos: redondear2(f.totalDescuentos.toNumber()),
    };
    return {
      idMaquilero: f.idMaquilero,
      maquilero: f.maquilero,
      nombreCorto: f.nombreCorto,
      ...totales,
      saldo: saldoDeTotales(totales),
      pendiente: armarPendiente(
        f.pendienteAbonos.toNumber(),
        f.pendientePagos.toNumber(),
        f.pendienteDescuentos.toNumber(),
        f.pendientePartidas,
      ),
    };
  });

  // Corte de la lista: saldo ≠ 0 **o** algo pendiente de revisión. Filtrar en JS (y no en el SQL)
  // evita escribir la fórmula una CUARTA vez; el universo son los maquileros activos, no una tabla.
  // Las DOS mitades del corte salen de la definición única: `tieneSaldo` (el mismo medio centavo de
  // tolerancia que usan el lote de CxP y la bandeja) y `hayPendiente` (por CONTEO, no por el neto: un
  // abono y un pago capturados del mismo importe netean 0 y volverían a esconder al maquilero).
  const visibles = calculadas.filter((f) => tieneSaldo(f.saldo) || hayPendiente(f.pendiente));

  const filas = visibles.map((f) => ({
    idMaquilero: f.idMaquilero,
    maquilero: f.maquilero,
    nombreCorto: f.nombreCorto,
    totalCargos: oculto(f.totalCargos),
    totalAbonos: oculto(f.totalAbonos),
    totalPagos: oculto(f.totalPagos),
    totalDescuentos: oculto(f.totalDescuentos),
    saldo: oculto(f.saldo),
    // El CONTEO no se oculta (no es un importe): la regla vive en `pendienteParaSalida`.
    pendienteRevision: pendienteParaSalida(f.pendiente, puedeVerImportes),
  }));

  const totalSaldo = puedeVerImportes
    ? redondear2(visibles.reduce((s, f) => s + f.saldo, 0))
    : null;
  const totalPendienteNeto = puedeVerImportes
    ? netoPendiente({
        abonos: redondear2(visibles.reduce((s, f) => s + f.pendiente.abonos, 0)),
        pagos: redondear2(visibles.reduce((s, f) => s + f.pendiente.pagos, 0)),
        descuentos: redondear2(visibles.reduce((s, f) => s + f.pendiente.descuentos, 0)),
      })
    : null;

  return { conFactura: filtros.conFactura ?? null, filas, totalSaldo, totalPendienteNeto };
}

/** Fila cruda del agregado EsMa por maquilero (subtotales en `numeric` → Decimal, cero-drift). */
interface SaldoEsMaLoteCruda {
  idMaquilero: number;
  totalCargos: Prisma.Decimal;
  totalAbonos: Prisma.Decimal;
  totalPagos: Prisma.Decimal;
  totalDescuentos: Prisma.Decimal;
  pendienteAbonos: Prisma.Decimal;
  pendientePagos: Prisma.Decimal;
  pendienteDescuentos: Prisma.Decimal;
  /** CUÁNTAS partidas esperan revisión (bigint en Postgres → se castea a int en el SELECT). */
  pendientePartidas: number;
}

/** Lo que el lote entrega por maquilero: su saldo (sólo lo revisado) y lo que aún espera revisión. */
export interface AporteEsMaLote {
  saldo: number;
  pendiente: PendienteRevision;
}

/**
 * SALDO EsMa de CADA maquilero con movimientos, en UN solo agregado SQL (NUNCA N+1). Reusa la MISMA
 * fórmula que {@link calcularSaldoMaquilero} —los cuatro criterios salen de `formula-saldo.ts` y el
 * saldo se arma con `saldoDeTotales`, con el MISMO redondeo por subtotal → no-regresión—, pero SIN el
 * filtro de rol/activo del tablero: la CONVIVENCIA de CxP (F9) necesita el aporte EsMa de CUALQUIER
 * proveedor con movimientos, para que la BANDEJA y el ESTADO DE CUENTA cuadren (un inactivo o sin rol
 * de maquila igual arrastra su saldo). Subtotales en `::numeric` (Decimal) → cero-drift vs el detalle.
 * Devuelve un Map idMaquilero→{saldo, pendiente}, SOLO con saldo ≠ 0 **o** algo pendiente de
 * revisión. Vista operativa (toda la cuenta; la segmentación fiscal fina llega con el CFDI en E3/E5).
 * Sin permiso ni ocultamiento: el que llama los aplica.
 *
 * ⭐ El PENDIENTE viaja junto al saldo por decisión de Daniel (§Post-F9.188a): un maquilero con TODO
 * sin revisar tiene saldo 0, y si el lote sólo devolviera saldos ≠ 0 la bandeja de CxP lo haría
 * DESAPARECER — justo cuando alguien tiene que decidir sobre ese dinero. Es el mismo corte que el
 * tablero de EsMa (`saldosDeTodosMaquileros`): saldo ≠ 0 o `hayPendiente` (por CONTEO, no por neto).
 */
export async function saldosEsMaPorMaquilero(
  cliente: Tx | PrismaClient,
  idEmpresa: number,
): Promise<Map<number, AporteEsMaLote>> {
  // Los cuatro criterios salen de la definición única (formula-saldo.ts). Los planos traen las DOS
  // sumas de un tiro (revisado → saldo; capturado → pendiente) y el conteo, con `FILTER`.
  const filas = await cliente.$queryRaw<SaldoEsMaLoteCruda[]>(Prisma.sql`
    SELECT
      p."id" AS "idMaquilero",
      COALESCE(c."total", 0)::numeric      AS "totalCargos",
      COALESCE(a."total", 0)::numeric      AS "totalAbonos",
      COALESCE(pg."total", 0)::numeric     AS "totalPagos",
      COALESCE(d."total", 0)::numeric      AS "totalDescuentos",
      COALESCE(a."pendiente", 0)::numeric  AS "pendienteAbonos",
      COALESCE(pg."pendiente", 0)::numeric AS "pendientePagos",
      COALESCE(d."pendiente", 0)::numeric  AS "pendienteDescuentos",
      (COALESCE(a."partidas", 0) + COALESCE(pg."partidas", 0)
        + COALESCE(d."partidas", 0))::int  AS "pendientePartidas"
    FROM "proveedores" p
    LEFT JOIN (
      SELECT "id_maquilero", SUM("cantidad_real" * "precio_real") AS "total"
      FROM "esma_cargo"
      WHERE "id_empresa" = ${idEmpresa} AND ${sqlCuenta('cargo')}
      GROUP BY "id_maquilero"
    ) c ON c."id_maquilero" = p."id"
    LEFT JOIN (
      SELECT "id_maquilero",
        SUM("monto") FILTER (WHERE ${sqlCuenta('abono')})    AS "total",
        SUM("monto") FILTER (WHERE ${sqlPendiente('abono')}) AS "pendiente",
        COUNT(*) FILTER (WHERE ${sqlPendiente('abono')})     AS "partidas"
      FROM "abono_maquilero"
      WHERE "id_empresa" = ${idEmpresa}
      GROUP BY "id_maquilero"
    ) a ON a."id_maquilero" = p."id"
    LEFT JOIN (
      SELECT "id_maquilero",
        SUM("monto") FILTER (WHERE ${sqlCuenta('pago')})    AS "total",
        SUM("monto") FILTER (WHERE ${sqlPendiente('pago')}) AS "pendiente",
        COUNT(*) FILTER (WHERE ${sqlPendiente('pago')})     AS "partidas"
      FROM "pago_maquilero"
      WHERE "id_empresa" = ${idEmpresa}
      GROUP BY "id_maquilero"
    ) pg ON pg."id_maquilero" = p."id"
    LEFT JOIN (
      SELECT "id_maquilero",
        SUM("monto") FILTER (WHERE ${sqlCuenta('descuento')})    AS "total",
        SUM("monto") FILTER (WHERE ${sqlPendiente('descuento')}) AS "pendiente",
        COUNT(*) FILTER (WHERE ${sqlPendiente('descuento')})     AS "partidas"
      FROM "descuento_maquilero"
      WHERE "id_empresa" = ${idEmpresa}
      GROUP BY "id_maquilero"
    ) d ON d."id_maquilero" = p."id"
    WHERE c."id_maquilero" IS NOT NULL OR a."id_maquilero" IS NOT NULL
       OR pg."id_maquilero" IS NOT NULL OR d."id_maquilero" IS NOT NULL
  `);

  const mapa = new Map<number, AporteEsMaLote>();
  for (const f of filas) {
    // Mismo redondeo por subtotal que calcularSaldoMaquilero (cada total redondea a 2, luego el saldo).
    const saldo = saldoDeTotales({
      totalCargos: redondear2(f.totalCargos.toNumber()),
      totalAbonos: redondear2(f.totalAbonos.toNumber()),
      totalPagos: redondear2(f.totalPagos.toNumber()),
      totalDescuentos: redondear2(f.totalDescuentos.toNumber()),
    });
    const pendiente = armarPendiente(
      f.pendienteAbonos.toNumber(),
      f.pendientePagos.toNumber(),
      f.pendienteDescuentos.toNumber(),
      f.pendientePartidas,
    );
    // Mismo corte que el tablero (§Post-F9.188a), con las MISMAS funciones: saldo ≠ 0 **o** algo
    // esperando revisión.
    if (tieneSaldo(saldo) || hayPendiente(pendiente)) {
      mapa.set(f.idMaquilero, { saldo, pendiente });
    }
  }
  return mapa;
}
