/**
 * Órdenes de COMPRA — Módulo COMPRAS (F4-E2): el documento con el que se COMPRA material
 * (telas/avíos) a un proveedor (doc `Documentacion_MJD/03-Produccion.md` §OC; ex `OrdCompra`/
 * `OrdCompraDet`). CRUD de la `OrdenCompra` + sus líneas (`OrdenCompraLinea`) con su matriz
 * opcional talla×color (`OrdenCompraLineaTalla`, decisión (c)) + sus órdenes de producción
 * ligadas (`OrdenCompraOrden`, derivadas de las líneas). Autorización, cancelación suave y
 * duplicado a un borrador nuevo.
 *
 * Innegociables aplicados:
 *  • A1 — toda la lógica vive aquí; las rutas solo validan permiso + Zod y delegan.
 *  • A2 — encabezado + líneas + matriz + ligas N:N en UNA transacción (`enTransaccion`): crear/
 *    editar/autorizar/cancelar/duplicar son atómicos.
 *  • A3/A9 — el folio `numCompra` sale de la secuencia atómica `"orden-compra"` POR EMPRESA
 *    (`siguienteFolio`); NUNCA `Max()+1`. El folio es por empresa de la sesión activa.
 *  • A4 — permisos verificados aquí (defensa en profundidad): `compras.ver`/`.administrar`/
 *    `.cancelar`/`.autorizar`. La edición de una OC autorizada exige admin (`roles.administrar`).
 *  • A7 — auditoría uniforme: `creadoPorId`/`modificadoPorId` + `Bitacora` en la misma tx (la OC
 *    es entidad crítica: alta, edición, autorización, cancelación y duplicado quedan registrados).
 *  • A9 — todo se filtra/sella por `idEmpresa` de la sesión activa (una OC de otra empresa, para
 *    esta sesión, no existe).
 *  • D1 — el `precio` de cada línea es el precio ACTUAL (unitario) que se guarda en la línea.
 *  • D3 — el TOTAL no se persiste: se DERIVA por suma (Σ cantidad×precio) al proyectar. En E2 NO
 *    se mueve kardex (la recepción que afecta inventario de telas/avíos llega en E3).
 *
 * DECISIONES DE NEGOCIO (DECISIONES.md §"Decisiones de diseño F4"):
 *  • (a) Una OC AUTORIZADA (o más allá) queda BLOQUEADA para el usuario normal; el ADMIN
 *    (`roles.administrar`, marcador de admin del proyecto, igual que `generaEntradaPt` en
 *    F3-E1) sí la edita, registrando cada cambio en Bitácora. `duplicarOC` (para todos) copia la
 *    OC a una nueva en `borrador` para ajustar sin recapturar; la copia sigue su propio ciclo.
 *  • (c) Sin Excel: el renglón que lo requiera lleva matriz talla×color NATIVA; la suma de la
 *    matriz = la `cantidad` del renglón (se valida). Renglones que no la usen = cantidad simple.
 */
import {
  esquemaCompraCrear,
  esquemaCompraEditarCuerpo,
  esquemaCompraCancelarCuerpo,
} from '../../contrato/esquemas/compra.js';
import { ETIQUETA_UNIDAD_TELA } from '../../contrato/esquemas/tela.js';
import type {
  DatosCompraLineaEntrada,
  CompraSalida,
  CompraLineaSalida,
  ResumenCompras,
} from '../../contrato/esquemas/compra.js';
import type {
  OrdenCompra,
  OrdenCompraLinea,
  OrdenCompraLineaTalla,
  Prisma,
} from '../../datos/index.js';
import { EstatusOrdenCompra } from '../../datos/index.js';
import { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { dispararPublicacion } from '../../comun/cola-eventos.js';
import {
  EVENTOS_OUTBOX,
  VERSION_EVENTO_RC_ORDEN,
  registrarEventoOutbox,
  type EventoRcOrden,
} from '../../comun/eventos-dominio.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import {
  armarPagina,
  esquemaPaginacion,
  rangoPrisma,
  type Pagina,
} from '../../comun/paginacion.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { siguienteFolio } from '../../comun/secuencias.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Clave de la secuencia de folios de órdenes de compra (A3 — por empresa). */
export const CLAVE_SECUENCIA_ORDEN_COMPRA = 'orden-compra';

/** Alta de OC: campos del esquema compartido. */
export type EntradaCrearOC = z.input<typeof esquemaCompraCrear>;
/** Edición del cuerpo de la OC (sin id: va en la URL). */
export type EntradaActualizarOC = z.input<typeof esquemaCompraEditarCuerpo>;

/**
 * Parámetros del listado con tipos NATIVOS (la ruta ya coaccionó la querystring; el dominio
 * re-valida con tipos nativos — mismo patrón que `ordenes.ts`). No se reusa el esquema del
 * contrato (que coacciona desde texto) para pasar el `request.query` ya parseado sin chocar.
 */
const esquemaListarComprasDominio = esquemaPaginacion.extend({
  busqueda: z.string().trim().max(200).optional(),
  idProveedor: z.number().int().positive().optional(),
  estatus: z
    .enum([
      'borrador',
      'pendiente_autorizacion',
      'autorizada',
      'recibida_parcial',
      'recibida_total',
      'cancelada',
    ])
    .optional(),
  fechaDesde: z.iso.date().optional(),
  fechaHasta: z.iso.date().optional(),
  idOrden: z.number().int().positive().optional(),
  incluirCanceladas: z.boolean().default(false),
  ordenarPor: z.enum(['numCompra', 'fecha', 'fechaEntrega', 'creadoEn']).default('numCompra'),
  direccion: z.enum(['asc', 'desc']).default('desc'),
});

/** Parámetros del listado (los reutiliza la ruta REST). */
export type ParametrosListarOC = z.input<typeof esquemaListarComprasDominio>;

/** Estatus desde los que un usuario normal puede editar (antes de la autorización). */
const ESTATUS_EDITABLES_NORMAL: readonly string[] = ['borrador', 'pendiente_autorizacion'];

/**
 * OC con todo lo que arma el dominio antes de proyectar: proveedor (nombre), líneas (tela/avío con
 * nombre, orden ligada con folio, matriz con etiquetas) y órdenes ligadas (folio).
 */
type OCConDetalle = OrdenCompra & {
  proveedor: { nombre: string };
  direccionEntrega: { nombre: string; direccion: string } | null;
  lineas: (OrdenCompraLinea & {
    tela: { nombre: string; nombreComplemento: string | null } | null;
    avio: { clave: string; descripcion: string } | null;
    orden: { folio: bigint } | null;
    tallas: (OrdenCompraLineaTalla & {
      color: { nombre: string };
      talla: { etiqueta: string };
    })[];
  })[];
  ordenesLigadas: { idOrden: number; orden: { folio: bigint } }[];
};

/** `include` estándar para traer la OC con todo su detalle (ordenado de forma estable). */
const incluirDetalle = {
  proveedor: { select: { nombre: true } },
  direccionEntrega: { select: { nombre: true, direccion: true } },
  lineas: {
    orderBy: { id: 'asc' },
    include: {
      tela: { select: { nombre: true, nombreComplemento: true } },
      avio: { select: { clave: true, descripcion: true } },
      orden: { select: { folio: true } },
      tallas: {
        orderBy: [{ talla: { orden: 'asc' } }, { id: 'asc' }],
        include: {
          color: { select: { nombre: true } },
          talla: { select: { etiqueta: true } },
        },
      },
    },
  },
  ordenesLigadas: {
    orderBy: { id: 'asc' },
    include: { orden: { select: { folio: true } } },
  },
} satisfies Prisma.OrdenCompraInclude;

// ── Helpers de existencia/validación ──────────────────────────────────────────────

/**
 * Busca una OC de la EMPRESA ACTIVA por id, o lanza `ErrorNoEncontrado` (una OC de otra empresa,
 * para esta sesión, no existe — A9). La usan obtener/editar/autorizar/cancelar/duplicar.
 */
async function exigirOC(tx: Tx, id: number, idEmpresa: number): Promise<OrdenCompra> {
  const oc = await tx.ordenCompra.findFirst({ where: { id, idEmpresa } });
  if (oc === null) {
    throw new ErrorNoEncontrado('OrdenCompra', id);
  }
  return oc;
}

/**
 * Exige que la dirección de entrega exista y esté ACTIVA (§Post-F9.18). Se valida aquí (A1) y no
 * solo con la FK: una dirección desactivada existe en la base pero ya no se debe poder elegir.
 */
async function exigirDireccionEntregaValida(
  tx: Tx,
  idDireccionEntrega: number,
): Promise<{ id: number; direccion: string }> {
  const direccion = await tx.direccionEntrega.findUnique({
    where: { id: idDireccionEntrega },
    select: { id: true, nombre: true, direccion: true, activo: true },
  });
  if (direccion === null) {
    throw new ErrorNoEncontrado('Dirección de entrega', idDireccionEntrega);
  }
  if (!direccion.activo) {
    throw new ErrorValidacion(
      `La dirección de entrega "${direccion.nombre}" está desactivada: elige otra del catálogo.`,
    );
  }
  return { id: direccion.id, direccion: direccion.direccion };
}

/**
 * Exige que ningún renglón de una tela CON complemento se quede sin su cantidad de complemento
 * (§Post-F9.18). Se llama al AUTORIZAR: es el punto donde la compra se vuelve real, y es lo que
 * permite que la explosión MRP genere borradores sin inventar la cantidad del Cardigan.
 */
async function exigirComplementosCapturados(tx: Tx, idOrdenCompra: number): Promise<void> {
  const pendientes = await tx.ordenCompraLinea.findMany({
    where: {
      idOrdenCompra,
      cantidadComplemento: null,
      tela: { nombreComplemento: { not: null } },
    },
    select: { tela: { select: { nombre: true, nombreComplemento: true } } },
    orderBy: { id: 'asc' },
  });
  const primero = pendientes[0];
  if (primero !== undefined) {
    const complemento = primero.tela?.nombreComplemento ?? 'complemento';
    throw new ErrorConflicto(
      `Falta la cantidad de ${complemento} de la tela "${primero.tela?.nombre ?? ''}"` +
        (pendientes.length > 1 ? ` (y ${String(pendientes.length - 1)} renglón(es) más)` : '') +
        `: esa tela se compra junto con su ${complemento}. Captúrala antes de autorizar.`,
    );
  }
}

/**
 * El día de HOY como `DateTime @db.Date` (medianoche UTC), para la fecha de EMISIÓN que pone el
 * servidor (§Post-F9.18). Se normaliza a día para que la columna `@db.Date` no arrastre la hora.
 */
function hoyColumna(): Date {
  const ahora = new Date();
  return new Date(
    `${String(ahora.getUTCFullYear())}-${String(ahora.getUTCMonth() + 1).padStart(2, '0')}-${String(
      ahora.getUTCDate(),
    ).padStart(2, '0')}T00:00:00.000Z`,
  );
}

/** Exige que el proveedor exista (las FK las protege la BD, pero damos un error claro). */
async function exigirProveedorExiste(tx: Tx, idProveedor: number): Promise<void> {
  const prov = await tx.proveedor.findUnique({
    where: { id: idProveedor },
    select: { id: true },
  });
  if (prov === null) {
    throw new ErrorNoEncontrado('Proveedor', idProveedor);
  }
}

/**
 * ¿La sesión es ADMIN? Se usa `roles.administrar` como marcador de "administrador total" del
 * proyecto (mismo criterio que la bandera `generaEntradaPt` de tipos-proceso en F3-E1). Solo el
 * admin puede editar una OC ya autorizada (decisión (a)).
 */
function esAdmin(sesion: SesionUsuario): boolean {
  return tienePermiso(sesion, 'roles.administrar');
}

/**
 * Valida el SET de líneas de la OC (regla de negocio de la decisión (c) + XOR catálogo/libre).
 * Para cada renglón:
 *  • XOR: es de tela (idTela, sin avío/libre), de avío (idAvio, sin tela/libre) o libre
 *    (descripcionLibre, sin tela/avío) — EXACTAMENTE una de las tres.
 *  • Si es de catálogo, la tela/avío existe.
 *  • Si trae matriz, el par (color, talla) no se repite, color/talla existen, y la SUMA de la
 *    matriz = la `cantidad` del renglón.
 *  • Si liga una orden de producción (`idOrden`), esa orden existe y es de la empresa activa (A9).
 *  • **La TELA es DEL proveedor de la OC** (§Post-F9.15, Daniel: *"cada proveedor de telas tiene
 *    sus telas definidas. No puedo meter una felpa alsatex en el proveedor bloom"*). La identidad
 *    de la tela incluye a su dueño desde A1, así que comprarle a X una tela de Y es un error de
 *    negocio, no una preferencia de la pantalla — se valida AQUÍ (A1: el servidor es la autoridad;
 *    el filtro del selector es solo ayuda de captura).
 *    EXCEPCIÓN deliberada: una tela SIN dueño (`idProveedor` NULL — las migradas) NO se rechaza.
 *    Bloquearlas dejaría OCs viejas imposibles de editar, y el catálogo se captura desde cero
 *    (acuerdo con Daniel): las nuevas siempre traen dueño, así que la puerta se cierra sola.
 * Devuelve el conjunto (sin repetidos) de idOrden ligados, para derivar `OrdenCompraOrden`.
 */
async function validarLineas(
  tx: Tx,
  idEmpresa: number,
  lineas: DatosCompraLineaEntrada[],
  /** Proveedor de la OC: contra él se valida el dueño de cada tela (§Post-F9.15). */
  idProveedorOC: number,
  /**
   * `true` = la OC la generó el sistema (explosión MRP), no una persona. Único efecto: se permite
   * dejar el COMPLEMENTO de la tela PENDIENTE, porque el BOM no sabe cuánto Cardigan lleva y
   * inventarlo sería peor. `autorizarOC` cierra el hueco: no autoriza con complementos pendientes.
   */
  automatica = false,
): Promise<{ idsOrden: Set<number>; lineas: DatosCompraLineaEntrada[] }> {
  const idsOrdenLigada = new Set<number>();
  const idsTela = new Set<number>();
  const idsAvio = new Set<number>();
  const idsColor = new Set<number>();
  const idsTalla = new Set<number>();

  for (const [indice, linea] of lineas.entries()) {
    const num = indice + 1;
    const tieneTela = linea.idTela != null;
    const tieneAvio = linea.idAvio != null;
    const tieneLibre = linea.descripcionLibre != null && linea.descripcionLibre !== '';
    const cuantas = [tieneTela, tieneAvio, tieneLibre].filter(Boolean).length;
    if (cuantas !== 1) {
      throw new ErrorValidacion(
        `El renglón ${num} debe ser de tela, de avío o libre (exactamente uno).`,
      );
    }
    // `idAvioProveedor` (traza del precio R1) solo tiene sentido en una línea de avío; en una de
    // tela o libre debe ir null (no hay FK física que lo impida → se valida aquí, A1).
    if (linea.idAvioProveedor != null && !tieneAvio) {
      throw new ErrorValidacion(
        `El renglón ${num} no es de avío; no puede llevar proveedor de avío (idAvioProveedor).`,
      );
    }
    // El COMPLEMENTO (Cardigan) es parte de una TELA: en avíos y líneas libres no existe
    // (§Post-F9.18). Que la tela SÍ lo exija se valida abajo, cuando ya se leyó el catálogo.
    if (!tieneTela && (linea.cantidadComplemento != null || linea.precioComplemento != null)) {
      throw new ErrorValidacion(
        `El renglón ${num} no es de tela; no puede llevar complemento (el complemento es parte de una tela).`,
      );
    }
    if (tieneTela) idsTela.add(linea.idTela as number);
    if (tieneAvio) idsAvio.add(linea.idAvio as number);
    if (linea.idOrden != null) idsOrdenLigada.add(linea.idOrden);

    // Matriz: suma = cantidad y no-repetidos.
    if (linea.tallas !== undefined && linea.tallas.length > 0) {
      const claves = new Set<string>();
      let suma = 0;
      for (const t of linea.tallas) {
        const clave = `${t.idColor}-${t.idTalla}`;
        if (claves.has(clave)) {
          throw new ErrorValidacion(
            `El renglón ${num} repite la combinación color/talla en su matriz.`,
          );
        }
        claves.add(clave);
        idsColor.add(t.idColor);
        idsTalla.add(t.idTalla);
        suma += t.cantidad;
      }
      // `cantidad` puede ser decimal; la matriz es entera. La suma debe coincidir exactamente.
      if (suma !== linea.cantidad) {
        throw new ErrorValidacion(
          `El renglón ${num}: la suma de la matriz (${suma}) debe ser igual a la cantidad (${linea.cantidad}).`,
        );
      }
    }
  }

  // Existencia de catálogos referenciados (en lote). Las TELAS se leen con su DUEÑO para validar
  // de una vez que sean de este proveedor (§Post-F9.15) sin una segunda consulta.
  const telasPorId = new Map<
    number,
    { nombre: string; unidadMedida: 'KG' | 'M'; nombreComplemento: string | null }
  >();
  if (idsTela.size > 0) {
    const telas = await tx.tela.findMany({
      where: { id: { in: [...idsTela] } },
      select: {
        id: true,
        nombre: true,
        idProveedor: true,
        unidadMedida: true,
        nombreComplemento: true,
        proveedor: { select: { nombre: true } },
      },
    });
    const porId = new Map(telas.map((tela) => [tela.id, tela]));
    for (const idTela of idsTela) {
      const tela = porId.get(idTela);
      if (tela === undefined) {
        throw new ErrorNoEncontrado('Tela', idTela);
      }
      // NULL = tela migrada sin dueño: se deja pasar a propósito (ver TSDoc de la función).
      if (tela.idProveedor !== null && tela.idProveedor !== idProveedorOC) {
        throw new ErrorValidacion(
          `La tela "${tela.nombre}" es de ${tela.proveedor?.nombre ?? 'otro proveedor'}: no se le ` +
            `puede comprar a este proveedor. Elige una tela suya, o dale de alta la tela con él ` +
            `como dueño en el catálogo.`,
        );
      }
      telasPorId.set(idTela, {
        nombre: tela.nombre,
        unidadMedida: tela.unidadMedida,
        nombreComplemento: tela.nombreComplemento,
      });
    }
  }

  // ── Reglas de la TELA que dependen del catálogo (§Post-F9.18) ────────────────────────────────
  // (1) La UNIDAD la manda la tela: se IGNORA lo que venga en el renglón. Daniel: *"la unidad de
  //     las telas va ligado a la tela; no puede ser una tela que se compra en kilos y en la OC la
  //     unidad sea piezas"*. Se normaliza aquí (A1) para que ni la UI ni el API puedan colarla.
  // (2) El COMPLEMENTO es obligatorio cuando la tela lo define: *"la tela se debe de comprar con su
  //     complemento en caso de tenerlo (Cardigan)"*. Y está prohibido cuando la tela no lo tiene.
  const lineasNormalizadas = lineas.map((linea, indice) => {
    if (linea.idTela == null) {
      return linea;
    }
    const num = indice + 1;
    const tela = telasPorId.get(linea.idTela);
    if (tela === undefined) {
      throw new ErrorNoEncontrado('Tela', linea.idTela);
    }
    if (tela.nombreComplemento === null) {
      if (linea.cantidadComplemento != null) {
        throw new ErrorValidacion(
          `La tela "${tela.nombre}" del renglón ${num} no lleva complemento: no se le puede capturar cantidad de complemento.`,
        );
      }
    } else if (linea.cantidadComplemento == null && !automatica) {
      throw new ErrorValidacion(
        `La tela "${tela.nombre}" del renglón ${num} se compra junto con su ${tela.nombreComplemento}: ` +
          `captura también la cantidad del ${tela.nombreComplemento}.`,
      );
    }
    return {
      ...linea,
      unidad: ETIQUETA_UNIDAD_TELA[tela.unidadMedida],
      ...(tela.nombreComplemento === null ? { precioComplemento: null } : {}),
    };
  });
  await exigirTodosExisten(tx, 'Avio', idsAvio, (ids) =>
    tx.avio.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  );
  await exigirTodosExisten(tx, 'Color', idsColor, (ids) =>
    tx.color.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  );
  await exigirTodosExisten(tx, 'Talla', idsTalla, (ids) =>
    tx.talla.findMany({ where: { id: { in: ids } }, select: { id: true } }),
  );

  // Las órdenes de producción ligadas deben existir y ser de la empresa activa (A9).
  if (idsOrdenLigada.size > 0) {
    const ordenes = await tx.orden.findMany({
      where: { id: { in: [...idsOrdenLigada] }, idEmpresa },
      select: { id: true },
    });
    const existentes = new Set(ordenes.map((o) => o.id));
    for (const idOrden of idsOrdenLigada) {
      if (!existentes.has(idOrden)) {
        throw new ErrorNoEncontrado('Orden', idOrden);
      }
    }
  }

  return { idsOrden: idsOrdenLigada, lineas: lineasNormalizadas };
}

/** Exige que todos los ids de un catálogo existan; lanza `ErrorNoEncontrado` con el primero que falte. */
async function exigirTodosExisten(
  _tx: Tx,
  entidad: string,
  ids: Set<number>,
  buscar: (ids: number[]) => Promise<{ id: number }[]>,
): Promise<void> {
  if (ids.size === 0) return;
  const filas = await buscar([...ids]);
  const existentes = new Set(filas.map((f) => f.id));
  for (const id of ids) {
    if (!existentes.has(id)) {
      throw new ErrorNoEncontrado(entidad, id);
    }
  }
}

// ── Creación/sincronización de líneas + matriz + ligas N:N ──────────────────────────

/**
 * Crea las líneas (con su matriz) de una OC desde cero (alta o duplicado). Asume que la OC no
 * tiene líneas aún. Devuelve nada; la proyección se hace después con un read fresco.
 */
async function crearLineas(
  tx: Tx,
  sesion: SesionUsuario,
  idOrdenCompra: number,
  lineas: DatosCompraLineaEntrada[],
): Promise<void> {
  for (const linea of lineas) {
    const creada = await tx.ordenCompraLinea.create({
      data: {
        idOrdenCompra,
        idTela: linea.idTela ?? null,
        idAvio: linea.idAvio ?? null,
        idAvioProveedor: linea.idAvioProveedor ?? null,
        cantidad: linea.cantidad,
        unidad: aTexto(linea.unidad) ?? null,
        precio: linea.precio,
        // Complemento de la tela (§Post-F9.18): viaja en el MISMO renglón que el cuerpo.
        cantidadComplemento: linea.cantidadComplemento ?? null,
        precioComplemento: linea.precioComplemento ?? null,
        idOrden: linea.idOrden ?? null,
        descripcionLibre: aTexto(linea.descripcionLibre) ?? null,
        ...datosCreacion(sesion),
      },
    });
    if (linea.tallas !== undefined && linea.tallas.length > 0) {
      await tx.ordenCompraLineaTalla.createMany({
        data: linea.tallas.map((t) => ({
          idOrdenCompraLinea: creada.id,
          idColor: t.idColor,
          idTalla: t.idTalla,
          cantidad: t.cantidad,
          creadoPorId: sesion.id,
          modificadoPorId: sesion.id,
        })),
      });
    }
  }
}

/**
 * Sincroniza las ligas N:N `OrdenCompraOrden` al conjunto de órdenes ligadas por las líneas
 * (derivadas, decisión de la ficha: persistir el N:N de encabezado). Diff mínimo conservando
 * auditoría: borra las que ya no están, crea las nuevas.
 */
async function sincronizarOrdenesLigadas(
  tx: Tx,
  sesion: SesionUsuario,
  idOrdenCompra: number,
  idsOrden: Set<number>,
): Promise<void> {
  const actuales = await tx.ordenCompraOrden.findMany({
    where: { idOrdenCompra },
    select: { id: true, idOrden: true },
  });
  const idPorOrden = new Map(actuales.map((o) => [o.idOrden, o.id]));

  const aBorrar = actuales.filter((o) => !idsOrden.has(o.idOrden)).map((o) => o.id);
  if (aBorrar.length > 0) {
    await tx.ordenCompraOrden.deleteMany({ where: { id: { in: aBorrar } } });
  }
  const aCrear = [...idsOrden].filter((idOrden) => !idPorOrden.has(idOrden));
  if (aCrear.length > 0) {
    await tx.ordenCompraOrden.createMany({
      data: aCrear.map((idOrden) => ({
        idOrdenCompra,
        idOrden,
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      })),
    });
  }
}

// ── Proyección a la salida (total derivado por suma) ────────────────────────────────

/** Proyecta una OC (con detalle) a la forma JSON del contrato. El total se DERIVA por suma. */
function aCompraSalida(oc: OCConDetalle): CompraSalida {
  let total = 0;
  const lineas: CompraLineaSalida[] = oc.lineas.map((l) => {
    const cantidad = l.cantidad.toNumber();
    const precio = l.precio.toNumber();
    // El COMPLEMENTO (Cardigan) va en el MISMO renglón (§Post-F9.18) y su importe SUMA al total:
    // es material que se compra y se paga. Sin precio propio se cobra al precio del cuerpo.
    const cantidadComplemento = l.cantidadComplemento?.toNumber() ?? null;
    const precioComplemento = l.precioComplemento?.toNumber() ?? null;
    const subtotal = redondear2(
      cantidad * precio + (cantidadComplemento ?? 0) * (precioComplemento ?? precio),
    );
    total += subtotal;
    return {
      id: l.id,
      idTela: l.idTela,
      tela: l.tela?.nombre ?? null,
      nombreComplementoTela: l.tela?.nombreComplemento ?? null,
      cantidadComplemento,
      precioComplemento,
      idAvio: l.idAvio,
      avio: l.avio === null ? null : `${l.avio.clave} — ${l.avio.descripcion}`,
      idAvioProveedor: l.idAvioProveedor,
      descripcionLibre: l.descripcionLibre,
      cantidad,
      unidad: l.unidad,
      precio,
      subtotal,
      idOrden: l.idOrden,
      folioOrden: l.orden === null ? null : Number(l.orden.folio),
      tallas: l.tallas.map((t) => ({
        idColor: t.idColor,
        color: t.color.nombre,
        idTalla: t.idTalla,
        etiquetaTalla: t.talla.etiqueta,
        cantidad: t.cantidad,
      })),
    };
  });

  return {
    id: oc.id,
    numCompra: Number(oc.numCompra),
    idEmpresa: oc.idEmpresa,
    estatus: oc.estatus,
    idProveedor: oc.idProveedor,
    proveedor: oc.proveedor.nombre,
    fecha: aFechaIso(oc.fecha),
    fechaEntrega: aFechaIso(oc.fechaEntrega),
    idDireccionEntrega: oc.idDireccionEntrega,
    direccionEntregaNombre: oc.direccionEntrega?.nombre ?? null,
    entregaEn: oc.entregaEn,
    observaciones: oc.observaciones,
    correspondeA: oc.correspondeA,
    facturasAmparadasLegacy: oc.facturasAmparadasLegacy,
    idUsuAutorizado: oc.idUsuAutorizado,
    fechaAutorizado: oc.fechaAutorizado === null ? null : oc.fechaAutorizado.toISOString(),
    canceladaEn: oc.canceladaEn === null ? null : oc.canceladaEn.toISOString(),
    canceladaPorId: oc.canceladaPorId,
    motivoCancelacion: oc.motivoCancelacion,
    lineas,
    ordenesLigadas: oc.ordenesLigadas.map((o) => ({
      idOrden: o.idOrden,
      folio: Number(o.orden.folio),
    })),
    total: redondear2(total),
    creadoEn: oc.creadoEn.toISOString(),
    creadoPorId: oc.creadoPorId,
    modificadoEn: oc.modificadoEn.toISOString(),
    modificadoPorId: oc.modificadoPorId,
  };
}

/** Redondea a 2 decimales (importes en pesos). */
function redondear2(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
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
 * Emite `oc-tela-resuelta` (post-F9, cierre del hueco de emisores) para CADA orden de producción
 * ligada a una línea de TELA de esta OC — dentro de la MISMA tx del hecho (A2). El auto-avance de la
 * RC re-evalúa el proceso `compraTela` de esas órdenes: relee el estado físico (¿hay una OC de tela
 * VIVA autorizada/recibida ligada a la orden?) y auto-completa o des-completa (idempotente). Se llama
 * al AUTORIZAR y al CANCELAR una OC; el consumidor decide el efecto según el estado actual.
 */
async function emitirOcTelaResuelta(tx: Tx, idEmpresa: number, idOC: number): Promise<void> {
  const lineas = await tx.ordenCompraLinea.findMany({
    where: { idOrdenCompra: idOC, idTela: { not: null }, idOrden: { not: null } },
    select: { idOrden: true },
  });
  const idsOrden = [
    ...new Set(lineas.map((l) => l.idOrden).filter((x): x is number => x !== null)),
  ];
  for (const idOrden of idsOrden) {
    const payload: EventoRcOrden = { idEmpresa, idOrden };
    await registrarEventoOutbox(
      tx,
      EVENTOS_OUTBOX.ocTelaResuelta,
      VERSION_EVENTO_RC_ORDEN,
      idEmpresa,
      payload,
    );
  }
}

// ── Operaciones ───────────────────────────────────────────────────────────────────

/**
 * Crea una orden de compra en estado `borrador` en UNA transacción (A2). Valida el proveedor y el
 * SET de líneas (XOR catálogo/libre, existencia de catálogos, matriz suma=cantidad, órdenes
 * ligadas de la empresa); toma el folio de la secuencia atómica `"orden-compra"` de la empresa
 * activa (A3/A9); deriva las ligas N:N `OrdenCompraOrden` de los `idOrden` de las líneas (R7);
 * auditoría + bitácora CREAR. Permiso `compras.administrar`.
 */
export async function crearOC(
  sesion: SesionUsuario,
  entrada: EntradaCrearOC,
  bd?: ContextoBd,
  /**
   * Uso INTERNO (no viaja por el API): `automatica: true` marca las OC que genera la explosión MRP,
   * que pueden nacer con el COMPLEMENTO de la tela pendiente (§Post-F9.18). La captura de una
   * persona siempre entra sin esto, y la autorización exige el complemento en ambos casos.
   */
  opciones: { automatica?: boolean } = {},
): Promise<CompraSalida> {
  verificarPermiso(sesion, 'compras.administrar');
  const datos = validarEntrada(esquemaCompraCrear, entrada);

  const idOC = await enTransaccion(async (tx) => {
    await exigirProveedorExiste(tx, datos.idProveedor);
    const direccion = await exigirDireccionEntregaValida(tx, datos.idDireccionEntrega);
    const { idsOrden, lineas } = await validarLineas(
      tx,
      sesion.idEmpresaActiva,
      datos.lineas,
      datos.idProveedor,
      opciones.automatica ?? false,
    );

    const folio = await siguienteFolio(tx, sesion.idEmpresaActiva, CLAVE_SECUENCIA_ORDEN_COMPRA);

    const oc = await tx.ordenCompra.create({
      data: {
        numCompra: folio,
        idEmpresa: sesion.idEmpresaActiva,
        idProveedor: datos.idProveedor,
        // §Post-F9.18: la fecha de emisión la pone el SERVIDOR (el día en que se captura). No
        // viaja en el cuerpo: *"la fecha de creación de la OC es la del día que se hace, sin
        // opción a cambiarla"*. El histórico migrado conserva la suya (entra por `crearOCMigrada`).
        fecha: hoyColumna(),
        fechaEntrega: aDateColumna(datos.fechaEntrega) ?? null,
        idDireccionEntrega: direccion.id,
        // El texto se COPIA del catálogo: impresos y consultas viejas siguen leyendo un solo campo.
        entregaEn: direccion.direccion,
        observaciones: aTexto(datos.observaciones) ?? null,
        correspondeA: aTexto(datos.correspondeA) ?? null,
        estatus: 'borrador',
        ...datosCreacion(sesion),
      },
    });

    await crearLineas(tx, sesion, oc.id, lineas);
    await sincronizarOrdenesLigadas(tx, sesion, oc.id, idsOrden);

    await registrarBitacora(tx, sesion, {
      entidad: 'OrdenCompra',
      idEntidad: oc.id,
      accion: 'CREAR',
      datos: {
        numCompra: Number(folio),
        idProveedor: datos.idProveedor,
        renglones: datos.lineas.length,
      },
    });

    return oc.id;
  }, bd);

  return obtenerOC(sesion, idOC, bd);
}

/**
 * Actualiza una OC (encabezado + reemplazo opcional del SET de líneas) en UNA transacción (A2).
 * REGLA (decisión (a)): si la OC está `autorizada`/`recibida_*` y la sesión NO es admin
 * (`roles.administrar`) → `ErrorConflicto` (la OC autorizada se bloquea para el usuario normal). En
 * `borrador`/`pendiente_autorizacion` cualquiera con `compras.administrar` edita. La OC cancelada
 * no se edita. Si `lineas` viene, REEMPLAZA todo el set (borra y recrea) y re-deriva las ligas
 * N:N. Bitácora MODIFICAR. Permiso `compras.administrar`.
 */
export async function actualizarOC(
  sesion: SesionUsuario,
  id: number,
  entrada: EntradaActualizarOC,
  bd?: ContextoBd,
): Promise<CompraSalida> {
  verificarPermiso(sesion, 'compras.administrar');
  const datos = validarEntrada(esquemaCompraEditarCuerpo, entrada);

  await enTransaccion(async (tx) => {
    const actual = await exigirOC(tx, id, sesion.idEmpresaActiva);
    if (actual.estatus === 'cancelada') {
      throw new ErrorConflicto('La orden de compra está cancelada; no se puede modificar.');
    }
    if (!ESTATUS_EDITABLES_NORMAL.includes(actual.estatus) && !esAdmin(sesion)) {
      // Decisión (a): autorizada/recibida_* solo la edita el admin.
      throw new ErrorConflicto(
        'La orden de compra ya está autorizada; solo un administrador puede modificarla.',
      );
    }

    const cambios: Prisma.OrdenCompraUncheckedUpdateInput = { ...datosModificacion(sesion) };
    if (datos.idProveedor !== undefined) {
      await exigirProveedorExiste(tx, datos.idProveedor);
      cambios.idProveedor = datos.idProveedor;
    }
    // §Post-F9.18: la fecha de EMISIÓN no se edita (la puso el servidor al crear la OC), así que
    // el cuerpo del PATCH ya no la trae. La de ENTREGA sí se cambia, pero no se puede vaciar.
    if (datos.fechaEntrega !== undefined)
      cambios.fechaEntrega = aDateColumna(datos.fechaEntrega) ?? null;
    if (datos.idDireccionEntrega !== undefined) {
      const direccion = await exigirDireccionEntregaValida(tx, datos.idDireccionEntrega);
      cambios.idDireccionEntrega = direccion.id;
      cambios.entregaEn = direccion.direccion;
    }
    if (datos.observaciones !== undefined)
      cambios.observaciones = aTexto(datos.observaciones) ?? null;
    if (datos.correspondeA !== undefined) cambios.correspondeA = aTexto(datos.correspondeA) ?? null;

    await tx.ordenCompra.update({ where: { id }, data: cambios });

    // Reemplazo del SET de líneas (si vino). Borra y recrea: las líneas no tienen estado propio
    // que conservar (a diferencia de la matriz de la orden de producción), así que el reemplazo
    // total es correcto y simple; las ligas N:N se re-derivan.
    if (datos.lineas !== undefined) {
      // El proveedor contra el que se validan las telas es el que VA A QUEDAR: si la edición lo
      // cambia, las telas tienen que ser del nuevo (si no, la OC quedaría inconsistente).
      const { idsOrden, lineas } = await validarLineas(
        tx,
        sesion.idEmpresaActiva,
        datos.lineas,
        datos.idProveedor ?? actual.idProveedor,
      );
      // Cascade borra la matriz de cada línea.
      await tx.ordenCompraLinea.deleteMany({ where: { idOrdenCompra: id } });
      await crearLineas(tx, sesion, id, lineas);
      await sincronizarOrdenesLigadas(tx, sesion, id, idsOrden);
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'OrdenCompra',
      idEntidad: id,
      accion: 'MODIFICAR',
      datos: {
        encabezado: true,
        lineas: datos.lineas?.length,
        ...(esAdmin(sesion) && !ESTATUS_EDITABLES_NORMAL.includes(actual.estatus)
          ? { edicionAdminSobreAutorizada: true }
          : {}),
      },
    });
  }, bd);

  return obtenerOC(sesion, id, bd);
}

/**
 * Autoriza una OC (decisión (a)): de `borrador`/`pendiente_autorizacion` pasa a `autorizada`,
 * sella `idUsuAutorizado`/`fechaAutorizado` y registra bitácora. Una OC autorizada/recibida/
 * cancelada no se re-autoriza (conflicto). Permiso PROPIO `compras.autorizar`.
 *
 * §Post-F9.18 — TAMBIÉN cierra el hueco del COMPLEMENTO: una OC generada por la explosión MRP puede
 * nacer con el complemento de la tela pendiente (el BOM no sabe cuánto Cardigan lleva), pero NO se
 * autoriza así: aquí se exige que cada renglón de una tela con complemento traiga su cantidad. Así
 * nadie compra "media tela" ni el sistema inventa cantidades.
 */
export async function autorizarOC(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<CompraSalida> {
  verificarPermiso(sesion, 'compras.autorizar');

  await enTransaccion(async (tx) => {
    const actual = await exigirOC(tx, id, sesion.idEmpresaActiva);
    if (!ESTATUS_EDITABLES_NORMAL.includes(actual.estatus)) {
      throw new ErrorConflicto(
        `La orden de compra ${Number(actual.numCompra)} no se puede autorizar desde el estatus "${actual.estatus}".`,
      );
    }
    await exigirComplementosCapturados(tx, id);
    await tx.ordenCompra.update({
      where: { id },
      data: {
        estatus: 'autorizada',
        idUsuAutorizado: sesion.id,
        fechaAutorizado: new Date(),
        ...datosModificacion(sesion),
      },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'OrdenCompra',
      idEntidad: id,
      accion: 'OTRO',
      datos: { autorizada: true, numCompra: Number(actual.numCompra) },
    });
    // OUTBOX (post-F9): la autorización de la OC de tela completa el proceso RC `compraTela` de las
    // órdenes ligadas. (El otro gancho de compras con la RC es `recepcionTela` al RECIBIR el material,
    // en recepciones.ts.) El consumidor relee el estado físico; se emite por orden afectada.
    await emitirOcTelaResuelta(tx, sesion.idEmpresaActiva, id);
  }, bd);

  dispararPublicacion();
  return obtenerOC(sesion, id, bd);
}

/**
 * Cancela una OC (cancelación SUAVE): `estatus='cancelada'` + `canceladaEn`/`canceladaPorId` +
 * `motivoCancelacion` (OBLIGATORIO) + bitácora CANCELAR. La OC sigue consultable; no se borra.
 * Cancelar dos veces es conflicto.
 *
 * REGLA "no cancelable con recepciones" (F4-E3): una OC con recepciones ACTIVAS (no reversadas) no
 * se puede cancelar — hay que reversarlas primero (D3: nada se borra; la reversión genera el inverso
 * de kardex). El chequeo es por CONTEO de `RecepcionCompra` activas (no solo por estatus): aunque el
 * estatus normalmente refleja las recepciones, el conteo es la verdad y cubre cualquier desfase. Un
 * estatus `recibida_*` también se rechaza por seguridad. Tras reversar TODAS, la OC vuelve a
 * `autorizada` y entonces sí se puede cancelar. Permiso PROPIO `compras.cancelar`.
 */
export async function cancelarOC(
  sesion: SesionUsuario,
  id: number,
  cuerpo: z.input<typeof esquemaCompraCancelarCuerpo>,
  bd?: ContextoBd,
): Promise<CompraSalida> {
  verificarPermiso(sesion, 'compras.cancelar');
  const datos = validarEntrada(esquemaCompraCancelarCuerpo, cuerpo);

  await enTransaccion(async (tx) => {
    const actual = await exigirOC(tx, id, sesion.idEmpresaActiva);
    if (actual.estatus === 'cancelada') {
      throw new ErrorConflicto(`La orden de compra ${Number(actual.numCompra)} ya está cancelada.`);
    }
    // F4-E3: hay que reversar las recepciones ACTIVAS antes de cancelar (D3). Se cuenta directo,
    // sin confiar solo en el estatus (que normalmente lo refleja, pero el conteo es la verdad).
    const recepcionesActivas = await tx.recepcionCompra.count({
      where: { idOrdenCompra: id, reversadaEn: null },
    });
    if (recepcionesActivas > 0) {
      throw new ErrorConflicto(
        'La orden de compra tiene recepciones; reversa las recepciones antes de cancelarla.',
      );
    }
    if (actual.estatus === 'recibida_parcial' || actual.estatus === 'recibida_total') {
      // Defensa adicional: si el estatus quedó en recibida_* sin recepciones activas (desfase),
      // se rechaza igual; primero hay que dejar la OC consistente.
      throw new ErrorConflicto(
        'La orden de compra tiene recepciones; reversa las recepciones antes de cancelarla.',
      );
    }
    await tx.ordenCompra.update({
      where: { id },
      data: {
        estatus: 'cancelada',
        canceladaEn: new Date(),
        canceladaPorId: sesion.id,
        motivoCancelacion: datos.motivo,
        ...datosModificacion(sesion),
      },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'OrdenCompra',
      idEntidad: id,
      accion: 'CANCELAR',
      datos: { numCompra: Number(actual.numCompra), motivo: datos.motivo },
    });
    // OUTBOX (post-F9): al cancelar la OC, la RC re-evalúa `compraTela` de las órdenes ligadas (si ya
    // no queda una OC de tela viva autorizada para la orden, el proceso se des-completa — decisión (f)).
    await emitirOcTelaResuelta(tx, sesion.idEmpresaActiva, id);
  }, bd);

  dispararPublicacion();
  return obtenerOC(sesion, id, bd);
}

/**
 * Duplica una OC a una NUEVA en estado `borrador` con folio nuevo (decisión (a) — "Duplicar a
 * nueva OC", para todos): copia el encabezado y las líneas (con su matriz), SIN datos de
 * autorización/cancelación; la copia sigue su propio ciclo. La OC origen debe ser de la empresa
 * activa (A9). Bitácora CREAR con el dato de origen. Devuelve la OC nueva. Permiso
 * `compras.administrar`.
 */
export async function duplicarOC(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<CompraSalida> {
  verificarPermiso(sesion, 'compras.administrar');

  const idNueva = await enTransaccion(async (tx) => {
    const origen = await tx.ordenCompra.findFirst({
      where: { id, idEmpresa: sesion.idEmpresaActiva },
      include: { lineas: { include: { tallas: true }, orderBy: { id: 'asc' } } },
    });
    if (origen === null) {
      throw new ErrorNoEncontrado('OrdenCompra', id);
    }

    const folio = await siguienteFolio(tx, sesion.idEmpresaActiva, CLAVE_SECUENCIA_ORDEN_COMPRA);

    const nueva = await tx.ordenCompra.create({
      data: {
        numCompra: folio,
        idEmpresa: sesion.idEmpresaActiva,
        idProveedor: origen.idProveedor,
        // La copia es una OC NUEVA: se emite HOY (§Post-F9.18), no el día de la original. La fecha
        // de entrega y la dirección sí se arrastran (es el mismo pedido, capturado de nuevo).
        fecha: hoyColumna(),
        fechaEntrega: origen.fechaEntrega,
        idDireccionEntrega: origen.idDireccionEntrega,
        entregaEn: origen.entregaEn,
        observaciones: origen.observaciones,
        correspondeA: origen.correspondeA,
        estatus: 'borrador',
        ...datosCreacion(sesion),
      },
    });

    // Copia las líneas (con su matriz) como un set de entrada nuevo, reusando crearLineas.
    const lineas: DatosCompraLineaEntrada[] = origen.lineas.map((l) => ({
      idTela: l.idTela,
      idAvio: l.idAvio,
      idAvioProveedor: l.idAvioProveedor,
      cantidad: l.cantidad.toNumber(),
      unidad: l.unidad,
      precio: l.precio.toNumber(),
      cantidadComplemento: l.cantidadComplemento?.toNumber() ?? null,
      precioComplemento: l.precioComplemento?.toNumber() ?? null,
      idOrden: l.idOrden,
      descripcionLibre: l.descripcionLibre,
      tallas: l.tallas.map((t) => ({
        idColor: t.idColor,
        idTalla: t.idTalla,
        cantidad: t.cantidad,
      })),
    }));
    await crearLineas(tx, sesion, nueva.id, lineas);
    const idsOrden = new Set(
      origen.lineas.map((l) => l.idOrden).filter((x): x is number => x != null),
    );
    await sincronizarOrdenesLigadas(tx, sesion, nueva.id, idsOrden);

    await registrarBitacora(tx, sesion, {
      entidad: 'OrdenCompra',
      idEntidad: nueva.id,
      accion: 'CREAR',
      datos: { numCompra: Number(folio), duplicadaDe: id, renglones: lineas.length },
    });

    return nueva.id;
  }, bd);

  return obtenerOC(sesion, idNueva, bd);
}

/** Obtiene una OC (con todo su detalle) de la empresa activa, o lanza `ErrorNoEncontrado`. */
export async function obtenerOC(
  sesion: SesionUsuario,
  id: number,
  bd?: ContextoBd,
): Promise<CompraSalida> {
  verificarPermiso(sesion, 'compras.ver');
  const oc = await clienteLectura(bd).ordenCompra.findFirst({
    where: { id, idEmpresa: sesion.idEmpresaActiva },
    include: incluirDetalle,
  });
  if (oc === null) {
    throw new ErrorNoEncontrado('OrdenCompra', id);
  }
  return aCompraSalida(oc);
}

/**
 * Lista las OC de la empresa activa (A9) con búsqueda combinada y paginación EN SERVIDOR:
 *  • `busqueda`: folio (si es número) o nombre de proveedor (insensible a mayúsculas).
 *  • filtros por proveedor, estatus, rango de fecha de emisión, y `idOrden` (las OC ligadas a una
 *    orden de PRODUCCIÓN — pantalla "Compras por orden", R7 — vía el N:N de encabezado).
 * Por defecto NO incluye las canceladas. Cada OC trae su detalle embebido con el total derivado.
 */
export async function listarOC(
  sesion: SesionUsuario,
  parametros: ParametrosListarOC = {},
  bd?: ContextoBd,
): Promise<Pagina<CompraSalida>> {
  verificarPermiso(sesion, 'compras.ver');
  const filtros = validarEntrada(esquemaListarComprasDominio, parametros);

  const where: Prisma.OrdenCompraWhereInput = {
    idEmpresa: sesion.idEmpresaActiva,
    ...(filtros.estatus === undefined ? {} : { estatus: filtros.estatus }),
    ...(filtros.estatus === undefined && !filtros.incluirCanceladas
      ? { estatus: { not: 'cancelada' } }
      : {}),
    ...(filtros.idProveedor === undefined ? {} : { idProveedor: filtros.idProveedor }),
    // OC ligadas a una orden de PRODUCCIÓN (pantalla "Compras por orden", R7): vía el N:N de
    // encabezado `OrdenCompraOrden` (que el dominio deriva de los idOrden de las líneas). La
    // empresa ya está sellada arriba (A9), así que no hace falta re-filtrar la orden por empresa.
    ...(filtros.idOrden === undefined
      ? {}
      : { ordenesLigadas: { some: { idOrden: filtros.idOrden } } }),
    ...armarFiltroFecha(filtros.fechaDesde, filtros.fechaHasta),
    ...armarBusqueda(filtros.busqueda),
  };

  const cliente = clienteLectura(bd);
  const [total, datos] = await Promise.all([
    cliente.ordenCompra.count({ where }),
    cliente.ordenCompra.findMany({
      where,
      orderBy: { [filtros.ordenarPor]: filtros.direccion },
      include: incluirDetalle,
      ...rangoPrisma(filtros),
    }),
  ]);

  const salida = datos.map((o) => aCompraSalida(o as OCConDetalle));
  return armarPagina(salida, total, filtros);
}

/** Estatus "abiertos" (con material pendiente de recibir) para el resumen de cabecera. */
const ESTATUS_ABIERTOS: readonly EstatusOrdenCompra[] = [
  EstatusOrdenCompra.autorizada,
  EstatusOrdenCompra.recibida_parcial,
];

/**
 * Filtros del resumen con tipos NATIVOS (la ruta ya coaccionó la querystring). Sub-conjunto de los
 * del listado que ACOTAN el universo de OC abiertas (proveedor/fecha/búsqueda/orden ligada); el
 * estatus NO entra (el resumen SIEMPRE mira las abiertas).
 */
const esquemaResumenOCDominio = z.object({
  busqueda: z.string().trim().max(200).optional(),
  idProveedor: z.number().int().positive().optional(),
  fechaDesde: z.iso.date().optional(),
  fechaHasta: z.iso.date().optional(),
  idOrden: z.number().int().positive().optional(),
});

/** Parámetros del resumen (los reutiliza la ruta REST). */
export type ParametrosResumenOC = z.input<typeof esquemaResumenOCDominio>;

/**
 * Resumen de cabecera de OC (KPIs `vCompras`, R9): # OC ABIERTAS (autorizada + recibida_parcial) que
 * cumplen el filtro, e importe TODAVÍA por recibir. Este último = Σ, sobre las líneas de esas OC, de
 * `max(0, cantidad − recibido) × precio`, donde `recibido` es la Σ de lo recibido por línea en
 * recepciones ACTIVAS (reversadaEn = null) — EXACTAMENTE el criterio de `recalcularEstatusOC`
 * (`recepciones.ts`), no una derivación distinta. El pendiente por línea nunca es negativo (una
 * línea sobre-recibida aporta 0). Permiso `compras.ver` (A4); todo acotado por empresa activa (A9).
 */
export async function resumenOC(
  sesion: SesionUsuario,
  parametros: ParametrosResumenOC = {},
  bd?: ContextoBd,
): Promise<ResumenCompras> {
  verificarPermiso(sesion, 'compras.ver');
  const filtros = validarEntrada(esquemaResumenOCDominio, parametros);
  const cliente = clienteLectura(bd);

  const where: Prisma.OrdenCompraWhereInput = {
    idEmpresa: sesion.idEmpresaActiva,
    estatus: { in: [...ESTATUS_ABIERTOS] },
    ...(filtros.idProveedor === undefined ? {} : { idProveedor: filtros.idProveedor }),
    ...(filtros.idOrden === undefined
      ? {}
      : { ordenesLigadas: { some: { idOrden: filtros.idOrden } } }),
    ...armarFiltroFecha(filtros.fechaDesde, filtros.fechaHasta),
    ...armarBusqueda(filtros.busqueda),
  };

  const abiertas = await cliente.ordenCompra.findMany({
    where,
    select: { id: true, lineas: { select: { id: true, cantidad: true, precio: true } } },
  });
  const ocAbiertas = abiertas.length;
  if (ocAbiertas === 0) {
    return { ocAbiertas: 0, porRecibir: 0 };
  }

  // Σ recibido por línea de OC en recepciones ACTIVAS (reversadaEn = null): MISMO criterio que
  // `recalcularEstatusOC`. Un solo groupBy para todas las líneas de las OC abiertas.
  const idsLinea = abiertas.flatMap((oc) => oc.lineas.map((l) => l.id));
  const recibidoPorLinea = new Map<number, number>();
  if (idsLinea.length > 0) {
    const sumas = await cliente.recepcionCompraLinea.groupBy({
      by: ['idOrdenCompraLinea'],
      where: { idOrdenCompraLinea: { in: idsLinea }, recepcionCompra: { reversadaEn: null } },
      _sum: { cantidadRecibida: true },
    });
    for (const s of sumas) {
      recibidoPorLinea.set(s.idOrdenCompraLinea, Number(s._sum.cantidadRecibida ?? 0));
    }
  }

  let porRecibir = 0;
  for (const oc of abiertas) {
    for (const l of oc.lineas) {
      const pendiente = Math.max(0, l.cantidad.toNumber() - (recibidoPorLinea.get(l.id) ?? 0));
      porRecibir += pendiente * l.precio.toNumber();
    }
  }
  return { ocAbiertas, porRecibir: redondear2(porRecibir) };
}

/** Arma el `OR` de búsqueda: folio (si es entero) o nombre de proveedor. Vacío → sin OR. */
function armarBusqueda(busqueda: string | undefined): Prisma.OrdenCompraWhereInput {
  if (busqueda === undefined || busqueda === '') {
    return {};
  }
  const or: Prisma.OrdenCompraWhereInput[] = [
    { proveedor: { nombre: { contains: busqueda, mode: 'insensitive' } } },
  ];
  if (/^\d+$/.test(busqueda.trim())) {
    try {
      or.push({ numCompra: BigInt(busqueda.trim()) });
    } catch {
      // No es un bigint válido; se ignora.
    }
  }
  return { OR: or };
}

/**
 * Arma el filtro por rango de fecha de emisión (`@db.Date`): `desde` inclusivo (gte) y `hasta`
 * inclusivo del DÍA COMPLETO (lt del día siguiente, para no excluir las horas de la fecha "hasta").
 */
function armarFiltroFecha(
  desde: string | undefined,
  hasta: string | undefined,
): Prisma.OrdenCompraWhereInput {
  if (desde === undefined && hasta === undefined) {
    return {};
  }
  const fecha: Prisma.DateTimeNullableFilter = {};
  if (desde !== undefined) fecha.gte = new Date(`${desde}T00:00:00.000Z`);
  // Hasta el FINAL del día (lt del día siguiente) para incluir toda la fecha "hasta".
  if (hasta !== undefined) {
    const d = new Date(`${hasta}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    fecha.lt = d;
  }
  return { fecha };
}
