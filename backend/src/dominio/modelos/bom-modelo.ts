/**
 * BOM del modelo (F1-E4) — la RECETA: telas y avíos de un `Modelo` (doc
 * `Documentacion_MJD/01-Modelos.md` §2, `ModelosTela`/`ModelosHab`).
 *
 * Cada sección se gestiona con un endpoint "set-completo" (como el grid de colores de la tela
 * o los proveedores del avío en E3): se manda el conjunto deseado y el dominio sincroniza
 * (agrega/quita/actualiza) en UNA transacción A2, conservando la auditoría de los renglones
 * que no cambian (diff mínimo). Sin duplicados por componente (lo valida el esquema y lo
 * re-valida el dominio; lo respalda la PK compuesta).
 *
 * 🔑 Regla de negocio (A1 — doc 01-Modelos §2): las TRES banderas
 * `paraPreCosto`/`paraProduccion`/`paraCosto` de cada tela/avío se CONSERVAN: un componente
 * puede costear sin listarse en producción y viceversa.
 *
 * El ARTE (bordados/estampados) ya NO es una sección de "set completo": desde V1-E3d
 * (§Post-F9.35) es un HIJO del modelo con sus propios datos y su foto, con CRUD renglón por
 * renglón en `arte-modelo.ts`. Aquí solo se LEE (para embeberlo en la ficha) y se COPIA (junto
 * con el resto de la receta, en `copiarBom`).
 *
 * `copiarBom` clona la receta de OTRO modelo en UNA transacción (todo o nada): útil para dar de
 * alta variantes a partir de un modelo base. onDelete del BOM hacia los catálogos es Restrict
 * (una tela/avío usado por un modelo no se borra físico); hacia el modelo es Cascade (permite
 * reescribir el set en la tx).
 */
import type {
  esquemaModeloAvioEntrada,
  esquemaModeloTelaEntrada,
} from '../../contrato/esquemas/modelo.js';
import {
  esquemaModeloAvios,
  esquemaModeloCopiarBomCuerpo,
  esquemaModeloTelas,
} from '../../contrato/esquemas/modelo.js';
import type { Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { factorParaLectura } from '../../comun/conversion.js';
import { redondear2 } from '../costos/decimales.js';
import {
  resolverPrecioAvioCatalogo,
  resolverPrecioTela,
  type OrigenPrecioAvioCatalogo,
  type OrigenPrecioTela,
} from '../costos/resolucion-precios.js';
import { ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { recalcularEstadoOrdenesDeModelo } from '../produccion/requisitos-orden.js';

import {
  borrarArchivoSiQuedoHuerfano,
  datosArteParaBitacora,
  leerArtesModelo,
  type ModeloArteDetalle,
} from './arte-modelo.js';
import {
  exigirModelo,
  incluirRelacionesModelo,
  leerTallasCurvaModelo,
  type ModeloConRelaciones,
  type TallaCurvaModelo,
} from './modelos.js';

// ── Tipos de entrada (lo que recibe el dominio ANTES de validar: defaults opcionales) ──
// El dominio re-valida con `validarEntrada` (mismo patrón que `EntradaCrear*`): por eso los
// puntos de entrada aceptan `z.input` (banderas opcionales) y, ya validados, las funciones
// internas trabajan con `z.output` (banderas resueltas).

/** Renglón de tela del BOM tal como LLEGA (banderas opcionales; el dominio aplica defaults). */
export type EntradaTelaBom = z.input<typeof esquemaModeloTelaEntrada>;
/** Renglón de avío del BOM tal como llega. */
export type EntradaAvioBom = z.input<typeof esquemaModeloAvioEntrada>;
/** Cuerpo de copiar BOM tal como llega (`reemplazar` opcional, default true). */
export type EntradaCopiarBom = z.input<typeof esquemaModeloCopiarBomCuerpo>;

/** Renglón de tela del BOM ya validado (banderas y consumo resueltos). */
type TelaBomValidada = z.output<typeof esquemaModeloTelaEntrada>;
/** Renglón de avío del BOM ya validado. */
type AvioBomValidado = z.output<typeof esquemaModeloAvioEntrada>;

// ── Salida de cada sección del BOM (renglones con nombre embebido para la UI) ──

/**
 * De qué escalón de la cascada salió el precio que se va a COSTEAR (mismo vocabulario en tela y
 * avío, para que la pantalla no tenga que traducir): ver `esquemaOrigenPrecioBom` del contrato.
 */
export type OrigenPrecioBom = OrigenPrecioAvioCatalogo;

/**
 * Traduce el origen de la cascada de TELA al vocabulario común de la receta. `amarre-color` se
 * reporta como `amarre` porque el proveedor amarrado ES el que costea; que su precio dependa del
 * color lo dice aparte `precioPorColor` (la receta es por modelo: el color llega con la orden).
 * `sugerido` es el último escalón del catálogo = `referencia`.
 */
function origenTelaParaBom(origen: OrigenPrecioTela): OrigenPrecioBom {
  switch (origen) {
    case 'amarre':
    case 'amarre-color':
      return 'amarre';
    case 'color-referencia':
    case 'sugerido':
      return 'referencia';
    default:
      return 'sin-precio';
  }
}

/** Renglón de tela del BOM tal como sale al cliente (con su AMARRE de precio R17 resuelto). */
export type ModeloTelaDetalle = {
  idTela: number;
  nombre: string;
  consumoPorPrenda: number;
  paraPreCosto: boolean;
  paraProduccion: boolean;
  paraCosto: boolean;
  /** `TelaProveedor.id` amarrado por Desarrollo (R17), o null. */
  idTelaProveedor: number | null;
  /** Nombre del proveedor amarrado, o null. */
  proveedorAmarrado: string | null;
  /** ¿El proveedor amarrado cotiza por color? (entonces el precio fino sale del color). */
  precioPorColor: boolean;
  /** El precio con el que se VA A COSTEAR (el escalón que gana la cascada), o null. */
  precioCosteo: number | null;
  /** De qué escalón salió `precioCosteo`. */
  origenPrecio: OrigenPrecioBom;
  /** Proveedor del que salió `precioCosteo` (null si salió del catálogo). */
  proveedorPrecio: string | null;
  /** `Tela.precioSugerido`: último escalón de la cascada. */
  precioReferencia: number | null;
};

/** Renglón de avío del BOM tal como sale al cliente (con su AMARRE de precio R17 resuelto). */
export type ModeloAvioDetalle = {
  idAvio: number;
  clave: string;
  descripcion: string;
  consumoPorPrenda: number;
  paraPreCosto: boolean;
  paraProduccion: boolean;
  paraCosto: boolean;
  /** ¿El consumo se captura POR TALLA (R18)? Lo administra `medidas-avio-talla.ts`. */
  consumoPorTalla: boolean;
  /** Proveedor del par `AvioProveedor` amarrado (R17), o null. */
  idAvioProveedor: number | null;
  /** Nombre del proveedor amarrado, o null. */
  proveedorAmarrado: string | null;
  /** El precio (por unidad de consumo) con el que se VA A COSTEAR, o null. */
  precioCosteo: number | null;
  /** De qué escalón salió `precioCosteo` (incluye `promedio-medidas`, que gana sobre el amarre). */
  origenPrecio: OrigenPrecioBom;
  /** Proveedor del que salió `precioCosteo` (null en promedio-medidas/referencia). */
  proveedorPrecio: string | null;
  /** `Avio.precioReferencia`: último escalón de la cascada. */
  precioReferencia: number | null;
};

/** BOM completo de un modelo (telas + avíos + su ARTE), para embeber en la ficha. */
export interface BomModelo {
  telas: ModeloTelaDetalle[];
  avios: ModeloAvioDetalle[];
  artes: ModeloArteDetalle[];
}

// ── Lecturas de cada sección (ordenadas por nombre del componente) ────────────

/**
 * Lee las telas del BOM de un modelo (con el nombre de la tela, ordenadas por nombre) y resuelve
 * el PRECIO QUE VA A COSTEAR con la MISMA cascada del motor (`resolverPrecioTela`: amarre →
 * sugerido — sin color, porque la receta es por modelo y el color aparece hasta la orden), diciendo
 * de qué escalón salió. La receta no puede enseñar un número distinto del que costea (regla de
 * Daniel, 15-ago-2026), y por eso NO se calcula aquí a mano: se llama al mismo resolvedor.
 */
export async function leerTelasBom(tx: Tx, idModelo: number): Promise<ModeloTelaDetalle[]> {
  const filas = await tx.modeloTela.findMany({
    where: { idModelo },
    select: {
      idTela: true,
      consumoPorPrenda: true,
      paraPreCosto: true,
      paraProduccion: true,
      paraCosto: true,
      idTelaProveedor: true,
      telaProveedor: {
        select: {
          precio: true,
          manejaPrecioPorColor: true,
          proveedor: { select: { nombre: true } },
        },
      },
      tela: { select: { nombre: true, precioSugerido: true } },
    },
    orderBy: { tela: { nombre: 'asc' } },
  });
  return filas.map((f) => {
    const precioSugerido = f.tela.precioSugerido === null ? null : f.tela.precioSugerido.toNumber();
    const proveedorAmarrado = f.telaProveedor?.proveedor.nombre ?? null;
    const resuelto = resolverPrecioTela({
      precioSugerido,
      amarre:
        f.telaProveedor === null || f.telaProveedor === undefined
          ? null
          : {
              precio: f.telaProveedor.precio === null ? null : f.telaProveedor.precio.toNumber(),
              manejaPrecioPorColor: f.telaProveedor.manejaPrecioPorColor,
            },
    });
    return {
      idTela: f.idTela,
      nombre: f.tela.nombre,
      consumoPorPrenda: f.consumoPorPrenda.toNumber(),
      paraPreCosto: f.paraPreCosto,
      paraProduccion: f.paraProduccion,
      paraCosto: f.paraCosto,
      idTelaProveedor: f.idTelaProveedor,
      proveedorAmarrado,
      precioPorColor: f.telaProveedor?.manejaPrecioPorColor ?? false,
      precioCosteo: resuelto.precio === null ? null : redondear2(resuelto.precio),
      origenPrecio: origenTelaParaBom(resuelto.origen),
      // Solo se acredita al proveedor cuando el precio SALIÓ de él (misma regla de traza que usa
      // el precosto al guardar `idTelaProveedor`): con el sugerido genérico, nadie lo firma.
      proveedorPrecio:
        resuelto.origen === 'amarre' || resuelto.origen === 'amarre-color'
          ? proveedorAmarrado
          : null,
      precioReferencia: precioSugerido,
    };
  });
}

/**
 * Lee los avíos del BOM de un modelo (con clave/descripción, ordenados por clave) y resuelve el
 * PRECIO QUE VA A COSTEAR con la MISMA función del precosto (`resolverPrecioAvioCatalogo`:
 * promedio de medidas → amarre → más barato → referencia), diciendo de qué escalón salió y qué
 * proveedor lo firmó. Nada se recalcula a mano aquí: la receta enseña el número del motor.
 *
 * Se leen de UNA sola consulta —para todos los avíos del BOM, sin N+1— los proveedores (con su
 * precio y su factor) y las medidas activas; `ModeloAvio.idAvioProveedor` guarda el PROVEEDOR del
 * par (no un id de `AvioProveedor`, que tiene PK compuesta).
 */
export async function leerAviosBom(tx: Tx, idModelo: number): Promise<ModeloAvioDetalle[]> {
  const filas = await tx.modeloAvio.findMany({
    where: { idModelo },
    select: {
      idAvio: true,
      consumoPorPrenda: true,
      paraPreCosto: true,
      paraProduccion: true,
      paraCosto: true,
      consumoPorTalla: true,
      idAvioProveedor: true,
      avio: {
        select: { clave: true, descripcion: true, precioReferencia: true, factorConversion: true },
      },
    },
    orderBy: { avio: { clave: 'asc' } },
  });

  const idsAvio = filas.map((f) => f.idAvio);
  // TODOS los proveedores de esos avíos (no solo el amarrado): la cascada compara para elegir el
  // MÁS BARATO cuando no hay amarre, que es justo lo que costea el precosto. Y las medidas
  // ACTIVAS, porque un avío "por medida" se costea con su promedio y ese escalón gana al amarre.
  const [proveedores, medidas] = await Promise.all([
    idsAvio.length === 0
      ? []
      : tx.avioProveedor.findMany({
          where: { idAvio: { in: idsAvio } },
          select: {
            idAvio: true,
            idProveedor: true,
            precio: true,
            factorConversion: true,
            proveedor: { select: { nombre: true } },
          },
          // Orden DETERMINISTA: ante un empate exacto de precio, la cascada se queda con el
          // primero, así que sin `orderBy` el NOMBRE del "más barato" podía bailar entre
          // corridas — el precio sería el mismo, pero un proveedor que cambia solo en pantalla
          // destruye la confianza en la cifra.
          orderBy: [{ proveedor: { nombre: 'asc' } }, { idProveedor: 'asc' }],
        }),
    idsAvio.length === 0
      ? []
      : tx.avioMedida.findMany({
          where: { idAvio: { in: idsAvio }, activo: true },
          select: { idAvio: true, precio: true },
        }),
  ]);

  type ProveedorDelAvio = (typeof proveedores)[number];
  const proveedoresPorAvio = new Map<number, ProveedorDelAvio[]>();
  for (const p of proveedores) {
    const lista = proveedoresPorAvio.get(p.idAvio);
    if (lista === undefined) proveedoresPorAvio.set(p.idAvio, [p]);
    else lista.push(p);
  }
  const medidasPorAvio = new Map<number, number[]>();
  for (const m of medidas) {
    const lista = medidasPorAvio.get(m.idAvio);
    if (lista === undefined) medidasPorAvio.set(m.idAvio, [m.precio.toNumber()]);
    else lista.push(m.precio.toNumber());
  }

  return filas.map((f) => {
    const delAvio = proveedoresPorAvio.get(f.idAvio) ?? [];
    const nombrePorProveedor = new Map(delAvio.map((p) => [p.idProveedor, p.proveedor.nombre]));
    // MISMA función que el precosto (`resolverPrecioAvioCatalogo`), no una copia: promedio de
    // medidas → amarre → más barato → referencia, con el precio ya ÷ factor (R1).
    const resuelto = resolverPrecioAvioCatalogo({
      precioReferencia:
        f.avio.precioReferencia === null ? null : f.avio.precioReferencia.toNumber(),
      factorConversionAvio: factorParaLectura(f.avio.factorConversion?.toNumber()),
      idAvioProveedor: f.idAvioProveedor,
      medidas: medidasPorAvio.get(f.idAvio) ?? [],
      proveedores: delAvio.map((p) => ({
        idProveedor: p.idProveedor,
        precio: p.precio === null ? null : p.precio.toNumber(),
        // LECTURA: el factor se SANEA (`factorParaLectura`) antes de entrar al motor. El motor
        // LANZA ante un factor ≤ 0 —y así debe ser al costear—, pero la ficha del modelo es una
        // consulta: no puede devolver 500 por una fila con el factor corrupto. Saneando la
        // ENTRADA se conserva UNA sola regla de precio (la misma del precosto) en vez de abrir un
        // camino paralelo "tolerante" que derivaría.
        factorConversion: factorParaLectura(p.factorConversion?.toNumber()),
      })),
    });
    return {
      idAvio: f.idAvio,
      clave: f.avio.clave,
      descripcion: f.avio.descripcion,
      consumoPorPrenda: f.consumoPorPrenda.toNumber(),
      paraPreCosto: f.paraPreCosto,
      paraProduccion: f.paraProduccion,
      paraCosto: f.paraCosto,
      consumoPorTalla: f.consumoPorTalla,
      idAvioProveedor: f.idAvioProveedor,
      proveedorAmarrado:
        f.idAvioProveedor === null ? null : (nombrePorProveedor.get(f.idAvioProveedor) ?? null),
      // Redondeado a 2 con la MISMA regla del precosto (la cascada del avío DIVIDE por el factor y
      // devuelve decimales infinitos): si la pantalla mostrara el crudo, diría 0.69 donde el
      // costeo guarda 0.69 pero calcula el importe con otro número.
      precioCosteo: resuelto.precio === null ? null : redondear2(resuelto.precio),
      origenPrecio: resuelto.origen,
      proveedorPrecio:
        resuelto.idProveedor === null
          ? null
          : (nombrePorProveedor.get(resuelto.idProveedor) ?? null),
      precioReferencia:
        f.avio.precioReferencia === null ? null : f.avio.precioReferencia.toNumber(),
    };
  });
}

/** Lee el BOM completo (telas + avíos + arte) de un modelo. Reusado por la ficha. */
export async function leerBom(tx: Tx, idModelo: number): Promise<BomModelo> {
  const [telas, avios, artes] = await Promise.all([
    leerTelasBom(tx, idModelo),
    leerAviosBom(tx, idModelo),
    leerArtesModelo(tx, idModelo),
  ]);
  return { telas, avios, artes };
}

/**
 * Modelo con sus relaciones + el BOM completo embebido + las TALLAS DE SU CURVA (forma de la
 * FICHA). Las tallas viajan solo aquí (el listado no las paga): son la lista con la que la receta
 * arma el consumo por talla de un avío (R18).
 */
export type ModeloFicha = ModeloConRelaciones &
  BomModelo & {
    tallasCurva: TallaCurvaModelo[];
  };

/**
 * Obtiene la FICHA de un modelo: datos generales + relaciones + conteo de fotos + el BOM
 * completo (telas/avíos/arte). Requiere `modelos.ver`. Lanza `ErrorNoEncontrado` si no
 * existe. (Lectura compuesta: el modelo y su BOM en una sola respuesta — `GET /api/modelos/:id`.)
 */
export async function obtenerFichaModelo(
  sesion: SesionUsuario,
  idModelo: number,
  bd?: ContextoBd,
): Promise<ModeloFicha> {
  verificarPermiso(sesion, 'modelos.ver');
  const cliente = clienteLectura(bd);
  const modelo = await cliente.modelo.findUnique({
    where: { id: idModelo },
    include: incluirRelacionesModelo,
  });
  if (modelo === null) {
    throw new ErrorNoEncontrado('Modelo', idModelo);
  }
  const [bom, tallasCurva] = await Promise.all([
    leerBom(cliente, idModelo),
    leerTallasCurvaModelo(cliente, idModelo),
  ]);
  return { ...modelo, ...bom, tallasCurva };
}

// ── Validación de componentes (existen y están activos) ────────────────────────

/** Valida que todas las telas existan y estén ACTIVAS (no se mete una tela desactivada al BOM). */
async function exigirTelasValidas(tx: Tx, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const telas = await tx.tela.findMany({
    where: { id: { in: ids } },
    select: { id: true, nombre: true, activo: true },
  });
  if (telas.length !== ids.length) {
    throw new ErrorValidacion('Una o más telas seleccionadas no existen.');
  }
  const inactiva = telas.find((t) => !t.activo);
  if (inactiva !== undefined) {
    throw new ErrorValidacion(
      `La tela "${inactiva.nombre}" está desactivada y no se puede agregar al modelo.`,
    );
  }
}

/** Valida que todos los avíos existan y estén ACTIVOS. */
async function exigirAviosValidos(tx: Tx, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const avios = await tx.avio.findMany({
    where: { id: { in: ids } },
    select: { id: true, clave: true, activo: true },
  });
  if (avios.length !== ids.length) {
    throw new ErrorValidacion('Uno o más avíos seleccionados no existen.');
  }
  const inactivo = avios.find((a) => !a.activo);
  if (inactivo !== undefined) {
    throw new ErrorValidacion(
      `El avío "${inactivo.clave}" está desactivado y no se puede agregar al modelo.`,
    );
  }
}

/**
 * Valida los AMARRES de precio de las TELAS (R17): cada `idTelaProveedor` debe EXISTIR, ser un
 * renglón DE ESA MISMA tela y estar ACTIVO. Sin esta validación se podía amarrar el precio de otra
 * tela (o uno dado de baja) y el precosto costearía con él sin que nadie lo notara.
 */
async function exigirAmarresTelaValidos(tx: Tx, deseados: TelaBomValidada[]): Promise<void> {
  const conAmarre = deseados.filter((d) => d.idTelaProveedor !== null);
  if (conAmarre.length === 0) return;

  const renglones = await tx.telaProveedor.findMany({
    where: { id: { in: conAmarre.map((d) => d.idTelaProveedor as number) } },
    select: { id: true, idTela: true, activo: true, proveedor: { select: { nombre: true } } },
  });
  const porId = new Map(renglones.map((r) => [r.id, r]));

  for (const d of conAmarre) {
    const renglon = porId.get(d.idTelaProveedor as number);
    if (renglon === undefined || renglon.idTela !== d.idTela) {
      throw new ErrorValidacion(
        'El proveedor amarrado a una de las telas no existe o no es de esa tela.',
      );
    }
    if (!renglon.activo) {
      throw new ErrorValidacion(
        `El precio del proveedor "${renglon.proveedor.nombre}" está desactivado y no se puede amarrar.`,
      );
    }
  }
}

/**
 * Valida los AMARRES de precio de los AVÍOS (R17): el par `(idAvio, idAvioProveedor)` debe existir
 * en `AvioProveedor` (el amarre guarda el PROVEEDOR, no un id propio — mismo criterio que
 * `OrdenCompraLinea.idAvioProveedor` de F4).
 */
async function exigirAmarresAvioValidos(tx: Tx, deseados: AvioBomValidado[]): Promise<void> {
  const conAmarre = deseados.filter((d) => d.idAvioProveedor !== null);
  if (conAmarre.length === 0) return;

  const existentes = await tx.avioProveedor.findMany({
    where: {
      OR: conAmarre.map((d) => ({
        idAvio: d.idAvio,
        idProveedor: d.idAvioProveedor as number,
      })),
    },
    select: { idAvio: true, idProveedor: true },
  });
  const claves = new Set(existentes.map((e) => `${e.idAvio}-${e.idProveedor}`));

  for (const d of conAmarre) {
    if (!claves.has(`${d.idAvio}-${String(d.idAvioProveedor)}`)) {
      throw new ErrorValidacion(
        'El proveedor amarrado a uno de los avíos no surte ese avío (no tiene precio capturado para él).',
      );
    }
  }
}

/** ¿Cambió alguna bandera, el consumo o el amarre de un renglón de tela/avío? */
function cambiaRenglonComponente(
  actual: {
    consumoPorPrenda: Prisma.Decimal;
    paraPreCosto: boolean;
    paraProduccion: boolean;
    paraCosto: boolean;
  },
  deseado: {
    consumoPorPrenda: number;
    paraPreCosto: boolean;
    paraProduccion: boolean;
    paraCosto: boolean;
  },
  amarreActual: number | null,
  amarreDeseado: number | null,
): boolean {
  return (
    actual.consumoPorPrenda.toNumber() !== deseado.consumoPorPrenda ||
    actual.paraPreCosto !== deseado.paraPreCosto ||
    actual.paraProduccion !== deseado.paraProduccion ||
    actual.paraCosto !== deseado.paraCosto ||
    amarreActual !== amarreDeseado
  );
}

// ── Sincronización (set-completo) de cada sección, dentro de una transacción ──

/** Reemplaza el set de TELAS del BOM (diff agrega/quita/actualiza). Devuelve true si hubo cambio. */
async function sincronizarTelas(
  tx: Tx,
  sesion: SesionUsuario,
  idModelo: number,
  deseados: TelaBomValidada[],
): Promise<boolean> {
  await exigirTelasValidas(
    tx,
    deseados.map((d) => d.idTela),
  );
  await exigirAmarresTelaValidos(tx, deseados);

  const actuales = await tx.modeloTela.findMany({ where: { idModelo } });
  const actualPorId = new Map(actuales.map((f) => [f.idTela, f]));
  const deseadoPorId = new Map(deseados.map((d) => [d.idTela, d]));

  const aQuitar = [...actualPorId.keys()].filter((id) => !deseadoPorId.has(id));
  const aAgregar = deseados.filter((d) => !actualPorId.has(d.idTela));
  const aActualizar = deseados.filter((d) => {
    const actual = actualPorId.get(d.idTela);
    return (
      actual !== undefined &&
      cambiaRenglonComponente(actual, d, actual.idTelaProveedor, d.idTelaProveedor)
    );
  });

  if (aQuitar.length === 0 && aAgregar.length === 0 && aActualizar.length === 0) {
    return false;
  }

  if (aQuitar.length > 0) {
    await tx.modeloTela.deleteMany({ where: { idModelo, idTela: { in: aQuitar } } });
  }
  if (aAgregar.length > 0) {
    await tx.modeloTela.createMany({
      data: aAgregar.map((d) => ({
        idModelo,
        idTela: d.idTela,
        consumoPorPrenda: d.consumoPorPrenda,
        paraPreCosto: d.paraPreCosto,
        paraProduccion: d.paraProduccion,
        paraCosto: d.paraCosto,
        idTelaProveedor: d.idTelaProveedor,
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      })),
    });
  }
  for (const d of aActualizar) {
    await tx.modeloTela.update({
      where: { idModelo_idTela: { idModelo, idTela: d.idTela } },
      data: {
        consumoPorPrenda: d.consumoPorPrenda,
        paraPreCosto: d.paraPreCosto,
        paraProduccion: d.paraProduccion,
        paraCosto: d.paraCosto,
        idTelaProveedor: d.idTelaProveedor,
        ...datosModificacion(sesion),
      },
    });
  }
  return true;
}

/** Reemplaza el set de AVÍOS del BOM (diff). Devuelve true si hubo cambio. */
async function sincronizarAvios(
  tx: Tx,
  sesion: SesionUsuario,
  idModelo: number,
  deseados: AvioBomValidado[],
): Promise<boolean> {
  await exigirAviosValidos(
    tx,
    deseados.map((d) => d.idAvio),
  );
  await exigirAmarresAvioValidos(tx, deseados);

  const actuales = await tx.modeloAvio.findMany({ where: { idModelo } });
  const actualPorId = new Map(actuales.map((f) => [f.idAvio, f]));
  const deseadoPorId = new Map(deseados.map((d) => [d.idAvio, d]));

  const aQuitar = [...actualPorId.keys()].filter((id) => !deseadoPorId.has(id));
  const aAgregar = deseados.filter((d) => !actualPorId.has(d.idAvio));
  const aActualizar = deseados.filter((d) => {
    const actual = actualPorId.get(d.idAvio);
    return (
      actual !== undefined &&
      cambiaRenglonComponente(actual, d, actual.idAvioProveedor, d.idAvioProveedor)
    );
  });

  if (aQuitar.length === 0 && aAgregar.length === 0 && aActualizar.length === 0) {
    return false;
  }

  if (aQuitar.length > 0) {
    await tx.modeloAvio.deleteMany({ where: { idModelo, idAvio: { in: aQuitar } } });
  }
  if (aAgregar.length > 0) {
    await tx.modeloAvio.createMany({
      data: aAgregar.map((d) => ({
        idModelo,
        idAvio: d.idAvio,
        consumoPorPrenda: d.consumoPorPrenda,
        paraPreCosto: d.paraPreCosto,
        paraProduccion: d.paraProduccion,
        paraCosto: d.paraCosto,
        idAvioProveedor: d.idAvioProveedor,
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      })),
    });
  }
  for (const d of aActualizar) {
    // OJO: aquí NO se toca `consumoPorTalla` ni las filas `ModeloAvioTalla` — el consumo por talla
    // (R18) es un sub-recurso con su propio endpoint (`medidas-avio-talla.ts`) y guardar la receta
    // no debe borrarlo. Solo el renglón que se QUITA del set pierde sus medidas (Cascade).
    await tx.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo, idAvio: d.idAvio } },
      data: {
        consumoPorPrenda: d.consumoPorPrenda,
        paraPreCosto: d.paraPreCosto,
        paraProduccion: d.paraProduccion,
        paraCosto: d.paraCosto,
        idAvioProveedor: d.idAvioProveedor,
        ...datosModificacion(sesion),
      },
    });
  }
  return true;
}

/** Marca la auditoría del modelo (modificadoPorId/En) cuando cambia su BOM. */
async function tocarModelo(tx: Tx, sesion: SesionUsuario, idModelo: number): Promise<void> {
  await tx.modelo.update({ where: { id: idModelo }, data: { ...datosModificacion(sesion) } });
}

// ── Endpoints set-completo (uno por sección) ──────────────────────────────────

/**
 * Reemplaza el set COMPLETO de TELAS del BOM de un modelo en UNA transacción (A2). Reglas:
 * permiso `modelos.administrar`; modelo existente; telas existentes/activas, sin repetir (puede
 * ir vacío). Conserva la auditoría de los renglones sin cambios (diff). Bitácora si hubo cambio.
 * Devuelve el set resultante.
 */
export async function reemplazarTelasBom(
  sesion: SesionUsuario,
  idModelo: number,
  telas: EntradaTelaBom[],
  bd?: ContextoBd,
): Promise<ModeloTelaDetalle[]> {
  verificarPermiso(sesion, 'modelos.administrar');
  const deseados = validarEntrada(esquemaModeloTelas, telas);
  return enTransaccion(async (tx) => {
    await exigirModelo(tx, idModelo);
    const cambio = await sincronizarTelas(tx, sesion, idModelo, deseados);
    if (cambio) {
      await tocarModelo(tx, sesion, idModelo);
      await registrarBitacora(tx, sesion, {
        entidad: 'Modelo',
        idEntidad: idModelo,
        accion: 'MODIFICAR',
        datos: { bom: 'telas', telas: deseados.map((d) => d.idTela) },
      });
    }
    return leerTelasBom(tx, idModelo);
  }, bd);
}

/** Reemplaza el set COMPLETO de AVÍOS del BOM (igual que telas). */
export async function reemplazarAviosBom(
  sesion: SesionUsuario,
  idModelo: number,
  avios: EntradaAvioBom[],
  bd?: ContextoBd,
): Promise<ModeloAvioDetalle[]> {
  verificarPermiso(sesion, 'modelos.administrar');
  const deseados = validarEntrada(esquemaModeloAvios, avios);
  return enTransaccion(async (tx) => {
    await exigirModelo(tx, idModelo);
    const cambio = await sincronizarAvios(tx, sesion, idModelo, deseados);
    if (cambio) {
      await tocarModelo(tx, sesion, idModelo);
      // El BOM de avíos es uno de los REQUISITOS de "orden completa" (Daniel 26-jul-2026): las
      // órdenes de ESTE modelo a las que solo les faltaba la receta se COMPLETAN en la MISMA
      // transacción (A2). Solo COMPLETA: un cambio de catálogo NUNCA degrada órdenes (ver
      // `recalcularEstadoOrdenesDeModelo`).
      await recalcularEstadoOrdenesDeModelo(tx, sesion, idModelo);
      await registrarBitacora(tx, sesion, {
        entidad: 'Modelo',
        idEntidad: idModelo,
        accion: 'MODIFICAR',
        datos: { bom: 'avios', avios: deseados.map((d) => d.idAvio) },
      });
    }
    return leerAviosBom(tx, idModelo);
  }, bd);
}

// ── Lecturas sueltas de cada sección (para los GET) ───────────────────────────

/** Lista las telas del BOM de un modelo. Requiere `modelos.ver`. Exige que el modelo exista. */
export async function listarTelasBom(
  sesion: SesionUsuario,
  idModelo: number,
  bd?: ContextoBd,
): Promise<ModeloTelaDetalle[]> {
  verificarPermiso(sesion, 'modelos.ver');
  const cliente = clienteLectura(bd);
  const existe = await cliente.modelo.findUnique({ where: { id: idModelo }, select: { id: true } });
  if (existe === null) {
    throw new ErrorNoEncontrado('Modelo', idModelo);
  }
  return leerTelasBom(cliente, idModelo);
}

/** Lista los avíos del BOM de un modelo. */
export async function listarAviosBom(
  sesion: SesionUsuario,
  idModelo: number,
  bd?: ContextoBd,
): Promise<ModeloAvioDetalle[]> {
  verificarPermiso(sesion, 'modelos.ver');
  const cliente = clienteLectura(bd);
  const existe = await cliente.modelo.findUnique({ where: { id: idModelo }, select: { id: true } });
  if (existe === null) {
    throw new ErrorNoEncontrado('Modelo', idModelo);
  }
  return leerAviosBom(cliente, idModelo);
}

// ── Copiar BOM de otro modelo (atómico) ───────────────────────────────────────

/**
 * Copia la receta (BOM) de OTRO modelo (`idOrigen`) al modelo `idDestino` en UNA transacción
 * (todo o nada, A2). Reglas: permiso `modelos.administrar`; ambos modelos existen; origen ≠
 * destino. Con `reemplazar=true` (por defecto) se reemplaza el BOM actual del destino con el
 * del origen; con `false` se FUSIONA conservando lo que el destino ya tiene (los componentes
 * del origen que el destino ya tenga NO se pisan). El BOM del origen pudo capturar componentes
 * desactivados desde entonces: se copian igual (es una copia interna, no una alta nueva).
 * Bitácora con el resumen. Devuelve el BOM resultante del destino.
 *
 * ⚠️ Al REEMPLAZAR, el arte del destino **se borra de verdad** (ya no es un puente a un catálogo,
 * V1-E3d): antes de barrerlo se registra ÍNTEGRO en la bitácora —precio, proveedor y foto
 * incluidos— y sus `Archivo` sin dueño se limpian con la misma regla de foto compartida que usa
 * `arte-modelo.ts` (D3: nada se borra en silencio).
 *
 * @example
 * await copiarBom(sesion, idDestino, { idOrigen: idBase, reemplazar: true });
 */
export async function copiarBom(
  sesion: SesionUsuario,
  idDestino: number,
  entrada: EntradaCopiarBom,
  bd?: ContextoBd,
): Promise<BomModelo> {
  verificarPermiso(sesion, 'modelos.administrar');
  const datos = validarEntrada(esquemaModeloCopiarBomCuerpo, entrada);

  if (datos.idOrigen === idDestino) {
    throw new ErrorValidacion('El modelo de origen y el de destino no pueden ser el mismo.');
  }

  return enTransaccion(async (tx) => {
    await exigirModelo(tx, idDestino);
    await exigirModelo(tx, datos.idOrigen);

    const [telasOrigen, aviosOrigen, artesOrigen] = await Promise.all([
      tx.modeloTela.findMany({ where: { idModelo: datos.idOrigen } }),
      tx.modeloAvio.findMany({ where: { idModelo: datos.idOrigen } }),
      // Ordenados como se despliegan: al FUSIONAR se reindexan detrás de lo que ya tiene el
      // destino, así que el orden relativo del origen (su arte principal primero) se respeta.
      tx.modeloArte.findMany({
        where: { idModelo: datos.idOrigen },
        orderBy: [{ orden: 'asc' }, { nombre: 'asc' }, { id: 'asc' }],
      }),
    ]);

    // ⚠️ EL ARTE QUE SE VA AL REEMPLAZAR NO ES UN PUENTE: **ES EL ARTE**. Desde V1-E3d ya no hay
    // catálogo del que recuperar nombre, puntadas, PRECIO (el que entra al costo de la OP,
    // `costos/costo-orden.ts`), proveedor ni foto: si esta transacción lo borra sin dejar rastro,
    // desaparece para siempre. Por eso se LEE ANTES de borrar y cada renglón que se va queda
    // ÍNTEGRO en la bitácora (D3), igual que en `eliminarArte`.
    if (datos.reemplazar) {
      const artesBorradas = await tx.modeloArte.findMany({ where: { idModelo: idDestino } });

      // Reemplaza: borra todo el BOM del destino y vuelca el del origen.
      await tx.modeloTela.deleteMany({ where: { idModelo: idDestino } });
      await tx.modeloAvio.deleteMany({ where: { idModelo: idDestino } });
      await tx.modeloArte.deleteMany({ where: { idModelo: idDestino } });

      if (artesBorradas.length > 0) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Modelo',
          idEntidad: idDestino,
          accion: 'MODIFICAR',
          datos: {
            bom: 'copiar',
            operacion: 'arte-reemplazado',
            idOrigen: datos.idOrigen,
            // El renglón COMPLETO de cada arte que se fue (precio y proveedor incluidos).
            artesQueSeFueron: artesBorradas.map(datosArteParaBitacora),
          },
        });
        // Las FOTOS que quedaron sin dueño se limpian con el MISMO cuidado que en `arte-modelo.ts`:
        // varios artes pueden compartir un `Archivo` (migración + «copiar arte de otro modelo»), así
        // que solo se borra el que ya no referencia NADIE — si no, se dejarían filas `Archivo`
        // huérfanas (y borrar a ciegas dejaría a otro arte sin su imagen). Se deduplica porque dos
        // artes del destino pueden compartir la misma foto.
        for (const idArchivo of new Set(
          artesBorradas.flatMap((a) => (a.idArchivoFoto === null ? [] : [a.idArchivoFoto])),
        )) {
          await borrarArchivoSiQuedoHuerfano(tx, idArchivo);
        }
      }
    }

    // Componentes que el destino YA tiene (para no pisarlos al fusionar / evitar P2002). El arte
    // se identifica por NOMBRE (ya no tiene id de catálogo: es un hijo del modelo, V1-E3d).
    const [telasDestino, aviosDestino, artesDestino] = datos.reemplazar
      ? [new Set<number>(), new Set<number>(), new Set<string>()]
      : await Promise.all([
          tx.modeloTela
            .findMany({ where: { idModelo: idDestino }, select: { idTela: true } })
            .then((f) => new Set(f.map((x) => x.idTela))),
          tx.modeloAvio
            .findMany({ where: { idModelo: idDestino }, select: { idAvio: true } })
            .then((f) => new Set(f.map((x) => x.idAvio))),
          tx.modeloArte
            .findMany({ where: { idModelo: idDestino }, select: { nombre: true } })
            .then((f) => new Set(f.map((x) => x.nombre.toLocaleLowerCase()))),
        ]);

    const telasACrear = telasOrigen.filter((t) => !telasDestino.has(t.idTela));
    const aviosACrear = aviosOrigen.filter((a) => !aviosDestino.has(a.idAvio));
    const artesACrear = artesOrigen.filter((a) => !artesDestino.has(a.nombre.toLocaleLowerCase()));

    if (telasACrear.length > 0) {
      // El AMARRE de precio (R17) viaja con el renglón: copiar una receta y perder el proveedor
      // amarrado dejaría al destino costeando con el precio genérico sin avisar.
      await tx.modeloTela.createMany({
        data: telasACrear.map((t) => ({
          idModelo: idDestino,
          idTela: t.idTela,
          consumoPorPrenda: t.consumoPorPrenda,
          paraPreCosto: t.paraPreCosto,
          paraProduccion: t.paraProduccion,
          paraCosto: t.paraCosto,
          idTelaProveedor: t.idTelaProveedor,
          creadoPorId: sesion.id,
          modificadoPorId: sesion.id,
        })),
      });
    }
    if (aviosACrear.length > 0) {
      await tx.modeloAvio.createMany({
        data: aviosACrear.map((a) => ({
          idModelo: idDestino,
          idAvio: a.idAvio,
          consumoPorPrenda: a.consumoPorPrenda,
          paraPreCosto: a.paraPreCosto,
          paraProduccion: a.paraProduccion,
          paraCosto: a.paraCosto,
          // El toggle R18 y su amarre R17 viajan con el renglón (ver el copiado de medidas abajo).
          consumoPorTalla: a.consumoPorTalla,
          idAvioProveedor: a.idAvioProveedor,
          creadoPorId: sesion.id,
          modificadoPorId: sesion.id,
        })),
      });

      // MEDIDAS POR TALLA (R18) de los avíos copiados: sin esto, copiar la receta traía el toggle
      // "se consume por talla" encendido y la matriz VACÍA — el destino quedaba con un avío que
      // dice costear por talla y no tiene ni una medida (y su amarre medida×talla, perdido).
      const medidasOrigen = await tx.modeloAvioTalla.findMany({
        where: { idModelo: datos.idOrigen, idAvio: { in: aviosACrear.map((a) => a.idAvio) } },
      });
      if (medidasOrigen.length > 0) {
        await tx.modeloAvioTalla.createMany({
          data: medidasOrigen.map((m) => ({
            idModelo: idDestino,
            idAvio: m.idAvio,
            idTalla: m.idTalla,
            consumo: m.consumo,
            idAvioMedida: m.idAvioMedida,
            creadoPorId: sesion.id,
            modificadoPorId: sesion.id,
          })),
        });
      }
    }
    if (artesACrear.length > 0) {
      // Al REEMPLAZAR, el destino quedó vacío: se copia el `orden` del origen tal cual (el arte
      // principal del origen llega como principal del destino). Al FUSIONAR, los copiados se
      // reindexan DETRÁS del arte que el destino ya tenía, para no desbancar a SU principal.
      // La FOTO se comparte con el original (el objeto de R2 no se duplica; ver `arte-modelo.ts`).
      let ordenBase = 0;
      if (!datos.reemplazar) {
        const maximo = await tx.modeloArte.aggregate({
          where: { idModelo: idDestino },
          _max: { orden: true },
        });
        ordenBase = (maximo._max.orden ?? -1) + 1;
      }
      await tx.modeloArte.createMany({
        data: artesACrear.map((a, i) => ({
          idModelo: idDestino,
          nombre: a.nombre,
          descripcion: a.descripcion,
          puntadas: a.puntadas,
          precio: a.precio,
          tipo: a.tipo,
          idProveedor: a.idProveedor,
          idArchivoFoto: a.idArchivoFoto,
          orden: datos.reemplazar ? a.orden : ordenBase + i,
          creadoPorId: sesion.id,
          modificadoPorId: sesion.id,
        })),
      });
    }

    await tocarModelo(tx, sesion, idDestino);
    // Copiar un BOM puede DARLE su receta de avíos al modelo destino: las órdenes suyas a las que
    // solo les faltaba eso se COMPLETAN aquí mismo (A2). Al REEMPLAZAR también puede quitársela,
    // pero eso NO degrada nada: el recálculo por catálogo solo asciende.
    await recalcularEstadoOrdenesDeModelo(tx, sesion, idDestino);
    await registrarBitacora(tx, sesion, {
      entidad: 'Modelo',
      idEntidad: idDestino,
      accion: 'MODIFICAR',
      datos: {
        bom: 'copiar',
        idOrigen: datos.idOrigen,
        reemplazar: datos.reemplazar,
        telas: telasACrear.length,
        avios: aviosACrear.length,
        artes: artesACrear.length,
      },
    });

    return leerBom(tx, idDestino);
  }, bd);
}
