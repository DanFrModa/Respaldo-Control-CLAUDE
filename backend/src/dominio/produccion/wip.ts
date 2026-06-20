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
 *  • Por recibir         = enviado − recibido           (por proceso/TipoProceso)
 *  • Entregado a cliente = Σ entregas (etapa `entrega_cliente`)
 *  • Por entregar        = recibido(costura, procesos `generaEntradaPt`) − entregado a cliente
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
 * maquilero la REUSARÁ EsMa en F6 (enviado − recibido = base del cargo/cuenta corriente).
 */
import { z } from 'zod';

import type {
  ExistenciaMaquileroLista,
  TableroWipPagina,
  WipOrden,
} from '../../contrato/index.js';
import { TipoEtapaMovimiento, type Prisma } from '../../datos/index.js';

import { ErrorNoEncontrado } from '../../comun/errores.js';
import { esquemaPaginacion, type Paginacion } from '../../comun/paginacion.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { clienteLectura, type ContextoBd } from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { armarBusqueda } from './ordenes.js';

/** Cliente de LECTURA (sin transacción) — el tipo del resultado de `clienteLectura`. */
type ClienteLectura = ReturnType<typeof clienteLectura>;

// ── Helpers de suma directa (DERIVADO, sin acumuladores) ──────────────────────────────────────────

/** Clave estable de una celda color×talla (para mapas). */
function claveCelda(idColor: number, idTalla: number): string {
  return `${idColor}:${idTalla}`;
}

/**
 * Suma `EtapaMovimientoDet.cantidad` POR ORDEN (un total por orden) para un conjunto de órdenes y un
 * filtro de tipo (+ opcionalmente "solo procesos que meten a PT"), en UNA sola consulta agregada
 * (groupBy en la base; no trae el detalle a memoria). Solo etapas VIVAS (canceladas excluidas).
 * Devuelve `idOrden → total`; las órdenes sin etapas de ese tipo no aparecen (se proyectan con 0).
 */
async function totalesPorOrden(
  cliente: ClienteLectura,
  idsOrden: number[],
  tipo: TipoEtapaMovimiento,
  opciones: { soloEntradaPt?: boolean } = {},
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
  const filas = await cliente.etapaMovimientoDet.groupBy({
    by: ['idEtapaMov'],
    where,
    _sum: { cantidad: true },
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
    totales.set(idOrden, (totales.get(idOrden) ?? 0) + (f._sum.cantidad ?? 0));
  }
  return totales;
}

/** Total pedido (Σ de la matriz `OrdenLineaTalla`) por orden, para un conjunto de órdenes. */
async function pedidoPorOrden(
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
 * Suma `EtapaMovimientoDet` por color×talla de UNA orden para un filtro de tipo (+ proceso opcional),
 * leyendo el detalle DIRECTO. Solo etapas vivas. Base de los pendientes por celda del drill-down.
 */
async function sumarCeldasOrden(
  cliente: ClienteLectura,
  idOrden: number,
  tipo: TipoEtapaMovimiento,
  idTipoProceso?: number,
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
    select: { idColor: true, idTalla: true, cantidad: true },
  });
  const acumulado = new Map<string, number>();
  for (const f of filas) {
    const clave = claveCelda(f.idColor, f.idTalla);
    acumulado.set(clave, (acumulado.get(clave) ?? 0) + f.cantidad);
  }
  return acumulado;
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
  estado: z.enum(['capturada', 'completa', 'cancelada']).optional(),
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
  recibido: number;
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
    porRecibir: t.enviado - t.recibido,
    porEntregar: t.recibidoCostura - t.entregado,
  };
}

/** ¿La orden tiene ALGO pendiente en cualquier etapa? (filtro `soloPendientes`). Pura. */
export function tienePendiente(t: TotalesOrden): boolean {
  const p = pendientesDerivados(t);
  return (
    p.porCortar !== 0 || p.cortadoPorEnviar !== 0 || p.porRecibir !== 0 || p.porEntregar !== 0
  );
}

/**
 * TABLERO WIP de la empresa activa (A9): lista LIGERA de órdenes con su avance AGREGADO por etapa
 * (totales por etapa + pendientes derivados, form `Proceso`). Filtros por modelo/cliente/estado +
 * búsqueda combinada (folio, modelo, cliente, valor de referencia D7, reusa `armarBusqueda`).
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
    ...(filtros.estado === undefined ? { estado: { not: 'cancelada' } } : { estado: filtros.estado }),
    ...(filtros.idModelo === undefined ? {} : { idModelo: filtros.idModelo }),
    ...(filtros.idCliente === undefined ? {} : { idCliente: filtros.idCliente }),
    ...armarBusqueda(filtros.busqueda),
  };

  const paginacion: Paginacion = { pagina: filtros.pagina, porPagina: filtros.porPagina };
  const orderBy = { [filtros.ordenarPor]: filtros.direccion } as Prisma.OrdenOrderByWithRelationInput;

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
    const [total, filas] = await Promise.all([
      cliente.orden.count({ where }),
      cliente.orden.findMany({
        where,
        orderBy,
        select: seleccion,
        skip: (paginacion.pagina - 1) * paginacion.porPagina,
        take: paginacion.porPagina,
      }),
    ]);
    const totales = await totalesDeOrdenes(
      cliente,
      filas.map((f) => f.id),
    );
    const datos = filas.map((f) => aFilaTablero(f, totales.get(f.id) ?? totalesVacios()));
    return {
      datos,
      total,
      pagina: paginacion.pagina,
      porPagina: paginacion.porPagina,
      totalPaginas: Math.max(1, Math.ceil(total / paginacion.porPagina)),
    };
  }

  const filas = await cliente.orden.findMany({ where, orderBy, select: seleccion });
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
    total,
    pagina: paginacion.pagina,
    porPagina: paginacion.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / paginacion.porPagina)),
  };
}

/** Totales en cero (para órdenes sin etapas ni matriz). */
function totalesVacios(): TotalesOrden {
  return { pedido: 0, cortado: 0, enviado: 0, recibido: 0, recibidoCostura: 0, entregado: 0 };
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
  const [pedido, cortado, enviado, recibido, recibidoCostura, entregado] = await Promise.all([
    pedidoPorOrden(cliente, idsOrden),
    totalesPorOrden(cliente, idsOrden, TipoEtapaMovimiento.corte),
    totalesPorOrden(cliente, idsOrden, TipoEtapaMovimiento.envio_maquila),
    totalesPorOrden(cliente, idsOrden, TipoEtapaMovimiento.recibo_maquila),
    totalesPorOrden(cliente, idsOrden, TipoEtapaMovimiento.recibo_maquila, { soloEntradaPt: true }),
    totalesPorOrden(cliente, idsOrden, TipoEtapaMovimiento.entrega_cliente),
  ]);
  for (const id of idsOrden) {
    resultado.set(id, {
      pedido: pedido.get(id) ?? 0,
      cortado: cortado.get(id) ?? 0,
      enviado: enviado.get(id) ?? 0,
      recibido: recibido.get(id) ?? 0,
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
    estado: 'capturada' | 'completa' | 'cancelada';
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
    recibidoCostura: t.recibidoCostura,
    entregado: t.entregado,
    porCortar: p.porCortar,
    cortadoPorEnviar: p.cortadoPorEnviar,
    porRecibir: p.porRecibir,
    porEntregar: p.porEntregar,
  };
}

// ── Drill-down de una orden ───────────────────────────────────────────────────────────────────

/** Metadato de presentación de una celda (color/talla). */
interface MetaCelda {
  idColor: number;
  color: string;
  idTalla: number;
  etiquetaTalla: string;
  ordenTalla: number;
}

/** Defensivo: si una celda no tiene metadato (etapa de un color/talla raro), arma uno mínimo. */
function metaPara(meta: Map<string, MetaCelda>, clave: string): MetaCelda {
  const m = meta.get(clave);
  if (m !== undefined) return m;
  const [idColor, idTalla] = clave.split(':').map(Number);
  return {
    idColor: idColor ?? 0,
    color: `Color ${idColor ?? 0}`,
    idTalla: idTalla ?? 0,
    etiquetaTalla: '',
    ordenTalla: 0,
  };
}

/** Ordena celdas por color, luego por el orden del catálogo de talla, luego idTalla. */
function ordenarCeldas<T extends { idColor: number; ordenTalla: number; idTalla: number }>(
  arr: T[],
): T[] {
  return arr.sort(
    (a, b) => a.idColor - b.idColor || a.ordenTalla - b.ordenTalla || a.idTalla - b.idTalla,
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

  // Metadatos + pedido por celda (de la matriz de la orden).
  const meta = new Map<string, MetaCelda>();
  const pedido = new Map<string, number>();
  for (const linea of orden.lineas) {
    for (const t of linea.tallas) {
      const clave = claveCelda(linea.idColor, t.idTalla);
      pedido.set(clave, (pedido.get(clave) ?? 0) + t.cantidad);
      if (!meta.has(clave)) {
        meta.set(clave, {
          idColor: linea.idColor,
          color: linea.color.nombre,
          idTalla: t.idTalla,
          etiquetaTalla: t.talla.etiqueta,
          ordenTalla: t.talla.orden,
        });
      }
    }
  }

  // Sumas por etapa (color×talla). Corte, recibido total/costura y entregado no dependen del proceso.
  const cortado = await sumarCeldasOrden(cliente, idOrden, TipoEtapaMovimiento.corte);
  const entregadoMapa = await sumarCeldasOrden(cliente, idOrden, TipoEtapaMovimiento.entrega_cliente);

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
  for (const proc of procesos) {
    if (proc.idTipoProceso === null) continue;
    const enviado = await sumarCeldasOrden(
      cliente,
      idOrden,
      TipoEtapaMovimiento.envio_maquila,
      proc.idTipoProceso,
    );
    const recibido = await sumarCeldasOrden(
      cliente,
      idOrden,
      TipoEtapaMovimiento.recibo_maquila,
      proc.idTipoProceso,
    );
    const generaEntradaPt = proc.tipoProceso?.generaEntradaPt ?? false;
    const sumaRecibido = [...recibido.values()].reduce((s, v) => s + v, 0);
    recibidoTotal += sumaRecibido;
    if (generaEntradaPt) recibidoCostura += sumaRecibido;

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

    // enviado − recibido a este proceso.
    const clavesRec = new Set<string>([...enviado.keys(), ...recibido.keys()]);
    const celdasRecibir = ordenarCeldas(
      [...clavesRec].map((clave) => {
        const m = metaPara(meta, clave);
        return { ...m, cantidad: (enviado.get(clave) ?? 0) - (recibido.get(clave) ?? 0) };
      }),
    )
      .filter((c) => c.cantidad !== 0)
      .map(({ ordenTalla: _o, ...resto }) => resto);
    porRecibir.push({
      ...datosProceso,
      celdas: celdasRecibir,
      totalPendiente:
        [...enviado.values()].reduce((s, v) => s + v, 0) -
        [...recibido.values()].reduce((s, v) => s + v, 0),
    });
  }

  // Entregado a cliente, por celda.
  const entregadoCeldas = ordenarCeldas(
    [...entregadoMapa.keys()].map((clave) => {
      const m = metaPara(meta, clave);
      return { ...m, cantidad: entregadoMapa.get(clave) ?? 0 };
    }),
  )
    .filter((c) => c.cantidad !== 0)
    .map(({ ordenTalla: _o, ...resto }) => resto);

  const totalPedido = [...pedido.values()].reduce((s, v) => s + v, 0);
  const totalCortado = [...cortado.values()].reduce((s, v) => s + v, 0);
  const totalEnviado = await totalEtapa(cliente, idOrden, TipoEtapaMovimiento.envio_maquila);
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
    recibidoCostura,
    entregado: totalEntregado,
    porEntregar: recibidoCostura - totalEntregado,
    porCortar,
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

// ── Existencias en poder del maquilero (enviado − recibido) ──────────────────────────────────────

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
function claveGrupoMaquilero(idMaquilero: number | null, idTipoProceso: number, idOrden: number): string {
  return `${idMaquilero ?? 'sin'}|${idTipoProceso}|${idOrden}`;
}

/**
 * EXISTENCIAS EN PODER DEL MAQUILERO (form `MaqExis` del viejo): por maquilero × proceso × orden, lo
 * que el maquilero tiene pendiente de devolver = enviado − recibido (Σ de `EtapaMovimientoDet`,
 * etapas vivas). Solo devuelve filas con saldo ≠ 0. Filtros por maquilero/proceso/orden. Filtra por
 * la empresa activa (A9). La REUSARÁ EsMa en F6 (esta cuenta es la base del cargo/saldo del maquilero).
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

  const [envios, recibos] = await Promise.all([
    cliente.etapaMovimientoDet.findMany({
      where: { etapaMov: { ...baseEtapa, tipo: TipoEtapaMovimiento.envio_maquila } },
      select: seleccion,
    }),
    cliente.etapaMovimientoDet.findMany({
      where: { etapaMov: { ...baseEtapa, tipo: TipoEtapaMovimiento.recibo_maquila } },
      select: seleccion,
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
  }
  const grupos = new Map<string, Acum>();

  const tomar = (
    fila: (typeof envios)[number],
  ): { clave: string; acum: Acum } | null => {
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
    if (r !== null) r.acum.recibido += fila.cantidad;
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
      enPoder: g.enviado - g.recibido,
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
