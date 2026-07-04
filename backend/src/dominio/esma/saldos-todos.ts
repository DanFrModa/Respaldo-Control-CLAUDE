/**
 * SALDOS DE TODOS LOS MAQUILEROS (F6-E5; doc 07-EsMa §1, ex `EsMa_SaldosMaq`): el tablero con el saldo
 * de cada maquilero ACTIVO con saldo ≠ 0, para el drill-down al estado de cuenta. Misma fórmula que
 * {@link saldoDeMaquilero} (`Σcargos validados no sin-costo + Σabonos − Σpagos − Σdescuentos`,
 * segmentable por facturación) pero calculada de una vez con **SQL agregado** (A1/§1 permite SQL para
 * reportes) — NUNCA N+1 llamando el saldo por cada maquilero.
 *
 * Innegociables: A1 (lógica aquí), A4 (`esma.ver-pagos`), A9 (los movimientos se acotan a la empresa
 * activa; el catálogo de proveedores es global — ADR-0007), D3 (el saldo se DERIVA, no se persiste).
 * Los IMPORTES se ocultan (todo en null) si falta `consultas.ver-importes`.
 */
import { esquemaSaldosTodosQuery, type SaldosTodosSalida } from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { ROLES_MAQUILA_ESMA } from './maquileros.js';

/** Redondeo monetario a 2 decimales (evita artefactos de float en las sumas del reporte). */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Fila cruda del `$queryRaw` (todos los importes ya en `float8` → number). */
interface FilaCruda {
  idMaquilero: number;
  maquilero: string;
  corto: string | null;
  totalCargos: number;
  totalAbonos: number;
  totalPagos: number;
  totalDescuentos: number;
  saldo: number;
}

/**
 * Calcula el saldo de todos los maquileros activos con saldo ≠ 0 (SQL agregado; misma fórmula que
 * `saldoDeMaquilero`). `conFactura = 'con' | 'sin'` segmenta ese lado (los movimientos sin definir NO
 * entran en ningún segmento). Permiso `esma.ver-pagos`; oculta importes sin `consultas.ver-importes`.
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

  const filasCrudas = await cliente.$queryRaw<FilaCruda[]>(Prisma.sql`
    SELECT
      p."id"     AS "idMaquilero",
      p."nombre" AS "maquilero",
      p."corto"  AS "corto",
      COALESCE(c."total", 0)::float8 AS "totalCargos",
      COALESCE(a."total", 0)::float8 AS "totalAbonos",
      COALESCE(pg."total", 0)::float8 AS "totalPagos",
      COALESCE(d."total", 0)::float8 AS "totalDescuentos",
      (COALESCE(c."total", 0) + COALESCE(a."total", 0)
        - COALESCE(pg."total", 0) - COALESCE(d."total", 0))::float8 AS "saldo"
    FROM "proveedores" p
    LEFT JOIN (
      SELECT "id_maquilero", SUM("cantidad_real" * "precio_real") AS "total"
      FROM "esma_cargo"
      WHERE "id_empresa" = ${idEmpresa} AND "estado" = 'validado' AND "sin_costo" = FALSE ${factura}
      GROUP BY "id_maquilero"
    ) c ON c."id_maquilero" = p."id"
    LEFT JOIN (
      SELECT "id_maquilero", SUM("monto") AS "total" FROM "abono_maquilero"
      WHERE "id_empresa" = ${idEmpresa} ${factura}
      GROUP BY "id_maquilero"
    ) a ON a."id_maquilero" = p."id"
    LEFT JOIN (
      SELECT "id_maquilero", SUM("monto") AS "total" FROM "pago_maquilero"
      WHERE "id_empresa" = ${idEmpresa} ${factura}
      GROUP BY "id_maquilero"
    ) pg ON pg."id_maquilero" = p."id"
    LEFT JOIN (
      SELECT "id_maquilero", SUM("monto") AS "total" FROM "descuento_maquilero"
      WHERE "id_empresa" = ${idEmpresa} ${factura}
      GROUP BY "id_maquilero"
    ) d ON d."id_maquilero" = p."id"
    WHERE p."activo" = TRUE
      AND EXISTS (
        SELECT 1 FROM "proveedor_rol" prr
        JOIN "roles_proveedor" rp ON rp."id" = prr."id_rol_proveedor"
        WHERE prr."id_proveedor" = p."id" AND rp."codigo" IN (${Prisma.join([...ROLES_MAQUILA_ESMA])})
      )
      AND (COALESCE(c."total", 0) + COALESCE(a."total", 0)
        - COALESCE(pg."total", 0) - COALESCE(d."total", 0)) <> 0
    ORDER BY p."nombre" ASC
  `);

  const puedeVerImportes = tienePermiso(sesion, 'consultas.ver-importes');
  const oculto = (valor: number): number | null => (puedeVerImportes ? redondear2(valor) : null);

  const filas = filasCrudas.map((f) => ({
    idMaquilero: f.idMaquilero,
    maquilero: f.maquilero,
    corto: f.corto,
    totalCargos: oculto(f.totalCargos),
    totalAbonos: oculto(f.totalAbonos),
    totalPagos: oculto(f.totalPagos),
    totalDescuentos: oculto(f.totalDescuentos),
    saldo: oculto(f.saldo),
  }));

  const totalSaldo = puedeVerImportes
    ? redondear2(filasCrudas.reduce((s, f) => s + f.saldo, 0))
    : null;

  return { conFactura: filtros.conFactura ?? null, filas, totalSaldo };
}
