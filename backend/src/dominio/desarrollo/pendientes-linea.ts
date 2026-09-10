/**
 * ⭐ V1-E8y (§Post-F9.152) — LOS PENDIENTES DE UN MODELO dentro de la lista de precios.
 *
 * Daniel, cotizando en la cita, pidió *«un campo abierto de pendientes»*, y al preguntarle si iban
 * por CITA o por MODELO eligió **por modelo**: *«falta muestra de color»* y *«pedir precio de
 * jareta»* son de un modelo concreto — una nota general de la junta los revolvería todos y a la
 * semana siguiente nadie sabría de cuál era cuál.
 *
 * 🔴 **NO es `NegociacionEvento.acuerdo`, y NO se reusa.** Aquél es el libro INMUTABLE de lo que se
 * pactó con el cliente (obligatorio, con su precio, jamás se edita — D3). Esto es la **LIBRETA**:
 * se escribe a la carrera en la cita, se corrige, se tacha y se borra. Meterlos en la misma tabla
 * habría contaminado el libro con notas de trabajo, que es exactamente lo que D3 protege.
 *
 * ⚠️ **UNA sola regla de acceso, la misma para las cuatro operaciones: los pendientes NO son el
 * papel.** No salen en el PDF, ni en el Excel, ni en la cotización; son una libreta pegada al
 * modelo. Por eso **no los frena el cierre de la lista ni el estado del renglón**
 * (`cerrado`/`dropeado`): tachar *"falta la muestra de color"* dos semanas después de cerrar el
 * modelo es justamente para lo que sirven, y bloquearlo obligaría a reabrir una lista —un acto
 * auditado y con peso— para palomear un recado. Se dice aquí, entera y de una vez, para que nadie
 * le añada media excepción después: **las cuatro puertas hacen lo mismo**.
 *
 * Lo que SÍ se aplica siempre: el scope por EMPRESA ACTIVA (A9 — un renglón de otra empresa no
 * existe para esta sesión), el permiso (`listas.ver` para leer, `listas.administrar` para escribir,
 * **sin permisos nuevos**), la transacción por operación (A2) y la bitácora (A7).
 */
import {
  esquemaPendienteLineaCrear,
  esquemaPendienteLineaEditar,
  type DatosPendienteLineaCrear,
  type DatosPendienteLineaEditar,
  type PendienteLineaSalida,
} from '../../contrato/esquemas/lista-precios.js';
import type { z } from 'zod';

import {
  aJsonBitacora,
  datosCreacion,
  datosModificacion,
  registrarBitacora,
} from '../../comun/auditoria.js';
import { ErrorNoEncontrado } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { aPendienteSalida } from './listas-precios.js';

/** Entradas tipadas (forma del esquema compartido). */
export type EntradaCrearPendiente = z.input<typeof esquemaPendienteLineaCrear>;
export type EntradaEditarPendiente = z.input<typeof esquemaPendienteLineaEditar>;

/**
 * El renglón EXISTE y es de la empresa activa (A9). Devuelve su `idLista` para la bitácora: el
 * pendiente es del renglón, pero quien lee la bitácora busca por la LISTA.
 *
 * ⚠️ Aquí NO se toma el advisory lock por lista, y es deliberado: un pendiente no toca precios ni
 * estados, así que no compite con nada que ese lock serialice. Tomarlo pondría a la libreta a hacer
 * cola detrás de un recálculo de factores sin ninguna invariante que defender.
 */
async function exigirRenglon(
  tx: Tx,
  idLinea: number,
  idEmpresa: number,
): Promise<{ id: number; idLista: number }> {
  const linea = await tx.listaPreciosLinea.findFirst({
    where: { id: idLinea, lista: { idEmpresa } },
    select: { id: true, idLista: true },
  });
  if (linea === null) {
    throw new ErrorNoEncontrado('Renglón de lista de precios', idLinea);
  }
  return linea;
}

/** El pendiente EXISTE, es de ese renglón y el renglón es de la empresa activa (A9). */
async function exigirPendiente(
  tx: Tx,
  idLinea: number,
  idPendiente: number,
  idEmpresa: number,
): Promise<{
  id: number;
  idListaLinea: number;
  texto: string;
  resuelto: boolean;
  idLista: number;
}> {
  const pendiente = await tx.listaPreciosLineaPendiente.findFirst({
    where: { id: idPendiente, idListaLinea: idLinea, listaLinea: { lista: { idEmpresa } } },
    select: {
      id: true,
      idListaLinea: true,
      texto: true,
      resuelto: true,
      listaLinea: { select: { idLista: true } },
    },
  });
  if (pendiente === null) {
    throw new ErrorNoEncontrado('Pendiente del modelo', idPendiente);
  }
  return {
    id: pendiente.id,
    idListaLinea: pendiente.idListaLinea,
    texto: pendiente.texto,
    resuelto: pendiente.resuelto,
    idLista: pendiente.listaLinea.idLista,
  };
}

/**
 * Lista los pendientes de un renglón (los tachados incluidos: tachar ≠ borrar). Requiere
 * `listas.ver`.
 *
 * ⚠️ Existe para quien quiera SÓLO la libreta; la mesa no lo llama, porque los pendientes ya viajan
 * embebidos en cada renglón del detalle de la lista (pedirlos aparte serían N llamadas para pintar
 * una lista de 20 modelos).
 */
export async function listarPendientesDeRenglon(
  sesion: SesionUsuario,
  idLinea: number,
  bd?: ContextoBd,
): Promise<PendienteLineaSalida[]> {
  verificarPermiso(sesion, 'listas.ver');
  const cliente = clienteLectura(bd);
  const linea = await cliente.listaPreciosLinea.findFirst({
    where: { id: idLinea, lista: { idEmpresa: sesion.idEmpresaActiva } },
    select: { id: true },
  });
  if (linea === null) {
    throw new ErrorNoEncontrado('Renglón de lista de precios', idLinea);
  }
  const pendientes = await cliente.listaPreciosLineaPendiente.findMany({
    where: { idListaLinea: idLinea },
    orderBy: { id: 'asc' },
  });
  return pendientes.map(aPendienteSalida);
}

/** ANOTA un pendiente en el modelo. Nace SIN tachar. Requiere `listas.administrar`. */
export async function crearPendienteDeRenglon(
  sesion: SesionUsuario,
  idLinea: number,
  entrada: EntradaCrearPendiente,
  bd?: ContextoBd,
): Promise<PendienteLineaSalida> {
  verificarPermiso(sesion, 'listas.administrar');
  const datos: DatosPendienteLineaCrear = validarEntrada(esquemaPendienteLineaCrear, entrada);

  return enTransaccion(async (tx) => {
    const linea = await exigirRenglon(tx, idLinea, sesion.idEmpresaActiva);

    const pendiente = await tx.listaPreciosLineaPendiente.create({
      data: { idListaLinea: idLinea, texto: datos.texto, ...datosCreacion(sesion) },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'ListaPrecios',
      idEntidad: linea.idLista,
      accion: 'MODIFICAR',
      datos: {
        operacion: 'agregar-pendiente',
        idLinea,
        idPendiente: pendiente.id,
        texto: pendiente.texto,
      },
    });

    return aPendienteSalida(pendiente);
  }, bd);
}

/**
 * CORRIGE el texto de un pendiente y/o lo TACHA (`resuelto`). PATCH parcial: omitir = no tocar.
 *
 * ⚠️ **La firma del tachado se limpia al destachar.** `resueltoEn`/`resueltoPorId` tienen que
 * corresponder al estado que hay, no al que hubo: dejar ahí a quien lo tachó cuando el pendiente
 * volvió a estar abierto sería la firma-adorno de §Post-F9.116 en pequeño. El rastro de que alguien
 * lo tachó y luego lo reabrió queda en la BITÁCORA, que es donde vive la historia.
 */
export async function editarPendienteDeRenglon(
  sesion: SesionUsuario,
  idLinea: number,
  idPendiente: number,
  entrada: EntradaEditarPendiente,
  bd?: ContextoBd,
): Promise<PendienteLineaSalida> {
  verificarPermiso(sesion, 'listas.administrar');
  const datos: DatosPendienteLineaEditar = validarEntrada(esquemaPendienteLineaEditar, entrada);

  return enTransaccion(async (tx) => {
    const actual = await exigirPendiente(tx, idLinea, idPendiente, sesion.idEmpresaActiva);

    const cambios: Record<string, unknown> = { ...datosModificacion(sesion) };
    const detalle: Record<string, unknown> = {};

    if (datos.texto !== undefined && datos.texto !== actual.texto) {
      cambios['texto'] = datos.texto;
      detalle['texto'] = { de: actual.texto, a: datos.texto };
    }
    if (datos.resuelto !== undefined && datos.resuelto !== actual.resuelto) {
      cambios['resuelto'] = datos.resuelto;
      cambios['resueltoEn'] = datos.resuelto ? new Date() : null;
      cambios['resueltoPorId'] = datos.resuelto ? sesion.id : null;
      detalle['resuelto'] = { de: actual.resuelto, a: datos.resuelto };
    }

    if (Object.keys(detalle).length === 0) {
      const sinCambios = await tx.listaPreciosLineaPendiente.findUniqueOrThrow({
        where: { id: idPendiente },
      });
      return aPendienteSalida(sinCambios);
    }

    const actualizado = await tx.listaPreciosLineaPendiente.update({
      where: { id: idPendiente },
      data: cambios,
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'ListaPrecios',
      idEntidad: actual.idLista,
      accion: 'MODIFICAR',
      datos: { operacion: 'editar-pendiente', idLinea, idPendiente, ...detalle },
    });

    return aPendienteSalida(actualizado);
  }, bd);
}

/**
 * BORRA un pendiente. Es libreta, no libro: un recado mal escrito se tira.
 *
 * D3 se respeta como se respeta con cualquier borrado físico del sistema (mismo patrón que
 * `quitarLineaLista`): el objeto COMPLETO queda en la BITÁCORA antes de irse, así que nada se
 * pierde — sólo deja de estorbar en la pantalla.
 */
export async function eliminarPendienteDeRenglon(
  sesion: SesionUsuario,
  idLinea: number,
  idPendiente: number,
  bd?: ContextoBd,
): Promise<void> {
  verificarPermiso(sesion, 'listas.administrar');

  await enTransaccion(async (tx) => {
    const actual = await exigirPendiente(tx, idLinea, idPendiente, sesion.idEmpresaActiva);
    const completo = await tx.listaPreciosLineaPendiente.findUniqueOrThrow({
      where: { id: idPendiente },
    });

    await tx.listaPreciosLineaPendiente.delete({ where: { id: idPendiente } });

    await registrarBitacora(tx, sesion, {
      entidad: 'ListaPrecios',
      idEntidad: actual.idLista,
      // No hay acción `ELIMINAR` en el enum; el precedente del repo para un borrado físico es
      // `OTRO` + `operacion` (ver `eliminarLista` y `dominio/admin/roles.ts`).
      accion: 'OTRO',
      datos: { operacion: 'eliminar-pendiente', idLinea, antes: aJsonBitacora(completo) },
    });
  }, bd);
}
