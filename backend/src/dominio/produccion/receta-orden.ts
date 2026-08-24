/**
 * RECETA CONGELADA DE LA ORDEN DE PRODUCCIÓN (V1-E3d pieza B, §Post-F9.43). Toda la lógica vive
 * AQUÍ (A1); las rutas REST solo validan permiso + Zod y delegan.
 *
 * Daniel (14-ago-2026): *"Un modelo se desarrolla a partir de cierta información. Y en ocasiones se
 * negocia con el cliente que ya no lleve alguna cosa (por ejemplo, quitarle una jareta para abaratar
 * el costo)… **El BOM debe de vivir en la OP**. De hecho así funciona en Control viejo."*
 *
 * EL HUECO QUE TAPA. Hasta aquí, los cuatro consumidores de la receta —MRP, habilitación, costeo y
 * el semáforo de "orden completa"— leían el BOM del **modelo, en vivo**. Como las banderas son del
 * MODELO, apagar la jareta de un cliente la apagaba en TODAS las órdenes de ese modelo, incluidas
 * las ya producidas CON jareta (y el código ya alcanzaba hacia atrás con
 * `recalcularEstadoOrdenesDeModelo`). Con un solo interruptor por modelo no se podían tener dos
 * clientes del mismo modelo, uno con jareta y otro sin.
 *
 * LAS SEIS REGLAS DE ESTE MÓDULO
 *
 *  1. **La receta se copia al CREAR la orden** ({@link copiarRecetaDelModelo}) — elección de Daniel
 *     sobre "al explotar el MRP": así se revisa y ajusta ANTES de comprar nada. Se copian telas,
 *     avíos (con sus medidas por talla, R18) y artes, con **cantidad y PRECIO**.
 *  2. **El PRECIO que se congela es el que la receta del modelo COSTEA**, resuelto con la cascada
 *     única de §Post-F9.48 (`leerTelasBom`/`leerAviosBom`, la misma que ve Desarrollo en la ficha
 *     del modelo). No se re-implementa la cascada aquí: se llama a la misma función. Es el "precio
 *     del día" del viejo (15,255 de 24,480 renglones de `OrdenesHab` traen precio distinto al del
 *     catálogo, sistemáticamente: la OP guardaba lo que costaba ESE día).
 *  3. **Las TRES banderas viajan** (`paraPreCosto`/`paraProduccion`/`paraCosto`). No se colapsan a
 *     una lista plana: cada consumidor conserva EXACTAMENTE el filtro que ya usaba, solo que ahora
 *     sobre la receta de la orden → cero regresión de alcance. Lo que cambia por cliente deja de ser
 *     bandera del modelo y pasa a ser un ajuste de ESTA orden.
 *  4. **Quitar un renglón que vino del modelo NO lo borra: lo EXCLUYE** ({@link quitarRenglonReceta}).
 *     Sin esa lápida, el comparador no podría distinguir *"le quité la jareta a ESTA orden"* —el caso
 *     de negocio— de *"el modelo agregó una jareta"*, y el aviso gritaría justo en el caso que la
 *     etapa vino a habilitar. Un renglón AGREGADO A MANO sí se borra de verdad, dejando su copia
 *     ÍNTEGRA en la bitácora (D3: nada desaparece en silencio).
 *  5. **La DESALINEACIÓN se calcula AL VUELO** ({@link calcularDesalineacion}) — sin evento, sin
 *     outbox y sin estado acumulado (§Post-F9.43(d): *"no tiene caso ahorita hacer nada de eso"*).
 *     La receta está congelada y el BOM está vivo, así que la diferencia sale de compararlos cuando
 *     alguien abre la pantalla. **Un renglón `ajustado`, `agregadoAMano` o `excluido` NO genera
 *     aviso**: esa diferencia la puso una persona a propósito. Ésa es la regla que hace que el caso
 *     de la jareta sea silencioso y el cambio del modelo, ruidoso.
 *  6. **Desarrollo LIBERA, y la puerta va antes de COMPRAR** ({@link liberarReceta},
 *     {@link exigirRecetaLiberada}). Sin liberar no se explota el MRP ni se generan OC. **Cortar y
 *     producir NO se bloquean**: el piso no se detiene porque Desarrollo no haya terminado de
 *     revisar; lo único que se frena es gastar dinero contra una receta que nadie miró.
 *
 * ⚠️ **NO se fuerza el OK uno por uno.** El 89 % de las órdenes lleva la receta del modelo tal cual;
 * obligar a 8 clics por OP entrena a la gente a clickear sin leer, y ahí se pierde el control con la
 * ilusión de tenerlo. Por eso hay UN botón ({@link marcarRecetaRevisada}) y el renglón desviado se
 * pinta distinto.
 *
 * ⭐ **El PRECIO congelado NO gobierna la OC.** La orden de compra sigue naciendo con el precio de la
 * última compra real al proveedor al que se le compra (§Post-F9.48/V1-E3e, decidido por Daniel el
 * 15-ago). La receta de la OP aporta al MRP **qué**, **cuánto** y **a quién** (el amarre); el precio
 * congelado es el que COSTEA la orden y el que vigila el aviso de desalineación. Las dos decisiones
 * conviven porque hablan de momentos distintos: congelar es del día que nació la orden, comprar es
 * del día que se compra.
 *
 * Innegociables: A1 (la lógica aquí), A2 (toda mutación en transacción), A4 (`ordenes.ver` para
 * leer, `desarrollo.administrar` —permiso REUSADO, cero permisos nuevos— para tocar y liberar),
 * A7 (bitácora en cada mutación), A9 (la orden se sella por la empresa activa), D3 (nada se borra
 * en silencio: lo que desaparece queda ÍNTEGRO en la bitácora).
 */
import type {
  CambioReceta,
  ChoqueTraerDelModelo,
  DatosLiberarReceta,
  DatosRecetaAgregar,
  DatosTraerDelModelo,
  TraerDelModeloResultado,
  DatosRecetaEditar,
  DatosRecetaQuitar,
  DesalineacionReceta,
  RecetaOrden,
  RecetaOrdenArte,
  RecetaOrdenAvio,
  RecetaOrdenAvioTalla,
  RecetaOrdenTela,
  ResumenReceta,
  TipoRenglonRecetaClave,
} from '../../contrato/index.js';
import {
  esquemaLiberarRecetaCuerpo,
  esquemaRecetaAgregarCuerpo,
  esquemaRecetaEditarCuerpo,
  esquemaRecetaQuitarCuerpo,
  esquemaTraerDelModeloCuerpo,
} from '../../contrato/index.js';
import { EstadoRenglonReceta, Prisma } from '../../datos/index.js';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import {
  avisoCurvaDistinta,
  curvaQueCubreExactamente,
  curvasDifieren,
  ladoDeUnaOrden,
  ladoDelModelo,
  nombreDeterministaCurva,
} from '../catalogos/curvas-de-la-orden.js';
import {
  avisoAvioPorMedidaConCantidadesPorTalla,
  avisoValorFueraDeRango,
} from '../catalogos/unidades-avio.js';
import { leerArtesModelo } from '../modelos/arte-modelo.js';
import { leerAviosBom, leerTelasBom } from '../modelos/bom-modelo.js';
// ⭐ V1-E4c: la lista de estatus que ya COMPROMETIERON la compra vive en `compras/comprometido-en-oc.ts`,
// junto a la otra lista de estatus de OC. La guarda de §Post-F9.79 (no sacar de la receta lo ya
// comprado) y la de V1-E4c (no cambiarle el color a una tela ya comprada) leen la MISMA: dos copias
// de "qué es estar comprometido" se desincronizan en la primera corrección.
import { algunaRecibida, ESTATUS_OC_COMPROMETIDA } from '../compras/comprometido-en-oc.js';
import { requeridoAvioReceta, requeridoContradictorioPorMedida } from './receta-avios.js';
import { recalcularEstadoOrden } from './requisitos-orden.js';
import { num, redondear2 } from '../costos/decimales.js';

/** Tolerancia al comparar cantidades/precios decimales (misma que el MRP y la habilitación). */
const TOLERANCIA = 1e-6;

/** ¿Dos números (o nulos) son distintos más allá del ruido de redondeo? */
function difieren(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;
  return Math.abs(a - b) > TOLERANCIA;
}

/** Un decimal de Prisma a número, o null. */
function dec(valor: Prisma.Decimal | null): number | null {
  return valor === null ? null : valor.toNumber();
}

// ── La orden, para las operaciones de receta ───────────────────────────────────────────────

/** Lo mínimo de la orden que este módulo necesita para operar. */
interface OrdenParaReceta {
  id: number;
  folio: bigint;
  idEmpresa: number;
  idModelo: number;
  estado: 'capturada' | 'completa' | 'cancelada';
  /** Sello histórico de "cuándo quedó lista por primera vez" (lo necesita el recálculo del estado). */
  fechaCompletada: Date | null;
  recetaLiberadaEn: Date | null;
  recetaLiberadaPorId: string | null;
  /** V1-E3r: la CURVA del modelo viaja aquí para poder avisar cuando difiere de la de la orden. */
  modelo: {
    codigo: string;
    curvaTalla: { nombre: string; items: { talla: { etiqueta: string } }[] } | null;
  };
  /** V1-E3j: el encabezado que la PANTALLA PROPIA de la receta necesita para decir en qué OP estás. */
  fechaEntrega: Date | null;
  cliente: { nombre: string };
}

/** Carga la orden de la empresa ACTIVA (A9) o lanza `ErrorNoEncontrado`. */
async function exigirOrdenDeLaEmpresa(
  tx: Tx,
  idOrden: number,
  idEmpresa: number,
): Promise<OrdenParaReceta> {
  const orden = await tx.orden.findFirst({
    where: { id: idOrden, idEmpresa },
    select: {
      id: true,
      folio: true,
      idEmpresa: true,
      idModelo: true,
      estado: true,
      fechaCompletada: true,
      recetaLiberadaEn: true,
      recetaLiberadaPorId: true,
      modelo: {
        select: {
          codigo: true,
          // ⭐ V1-E3r (§Post-F9.81): la curva del modelo, para el aviso de curva distinta. Los items
          // vienen en el orden de la curva — el mismo que la ficha del modelo enseña.
          curvaTalla: {
            select: {
              nombre: true,
              items: {
                select: { talla: { select: { etiqueta: true } } },
                orderBy: [{ posicion: 'asc' }, { idTalla: 'asc' }],
              },
            },
          },
        },
      },
      fechaEntrega: true,
      cliente: { select: { nombre: true } },
    },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }
  return orden;
}

/** Una orden CANCELADA no se toca (misma regla que el resto del módulo de órdenes). */
function exigirOrdenViva(orden: OrdenParaReceta): void {
  if (orden.estado === 'cancelada') {
    throw new ErrorConflicto('La orden está cancelada: su receta ya no se puede modificar.');
  }
}

// ── 1. COPIAR la receta del modelo al crear la orden ───────────────────────────────────────

/** Qué se copió, para la bitácora del alta. */
export interface ResumenCopiaReceta {
  telas: number;
  avios: number;
  artes: number;
}

/** Opciones de la copia. */
export interface OpcionesCopiaReceta {
  /**
   * MODO MIGRACIÓN: copia consumo, banderas y amarres, pero **deja el precio en NULL**.
   *
   * Dos razones, las dos de peso:
   *  1. **Correcta**: congelar en una orden de 2025 el precio que la cascada resuelve HOY sería
   *     inventar un dato que nadie calculó nunca en ese momento. `null` significa *"esta orden no
   *     congeló precio"* y hace que el costeo caiga al catálogo — exactamente como antes de la
   *     etapa. Es la MISMA decisión que tomó el backfill de la migración.
   *  2. **Rápida**: resolver la cascada por orden implica leer las últimas compras de todo el BOM
   *     (`leerTelasBom`/`leerAviosBom`) — un puñado de consultas × ~4,000 órdenes históricas. Con
   *     esto se leen los renglones del BOM crudos, sin cascada.
   */
  sinPrecios?: boolean;
}

/**
 * COPIA la receta del modelo a la orden recién creada, con **cantidad y PRECIO** (regla 1 del
 * encabezado). Corre DENTRO de la transacción del llamador (A2: o queda la orden con su receta, o no
 * queda nada).
 *
 * El precio se toma de la MISMA cascada que ve Desarrollo en la ficha del modelo
 * (`leerTelasBom`/`leerAviosBom` → `precioCosteo`, §Post-F9.48). No se re-implementa aquí: llamar a
 * la misma función es lo único que garantiza que la orden nazca con el número que el sistema dice
 * que cuesta. El ETL usa `sinPrecios` (ver {@link OpcionesCopiaReceta}).
 *
 * IDEMPOTENTE: si la orden ya tiene renglones no copia nada (devuelve ceros). Así el ETL puede
 * re-correrse y el alta puede componerse sin duplicar.
 *
 * `sesion` puede ser `null` (procesos de sistema: ETL de migración) — la auditoría queda en NULL,
 * mismo criterio que el resto de la migración.
 */
export async function copiarRecetaDelModelo(
  tx: Tx,
  sesion: SesionUsuario | null,
  orden: { id: number; idEmpresa: number; idModelo: number },
  opciones: OpcionesCopiaReceta = {},
): Promise<ResumenCopiaReceta> {
  const yaTiene = await tx.ordenTela.count({ where: { idOrden: orden.id } });
  const yaTieneAvios = await tx.ordenAvio.count({ where: { idOrden: orden.id } });
  const yaTieneArtes = await tx.ordenArte.count({ where: { idOrden: orden.id } });
  if (yaTiene + yaTieneAvios + yaTieneArtes > 0) {
    return { telas: 0, avios: 0, artes: 0 };
  }

  const sinPrecios = opciones.sinPrecios ?? false;
  const [telas, avios, artes, medidas] = await Promise.all([
    sinPrecios
      ? tx.modeloTela.findMany({ where: { idModelo: orden.idModelo } }).then((filas) =>
          filas.map((f) => ({
            idTela: f.idTela,
            consumoPorPrenda: f.consumoPorPrenda.toNumber(),
            precioCosteo: null as number | null,
            paraPreCosto: f.paraPreCosto,
            paraProduccion: f.paraProduccion,
            paraCosto: f.paraCosto,
            idTelaProveedor: f.idTelaProveedor,
          })),
        )
      : leerTelasBom(tx, orden.idModelo, orden.idEmpresa),
    sinPrecios
      ? tx.modeloAvio.findMany({ where: { idModelo: orden.idModelo } }).then((filas) =>
          filas.map((f) => ({
            idAvio: f.idAvio,
            consumoPorPrenda: f.consumoPorPrenda.toNumber(),
            precioCosteo: null as number | null,
            paraPreCosto: f.paraPreCosto,
            paraProduccion: f.paraProduccion,
            paraCosto: f.paraCosto,
            consumoPorTalla: f.consumoPorTalla,
            idAvioProveedor: f.idAvioProveedor,
          })),
        )
      : leerAviosBom(tx, orden.idModelo, orden.idEmpresa),
    leerArtesModelo(tx, orden.idModelo),
    tx.modeloAvioTalla.findMany({
      where: { idModelo: orden.idModelo },
      select: { idAvio: true, idTalla: true, consumo: true, idAvioMedida: true },
    }),
  ]);

  const auditoria = sesion === null ? {} : datosCreacion(sesion);

  // ⭐ V1-E3g (H1 del review) — La receta NACE aquí, y por aquí pasa el 100 % de las órdenes. Si el
  // BOM trae la combinación heredada "avío por medida + `consumoPorTalla` encendido", copiarla tal
  // cual **fabrica de nuevo** el mismo defecto que esta etapa vino a cerrar: cantidades por talla
  // que la pantalla ya no muestra moviendo el requerido del MRP en la sombra. Normalizar sólo en
  // agregar/editar/restaurar era tapar las tres puertas laterales dejando abierta la principal.
  // Las CANTIDADES por talla se copian igual (D3: no se pierde nada); simplemente dejan de mandar.
  const porMedida = await aviosPorMedida(
    tx,
    avios.map((a) => a.idAvio),
  );

  if (telas.length > 0) {
    await tx.ordenTela.createMany({
      data: telas.map((t) => ({
        idOrden: orden.id,
        idTela: t.idTela,
        consumoPorPrenda: new Prisma.Decimal(t.consumoPorPrenda),
        precio: t.precioCosteo === null ? null : new Prisma.Decimal(t.precioCosteo),
        paraPreCosto: t.paraPreCosto,
        paraProduccion: t.paraProduccion,
        paraCosto: t.paraCosto,
        idTelaProveedor: t.idTelaProveedor,
        ...auditoria,
      })),
    });
  }

  // Los avíos se crean UNO a uno solo porque hace falta su `id` para colgarles las medidas por
  // talla; las medidas sí van por LOTE (`createMany`). Un modelo tiene decenas de avíos, no miles.
  for (const a of avios) {
    const fila = await tx.ordenAvio.create({
      data: {
        idOrden: orden.id,
        idAvio: a.idAvio,
        consumoPorPrenda: new Prisma.Decimal(a.consumoPorPrenda),
        precio: a.precioCosteo === null ? null : new Prisma.Decimal(a.precioCosteo),
        paraPreCosto: a.paraPreCosto,
        paraProduccion: a.paraProduccion,
        paraCosto: a.paraCosto,
        consumoPorTalla: porMedida.has(a.idAvio) ? false : a.consumoPorTalla,
        idAvioProveedor: a.idAvioProveedor,
        ...auditoria,
      },
      select: { id: true },
    });
    const suyas = medidas.filter((m) => m.idAvio === a.idAvio);
    if (suyas.length > 0) {
      await tx.ordenAvioTalla.createMany({
        data: suyas.map((m) => ({
          idOrdenAvio: fila.id,
          idTalla: m.idTalla,
          consumo: m.consumo,
          idAvioMedida: m.idAvioMedida,
          ...auditoria,
        })),
      });
    }
  }

  if (artes.length > 0) {
    await tx.ordenArte.createMany({
      data: artes.map((a) => ({
        idOrden: orden.id,
        idModeloArte: a.id,
        descripcion: a.descripcion,
        posicion: a.posicion,
        puntadas: a.puntadas,
        precio: a.precio === null ? null : new Prisma.Decimal(a.precio),
        idTipoArte: a.idTipoArte,
        idProveedor: a.idProveedor,
        ...auditoria,
      })),
    });
  }

  return { telas: telas.length, avios: avios.length, artes: artes.length };
}

// ── 2. LECTURA de la receta (con la desalineación al vuelo) ────────────────────────────────

/** `select` de los renglones de tela de la receta, con lo que la pantalla necesita. */
const SELECT_TELA = {
  id: true,
  idTela: true,
  consumoPorPrenda: true,
  precio: true,
  paraPreCosto: true,
  paraProduccion: true,
  paraCosto: true,
  idTelaProveedor: true,
  estado: true,
  agregadoAMano: true,
  excluido: true,
  notas: true,
  liberadoEn: true,
  liberadoPorId: true,
  tela: { select: { nombre: true, unidadMedida: true } },
  telaProveedor: { select: { proveedor: { select: { nombre: true } } } },
} satisfies Prisma.OrdenTelaSelect;

/** `select` de los renglones de avío de la receta. */
const SELECT_AVIO = {
  id: true,
  idAvio: true,
  consumoPorPrenda: true,
  precio: true,
  paraPreCosto: true,
  paraProduccion: true,
  paraCosto: true,
  consumoPorTalla: true,
  idAvioProveedor: true,
  estado: true,
  agregadoAMano: true,
  excluido: true,
  notas: true,
  liberadoEn: true,
  liberadoPorId: true,
  avio: {
    select: {
      clave: true,
      descripcion: true,
      unidad: true,
      // ⭐ V1-E3g: la unidad de las MEDIDAS (cm) NO es la de consumo (pza) — son dos datos.
      unidadMedida: true,
      esGenerico: true,
      // ¿Tiene medidas ACTIVAS? Es el hecho del que sale `modoCaptura` — el MISMO con el que el
      // precosto decide promediar las medidas (`costos/resolucion-precios.ts`).
      _count: { select: { medidas: { where: { activo: true } } } },
    },
  },
  tallas: {
    select: {
      idTalla: true,
      consumo: true,
      idAvioMedida: true,
      talla: { select: { etiqueta: true, orden: true } },
      avioMedida: { select: { medida: true, precio: true } },
    },
  },
} satisfies Prisma.OrdenAvioSelect;

/** `select` de los renglones de arte de la receta. */
const SELECT_ARTE = {
  id: true,
  idModeloArte: true,
  descripcion: true,
  posicion: true,
  puntadas: true,
  precio: true,
  idTipoArte: true,
  idProveedor: true,
  estado: true,
  agregadoAMano: true,
  excluido: true,
  notas: true,
  liberadoEn: true,
  liberadoPorId: true,
  proveedor: { select: { nombre: true } },
  tipoArte: { select: { nombre: true, codigo: true, usaPuntadas: true } },
} satisfies Prisma.OrdenArteSelect;

/** Fila de tela tal como la devuelven los `select` de este módulo. */
type FilaTela = Prisma.OrdenTelaGetPayload<{ select: typeof SELECT_TELA }>;
/** Fila de avío (con sus medidas por talla). */
type FilaAvio = Prisma.OrdenAvioGetPayload<{ select: typeof SELECT_AVIO }>;
/** Fila de arte. */
type FilaArte = Prisma.OrdenArteGetPayload<{ select: typeof SELECT_ARTE }>;

/** Un decimal opcional del cuerpo a `Prisma.Decimal` (o `null` explícito). */
function precioDecimal(valor: number | null): Prisma.Decimal | null {
  return valor === null ? null : new Prisma.Decimal(valor);
}

/**
 * RECHAZA re-agregar un renglón que ya está VIVO en la receta. Agregar solo puede CREAR o REVIVIR
 * una lápida; "actualizar" un renglón vivo por esta puerta pisaba en silencio su precio congelado,
 * sus banderas y su amarre (hallazgo del reviewer). Para eso está `editarRenglonReceta`.
 */
function exigirNoEstaVivo(
  previo: { excluido: boolean } | null,
  comoSeLlama: string,
): asserts previo is { excluido: boolean } | null {
  if (previo !== null && !previo.excluido) {
    throw new ErrorConflicto(
      `${comoSeLlama} ya está en la receta de esta orden: edítalo en su renglón en vez de volver a ` +
        'agregarlo (agregar de nuevo borraría su precio congelado y su amarre).',
    );
  }
}

/** Foto ÍNTEGRA de un renglón de TELA para la bitácora (D3: nada desaparece sin quedar escrito). */
function fotoTela(f: FilaTela): object {
  return {
    idTela: f.idTela,
    consumoPorPrenda: num(f.consumoPorPrenda),
    precio: dec(f.precio),
    paraPreCosto: f.paraPreCosto,
    paraProduccion: f.paraProduccion,
    paraCosto: f.paraCosto,
    idTelaProveedor: f.idTelaProveedor,
    estado: f.estado,
    agregadoAMano: f.agregadoAMano,
    excluido: f.excluido,
    notas: f.notas,
  };
}

/** Foto ÍNTEGRA de un renglón de AVÍO (incluidas sus medidas por talla). */
function fotoAvio(f: FilaAvio): object {
  return {
    idAvio: f.idAvio,
    consumoPorPrenda: num(f.consumoPorPrenda),
    precio: dec(f.precio),
    paraPreCosto: f.paraPreCosto,
    paraProduccion: f.paraProduccion,
    paraCosto: f.paraCosto,
    consumoPorTalla: f.consumoPorTalla,
    idAvioProveedor: f.idAvioProveedor,
    estado: f.estado,
    agregadoAMano: f.agregadoAMano,
    excluido: f.excluido,
    notas: f.notas,
    tallas: f.tallas.map((t) => ({
      idTalla: t.idTalla,
      consumo: num(t.consumo),
      idAvioMedida: t.idAvioMedida,
    })),
  };
}

/**
 * MODO DE CAPTURA por talla de un renglón de avío (V1-E3g, §Post-F9.66). Sale de un solo hecho:
 * ¿el avío tiene medidas ACTIVAS en su catálogo? Un cierre las tiene y por talla se elige QUÉ se
 * pide; un elástico no, y por talla se captura CUÁNTO se gasta. Es exactamente el mismo criterio
 * que usa el precosto para promediar las medidas: una sola definición de "avío por medida".
 */
function modoCapturaAvio(f: FilaAvio): 'consumo' | 'medida' {
  return f.avio._count.medidas > 0 ? 'medida' : 'consumo';
}

/**
 * AVISO —que NO bloquea— sobre la captura por talla de un renglón de avío.
 *
 * ⚠️ El caso que importa es la CONTRADICCIÓN HEREDADA: un avío "por medida" con el toggle
 * `consumoPorTalla` encendido de antes de V1-E3g. La pantalla ya no muestra esas cantidades (en
 * modo `medida` no se capturan), pero seguirían moviendo el requerido del MRP. No se apagan aquí a
 * la fuerza —una lectura NO cambia datos, y voltear el cálculo de una orden viva sin que nadie lo
 * pida sería justo el cambio callado que D3 prohíbe—: se DICE, y se apaga al guardar el renglón.
 */
function avisoCapturaAvio(f: FilaAvio, piezas: PiezasDeLaOrden): string | null {
  if (modoCapturaAvio(f) === 'medida' && f.consumoPorTalla) {
    // §Post-F9.105: el texto es el MISMO de las otras dos pantallas (`unidades-avio.ts`) y ahora
    // trae la MAGNITUD: aquí sí hay orden detrás, así que se puede decir cuánto se está pidiendo
    // de más —que es lo que Daniel necesitaba ver— en vez de sólo que hay una contradicción.
    return avisoAvioPorMedidaConCantidadesPorTalla(
      'Guarda el renglón para normalizarlo.',
      requeridoContradictorioPorMedida(
        { consumoPorPrenda: f.consumoPorPrenda, consumoPorTalla: true, tallas: f.tallas },
        piezas.total,
        piezas.porTalla,
        f.avio.unidad,
      ),
    );
  }
  if (modoCapturaAvio(f) === 'consumo') {
    for (const t of f.tallas) {
      const aviso = avisoValorFueraDeRango(
        `El consumo de la talla ${t.talla.etiqueta}`,
        num(t.consumo),
        f.avio.unidad,
      );
      if (aviso !== null) return aviso;
    }
  }
  return null;
}

/**
 * MATRIZ de medidas por talla de un avío, **armada desde el universo de tallas de la ORDEN**
 * (V1-E3d/N4, extendiendo `leerMedidasAvio` de V1-E3c a la OP).
 *
 * Devuelve una fila por talla que la orden produce —capturada o no, con `consumo: null` cuando no
 * lo está— más las capturadas que la orden ya no lleva (`enLaOrden: false`), para que ninguna
 * medida desaparezca en silencio. El `null` NO es un 0: un 0 es un cero puesto a propósito.
 */
function medidasPorTalla(
  f: FilaAvio,
  tallasOrden: { idTalla: number; talla: { etiqueta: string; orden: number } }[],
): RecetaOrdenAvioTalla[] {
  const capturada = new Map(f.tallas.map((t) => [t.idTalla, t]));
  const detalle = (
    t: FilaAvio['tallas'][number] | undefined,
    idTalla: number,
    etiqueta: string,
    enLaOrden: boolean,
  ): RecetaOrdenAvioTalla => ({
    idTalla,
    etiqueta,
    consumo: t === undefined ? null : num(t.consumo),
    enLaOrden,
    idAvioMedida: t?.idAvioMedida ?? null,
    medidaAmarrada: t?.avioMedida?.medida ?? null,
    precioMedida:
      t?.avioMedida === null || t?.avioMedida === undefined ? null : num(t.avioMedida.precio),
  });

  const idsOrden = new Set(tallasOrden.map((t) => t.idTalla));
  return [
    ...tallasOrden.map((t) => detalle(capturada.get(t.idTalla), t.idTalla, t.talla.etiqueta, true)),
    ...f.tallas
      .filter((t) => !idsOrden.has(t.idTalla))
      .sort(
        (a, b) =>
          a.talla.orden - b.talla.orden || a.talla.etiqueta.localeCompare(b.talla.etiqueta, 'es'),
      )
      .map((t) => detalle(t, t.idTalla, t.talla.etiqueta, false)),
  ];
}

/** Foto ÍNTEGRA de un renglón de ARTE. */
function fotoArte(f: FilaArte): object {
  return {
    idModeloArte: f.idModeloArte,
    descripcion: f.descripcion,
    posicion: f.posicion,
    puntadas: f.puntadas,
    precio: dec(f.precio),
    idTipoArte: f.idTipoArte,
    idProveedor: f.idProveedor,
    estado: f.estado,
    agregadoAMano: f.agregadoAMano,
    excluido: f.excluido,
    notas: f.notas,
  };
}

/**
 * ¿Este renglón está DESVIADO A PROPÓSITO? Un renglón que una persona tocó (ajustado), agregó a mano
 * o excluyó **no genera aviso**: su diferencia contra el modelo la puso alguien queriendo. Es la
 * regla que hace silencioso el caso de la jareta y ruidoso el cambio del modelo.
 */
function desviadoAProposito(r: {
  estado: EstadoRenglonReceta;
  agregadoAMano: boolean;
  excluido: boolean;
}): boolean {
  return r.estado === EstadoRenglonReceta.ajustado || r.agregadoAMano || r.excluido;
}

/** Formatea una cantidad para el texto del aviso (sin ceros de relleno molestos). */
function cifra(valor: number | null): string {
  if (valor === null) return 'sin dato';
  return String(Number(valor.toFixed(4)));
}

/** Formatea un precio para el texto del aviso. */
function pesos(valor: number | null): string {
  return valor === null ? 'sin precio' : `$${redondear2(valor).toFixed(2)}`;
}

/**
 * Compara la receta congelada con el BOM VIVO del modelo y arma los avisos (regla 5 del encabezado).
 * PURA sobre lo ya leído (sin BD) para poder probarla sin Postgres.
 */
export function calcularDesalineacion(
  telas: RecetaOrdenTela[],
  avios: RecetaOrdenAvio[],
  artes: RecetaOrdenArte[],
  faltantes: { tipo: TipoRenglonRecetaClave; material: string; idMaterialModelo: number }[],
  conOrdenCompra: boolean,
): DesalineacionReceta {
  const cambios: CambioReceta[] = [];

  const revisar = (
    tipo: TipoRenglonRecetaClave,
    r: {
      id: number;
      estado: string;
      agregadoAMano: boolean;
      excluido: boolean;
      enElModelo: boolean;
    },
    material: string,
    consumo: { orden: number | null; modelo: number | null },
    precio: { orden: number | null; modelo: number | null; deCompra: boolean },
  ): CambioReceta[] => {
    const propios: CambioReceta[] = [];
    if (
      desviadoAProposito({
        estado: r.estado as EstadoRenglonReceta,
        agregadoAMano: r.agregadoAMano,
        excluido: r.excluido,
      })
    ) {
      return propios;
    }
    if (!r.enElModelo) {
      propios.push({
        tipo,
        idRenglon: r.id,
        material,
        idMaterialModelo: null,
        que: 'quitado',
        detalle: `El modelo ya no lleva "${material}", y esta orden sí lo tiene congelado.`,
      });
      return propios;
    }
    if (difieren(consumo.orden, consumo.modelo)) {
      propios.push({
        tipo,
        idRenglon: r.id,
        material,
        idMaterialModelo: null,
        que: 'consumo',
        detalle: `La cantidad de "${material}" pasó de ${cifra(consumo.orden)} a ${cifra(consumo.modelo)} en el modelo.`,
      });
    }
    // El precio solo se compara si la orden CONGELÓ uno: `null` significa "esta orden no congeló
    // precio" (recetas anteriores a V1-E3d), y contra eso no hay diferencia que reportar.
    //
    // ⭐ Y se DISTINGUE la causa (hallazgo del reviewer). Desde V1-E3e el precio que costea la
    // receta del modelo ES la última compra real, así que un comprador que ajusta la línea de su
    // propia OC y la autoriza movería este número SIN que nadie tocara el modelo. Decirle a eso
    // "el modelo cambió" es nombrar mal la causa —y dejaría en rojo permanente a toda orden viva
    // con esa tela—. Cuando el precio del modelo viene del escalón de COMPRA, el aviso lo dice así
    // y NO enciende el rojo de `conOrdenCompra`.
    if (precio.orden !== null && difieren(precio.orden, precio.modelo)) {
      propios.push(
        precio.deCompra
          ? {
              tipo,
              idRenglon: r.id,
              material,
              idMaterialModelo: null,
              que: 'precio-mercado',
              detalle:
                `La última COMPRA REAL de "${material}" es de ${pesos(precio.modelo)} y esta orden ` +
                `congeló ${pesos(precio.orden)}. El modelo no cambió: cambió el precio de compra.`,
            }
          : {
              tipo,
              idRenglon: r.id,
              material,
              idMaterialModelo: null,
              que: 'precio',
              detalle: `El precio de "${material}" pasó de ${pesos(precio.orden)} a ${pesos(precio.modelo)} en el modelo.`,
            },
      );
    }
    return propios;
  };

  for (const t of telas) {
    cambios.push(
      ...revisar(
        'tela',
        t,
        t.nombre,
        { orden: t.consumoPorPrenda, modelo: t.consumoModelo },
        { orden: t.precio, modelo: t.precioModelo, deCompra: t.precioModeloDeCompra },
      ),
    );
  }
  for (const a of avios) {
    cambios.push(
      ...revisar(
        'avio',
        a,
        `${a.clave} — ${a.descripcion}`,
        { orden: a.consumoPorPrenda, modelo: a.consumoModelo },
        { orden: a.precio, modelo: a.precioModelo, deCompra: a.precioModeloDeCompra },
      ),
    );
  }
  for (const ar of artes) {
    // El arte no tiene consumo: solo se vigila que siga existiendo y su precio.
    cambios.push(
      ...revisar(
        'arte',
        ar,
        ar.descripcion,
        { orden: null, modelo: null },
        // El arte no tiene cascada de compra: su precio es uno solo (§Post-F9.35).
        { orden: ar.precio, modelo: ar.precioModelo, deCompra: false },
      ),
    );
  }
  for (const f of faltantes) {
    cambios.push({
      tipo: f.tipo,
      idRenglon: null,
      material: f.material,
      // ⭐ V1-E3h: el id del material EN EL MODELO viaja con el aviso, para que «traer del modelo»
      // pueda señalar ESTE faltante y no solo "todo lo que falte" (§Post-F9.73 punto 1).
      idMaterialModelo: f.idMaterialModelo,
      que: 'agregado',
      detalle: `El modelo ahora lleva "${f.material}", y esta orden no lo tiene.`,
    });
  }

  // ROJO solo si hay dinero comprometido **y** el cambio lo provocó una PERSONA tocando el modelo.
  // Un `precio-mercado` sí se informa (la cifra cambió y hay que saberlo), pero no enciende la
  // alarma: encenderla por cada compra que se autoriza la convertiría en ruido de fondo.
  const porPersona = cambios.some((c) => c.que !== 'precio-mercado');
  return {
    hayCambios: cambios.length > 0,
    conOrdenCompra,
    critico: conOrdenCompra && porPersona,
    cambios,
  };
}

/**
 * Cuenta los renglones por estado y por FIRMA (los excluidos NO cuentan como vivos).
 *
 * V1-E3h: `liberados`/`porLiberar` son de renglones VIVOS. Una lápida firmada no suma —no se compra
 * de todos modos— y una lápida sin firmar no falta: esta orden ya decidió sobre ella. Es la MISMA
 * definición que usan la puerta (`leerPorLiberar`) y la bandeja; se exporta porque es pura y esa
 * coincidencia hay que poder probarla sin base de datos.
 */
export function resumirReceta(
  filas: { estado: EstadoRenglonReceta; excluido: boolean; liberadoEn: Date | null }[],
): ResumenReceta {
  let sinRevisar = 0;
  let revisados = 0;
  let ajustados = 0;
  let excluidos = 0;
  let liberados = 0;
  let porLiberar = 0;
  for (const f of filas) {
    if (f.excluido) {
      excluidos += 1;
      continue;
    }
    if (f.estado === EstadoRenglonReceta.sin_revisar) sinRevisar += 1;
    else if (f.estado === EstadoRenglonReceta.revisado) revisados += 1;
    else ajustados += 1;
    if (f.liberadoEn === null) porLiberar += 1;
    else liberados += 1;
  }
  return {
    sinRevisar,
    revisados,
    ajustados,
    excluidos,
    total: sinRevisar + revisados + ajustados,
    liberados,
    porLiberar,
  };
}

/**
 * Exige poder VER la receta: `ordenes.ver` (se llega desde la OP) **o** `desarrollo.ver` (se llega
 * desde la bandeja o desde la pantalla propia). Mismo patrón que las lecturas compartidas del
 * inventario cíclico (`exigirAlgunPermisoCiclico`): las MUTACIONES siguen exigiendo su permiso fino
 * con `verificarPermiso` — aquí no se afloja ninguna.
 */
function exigirVerLaReceta(sesion: SesionUsuario): void {
  if (!tienePermiso(sesion, 'ordenes.ver') && !tienePermiso(sesion, 'desarrollo.ver')) {
    throw new ErrorPermiso(undefined, 'desarrollo.ver');
  }
}

/**
 * LEE la receta congelada de una orden (A9) con la DESALINEACIÓN contra el BOM del modelo calculada
 * AL VUELO (regla 5). Los renglones traen embebido lo que el modelo dice HOY
 * (`consumoModelo`/`precioModelo`), para que la pantalla pinte la diferencia sin una segunda
 * llamada.
 *
 * ⭐ V1-E3j — LA LECTURA ACEPTA `ordenes.ver` **O** `desarrollo.ver`, y esto NO es una relajación:
 * es cerrar el hueco que dejó §Post-F9.72. Ahí las SIETE mutaciones de la receta bajaron a
 * `desarrollo.administrar` —*"nadie va a tener permiso de modificar la OP más que yo"*— y la bandeja
 * «Recetas por liberar» quedó en `desarrollo.ver`, pero **esta lectura se quedó en `ordenes.ver`**.
 * Resultado: un usuario de Desarrollo puro entraba a su bandeja, podía FIRMAR una receta… y no podía
 * LEERLA. Con la pantalla propia de V1-E3j eso deja de ser teórico: la ruta abre con `desarrollo.ver`
 * y su primera consulta sería un 403 — exactamente el síntoma que §Post-F9.68 manda matar.
 *
 * (En los roles sembrados hoy los dos permisos van juntos, así que nadie ve más de lo que veía; el
 * agujero vive en los roles a la medida, que es donde estas cosas se rompen.)
 */
export async function obtenerRecetaOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<RecetaOrden> {
  exigirVerLaReceta(sesion);
  const cliente = clienteLectura(bd);
  const orden = await exigirOrdenDeLaEmpresa(cliente, idOrden, sesion.idEmpresaActiva);
  return armarReceta(cliente, orden);
}

/** Arma la salida completa de la receta (compartido por la lectura y por cada mutación). */
async function armarReceta(tx: Tx, orden: OrdenParaReceta): Promise<RecetaOrden> {
  const [
    filasTela,
    filasAvio,
    filasArte,
    telasModelo,
    aviosModelo,
    artesModelo,
    ocs,
    tallasOrden,
    piezas,
    piezasPorTalla,
  ] = await Promise.all([
    tx.ordenTela.findMany({
      where: { idOrden: orden.id },
      select: SELECT_TELA,
      orderBy: { tela: { nombre: 'asc' } },
    }),
    tx.ordenAvio.findMany({
      where: { idOrden: orden.id },
      select: SELECT_AVIO,
      orderBy: { avio: { clave: 'asc' } },
    }),
    tx.ordenArte.findMany({
      where: { idOrden: orden.id },
      select: SELECT_ARTE,
      // V1-E3f: al retirarse el `nombre`, el orden estable es por descripción y luego por id.
      orderBy: [{ descripcion: 'asc' }, { id: 'asc' }],
    }),
    leerTelasBom(tx, orden.idModelo, orden.idEmpresa),
    leerAviosBom(tx, orden.idModelo, orden.idEmpresa),
    leerArtesModelo(tx, orden.idModelo),
    // ¿Ya se comprometió dinero? (decide DÓNDE se enseña el aviso, §Post-F9.43(d)). Cuenta
    // cualquier renglón de OC NO cancelada ligado a la orden.
    tx.ordenCompraLinea.count({
      where: { idOrden: orden.id, ordenCompra: { estatus: { not: 'cancelada' } } },
    }),
    // ⭐ V1-E3d/N4: el universo de tallas de la RECETA es el de la ORDEN (su matriz color×talla),
    // no la curva del modelo — es lo que esta orden de verdad produce y lo que el MRP explota.
    // Extiende a la OP la regla de V1-E3c: la matriz se arma desde el universo, no desde las
    // filas que alguien haya alcanzado a capturar (si no, un avío por talla sin medidas nunca
    // se podía capturar desde la orden).
    tx.ordenLineaTalla.findMany({
      where: { ordenLinea: { idOrden: orden.id } },
      select: { idTalla: true, talla: { select: { etiqueta: true, orden: true } } },
      distinct: ['idTalla'],
      orderBy: [{ talla: { orden: 'asc' } }, { talla: { etiqueta: 'asc' } }],
    }),
    // V1-E3j: la CANTIDAD de la orden para el encabezado de la pantalla propia de la receta. Se
    // deriva por SUMA de la matriz (misma regla que `aOrdenSalida`: el total nunca se guarda).
    tx.ordenLineaTalla.aggregate({
      where: { ordenLinea: { idOrden: orden.id } },
      _sum: { cantidad: true },
    }),
    // ⭐ §Post-F9.105: las piezas AGRUPADAS POR TALLA — el insumo de R18 y, con él, de la MAGNITUD
    // del aviso de la contradicción «por medida + cantidades por talla». Sin esto el aviso sólo
    // podía decir que había una contradicción, no cuánto se estaba pidiendo de más (que es lo que
    // hizo comprar 53 veces el cierre). Es la MISMA función que usan las guardas de la edición.
    piezasDeLaOrden(tx, orden.id),
  ]);

  // El nombre del proveedor amarrado del AVÍO se resuelve contra el `idAvioProveedor` de LA ORDEN
  // (no contra el del modelo): el amarre es congelado y editable por orden, así que tomar el nombre
  // del modelo enseñaría un proveedor que esta orden ya no usa — la clase de mentira que la etapa
  // vino a matar. Una sola consulta por lote, sin N+1.
  const idsProveedorAvio = [
    ...new Set(filasAvio.map((f) => f.idAvioProveedor).filter((id): id is number => id !== null)),
  ];
  const nombreProveedor = new Map(
    idsProveedorAvio.length === 0
      ? []
      : (
          await tx.proveedor.findMany({
            where: { id: { in: idsProveedorAvio } },
            select: { id: true, nombre: true },
          })
        ).map((p) => [p.id, p.nombre] as const),
  );

  const telaPorId = new Map(telasModelo.map((t) => [t.idTela, t]));
  const avioPorId = new Map(aviosModelo.map((a) => [a.idAvio, a]));
  // ⭐ V1-E3f: el arte se casa por su TRAZA `idModeloArte`, no por nombre — el nombre se retiró
  // (§Post-F9.52 punto 1) y la traza es ahora la identidad del renglón dentro de la orden
  // (`@@unique([idOrden, idModeloArte])`). Consecuencia buscada: si el arte del modelo se borra,
  // la FK cae a NULL (SetNull) y el renglón congelado pasa a leerse como "ya no está en el
  // modelo" — que es exactamente lo que pasó. Antes se casaba por nombre justo para NO decir eso
  // cuando el arte seguía ahí con el mismo nombre; sin nombre, esa distinción ya no existe y la
  // lectura literal de la traza es la única honesta.
  const artePorTraza = new Map(artesModelo.map((a) => [a.id, a]));

  const telas: RecetaOrdenTela[] = filasTela.map((f) => {
    const delModelo = telaPorId.get(f.idTela);
    return {
      id: f.id,
      tipo: 'tela' as const,
      estado: f.estado,
      agregadoAMano: f.agregadoAMano,
      excluido: f.excluido,
      notas: f.notas,
      liberadoEn: f.liberadoEn?.toISOString() ?? null,
      liberadoPor: f.liberadoPorId,
      enElModelo: delModelo !== undefined,
      cambios: [],
      idTela: f.idTela,
      nombre: f.tela.nombre,
      unidad: f.tela.unidadMedida,
      consumoPorPrenda: num(f.consumoPorPrenda),
      precio: dec(f.precio),
      paraPreCosto: f.paraPreCosto,
      paraProduccion: f.paraProduccion,
      paraCosto: f.paraCosto,
      idTelaProveedor: f.idTelaProveedor,
      proveedorAmarrado: f.telaProveedor?.proveedor.nombre ?? null,
      consumoModelo: delModelo?.consumoPorPrenda ?? null,
      precioModelo: delModelo?.precioCosteo ?? null,
      precioModeloDeCompra: delModelo?.origenPrecio === 'ultimo-precio-compra',
    };
  });

  const avios: RecetaOrdenAvio[] = filasAvio.map((f) => {
    const delModelo = avioPorId.get(f.idAvio);
    return {
      id: f.id,
      tipo: 'avio' as const,
      estado: f.estado,
      agregadoAMano: f.agregadoAMano,
      excluido: f.excluido,
      notas: f.notas,
      liberadoEn: f.liberadoEn?.toISOString() ?? null,
      liberadoPor: f.liberadoPorId,
      enElModelo: delModelo !== undefined,
      cambios: [],
      idAvio: f.idAvio,
      clave: f.avio.clave,
      descripcion: f.avio.descripcion,
      unidad: f.avio.unidad,
      esGenerico: f.avio.esGenerico,
      consumoPorPrenda: num(f.consumoPorPrenda),
      precio: dec(f.precio),
      paraPreCosto: f.paraPreCosto,
      paraProduccion: f.paraProduccion,
      paraCosto: f.paraCosto,
      consumoPorTalla: f.consumoPorTalla,
      modoCaptura: modoCapturaAvio(f),
      unidadMedida: f.avio.unidadMedida,
      avisoCaptura: avisoCapturaAvio(f, piezasPorTalla),
      idAvioProveedor: f.idAvioProveedor,
      proveedorAmarrado:
        f.idAvioProveedor === null ? null : (nombreProveedor.get(f.idAvioProveedor) ?? null),
      tallas: medidasPorTalla(f, tallasOrden),
      tieneTallas: tallasOrden.length > 0,
      consumoModelo: delModelo?.consumoPorPrenda ?? null,
      precioModelo: delModelo?.precioCosteo ?? null,
      precioModeloDeCompra: delModelo?.origenPrecio === 'ultimo-precio-compra',
    };
  });

  const artes: RecetaOrdenArte[] = filasArte.map((f) => {
    const delModelo = f.idModeloArte === null ? undefined : artePorTraza.get(f.idModeloArte);
    return {
      id: f.id,
      tipo: 'arte' as const,
      estado: f.estado,
      agregadoAMano: f.agregadoAMano,
      excluido: f.excluido,
      notas: f.notas,
      liberadoEn: f.liberadoEn?.toISOString() ?? null,
      liberadoPor: f.liberadoPorId,
      enElModelo: delModelo !== undefined,
      cambios: [],
      idModeloArte: f.idModeloArte,
      descripcion: f.descripcion,
      posicion: f.posicion,
      puntadas: f.puntadas,
      idTipoArte: f.idTipoArte,
      tipoArte: f.tipoArte.nombre,
      codigoTipoArte: f.tipoArte.codigo,
      usaPuntadas: f.tipoArte.usaPuntadas,
      precio: dec(f.precio),
      idProveedor: f.idProveedor,
      proveedor: f.proveedor?.nombre ?? null,
      precioModelo: delModelo?.precio ?? null,
      precioModeloDeCompra: false,
    };
  });

  // Insumos que el MODELO trae y la orden NO tiene NI SIQUIERA como lápida: son los "agregados".
  // Un renglón excluido SÍ cuenta como presente — la orden ya decidió sobre él.
  const idsTelaOrden = new Set(filasTela.map((f) => f.idTela));
  const idsAvioOrden = new Set(filasAvio.map((f) => f.idAvio));
  const idsArteOrden = new Set(
    filasArte.flatMap((f) => (f.idModeloArte === null ? [] : [f.idModeloArte])),
  );
  const faltantes: {
    tipo: TipoRenglonRecetaClave;
    material: string;
    idMaterialModelo: number;
  }[] = [
    ...telasModelo
      .filter((t) => !idsTelaOrden.has(t.idTela))
      .map((t) => ({ tipo: 'tela' as const, material: t.nombre, idMaterialModelo: t.idTela })),
    ...aviosModelo
      .filter((a) => !idsAvioOrden.has(a.idAvio))
      .map((a) => ({
        tipo: 'avio' as const,
        material: `${a.clave} — ${a.descripcion}`,
        idMaterialModelo: a.idAvio,
      })),
    ...artesModelo
      .filter((a) => !idsArteOrden.has(a.id))
      .map((a) => ({ tipo: 'arte' as const, material: a.descripcion, idMaterialModelo: a.id })),
  ];

  /*
   * ⭐ V1-E3r (§Post-F9.81) — EL AVISO DE CURVA DISTINTA.
   *
   * ⚠️ Se compara contra `tallasOrden`, EXACTAMENTE el mismo conjunto con el que `medidasPorTalla`
   * arma la matriz que el usuario ve debajo. Comparar contra otra cosa (la suma de las OP del
   * modelo, las tallas con cantidad > 0…) sería una segunda contradicción encima de la primera:
   * el aviso hablaría de una matriz que no es la que está en pantalla.
   *
   * El nombre del lado de la ORDEN sale del catálogo cuando alguna curva cubre exactamente ese
   * conjunto (es lo normal: el ETL sembró una curva por combinación del viejo); si no, se usa el
   * nombre determinista, que es el mismo con el que se crearía. Así el aviso SIEMPRE nombra las dos
   * curvas, que es lo que Daniel pidió — un aviso que sólo dijera "son distintas" obliga a ir a
   * buscar la diferencia a otra pantalla, que es justo lo que le pasó.
   */
  const curvaModelo = orden.modelo.curvaTalla;
  const etiquetasModelo = curvaModelo?.items.map((i) => i.talla.etiqueta) ?? [];
  const etiquetasOrden = tallasOrden.map((t) => t.talla.etiqueta);

  // ⚠️ La consulta del nombre SOLO se paga cuando hay algo que avisar. Se pregunta primero con
  // `curvasDifieren` —la MISMA regla que usa el redactor, no un criterio propio— porque los dos
  // casos frecuentes (el modelo sin curva, y la curva que sí coincide) no necesitan nombre alguno,
  // y `armarReceta` corre también dentro de transacciones de ESCRITURA.
  let aviso = null;
  if (curvaModelo !== null && etiquetasModelo.length > 0 && etiquetasOrden.length > 0) {
    if (curvasDifieren(etiquetasModelo, etiquetasOrden)) {
      const curvaDeLaOrden = await curvaQueCubreExactamente(
        tx,
        tallasOrden.map((t) => t.idTalla),
      );
      aviso = avisoCurvaDistinta(
        ladoDelModelo(curvaModelo.nombre, etiquetasModelo),
        ladoDeUnaOrden(
          curvaDeLaOrden?.nombre ?? nombreDeterministaCurva(etiquetasOrden),
          etiquetasOrden,
        ),
      );
    }
  }

  const resumen = resumirReceta([...filasTela, ...filasAvio, ...filasArte]);
  const desalineacion = calcularDesalineacion(telas, avios, artes, faltantes, ocs > 0);
  // Cada renglón se lleva SUS cambios (para pintarlos en su fila sin que la pantalla los cruce).
  for (const c of desalineacion.cambios) {
    if (c.idRenglon === null) continue;
    const destino =
      c.tipo === 'tela'
        ? telas.find((t) => t.id === c.idRenglon)
        : c.tipo === 'avio'
          ? avios.find((a) => a.id === c.idRenglon)
          : artes.find((a) => a.id === c.idRenglon);
    destino?.cambios.push(c.que);
  }

  return {
    idOrden: orden.id,
    folio: Number(orden.folio),
    idModelo: orden.idModelo,
    codigoModelo: orden.modelo.codigo,
    // ⭐ V1-E3j — el encabezado de la orden viaja CON la receta: su pantalla propia se abre desde la
    // bandeja de Desarrollo, donde no hay una OP alrededor de la cual leerse (y pedirlo aparte
    // ataría la pantalla a `ordenes.ver`, el permiso que §Post-F9.72 sacó de en medio).
    cliente: orden.cliente.nombre,
    fechaEntrega:
      orden.fechaEntrega === null ? null : orden.fechaEntrega.toISOString().slice(0, 10),
    estado: orden.estado,
    totalPiezas: piezas._sum.cantidad ?? 0,
    liberadaEn: orden.recetaLiberadaEn?.toISOString() ?? null,
    liberadaPor: orden.recetaLiberadaPorId,
    // ⭐ V1-E3h: la puerta dejó de ser todo-o-nada. `puedeComprar` = **hay algo firmado**, que es
    // exactamente lo que el MRP necesita para tener qué explotar; `todoLiberado` es la bandera
    // DERIVADA de la orden ("no queda nada por firmar"), la que lee el semáforo de orden completa.
    puedeComprar: resumen.liberados > 0,
    todoLiberado: orden.recetaLiberadaEn !== null,
    // ⭐ V1-E3r: el aviso YA REDACTADO por el servidor (A1), o null si no hay nada que avisar. La
    // pantalla lo pinta tal cual — ni arma la frase, ni resuelve el plural, ni ordena las tallas.
    avisoCurva: aviso === null ? null : aviso.texto,
    resumen,
    telas,
    avios,
    artes,
    desalineacion,
  };
}

/**
 * DESALINEACIÓN de una orden, calculada al vuelo, **sin traer la receta entera al llamador**.
 *
 * Es el **primer aviso de §Post-F9.43(d)**: *"sin OC todavía → rojo EN EL LUGAR DE LA DECISIÓN (al
 * explotar el MRP / generar la OC), diciendo qué cambió"*. La usa `compras/mrp.ts` para que quien
 * está a punto de gastar vea la diferencia SIN tener que abrir la orden en otra pantalla.
 *
 * Reusa `armarReceta` a propósito (no re-implementa la comparación): la regla de qué cuenta como
 * desalineado —y sobre todo la de qué NO cuenta, porque lo desvió una persona— vive en UN solo
 * lugar. Duplicarla aquí es exactamente cómo divergen dos avisos que deberían decir lo mismo.
 */
export async function desalineacionDeOrden(
  tx: Tx,
  idOrden: number,
  idEmpresa: number,
): Promise<DesalineacionReceta> {
  const orden = await exigirOrdenDeLaEmpresa(tx, idOrden, idEmpresa);
  return (await armarReceta(tx, orden)).desalineacion;
}

// ── 3. LA PUERTA: sin liberar no se compra ─────────────────────────────────────────────────

/** Dónde se libera, dicho una sola vez: el aviso tiene que llevar a la pantalla, no adivinarla. */
const DONDE_SE_LIBERA =
  'Se libera desde la receta de la orden (Centro de Órdenes → la orden → «Receta de la orden»), o ' +
  'de un jalón desde Desarrollo → «Recetas por liberar».';

/** Un renglón VIVO de la receta que Desarrollo todavía no firma (V1-E3h, §Post-F9.72). */
export interface RenglonPorLiberar {
  tipo: TipoRenglonRecetaClave;
  idRenglon: number;
  /** Material comprable: uno de los dos viene con id, el otro en null (el arte no trae ninguno). */
  idTela: number | null;
  idAvio: number | null;
  material: string;
  consumoPorPrenda: number;
  unidad: string | null;
}

/**
 * Lee los renglones VIVOS de la receta que siguen SIN firmar. Los `excluido` no cuentan: esta orden
 * ya decidió que no los lleva, así que no le faltan a nadie.
 */
async function leerPorLiberar(tx: Tx, idOrden: number): Promise<RenglonPorLiberar[]> {
  const donde = { idOrden, excluido: false, liberadoEn: null } as const;
  const [telas, avios, artes] = await Promise.all([
    tx.ordenTela.findMany({
      where: donde,
      select: {
        id: true,
        idTela: true,
        consumoPorPrenda: true,
        tela: { select: { nombre: true, unidadMedida: true } },
      },
      orderBy: { tela: { nombre: 'asc' } },
    }),
    tx.ordenAvio.findMany({
      where: donde,
      select: {
        id: true,
        idAvio: true,
        consumoPorPrenda: true,
        avio: { select: { clave: true, descripcion: true, unidad: true } },
      },
      orderBy: { avio: { clave: 'asc' } },
    }),
    tx.ordenArte.findMany({
      where: donde,
      select: { id: true, descripcion: true },
      orderBy: [{ descripcion: 'asc' }, { id: 'asc' }],
    }),
  ]);
  return [
    ...telas.map((t) => ({
      tipo: 'tela' as const,
      idRenglon: t.id,
      idTela: t.idTela,
      idAvio: null,
      material: t.tela.nombre,
      consumoPorPrenda: num(t.consumoPorPrenda),
      unidad: t.tela.unidadMedida,
    })),
    ...avios.map((a) => ({
      tipo: 'avio' as const,
      idRenglon: a.id,
      idTela: null,
      idAvio: a.idAvio,
      material: `${a.avio.clave} — ${a.avio.descripcion}`,
      consumoPorPrenda: num(a.consumoPorPrenda),
      unidad: a.avio.unidad,
    })),
    ...artes.map((r) => ({
      tipo: 'arte' as const,
      idRenglon: r.id,
      idTela: null,
      idAvio: null,
      material: r.descripcion,
      consumoPorPrenda: 0,
      unidad: null,
    })),
  ];
}

/**
 * ⭐ LA PUERTA, ahora "SE COMPRA LO LIBERADO" (V1-E3h, §Post-F9.72 — antes era todo-o-nada).
 *
 * Daniel: *"podría haber algún cierre que aún no autoriza el cliente, pero ya podríamos ir comprando
 * lo demás"*. Así que ya NO se exige que la receta entera esté firmada:
 *
 *  • Con **algo** liberado, PASA — y devuelve la lista de lo que quedó fuera, con nombre y
 *    cantidad, para que quien está comprando lo VEA (requisito textual de Daniel: *"transparentemente
 *    qué le falta de liberar"*). Lo no firmado no entra a la explosión, pero tampoco desaparece en
 *    silencio (D3).
 *  • Con **nada** liberado, FRENA: no hay literalmente nada que comprar, y decirlo con un aviso
 *    vacío sería peor que un error. El mensaje dice **dónde se libera** — el hueco de navegación
 *    que §Post-F9.72 nombra aparte.
 *
 * La usan el MRP (explotar), la generación de OC desde la explosión y el alta de OC **capturada a
 * mano** ligada a la orden — y **solo ellos**: cortar, enviar a maquila, recibir y entregar NO pasan
 * por aquí a propósito (el piso no se detiene porque Desarrollo no haya terminado; lo único que se
 * frena es gastar dinero contra una receta que nadie miró).
 *
 * ⚠️ **`idEmpresa` es OBLIGATORIO (A9)**: sin él, una orden ajena contestaría 409 «sin liberar»
 * —confirmando que existe y en qué estado está— en vez de 404.
 */
export async function exigirRecetaLiberada(
  tx: Tx,
  idOrden: number,
  idEmpresa: number,
): Promise<RenglonPorLiberar[]> {
  const orden = await tx.orden.findFirst({
    where: { id: idOrden, idEmpresa },
    select: { folio: true },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }
  const [pendientes, liberados] = await Promise.all([
    leerPorLiberar(tx, idOrden),
    contarLiberados(tx, idOrden),
  ]);
  if (liberados === 0) {
    throw new ErrorConflicto(
      `La receta de la orden ${String(orden.folio)} todavía no la libera Desarrollo: no hay nada ` +
        `autorizado que comprar. ${DONDE_SE_LIBERA} (Cortar y producir no están bloqueados.)`,
    );
  }
  return pendientes;
}

/** Cuántos renglones VIVOS de la receta están ya firmados (los excluidos no cuentan). */
async function contarLiberados(tx: Tx, idOrden: number): Promise<number> {
  const donde = { idOrden, excluido: false, liberadoEn: { not: null } } as const;
  const [telas, avios, artes] = await Promise.all([
    tx.ordenTela.count({ where: donde }),
    tx.ordenAvio.count({ where: donde }),
    tx.ordenArte.count({ where: donde }),
  ]);
  return telas + avios + artes;
}

/**
 * EXIGE que los MATERIALES concretos que se van a comprar estén firmados (V1-E3h). Es la otra mitad
 * de "se compra lo liberado": la puerta general solo garantiza que **algo** está firmado, y con la
 * liberación por partes eso ya no basta para una OC capturada a mano —o para una selección de
 * requerimientos hecha antes de que un renglón se re-cerrara—. Sin esto, la compra parcial abriría
 * exactamente el agujero que la firma existe para tapar.
 *
 * Un material que NO está en la receta de la orden **no se rechaza aquí**: comprarle algo extra a
 * una orden es legal (la OC a mano lo permite a propósito) y la receta no es una lista blanca de
 * compra. Lo que se prohíbe es comprar un renglón que SÍ está en la receta y que Desarrollo todavía
 * no firmó.
 */
export async function exigirMaterialesLiberados(
  tx: Tx,
  idOrden: number,
  idEmpresa: number,
  materiales: readonly { idTela?: number | null | undefined; idAvio?: number | null | undefined }[],
): Promise<void> {
  const orden = await tx.orden.findFirst({
    where: { id: idOrden, idEmpresa },
    select: { folio: true },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }
  const pendientes = await leerPorLiberar(tx, idOrden);
  if (pendientes.length === 0) return;
  const telasPendientes = new Map(
    pendientes.flatMap((p) => (p.idTela === null ? [] : [[p.idTela, p.material] as const])),
  );
  const aviosPendientes = new Map(
    pendientes.flatMap((p) => (p.idAvio === null ? [] : [[p.idAvio, p.material] as const])),
  );
  const chocan = new Set<string>();
  for (const m of materiales) {
    const porTela = m.idTela == null ? undefined : telasPendientes.get(m.idTela);
    const porAvio = m.idAvio == null ? undefined : aviosPendientes.get(m.idAvio);
    if (porTela !== undefined) chocan.add(porTela);
    if (porAvio !== undefined) chocan.add(porAvio);
  }
  if (chocan.size > 0) {
    throw new ErrorConflicto(
      `Desarrollo todavía no libera ${[...chocan].map((m) => `"${m}"`).join(', ')} en la receta de ` +
        `la orden ${String(orden.folio)}: no se puede comprar. ${DONDE_SE_LIBERA}`,
    );
  }
}

// ── 4. MUTACIONES ──────────────────────────────────────────────────────────────────────────

/**
 * Lo que la mutación puede contarle de vuelta a `enRecetaEditable`. Hoy solo una cosa: que el
 * renglón que tocó era una **LÁPIDA** (`excluido`), que por definición no cambia QUÉ se compra —
 * así que no tiene por qué revocar la firma de Desarrollo (hallazgo del reviewer).
 */
interface ContextoMutacionReceta {
  cayoSobreLapida: () => void;
  /**
   * ⭐ V1-E3h: la mutación DECLARA qué renglón tocó, para que la firma se revoque **solo en ese
   * renglón** y no en toda la receta (§Post-F9.72: se libera por partes, así que también se
   * re-cierra por partes). Una mutación que no declara nada no revoca nada.
   */
  tocoRenglon: (tipo: TipoRenglonRecetaClave, idRenglon: number) => void;
}

/** Lo que toda mutación de la receta comparte: permiso, orden viva, transacción y salida completa. */
async function enRecetaEditable<T>(
  sesion: SesionUsuario,
  idOrden: number,
  bd: ContextoBd | undefined,
  accion: (tx: Tx, orden: OrdenParaReceta, ctx: ContextoMutacionReceta) => Promise<T>,
  opciones: { cambiaElContenido?: boolean } = {},
): Promise<RecetaOrden> {
  verificarPermiso(sesion, 'desarrollo.administrar');
  return enTransaccion(async (tx) => {
    const orden = await exigirOrdenDeLaEmpresa(tx, idOrden, sesion.idEmpresaActiva);
    exigirOrdenViva(orden);
    let sobreLapida = false;
    const tocados: { tipo: TipoRenglonRecetaClave; idRenglon: number }[] = [];
    await accion(tx, orden, {
      cayoSobreLapida: () => {
        sobreLapida = true;
      },
      tocoRenglon: (tipo, idRenglon) => {
        tocados.push({ tipo, idRenglon });
      },
    });

    // ⭐ TOCAR EL CONTENIDO DE UN RENGLÓN YA LIBERADO LO VUELVE A CERRAR (hallazgo del reviewer,
    // ahora POR RENGLÓN — V1-E3h/§Post-F9.72).
    //
    // La firma de Desarrollo es sobre LO QUE SE FIRMÓ. Sin esto se podía meter material nuevo a una
    // receta ya liberada —o cambiarle el precio, o el amarre— y comprarlo sin que nadie lo volviera
    // a mirar: justo el agujero que la puerta existe para tapar. Al re-cerrarse, el renglón tocado
    // ya quedó en `ajustado`, así que revisarlo y volver a firmarlo es un par de clics.
    //
    // ⚠️ **Lo que cambia respecto de V1-E3d**: antes se revocaba LA RECETA ENTERA. Con la firma por
    // renglón eso sería un castigo colectivo — tocar el consumo de una tela cerraría de golpe los
    // avíos que ya se estaban comprando, que es justo lo contrario de lo que Daniel pidió. Ahora se
    // cierra SOLO el renglón que se tocó.
    //
    // NO re-cierran: "marcar todo revisado" y "liberar" (no cambian QUÉ se compra), editar una
    // LÁPIDA (no se compra de todos modos), EXCLUIR un renglón (quita algo de la compra: no hay
    // firma ajena que invalidar) ni las lecturas.
    //
    // ⚠️ Revocar NO des-completa la orden (el recálculo de abajo va con `permitirDesCompletar:
    // false`): una orden a medio producir no se saca de los tableros por un cambio de receta —es la
    // misma regla de Daniel del 26-jul—. Quien mira la orden lo ve igual, porque este panel dice
    // qué falta firmar y la puerta de compra está cerrada de verdad para ese renglón.
    if (opciones.cambiaElContenido === true && !sobreLapida && tocados.length > 0) {
      const revocados = await revocarFirmaDeRenglones(tx, sesion, orden.id, tocados);
      if (revocados.length > 0) {
        await bitacoraReceta(tx, sesion, orden.id, 'MODIFICAR', {
          accion: 'liberacion-renglon-revocada',
          renglones: revocados,
          motivo:
            'se cambió el contenido de un renglón ya liberado: Desarrollo tiene que volver a firmarlo',
        });
      }
    }
    // La bandera de la ORDEN es DERIVADA desde V1-E3h ("todo lo vivo está liberado"): se recalcula
    // SIEMPRE, porque hasta quitar un renglón pendiente puede dejar la receta completa.
    await sincronizarLiberacionOrden(tx, sesion, orden.id);
    // El semáforo de "orden completa" depende AHORA de la receta (liberada + arte), así que se
    // recalcula en la MISMA transacción (A2). `permitirDesCompletar: false`: tocar la receta nunca
    // degrada una orden en curso — el des-completar sigue viviendo solo en la edición de su matriz.
    await recalcularEstadoOrden(tx, sesion, orden, {
      tocarAuditoria: false,
      permitirDesCompletar: false,
    });
    const recargada = await exigirOrdenDeLaEmpresa(tx, idOrden, sesion.idEmpresaActiva);
    return armarReceta(tx, recargada);
  }, bd);
}

/**
 * Solo las claves DEFINIDAS: lo que el cuerpo no trajo NO se toca (la clave del revivir).
 *
 * El tipo de salida ELIMINA `undefined` de los valores a propósito: con `exactOptionalPropertyTypes`
 * un `{ precio: undefined }` no es lo mismo que "sin la clave", y Prisma lo rechaza. Así el `update`
 * recibe exactamente los campos que se van a escribir.
 */
function soloDefinido<T extends object>(campos: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

/**
 * AGREGA un renglón a la receta de ESTA orden, o **REVIVE una lápida** (`desarrollo.administrar`).
 *
 * Cómo nace depende de si el material vive o no en el BOM del modelo:
 *  - **No está en el modelo** → `ajustado` + `agregadoAMano`: solo existe en esta orden, ningún
 *    recálculo lo pisa y ningún aviso de desalineación lo reclama.
 *  - **Sí está en el modelo** (traer al pedido lo que el modelo agregó después) → hereda precio,
 *    banderas, amarre y medidas por talla, `agregadoAMano: false`, y **`revisado` si se copió tal
 *    cual** — para que un cambio POSTERIOR del modelo sí levante su aviso.
 *
 * ⚠️ **LOS TRES CAMINOS SON DISTINTOS, y confundirlos costaba caro** (hallazgo del reviewer):
 *
 *  1. **No existe** → se CREA, aplicando aquí los defaults (`paraX: true`, `consumoPorTalla: false`,
 *     `tipoArte: BORDADO`). Es el único lugar donde inventarlos es correcto.
 *  2. **Existe como LÁPIDA** (`excluido: true`) → se REVIVE, y **solo se pisa lo que el cuerpo
 *     trajo**: su precio congelado, sus banderas y su amarre siguen siendo los de esta orden.
 *  3. **Existe VIVO** → **409**. Antes esto lo "actualizaba" en silencio con los defaults del
 *     esquema, así que dos clics en la pantalla que esta etapa estrena borraban **el precio
 *     congelado** (el dato que la etapa existe para proteger), volteaban `paraCosto` y limpiaban el
 *     amarre — dejando al MRP sin saber a quién comprarle. Para cambiar un renglón vivo está
 *     `editarRenglonReceta`, que es un PATCH de verdad y guarda el `antes`.
 *
 * A7/D3: al revivir, la bitácora lleva el estado **`antes` ÍNTEGRO**, para que nada de lo que había
 * sea irrecuperable.
 */
export async function agregarRenglonReceta(
  sesion: SesionUsuario,
  idOrden: number,
  cuerpo: DatosRecetaAgregar,
  bd?: ContextoBd,
): Promise<RecetaOrden> {
  const datos = validarEntrada(esquemaRecetaAgregarCuerpo, cuerpo);
  return enRecetaEditable(
    sesion,
    idOrden,
    bd,
    async (tx, orden) => {
      const auditoria = { ...datosCreacion(sesion) };
      /**
       * Lo que marca a un renglón NUEVO (nunca a uno revivido: ése vino del modelo).
       *
       * ⚠️ `agregadoAMano` NO es "lo agregó una persona": es **"esto no está en el modelo"**. Si el
       * material SÍ vive en el BOM —el caso de traer al pedido lo que el modelo agregó después— el
       * renglón nace **como del modelo**: hereda precio, banderas, amarre y medidas por talla.
       *
       * ⚠️⚠️ Y NACE `revisado`, NO `ajustado`. Es la mitad que faltaba: `desviadoAProposito` calla
       * al renglón `ajustado` **igual** que al agregado a mano, así que dejarlo `ajustado` lo dejaba
       * exactamente igual de sordo y el flip de la bandera no compraba nada (segundo hallazgo del
       * reviewer). Copiado FIEL del modelo = nadie lo ajustó = si el modelo cambia mañana, AVISA.
       * En cuanto la persona teclea algo distinto de lo que dice el modelo, sí es un ajuste y se
       * calla, que es la regla de siempre.
       */
      const comunesNuevo = (copiaFielDelModelo: boolean) => ({
        estado: copiaFielDelModelo ? EstadoRenglonReceta.revisado : EstadoRenglonReceta.ajustado,
        excluido: false,
        notas: datos.notas ?? null,
      });
      /**
       * Lo que marca a una lápida REVIVIDA (sin tocar `agregadoAMano`: su origen no cambia).
       *
       * ⭐ V1-E3h: revivir **borra la firma** del renglón. Una lápida pudo quedar firmada (el
       * backfill firmó todo, y liberar «todo» no la toca porque no se compra); resucitarla con esa
       * firma puesta la metería a la compra sin que nadie la volviera a mirar — que es exactamente
       * el agujero que la puerta existe para tapar.
       */
      const comunesRevivido = {
        estado: EstadoRenglonReceta.ajustado,
        excluido: false,
        liberadoEn: null,
        liberadoPorId: null,
        ...(datos.notas === undefined ? {} : { notas: datos.notas }),
        ...datosModificacion(sesion),
      };

      if (datos.tipo === 'tela') {
        await exigirTelaExiste(tx, datos.idTela);
        const previo = await tx.ordenTela.findUnique({
          where: { idOrden_idTela: { idOrden: orden.id, idTela: datos.idTela } },
          select: SELECT_TELA,
        });
        exigirNoEstaVivo(previo, `La tela "${previo?.tela.nombre ?? ''}"`);
        // ¿Este material está en el BOM del modelo? Si sí, el renglón nuevo se trae de ahí lo que
        // el cuerpo no dijo (H5): precio de la cascada, banderas y amarre por proveedor.
        const delModelo = (await leerTelasBom(tx, orden.idModelo, orden.idEmpresa)).find(
          (t) => t.idTela === datos.idTela,
        );

        // Solo lo que el cuerpo trajo (al revivir) / con defaults (al crear).
        const delCuerpo = {
          consumoPorPrenda: new Prisma.Decimal(datos.consumoPorPrenda),
          precio: datos.precio === undefined ? undefined : precioDecimal(datos.precio),
          paraPreCosto: datos.paraPreCosto,
          paraProduccion: datos.paraProduccion,
          paraCosto: datos.paraCosto,
          idTelaProveedor: datos.idTelaProveedor,
        };

        if (previo !== null) {
          await tx.ordenTela.update({
            where: { id: previo.id },
            data: { ...soloDefinido(delCuerpo), ...comunesRevivido },
          });
        } else {
          await tx.ordenTela.create({
            data: {
              idOrden: orden.id,
              idTela: datos.idTela,
              consumoPorPrenda: delCuerpo.consumoPorPrenda,
              precio: delCuerpo.precio ?? precioDecimal(delModelo?.precioCosteo ?? null),
              paraPreCosto: datos.paraPreCosto ?? delModelo?.paraPreCosto ?? true,
              paraProduccion: datos.paraProduccion ?? delModelo?.paraProduccion ?? true,
              paraCosto: datos.paraCosto ?? delModelo?.paraCosto ?? true,
              idTelaProveedor: datos.idTelaProveedor ?? delModelo?.idTelaProveedor ?? null,
              agregadoAMano: delModelo === undefined,
              ...comunesNuevo(
                delModelo !== undefined &&
                  datos.consumoPorPrenda === delModelo.consumoPorPrenda &&
                  datos.precio === undefined &&
                  datos.paraPreCosto === undefined &&
                  datos.paraProduccion === undefined &&
                  datos.paraCosto === undefined &&
                  datos.idTelaProveedor === undefined,
              ),
              ...auditoria,
            },
          });
        }
        await bitacoraReceta(tx, sesion, orden.id, 'CREAR', {
          tipo: 'tela',
          idTela: datos.idTela,
          cambios: datos,
          revivido: previo !== null,
          ...(previo === null
            ? { delModelo: delModelo !== undefined }
            : { antes: fotoTela(previo) }),
        });
        return;
      }

      if (datos.tipo === 'avio') {
        await exigirAvioExiste(tx, datos.idAvio);
        const previo = await tx.ordenAvio.findUnique({
          where: { idOrden_idAvio: { idOrden: orden.id, idAvio: datos.idAvio } },
          select: SELECT_AVIO,
        });
        exigirNoEstaVivo(
          previo,
          `El avío "${previo === null ? '' : `${previo.avio.clave} — ${previo.avio.descripcion}`}"`,
        );

        const delModeloAvio = (await leerAviosBom(tx, orden.idModelo, orden.idEmpresa)).find(
          (a) => a.idAvio === datos.idAvio,
        );

        // ⭐ V1-E3g: si el avío se compra POR MEDIDA, la cantidad no va por talla (ver
        // `normalizarConsumoPorTalla`). Se normaliza aquí, ANTES de escribir, para que el toggle
        // heredado del modelo tampoco reviva la contradicción al copiar la receta.
        const porMedida = await avioEsPorMedida(tx, datos.idAvio);
        const consumoPorTallaPedido = normalizarConsumoPorTalla(datos.consumoPorTalla, porMedida);

        const delCuerpo = {
          consumoPorPrenda: new Prisma.Decimal(datos.consumoPorPrenda),
          precio: datos.precio === undefined ? undefined : precioDecimal(datos.precio),
          paraPreCosto: datos.paraPreCosto,
          paraProduccion: datos.paraProduccion,
          paraCosto: datos.paraCosto,
          consumoPorTalla: consumoPorTallaPedido,
          idAvioProveedor: datos.idAvioProveedor,
        };

        const id =
          previo !== null
            ? (
                await tx.ordenAvio.update({
                  where: { id: previo.id },
                  data: { ...soloDefinido(delCuerpo), ...comunesRevivido },
                  select: { id: true },
                })
              ).id
            : (
                await tx.ordenAvio.create({
                  data: {
                    idOrden: orden.id,
                    idAvio: datos.idAvio,
                    consumoPorPrenda: delCuerpo.consumoPorPrenda,
                    precio: delCuerpo.precio ?? precioDecimal(delModeloAvio?.precioCosteo ?? null),
                    paraPreCosto: datos.paraPreCosto ?? delModeloAvio?.paraPreCosto ?? true,
                    paraProduccion: datos.paraProduccion ?? delModeloAvio?.paraProduccion ?? true,
                    paraCosto: datos.paraCosto ?? delModeloAvio?.paraCosto ?? true,
                    consumoPorTalla: porMedida
                      ? false
                      : (datos.consumoPorTalla ?? delModeloAvio?.consumoPorTalla ?? false),
                    idAvioProveedor:
                      datos.idAvioProveedor ?? delModeloAvio?.idAvioProveedor ?? null,
                    agregadoAMano: delModeloAvio === undefined,
                    ...comunesNuevo(
                      delModeloAvio !== undefined &&
                        datos.consumoPorPrenda === delModeloAvio.consumoPorPrenda &&
                        datos.precio === undefined &&
                        datos.paraPreCosto === undefined &&
                        datos.paraProduccion === undefined &&
                        datos.paraCosto === undefined &&
                        datos.consumoPorTalla === undefined &&
                        datos.idAvioProveedor === undefined &&
                        datos.tallas === undefined,
                    ),
                    ...auditoria,
                  },
                  select: { id: true },
                })
              ).id;
        if (datos.tallas !== undefined) {
          await reemplazarMedidasAvio(tx, sesion, id, datos.tallas);
        } else if (previo === null && delModeloAvio !== undefined) {
          // Renglón NUEVO que sí está en el modelo: se trae también su juego de medidas por talla
          // (lo que antes se perdía y había que recuperar con un "Restaurar" que nadie anunciaba).
          const medidas = await tx.modeloAvioTalla.findMany({
            where: { idModelo: orden.idModelo, idAvio: datos.idAvio },
            select: { idTalla: true, consumo: true, idAvioMedida: true },
          });
          if (medidas.length > 0) {
            await reemplazarMedidasAvio(
              tx,
              sesion,
              id,
              medidas.map((m) => ({
                idTalla: m.idTalla,
                consumo: num(m.consumo),
                idAvioMedida: m.idAvioMedida,
              })),
            );
          }
        }
        await bitacoraReceta(tx, sesion, orden.id, 'CREAR', {
          tipo: 'avio',
          idAvio: datos.idAvio,
          cambios: datos,
          revivido: previo !== null,
          ...(previo === null
            ? { delModelo: delModeloAvio !== undefined }
            : { antes: fotoAvio(previo) }),
        });
        return;
      }

      if (datos.idProveedor != null) {
        await exigirProveedorExiste(tx, datos.idProveedor);
      }
      // ⭐ V1-E3f: la identidad del arte dentro de la orden es su TRAZA al arte del modelo
      // (`@@unique([idOrden, idModeloArte])`), porque el `nombre` que la hacía se retiró
      // (§Post-F9.52 punto 1). Dos consecuencias directas:
      //  • **Con `idModeloArte`** se busca la lápida de ESE arte y se revive (el caso "traer al
      //    pedido lo que el modelo agregó después"), y el arte del modelo se resuelve por id, no
      //    por texto.
      //  • **Sin `idModeloArte`** el renglón es AGREGADO A MANO y siempre se CREA: sin nombre no
      //    hay con qué reconocer una lápida suya, y varios artes a mano en la misma orden son
      //    legales (Postgres trata los NULL del unique como distintos). La descripción y el tipo
      //    son entonces obligatorios: no hay de dónde heredarlos.
      const delModeloArte =
        datos.idModeloArte === undefined
          ? undefined
          : (await leerArtesModelo(tx, orden.idModelo)).find((a) => a.id === datos.idModeloArte);
      if (datos.idModeloArte !== undefined && delModeloArte === undefined) {
        throw new ErrorNoEncontrado('Arte del modelo', datos.idModeloArte);
      }
      const previo =
        datos.idModeloArte === undefined
          ? null
          : await tx.ordenArte.findUnique({
              where: {
                idOrden_idModeloArte: { idOrden: orden.id, idModeloArte: datos.idModeloArte },
              },
              select: SELECT_ARTE,
            });
      exigirNoEstaVivo(
        previo,
        `El arte "${datos.descripcion ?? delModeloArte?.descripcion ?? ''}"`,
      );

      const idTipoArte = datos.idTipoArte ?? delModeloArte?.idTipoArte;
      const descripcion = datos.descripcion ?? delModeloArte?.descripcion;
      if (previo === null && (idTipoArte === undefined || descripcion === undefined)) {
        throw new ErrorValidacion(
          'Un arte agregado a mano necesita descripción y tipo (no hay arte del modelo del que ' +
            'heredarlos).',
        );
      }
      if (datos.idTipoArte !== undefined) {
        await exigirTipoArteExiste(tx, datos.idTipoArte);
      }

      const delCuerpoArte = {
        descripcion: datos.descripcion,
        posicion: datos.posicion,
        puntadas: datos.puntadas,
        precio: datos.precio === undefined ? undefined : precioDecimal(datos.precio),
        idTipoArte: datos.idTipoArte,
        idProveedor: datos.idProveedor,
      };

      if (previo !== null) {
        await tx.ordenArte.update({
          where: { id: previo.id },
          data: { ...soloDefinido(delCuerpoArte), ...comunesRevivido },
        });
      } else {
        await tx.ordenArte.create({
          data: {
            idOrden: orden.id,
            // Los dos ya están comprobados arriba (el `if` de más arriba corta si faltan).
            descripcion: descripcion ?? '',
            idTipoArte: idTipoArte ?? 0,
            posicion: datos.posicion ?? delModeloArte?.posicion ?? null,
            puntadas: datos.puntadas ?? delModeloArte?.puntadas ?? null,
            precio: delCuerpoArte.precio ?? precioDecimal(delModeloArte?.precio ?? null),
            idProveedor: datos.idProveedor ?? delModeloArte?.idProveedor ?? null,
            idModeloArte: delModeloArte?.id ?? null,
            agregadoAMano: delModeloArte === undefined,
            ...comunesNuevo(
              delModeloArte !== undefined &&
                datos.precio === undefined &&
                datos.descripcion === undefined &&
                datos.posicion === undefined &&
                datos.puntadas === undefined &&
                datos.idTipoArte === undefined &&
                datos.idProveedor === undefined,
            ),
            ...auditoria,
          },
        });
      }
      await bitacoraReceta(tx, sesion, orden.id, 'CREAR', {
        tipo: 'arte',
        idModeloArte: datos.idModeloArte ?? null,
        cambios: datos,
        revivido: previo !== null,
        ...(previo === null
          ? { delModelo: delModeloArte !== undefined }
          : { antes: fotoArte(previo) }),
      });
    },
    // Cambia QUÉ se compra. El renglón NUEVO nace SIN firma; al REVIVIR una lápida la firma se
    // borra explícitamente (`comunesRevivido`). En los dos casos la bandera derivada de la orden
    // se recalcula (ver `enRecetaEditable`).
    { cambiaElContenido: true },
  );
}

/**
 * EDITA un renglón de la receta (`desarrollo.administrar`). Cualquier cambio lo deja en `ajustado`
 * — la marca que hace que un cambio posterior del modelo no lo pise (mismo patrón que
 * `PrecostoLinea.ajustado`) y que su diferencia contra el modelo deje de generar aviso.
 *
 * PATCH de verdad: lo que no viene NO se toca.
 */
export async function editarRenglonReceta(
  sesion: SesionUsuario,
  idOrden: number,
  tipo: TipoRenglonRecetaClave,
  idRenglon: number,
  cuerpo: DatosRecetaEditar,
  bd?: ContextoBd,
): Promise<RecetaOrden> {
  const datos = validarEntrada(esquemaRecetaEditarCuerpo, cuerpo);
  return enRecetaEditable(
    sesion,
    idOrden,
    bd,
    async (tx, orden, ctx) => {
      const marca = { estado: EstadoRenglonReceta.ajustado, ...datosModificacion(sesion) };

      if (tipo === 'tela') {
        const fila = await exigirRenglonTela(tx, orden.id, idRenglon);
        // ⭐ V1-E3y (§Post-F9.79): editar lo comprado es LEGÍTIMO (precio, amarre, notas, banderas de
        // costo, subir o bajar el consumo) — lo que no se vale es SACARLO por la puerta de atrás,
        // dejando su requerido en CERO sin haberlo quitado. Se compara el requerido de ANTES contra
        // el que dejaría este cuerpo.
        const antesTela = telaParaRequerido(fila);
        const despuesTela: RenglonParaRequerido = {
          excluido: fila.excluido,
          paraProduccion: datos.paraProduccion ?? fila.paraProduccion,
          consumoPorPrenda: datos.consumoPorPrenda ?? antesTela.consumoPorPrenda,
        };
        if (sacaDeLaCompra(antesTela, despuesTela, await piezasDeLaOrden(tx, orden.id))) {
          await exigirNoSacarLoComprado(
            tx,
            orden,
            'tela',
            fila.idTela,
            fila.tela.nombre,
            'dejarlo fuera de la compra de esta orden',
          );
        }
        // Editar una LÁPIDA no cambia qué se compra: no revoca la firma de Desarrollo.
        if (fila.excluido) ctx.cayoSobreLapida();
        else ctx.tocoRenglon(tipo, fila.id);
        await tx.ordenTela.update({
          where: { id: fila.id },
          data: {
            ...(datos.consumoPorPrenda === undefined
              ? {}
              : { consumoPorPrenda: new Prisma.Decimal(datos.consumoPorPrenda) }),
            ...(datos.precio === undefined
              ? {}
              : { precio: datos.precio === null ? null : new Prisma.Decimal(datos.precio) }),
            ...(datos.paraPreCosto === undefined ? {} : { paraPreCosto: datos.paraPreCosto }),
            ...(datos.paraProduccion === undefined ? {} : { paraProduccion: datos.paraProduccion }),
            ...(datos.paraCosto === undefined ? {} : { paraCosto: datos.paraCosto }),
            ...(datos.idTelaProveedor === undefined
              ? {}
              : { idTelaProveedor: datos.idTelaProveedor }),
            ...(datos.notas === undefined ? {} : { notas: datos.notas }),
            ...marca,
          },
        });
        await bitacoraReceta(tx, sesion, orden.id, 'MODIFICAR', {
          tipo,
          idRenglon,
          // D3: la foto ÍNTEGRA, no dos campos. El PATCH del contrato expone banderas y amarre,
          // así que el `antes` tiene que poder reconstruir el renglón completo (no solo `cambios`,
          // que dice a qué quedó pero no de qué venía).
          antes: fotoTela(fila),
          cambios: datos,
        });
        return;
      }

      if (tipo === 'avio') {
        const fila = await exigirRenglonAvio(tx, orden.id, idRenglon);
        const antes = fotoAvio(fila);
        if (fila.excluido) ctx.cayoSobreLapida();
        else ctx.tocoRenglon(tipo, fila.id);
        // ⭐ V1-E3g: el toggle que llega se normaliza contra el modo del avío. Además, si el
        // renglón trae la contradicción HEREDADA (por medida + toggle encendido) se apaga aquí: es
        // el momento en que el usuario sí pidió tocar ese renglón, y queda en la bitácora con el
        // resto del cambio (nunca en una lectura).
        //
        // 🔴 **§Post-F9.105 — CUALQUIER guardado del renglón normaliza, no sólo el de las tallas.**
        // Hasta hoy esto pedía además `datos.tallas !== undefined`, así que guardar sólo el precio
        // o el proveedor dejaba la contradicción viva… mientras el aviso PROMETÍA *"Guarda para
        // normalizarlo"*. El texto prometía lo que el código no cumplía, y las OP de antes del
        // 18-ago-2026 seguían comprando 53 veces el cierre que hacía falta.
        const porMedida = await avioEsPorMedida(tx, fila.idAvio);
        const consumoPorTallaPedido =
          normalizarConsumoPorTalla(datos.consumoPorTalla, porMedida) ??
          (porMedida && fila.consumoPorTalla ? false : undefined);
        /** ¿La bandera se apaga sola (nadie la mandó en el PATCH)? Decide qué error se explica. */
        const normalizacionAutomatica =
          datos.consumoPorTalla === undefined && consumoPorTallaPedido === false;

        // ⭐ V1-E3y (§Post-F9.79): misma regla que en la tela, pero aquí el requerido puede venir de
        // las MEDIDAS POR TALLA (R18) — ponerlas todas en 0 vacía la compra con `paraProduccion` y
        // `consumoPorPrenda` intactos, que es la tercera puerta de atrás. Va DESPUÉS de resolver el
        // toggle normalizado (`consumoPorTallaPedido`) porque el estado resultante depende de él, y
        // ANTES de escribir nada.
        const antesAvio = avioParaRequerido(fila);
        const consumoResultante = datos.consumoPorPrenda ?? antesAvio.consumoPorPrenda;
        const despuesAvio: RenglonParaRequerido = {
          excluido: fila.excluido,
          paraProduccion: datos.paraProduccion ?? fila.paraProduccion,
          consumoPorPrenda: consumoResultante,
          consumoPorTalla: consumoPorTallaPedido ?? fila.consumoPorTalla,
          tallas:
            datos.tallas === undefined
              ? antesAvio.tallas
              : medidasResultantes(datos.tallas, fila.tallas, consumoResultante),
        };
        const piezasOrden = await piezasDeLaOrden(tx, orden.id);
        if (sacaDeLaCompra(antesAvio, despuesAvio, piezasOrden)) {
          // 🔴 §Post-F9.105 — ¿QUIÉN DEJÓ EL REQUERIDO EN CERO: el usuario o la normalización?
          // Apagar la bandera cambia el requerido, y con un `consumoPorPrenda` en 0 lo deja en
          // cero: si ese avío ya tiene OC, el guardado se RECHAZA… en un PATCH donde el usuario
          // quizá sólo cambió el precio. Se mide en vez de suponerse: si el cambio SIN normalizar
          // también lo sacaba de la compra, la causa es del usuario y el mensaje de siempre es el
          // correcto; si no, la causa es nuestra y hay que decir cómo se arregla DE VERDAD (no
          // des-autorizando una OC que está bien). La guarda NO se relaja: sigue rechazando.
          const porSuCuenta = sacaDeLaCompra(
            antesAvio,
            { ...despuesAvio, consumoPorTalla: fila.consumoPorTalla },
            piezasOrden,
          );
          const culpaDeLaNormalizacion = normalizacionAutomatica && !porSuCuenta;
          await exigirNoSacarLoComprado(
            tx,
            orden,
            'avio',
            fila.idAvio,
            `${fila.avio.clave} — ${fila.avio.descripcion}`,
            culpaDeLaNormalizacion
              ? 'guardar este renglón sin decir cuánto lleva por prenda'
              : 'dejarlo fuera de la compra de esta orden',
            culpaDeLaNormalizacion
              ? 'Ese renglón arrastra una contradicción: el avío se compra POR MEDIDA y traía ' +
                  'encendido "se consume por talla" de una captura vieja, así que al guardar se ' +
                  'normaliza — y con su consumo por prenda en 0 el requerido quedaría en 0. NO ' +
                  'hace falta tocar la orden de compra: captura en ESTE MISMO guardado el consumo ' +
                  'por prenda que de verdad lleva (en un cierre, normalmente 1) y se arregla.'
              : null,
          );
        }

        await tx.ordenAvio.update({
          where: { id: fila.id },
          data: {
            ...(datos.consumoPorPrenda === undefined
              ? {}
              : { consumoPorPrenda: new Prisma.Decimal(datos.consumoPorPrenda) }),
            ...(datos.precio === undefined
              ? {}
              : { precio: datos.precio === null ? null : new Prisma.Decimal(datos.precio) }),
            ...(datos.paraPreCosto === undefined ? {} : { paraPreCosto: datos.paraPreCosto }),
            ...(datos.paraProduccion === undefined ? {} : { paraProduccion: datos.paraProduccion }),
            ...(datos.paraCosto === undefined ? {} : { paraCosto: datos.paraCosto }),
            ...(consumoPorTallaPedido === undefined
              ? {}
              : { consumoPorTalla: consumoPorTallaPedido }),
            ...(datos.idAvioProveedor === undefined
              ? {}
              : { idAvioProveedor: datos.idAvioProveedor }),
            ...(datos.notas === undefined ? {} : { notas: datos.notas }),
            ...marca,
          },
        });
        if (datos.tallas !== undefined) {
          await reemplazarMedidasAvio(tx, sesion, fila.id, datos.tallas);
        }
        await bitacoraReceta(tx, sesion, orden.id, 'MODIFICAR', {
          tipo,
          idRenglon,
          // D3: incluye las medidas por talla VIEJAS — `reemplazarMedidasAvio` las borra en bloque.
          antes,
          // ⭐ §Post-F9.105: si la bandera se apagó SOLA (el usuario no la mandó), va igual en los
          // cambios. El sistema hizo algo que nadie pidió —normalizar la contradicción— y eso tiene
          // que poder leerse en la bitácora, no deducirse comparando el `antes` con el estado de
          // hoy: un cambio del sistema que no se registra es indistinguible de uno que se calló.
          cambios: normalizacionAutomatica ? { ...datos, consumoPorTalla: false } : datos,
        });
        return;
      }

      const fila = await exigirRenglonArte(tx, orden.id, idRenglon);
      if (fila.excluido) ctx.cayoSobreLapida();
      else ctx.tocoRenglon(tipo, fila.id);
      if (datos.idProveedor != null) {
        await exigirProveedorExiste(tx, datos.idProveedor);
      }
      // V1-E3f: ya no hay choque de nombre que pre-chequear (la identidad del renglón es su traza
      // `idModeloArte`, que esta edición NO toca). Editar la descripción de un arte a una que ya
      // usa otro renglón de la misma orden es legal — el nombre único se retiró a propósito
      // (§Post-F9.52 punto 1). Lo que sí se valida es el TIPO, que viene del catálogo.
      if (datos.idTipoArte !== undefined && datos.idTipoArte !== fila.idTipoArte) {
        await exigirTipoArteExiste(tx, datos.idTipoArte);
      }
      await tx.ordenArte.update({
        where: { id: fila.id },
        data: {
          ...(datos.descripcion === undefined ? {} : { descripcion: datos.descripcion }),
          ...(datos.posicion === undefined ? {} : { posicion: datos.posicion }),
          ...(datos.idTipoArte === undefined ? {} : { idTipoArte: datos.idTipoArte }),
          ...(datos.puntadas === undefined ? {} : { puntadas: datos.puntadas }),
          ...(datos.precio === undefined
            ? {}
            : { precio: datos.precio === null ? null : new Prisma.Decimal(datos.precio) }),
          ...(datos.idProveedor === undefined ? {} : { idProveedor: datos.idProveedor }),
          ...(datos.notas === undefined ? {} : { notas: datos.notas }),
          ...marca,
        },
      });
      await bitacoraReceta(tx, sesion, orden.id, 'MODIFICAR', {
        tipo,
        idRenglon,
        antes: fotoArte(fila),
        cambios: datos,
      });
    },
    // Cambia QUÉ se compra: el renglón tocado se re-cierra y hay que volver a firmarlo — SOLO él,
    // no la receta entera (V1-E3h, ver `enRecetaEditable`).
    { cambiaElContenido: true },
  );
}

/**
 * QUITA un renglón de la receta de ESTA orden (`desarrollo.administrar`) — el caso de la jareta.
 *
 * REGLA 4 del encabezado, y es la parte fina:
 *  • Un renglón que vino del MODELO se **EXCLUYE** (lápida `excluido = true`), no se borra. Sin la
 *    lápida, el comparador vería el insumo en el modelo y no en la orden, y avisaría *"el modelo
 *    agregó X"* — un aviso FALSO, y encima justo en el caso que la etapa vino a habilitar.
 *  • Un renglón AGREGADO A MANO se borra de verdad: no vino del modelo, no hay nada que recordar
 *    frente a él. Su copia ÍNTEGRA (no un conteo) queda en la bitácora, D3.
 */
export async function quitarRenglonReceta(
  sesion: SesionUsuario,
  idOrden: number,
  tipo: TipoRenglonRecetaClave,
  idRenglon: number,
  cuerpo: DatosRecetaQuitar = {},
  bd?: ContextoBd,
): Promise<RecetaOrden> {
  const datos = validarEntrada(esquemaRecetaQuitarCuerpo, cuerpo);
  return enRecetaEditable(
    sesion,
    idOrden,
    bd,
    async (tx, orden) => {
      const marca = {
        excluido: true,
        estado: EstadoRenglonReceta.ajustado,
        ...(datos.motivo === undefined ? {} : { notas: datos.motivo }),
        ...datosModificacion(sesion),
      };

      if (tipo === 'tela') {
        const fila = await exigirRenglonTela(tx, orden.id, idRenglon);
        // ⭐ V1-E3y (§Post-F9.79): lo ya COMPRADO no se quita de la receta. `null` = el renglón se
        // va, así que su requerido resultante es cero; sólo se mira si HOY pedía algo (uno que ya
        // estaba fuera no se puede "sacar" otra vez).
        if (sacaDeLaCompra(telaParaRequerido(fila), null, await piezasDeLaOrden(tx, orden.id))) {
          await exigirNoSacarLoComprado(
            tx,
            orden,
            'tela',
            fila.idTela,
            fila.tela.nombre,
            'quitarlo de la receta de esta orden',
          );
        }
        // D3: la copia ÍNTEGRA la arma el MISMO helper que usa el revivir — una sola definición de
        // "qué hay que conservar de este renglón", para que no puedan divergir.
        const copia = { tipo, idRenglon, ...fotoTela(fila), motivo: datos.motivo ?? null };
        if (fila.agregadoAMano) {
          await tx.ordenTela.delete({ where: { id: fila.id } });
          await bitacoraReceta(tx, sesion, orden.id, 'CANCELAR', { ...copia, borrado: true });
        } else {
          await tx.ordenTela.update({ where: { id: fila.id }, data: marca });
          await bitacoraReceta(tx, sesion, orden.id, 'MODIFICAR', { ...copia, excluido: true });
        }
        return;
      }

      if (tipo === 'avio') {
        const fila = await exigirRenglonAvio(tx, orden.id, idRenglon);
        // ⭐ V1-E3y (§Post-F9.79): lo ya COMPRADO no se quita de la receta (ver la nota de la tela).
        // En un avío el requerido puede venir de sus MEDIDAS POR TALLA (R18), no del consumo.
        if (sacaDeLaCompra(avioParaRequerido(fila), null, await piezasDeLaOrden(tx, orden.id))) {
          await exigirNoSacarLoComprado(
            tx,
            orden,
            'avio',
            fila.idAvio,
            `${fila.avio.clave} — ${fila.avio.descripcion}`,
            'quitarlo de la receta de esta orden',
          );
        }
        // D3: copia ÍNTEGRA (incluidas sus medidas por talla) con el MISMO helper del revivir.
        const copia = { tipo, idRenglon, ...fotoAvio(fila), motivo: datos.motivo ?? null };
        if (fila.agregadoAMano) {
          await tx.ordenAvio.delete({ where: { id: fila.id } });
          await bitacoraReceta(tx, sesion, orden.id, 'CANCELAR', { ...copia, borrado: true });
        } else {
          await tx.ordenAvio.update({ where: { id: fila.id }, data: marca });
          await bitacoraReceta(tx, sesion, orden.id, 'MODIFICAR', { ...copia, excluido: true });
        }
        return;
      }

      const fila = await exigirRenglonArte(tx, orden.id, idRenglon);
      // D3: copia ÍNTEGRA con el MISMO helper del revivir.
      const copia = { tipo, idRenglon, ...fotoArte(fila), motivo: datos.motivo ?? null };
      if (fila.agregadoAMano) {
        await tx.ordenArte.delete({ where: { id: fila.id } });
        await bitacoraReceta(tx, sesion, orden.id, 'CANCELAR', { ...copia, borrado: true });
      } else {
        await tx.ordenArte.update({ where: { id: fila.id }, data: marca });
        await bitacoraReceta(tx, sesion, orden.id, 'MODIFICAR', { ...copia, excluido: true });
      }
    },
    // ⚠️ QUITAR **no revoca ninguna firma**, y es a propósito: excluir un renglón le quita algo a
    // la compra, no le agrega nada sin revisar. Lo único que pasa es que la bandera derivada de
    // la orden se recalcula — y puede quedar COMPLETA, si lo que faltaba por firmar era justo
    // lo que se acaba de excluir (ver `enRecetaEditable`).
    { cambiaElContenido: true },
  );
}

/**
 * RESTAURA un renglón al valor que trae HOY el BOM del modelo (`desarrollo.administrar`) — es la
 * "opción de traer los cambios A MANO" de §Post-F9.43(f), y el espejo de `restaurarLineaBom` del
 * precosteo. Re-copia consumo, precio (la cascada actual), amarre, banderas y medidas por talla, y
 * deja el renglón en `revisado` **con la lápida levantada** (`excluido = false`): restaurar es un
 * acto deliberado de una persona que acaba de mirar el renglón.
 *
 * Si el insumo YA NO está en el BOM del modelo, no hay a dónde volver y se rechaza con un mensaje
 * claro (en vez de dejarlo en un estado a medias).
 */
export async function restaurarRenglonReceta(
  sesion: SesionUsuario,
  idOrden: number,
  tipo: TipoRenglonRecetaClave,
  idRenglon: number,
  bd?: ContextoBd,
): Promise<RecetaOrden> {
  return enRecetaEditable(
    sesion,
    idOrden,
    bd,
    async (tx, orden, ctx) => {
      const marca = {
        estado: EstadoRenglonReceta.revisado,
        excluido: false,
        ...datosModificacion(sesion),
      };

      if (tipo === 'tela') {
        const fila = await exigirRenglonTela(tx, orden.id, idRenglon);
        // Restaurar PISA consumo, precio, banderas y amarre: cambia QUÉ y a QUIÉN se compra, así
        // que el renglón vuelve a necesitar firma (V1-E3h). También aplica sobre una lápida:
        // restaurar la levanta (`excluido: false`), y volver a la compra sin firmar sería el hueco.
        ctx.tocoRenglon(tipo, fila.id);
        const delModelo = (await leerTelasBom(tx, orden.idModelo, orden.idEmpresa)).find(
          (t) => t.idTela === fila.idTela,
        );
        if (delModelo === undefined) {
          throw new ErrorConflicto(
            `"${fila.tela.nombre}" ya no está en la receta del modelo: no hay a qué restaurarlo. ` +
              'Ajusta el renglón a mano o quítalo.',
          );
        }
        // ⭐ V1-E3y (§Post-F9.79): restaurar PISA `paraProduccion` y el consumo con lo que diga el
        // modelo HOY. Si eso dejara al material comprado sin requerido, es la MISMA puerta de atrás
        // que quitarlo — entrada por el otro lado. (Restaurar nunca lo excluye: levanta la lápida,
        // así que el estado resultante va siempre con `excluido: false`.)
        if (
          sacaDeLaCompra(
            telaParaRequerido(fila),
            {
              excluido: false,
              paraProduccion: delModelo.paraProduccion,
              consumoPorPrenda: delModelo.consumoPorPrenda,
            },
            await piezasDeLaOrden(tx, orden.id),
          )
        ) {
          await exigirNoSacarLoComprado(
            tx,
            orden,
            'tela',
            fila.idTela,
            fila.tela.nombre,
            'restaurarlo a lo que dice el modelo (lo dejaría fuera de la compra)',
          );
        }
        await tx.ordenTela.update({
          where: { id: fila.id },
          data: {
            consumoPorPrenda: new Prisma.Decimal(delModelo.consumoPorPrenda),
            precio:
              delModelo.precioCosteo === null ? null : new Prisma.Decimal(delModelo.precioCosteo),
            paraPreCosto: delModelo.paraPreCosto,
            paraProduccion: delModelo.paraProduccion,
            paraCosto: delModelo.paraCosto,
            idTelaProveedor: delModelo.idTelaProveedor,
            agregadoAMano: false,
            ...marca,
          },
        });
        await bitacoraReceta(tx, sesion, orden.id, 'MODIFICAR', {
          tipo,
          idRenglon,
          restaurado: true,
          // D3: restaurar PISA el precio congelado, las banderas y el amarre. Lo que desaparece
          // queda ÍNTEGRO aquí (no un resumen): es el único rastro de lo que Desarrollo negoció.
          antes: fotoTela(fila),
          consumoPorPrenda: delModelo.consumoPorPrenda,
          precio: delModelo.precioCosteo,
        });
        return;
      }

      if (tipo === 'avio') {
        const fila = await exigirRenglonAvio(tx, orden.id, idRenglon);
        ctx.tocoRenglon(tipo, fila.id);
        // La foto se toma ANTES de tocar nada: `reemplazarMedidasAvio` borra el juego completo de
        // medidas por talla, y sin esto se irían sin dejar rastro (D3, mismo cierre que la pieza A).
        const antes = fotoAvio(fila);
        const delModelo = (await leerAviosBom(tx, orden.idModelo, orden.idEmpresa)).find(
          (a) => a.idAvio === fila.idAvio,
        );
        if (delModelo === undefined) {
          throw new ErrorConflicto(
            `"${fila.avio.clave} — ${fila.avio.descripcion}" ya no está en la receta del modelo: no ` +
              'hay a qué restaurarlo. Ajusta el renglón a mano o quítalo.',
          );
        }
        // V1-E3g: el modelo ya viene normalizado, pero restaurar NO debe ser la rendija por la que
        // un toggle viejo vuelva a encenderse en un avío "por medida". Se resuelve ARRIBA porque el
        // estado resultante que mira la guarda de V1-E3y depende de él.
        const consumoPorTallaRestaurado = (await avioEsPorMedida(tx, fila.idAvio))
          ? false
          : delModelo.consumoPorTalla;
        // Las medidas del MODELO se leen ANTES de escribir: son las que quedarán en el renglón
        // (`reemplazarMedidasAvio` más abajo) y por tanto las que deciden el requerido resultante.
        const medidas = await tx.modeloAvioTalla.findMany({
          where: { idModelo: orden.idModelo, idAvio: fila.idAvio },
          select: { idTalla: true, consumo: true, idAvioMedida: true },
        });
        // ⭐ V1-E3y (§Post-F9.79): misma comprobación que en la tela, con las MEDIDAS del modelo
        // (R18) — restaurar puede vaciar el requerido tanto por el consumo como por las medidas.
        if (
          sacaDeLaCompra(
            avioParaRequerido(fila),
            {
              excluido: false,
              paraProduccion: delModelo.paraProduccion,
              consumoPorPrenda: delModelo.consumoPorPrenda,
              consumoPorTalla: consumoPorTallaRestaurado,
              tallas: medidas.map((m) => ({ idTalla: m.idTalla, consumo: num(m.consumo) })),
            },
            await piezasDeLaOrden(tx, orden.id),
          )
        ) {
          await exigirNoSacarLoComprado(
            tx,
            orden,
            'avio',
            fila.idAvio,
            `${fila.avio.clave} — ${fila.avio.descripcion}`,
            'restaurarlo a lo que dice el modelo (lo dejaría fuera de la compra)',
          );
        }
        await tx.ordenAvio.update({
          where: { id: fila.id },
          data: {
            consumoPorPrenda: new Prisma.Decimal(delModelo.consumoPorPrenda),
            precio:
              delModelo.precioCosteo === null ? null : new Prisma.Decimal(delModelo.precioCosteo),
            paraPreCosto: delModelo.paraPreCosto,
            paraProduccion: delModelo.paraProduccion,
            paraCosto: delModelo.paraCosto,
            consumoPorTalla: consumoPorTallaRestaurado,
            idAvioProveedor: delModelo.idAvioProveedor,
            agregadoAMano: false,
            ...marca,
          },
        });
        await reemplazarMedidasAvio(
          tx,
          sesion,
          fila.id,
          medidas.map((m) => ({
            idTalla: m.idTalla,
            consumo: num(m.consumo),
            idAvioMedida: m.idAvioMedida,
          })),
        );
        await bitacoraReceta(tx, sesion, orden.id, 'MODIFICAR', {
          tipo,
          idRenglon,
          restaurado: true,
          antes,
          consumoPorPrenda: delModelo.consumoPorPrenda,
          precio: delModelo.precioCosteo,
          // Las medidas NUEVAS van completas (no un conteo): con `antes.tallas` se reconstruye el
          // juego viejo y con éstas el nuevo.
          tallas: medidas.map((m) => ({
            idTalla: m.idTalla,
            consumo: num(m.consumo),
            idAvioMedida: m.idAvioMedida,
          })),
        });
        return;
      }

      const fila = await exigirRenglonArte(tx, orden.id, idRenglon);
      ctx.tocoRenglon(tipo, fila.id);
      // V1-E3f: restaurar sigue la TRAZA (`idModeloArte`), no el nombre. Un renglón que la perdió
      // —porque el arte del modelo se borró— ya no tiene a qué volver, y tampoco lo tenía antes:
      // el nombre solo lo disimulaba mientras existiera un arte llamado igual.
      const delModelo =
        fila.idModeloArte === null
          ? undefined
          : (await leerArtesModelo(tx, orden.idModelo)).find((a) => a.id === fila.idModeloArte);
      if (delModelo === undefined) {
        throw new ErrorConflicto(
          `El arte "${fila.descripcion}" ya no está en el modelo: no hay a qué restaurarlo. ` +
            'Ajústalo a mano o quítalo.',
        );
      }
      await tx.ordenArte.update({
        where: { id: fila.id },
        data: {
          idModeloArte: delModelo.id,
          descripcion: delModelo.descripcion,
          posicion: delModelo.posicion,
          puntadas: delModelo.puntadas,
          precio: delModelo.precio === null ? null : new Prisma.Decimal(delModelo.precio),
          idTipoArte: delModelo.idTipoArte,
          idProveedor: delModelo.idProveedor,
          agregadoAMano: false,
          ...marca,
        },
      });
      await bitacoraReceta(tx, sesion, orden.id, 'MODIFICAR', {
        tipo,
        idRenglon,
        restaurado: true,
        antes: fotoArte(fila),
        precio: delModelo.precio,
      });
    },
    // Cambia QUÉ se compra (pisa consumo, precio, banderas y amarre): el renglón restaurado se
    // re-cierra y vuelve a necesitar firma (V1-E3h, ver `enRecetaEditable`).
    { cambiaElContenido: true },
  );
}

/**
 * MARCA TODO REVISADO (`desarrollo.administrar`) — el botón que evita los 8 clics por OP. Pasa a
 * `revisado` únicamente los renglones `sin_revisar` **no excluidos**: los `ajustado` conservan su
 * marca (es la que impide que el modelo los pise) y los excluidos ya están decididos.
 */
export async function marcarRecetaRevisada(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<RecetaOrden> {
  return enRecetaEditable(sesion, idOrden, bd, async (tx, orden) => {
    const donde = {
      idOrden: orden.id,
      estado: EstadoRenglonReceta.sin_revisar,
      excluido: false,
    } as const;
    const auditoria = datosModificacion(sesion);
    const [telas, avios, artes] = await Promise.all([
      tx.ordenTela.updateMany({
        where: donde,
        data: { estado: EstadoRenglonReceta.revisado, ...auditoria },
      }),
      tx.ordenAvio.updateMany({
        where: donde,
        data: { estado: EstadoRenglonReceta.revisado, ...auditoria },
      }),
      tx.ordenArte.updateMany({
        where: donde,
        data: { estado: EstadoRenglonReceta.revisado, ...auditoria },
      }),
    ]);
    await bitacoraReceta(tx, sesion, orden.id, 'MODIFICAR', {
      accion: 'marcar-todo-revisado',
      telas: telas.count,
      avios: avios.count,
      artes: artes.count,
    });
  });
}

/**
 * ⭐ LIBERA renglones de la receta, **UNO POR UNO** (`desarrollo.administrar`) — la firma de
 * Desarrollo que abre la puerta de compra (§Post-F9.43(c), partida en renglones por §Post-F9.72,
 * y firmada VIÉNDOLA por §Post-F9.80).
 *
 * Daniel (19-ago-2026): *"podría haber algún cierre que aún no autoriza el cliente, pero ya podríamos
 * ir comprando lo demás"* → se libera **por partes**, no todo-o-nada.
 *
 * Daniel (20-ago-2026): *"me parece una mala idea el botón de «Liberar todo lo que falta». Creo que
 * siempre se debe liberar uno por uno, para que se revise lo que se está haciendo. **No tiene sentido
 * liberar las cosas sin ver**."* → **quien firma NOMBRA cada renglón**.
 *
 * ⚠️ **La regla vive AQUÍ, no en la pantalla** (A1/A4, §Post-F9.68: esconder *y* bloquear). Hasta
 * V1-E3j esta función aceptaba un `alcance` en bloque (`todo`/`telas`/`avios`/`artes`) y una bandera
 * `revisarPendientes` que marcaba revisado y firmaba en el mismo acto; los dos los había agregado el
 * LEAD para que *"lo rutinario no cueste veinte clics"*, y los dos se retiraron. Quitarlos solo de la
 * UI habría dejado el API firmando de un golpe lo que nadie miró — que es exactamente lo que
 * §Post-F9.68 vino a matar.
 *
 * ⚠️ **Lo que esto NO pretende ser**: nada impide que un cliente lea la receta, junte los ids y los
 * mande todos en una llamada. Eso es DELIBERADO y es la línea que el servidor sí puede sostener: el
 * servidor **jamás expande un comodín**, así que no hay forma de firmar un renglón cuyo id no se
 * conocía. Reconstruir "liberar todo" exige leer la receta y enumerarla — y volver a ofrecerlo con un
 * botón sería re-tomar la decisión de producto que Daniel ya tomó, no aprovechar un hueco.
 *
 * DOS condiciones, y las dos tienen razón de ser:
 *  • **Ningún renglón `sin_revisar` entre los que se firman.** No son 8 clics: «marcar todo revisado»
 *    —que se CONSERVA, porque no libera nada: solo dice *"ya miré estos renglones"*— lo resuelve de
 *    un golpe para el 89 % de las órdenes que vienen limpias. Se mide sobre lo que se firma y no
 *    sobre la receta entera: si fuera global, un avío que nadie ha mirado bloquearía la firma de una
 *    tela — justo lo que §Post-F9.72 vino a desbloquear.
 *  • **No se firma "nada".** Una lista vacía dejaría al MRP explotando cero y a alguien creyendo que
 *    ya lo revisaron (D3: no se libera en silencio).
 *
 * Y dos cosas que se DICEN en vez de tragarse (A9/D3): un id que no es de esta orden es 404, y un id
 * de LÁPIDA se explica por su causa —el renglón existe, pero esta orden decidió que no lo lleva—.
 * Las lápidas quedan fuera a propósito: un renglón excluido no se compra, así que firmarlo no
 * significaría nada.
 *
 * Liberar es IDEMPOTENTE en el sentido útil: volver a firmar un renglón re-sella quién y cuándo
 * (Desarrollo lo revisó de nuevo), no truena.
 */
export async function liberarReceta(
  sesion: SesionUsuario,
  idOrden: number,
  cuerpo: DatosLiberarReceta,
  bd?: ContextoBd,
): Promise<RecetaOrden> {
  const datos = validarEntrada(esquemaLiberarRecetaCuerpo, cuerpo);
  return enRecetaEditable(sesion, idOrden, bd, async (tx, orden) => {
    const seleccion = datos.renglones;
    if (seleccion.length === 0) {
      throw new ErrorValidacion(
        'No se indicó ningún renglón que liberar. La receta se firma renglón por renglón: elige el ' +
          'que quieres autorizar.',
      );
    }
    const idsPorTipo = (tipo: TipoRenglonRecetaClave): number[] =>
      seleccion.filter((r) => r.tipo === tipo).map((r) => r.id);

    /** El `where` de una de las tres tablas (o `null` = de esa sección no se firma nada). */
    const dondeDe = (
      tipo: TipoRenglonRecetaClave,
    ): { idOrden: number; excluido: false; id: { in: number[] } } | null => {
      const ids = idsPorTipo(tipo);
      return ids.length === 0
        ? null
        : { idOrden: orden.id, excluido: false as const, id: { in: ids } };
    };

    const dondeTela = dondeDe('tela');
    const dondeAvio = dondeDe('avio');
    const dondeArte = dondeDe('arte');

    const [telas, avios, artes] = await Promise.all([
      dondeTela === null
        ? Promise.resolve([])
        : tx.ordenTela.findMany({
            where: dondeTela,
            select: { id: true, estado: true, excluido: true, liberadoEn: true },
          }),
      dondeAvio === null
        ? Promise.resolve([])
        : tx.ordenAvio.findMany({
            where: dondeAvio,
            select: { id: true, estado: true, excluido: true, liberadoEn: true },
          }),
      dondeArte === null
        ? Promise.resolve([])
        : tx.ordenArte.findMany({
            where: dondeArte,
            select: { id: true, estado: true, excluido: true, liberadoEn: true },
          }),
    ]);

    // D3: un id que no es de esta orden (o que es una lápida) se DICE, no se traga en silencio —
    // si no, "liberé 3 renglones" mentiría cuando en realidad se firmó uno.
    //
    // ⚠️ Y se dice la CAUSA CORRECTA. El `where` excluye las lápidas, así que un renglón excluido
    // caía en el mismo saco que un id de otra orden y contestaba "no encontrado": el renglón SÍ
    // existe, lo que pasa es que esta orden decidió que no lo lleva. Un mensaje que describe mal su
    // causa manda a buscar el error donde no está.
    const encontrados = new Set([
      ...telas.map((t) => `tela-${String(t.id)}`),
      ...avios.map((a) => `avio-${String(a.id)}`),
      ...artes.map((a) => `arte-${String(a.id)}`),
    ]);
    const perdidos = seleccion.filter((r) => !encontrados.has(`${r.tipo}-${String(r.id)}`));
    const primero = perdidos[0];
    if (primero !== undefined) {
      const lapida = await esLapidaDeLaOrden(tx, orden.id, primero.tipo, primero.id);
      if (lapida !== null) {
        throw new ErrorConflicto(
          `"${lapida}" está QUITADO de esta orden: no se compra, así que no hay nada que ` +
            'firmarle. Si de verdad va, tráelo de vuelta desde su renglón y entonces fírmalo.',
        );
      }
      throw new ErrorNoEncontrado('Renglón de la receta', primero.id);
    }

    // Llegar aquí con `total === 0` es imposible: la selección no está vacía y ya se probó que cada
    // id existe, está vivo y es de esta orden. Por eso no hay guarda de "receta vacía" — la que
    // había servía al desaparecido `alcance: 'todo'`, que sí podía no encontrar nada.
    const resumen = resumirReceta([...telas, ...avios, ...artes]);
    if (resumen.sinRevisar > 0) {
      throw new ErrorConflicto(
        resumen.sinRevisar === 1 && resumen.total === 1
          ? 'Este renglón todavía no está revisado. Márcalo revisado (o usa "marcar todo revisado") ' +
              'antes de liberarlo.'
          : `Quedan ${String(resumen.sinRevisar)} renglones sin revisar. Revísalos (o usa "marcar ` +
              'todo revisado") antes de liberar.',
      );
    }

    const firma = {
      liberadoEn: new Date(),
      liberadoPorId: sesion.id,
      ...datosModificacion(sesion),
    };
    await Promise.all([
      dondeTela === null
        ? Promise.resolve()
        : tx.ordenTela.updateMany({ where: dondeTela, data: firma }).then(() => undefined),
      dondeAvio === null
        ? Promise.resolve()
        : tx.ordenAvio.updateMany({ where: dondeAvio, data: firma }).then(() => undefined),
      dondeArte === null
        ? Promise.resolve()
        : tx.ordenArte.updateMany({ where: dondeArte, data: firma }).then(() => undefined),
    ]);

    await bitacoraReceta(tx, sesion, orden.id, 'MODIFICAR', {
      accion: 'liberar-receta',
      renglones: resumen.total,
      // Cuántos de los firmados NO lo estaban: es el número que dice si esta firma movió algo.
      nuevos: resumen.porLiberar,
      ajustados: resumen.ajustados,
      // A7: queda escrito EXACTAMENTE qué se firmó. Con la firma uno por uno esto es la traza de
      // quién autorizó qué, no un dato de relleno.
      seleccion,
    });
  });
}

/**
 * ⭐ TRAE DEL MODELO lo que le falta a la receta (`desarrollo.administrar`) — §Post-F9.73.
 *
 * Daniel (19-ago-2026): *"Si le falta algo a la receta y se genera la OP… ¿ya no puede jalar la info
 * del modelo? Podría llegar a ser común que le falte algo a la receta."* Tenía razón: el sistema YA
 * detectaba el faltante y hasta lo nombraba (`calcularDesalineacion` → *"El modelo ahora lleva «X», y
 * esta orden no lo tiene"*), pero la única salida era **volver a teclearlo** mirando el modelo en
 * otra pantalla. Y quien lo tecleaba era COMPRAS, que no es quien sabe si ese material va o no va.
 *
 * LAS CUATRO REGLAS, y las cuatro son de la decisión:
 *
 *  1. **Renglón por renglón, o todos de un jalón.** Sin `materiales` entra todo lo que falte.
 *  2. **Lo jala DESARROLLO.** Mismo permiso que firmar (`desarrollo.administrar`): *"las mismas
 *     manos que firman son las que jalan"*. Compras EXPLOTA, no captura.
 *  3. **Lo que se jala nace SIN LIBERAR**, para que pase por la misma firma que todo lo demás: entra
 *     como un pendiente más en la lista que el comprador ya está viendo (§Post-F9.72). Nace
 *     `revisado`, no `sin_revisar`: es una copia FIEL del modelo traída a propósito por quien
 *     revisa — el mismo criterio de `agregarRenglonReceta` — pero **sin firma**, que es lo que la
 *     decisión pide.
 *  4. 🔴 **NUNCA en silencio y NUNCA pisando lo ajustado.** Esta operación **solo CREA lo que no
 *     está**. Jamás toca un renglón existente:
 *       • el que ya está VIVO se respeta (si difiere del modelo, el camino es «Restaurar» en su
 *         renglón, que sí avisa de lo que pisa y lo deja en la bitácora);
 *       • la LÁPIDA se respeta con más razón: alguien decidió que esta orden NO lo lleva (la
 *         jareta), y resucitarla desde un botón masivo desharía esa decisión de negocio en silencio.
 *     Los dos casos vuelven en `respetados` **con su motivo redactado**: el modelo propone, la orden
 *     manda (D3).
 *
 * ⚠️ **No es "restaurar la receta".** Restaurar existe aparte y es por renglón, deliberado y con
 * `antes` íntegro en la bitácora. Traer del modelo no pisa nada, así que puede ser masivo sin miedo.
 *
 * 🔵 **V1-E3y — por qué esta operación NO lleva el bloqueo de "lo comprado no se saca"
 * (§Post-F9.79):** justamente por la regla 4. Los tres bucles de abajo solo hacen `create` cuando el
 * material NO está en la orden, y hacen `continue` en cuanto lo encuentran (vivo o lápida). No
 * escribe ni un campo de un renglón existente, así que no hay forma de sacar de la compra algo ya
 * comprado por esta puerta. Lo mismo vale para `agregarRenglonReceta`: agrega o REVIVE una lápida —
 * mete material a la receta, nunca lo saca.
 */
export async function traerDelModelo(
  sesion: SesionUsuario,
  idOrden: number,
  cuerpo: DatosTraerDelModelo = {},
  bd?: ContextoBd,
): Promise<TraerDelModeloResultado> {
  const datos = validarEntrada(esquemaTraerDelModeloCuerpo, cuerpo);
  const traidos: { tipo: TipoRenglonRecetaClave; material: string }[] = [];
  const respetados: ChoqueTraerDelModelo[] = [];

  const receta = await enRecetaEditable(
    sesion,
    idOrden,
    bd,
    async (tx, orden) => {
      const pedidos = datos.materiales;
      /** ¿Este material lo pidió el usuario EXPLÍCITAMENTE? (sin lista = "todo lo que falte"). */
      const loPidieronPorSuNombre = (tipo: TipoRenglonRecetaClave, id: number): boolean =>
        pedidos !== undefined &&
        pedidos.some((m) =>
          m.tipo !== tipo
            ? false
            : m.tipo === 'tela'
              ? m.idTela === id
              : m.tipo === 'avio'
                ? m.idAvio === id
                : m.idModeloArte === id,
        );
      /** ¿Este material entra en esta corrida? */
      const loPidieron = (tipo: TipoRenglonRecetaClave, id: number): boolean =>
        pedidos === undefined || loPidieronPorSuNombre(tipo, id);

      /**
       * ⚠️ **QUÉ CUENTA COMO CHOQUE, y qué NO** (hallazgo del reviewer).
       *
       * Un renglón que ya está en la orden **idéntico al modelo no decidió nada distinto**: no es
       * un choque, es simplemente que no falta. Reportarlo convertía una operación exitosa en un
       * muro de avisos falsos —una orden con 12 avíos alineados y 1 faltante daba 1 éxito y 12
       * "choques"— y ensuciaba la bitácora con 12 conflictos que nunca ocurrieron.
       *
       * Se reporta cuando:
       *  • lo PIDIERON por su nombre (preguntaron por ese material: merecen la respuesta), o
       *  • la orden se desvió A PROPÓSITO — lápida, ajuste propio o agregado a mano. Es la MISMA
       *    definición que usa la desalineación (`desviadoAProposito`), no una copia: "esta
       *    diferencia la puso una persona" es lo que hace que sea un choque y no un dato.
       */
      const hayQueReportar = (
        tipo: TipoRenglonRecetaClave,
        id: number,
        fila: { estado: EstadoRenglonReceta; agregadoAMano: boolean; excluido: boolean },
      ): boolean => loPidieronPorSuNombre(tipo, id) || desviadoAProposito(fila);

      const [telasModelo, aviosModelo, artesModelo] = await Promise.all([
        leerTelasBom(tx, orden.idModelo, orden.idEmpresa),
        leerAviosBom(tx, orden.idModelo, orden.idEmpresa),
        leerArtesModelo(tx, orden.idModelo),
      ]);

      const auditoria = datosCreacion(sesion);
      /** Un renglón traído del modelo: copia FIEL (revisado) y, sobre todo, SIN FIRMA. */
      const nace = {
        estado: EstadoRenglonReceta.revisado,
        agregadoAMano: false,
        excluido: false,
        liberadoEn: null,
        liberadoPorId: null,
        ...auditoria,
      } as const;

      /** Qué decir cuando la orden ya tiene el material y por eso no se trae. */
      const motivoDe = (excluido: boolean, ajustado: boolean): string =>
        excluido
          ? 'Esta orden decidió que NO lo lleva (se quitó a mano). Traerlo de vuelta es una decisión ' +
            'de negocio: si de verdad va, agrégalo desde su renglón.'
          : ajustado
            ? 'Ya está en esta orden con un ajuste propio, y el ajuste manda sobre el modelo. Si ' +
              'quieres el valor del modelo, usa «Restaurar» en su renglón.'
            : 'Ya está en la receta de esta orden. Si el modelo cambió y quieres su valor de hoy, ' +
              'usa «Restaurar» en su renglón.';

      // ── TELAS ──
      const filasTela = await tx.ordenTela.findMany({
        where: { idOrden: orden.id },
        select: {
          idTela: true,
          excluido: true,
          estado: true,
          agregadoAMano: true,
          tela: { select: { nombre: true } },
        },
      });
      const telaPorId = new Map(filasTela.map((f) => [f.idTela, f]));
      for (const t of telasModelo) {
        if (!loPidieron('tela', t.idTela)) continue;
        const ya = telaPorId.get(t.idTela);
        if (ya !== undefined) {
          if (hayQueReportar('tela', t.idTela, ya)) {
            respetados.push({
              tipo: 'tela',
              material: ya.tela.nombre,
              motivo: motivoDe(ya.excluido, ya.estado === EstadoRenglonReceta.ajustado),
            });
          }
          continue;
        }
        await tx.ordenTela.create({
          data: {
            idOrden: orden.id,
            idTela: t.idTela,
            consumoPorPrenda: new Prisma.Decimal(t.consumoPorPrenda),
            precio: precioDecimal(t.precioCosteo),
            paraPreCosto: t.paraPreCosto,
            paraProduccion: t.paraProduccion,
            paraCosto: t.paraCosto,
            idTelaProveedor: t.idTelaProveedor,
            ...nace,
          },
        });
        traidos.push({ tipo: 'tela', material: t.nombre });
      }

      // ── AVÍOS (con sus medidas por talla, R18) ──
      const filasAvio = await tx.ordenAvio.findMany({
        where: { idOrden: orden.id },
        select: {
          idAvio: true,
          excluido: true,
          estado: true,
          agregadoAMano: true,
          avio: { select: { clave: true, descripcion: true } },
        },
      });
      const avioPorId = new Map(filasAvio.map((f) => [f.idAvio, f]));
      for (const a of aviosModelo) {
        if (!loPidieron('avio', a.idAvio)) continue;
        const ya = avioPorId.get(a.idAvio);
        if (ya !== undefined) {
          if (hayQueReportar('avio', a.idAvio, ya)) {
            respetados.push({
              tipo: 'avio',
              material: `${ya.avio.clave} — ${ya.avio.descripcion}`,
              motivo: motivoDe(ya.excluido, ya.estado === EstadoRenglonReceta.ajustado),
            });
          }
          continue;
        }
        // V1-E3g: un avío que se compra POR MEDIDA no lleva cantidad por talla, aunque el BOM traiga
        // el toggle heredado encendido (misma normalización que la copia al crear la orden).
        const porMedida = await avioEsPorMedida(tx, a.idAvio);
        const fila = await tx.ordenAvio.create({
          data: {
            idOrden: orden.id,
            idAvio: a.idAvio,
            consumoPorPrenda: new Prisma.Decimal(a.consumoPorPrenda),
            precio: precioDecimal(a.precioCosteo),
            paraPreCosto: a.paraPreCosto,
            paraProduccion: a.paraProduccion,
            paraCosto: a.paraCosto,
            consumoPorTalla: porMedida ? false : a.consumoPorTalla,
            idAvioProveedor: a.idAvioProveedor,
            ...nace,
          },
          select: { id: true },
        });
        const medidas = await tx.modeloAvioTalla.findMany({
          where: { idModelo: orden.idModelo, idAvio: a.idAvio },
          select: { idTalla: true, consumo: true, idAvioMedida: true },
        });
        if (medidas.length > 0) {
          await tx.ordenAvioTalla.createMany({
            data: medidas.map((m) => ({
              idOrdenAvio: fila.id,
              idTalla: m.idTalla,
              consumo: m.consumo,
              idAvioMedida: m.idAvioMedida,
              ...auditoria,
            })),
          });
        }
        traidos.push({ tipo: 'avio', material: `${a.clave} — ${a.descripcion}` });
      }

      // ── ARTES (casados por su TRAZA `idModeloArte`, V1-E3f) ──
      const filasArte = await tx.ordenArte.findMany({
        where: { idOrden: orden.id },
        select: {
          idModeloArte: true,
          excluido: true,
          estado: true,
          agregadoAMano: true,
          descripcion: true,
        },
      });
      const artePorTraza = new Map(
        filasArte.flatMap((f) => (f.idModeloArte === null ? [] : [[f.idModeloArte, f] as const])),
      );
      for (const ar of artesModelo) {
        if (!loPidieron('arte', ar.id)) continue;
        const ya = artePorTraza.get(ar.id);
        if (ya !== undefined) {
          if (hayQueReportar('arte', ar.id, ya)) {
            respetados.push({
              tipo: 'arte',
              material: ya.descripcion,
              motivo: motivoDe(ya.excluido, ya.estado === EstadoRenglonReceta.ajustado),
            });
          }
          continue;
        }
        await tx.ordenArte.create({
          data: {
            idOrden: orden.id,
            idModeloArte: ar.id,
            descripcion: ar.descripcion,
            posicion: ar.posicion,
            puntadas: ar.puntadas,
            precio: precioDecimal(ar.precio),
            idTipoArte: ar.idTipoArte,
            idProveedor: ar.idProveedor,
            ...nace,
          },
        });
        traidos.push({ tipo: 'arte', material: ar.descripcion });
      }

      // ⚠️ H6 — LO QUE SE PIDIÓ Y EL MODELO YA NO LLEVA (D3: se dice con nombre, no se calla).
      //
      // El aviso de faltante que trae el `idMaterialModelo` puede venir de una pantalla abierta hace
      // rato: entre medias alguien pudo quitar ese material del BOM. Sin esto, los tres bucles de
      // arriba simplemente no encontraban qué traer, las dos listas volvían vacías y el panel decía
      // *"No hay nada del modelo que traer: esta orden ya lo tiene todo"* — **falso**, y peor: la
      // acción que el usuario pidió no ocurrió y nadie se lo dijo.
      for (const m of pedidos ?? []) {
        const enElModelo =
          m.tipo === 'tela'
            ? telasModelo.some((t) => t.idTela === m.idTela)
            : m.tipo === 'avio'
              ? aviosModelo.some((a) => a.idAvio === m.idAvio)
              : artesModelo.some((a) => a.id === m.idModeloArte);
        if (enElModelo) continue;
        const id = m.tipo === 'tela' ? m.idTela : m.tipo === 'avio' ? m.idAvio : m.idModeloArte;
        respetados.push({
          tipo: m.tipo,
          material: (await nombreDelMaterial(tx, m.tipo, id)) ?? `#${String(id)}`,
          motivo:
            'El modelo YA NO lo lleva, así que no hay de dónde traerlo. El aviso que lo pedía es ' +
            'de antes de que se quitara del modelo: vuelve a abrir la receta para verla al día.',
        });
      }

      // D3/A7: la bitácora guarda LAS DOS listas — lo que entró y lo que se respetó con su motivo.
      // "No lo trajo en silencio" no es solo la pantalla: tiene que quedar escrito.
      await bitacoraReceta(tx, sesion, orden.id, 'CREAR', {
        accion: 'traer-del-modelo',
        ...(datos.materiales === undefined
          ? { alcance: 'todo-lo-que-falte' }
          : { pedidos: datos.materiales }),
        traidos,
        respetados,
      });
    },
    // Agrega material a la receta, pero SOLO material NUEVO y SIN FIRMA: no hay ninguna firma ajena
    // que invalidar, así que no se declara ningún renglón tocado (ver `enRecetaEditable`).
    { cambiaElContenido: true },
  );

  return { receta, traidos, respetados };
}

/**
 * Cómo se llama un material del CATÁLOGO (no de la receta), para poder nombrarlo en un aviso aunque
 * ni la orden ni el modelo lo lleven ya. `null` si el id no existe.
 */
async function nombreDelMaterial(
  tx: Tx,
  tipo: TipoRenglonRecetaClave,
  id: number,
): Promise<string | null> {
  if (tipo === 'tela') {
    const fila = await tx.tela.findUnique({ where: { id }, select: { nombre: true } });
    return fila?.nombre ?? null;
  }
  if (tipo === 'avio') {
    const fila = await tx.avio.findUnique({
      where: { id },
      select: { clave: true, descripcion: true },
    });
    return fila === null ? null : `${fila.clave} — ${fila.descripcion}`;
  }
  const fila = await tx.modeloArte.findUnique({ where: { id }, select: { descripcion: true } });
  return fila?.descripcion ?? null;
}

/**
 * ¿Ese id es una LÁPIDA de esta orden? Devuelve cómo se llama el material (para nombrarlo en el
 * mensaje) o `null` si el renglón no existe aquí. Solo para explicar por qué un id de una selección
 * no entró al alcance — la diferencia entre *"no existe"* y *"existe pero está quitado"*.
 */
async function esLapidaDeLaOrden(
  tx: Tx,
  idOrden: number,
  tipo: TipoRenglonRecetaClave,
  idRenglon: number,
): Promise<string | null> {
  if (tipo === 'tela') {
    const fila = await tx.ordenTela.findFirst({
      where: { id: idRenglon, idOrden, excluido: true },
      select: { tela: { select: { nombre: true } } },
    });
    return fila === null ? null : fila.tela.nombre;
  }
  if (tipo === 'avio') {
    const fila = await tx.ordenAvio.findFirst({
      where: { id: idRenglon, idOrden, excluido: true },
      select: { avio: { select: { clave: true, descripcion: true } } },
    });
    return fila === null ? null : `${fila.avio.clave} — ${fila.avio.descripcion}`;
  }
  const fila = await tx.ordenArte.findFirst({
    where: { id: idRenglon, idOrden, excluido: true },
    select: { descripcion: true },
  });
  return fila === null ? null : fila.descripcion;
}

// ── ⭐ V1-E3y — NO SE SACA DE LA RECETA LO YA COMPRADO (§Post-F9.79) ─────────────────────────

/**
 * El estado de un renglón de la receta, **reducido a lo que decide su REQUERIDO**. Se usa dos veces
 * por mutación: con el estado ACTUAL y con el RESULTANTE.
 *
 * Los dos campos de avío son opcionales porque una TELA no los tiene: sin ellos el cálculo cae al
 * camino `consumoPorPrenda × piezas`, que es exactamente lo que el MRP hace con las telas.
 */
export interface RenglonParaRequerido {
  excluido: boolean;
  paraProduccion: boolean;
  consumoPorPrenda: number;
  /** Sólo avíos (R18): ¿la cantidad sale de las medidas por talla? */
  consumoPorTalla?: boolean | undefined;
  /** Sólo avíos (R18): las medidas por talla vigentes o resultantes. */
  tallas?: readonly { idTalla: number; consumo: number }[] | undefined;
}

/** Las piezas de la orden: el total y su desglose por talla (D4). */
export interface PiezasDeLaOrden {
  total: number;
  porTalla: ReadonlyMap<number, number>;
}

/**
 * ⭐ CUÁNTO de este material pide la orden con este estado del renglón — el **requerido REAL**, no
 * un proxy.
 *
 * ⚠️ **Por qué no basta con mirar `paraProduccion` y `consumoPorPrenda`** (hallazgo del reviewer que
 * tumbó la primera versión de esta guarda): en un avío **por talla** (R18, `consumoPorTalla`) el
 * `consumoPorPrenda` del renglón **no es lo que explota** — es sólo el *fallback* de las tallas sin
 * medida. Un avío comprado con `consumoPorPrenda = 2` y sus medidas puestas **todas en 0**
 * (`esquemaRecetaTallaEntrada.consumo` es `nonnegative`, así que el 0 pasa) explota a **0** con los
 * dos campos intactos: la MISMA contradicción, por una tercera puerta. Y al revés: un avío con
 * `consumoPorPrenda = 0` y medidas > 0 **sí** pide material, y un criterio de dos campos lo daba por
 * fuera y no lo protegía aunque estuviera comprado.
 *
 * Por eso el criterio no es *"estos campos"* sino **el número que de verdad manda**, y se calcula
 * con `requeridoAvioReceta` — la MISMA función que usan la explosión MRP (`compras/mrp.ts`) y la
 * habilitación. Una sola definición de R18 en todo el sistema: si la regla cambia, esta guarda
 * cambia con ella y no puede derivar.
 *
 * `excluido` o `!paraProduccion` cortan antes porque el MRP los filtra en el `where` (junto con
 * `liberadoEn != null`, que aquí NO se mira a propósito: una firma revocada es un pendiente de
 * firma, no una salida — ver la nota de cierre de V1-E3y).
 *
 * Es PURA (se exporta para poder probarla sin base de datos, mismo criterio que `resumirReceta`).
 */
export function requeridoDelRenglon(
  renglon: RenglonParaRequerido,
  piezas: PiezasDeLaOrden,
): number {
  if (renglon.excluido || !renglon.paraProduccion) return 0;
  return requeridoAvioReceta(
    {
      consumoPorPrenda: new Prisma.Decimal(renglon.consumoPorPrenda),
      consumoPorTalla: renglon.consumoPorTalla ?? false,
      tallas: (renglon.tallas ?? []).map((t) => ({
        idTalla: t.idTalla,
        consumo: new Prisma.Decimal(t.consumo),
      })),
    },
    piezas.total,
    new Map(piezas.porTalla),
  ).requerido;
}

/**
 * ⭐ ¿El cambio SACA de la compra un material que hoy sí pide la orden?
 *
 * Un criterio ÚNICO y real para las tres puertas —quitar, dejarlo en cero (por consumo **o por
 * medidas**) y apagar `paraProduccion`—: **antes pedía algo y después no pide nada**. Ni una lista
 * de campos que haya que acordarse de ampliar cada vez que aparezca otra forma de llegar al mismo
 * sitio.
 *
 * El lado *"antes > 0"* es el que evita atrapar a nadie: un renglón que YA estaba fuera (o una orden
 * sin matriz capturada, que no pide nada de nada) no se puede "sacar" otra vez, así que se deja
 * pasar. La puerta se cierra al que quiere salir, no al que nunca entró.
 */
export function sacaDeLaCompra(
  antes: RenglonParaRequerido,
  despues: RenglonParaRequerido | null,
  piezas: PiezasDeLaOrden,
): boolean {
  if (requeridoDelRenglon(antes, piezas) <= 0) return false;
  // `null` = el renglón se va (quitar): su requerido resultante es cero por definición.
  return despues === null || requeridoDelRenglon(despues, piezas) <= 0;
}

/**
 * Las piezas de la orden agrupadas por talla (D4) — el insumo de R18. Mismo dato que arma
 * `piezasPorTallaOrden` en el MRP, pero agregado en la BASE (`groupBy`) porque aquí no hace falta
 * traerse la matriz entera para contar.
 */
async function piezasDeLaOrden(tx: Tx, idOrden: number): Promise<PiezasDeLaOrden> {
  const filas = await tx.ordenLineaTalla.groupBy({
    by: ['idTalla'],
    where: { ordenLinea: { idOrden } },
    _sum: { cantidad: true },
  });
  const porTalla = new Map<number, number>();
  let total = 0;
  for (const f of filas) {
    const piezas = f._sum.cantidad ?? 0;
    porTalla.set(f.idTalla, piezas);
    total += piezas;
  }
  return { total, porTalla };
}

/** El renglón de TELA de la receta, reducido a lo que decide su requerido. */
function telaParaRequerido(f: {
  excluido: boolean;
  paraProduccion: boolean;
  consumoPorPrenda: Prisma.Decimal;
}): RenglonParaRequerido {
  return {
    excluido: f.excluido,
    paraProduccion: f.paraProduccion,
    consumoPorPrenda: num(f.consumoPorPrenda),
  };
}

/** El renglón de AVÍO de la receta, con sus medidas por talla (R18). */
function avioParaRequerido(f: {
  excluido: boolean;
  paraProduccion: boolean;
  consumoPorPrenda: Prisma.Decimal;
  consumoPorTalla: boolean;
  tallas: readonly { idTalla: number; consumo: Prisma.Decimal }[];
}): RenglonParaRequerido {
  return {
    excluido: f.excluido,
    paraProduccion: f.paraProduccion,
    consumoPorPrenda: num(f.consumoPorPrenda),
    consumoPorTalla: f.consumoPorTalla,
    tallas: f.tallas.map((t) => ({ idTalla: t.idTalla, consumo: num(t.consumo) })),
  };
}

/**
 * ⭐ La cascada de UNA medida por talla que llega en el cuerpo: **`consumo` explícito → la medida
 * PREVIA de esa talla → el consumo por prenda del renglón**. El cuerpo del PATCH trae `consumo`
 * **opcional**, así que "no vino" no es "cero".
 *
 * ⚠️ **Es la ÚNICA definición de esa cascada en el sistema, y eso es deliberado.** La usan las DOS
 * partes que tienen que coincidir: `reemplazarMedidasAvio`, que la ESCRIBE, y la guarda de V1-E3y,
 * que necesita saber qué quedaría para decidir si el requerido se va a cero. Escribirla dos veces
 * era la tentación obvia —y habría sido un defecto silencioso: la guarda calcularía sobre medidas
 * que no son las que se van a guardar, y nadie se enteraría hasta que dejara pasar justo el caso que
 * vino a cerrar—. Se exporta para poder probarla sin base de datos.
 */
export function medidasResultantes(
  pedidas: readonly { idTalla: number; consumo?: number | undefined }[],
  previas: readonly { idTalla: number; consumo: Prisma.Decimal }[],
  consumoPorPrendaResultante: number,
): { idTalla: number; consumo: number }[] {
  const previo = new Map(previas.map((t) => [t.idTalla, num(t.consumo)]));
  return pedidas.map((t) => ({
    idTalla: t.idTalla,
    consumo: t.consumo ?? previo.get(t.idTalla) ?? consumoPorPrendaResultante,
  }));
}

/**
 * ⭐ Exige que este MATERIAL de la receta no esté ya COMPRADO para esta orden (§Post-F9.79).
 *
 * Daniel: *"¿Qué pasa si ya se liberó un renglón, se hace la OC de ese avío… se puede luego quitar?
 * Eso no está bien."* Lo que quedaba tras hacerlo era una CONTRADICCIÓN: la OC dice *"compramos esto
 * para la orden N"* y la receta de N dice *"esto no va"* — y la explosión deja de contarlo, así que
 * el *"qué tengo / qué falta"* ya no cuadra con lo comprado. Peor con un renglón `agregadoAMano`,
 * que al quitarse se BORRA.
 *
 * **Va por MATERIAL, no por orden entera**: cada línea de OC guarda de qué tela o avío es
 * (`idTela`/`idAvio`) y a qué orden de producción se compró (`idOrden`), así que se bloquea
 * exactamente el renglón comprado y ninguno más.
 *
 * **Solo aplica a TELA y AVÍO**, y no es un olvido: una línea de OC solo puede apuntar a una tela o
 * a un avío del catálogo (o ser texto libre). No existe forma de ligar una OC a un ARTE concreto de
 * la receta, así que no hay nada que comprobar de ese lado.
 *
 * **A9**: la OC tiene que ser de la MISMA empresa que la orden; una de otra empresa no bloquea nada
 * (ni se nombra en el error).
 *
 * El mensaje es ACCIONABLE a propósito: nombra el material, el/los FOLIO(S) de la OC y qué hacer.
 * Si la OC ya se recibió, dice que ese camino NO existe y por qué — DANIEL, 20-ago-2026: *"una vez
 * recibido no se puede desautorizar"*.
 */
async function exigirNoSacarLoComprado(
  tx: Tx,
  orden: OrdenParaReceta,
  tipo: 'tela' | 'avio',
  idMaterial: number,
  nombreMaterial: string,
  queSeIntenta: string,
  /**
   * ⭐ §Post-F9.105 — CÓMO SE ARREGLA, cuando el camino de siempre (des-autorizar la OC) **no es el
   * camino**. El mensaje por defecto asume que alguien quiso SACAR el material; si el requerido se
   * fue a cero por la normalización automática del avío por medida, quien guardaba sólo quería
   * cambiar un precio, y mandarlo a des-autorizar una OC sería mandarlo a romper algo que está
   * bien. `null` = el texto de siempre.
   */
  comoArreglarlo: string | null = null,
): Promise<void> {
  const lineas = await tx.ordenCompraLinea.findMany({
    where: {
      idOrden: orden.id,
      ...(tipo === 'tela' ? { idTela: idMaterial } : { idAvio: idMaterial }),
      ordenCompra: {
        idEmpresa: orden.idEmpresa,
        estatus: { in: [...ESTATUS_OC_COMPROMETIDA] },
      },
    },
    select: { ordenCompra: { select: { numCompra: true, estatus: true } } },
    orderBy: { id: 'asc' },
  });
  if (lineas.length === 0) return;

  const folios = [...new Set(lineas.map((l) => Number(l.ordenCompra.numCompra)))].sort(
    (a, b) => a - b,
  );
  const listaFolios = folios.map((f) => `#${String(f)}`).join(', ');
  const plural = folios.length > 1;
  const recibida = algunaRecibida(lineas.map((l) => l.ordenCompra.estatus));

  if (recibida) {
    throw new ErrorConflicto(
      `"${nombreMaterial}" ya se RECIBIÓ contra ${plural ? 'las órdenes de compra' : 'la orden de compra'} ` +
        `${listaFolios} de esta orden de producción: no se puede ${queSeIntenta}. ` +
        (comoArreglarlo ??
          'El material ya entró al inventario, y des-autorizar una OC recibida NO es posible — el ' +
            'camino honesto es una devolución o un ajuste de inventario, no deshacer la firma.'),
    );
  }
  // ⚠️ El mensaje NO manda al usuario a hacer algo que probablemente NO PUEDE: des-autorizar es una
  // llave del perfil de Dirección (`compras.desautorizar`), y quien edita la receta casi nunca la
  // tiene. Decir "des-autorízala" a secas dejaría a la mayoría dando vueltas contra un 403. Se
  // nombra el camino Y a quién pedírselo, para que el aviso sirva a los dos lados del mostrador.
  throw new ErrorConflicto(
    `"${nombreMaterial}" ya está COMPRADO para esta orden en ${plural ? 'las órdenes de compra' : 'la orden de compra'} ` +
      `${listaFolios} (autorizada${plural ? 's' : ''}): no se puede ${queSeIntenta}. ` +
      (comoArreglarlo ??
        `Si de verdad no va, hay que DES-AUTORIZAR ${plural ? 'esas órdenes de compra' : 'esa orden de compra'} ` +
          'en Compras › Órdenes de compra y volver aquí. Ese botón es del perfil de Dirección: si ' +
          'no te aparece, pídeselo a quien lo tenga.'),
  );
}

/**
 * QUITA la firma de los renglones tocados que la tenían, y devuelve cuáles se re-cerraron (para la
 * bitácora). Se re-lee el `liberadoEn` desde la base a propósito: la mutación ya escribió, así que
 * lo que valga la pena revocar es lo que la base diga AHORA.
 */
async function revocarFirmaDeRenglones(
  tx: Tx,
  sesion: SesionUsuario,
  idOrden: number,
  tocados: readonly { tipo: TipoRenglonRecetaClave; idRenglon: number }[],
): Promise<{ tipo: TipoRenglonRecetaClave; idRenglon: number }[]> {
  const ids = (tipo: TipoRenglonRecetaClave): number[] => [
    ...new Set(tocados.filter((t) => t.tipo === tipo).map((t) => t.idRenglon)),
  ];
  const limpiar = { liberadoEn: null, liberadoPorId: null, ...datosModificacion(sesion) };
  const revocados: { tipo: TipoRenglonRecetaClave; idRenglon: number }[] = [];

  const idsTela = ids('tela');
  if (idsTela.length > 0) {
    const filas = await tx.ordenTela.findMany({
      where: { idOrden, id: { in: idsTela }, liberadoEn: { not: null } },
      select: { id: true },
    });
    if (filas.length > 0) {
      await tx.ordenTela.updateMany({
        where: { id: { in: filas.map((f) => f.id) } },
        data: limpiar,
      });
      revocados.push(...filas.map((f) => ({ tipo: 'tela' as const, idRenglon: f.id })));
    }
  }
  const idsAvio = ids('avio');
  if (idsAvio.length > 0) {
    const filas = await tx.ordenAvio.findMany({
      where: { idOrden, id: { in: idsAvio }, liberadoEn: { not: null } },
      select: { id: true },
    });
    if (filas.length > 0) {
      await tx.ordenAvio.updateMany({
        where: { id: { in: filas.map((f) => f.id) } },
        data: limpiar,
      });
      revocados.push(...filas.map((f) => ({ tipo: 'avio' as const, idRenglon: f.id })));
    }
  }
  const idsArte = ids('arte');
  if (idsArte.length > 0) {
    const filas = await tx.ordenArte.findMany({
      where: { idOrden, id: { in: idsArte }, liberadoEn: { not: null } },
      select: { id: true },
    });
    if (filas.length > 0) {
      await tx.ordenArte.updateMany({
        where: { id: { in: filas.map((f) => f.id) } },
        data: limpiar,
      });
      revocados.push(...filas.map((f) => ({ tipo: 'arte' as const, idRenglon: f.id })));
    }
  }
  return revocados;
}

/**
 * ⭐ LA INVARIANTE DEL DERIVADO, en una sola línea y PURA: *"no queda ningún renglón vivo sin
 * firmar"*. Vive aparte —y exportada— porque es la regla que decide si `Orden.recetaLiberadaEn` se
 * sella, y de ahí cuelga el semáforo de "orden completa".
 *
 * ⚠️ **Una receta VACÍA es `false`, no `true`.** `[].every(...)` contesta `true`, así que sin el
 * `length > 0` una receta que se quedó sin renglones vivos se sellaría como "liberada completa" y
 * el semáforo diría *orden completa* con una receta que no tiene nada — la misma mentira que
 * `liberarReceta` rechaza de frente ("liberar nada sería mentir"). El caso llega solo: excluir el
 * último renglón vivo pasa por aquí.
 */
export function recetaCompletamenteLiberada(
  vivos: readonly { liberadoEn: Date | null }[],
): boolean {
  return vivos.length > 0 && vivos.every((f) => f.liberadoEn !== null);
}

/**
 * ⭐ MANTIENE `Orden.recetaLiberadaEn` como DERIVADO (V1-E3h): *"no queda ningún renglón vivo sin
 * firmar"*. Es lo que leen el semáforo de "orden completa" (`requisitos-orden.ts`) y el detalle de
 * la orden; la PUERTA DE COMPRA ya no lo consulta (pregunta renglón por renglón).
 *
 * Lo mantiene el DOMINIO y solo el dominio (nunca la UI, nunca una vista): se llama al final de
 * TODA mutación de receta, porque hasta excluir un renglón pendiente puede dejar la receta completa.
 * La fecha que se sella es la de la firma MÁS RECIENTE, no `now()`: "cuándo quedó completa" es
 * cuándo se firmó el último renglón que faltaba.
 *
 * Una receta VACÍA (sin renglones vivos) NO cuenta como liberada: sería decir que se revisó nada.
 */
async function sincronizarLiberacionOrden(
  tx: Tx,
  sesion: SesionUsuario,
  idOrden: number,
): Promise<void> {
  const donde = { idOrden, excluido: false } as const;
  const [telas, avios, artes] = await Promise.all([
    tx.ordenTela.findMany({ where: donde, select: { liberadoEn: true, liberadoPorId: true } }),
    tx.ordenAvio.findMany({ where: donde, select: { liberadoEn: true, liberadoPorId: true } }),
    tx.ordenArte.findMany({ where: donde, select: { liberadoEn: true, liberadoPorId: true } }),
  ]);
  const vivos = [...telas, ...avios, ...artes];
  const todoFirmado = recetaCompletamenteLiberada(vivos);

  const actual = await tx.orden.findUniqueOrThrow({
    where: { id: idOrden },
    select: { recetaLiberadaEn: true, recetaLiberadaPorId: true },
  });

  if (!todoFirmado) {
    if (actual.recetaLiberadaEn === null) return;
    await tx.orden.update({
      where: { id: idOrden },
      data: { recetaLiberadaEn: null, recetaLiberadaPorId: null, ...datosModificacion(sesion) },
    });
    return;
  }

  // La última firma manda (y con ella, quién la puso).
  let ultima = vivos[0] as { liberadoEn: Date | null; liberadoPorId: string | null };
  for (const f of vivos) {
    if ((f.liberadoEn?.getTime() ?? 0) >= (ultima.liberadoEn?.getTime() ?? 0)) ultima = f;
  }
  if (actual.recetaLiberadaEn?.getTime() === ultima.liberadoEn?.getTime()) return;
  await tx.orden.update({
    where: { id: idOrden },
    data: {
      recetaLiberadaEn: ultima.liberadoEn,
      recetaLiberadaPorId: ultima.liberadoPorId,
      ...datosModificacion(sesion),
    },
  });
}

// ── Helpers internos ───────────────────────────────────────────────────────────────────────

/** Bitácora uniforme de la receta (A7). La entidad es la ORDEN: es la que audita el negocio. */
async function bitacoraReceta(
  tx: Tx,
  sesion: SesionUsuario,
  idOrden: number,
  accion: 'CREAR' | 'MODIFICAR' | 'CANCELAR',
  datos: object,
): Promise<void> {
  await registrarBitacora(tx, sesion, {
    entidad: 'RecetaOrden',
    idEntidad: idOrden,
    accion,
    datos,
  });
}

/**
 * Reemplaza el juego COMPLETO de medidas por talla de un renglón de avío (set-completo, A2).
 *
 * ⭐ V1-E3g: `consumo` puede venir SIN capturar (avío "por medida": por talla sólo se elige QUÉ se
 * pide). En ese caso NO se inventa un cero —envenenaría el requerido— ni se pisa lo que había: se
 * conserva la cantidad que la fila ya tenía y, si la fila es nueva, se siembra el `consumoPorPrenda`
 * CONGELADO del renglón, que es la cantidad correcta (1 pza por prenda).
 */
async function reemplazarMedidasAvio(
  tx: Tx,
  sesion: SesionUsuario,
  idOrdenAvio: number,
  tallas: {
    idTalla: number;
    consumo?: number | undefined;
    idAvioMedida?: number | null | undefined;
  }[],
): Promise<void> {
  const previas = await tx.ordenAvioTalla.findMany({
    where: { idOrdenAvio },
    select: { idTalla: true, consumo: true },
  });
  await tx.ordenAvioTalla.deleteMany({ where: { idOrdenAvio } });
  if (tallas.length === 0) return;

  const renglon = await tx.ordenAvio.findUniqueOrThrow({
    where: { id: idOrdenAvio },
    select: { consumoPorPrenda: true },
  });
  // ⭐ La cascada vive en UN solo lugar (`medidasResultantes`), y la guarda de V1-E3y la reusa para
  // saber QUÉ va a quedar escrito aquí. Repetirla sería dejar que las dos deriven.
  const resueltas = new Map(
    medidasResultantes(tallas, previas, num(renglon.consumoPorPrenda)).map((t) => [
      t.idTalla,
      t.consumo,
    ]),
  );

  await tx.ordenAvioTalla.createMany({
    data: tallas.map((t) => ({
      idOrdenAvio,
      idTalla: t.idTalla,
      consumo: new Prisma.Decimal(resueltas.get(t.idTalla) ?? 0),
      idAvioMedida: t.idAvioMedida ?? null,
      ...datosCreacion(sesion),
    })),
  });
}

/**
 * Cuáles de estos avíos son "por medida" (≥1 `AvioMedida` ACTIVA), EN UNA sola consulta. Mismo
 * criterio que `modoCapturaAvio` y que el precosto. Se resuelve en lote porque el nacimiento de la
 * receta recorre TODOS los avíos del modelo: preguntar uno por uno sería un N+1 en el camino por el
 * que pasa cada orden.
 */
async function aviosPorMedida(tx: Tx, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const filas = await tx.avioMedida.findMany({
    where: { idAvio: { in: ids }, activo: true },
    select: { idAvio: true },
    distinct: ['idAvio'],
  });
  return new Set(filas.map((f) => f.idAvio));
}

/**
 * ¿El avío es "por medida"? (≥1 `AvioMedida` ACTIVA). Mismo criterio que `modoCapturaAvio` y que el
 * precosto — se consulta aquí porque en las rutas de escritura no siempre hay la fila proyectada.
 */
async function avioEsPorMedida(tx: Tx, idAvio: number): Promise<boolean> {
  return (await aviosPorMedida(tx, [idAvio])).has(idAvio);
}

/**
 * Normaliza el toggle `consumoPorTalla` que llega del cliente: en un avío "por medida" la cantidad
 * NO varía por talla (el cierre es 1 pza), así que el toggle queda en **false**. Si se dejara
 * encendido, unas cantidades por talla que la pantalla ya ni muestra seguirían mandando en el
 * requerido del MRP, en la sombra (V1-E3g, §Post-F9.66). `undefined` (el PATCH no lo trae) se
 * respeta tal cual: una lectura o un cambio de otro campo no toca lo que nadie pidió tocar.
 */
function normalizarConsumoPorTalla(
  deseado: boolean | undefined,
  porMedida: boolean,
): boolean | undefined {
  if (deseado === undefined) return undefined;
  return porMedida ? false : deseado;
}

/** Renglón de tela de ESTA orden, o `ErrorNoEncontrado` (A9 del sub-recurso). */
async function exigirRenglonTela(tx: Tx, idOrden: number, id: number) {
  const fila = await tx.ordenTela.findFirst({
    where: { id, idOrden },
    select: { ...SELECT_TELA },
  });
  if (fila === null) throw new ErrorNoEncontrado('Renglón de tela de la receta', id);
  return fila;
}

/** Renglón de avío de ESTA orden, o `ErrorNoEncontrado`. */
async function exigirRenglonAvio(tx: Tx, idOrden: number, id: number) {
  const fila = await tx.ordenAvio.findFirst({
    where: { id, idOrden },
    select: { ...SELECT_AVIO },
  });
  if (fila === null) throw new ErrorNoEncontrado('Renglón de avío de la receta', id);
  return fila;
}

/** Renglón de arte de ESTA orden, o `ErrorNoEncontrado`. */
async function exigirRenglonArte(tx: Tx, idOrden: number, id: number) {
  const fila = await tx.ordenArte.findFirst({
    where: { id, idOrden },
    select: { ...SELECT_ARTE },
  });
  if (fila === null) throw new ErrorNoEncontrado('Arte de la receta', id);
  return fila;
}

/** La tela existe (y no está descontinuada) — mismo criterio que el BOM del modelo. */
async function exigirTelaExiste(tx: Tx, idTela: number): Promise<void> {
  const tela = await tx.tela.findUnique({ where: { id: idTela }, select: { activo: true } });
  if (tela === null) throw new ErrorValidacion('La tela seleccionada no existe.');
  if (!tela.activo) {
    throw new ErrorValidacion('La tela seleccionada está descontinuada.');
  }
}

/** El avío existe (y está activo). */
async function exigirAvioExiste(tx: Tx, idAvio: number): Promise<void> {
  const avio = await tx.avio.findUnique({ where: { id: idAvio }, select: { activo: true } });
  if (avio === null) throw new ErrorValidacion('El avío seleccionado no existe.');
  if (!avio.activo) {
    throw new ErrorValidacion('El avío seleccionado está desactivado.');
  }
}

/**
 * El TIPO de arte existe, está activo y está marcado como arte (V1-E3f, catálogo único). Mismo
 * criterio que el arte del modelo (`arte-modelo.ts`): sin la última condición se podría congelar
 * en la orden un arte "de costura", que es justo lo que la bandera vino a evitar.
 */
async function exigirTipoArteExiste(tx: Tx, idTipoArte: number): Promise<void> {
  const tipo = await tx.tipoProceso.findUnique({
    where: { id: idTipoArte },
    select: { nombre: true, activo: true, esArte: true },
  });
  if (tipo === null) throw new ErrorValidacion('El tipo de arte seleccionado no existe.');
  if (!tipo.activo) {
    throw new ErrorValidacion(`El tipo "${tipo.nombre}" está desactivado y no se puede usar.`);
  }
  if (!tipo.esArte) {
    throw new ErrorValidacion(`El proceso "${tipo.nombre}" no está marcado como tipo de arte.`);
  }
}

/** El proveedor existe y está activo (mismo criterio que el arte del modelo). */
async function exigirProveedorExiste(tx: Tx, idProveedor: number): Promise<void> {
  const proveedor = await tx.proveedor.findUnique({
    where: { id: idProveedor },
    select: { nombre: true, activo: true },
  });
  if (proveedor === null) throw new ErrorValidacion('El proveedor seleccionado no existe.');
  if (!proveedor.activo) {
    throw new ErrorValidacion(
      `El proveedor "${proveedor.nombre}" está desactivado y no se puede asignar.`,
    );
  }
}

// ── 5. Lectura FOCALIZADA para el impreso de la orden ──────────────────────────────────────

/** La receta como la necesita el impreso de la OP: nombres + consumo, ya filtrada. */
export interface RecetaParaImpreso {
  telas: { nombre: string; consumoPorPrenda: number }[];
  avios: { clave: string; descripcion: string; consumoPorPrenda: number }[];
  /** Artes de la orden, ordenados por descripción (V1-E3f: el nombre se retiró). */
  artes: { descripcion: string; tipoArte: string; idModeloArte: number | null }[];
}

/**
 * Lee la receta de la orden para el IMPRESO de la OP (V1-E3d). Filtra `paraProduccion` y descarta
 * los EXCLUIDOS: el papel que va al piso tiene que decir lo que ESTA orden lleva, no lo que lleva
 * la plantilla. Antes leía el BOM del modelo, y con dos órdenes del mismo modelo —una con jareta y
 * otra sin— el papel mentía en una de las dos.
 */
export async function leerRecetaParaImpreso(tx: Tx, idOrden: number): Promise<RecetaParaImpreso> {
  const [telas, avios, artes] = await Promise.all([
    tx.ordenTela.findMany({
      where: { idOrden, paraProduccion: true, excluido: false },
      select: { consumoPorPrenda: true, tela: { select: { nombre: true } } },
      orderBy: { tela: { nombre: 'asc' } },
    }),
    tx.ordenAvio.findMany({
      where: { idOrden, paraProduccion: true, excluido: false },
      select: {
        consumoPorPrenda: true,
        avio: { select: { clave: true, descripcion: true } },
      },
      orderBy: { avio: { clave: 'asc' } },
    }),
    tx.ordenArte.findMany({
      where: { idOrden, excluido: false },
      select: { descripcion: true, idModeloArte: true, tipoArte: { select: { nombre: true } } },
      orderBy: [{ descripcion: 'asc' }, { id: 'asc' }],
    }),
  ]);
  return {
    telas: telas.map((t) => ({
      nombre: t.tela.nombre,
      consumoPorPrenda: num(t.consumoPorPrenda),
    })),
    avios: avios.map((a) => ({
      clave: a.avio.clave,
      descripcion: a.avio.descripcion,
      consumoPorPrenda: num(a.consumoPorPrenda),
    })),
    artes: artes.map((a) => ({
      descripcion: a.descripcion,
      tipoArte: a.tipoArte.nombre,
      idModeloArte: a.idModeloArte,
    })),
  };
}
