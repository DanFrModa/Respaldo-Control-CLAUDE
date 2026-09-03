/**
 * ⭐⭐ V1-E9p (§Post-F9.144(b)) — **LA PROMESA DE LA MESA, Y SI SE CUMPLIÓ.**
 *
 * Daniel, textual: *«me quitan un cierre y yo le pongo que estimo que la maquila costará 5 pesos
 * menos. Esa es mi estimación en ese momento, pero ya en la oficina **se tiene que buscar una
 * maquila de ese costo** con las nuevas características de la prenda… **Todo eso se intentará hacer
 * así, pero no es seguro que se consiga**»*.
 *
 * 🔴 **EL RE-ENCUADRE, y es contraintuitivo: un estimado NO es un dato pendiente de CAPTURA, es una
 * PROMESA pendiente de CUMPLIMIENTO.** Ya se le dijo el precio al cliente. Tiene **DOS** finales
 * posibles, no uno — y hasta esta etapa sólo cabía uno.
 *
 * 🔴 **El estado prohibido que esto mata**, con las palabras de la decisión: *«Desarrollo cuadra la
 * receta con la maquila que sí consiguió, el renglón se va de la bandeja como "resuelto", y **nadie
 * se entera de que el margen que Daniel vendió ya no existe**»*. Un cuadre que sólo puede terminar
 * en «listo» **convierte un incumplimiento en un silencio**.
 *
 * ── ⚠️ POR QUÉ NO ES `revisionEstado = 'rechazada'` ────────────────────────────────────────────
 *
 * Porque `rechazada` YA SIGNIFICA OTRA COSA: *«devuelta con observaciones: corrige la receta»* — la
 * receta está MAL y el renglón VUELVE a la cola. «No se consiguió» es lo contrario: la receta está
 * BIEN, cuadrada y firmada; lo que falló es el COSTO. Reusarla mandaría a corregir una receta que no
 * tiene nada malo y **taparía el hecho económico con una etiqueta de trámite**, que es justo el
 * silencio que esta etapa vino a romper. Son DOS EJES (ver `Modelo.metaResultado`).
 *
 * ── ⭐ DE DÓNDE SALE LA META: ya estaba guardada, no se captura nada nuevo ─────────────────────
 *
 * `NegociacionEvento.costoEstimado` (V1-E8w, §Post-F9.149) es *«la SUMA de los costos estimados con
 * los que se cerró la mesa»*, guardada *«para que el hilo pueda decir: vendí con un costo de
 * $43.00»*. Cómo se llega de una VERSIÓN hasta ahí está medido y escrito en
 * {@link expedienteDeLaNegociacion} — léelo antes de tocar nada de aquí.
 *
 * ── ⚠️ LO QUE NO CAMBIA ────────────────────────────────────────────────────────────────────────
 *
 * **La bandeja sigue SIN FIRMAR: LLEVA** (§Post-F9.140 punto 4). Que enseñe la meta y el desenlace
 * no la convierte en una segunda autoridad: sigue siendo de solo lectura. Y **avisar no es
 * bloquear** (§Post-F9.64): declarar «no se consiguió» no impide producir, ni comprar, ni firmar —
 * sólo hace que se VEA.
 *
 * **Sin permisos nuevos:** declarar el desenlace va pegado a la firma que ya existe
 * (`modelos.aprobar-receta`); la lista del dueño reusa `modelos.ver` + `consultas.ver-importes`.
 */
import type {
  FiltrosPromesasIncumplidas,
  PromesaIncumplida,
  PromesasIncumplidasPagina,
} from '../../contrato/index.js';
import { esquemaPromesasIncumplidasDominio } from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';

import { ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd, type Tx } from '../../comun/transaccion.js';
import type { PrismaClient } from '../../datos/index.js';
import { validarEntrada } from '../../comun/validacion.js';
import { redondear2 } from '../costos/decimales.js';

/**
 * ⭐⭐ **EL LINAJE COMPLETO DE CADA VERSIÓN** — la CTE que {@link expedienteDeLaNegociacion} necesita
 * para poder subir por la cadena de padres hasta donde vive el expediente.
 *
 * ⚠️ **Va PEGADA al principio de toda consulta que use el `LATERAL`** —hoy son **CINCO**: las dos
 * de la bandeja «Recetas por revisar» (conteo y filas), las dos de «Promesas incumplidas» (resumen y
 * filas) y la de {@link resolverCostoPrometido}—, así:
 * `` Prisma.sql`${CTE_LINAJE_DE_VERSIONES} SELECT … ${desde}` ``.
 *
 * 🔑 **Olvidarla es un error DURO, nunca una respuesta equivocada:** Postgres revienta con
 * *«relation "linaje" does not exist»*, y **no existe ninguna relación real con ese nombre** en el
 * esquema, así que el nombre no puede resolverse por accidente contra otra tabla. Es la única forma
 * aceptable de que este acoplamiento falle.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴🔴 QUÉ PROTEGE ESTA CTE, Y QUIÉN LA PROTEGE A ELLA — léelo antes de tocar una prueba
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * El guardián unitario de `meta-negociada.test.ts` pincha el **TEXTO** de esta SQL: que sea
 * `RECURSIVE`, que arranque en la versión misma, que tenga exactamente dos ramas, que la recursiva
 * trepe por `id_siguiente` y que lleve tope. Eso mata las regresiones de FORMA —volver al padre
 * inmediato, avanzar por el nodo equivocado, saltarse el nivel 0, quitar el tope—, y sólo ésas.
 *
 * 🔴 **La SEMÁNTICA de la recursión —que de verdad suba— la sostiene INTEGRACIÓN, y nada más.**
 * Está medido, no supuesto: cambiar `WHERE l."nivel" < 100` por `… < 100 AND false` deja la
 * subcadena del tope intacta, las dos ramas intactas y la auto-referencia intacta, es **SQL
 * perfectamente válido**, neutra la recursión por completo… y el suite unitario entero pasa en
 * **verde**. Lo que la mata es `meta-negociada.int.test.ts`: la primera prueba del join, la del hijo
 * de en medio, las dos del NIETO y el resto de aserciones que dependen de encontrar el expediente.
 *
 * ⚠️ **Por eso esas pruebas de integración NO son redundantes con las unitarias, y no se retiran
 * "porque ya hay un guardián".** Son las únicas que contestan la pregunta que importa: *¿la cadena
 * llega hasta donde vive el expediente?* Si un día hay que elegir, se conserva la de integración.
 *
 * 🔴 **POR QUÉ VIVE FUERA DEL `LATERAL` y no dentro.** Sería más bonito escribirla dentro, correlada
 * con `m."id"` — pero **PostgreSQL no admite referencias LATERAL dentro de un `WITH`**: las CTE no
 * se correlacionan. Así que se calcula el cierre transitivo **de todas las versiones de una vez**
 * (no correlado) y el `LATERAL` lo consulta por `ln."id_version" = m."id"`. El coste es despreciable
 * porque el término base ya descarta al catálogo entero: los ~4,987 modelos migrados del Access no
 * tienen linaje y **no entran**.
 *
 * ⚠️ **El tope de profundidad (`nivel < 100`) no es paranoia barata:** por construcción no puede
 * haber ciclos —`mintearVersionDeModelo` siempre crea al HIJO nuevo apuntando a un padre que ya
 * existía—, pero un dato tocado a mano sí podría cerrarlos, y un ciclo en un `WITH RECURSIVE` cuelga
 * la consulta para siempre. 100 pasa de sobra: la cadena es tan larga como veces se ha versionado
 * una familia, y el propio minteo se rinde a los 50 sufijos.
 */
export const CTE_LINAJE_DE_VERSIONES: Prisma.Sql = Prisma.sql`
  WITH RECURSIVE "linaje" AS (
    -- Nivel 0: la version misma. El filtro es el MISMO predicado de esVersionDeModelo: fuera los
    -- hijos del linaje 1:N, dentro lo que tiene padre o numero de version. Sin el, la CTE
    -- recorreria el catalogo entero para nada.
    SELECT v."id"              AS "id_version",
           v."id"              AS "id_ancestro",
           v."id_modelo_padre" AS "id_siguiente",
           0                   AS "nivel"
      FROM "modelos" v
     WHERE v."id_modelo_desarrollo" IS NULL
       AND (v."id_modelo_padre" IS NOT NULL OR v."version_desarrollo" IS NOT NULL)
    UNION ALL
    -- …y de ahí para arriba: padre, abuelo, bisabuelo, hasta la RAÍZ.
    SELECT l."id_version", a."id", a."id_modelo_padre", l."nivel" + 1
      FROM "linaje" l
      JOIN "modelos" a ON a."id" = l."id_siguiente"
     WHERE l."nivel" < 100
  )
`;

/**
 * ⭐⭐ **DE QUÉ NEGOCIACIÓN SALIÓ ESTA VERSIÓN** — el expediente de Desarrollo con el que se negoció
 * (cliente y proyecto) y **la META con la que se cerró la mesa**, en UN solo `LATERAL`.
 *
 * ⚠️ Espera la tabla `modelos` **aliaseada como `m`** y la CTE {@link CTE_LINAJE_DE_VERSIONES} al
 * principio de la consulta. Expone `neg."cliente"`, `neg."proyecto"` y `neg."costo_prometido"`.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 🔴 EL JOIN, MEDIDO — y por qué sube por TODA la cadena de padres
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * La única ruta estructural de un `Modelo` a un `NegociacionEvento` es
 * **`Desarrollo` → `ListaPreciosLinea` → `NegociacionEvento`** (`ListaPreciosLinea` cuelga de
 * `idDesarrollo`, y `Desarrollo` es lo único que apunta a un modelo). No hay otra: `idModeloPadre`
 * no lo usa nadie más para llegar a una lista.
 *
 * **Y el eslabón que obliga a mirar HACIA ARRIBA está medido:** `crearVersionDeModelo` /
 * `mintearVersionDeModelo` (`versiones.ts`) **NO crean un `Desarrollo`** — sólo el modelo con su
 * receta copiada. Además, §Post-F9.144(a) fija el orden de los hechos: la mesa (momento 2) pasa
 * **antes** de que la versión exista, y la versión nace en la oficina (momento 3), *«más adelante,
 * por la gente de desarrollo»*. ⇒ **Cuando se guardó la mesa, la versión todavía no existía**, así
 * que el evento cuelga del expediente del modelo que SÍ estaba en la mesa. Anclar sólo en
 * `d.id_modelo = m.id` daría `NULL` siempre por el camino normal.
 *
 * 🔴🔴 **Y NO BASTA CON EL PADRE INMEDIATO: el linaje es una CADENA.** `mintearVersionDeModelo`
 * escribe `idModeloPadre: padre.id` — **el padre inmediato, no la raíz**— y ninguna de sus tres
 * guardas impide versionar una versión (el CÓDIGO es plano, `-01` → `-02`; el vínculo de padres no).
 * Para `CYA-26-71-001-02`, nacida de `-01`, el padre es `-01`, que **tampoco tiene expediente**: el
 * `Desarrollo` está en la **RAÍZ**. Un ancla de un solo nivel devuelve `NULL` ahí.
 *
 * ⚠️ **Y ese `NULL` sería PEOR que el defecto original**, no un empate: la fila SÍ aparece en
 * «Promesas incumplidas» —el desenlace se declaró— pero con la brecha en `—`, el impacto en `—` y
 * aportando **0** al total de la cartera. Daniel leería *«conseguí 45»* contra un guion: sabría que
 * algo se incumplió y **no cuánto**. Silencio parcial, en la pantalla que existe para romper el
 * silencio. Y el disparador no es exótico: es **la segunda vuelta de negociación**.
 *
 * ⇒ Se ancla en el conjunto de **ANCESTROS** ({@link CTE_LINAJE_DE_VERSIONES}), que incluye a la
 * versión misma en el nivel 0.
 *
 * ⚠️ **Y el cliente del ancestro es el correcto, no una aproximación:** el código de la familia
 * lleva dentro la abreviatura del cliente (`CYA-…` = C&A) y toda versión hereda la raíz
 * (`versiones.ts`, regla 2) ⇒ una familia es de UN cliente. Copiar un modelo para otro cliente **no
 * versiona**, mintea un código nuevo (`modelo-en-la-mesa.ts`, punto 2 de su encabezado).
 *
 * 🔴 **LA AMBIGÜEDAD QUE QUEDA, declarada:** un modelo puede tener expediente en VARIOS proyectos, y
 * nada guarda de cuál mesa nació esta versión. Se resuelve con una preferencia **determinista** y
 * escrita, no con un empate:
 *
 *  1. el expediente que **sí tiene mesa** (uno sin mesa no puede contestar la pregunta),
 *  2. el **más cercano en el linaje** (`ln.nivel ASC`): el propio antes que el del padre, y el del
 *     padre antes que el del abuelo — lo más específico gana,
 *  3. el **más reciente** (`d.id DESC`) — el mismo desempate que esta consulta ya usaba.
 *
 * ⚠️ **Sustituye al antiguo `negociacionDeLaVersion` de `recetas-por-revisar.ts`, y le arregla un
 * hueco de paso:** aquél sólo miraba `d.id_modelo = m.id`, así que por el camino normal la bandeja
 * enseñaba **cliente vacío** en todas sus filas. Con el linaje en la ecuación, el cliente aparece. Se
 * unificó en UNA función a propósito: si el cliente saliera de un expediente y la meta de otro, la
 * fila estaría contando **dos negociaciones distintas** como si fueran una.
 *
 * ⚠️ Sigue siendo `LEFT JOIN`: **puede no haber expediente en toda la cadena** (una versión creada a
 * mano desde la ficha, cuya familia no está en ningún proyecto). Con un `JOIN` normal esas versiones
 * —que hay que revisar igual— desaparecerían de la bandeja.
 *
 * ⚠️ **A9:** el modelo es global (ADR-0007) pero el proyecto y el cliente son de una empresa, así
 * que el expediente se acota a `idEmpresaActiva`.
 */
export function expedienteDeLaNegociacion(idEmpresa: number): Prisma.Sql {
  return Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT c."nombre"            AS "cliente",
             p."nombre"            AS "proyecto",
             mesa."costo_estimado" AS "costo_prometido"
        FROM "linaje" ln
        JOIN "desarrollos" d ON d."id_modelo" = ln."id_ancestro"
        JOIN "proyectos" p ON p."id" = d."id_proyecto"
        JOIN "clientes"  c ON c."id" = p."id_cliente"
        -- LA META: el ULTIMO cierre de mesa de este expediente. Va con LEFT porque un expediente
        -- sin renglon en lista (o con renglon pero sin mesa guardada) sigue diciendo con quien se
        -- negocio, y perder el cliente por no haber meta seria cambiar un hueco por otro.
        LEFT JOIN LATERAL (
          SELECT ne."costo_estimado"
            FROM "lista_precios_linea" ll
            JOIN "negociacion_evento" ne ON ne."id_lista_linea" = ll."id"
           WHERE ll."id_desarrollo" = d."id"
             AND ne."costo_estimado" IS NOT NULL
           ORDER BY ne."id" DESC
           LIMIT 1
        ) mesa ON true
       WHERE ln."id_version" = m."id"
         AND d."apagado" = false
         AND p."id_empresa" = ${idEmpresa}
       ORDER BY (mesa."costo_estimado" IS NOT NULL) DESC,
                ln."nivel" ASC,
                d."id" DESC
       LIMIT 1
    ) neg ON true
  `;
}

/**
 * EL DINERO QUE YA ESTÁ ESPERANDO esta versión: los renglones de PEDIDO vivos (pedido no cancelado
 * y no marcado «no producir») de la empresa activa que apuntan a este modelo, con su fecha
 * comprometida más próxima y sus piezas. Expone `esp."fecha_compromiso"` y `esp."piezas"`.
 *
 * Se resuelve con un `LEFT JOIN LATERAL` agregado —una sola pasada por el índice
 * `pedido_linea(id_modelo)`— y no con un `count` por fila desde el llamador, que sería un N+1
 * contra toda la cartera.
 *
 * La fecha es `COALESCE(fecha_de, fecha_hasta)`: el compromiso es el ARRANQUE de la ventana de
 * entrega, y si ese dato falta se usa el cierre — una versión con fecha comprometida urge más que
 * una sin ninguna, y perderla por un `fecha_de` vacío la mandaría al final de la lista.
 *
 * ⚠️ **Vive aquí, junto a {@link expedienteDeLaNegociacion}, desde V1-E9p**: nació en la bandeja
 * «Recetas por revisar» y hoy lo comparten la bandeja y la lista de promesas incumplidas —donde las
 * PIEZAS son lo que convierte *«$2 de más»* en *«$24,000 de margen que ya no existe»*. Copiarlo
 * habría sido dos definiciones del mismo dinero.
 */
export function dineroEsperando(idEmpresa: number): Prisma.Sql {
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
 * ⭐ **LA BRECHA**, y su signo: `conseguido − prometido`.
 *
 * **Positivo = se consiguió PEOR de lo prometido** (la prenda cuesta MÁS que el costo con el que
 * Daniel la vendió ⇒ el margen se encogió). Negativo = se consiguió mejor.
 *
 * `null` cuando falta cualquiera de los dos: sin los dos números **no hay brecha**, y devolver 0
 * —el error fácil— diría *«se cumplió exacto»* justo cuando no se sabe nada. REGLA 0-B: la pregunta
 * es *«¿funciona bien cuando el dato NO está?»*, y aquí funcionar es callarse.
 *
 * PURA a propósito: se prueba sin base de datos y la comparten el dominio y la proyección.
 */
export function brechaDeMeta(
  prometido: number | null | undefined,
  conseguido: number | null | undefined,
): number | null {
  if (prometido === null || prometido === undefined) {
    return null;
  }
  if (conseguido === null || conseguido === undefined) {
    return null;
  }
  return redondear2(conseguido - prometido);
}

/**
 * ⭐ **EL IMPACTO**: la brecha multiplicada por las piezas que el cliente ya pidió. Es lo que
 * traduce *«$2 de más por prenda»* al idioma en el que duele: *«$24,000 de margen que ya no está»*.
 *
 * `null` si no hay brecha (no se puede multiplicar lo que no se sabe). Con brecha y **sin piezas**
 * da `0` y eso es correcto: todavía no hay dinero comprometido detrás — la promesa se incumplió,
 * pero aún no le cuesta a nadie.
 */
export function impactoDeLaBrecha(brecha: number | null, piezas: number): number | null {
  if (brecha === null) {
    return null;
  }
  return redondear2(brecha * piezas);
}

// ══ EL DESENLACE: las cuatro columnas del acto ═════════════════════════════════════════════════

/** Cómo terminó la promesa, tal como lo declara quien salió a buscarla. */
export interface DesenlaceDeLaMeta {
  /** `true` = se consiguió lo prometido (o mejor). `false` = NO se consiguió. */
  lograda: boolean;
  /** Lo que SÍ se consiguió (costo por prenda). Obligatorio cuando NO se logró. */
  costoConseguido?: number | undefined;
  /** Por qué no se consiguió (obligatorio cuando NO se logró) u observación de lo que sí se logró. */
  nota?: string | undefined;
}

/** Las cuatro columnas del desenlace, tal como se escriben en `Modelo`. */
export interface ColumnasDelDesenlace {
  metaResultado: 'lograda' | 'no_lograda' | null;
  metaCostoPrometido: Prisma.Decimal | null;
  metaCostoConseguido: Prisma.Decimal | null;
  metaNota: string | null;
}

/**
 * ⭐⭐ **EL DESENLACE BORRADO** — lo que escriben el RECHAZO y la INVALIDACIÓN automática, y también
 * una aprobación que no contesta la pregunta.
 *
 * 🔴 **Por qué se borra y no se deja, que es la parte que se pasa por alto.** Las columnas del
 * desenlace describen **UN acto**, igual que las cuatro de la revisión (V1-E7d): *«un acto nuevo
 * sustituye al anterior COMPLETO, nunca se limpia un campo suelto dejando una tupla mentirosa»*.
 * Dejar el desenlace vivo bajo un acto nuevo pintaría una **brecha medida sobre una receta que ya
 * cambió** — el dueño leería *«conseguí $45»* de una receta que hoy lleva otra tela. Y en la
 * invalidación es peor: la versión vuelve a `pendiente`, así que la brecha colgaría de algo que
 * **nadie ha revisado**.
 *
 * ⚠️ **No se pierde nada (D3):** las tres puertas llevan el desenlace anterior a la BITÁCORA, que se
 * agrega y jamás se edita. La secuencia completa —«se firmó con brecha de $2 el 12, cambió la tela
 * el 14, se volvió a firmar el 15»— se reconstruye desde ahí, que es exactamente el reparto con el
 * que ya viven `revisionEstado` y sus tres compañeras.
 */
export const DESENLACE_BORRADO: ColumnasDelDesenlace = {
  metaResultado: null,
  metaCostoPrometido: null,
  metaCostoConseguido: null,
  metaNota: null,
};

/**
 * Traduce el desenlace declarado a las cuatro columnas, exigiendo lo que un «no se consiguió» tiene
 * que traer para servirle a alguien.
 *
 * ⚠️ **Las dos exigencias del «NO», y por qué no son burocracia:** sin `costoConseguido` no hay
 * BRECHA que enseñar (*«prometí 5, conseguí…»* y ahí se corta), y sin `nota` el dueño ve un número
 * peor sin saber qué pasó. Es la misma regla que el MOTIVO obligatorio del rechazo, por la misma
 * razón. Un «sí se consiguió» no exige ninguna de las dos: no hay nada que explicar.
 *
 * ⚠️ **Y no bloquea nada** (§Post-F9.64: *avisar no es bloquear*): el desenlace ENTERO es opcional
 * en el contrato — firmar sin contestar la pregunta sigue funcionando exactamente como antes de
 * esta etapa. Lo que se exige es la coherencia de la respuesta que sí se dio.
 *
 * `costoPrometido` es lo que resolvió {@link resolverCostoPrometido}; llega `null` cuando la versión
 * no viene de una mesa registrada, y eso NO impide declarar el desenlace: se guarda lo que sí se
 * sabe (REGLA 0-B).
 */
export function columnasDelDesenlace(
  desenlace: DesenlaceDeLaMeta,
  costoPrometido: number | null,
): ColumnasDelDesenlace {
  const nota = normalizarNota(desenlace.nota);
  const conseguido = desenlace.costoConseguido;

  if (!desenlace.lograda) {
    if (conseguido === undefined || conseguido === null) {
      throw new ErrorValidacion(
        'Para declarar que NO se consiguió lo prometido hay que decir cuánto SÍ se consiguió: sin ' +
          'ese número no hay brecha que enseñarle a quien vendió con el costo anterior.',
      );
    }
    if (nota === null) {
      throw new ErrorValidacion(
        'Escribe por qué no se consiguió lo prometido: un costo peor sin explicación no le dice ' +
          'nada a quien ya le dio ese precio al cliente.',
      );
    }
  }

  return {
    metaResultado: desenlace.lograda ? 'lograda' : 'no_lograda',
    metaCostoPrometido: costoPrometido === null ? null : new Prisma.Decimal(costoPrometido),
    metaCostoConseguido:
      conseguido === undefined || conseguido === null ? null : new Prisma.Decimal(conseguido),
    metaNota: nota,
  };
}

/** Recorta la nota y convierte el vacío en `null` (una nota en blanco no es una nota). */
function normalizarNota(texto: string | undefined): string | null {
  const limpio = texto?.trim() ?? '';
  return limpio === '' ? null : limpio;
}

/**
 * ⭐ **CONGELA LA META**: resuelve, en el momento de la firma, el costo con el que se cerró la mesa
 * de la que salió esta versión. `null` si no se encuentra ninguna (la versión no vino de una
 * negociación registrada) — y eso no es un error, ver {@link columnasDelDesenlace}.
 *
 * ⚠️ **Corre la MISMA SQL que la bandeja** ({@link expedienteDeLaNegociacion}), no una parecida: si
 * la lista enseñara una meta y la firma congelara otra, el desenlace mediría contra un número que la
 * persona nunca vio. Una sola definición, dos llamadores — mismo criterio que las guardas gemelas de
 * `revisionSinAprobar` / `SQL_REVISION_SIN_APROBAR`.
 */
export async function resolverCostoPrometido(
  tx: Tx | PrismaClient,
  idModelo: number,
  idEmpresa: number,
): Promise<number | null> {
  const filas = await tx.$queryRaw<{ costoPrometido: Prisma.Decimal | null }[]>(Prisma.sql`
    ${CTE_LINAJE_DE_VERSIONES}
    SELECT neg."costo_prometido" AS "costoPrometido"
      FROM "modelos" m
      ${expedienteDeLaNegociacion(idEmpresa)}
     WHERE m."id" = ${idModelo}
  `);
  const valor = filas[0]?.costoPrometido;
  return valor === undefined || valor === null ? null : valor.toNumber();
}

/**
 * ⭐ **LA META, PARA PODER CONTESTAR LA PREGUNTA** — lo que la pantalla de la firma pide antes de
 * enseñar *«¿se logró lo prometido?»*.
 *
 * 🔴 **Por qué hace falta una consulta y no basta con la columna guardada.** `Modelo.metaCostoPrometido`
 * sólo existe **después** de que alguien haya declarado un desenlace: en la PRIMERA firma —que es
 * justo cuando se hace la pregunta— viene en `null`. Enseñar la meta desde ahí sería una rama que
 * casi nunca se pinta, y la persona contestaría *«¿se logró?»* **sin ver contra qué**.
 *
 * Corre la MISMA SQL que la bandeja y que la firma ({@link expedienteDeLaNegociacion}), así que los
 * tres enseñan y congelan el mismo número.
 *
 * ⚠️ Permisos: `modelos.aprobar-receta` (quien firma) **y** `consultas.ver-importes` (es un
 * importe). En el reparto de `prisma/seed.ts` los dos los llevan EXACTAMENTE los mismos cuatro
 * perfiles (Administrador, AdministracionDireccion, Directivo y Gerencial), así que todo el que
 * puede firmar puede ver la meta: la pareja no cierra ninguna puerta que estuviera abierta.
 * **Sin permisos nuevos.**
 */
export async function consultarMetaPrometida(
  sesion: SesionUsuario,
  idModelo: number,
  bd?: ContextoBd,
): Promise<{ costoPrometido: number | null }> {
  verificarPermiso(sesion, 'modelos.aprobar-receta');
  verificarPermiso(sesion, 'consultas.ver-importes');
  const cliente = clienteLectura(bd);
  return {
    costoPrometido: await resolverCostoPrometido(cliente, idModelo, sesion.idEmpresaActiva),
  };
}

// ══ LA LISTA DEL DUEÑO: las promesas que no se cumplieron ══════════════════════════════════════

/** Fila cruda del `$queryRaw` (las sumas vienen como BIGINT de Postgres). */
interface FilaPromesa {
  idModelo: number;
  codigo: string;
  descripcion: string | null;
  codigoPadre: string | null;
  versionDesarrollo: number | null;
  cliente: string | null;
  proyecto: string | null;
  costoPrometido: Prisma.Decimal | null;
  costoConseguido: Prisma.Decimal | null;
  metaNota: string | null;
  revisadoEn: Date | null;
  revisadoPor: string | null;
  piezasPedidas: bigint | null;
}

/**
 * ⭐⭐ **LAS PROMESAS QUE NO SE CUMPLIERON** — la lista que Daniel pidió que existiera, porque la
 * brecha *«le importa AL DUEÑO, que ya le dio ese precio al cliente»*, no a quien despacha la cola.
 *
 * Una fila por VERSIÓN cuyo desenlace se declaró `no_lograda`, con la brecha por prenda y el
 * IMPACTO (brecha × piezas ya pedidas), ordenada por **lo que más dinero cuesta primero**.
 *
 * ⚠️ **La agregación es del SERVIDOR** (misma regla que la bandeja y que el concentrado de F5-E7):
 * la brecha, el impacto, las piezas y los totales de la cartera salen de SQL. Sumarlos en el cliente
 * daría un total que depende de la página que estés viendo — y este total es precisamente el número
 * que Daniel mira.
 *
 * ⚠️ **Permisos: NINGUNO NUEVO.** `modelos.ver` (es una lista de modelos) **y**
 * `consultas.ver-importes` — el permiso transversal que ya gobierna ver precios e importes. Los dos,
 * porque esta pantalla **ES** el dinero: sin los importes no queda nada que enseñar, así que
 * ocultarlos columna por columna dejaría una lista vacía de sentido en vez de una puerta honesta.
 *
 * ⚠️ **A9:** los modelos son globales (ADR-0007), pero el expediente/cliente y los pedidos se acotan
 * a `idEmpresaActiva`.
 */
export async function consultarPromesasIncumplidas(
  sesion: SesionUsuario,
  filtros: FiltrosPromesasIncumplidas = {},
  bd?: ContextoBd,
): Promise<PromesasIncumplidasPagina> {
  verificarPermiso(sesion, 'modelos.ver');
  verificarPermiso(sesion, 'consultas.ver-importes');
  const f = validarEntrada(esquemaPromesasIncumplidasDominio, filtros);
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

  const desde = Prisma.sql`
    FROM "modelos" m
    LEFT JOIN "modelos" padre ON padre."id" = m."id_modelo_padre"
    LEFT JOIN "usuarios" u ON u."id" = m."id_revisado_por"
    ${expedienteDeLaNegociacion(idEmpresa)}
    ${dineroEsperando(idEmpresa)}
   WHERE m."meta_resultado" = 'no_lograda'
     ${condBusqueda}
  `;

  // ⚠️ LA BRECHA Y EL IMPACTO SE ORDENAN EN SQL, no en TypeScript: ordenar la página ya recortada
  // pondría arriba lo más caro DE ESA PÁGINA, que es una mentira distinta en cada página.
  const brechaSql = Prisma.sql`(m."meta_costo_conseguido" - m."meta_costo_prometido")`;
  const impactoSql = Prisma.sql`(${brechaSql} * COALESCE(esp."piezas", 0))`;

  const [resumen, filas] = await Promise.all([
    cliente.$queryRaw<{ total: bigint; impactoTotal: Prisma.Decimal | null }[]>(Prisma.sql`
      ${CTE_LINAJE_DE_VERSIONES}
      SELECT COUNT(*)::bigint     AS "total",
             -- El impacto de TODA la cartera, no el de la página: es el número que se mira primero.
             SUM(COALESCE(${impactoSql}, 0)) AS "impactoTotal"
      ${desde}
    `),
    cliente.$queryRaw<FilaPromesa[]>(Prisma.sql`
      ${CTE_LINAJE_DE_VERSIONES}
      SELECT m."id"                    AS "idModelo",
             m."codigo"                AS "codigo",
             m."descripcion"           AS "descripcion",
             padre."codigo"            AS "codigoPadre",
             m."version_desarrollo"    AS "versionDesarrollo",
             neg."cliente"             AS "cliente",
             neg."proyecto"            AS "proyecto",
             m."meta_costo_prometido"  AS "costoPrometido",
             m."meta_costo_conseguido" AS "costoConseguido",
             m."meta_nota"             AS "metaNota",
             m."revisado_en"           AS "revisadoEn",
             u."nombre"                AS "revisadoPor",
             esp."piezas"              AS "piezasPedidas"
      ${desde}
      ORDER BY ${impactoSql} DESC NULLS LAST,
               ${brechaSql} DESC NULLS LAST,
               m."revisado_en" DESC NULLS LAST,
               m."id" ASC
      LIMIT ${f.porPagina} OFFSET ${(f.pagina - 1) * f.porPagina}
    `),
  ]);

  const total = Number(resumen[0]?.total ?? 0n);
  const impactoTotal = redondear2(Number(resumen[0]?.impactoTotal ?? 0));

  const datos: PromesaIncumplida[] = filas.map((r) => {
    const costoPrometido = r.costoPrometido === null ? null : r.costoPrometido.toNumber();
    const costoConseguido = r.costoConseguido === null ? null : r.costoConseguido.toNumber();
    const piezasPedidas = r.piezasPedidas === null ? 0 : Number(r.piezasPedidas);
    const brecha = brechaDeMeta(costoPrometido, costoConseguido);
    return {
      idModelo: r.idModelo,
      codigo: r.codigo,
      descripcion: r.descripcion,
      codigoPadre: r.codigoPadre,
      versionDesarrollo: r.versionDesarrollo,
      cliente: r.cliente,
      proyecto: r.proyecto,
      costoPrometido,
      costoConseguido,
      brecha,
      piezasPedidas,
      impacto: impactoDeLaBrecha(brecha, piezasPedidas),
      nota: r.metaNota,
      revisadoPor: r.revisadoPor,
      revisadoEn: r.revisadoEn === null ? null : r.revisadoEn.toISOString(),
    };
  });

  return {
    datos,
    total,
    impactoTotal,
    pagina: f.pagina,
    porPagina: f.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / f.porPagina)),
  };
}
