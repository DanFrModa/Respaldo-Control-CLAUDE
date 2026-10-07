/**
 * ⭐ QUIÉN VE EL DINERO DEL MODELO Y DE LA ORDEN (fila 0.249 parte C, §Post-F9.257(c)).
 *
 * `modelos.ver` y `ordenes.ver` son llaves de VOCABULARIO —qué prenda es, qué lleva, de quién es la
 * orden— y el dueño quiere que algún día entren al piso de lectura. Pero sus respuestas traían además
 * **dinero**: la maquila y el corte base del modelo, el precio de cada arte, los precios con los que
 * costea la receta (BOM), la maquila de referencia de la orden y los precios CONGELADOS de la receta
 * de la orden (y del histórico del sistema viejo). *«Lo que sea dinero no debe estar en el piso»*.
 *
 * Aquí vive la regla que decide quién los recibe. **No hay llave nueva**: se combinan llaves que ya
 * existen, cada una por una razón medida —
 *
 *  • `consultas.ver-importes` — la llave de DINERO de los precios (acceso #2 del viejo, *«Ver Importes
 *    Totales y Precios»*). Es la misma con la que la parte B abre los precios de telas y avíos.
 *  • `modelos.administrar` — quien **teclea** esos precios: la maquila y el corte base (el alta y la
 *    edición del modelo), el precio del arte (`crearArte`/`actualizarArte`) y los amarres del BOM.
 *  • `ordenes.precio-maquila` (SÓLO la maquila de referencia) — Producción **captura el precio real
 *    de maquila** de la orden y la referencia es lo que tiene a la vista para negociarlo. Es el MISMO
 *    dato en dos sitios: `maquilaReferencia` de la orden ES `Modelo.maquilaBase` (lo lee
 *    `produccion/precios-orden.ts`), así que se abre igual en los dos — taparlo en uno y no en el
 *    otro sería una puerta lateral o una contradicción.
 *  • `ordenes.ver-precio-real-maquila` (SÓLO la maquila de referencia) — quien ya ve el precio REAL
 *    negociado de la maquila (el dato más sensible de los dos) no puede quedarse sin la referencia
 *    contra la que se negoció: el panel de precios de la orden los enseña lado a lado.
 *  • `desarrollo.administrar` (SÓLO los precios de la ORDEN) — quien **edita la receta congelada de
 *    la orden**: las siete mutaciones de `produccion/receta-orden.ts` exigen esa llave y aceptan
 *    `precio` en el renglón. Quitarle la lectura lo dejaría capturando a ciegas.
 *
 * ⚠️ Los precios del BOM (`precioCosteo`, `precioReferencia`, el proveedor del que sale el precio) NO
 * usan esta regla: son el MISMO precio de catálogo que la parte B ya tapa (el amarre, el más barato,
 * el de referencia, el promedio de las medidas) o la última compra de ese material. Se gobiernan con
 * `puedeVerPreciosDeTela`/`puedeVerPreciosDeAvio` (`catalogos/precios-de-catalogo.ts`): quien ve el
 * precio de una tela en el catálogo lo ve también en la receta, y al revés. Esas dos reglas
 * CONTIENEN a la de aquí (las dos llevan `consultas.ver-importes` y `modelos.administrar`), así que
 * nadie que vea la maquila del modelo deja de ver su BOM.
 *
 * 🔑 **La invariante que hace que ningún formulario pise un precio:** toda llave que ESCRIBE uno de
 * estos precios DESDE UN FORMULARIO está en su lista de lectura. La fija `precios-de-modelo.test.ts`
 * leyendo el `verificarPermiso` real de cada escritor.
 *
 * ⚠️ El frontend NO repite esta regla: reacciona a lo que llega (`preciosOcultos`/`maquilaOculta`
 * ⇒ pinta «—» y no manda el campo al guardar).
 */
import type { ClavePermiso } from '../../contrato/index.js';

import { tienePermiso, type SesionUsuario } from '../../comun/permisos.js';

/** Llaves que dejan ver el DINERO PROPIO del modelo: corte base y precio del arte. */
export const LLAVES_PRECIO_MODELO: readonly ClavePermiso[] = [
  'consultas.ver-importes',
  'modelos.administrar',
];

/**
 * Llaves que dejan ver la MAQUILA DE REFERENCIA (`Modelo.maquilaBase` = `maquilaReferencia` de la
 * orden): las del modelo más quien captura el precio real de maquila.
 */
export const LLAVES_MAQUILA_DE_REFERENCIA: readonly ClavePermiso[] = [
  ...LLAVES_PRECIO_MODELO,
  'ordenes.precio-maquila',
  'ordenes.ver-precio-real-maquila',
];

/**
 * Llaves que dejan ver los precios CONGELADOS de la ORDEN: la receta de la orden (con lo que el
 * modelo dice hoy, embebido para compararlo) y la habilitación del histórico del sistema viejo.
 */
export const LLAVES_PRECIO_DE_ORDEN: readonly ClavePermiso[] = [
  ...LLAVES_PRECIO_MODELO,
  'desarrollo.administrar',
];

/** ¿La sesión recibe el corte base y el precio del arte? Ver {@link LLAVES_PRECIO_MODELO}. */
export function puedeVerPreciosDeModelo(sesion: SesionUsuario): boolean {
  return LLAVES_PRECIO_MODELO.some((clave) => tienePermiso(sesion, clave));
}

/** ¿La sesión recibe la maquila de referencia? Ver {@link LLAVES_MAQUILA_DE_REFERENCIA}. */
export function puedeVerMaquilaDeReferencia(sesion: SesionUsuario): boolean {
  return LLAVES_MAQUILA_DE_REFERENCIA.some((clave) => tienePermiso(sesion, clave));
}

/** ¿La sesión recibe los precios congelados de la orden? Ver {@link LLAVES_PRECIO_DE_ORDEN}. */
export function puedeVerPreciosDeOrden(sesion: SesionUsuario): boolean {
  return LLAVES_PRECIO_DE_ORDEN.some((clave) => tienePermiso(sesion, clave));
}

/**
 * ⭐ LA META DE COSTO DEL MODELO (fila 0.249 parte D) — lo que el modelo congela al firmar su revisión:
 * lo PROMETIDO en la mesa (`metaCostoPrometido`) y lo que SÍ se consiguió (`metaCostoConseguido`).
 * Son costos por prenda, o sea dinero, y van partidas:
 *
 *  • **Lo prometido** sólo con `consultas.ver-importes`: es la misma regla con que las otras tres
 *    puertas que lo enseñan lo cierran (`GET /modelos/:id/meta-prometida`, el `costoPrometido` de la
 *    bandeja «Recetas por revisar» y «Promesas incumplidas», en `meta-negociada.ts`). Quien firma NO
 *    lo teclea —lo resuelve el servidor—, así que no hay «quien escribe» que dejar a ciegas.
 *  • **Lo conseguido** con `consultas.ver-importes` **o** `modelos.aprobar-receta`: es lo que el
 *    firmante TECLEA al aprobar. Quien escribe, lee — si no, el eco de su propia firma le llegaría en
 *    blanco.
 */
export function puedeVerMetaPrometida(sesion: SesionUsuario): boolean {
  return tienePermiso(sesion, 'consultas.ver-importes');
}

/** ¿La sesión recibe lo CONSEGUIDO de la meta de costo? Ver {@link puedeVerMetaPrometida}. */
export function puedeVerMetaConseguida(sesion: SesionUsuario): boolean {
  return (
    tienePermiso(sesion, 'consultas.ver-importes') || tienePermiso(sesion, 'modelos.aprobar-receta')
  );
}

/** Lo mínimo de un modelo que trae dinero propio (lo cumple `ModeloConRelaciones`). */
interface ConDineroDeModelo {
  maquilaBase: { toNumber(): number } | null;
  corteBase: { toNumber(): number } | null;
  metaCostoPrometido: { toNumber(): number } | null;
  metaCostoConseguido: { toNumber(): number } | null;
}

/** Las marcas de lo que el servidor TAPÓ de un modelo para esta sesión. */
export interface MarcasPreciosModelo {
  /** `true` = `corteBase` va null porque no te toca verlo (no porque no esté capturado). */
  preciosOcultos: boolean;
  /** `true` = `maquilaBase` va null porque no te toca verla. */
  maquilaOculta: boolean;
}

/**
 * ⭐ Tapa EN EL SERVIDOR el dinero propio de un modelo para quien no puede verlo. Proyección pura:
 * nunca escribe. Lo que NO se tapa: la ficha, el linaje, la revisión, el conteo de fotos — dicen QUÉ
 * es la prenda, no cuánto cuesta. (`costoActual` ya lo tapa `puedeVerCostoRealDeModelo`.)
 *
 * La meta de costo (`metaCostoPrometido`/`metaCostoConseguido`) se tapa con
 * {@link puedeVerMetaPrometida}/{@link puedeVerMetaConseguida} y va en `null` SIN marca: ninguna
 * pantalla la lee de esta salida (la firma pide la meta en vivo a `GET /modelos/:id/meta-prometida`).
 */
export function ocultarPreciosDeModeloSiNoPuede<T extends ConDineroDeModelo>(
  sesion: SesionUsuario,
  modelo: T,
): T & MarcasPreciosModelo {
  const verModelo = puedeVerPreciosDeModelo(sesion);
  const verMaquila = puedeVerMaquilaDeReferencia(sesion);
  return {
    ...modelo,
    maquilaBase: verMaquila ? modelo.maquilaBase : null,
    corteBase: verModelo ? modelo.corteBase : null,
    metaCostoPrometido: puedeVerMetaPrometida(sesion) ? modelo.metaCostoPrometido : null,
    metaCostoConseguido: puedeVerMetaConseguida(sesion) ? modelo.metaCostoConseguido : null,
    preciosOcultos: !verModelo,
    maquilaOculta: !verMaquila,
  };
}
