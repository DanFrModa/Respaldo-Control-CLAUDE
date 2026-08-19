/**
 * BANDEJA «RECETAS POR LIBERAR» — V1-E3h (§Post-F9.72). DANIEL la aprobó el 19-ago-2026: *"está
 * buenísima"*.
 *
 * EL PROBLEMA QUE RESUELVE. Con la firma por renglón, Desarrollo puede dejar medio autorizada una
 * receta sin darse cuenta. Y para saber qué le falta firmar tendría que abrir **orden por orden**:
 * nadie hace eso. El resultado real —el que le pasó a Daniel con los avíos— es que **solo se libera
 * lo que alguien viene a reclamar**, y lo que nadie reclama se detiene solo, en silencio, hasta que
 * es tarde.
 *
 * CÓMO SE RECORRE, y las tres decisiones que lo definen:
 *
 *  1. **Una fila por ORDEN, no por material.** Así trabaja Daniel: abre una orden y la resuelve
 *     entera. Una lista por material tendría cinco renglones de la misma orden y obligaría a
 *     recomponer mentalmente el trabajo.
 *  2. **Ordenada por FECHA DE ENTREGA**, no por folio: lo que estorba primero, arriba. Las órdenes
 *     sin fecha van al final (no se puede afirmar que urgen).
 *  3. **La marca de "ya está frenando dinero"** (`conOrdenCompra`): la orden YA tiene OC no
 *     cancelada por OTRA parte de su receta, así que alguien ya compró y está esperando el resto.
 *     No es lo mismo que una orden recién nacida a la que nadie le pide nada todavía.
 *
 * ⚠️ **La agregación es del SERVIDOR** (misma regla que el concentrado de F5-E7 y el resumen de
 * pendientes de la RC): los conteos por tipo y el `conOrdenCompra` salen de UNA consulta SQL, jamás
 * de sumar en el cliente. Sumar en el cliente obligaría a bajar la receta entera de cada orden
 * pendiente, y la cifra dependería de la página que se esté viendo.
 *
 * Permisos: `desarrollo.ver` para verla; liberar desde ahí pasa por `liberarReceta` (que exige
 * `desarrollo.administrar`) — la bandeja NO libera nada por su cuenta. A9: solo la empresa activa.
 */
import type {
  FiltrosRecetasPorLiberar,
  RecetaPorLiberar,
  RecetasPorLiberarPagina,
} from '../../contrato/index.js';
import { esquemaRecetasPorLiberarDominio } from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';

import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Fila cruda del `$queryRaw` (los conteos vienen como BIGINT de Postgres). */
interface FilaBandeja {
  idOrden: number;
  folio: bigint;
  idModelo: number;
  modelo: string;
  cliente: string;
  fechaEntrega: Date | null;
  telas: bigint;
  avios: bigint;
  artes: bigint;
  conOrdenCompra: boolean;
}

/**
 * Los renglones VIVOS SIN FIRMAR de cada orden, contados por tipo, en UNA sola pasada.
 *
 * `UNION ALL` de las tres tablas y `GROUP BY id_orden`: cada tabla ataca por su índice
 * `(liberado_en)` filtrando `IS NULL`. Se hace así y no con tres `count` por orden porque eso sería
 * un N+1 contra toda la cartera de órdenes vivas.
 *
 * Las LÁPIDAS (`excluido`) quedan fuera: esta orden ya decidió que no las lleva, así que no le
 * faltan a nadie — es la MISMA definición que usa la puerta de compra (`leerPorLiberar`), y tienen
 * que coincidir o la bandeja mandaría a firmar algo que a nadie le falta.
 */
function pendientesPorOrden(): Prisma.Sql {
  return Prisma.sql`
    SELECT "id_orden",
           SUM(CASE WHEN "tipo" = 'tela' THEN 1 ELSE 0 END) AS "telas",
           SUM(CASE WHEN "tipo" = 'avio' THEN 1 ELSE 0 END) AS "avios",
           SUM(CASE WHEN "tipo" = 'arte' THEN 1 ELSE 0 END) AS "artes"
      FROM (
        SELECT "id_orden", 'tela' AS "tipo" FROM "orden_tela"
         WHERE "liberado_en" IS NULL AND "excluido" = false
        UNION ALL
        SELECT "id_orden", 'avio' AS "tipo" FROM "orden_avio"
         WHERE "liberado_en" IS NULL AND "excluido" = false
        UNION ALL
        SELECT "id_orden", 'arte' AS "tipo" FROM "orden_arte"
         WHERE "liberado_en" IS NULL AND "excluido" = false
      ) AS "pend"
     GROUP BY "id_orden"
  `;
}

/**
 * BANDEJA «Recetas por liberar» (`desarrollo.ver`, A9). Una fila por ORDEN VIVA con al menos un
 * renglón de receta sin firmar, ordenada por FECHA DE ENTREGA (las sin fecha, al final) y luego por
 * folio.
 *
 * Las órdenes CANCELADAS quedan fuera: su receta ya no se compra y firmarla no significa nada.
 */
export async function consultarRecetasPorLiberar(
  sesion: SesionUsuario,
  filtros: FiltrosRecetasPorLiberar = {},
  bd?: ContextoBd,
): Promise<RecetasPorLiberarPagina> {
  verificarPermiso(sesion, 'desarrollo.ver');
  const f = validarEntrada(esquemaRecetasPorLiberarDominio, filtros);
  const cliente = clienteLectura(bd);

  const busqueda = f.busqueda ?? '';
  const condBusqueda =
    busqueda === ''
      ? Prisma.empty
      : Prisma.sql`AND (
            m."codigo" ILIKE ${`%${busqueda}%`}
         OR c."nombre" ILIKE ${`%${busqueda}%`}
         OR CAST(o."folio" AS TEXT) LIKE ${`%${busqueda}%`}
        )`;
  // "Ya está frenando dinero": OC NO cancelada ligada a la orden por cualquier renglón.
  const conOc = Prisma.sql`EXISTS (
      SELECT 1
        FROM "orden_compra_linea" l
        JOIN "ordenes_compra" oc ON oc."id" = l."id_orden_compra"
       WHERE l."id_orden" = o."id"
         AND oc."estatus"::text <> 'cancelada'
    )`;
  const condSoloConOc = f.soloConOrdenCompra ? Prisma.sql`AND ${conOc}` : Prisma.empty;

  const desde = Prisma.sql`
    FROM (${pendientesPorOrden()}) AS "p"
    JOIN "ordenes"  o ON o."id"  = "p"."id_orden"
    JOIN "modelos"  m ON m."id"  = o."id_modelo"
    JOIN "clientes" c ON c."id"  = o."id_cliente"
   WHERE o."id_empresa" = ${sesion.idEmpresaActiva}
     AND o."estado"::text <> 'cancelada'
     ${condBusqueda}
     ${condSoloConOc}
  `;

  const [conteo, filas] = await Promise.all([
    cliente.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT COUNT(*)::bigint AS "total" ${desde}`),
    cliente.$queryRaw<FilaBandeja[]>(Prisma.sql`
      SELECT o."id"            AS "idOrden",
             o."folio"         AS "folio",
             o."id_modelo"     AS "idModelo",
             m."codigo"        AS "modelo",
             c."nombre"        AS "cliente",
             o."fecha_entrega" AS "fechaEntrega",
             "p"."telas"       AS "telas",
             "p"."avios"       AS "avios",
             "p"."artes"       AS "artes",
             ${conOc}          AS "conOrdenCompra"
      ${desde}
      ORDER BY o."fecha_entrega" ASC NULLS LAST, o."folio" ASC
      LIMIT ${f.porPagina} OFFSET ${(f.pagina - 1) * f.porPagina}
    `),
  ]);

  const total = Number(conteo[0]?.total ?? 0n);
  const datos: RecetaPorLiberar[] = filas.map((r) => {
    const telas = Number(r.telas);
    const avios = Number(r.avios);
    const artes = Number(r.artes);
    return {
      idOrden: r.idOrden,
      folio: Number(r.folio),
      idModelo: r.idModelo,
      modelo: r.modelo,
      cliente: r.cliente,
      fechaEntrega: r.fechaEntrega === null ? null : r.fechaEntrega.toISOString().slice(0, 10),
      telas,
      avios,
      artes,
      porLiberar: telas + avios + artes,
      conOrdenCompra: r.conOrdenCompra,
    };
  });

  return {
    datos,
    total,
    pagina: f.pagina,
    porPagina: f.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / f.porPagina)),
  };
}
