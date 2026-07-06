/**
 * FACTORES del cliente para la lista de precios (F8-E4, D13/R20a — Desarrollo y Cotización).
 *
 * Cada cliente tiene un DEFAULT (`idClienteDepartamento` NULL) y, opcionalmente, un OVERRIDE por
 * departamento (decisión (a)). Los cuatro porcentajes (margen, descuentos, regalías, costo de ventas)
 * alimentan la fórmula del precio de lista (`../costos/precio-lista.ts`). `resolverFactores` es lo que
 * la creación de la lista usa para su SNAPSHOT; `guardarFactores`/`listarFactores` son el CRUD que
 * administra la pantalla del cliente.
 *
 * Innegociables aplicados:
 *  • A1 — toda la lógica vive aquí (validación de porcentajes incluida); las rutas sólo validan
 *    permiso + Zod y delegan.
 *  • A2 — el upsert (buscar + crear/editar) va en UNA transacción, serializada por advisory lock por
 *    cliente para que dos capturas del DEFAULT (NULL, que Postgres trata como distinto) no dupliquen.
 *  • A7 — auditoría uniforme + `Bitacora` (entidad `'Cliente'`, sub-recurso) en la misma tx.
 *
 * Los factores son config GLOBAL del cliente (como `ClienteDepartamento`): el Cliente NO tiene empresa,
 * así que aquí NO hay scope A9 (el scope por empresa vive en la LISTA, que sí es por empresa).
 */
import type { ClienteFactores, Prisma } from '../../datos/index.js';

import {
  esquemaClienteFactoresGuardar,
  type ClienteFactoresSalida,
  type DatosClienteFactoresGuardar,
} from '../../contrato/esquemas/cliente-factores.js';
import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { tienePermiso, verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';
import { num } from '../costos/decimales.js';
import type { FactoresLista } from '../costos/precio-lista.js';

/** Namespace del `pg_advisory_xact_lock` que serializa el upsert de factores por cliente. */
const NAMESPACE_LOCK_FACTORES = 20_541;

/**
 * Valida los cuatro porcentajes con la MISMA regla que la fórmula (`../costos/precio-lista.ts`):
 * `margenPct ∈ [0,100)` (no divide por ≤ 0) y `(descuentos + regalías + costoVentas) ∈ [0,100)`.
 * Lanza `ErrorValidacion` (400) con un mensaje de negocio; así el helper puro nunca ve un `RangeError`
 * en producción (el dominio valida ANTES). Reutilizable por la lista (snapshot editable).
 */
export function validarFactores(f: FactoresLista): void {
  if (!(f.margenPct >= 0) || f.margenPct >= 100) {
    throw new ErrorValidacion('El margen debe estar entre 0 y 100 (sin llegar a 100).');
  }
  for (const [etiqueta, valor] of [
    ['El descuento', f.descuentosPct],
    ['La regalía', f.regaliasPct],
    ['El costo de ventas', f.costoVentasPct],
  ] as const) {
    if (!(valor >= 0)) {
      throw new ErrorValidacion(`${etiqueta} no puede ser negativo.`);
    }
  }
  const suma = f.descuentosPct + f.regaliasPct + f.costoVentasPct;
  if (suma >= 100) {
    throw new ErrorValidacion(
      'La suma de descuentos + regalías + costo de ventas debe ser menor a 100.',
    );
  }
}

/** Convierte una fila `ClienteFactores` de Prisma a los cuatro números de la fórmula. */
export function factoresANumeros(f: {
  margenPct: Prisma.Decimal;
  descuentosPct: Prisma.Decimal;
  regaliasPct: Prisma.Decimal;
  costoVentasPct: Prisma.Decimal;
}): FactoresLista {
  return {
    margenPct: num(f.margenPct),
    descuentosPct: num(f.descuentosPct),
    regaliasPct: num(f.regaliasPct),
    costoVentasPct: num(f.costoVentasPct),
  };
}

/**
 * Proyecta una fila `ClienteFactores` a la salida del contrato, OCULTANDO los porcentajes (null) sin
 * `consultas.ver-importes`. La ocultación vive en el DOMINIO (igual que las listas, A1): la ruta sólo
 * devuelve lo que el dominio decide.
 */
function aFactoresSalida(f: ClienteFactores, verImportes: boolean): ClienteFactoresSalida {
  return {
    id: f.id,
    idCliente: f.idCliente,
    idClienteDepartamento: f.idClienteDepartamento,
    margenPct: verImportes ? f.margenPct.toNumber() : null,
    descuentosPct: verImportes ? f.descuentosPct.toNumber() : null,
    regaliasPct: verImportes ? f.regaliasPct.toNumber() : null,
    costoVentasPct: verImportes ? f.costoVentasPct.toNumber() : null,
    creadoEn: f.creadoEn.toISOString(),
    creadoPorId: f.creadoPorId,
    modificadoEn: f.modificadoEn.toISOString(),
    modificadoPorId: f.modificadoPorId,
  };
}

/**
 * RESUELVE los factores aplicables a un cliente+departamento: primero el OVERRIDE del departamento;
 * si no hay, el DEFAULT del cliente (`idClienteDepartamento` NULL). Si NO hay ninguno de los dos,
 * lanza `ErrorValidacion` (no inventa ceros): hay que capturar los factores antes de crear una lista.
 * La usa `crearLista` para su snapshot.
 */
export async function resolverFactores(
  tx: Tx,
  idCliente: number,
  idClienteDepartamento: number,
): Promise<ClienteFactores> {
  const override = await tx.clienteFactores.findFirst({
    where: { idCliente, idClienteDepartamento },
  });
  if (override !== null) {
    return override;
  }
  const porDefault = await tx.clienteFactores.findFirst({
    where: { idCliente, idClienteDepartamento: null },
  });
  if (porDefault !== null) {
    return porDefault;
  }
  throw new ErrorValidacion(
    'Este cliente/departamento no tiene factores capturados; captúralos antes de crear la lista de precios.',
  );
}

/** Toma el advisory lock por cliente (serializa el upsert de factores, evita doble DEFAULT). */
async function bloquearCliente(tx: Tx, idCliente: number): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE_LOCK_FACTORES}::int, ${idCliente}::int)`;
}

/** Exige que el cliente exista y esté ACTIVO (no se editan factores de un cliente desactivado). */
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
      `El cliente "${cliente.nombre}" está desactivado; reactívalo para editar sus factores.`,
    );
  }
}

/** Exige que el departamento pertenezca al cliente (un departamento de otro cliente, no existe). */
async function exigirDepartamentoDeCliente(
  tx: Tx,
  idCliente: number,
  idClienteDepartamento: number,
): Promise<void> {
  const departamento = await tx.clienteDepartamento.findFirst({
    where: { id: idClienteDepartamento, idCliente },
    select: { id: true, activo: true, nombre: true },
  });
  if (departamento === null) {
    throw new ErrorNoEncontrado('Departamento del cliente', idClienteDepartamento);
  }
  if (!departamento.activo) {
    throw new ErrorConflicto(
      `El departamento "${departamento.nombre}" está desactivado; reactívalo para capturar sus factores.`,
    );
  }
}

/**
 * LISTA los factores de un cliente (default + overrides por departamento), ordenados con el default
 * primero y luego por departamento. Requiere `listas.ver`. La OCULTACIÓN de importes la decide el
 * DOMINIO (por `consultas.ver-importes`), como las listas — la ruta sólo devuelve lo proyectado.
 */
export async function listarFactoresCliente(
  sesion: SesionUsuario,
  idCliente: number,
  bd?: ContextoBd,
): Promise<ClienteFactoresSalida[]> {
  verificarPermiso(sesion, 'listas.ver');
  const cliente = clienteLectura(bd);
  const existe = await cliente.cliente.findUnique({
    where: { id: idCliente },
    select: { id: true },
  });
  if (existe === null) {
    throw new ErrorNoEncontrado('Cliente', idCliente);
  }
  const filas = await cliente.clienteFactores.findMany({
    where: { idCliente },
    orderBy: [{ idClienteDepartamento: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
  });
  const verImportes = tienePermiso(sesion, 'consultas.ver-importes');
  return filas.map((f) => aFactoresSalida(f, verImportes));
}

/**
 * GUARDA (upsert) los factores de un cliente o de uno de sus departamentos (D13/R20a). Requiere
 * `listas.administrar`. Valida el cliente (activo), el departamento (si es override) y los porcentajes
 * (`validarFactores`). Serializa por advisory lock por cliente para no duplicar el DEFAULT. Auditoría
 * + bitácora en la misma tx (A2/A7).
 */
export async function guardarFactoresCliente(
  sesion: SesionUsuario,
  idCliente: number,
  entrada: DatosClienteFactoresGuardar,
  bd?: ContextoBd,
): Promise<ClienteFactoresSalida> {
  verificarPermiso(sesion, 'listas.administrar');
  const datos = validarEntrada(esquemaClienteFactoresGuardar, entrada);
  const idClienteDepartamento = datos.idClienteDepartamento ?? null;
  validarFactores(datos);

  const guardado = await enTransaccion(async (tx) => {
    await bloquearCliente(tx, idCliente);
    await exigirClienteActivo(tx, idCliente);
    if (idClienteDepartamento !== null) {
      await exigirDepartamentoDeCliente(tx, idCliente, idClienteDepartamento);
    }

    const existente = await tx.clienteFactores.findFirst({
      where: { idCliente, idClienteDepartamento },
      select: { id: true },
    });

    const valores = {
      margenPct: datos.margenPct,
      descuentosPct: datos.descuentosPct,
      regaliasPct: datos.regaliasPct,
      costoVentasPct: datos.costoVentasPct,
    };

    let guardado: ClienteFactores;
    if (existente === null) {
      guardado = await tx.clienteFactores.create({
        data: { idCliente, idClienteDepartamento, ...valores, ...datosCreacion(sesion) },
      });
    } else {
      guardado = await tx.clienteFactores.update({
        where: { id: existente.id },
        data: { ...valores, ...datosModificacion(sesion) },
      });
    }

    await registrarBitacora(tx, sesion, {
      entidad: 'Cliente',
      idEntidad: idCliente,
      accion: existente === null ? 'CREAR' : 'MODIFICAR',
      datos: { factores: idClienteDepartamento === null ? 'default' : idClienteDepartamento },
    });

    return guardado;
  }, bd);

  return aFactoresSalida(guardado, tienePermiso(sesion, 'consultas.ver-importes'));
}
