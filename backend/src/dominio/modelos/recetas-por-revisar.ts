/**
 * ⭐⭐ BANDEJA «RECETAS POR REVISAR» — V1-E8r (§Post-F9.140, decisión de DANIEL, 29-ago-2026).
 *
 * Palabras suyas: *"Creo que despues de una negociacion, tiene que haber una validadcion de la
 * receta original. O sea, de alguna manera deberia de pasar un filtro para ver lo que se negocio
 * con el cliente. y como se cerro. Hay muchos modelos que si se aceptan tal cual como esta la
 * receta, pero otros que habra que cambiar en vivo (a estimado) y despues buscar proveedor y
 * cambiar la receta para produccion"*.
 *
 * 🔴 **EL PROBLEMA QUE RESUELVE — y lo que NO se vuelve a construir.** La compuerta que Daniel pidió
 * en §Post-F9.110 **ya existe** desde V1-E7d: `exigirRevisionAprobadaParaProducir`
 * (`revision-modelo.ts`) le niega producción a toda versión sin firma, y lo hace dentro de
 * `promoverAProduccionNucleo`, así que cubre también la puerta lateral de generar la OP. Lo que
 * **no existía** es la COLA: ninguna consulta listaba lo que espera revisión, así que **la
 * compuerta era un muro al final del camino, no un filtro** — te topabas con ella cuando ya
 * querías producir. Esto es la cola. La firma sigue donde estaba.
 *
 * 🔴 **LA BANDEJA NO FIRMA: LLEVA.** Regla que Daniel fijó sobre la bandeja hermana «Recetas por
 * liberar» al quitarle su botón de aprobar en bloque: *"siempre se debe liberar uno por uno… no
 * tiene sentido liberar las cosas sin ver"* (§Post-F9.80). Cuadrar lo que se negoció es, por
 * definición, algo que hay que ver uno por uno. Esta consulta es de **SOLO LECTURA**: dice qué
 * versiones esperan revisión y lleva a la ficha del modelo, donde se firma viéndola.
 *
 * ── QUÉ CAE AQUÍ, y por qué exactamente eso ────────────────────────────────────────────────────
 *
 *  1. ⭐ **Lo que la COMPUERTA bloquea — preguntado con SU MISMA función**, no con un predicado
 *     parecido: {@link revisionBloqueaProduccion} y su gemela en SQL
 *     {@link SQL_REVISION_BLOQUEA_PRODUCCION}, ambas en `revision-modelo.ts` y probadas juntas
 *     sobre las 16 combinaciones. Escribir aquí `revision_estado = 'pendiente'` —lo obvio— habría
 *     dejado fuera dos poblaciones que el muro SÍ frena: las versiones con la columna en **NULL**
 *     (las que ya existían al desplegarse V1-E7d; su migración dice *"para ellas NULL se lee como
 *     `pendiente`"*) y las **rechazadas**, que tampoco pueden producirse. Bloqueadas e invisibles
 *     es justo el estado que esta etapa viene a matar.
 *  2. ⭐ **Sólo VERSIONES**, que es lo que nació de una negociación (`idModeloPadre` o
 *     `versionDesarrollo`). Va dentro del predicado de arriba, y por eso los **~4,987 modelos
 *     migrados del Access** —`revisionEstado` en NULL a propósito, *"no cambian de conducta"*— no
 *     se cuelan: no son versiones de nadie. Es lo que mantiene la bandeja CORTA, que es lo que
 *     Daniel pidió al decir *"hay muchos modelos que si se aceptan tal cual"*: los que se aceptan
 *     tal cual nunca generaron una versión, así que aquí no aparecen.
 *  3. **Sólo las de `origen = 'desarrollo'`.** Medido: `promoverAProduccionNucleo` rechaza un
 *     modelo ya de producción ANTES de llamar a la compuerta, y `salidaAProduccion` sólo promueve
 *     si `origen === 'desarrollo'` — o sea, a una versión ya promovida el muro no la frena y no hay
 *     nada que desatorar. (Y firmarla es imposible: `exigirVersionRevisable` la rechaza por estar
 *     en producción.) Listarla sería un renglón sobre el que nadie puede hacer nada.
 *  4. **NO se filtra por `activo`**, a propósito: `promoverAProduccionNucleo` no mira esa bandera,
 *     así que una versión dada de baja sigue pudiendo intentar producirse y toparse con el muro.
 *     Esconderla aquí volvería a fabricar el "bloqueada e invisible".
 *
 * ── CÓMO SE RECORRE — las tres decisiones que Daniel fijó en la bandeja hermana, adaptadas ──────
 *
 *  1. **Una fila por VERSIÓN**, que es lo que una persona resuelve de una sentada (allá era una
 *     ORDEN). Se revisa la receta de un modelo completa: telas, avíos y arte de ESE modelo.
 *  2. **Ordenada por lo que ESTORBA PRIMERO.** Allá era la fecha de entrega de la orden; aquí se
 *     midió que **una versión frenada NO puede tener OP** —generarla exige promover, y el muro lo
 *     impide—, así que "el modelo con OP ya generada" no sirve como criterio: casi siempre sería
 *     falso. Lo que sí existe y sí urge es el **PEDIDO** que ya está detrás: el cliente ya lo
 *     ordenó y la OP no puede nacer. Por eso el orden es la **fecha comprometida más próxima de los
 *     pedidos vivos** que dependen de esta versión (las sin fecha, al final, como allá), luego las
 *     que tienen pedido, luego la MÁS VIEJA (la que lleva más tiempo detenida en silencio).
 *  3. **La marca de «ya está frenando dinero»** (`conPedido`, con sus `piezasPedidas`): allá era
 *     `conOrdenCompra`. Aquí es que ya hay un pedido vivo del cliente esperando esta receta — no es
 *     lo mismo que una versión recién negociada a la que todavía nadie le pide nada.
 *
 * ⚠️ **La agregación es del SERVIDOR** (misma regla que la bandeja hermana y que el concentrado de
 * F5-E7): la fecha comprometida, las piezas y la marca salen de UNA consulta SQL. Sumarlas en el
 * cliente obligaría a bajarse los pedidos de cada versión y la cifra dependería de la página.
 *
 * ⚠️ **A9 y modelos GLOBALES.** `Modelo` no tiene `idEmpresa` (los catálogos de F1 son globales,
 * ADR-0007), así que la población NO se filtra por empresa — igual que el catálogo de modelos. Lo
 * que sí se acota a `idEmpresaActiva` es el **dinero**: los pedidos y el proyecto/cliente de la
 * negociación, que sí son de una empresa.
 *
 * Permisos: `modelos.ver` para verla — el mismo que abre la ficha del modelo, así que el camino
 * nunca es un enlace muerto (mismo criterio que §Post-F9.68 en la bandeja hermana). FIRMAR es otro
 * endpoint (`modelos.aprobar-receta`) y vive en la ficha. **Sin permisos nuevos y sin migración.**
 */
import type {
  FiltrosRecetasPorRevisar,
  RecetaPorRevisar,
  RecetasPorRevisarPagina,
} from '../../contrato/index.js';
import { esquemaRecetasPorRevisarDominio } from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';

import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import {
  estadoRevisionEfectivo,
  SQL_REVISION_BLOQUEA_PRODUCCION,
  type EstadoRevision,
} from './revision-modelo.js';

/** Fila cruda del `$queryRaw` (las sumas vienen como BIGINT de Postgres). */
interface FilaBandeja {
  idModelo: number;
  codigo: string;
  descripcion: string | null;
  codigoPadre: string | null;
  versionDesarrollo: number | null;
  revisionEstado: EstadoRevision | null;
  revisionNota: string | null;
  creadoEn: Date;
  cliente: string | null;
  proyecto: string | null;
  fechaCompromiso: Date | null;
  piezasPedidas: bigint | null;
}

/**
 * EL DINERO QUE YA ESTÁ ESPERANDO esta versión: los renglones de PEDIDO vivos (pedido no cancelado
 * y no marcado «no producir») de la empresa activa que apuntan a este modelo, con su fecha
 * comprometida más próxima y sus piezas.
 *
 * Se resuelve con un `LEFT JOIN LATERAL` agregado —una sola pasada por el índice
 * `pedido_linea(id_modelo)`— y no con un `count` por fila desde el llamador, que sería un N+1
 * contra toda la cartera.
 *
 * La fecha es `COALESCE(fecha_de, fecha_hasta)`: el compromiso es el ARRANQUE de la ventana de
 * entrega, y si ese dato falta se usa el cierre — una versión con fecha comprometida urge más que
 * una sin ninguna, y perderla por un `fecha_de` vacío la mandaría al final de la lista.
 */
function dineroEsperando(idEmpresa: number): Prisma.Sql {
  return Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT MIN(COALESCE(pe."fecha_de", pe."fecha_hasta")) AS "fecha_compromiso",
             SUM(pl."cantidad_pedida")::bigint              AS "piezas"
        FROM "pedido_linea" pl
        JOIN "pedidos" pe ON pe."id" = pl."id_pedido"
       WHERE pl."id_modelo" = m."id"
         AND pe."id_empresa" = ${idEmpresa}
         AND pe."ped_cancelado" = false
         AND pe."no_producir" = false
    ) esp ON true
  `;
}

/**
 * DE QUÉ NEGOCIACIÓN salió la versión: su expediente de Desarrollo vivo dentro de un proyecto de la
 * empresa activa, para poder decir con QUÉ CLIENTE se negoció — que es literalmente lo que Daniel
 * pide ver (*"lo que se negocio con el cliente. y como se cerro"*).
 *
 * Es un `LEFT JOIN` porque **puede no haberlo**: `crearVersionDeModelo` no exige ni crea un
 * `Desarrollo`, así que una versión creada a mano desde la ficha del modelo no tiene expediente.
 * Con un `JOIN` normal, esas versiones —bloqueadas igual— desaparecerían de la bandeja.
 */
function negociacionDeLaVersion(idEmpresa: number): Prisma.Sql {
  return Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT c."nombre" AS "cliente", p."nombre" AS "proyecto"
        FROM "desarrollos" d
        JOIN "proyectos" p ON p."id" = d."id_proyecto"
        JOIN "clientes"  c ON c."id" = p."id_cliente"
       WHERE d."id_modelo" = m."id"
         AND d."apagado" = false
         AND p."id_empresa" = ${idEmpresa}
       ORDER BY d."id" DESC
       LIMIT 1
    ) neg ON true
  `;
}

/**
 * BANDEJA «Recetas por revisar» (`modelos.ver`). Una fila por VERSIÓN a la que la revisión le está
 * negando producción, ordenada por lo que estorba primero.
 */
export async function consultarRecetasPorRevisar(
  sesion: SesionUsuario,
  filtros: FiltrosRecetasPorRevisar = {},
  bd?: ContextoBd,
): Promise<RecetasPorRevisarPagina> {
  verificarPermiso(sesion, 'modelos.ver');
  const f = validarEntrada(esquemaRecetasPorRevisarDominio, filtros);
  const cliente = clienteLectura(bd);
  const idEmpresa = sesion.idEmpresaActiva;

  const busqueda = f.busqueda ?? '';
  const condBusqueda =
    busqueda === ''
      ? Prisma.empty
      : Prisma.sql`AND (
            m."codigo" ILIKE ${`%${busqueda}%`}
         OR padre."codigo" ILIKE ${`%${busqueda}%`}
         OR neg."cliente" ILIKE ${`%${busqueda}%`}
        )`;
  const condSoloConPedido = f.soloConPedido
    ? Prisma.sql`AND esp."piezas" IS NOT NULL`
    : Prisma.empty;

  const desde = Prisma.sql`
    FROM "modelos" m
    LEFT JOIN "modelos" padre ON padre."id" = m."id_modelo_padre"
    ${negociacionDeLaVersion(idEmpresa)}
    ${dineroEsperando(idEmpresa)}
   WHERE m."origen"::text = 'desarrollo'
     AND ${SQL_REVISION_BLOQUEA_PRODUCCION}
     ${condBusqueda}
     ${condSoloConPedido}
  `;

  const [conteo, filas] = await Promise.all([
    cliente.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT COUNT(*)::bigint AS "total" ${desde}`),
    cliente.$queryRaw<FilaBandeja[]>(Prisma.sql`
      SELECT m."id"                 AS "idModelo",
             m."codigo"             AS "codigo",
             m."descripcion"        AS "descripcion",
             padre."codigo"         AS "codigoPadre",
             m."version_desarrollo" AS "versionDesarrollo",
             m."revision_estado"    AS "revisionEstado",
             m."revision_nota"      AS "revisionNota",
             m."creado_en"          AS "creadoEn",
             neg."cliente"          AS "cliente",
             neg."proyecto"         AS "proyecto",
             esp."fecha_compromiso" AS "fechaCompromiso",
             esp."piezas"           AS "piezasPedidas"
      ${desde}
      ORDER BY esp."fecha_compromiso" ASC NULLS LAST,
               (esp."piezas" IS NOT NULL) DESC,
               m."creado_en" ASC,
               m."id" ASC
      LIMIT ${f.porPagina} OFFSET ${(f.pagina - 1) * f.porPagina}
    `),
  ]);

  const total = Number(conteo[0]?.total ?? 0n);
  const datos: RecetaPorRevisar[] = filas.map((r) => ({
    idModelo: r.idModelo,
    codigo: r.codigo,
    descripcion: r.descripcion,
    codigoPadre: r.codigoPadre,
    versionDesarrollo: r.versionDesarrollo,
    // El `null` se pliega a `pendiente` AQUÍ, con la misma función que la compuerta: la pantalla
    // recibe la palabra ya resuelta y no puede inventarse otra lectura del mismo hecho.
    estado: estadoRevisionEfectivo(r.revisionEstado),
    revisionNota: r.revisionNota,
    creadoEn: r.creadoEn.toISOString(),
    cliente: r.cliente,
    proyecto: r.proyecto,
    fechaCompromiso:
      r.fechaCompromiso === null ? null : r.fechaCompromiso.toISOString().slice(0, 10),
    piezasPedidas: r.piezasPedidas === null ? 0 : Number(r.piezasPedidas),
    conPedido: r.piezasPedidas !== null,
  }));

  return {
    datos,
    total,
    pagina: f.pagina,
    porPagina: f.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / f.porPagina)),
  };
}
