/**
 * 🔒 LA BITÁCORA TAPA EL DINERO AL LEERLA (fila 0.249 parte D + fila 0.255).
 *
 * La bitácora (A7) guarda el antes y el después de cada cambio EN CLARO: precios del modelo y de la
 * orden, maquilas reales, precios de tela, de avío y de compra, costos de la orden, el EDR, montos de
 * EsMa y de CxP/CxC, precios y factores de las listas, a quién se le paga en una corrida… Y la leen
 * (`admin.ver-bitacora`) roles que NO pueden ver esos números en su pantalla. Por ahí se escapaba lo
 * que cada pantalla tapa.
 *
 * **Se tapa al LEER, no al escribir.** Lo guardado queda COMPLETO (D3/A7: la bitácora es el rastro
 * inmutable; nadie toca `comun/auditoria.ts`), y las entradas viejas quedan cubiertas solas, sin
 * migrar nada (REGLA 0-B). Lo único que cambia es lo que viaja a quien consulta.
 *
 * 🔑 **Cada importe se tapa con LA MISMA LLAVE QUE SU PANTALLA.** Las reglas de abajo REUSAN la función
 * con que cada pantalla decide (`puedeVerPreciosDeTela`, `puedeVerFactoresDePrecio`, …): no hay una
 * segunda versión de quién ve qué. Si una pantalla cambia su regla, la bitácora la sigue sola.
 *
 * 🔑 **El mapa es por ENTIDAD + CLAVE**, y la clave se busca a CUALQUIER profundidad del JSON de esa
 * entidad (`{antes:{precio}}`, `colores[].precio`, `{de,a}` bajo la clave). Por entidad porque el
 * nombre solo no basta: `anterior` es un estatus en `OrdenCompra` y un monto en `Orden`; `total` es
 * dinero en `CorridaPago` y un conteo en `ProcesoDef`.
 *
 * 🔑 **Lo no declarado que suena a dinero se tapa por defecto** ({@link PARECE_DINERO}): con
 * `consultas.ver-importes` (la llave de dinero de uso general), salvo que el nombre lleve «factor»,
 * que va con la llave de los factores (`listas.aprobar`, {@link REGLA_FACTOR_DESCONOCIDO}); y unas
 * pocas claves tienen regla fija por nombre en cualquier entidad ({@link REGLAS_POR_NOMBRE}). Cubre
 * los VOLCADOS de fila completa (`aJsonBitacora(fila)`, p. ej. al eliminar una lista) cuyas columnas
 * ningún escáner de código ve, y cualquier campo nuevo que alguien escriba sin declararlo.
 *
 * ⚠️ **Un falso positivo NO siempre se le esconde sólo a quien no tiene llave de dinero.** Con el
 * default `importes`, sí (falla del lado seguro). Pero una clave desconocida con «factor» que en
 * realidad no sea dinero se le esconde también a quien VE importes y no factores (hoy, Gerencial). Los
 * falsos positivos medidos van a {@link NO_ES_DINERO} con su razón. Y el default sólo alcanza a los
 * NOMBRES que encajan con {@link PARECE_DINERO}: un dinero con nombre que no lo parece pasa en claro.
 * Por eso el guardián (`bitacora-guardian.test.ts`) exige que toda clave con nombre de dinero que el
 * CÓDIGO escribe tenga su regla explícita, y que toda ENTIDAD escrita esté en el mapa o declarada sin
 * dinero: el default es la red, no el diseño.
 *
 * Contrato: el valor tapado viaja como `{ "oculto": true }` ({@link OCULTO}) y el registro lleva
 * cuántos se taparon. Un valor `null` NO se tapa: vacío no revela ningún importe.
 *
 * ⚠️ **LÍMITES que ningún mapa resuelve** (declarados): texto libre con cifras (el `acuerdo` de un
 * evento de negociación, `notas`, `motivo`) y la aritmética (quien ve el precio y las piezas faltantes
 * de un descuento de maquila deduce el monto; precedente aceptado por Daniel en
 * `desarrollo/cliente-factores.ts`: *se oculta el NÚMERO, no la ARITMÉTICA*).
 */
import { tienePermiso, type SesionUsuario } from '../../comun/permisos.js';
import { puedeVerPreciosDeAvio, puedeVerPreciosDeTela } from '../catalogos/precios-de-catalogo.js';
import {
  puedeVerPreciosDeCompra,
  puedeVerPreciosDeRecepcion,
} from '../compras/precios-de-compra.js';
import { puedeVerFactoresDePrecio } from '../desarrollo/cliente-factores.js';
import { puedeVerCostoRealDeModelo } from '../modelos/modelos.js';
import {
  puedeVerMaquilaDeReferencia,
  puedeVerMetaConseguida,
  puedeVerMetaPrometida,
  puedeVerPreciosDeModelo,
  puedeVerPreciosDeOrden,
} from '../modelos/precios-de-modelo.js';
import { puedeVerCorrida } from '../pagos/acceso-corrida.js';

/**
 * Las reglas con nombre → quién puede ver. TODAS reusan la regla de la pantalla que enseña ese dato.
 */
export const REGLAS_BITACORA = {
  /** Corte base, precio del arte (`modelos/precios-de-modelo.ts`). */
  precioModelo: puedeVerPreciosDeModelo,
  /** Maquila base del modelo = maquila de referencia de la orden. */
  maquilaReferencia: puedeVerMaquilaDeReferencia,
  /** Precios congelados de la receta de la orden. */
  precioOrden: puedeVerPreciosDeOrden,
  /** Maquila/aplicación REAL de la orden, precio pactado del envío y del cierre de maquila. */
  maquilaReal: (s: SesionUsuario): boolean => tienePermiso(s, 'ordenes.ver-precio-real-maquila'),
  /** Precios del catálogo de telas (parte B). */
  precioTela: puedeVerPreciosDeTela,
  /** Precios del catálogo de avíos (parte B). */
  precioAvio: puedeVerPreciosDeAvio,
  /** Precio de compra (OC, explosión, proveedor de compra del material de una orden). */
  precioCompra: puedeVerPreciosDeCompra,
  /** Precios e importe de una recepción de compra (+ quien recibe). */
  precioRecepcion: puedeVerPreciosDeRecepcion,
  /** La llave de DINERO de uso general (EsMa, CxP/CxC, listas, cotizaciones, precostos). */
  importes: (s: SesionUsuario): boolean => tienePermiso(s, 'consultas.ver-importes'),
  /** Costo de la orden: `costos.ver` Y `consultas.ver-importes` (`costos/costo-orden.ts`). */
  costos: puedeVerCostoRealDeModelo,
  /** El EDR entero se protege con `edr.ver` (`edr/edr.ts`). */
  edr: (s: SesionUsuario): boolean => tienePermiso(s, 'edr.ver'),
  /** El precio de venta de una línea del EDR también lo enseña la facturación (`ventas.ver`). */
  ventaEdr: (s: SesionUsuario): boolean =>
    tienePermiso(s, 'edr.ver') || tienePermiso(s, 'ventas.ver'),
  /** Los cuatro factores de precio de una lista (`listas.aprobar`). */
  factores: puedeVerFactoresDePrecio,
  /** A quién se le paga en una corrida (fila 0.255): la llave de la corrida. */
  corrida: puedeVerCorrida,
  /** Cuánto se le paga en una corrida: la llave de la corrida Y ver importes (como su pantalla). */
  corridaMonto: (s: SesionUsuario): boolean =>
    puedeVerCorrida(s) && tienePermiso(s, 'consultas.ver-importes'),
  /** Lo prometido de la meta de costo del modelo. */
  metaPrometida: puedeVerMetaPrometida,
  /** Lo conseguido de la meta de costo del modelo (lo teclea quien firma). */
  metaConseguida: puedeVerMetaConseguida,
  /** El límite de crédito del proveedor: su ficha lo enseña a quien la abre. */
  fichaProveedor: (s: SesionUsuario): boolean =>
    tienePermiso(s, 'proveedores.ver') || tienePermiso(s, 'proveedores.administrar'),
  /** Las regalías de la etiqueta: su catálogo las enseña a quien lo abre. */
  etiquetaMarca: (s: SesionUsuario): boolean =>
    tienePermiso(s, 'etiquetas-marca.ver') || tienePermiso(s, 'etiquetas-marca.administrar'),
  /**
   * Los parámetros de precio de la empresa (utilidad sugerida, regalías base, costo de empaque base):
   * el precosto y la lista de precios los enseñan con `consultas.ver-importes`
   * (`costos/pre-costo.ts`); quien los TECLEA en la configuración (`empresas.administrar`) los lee.
   */
  configEmpresa: (s: SesionUsuario): boolean =>
    tienePermiso(s, 'consultas.ver-importes') || tienePermiso(s, 'empresas.administrar'),
} as const satisfies Readonly<Record<string, (s: SesionUsuario) => boolean>>;

/** Nombre de una regla de la bitácora. */
export type ReglaBitacora = keyof typeof REGLAS_BITACORA;

/** La regla con que se tapa lo NO declarado que suena a dinero. */
export const REGLA_POR_DEFECTO: ReglaBitacora = 'importes';

/** La regla con que se tapa lo NO declarado cuyo nombre lleva «factor» (más estricta que el default). */
export const REGLA_FACTOR_DESCONOCIDO: ReglaBitacora = 'factores';

/** ¿La clave nombra un factor? */
const FACTOR = /factor/i;

/** Las raíces de dinero, sin distinguir mayúsculas. */
const RAICES_DINERO =
  /precio|cost(?!ura)|monto|importe|maquila|corteBase|saldo|margen|utilidad|factor|descuento|bonific|regal|comision|tarifa|flete|pago|credito|subtotal|gastos|intereses|beneficiario/i;

/**
 * `iva` va APARTE y distinguiendo mayúsculas: sin distinguir, «iva» está dentro de «act**iva**do»,
 * «desact**iva**das»… (medido: los dos únicos aciertos del repo eran esos). Así sólo encaja como
 * palabra de camelCase: `iva`, `ivaTrasladado`, `montoIva`, `retieneIva`.
 */
const RAIZ_IVA = /(?:^iva|Iva)(?![a-z])/;

/**
 * ⭐ UNA sola prueba de «suena a dinero», compartida por el tapado (default) y por el guardián que
 * escanea el código. Cada raíz está MEDIDA contra todas las claves que el código manda a la bitácora
 * (los falsos positivos reales están en {@link NO_ES_DINERO}, con su razón):
 *  • `cost` y no `costo`: `telaCost`/`aviosCost`/`procesosCost` (`CostoOrden`) no contienen «costo»;
 *    `(?!ura)` porque `diasCostura` (`RangoDificultad`) son días.
 *  • `utilidad`, `factor`, `descuento`, `regal`, `bonific`: la utilidad sugerida y los factores de
 *    precio (`ConfiguracionEmpresa`, los `descartados` de la fusión de departamentos).
 *  • `pago` y `credito` dan falsos positivos medidos (`formaPago`, `diasCredito`), pero un monto de
 *    pago o un crédito nuevo sin declarar debe nacer tapado: se declaran los falsos, no se quita la raíz.
 *  • `beneficiario` no es un importe, pero dice a quién se le paga (fila 0.255).
 */
export const PARECE_DINERO: { readonly test: (clave: string) => boolean } = {
  test: (clave: string): boolean => RAICES_DINERO.test(clave) || RAIZ_IVA.test(clave),
};

/** Las claves de id (`idPrecostoNuevo`, `idMaquilero`…) nunca son dinero aunque lo parezcan. */
const ES_ID = /^id[A-Z]/;

/**
 * ⭐ Claves con REGLA FIJA POR NOMBRE, en CUALQUIER entidad (se consultan después del mapa de la
 * entidad y antes del default). Los cuatro factores de precio de un cliente o de una lista se tapan
 * SIEMPRE con la llave de los factores (`listas.aprobar`): tapados con el default (`importes`), los
 * vería Gerencial, que tiene `consultas.ver-importes` y no esa llave. Pasó: la fusión de
 * departamentos (`catalogos/cliente-departamentos.ts`, entidad `Cliente`) guardaba los factores
 * descartados y Gerencial los leía en claro.
 */
export const REGLAS_POR_NOMBRE: Readonly<Record<string, ReglaBitacora>> = {
  margenPct: 'factores',
  descuentosPct: 'factores',
  regaliasPct: 'factores',
  costoVentasPct: 'factores',
};

/**
 * entidad → clave → regla. La clave se busca a CUALQUIER profundidad del JSON de esa entidad. Cada
 * entrada nombra a su escritor (relativo a `src/dominio/`).
 */
export const MAPA_BITACORA: Readonly<Record<string, Readonly<Record<string, ReglaBitacora>>>> = {
  // modelos/modelos.ts (`{de,a}` al editar), modelos/bom-modelo.ts (`artesQueSeFueron[].precio`),
  // modelos/revision-modelo.ts (la meta de costo y sus anteriores).
  Modelo: {
    maquilaBase: 'maquilaReferencia',
    corteBase: 'precioModelo',
    precio: 'precioModelo',
    metaCostoPrometido: 'metaPrometida',
    metaCostoPrometidoAnterior: 'metaPrometida',
    metaCostoConseguido: 'metaConseguida',
    metaCostoConseguidoAnterior: 'metaConseguida',
  },
  // modelos/arte-modelo.ts (`precio{de,a}` y el arte íntegro).
  ModeloArte: { precio: 'precioModelo' },
  // produccion/receta-orden.ts (fotos íntegras de cada renglón, `cambios`, `antes`).
  RecetaOrden: { precio: 'precioOrden' },
  Orden: {
    // produccion/precios-orden.ts: `precio` es la ETIQUETA ('maquila'/'aplicacion') y los montos van
    // en las claves genéricas `anterior`/`nuevo`. Tapar la etiqueta junto con los montos es inocuo.
    precio: 'maquilaReal',
    anterior: 'maquilaReal',
    nuevo: 'maquilaReal',
    // compras/proveedor-de-orden.ts: el precio de compra del material asignado.
    precioAnterior: 'precioCompra',
    precioNuevo: 'precioCompra',
    // produccion/cierre-orden.ts: el costo unitario congelado al cerrar.
    costoUnitarioCongelado: 'costos',
  },
  // compras/color-de-la-tela.ts
  TelaColor: {
    precioAnterior: 'precioTela',
    precioNuevo: 'precioTela',
    precioComplementoAnterior: 'precioTela',
    precioComplementoNuevo: 'precioTela',
  },
  // catalogos/telas.ts
  Tela: {
    precio: 'precioTela',
    precioComplemento: 'precioTela',
    precioSugerido: 'precioTela',
    precioSugeridoComplemento: 'precioTela',
  },
  // catalogos/tela-proveedores.ts
  TelaProveedor: { precio: 'precioTela' },
  // catalogos/avios.ts, catalogos/avio-medidas.ts (`desactivadas[].precio`)
  Avio: { precioReferencia: 'precioAvio', precio: 'precioAvio' },
  // catalogos/proveedores.ts: el precio del avío que surte, y el límite de crédito de la ficha.
  Proveedor: { precio: 'precioAvio', limiteCredito: 'fichaProveedor' },
  // catalogos/proveedores.ts: el escáner lo ve por compartir el identificador `datos` con la ficha
  // del proveedor; un contacto no guarda dinero, pero si algún día lo hiciera queda con la regla de
  // su ficha.
  ProveedorContacto: { limiteCredito: 'fichaProveedor' },
  // catalogos/etiquetas-marca.ts
  EtiquetaMarca: { regalias: 'etiquetaMarca' },
  // compras/recepciones.ts (`preciosCorregidos[]{precioOc,recibido}`; `recibido` lo cubre el padre).
  RecepcionCompra: {
    importe: 'precioRecepcion',
    preciosCorregidos: 'precioRecepcion',
    precioOc: 'precioRecepcion',
    recibido: 'precioRecepcion',
  },
  // costos/costo-orden.ts (`baseProrrateo` son piezas).
  CostoOrden: {
    telaCost: 'costos',
    procesosCost: 'costos',
    aviosCost: 'costos',
    otros: 'costos',
    costoTotal: 'costos',
    telaReal: 'costos',
    aviosReal: 'costos',
  },
  // produccion/etapas.ts
  EtapaMovimiento: { precioPactado: 'maquilaReal' },
  // produccion/cierre-maquila.ts
  CierreMaquilaOrden: { precio: 'maquilaReal' },
  // produccion/cierre-maquila.ts (`precio` = maquila real; `monto` = el descuento) + esma/*.
  DescuentoMaquilero: { precio: 'maquilaReal', monto: 'importes' },
  // esma/movimientos.ts, esma/correccion.ts, esma/migracion.ts
  AbonoMaquilero: { monto: 'importes' },
  // esma/pagos.ts (`aplicaciones[].cantidad` son PIEZAS, no dinero), esma/correccion.ts, migracion.
  PagoMaquilero: { monto: 'importes' },
  // esma/cargos.ts (`cantidadReal` son piezas).
  EsMaCargo: { precioReal: 'importes' },
  // terceros/cuenta-terceros.ts, pagos/cotejo.ts (`antes`/`despues` contienen `monto`/`importe`).
  MovimientoTercero: { monto: 'importes', importe: 'importes' },
  // pagos/corrida.ts — fila 0.255: `total` es dinero aquí (genérica).
  CorridaPago: { total: 'corridaMonto' },
  // pagos/corrida.ts — fila 0.255: a quién (`nombre`, `beneficiario`) y cuánto (`monto`).
  RenglonCorridaPago: {
    nombre: 'corrida',
    beneficiario: 'corrida',
    monto: 'corridaMonto',
    montoAnterior: 'corridaMonto',
  },
  // desarrollo/listas-precios.ts (incluidos los volcados de `quitar-linea`/`eliminar-lista`),
  // desarrollo/negociacion.ts, desarrollo/pendientes-linea.ts.
  ListaPrecios: {
    precio: 'importes',
    precioTarget: 'importes',
    costoEstimado: 'importes',
    costoUnit: 'importes',
    precioCalculado: 'importes',
    precioAprobado: 'importes',
    precioAprobadoAnterior: 'importes',
    precioAnterior: 'importes',
    precioNuevo: 'importes',
    precioUnit: 'importes',
    importe: 'importes',
    margenPct: 'factores',
    descuentosPct: 'factores',
    regaliasPct: 'factores',
    costoVentasPct: 'factores',
  },
  // desarrollo/cotizaciones.ts (`renglones[].precioUnit`).
  Cotizacion: { precioUnit: 'importes' },
  // desarrollo/precostos.ts
  Precosto: { costoTotal: 'importes' },
  // edr/edr.ts — `otros` es dinero aquí (genérica).
  Edr: { gastos: 'edr', intereses: 'edr', bonificaciones: 'edr', otros: 'edr' },
  // edr/edr.ts
  EdrLinea: { precioVenta: 'ventaEdr' },
  // catalogos/cliente-departamentos.ts — la fusión de departamentos guarda los factores DESCARTADOS
  // (`descartados[]`, armado en `cliente-departamentos-fusion-referencias.ts`). Los cubre también
  // REGLAS_POR_NOMBRE; aquí quedan explícitos.
  Cliente: {
    margenPct: 'factores',
    descuentosPct: 'factores',
    regaliasPct: 'factores',
    costoVentasPct: 'factores',
  },
  // catalogos/colores.ts — la fusión de colores guarda el precio por color de proveedor de tela que
  // se descartó (`descartados[].precio`, armado en `colores-fusion-referencias.ts`).
  Color: { precio: 'precioTela' },
  // admin/empresas.ts — escribe las claves de la configuración de forma DINÁMICA
  // (`Object.fromEntries(Object.entries(datos))`): el escáner no las ve, se declaran a mano. Las de
  // dinero son las tres de abajo; `colchonCostura`/`agingLimite*` son días, `pctDesvioCompra` es la
  // tolerancia de desvío de una compra (un porcentaje, no un precio).
  ConfiguracionEmpresa: {
    utilidadSugerida: 'configEmpresa',
    regaliasBase: 'configEmpresa',
    costoEmpaqueBase: 'configEmpresa',
  },
};

/**
 * Lo que tiene nombre de dinero y NO lo es, por entidad, con su razón. Pasa en claro.
 */
export const NO_ES_DINERO: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  RecetaOrden: {
    paraCosto: 'bandera: el renglón entra al costeo',
    paraPreCosto: 'bandera: el renglón entra al precosto',
  },
  TelaColor: {
    precioDelColorDesdeLaCompra: 'bandera: el precio del color se fijó desde la explosión',
  },
  TelaProveedor: { manejaPrecioPorColor: 'bandera: el proveedor cobra distinto por color' },
  Precosto: { sinPrecioCatalogo: 'booleano/conteo: renglones sin precio de catálogo' },
  EsMaCargo: { sinCosto: 'bandera: el cargo nació sin costo' },
  CorridaPago: { renglonesConMonto: 'conteo de renglones' },
  Cotizacion: { versionPrecosto: 'número de versión del precosto' },
  Cliente: {
    factores:
      'etiqueta: qué factores se guardaron («default» o el id del departamento), sin valores',
    diasCredito: 'días de crédito (plazo, no un importe); la ficha del cliente lo enseña',
  },
  FactorCantidad: { factor: 'multiplicador de CANTIDAD (piezas), no de precio' },
  ListaPrecios: { factoresCambiaron: 'bandera: los factores de la lista cambiaron' },
  ConceptoPago: { formaPagoPreferida: 'texto: efectivo / transferencia / cheque' },
  RenglonCorridaPago: {
    formaPago: 'texto: efectivo / transferencia / cheque',
    formaPagoAnterior: 'texto: efectivo / transferencia / cheque',
  },
  Proveedor: {
    formaPago: 'clave SAT de forma de pago (texto)',
    formaPagoPreferida: 'texto: efectivo / transferencia / cheque',
    metodoPago: 'clave SAT de método de pago (PUE/PPD)',
    obsPago: 'ya se guarda como `{ cambio: true }` (parte A): nunca lleva el texto',
    diasCredito: 'días de crédito (plazo); la ficha lo enseña con `proveedores.ver`',
    retieneIva: 'bandera fiscal: si se le retiene IVA',
  },
  // El escáner las atribuye al contacto porque `catalogos/proveedores.ts` usa el mismo nombre
  // (`detalle`) para la ficha y para el contacto; un contacto no las guarda. Mismas razones.
  ProveedorContacto: {
    formaPago: 'clave SAT de forma de pago (texto)',
    formaPagoPreferida: 'texto: efectivo / transferencia / cheque',
    metodoPago: 'clave SAT de método de pago (PUE/PPD)',
    obsPago: 'ya se guarda como `{ cambio: true }` (parte A): nunca lleva el texto',
    diasCredito: 'días de crédito (plazo)',
    retieneIva: 'bandera fiscal: si se le retiene IVA',
  },
  ProveedorCuentaPago: {
    beneficiario: 'se guarda como `{ cambio: true }` (parte A): nunca lleva el nombre',
  },
  ConceptoPagoCuenta: {
    beneficiario: 'se guarda como `{ cambio: true }` (parte A): nunca lleva el nombre',
  },
};

/** El centinela con que viaja un valor tapado. */
export const OCULTO: Readonly<{ oculto: true }> = Object.freeze({ oculto: true });

/**
 * La regla que gobierna una clave de una entidad, o `undefined` si pasa en claro, en este orden: la
 * explícita del mapa de la entidad; la fija por nombre ({@link REGLAS_POR_NOMBRE}); nada si es un id
 * o está declarada como «no es dinero»; `factores` si suena a dinero y su nombre lleva «factor»; y el
 * default (`importes`) si suena a dinero.
 */
export function reglaDeClave(entidad: string, clave: string): ReglaBitacora | undefined {
  // `Object.hasOwn` y no `MAPA[e]?.[c]`: una clave `constructor`/`__proto__` en el JSON guardado
  // encontraría el PROTOTIPO del objeto del mapa y lo tomaría por una regla.
  const delMapa = Object.hasOwn(MAPA_BITACORA, entidad) ? MAPA_BITACORA[entidad] : undefined;
  if (delMapa !== undefined && Object.hasOwn(delMapa, clave)) return delMapa[clave];
  if (Object.hasOwn(REGLAS_POR_NOMBRE, clave)) return REGLAS_POR_NOMBRE[clave];
  if (ES_ID.test(clave)) return undefined;
  const noEs = Object.hasOwn(NO_ES_DINERO, entidad) ? NO_ES_DINERO[entidad] : undefined;
  if (noEs !== undefined && Object.hasOwn(noEs, clave)) return undefined;
  if (!PARECE_DINERO.test(clave)) return undefined;
  // Un FACTOR desconocido se tapa con la llave de los factores, no con la de importes: con
  // `importes` lo vería Gerencial (ver {@link REGLAS_POR_NOMBRE}).
  return FACTOR.test(clave) ? REGLA_FACTOR_DESCONOCIDO : REGLA_POR_DEFECTO;
}

/** Lo que devuelve el tapado: los datos a enviar y cuántos valores se taparon. */
export interface DatosTapados {
  datos: unknown;
  datosOcultos: number;
}

/**
 * ⭐ Tapa los datos de UN registro de bitácora para esta sesión. Proyección pura: nunca muta lo que
 * recibe (devuelve copias donde hay algo que tapar).
 *
 * En cada objeto, a cualquier profundidad, cada clave con regla que la sesión NO cumple se sustituye
 * por {@link OCULTO} sin descender (sea número, `{de,a}`, arreglo u objeto); un `null` se deja tal cual.
 * Si la sesión cumple TODAS las reglas, devuelve los datos intactos.
 */
export function taparDatosBitacora(
  sesion: SesionUsuario,
  entidad: string,
  datos: unknown,
): DatosTapados {
  const cumple = new Map<ReglaBitacora, boolean>();
  let todas = true;
  for (const nombre of Object.keys(REGLAS_BITACORA) as ReglaBitacora[]) {
    const ok = REGLAS_BITACORA[nombre](sesion);
    cumple.set(nombre, ok);
    if (!ok) todas = false;
  }
  if (todas) return { datos, datosOcultos: 0 };

  let datosOcultos = 0;
  const recorrer = (valor: unknown): unknown => {
    if (Array.isArray(valor)) return valor.map(recorrer);
    if (valor === null || typeof valor !== 'object') return valor;
    const salida: Record<string, unknown> = {};
    for (const [clave, v] of Object.entries(valor)) {
      const regla = reglaDeClave(entidad, clave);
      const tapar = regla !== undefined && v !== null && cumple.get(regla) !== true;
      if (tapar) datosOcultos += 1;
      // `defineProperty` y no `salida[clave] =`: una clave `__proto__` en el JSON guardado sería
      // una propiedad más, no un cambio de prototipo.
      Object.defineProperty(salida, clave, {
        value: tapar ? OCULTO : recorrer(v),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return salida;
  };
  return { datos: recorrer(datos), datosOcultos };
}
