/**
 * EL CONTRATO INTERNO DEL INVENTARIO CÍCLICO — un ADAPTADOR por dimensión (fila 0.099).
 *
 * El motor del cíclico (folio, teórico congelado, estados, cancelación suave, auditoría, exactitud,
 * hoja impresa y el aviso de «el almacén se movió») es EL MISMO para producto terminado, telas y
 * avíos. Lo único que cambia es lo que depende de la LLAVE del artículo, y eso es exactamente lo
 * que vive detrás de este contrato:
 *
 *  1. **Enumerar** los artículos con existencia del almacén ({@link AdaptadorCiclico.enumerar}).
 *  2. **Leer la existencia BAJO BLOQUEO** ({@link AdaptadorCiclico.leerExistenciasBloqueadas}) —
 *     que es a la vez cómo se CONGELA el teórico al abrir la hoja y cómo se re-lee al cerrarla.
 *  3. **Aplicar el ajuste 1:1 al kardex** ({@link AdaptadorCiclico.registrarAjuste} +
 *     {@link AdaptadorCiclico.enlazar}).
 *  4. **Describir el artículo** ({@link AdaptadorCiclico.leer}) para la pantalla y la hoja impresa.
 *
 * ⚠️ **PT cuenta ENTERO y telas/avíos cuentan DECIMAL.** El genérico NO redondea a piezas: cada
 * adaptador declara su {@link AdaptadorCiclico.escala} (0 para PT, 4 para telas y avíos — la misma
 * de `movimiento_det_tela`/`movimiento_det_avio`) y toda la aritmética del motor pasa por
 * {@link redondear} con ESA escala. Sin eso, contar 12.5 m sería imposible; y sin redondear, la
 * resta en coma flotante de dos saldos limpios (`130.1 − 100.2 = 29.89999999999999`) escribiría
 * movimientos de ruido que la columna ni siquiera puede guardar.
 */
import type { TipoAlmacen } from '../../../datos/index.js';
import type {
  ClavePermiso,
  DatosCiclicoRenglonAgregar,
  DatosInventarioCiclicoCrear,
  DimensionCiclicoValor,
} from '../../../contrato/index.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ClienteLectura, Tx } from '../../../comun/transaccion.js';

/**
 * Llave de un artículo de kardex, OPACA para el motor: un mapa de nombre→id que sólo el adaptador
 * sabe leer (`{idModelo,idColor,idTalla,idOrden}` en PT, `{idTelaColor}` en telas, `{idAvio}` en
 * avíos). El motor la usa como identidad —la compara con {@link textoClave}— y nunca la interpreta.
 */
export type ClaveArticulo = Readonly<Record<string, number | null>>;

/**
 * Identidad TEXTUAL y ESTABLE de una llave, para usarla como clave de `Map`/`Set`. Ordena los
 * campos por nombre: dos llaves con los mismos pares dan el mismo texto aunque se hayan construido
 * en distinto orden.
 */
export function textoClave(clave: ClaveArticulo): string {
  return Object.keys(clave)
    .sort()
    .map((k) => `${k}=${String(clave[k] ?? 'null')}`)
    .join('|');
}

/** El almacén que se cuenta, ya resuelto (A9 + tipo verificados por el motor). */
export interface ContextoDimension {
  idEmpresa: number;
  idAlmacen: number;
}

/**
 * Los DOS componentes de una existencia. `complemento` NULL = el artículo no tiene segundo
 * componente (PT, avíos, y las telas sin cardigan). NULL ≠ 0: el 0 es un complemento que EXISTE y
 * está vacío, y esa diferencia decide si el conteo pide un segundo número o no (D5).
 */
export interface Componentes {
  cuerpo: number;
  complemento: number | null;
}

/** Un movimiento de kardex que reconcilió un renglón (traza de la exactitud). */
export interface AjusteEnlazado {
  id: number;
  folio: number;
  direccion: 'entrada' | 'salida';
}

/** Un renglón del detalle, ya leído y DESCRITO por su adaptador. */
export interface RenglonCiclico {
  idDet: number;
  clave: ClaveArticulo;
  /** El artículo: código del modelo, nombre de la tela, clave del avío. */
  titulo: string;
  /** Lo que lo distingue dentro de su artículo (color·talla·orden, color de tela, descripción). */
  subtitulo: string | null;
  /** Unidad de la cantidad (m, kg, pza…); null si no aplica. */
  unidad: string | null;
  /**
   * Nombre del segundo componente (D5); null si ESTE RENGLÓN no lo lleva. Lo decide el teórico
   * CONGELADO ({@link RenglonCiclico.cantTeoricaComplemento}), nunca el catálogo de hoy: una hoja
   * abierta ya fijó su forma, y el ajuste sólo puede mover el componente que congeló.
   */
  nombreComplemento: string | null;
  cantTeorica: number;
  cantTeoricaComplemento: number | null;
  cantReal: number | null;
  cantRealComplemento: number | null;
  ajustes: AjusteEnlazado[];
}

/**
 * Qué renglones de una hoja YA ABIERTA llevan segundo componente, por {@link textoClave} (fila
 * 0.099). Lo arma el motor a partir del teórico CONGELADO y se lo pasa al adaptador al re-leer la
 * existencia para cerrar.
 *
 * ⚠️ **Por qué existe.** La forma de una hoja la fija el ALTA: el ajuste sólo puede mover el
 * componente cuyo teórico congeló. Si el catálogo cambia con la hoja abierta —a una tela se le quita
 * el `nombreComplemento`—, el adaptador leería la existencia del complemento como «no aplica» aunque
 * el kardex tenga saldo de verdad ahí: el cierre creería que el almacén se movió y, al confirmar,
 * la salida del complemento chocaría contra un no-negativo calculado sobre un 0 falso, dejando una
 * hoja imposible de cerrar. Con esta forma, el que manda es lo congelado.
 */
export type FormaCongelada = ReadonlyMap<string, boolean>;

/** Un renglón a sembrar: su llave y el teórico ya congelado. */
export interface RenglonASembrar {
  clave: ClaveArticulo;
  teorico: Componentes;
}

/** Lo capturado de un renglón (lo CONTADO, nunca una diferencia). */
export interface CapturaRenglon {
  idDet: number;
  cantReal: number;
  cantRealComplemento: number | null;
}

/** Una línea del ajuste que se va a escribir al kardex (cantidades SIEMPRE positivas). */
export interface LineaAjuste {
  clave: ClaveArticulo;
  /** Cantidad del componente principal; 0 si sólo se mueve el complemento. */
  cuerpo: number;
  /** Cantidad del complemento; null si el artículo no lo tiene. */
  complemento: number | null;
}

/** Adaptador de UNA dimensión del cíclico. */
export interface AdaptadorCiclico {
  /** Qué cuenta (persistido en el encabezado). */
  readonly dimension: DimensionCiclicoValor;
  /** Tipo de almacén que esta dimensión exige (`exigirAlmacenDelTipo` — fila 0.137). */
  readonly tipoAlmacen: TipoAlmacen;
  /** true = el capturista NO ve el teórico (PT, D6). */
  readonly conteoCiego: boolean;
  /** Decimales de la cantidad: 0 = piezas enteras (PT); 4 = metros/kilos (telas y avíos). */
  readonly escala: 0 | 4;
  /** Cómo se llama el artículo en los mensajes ("modelo", "color de tela", "avío"). */
  readonly nombreArticulo: string;
  /**
   * Permiso EXTRA que exige APLICAR el ajuste de esta dimensión, además de
   * `indicadores.ciclicos-consulta`. Existe porque el ajuste escribe en el kardex de la dimensión:
   * abrir el cíclico a telas y avíos sin esto le habría dado a cualquiera con permiso de cíclicos
   * la capacidad de mover el inventario de telas, que antes no tenía. `null` en PT — su ajuste ya
   * existía bajo el permiso del módulo y esta fila NO le cambia la llave a nadie.
   */
  readonly permisoAjuste: ClavePermiso | null;

  /**
   * Extrae de los datos del alta la lista de ids que ACOTA el conteo (`idsModelo`/`idsTela`/
   * `idsAvio`), y RECHAZA la lista de otra dimensión: un filtro que no filtra dejaría al usuario
   * creyendo que acotó su conteo.
   */
  alcance(datos: DatosInventarioCiclicoCrear): number[] | undefined;

  /** (1) Artículos con existencia ≠ 0 en el almacén, dentro del alcance. */
  enumerar(tx: Tx, ctx: ContextoDimension, alcance: number[] | undefined): Promise<ClaveArticulo[]>;

  /**
   * (2) Existencia ACTUAL de cada artículo, leída por Σ DIRECTA de movimientos (NUNCA la vista —
   * ADR-0010 §3) DESPUÉS de tomar su bloqueo. El adaptador toma los locks en SU orden determinista
   * (el mismo que usan las salidas de esa dimensión), que es lo que evita el interbloqueo con
   * operaciones cruzadas. Devuelve un mapa por {@link textoClave}.
   *
   * `formaCongelada` sólo viaja al CERRAR la hoja (ver {@link FormaCongelada}); al CONGELAR va
   * ausente, porque en ese momento el catálogo de hoy ES la verdad.
   */
  leerExistenciasBloqueadas(
    tx: Tx,
    ctx: ContextoDimension,
    claves: readonly ClaveArticulo[],
    formaCongelada?: FormaCongelada,
  ): Promise<Map<string, Componentes>>;

  /** Siembra renglones POR LOTES (`createMany`) — nunca uno por uno (es la pantalla del arranque). */
  sembrar(
    tx: Tx,
    sesion: SesionUsuario,
    idInventario: number,
    renglones: readonly RenglonASembrar[],
  ): Promise<void>;

  /**
   * Valida la llave de un renglón AÑADIDO A MANO: que traiga los campos de ESTA dimensión (y sólo
   * ésos) y que los artículos existan. Devuelve la llave normalizada.
   */
  resolverClaveNueva(
    tx: Tx,
    ctx: ContextoDimension,
    entrada: DatosCiclicoRenglonAgregar,
  ): Promise<ClaveArticulo>;

  /** (4) Detalle DESCRITO y ORDENADO para la pantalla, la exactitud y la hoja impresa. */
  leer(cliente: ClienteLectura, idInventario: number): Promise<RenglonCiclico[]>;

  /** Guarda lo contado POR LOTES. */
  guardarConteo(
    tx: Tx,
    sesion: SesionUsuario,
    idInventario: number,
    capturas: readonly CapturaRenglon[],
  ): Promise<void>;

  /** Cuántos renglones tiene la hoja y cuántos están contados (para el estado). */
  contar(
    cliente: ClienteLectura,
    idInventario: number,
  ): Promise<{ total: number; contados: number }>;

  /** (3) Escribe UN movimiento de kardex con todas las líneas de una dirección. Devuelve su id. */
  registrarAjuste(
    tx: Tx,
    sesion: SesionUsuario,
    ctx: ContextoDimension,
    direccion: 'entrada' | 'salida',
    lineas: readonly LineaAjuste[],
    datos: { observaciones: string; idCiclico: number; fecha: Date },
  ): Promise<number>;

  /** Enlaza los renglones con el movimiento que los reconcilió (traza, por lotes). */
  enlazar(
    tx: Tx,
    sesion: SesionUsuario,
    idsDet: readonly number[],
    idMovimiento: number,
    direccion: 'entrada' | 'salida',
  ): Promise<void>;
}

/** Redondea a la escala de la dimensión (mata el ruido de la resta en coma flotante). */
export function redondear(valor: number, escala: 0 | 4): number {
  const factor = 10 ** escala;
  return Math.round(valor * factor) / factor;
}
