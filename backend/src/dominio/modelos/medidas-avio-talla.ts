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
 *  • Las tallas deben EXISTIR y estar ACTIVAS (no se meten tallas apagadas a las medidas).
 *  • La lista de tallas SIEMPRE reemplaza el set (set-completo), INDEPENDIENTE del toggle: si se
 *    manda `tallas:[]` se vacían las medidas; si se mandan tallas con `consumoPorTalla=false`,
 *    quedan LATENTES (se guardan aunque el toggle esté off). Así apagar el toggle no obliga a
 *    perder las medidas ya capturadas.
 *  • Auditoría A7 + bitácora (entidad `'Modelo'`, `MODIFICAR`) y `tocarModelo` cuando algo cambia.
 *
 * Permisos: leer = `modelos.ver`; mutar = `modelos.administrar`.
 */
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

import { exigirModelo } from './modelos.js';

/** Cuerpo de guardar medidas tal como LLEGA al dominio (se re-valida con `validarEntrada`). */
export type EntradaMedidasAvio = z.input<typeof esquemaMedidasAvioGuardar>;

/** Renglón de medida por talla ya validado. */
type MedidaTallaValidada = z.output<typeof esquemaModeloAvioTallaEntrada>;

/** Renglón de medida por talla tal como sale al cliente (con la etiqueta de la talla embebida). */
export interface ModeloAvioTallaDetalle {
  idTalla: number;
  etiquetaTalla: string;
  consumo: number;
}

/** Medidas por talla completas de un avío del BOM (toggle + renglones). */
export interface MedidasAvio {
  idModelo: number;
  idAvio: number;
  consumoPorTalla: boolean;
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

/** Lee las medidas por talla del avío (con la etiqueta), ordenadas por `talla.orden` luego etiqueta. */
async function leerMedidasAvio(
  tx: Tx,
  idModelo: number,
  idAvio: number,
  consumoPorTalla: boolean,
): Promise<MedidasAvio> {
  const filas = await tx.modeloAvioTalla.findMany({
    where: { idModelo, idAvio },
    select: {
      idTalla: true,
      consumo: true,
      talla: { select: { etiqueta: true } },
    },
    orderBy: [{ talla: { orden: 'asc' } }, { talla: { etiqueta: 'asc' } }],
  });
  return {
    idModelo,
    idAvio,
    consumoPorTalla,
    tallas: filas.map((f) => ({
      idTalla: f.idTalla,
      etiquetaTalla: f.talla.etiqueta,
      consumo: f.consumo.toNumber(),
    })),
  };
}

/**
 * Reemplaza el set de medidas por talla del avío (diff agrega/quita/actualiza). Exige tallas
 * válidas/activas. Devuelve true si hubo cambio. NO escribe bitácora (lo hace el llamador).
 */
async function sincronizarMedidas(
  tx: Tx,
  sesion: SesionUsuario,
  idModelo: number,
  idAvio: number,
  deseados: MedidaTallaValidada[],
): Promise<boolean> {
  await exigirTallasValidas(
    tx,
    deseados.map((d) => d.idTalla),
  );

  const actuales = await tx.modeloAvioTalla.findMany({ where: { idModelo, idAvio } });
  const actualPorId = new Map(actuales.map((f) => [f.idTalla, f]));
  const deseadoPorId = new Map(deseados.map((d) => [d.idTalla, d]));

  const aQuitar = [...actualPorId.keys()].filter((id) => !deseadoPorId.has(id));
  const aAgregar = deseados.filter((d) => !actualPorId.has(d.idTalla));
  const aActualizar = deseados.filter((d) => {
    const actual = actualPorId.get(d.idTalla);
    return actual !== undefined && actual.consumo.toNumber() !== d.consumo;
  });

  if (aQuitar.length === 0 && aAgregar.length === 0 && aActualizar.length === 0) {
    return false;
  }

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
        creadoPorId: sesion.id,
        modificadoPorId: sesion.id,
      })),
    });
  }
  for (const d of aActualizar) {
    await tx.modeloAvioTalla.update({
      where: { idModelo_idAvio_idTalla: { idModelo, idAvio, idTalla: d.idTalla } },
      data: { consumo: d.consumo, ...datosModificacion(sesion) },
    });
  }
  return true;
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
 * `tocarModelo` si hubo cambio. Devuelve el set resultante.
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

    const cambiaMedidas = await sincronizarMedidas(tx, sesion, idModelo, idAvio, datos.tallas);

    if (cambiaBandera || cambiaMedidas) {
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
        },
      });
    }

    return leerMedidasAvio(tx, idModelo, idAvio, datos.consumoPorTalla);
  }, bd);
}
