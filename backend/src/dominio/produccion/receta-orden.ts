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
  DatosRecetaAgregar,
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
  esquemaRecetaAgregarCuerpo,
  esquemaRecetaEditarCuerpo,
  esquemaRecetaQuitarCuerpo,
} from '../../contrato/index.js';
import { EstadoRenglonReceta, Prisma } from '../../datos/index.js';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { avisoValorFueraDeRango } from '../catalogos/unidades-avio.js';
import { leerArtesModelo } from '../modelos/arte-modelo.js';
import { leerAviosBom, leerTelasBom } from '../modelos/bom-modelo.js';
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
  modelo: { codigo: string };
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
      modelo: { select: { codigo: true } },
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
        consumoPorTalla: a.consumoPorTalla,
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
function avisoCapturaAvio(f: FilaAvio): string | null {
  if (modoCapturaAvio(f) === 'medida' && f.consumoPorTalla) {
    return (
      'Este avío se compra POR MEDIDA (tiene medidas en su catálogo), pero trae encendido ' +
      '"se consume por talla" de una captura anterior: las cantidades por talla ya no se capturan ' +
      'y siguen contando en el requerido. Guarda el renglón para normalizarlo.'
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
  faltantes: { tipo: TipoRenglonRecetaClave; material: string }[],
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
              que: 'precio-mercado',
              detalle:
                `La última COMPRA REAL de "${material}" es de ${pesos(precio.modelo)} y esta orden ` +
                `congeló ${pesos(precio.orden)}. El modelo no cambió: cambió el precio de compra.`,
            }
          : {
              tipo,
              idRenglon: r.id,
              material,
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

/** Cuenta los renglones por estado (los excluidos NO cuentan como vivos). */
function resumirReceta(filas: { estado: EstadoRenglonReceta; excluido: boolean }[]): ResumenReceta {
  let sinRevisar = 0;
  let revisados = 0;
  let ajustados = 0;
  let excluidos = 0;
  for (const f of filas) {
    if (f.excluido) {
      excluidos += 1;
      continue;
    }
    if (f.estado === EstadoRenglonReceta.sin_revisar) sinRevisar += 1;
    else if (f.estado === EstadoRenglonReceta.revisado) revisados += 1;
    else ajustados += 1;
  }
  return {
    sinRevisar,
    revisados,
    ajustados,
    excluidos,
    total: sinRevisar + revisados + ajustados,
  };
}

/**
 * LEE la receta congelada de una orden (permiso `ordenes.ver`, A9) con la DESALINEACIÓN contra el
 * BOM del modelo calculada AL VUELO (regla 5). Los renglones traen embebido lo que el modelo dice
 * HOY (`consumoModelo`/`precioModelo`), para que la pantalla pinte la diferencia sin una segunda
 * llamada.
 */
export async function obtenerRecetaOrden(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<RecetaOrden> {
  verificarPermiso(sesion, 'ordenes.ver');
  const cliente = clienteLectura(bd);
  const orden = await exigirOrdenDeLaEmpresa(cliente, idOrden, sesion.idEmpresaActiva);
  return armarReceta(cliente, orden);
}

/** Arma la salida completa de la receta (compartido por la lectura y por cada mutación). */
async function armarReceta(tx: Tx, orden: OrdenParaReceta): Promise<RecetaOrden> {
  const [filasTela, filasAvio, filasArte, telasModelo, aviosModelo, artesModelo, ocs, tallasOrden] =
    await Promise.all([
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
      avisoCaptura: avisoCapturaAvio(f),
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
  const faltantes: { tipo: TipoRenglonRecetaClave; material: string }[] = [
    ...telasModelo
      .filter((t) => !idsTelaOrden.has(t.idTela))
      .map((t) => ({ tipo: 'tela' as const, material: t.nombre })),
    ...aviosModelo
      .filter((a) => !idsAvioOrden.has(a.idAvio))
      .map((a) => ({ tipo: 'avio' as const, material: `${a.clave} — ${a.descripcion}` })),
    ...artesModelo
      .filter((a) => !idsArteOrden.has(a.id))
      .map((a) => ({ tipo: 'arte' as const, material: a.descripcion })),
  ];

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
    liberadaEn: orden.recetaLiberadaEn?.toISOString() ?? null,
    liberadaPor: orden.recetaLiberadaPorId,
    puedeComprar: orden.recetaLiberadaEn !== null,
    resumen: resumirReceta([...filasTela, ...filasAvio, ...filasArte]),
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

/**
 * EXIGE que la receta de la orden esté LIBERADA por Desarrollo (§Post-F9.43(c)). La usan el MRP
 * (explotar), la generación de OC desde la explosión y el alta de OC **capturada a mano** ligada a
 * la orden — y **solo ellos**: cortar, enviar a maquila, recibir y entregar NO pasan por aquí a
 * propósito (el piso no se detiene porque Desarrollo no haya terminado; lo único que se frena es
 * gastar dinero contra una receta que nadie miró).
 *
 * ⚠️ **`idEmpresa` es OBLIGATORIO (A9)**, aunque hoy los tres llamadores ya filtran antes: sin él,
 * una orden ajena contestaría 409 «sin liberar» —confirmando que existe y en qué estado está— en vez
 * de 404. Pedirlo aquí quita el pie de banco para el próximo que la llame (hallazgo del reviewer).
 */
export async function exigirRecetaLiberada(
  tx: Tx,
  idOrden: number,
  idEmpresa: number,
): Promise<void> {
  const orden = await tx.orden.findFirst({
    where: { id: idOrden, idEmpresa },
    select: { folio: true, recetaLiberadaEn: true },
  });
  if (orden === null) {
    throw new ErrorNoEncontrado('Orden', idOrden);
  }
  if (orden.recetaLiberadaEn === null) {
    throw new ErrorConflicto(
      `La receta de la orden ${String(orden.folio)} todavía no la libera Desarrollo: no se puede ` +
        'explotar el MRP ni generar órdenes de compra. (Cortar y producir no están bloqueados.)',
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
    await accion(tx, orden, {
      cayoSobreLapida: () => {
        sobreLapida = true;
      },
    });

    // ⭐ TOCAR EL CONTENIDO DE UNA RECETA YA LIBERADA LA RE-ABRE (hallazgo del reviewer).
    //
    // La firma de Desarrollo es sobre LO QUE SE FIRMÓ. Sin esto se podía meter material nuevo a una
    // receta ya liberada —o cambiarle el precio, o el amarre— y comprarlo sin que nadie lo volviera
    // a mirar: justo el agujero que la puerta existe para tapar. Al re-abrir, los renglones tocados
    // ya quedaron en `ajustado`, así que "marcar todo revisado" + "liberar" es un par de clics.
    //
    // NO re-abren: "marcar todo revisado" y "liberar" (no cambian QUÉ se compra), ni las lecturas.
    // De paso, esto ES el camino de revocación que `mrp.ts` mencionaba y no existía.
    //
    // ⚠️ Revocar NO des-completa la orden (el recálculo de abajo va con `permitirDesCompletar:
    // false`): una orden a medio producir no se saca de los tableros por un cambio de receta —es la
    // misma regla de Daniel del 26-jul—. Quien mira la orden lo ve igual, porque este panel dice
    // "Sin liberar" en grande y la puerta de compra está cerrada de verdad.
    if (opciones.cambiaElContenido === true && !sobreLapida && orden.recetaLiberadaEn !== null) {
      await tx.orden.update({
        where: { id: orden.id },
        data: { recetaLiberadaEn: null, recetaLiberadaPorId: null, ...datosModificacion(sesion) },
      });
      await bitacoraReceta(tx, sesion, orden.id, 'MODIFICAR', {
        accion: 'liberacion-revocada',
        motivo:
          'se cambió el contenido de una receta ya liberada: Desarrollo tiene que volver a firmarla',
      });
    }
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
      /** Lo que marca a una lápida REVIVIDA (sin tocar `agregadoAMano`: su origen no cambia). */
      const comunesRevivido = {
        estado: EstadoRenglonReceta.ajustado,
        excluido: false,
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

        const delCuerpo = {
          consumoPorPrenda: new Prisma.Decimal(datos.consumoPorPrenda),
          precio: datos.precio === undefined ? undefined : precioDecimal(datos.precio),
          paraPreCosto: datos.paraPreCosto,
          paraProduccion: datos.paraProduccion,
          paraCosto: datos.paraCosto,
          consumoPorTalla: datos.consumoPorTalla,
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
                    consumoPorTalla:
                      datos.consumoPorTalla ?? delModeloAvio?.consumoPorTalla ?? false,
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
    // Cambia QUÉ se compra: si la receta ya estaba liberada, se re-abre (ver `enRecetaEditable`).
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
        // Editar una LÁPIDA no cambia qué se compra: no revoca la firma de Desarrollo.
        if (fila.excluido) ctx.cayoSobreLapida();
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
            ...(datos.consumoPorTalla === undefined
              ? {}
              : { consumoPorTalla: datos.consumoPorTalla }),
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
          cambios: datos,
        });
        return;
      }

      const fila = await exigirRenglonArte(tx, orden.id, idRenglon);
      if (fila.excluido) ctx.cayoSobreLapida();
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
    // Cambia QUÉ se compra: si la receta ya estaba liberada, se re-abre (ver `enRecetaEditable`).
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
    // Cambia QUÉ se compra: si la receta ya estaba liberada, se re-abre (ver `enRecetaEditable`).
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
    async (tx, orden) => {
      const marca = {
        estado: EstadoRenglonReceta.revisado,
        excluido: false,
        ...datosModificacion(sesion),
      };

      if (tipo === 'tela') {
        const fila = await exigirRenglonTela(tx, orden.id, idRenglon);
        const delModelo = (await leerTelasBom(tx, orden.idModelo, orden.idEmpresa)).find(
          (t) => t.idTela === fila.idTela,
        );
        if (delModelo === undefined) {
          throw new ErrorConflicto(
            `"${fila.tela.nombre}" ya no está en la receta del modelo: no hay a qué restaurarlo. ` +
              'Ajusta el renglón a mano o quítalo.',
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
        await tx.ordenAvio.update({
          where: { id: fila.id },
          data: {
            consumoPorPrenda: new Prisma.Decimal(delModelo.consumoPorPrenda),
            precio:
              delModelo.precioCosteo === null ? null : new Prisma.Decimal(delModelo.precioCosteo),
            paraPreCosto: delModelo.paraPreCosto,
            paraProduccion: delModelo.paraProduccion,
            paraCosto: delModelo.paraCosto,
            consumoPorTalla: delModelo.consumoPorTalla,
            idAvioProveedor: delModelo.idAvioProveedor,
            agregadoAMano: false,
            ...marca,
          },
        });
        const medidas = await tx.modeloAvioTalla.findMany({
          where: { idModelo: orden.idModelo, idAvio: fila.idAvio },
          select: { idTalla: true, consumo: true, idAvioMedida: true },
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
    // Cambia QUÉ se compra: si la receta ya estaba liberada, se re-abre (ver `enRecetaEditable`).
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
 * LIBERA la receta (`desarrollo.administrar`) — la firma de Desarrollo que abre la puerta de compra
 * (§Post-F9.43(c)).
 *
 * DOS condiciones, y las dos tienen razón de ser:
 *  • **Ningún renglón `sin_revisar`.** No son 8 clics: el botón "marcar todo revisado" lo resuelve
 *    de un golpe para el 89 % de las órdenes que vienen limpias. Sin esta condición, el estado por
 *    renglón sería decorativo.
 *  • **La receta no puede estar VACÍA.** Liberar "nada" dejaría al MRP explotando cero y a alguien
 *    creyendo que ya lo revisaron. Si el modelo no tiene BOM (2 de cada 3 órdenes del viejo), la
 *    receta se captura a mano en la OP — que es exactamente como funcionaba el viejo.
 *
 * Liberar es IDEMPOTENTE en el sentido útil: volver a liberar re-sella quién y cuándo (Desarrollo
 * revisó de nuevo), no truena.
 */
export async function liberarReceta(
  sesion: SesionUsuario,
  idOrden: number,
  bd?: ContextoBd,
): Promise<RecetaOrden> {
  return enRecetaEditable(sesion, idOrden, bd, async (tx, orden) => {
    const [telas, avios, artes] = await Promise.all([
      tx.ordenTela.findMany({
        where: { idOrden: orden.id },
        select: { estado: true, excluido: true },
      }),
      tx.ordenAvio.findMany({
        where: { idOrden: orden.id },
        select: { estado: true, excluido: true },
      }),
      tx.ordenArte.findMany({
        where: { idOrden: orden.id },
        select: { estado: true, excluido: true },
      }),
    ]);
    const resumen = resumirReceta([...telas, ...avios, ...artes]);
    if (resumen.total === 0) {
      throw new ErrorConflicto(
        'La receta de esta orden está vacía: no hay nada que liberar. Captura lo que lleva la ' +
          'prenda (o restaura los renglones del modelo) antes de liberarla.',
      );
    }
    if (resumen.sinRevisar > 0) {
      throw new ErrorConflicto(
        `Quedan ${String(resumen.sinRevisar)} renglones sin revisar. Revísalos (o usa "marcar todo ` +
          'revisado") antes de liberar la receta.',
      );
    }
    await tx.orden.update({
      where: { id: orden.id },
      data: {
        recetaLiberadaEn: new Date(),
        recetaLiberadaPorId: sesion.id,
        ...datosModificacion(sesion),
      },
    });
    await bitacoraReceta(tx, sesion, orden.id, 'MODIFICAR', {
      accion: 'liberar-receta',
      renglones: resumen.total,
      ajustados: resumen.ajustados,
      excluidos: resumen.excluidos,
    });
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

/** Reemplaza el juego COMPLETO de medidas por talla de un renglón de avío (set-completo, A2). */
async function reemplazarMedidasAvio(
  tx: Tx,
  sesion: SesionUsuario,
  idOrdenAvio: number,
  tallas: { idTalla: number; consumo: number; idAvioMedida?: number | null | undefined }[],
): Promise<void> {
  await tx.ordenAvioTalla.deleteMany({ where: { idOrdenAvio } });
  if (tallas.length === 0) return;
  await tx.ordenAvioTalla.createMany({
    data: tallas.map((t) => ({
      idOrdenAvio,
      idTalla: t.idTalla,
      consumo: new Prisma.Decimal(t.consumo),
      idAvioMedida: t.idAvioMedida ?? null,
      ...datosCreacion(sesion),
    })),
  });
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
