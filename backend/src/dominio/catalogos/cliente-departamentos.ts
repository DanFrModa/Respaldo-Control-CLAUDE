/**
 * Departamentos del cliente (F8-E1a, D13/R16 — Desarrollo y Cotización).
 *
 * Un cliente puede dividir su operación en DEPARTAMENTOS (p. ej. C&A → "NIÑOS",
 * "DAMAS"). Es el ESPEJO, más simple, de los campos de referencia del cliente
 * (`ClienteCampo`, D7 — ver `clientes.ts` §"Campos de referencia del cliente"): un
 * sub-recurso del Cliente cuya clave de negocio es el `nombre`, único DENTRO del
 * cliente (insensible a mayúsculas). NO tiene `tipo` ni `orden`.
 *
 * Reglas (mismas que los campos):
 *  • `nombre` es ÚNICO DENTRO del cliente (índice `@@unique([idCliente, nombre])`),
 *    insensible a mayúsculas; el mensaje al duplicar es claro.
 *  • Cada operación de departamento exige que el cliente exista y esté ACTIVO (no se
 *    editan departamentos de un cliente desactivado).
 *  • Borrado SUAVE (`activo`) reversible con desactivar/reactivar.
 *  • Cada operación va en UNA transacción (A2) con auditoría (A7) + `Bitacora` juntos
 *    o nada; la carrera residual la captura el unique de la base (P2002 →
 *    `ErrorConflicto`). La bitácora usa la entidad `'Cliente'` (el departamento es un
 *    sub-recurso), igual que hacen los campos.
 */
import type { ClienteDepartamento, Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import {
  esquemaClienteDepartamentoCrear,
  esquemaClienteDepartamentoEditar,
  esquemaClienteDepartamentoFusionar,
  type FusionDepartamentosPrevia,
} from '../../contrato/esquemas/cliente-departamento.js';
import {
  REFERENCIAS_A_REPUNTAR,
  colisionDeFactores,
  contarUsosDeDepartamento,
} from './cliente-departamentos-fusion-referencias.js';
import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

/** Alta de un departamento: forma del esquema compartido. */
export type EntradaCrearDepartamentoCliente = z.input<typeof esquemaClienteDepartamentoCrear>;

/** Edición de un departamento: `id` + cambios parciales (incluye `activo`). */
export type EntradaActualizarDepartamentoCliente = z.input<typeof esquemaClienteDepartamentoEditar>;

/** Fusión de departamentos duplicados: canónico que se queda + los que se absorben. */
export type EntradaFusionarDepartamentos = z.input<typeof esquemaClienteDepartamentoFusionar>;

/** Vista previa de la fusión (re-exportada del contrato para el consumo del dominio/API). */
export type PreviaFusionDepartamentos = FusionDepartamentosPrevia;

/**
 * Unicidad del `nombre` DENTRO del cliente (D13/R16): un cliente no puede tener dos
 * departamentos con el mismo nombre, sin importar mayúsculas. Se valida en la
 * transacción; la carrera residual la captura el unique `@@unique([idCliente, nombre])`.
 */
async function exigirNombreDepartamentoLibre(
  tx: Tx,
  idCliente: number,
  nombre: string,
  idActual?: number,
): Promise<void> {
  const existente = await tx.clienteDepartamento.findFirst({
    where: {
      idCliente,
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(idActual === undefined ? {} : { id: { not: idActual } }),
    },
    select: { id: true, activo: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Este cliente ya tiene un departamento llamado "${nombre}".`
        : `Este cliente ya tiene un departamento llamado "${nombre}" (está desactivado; puedes reactivarlo).`,
    );
  }
}

/**
 * Busca un cliente ACTIVO por id (para operar sus departamentos): no se editan
 * departamentos de un cliente desactivado. Lanza `ErrorNoEncontrado` si no existe,
 * `ErrorConflicto` si está desactivado.
 */
async function exigirClienteActivo(tx: Tx, idCliente: number): Promise<void> {
  const cliente = await tx.cliente.findUnique({
    where: { id: idCliente },
    select: { nombre: true, activo: true },
  });
  if (cliente === null) {
    throw new ErrorNoEncontrado('Cliente', idCliente);
  }
  if (!cliente.activo) {
    throw new ErrorConflicto(
      `El cliente "${cliente.nombre}" está desactivado; reactívalo para editar sus departamentos.`,
    );
  }
}

/**
 * Busca un departamento que PERTENEZCA al cliente o lanza `ErrorNoEncontrado` (un
 * departamento de otro cliente, para este cliente, no existe).
 */
async function exigirDepartamentoDeCliente(
  tx: Tx,
  idCliente: number,
  idDepartamento: number,
): Promise<ClienteDepartamento> {
  const departamento = await tx.clienteDepartamento.findFirst({
    where: { id: idDepartamento, idCliente },
  });
  if (departamento === null) {
    throw new ErrorNoEncontrado('Departamento del cliente', idDepartamento);
  }
  return departamento;
}

/**
 * Lista los departamentos de un cliente (D13/R16), ordenados por `nombre`. Por defecto
 * solo los activos; `incluirInactivos` trae también los desactivados. Requiere
 * `clientes.ver`. Exige que el cliente exista (no su estado activo: ver los
 * departamentos de un cliente desactivado es lícito).
 */
export async function listarDepartamentosCliente(
  sesion: SesionUsuario,
  idCliente: number,
  opciones: { incluirInactivos?: boolean } = {},
  bd?: ContextoBd,
): Promise<ClienteDepartamento[]> {
  verificarPermiso(sesion, 'clientes.ver');
  const cliente = clienteLectura(bd);
  const existe = await cliente.cliente.findUnique({
    where: { id: idCliente },
    select: { id: true },
  });
  if (existe === null) {
    throw new ErrorNoEncontrado('Cliente', idCliente);
  }
  return cliente.clienteDepartamento.findMany({
    where: { idCliente, ...(opciones.incluirInactivos === true ? {} : { activo: true }) },
    orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
  });
}

/**
 * Agrega un departamento a un cliente (D13/R16) en UNA transacción (A2). Reglas:
 * permiso `clientes.administrar`; el cliente debe existir y estar ACTIVO; `nombre`
 * único dentro del cliente → `ErrorConflicto`. Auditoría/bitácora en la misma
 * transacción.
 */
export async function agregarDepartamentoCliente(
  sesion: SesionUsuario,
  idCliente: number,
  entrada: EntradaCrearDepartamentoCliente,
  bd?: ContextoBd,
): Promise<ClienteDepartamento> {
  verificarPermiso(sesion, 'clientes.administrar');
  const datos = validarEntrada(esquemaClienteDepartamentoCrear, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirClienteActivo(tx, idCliente);
      await exigirNombreDepartamentoLibre(tx, idCliente, datos.nombre);

      const departamento = await tx.clienteDepartamento.create({
        data: {
          idCliente,
          nombre: datos.nombre,
          ...datosCreacion(sesion),
        },
      });

      await registrarBitacora(tx, sesion, {
        entidad: 'Cliente',
        idEntidad: idCliente,
        accion: 'MODIFICAR',
        datos: {
          departamento: 'agregar',
          idDepartamento: departamento.id,
          nombre: departamento.nombre,
        },
      });

      return departamento;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto(`Este cliente ya tiene un departamento llamado "${datos.nombre}".`, {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Actualiza un departamento de un cliente (D13/R16): `nombre` y/o `activo`
 * (des/reactivar) — la forma de `esquemaClienteDepartamentoEditar`. UNA transacción
 * (A2). El cliente debe estar ACTIVO. Si cambia el nombre, se exige que el nuevo esté
 * libre dentro del cliente. Bitácora con el detalle.
 */
export async function actualizarDepartamentoCliente(
  sesion: SesionUsuario,
  idCliente: number,
  entrada: EntradaActualizarDepartamentoCliente,
  bd?: ContextoBd,
): Promise<ClienteDepartamento> {
  verificarPermiso(sesion, 'clientes.administrar');
  const datos = validarEntrada(esquemaClienteDepartamentoEditar, entrada);

  try {
    return await enTransaccion(async (tx) => {
      await exigirClienteActivo(tx, idCliente);
      const actual = await exigirDepartamentoDeCliente(tx, idCliente, datos.id);

      const cambiaNombre = datos.nombre !== undefined && datos.nombre !== actual.nombre;
      const reactiva = datos.activo === true && !actual.activo;
      const desactiva = datos.activo === false && actual.activo;

      if (!cambiaNombre && !reactiva && !desactiva) {
        return actual; // nada que guardar: idempotente, sin bitácora vacía
      }

      if (cambiaNombre && datos.nombre !== undefined) {
        await exigirNombreDepartamentoLibre(tx, idCliente, datos.nombre, datos.id);
      }

      const cambios: Prisma.ClienteDepartamentoUpdateInput = { ...datosModificacion(sesion) };
      if (cambiaNombre && datos.nombre !== undefined) {
        cambios.nombre = datos.nombre;
      }
      if ((reactiva || desactiva) && datos.activo !== undefined) {
        cambios.activo = datos.activo;
      }

      const departamento = await tx.clienteDepartamento.update({
        where: { id: datos.id },
        data: cambios,
      });

      if (cambiaNombre || reactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Cliente',
          idEntidad: idCliente,
          accion: 'MODIFICAR',
          datos: {
            departamento: 'modificar',
            idDepartamento: departamento.id,
            ...(cambiaNombre ? { nombre: { de: actual.nombre, a: departamento.nombre } } : {}),
            ...(reactiva ? { operacion: 'reactivar' } : {}),
          },
        });
      }
      if (desactiva) {
        await registrarBitacora(tx, sesion, {
          entidad: 'Cliente',
          idEntidad: idCliente,
          accion: 'MODIFICAR',
          datos: {
            departamento: 'desactivar',
            idDepartamento: departamento.id,
            nombre: departamento.nombre,
          },
        });
      }

      return departamento;
    }, bd);
  } catch (error) {
    if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
      throw new ErrorConflicto('Este cliente ya tiene un departamento con ese nombre.', {
        causa: error,
      });
    }
    throw error;
  }
}

/**
 * Desactiva (borrado SUAVE) un departamento de un cliente (D13/R16). Desactivar dos
 * veces es `ErrorConflicto`. El cliente debe estar ACTIVO.
 */
export async function desactivarDepartamentoCliente(
  sesion: SesionUsuario,
  idCliente: number,
  idDepartamento: number,
  bd?: ContextoBd,
): Promise<ClienteDepartamento> {
  verificarPermiso(sesion, 'clientes.administrar');
  return enTransaccion(async (tx) => {
    await exigirClienteActivo(tx, idCliente);
    const actual = await exigirDepartamentoDeCliente(tx, idCliente, idDepartamento);
    if (!actual.activo) {
      throw new ErrorConflicto(`El departamento "${actual.nombre}" ya está desactivado.`);
    }
    return actualizarDepartamentoCliente(
      sesion,
      idCliente,
      { id: idDepartamento, activo: false },
      { tx },
    );
  }, bd);
}

/** Reactiva un departamento desactivado (operación inversa del borrado suave). */
export async function reactivarDepartamentoCliente(
  sesion: SesionUsuario,
  idCliente: number,
  idDepartamento: number,
  bd?: ContextoBd,
): Promise<ClienteDepartamento> {
  verificarPermiso(sesion, 'clientes.administrar');
  return enTransaccion(async (tx) => {
    await exigirClienteActivo(tx, idCliente);
    const actual = await exigirDepartamentoDeCliente(tx, idCliente, idDepartamento);
    if (actual.activo) {
      throw new ErrorConflicto(`El departamento "${actual.nombre}" ya está activo.`);
    }
    // No hace falta re-checar el nombre: el unique `@@unique([idCliente, nombre])` cubre
    // activos e inactivos, así que mientras estuvo apagado nadie pudo reusarlo.
    return actualizarDepartamentoCliente(
      sesion,
      idCliente,
      { id: idDepartamento, activo: true },
      { tx },
    );
  }, bd);
}

// ── FUSIÓN de departamentos duplicados (§Post-F9.122(a)) ──────────────────────────

/**
 * ⭐ FUSIONA departamentos SINÓNIMOS de un mismo cliente en el que se queda (§Post-F9.122(a)).
 *
 * **El problema, en palabras de Daniel (25-ago-2026):** *"los departamentos están revueltos… hay
 * mujer, dama, caballero, hombre"*. El importador de OC por PDF da de alta un departamento cada vez
 * que la OC trae un texto que no reconoce, y cada cliente escribe el suyo distinto (`"2-HOMBRE"` en
 * una OC, `"Caballeros"` en el catálogo) ⇒ el catálogo se llena de sinónimos. Y como **la lista de
 * precios cuelga de cliente + departamento** (§Post-F9.109), dos nombres para lo mismo parten el
 * trabajo en dos mundos que no se ven entre sí: un desarrollo capturado en «2-HOMBRE» no aparece al
 * armar la lista de «Caballeros». Sin esto, Daniel **no puede armar una lista de precios**.
 *
 * **Qué hace:** repunta al canónico **TODO** lo que colgaba de cada absorbido —proyectos, listas de
 * precios, cotizaciones y factores— (`REFERENCIAS_A_REPUNTAR`, con su red contra el olvido), DESACTIVA
 * cada absorbido (borrado SUAVE: **nunca se borra físicamente un departamento**), REACTIVA el canónico
 * y deja bitácora por cada absorbido más una de resumen en el que se queda. Todo en UNA transacción
 * (A2): o se consolida entero o no se toca nada.
 *
 * ⚠️ **REPUNTA, NO BLOQUEA — al revés que `fusionarColores`.** El porqué, con la medición, está en la
 * cabecera de `cliente-departamentos-fusion-referencias.ts`: las cuatro llaves entrantes del
 * departamento son documentos vivos y editables, y arreglar a dónde apuntan **es** el trabajo.
 * Negarse aquí (como se hace con los colores, cuyos movimientos ya asentados no se pueden mover sin
 * volverlos incoherentes) dejaría a Daniel exactamente igual de atorado.
 *
 * ⚖️ **Colisión de FACTORES:** si el canónico y el absorbido tienen factores propios, gana el del que
 * SE QUEDA y los del absorbido se **escriben en la bitácora antes de retirarse** — ver
 * {@link colisionDeFactores}, que es la MISMA función con la que
 * {@link previsualizarFusionDepartamentos} avisa antes de apretar el botón.
 *
 * Reglas: permiso `clientes.administrar` (el mismo que ya administra departamentos, sin permiso
 * nuevo); el cliente debe existir y estar ACTIVO; **el canónico y cada absorbido tienen que ser de
 * ESE cliente** (`exigirDepartamentoDeCliente`, que es lo que impide fusionar entre clientes
 * distintos); Zod ya excluye el destino de la lista de orígenes y prohíbe repetidos.
 *
 * @returns el departamento CANÓNICO sobreviviente, ya consolidado y activo.
 */
export async function fusionarDepartamentosCliente(
  sesion: SesionUsuario,
  idCliente: number,
  entrada: EntradaFusionarDepartamentos,
  bd?: ContextoBd,
): Promise<ClienteDepartamento> {
  verificarPermiso(sesion, 'clientes.administrar');
  const datos = validarEntrada(esquemaClienteDepartamentoFusionar, entrada);

  return enTransaccion(async (tx) => {
    await exigirClienteActivo(tx, idCliente);
    const destino = await exigirDepartamentoDeCliente(tx, idCliente, datos.idDestino);

    let referenciasMovidas = 0;
    const absorbidos: { id: number; nombre: string }[] = [];

    for (const idOrigen of datos.origenes) {
      const origen = await exigirDepartamentoDeCliente(tx, idCliente, idOrigen);
      const contexto = { idCliente, idOrigen, idDestino: datos.idDestino };

      let movidosDeEsteOrigen = 0;
      const descartados: Prisma.JsonObject[] = [];
      for (const referencia of REFERENCIAS_A_REPUNTAR) {
        const hecho = await referencia.repuntar(tx, contexto);
        movidosDeEsteOrigen += hecho.movidos;
        for (const descarte of hecho.descartados ?? []) {
          descartados.push({ ...descarte, referencia: referencia.relacion });
        }
      }
      referenciasMovidas += movidosDeEsteOrigen;

      // Borrado SUAVE del absorbido (idempotente si ya estaba apagado). NUNCA físico: el
      // departamento sigue existiendo, y su bitácora dice en cuál se fusionó.
      if (origen.activo) {
        await tx.clienteDepartamento.update({
          where: { id: idOrigen },
          data: { activo: false, ...datosModificacion(sesion) },
        });
      }
      absorbidos.push({ id: origen.id, nombre: origen.nombre });

      // Bitácora por cada absorbido (auditoría granular A7). Aquí es donde quedan los factores
      // descartados con sus cuatro valores: la decisión es auditable y rehacible a mano.
      await registrarBitacora(tx, sesion, {
        entidad: 'Cliente',
        idEntidad: idCliente,
        accion: 'OTRO',
        datos: {
          departamento: 'fusionar',
          idDepartamento: origen.id,
          nombre: origen.nombre,
          fusionadoEn: { id: destino.id, nombre: destino.nombre },
          referenciasReasignadas: movidosDeEsteOrigen,
          ...(descartados.length > 0 ? { descartados } : {}),
        },
      });
    }

    // El canónico sobrevive y queda ACTIVO. Toca `modificadoPor` y, si estaba apagado, lo reactiva.
    const destinoActualizado = await tx.clienteDepartamento.update({
      where: { id: datos.idDestino },
      data: { activo: true, ...datosModificacion(sesion) },
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'Cliente',
      idEntidad: idCliente,
      accion: 'MODIFICAR',
      datos: {
        departamento: 'fusionar',
        idDepartamento: destino.id,
        nombre: destino.nombre,
        absorbio: absorbidos,
        referenciasReasignadas: referenciasMovidas,
      },
    });

    return destinoActualizado;
  }, bd);
}

/**
 * ⭐ **LA GUARDA GEMELA de la fusión: dice QUÉ VA A PASAR antes de que pase** (§Post-F9.122(a)).
 *
 * Devuelve, por cada departamento a absorber, **cuántos** proyectos, listas de precios, cotizaciones
 * y factores se van a mover al canónico, y si los factores **van a chocar** (el canónico ya tiene los
 * suyos ⇒ los del absorbido se descartan).
 *
 * 🔴 **Es la MISMA función, nunca un resumen.** Cuenta con los mismos `contar` de
 * `REFERENCIAS_A_REPUNTAR` que el repunte recorre, y decide la colisión con la misma
 * {@link colisionDeFactores} que la ejecuta. Un contador paralelo escrito "para la pantalla" se
 * desincroniza en la primera corrección y le promete al usuario algo distinto de lo que el servidor
 * hace — que es justo el error que esta pantalla no se puede permitir, porque el usuario aprieta el
 * botón CREYÉNDOLE.
 *
 * ⚠️ **NO devuelve los VALORES de los factores**, sólo si chocan. Los cuatro porcentajes son
 * información del DUEÑO (`listas.aprobar`, §Post-F9.125: *"no son visibles para nadie más"*) y esta
 * pantalla la abre quien administra clientes. La frase «el que se queda conserva los suyos» se puede
 * decir sin enseñar un número; los valores descartados quedan en la BITÁCORA, que es donde deben
 * estar.
 *
 * Es de sólo lectura: no escribe nada. Permiso `clientes.administrar` (el de la operación que
 * previsualiza: quien no puede fusionar tampoco tiene por qué inventariar lo que colgaría).
 */
export async function previsualizarFusionDepartamentos(
  sesion: SesionUsuario,
  idCliente: number,
  entrada: EntradaFusionarDepartamentos,
  bd?: ContextoBd,
): Promise<PreviaFusionDepartamentos> {
  verificarPermiso(sesion, 'clientes.administrar');
  const datos = validarEntrada(esquemaClienteDepartamentoFusionar, entrada);

  return enTransaccion(async (tx) => {
    await exigirClienteActivo(tx, idCliente);
    const destino = await exigirDepartamentoDeCliente(tx, idCliente, datos.idDestino);

    const origenes: PreviaFusionDepartamentos['origenes'] = [];
    const totales = new Map<string, { etiqueta: string; cuenta: number }>();

    // ⚠️ Los absorbidos se procesan EN ORDEN, y el orden importa para los factores: si dos traen los
    // suyos y el canónico no, el PRIMERO se los lleva y el SEGUNDO ya choca. La previa no escribe, así
    // que **simula ese avance** — si leyera la base a secas diría "ninguno choca" y prometería mover
    // los dos. La decisión sigue siendo de `colisionDeFactores`; aquí sólo se le dice el estado que
    // habrá cuando le toque a este origen.
    let destinoTendraFactores =
      (await tx.clienteFactores.findFirst({
        where: { idCliente, idClienteDepartamento: datos.idDestino },
        select: { id: true },
      })) !== null;

    for (const idOrigen of datos.origenes) {
      const origen = await exigirDepartamentoDeCliente(tx, idCliente, idOrigen);
      const usos = await contarUsosDeDepartamento(tx, idOrigen);
      const colision = await colisionDeFactores(
        tx,
        { idCliente, idOrigen, idDestino: datos.idDestino },
        { destinoYaTieneFactores: destinoTendraFactores },
      );
      const traeFactores = (usos.find((u) => u.relacion === 'factores')?.cuenta ?? 0) > 0;
      if (traeFactores && colision === null) {
        destinoTendraFactores = true; // se los lleva: el siguiente que traiga los suyos ya chocará
      }

      // 🔴 Lo que la previa promete es lo que SE VA A MOVER, no lo que cuelga. Para los factores son
      // cosas distintas: los que chocan se descartan, no viajan. Prometer que viajan sería la misma
      // mentira que un contador paralelo, sólo que servida por la función buena.
      const aMover = usos.map((uso) =>
        uso.relacion === 'factores' && colision !== null ? { ...uso, cuenta: 0 } : uso,
      );
      for (const uso of aMover) {
        const acumulado = totales.get(uso.relacion) ?? { etiqueta: uso.etiqueta, cuenta: 0 };
        acumulado.cuenta += uso.cuenta;
        totales.set(uso.relacion, acumulado);
      }

      origenes.push({
        id: origen.id,
        nombre: origen.nombre,
        usos: aMover,
        factoresSeDescartan: colision !== null,
      });
    }

    return {
      destino: { id: destino.id, nombre: destino.nombre },
      origenes,
      totales: [...totales].map(([relacion, t]) => ({
        relacion,
        etiqueta: t.etiqueta,
        cuenta: t.cuenta,
      })),
    };
  }, bd);
}
