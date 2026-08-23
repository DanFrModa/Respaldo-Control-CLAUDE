/**
 * VENTAS — la vista COMERCIAL de la facturación por modelo (proto `vVentas`; F7-E2; doc
 * `06-Costos-y-EDR.md` §4; D2 #5). No es un módulo nuevo: reusa la misma fuente que el EDR (`EdrLinea`
 * × `Edr`), presentada como lista operativa por período. Toda la lógica vive AQUÍ (A1); la ruta solo
 * valida permiso + Zod y delega. Se protege con `edr.ver` (es data del EDR; sin permisos nuevos).
 *
 * Ventas = Σ(cantVendida × precioVenta FACTURADO) (D2 #5); las unidades = Σ cantVendida; el mes sale
 * del encabezado `Edr`. v2 NO tiene folio de factura en el EDR → la columna identificadora del proto
 * ("Factura") se sustituye por el FOLIO DE LA OP (o null en líneas manuales sin orden).
 *
 * La agregación (resumen del período) y la paginación se hacen EN EL SERVIDOR con SQL crudo
 * (`$queryRaw`, sin vista de BD → SIN migración; mismo patrón que el concentrado de la RC): NUNCA se
 * pivotea ni se suma en el cliente. El `importe` = cantidad × precio es un PRODUCTO que Prisma no puede
 * agregar con `aggregate`, por eso el resumen se calcula en SQL.
 */
import {
  esquemaVentasQuery,
  type VentaLinea,
  type VentasResumen,
  type VentasSalida,
} from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { armarPagina, rangoPrisma, type Paginacion } from '../../comun/paginacion.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { redondear2 } from '../costos/decimales.js';

/** Filtros ya validados. */
type FiltrosVentas = z.output<typeof esquemaVentasQuery>;

/**
 * Condiciones `WHERE` comunes a la página y al resumen (sobre `edr_linea el` + `edr e`, con los
 * catálogos LEFT-joined). Año obligatorio; mes opcional; búsqueda por cliente / código de modelo /
 * folio de la OP (los NULL de las tablas LEFT-joined no casan con ILIKE, comportamiento deseado).
 */
function condicionesVenta(filtros: FiltrosVentas): Prisma.Sql {
  const cond: Prisma.Sql[] = [Prisma.sql`e."anio" = ${filtros.anio}`];
  if (filtros.mes !== undefined) {
    cond.push(Prisma.sql`e."mes" = ${filtros.mes}`);
  }
  if (filtros.busqueda !== undefined && filtros.busqueda !== '') {
    const patron = `%${filtros.busqueda}%`;
    cond.push(
      Prisma.sql`(c."nombre" ILIKE ${patron} OR m."codigo" ILIKE ${patron} OR o."folio"::text ILIKE ${patron})`,
    );
  }
  return Prisma.join(cond, ' AND ');
}

/**
 * FROM + JOINs comunes: las líneas del EDR con su encabezado (año/mes) y sus catálogos legibles.
 * cliente/modelo/orden son FKs NULLABLE → LEFT JOIN (una línea manual sin orden sigue apareciendo).
 */
function desdeVentas(where: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    FROM "edr_linea" el
    JOIN "edr" e         ON e."id"  = el."id_edr"
    LEFT JOIN "clientes" c ON c."id" = el."id_cliente"
    LEFT JOIN "modelos"  m ON m."id" = el."id_modelo"
    LEFT JOIN "ordenes"  o ON o."id" = el."id_orden"
    WHERE ${where}
  `;
}

/** Un renglón crudo de la página (folio llega como bigint; precio/importe casteados a float8). */
interface FilaCruda {
  id: number;
  idOrden: number | null;
  folio: bigint | null;
  idCliente: number | null;
  cliente: string | null;
  idModelo: number | null;
  modelo: string | null;
  descripcion: string | null;
  cantidad: number;
  precio: number;
  importe: number;
  anio: number;
  mes: number;
}

/** Proyecta un renglón crudo a la línea del contrato. */
function aVentaLinea(f: FilaCruda): VentaLinea {
  return {
    id: f.id,
    idOrden: f.idOrden,
    folioOrden: f.folio === null ? null : Number(f.folio),
    idCliente: f.idCliente,
    cliente: f.cliente,
    idModelo: f.idModelo,
    modelo: f.modelo,
    descripcion: f.descripcion,
    cantidad: f.cantidad,
    precio: redondear2(Number(f.precio)),
    importe: redondear2(Number(f.importe)),
    anio: f.anio,
    mes: f.mes,
  };
}

/**
 * VENTAS de un período (A4 `edr.ver`): resumen agregado (sobre TODO el filtro) + la página de líneas.
 * `mes` omitido = todo el año. Orden determinista: período reciente primero, luego folio de OP (las
 * líneas manuales sin folio al final) y por id. El resumen se calcula en SQL (importe = Σ cant×precio).
 */
export async function listarVentas(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaVentasQuery> = { anio: new Date().getFullYear() },
  bd?: ContextoBd,
): Promise<VentasSalida> {
  verificarPermiso(sesion, 'edr.ver');
  const filtros = validarEntrada(esquemaVentasQuery, parametros);
  const cliente = clienteLectura(bd);

  const where = condicionesVenta(filtros);
  const desde = desdeVentas(where);
  const { skip, take } = rangoPrisma({ pagina: filtros.pagina, porPagina: filtros.porPagina });

  const filasCrudas = await cliente.$queryRaw<FilaCruda[]>(Prisma.sql`
    SELECT
      el."id"                                         AS "id",
      el."id_orden"                                   AS "idOrden",
      o."folio"                                       AS "folio",
      el."id_cliente"                                 AS "idCliente",
      c."nombre"                                      AS "cliente",
      el."id_modelo"                                  AS "idModelo",
      m."codigo"                                      AS "modelo",
      COALESCE(el."descripcion", m."descripcion")     AS "descripcion",
      el."cant_vendida"                               AS "cantidad",
      el."precio_venta"::float8                       AS "precio",
      (el."cant_vendida" * el."precio_venta")::float8 AS "importe",
      e."anio"                                        AS "anio",
      e."mes"                                         AS "mes"
    ${desde}
    ORDER BY e."anio" DESC, e."mes" DESC, o."folio" DESC NULLS LAST, el."id" DESC
    LIMIT ${take} OFFSET ${skip}
  `);

  // Resumen sobre TODO el filtro (no solo la página): una consulta agregada (A1, nunca en el cliente).
  const [agg] = await cliente.$queryRaw<{ importe: number; unidades: bigint; lineas: bigint }[]>(
    Prisma.sql`
      SELECT
        COALESCE(SUM(el."cant_vendida" * el."precio_venta"), 0)::float8 AS "importe",
        COALESCE(SUM(el."cant_vendida"), 0)::bigint                     AS "unidades",
        COUNT(*)                                                        AS "lineas"
      ${desde}
    `,
  );

  const importe = redondear2(Number(agg?.importe ?? 0));
  const unidades = Number(agg?.unidades ?? 0);
  const totalLineas = Number(agg?.lineas ?? 0);
  const resumen: VentasResumen = {
    importe,
    unidades,
    ticketPromedio: unidades > 0 ? redondear2(importe / unidades) : 0,
    lineas: totalLineas,
  };

  const paginacion: Paginacion = { pagina: filtros.pagina, porPagina: filtros.porPagina };
  const pagina = armarPagina(filasCrudas.map(aVentaLinea), totalLineas, paginacion);

  return {
    anio: filtros.anio,
    mes: filtros.mes ?? null,
    resumen,
    lineas: pagina.datos,
    total: pagina.total,
    pagina: pagina.pagina,
    porPagina: pagina.porPagina,
    totalPaginas: pagina.totalPaginas,
  };
}
