/**
 * Medidas POR TALLA de un avío del BOM (F8-E1, R18) — para CIERTOS avíos (cierres, elástico…) el
 * consumo se captura POR TALLA en vez de un único `consumoPorPrenda`. Sub-recurso del renglón avío
 * del BOM de un modelo (`ModeloAvio` → `ModeloAvioTalla`). Doc funcional:
 * `Documentacion_MJD/PROPUESTA-Desarrollo-Cotizacion-y-Listas-de-Precios.md` (R18).
 *
 * Se gestiona con un endpoint SET-COMPLETO (misma mecánica que el BOM de F1-E4, `bom-modelo.ts`):
 * se manda el `consumoPorTalla` deseado + el conjunto de `tallas`, y el dominio, EN UNA transacción
 * A2: (1) actualiza el toggle `ModeloAvio.consumoPorTalla`; (2) sincroniza (agrega/quita/actualiza)
 * las filas `ModeloAvioTalla` con las tallas dadas, conservando la auditoría de las que no cambian
 * (diff mínimo). Sin `idTalla` repetido (lo valida el esquema y lo respalda la PK compuesta).
 *
 * 🔑 Reglas (A1):
 *  • El renglón `ModeloAvio` (idModelo, idAvio) debe EXISTIR: si no, `ErrorNoEncontrado` (el avío
 *    no está en el BOM de ese modelo). El modelo debe existir (`exigirModelo`).
 *  • La LECTURA arma la matriz desde la CURVA del modelo (V1-E3c): devuelve una fila por talla de
 *    la curva (consumo 0 si no se ha capturado) + las capturadas que ya no están en la curva, y
 *    publica `tieneCurva` para que la UI diga la verdad (antes la lista salía vacía SIEMPRE y el
 *    aviso "el modelo no tiene curva" se mostraba aunque sí la tuviera).
 *  • Cada talla puede AMARRAR una `AvioMedida` del avío (R5/B11, `idAvioMedida`): la medida debe
 *    ser de ESE avío y estar activa.
 *  • Las tallas deben EXISTIR y estar ACTIVAS (no se meten tallas apagadas a las medidas).
 *  • La lista de tallas SIEMPRE reemplaza el set (set-completo), INDEPENDIENTE del toggle: si se
 *    manda `tallas:[]` se vacían las medidas; si se mandan tallas con `consumoPorTalla=false`,
 *    quedan LATENTES (se guardan aunque el toggle esté off). Así apagar el toggle no obliga a
 *    perder las medidas ya capturadas.
 *  • Auditoría A7 + bitácora (entidad `'Modelo'`, `MODIFICAR`) y `tocarModelo` cuando algo cambia.
 *
 * ⭐ **V1-E3g (§Post-F9.66) — dos modos, nunca los dos vivos a la vez.** El número por talla no
 * siempre significa lo mismo, y ahí nacía la confusión que Daniel encontró capturando un cierre:
 *
 *  • **`consumo`** (elástico, jareta) — el avío NO tiene medidas en su catálogo: por talla se
 *    captura CUÁNTO se gasta, en `Avio.unidad` (0.75 m en CH). Se multiplica por piezas y precio.
 *  • **`medida`** (cierres) — el avío SÍ tiene medidas activas: por talla se elige QUÉ se pide (el
 *    cierre de 53 cm). La cantidad no varía por talla —es `consumoPorPrenda`— así que el dominio
 *    **fuerza `consumoPorTalla = false`** y el requerido (R18) se calcula por prenda. Se fuerza en
 *    vez de dejarlo como estaba porque un consumo por talla que la pantalla ya no muestra seguiría
 *    moviendo el MRP **en la sombra**; forzarlo queda ASENTADO en la bitácora y en un aviso, que es
 *    lo contrario de callado. Las cantidades viejas NO se borran (D3): sólo dejan de mandar.
 *
 * Permisos: leer = `modelos.ver`; mutar = `modelos.administrar`.
 */
import type { Prisma } from '../../datos/index.js';
import type {
  esquemaModeloAvioTallaEntrada,
  ModoCapturaTalla,
} from '../../contrato/esquemas/modelo-avio-talla.js';
import { esquemaMedidasAvioGuardar } from '../../contrato/esquemas/modelo-avio-talla.js';
import type { z } from 'zod';

import { datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import { avisoValorFueraDeRango } from '../catalogos/unidades-avio.js';

import { avisosDeCurvaDelModelo } from './curva-desde-ordenes.js';
import { exigirModelo, leerTallasCurvaModelo } from './modelos.js';

/** Cuerpo de guardar medidas tal como LLEGA al dominio (se re-valida con `validarEntrada`). */
export type EntradaMedidasAvio = z.input<typeof esquemaMedidasAvioGuardar>;

/** Renglón de medida por talla ya validado. */
type MedidaTallaValidada = z.output<typeof esquemaModeloAvioTallaEntrada>;

/** Renglón de medida por talla tal como sale al cliente (con la etiqueta de la talla embebida). */
export interface ModeloAvioTallaDetalle {
  idTalla: number;
  etiquetaTalla: string;
  /**
   * Consumo CAPTURADO, o `null` si la talla viene de la curva y todavía no tiene fila en BD. El
   * `null` NO es un 0: un 0 es un cero capturado a propósito (entra al promedio del precosto y el
   * MRP lo respeta), mientras que el `null` no existe para nadie más que para pintar la matriz.
   */
  consumo: number | null;
  /** ¿La talla pertenece a la CURVA vigente del modelo? (false = capturada con otra curva). */
  enCurva: boolean;
  /** `AvioMedida.id` amarrado a esta talla (R5/B11), o null. */
  idAvioMedida: number | null;
  /** Etiqueta de la medida amarrada ("15 cm"), o null. */
  medidaAmarrada: string | null;
  /** Precio de la medida amarrada, o null. */
  precioMedida: number | null;
}

/** Medidas por talla completas de un avío del BOM (modo + toggle + renglones + avisos). */
export interface MedidasAvio {
  idModelo: number;
  idAvio: number;
  consumoPorTalla: boolean;
  /** ¿El MODELO tiene curva de tallas asignada? (con curva SIEMPRE hay renglones que capturar). */
  tieneCurva: boolean;
  /** ¿Por talla se captura la CANTIDAD o la ESPECIFICACIÓN? (V1-E3g; lo deriva el servidor). */
  modoCaptura: ModoCapturaTalla;
  /** `Avio.unidad` — unidad del CONSUMO (m, pza…). La UI la pega al campo que se captura. */
  unidadConsumo: string | null;
  /** `Avio.unidadMedida` — unidad de las MEDIDAS del avío (cm, mm…). */
  unidadMedida: string | null;
  /** Advertencias que NO bloquean (valor absurdo para la unidad, unidad faltante). */
  avisos: string[];
  tallas: ModeloAvioTallaDetalle[];
}

/**
 * Lo que hace falta saber del AVÍO para capturar por talla: su modo (¿tiene medidas activas en el
 * catálogo?), sus dos unidades y el consumo por prenda del renglón del BOM (el que rellena la
 * cantidad en modo `medida`).
 */
interface ContextoAvioTalla {
  consumoPorTalla: boolean;
  consumoPorPrenda: number;
  modoCaptura: ModoCapturaTalla;
  unidadConsumo: string | null;
  unidadMedida: string | null;
}

/** Marca la auditoría del modelo (modificadoPorId/En) cuando cambian sus medidas por talla. */
async function tocarModelo(tx: Tx, sesion: SesionUsuario, idModelo: number): Promise<void> {
  await tx.modelo.update({ where: { id: idModelo }, data: { ...datosModificacion(sesion) } });
}

/**
 * Lee el renglón `ModeloAvio` + el AVÍO del catálogo, o lanza `ErrorNoEncontrado`: si no existe, el
 * avío no está en el BOM de ese modelo (aunque el avío exista en el catálogo).
 *
 * ⭐ El `modoCaptura` se DERIVA aquí de un solo hecho —¿el avío tiene ≥1 medida ACTIVA en su
 * catálogo?— que es exactamente el mismo con el que el precosto decide promediar las medidas
 * (`costos/resolucion-precios.ts`). Una sola definición de "avío por medida" en todo el sistema:
 * si viviera duplicada, la pantalla y el costeo podrían opinar distinto del mismo avío.
 */
async function exigirRenglonAvio(
  tx: Tx,
  idModelo: number,
  idAvio: number,
): Promise<ContextoAvioTalla> {
  const renglon = await tx.modeloAvio.findUnique({
    where: { idModelo_idAvio: { idModelo, idAvio } },
    select: {
      consumoPorTalla: true,
      consumoPorPrenda: true,
      avio: {
        select: {
          unidad: true,
          unidadMedida: true,
          _count: { select: { medidas: { where: { activo: true } } } },
        },
      },
    },
  });
  if (renglon === null) {
    throw new ErrorNoEncontrado('Avío en el BOM del modelo', idAvio);
  }
  return {
    consumoPorTalla: renglon.consumoPorTalla,
    consumoPorPrenda: renglon.consumoPorPrenda.toNumber(),
    modoCaptura: renglon.avio._count.medidas > 0 ? 'medida' : 'consumo',
    unidadConsumo: renglon.avio.unidad,
    unidadMedida: renglon.avio.unidadMedida,
  };
}

/**
 * Valida que todas las tallas existan y estén ACTIVAS (no se meten tallas desactivadas a las
 * medidas del avío). El arreglo ya viene sin repetidos por el esquema Zod.
 */
async function exigirTallasValidas(tx: Tx, idsTallas: number[]): Promise<void> {
  if (idsTallas.length === 0) return;
  const tallas = await tx.talla.findMany({
    where: { id: { in: idsTallas } },
    select: { id: true, etiqueta: true, activo: true },
  });
  if (tallas.length !== idsTallas.length) {
    throw new ErrorValidacion('Una o más tallas seleccionadas no existen.');
  }
  const inactiva = tallas.find((t) => !t.activo);
  if (inactiva !== undefined) {
    throw new ErrorValidacion(
      `La talla "${inactiva.etiqueta}" está desactivada y no se puede usar en las medidas del avío.`,
    );
  }
}

/**
 * Lee las medidas por talla del avío. ⭐ Los renglones NACEN DE LA CURVA del modelo (V1-E3c): se
 * devuelven TODAS las tallas de la curva —en el orden de la curva—, con su consumo capturado o 0
 * si aún no se captura, y detrás las tallas capturadas que YA NO están en la curva (`enCurva:
 * false`), para no perderlas en silencio si alguien cambió la curva después.
 *
 * Antes esta función hacía un solo `findMany` sobre `ModeloAvioTalla` y NADA en el sistema creaba
 * esas filas: la lista salía siempre vacía y la UI concluía —falsamente— que "el modelo no tiene
 * curva de tallas". Por eso `tieneCurva` viaja aparte: es el único dato con el que la UI puede
 * decir la verdad.
 *
 * ⚠️ Las tallas de la curva sin captura salen con `consumo: null`, NO con 0 (ver
 * {@link ModeloAvioTallaDetalle}): son filas de PANTALLA, no filas de BD.
 */
async function leerMedidasAvio(
  tx: Tx,
  idModelo: number,
  idAvio: number,
  contexto: ContextoAvioTalla,
  idEmpresa: number,
): Promise<MedidasAvio> {
  const [curva, filas, avisosCurva] = await Promise.all([
    leerTallasCurvaModelo(tx, idModelo),
    tx.modeloAvioTalla.findMany({
      where: { idModelo, idAvio },
      select: {
        idTalla: true,
        consumo: true,
        idAvioMedida: true,
        talla: { select: { etiqueta: true, orden: true } },
        avioMedida: { select: { medida: true, precio: true } },
      },
      orderBy: [{ talla: { orden: 'asc' } }, { talla: { etiqueta: 'asc' } }],
    }),
    // ⭐ V1-E3r (§Post-F9.81) — ÉSTA es la pantalla donde Daniel encontró el problema: capturando el
    // consumo por talla de un avío vio "tallas de bebés" y no había forma de saber por qué. El aviso
    // tiene que estar AQUÍ, no sólo en la ficha. `idEmpresa` obligatorio (A9): cuenta ÓRDENES.
    avisosDeCurvaDelModelo(tx, idModelo, idEmpresa),
  ]);

  const capturadaPorTalla = new Map(filas.map((f) => [f.idTalla, f]));
  const detalle = (
    f: (typeof filas)[number] | undefined,
    idTalla: number,
    etiquetaTalla: string,
    enCurva: boolean,
  ): ModeloAvioTallaDetalle => ({
    idTalla,
    etiquetaTalla,
    // SIN capturar ⇒ `null` (no hay fila en BD). NUNCA 0: un 0 sintético viajaría de vuelta en el
    // set-completo, crearía la fila y envenenaría el promedio del precosto y el aviso del MRP.
    consumo: f === undefined ? null : f.consumo.toNumber(),
    enCurva,
    idAvioMedida: f?.idAvioMedida ?? null,
    medidaAmarrada: f?.avioMedida?.medida ?? null,
    precioMedida: f?.avioMedida?.precio.toNumber() ?? null,
  });

  const deLaCurva = curva.map((t) =>
    detalle(capturadaPorTalla.get(t.idTalla), t.idTalla, t.etiqueta, true),
  );
  const idsCurva = new Set(curva.map((t) => t.idTalla));
  const fueraDeCurva = filas
    .filter((f) => !idsCurva.has(f.idTalla))
    .map((f) => detalle(f, f.idTalla, f.talla.etiqueta, false));

  const tallas = [...deLaCurva, ...fueraDeCurva];
  return {
    idModelo,
    idAvio,
    consumoPorTalla: contexto.consumoPorTalla,
    tieneCurva: curva.length > 0,
    modoCaptura: contexto.modoCaptura,
    unidadConsumo: contexto.unidadConsumo,
    unidadMedida: contexto.unidadMedida,
    // Los avisos de curva distinta van DELANTE: explican por qué la matriz de abajo trae las tallas
    // que trae, que es la pregunta que el usuario se está haciendo mientras la ve.
    avisos: [...avisosCurva, ...avisosDeCaptura(contexto, tallas)],
    tallas,
  };
}

/**
 * AVISOS que NO bloquean (V1-E3g): el riesgo que quedó abierto al confiar en la unidad del avío es
 * que esté MAL PUESTA, y contra eso se avisa cuando el número no tiene sentido para esa unidad (un
 * `1` en un cierre en cm casi seguro quiso ser `100`). Nunca es un error: los rangos son de sentido
 * común, no reglas del negocio, y un rango mal calibrado no debe frenar una captura legítima.
 *
 * En modo `medida` no se revisan las cantidades por talla: ahí no se capturan (el aviso del valor
 * de la medida vive en el catálogo del avío, que es donde se teclea).
 */
function avisosDeCaptura(contexto: ContextoAvioTalla, tallas: ModeloAvioTallaDetalle[]): string[] {
  const avisos: string[] = [];

  // ⭐ H3 del review — La CONTRADICCIÓN heredada (avío por medida + `consumoPorTalla` encendido) se
  // avisaba en la receta de la ORDEN pero no aquí, en el BOM… que es **donde se arregla**. El
  // usuario leía el aviso en la orden, venía al modelo y encontraba una pantalla que no mencionaba
  // el problema. Igual que allá: se DICE, no se apaga al leer — apagarlo lo hace el guardado.
  if (contexto.modoCaptura === 'medida') {
    if (contexto.consumoPorTalla) {
      avisos.push(
        'Este avío se compra POR MEDIDA (tiene medidas en su catálogo), pero trae encendido ' +
          '"se consume por talla" de una captura anterior: las cantidades por talla ya no se ' +
          'capturan y siguen contando en el requerido. Guarda para normalizarlo.',
      );
    }
    // En modo `medida` las cantidades no se capturan aquí, así que revisarlas sería ruido: el
    // aviso del número absurdo de la MEDIDA vive en el catálogo del avío, que es donde se teclea.
    return avisos;
  }

  for (const t of tallas) {
    if (t.consumo === null) continue;
    const aviso = avisoValorFueraDeRango(
      `El consumo de la talla ${t.etiquetaTalla}`,
      t.consumo,
      contexto.unidadConsumo,
    );
    if (aviso !== null) avisos.push(aviso);
  }
  return avisos;
}

/**
 * Valida los AMARRES medida×talla (R5/B11): cada `idAvioMedida` debe existir, ser una medida DE
 * ESE avío y estar ACTIVA. Sin esto se podría amarrar la talla a la medida de otro avío (o a una
 * dada de baja) y la compra/MRP desglosaría con un precio ajeno.
 */
async function exigirMedidasAvioValidas(
  tx: Tx,
  idAvio: number,
  deseados: MedidaTallaValidada[],
): Promise<void> {
  const ids = [
    ...new Set(deseados.flatMap((d) => (d.idAvioMedida === null ? [] : [d.idAvioMedida]))),
  ];
  if (ids.length === 0) return;

  const medidas = await tx.avioMedida.findMany({
    where: { id: { in: ids } },
    select: { id: true, idAvio: true, medida: true, activo: true },
  });
  const porId = new Map(medidas.map((m) => [m.id, m]));

  for (const id of ids) {
    const medida = porId.get(id);
    if (medida === undefined || medida.idAvio !== idAvio) {
      throw new ErrorValidacion('Una de las medidas seleccionadas no existe o no es de este avío.');
    }
    if (!medida.activo) {
      throw new ErrorValidacion(
        `La medida "${medida.medida}" está desactivada y no se puede amarrar a una talla.`,
      );
    }
  }
}

/**
 * Medida que el set-completo RETIRÓ, con lo que tenía (para dejarla auditada, D3). Se tipa como
 * `Prisma.InputJsonObject` porque viaja TAL CUAL al campo JSON de la bitácora.
 */
type MedidaRetirada = Prisma.InputJsonObject & {
  idTalla: number;
  etiquetaTalla: string;
  consumo: number;
  idAvioMedida: number | null;
};

/** Resultado de sincronizar: si hubo cambio y QUÉ medidas desaparecieron. */
interface ResultadoSincronizacion {
  cambio: boolean;
  retiradas: MedidaRetirada[];
}

/**
 * Reemplaza el set de medidas por talla del avío (diff agrega/quita/actualiza). Exige tallas
 * válidas/activas y amarres de medida válidos. Devuelve si hubo cambio y las medidas RETIRADAS
 * (con su consumo y su amarre previos) para que el llamador las deje en la bitácora. NO escribe
 * bitácora (lo hace el llamador).
 */
async function sincronizarMedidas(
  tx: Tx,
  sesion: SesionUsuario,
  idModelo: number,
  idAvio: number,
  deseados: MedidaTallaValidada[],
  contexto: ContextoAvioTalla,
): Promise<ResultadoSincronizacion> {
  await exigirTallasValidas(
    tx,
    deseados.map((d) => d.idTalla),
  );
  await exigirMedidasAvioValidas(tx, idAvio, deseados);

  const actuales = await tx.modeloAvioTalla.findMany({
    where: { idModelo, idAvio },
    // La etiqueta viaja para que la bitácora sea LEGIBLE (dice "G", no solo un id).
    include: { talla: { select: { etiqueta: true } } },
  });
  const actualPorId = new Map(actuales.map((f) => [f.idTalla, f]));
  const deseadoPorId = new Map(deseados.map((d) => [d.idTalla, d]));

  /**
   * CANTIDAD que va a quedar en la fila. En modo `consumo` es la capturada y es OBLIGATORIA (sin
   * ella no hay nada que guardar). En modo `medida` NO se captura: se conserva la que ya tenía la
   * fila —nunca se pisa lo que había, D3— y si la fila es nueva se siembra con el `consumoPorPrenda`
   * del renglón, que es el número correcto (1 pza por prenda). Da igual para el requerido: en modo
   * `medida` el toggle queda en false y R18 calcula por prenda, no por talla.
   */
  const consumoDe = (d: MedidaTallaValidada): number => {
    if (contexto.modoCaptura === 'consumo') {
      if (d.consumo === undefined) {
        throw new ErrorValidacion(
          'Falta el consumo de una de las tallas: este avío se captura por cantidad.',
        );
      }
      return d.consumo;
    }
    return d.consumo ?? actualPorId.get(d.idTalla)?.consumo.toNumber() ?? contexto.consumoPorPrenda;
  };

  const aQuitar = [...actualPorId.keys()].filter((id) => !deseadoPorId.has(id));
  const aAgregar = deseados.filter((d) => !actualPorId.has(d.idTalla));
  const aActualizar = deseados.filter((d) => {
    const actual = actualPorId.get(d.idTalla);
    return (
      actual !== undefined &&
      (actual.consumo.toNumber() !== consumoDe(d) || actual.idAvioMedida !== d.idAvioMedida)
    );
  });

  if (aQuitar.length === 0 && aAgregar.length === 0 && aActualizar.length === 0) {
    return { cambio: false, retiradas: [] };
  }

  // ⚠️ Lo que se VA se lee ANTES de borrarlo (D3: nada desaparece en silencio). Vaciar el campo de
  // una talla en el editor es la única forma de des-capturar su medida —es el comportamiento
  // correcto del set-completo—, pero también es un descuido de una tecla: sin esto la bitácora
  // decía "tallas: 4" donde antes decía 5 y NADIE podía saber cuál se fue, con cuánto consumo ni
  // con qué medida amarrada.
  const retiradas: MedidaRetirada[] = aQuitar.flatMap((idTalla) => {
    const fila = actualPorId.get(idTalla);
    return fila === undefined
      ? []
      : [
          {
            idTalla,
            etiquetaTalla: fila.talla.etiqueta,
            consumo: fila.consumo.toNumber(),
            idAvioMedida: fila.idAvioMedida,
          },
        ];
  });

  if (aQuitar.length > 0) {
    await tx.modeloAvioTalla.deleteMany({
      where: { idModelo, idAvio, idTalla: { in: aQuitar } },
    });
  }
  if (aAgregar.length > 0) {
    await tx.modeloAvioTalla.createMany({
      data: aAgregar.map((d) => ({
        idModelo,
        idAvio,
        idTalla: d.idTalla,
        consumo: consumoDe(d),
        idAvioMedida: d.idAvioMedida,
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      })),
    });
  }
  for (const d of aActualizar) {
    await tx.modeloAvioTalla.update({
      where: { idModelo_idAvio_idTalla: { idModelo, idAvio, idTalla: d.idTalla } },
      data: { consumo: consumoDe(d), idAvioMedida: d.idAvioMedida, ...datosModificacion(sesion) },
    });
  }
  return { cambio: true, retiradas };
}

/**
 * Obtiene las medidas por talla de un avío del BOM. Requiere `modelos.ver`. Lanza
 * `ErrorNoEncontrado` si el avío no está en el BOM de ese modelo. Devuelve el toggle
 * `consumoPorTalla` + las tallas con su medida (ordenadas por orden de la talla luego etiqueta).
 */
export async function obtenerMedidasAvio(
  sesion: SesionUsuario,
  idModelo: number,
  idAvio: number,
  bd?: ContextoBd,
): Promise<MedidasAvio> {
  verificarPermiso(sesion, 'modelos.ver');
  const cliente = clienteLectura(bd);
  const contexto = await exigirRenglonAvio(cliente, idModelo, idAvio);
  return leerMedidasAvio(cliente, idModelo, idAvio, contexto, sesion.idEmpresaActiva);
}

/**
 * Guarda (SET-COMPLETO) las medidas por talla de un avío del BOM en UNA transacción (A2). Reglas:
 * permiso `modelos.administrar`; el modelo debe existir; el renglón avío debe estar en el BOM; las
 * tallas deben existir y estar activas, sin repetir. Actualiza el toggle `consumoPorTalla` y
 * sincroniza las filas `ModeloAvioTalla` con las tallas dadas (la lista SIEMPRE reemplaza el set,
 * independiente del toggle). Conserva la auditoría de los renglones sin cambios (diff). Bitácora y
 * `tocarModelo` si hubo cambio; las medidas que el set-completo RETIRA quedan ÍNTEGRAS en la
 * bitácora (`tallasRetiradas`: talla, consumo y amarre previos), porque vaciar el campo de una
 * talla la borra y esa es la única forma de reconstruirla (D3). Devuelve el set resultante.
 */
export async function guardarMedidasAvio(
  sesion: SesionUsuario,
  idModelo: number,
  idAvio: number,
  entrada: EntradaMedidasAvio,
  bd?: ContextoBd,
): Promise<MedidasAvio> {
  verificarPermiso(sesion, 'modelos.administrar');
  const datos = validarEntrada(esquemaMedidasAvioGuardar, entrada);

  return enTransaccion(async (tx) => {
    await exigirModelo(tx, idModelo);
    const contexto = await exigirRenglonAvio(tx, idModelo, idAvio);

    // ⭐ En modo `medida` la cantidad NO varía por talla (el cierre es 1 pza), así que el toggle se
    // FUERZA a false pase lo que pase: si se dejara encendido, unas cantidades por talla que la
    // pantalla ya ni muestra seguirían mandando en el requerido del MRP, en la sombra. Se fuerza
    // y se ASIENTA (bitácora + aviso): lo contrario de un cambio callado (D3).
    const consumoPorTallaFinal = contexto.modoCaptura === 'medida' ? false : datos.consumoPorTalla;
    const forzado = contexto.modoCaptura === 'medida' && datos.consumoPorTalla;

    const cambiaBandera = contexto.consumoPorTalla !== consumoPorTallaFinal;
    if (cambiaBandera) {
      await tx.modeloAvio.update({
        where: { idModelo_idAvio: { idModelo, idAvio } },
        data: { consumoPorTalla: consumoPorTallaFinal, ...datosModificacion(sesion) },
      });
    }

    const medidas = await sincronizarMedidas(tx, sesion, idModelo, idAvio, datos.tallas, contexto);

    if (cambiaBandera || medidas.cambio) {
      await tocarModelo(tx, sesion, idModelo);
      await registrarBitacora(tx, sesion, {
        entidad: 'Modelo',
        idEntidad: idModelo,
        accion: 'MODIFICAR',
        datos: {
          bom: 'medidas-avio',
          idAvio,
          consumoPorTalla: consumoPorTallaFinal,
          modoCaptura: contexto.modoCaptura,
          // Deja constancia de que el toggle se apagó SOLO por ser un avío "por medida", para que
          // nadie lea después "el usuario lo apagó" donde lo apagó la regla.
          ...(forzado ? { consumoPorTallaForzadoAFalse: 'avío por medida (V1-E3g)' } : {}),
          tallas: datos.tallas.length,
          // Las medidas que se FUERON, ÍNTEGRAS (talla, consumo y amarre previos): es lo único
          // con lo que se puede reconstruir un borrado por vaciado (D3). Si no se quitó ninguna,
          // el campo no ensucia la bitácora.
          ...(medidas.retiradas.length === 0 ? {} : { tallasRetiradas: medidas.retiradas }),
        },
      });
    }

    const resultado = await leerMedidasAvio(
      tx,
      idModelo,
      idAvio,
      { ...contexto, consumoPorTalla: consumoPorTallaFinal },
      sesion.idEmpresaActiva,
    );
    if (forzado) {
      resultado.avisos.push(
        'Este avío se compra POR MEDIDA (tiene medidas en su catálogo): la cantidad no se captura ' +
          'por talla, se toma el consumo por prenda del renglón. Se apagó "se consume por talla".',
      );
    }
    return resultado;
  }, bd);
}
