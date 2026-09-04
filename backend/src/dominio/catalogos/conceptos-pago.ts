/**
 * ⭐ CATÁLOGO DE CONCEPTOS DE PAGO QUE **NO** SON PROVEEDORES (fila 0.125; §Post-F9.189(c)).
 *
 * Daniel: *«También quiero dejar pagos para cosas que no necesariamente están dadas de alta como
 * proveedores (nóminas por fuera, gratificaciones, pago de algún servicio como agua, o cualquier
 * otra cosa). Debería de poder tener como un catálogo de otras cosas que no son proveedores.»* Y,
 * esa misma tarde, cerró la duda: *«que sean un catálogo aparte, no proveedores»* — no tienen RFC,
 * ni orden, ni estado de cuenta, y colarlos al padrón de proveedores contaminaría CxP y los
 * reportes fiscales del contador.
 *
 * ⭐ **LOS PREDETERMINADOS**, textual: *«algunos de ellos quiero que se carguen por default en la
 * relación, porque son conceptos que cada semana pago y no quiero que se me vaya a olvidar ponerlo
 * (caja chica, nómina por fuera, etc.). De ese catálogo poder definir cuáles son los
 * predeterminados para que siempre se carguen EN CERO para que yo le ponga la cantidad.»*
 * ⇒ `predeterminado` es la marca; el que los carga en cero es el alta de la corrida
 * (`dominio/pagos/corrida.ts`).
 *
 * GLOBAL, como todo catálogo maestro (A9/ADR-0007: no lleva `idEmpresa`). Borrado SUAVE (D3).
 * SIN ETL: arranca en cero — nunca vivió en Access, vivía en un Excel.
 *
 * Permisos (A4, deny-by-default): `conceptos-pago.ver` / `conceptos-pago.administrar`. NO reusa
 * `proveedores.*`: es otro catálogo, y quien administra el padrón de proveedores no tiene por qué
 * poder inventar destinos de pago.
 *
 * Las CUENTAS del concepto viven en `conceptos-pago-cuentas.ts` y comparten TODAS las reglas con
 * las del proveedor (`cuentas-pago-reglas.ts`).
 */
import {
  esquemaConceptoPagoCrear,
  esquemaConceptoPagoEditar,
  esquemaConceptosPagoQuery,
  type ConceptosPagoPagina,
  type ConceptoPagoSalida,
} from '../../contrato/index.js';
import type { Prisma } from '../../datos/index.js';
import type { z } from 'zod';

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

import { proyectarCuentaConcepto } from './conceptos-pago-cuentas.js';

/** `include` para traer el concepto con sus cuentas (la default primero). */
export const incluirConcepto = {
  cuentas: {
    where: { activo: true },
    orderBy: [
      { esDefault: { sort: 'desc', nulls: 'last' } },
      { id: 'asc' },
    ] satisfies Prisma.ConceptoPagoCuentaOrderByWithRelationInput[],
  },
} satisfies Prisma.ConceptoPagoInclude;

/** Concepto con sus cuentas, tal como lo devuelve Prisma. */
type ConceptoConCuentas = Prisma.ConceptoPagoGetPayload<{ include: typeof incluirConcepto }>;

/** Proyecta un concepto al contrato. */
export function proyectarConcepto(c: ConceptoConCuentas): ConceptoPagoSalida {
  return {
    id: c.id,
    nombre: c.nombre,
    rubro: c.rubro,
    formaPagoPreferida: c.formaPagoPreferida,
    predeterminado: c.predeterminado,
    notas: c.notas,
    activo: c.activo,
    cuentas: c.cuentas.map(proyectarCuentaConcepto),
  };
}

/** Traduce el choque del unique del nombre a un error de negocio legible. */
function traducirChoque(nombre: string, error: unknown): never {
  if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
    throw new ErrorConflicto(`Ya existe un concepto de pago llamado "${nombre}".`);
  }
  throw error;
}

/**
 * Confirma que el concepto EXISTE (y lo devuelve). Se usa desde el módulo de cuentas y desde la
 * corrida: un id inventado responde 404, no un renglón sin dueño.
 */
export async function exigirConceptoPago(
  tx: Tx,
  idConcepto: number,
): Promise<{ id: number; nombre: string; activo: boolean }> {
  const concepto = await tx.conceptoPago.findUnique({
    where: { id: idConcepto },
    select: { id: true, nombre: true, activo: true },
  });
  if (concepto === null) {
    throw new ErrorNoEncontrado('ConceptoPago', idConcepto);
  }
  return concepto;
}

/**
 * Lista el catálogo (paginación, búsqueda y filtro EN EL SERVIDOR, patrón CRUD). Por omisión sólo
 * los ACTIVOS. Permiso `conceptos-pago.ver`.
 */
export async function listarConceptosPago(
  sesion: SesionUsuario,
  parametros: z.input<typeof esquemaConceptosPagoQuery> = {},
  bd?: ContextoBd,
): Promise<ConceptosPagoPagina> {
  verificarPermiso(sesion, 'conceptos-pago.ver');
  const filtros = validarEntrada(esquemaConceptosPagoQuery, parametros);
  const cliente = clienteLectura(bd);

  const where: Prisma.ConceptoPagoWhereInput = {
    ...(filtros.incluirInactivos ? {} : { activo: true }),
    ...(filtros.rubro === undefined ? {} : { rubro: filtros.rubro }),
    ...(filtros.busqueda === undefined || filtros.busqueda === ''
      ? {}
      : { nombre: { contains: filtros.busqueda, mode: 'insensitive' } }),
  };

  const [total, filas] = await Promise.all([
    cliente.conceptoPago.count({ where }),
    cliente.conceptoPago.findMany({
      where,
      // Orden estable y útil: primero los que se cargan solos (son los que Daniel revisa cada
      // semana), luego por rubro y nombre. El `id` cierra el desempate (determinista, A8).
      orderBy: [{ predeterminado: 'desc' }, { rubro: 'asc' }, { nombre: 'asc' }, { id: 'asc' }],
      skip: (filtros.pagina - 1) * filtros.porPagina,
      take: filtros.porPagina,
      include: incluirConcepto,
    }),
  ]);

  return {
    datos: filas.map(proyectarConcepto),
    total,
    pagina: filtros.pagina,
    porPagina: filtros.porPagina,
    totalPaginas: Math.max(1, Math.ceil(total / filtros.porPagina)),
  };
}

/** Obtiene un concepto con sus cuentas, o lanza 404. Permiso `conceptos-pago.ver`. */
export async function obtenerConceptoPago(
  sesion: SesionUsuario,
  idConcepto: number,
  bd?: ContextoBd,
): Promise<ConceptoPagoSalida> {
  verificarPermiso(sesion, 'conceptos-pago.ver');
  const concepto = await clienteLectura(bd).conceptoPago.findUnique({
    where: { id: idConcepto },
    include: incluirConcepto,
  });
  if (concepto === null) {
    throw new ErrorNoEncontrado('ConceptoPago', idConcepto);
  }
  return proyectarConcepto(concepto);
}

/**
 * Da de alta un concepto, en UNA transacción con su bitácora (A2/A7).
 *
 * El `rubro` sólo admite los cuatro que NO se derivan de un proveedor (lo exige el Zod y lo repite
 * un CHECK en la base): un concepto del catálogo jamás cae en la sección de maquileros ni en la de
 * proveedores.
 */
export async function crearConceptoPago(
  sesion: SesionUsuario,
  entrada: z.input<typeof esquemaConceptoPagoCrear>,
  bd?: ContextoBd,
): Promise<ConceptoPagoSalida> {
  verificarPermiso(sesion, 'conceptos-pago.administrar');
  const datos = validarEntrada(esquemaConceptoPagoCrear, entrada);

  const id = await enTransaccion(async (tx) => {
    const creado = await tx.conceptoPago
      .create({
        data: {
          nombre: datos.nombre,
          rubro: datos.rubro,
          formaPagoPreferida: datos.formaPagoPreferida ?? null,
          predeterminado: datos.predeterminado ?? false,
          notas: datos.notas === undefined || datos.notas === '' ? null : datos.notas,
          ...datosCreacion(sesion),
        },
      })
      .catch((error: unknown) => traducirChoque(datos.nombre, error));

    await registrarBitacora(tx, sesion, {
      entidad: 'ConceptoPago',
      idEntidad: creado.id,
      accion: 'CREAR',
      datos: {
        nombre: creado.nombre,
        rubro: creado.rubro,
        predeterminado: creado.predeterminado,
      },
    });
    return creado.id;
  }, bd);

  return obtenerConceptoPago(sesion, id, bd);
}

/** Campos de TEXTO editables (clave del payload === clave del modelo). */
const CAMPOS_TEXTO = ['nombre', 'notas'] as const;

/**
 * Edita un concepto (PATCH parcial: omitir = no tocar; `null`/'' = borrar el opcional), lo retira o
 * lo revive. UNA transacción con bitácora (A2/A7).
 *
 * ⚠️ Retirar un concepto NO toca las corridas que ya lo usaron: el renglón congela su nombre y su
 * rubro justo para eso. Lo único que cambia es que deja de ofrecerse y de cargarse solo.
 */
export async function actualizarConceptoPago(
  sesion: SesionUsuario,
  idConcepto: number,
  entrada: z.input<typeof esquemaConceptoPagoEditar>,
  bd?: ContextoBd,
): Promise<ConceptoPagoSalida> {
  verificarPermiso(sesion, 'conceptos-pago.administrar');
  const datos = validarEntrada(esquemaConceptoPagoEditar, entrada);

  await enTransaccion(async (tx) => {
    const actual = await tx.conceptoPago.findUnique({ where: { id: idConcepto } });
    if (actual === null) {
      throw new ErrorNoEncontrado('ConceptoPago', idConcepto);
    }

    const cambios: Prisma.ConceptoPagoUncheckedUpdateInput = { ...datosModificacion(sesion) };
    const detalle: Record<string, unknown> = {};

    for (const campo of CAMPOS_TEXTO) {
      const crudo = datos[campo];
      if (crudo === undefined) continue;
      const nuevo = crudo === null || crudo === '' ? null : crudo;
      // `nombre` nunca queda en null: el esquema lo exige con ≥1 carácter si viene.
      if (campo === 'nombre' && nuevo === null) continue;
      if (nuevo !== actual[campo]) {
        (cambios as Record<string, unknown>)[campo] = nuevo;
        detalle[campo] = { de: actual[campo], a: nuevo };
      }
    }

    if (datos.rubro !== undefined && datos.rubro !== actual.rubro) {
      cambios.rubro = datos.rubro;
      detalle.rubro = { de: actual.rubro, a: datos.rubro };
    }
    if (datos.formaPagoPreferida !== undefined) {
      const nueva = datos.formaPagoPreferida ?? null;
      if (nueva !== actual.formaPagoPreferida) {
        cambios.formaPagoPreferida = nueva;
        detalle.formaPagoPreferida = { de: actual.formaPagoPreferida, a: nueva };
      }
    }
    if (datos.predeterminado !== undefined && datos.predeterminado !== actual.predeterminado) {
      cambios.predeterminado = datos.predeterminado;
      detalle.predeterminado = { de: actual.predeterminado, a: datos.predeterminado };
    }

    const retira = datos.activo === false && actual.activo;
    const revive = datos.activo === true && !actual.activo;
    if (retira || revive) {
      cambios.activo = retira ? false : true;
    }

    if (Object.keys(detalle).length === 0 && !retira && !revive) {
      return;
    }

    await tx.conceptoPago
      .update({ where: { id: idConcepto }, data: cambios })
      .catch((error: unknown) => traducirChoque(datos.nombre ?? actual.nombre, error));

    await registrarBitacora(tx, sesion, {
      entidad: 'ConceptoPago',
      idEntidad: idConcepto,
      // Retirar es un DESACTIVAR de libro (borrado suave), no un MODIFICAR más.
      accion: retira ? 'DESACTIVAR' : 'MODIFICAR',
      datos: {
        ...detalle,
        ...(retira ? { operacion: 'retirar', nombre: actual.nombre } : {}),
        ...(revive ? { operacion: 'reactivar' } : {}),
      },
    });
  }, bd);

  return obtenerConceptoPago(sesion, idConcepto, bd);
}
