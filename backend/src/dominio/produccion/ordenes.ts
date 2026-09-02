/**
 * Órdenes de producción — Módulo ÓRDENES (F2-E2): el documento con el que se manda a PRODUCIR
 * un renglón de un pedido (doc `Documentacion_MJD/03-Produccion.md` y `02-Pedidos.md`). CRUD de
 * la `Orden` + su matriz (`OrdenLinea` colores × `OrdenLineaTalla` tallas), copiar la matriz de
 * otra orden, cancelarla (suave), sus referencias por cliente (D7) y sus comentarios (inmutables).
 *
 * Innegociables aplicados:
 *  • A1 — toda la lógica vive aquí; las rutas (corte 2) solo validan permiso + Zod y delegan.
 *  • A2 — encabezado + matriz + referencias en UNA transacción (`enTransaccion`): crear/editar/
 *    guardar-matriz/copiar/referencias son atómicos. Corrige el viejo, que insertaba encabezado y
 *    detalle sin transacción.
 *  • A3/A9 — el `folio` sale de la secuencia atómica `"orden"` POR EMPRESA (`siguienteFolio`);
 *    NUNCA `Max()+1` (sustituye `AumentarNumOrd`). El folio es por empresa de la sesión activa.
 *  • A7 — auditoría uniforme: `creadoPorId`/`modificadoPorId` + `Bitacora` en la misma tx (la
 *    orden es entidad crítica: cada cambio de matriz/encabezado/cancelación queda registrado).
 *  • A9 — todo se filtra/sella por `idEmpresa` de la sesión activa (una orden de otra empresa,
 *    para esta sesión, no existe).
 *
 * AUTORRELLENO (paridad con `Ordenes!IdPedidosDet_AfterUpdate` del viejo): al crear la orden
 * desde un renglón de pedido, el modelo/cliente/empresa se DERIVAN del renglón→pedido (no se
 * capturan). La empresa de la orden = la empresa del PEDIDO (no la de la sesión), para no
 * desligar la orden de su pedido; se exige que esa empresa sea la de la sesión activa (A9).
 *
 * ESTADO AUTOMÁTICO (no editable por el usuario; Daniel 26-jul-2026): la orden pasa sola a
 * `completa` cuando cumple sus REQUISITOS —**tallas + receta liberada, y arte si aplica**—. La regla vive
 * ENTERA en `requisitos-orden.ts` (función pura `requisitosOrden` + `recalcularEstadoOrden`), y
 * este módulo la invoca en los tres puntos donde la orden cambia: alta, guardar matriz y copiar
 * matriz. `fechaCompletada` se sella la PRIMERA vez que se completa y NUNCA se borra (paridad con
 * `Ordenes.FechaDet = Now()` de v1). `cancelada` (por `cancelarOrden`) SIEMPRE gana.
 *   DES-COMPLETAR es la excepción, no la regla: una orden solo vuelve de `completa` a `capturada`
 * al editar LA MATRIZ DE ESA ORDEN y siempre que NO tenga actividad de producción viva (corte o
 * envío sin cancelar). Editar el BOM del MODELO ya NO alcanza a sus órdenes (V1-E3d: cada orden
 * tiene su receta congelada, `modelos/bom-modelo.ts`); lo único del modelo que las recalcula es la
 * casilla "lleva arte" (`modelos/modelos.ts`), y ésa SOLO puede COMPLETAR, nunca degradar: editar
 * un catálogo no puede sacar de los tableros a lo que ya se está produciendo ni degradar el
 * histórico.
 *   El estado es un SEMÁFORO DE CAPTURA, no una llave para operar: ninguna pantalla exige
 * `completa` para cortar/enviar/recibir/entregar (lo único que bloquea es `cancelada`).
 *
 * UPC: ELIMINADO. Los códigos de barra de orden ya no se usan y la columna `Orden.upc` fue
 * borrada del modelo (decisión Gabriel 16-jun-2026): no hay dato, endpoint ni generación.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * MAPEO DE COLUMNAS v1→v2 (contrato del ETL futuro). Verificado contra el encabezado REAL de
 * `Respaldo CLAUDE/TABLAS/Ordenes.csv` (34 columnas). Ninguna columna con datos se pierde (plan §7).
 *
 *  | v1 (Ordenes.csv)   | v2 (Orden)          | Notas                                              |
 *  |--------------------|---------------------|----------------------------------------------------|
 *  | IdOrdenes          | id                  | PK autoincrement                                   |
 *  | Numero             | folio (BigInt)      | secuencia "orden" por empresa (A3); ya no Max()+1  |
 *  | IdPedidosDet       | idPedidoLinea (Int?)| FK PedidoLinea N:1; NULLABLE para ETL, EXIGIDA en  |
 *  |                    |                     | captura nueva (orden sin pedido = solo histórico)  |
 *  | IdModelos          | idModelo            | FK Modelo; autorrellenado del pedido               |
 *  | IdMaquileros       | idMaquilero (Int?)  | FK Proveedor (maquilero = Proveedor, fusión D12);  |
 *  |                    |                     | F2 solo asignación, NO valida rol; 0→null en ETL   |
 *  | IdEtiquetasM       | idEtiquetaMarca(Int?)| FK EtiquetaMarca (nullable: hay nulos)            |
 *  | IdClientes         | idCliente           | FK Cliente; autorrellenado del pedido              |
 *  | IdTelasDis         | idTela (Int?)       | FK Tela (nullable)                                 |
 *  | Fecha              | fecha (Date?)       | @db.Date                                           |
 *  | FechaEntrega       | fechaEntrega (Date?)| @db.Date                                           |
 *  | Observaciones      | observaciones       | String?                                            |
 *  | Tallas             | tallasV1            | cadena CRUDA de trazabilidad, solo lectura; el     |
 *  |                    |                     | despivote a OrdenLineaTalla lo hace el ETL         |
 *  | MaquilaOrd         | maquilaOrd (Dec?)   | dato F3/F6 sin motor                               |
 *  | NoCost             | noCostear (Bool)    |                                                    |
 *  | Monarch            | → OrdenReferencia   | D7: NO es columna de Orden; el ETL la mete como    |
 *  |                    |                     | valor de referencia del cliente                    |
 *  | OrdCancelada       | estado=cancelada    | + motivoCancelada                                  |
 *  | MotivoCancelada    | motivoCancelada     | String?                                            |
 *  | IdEmpresas         | idEmpresa           | FK Empresa (A9)                                    |
 *  | UPC                | — (EXCLUIDA)        | códigos de barra en retiro: columna eliminada      |
 *  | IdCP_Articulos     | idTipoArticuloRC    | Int? SIN FK (F5)                                   |
 *  | IdRC_Aplicaciones  | idRcAplicaciones    | Int? SIN FK (F5)                                   |
 *  | IdRC_TipoTelas     | idRcTipoTelas       | Int? SIN FK (F5)                                   |
 *  | FechaInicioRC      | fechaInicioRC       | DateTime? (F5)                                     |
 *  | FechaEntregaRC     | fechaEntregaRC      | DateTime? (F5)                                     |
 *  | FechaProg          | fechaProg           | DateTime? (F5)                                     |
 *  | EnRiesgo           | enRiesgo (Bool?)    | F5                                                 |
 *  | SI_RC              | siRC (Bool?)        | F5                                                 |
 *  | FechaDet           | fechaCompletada     | deriva estado='completa'                           |
 *  | Composicion        | composicion         | String? — se HEREDA de `Modelo.composicion`        |
 *  | CompForzada        | compForzada (Bool)  | true = override manual de ESTA orden               |
 *  | Pagada             | pagada (Bool?)      | F6                                                 |
 *  | ObsMaquila         | obsMaquila          | String?                                            |
 *  | AplicacionOrd      | aplicacionOrd (Dec?)| dato F3/F6                                         |
 *  | RC_Viva            | rcViva (Bool?)      | F5                                                 |
 *
 * OrdenesDet (v1, 11 cols) → OrdenLinea + OrdenLineaTalla: IdOrdenesDet→OrdenLinea.id;
 *  IdOrdenes→idOrden; Color (texto libre)→idColor (FK Color, el ETL fusiona); T1..T8→un
 *  OrdenLineaTalla por talla (idTalla + cantidad), despivotado por el ETL.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */
import {
  esquemaOrdenCrear,
  esquemaOrdenEditar,
  esquemaOrdenMatrizCuerpo,
  esquemaOrdenCopiarMatrizCuerpo,
  esquemaOrdenCancelarCuerpo,
  esquemaOrdenReferenciasCuerpo,
  esquemaOrdenComentarioCuerpo,
} from '../../contrato/esquemas/orden.js';
import type {
  DatosOrdenLineaEntrada,
  DatosOrdenReferenciaEntrada,
  OrdenSalida,
} from '../../contrato/esquemas/orden.js';
import type {
  Orden,
  OrdenLinea,
  OrdenLineaTalla,
  OrigenModelo,
  Prisma,
} from '../../datos/index.js';
import { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { dispararPublicacion } from '../../comun/cola-eventos.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  EVENTOS_OUTBOX,
  registrarEventoOutbox,
  VERSION_ORDEN_CREADA,
  type EventoOrdenCreada,
} from '../../comun/eventos-dominio.js';
import {
  armarPagina,
  esquemaPaginacion,
  rangoPrisma,
  type Pagina,
} from '../../comun/paginacion.js';
import { nombreDeUsuario, nombresDeUsuarios } from '../../comun/nombres-usuario.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { sinonimosDeDepartamentos } from '../catalogos/cliente-departamentos-sinonimos.js';

import { copiarRecetaDelModelo } from './receta-orden.js';
import { recalcularEstadoOrden, requisitosOrden } from './requisitos-orden.js';

/** Clave de la secuencia de folios de órdenes (A3 — por empresa). */
export const CLAVE_SECUENCIA_ORDEN = 'orden';

/** Alta de orden: campos del esquema compartido. */
export type EntradaCrearOrden = z.input<typeof esquemaOrdenCrear>;
/** Edición del encabezado de la orden. */
export type EntradaActualizarOrden = z.input<typeof esquemaOrdenEditar>;

/**
 * Parámetros del listado con tipos NATIVOS (la ruta ya coaccionó la querystring; el dominio
 * re-valida con tipos nativos — mismo patrón que `pedidos.ts`/`clientes.ts`). No se reusa el
 * esquema del contrato (que coacciona desde texto) para que la ruta pueda pasar el `request.query`
 * ya parseado sin chocar de tipos.
 */
const esquemaListarOrdenesDominio = esquemaPaginacion.extend({
  busqueda: z.string().trim().max(200).optional(),
  idModelo: z.number().int().positive().optional(),
  idCliente: z.number().int().positive().optional(),
  anio: z.number().int().min(2000).max(2100).optional(),
  estado: z.enum(['capturada', 'completa', 'cancelada']).optional(),
  incluirCanceladas: z.boolean().default(false),
  ordenarPor: z.enum(['folio', 'fecha', 'fechaEntrega', 'creadoEn']).default('folio'),
  direccion: z.enum(['asc', 'desc']).default('desc'),
});

/** Parámetros del listado (los reutiliza la ruta REST en corte 2). */
export type ParametrosListarOrdenes = z.input<typeof esquemaListarOrdenesDominio>;

/**
 * Orden con todo lo que arma el dominio antes de proyectar a la salida: modelo/cliente/maquilero/
 * etiqueta/tela (para nombres en UI), su matriz (colores con sus tallas), referencias y comentarios.
 */
type OrdenConDetalle = Orden & {
  modelo: {
    codigo: string;
    descripcion: string | null;
    /** Casilla "lleva arte": el único insumo de la regla que sigue viviendo en el MODELO. */
    llevaArte: boolean;
  };
  /** Artes VIVOS de la RECETA de esta orden (insumo de la regla, V1-E3d). */
  _count: { recetaArtes: number };
  cliente: { nombre: string };
  maquilero: { nombre: string } | null;
  etiquetaMarca: { nombre: string } | null;
  tela: { nombre: string } | null;
  lineas: (OrdenLinea & {
    color: { nombre: string };
    tallas: (OrdenLineaTalla & { talla: { etiqueta: string } })[];
  })[];
  referencias: {
    id: number;
    idClienteCampo: number;
    valor: string;
    clienteCampo: { etiqueta: string };
  }[];
  comentarios: { id: number; idUsuario: string | null; comentario: string; fecha: Date }[];
};

/** `include` estándar para traer la orden con todo su detalle (ordenado de forma estable). */
const incluirDetalle = {
  modelo: {
    select: {
      codigo: true,
      descripcion: true,
      // Único insumo de la regla que sigue en el MODELO (V1-E3d): la casilla "lleva arte". Los
      // otros dos son de la ORDEN (receta liberada + artes de la receta) y viajan abajo.
      llevaArte: true,
    },
  },
  // Conteo del arte VIVO de la receta de ESTA orden, sin traer la receta entera.
  _count: { select: { recetaArtes: { where: { excluido: false } } } },
  cliente: { select: { nombre: true } },
  maquilero: { select: { nombre: true } },
  etiquetaMarca: { select: { nombre: true } },
  tela: { select: { nombre: true } },
  lineas: {
    orderBy: { id: 'asc' },
    include: {
      color: { select: { nombre: true } },
      tallas: {
        orderBy: [{ talla: { orden: 'asc' } }, { id: 'asc' }],
        include: { talla: { select: { etiqueta: true } } },
      },
    },
  },
  referencias: {
    orderBy: { id: 'asc' },
    include: { clienteCampo: { select: { etiqueta: true } } },
  },
  comentarios: { orderBy: { id: 'asc' } },
} satisfies Prisma.OrdenInclude;

// ── Helpers de existencia/validación ──────────────────────────────────────────────

/**
 * Busca una orden de la EMPRESA ACTIVA por id, o lanza `ErrorNoEncontrado` (una orden de otra
 * empresa, para esta sesión, no existe — A9). Lo usan obtener/editar/matriz/copiar/cancelar.
 */
async function exigirOrden(tx: Tx, id: number, idEmpresa: number): Promise<Orden> {
  const orden = await tx.orden.findFirst({ where: { id, idEmpresa } });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', id);
  }
  return orden;
}

/** Datos del renglón de pedido para el AUTORRELLENO de la orden. */
interface OrigenPedidoLinea {
  idModelo: number;
  idCliente: number;
  idEmpresa: number;
  /** OC original del cliente en el pedido: se copia como SNAPSHOT a la orden (R3, B3). */
  ocCliente: string | null;
  /**
   * COMPOSICIÓN capturada en la ficha del MODELO (Daniel 24-jul-2026): la orden la HEREDA sola.
   * No es un snapshot congelado como `ocCliente`: mientras la orden no tenga override
   * (`compForzada = false`) se vuelve a derivar cada vez que se guarda su encabezado.
   */
  composicionModelo: string | null;
}

/**
 * Resuelve y VALIDA el renglón de pedido del que sale la orden (autorrelleno + reglas, paridad con
 * `IdPedidosDet_AfterUpdate`). Exige (decisión Gabriel 16-jun-2026: orden sin pedido = solo
 * histórico, jamás captura nueva):
 *  • que el renglón exista,
 *  • que su pedido sea de la EMPRESA ACTIVA (A9),
 *  • que el pedido NO esté cancelado (`pedCancelado`) ni marcado `noProducir`,
 *  • que el modelo del renglón siga ACTIVO (no producir un modelo descontinuado),
 *  • 🔴 que el modelo que va a QUEDAR en la orden NO sea de `origen = 'desarrollo'` (fila 0.090,
 *    cierra §Post-F9.34): un desarrollo no se produce, se le genera la OP —y ahí nace su modelo de
 *    producción por color. Ver la guarda, abajo, para quién la cruza y quién no.
 * Devuelve el modelo/cliente/empresa para sellarlos en la orden.
 *
 * ⭐⭐ V1-E3 — `idModeloDeLaOrden` (opcional): el modelo que de verdad va a llevar la orden cuando
 * NO es el del renglón. Pasa en un solo caso, y es el que da nombre a la etapa: el renglón apunta a
 * un modelo de DESARROLLO y la salida a producción hace nacer (o reusa) el **modelo de producción de
 * ese color**, que es quien tiene que quedar en la OP. El renglón NO se toca: sigue apuntando a su
 * desarrollo, que es de donde salen la receta y el precio.
 *
 * ⚠️ Cuando viene, se comprueban **los DOS** modelos: el del renglón (el padre, dueño de la receta)
 * y el de la orden (el hijo). Que el padre esté vivo no dice nada del hijo, ni al revés — y producir
 * cualquiera de los dos descontinuado es lo que la guarda existe para impedir. La COMPOSICIÓN se
 * hereda del modelo que queda en la ORDEN, no del renglón: es la ficha de la prenda que se va a
 * producir.
 */
async function resolverOrigenPedido(
  tx: Tx,
  idPedidoLinea: number,
  idEmpresa: number,
  idModeloDeLaOrden?: number,
): Promise<OrigenPedidoLinea> {
  const linea = await tx.pedidoLinea.findUnique({
    where: { id: idPedidoLinea },
    select: {
      idModelo: true,
      modelo: { select: { activo: true, codigo: true, composicion: true, origen: true } },
      pedido: {
        select: {
          idEmpresa: true,
          idCliente: true,
          pedCancelado: true,
          noProducir: true,
          folio: true,
          ocCliente: true,
        },
      },
    },
  });
  if (linea === null) {
    throw new ErrorNoEncontrado('Renglón de pedido', idPedidoLinea);
  }
  if (linea.pedido.idEmpresa !== idEmpresa) {
    // El pedido es de otra empresa: para esta sesión, ese renglón no existe (A9).
    throw new ErrorNoEncontrado('Renglón de pedido', idPedidoLinea);
  }
  if (linea.pedido.pedCancelado) {
    throw new ErrorConflicto(
      `El pedido ${Number(linea.pedido.folio)} está cancelado; no se le pueden crear órdenes.`,
    );
  }
  if (linea.pedido.noProducir) {
    throw new ErrorConflicto(
      `El pedido ${Number(linea.pedido.folio)} está marcado como "no producir"; no se le pueden crear órdenes.`,
    );
  }
  if (!linea.modelo.activo) {
    throw new ErrorConflicto(
      `El modelo "${linea.modelo.codigo}" está descontinuado; no se puede producir.`,
    );
  }

  // V1-E3: la orden puede llevar OTRO modelo que el del renglón (el hijo de producción del color).
  // `modeloDeLaOrden` es el que se sella en la OP y del que se hereda la composición.
  const modeloDeLaOrden =
    idModeloDeLaOrden === undefined || idModeloDeLaOrden === linea.idModelo
      ? { id: linea.idModelo, ...linea.modelo }
      : await exigirModeloProducible(tx, idModeloDeLaOrden);

  // 🔴🔴 V1-E3 (§Post-F9.34, cerrada en la fila 0.090) — **UNA OP NUNCA LLEVA UN MODELO DE
  // DESARROLLO.** La guarda mira el modelo que se va a SELLAR en la orden, no la puerta por la que
  // se entró, porque lo que hay que prohibir es el resultado: un desarrollo produciéndose.
  //
  // Quién la cruza y quién no, medido:
  //  • `salidaAProduccion` — NUNCA la toca: `resolverModeloDeLaOp` le entrega o un modelo de
  //    producción heredado (renglón legado) o el hijo por color que acaba de nacer/reusar, y los
  //    dos son `origen = 'produccion'` por construcción.
  //  • `POST /api/ordenes` — la cruza justo en el caso que era el agujero: renglón que apunta a un
  //    desarrollo, sin `idModeloDeLaOrden`. Por esa puerta nacía una OP de un modelo que sigue en
  //    `origen = 'desarrollo'`, sin `numeroProduccion` y —desde V1-E3— sin ningún modelo por color.
  //    Su caso LEGADO (renglón que ya apunta a producción) sigue funcionando igual: no se retira
  //    ninguna capacidad, se cierra una que producía una OP inválida.
  //
  // FALLA CERRADO y manda a la puerta buena: el número de 5 dígitos es del MODELO, y quien lo hace
  // nacer es la salida a producción. Crear la orden aquí y "arreglar el modelo después" no existe.
  if (modeloDeLaOrden.origen === 'desarrollo') {
    throw new ErrorConflicto(
      `El modelo "${modeloDeLaOrden.codigo}" es de desarrollo: no se le puede crear una orden por ` +
        `captura directa. Genera la OP desde el renglón del pedido ("Generar OP", ` +
        `POST /api/pedidos/lineas/{idLinea}/salida-produccion): ahí nace el modelo de producción ` +
        `del color con su número de 5 dígitos, que es el que lleva la orden.`,
    );
  }

  return {
    idModelo: modeloDeLaOrden.id,
    idCliente: linea.pedido.idCliente,
    idEmpresa: linea.pedido.idEmpresa,
    ocCliente: linea.pedido.ocCliente,
    composicionModelo: modeloDeLaOrden.composicion,
  };
}

/**
 * Exige que un modelo exista y NO esté descontinuado, con el MISMO texto que la comprobación del
 * modelo del renglón (V1-E3): las dos prohíben lo mismo —producir un modelo dado de baja— y dos
 * frases distintas para la misma regla es como se separan dos caminos que deben decidir igual.
 */
async function exigirModeloProducible(
  tx: Tx,
  idModelo: number,
): Promise<{
  id: number;
  activo: boolean;
  codigo: string;
  composicion: string | null;
  origen: OrigenModelo;
}> {
  const modelo = await tx.modelo.findUnique({
    where: { id: idModelo },
    select: { id: true, activo: true, codigo: true, composicion: true, origen: true },
  });
  if (modelo === null) {
    throw new ErrorNoEncontrado('Modelo', idModelo);
  }
  if (!modelo.activo) {
    throw new ErrorConflicto(
      `El modelo "${modelo.codigo}" está descontinuado; no se puede producir.`,
    );
  }
  return modelo;
}

/** Exige que el maquilero (Proveedor) exista (en F2 NO se valida su rol de maquila, solo asignación). */
async function exigirProveedorExiste(tx: Tx, idMaquilero: number): Promise<void> {
  const prov = await tx.proveedor.findUnique({ where: { id: idMaquilero }, select: { id: true } });
  if (prov === null) {
    throw new ErrorNoEncontrado('Proveedor', idMaquilero);
  }
}

/** Exige que la etiqueta de marca exista (las FK las protege la BD, pero damos un error claro). */
async function exigirEtiquetaExiste(tx: Tx, idEtiquetaMarca: number): Promise<void> {
  const e = await tx.etiquetaMarca.findUnique({
    where: { id: idEtiquetaMarca },
    select: { id: true },
  });
  if (e === null) {
    throw new ErrorNoEncontrado('EtiquetaMarca', idEtiquetaMarca);
  }
}

/** Exige que la tela exista. */
async function exigirTelaExiste(tx: Tx, idTela: number): Promise<void> {
  const t = await tx.tela.findUnique({ where: { id: idTela }, select: { id: true } });
  if (t === null) {
    throw new ErrorNoEncontrado('Tela', idTela);
  }
}

// ── Sincronización de la matriz (colores × tallas) — diff mínimo, conserva auditoría ──

/**
 * Sincroniza la matriz (renglones de color + sus tallas) al `set` deseado en la transacción (A2),
 * conservando la auditoría de los renglones que no cambian (diff mínimo, como `sincronizarLineas`
 * de pedidos). Valida:
 *  • COLOR no repetido en el set (regla `@@unique([idOrden, idColor])` + mensaje claro).
 *  • Todos los colores existen y están activos.
 *  • Todas las tallas existen en el catálogo y no se repiten dentro de un mismo color.
 *  • Cantidades enteras ≥0 (ya las validó Zod; aquí se confía en el tipo).
 *
 * Renglones con `id` que existan se ACTUALIZAN (y sus tallas se reemplazan diff-mínimo); los
 * nuevos (sin `id`) se CREAN con sus tallas; los que ya no están en el set se BORRAN (Cascade
 * borra sus tallas). Devuelve el número de renglones del set resultante.
 */
async function sincronizarMatriz(
  tx: Tx,
  sesion: SesionUsuario,
  idOrden: number,
  set: DatosOrdenLineaEntrada[],
): Promise<number> {
  // 1) Color no repetido en el set entrante.
  const idsColor = set.map((l) => l.idColor);
  if (new Set(idsColor).size !== idsColor.length) {
    throw new ErrorValidacion('Un color no puede aparecer dos veces en la misma orden.');
  }

  // 2) Colores existen y están activos.
  if (idsColor.length > 0) {
    const colores = await tx.color.findMany({
      where: { id: { in: [...new Set(idsColor)] } },
      select: { id: true, activo: true, nombre: true },
    });
    const porId = new Map(colores.map((c) => [c.id, c]));
    for (const idColor of new Set(idsColor)) {
      const color = porId.get(idColor);
      if (color === undefined) {
        throw new ErrorNoEncontrado('Color', idColor);
      }
      if (!color.activo) {
        throw new ErrorConflicto(`El color "${color.nombre}" está desactivado; no se puede usar.`);
      }
    }
  }

  // 3) Tallas: existen en el catálogo y no se repiten dentro de un color.
  const idsTalla = set.flatMap((l) => l.tallas.map((t) => t.idTalla));
  if (idsTalla.length > 0) {
    const tallas = await tx.talla.findMany({
      where: { id: { in: [...new Set(idsTalla)] } },
      select: { id: true },
    });
    const existentes = new Set(tallas.map((t) => t.id));
    for (const idTalla of new Set(idsTalla)) {
      if (!existentes.has(idTalla)) {
        throw new ErrorNoEncontrado('Talla', idTalla);
      }
    }
  }
  for (const linea of set) {
    const idsTallaLinea = linea.tallas.map((t) => t.idTalla);
    if (new Set(idsTallaLinea).size !== idsTallaLinea.length) {
      throw new ErrorValidacion('Una talla no puede aparecer dos veces en el mismo color.');
    }
  }

  // 4) Diff de renglones (colores) por id.
  const actuales = await tx.ordenLinea.findMany({ where: { idOrden }, select: { id: true } });
  const idsActuales = new Set(actuales.map((l) => l.id));
  const idsDeseados = new Set(set.filter((l) => l.id !== undefined).map((l) => l.id as number));

  const aBorrar = [...idsActuales].filter((id) => !idsDeseados.has(id));
  if (aBorrar.length > 0) {
    // Cascade borra las tallas del renglón.
    await tx.ordenLinea.deleteMany({ where: { id: { in: aBorrar }, idOrden } });
  }

  for (const linea of set) {
    // Pantone POR color (petición Daniel): sólo se toca si viene en el set (undefined = no lo mandó,
    // se conserva; null = limpiarlo; string = capturarlo).
    const datosPantone = linea.pantone !== undefined ? { pantone: linea.pantone } : {};
    if (linea.id !== undefined && idsActuales.has(linea.id)) {
      await tx.ordenLinea.update({
        where: { id: linea.id },
        data: { idColor: linea.idColor, ...datosPantone, ...datosModificacion(sesion) },
      });
      await reemplazarTallas(tx, sesion, linea.id, linea.tallas);
    } else {
      const creada = await tx.ordenLinea.create({
        data: { idOrden, idColor: linea.idColor, ...datosPantone, ...datosCreacion(sesion) },
      });
      await reemplazarTallas(tx, sesion, creada.id, linea.tallas);
    }
  }

  return set.length;
}

/**
 * Reemplaza las tallas de un renglón (color) por el set dado, diff mínimo: las que están y siguen
 * → update de cantidad; las nuevas → create; las que ya no están → delete. Conserva la auditoría
 * de las que no cambian.
 */
async function reemplazarTallas(
  tx: Tx,
  sesion: SesionUsuario,
  idOrdenLinea: number,
  tallas: { idTalla: number; cantidad: number }[],
): Promise<void> {
  const actuales = await tx.ordenLineaTalla.findMany({
    where: { idOrdenLinea },
    select: { id: true, idTalla: true },
  });
  const idLineaTallaPorTalla = new Map(actuales.map((t) => [t.idTalla, t.id]));
  const idsTallaDeseados = new Set(tallas.map((t) => t.idTalla));

  const aBorrar = actuales.filter((t) => !idsTallaDeseados.has(t.idTalla)).map((t) => t.id);
  if (aBorrar.length > 0) {
    await tx.ordenLineaTalla.deleteMany({ where: { id: { in: aBorrar } } });
  }

  for (const talla of tallas) {
    const idExistente = idLineaTallaPorTalla.get(talla.idTalla);
    if (idExistente !== undefined) {
      await tx.ordenLineaTalla.update({
        where: { id: idExistente },
        data: { cantidad: talla.cantidad, ...datosModificacion(sesion) },
      });
    } else {
      await tx.ordenLineaTalla.create({
        data: {
          idOrdenLinea,
          idTalla: talla.idTalla,
          cantidad: talla.cantidad,
          ...datosCreacion(sesion),
        },
      });
    }
  }
}

// ── Proyección a la salida (total derivado por suma) ────────────────────────────────

/**
 * Proyecta una orden (con detalle) a la forma JSON del contrato. El total se DERIVA por suma.
 * `ocultarPrecios` (rediseño R2, §4.4.3): desde que los precios de la orden se capturan en vivo
 * (`precios-orden.ts`), `maquilaOrd`/`aplicacionOrd` son el PRECIO REAL negociado — sin el permiso
 * `ordenes.ver-precio-real-maquila` van null también aquí (paridad con el acceso 36 del viejo;
 * antes eran dato inerte del ETL y se exponían con solo `ordenes.ver`).
 *
 * `nombrePorId` llega YA RESUELTO desde el llamador (mismo patrón que `aEventoSalida`): esta función
 * es SÍNCRONA a propósito y no puede consultar la base. Resolver el nombre del autor renglón por
 * renglón haría N+1 en el LISTADO de órdenes —cada orden trae sus comentarios embebidos—, así que
 * `listarOrdenes` resuelve la página COMPLETA de una sola consulta. El mapa es OBLIGATORIO a
 * propósito (sin default): si mañana aparece un tercer llamador y olvida resolver los nombres, que
 * sea un error de compilación y no un `nombreUsuario: null` silencioso en toda la pantalla.
 */
function aOrdenSalida(
  orden: OrdenConDetalle,
  ocultarPrecios: boolean,
  nombrePorId: ReadonlyMap<string, string>,
): OrdenSalida {
  let totalPiezas = 0;
  const lineas = orden.lineas.map((l) => {
    let totalLinea = 0;
    const tallas = l.tallas.map((t) => {
      totalLinea += t.cantidad;
      return { idTalla: t.idTalla, etiquetaTalla: t.talla.etiqueta, cantidad: t.cantidad };
    });
    totalPiezas += totalLinea;
    return {
      id: l.id,
      idColor: l.idColor,
      color: l.color.nombre,
      pantone: l.pantone,
      tallas,
      totalPiezas: totalLinea,
    };
  });

  return {
    id: orden.id,
    folio: Number(orden.folio),
    idEmpresa: orden.idEmpresa,
    estado: orden.estado,
    idPedidoLinea: orden.idPedidoLinea,
    idModelo: orden.idModelo,
    codigoModelo: orden.modelo.codigo,
    descripcionModelo: orden.modelo.descripcion,
    idCliente: orden.idCliente,
    cliente: orden.cliente.nombre,
    idMaquilero: orden.idMaquilero,
    maquilero: orden.maquilero?.nombre ?? null,
    idEtiquetaMarca: orden.idEtiquetaMarca,
    etiquetaMarca: orden.etiquetaMarca?.nombre ?? null,
    idTela: orden.idTela,
    tela: orden.tela?.nombre ?? null,
    fecha: aFechaIso(orden.fecha),
    fechaEntrega: aFechaIso(orden.fechaEntrega),
    observaciones: orden.observaciones,
    composicion: orden.composicion,
    compForzada: orden.compForzada,
    obsMaquila: orden.obsMaquila,
    noCostear: orden.noCostear,
    fechaCompletada: orden.fechaCompletada === null ? null : orden.fechaCompletada.toISOString(),
    // Transparencia del estado (Daniel 26-jul-2026): la orden dice POR QUÉ está como está.
    requisitos: requisitosOrden({
      renglonesMatriz: orden.lineas.length,
      // V1-E3d: el requisito ya no le pregunta al MODELO si tiene avíos, sino a ESTA orden si su
      // receta está liberada y si trae su arte.
      recetaLiberada: orden.recetaLiberadaEn !== null,
      artesOrden: orden._count.recetaArtes,
      llevaArte: orden.modelo.llevaArte,
    }),
    motivoCancelada: orden.motivoCancelada,
    ocCliente: orden.ocCliente,
    tallasV1: orden.tallasV1,
    maquilaOrd: ocultarPrecios || orden.maquilaOrd === null ? null : orden.maquilaOrd.toNumber(),
    aplicacionOrd:
      ocultarPrecios || orden.aplicacionOrd === null ? null : orden.aplicacionOrd.toNumber(),
    pagada: orden.pagada,
    enRiesgo: orden.enRiesgo,
    siRC: orden.siRC,
    rcViva: orden.rcViva,
    lineas,
    totalPiezas,
    referencias: orden.referencias.map((r) => ({
      id: r.id,
      idClienteCampo: r.idClienteCampo,
      etiqueta: r.clienteCampo.etiqueta,
      valor: r.valor,
    })),
    comentarios: orden.comentarios.map((c) => ({
      id: c.id,
      idUsuario: c.idUsuario,
      nombreUsuario: nombreDeUsuario(nombrePorId, c.idUsuario),
      comentario: c.comentario,
      fecha: c.fecha.toISOString(),
    })),
    creadoEn: orden.creadoEn.toISOString(),
    creadoPorId: orden.creadoPorId,
    modificadoEn: orden.modificadoEn.toISOString(),
    modificadoPorId: orden.modificadoPorId,
  };
}

/** Convierte un `DateTime @db.Date` a `YYYY-MM-DD`, o `null`. */
function aFechaIso(fecha: Date | null): string | null {
  return fecha === null ? null : fecha.toISOString().slice(0, 10);
}

/** Convierte un `YYYY-MM-DD` (o null/undefined) al `Date` que Prisma guarda en `@db.Date`. */
function aDateColumna(valor: string | null | undefined): Date | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  return new Date(`${valor}T00:00:00.000Z`);
}

/** Normaliza un texto opcional (trim ya aplicado por Zod; vacío → null). */
function aTexto(valor: string | null | undefined): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  return valor;
}

/**
 * COMPOSICIÓN de la orden — decisión de DANIEL (24-jul-2026): «la composición no sale de la OC del
 * cliente, sale del desarrollo del modelo; de ahí la jala». La fuente es `Modelo.composicion`; lo
 * que se capture en la orden es un OVERRIDE de ESA orden, marcado con `compForzada = true`.
 *
 * Reglas (las mismas en el alta y en la edición del encabezado):
 *  • Sin captura (`null`/'') → se HEREDA la del modelo y `compForzada = false`.
 *  • Con captura IGUAL a la del MODELO → se trata como HEREDADA (`compForzada = false`): teclear
 *    justo lo que ya dice el modelo no es "desconectarse" de él.
 *  • Con captura DISTINTA de la guardada → override: se respeta el texto y `compForzada = true`.
 *  • Con captura IGUAL a la guardada → no se toca la bandera (re-guardar el encabezado sin tocar
 *    el campo NUNCA convierte una composición heredada en override).
 *  • `compForzada` explícito en el cuerpo MANDA (lo usan el importador de OC y el ETL): `false`
 *    fuerza la re-derivación del modelo, `true` conserva el texto capturado.
 *
 * 🔒 HEREDAR NUNCA DESTRUYE UN DATO (guard anti-pérdida). Si al heredar el modelo NO tiene
 * composición y la orden SÍ tenía una, se CONSERVA la de la orden. Sin este guard, abrir una OP
 * histórica (o importada por PDF) y guardar cualquier campo del encabezado la habría vaciado en
 * silencio, porque `modelos.composicion` nació vacía. El guard cubre EXACTAMENTE ese caso: el
 * guardado que NO tocó el campo (`capturada === actual`, incluido el campo omitido). Si el usuario
 * escribió otra cosa —o lo vació, o el cuerpo pidió `compForzada: false`— manda lo que pidió, no el
 * guard. La migración de datos `20260724130000_ordenes_composicion_historica` marca además esas
 * órdenes como override.
 *
 * Re-derivación: solo ocurre donde la orden YA se está tocando (alta y guardado del encabezado) y
 * solo si la orden NO tiene override. Cambiar la composición del MODELO no recalcula de golpe las
 * órdenes históricas (sería un recálculo masivo silencioso); cada una la refresca al siguiente
 * guardado de su encabezado. El modelo de una orden NO se puede cambiar (no está en el PATCH: se
 * autorrellena del renglón de pedido al nacer), así que no hay caso de "cambió el modelo".
 */
function resolverComposicion(args: {
  /** Lo que viene en el cuerpo (`undefined` = no se tocó el campo). */
  capturada: string | null | undefined;
  /** Bandera explícita del cuerpo (`undefined` = que la deduzca esta función). */
  forzadaExplicita: boolean | undefined;
  /** Composición guardada hoy en la orden (`null` en el alta). */
  actual: string | null;
  /** Bandera guardada hoy en la orden (`false` en el alta). */
  forzadaActual: boolean;
  /** Composición capturada en la ficha del modelo. */
  delModelo: string | null;
}): { composicion: string | null; compForzada: boolean } {
  const capturada = args.capturada === undefined ? args.actual : (aTexto(args.capturada) ?? null);

  let forzada: boolean;
  if (args.forzadaExplicita !== undefined) {
    forzada = args.forzadaExplicita;
  } else if (capturada === null) {
    // Vaciar el campo = "vuelve a la del modelo".
    forzada = false;
  } else if (capturada === args.delModelo) {
    // Es exactamente la del modelo: sigue siendo heredada, no un override.
    forzada = false;
  } else if (capturada === args.actual) {
    // Mismo texto que ya estaba: se conserva el estado actual de la bandera.
    forzada = args.forzadaActual;
  } else {
    forzada = true;
  }

  if (forzada) {
    return { composicion: capturada, compForzada: true };
  }
  // Guard anti-pérdida: heredar "nada" sobre un dato existente NO borra (ver 🔒 arriba). Solo
  // aplica al guardado que NO tocó el campo; si se pidió otro texto (o vaciarlo), manda lo pedido.
  if (args.delModelo === null && args.actual !== null && capturada === args.actual) {
    return { composicion: args.actual, compForzada: args.forzadaActual };
  }
  return { composicion: args.delModelo, compForzada: false };
}

// ── Operaciones ───────────────────────────────────────────────────────────────────

/**
 * ⭐⭐ V1-E3 — Opciones del alta que **NO viajan por el contrato REST** y por eso no viven en
 * `esquemaOrdenCrear`: son composición dominio→dominio.
 *
 * 🔴 **Y que no viajen es la mitad del diseño.** El modelo de una orden es AUTORRELLENO (sale del
 * renglón del pedido, F2-E2): si esto fuera un campo del cuerpo, cualquier cliente del API podría
 * crear una orden de un modelo que no tiene nada que ver con su pedido, y el autorrelleno dejaría de
 * ser una garantía para volverse una sugerencia. Como parámetro de función, la única puerta que lo
 * puede usar es la que ya decidió el modelo con la regla del negocio.
 */
export interface OpcionesAltaOrden {
  /**
   * El modelo de PRODUCCIÓN que se sella en la orden cuando NO es el del renglón — el hijo por color
   * que hace nacer `salidaAProduccion` (V1-E3). Ausente = el de siempre, el del renglón.
   */
  idModeloDeLaOrden?: number | undefined;
}

/**
 * Crea una orden de producción desde un renglón de pedido (`idPedidoLinea`) en UNA transacción
 * (A2). AUTORRELLENO de modelo/cliente/empresa del renglón→pedido; el folio sale de la secuencia
 * atómica `"orden"` de la empresa del pedido (A3/A9). EXIGE el renglón de pedido y rechaza pedidos
 * cancelados/no-producir o modelos descontinuados. Permite N órdenes por renglón (resurtidos). Si
 * `lineas` viene, crea la matriz en la misma tx y el estado se deriva de la regla. Auditoría +
 * bitácora.
 *
 * Rediseño R3: copia el SNAPSHOT `Pedido.ocCliente` → `Orden.ocCliente` (B3: la OC del cliente
 * queda amarrada a CADA OP que nace del pedido) y publica el evento outbox `orden-creada` (B5:
 * la RC se PROGRAMA SOLA; el consumidor de `rcAutomatica.ts` la genera en segundo plano). El
 * evento se publica AQUÍ —el punto ÚNICO de nacimiento por captura— para que tanto la salida a
 * producción del constructor como el alta directa de /captura la disparen sin duplicar lógica;
 * el modo migración usa `crearOrdenMigrada` (migracion.ts), que NO pasa por aquí y NO encola.
 *
 * COMPOSICIÓN (Daniel 24-jul-2026): si el alta no la captura, la orden HEREDA
 * `Modelo.composicion` con `compForzada = false`; si la captura, queda como override
 * (`compForzada = true`). Ver `resolverComposicion`.
 *
 * ⭐⭐ V1-E3 — `opciones.idModeloDeLaOrden` ({@link OpcionesAltaOrden}) sella la orden con OTRO
 * modelo que el del renglón: el hijo de producción por color que hace nacer `salidaAProduccion`.
 * NO viaja por el contrato REST a propósito (ver el tipo). Sin él, todo sigue exactamente igual.
 *
 * 🔴 Y por eso mismo el alta por CAPTURA (la ruta `POST /api/ordenes`, que no pasa ese modelo)
 * rechaza los renglones de DESARROLLO: sin el hijo por color, su OP nacería de un modelo que no
 * está en producción y sin nº de 5 dígitos. La guarda vive en `resolverOrigenPedido`.
 */
export async function crearOrden(
  sesion: SesionUsuario,
  entrada: EntradaCrearOrden,
  bd?: ContextoBd,
  opciones: OpcionesAltaOrden = {},
): Promise<OrdenSalida> {
  verificarPermiso(sesion, 'ordenes.administrar');
  const datos = validarEntrada(esquemaOrdenCrear, entrada);

  const idOrden = await enTransaccion(async (tx) => {
    const origen = await resolverOrigenPedido(
      tx,
      datos.idPedidoLinea,
      sesion.idEmpresaActiva,
      opciones.idModeloDeLaOrden,
    );

    if (datos.idMaquilero != null) {
      await exigirProveedorExiste(tx, datos.idMaquilero);
    }
    if (datos.idEtiquetaMarca != null) {
      await exigirEtiquetaExiste(tx, datos.idEtiquetaMarca);
    }
    if (datos.idTela != null) {
      await exigirTelaExiste(tx, datos.idTela);
    }

    const folio = await siguienteFolio(tx, origen.idEmpresa, CLAVE_SECUENCIA_ORDEN);

    // Composición: se HEREDA del modelo salvo que el alta capture una a mano (Daniel 24-jul-2026).
    const composicion = resolverComposicion({
      capturada: datos.composicion,
      forzadaExplicita: datos.compForzada,
      actual: null,
      forzadaActual: false,
      delModelo: origen.composicionModelo,
    });

    const orden = await tx.orden.create({
      data: {
        folio,
        idEmpresa: origen.idEmpresa,
        idPedidoLinea: datos.idPedidoLinea,
        idModelo: origen.idModelo,
        idCliente: origen.idCliente,
        idMaquilero: datos.idMaquilero ?? null,
        idEtiquetaMarca: datos.idEtiquetaMarca ?? null,
        idTela: datos.idTela ?? null,
        fecha: aDateColumna(datos.fecha) ?? null,
        fechaEntrega: aDateColumna(datos.fechaEntrega) ?? null,
        observaciones: aTexto(datos.observaciones) ?? null,
        composicion: composicion.composicion,
        compForzada: composicion.compForzada,
        obsMaquila: aTexto(datos.obsMaquila) ?? null,
        noCostear: datos.noCostear ?? false,
        ocCliente: origen.ocCliente,
        ...datosCreacion(sesion),
      },
    });

    // Matriz inicial opcional: la sincroniza y deja que la regla derive el estado (tallas +
    // receta liberada, y arte si aplica — `requisitos-orden.ts`).
    // ⚠️ POR ESTA VÍA ninguna orden puede nacer `completa`, ni trayendo su matriz: la receta se
    // copia unas líneas más abajo y `copiarRecetaDelModelo` NO escribe `liberadoEn` (la deja en
    // NULL), así que `recetaLiberadaEn` de la orden nunca se pone y el recálculo del final SIEMPRE
    // encuentra el requisito `receta` en falso. Una orden capturada a mano nace `capturada` y sólo
    // se completa cuando Desarrollo libera su receta.
    // La EXCEPCIÓN es la otra vía de creación: `crearOrdenMigrada` (`migracion.ts`) escribe el
    // `estado` explícito de Access —que puede ser `completa`— y libera la receta migrada SÓLO si
    // la orden no está cancelada y su receta no quedó vacía (`migracion.ts:220`). Como 2 de cada 3
    // modelos del viejo no tienen BOM, muchas órdenes históricas nacen `completa` SIN cumplir la
    // regla — por eso `realinear-estado-ordenes.ts` es paso obligatorio al cerrar la carga.
    // No pasa por aquí (ver la nota de `crearOrden` más arriba).
    if (datos.lineas !== undefined && datos.lineas.length > 0) {
      await sincronizarMatriz(tx, sesion, orden.id, datos.lineas);
    }

    // ⭐ V1-E3d (§Post-F9.43): LA RECETA SE CONGELA AQUÍ. Daniel eligió copiarla AL CREAR la orden
    // (sobre la alternativa "al explotar el MRP") para que se revise y ajuste ANTES de comprar nada.
    // Desde este punto la orden vive de SU receta: cambiar el BOM del modelo ya no la alcanza.
    const receta = await copiarRecetaDelModelo(tx, sesion, {
      id: orden.id,
      idEmpresa: origen.idEmpresa,
      idModelo: origen.idModelo,
    });
    // `tocarAuditoria: false`: la orden ACABA de nacer con su `datosCreacion`; si el recálculo no
    // cambia nada, no tiene por qué emitir un UPDATE extra ni re-sellar `modificadoEn`.
    await recalcularEstadoOrden(tx, sesion, orden, { tocarAuditoria: false });

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: orden.id,
      accion: 'CREAR',
      datos: {
        folio: Number(folio),
        idPedidoLinea: datos.idPedidoLinea,
        idModelo: origen.idModelo,
        idCliente: origen.idCliente,
        renglones: datos.lineas?.length ?? 0,
        receta: { ...receta },
      },
    });

    // Evento outbox `orden-creada` (R3, B5): en la MISMA tx (o quedan orden Y evento, o ninguno).
    const payload: EventoOrdenCreada = { idEmpresa: origen.idEmpresa, idOrden: orden.id };
    await registrarEventoOutbox(
      tx,
      EVENTOS_OUTBOX.ordenCreada,
      VERSION_ORDEN_CREADA,
      origen.idEmpresa,
      payload,
    );

    return orden.id;
  }, bd);

  // Publica el outbox tras el commit (best-effort; el barrido periódico recupera). Si se compone
  // bajo una `bd.tx` externa, publicar filas aún no commiteadas es un no-op inofensivo (el relay
  // no las ve hasta el commit; el barrido las recoge después).
  dispararPublicacion();

  return obtenerOrden(sesion, idOrden, bd);
}

/**
 * Actualiza el ENCABEZADO de una orden (fechas, etiqueta, tela, maquilero, composición/
 * compForzada, observaciones, obsMaquila, noCostear) en UNA transacción (A2). NO toca el estado
 * derivado, el folio, el pedido de origen, el modelo/cliente (autorrellenados) ni la matriz. No
 * se puede editar una orden cancelada.
 *
 * COMPOSICIÓN (Daniel 24-jul-2026): editarla a mano deja la orden con override
 * (`compForzada = true`) y ya no se pisa; VACIARLA la devuelve a la del modelo. Si la orden no
 * tiene override, este guardado la RE-DERIVA de `Modelo.composicion` (así una corrección en la
 * ficha del modelo baja a la orden sin recálculos masivos). Ver `resolverComposicion`.
 */
export async function actualizarOrden(
  sesion: SesionUsuario,
  entrada: EntradaActualizarOrden,
  bd?: ContextoBd,
): Promise<OrdenSalida> {
  verificarPermiso(sesion, 'ordenes.administrar');
  const datos = validarEntrada(esquemaOrdenEditar, entrada);

  await enTransaccion(async (tx) => {
    const actual = await exigirOrden(tx, datos.id, sesion.idEmpresaActiva);
    if (actual.estado === 'cancelada') {
      throw new ErrorConflicto('La orden está cancelada; no se puede modificar.');
    }

    const cambios: Prisma.OrdenUncheckedUpdateInput = { ...datosModificacion(sesion) };

    if (datos.idMaquilero !== undefined) {
      if (datos.idMaquilero !== null) await exigirProveedorExiste(tx, datos.idMaquilero);
      cambios.idMaquilero = datos.idMaquilero;
    }
    if (datos.idEtiquetaMarca !== undefined) {
      if (datos.idEtiquetaMarca !== null) await exigirEtiquetaExiste(tx, datos.idEtiquetaMarca);
      cambios.idEtiquetaMarca = datos.idEtiquetaMarca;
    }
    if (datos.idTela !== undefined) {
      if (datos.idTela !== null) await exigirTelaExiste(tx, datos.idTela);
      cambios.idTela = datos.idTela;
    }
    // Cada campo solo se toca si vino (`undefined` = no tocar); `null` vacía. Los helpers
    // devuelven `undefined` solo cuando la entrada es `undefined`, que aquí ya descartamos, así
    // que el `?? null` es seguro y satisface exactOptionalPropertyTypes.
    if (datos.fecha !== undefined) cambios.fecha = aDateColumna(datos.fecha) ?? null;
    if (datos.fechaEntrega !== undefined)
      cambios.fechaEntrega = aDateColumna(datos.fechaEntrega) ?? null;
    if (datos.observaciones !== undefined)
      cambios.observaciones = aTexto(datos.observaciones) ?? null;
    // Composición (Daniel 24-jul-2026): la fuente es el MODELO; lo capturado aquí es el override
    // de ESTA orden. Vaciar el campo la devuelve a la del modelo. Ver `resolverComposicion`.
    if (datos.composicion !== undefined || datos.compForzada !== undefined) {
      const modelo = await tx.modelo.findUniqueOrThrow({
        where: { id: actual.idModelo },
        select: { composicion: true },
      });
      const resuelta = resolverComposicion({
        capturada: datos.composicion,
        forzadaExplicita: datos.compForzada,
        actual: actual.composicion,
        forzadaActual: actual.compForzada,
        delModelo: modelo.composicion,
      });
      cambios.composicion = resuelta.composicion;
      cambios.compForzada = resuelta.compForzada;
    }
    if (datos.obsMaquila !== undefined) cambios.obsMaquila = aTexto(datos.obsMaquila) ?? null;
    if (datos.noCostear !== undefined) cambios.noCostear = datos.noCostear;

    await tx.orden.update({ where: { id: datos.id }, data: cambios });

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: datos.id,
      accion: 'MODIFICAR',
      datos: { encabezado: true },
    });
  }, bd);

  return obtenerOrden(sesion, datos.id, bd);
}

/**
 * Guarda la MATRIZ completa de una orden (colores × tallas) en UNA transacción (A2). Sincroniza
 * el set (agrega/edita/quita) conservando auditoría, valida color no repetido + tallas del
 * catálogo + cantidades ≥0. RECALCULA el estado con la regla única (`requisitos-orden.ts`): se
 * completa sola si ya cumple todo, y si le vacían la matriz vuelve a `capturada`; `fechaCompletada`
 * se sella la primera vez y no se re-sella ni se borra. No se puede tocar la matriz de una orden
 * cancelada. Bitácora A7 (entidad crítica).
 */
export async function guardarMatrizOrden(
  sesion: SesionUsuario,
  id: number,
  entrada: z.input<typeof esquemaOrdenMatrizCuerpo>,
  bd?: ContextoBd,
): Promise<OrdenSalida> {
  verificarPermiso(sesion, 'ordenes.administrar');
  const datos = validarEntrada(esquemaOrdenMatrizCuerpo, entrada);

  await enTransaccion(async (tx) => {
    const actual = await exigirOrden(tx, id, sesion.idEmpresaActiva);
    if (actual.estado === 'cancelada') {
      throw new ErrorConflicto('La orden está cancelada; no se puede modificar su matriz.');
    }

    const renglones = await sincronizarMatriz(tx, sesion, id, datos.lineas);

    // Estado derivado: lo decide la regla ÚNICA (`requisitos-orden.ts`). Si al guardar la matriz
    // ya se cumple todo, la orden pasa sola a `completa` y se sella `fechaCompletada` la PRIMERA
    // vez (paridad con `FechaDet` de v1, que nunca se borra). Este es el ÚNICO camino que puede
    // DES-completar (vaciar la matriz), y aun así solo si la orden no tiene actividad de producción
    // viva — una orden ya cortada/enviada no se degrada. El `modificadoPor` lo pone el recálculo.
    await recalcularEstadoOrden(tx, sesion, actual);

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: id,
      accion: 'MODIFICAR',
      datos: { matriz: renglones },
    });
  }, bd);

  return obtenerOrden(sesion, id, bd);
}

/**
 * Copia la matriz COMPLETA de OTRA orden a esta (doc 03-Produccion `CopiarDetallesOrd`), mapeando
 * las tallas por su ETIQUETA (las curvas/órdenes pueden tener tallas distintas: se reutiliza la
 * misma talla del catálogo por su etiqueta — como las dos órdenes usan el catálogo de tallas
 * global, basta con copiar `idTalla`). Ambas órdenes deben ser de la empresa activa. Sustituye la
 * matriz actual. Recalcula el estado como cualquier guardado de matriz.
 */
export async function copiarDetalleOrden(
  sesion: SesionUsuario,
  id: number,
  cuerpo: z.input<typeof esquemaOrdenCopiarMatrizCuerpo>,
  bd?: ContextoBd,
): Promise<OrdenSalida> {
  verificarPermiso(sesion, 'ordenes.administrar');
  const datos = validarEntrada(esquemaOrdenCopiarMatrizCuerpo, cuerpo);

  if (datos.idOrdenOrigen === id) {
    throw new ErrorValidacion('No se puede copiar la matriz de una orden sobre sí misma.');
  }

  await enTransaccion(async (tx) => {
    const destino = await exigirOrden(tx, id, sesion.idEmpresaActiva);
    if (destino.estado === 'cancelada') {
      throw new ErrorConflicto('La orden está cancelada; no se puede modificar su matriz.');
    }
    // El origen debe existir y ser de la misma empresa (A9); incluye su matriz con las tallas.
    const origen = await tx.orden.findFirst({
      where: { id: datos.idOrdenOrigen, idEmpresa: sesion.idEmpresaActiva },
      include: { lineas: { include: { tallas: true }, orderBy: { id: 'asc' } } },
    });
    if (origen === null) {
      throw new ErrorNoEncontrado('Orden', datos.idOrdenOrigen);
    }

    // Construye el set deseado a partir de la matriz del origen y lo sincroniza (reemplaza la del
    // destino). El mapeo "por etiqueta" se honra reutilizando la MISMA talla del catálogo global.
    const set: DatosOrdenLineaEntrada[] = origen.lineas.map((l) => ({
      idColor: l.idColor,
      tallas: l.tallas.map((t) => ({ idTalla: t.idTalla, cantidad: t.cantidad })),
    }));
    const renglones = await sincronizarMatriz(tx, sesion, id, set);

    // Mismo estado derivado que cualquier guardado de matriz: lo decide la regla única.
    await recalcularEstadoOrden(tx, sesion, destino);

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: id,
      accion: 'MODIFICAR',
      datos: { matrizCopiadaDe: datos.idOrdenOrigen, renglones },
    });
  }, bd);

  return obtenerOrden(sesion, id, bd);
}

/**
 * Cancela una orden (cancelación SUAVE): `estado='cancelada'` + `motivoCancelada` (OBLIGATORIO) +
 * bitácora `CANCELAR`. La orden sigue consultable; no se borra. Cancelar dos veces es conflicto.
 * Permiso propio: `ordenes.cancelar`.
 */
export async function cancelarOrden(
  sesion: SesionUsuario,
  id: number,
  cuerpo: z.input<typeof esquemaOrdenCancelarCuerpo>,
  bd?: ContextoBd,
): Promise<OrdenSalida> {
  verificarPermiso(sesion, 'ordenes.cancelar');
  const datos = validarEntrada(esquemaOrdenCancelarCuerpo, cuerpo);

  await enTransaccion(async (tx) => {
    const actual = await exigirOrden(tx, id, sesion.idEmpresaActiva);
    if (actual.estado === 'cancelada') {
      throw new ErrorConflicto(`La orden ${Number(actual.folio)} ya está cancelada.`);
    }
    await tx.orden.update({
      where: { id },
      data: { estado: 'cancelada', motivoCancelada: datos.motivo, ...datosModificacion(sesion) },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: id,
      accion: 'CANCELAR',
      datos: { folio: Number(actual.folio), motivo: datos.motivo },
    });
  }, bd);

  return obtenerOrden(sesion, id, bd);
}

/**
 * Guarda el SET COMPLETO de referencias de una orden (D7 — generaliza el `Monarch` del viejo).
 * Cada valor debe corresponder a un `ClienteCampo` ACTIVO del CLIENTE de la orden (rechaza un
 * campo de otro cliente o desactivado). Diff mínimo conservando auditoría; en UNA transacción.
 *
 * Las referencias son DATOS DE LA ORDEN (en el viejo eran columnas del propio registro), así que
 * guardarlas SÍ marca la orden como modificada (`modificadoEn`/`modificadoPorId`) en la MISMA tx,
 * igual que la matriz o el encabezado (A7). Faltaba: el "Historial" del detalle mentía tras
 * guardar referencias, y la UI —que se re-sincroniza por `modificadoEn`— no se enteraba del
 * guardado (defecto encontrado por el e2e de `ordenes.spec.ts`, 24-jul-2026).
 */
export async function guardarReferenciasOrden(
  sesion: SesionUsuario,
  id: number,
  cuerpo: z.input<typeof esquemaOrdenReferenciasCuerpo>,
  bd?: ContextoBd,
): Promise<OrdenSalida> {
  verificarPermiso(sesion, 'ordenes.administrar');
  const datos = validarEntrada(esquemaOrdenReferenciasCuerpo, cuerpo);

  await enTransaccion(async (tx) => {
    const actual = await exigirOrden(tx, id, sesion.idEmpresaActiva);
    if (actual.estado === 'cancelada') {
      throw new ErrorConflicto('La orden está cancelada; no se pueden modificar sus referencias.');
    }
    await validarReferencias(tx, actual.idCliente, datos.referencias);
    await sincronizarReferencias(tx, sesion, id, datos.referencias);

    // La orden CAMBIÓ: se sella su auditoría en la misma tx (calca lo que hace la matriz, A7).
    await tx.orden.update({ where: { id }, data: { ...datosModificacion(sesion) } });

    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: id,
      accion: 'MODIFICAR',
      datos: { referencias: datos.referencias.length },
    });
  }, bd);

  return obtenerOrden(sesion, id, bd);
}

/**
 * Valida que cada `idClienteCampo` exista, esté ACTIVO y pertenezca al CLIENTE de la orden (D7).
 * Rechaza un campo de otro cliente con `ErrorValidacion`. Además exige que un campo no se repita
 * en el set (el `@@unique([idOrden, idClienteCampo])` lo respaldaría, pero damos error claro).
 * Exportada para que `salidaAProduccion` (R3, B4) capture referencias en SU transacción.
 */
export async function validarReferencias(
  tx: Tx,
  idCliente: number,
  referencias: DatosOrdenReferenciaEntrada[],
): Promise<void> {
  const ids = referencias.map((r) => r.idClienteCampo);
  if (new Set(ids).size !== ids.length) {
    throw new ErrorValidacion('Un campo de referencia no puede aparecer dos veces en la orden.');
  }
  if (ids.length === 0) return;

  const campos = await tx.clienteCampo.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, idCliente: true, activo: true, etiqueta: true },
  });
  const porId = new Map(campos.map((c) => [c.id, c]));
  for (const idCampo of new Set(ids)) {
    const campo = porId.get(idCampo);
    if (campo === undefined) {
      throw new ErrorNoEncontrado('ClienteCampo', idCampo);
    }
    if (campo.idCliente !== idCliente) {
      throw new ErrorValidacion(
        `El campo de referencia "${campo.etiqueta}" no pertenece al cliente de esta orden.`,
      );
    }
    if (!campo.activo) {
      throw new ErrorConflicto(`El campo de referencia "${campo.etiqueta}" está desactivado.`);
    }
  }
}

/**
 * Sincroniza las referencias al set deseado (diff mínimo por `idClienteCampo`), conserva auditoría.
 * Exportada para que `salidaAProduccion` (R3, B4) capture referencias en SU transacción.
 */
export async function sincronizarReferencias(
  tx: Tx,
  sesion: SesionUsuario,
  idOrden: number,
  referencias: DatosOrdenReferenciaEntrada[],
): Promise<void> {
  const actuales = await tx.ordenReferencia.findMany({
    where: { idOrden },
    select: { id: true, idClienteCampo: true },
  });
  const idPorCampo = new Map(actuales.map((r) => [r.idClienteCampo, r.id]));
  const camposDeseados = new Set(referencias.map((r) => r.idClienteCampo));

  const aBorrar = actuales.filter((r) => !camposDeseados.has(r.idClienteCampo)).map((r) => r.id);
  if (aBorrar.length > 0) {
    await tx.ordenReferencia.deleteMany({ where: { id: { in: aBorrar } } });
  }

  for (const ref of referencias) {
    const idExistente = idPorCampo.get(ref.idClienteCampo);
    if (idExistente !== undefined) {
      await tx.ordenReferencia.update({
        where: { id: idExistente },
        data: { valor: ref.valor, ...datosModificacion(sesion) },
      });
    } else {
      await tx.ordenReferencia.create({
        data: {
          idOrden,
          idClienteCampo: ref.idClienteCampo,
          valor: ref.valor,
          ...datosCreacion(sesion),
        },
      });
    }
  }
}

/**
 * Agrega un comentario INMUTABLE a una orden (paridad con `ComentaOrd`): usuario (de la sesión) +
 * fecha (now) + texto. No se edita ni se borra. Bitácora `OTRO` (es un evento de hilo, no un
 * cambio de datos de la orden). Requiere `ordenes.administrar`.
 */
export async function agregarComentarioOrden(
  sesion: SesionUsuario,
  id: number,
  cuerpo: z.input<typeof esquemaOrdenComentarioCuerpo>,
  bd?: ContextoBd,
): Promise<OrdenSalida> {
  verificarPermiso(sesion, 'ordenes.administrar');
  const datos = validarEntrada(esquemaOrdenComentarioCuerpo, cuerpo);

  await enTransaccion(async (tx) => {
    await exigirOrden(tx, id, sesion.idEmpresaActiva);
    await tx.ordenComentario.create({
      data: { idOrden: id, idUsuario: sesion.id, comentario: datos.comentario },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'Orden',
      idEntidad: id,
      accion: 'OTRO',
      datos: { comentario: true },
    });
  }, bd);

  return obtenerOrden(sesion, id, bd);
}

/** Obtiene una orden (con todo su detalle) de la empresa activa, o lanza `ErrorNoEncontrado`. */
export async function obtenerOrden(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<OrdenSalida> {
  verificarPermiso(sesion, 'ordenes.ver');
  const orden = await clienteLectura(bd).orden.findFirst({
    where: { id, idEmpresa: sesion.idEmpresaActiva },
    include: incluirDetalle,
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', id);
  }
  const nombrePorId = await nombresDeUsuarios(
    clienteLectura(bd),
    orden.comentarios.map((c) => c.idUsuario),
  );
  return aOrdenSalida(orden, !tienePermiso(sesion, 'ordenes.ver-precio-real-maquila'), nombrePorId);
}

/**
 * Lista órdenes de la empresa activa (A9) con búsqueda combinada y paginación EN SERVIDOR:
 *  • `busqueda`: folio interno (si es número), código de modelo, nombre de cliente, o CUALQUIER
 *    valor de `OrdenReferencia` (usando su índice dedicado, D7).
 *  • filtros por modelo, cliente, año (de `fecha`) y estado.
 * Por defecto NO incluye las canceladas. Cada orden trae su detalle embebido (matriz, referencias,
 * comentarios) con el total derivado.
 */
export async function listarOrdenes(
  sesion: SesionUsuario,
  parametros: ParametrosListarOrdenes = {},
  bd?: ContextoBd,
): Promise<Pagina<OrdenSalida>> {
  verificarPermiso(sesion, 'ordenes.ver');
  const filtros = validarEntrada(esquemaListarOrdenesDominio, parametros);

  const where: Prisma.OrdenWhereInput = {
    idEmpresa: sesion.idEmpresaActiva,
    ...(filtros.estado === undefined ? {} : { estado: filtros.estado }),
    ...(filtros.estado === undefined && !filtros.incluirCanceladas
      ? { estado: { not: 'cancelada' } }
      : {}),
    ...(filtros.idModelo === undefined ? {} : { idModelo: filtros.idModelo }),
    ...(filtros.idCliente === undefined ? {} : { idCliente: filtros.idCliente }),
    ...(filtros.anio === undefined ? {} : { fecha: rangoAnio(filtros.anio) }),
    ...(await armarBusquedaConSinonimos(filtros.busqueda, bd)),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.orden.count({ where }),
    cliente.orden.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      include: incluirDetalle,
      ...rangoPrisma(filtros),
    }),
  ]);

  const ocultarPrecios = !tienePermiso(sesion, 'ordenes.ver-precio-real-maquila');
  // Los autores de los comentarios de TODA la página, en UNA consulta (nunca una por orden).
  const nombrePorId = await nombresDeUsuarios(
    cliente,
    datos.flatMap((o) => (o as OrdenConDetalle).comentarios.map((c) => c.idUsuario)),
  );
  const salida = datos.map((o) => aOrdenSalida(o as OrdenConDetalle, ocultarPrecios, nombrePorId));
  return armarPagina(salida, total, filtros);
}

/** `buscarOrdenes` es un alias semántico de `listarOrdenes` (la búsqueda va en `parametros.busqueda`). */
export const buscarOrdenes = listarOrdenes;

/**
 * Arma el `OR` de búsqueda combinada: folio (si la búsqueda es entero), código de modelo, nombre
 * de cliente y valor de referencia (D7, vía el índice de `OrdenReferencia.valor`). Vacío → sin OR.
 *
 * Exportado para reusarse en las CONSULTAS ligeras (F2-E4, `consultas.ts`): la consulta y el
 * buscador global comparten EXACTAMENTE esta lógica de búsqueda combinada (folio + modelo + cliente
 * + valor de referencia), con su proyección ligera propia.
 *
 * ⭐⭐ `sinonimosDepartamento` (§Post-F9.172(a)) — nombres de departamento que la búsqueda debe
 * entender ADEMÁS del texto tecleado, porque el catálogo dice que se fusionaron con él. Buscar
 * «Caballeros» tiene que traer las órdenes cuya referencia dice «2-HOMBRE»: el texto que el cliente
 * escribió en su OC **no se reescribe nunca**, así que el sinónimo se resuelve al consultar. Se
 * comparan por IGUALDAD (insensible a mayúsculas), no por `contains`: no son un fragmento que el
 * usuario tecleó sino nombres EXACTOS del catálogo —los mismos que el importador copió al valor de
 * la referencia—, y un `contains` con un nombre de una o dos letras arrastraría media base.
 *
 * 🔑 Esta función sigue siendo **pura**: quien la llama resuelve el conjunto de sinónimos UNA vez
 * (`armarBusquedaConSinonimos`) y se lo pasa. Nunca se recorre la cadena de fusiones por fila.
 */
export function armarBusqueda(
  busqueda: string | undefined,
  sinonimosDepartamento: readonly string[] = [],
): Prisma.OrdenWhereInput {
  if (busqueda === undefined || busqueda === '') {
    return {};
  }
  const or: Prisma.OrdenWhereInput[] = [
    { modelo: { codigo: { contains: busqueda, mode: 'insensitive' } } },
    { cliente: { nombre: { contains: busqueda, mode: 'insensitive' } } },
    { referencias: { some: { valor: { contains: busqueda, mode: 'insensitive' } } } },
  ];
  const porSinonimo = condicionSinonimosDepartamento(sinonimosDepartamento);
  if (porSinonimo !== null) {
    or.push(porSinonimo);
  }
  const folio = aFolioBusqueda(busqueda);
  if (folio !== null) {
    or.push({ folio });
  }
  return { OR: or };
}

/**
 * Condición "alguna referencia de la orden ES uno de estos nombres de departamento" (§Post-F9.172(a)).
 * `null` cuando no hay sinónimos, para no meter un `OR` vacío —que en Prisma no casa NADA— en el
 * `where`. Exportada para el Centro de Órdenes, que arma su propio `OR` (busca sin nombre de
 * cliente) pero entiende los mismos sinónimos.
 */
export function condicionSinonimosDepartamento(
  sinonimos: readonly string[],
): Prisma.OrdenWhereInput | null {
  if (sinonimos.length === 0) {
    return null;
  }
  return {
    referencias: {
      some: { OR: sinonimos.map((nombre) => ({ valor: { equals: nombre, mode: 'insensitive' } })) },
    },
  };
}

/**
 * ⭐⭐ La búsqueda de órdenes CON los sinónimos ya resueltos (§Post-F9.172(a)): el embudo que usan el
 * listado, las consultas ligeras, el buscador global, el tablero WIP y la lista de costos.
 *
 * Es {@link armarBusqueda} + **una** resolución de sinónimos por consulta
 * ({@link sinonimosDeDepartamentos}, 1 viaje si el texto no casa con ningún departamento). Se hizo
 * async por esto: el rastro de la fusión vive en el catálogo y hay que leerlo, pero **una sola vez**
 * — jamás por fila.
 */
export async function armarBusquedaConSinonimos(
  busqueda: string | undefined,
  bd?: ContextoBd,
): Promise<Prisma.OrdenWhereInput> {
  if (busqueda === undefined || busqueda === '') {
    return {};
  }
  return armarBusqueda(busqueda, await sinonimosDeDepartamentos(busqueda, bd));
}

/** Si la búsqueda es un entero, devuelve el `bigint` para filtrar por folio; si no, `null`. */
function aFolioBusqueda(busqueda: string): bigint | null {
  if (!/^\d+$/.test(busqueda.trim())) {
    return null;
  }
  try {
    return BigInt(busqueda.trim());
  } catch {
    return null;
  }
}

/**
 * Rango `@db.Date` para filtrar por año natural (de enero 1 a enero 1 del siguiente, exclusivo).
 * Exportado para reusarse en las CONSULTAS/tablero (F2-E4): el filtro por año es idéntico.
 */
export function rangoAnio(anio: number): Prisma.DateTimeNullableFilter {
  return {
    gte: new Date(`${anio}-01-01T00:00:00.000Z`),
    lt: new Date(`${anio + 1}-01-01T00:00:00.000Z`),
  };
}
