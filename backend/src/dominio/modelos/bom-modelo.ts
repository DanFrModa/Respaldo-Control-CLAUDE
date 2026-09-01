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
import { redondear2 } from '../costos/decimales.js';
import {
  resolverPrecioAvioCatalogo,
  resolverPrecioTela,
  type CompraRealPrecio,
  type OrigenPrecioAvioCatalogo,
  type OrigenPrecioTela,
} from '../costos/resolucion-precios.js';
import {
  claveMaterial,
  claveMaterialProveedor,
  leerUltimosPreciosCompra,
  type UltimosPreciosCompra,
} from '../costos/ultimo-precio-compra.js';
import { ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { exigirRecetaPropia, resolverIdRecetaDeModelo } from './receta-compartida.js';
import { tocarModeloPorCambioDeReceta } from './revision-modelo.js';
import { validarEntrada } from '../../comun/validacion.js';
import { eliminarObjetosBestEffort, type ServicioArchivos } from '../../comun/archivos.js';

import {
  borrarArchivoSiQuedoHuerfano,
  datosArteParaBitacora,
  leerArtesModelo,
  type ModeloArteDetalle,
} from './arte-modelo.js';
import { avisosDeCurvaDelModelo } from './curva-desde-ordenes.js';
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
    case 'ultimo-precio-compra':
      return 'ultimo-precio-compra';
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

/**
 * Traduce una entrada del mapa de últimas compras a la forma MÍNIMA que pide la cascada
 * (`CompraRealPrecio`). `undefined` ⇒ ese material/proveedor nunca se ha comprado.
 */
function aCompraReal(
  ultimos: UltimosPreciosCompra,
  clave: string,
  porProveedor = false,
): CompraRealPrecio | null {
  const mapa = porProveedor ? ultimos.porMaterialProveedor : ultimos.porMaterial;
  const u = mapa.get(clave);
  return u === undefined ? null : { precio: u.precio, idProveedor: u.idProveedor };
}

/**
 * ⚠️ ¿El renglón tiene AMARRE pero el precio que costea **no lo firmó el proveedor amarrado**?
 *
 * Es la alerta «tu amarre no se está usando», y desde V1-E3e la decide el SERVIDOR: la UI no puede
 * deducirla del origen. Antes bastaba con `origenPrecio !== 'amarre'`, pero ahora el escalón normal
 * de un renglón amarrado es `ultimo-precio-compra` —la última compra A ESE proveedor—, que NO es un
 * amarre ignorado... salvo cuando la compra fue a OTRO. Ese caso es alcanzable y silencioso:
 * Desarrollo amarra a un proveedor para fijar la relación negociada pero deja `TelaProveedor.precio`
 * en blanco (la columna es nullable), a ese proveedor nunca se le compró, y la cascada cae al
 * escalón general y costea con el precio de un tercero. La cifra es correcta; lo que faltaba era
 * decir que el amarre no manda.
 *
 * Se compara por **id de proveedor**, nunca por nombre (dos proveedores pueden llamarse parecido y
 * el nombre es un dato de presentación).
 */
function amarreNoFirmaElPrecio(
  idProveedorAmarrado: number | null,
  resuelto: { origen: OrigenPrecioTela | OrigenPrecioAvioCatalogo; idProveedor: number | null },
): boolean {
  if (idProveedorAmarrado === null) {
    return false; // sin amarre no hay nada que ignorar
  }
  switch (resuelto.origen) {
    case 'amarre':
    case 'amarre-color':
      return false; // el precio ES el del amarrado
    case 'ultimo-precio-compra':
      // El caso normal desde §Post-F9.48: la compra es DEL amarrado. Si fue a otro, sí se ignoró.
      return resuelto.idProveedor !== idProveedorAmarrado;
    default:
      // más barato / referencia / sugerido / color-referencia / promedio-medidas / sin-precio:
      // ninguno salió del proveedor amarrado.
      return true;
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
  /**
   * ⚠️ Hay AMARRE pero el precio que costea **no lo firmó el proveedor amarrado**. Lo decide el
   * SERVIDOR comparando ids (nunca nombres): ver {@link amarreNoFirmaElPrecio}.
   */
  amarreIgnorado: boolean;
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
  /** ⚠️ Hay AMARRE pero el precio que costea no lo firmó el amarrado ({@link amarreNoFirmaElPrecio}). */
  amarreIgnorado: boolean;
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
 * el PRECIO QUE VA A COSTEAR con la MISMA cascada del motor (`resolverPrecioTela`), diciendo de qué
 * escalón salió. La receta no puede enseñar un número distinto del que costea (regla de Daniel,
 * §Post-F9.47), y por eso NO se calcula aquí a mano: se llama al mismo resolvedor.
 *
 * Desde V1-E3e (§Post-F9.48) la cascada arranca con la **última COMPRA REAL** de la tela, así que
 * hace falta la EMPRESA ACTIVA (A9: las OC de otra empresa no cuentan). El histórico se lee POR
 * LOTE —una sola consulta para todas las telas del BOM, no una por renglón— con
 * `leerUltimosPreciosCompra`.
 */
export async function leerTelasBom(
  tx: Tx,
  idModelo: number,
  idEmpresa: number,
): Promise<ModeloTelaDetalle[]> {
  // ⭐ V1-E9b — LA RECETA COMPARTIDA: un modelo de producción derivado lee las telas de su modelo
  // de DESARROLLO. Se resuelve AQUÍ DENTRO, no en cada llamador: ésta es una de las tres lecturas
  // canónicas y por ella entra todo el sistema (ficha, precosto de la orden, MRP). Resolver es
  // idempotente (no hay cadenas), así que no importa si quien llama ya resolvió.
  const idReceta = await resolverIdRecetaDeModelo(tx, idModelo);
  const filas = await tx.modeloTela.findMany({
    where: { idModelo: idReceta },
    select: {
      idTela: true,
      consumoPorPrenda: true,
      paraPreCosto: true,
      paraProduccion: true,
      paraCosto: true,
      idTelaProveedor: true,
      telaProveedor: {
        select: {
          idProveedor: true,
          precio: true,
          manejaPrecioPorColor: true,
          proveedor: { select: { nombre: true } },
        },
      },
      tela: { select: { nombre: true, precioSugerido: true } },
    },
    orderBy: { tela: { nombre: 'asc' } },
  });

  const ultimos = await leerUltimosPreciosCompra(tx, idEmpresa, {
    telas: filas.map((f) => f.idTela),
  });

  return filas.map((f) => {
    const precioSugerido = f.tela.precioSugerido === null ? null : f.tela.precioSugerido.toNumber();
    const proveedorAmarrado = f.telaProveedor?.proveedor.nombre ?? null;
    const claveGlobal = claveMaterial('tela', f.idTela);
    const claveAmarrado =
      f.telaProveedor == null
        ? null
        : claveMaterialProveedor('tela', f.idTela, f.telaProveedor.idProveedor);
    const resuelto = resolverPrecioTela({
      precioSugerido,
      amarre:
        f.telaProveedor === null || f.telaProveedor === undefined
          ? null
          : {
              precio: f.telaProveedor.precio === null ? null : f.telaProveedor.precio.toNumber(),
              manejaPrecioPorColor: f.telaProveedor.manejaPrecioPorColor,
            },
      ultimaCompra: aCompraReal(ultimos, claveGlobal),
      ultimaCompraProveedorAmarrado:
        claveAmarrado === null ? null : aCompraReal(ultimos, claveAmarrado, true),
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
      // Con `ultimo-precio-compra` firma QUIEN VENDIÓ (que con amarre es el amarrado, y sin
      // amarre puede ser cualquiera: por eso se saca del mapa y no se asume).
      proveedorPrecio:
        resuelto.origen === 'ultimo-precio-compra'
          ? (ultimos.porMaterialProveedor.get(
              claveMaterialProveedor('tela', f.idTela, resuelto.idProveedor ?? -1),
            )?.proveedor ?? null)
          : resuelto.origen === 'amarre' || resuelto.origen === 'amarre-color'
            ? proveedorAmarrado
            : null,
      amarreIgnorado: amarreNoFirmaElPrecio(f.telaProveedor?.idProveedor ?? null, resuelto),
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
export async function leerAviosBom(
  tx: Tx,
  idModelo: number,
  idEmpresa: number,
): Promise<ModeloAvioDetalle[]> {
  // ⭐ V1-E9b — LA RECETA COMPARTIDA (ver {@link leerTelasBom}): los avíos salen del modelo de
  // desarrollo cuando éste es uno de sus hijos de producción.
  const idReceta = await resolverIdRecetaDeModelo(tx, idModelo);
  const filas = await tx.modeloAvio.findMany({
    where: { idModelo: idReceta },
    select: {
      idAvio: true,
      consumoPorPrenda: true,
      paraPreCosto: true,
      paraProduccion: true,
      paraCosto: true,
      consumoPorTalla: true,
      idAvioProveedor: true,
      avio: {
        select: { clave: true, descripcion: true, precioReferencia: true },
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

  // V1-E3e (§Post-F9.48): el escalón 1 de la cascada es la última COMPRA REAL. Se lee POR LOTE
  // (una consulta para TODOS los avíos del BOM) y acotado a la empresa activa (A9).
  const ultimos = await leerUltimosPreciosCompra(tx, idEmpresa, { avios: idsAvio });

  return filas.map((f) => {
    const delAvio = proveedoresPorAvio.get(f.idAvio) ?? [];
    const nombrePorProveedor = new Map(delAvio.map((p) => [p.idProveedor, p.proveedor.nombre]));
    // MISMA función que el precosto (`resolverPrecioAvioCatalogo`), no una copia: promedio de
    // medidas → amarre → más barato → referencia. Los precios ya están en unidad de consumo
    // (§Post-F9.97), así que no hay conversión que aplicar ni factor corrupto que sanear.
    const resuelto = resolverPrecioAvioCatalogo({
      precioReferencia:
        f.avio.precioReferencia === null ? null : f.avio.precioReferencia.toNumber(),
      idAvioProveedor: f.idAvioProveedor,
      medidas: medidasPorAvio.get(f.idAvio) ?? [],
      ultimaCompra: aCompraReal(ultimos, claveMaterial('avio', f.idAvio)),
      ultimaCompraProveedorAmarrado:
        f.idAvioProveedor === null
          ? null
          : aCompraReal(ultimos, claveMaterialProveedor('avio', f.idAvio, f.idAvioProveedor), true),
      proveedores: delAvio.map((p) => ({
        idProveedor: p.idProveedor,
        precio: p.precio === null ? null : p.precio.toNumber(),
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
      // El proveedor que FIRMA el precio. Con `ultimo-precio-compra` puede ser uno que ni siquiera
      // está capturado como `AvioProveedor` (se le compró sin darlo de alta en el catálogo del
      // avío): por eso el nombre se toma del histórico de compras antes que del catálogo.
      proveedorPrecio:
        resuelto.idProveedor === null
          ? null
          : (nombrePorProveedor.get(resuelto.idProveedor) ??
            ultimos.porMaterialProveedor.get(
              claveMaterialProveedor('avio', f.idAvio, resuelto.idProveedor),
            )?.proveedor ??
            null),
      amarreIgnorado: amarreNoFirmaElPrecio(f.idAvioProveedor, resuelto),
      precioReferencia:
        f.avio.precioReferencia === null ? null : f.avio.precioReferencia.toNumber(),
    };
  });
}

/** Una medida por talla del BOM, tal como la copia quien la lee (R18). */
export interface ModeloAvioTallaBom {
  idAvio: number;
  idTalla: number;
  consumo: Prisma.Decimal;
  idAvioMedida: number | null;
}

/**
 * ⭐⭐ V1-E9b — **LA CUARTA LECTURA CANÓNICA**: las MEDIDAS POR TALLA del BOM (R18,
 * `ModeloAvioTalla`), con la receta compartida ya resuelta.
 *
 * ### Por qué existe, que es lo importante
 *
 * De las CINCO tablas de la receta, `ModeloAvioTalla` era **la única sin lectura canónica**. Las
 * otras cuatro viven bajo el paraguas del embudo —`leerTelasBom`, `leerAviosBom` y
 * `leerArtesModelo` resuelven POR DENTRO—, así que quien las llama puede pasarles el id del hijo o
 * el del padre y **da lo mismo**: la resolución no se puede perder porque no está en el llamador.
 *
 * Las medidas no tenían ese paraguas, y el precio se pagaba en duplicación: su resolución vivía
 * **repetida en cuatro sitios** de `produccion/receta-orden.ts` (la copia al crear la orden,
 * agregar un renglón, restaurarlo y «traer del modelo») y **sólo uno de los cuatro tenía prueba**.
 * El reviewer de la etapa lo demostró revirtiendo uno a mano: la suite entera —2,345 pruebas—
 * **siguió en verde**. Y el guardián de lecturas tampoco lo veía, porque trabaja por ARCHIVO y ese
 * archivo ya importaba el resolver.
 *
 * 🔴 **Lo que esa mutación superviviente significaba en el negocio:** en la orden de un modelo hijo,
 * darle a «traer del modelo» metía el avío **sin sus medidas por talla**. No truena ni avisa:
 * **cambia el requerido del MRP** y se compra otra cantidad.
 *
 * ⇒ Con esta función las cuatro duplicaciones se vuelven UNA, y la resolución deja de ser algo que
 * un llamador pueda olvidar. `receta-compartida-guardian.test.ts` vigila que nadie vuelva a leer la
 * tabla directo desde producción.
 *
 * `idAvio` acota a un solo renglón (lo que piden tres de los cuatro sitios); sin él trae las
 * medidas de TODO el BOM (lo que pide la copia al crear la orden).
 */
export async function leerMedidasAvioBom(
  tx: Tx,
  idModelo: number,
  idAvio?: number,
): Promise<ModeloAvioTallaBom[]> {
  // Mismo embudo que las otras tres canónicas: se resuelve AQUÍ DENTRO, nunca en el llamador.
  const idReceta = await resolverIdRecetaDeModelo(tx, idModelo);
  return tx.modeloAvioTalla.findMany({
    where: { idModelo: idReceta, ...(idAvio === undefined ? {} : { idAvio }) },
    select: { idAvio: true, idTalla: true, consumo: true, idAvioMedida: true },
  });
}

/**
 * Lee el BOM completo (telas + avíos + arte) de un modelo. Reusado por la ficha y por el impreso de
 * la orden. `idEmpresa` es la empresa ACTIVA (A9): desde V1-E3e el precio que costea sale de la
 * última compra REAL, y las OC de otra empresa no cuentan.
 */
export async function leerBom(tx: Tx, idModelo: number, idEmpresa: number): Promise<BomModelo> {
  const [telas, avios, artes] = await Promise.all([
    leerTelasBom(tx, idModelo, idEmpresa),
    leerAviosBom(tx, idModelo, idEmpresa),
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
    /**
     * ⭐ V1-E3r (§Post-F9.81): avisos —YA REDACTADOS por el servidor— de que la curva del modelo no
     * coincide con las tallas que piden sus órdenes. Uno por cada conjunto distinto. NUNCA bloquean.
     */
    avisosCurva: string[];
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
  const [bom, tallasCurva, avisosCurva] = await Promise.all([
    leerBom(cliente, idModelo, sesion.idEmpresaActiva),
    leerTallasCurvaModelo(cliente, idModelo),
    // ⭐ V1-E3r: `idEmpresaActiva` NO es opcional aquí (A9) — cuenta ÓRDENES, y las órdenes son por
    // empresa aunque el catálogo de tallas sea global (ADR-0007).
    avisosDeCurvaDelModelo(cliente, idModelo, sesion.idEmpresaActiva),
  ]);
  return { ...modelo, ...bom, tallasCurva, avisosCurva };
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
    // ⭐ V1-E9b pieza B — la receta de un HIJO del linaje 1:N no se edita desde el hijo: guardar
    // aquí reescribiría la del desarrollo y la de sus hermanos de color, en silencio.
    await exigirRecetaPropia(tx, idModelo);
    const cambio = await sincronizarTelas(tx, sesion, idModelo, deseados);
    if (cambio) {
      await tocarModeloPorCambioDeReceta(tx, sesion, idModelo, 'telas');
      await registrarBitacora(tx, sesion, {
        entidad: 'Modelo',
        idEntidad: idModelo,
        accion: 'MODIFICAR',
        datos: { bom: 'telas', telas: deseados.map((d) => d.idTela) },
      });
    }
    return leerTelasBom(tx, idModelo, sesion.idEmpresaActiva);
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
    // ⭐ V1-E9b pieza B — misma razón que en las telas: la receta del hijo es de solo lectura.
    await exigirRecetaPropia(tx, idModelo);
    const cambio = await sincronizarAvios(tx, sesion, idModelo, deseados);
    if (cambio) {
      await tocarModeloPorCambioDeReceta(tx, sesion, idModelo, 'avios');
      // ⭐ V1-E3d (§Post-F9.43): AQUÍ YA NO SE TOCAN LAS ÓRDENES. Antes, editar el BOM del modelo
      // recalculaba el estado de sus órdenes (`recalcularEstadoOrdenesDeModelo`) — el "alcance
      // hacia atrás" que la etapa vino a cortar: cada orden tiene su receta CONGELADA, así que
      // cambiar la plantilla no puede mover a ninguna. Si alguien quiere bajar el cambio a una
      // orden, lo hace a mano desde su receta ("restaurar renglón").
      await registrarBitacora(tx, sesion, {
        entidad: 'Modelo',
        idEntidad: idModelo,
        accion: 'MODIFICAR',
        datos: { bom: 'avios', avios: deseados.map((d) => d.idAvio) },
      });
    }
    return leerAviosBom(tx, idModelo, sesion.idEmpresaActiva);
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
  return leerTelasBom(cliente, idModelo, sesion.idEmpresaActiva);
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
  return leerAviosBom(cliente, idModelo, sesion.idEmpresaActiva);
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
 * ---
 * ## ⭐ V1-E9b pieza B — LOS DOS LADOS DE LA RECETA COMPARTIDA, Y SE TRATAN DISTINTO
 *
 * **El DESTINO se BLOQUEA** ({@link exigirRecetaPropia}). Copiar sobre un hijo del linaje 1:N
 * reescribiría la receta del desarrollo y la de sus hermanos de color — y con `reemplazar: true`,
 * que es el DEFAULT (`CopiarBomDialogo.tsx`), primero la BORRA. El arte se borra **de verdad** (ver
 * el aviso de arriba) y sólo sobrevive en la bitácora. Ése era el defecto silencioso y destructivo
 * que esta pieza vino a cerrar: la operación “salía bien”, sin error y sin aviso.
 *
 * **El ORIGEN se RESUELVE.** Leerlo es una LECTURA como cualquier otra: copiar DESDE un hijo tiene
 * que traer la receta que ese hijo enseña —la de su padre— y no una lista vacía. Las cuatro
 * consultas de abajo (telas, avíos, arte y las medidas por talla) usan `idRecetaOrigen`, nunca
 * `datos.idOrigen` en crudo.
 *
 * **Y la guarda origen≠destino se compara YA RESUELTA.** Copiar del padre a un hijo (o de un hijo a
 * su padre) no es el mismo id **pero es la misma receta**: sin resolver los dos lados, la copia
 * borraría la receta y la volvería a poner sobre sí misma. Comparar los ids crudos no lo ve.
 *
 * **Al REEMPLAZAR se borran los artes del destino**, y las fotos que quedan sin dueño se borran
 * también de R2 (objeto físico incluido), TRAS el commit y en modo BEST-EFFORT (0.081a). Las fotos
 * que OTRO arte siga compartiendo no se tocan.
 * ⚠️ Llamar SIEMPRE a NIVEL SUPERIOR (sin pasar un `bd.tx` ya abierto) — ver
 * {@link eliminarObjetosBestEffort}.
 *
 * @example
 * await copiarBom(sesion, idDestino, { idOrigen: idBase, reemplazar: true });
 */
export async function copiarBom(
  sesion: SesionUsuario,
  idDestino: number,
  entrada: EntradaCopiarBom,
  bd?: ContextoBd,
  archivos?: ServicioArchivos,
): Promise<BomModelo> {
  verificarPermiso(sesion, 'modelos.administrar');
  const datos = validarEntrada(esquemaModeloCopiarBomCuerpo, entrada);

  // El choque LITERAL se ataja antes de abrir la transacción: es el error común (elegirse a uno
  // mismo en el selector) y no necesita la base. El choque por receta COMPARTIDA —que sí la
  // necesita— se comprueba adentro, con su propio mensaje.
  if (datos.idOrigen === idDestino) {
    throw new ErrorValidacion('El modelo de origen y el de destino no pueden ser el mismo.');
  }

  // Keys de R2 de las fotos de arte que el REEMPLAZO dejó sin dueño y la tx llegó a borrar. Se
  // acumulan dentro de la transacción y se consumen DESPUÉS del commit (0.081a): si la tx revienta,
  // la excepción se lleva por delante el borrado físico y no se toca un solo objeto del bucket.
  const keysR2: string[] = [];

  const bom = await enTransaccion(async (tx) => {
    await exigirModelo(tx, idDestino);
    await exigirModelo(tx, datos.idOrigen);
    // ⭐ V1-E9b pieza B — el DESTINO no puede ser un hijo del linaje 1:N (ver la nota de arriba).
    await exigirRecetaPropia(tx, idDestino);

    // Los DOS lados resueltos, no uno: la guarda de abajo compara RECETAS, no modelos, y el
    // origen se lee de quien de verdad tiene las filas. Se resuelven los dos aunque el destino
    // acabe de pasar por `exigirRecetaPropia`, para que la comparación no dependa de esa guarda.
    const [idRecetaOrigen, idRecetaDestino] = await Promise.all([
      resolverIdRecetaDeModelo(tx, datos.idOrigen),
      resolverIdRecetaDeModelo(tx, idDestino),
    ]);
    if (idRecetaOrigen === idRecetaDestino) {
      throw new ErrorValidacion(
        'Esos dos modelos COMPARTEN la misma receta (uno nació del otro), así que copiarla sería ' +
          'copiarla sobre sí misma. Elige un modelo de origen de otro desarrollo.',
      );
    }

    const [telasOrigen, aviosOrigen, artesOrigen] = await Promise.all([
      tx.modeloTela.findMany({ where: { idModelo: idRecetaOrigen } }),
      tx.modeloAvio.findMany({ where: { idModelo: idRecetaOrigen } }),
      // Ordenados como se despliegan: al FUSIONAR se reindexan detrás de lo que ya tiene el
      // destino, así que el orden relativo del origen (su arte principal primero) se respeta.
      tx.modeloArte.findMany({
        where: { idModelo: idRecetaOrigen },
        orderBy: [{ orden: 'asc' }, { id: 'asc' }],
        include: { fotos: { select: { idArchivo: true, orden: true }, orderBy: { orden: 'asc' } } },
      }),
    ]);

    // ⚠️ EL ARTE QUE SE VA AL REEMPLAZAR NO ES UN PUENTE: **ES EL ARTE**. Desde V1-E3d ya no hay
    // catálogo del que recuperar nombre, puntadas, PRECIO (el que entra al costo de la OP,
    // `costos/costo-orden.ts`), proveedor ni foto: si esta transacción lo borra sin dejar rastro,
    // desaparece para siempre. Por eso se LEE ANTES de borrar y cada renglón que se va queda
    // ÍNTEGRO en la bitácora (D3), igual que en `eliminarArte`.
    if (datos.reemplazar) {
      const artesBorradas = await tx.modeloArte.findMany({
        where: { idModelo: idDestino },
        include: { fotos: { select: { idArchivo: true } } },
      });

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
          artesBorradas.flatMap((a) => a.fotos.map((f) => f.idArchivo)),
        )) {
          const key = await borrarArchivoSiQuedoHuerfano(tx, idArchivo);
          if (key !== null) {
            keysR2.push(key);
          }
        }
      }
    }

    // Componentes que el destino YA tiene (para no pisarlos al fusionar). ⚠️ El arte se compara
    // por su DESCRIPCIÓN normalizada: desde V1-E3f no tiene nombre ni ninguna clave de negocio
    // (§Post-F9.52 punto 1), así que esto ya no es una unicidad —la base la perdió a propósito—
    // sino la heurística de "no traer dos veces lo mismo" al fusionar. Un falso positivo (dos
    // artes distintos descritos igual) hace que uno no se copie; el usuario lo ve y lo agrega.
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
            .findMany({ where: { idModelo: idDestino }, select: { descripcion: true } })
            .then((f) => new Set(f.map((x) => x.descripcion.trim().toLocaleLowerCase()))),
        ]);

    const telasACrear = telasOrigen.filter((t) => !telasDestino.has(t.idTela));
    const aviosACrear = aviosOrigen.filter((a) => !aviosDestino.has(a.idAvio));
    const artesACrear = artesOrigen.filter(
      (a) => !artesDestino.has(a.descripcion.trim().toLocaleLowerCase()),
    );

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
        where: { idModelo: idRecetaOrigen, idAvio: { in: aviosACrear.map((a) => a.idAvio) } },
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
      // Las FOTOS se comparten con el original (el objeto de R2 no se duplica; ver
      // `arte-modelo.ts`). Como son PLURALES desde V1-E3f, cada arte se crea con su set anidado y
      // no con un `createMany` (que no admite relaciones); el arte por modelo es un puñado.
      let ordenBase = 0;
      if (!datos.reemplazar) {
        const maximo = await tx.modeloArte.aggregate({
          where: { idModelo: idDestino },
          _max: { orden: true },
        });
        ordenBase = (maximo._max.orden ?? -1) + 1;
      }
      for (const [i, a] of artesACrear.entries()) {
        await tx.modeloArte.create({
          data: {
            idModelo: idDestino,
            descripcion: a.descripcion,
            posicion: a.posicion,
            puntadas: a.puntadas,
            precio: a.precio,
            idTipoArte: a.idTipoArte,
            idProveedor: a.idProveedor,
            orden: datos.reemplazar ? a.orden : ordenBase + i,
            fotos: {
              create: a.fotos.map((f) => ({
                idArchivo: f.idArchivo,
                orden: f.orden,
                creadoPorId: sesion.id,
              })),
            },
            creadoPorId: sesion.id,
            modificadoPorId: sesion.id,
          },
        });
      }
    }

    await tocarModeloPorCambioDeReceta(tx, sesion, idDestino, 'copia-de-otro-modelo');
    // V1-E3d: copiar un BOM ya no alcanza a las órdenes del modelo destino (su receta está
    // congelada). Ver la nota de `reemplazarAviosBom`.
    await registrarBitacora(tx, sesion, {
      entidad: 'Modelo',
      idEntidad: idDestino,
      accion: 'MODIFICAR',
      datos: {
        bom: 'copiar',
        idOrigen: datos.idOrigen,
        // Si el origen era un HIJO del linaje 1:N, la receta salió de OTRO modelo (su desarrollo):
        // el rastro tiene que decir de dónde vinieron de verdad las filas (A7/D3).
        ...(idRecetaOrigen === datos.idOrigen ? {} : { idModeloDeLaRecetaOrigen: idRecetaOrigen }),
        reemplazar: datos.reemplazar,
        telas: telasACrear.length,
        avios: aviosACrear.length,
        artes: artesACrear.length,
      },
    });

    return leerBom(tx, idDestino, sesion.idEmpresaActiva);
  }, bd);

  await eliminarObjetosBestEffort(
    archivos,
    keysR2,
    `las fotos de arte que reemplazó la copia de receta al modelo ${String(idDestino)}`,
  );

  return bom;
}
