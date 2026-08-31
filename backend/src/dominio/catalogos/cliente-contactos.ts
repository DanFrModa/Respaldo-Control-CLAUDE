/**
 * ⭐ V1-E8y (§Post-F9.152) — CONTACTOS DEL CLIENTE: **la compradora con la que se negocia**.
 *
 * Salió midiendo la mesa para cotizar en la cita: la lista de precios se negocia CON ALGUIEN, y el
 * cliente **no guardaba a nadie**. Sólo tenía tres campos sueltos en su ficha
 * (`contacto`/`telefono`/`email`), uno por cliente — con eso no se puede anotar a la compradora de
 * NIÑOS *y* a la de DAMAS, que es exactamente lo que hay del otro lado de la mesa.
 *
 * Es el ESPEJO de `ProveedorContacto` (`proveedores.ts`, V1-E3f), y se copia a propósito: la misma
 * forma, los mismos verbos y el mismo borrado suave. Con **una diferencia que decidió Daniel**: el
 * **DEPARTAMENTO es OPCIONAL**.
 *
 * > *«Los contactos cuelgan del CLIENTE, con departamento OPCIONAL — así "Laura, compradora de
 * > NIÑOS" se distingue, y "Carlos, crédito" no necesita departamento inventado.»*
 *
 * Consecuencias de esa decisión, escritas para que nadie las "arregle" después:
 *  • La columna es NULLABLE y **no entra en ninguna unicidad**: dos personas pueden llamarse igual,
 *    y la misma persona puede aparecer dos veces con departamentos distintos si así se captura.
 *  • Un departamento que viene TIENE que ser **de ese cliente** (si no, la ficha diría que la
 *    compradora de C&A atiende un departamento de Liverpool). Eso sí se valida, siempre.
 *  • Se acepta un departamento **archivado** al LEER (los contactos viejos se siguen viendo), pero
 *    no al asignarlo: mismo criterio que las demás puertas de este catálogo.
 *
 * 🔴 **SIN permisos nuevos**: se gobiernan con `clientes.ver` / `clientes.administrar`, que ya
 * existen. Y **nada se borra** (D3): quien se fue se archiva con `activo = false`, porque su nombre
 * puede seguir apareciendo en documentos viejos.
 *
 * 🔴 **La tabla NACE VACÍA y así se queda** (REGLA 0-B, §Post-F9.163): los `Cliente.contacto` que
 * hoy existen **no se migran** aquí. Los datos de hoy son basura y se van a limpiar; esta función
 * sólo tiene que funcionar bien cuando el dato **no está**, y funciona: sin contactos, el listado
 * devuelve vacío y la pantalla lo dice.
 */
import {
  esquemaClienteContactoCrear,
  esquemaClienteContactoEditarCuerpo,
} from '../../contrato/index.js';
import type { ClienteContacto, Prisma } from '../../datos/index.js';

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

/** Un contacto con el NOMBRE de su departamento resuelto (la forma que proyecta la ruta). */
export type ContactoCliente = ClienteContacto & {
  clienteDepartamento: { nombre: string } | null;
};

/** `include` único de las lecturas: el nombre del departamento viaja con el contacto. */
const incluirDepartamento = {
  clienteDepartamento: { select: { nombre: true } },
} satisfies Prisma.ClienteContactoInclude;

/** Exige que el cliente exista (404 claro antes de chocar con la FK). */
async function exigirCliente(tx: Tx, idCliente: number): Promise<void> {
  const cliente = await tx.cliente.findUnique({ where: { id: idCliente }, select: { id: true } });
  if (cliente === null) {
    throw new ErrorNoEncontrado('Cliente', idCliente);
  }
}

/**
 * Exige que el departamento sea **de ese cliente** y esté ACTIVO.
 *
 * ⭐ Guarda GEMELA de la de `proyectos.ts` / `listas-precios.ts` / `cliente-factores.ts`: mismo
 * error y misma forma de mensaje. Es la cuarta puerta del mismo catálogo, y las cuatro dicen lo
 * mismo — apagar un departamento es *cómo* la fusión retira un duplicado (§Post-F9.122a), así que
 * asignarle gente nueva a uno apagado es volver a poblar lo que se acaba de barrer.
 */
async function exigirDepartamentoDelCliente(
  tx: Tx,
  idCliente: number,
  idClienteDepartamento: number,
): Promise<void> {
  const departamento = await tx.clienteDepartamento.findFirst({
    where: { id: idClienteDepartamento, idCliente },
    select: { activo: true, nombre: true },
  });
  if (departamento === null) {
    throw new ErrorValidacion('El departamento no pertenece al cliente indicado.');
  }
  if (!departamento.activo) {
    throw new ErrorConflicto(
      `El departamento "${departamento.nombre}" está desactivado; reactívalo para asignarle contactos.`,
    );
  }
}

/**
 * Confirma que el contacto EXISTE **y es de ese cliente**. Un id ajeno responde 404, no un update
 * silencioso a la ficha equivocada (A9: nunca se opera sobre lo ajeno).
 */
async function exigirContactoDelCliente(
  tx: Tx,
  idCliente: number,
  idContacto: number,
): Promise<ClienteContacto> {
  const contacto = await tx.clienteContacto.findFirst({ where: { id: idContacto, idCliente } });
  if (contacto === null) {
    throw new ErrorNoEncontrado('ClienteContacto', idContacto);
  }
  return contacto;
}

/**
 * Lista los contactos de un cliente. Por omisión sólo los activos. Permiso `clientes.ver`.
 *
 * El orden es el mismo del proveedor: activos primero, luego por nombre, con el id de desempate
 * (dos personas pueden llamarse igual — el orden tiene que ser estable de todas formas).
 */
export async function listarContactosCliente(
  sesion: SesionUsuario,
  idCliente: number,
  incluirInactivos = false,
  bd?: ContextoBd,
): Promise<ContactoCliente[]> {
  verificarPermiso(sesion, 'clientes.ver');
  const cliente = clienteLectura(bd);
  const existe = await cliente.cliente.findUnique({
    where: { id: idCliente },
    select: { id: true },
  });
  if (existe === null) {
    throw new ErrorNoEncontrado('Cliente', idCliente);
  }
  return cliente.clienteContacto.findMany({
    where: { idCliente, ...(incluirInactivos ? {} : { activo: true }) },
    include: incluirDepartamento,
    orderBy: [{ activo: 'desc' }, { nombre: 'asc' }, { id: 'asc' }],
  });
}

/**
 * Agrega un contacto al cliente, en UNA transacción con su bitácora (A2/A7). El puesto es texto
 * libre (puede ir vacío) y el departamento es opcional. No hay unicidad: dos personas pueden
 * llamarse igual, y la misma persona puede atender dos departamentos.
 */
export async function crearContactoCliente(
  sesion: SesionUsuario,
  idCliente: number,
  entrada: unknown,
  bd?: ContextoBd,
): Promise<ContactoCliente> {
  verificarPermiso(sesion, 'clientes.administrar');
  const datos = validarEntrada(esquemaClienteContactoCrear, entrada);

  return enTransaccion(async (tx) => {
    await exigirCliente(tx, idCliente);
    if (datos.idClienteDepartamento !== undefined) {
      await exigirDepartamentoDelCliente(tx, idCliente, datos.idClienteDepartamento);
    }

    const contacto = await tx.clienteContacto.create({
      data: {
        idCliente,
        idClienteDepartamento: datos.idClienteDepartamento ?? null,
        nombre: datos.nombre,
        puesto: datos.puesto ?? null,
        telefono: datos.telefono ?? null,
        email: datos.email ?? null,
        notas: datos.notas ?? null,
        ...datosCreacion(sesion),
      },
      include: incluirDepartamento,
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'ClienteContacto',
      idEntidad: contacto.id,
      accion: 'CREAR',
      datos: {
        idCliente,
        nombre: contacto.nombre,
        puesto: contacto.puesto,
        idClienteDepartamento: contacto.idClienteDepartamento,
      },
    });

    return contacto;
  }, bd);
}

/** Campos de TEXTO editables de un contacto (clave del payload === clave del modelo). */
const CAMPOS_TEXTO_CONTACTO = ['nombre', 'puesto', 'telefono', 'email', 'notas'] as const;

/**
 * Edita un contacto (PATCH parcial, misma semántica que el proveedor: omitir = no tocar; `null`/''
 * = borrar) y/o lo archiva/revive con `activo`. Todo en UNA transacción con bitácora (A2/A7).
 *
 * El `nombre` es lo único que no se puede vaciar (un contacto sin nombre no sirve): el esquema lo
 * deja opcional pero NO nullable.
 *
 * `idClienteDepartamento: null` DESLIGA a la persona del departamento —pasa a atender al cliente
 * completo—, que es un cambio legítimo y no un borrado a medias.
 */
export async function actualizarContactoCliente(
  sesion: SesionUsuario,
  idCliente: number,
  idContacto: number,
  entrada: unknown,
  bd?: ContextoBd,
): Promise<ContactoCliente> {
  verificarPermiso(sesion, 'clientes.administrar');
  const datos = validarEntrada(esquemaClienteContactoEditarCuerpo, entrada);

  return enTransaccion(async (tx) => {
    const actual = await exigirContactoDelCliente(tx, idCliente, idContacto);

    const cambios: Prisma.ClienteContactoUpdateInput = { ...datosModificacion(sesion) };
    const detalle: Record<string, unknown> = {};

    for (const campo of CAMPOS_TEXTO_CONTACTO) {
      const crudo = datos[campo];
      if (crudo === undefined) continue;
      const nuevo = crudo === null || crudo === '' ? null : crudo;
      // `nombre` nunca queda en null: el esquema lo exige con ≥1 carácter si viene.
      if (campo === 'nombre' && nuevo === null) continue;
      const anterior = actual[campo];
      if (nuevo !== anterior) {
        (cambios as Record<string, unknown>)[campo] = nuevo;
        detalle[campo] = { de: anterior, a: nuevo };
      }
    }

    if (datos.idClienteDepartamento !== undefined) {
      const nuevo = datos.idClienteDepartamento;
      if (nuevo !== actual.idClienteDepartamento) {
        if (nuevo !== null) {
          await exigirDepartamentoDelCliente(tx, idCliente, nuevo);
        }
        cambios.clienteDepartamento =
          nuevo === null ? { disconnect: true } : { connect: { id: nuevo } };
        detalle['idClienteDepartamento'] = { de: actual.idClienteDepartamento, a: nuevo };
      }
    }

    const archiva = datos.activo === false && actual.activo;
    const revive = datos.activo === true && !actual.activo;
    if (archiva) {
      cambios.activo = false;
    } else if (revive) {
      cambios.activo = true;
    }

    if (Object.keys(detalle).length === 0 && !archiva && !revive) {
      // Nada cambió: se devuelve tal cual (con su departamento resuelto), sin tocar la bitácora.
      return tx.clienteContacto.findUniqueOrThrow({
        where: { id: idContacto },
        include: incluirDepartamento,
      });
    }

    const actualizado = await tx.clienteContacto.update({
      where: { id: idContacto },
      data: cambios,
      include: incluirDepartamento,
    });

    await registrarBitacora(tx, sesion, {
      entidad: 'ClienteContacto',
      idEntidad: idContacto,
      // Archivar un contacto es un DESACTIVAR de libro (borrado suave), no un MODIFICAR más.
      accion: archiva ? 'DESACTIVAR' : 'MODIFICAR',
      datos: {
        idCliente,
        ...detalle,
        ...(archiva ? { operacion: 'archivar', nombre: actual.nombre } : {}),
        ...(revive ? { operacion: 'reactivar' } : {}),
      },
    });

    return actualizado;
  }, bd);
}
