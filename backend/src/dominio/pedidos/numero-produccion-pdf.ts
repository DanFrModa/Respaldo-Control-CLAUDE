/**
 * ⭐⭐ **EL Nº DE PRODUCCIÓN DE CADA OC, DICHO ANTES DE CONFIRMAR** (fila 0.151).
 *
 * DANIEL, textual, después de importar un PDF y encontrarse la OP ya hecha: *«me generó el pedido y
 * la OP **sin preguntar el número de modelo interno**… **Quedamos que ese lo ponía yo, con una
 * sugerencia previa**… No me gustó que todo sea completamente automático antes de poder
 * verificar.»*
 *
 * El panel manual «Generar OP» ya lo hacía —llega con el número precargado y editable— porque
 * `salidaAProduccion` acepta `numeroProduccion` desde §Post-F9.46. El importador por PDF llamaba a
 * esa MISMA función sin pasarle el campo, así que el número lo elegía el sistema y nadie lo veía
 * hasta después. Este módulo es la mitad que faltaba: contesta, **por PDF y antes de escribir
 * nada**, *«¿qué le va a pasar al modelo de esta OC, y con qué número?»*.
 *
 * ---
 * ## 🔴 POR QUÉ VIVE APARTE, Y POR QUÉ SE CALCULA PARA TODA LA TANDA DE GOLPE
 *
 * Mismo motivo que `color-del-papel.ts` y `oc-duplicada.ts`: la vista previa y el confirm tienen
 * que decir **lo mismo**. Y hay una razón más, que es la que obliga a mirar la tanda ENTERA en vez
 * de PDF por PDF:
 *
 * 🔑 **Cuatro OC de cuatro colores del mismo modelo estrenan CUATRO números** (V1-E3,
 * §Post-F9.172(b)). Si cada renglón preguntara «¿cuál es el siguiente libre?» por su cuenta, los
 * cuatro recibirían **el mismo** —nada se ha escrito todavía—, el usuario confirmaría creyendo que
 * son cuatro distintos y el segundo nacimiento tumbaría **la tanda entera** con *«ese número ya
 * está ocupado»*. Por eso los números propuestos se **apartan** según se reparten
 * ({@link proponerNumeroProduccion} recibe los ya reservados) y los pares (modelo, color) que ya se
 * llevaron uno se marcan como **reusados por la propia tanda**.
 *
 * ## ⚠️ LA PROPUESTA ES INFORMATIVA, Y ESO NO ES UN DETALLE DE REDACCIÓN
 *
 * Esto corre **fuera** de la transacción que va a guardar y **sin** el advisory lock del par (el que
 * toma `derivarModeloDeProduccion`). Entre esta consulta y el confirm, otra sesión —o el panel
 * manual— puede llevarse ese número. Quien decide de verdad es el confirm, que vuelve a proponer
 * **bajo candado** y **BLOQUEA** si el número capturado ya está ocupado. La pantalla no debe
 * prometer que el número queda apartado; sólo precargarlo.
 *
 * ## Y el desenlace es lo que decide si el campo se OFRECE
 *
 * Sólo `nacido` puede llevar número. En `reusado` y `heredado` el modelo ya tiene el suyo y
 * `obtenerODerivarModeloDeProduccion` **ignora** el capturado (avisa, no bloquea): ofrecer el campo
 * ahí sería prometer algo que la capa de abajo descarta.
 *
 * ## 🔴 Y un `reusado` cuyo modelo está DESCONTINUADO no es un reuso: es un rechazo
 *
 * `obtenerODerivarModeloDeProduccion` lanza `ErrorConflicto` si el hijo de ese color está apagado
 * (§Post-F9.119), y con A2 eso **tumba la importación completa**. Ese caso sale con el desenlace
 * `reusado` —es el modelo con el que la OP *querría* hacerse, y como no nace nada tampoco hay
 * número que teclear— pero **sin número** y con el aviso diciendo que la importación se va a
 * rechazar y cómo arreglarlo. No hay un cuarto valor en el enum a propósito: `modeloDeProduccion`
 * lo comparten la previa y la respuesta del alta (`OrdenPdfImportada`), donde un "bloqueado" no
 * puede ocurrir nunca.
 */
import type { DesenlaceModeloPdf } from '../../contrato/index.js';

import { ErrorValidacion } from '../../comun/errores.js';
import type { Tx } from '../../comun/transaccion.js';
import { digitosDelModelo, proponerNumeroProduccion } from '../modelos/nomenclatura.js';

/** Lo que hay que saber de un PDF para numerar la OP que nacería de él. */
export interface RenglonParaNumerar {
  /** NUESTRO modelo ligado a este PDF, o `null` si todavía no hay liga (o el PDF no se va a importar). */
  idModelo: number | null;
  /** Color CANÓNICO en el que va a nacer la OP, o `null` si el color se va a crear al confirmar. */
  idColor: number | null;
  /**
   * Clave del NOMBRE del color del papel. Distingue dos colores que **todavía no existen** dentro de
   * la misma tanda: sin ella, dos OC de colores nuevos DISTINTOS del mismo modelo compartirían la
   * clave `(modelo, null)` y la segunda se anunciaría como reuso de la primera, que es falso.
   */
  claveColor: string;
}

/** Qué le va a pasar al modelo de producción de UN PDF, y con qué número. */
export interface DesenlaceNumeroPdf {
  /** `null` = no hay liga (o el PDF no se va a importar): no hay modelo del que hablar. */
  modeloDeProduccion: DesenlaceModeloPdf | null;
  /** Número propuesto para precargar el campo (sólo en `nacido`; `null` si la serie está llena). */
  numeroProduccionPropuesto: number | null;
  /** Número del modelo con el que va a quedar la OP cuando NO nace uno nuevo. */
  numeroProduccionModelo: number | null;
  /** Avisos de la numeración de este PDF. NUNCA bloquean. */
  avisos: string[];
}

/** Un PDF del que no hay nada que numerar (sin liga, o que no se va a importar). */
const SIN_NUMERAR: DesenlaceNumeroPdf = {
  modeloDeProduccion: null,
  numeroProduccionPropuesto: null,
  numeroProduccionModelo: null,
  avisos: [],
};

/** Lo que se lee del modelo ligado para poder numerarlo (forma de `digitosDelModelo` + su estado). */
interface ModeloLigado {
  id: number;
  codigo: string;
  codigoDesarrollo: string | null;
  idTipoProducto: number | null;
  idGenero: number | null;
  origen: string;
  numeroProduccion: number | null;
}

/**
 * Resuelve, **para toda la tanda y en orden**, qué le va a pasar al modelo de cada PDF y con qué
 * número. Devuelve un desenlace por renglón, en el MISMO orden que entraron (el índice liga con la
 * vista previa). Sólo LEE.
 *
 * ⚠️ Un modelo al que le faltan los dígitos de la nomenclatura (tipo de prenda / género) **no tumba
 * la vista previa**: su renglón sale como `nacido` sin propuesta y con el motivo en `avisos`. Antes
 * de esta fila eso sólo se descubría al confirmar, cuando `digitosDelModelo` reventaba **la
 * transacción entera** y con ella el resto de las OC de la tanda.
 */
export async function resolverNumerosDeProduccion(
  bd: Tx,
  renglones: readonly RenglonParaNumerar[],
): Promise<DesenlaceNumeroPdf[]> {
  const salida: DesenlaceNumeroPdf[] = [];
  /** Números que esta misma pasada ya repartió y que todavía no están en la base. */
  const reservados = new Set<number>();
  /** Pares (modelo, color) que YA estrenan modelo en esta tanda → el número que se llevaron. */
  const nacientes = new Map<string, number | null>();
  /** Cache de modelos: una tanda repite el mismo modelo en varias OC (es el caso de Daniel). */
  const modelos = new Map<number, ModeloLigado | null>();

  for (const renglon of renglones) {
    if (renglon.idModelo === null) {
      salida.push(SIN_NUMERAR);
      continue;
    }
    const modelo = await leerModelo(bd, modelos, renglon.idModelo);
    if (modelo === null) {
      // Liga a un modelo que no existe: el confirm lo dirá con su error. Aquí no se inventa nada.
      salida.push(SIN_NUMERAR);
      continue;
    }

    // Rama LEGADO: el modelo ligado ya es de producción (los ~4,987 del Access). La OP lo hereda tal
    // cual y nada nace, así que no hay número que teclear.
    if (modelo.origen !== 'desarrollo') {
      salida.push({
        modeloDeProduccion: 'heredado',
        numeroProduccionPropuesto: null,
        numeroProduccionModelo: modelo.numeroProduccion,
        avisos: [],
      });
      continue;
    }

    const clave = `${String(modelo.id)}:${renglon.idColor === null ? `n:${renglon.claveColor}` : String(renglon.idColor)}`;

    // ¿Otro PDF de ESTA tanda ya se llevó el modelo de este par? Entonces esta OC lo va a REUSAR.
    const naciente = nacientes.get(clave);
    if (naciente !== undefined) {
      salida.push({
        modeloDeProduccion: 'reusado',
        numeroProduccionPropuesto: null,
        numeroProduccionModelo: naciente,
        avisos: [
          'Otra OC de esta misma tanda hace nacer el modelo de producción de este color; esta OC ' +
            'va a usar ESE modelo y no estrena número (el número es del modelo, no de la orden).',
        ],
      });
      continue;
    }

    // ¿Ese color ya tiene modelo de producción? Se reusa (mismo criterio y mismo `orderBy` que
    // `obtenerODerivarModeloDeProduccion`: si hubiera dos, gana el primero que nació).
    //
    // 🔴 **`activo` NO ES DECORACIÓN: SIN ÉL LA PREVIA PROMETE UN REUSO QUE EL CONFIRM RECHAZA.**
    // `obtenerODerivarModeloDeProduccion` lanza `ErrorConflicto` cuando el hijo de ese color está
    // DESCONTINUADO (§Post-F9.119: reactivarlo es un acto a mano, nunca un efecto lateral de generar
    // una OP), y como el confirm corre en UNA transacción (A2), ese conflicto **revierte la tanda
    // entera**. Sin mirar `activo`, la vista previa anunciaba *«la OP se va a hacer con él»* de un
    // modelo con el que la OP no se puede hacer — justo lo contrario de la invariante que este
    // módulo declara en su encabezado (*la previa y el confirm tienen que decir lo MISMO*), y el
    // mismo cuidado que `ligaSugerida` sí tiene al filtrar los modelos inactivos.
    const existente =
      renglon.idColor === null
        ? null
        : await bd.modelo.findFirst({
            where: { idModeloDesarrollo: modelo.id, idColor: renglon.idColor },
            orderBy: { id: 'asc' },
            select: { codigo: true, numeroProduccion: true, activo: true },
          });
    if (existente !== null) {
      salida.push({
        modeloDeProduccion: 'reusado',
        numeroProduccionPropuesto: null,
        // ⚠️ Con el hijo descontinuado NO se anuncia ningún número: la OP no va a quedar con él
        // (no va a haber OP). Enseñar `#71007` aquí sería la mitad visible de la promesa falsa.
        numeroProduccionModelo: existente.activo ? existente.numeroProduccion : null,
        avisos: [
          existente.activo
            ? `Este color ya tiene el modelo de producción ${existente.codigo}: la OP se va a ` +
              `hacer con él y no nace ninguno nuevo.`
            : // El mismo remedio, con las mismas palabras, que el error del confirm
              // (`obtenerODerivarModeloDeProduccion`): quien lea el aviso ya sabe qué hacer.
              `El modelo de producción ${existente.codigo} de ese color está DESCONTINUADO, así ` +
              `que esta OC no se va a poder importar: la importación entera se va a rechazar. ` +
              `Reactívalo desde su ficha si vas a producirlo otra vez — no se le puede dar la ` +
              `vuelta haciendo nacer otro, porque el número es del modelo y ese color ya tiene ` +
              `el suyo.`,
        ],
      });
      continue;
    }

    // NACE: se propone el siguiente libre, APARTANDO los que esta misma tanda ya repartió.
    let propuesta;
    try {
      const digitos = await digitosDelModelo(bd, modelo);
      propuesta = await proponerNumeroProduccion(bd, digitos, reservados);
    } catch (error) {
      if (error instanceof ErrorValidacion) {
        nacientes.set(clave, null);
        salida.push({
          modeloDeProduccion: 'nacido',
          numeroProduccionPropuesto: null,
          numeroProduccionModelo: null,
          avisos: [error.message],
        });
        continue;
      }
      throw error;
    }
    if (propuesta.numero !== null) {
      reservados.add(propuesta.numero);
    }
    nacientes.set(clave, propuesta.numero);
    salida.push({
      modeloDeProduccion: 'nacido',
      numeroProduccionPropuesto: propuesta.numero,
      numeroProduccionModelo: null,
      avisos: propuesta.avisos,
    });
  }

  return salida;
}

/** Lee (una sola vez por id) el modelo ligado a un PDF. */
async function leerModelo(
  bd: Tx,
  cache: Map<number, ModeloLigado | null>,
  idModelo: number,
): Promise<ModeloLigado | null> {
  const enCache = cache.get(idModelo);
  if (enCache !== undefined) {
    return enCache;
  }
  const modelo = await bd.modelo.findUnique({
    where: { id: idModelo },
    select: {
      id: true,
      codigo: true,
      codigoDesarrollo: true,
      idTipoProducto: true,
      idGenero: true,
      origen: true,
      numeroProduccion: true,
    },
  });
  cache.set(idModelo, modelo);
  return modelo;
}
