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
 * Permisos: leer = `modelos.ver`; mutar = `modelos.administrar`.
 */
import type { Prisma } from '../../datos/index.js';
import type { esquemaModeloAvioTallaEntrada } from '../../contrato/esquemas/modelo-avio-talla.js';
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

/** Medidas por talla completas de un avío del BOM (toggle + renglones). */
export interface MedidasAvio {
  idModelo: number;
  idAvio: number;
  consumoPorTalla: boolean;
  /** ¿El MODELO tiene curva de tallas asignada? (con curva SIEMPRE hay renglones que capturar). */
  tieneCurva: boolean;
  tallas: ModeloAvioTallaDetalle[];
}

/** Marca la auditoría del modelo (modificadoPorId/En) cuando cambian sus medidas por talla. */
async function tocarModelo(tx: Tx, sesion: SesionUsuario, idModelo: number): Promise<void> {
  await tx.modelo.update({ where: { id: idModelo }, data: { ...datosModificacion(sesion) } });
}

/**
 * Lee el renglón `ModeloAvio` (solo el toggle) o lanza `ErrorNoEncontrado`: si no existe, el avío
 * no está en el BOM de ese modelo (aunque el avío exista en el catálogo).
 */
async function exigirRenglonAvio(tx: Tx, idModelo: number, idAvio: number): Promise<boolean> {
  const renglon = await tx.modeloAvio.findUnique({
    where: { idModelo_idAvio: { idModelo, idAvio } },
    select: { consumoPorTalla: true },
  });
  if (renglon === null) {
    throw new ErrorNoEncontrado('Avío en el BOM del modelo', idAvio);
  }
  return renglon.consumoPorTalla;
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
  consumoPorTalla: boolean,
): Promise<MedidasAvio> {
  const [curva, filas] = await Promise.all([
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

  return {
    idModelo,
    idAvio,
    consumoPorTalla,
    tieneCurva: curva.length > 0,
    tallas: [...deLaCurva, ...fueraDeCurva],
  };
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

  const aQuitar = [...actualPorId.keys()].filter((id) => !deseadoPorId.has(id));
  const aAgregar = deseados.filter((d) => !actualPorId.has(d.idTalla));
  const aActualizar = deseados.filter((d) => {
    const actual = actualPorId.get(d.idTalla);
    return (
      actual !== undefined &&
      (actual.consumo.toNumber() !== d.consumo || actual.idAvioMedida !== d.idAvioMedida)
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
        consumo: d.consumo,
        idAvioMedida: d.idAvioMedida,
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      })),
    });
  }
  for (const d of aActualizar) {
    await tx.modeloAvioTalla.update({
      where: { idModelo_idAvio_idTalla: { idModelo, idAvio, idTalla: d.idTalla } },
      data: { consumo: d.consumo, idAvioMedida: d.idAvioMedida, ...datosModificacion(sesion) },
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
  const consumoPorTalla = await exigirRenglonAvio(cliente, idModelo, idAvio);
  return leerMedidasAvio(cliente, idModelo, idAvio, consumoPorTalla);
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
    const consumoActual = await exigirRenglonAvio(tx, idModelo, idAvio);

    const cambiaBandera = consumoActual !== datos.consumoPorTalla;
    if (cambiaBandera) {
      await tx.modeloAvio.update({
        where: { idModelo_idAvio: { idModelo, idAvio } },
        data: { consumoPorTalla: datos.consumoPorTalla, ...datosModificacion(sesion) },
      });
    }

    const medidas = await sincronizarMedidas(tx, sesion, idModelo, idAvio, datos.tallas);

    if (cambiaBandera || medidas.cambio) {
      await tocarModelo(tx, sesion, idModelo);
      await registrarBitacora(tx, sesion, {
        entidad: 'Modelo',
        idEntidad: idModelo,
        accion: 'MODIFICAR',
        datos: {
          bom: 'medidas-avio',
          idAvio,
          consumoPorTalla: datos.consumoPorTalla,
          tallas: datos.tallas.length,
          // Las medidas que se FUERON, ÍNTEGRAS (talla, consumo y amarre previos): es lo único
          // con lo que se puede reconstruir un borrado por vaciado (D3). Si no se quitó ninguna,
          // el campo no ensucia la bitácora.
          ...(medidas.retiradas.length === 0 ? {} : { tallasRetiradas: medidas.retiradas }),
        },
      });
    }

    return leerMedidasAvio(tx, idModelo, idAvio, datos.consumoPorTalla);
  }, bd);
}
