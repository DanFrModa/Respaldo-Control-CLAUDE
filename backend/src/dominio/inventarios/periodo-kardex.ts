/**
 * EL PERIODO DE UN KARDEX — la pieza que la fila 0.138 construyó para producto terminado y que la
 * 0.173 sacó de ahí para que la usen los CUATRO (PT, tela por color, tela por lote y avíos).
 *
 * Daniel, en el repaso de inventarios: *«con diez años cargados, pedirlo trae todo»*. Un kardex sin
 * periodo pide el histórico ENTERO en una sola respuesta; medido en PT contra una base sintética de
 * diez años, eran **25 000 renglones y 8.3 MB**. La cura tiene DOS piezas y las dos viven aquí, en
 * el dominio (A1: ni la ruta ni la pantalla deciden el periodo):
 *
 *  1. Un PERIODO (`desde`/`hasta`) que se resuelve en el `WHERE` del SERVIDOR, nunca recortando en
 *     el cliente lo que ya llegó.
 *  2. Una VENTANA POR OMISIÓN cuando nadie pide periodo: sin ella, la pantalla que hoy no manda
 *     fechas seguiría pidiendo los diez años y el defecto seguiría vivo para quien no toque el
 *     filtro — que es la mayoría.
 *
 * Y como un rango que el usuario escribe no acota nada por sí solo (`desde=2016-01-01` es otra vez
 * todo el histórico), hay además un TOPE DURO de renglones. Los tres datos —periodo efectivo, tope
 * y si hubo corte— VIAJAN EN LA RESPUESTA: nadie debe creer que ve todo cuando ve un pedazo.
 *
 * ⭐⭐ EL CORTE SE LLEVA LO VIEJO, NO LO NUEVO. El folio es la **secuencia atómica por empresa
 * (A3)**: crece con el tiempo, así que `ORDER BY folio ASC LIMIT n` devuelve **los n MÁS VIEJOS** de
 * la ventana. En PT eso escondía siete meses recientes con la pantalla diciendo «en adelante». Por
 * eso {@link recortarPorLaCola} se pide DESCENDENTE y se invierte: lo que se ve es el FINAL. El
 * precio es que el saldo anterior deja de ser «lo de antes de `desde`» y pasa a ser **lo que el
 * artículo traía justo antes del PRIMER RENGLÓN QUE SE VE**, anclado con la MISMA llave con la que
 * la lista se ordena y se corta —`(folio, id)`, no la fecha—, que es lo que evita que dos
 * movimientos del mismo día a ambos lados del límite se dupliquen o se pierdan.
 *
 * 📏 **Por qué los MISMOS números para los cuatro (decisión de la 0.173, medida).** La tentación era
 * darle al kardex LEGADO por lote una ventana distinta, porque es un archivo CONGELADO (desde la
 * fila 0.170 nadie escribe ahí: es sólo el histórico migrado de Access) y una ventana que corre con
 * el calendario acabará dejándolo en blanco. Se midió el volumen real antes de inventar nada: con la
 * ventana de migración vigente (`ETL_DESDE=2025`, §Post-F9.24) de los CSV de Access entran **259
 * renglones repartidos en 51 telas, con un máximo de 48 en la tela más movida** — o sea que el que
 * la fila daba por «el único con volumen real» es en la práctica el más pequeño de los tres. Sin un
 * problema que resolver, una regla propia sería doblar el diseño para que le cuadre al histórico, y
 * eso es exactamente lo que la REGLA 0-B prohíbe. Un solo mecanismo, un solo juego de números; lo
 * que sí se hace es que la pantalla del legado DIGA que su vacío es del periodo, no de la tela.
 * *(Si algún día F10 migrara el histórico completo, la tela más movida traería 2 153 renglones: el
 * tope los acota igual, y el usuario amplía las fechas cuando quiera ver más atrás.)*
 */
import { z } from 'zod';

import { ZONA_DEL_NEGOCIO } from '../../comun/fecha-negocio.js';

/**
 * Meses de la ventana por omisión cuando NADIE pide `desde`.
 *
 * Doce, no tres ni uno: un año es el ciclo completo del negocio (las dos temporadas y la
 * comparación contra el mismo mes del año pasado), y de un plumazo deja fuera el ~90 % de un
 * histórico de diez años. Un periodo más largo se pide a mano — y entonces es una decisión
 * consciente, no el precio por omisión de abrir la pantalla.
 */
export const MESES_VENTANA_KARDEX = 12;

/** Renglones que devuelve un kardex si el llamador no pide otro tope. */
export const RENGLONES_KARDEX_POR_OMISION = 1000;

/** Tope DURO de renglones: ni pidiéndolo se pasa de aquí (es el techo que el rango no garantiza). */
export const TOPE_RENGLONES_KARDEX = 5000;

/**
 * Los tres campos del periodo, para pegarlos a los filtros propios de cada kardex. Se exponen como
 * shape (y no como esquema cerrado) porque cada kardex tiene su identificador obligatorio distinto
 * —modelo, tela, color de tela, avío— y todos comparten EXACTAMENTE estos tres.
 */
export const camposPeriodoKardex = {
  /** Primer día del periodo (YYYY-MM-DD), INCLUSIVE. */
  desde: z.iso.date({ error: 'La fecha «desde» no es válida (YYYY-MM-DD)' }).optional(),
  /** Último día del periodo (YYYY-MM-DD), INCLUSIVE. */
  hasta: z.iso.date({ error: 'La fecha «hasta» no es válida (YYYY-MM-DD)' }).optional(),
  /** Tope de renglones. El DEFAULT vive aquí (A1), no en el contrato. */
  limite: z.number().int().min(1).max(TOPE_RENGLONES_KARDEX).default(RENGLONES_KARDEX_POR_OMISION),
};

/**
 * El rechazo del rango AL REVÉS, para colgarlo con `.refine(...)` del esquema de cada kardex. Va
 * aparte de {@link camposPeriodoKardex} porque un `.refine` no se puede «pegar» a un shape: lo
 * aplica cada esquema después de armar sus propios filtros. El mensaje es uno solo para los cuatro.
 *
 * ⚠️ Los esquemas de dominio que lo usan **se EXPORTAN** para que el contrato pueda compararse
 * contra ellos (`contrato/esquemas/tope-kardex-honesto.test.ts`): el tope vive dos veces —como
 * `.max()` literal en el querystring publicado y como constante aquí— y una prueba mecánica cruza
 * los dos. Comparar contra un intermediario «equivalente» sería un guardián ciego (cicatriz de
 * `contrato/esquemas/paginacion-honesta.test.ts`).
 */
export const periodoAlDerecho = {
  /** `desde` no puede ser posterior a `hasta` (si faltan, no hay nada que comparar). */
  predicado: (f: { desde?: string | undefined; hasta?: string | undefined }): boolean =>
    f.desde === undefined || f.hasta === undefined || f.desde <= f.hasta,
  opciones: {
    error: 'El periodo está al revés: «desde» no puede ser posterior a «hasta».',
    path: ['desde'],
  },
};

/** El periodo que un kardex REALMENTE consultó (lo que viaja de vuelta a la pantalla). */
export interface VentanaKardex {
  /** Primer día consultado (YYYY-MM-DD, inclusive). SIEMPRE hay uno: nunca se lee sin piso. */
  desde: string;
  /** Último día consultado (YYYY-MM-DD, inclusive), o `null` si no se puso techo. */
  hasta: string | null;
  /** `true` cuando el `desde` lo puso esta función porque nadie pidió periodo. */
  porOmision: boolean;
}

/** El día de HOY tal como lo vive el negocio (México), en YYYY-MM-DD. */
function hoyDelNegocio(ahora: Date): string {
  // `en-CA` da exactamente `YYYY-MM-DD`; la zona se toma de `comun/fecha-negocio` para no tener
  // dos husos distintos en el sistema (el servidor corre en UTC y la gente captura en -06:00).
  return ahora.toLocaleDateString('en-CA', { timeZone: ZONA_DEL_NEGOCIO });
}

/**
 * Resuelve el PERIODO de un kardex. Función PURA (por eso se prueba sin base de datos).
 *
 * Reglas, y son las que la respuesta declara:
 *  • Los dos extremos son INCLUSIVOS: un movimiento fechado el mismo día que `hasta` SÍ entra
 *    (`fecha` es una columna `date`, así que no hay trampa de horas).
 *  • Si NO viene `desde`, se pone uno: {@link MESES_VENTANA_KARDEX} meses hacia atrás desde `hasta`
 *    si lo hay, o desde hoy si no. Es decir, **el periodo SIEMPRE tiene piso**, y por eso pedir un
 *    kardex no puede volver a traer diez años.
 *  • Si viene `hasta` sin `desde`, la ventana son los 12 meses que TERMINAN en `hasta` (no «todo
 *    hasta esa fecha»): la garantía de piso vale también ahí.
 *  • Si no viene `hasta`, no se pone techo — un movimiento con fecha futura sigue apareciendo, que
 *    es lo que uno espera al abrir el kardex. Y los hay: el histórico de Access trae fechas
 *    capturadas mal (hasta 2029) que la lectura no debe esconder.
 */
export function resolverVentanaKardex(
  filtros: { desde?: string | undefined; hasta?: string | undefined },
  ahora: Date = new Date(),
): VentanaKardex {
  const hasta = filtros.hasta ?? null;
  if (filtros.desde !== undefined) {
    return { desde: filtros.desde, hasta, porOmision: false };
  }
  const ancla = filtros.hasta ?? hoyDelNegocio(ahora);
  const [anio, mes, dia] = ancla.split('-').map(Number);
  // Aritmética de CALENDARIO en UTC (nada de restar milisegundos): un mes no dura siempre lo mismo.
  const piso = new Date(Date.UTC(anio as number, (mes as number) - 1 - MESES_VENTANA_KARDEX, dia));
  return { desde: piso.toISOString().slice(0, 10), hasta, porOmision: true };
}

/** Convierte un YYYY-MM-DD del periodo al `Date` que espera una columna `date` de Postgres. */
export function diaDelPeriodo(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * Aplica el TOPE quedándose con **el final** del periodo. Recibe lo que devolvió la consulta pedida
 * en orden DESCENDENTE con `take: limite + 1` (ese uno de más es la forma barata de saber que hay
 * más SIN pagar un `count` sobre diez años) y devuelve los `limite` más nuevos, ya en orden
 * cronológico.
 *
 * ⚠️ Si esto se llama con una consulta pedida en ASCENDENTE, devuelve el pedazo MÁS VIEJO del
 * periodo y la pantalla esconde justo lo que uno abre un kardex a mirar. El orden lo pone el
 * llamador; esta función asume el descendente que documenta la cabecera del archivo.
 */
export function recortarPorLaCola<T>(
  filasDescendentes: T[],
  limite: number,
): { enPeriodo: T[]; truncado: boolean } {
  return {
    // El `slice` ya copia: no se muta lo que devolvió Prisma.
    enPeriodo: filasDescendentes.slice(0, limite).reverse(),
    truncado: filasDescendentes.length > limite,
  };
}
