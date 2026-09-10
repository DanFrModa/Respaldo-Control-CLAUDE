import { z } from 'zod';

import { esquemaTipoRenglonReceta } from './renglon-receta.js';

/**
 * ⭐⭐ **EL AVISO DE LA OP QUE SE DESVÍA DEL GRUPO** — contrato de la comparación HORIZONTAL
 * (una OP contra SUS HERMANAS).
 *
 * DANIEL (§Post-F9.146, pregunta 4): *«Normalmente todas las OP deben de ir iguales. Puede pasar que
 * una OP del grupo se le cambie algún avío (por ejemplo, no hubo cierre de ese tono y se compró otro
 * tipo de cierre sólo para la café)… **se debe de poder hacer, pero advirtiendo de la diferencia**»*.
 *
 * 🔴 **NO ES LA DESALINEACIÓN** (`esquemaDesalineacionReceta`, en `receta-orden.ts`), y confundirlas
 * es el error más fácil de cometer aquí:
 *
 * | | Compara | Eje |
 * |---|---|---|
 * | `DesalineacionReceta` | la copia congelada de la orden **contra la receta del MODELO** | VERTICAL (padre ↔ hijo, a lo largo del tiempo) |
 * | `FrenteAlGrupo` (esto) | la copia congelada de la orden **contra la de sus OP HERMANAS** | HORIZONTAL (hermana ↔ hermana, en el mismo momento) |
 *
 * Dos OP hermanas pueden estar **las dos perfectamente alineadas con la receta del padre** y aun así
 * diferir entre ellas (una le agregó un avío a mano, la otra no) — y al revés: las dos pueden estar
 * desalineadas del modelo **de la misma forma** y por tanto ir iguales entre ellas. Son preguntas
 * distintas y ninguna implica la otra.
 *
 * 🔴 **AVISA; NUNCA BLOQUEA.** La diferencia es LEGÍTIMA — Daniel la describe como algo que pasa y
 * está bien. Nada de este contrato entra en una guarda: no impide guardar, no exige justificar y no
 * cambia lo que se puede comprar. Es exactamente el mismo criterio de `avisoCurva`
 * (`catalogos/curvas-de-la-orden.ts`) y de §Post-F9.64: *«que me diga»*, no *«que no me deje»*.
 *
 * 🔴 **El texto lo REDACTA EL SERVIDOR (A1).** La pantalla lo pinta tal cual: no arma la frase, no
 * resuelve el singular/plural, no decide el orden ni recompone qué difiere. Dos pantallas que
 * redactaran el mismo aviso por su cuenta acabarían diciendo cosas distintas del mismo hecho.
 */

/**
 * QUÉ tiene distinto esta OP respecto de sus hermanas.
 *  • `solo-esta`    — esta OP lleva un material que **ninguna** de sus hermanas lleva.
 *  • `no-la-lleva`  — esta OP **no** lleva un material que sus hermanas sí (una lápida excluida, o
 *    un renglón que nunca se copió).
 *  • `cantidad`     — el mismo material, con **cantidad congelada distinta**.
 *
 * ⚠️ **El PRECIO no está en la lista, a propósito.** El precio se negocia por proveedor y por
 * momento (§Post-F9.43/.48: el precio del modelo ES la última compra real), así que dos OP hermanas
 * creadas con una semana de diferencia congelan precios distintos **sin que nadie haya cambiado
 * nada**. Un aviso que se encendiera por eso sería ruido de fondo permanente — el mismo error que
 * `precio-mercado` vino a corregir en la comparación vertical.
 */
export const esquemaTipoDiferenciaHermanas = z
  .enum(['solo-esta', 'no-la-lleva', 'cantidad'])
  .describe('Qué tiene distinto esta OP respecto de sus hermanas.');

/** Clave del tipo de diferencia. */
export type TipoDiferenciaHermanas = z.infer<typeof esquemaTipoDiferenciaHermanas>;

/** Un material que ESTA OP lleva distinto que sus hermanas. */
export const esquemaDiferenciaConHermanas = z
  .object({
    tipo: esquemaTipoRenglonReceta,
    material: z
      .string()
      .describe('Cómo se llama el material, para nombrarlo en el aviso ("BOT-01 — Botón nácar").'),
    que: esquemaTipoDiferenciaHermanas,
    detalle: z
      .string()
      .describe(
        'La frase completa, YA REDACTADA por el servidor (A1): dice qué lleva esta OP, qué llevan ' +
          'las otras y con qué folios. La pantalla la pinta tal cual.',
      ),
  })
  .describe('Un material en el que esta OP no coincide con sus OP hermanas.');

/** Una diferencia de esta OP contra el grupo. */
export type DiferenciaConHermanas = z.infer<typeof esquemaDiferenciaConHermanas>;

/**
 * Cómo va ESTA OP frente a su grupo de hermanas. Se calcula **EN VIVO** en cada lectura y **no se
 * guarda nunca**: un «está desviada» persistido es un derivado que se queda viejo en cuanto alguien
 * corrige la receta de cualquiera de las hermanas (misma razón por la que `desalineacion` y
 * `ocsComprometidas` tampoco se guardan).
 *
 * ⭐ **Quién es «hermana», medido contra el código y dicho aquí para que no se re-descubra:** la OP
 * cuyo modelo cuelga del **MISMO LINAJE** (`idModeloDesarrollo ?? idModelo`, la regla única de
 * `modelos/receta-compartida.ts`). Desde V1-E9a/0.078 un desarrollo engendra **un modelo de
 * producción por color** y cada uno tiene su OP — que es exactamente el «grupo» del que habla
 * Daniel: *«Me dan 4 pedidos diferentes, uno por color»* (§Post-F9.135).
 *
 * ⚠️ Por eso **el pedido interno NO es la familia**: los cuatro colores llegan en cuatro pedidos
 * distintos. (`ordenesDelPedidoDeOrden`, en `compras/mrp.ts`, sí agrupa por pedido — pero contesta
 * otra pregunta: *«¿qué OP conviene comprar juntas?»*, no *«¿cuáles deberían ir iguales?»*.)
 *
 * **No cuentan como hermanas:** las órdenes **canceladas** (mismo criterio que
 * `conjuntosDeLasOrdenesDelModelo`: lo cancelado no es un compromiso con nadie), las de **otra
 * empresa** (A9), las que **no tienen ni una fila congelada** (2 577 de las ~3 900 migradas: su
 * modelo del viejo no tenía BOM) y —⭐⭐ lo que endereza el aviso— las que **tienen receta escrita
 * por la MIGRACIÓN** y nadie ha tocado.
 *
 * 🔴 **El ETL SÍ escribe recetas congeladas** (~1 346), por el dominio y no nombrando las tablas.
 * Y como `EstadoOrden` **no tiene estado de cerrada**, una OP entregada en 2019 **votaría para
 * siempre**: N históricas con la copia del día del ETL contra 1 OP nueva señalarían **a la nueva**.
 * Eso invierte el aviso que Daniel pidió, y duplica invertido lo que ya dice `desalineacion`.
 * ⚠️ No es REGLA 0-B: ahí el dato viejo FALTA; aquí ESTÁ y le gana la votación al nuevo.
 *
 * ⚠️ **«Migración» = cualquier BACKFILL, no sólo el ETL de Access.** El backfill de
 * `20260815140000` copió el BOM a **toda** orden existente, sin filtro, así que **lo capturado a
 * mano en v2 antes del 15-ago-2026 lleva la misma marca**. Ninguna de esas recetas la decidió una
 * persona, que es lo único que la comparación necesita saber.
 *
 * ---
 * ## ⚠️ LO QUE ESTE RECORTE CUESTA — y hasta cuándo dura
 *
 * Apartar el histórico tiene un precio que hay que decir entero: **sobre una familia cuya receta
 * viene de un backfill, el aviso NO HABLA hasta que DOS de sus OP tengan receta decidida por una
 * persona.** Y eso incluye **el caso estrella de Daniel**: si a una OP migrada le cambian el cierre
 * a mano, sus hermanas migradas no votan, no hay grupo, y **no sale aviso** — ni aquí ni en la
 * comparación vertical, que calla los renglones `agregadoAMano` a propósito. En el **Centro de
 * Órdenes esa fila sale limpia** (el chip sólo aparece cuando hay aviso); sólo el **banner de la
 * receta** dice que la familia quedó fuera.
 *
 * ⭐ **Pero el silencio NO es permanente, y eso es lo que lo hace tolerable:** una orden vuelve al
 * grupo en cuanto alguien **toca de verdad** su receta — firmarla, **quitarle un renglón** (la
 * jareta), agregarle uno a mano, editarlo, restaurarlo o traerlo del modelo. ⚠️ **Cuatro actos NO
 * la devuelven**, y están medidos y enumerados en `dominio/produccion/hermanas-de-la-op.ts`:
 * «marcar todo revisado», «reabrir/cerrar la receta», «corregir la captura» **de una lápida** y
 * **asignar el proveedor o el precio de compra** (`compras/proveedor-de-orden.ts`). Ninguno toca la
 * firma, y ninguno dice que la receta sea distinta — ni «ya lo miré», ni «voy a mirarlo», ni «a
 * quién se lo compro». El aviso empieza a hablar en cuanto
 * la familia se trabaja de verdad en v2 — que es la población para la que Daniel lo pidió.
 *
 * ✅ **Es decisión CONFIRMADA de Daniel, no un default nuestro:** *«La información que no se genera
 * en este sistema, puede no tener todas las cosas que tiene este sistema… **Lo que no haya no
 * importa.** Asumo que las órdenes viejas no tengan todas las funciones que las nuevas»* — el
 * principio de REGLA 0-B, bajo el que cae este recorte.
 *
 * Y además es lo correcto de ingeniería: el aviso contrario —señalar a la OP nueva y correcta—
 * entrena a la gente a ignorarlo, y de ahí no se vuelve.
 *
 * Las dos exclusiones se **cuentan** en `fueraDeLaComparacion` y se **dicen** en
 * `notaFueraDeLaComparacion` (ya redactada), para que ningún silencio quede sin explicar.
 */
export const esquemaFrenteAlGrupo = z
  .object({
    hermanas: z
      .number()
      .int()
      .describe(
        'Cuántas OP hermanas COMPARABLES tiene su grupo: no canceladas, de esta empresa, CON ' +
          'receta congelada y con esa receta **decidida por una persona** (las escritas por un ' +
          'backfill NO cuentan: ver `fueraDeLaComparacion`). `0` = no hay con quién compararse, y ' +
          'entonces `aviso` es siempre null — mira `notaFueraDeLaComparacion` para saber por qué.',
      ),
    foliosHermanas: z
      .array(z.number().int())
      .describe('Folios de esas hermanas, para reconocerlas (recortado a las primeras).'),
    fueraDeLaComparacion: z
      .number()
      .int()
      .describe(
        'Cuántas OTRAS OP del linaje se dejaron FUERA de la comparación, por cualquiera de las dos ' +
          'razones: no tienen ni una fila de receta congelada, o su receta la escribió la ' +
          'MIGRACIÓN y nadie la ha tocado (si votara, el histórico señalaría a la OP nueva). Se ' +
          'publica para que la exclusión no falle en silencio: sin este número, un grupo entero ' +
          'podría quedarse sin comparar y nadie lo sabría.',
      ),
    diferencias: z
      .array(esquemaDiferenciaConHermanas)
      .describe('Qué lleva distinto. Vacío = va igual que sus hermanas.'),
    aviso: z
      .string()
      .nullable()
      .describe(
        'Resumen de UNA línea ya redactado por el servidor, nombrando los materiales que difieren ' +
          'y **con cuántas hermanas difiere de verdad** (con 3-2, una minoritaria difiere de 3, no ' +
          'de sus 4 hermanas). `null` = no hay nada que avisar (va igual, o no tiene hermanas).',
      ),
    notaFueraDeLaComparacion: z
      .string()
      .nullable()
      .describe(
        '⭐ La frase, YA REDACTADA por el servidor (singular/plural incluido), que explica cuántas ' +
          'OP del modelo quedaron fuera y por qué. `null` = ninguna quedó fuera. 🔴 Es INDEPENDIENTE ' +
          'de `aviso`: se enseña **también cuando `aviso` es null**, que es justo el caso silencioso ' +
          'que vino a destapar — y con el histórico real ése es el caso común, no la esquina.',
      ),
  })
  .describe(
    'Cómo va esta OP frente a sus OP hermanas (mismo linaje de modelo), calculado al vuelo. ' +
      'INFORMATIVO: nunca bloquea nada.',
  );

/** Cómo va una OP frente a su grupo de hermanas. */
export type FrenteAlGrupo = z.infer<typeof esquemaFrenteAlGrupo>;
