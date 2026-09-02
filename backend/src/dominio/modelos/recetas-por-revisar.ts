/**
 * ⭐⭐ BANDEJA «RECETAS POR REVISAR» — V1-E8r (§Post-F9.140, decisión de DANIEL, 29-ago-2026).
 *
 * Palabras suyas: *"Creo que despues de una negociacion, tiene que haber una validadcion de la
 * receta original. O sea, de alguna manera deberia de pasar un filtro para ver lo que se negocio
 * con el cliente. y como se cerro. Hay muchos modelos que si se aceptan tal cual como esta la
 * receta, pero otros que habra que cambiar en vivo (a estimado) y despues buscar proveedor y
 * cambiar la receta para produccion"*.
 *
 * 🔴 **EL PROBLEMA QUE RESUELVE.** V1-E7d había construido la FIRMA (§Post-F9.110) y, con ella, un
 * muro que le negaba producción a la versión sin revisar. Lo que **no existía** era la COLA:
 * ninguna consulta listaba lo que espera revisión, así que el muro estaba al final del camino y no
 * al principio — te topabas con él cuando ya querías producir. Esto es la cola.
 *
 * 🔴🔴 **V1-E9c (§Post-F9.169) — EL MURO YA NO ESTÁ, Y ESTA BANDEJA SE VOLVIÓ LO ÚNICO QUE HAY.**
 * Daniel disolvió la compuerta (*"no detiene ni la producción ni los demás renglones ya
 * firmados"*): lo único que frena el gasto es la firma POR RENGLÓN de la receta de la orden. La
 * revisión del modelo sobrevive como **REGISTRO** —dice que alguien miró lo que se negoció—, y sin
 * muro detrás, **esta lista es la única forma de que ese registro se levante**: si nadie ve lo que
 * falta por revisar, nadie lo revisa. Por eso aquí abajo la regla 3 se invirtió: ya NO se filtra
 * por `origen = 'desarrollo'`.
 *
 * 🔴 **LA BANDEJA NO FIRMA: LLEVA.** Regla que Daniel fijó sobre la bandeja hermana «Recetas por
 * liberar» al quitarle su botón de aprobar en bloque: *"siempre se debe liberar uno por uno… no
 * tiene sentido liberar las cosas sin ver"* (§Post-F9.80). Cuadrar lo que se negoció es, por
 * definición, algo que hay que ver uno por uno. Esta consulta es de **SOLO LECTURA**: dice qué
 * versiones esperan revisión y lleva a la ficha del modelo, donde se firma viéndola.
 *
 * ── QUÉ CAE AQUÍ, y por qué exactamente eso ────────────────────────────────────────────────────
 *
 *  1. ⭐ **Lo que le FALTA la firma — preguntado con la MISMA función que la pinta en la ficha**,
 *     no con un predicado parecido: {@link revisionSinAprobar} y su gemela en SQL
 *     {@link SQL_REVISION_SIN_APROBAR}, ambas en `revision-modelo.ts` y probadas juntas
 *     sobre las 32 combinaciones. Escribir aquí `revision_estado = 'pendiente'` —lo obvio— habría
 *     dejado fuera dos poblaciones que tampoco están firmadas: las versiones con la columna en **NULL**
 *     (las que ya existían al desplegarse V1-E7d; su migración dice *"para ellas NULL se lee como
 *     `pendiente`"*) y las **rechazadas**, que son lo contrario de una firma. Sin firmar e
 *     invisibles es justo el estado que esta etapa vino a matar.
 *  2. ⭐ **Sólo VERSIONES**, que es lo que nació de una negociación (`idModeloPadre` o
 *     `versionDesarrollo`). Va dentro del predicado de arriba, y por eso los **~4,987 modelos
 *     migrados del Access** —`revisionEstado` en NULL a propósito, *"no cambian de conducta"*— no
 *     se cuelan: no son versiones de nadie. Es lo que mantiene la bandeja CORTA, que es lo que
 *     Daniel pidió al decir *"hay muchos modelos que si se aceptan tal cual"*: los que se aceptan
 *     tal cual nunca generaron una versión, así que aquí no aparecen.
 *  3. ⭐⭐ **TAMBIÉN las que YA están en producción** (V1-E9c). Hasta aquí se filtraba
 *     `origen = 'desarrollo'`, y la razón escrita era literalmente *"a una versión ya promovida el
 *     muro no la frena y no hay nada que desatorar; y firmarla es imposible"*. **Las dos mitades de
 *     esa razón se cayeron el mismo día**: al disolverse el muro, generar la OP promueve la versión
 *     con la revisión en `pendiente` (antes no podía llegar ahí), y `exigirVersionRevisable` dejó
 *     de rechazar el modelo de producción justamente para que se pueda firmar. Filtrarlas hoy
 *     dejaría **fuera de la vista precisamente a las que ya están corriendo sin que nadie las
 *     revisara** — que son las que urgen, no las que menos.
 *  4. **NO se filtra por `activo`**, a propósito: `promoverAProduccionNucleo` no mira esa bandera,
 *     así que una versión dada de baja sigue pudiendo producirse. Esconderla aquí volvería a
 *     fabricar el "sin firmar e invisible".
 *
 * ── CÓMO SE RECORRE — las tres decisiones que Daniel fijó en la bandeja hermana, adaptadas ──────
 *
 *  1. **Una fila por VERSIÓN**, que es lo que una persona resuelve de una sentada (allá era una
 *     ORDEN). Se revisa la receta de un modelo completa: telas, avíos y arte de ESE modelo.
 *  2. **Ordenada por lo que ESTORBA PRIMERO: el DINERO que ya está esperando.** Allá era la fecha
 *     de entrega de la orden; aquí es la **fecha comprometida más próxima de los pedidos vivos**
 *     que dependen de esta versión (las sin fecha, al final, como allá), luego las que tienen
 *     pedido, luego la MÁS VIEJA (la que lleva más tiempo esperando en silencio).
 *
 *     ⚠️ **V1-E9c corrigió el porqué, no el criterio.** Se justificaba diciendo que *"una versión
 *     frenada no llega a tener OP"* y que por eso "el modelo con OP ya generada" no servía de
 *     criterio. Sin muro, eso dejó de ser cierto: hoy una versión sin revisar SÍ puede tener OP.
 *     El orden sigue igual porque el pedido es la señal más temprana y más cara —el cliente ya lo
 *     ordenó— y porque la OP no dice nada del gasto: lo que frena el gasto es el renglón sin
 *     liberar, no la orden.
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
 *
 * ── ⭐⭐ V1-E9p (§Post-F9.144(b)) — LA BANDEJA AHORA ENSEÑA **LO PROMETIDO** ─────────────────────
 *
 * Daniel re-encuadró la pregunta: *«los estimados no son datos, son METAS… no es seguro que se
 * consiga»*. La bandeja preguntaba *«¿ya capturaste?»*; la pregunta buena es *«¿se logró lo
 * prometido?»*, y **quien va a contestarla tiene que poder VER la meta**. Por eso cada fila trae
 * `costoPrometido`: el costo con el que se cerró la mesa (`NegociacionEvento.costoEstimado`).
 *
 * ⚠️ **Y de paso se arregló un hueco que estaba a la vista:** el `cliente` lo resolvía un `LATERAL`
 * local que sólo miraba `d.id_modelo = m.id` — el expediente PROPIO de la versión. Pero
 * `crearVersionDeModelo` **no crea expediente**, y la mesa pasa ANTES de que la versión exista
 * (§Post-F9.144(a)), así que por el camino normal ese join daba NULL y la columna «Cliente» salía
 * vacía siempre. Hoy lo resuelve {@link expedienteDeLaNegociacion}, que mira también al PADRE — y
 * saca de ahí **el cliente y la meta juntos**, para que una fila no pueda estar contando dos
 * negociaciones distintas como si fueran una. El porqué completo, medido, está en esa función.
 *
 * 🔴 **Y la meta va TRAS LA REJA DE LOS IMPORTES** (`consultas.ver-importes`), aunque la bandeja la
 * abra `modelos.ver`: son dos preguntas distintas. `modelos.ver` no se resta en ningún escalón del
 * seed, así que sin la reja el costo con el que se vendió llegaría a Ventas, Logística, Asistente y
 * Secretarial — justo a quienes se les quitó ver importes. Se oculta el IMPORTE, no la FILA.
 *
 * ⚠️ **La bandeja sigue sin firmar: LLEVA** (§Post-F9.140 punto 4). Enseñar la meta no la convierte
 * en una segunda autoridad; el desenlace se declara al FIRMAR, en la ficha del modelo.
 */
import type {
  FiltrosRecetasPorRevisar,
  RecetaPorRevisar,
  RecetasPorRevisarPagina,
} from '../../contrato/index.js';
import { esquemaRecetasPorRevisarDominio } from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';

import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import {
  CTE_LINAJE_DE_VERSIONES,
  dineroEsperando,
  expedienteDeLaNegociacion,
} from './meta-negociada.js';
import {
  estadoRevisionEfectivo,
  SQL_REVISION_SIN_APROBAR,
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
  costoPrometido: Prisma.Decimal | null;
}

/**
 * BANDEJA «Recetas por revisar» (`modelos.ver`). Una fila por VERSIÓN cuya revisión no está
 * firmada —esté en desarrollo o ya en producción—, ordenada por lo que estorba primero.
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
  // 🔴🔴 LA META ES DINERO, Y VA TRAS LA REJA DE LOS IMPORTES. Esta bandeja la abre `modelos.ver`,
  // que **no se resta en ningún escalón** de `prisma/seed.ts` ⇒ la ven Ventas, Logística, Asistente
  // y Secretarial — exactamente los roles a los que se les QUITÓ `consultas.ver-importes` por
  // decisión. Publicar aquí el costo con el que se cerró la mesa les enseñaría *«la información que
  // vendí»* por la puerta de al lado. Es la MISMA columna que `desarrollo/negociacion.ts` ya oculta
  // así (`costoEstimado: verImportes ? … : null`) y el mismo dato que `consultarMetaPrometida`
  // protege con este permiso: una sola reja para un solo dato.
  //
  // ⚠️ **Se oculta el IMPORTE, no la FILA.** Quien no ve importes sigue viendo qué falta por
  // revisar, de qué padre salió y qué pedido está esperando: la cola es su trabajo, el precio no.
  const verImportes = tienePermiso(sesion, 'consultas.ver-importes');

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
    ${expedienteDeLaNegociacion(idEmpresa)}
    ${dineroEsperando(idEmpresa)}
   WHERE ${SQL_REVISION_SIN_APROBAR}
     ${condBusqueda}
     ${condSoloConPedido}
  `;

  const [conteo, filas] = await Promise.all([
    cliente.$queryRaw<{ total: bigint }[]>(
      // ⚠️ La CTE del linaje va PEGADA al principio: el `LATERAL` del expediente la consulta.
      Prisma.sql`${CTE_LINAJE_DE_VERSIONES} SELECT COUNT(*)::bigint AS "total" ${desde}`,
    ),
    cliente.$queryRaw<FilaBandeja[]>(Prisma.sql`
      ${CTE_LINAJE_DE_VERSIONES}
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
             esp."piezas"           AS "piezasPedidas",
             neg."costo_prometido"  AS "costoPrometido"
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
    // El `null` se pliega a `pendiente` AQUÍ, con la misma función que la ficha del modelo: la pantalla
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
    // ⭐⭐ V1-E9p — LA META que quien cuadre esta receta tiene que salir a conseguir. Sin verla
    // aquí, la pregunta «¿se logró lo prometido?» que le van a hacer al firmar no se puede
    // contestar. Null = esta versión no viene de una negociación registrada (REGLA 0-B: la fila
    // se comporta como siempre).
    costoPrometido: verImportes && r.costoPrometido !== null ? r.costoPrometido.toNumber() : null,
  }));

  return {
    datos,
    total,
    pagina: f.pagina,
    porPagina: f.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / f.porPagina)),
  };
}
