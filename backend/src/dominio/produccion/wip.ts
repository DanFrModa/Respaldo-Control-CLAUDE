/**
 * TABLERO WIP + existencias en poder del maquilero (F3-E5; doc 03-Produccion, form `Proceso` +
 * `MaqExis`). Son CONSULTAS de SOLO LECTURA: todo el avance se DERIVA por suma directa de
 * `EtapaMovimientoDet` (sin acumuladores ni columnas — D3/D4), excluyendo etapas canceladas
 * (`canceladoEn IS NULL`). Toda la lógica vive AQUÍ (A1); las rutas REST solo validan permiso + Zod
 * y delegan.
 *
 * Fórmulas del avance por orden (form `Proceso` del viejo; cada una excluye canceladas):
 *  • Por cortar          = pedido(orden) − cortado
 *  • Cortado por enviar  = cortado − enviado            (por proceso/TipoProceso, D8)
 *  • Por recibir         = enviado − recibido − incompletas − faltantes saldados   (por proceso/TipoProceso)
 *  • Entregado a cliente = Σ entregas (etapa `entrega_cliente`)
 *  • Por entregar        = recibido(costura, procesos `generaEntradaPt`) − entregado a cliente
 *  • Empacado            = Σ empaques (etapa `empaque`, 0.114). SIN pendiente derivado: la cantidad
 *    del empaque es PROPIA y no se topa contra nada (*«se fabrican 1,000 y se empacan 990; se paga
 *    lo empacado y las 10 se quedan quietas en inventario»*), así que un «por empacar» sería una
 *    resta que el negocio no hace.
 *
 * Decisión de "por entregar": el viejo entregaba al cliente lo que ya estaba en PT (lo metido por el
 * recibo de COSTURA, `TipoProceso.generaEntradaPt`). Por eso la base de "por entregar" es el
 * recibido de los procesos que meten a PT, NO el recibido total (el estampado/bordado no es lo que
 * se entrega como prenda terminada; es un paso intermedio sobre la misma pieza). Si una orden no
 * tuvo proceso que meta a PT, `recibidoCostura` = 0 y `porEntregar` = −entregado (raro; se muestra
 * tal cual, igual que el sobre-corte negativo).
 *
 * Innegociables aplicados:
 *  • A1 — la lógica vive en este módulo; las rutas son delgadas.
 *  • A4 — toda consulta re-verifica `produccion.wip-ver` (deny-by-default).
 *  • A9 — todo se filtra por la empresa ACTIVA de la sesión (una orden de otra empresa no existe).
 *  • D3/D4 — derivado por suma directa de `EtapaMovimientoDet`, por color×talla, sin acumuladores.
 *
 * Las banderas/flags del querystring se re-validan en el dominio con esquemas LOCALES `z.boolean()`
 * (no el `stringbool` del contrato) — evita el 400 espurio del hotfix F2 (PR #56). La consulta del
 * maquilero la REUSARÁ EsMa en F6 (base del cargo/cuenta corriente).
 *
 * ⭐ LAS PRENDAS INCOMPLETAS RESTAN DEL PENDIENTE (V1-E8v, §Post-F9.147). DANIEL: *"Al registrarlas
 * como incompletas entregadas, dejan de estar en la maquila"*. Ya volvieron del taller, así que
 * salen del tránsito aunque no se produzcan, no se inventaríen y no se paguen. Todas las fórmulas
 * de "por recibir" / "en poder del maquilero" de este módulo restan `incompletas` por la MISMA
 * función, {@link pendientePorCelda} (`produccion/incompletas.ts`), que es también el tope que
 * valida el guardado bajo lock. Lo que queda en el pendiente es el FALTANTE: lo que nunca volvió y
 * se le cobra.
 */
import { z } from 'zod';

import type {
  ExistenciaMaquileroLista,
  TableroWipPagina,
  WipMaquileroPendiente,
  WipOrden,
  WipTotales,
} from '../../contrato/index.js';
import { esquemaEstadoOrden } from '../../contrato/esquemas/orden.js';
import { TipoEtapaMovimiento, type EstadoOrden, type Prisma } from '../../datos/index.js';

import { ErrorNoEncontrado } from '../../comun/errores.js';
import { esquemaPaginacion, type Paginacion } from '../../comun/paginacion.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import {
  saldadosPorOrden,
  saldadosPorTercero,
  totalSaldable,
  totalSaldadoDeOrdenes,
} from './faltantes-saldados.js';
import { pendientePorCelda } from './incompletas.js';
import { SIN_PACK, claveCeldaPack, normalizarPack } from './packs.js';
import { armarBusquedaConSinonimos } from './ordenes.js';

/** Cliente de LECTURA (sin transacción) — el tipo del resultado de `clienteLectura`. */
type ClienteLectura = ReturnType<typeof clienteLectura>;

// ── Helpers de suma directa (DERIVADO, sin acumuladores) ──────────────────────────────────────────

/**
 * Clave estable de una celda del WIP: color×talla×PACK (§Post-F9.10). El saldo de producción se
 * lleva tendido por tendido, así que el pendiente que esta pantalla OFRECE tiene que estar partido
 * igual que el que el guardado TOPA. Con `claveCeldaPack` compartida con `packs.ts` las dos caras
 * usan literalmente la misma llave.
 */
function claveCelda(idColor: number, idTalla: number, pack: string): string {
  return claveCeldaPack(idColor, idTalla, pack);
}

/**
 * Clave PLEGADA (color×talla, sin pack) para lo que NO maneja packs: la entrega a cliente, donde
 * *«ya es sólo color»* (§Post-F9.10). Mezclarla con la de arriba habría hecho que las celdas de
 * entrega no encontraran su metadato y salieran sin nombre de color ni etiqueta de talla.
 */
function claveCeldaPlegada(idColor: number, idTalla: number): string {
  return `${idColor}:${idTalla}`;
}

/**
 * Suma una columna de `EtapaMovimientoDet` POR ORDEN (un total por orden) para un conjunto de
 * órdenes y un filtro de tipo (+ opcionalmente "solo procesos que meten a PT"), en UNA sola consulta
 * agregada (groupBy en la base; no trae el detalle a memoria). Solo etapas VIVAS (canceladas
 * excluidas). Devuelve `idOrden → total`; las órdenes sin etapas de ese tipo no aparecen (se
 * proyectan con 0).
 *
 * `columna` elige QUÉ se suma: `cantidad` (piezas buenas, el caso normal) o `cantidadIncompletas`
 * (las prendas incompletas del recibo, V1-E8v). Son columnas DISTINTAS a propósito: mezclarlas en
 * una sola sería justo lo que §Post-F9.136 prohíbe (las incompletas no producen, no inventarían y
 * no se pagan) — lo que sí comparten desde §Post-F9.147 es que las dos cierran el pendiente.
 */
async function totalesPorOrden(
  cliente: ClienteLectura,
  idsOrden: number[],
  tipo: TipoEtapaMovimiento,
  opciones: { soloEntradaPt?: boolean; columna?: 'cantidad' | 'cantidadIncompletas' } = {},
): Promise<Map<number, number>> {
  const totales = new Map<number, number>();
  if (idsOrden.length === 0) {
    return totales;
  }
  const where: Prisma.EtapaMovimientoDetWhereInput = {
    etapaMov: {
      idOrden: { in: idsOrden },
      tipo,
      canceladoEn: null,
      ...(opciones.soloEntradaPt ? { tipoProceso: { generaEntradaPt: true } } : {}),
    },
  };
  const columna = opciones.columna ?? 'cantidad';
  const filas = await cliente.etapaMovimientoDet.groupBy({
    by: ['idEtapaMov'],
    where,
    _sum: { cantidad: true, cantidadIncompletas: true },
  });
  // groupBy por etapa da el total por etapa; reagrupamos por orden con un par (idEtapaMov, idOrden).
  const idsEtapa = filas.map((f) => f.idEtapaMov);
  const etapas = await cliente.etapaMovimiento.findMany({
    where: { id: { in: idsEtapa } },
    select: { id: true, idOrden: true },
  });
  const ordenPorEtapa = new Map(etapas.map((e) => [e.id, e.idOrden]));
  for (const f of filas) {
    const idOrden = ordenPorEtapa.get(f.idEtapaMov);
    if (idOrden === undefined) continue;
    totales.set(idOrden, (totales.get(idOrden) ?? 0) + (f._sum[columna] ?? 0));
  }
  return totales;
}

/**
 * Total pedido (Σ de la matriz `OrdenLineaTalla`) por orden, para un conjunto de órdenes.
 * Exportada: el Resumen operativo (R9) la reusa para las piezas de "órdenes por vencer".
 */
export async function pedidoPorOrden(
  cliente: ClienteLectura,
  idsOrden: number[],
): Promise<Map<number, number>> {
  const totales = new Map<number, number>();
  if (idsOrden.length === 0) {
    return totales;
  }
  const filas = await cliente.ordenLineaTalla.groupBy({
    by: ['idOrdenLinea'],
    where: { ordenLinea: { idOrden: { in: idsOrden } } },
    _sum: { cantidad: true },
  });
  const renglones = await cliente.ordenLinea.findMany({
    where: { idOrden: { in: idsOrden } },
    select: { id: true, idOrden: true },
  });
  const ordenPorRenglon = new Map(renglones.map((r) => [r.id, r.idOrden]));
  for (const f of filas) {
    const idOrden = ordenPorRenglon.get(f.idOrdenLinea);
    if (idOrden === undefined) continue;
    totales.set(idOrden, (totales.get(idOrden) ?? 0) + (f._sum.cantidad ?? 0));
  }
  return totales;
}

/**
 * Suma `EtapaMovimientoDet` de UNA orden para un filtro de tipo (+ proceso opcional), leyendo el
 * detalle DIRECTO. Solo etapas vivas. Base de los pendientes por celda del drill-down.
 *
 * `plegarPack` elige la llave: por defecto color×talla×PACK (corte y envío, que llevan tendido), y
 * `true` para lo que NO maneja packs —la entrega a cliente—, donde la llave es color×talla.
 */
async function sumarCeldasOrden(
  cliente: ClienteLectura,
  idOrden: number,
  tipo: TipoEtapaMovimiento,
  idTipoProceso?: number,
  plegarPack = false,
): Promise<Map<string, number>> {
  const filas = await cliente.etapaMovimientoDet.findMany({
    where: {
      etapaMov: {
        idOrden,
        tipo,
        canceladoEn: null,
        ...(idTipoProceso === undefined ? {} : { idTipoProceso }),
      },
    },
    select: { idColor: true, idTalla: true, pack: true, cantidad: true },
  });
  const acumulado = new Map<string, number>();
  for (const f of filas) {
    const clave = plegarPack
      ? claveCeldaPlegada(f.idColor, f.idTalla)
      : claveCelda(f.idColor, f.idTalla, f.pack);
    acumulado.set(clave, (acumulado.get(clave) ?? 0) + f.cantidad);
  }
  return acumulado;
}

/**
 * Igual que {@link sumarCeldasOrden} pero AGRUPANDO POR TERCERO (el maquilero del movimiento):
 * devuelve, por cada `idTercero` (o `null` en lo migrado sin dato), su matriz color×talla y el
 * nombre para pintarlo. Es la base del desglose "por recibir POR MAQUILERO" (regla de Daniel del
 * 28-jul-2026: no se recibe de quien no recibió el corte).
 *
 * `Sin asignar` es el MISMO literal que usa {@link consultarExistenciaMaquilero} para el histórico
 * migrado sin tercero: las dos vistas del módulo tienen que nombrar igual al mismo hueco.
 */
async function sumarCeldasPorTercero(
  cliente: ClienteLectura,
  idOrden: number,
  tipo: TipoEtapaMovimiento,
  idTipoProceso: number,
): Promise<
  Map<
    number | null,
    { nombre: string; celdas: Map<string, number>; incompletas: Map<string, number> }
  >
> {
  const filas = await cliente.etapaMovimientoDet.findMany({
    where: { etapaMov: { idOrden, tipo, idTipoProceso, canceladoEn: null } },
    select: {
      idColor: true,
      idTalla: true,
      pack: true,
      cantidad: true,
      cantidadIncompletas: true,
      etapaMov: { select: { idTercero: true, tercero: { select: { nombre: true } } } },
    },
  });
  // `celdas` = piezas BUENAS (lo producido/enviado); `incompletas` = las prendas incompletas que
  // ese tercero entregó (V1-E8k). Van SEPARADAS a propósito, y NO porque cuenten distinto en el
  // pendiente —desde V1-E8v las dos lo cierran igual (§Post-F9.147)—: separadas porque sólo las
  // BUENAS producen, se inventarían y se pagan. En envíos/cortes la columna es NULL y el mapa
  // queda vacío.
  const porTercero = new Map<
    number | null,
    { nombre: string; celdas: Map<string, number>; incompletas: Map<string, number> }
  >();
  for (const f of filas) {
    const idTercero = f.etapaMov.idTercero;
    let grupo = porTercero.get(idTercero);
    if (grupo === undefined) {
      grupo = {
        nombre: f.etapaMov.tercero?.nombre ?? 'Sin asignar',
        celdas: new Map(),
        incompletas: new Map(),
      };
      porTercero.set(idTercero, grupo);
    }
    // ⭐ La llave lleva el PACK. Un recibo capturado SIN pack (el maquilero los devolvió revueltos,
    // §Post-F9.10) cae en el bucket vacío, y de ahí sale la celda NEGATIVA del desglose: es lo
    // devuelto sin decir de qué tendido era. Se deja ver a propósito — sin ella, Σ celdas dejaría de
    // dar `totalPendiente` y el desglose contradiría a su propio total.
    const clave = claveCelda(f.idColor, f.idTalla, f.pack);
    grupo.celdas.set(clave, (grupo.celdas.get(clave) ?? 0) + f.cantidad);
    const inc = f.cantidadIncompletas ?? 0;
    if (inc > 0) {
      grupo.incompletas.set(clave, (grupo.incompletas.get(clave) ?? 0) + inc);
    }
  }
  return porTercero;
}

/**
 * El PRECIO PACTADO de cada maquilero en un proceso de la orden: el del ENVÍO vivo más reciente que
 * lo traiga. Es la base del cobro que se PROPONDRÍA al cerrar la orden con él (V1, fila 0.109), y
 * sale del mismo sitio que usa `cierre-maquila.ts` al cerrar de verdad: el envío, no la orden.
 *
 * `null` cuando ninguno de sus envíos trae precio — el caso del histórico migrado (1,309 envíos sin
 * `precioPactado`). Ahí el cierre SALDA igual pero no propone cobro, y la pantalla lo dice con
 * nombre en vez de enseñar un importe inventado.
 */
async function preciosPorTercero(
  cliente: ClienteLectura,
  idOrden: number,
  idTipoProceso: number,
): Promise<Map<number, number>> {
  const envios = await cliente.etapaMovimiento.findMany({
    where: {
      idOrden,
      idTipoProceso,
      tipo: TipoEtapaMovimiento.envio_maquila,
      canceladoEn: null,
      idTercero: { not: null },
      precioPactado: { not: null },
    },
    select: { idTercero: true, precioPactado: true },
    orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
  });
  const precios = new Map<number, number>();
  for (const e of envios) {
    // El primero que aparece por tercero es el más reciente (el `orderBy` manda): no se pisa.
    if (e.idTercero === null || e.precioPactado === null || precios.has(e.idTercero)) continue;
    precios.set(e.idTercero, e.precioPactado.toNumber());
  }
  return precios;
}

/**
 * Pliega el agrupado por tercero en la matriz TOTAL del proceso (evita repetir la consulta).
 * `campo` elige qué se pliega: las piezas buenas o las prendas incompletas (V1-E8k).
 */
function plegarPorTercero(
  porTercero: Map<
    number | null,
    { nombre: string; celdas: Map<string, number>; incompletas: Map<string, number> }
  >,
  campo: 'celdas' | 'incompletas' = 'celdas',
): Map<string, number> {
  const total = new Map<string, number>();
  for (const grupo of porTercero.values()) {
    for (const [clave, cantidad] of grupo[campo]) {
      total.set(clave, (total.get(clave) ?? 0) + cantidad);
    }
  }
  return total;
}

/**
 * "Por recibir" de un proceso DESGLOSADO POR MAQUILERO: `enviado − buenas − incompletas − faltantes saldados` de cada
 * tercero, por color×talla (V1-E8v, §Post-F9.147: la incompleta ya volvió, así que sale del
 * tránsito). Lo comparten el drill-down del WIP y los pendientes del recibo (`recibos.ts`) para
 * que las dos pantallas de recibo que existen ofrezcan y topen EXACTAMENTE lo mismo.
 *
 * Se enumeran los terceros que aparecen en envíos **o** en recibos vivos: un maquilero con recibos
 * y sin envío (posible en lo migrado, donde `Recibos.IdMaquileros` era independiente de
 * `Entregas.IdMaquileros`) tiene pendiente NEGATIVO y no puede desaparecer del desglose — si no,
 * `Σ porMaquilero ≠ totalPendiente` y el drill-down contradiría a "Existencias en poder del
 * maquilero", que sí lo cuenta (hallazgo del reviewer).
 */
export async function pendientePorMaquilero(
  cliente: ClienteLectura,
  idOrden: number,
  idTipoProceso: number,
  meta: Map<string, MetaCelda>,
  opciones: { ocultarPrecio: boolean },
): Promise<{
  porMaquilero: WipMaquileroPendiente[];
  enviado: Map<string, number>;
  recibido: Map<string, number>;
  /** Prendas INCOMPLETAS ya entregadas, por celda (V1-E8k). SÍ restan del pendiente (V1-E8v). */
  incompletas: Map<string, number>;
  /** Faltantes ya SALDADOS por cierres vivos, por celda (V1, fila 0.109). También restan. */
  saldados: Map<string, number>;
}> {
  const [enviadoPorTercero, recibidoPorTercero, saldadoPorTercero, precioPorTercero] =
    await Promise.all([
      sumarCeldasPorTercero(cliente, idOrden, TipoEtapaMovimiento.envio_maquila, idTipoProceso),
      sumarCeldasPorTercero(cliente, idOrden, TipoEtapaMovimiento.recibo_maquila, idTipoProceso),
      saldadosPorTercero(cliente, idOrden, idTipoProceso),
      preciosPorTercero(cliente, idOrden, idTipoProceso),
    ]);

  // Los terceros con envío, con recibo **o con cierre**: quien ya cerró no puede desaparecer del
  // desglose, porque su historia (cuántas piezas se le saldaron) es parte de la trazabilidad.
  const terceros = new Set<number | null>([
    ...enviadoPorTercero.keys(),
    ...recibidoPorTercero.keys(),
    ...saldadoPorTercero.keys(),
  ]);
  const porMaquilero = [...terceros].map((idTercero) => {
    const grupoEnviado = enviadoPorTercero.get(idTercero);
    const grupoRecibido = recibidoPorTercero.get(idTercero);
    // `null` (histórico migrado sin tercero) nunca tiene cierres: no se le puede cerrar la orden a
    // «Sin asignar» (a nadie se le cobra un faltante sin nombre), así que ahí el mapa va vacío.
    const saldadoDelTercero = idTercero === null ? undefined : saldadoPorTercero.get(idTercero);
    const claves = new Set<string>([
      ...(grupoEnviado?.celdas.keys() ?? []),
      ...(grupoRecibido?.celdas.keys() ?? []),
      ...(saldadoDelTercero?.keys() ?? []),
    ]);
    const celdasConPendiente = ordenarCeldas(
      [...claves].map((clave) => {
        const m = metaPara(meta, clave);
        return {
          ...m,
          // PENDIENTE = enviado − buenas − incompletas − faltantes saldados, por la MISMA función que usa el tope de
          // `registrarReciboMaquila` bajo lock (V1-E8v, §Post-F9.147). Es UN SOLO número: lo que el
          // maquilero todavía tiene y lo que todavía se le puede recibir son lo mismo desde que la
          // incompleta sale del tránsito. Lo que quede aquí cuando ya cerró su entrega es el
          // FALTANTE, que es lo que se le cobra.
          //
          // ⭐ CON PACKS (§Post-F9.10) la celda es por TENDIDO, y hay que leer esto con cuidado
          // para no afirmar de más: la ARITMÉTICA es la misma que la del guardado, pero el tope de
          // un renglón CON pack es esta celda, mientras que el de uno SIN pack es la SUMA de las
          // celdas de ese color×talla (el agregado), porque *«un recibo sin pack consume del saldo
          // agregado»*. Por eso lo devuelto sin pack cae en el bucket de pack vacío —en negativo—
          // en vez de repartirse entre los tendidos: así Σ celdas sigue dando `totalPendiente` y
          // el agregado que el servidor topa se lee directo del desglose, sumándolo.
          cantidad: pendientePorCelda(
            grupoEnviado?.celdas.get(clave) ?? 0,
            (grupoRecibido?.celdas.get(clave) ?? 0) + (grupoRecibido?.incompletas.get(clave) ?? 0),
            // ⭐ V1 (fila 0.109): lo ya SALDADO al cerrar la orden con este maquilero sale del
            // pendiente. Es lo que vuelve cobrable al faltante — mientras el faltante ERA el
            // pendiente, cobrarlo no bajaba nada.
            saldadoDelTercero?.get(clave) ?? 0,
          ),
          // Las incompletas viajan al lado, informativas: la trazabilidad de las cuatro cubetas que
          // pidió Daniel (enviado = primeras + segundas + faltantes + incompletas).
          incompletas: grupoRecibido?.incompletas.get(clave) ?? 0,
        };
      }),
    );
    const celdas = celdasConPendiente
      .filter((c) => c.cantidad !== 0 || c.incompletas !== 0)
      .map(({ ordenTalla: _o, ...resto }) => resto);
    // ⭐⭐ LO QUE DE VERDAD SE PUEDE SALDAR, por la MISMA función que el servidor usa al CERRAR
    // (`celdasSaldables`/`totalSaldable`, `faltantes-saldados.ts`): pliega por color×talla y se
    // queda con lo positivo. NO es `totalPendiente` —la suma plana—, y la diferencia es dinero:
    // con `+5` en una talla y `−5` en otra, la suma plana da 0 (el botón no aparecería nunca y la
    // orden migrada nunca se podría cerrar) mientras hay 5 piezas que saldar; y con `+5` y `−3` da
    // 2 mientras el descuento saldría por 5. Una celda no le presta saldo a otra.
    const faltantesSaldables = totalSaldable(
      celdasConPendiente.map((c) => ({
        idColor: c.idColor,
        idTalla: c.idTalla,
        pendiente: c.cantidad,
      })),
    );
    const faltantesSaldados = [...(saldadoDelTercero?.values() ?? [])].reduce((s, v) => s + v, 0);
    const totalPendiente = pendientePorCelda(
      [...(grupoEnviado?.celdas.values() ?? [])].reduce((s, v) => s + v, 0),
      [...(grupoRecibido?.celdas.values() ?? [])].reduce((s, v) => s + v, 0) +
        [...(grupoRecibido?.incompletas.values() ?? [])].reduce((s, v) => s + v, 0),
      faltantesSaldados,
    );
    const precio = idTercero === null ? null : (precioPorTercero.get(idTercero) ?? null);
    return {
      idMaquilero: idTercero,
      maquilero: grupoEnviado?.nombre ?? grupoRecibido?.nombre ?? 'Sin asignar',
      celdas,
      // Mismo derivado que las celdas, en total: enviado − buenas − incompletas − saldado.
      totalPendiente,
      totalIncompletas: [...(grupoRecibido?.incompletas.values() ?? [])].reduce((s, v) => s + v, 0),
      faltantesSaldados,
      faltantesSaldables,
      // El precio va REDACTADO igual que en la cancelación de un recibo (R2 §4.4.3): quien recibe
      // aprieta el botón de cerrar, y quien recibe no necesariamente ve precios de maquila.
      precioFaltante: opciones.ocultarPrecio ? null : precio,
      // El importe lo calcula el SERVIDOR (A1): que la confirmación multiplique por su cuenta sería
      // la misma regla escrita en dos lados. Sin pendiente positivo no hay nada que proponer.
      // 🔑 El importe se calcula sobre lo SALDABLE, no sobre `totalPendiente`: es el número que el
      // servidor va a escribir en el descuento, y el que el usuario está aprobando.
      importeFaltantePropuesto:
        opciones.ocultarPrecio || precio === null || faltantesSaldables <= 0
          ? null
          : faltantesSaldables * precio,
    };
  });
  porMaquilero.sort((a, b) => a.maquilero.localeCompare(b.maquilero, 'es'));

  // Los totales del proceso se PLIEGAN de lo ya traído: sin esto serían dos consultas idénticas
  // más (el mismo rowset, solo que sin el join del tercero).
  const saldados = new Map<string, number>();
  for (const celdas of saldadoPorTercero.values()) {
    for (const [clave, cantidad] of celdas) {
      saldados.set(clave, (saldados.get(clave) ?? 0) + cantidad);
    }
  }

  return {
    porMaquilero,
    enviado: plegarPorTercero(enviadoPorTercero),
    recibido: plegarPorTercero(recibidoPorTercero),
    incompletas: plegarPorTercero(recibidoPorTercero, 'incompletas'),
    saldados,
  };
}

// ── Tablero WIP: listado de órdenes con su avance agregado ──────────────────────────────────────

/**
 * Filtros del TABLERO WIP EN DOMINIO (tipos nativos: `boolean`/`number`), distinto del esquema de la
 * URL del contrato (`esquemaTableroWipQuery`, con `z.coerce`/`z.stringbool`). La ruta coacciona la
 * querystring y pasa AQUÍ el valor nativo; los tests llaman con valores nativos. Re-validar el
 * contrato (`stringbool`) sobre un booleano ya coaccionado lanzaría (Zod 4.4.x) → 400 espurio; por
 * eso el dominio tiene su propio esquema con `z.boolean()` (mismo patrón que `*Dominio` de F2-E4).
 */
const esquemaTableroWipDominio = esquemaPaginacion.extend({
  busqueda: z.string().trim().max(200).optional(),
  idModelo: z.number().int().positive().optional(),
  idCliente: z.number().int().positive().optional(),
  // El esquema del CONTRATO, no una copia de sus valores (0.061 agregó `cerrada`).
  estado: esquemaEstadoOrden.optional(),
  soloPendientes: z.boolean().default(false),
  ordenarPor: z.enum(['folio', 'fecha', 'fechaEntrega']).default('folio'),
  direccion: z.enum(['asc', 'desc']).default('desc'),
});

/** Parámetros que acepta {@link consultarWip} (forma nativa, no la de la URL). */
export type ParametrosTableroWip = z.input<typeof esquemaTableroWipDominio>;

/** Totales derivados de una orden (los que comparten la fila del tablero y el drill-down). */
export interface TotalesOrden {
  pedido: number;
  cortado: number;
  enviado: number;
  /** Piezas BUENAS recibidas (primeras + segundas). NO incluye las incompletas. */
  recibido: number;
  /**
   * Prendas INCOMPLETAS entregadas (V1-E8v, §Post-F9.147). Ya volvieron del taller, así que cierran
   * el pendiente por recibir aunque no se hayan producido ni inventariado.
   */
  incompletas: number;
  /**
   * Piezas FALTANTES ya SALDADAS al cerrar la orden con sus maquileros (V1, fila 0.109). Nunca
   * volvieron del taller y ya se decidió que no vuelven (se cobraron o se perdonaron), así que
   * salen del pendiente por recibir. Tercera cubeta con columna propia.
   */
  faltantesSaldados: number;
  recibidoCostura: number;
  entregado: number;
}

/**
 * Calcula los pendientes derivados a partir de los totales (form `Proceso`). Función PURA (la
 * ejercita el test unitario en sus fronteras: sobre-corte negativo, todo cero, etc.).
 */
export function pendientesDerivados(t: TotalesOrden): {
  porCortar: number;
  cortadoPorEnviar: number;
  porRecibir: number;
  porEntregar: number;
} {
  return {
    porCortar: t.pedido - t.cortado,
    cortadoPorEnviar: t.cortado - t.enviado,
    // enviado − buenas − incompletas − faltantes saldados (V1-E8v, §Post-F9.147: la incompleta ya volvió del taller y
    // deja de estar en la maquila). Lo que queda es el FALTANTE, que se le cobra al maquilero.
    // ⭐ Por la MISMA función que todas las demás puertas, no por la fórmula escrita a mano: la
    // doctrina de la etapa es «guardas gemelas = la misma función, nunca un resumen suyo», y este
    // sitio era el único de TypeScript que la reescribía inline (hallazgo del reviewer).
    porRecibir: pendientePorCelda(t.enviado, t.recibido + t.incompletas, t.faltantesSaldados),
    porEntregar: t.recibidoCostura - t.entregado,
  };
}

/** ¿La orden tiene ALGO pendiente en cualquier etapa? (filtro `soloPendientes`). Pura. */
export function tienePendiente(t: TotalesOrden): boolean {
  const p = pendientesDerivados(t);
  return p.porCortar !== 0 || p.cortadoPorEnviar !== 0 || p.porRecibir !== 0 || p.porEntregar !== 0;
}

/**
 * AGREGADO por etapa (piezas) sobre TODO el universo filtrado (no solo la página) — KPIs de vistazo
 * del proto. Se deriva por suma directa de `EtapaMovimientoDet` (D3/D4) con el MISMO criterio que las
 * filas del tablero y que `kpisWip` de Indicadores: cada dimensión es UNA agregación en la base
 * (`_sum`) acotada por el `where` de las órdenes (relación anidada `etapaMov.orden`/`ordenLinea.orden`);
 * nunca se traen los detalles a memoria. `recibidoCostura` = recibos de procesos que meten a PT
 * (`generaEntradaPt`), base de "por entregar". Los pendientes se derivan con {@link pendientesDerivados}.
 *
 * El filtro `soloPendientes` del listado NO participa aquí: se aplica en memoria sobre las filas y una
 * orden sin nada pendiente aporta 0 a cada etapa pendiente, por lo que la Σ es idéntica. Así el
 * agregado refleja exactamente el `where` SQL (empresa/estado/modelo/cliente/búsqueda).
 *
 * Exportada: el Resumen operativo (R9) la reusa para "en producción (WIP)" (mismo criterio D3/D4,
 * sin duplicar la derivación).
 */
export async function agregadoWip(
  cliente: ClienteLectura,
  where: Prisma.OrdenWhereInput,
): Promise<WipTotales> {
  const sumaEtapa = async (
    tipo: TipoEtapaMovimiento,
    opciones: { soloEntradaPt?: boolean } = {},
  ): Promise<number> => {
    const r = await cliente.etapaMovimientoDet.aggregate({
      where: {
        etapaMov: {
          tipo,
          canceladoEn: null,
          orden: where,
          ...(opciones.soloEntradaPt ? { tipoProceso: { generaEntradaPt: true } } : {}),
        },
      },
      _sum: { cantidad: true },
    });
    return r._sum.cantidad ?? 0;
  };
  /**
   * Σ de prendas INCOMPLETAS de los recibos vivos del universo filtrado (V1-E8v). Va aparte de
   * `sumaEtapa` porque suma OTRA columna (`cantidadIncompletas`, que en corte/envío/entrega es
   * NULL): mezclarla en `_sum.cantidad` sería justo lo que §Post-F9.136 prohíbe.
   */
  const sumaIncompletas = async (): Promise<number> => {
    const r = await cliente.etapaMovimientoDet.aggregate({
      where: {
        etapaMov: {
          tipo: TipoEtapaMovimiento.recibo_maquila,
          canceladoEn: null,
          orden: where,
        },
      },
      _sum: { cantidadIncompletas: true },
    });
    return r._sum.cantidadIncompletas ?? 0;
  };

  const [
    pedidoAgg,
    cortado,
    enviado,
    recibido,
    incompletas,
    faltantesSaldados,
    recibidoCostura,
    entregado,
  ] = await Promise.all([
    cliente.ordenLineaTalla.aggregate({
      where: { ordenLinea: { orden: where } },
      _sum: { cantidad: true },
    }),
    sumaEtapa(TipoEtapaMovimiento.corte),
    sumaEtapa(TipoEtapaMovimiento.envio_maquila),
    sumaEtapa(TipoEtapaMovimiento.recibo_maquila),
    sumaIncompletas(),
    // Σ de la tercera cubeta sobre el MISMO universo filtrado (V1, fila 0.109). Va aparte porque
    // no es una etapa: es su propia tabla, y su suma es una sola agregación en la base.
    totalSaldadoDeOrdenes(cliente, where),
    sumaEtapa(TipoEtapaMovimiento.recibo_maquila, { soloEntradaPt: true }),
    sumaEtapa(TipoEtapaMovimiento.entrega_cliente),
  ]);
  const t: TotalesOrden = {
    pedido: pedidoAgg._sum.cantidad ?? 0,
    cortado,
    enviado,
    recibido,
    incompletas,
    faltantesSaldados,
    recibidoCostura,
    entregado,
  };
  return { ...t, ...pendientesDerivados(t) };
}

/**
 * TABLERO WIP de la empresa activa (A9): lista LIGERA de órdenes con su avance AGREGADO por etapa
 * (totales por etapa + pendientes derivados, form `Proceso`). Filtros por modelo/cliente/estado +
 * búsqueda combinada (folio, modelo, cliente, valor de referencia D7, reusa
 * `armarBusquedaConSinonimos` — así el tablero entiende los departamentos fusionados, §Post-F9.172(a)).
 *
 * Sobre `soloPendientes`: el filtro "solo órdenes con algo pendiente" se aplica DESPUÉS de derivar
 * (el pendiente no es una columna persistida, no se puede filtrar en SQL). Para que la paginación
 * siga siendo coherente, cuando `soloPendientes` está activo se PAGINA en memoria sobre el conjunto
 * filtrado (el universo de órdenes "vivas" de una empresa es acotado; si algún día crece, E6 decide
 * materializar — aquí NO se toma esa decisión). Sin el filtro, se pagina en la base (lo normal).
 */
export async function consultarWip(
  sesion: SesionUsuario,
  parametros: ParametrosTableroWip = {},
  bd?: ContextoBd,
): Promise<TableroWipPagina> {
  verificarPermiso(sesion, 'produccion.wip-ver');
  const filtros = validarEntrada(esquemaTableroWipDominio, parametros);
  const cliente = clienteLectura(bd);

  const where: Prisma.OrdenWhereInput = {
    idEmpresa: sesion.idEmpresaActiva,
    ...(filtros.estado === undefined
      ? { estado: { not: 'cancelada' } }
      : { estado: filtros.estado }),
    ...(filtros.idModelo === undefined ? {} : { idModelo: filtros.idModelo }),
    ...(filtros.idCliente === undefined ? {} : { idCliente: filtros.idCliente }),
    ...(await armarBusquedaConSinonimos(filtros.busqueda, bd)),
  };

  const paginacion: Paginacion = { pagina: filtros.pagina, porPagina: filtros.porPagina };
  const orderBy = {
    [filtros.ordenarPor]: filtros.direccion,
  } as Prisma.OrdenOrderByWithRelationInput;

  const seleccion = {
    id: true,
    folio: true,
    estado: true,
    fecha: true,
    fechaEntrega: true,
    idModelo: true,
    modelo: { select: { codigo: true } },
    idCliente: true,
    cliente: { select: { nombre: true } },
  } satisfies Prisma.OrdenSelect;

  // Sin `soloPendientes`: paginamos en la base (lo común). Con el filtro: traemos las órdenes que
  // cumplen el WHERE, derivamos y filtramos/paginamos en memoria (el universo vivo es acotado).
  if (!filtros.soloPendientes) {
    const [total, filas, totalesAgg] = await Promise.all([
      cliente.orden.count({ where }),
      cliente.orden.findMany({
        where,
        orderBy,
        select: seleccion,
        skip: (paginacion.pagina - 1) * paginacion.porPagina,
        take: paginacion.porPagina,
      }),
      agregadoWip(cliente, where),
    ]);
    const totales = await totalesDeOrdenes(
      cliente,
      filas.map((f) => f.id),
    );
    const datos = filas.map((f) => aFilaTablero(f, totales.get(f.id) ?? totalesVacios()));
    return {
      datos,
      totales: totalesAgg,
      total,
      pagina: paginacion.pagina,
      porPagina: paginacion.porPagina,
      totalPaginas: Math.max(1, Math.ceil(total / paginacion.porPagina)),
    };
  }

  const [filas, totalesAgg] = await Promise.all([
    cliente.orden.findMany({ where, orderBy, select: seleccion }),
    agregadoWip(cliente, where),
  ]);
  const totales = await totalesDeOrdenes(
    cliente,
    filas.map((f) => f.id),
  );
  const conPendiente = filas.filter((f) => tienePendiente(totales.get(f.id) ?? totalesVacios()));
  const total = conPendiente.length;
  const inicio = (paginacion.pagina - 1) * paginacion.porPagina;
  const pagina = conPendiente.slice(inicio, inicio + paginacion.porPagina);
  const datos = pagina.map((f) => aFilaTablero(f, totales.get(f.id) ?? totalesVacios()));
  return {
    datos,
    totales: totalesAgg,
    total,
    pagina: paginacion.pagina,
    porPagina: paginacion.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / paginacion.porPagina)),
  };
}

/** Totales en cero (para órdenes sin etapas ni matriz). */
function totalesVacios(): TotalesOrden {
  return {
    pedido: 0,
    cortado: 0,
    enviado: 0,
    recibido: 0,
    incompletas: 0,
    faltantesSaldados: 0,
    recibidoCostura: 0,
    entregado: 0,
  };
}

/**
 * Calcula los totales DERIVADOS (pedido + por etapa) de un conjunto de órdenes en pocas consultas
 * agregadas (una por dimensión), no por orden. Devuelve `idOrden → TotalesOrden`.
 */
async function totalesDeOrdenes(
  cliente: ClienteLectura,
  idsOrden: number[],
): Promise<Map<number, TotalesOrden>> {
  const resultado = new Map<number, TotalesOrden>();
  if (idsOrden.length === 0) {
    return resultado;
  }
  const [pedido, cortado, enviado, recibido, incompletas, saldados, recibidoCostura, entregado] =
    await Promise.all([
      pedidoPorOrden(cliente, idsOrden),
      totalesPorOrden(cliente, idsOrden, TipoEtapaMovimiento.corte),
      totalesPorOrden(cliente, idsOrden, TipoEtapaMovimiento.envio_maquila),
      totalesPorOrden(cliente, idsOrden, TipoEtapaMovimiento.recibo_maquila),
      totalesPorOrden(cliente, idsOrden, TipoEtapaMovimiento.recibo_maquila, {
        columna: 'cantidadIncompletas',
      }),
      // Los faltantes saldados NO son una etapa: viven en su propia tabla (V1, fila 0.109).
      saldadosPorOrden(cliente, idsOrden),
      totalesPorOrden(cliente, idsOrden, TipoEtapaMovimiento.recibo_maquila, {
        soloEntradaPt: true,
      }),
      totalesPorOrden(cliente, idsOrden, TipoEtapaMovimiento.entrega_cliente),
    ]);
  for (const id of idsOrden) {
    resultado.set(id, {
      pedido: pedido.get(id) ?? 0,
      cortado: cortado.get(id) ?? 0,
      enviado: enviado.get(id) ?? 0,
      recibido: recibido.get(id) ?? 0,
      incompletas: incompletas.get(id) ?? 0,
      faltantesSaldados: saldados.get(id) ?? 0,
      recibidoCostura: recibidoCostura.get(id) ?? 0,
      entregado: entregado.get(id) ?? 0,
    });
  }
  return resultado;
}

/** Proyecta una fila cruda + sus totales derivados a la fila del tablero del contrato. */
function aFilaTablero(
  fila: {
    id: number;
    folio: bigint;
    /** Estado de la orden: el TIPO del enum, NUNCA una copia literal de sus valores (0.061). */
    estado: EstadoOrden;
    fecha: Date | null;
    fechaEntrega: Date | null;
    idModelo: number;
    modelo: { codigo: string };
    idCliente: number;
    cliente: { nombre: string };
  },
  t: TotalesOrden,
): TableroWipPagina['datos'][number] {
  const p = pendientesDerivados(t);
  return {
    idOrden: fila.id,
    folio: Number(fila.folio),
    estado: fila.estado,
    fecha: fila.fecha === null ? null : fila.fecha.toISOString().slice(0, 10),
    fechaEntrega: fila.fechaEntrega === null ? null : fila.fechaEntrega.toISOString().slice(0, 10),
    idModelo: fila.idModelo,
    codigoModelo: fila.modelo.codigo,
    idCliente: fila.idCliente,
    cliente: fila.cliente.nombre,
    pedido: t.pedido,
    cortado: t.cortado,
    enviado: t.enviado,
    recibido: t.recibido,
    incompletas: t.incompletas,
    faltantesSaldados: t.faltantesSaldados,
    recibidoCostura: t.recibidoCostura,
    entregado: t.entregado,
    porCortar: p.porCortar,
    cortadoPorEnviar: p.cortadoPorEnviar,
    porRecibir: p.porRecibir,
    porEntregar: p.porEntregar,
  };
}

// ── Drill-down de una orden ───────────────────────────────────────────────────────────────────

/** Metadato de presentación de una celda (color/pack/talla). */
export interface MetaCelda {
  idColor: number;
  color: string;
  /** Pack / tendido de la celda (§Post-F9.10); cadena vacía cuando no aplica. */
  pack: string;
  idTalla: number;
  etiquetaTalla: string;
  ordenTalla: number;
}

/**
 * Defensivo: si una celda no tiene metadato (etapa de un color/talla raro), arma uno mínimo.
 *
 * 🔗 ÚNICA COPIA, y a propósito: la comparten el drill-down del WIP (aquí), los pendientes por
 * recibir (`recibos.ts`) y los pendientes/sugerencias de corte y envío (`etapas.ts`, que hasta
 * §Post-F9.10 tenía una copia privada palabra por palabra). Las tres leen llaves `color:talla:pack`
 * armadas por `claveCeldaPack`; si el respaldo se duplica, las vistas del MISMO pendiente acaban
 * nombrando distinto a la misma celda.
 *
 * ⚠️ La llave es `color:talla:pack` y el PACK ES TEXTO LIBRE que puede traer `:`. Por eso se corta
 * por los DOS primeros separadores (color y talla son enteros) y el resto se toma ENTERO como pack:
 * con `split(':')` una etiqueta como "A:B" habría dado un pack truncado, en silencio.
 */
export function metaPara(meta: Map<string, MetaCelda>, clave: string): MetaCelda {
  const m = meta.get(clave);
  if (m !== undefined) return m;
  const corte1 = clave.indexOf(':');
  const corte2 = corte1 < 0 ? -1 : clave.indexOf(':', corte1 + 1);
  const idColor = corte1 < 0 ? 0 : Number(clave.slice(0, corte1));
  const idTalla =
    corte2 < 0 ? Number(clave.slice(corte1 + 1)) : Number(clave.slice(corte1 + 1, corte2));
  return {
    idColor: Number.isFinite(idColor) ? idColor : 0,
    color: `Color ${Number.isFinite(idColor) ? idColor : 0}`,
    pack: corte2 < 0 ? SIN_PACK : clave.slice(corte2 + 1),
    idTalla: Number.isFinite(idTalla) ? idTalla : 0,
    etiquetaTalla: '',
    ordenTalla: 0,
  };
}

/** Ordena celdas por color, luego por pack, luego por el orden del catálogo de talla, luego idTalla. */
function ordenarCeldas<
  T extends { idColor: number; ordenTalla: number; idTalla: number; pack: string },
>(arr: T[]): T[] {
  return arr.sort(
    (a, b) =>
      a.idColor - b.idColor ||
      a.pack.localeCompare(b.pack, 'es') ||
      a.ordenTalla - b.ordenTalla ||
      a.idTalla - b.idTalla,
  );
}

/**
 * DRILL-DOWN de UNA orden de la empresa activa (A9): el avance completo (totales + pendientes por
 * etapa) con el detalle color×talla. Cubre "qué falta" en cada etapa por celda. Lanza
 * `ErrorNoEncontrado` (vía la proyección) si la orden no es de la empresa activa.
 */
export async function wipDeOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<WipOrden> {
  verificarPermiso(sesion, 'produccion.wip-ver');
  const cliente = clienteLectura(bd);

  const orden = await cliente.orden.findFirst({
    where: { id: idOrden, idEmpresa: sesion.idEmpresaActiva },
    select: {
      id: true,
      folio: true,
      estado: true,
      idModelo: true,
      modelo: { select: { codigo: true } },
      idCliente: true,
      cliente: { select: { nombre: true } },
      lineas: {
        select: {
          idColor: true,
          pack: true,
          color: { select: { nombre: true } },
          tallas: {
            select: {
              idTalla: true,
              cantidad: true,
              talla: { select: { etiqueta: true, orden: true } },
            },
          },
        },
      },
    },
  });
  if (orden === null) {
    // Mismo contrato que el resto de las consultas: una orden de otra empresa "no existe".
    throw new ErrorNoEncontrado('Orden', idOrden);
  }

  // Metadatos + pedido por celda (de la matriz de la orden), llave color×talla×PACK.
  const meta = new Map<string, MetaCelda>();
  const pedido = new Map<string, number>();
  // Metadatos PLEGADOS (color×talla) para lo que no maneja packs: la entrega a cliente. Se arma en
  // la misma pasada; el pack se deja vacío porque ahí de verdad no significa nada.
  const metaPlegada = new Map<string, MetaCelda>();
  for (const linea of orden.lineas) {
    const pack = normalizarPack(linea.pack);
    for (const t of linea.tallas) {
      const clave = claveCelda(linea.idColor, t.idTalla, pack);
      pedido.set(clave, (pedido.get(clave) ?? 0) + t.cantidad);
      const datos = {
        idColor: linea.idColor,
        color: linea.color.nombre,
        idTalla: t.idTalla,
        etiquetaTalla: t.talla.etiqueta,
        ordenTalla: t.talla.orden,
      };
      if (!meta.has(clave)) meta.set(clave, { ...datos, pack });
      // ⭐ Y también SIN pack (§Post-F9.10): cuando el maquilero devuelve los tendidos revueltos, el
      // pendiente saca una celda de pack vacío —en negativo, lo devuelto sin atribuir—. Si no se
      // registra aquí su metadato, esa celda cae en el respaldo defensivo y sale rotulada «Color 7»
      // con la talla en blanco: un renglón real de la pantalla, con el nombre equivocado.
      const claveSinPack = claveCelda(linea.idColor, t.idTalla, SIN_PACK);
      if (!meta.has(claveSinPack)) meta.set(claveSinPack, { ...datos, pack: SIN_PACK });
      const clavePlegada = claveCeldaPlegada(linea.idColor, t.idTalla);
      if (!metaPlegada.has(clavePlegada)) {
        metaPlegada.set(clavePlegada, { ...datos, pack: SIN_PACK });
      }
    }
  }

  // Sumas por etapa. Corte va por color×talla×PACK (lleva tendido); la entrega a cliente va PLEGADA
  // —ahí ya es sólo color (§Post-F9.10)—, y por eso también usa el metadato plegado: buscarla en el
  // mapa con pack habría dejado sus celdas sin nombre de color ni etiqueta de talla.
  const cortado = await sumarCeldasOrden(cliente, idOrden, TipoEtapaMovimiento.corte);
  const entregadoMapa = await sumarCeldasOrden(
    cliente,
    idOrden,
    TipoEtapaMovimiento.entrega_cliente,
    undefined,
    true,
  );

  // Procesos efectivamente usados (envíos vivos): enumera cortadoPorEnviar/porRecibir.
  const procesos = await cliente.etapaMovimiento.findMany({
    where: {
      idOrden,
      tipo: TipoEtapaMovimiento.envio_maquila,
      canceladoEn: null,
      idTipoProceso: { not: null },
    },
    select: {
      idTipoProceso: true,
      tipoProceso: { select: { nombre: true, codigo: true, generaEntradaPt: true } },
    },
    distinct: ['idTipoProceso'],
  });

  // V1-E4b (§Post-F9.61): qué procesos se enviaron como PRENDA YA TERMINADA — sus prendas están en
  // el almacén de TRÁNSITO y el recibo las DEVUELVE, así que la captura pide almacén destino aunque
  // el proceso no sea el que crea el PT. Una sola consulta para todos los procesos de la orden.
  const enviosPrendaTerminada = await cliente.etapaMovimiento.findMany({
    where: {
      idOrden,
      tipo: TipoEtapaMovimiento.envio_maquila,
      canceladoEn: null,
      prendaTerminada: true,
      idTipoProceso: { not: null },
    },
    select: { idTipoProceso: true, stockSinOrden: true },
    distinct: ['idTipoProceso'],
  });
  // Además de QUIÉN devuelve, de qué BUCKET salió (V1-E4b/H1): la captura del siguiente envío queda
  // fijada por él (el servidor no deja mezclar buckets en la misma orden+proceso).
  const bucketPorProceso = new Map<number, boolean>();
  for (const e of enviosPrendaTerminada) {
    if (e.idTipoProceso !== null) bucketPorProceso.set(e.idTipoProceso, e.stockSinOrden);
  }
  const procesosQueDevuelven = new Set(bucketPorProceso.keys());

  // porCortar = pedido − cortado, por celda (incluye celdas con sobre-corte → negativo).
  const clavesCorte = new Set<string>([...pedido.keys(), ...cortado.keys()]);
  const porCortar = ordenarCeldas(
    [...clavesCorte].map((clave) => {
      const m = metaPara(meta, clave);
      return { ...m, cantidad: (pedido.get(clave) ?? 0) - (cortado.get(clave) ?? 0) };
    }),
  ).map(({ ordenTalla: _o, ...resto }) => resto);

  // cortadoPorEnviar / porRecibir por proceso (solo celdas ≠ 0).
  const cortadoPorEnviar: WipOrden['cortadoPorEnviar'] = [];
  const porRecibir: WipOrden['porRecibir'] = [];
  let recibidoTotal = 0;
  let recibidoCostura = 0;
  /**
   * Σ ENVIADO a procesos que meten a PT (costura). Lo publica el SERVIDOR (A1) porque el stepper del
   * panel de avance lo necesita y **despejarlo en el cliente es re-derivar una regla de negocio**:
   * hasta V1-E8v la pantalla hacía `recibidoCostura + Σ totalPendiente`, que INVIERTE la fórmula del
   * pendiente. En cuanto el pendiente empezó a restar las incompletas (§Post-F9.147) ese despeje
   * empezó a devolver `enviado − incompletas` y la pantalla decía que al maquilero se le mandó menos
   * de lo que se le mandó — y le regalaba esas piezas al conteo de Arte.
   */
  let enviadoCostura = 0;
  /** Σ de prendas INCOMPLETAS entregadas en la orden (todas sus maquilas). Cuarta cubeta. */
  let incompletasTotal = 0;
  let faltantesSaldadosTotal = 0;
  for (const proc of procesos) {
    if (proc.idTipoProceso === null) continue;
    // Envío y recibo del proceso, DESGLOSADOS por maquilero y plegados a los totales del proceso:
    // una sola pasada por tipo de movimiento (el helper lo comparte con `pendientesPorRecibir`).
    const { porMaquilero, enviado, recibido, incompletas, saldados } = await pendientePorMaquilero(
      cliente,
      idOrden,
      proc.idTipoProceso,
      meta,
      {
        // MISMA redacción que `pendientesPorRecibir` y que la cancelación de un recibo (R2 §4.4.3):
        // la manda el PERMISO, no la pantalla. Redactarlo aquí «siempre, por si acaso» sonaba
        // prudente y era un defecto: el panel de avance —donde vive el botón de cerrar la orden—
        // lee el pendiente de ESTE endpoint, así que la confirmación habría enseñado el precio y el
        // importe en blanco a TODO el mundo, incluido quien sí puede verlos.
        ocultarPrecio: !tienePermiso(sesion, 'ordenes.ver-precio-real-maquila'),
      },
    );
    const generaEntradaPt = proc.tipoProceso?.generaEntradaPt ?? false;
    const sumaRecibido = [...recibido.values()].reduce((s, v) => s + v, 0);
    const sumaEnviado = [...enviado.values()].reduce((s, v) => s + v, 0);
    recibidoTotal += sumaRecibido;
    if (generaEntradaPt) {
      recibidoCostura += sumaRecibido;
      // Suma DIRECTA de los envíos del proceso, no un despeje del pendiente (ver `enviadoCostura`).
      enviadoCostura += sumaEnviado;
    }
    // Las incompletas de ESTE proceso, que restan del pendiente por recibir (V1-E8v) pero NUNCA
    // de `recibido` (no se produjeron: regla 1 de §Post-F9.136).
    incompletasTotal += [...incompletas.values()].reduce((s, v) => s + v, 0);
    // La TERCERA cubeta (V1, fila 0.109): lo que ya se saldó al cerrar con cada maquilero.
    faltantesSaldadosTotal += [...saldados.values()].reduce((s, v) => s + v, 0);

    const datosProceso = {
      idTipoProceso: proc.idTipoProceso,
      tipoProceso: proc.tipoProceso?.nombre ?? '',
      codigoProceso: proc.tipoProceso?.codigo ?? '',
      generaEntradaPt,
    };

    // cortado − enviado a este proceso.
    const clavesEnv = new Set<string>([...cortado.keys(), ...enviado.keys()]);
    const celdasEnviar = ordenarCeldas(
      [...clavesEnv].map((clave) => {
        const m = metaPara(meta, clave);
        return { ...m, cantidad: (cortado.get(clave) ?? 0) - (enviado.get(clave) ?? 0) };
      }),
    )
      .filter((c) => c.cantidad !== 0)
      .map(({ ordenTalla: _o, ...resto }) => resto);
    cortadoPorEnviar.push({
      ...datosProceso,
      celdas: celdasEnviar,
      totalPendiente:
        [...cortado.values()].reduce((s, v) => s + v, 0) -
        [...enviado.values()].reduce((s, v) => s + v, 0),
    });

    // enviado − recibido − incompletas − faltantes saldados a este proceso (V1-E8v, §Post-F9.147: la incompleta ya
    // volvió del taller, así que sale del tránsito). MISMA función que el tope del guardado.
    const clavesRec = new Set<string>([
      ...enviado.keys(),
      ...recibido.keys(),
      ...incompletas.keys(),
      ...saldados.keys(),
    ]);
    const celdasRecibir = ordenarCeldas(
      [...clavesRec].map((clave) => {
        const m = metaPara(meta, clave);
        return {
          ...m,
          cantidad: pendientePorCelda(
            enviado.get(clave) ?? 0,
            (recibido.get(clave) ?? 0) + (incompletas.get(clave) ?? 0),
            saldados.get(clave) ?? 0,
          ),
        };
      }),
    )
      .filter((c) => c.cantidad !== 0)
      .map(({ ordenTalla: _o, ...resto }) => resto);
    porRecibir.push({
      ...datosProceso,
      devuelveAPt: procesosQueDevuelven.has(proc.idTipoProceso),
      stockSinOrden: bucketPorProceso.get(proc.idTipoProceso) ?? false,
      celdas: celdasRecibir,
      totalPendiente: pendientePorCelda(
        [...enviado.values()].reduce((s, v) => s + v, 0),
        [...recibido.values()].reduce((s, v) => s + v, 0) +
          [...incompletas.values()].reduce((s, v) => s + v, 0),
        [...saldados.values()].reduce((s, v) => s + v, 0),
      ),
      porMaquilero,
    });
  }

  // Σ corte por celda (V1-E8i): el disponible a enviar de un proceso SIN envíos todavía. Va
  // completo (incluidas las celdas en 0) para que la captura tenga un tope real en cada celda de la
  // orden: cero cortado es un tope, no una ausencia de dato.
  const clavesCortado = new Set<string>([...pedido.keys(), ...cortado.keys()]);
  const cortadoCeldas = ordenarCeldas(
    [...clavesCortado].map((clave) => {
      const m = metaPara(meta, clave);
      return { ...m, cantidad: cortado.get(clave) ?? 0 };
    }),
  ).map(({ ordenTalla: _o, ...resto }) => resto);

  // Entregado a cliente, por celda (SIN pack: la entrega no lo maneja).
  const entregadoCeldas = ordenarCeldas(
    [...entregadoMapa.keys()].map((clave) => {
      const m = metaPara(metaPlegada, clave);
      return { ...m, cantidad: entregadoMapa.get(clave) ?? 0 };
    }),
  )
    .filter((c) => c.cantidad !== 0)
    .map(({ ordenTalla: _o, ...resto }) => resto);

  const totalPedido = [...pedido.values()].reduce((s, v) => s + v, 0);
  const totalCortado = [...cortado.values()].reduce((s, v) => s + v, 0);
  const totalEnviado = await totalEtapa(cliente, idOrden, TipoEtapaMovimiento.envio_maquila);
  // 0.114: Σ EMPACADO. Suma directa de las etapas de empaque VIVAS, igual que el resto — NO se
  // deriva de lo recibido ni de lo entregado: la cantidad del empaque es propia (regla de C&A).
  const totalEmpacado = await totalEtapa(cliente, idOrden, TipoEtapaMovimiento.empaque);
  const totalEntregado = [...entregadoMapa.values()].reduce((s, v) => s + v, 0);

  return {
    idOrden: orden.id,
    folio: Number(orden.folio),
    estado: orden.estado,
    idModelo: orden.idModelo,
    codigoModelo: orden.modelo.codigo,
    idCliente: orden.idCliente,
    cliente: orden.cliente.nombre,
    pedido: totalPedido,
    cortado: totalCortado,
    enviado: totalEnviado,
    recibido: recibidoTotal,
    enviadoCostura,
    recibidoCostura,
    empacado: totalEmpacado,
    // Las dos cifras que completan la TRAZABILIDAD DE LAS CUATRO CUBETAS que pidió Daniel
    // (§Post-F9.147: *"debemos de saber que paso con cada prenda despues"*):
    //   enviado = buenas (`recibido`) + incompletas + faltante (`pendientePorRecibir`).
    // Sin ellas el drill-down enseñaba `enviado` y `recibido` y el hueco entre los dos no tenía
    // nombre: podían ser prendas en el taller o prendas perdidas, y son cosas distintas.
    incompletas: incompletasTotal,
    faltantesSaldados: faltantesSaldadosTotal,
    pendientePorRecibir: pendientePorCelda(
      totalEnviado,
      recibidoTotal + incompletasTotal,
      faltantesSaldadosTotal,
    ),
    entregado: totalEntregado,
    porEntregar: recibidoCostura - totalEntregado,
    porCortar,
    cortadoCeldas,
    cortadoPorEnviar,
    porRecibir,
    entregadoCeldas,
  };
}

/** Total de piezas de una etapa (todas las vivas de un tipo) de una orden, por suma directa. */
async function totalEtapa(
  cliente: ClienteLectura,
  idOrden: number,
  tipo: TipoEtapaMovimiento,
): Promise<number> {
  const agregado = await cliente.etapaMovimientoDet.aggregate({
    where: { etapaMov: { idOrden, tipo, canceladoEn: null } },
    _sum: { cantidad: true },
  });
  return agregado._sum.cantidad ?? 0;
}

// ── Existencias en poder del maquilero (enviado − recibido − incompletas − faltantes saldados) ───────────────────────

/**
 * Filtros de la consulta de EXISTENCIAS EN PODER DEL MAQUILERO EN DOMINIO (tipos nativos). La ruta
 * coacciona la querystring y pasa el valor nativo; los tests llaman con valores nativos.
 */
const esquemaExistenciaMaquileroDominio = z.object({
  idMaquilero: z.number().int().positive().optional(),
  idTipoProceso: z.number().int().positive().optional(),
  idOrden: z.number().int().positive().optional(),
});

/** Parámetros que acepta {@link consultarExistenciaMaquilero} (forma nativa). */
export type ParametrosExistenciaMaquilero = z.input<typeof esquemaExistenciaMaquileroDominio>;

/** Clave estable de un grupo maquilero × proceso × orden. */
function claveGrupoMaquilero(
  idMaquilero: number | null,
  idTipoProceso: number,
  idOrden: number,
): string {
  return `${idMaquilero ?? 'sin'}|${idTipoProceso}|${idOrden}`;
}

/**
 * EXISTENCIAS EN PODER DEL MAQUILERO (form `MaqExis` del viejo): por maquilero × proceso × orden, lo
 * que el maquilero tiene pendiente de devolver = **enviado − buenas − incompletas − faltantes saldados** (Σ de
 * `EtapaMovimientoDet`, etapas vivas). Solo devuelve filas con saldo ≠ 0. Filtros por
 * maquilero/proceso/orden. Filtra por la empresa activa (A9). La REUSA EsMa (esta cuenta es la base
 * del cargo/saldo del maquilero).
 *
 * ⭐ V1-E8v (§Post-F9.147) — ÉSTA ES LA PANTALLA QUE DANIEL DESCRIBIÓ LITERALMENTE: *"Al
 * registrarlas como incompletas entregadas, dejan de estar en la maquila"*. Antes, el maquilero que
 * devolvía 95 buenas + 5 incompletas de 100 seguía apareciendo aquí con 5 «en su poder», y no tenía
 * nada. Ahora el saldo queda en 0 y la fila desaparece.
 *
 * 🔴 DECISIÓN, no descuido: el filtro `enPoder !== 0` se CONSERVA aunque eso haga desaparecer la
 * columna «Incompletas» justo en el caso de Daniel (95 + 5 de 100). La pantalla se llama
 * «Existencias EN PODER del maquilero» y contesta *"¿qué tiene fulano en su taller?"*: una fila con
 * 0 en poder **no es una existencia**, y ampliar el filtro a `|| incompletas !== 0` la convertiría
 * en un histórico de entregas, contradiciendo su propio título. ⇒ **La columna sirve para que la
 * fila que SÍ existe cuadre a la vista** (`enviado = recibido + incompletas + en poder`), no para
 * ser el registro de las incompletas.
 *
 * ⚠️ Dónde SÍ se ven siempre, sin filtro que las esconda: el **drill-down del tablero WIP** de la
 * orden (las cuatro cubetas como métricas), el **tablero WIP de Indicadores** (columna y tarjeta) y
 * el **estado de cuenta del maquilero** (bloque de incompletas de `incompletasDeMaquilero`, que es
 * el registro de la regla 4 de §Post-F9.136 y NO depende de este saldo).
 *
 * Implementación: una sola lectura del detalle de envíos y recibos vivos (con su etapa: maquilero,
 * proceso, orden) y se restan en memoria agrupando por (maquilero, proceso, orden). El volumen por
 * empresa es acotado; si crece, la decisión de materializar/indexar es de E6 (no aquí).
 */
export async function consultarExistenciaMaquilero(
  sesion: SesionUsuario,
  parametros: ParametrosExistenciaMaquilero = {},
  bd?: ContextoBd,
): Promise<ExistenciaMaquileroLista> {
  verificarPermiso(sesion, 'produccion.wip-ver');
  const filtros = validarEntrada(esquemaExistenciaMaquileroDominio, parametros);
  const cliente = clienteLectura(bd);

  const baseEtapa: Prisma.EtapaMovimientoWhereInput = {
    idEmpresa: sesion.idEmpresaActiva,
    canceladoEn: null,
    idTipoProceso: filtros.idTipoProceso === undefined ? { not: null } : filtros.idTipoProceso,
    ...(filtros.idMaquilero === undefined ? {} : { idTercero: filtros.idMaquilero }),
    ...(filtros.idOrden === undefined ? {} : { idOrden: filtros.idOrden }),
  };

  // Detalle de envíos y recibos vivos con su etapa (maquilero/proceso/orden) y nombres legibles.
  const seleccion = {
    cantidad: true,
    cantidadIncompletas: true,
    etapaMov: {
      select: {
        tipo: true,
        idTercero: true,
        idTipoProceso: true,
        idOrden: true,
        tercero: { select: { nombre: true } },
        tipoProceso: { select: { nombre: true } },
        orden: { select: { folio: true, modelo: { select: { codigo: true } } } },
      },
    },
  } satisfies Prisma.EtapaMovimientoDetSelect;

  const [envios, recibos, cierres] = await Promise.all([
    cliente.etapaMovimientoDet.findMany({
      where: { etapaMov: { ...baseEtapa, tipo: TipoEtapaMovimiento.envio_maquila } },
      select: seleccion,
    }),
    cliente.etapaMovimientoDet.findMany({
      where: { etapaMov: { ...baseEtapa, tipo: TipoEtapaMovimiento.recibo_maquila } },
      select: seleccion,
    }),
    // ⭐ V1 (fila 0.109): los cierres VIVOS del mismo universo. Lo saldado deja de estar en poder
    // del maquilero — ya se decidió que no vuelve—, que es justo lo que esta pantalla contesta.
    cliente.cierreMaquilaOrden.findMany({
      where: {
        idEmpresa: sesion.idEmpresaActiva,
        deshechoEn: null,
        ...(filtros.idTipoProceso === undefined ? {} : { idTipoProceso: filtros.idTipoProceso }),
        ...(filtros.idMaquilero === undefined ? {} : { idMaquilero: filtros.idMaquilero }),
        ...(filtros.idOrden === undefined ? {} : { idOrden: filtros.idOrden }),
      },
      select: {
        idMaquilero: true,
        idTipoProceso: true,
        idOrden: true,
        detalles: { select: { cantidadFaltantes: true } },
      },
    }),
  ]);

  interface Acum {
    idMaquilero: number | null;
    maquilero: string;
    idTipoProceso: number;
    tipoProceso: string;
    idOrden: number;
    folioOrden: number;
    codigoModelo: string;
    enviado: number;
    recibido: number;
    incompletas: number;
    faltantesSaldados: number;
  }
  const grupos = new Map<string, Acum>();

  const tomar = (fila: (typeof envios)[number]): { clave: string; acum: Acum } | null => {
    const e = fila.etapaMov;
    if (e.idTipoProceso === null) return null;
    const clave = claveGrupoMaquilero(e.idTercero, e.idTipoProceso, e.idOrden);
    const acum =
      grupos.get(clave) ??
      ({
        idMaquilero: e.idTercero,
        maquilero: e.tercero?.nombre ?? 'Sin asignar',
        idTipoProceso: e.idTipoProceso,
        tipoProceso: e.tipoProceso?.nombre ?? '',
        idOrden: e.idOrden,
        folioOrden: Number(e.orden.folio),
        codigoModelo: e.orden.modelo.codigo,
        enviado: 0,
        recibido: 0,
        incompletas: 0,
        faltantesSaldados: 0,
      } satisfies Acum);
    grupos.set(clave, acum);
    return { clave, acum };
  };

  for (const fila of envios) {
    const r = tomar(fila);
    if (r !== null) r.acum.enviado += fila.cantidad;
  }
  for (const fila of recibos) {
    const r = tomar(fila);
    if (r === null) continue;
    r.acum.recibido += fila.cantidad;
    // Las incompletas van a su propia cubeta: NO son "recibido" (no se produjeron ni se pagan),
    // pero SÍ salieron del taller y por eso restan del saldo en poder (V1-E8v).
    r.acum.incompletas += fila.cantidadIncompletas ?? 0;
  }
  // Los cierres NO nacen de una etapa, así que no pasan por `tomar` (que lee `EtapaMovimientoDet`):
  // se acumulan sobre el MISMO grupo maquilero×proceso×orden. Si un cierre no encuentra grupo es
  // porque su envío está cancelado o filtrado — no se inventa una fila con enviado 0, que saldría
  // en negativo y diría que el maquilero «tiene» piezas de menos.
  for (const c of cierres) {
    const clave = claveGrupoMaquilero(c.idMaquilero, c.idTipoProceso, c.idOrden);
    const acum = grupos.get(clave);
    if (acum === undefined) continue;
    acum.faltantesSaldados += c.detalles.reduce((s, d) => s + d.cantidadFaltantes, 0);
  }

  const filas = [...grupos.values()]
    .map((g) => ({
      idMaquilero: g.idMaquilero,
      maquilero: g.maquilero,
      idTipoProceso: g.idTipoProceso,
      tipoProceso: g.tipoProceso,
      idOrden: g.idOrden,
      folioOrden: g.folioOrden,
      codigoModelo: g.codigoModelo,
      enviado: g.enviado,
      recibido: g.recibido,
      incompletas: g.incompletas,
      faltantesSaldados: g.faltantesSaldados,
      // MISMA regla que `pendientePorCelda` (aquí en total, no por celda): lo que le queda al
      // maquilero es lo que NO volvió Y todavía se le espera. Lo ya SALDADO al cerrar la orden con
      // él sale de aquí (V1, fila 0.109): esa deuda ya se resolvió —cobrada o perdonada— y seguir
      // enseñándola sería la lista que nunca se vacía que esta fila vino a cerrar.
      enPoder: pendientePorCelda(g.enviado, g.recibido + g.incompletas, g.faltantesSaldados),
    }))
    .filter((f) => f.enPoder !== 0)
    .sort(
      (a, b) =>
        a.maquilero.localeCompare(b.maquilero, 'es') ||
        a.folioOrden - b.folioOrden ||
        a.tipoProceso.localeCompare(b.tipoProceso, 'es'),
    );

  const totalEnPoder = filas.reduce((s, f) => s + f.enPoder, 0);
  return { filas, totalEnPoder };
}
