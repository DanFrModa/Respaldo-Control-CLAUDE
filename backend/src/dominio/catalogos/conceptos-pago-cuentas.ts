/**
 * CUENTAS / DESTINOS DE PAGO de un CONCEPTO que no es proveedor (fila 0.125).
 *
 * **Espejo de `proveedor-cuentas-pago.ts` (0.112)** en la plomería, y ni una regla repetida: todas
 * las decisiones —validar el par (tipo, número), qué decir cuando la cuenta ya estaba, y el cruce
 * de retirar / revivir / promover— salen de `cuentas-pago-reglas.ts`, que las dos implementaciones
 * comparten. Escribirlas dos veces es el defecto que la fila 0.115 destapó en la fórmula del saldo:
 * la misma pregunta contestada en dos archivos y sólo uno arreglado.
 *
 * Por qué la tabla es aparte y no la del proveedor: un concepto NO es un proveedor (decisión de
 * Daniel). Meterlo en `proveedor_cuenta_pago` pediría una FK nullable y un CHECK polimórfico en una
 * tabla que hoy Daniel está cargando a mano en `prueba` — se tocaría dato vivo para ahorrar una
 * tabla.
 *
 * Permisos: `conceptos-pago.ver` / `conceptos-pago.administrar`. Todo cambio va en UNA transacción
 * con su bitácora (A2/A7). ⚠️ **El número de cuenta NUNCA se copia a la bitácora**: basta con saber
 * que cambió (dato bancario).
 */
import {
  esquemaConceptoPagoCuentaCrear,
  esquemaConceptoPagoCuentaEditar,
  type ConceptoPagoCuentaSalida,
} from '../../contrato/index.js';
import type { ConceptoPagoCuenta, Prisma } from '../../datos/index.js';
import type { z } from 'zod';

import { datosCreacion, datosModificacion, registrarBitacora } from '../../comun/auditoria.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import { verificarPermiso, type SesionUsuario } from '../../comun/permisos.js';
import { CODIGO_PRISMA, codigoErrorPrisma } from '../../comun/prisma-errores.js';
import {
  clienteLectura,
  enTransaccion,
  type ContextoBd,
  type Tx,
} from '../../comun/transaccion.js';
import { validarEntrada } from '../../comun/validacion.js';

import {
  exigirCuentaValida,
  MENSAJE_PROMOVER_RETIRADA,
  mensajeCuentaDuplicada,
  promoverExigeReactivar,
  resolverJuegoDeDefault,
} from './cuentas-pago-reglas.js';

/**
 * Namespace del `pg_advisory_xact_lock` que serializa el juego de LA DEFAULT de UN concepto.
 * Segunda clave = `idConcepto`. Familia 20_5xx (inventario en `modelos/fotos-modelo.ts`); el
 * proveedor usa el 20_549, éste estrena el **20_550**. Namespace PROPIO a propósito: un concepto y
 * un proveedor con el mismo id no tienen por qué esperarse el uno al otro.
 */
const NAMESPACE_LOCK_CUENTA_CONCEPTO = 20_550;

/** Orden de presentación: la DEFAULT primero, luego las activas, y al final las retiradas. */
const ORDEN_CUENTAS = [
  // `nulls: 'last'` NO es adorno: `esDefault` vale true/NULL y en Postgres un `DESC` pone los NULL
  // PRIMERO — sin esto la default saldría hasta abajo, justo al revés.
  { esDefault: { sort: 'desc', nulls: 'last' } },
  { activo: 'desc' },
  { id: 'asc' },
] satisfies Prisma.ConceptoPagoCuentaOrderByWithRelationInput[];

/** Proyecta una cuenta al contrato (`esDefault` sale como boolean puro: adentro es true/NULL). */
export function proyectarCuentaConcepto(c: ConceptoPagoCuenta): ConceptoPagoCuentaSalida {
  return {
    id: c.id,
    idConcepto: c.idConcepto,
    beneficiario: c.beneficiario,
    banco: c.banco,
    tipoCuenta: c.tipoCuenta,
    cuenta: c.cuenta,
    alias: c.alias,
    esFiscal: c.esFiscal,
    esDefault: c.esDefault === true,
    notas: c.notas,
    activo: c.activo,
  };
}

/** Serializa por concepto todo lo que toca la marca de default (retirar también la apaga). */
async function bloquearCuentasDelConcepto(tx: Tx, idConcepto: number): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE_LOCK_CUENTA_CONCEPTO}::int, ${idConcepto}::int)`;
}

/** Confirma que la cuenta existe **y es de ese concepto** (un id ajeno responde 404, no un update). */
async function exigirCuentaDelConcepto(
  tx: Tx,
  idConcepto: number,
  idCuenta: number,
): Promise<ConceptoPagoCuenta> {
  const cuenta = await tx.conceptoPagoCuenta.findFirst({ where: { id: idCuenta, idConcepto } });
  if (cuenta === null) {
    throw new ErrorNoEncontrado('ConceptoPagoCuenta', idCuenta);
  }
  return cuenta;
}

/** Exige que el número no esté YA capturado en ese concepto (mensaje compartido con el proveedor). */
async function exigirCuentaLibre(
  tx: Tx,
  idConcepto: number,
  cuenta: string,
  idActual?: number,
): Promise<void> {
  const existente = await tx.conceptoPagoCuenta.findFirst({
    where: { idConcepto, cuenta, ...(idActual === undefined ? {} : { id: { not: idActual } }) },
    select: { id: true, activo: true, beneficiario: true },
  });
  if (existente !== null) {
    throw mensajeCuentaDuplicada('Este concepto', existente);
  }
}

/**
 * Apaga la marca de default de las demás cuentas del concepto, SIEMPRE antes de encender la nueva
 * (el unique `(idConcepto, esDefault)` no perdona el orden inverso).
 *
 * La cuenta degradada lleva su `datosModificacion` y su renglón de bitácora propio (A7): sin lo
 * primero `@updatedAt` movería la fecha dejando `modificadoPorId` en quien la tocó la vez anterior;
 * sin lo segundo, «a esta cuenta le quitaron la default» no aparecería en ningún lado.
 */
async function apagarDefaultActual(
  tx: Tx,
  sesion: SesionUsuario,
  idConcepto: number,
  exceptoId?: number,
): Promise<void> {
  const anteriores = await tx.conceptoPagoCuenta.findMany({
    where: {
      idConcepto,
      esDefault: true,
      ...(exceptoId === undefined ? {} : { id: { not: exceptoId } }),
    },
    select: { id: true },
  });
  for (const anterior of anteriores) {
    await tx.conceptoPagoCuenta.update({
      where: { id: anterior.id },
      data: { esDefault: null, ...datosModificacion(sesion) },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'ConceptoPagoCuenta',
      idEntidad: anterior.id,
      accion: 'MODIFICAR',
      datos: {
        idConcepto,
        operacion: 'quitar-default',
        motivo: 'otra cuenta del concepto la reemplazó como cuenta por omisión',
        ...(exceptoId === undefined ? {} : { laReemplazo: exceptoId }),
      },
    });
  }
}

/** Traduce el choque del unique de la base (carrera residual) a un error de negocio legible. */
function traducirChoque(error: unknown): never {
  if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
    throw new ErrorConflicto(
      'Otra persona cambió las cuentas de este concepto al mismo tiempo. Vuelve a intentarlo.',
    );
  }
  throw error;
}

/** Confirma que el concepto existe (404 si no). */
async function exigirConcepto(tx: Tx, idConcepto: number): Promise<void> {
  const concepto = await tx.conceptoPago.findUnique({
    where: { id: idConcepto },
    select: { id: true },
  });
  if (concepto === null) {
    throw new ErrorNoEncontrado('ConceptoPago', idConcepto);
  }
}

/**
 * Lista las cuentas de un concepto. Por omisión sólo las ACTIVAS; con `incluirInactivas` salen
 * también las retiradas, que es como se consulta el historial reutilizable. Permiso
 * `conceptos-pago.ver`.
 */
export async function listarCuentasConcepto(
  sesion: SesionUsuario,
  idConcepto: number,
  incluirInactivas = false,
  bd?: ContextoBd,
): Promise<ConceptoPagoCuentaSalida[]> {
  verificarPermiso(sesion, 'conceptos-pago.ver');
  const cliente = clienteLectura(bd);
  const concepto = await cliente.conceptoPago.findUnique({
    where: { id: idConcepto },
    select: { id: true },
  });
  if (concepto === null) {
    throw new ErrorNoEncontrado('ConceptoPago', idConcepto);
  }
  const cuentas = await cliente.conceptoPagoCuenta.findMany({
    where: { idConcepto, ...(incluirInactivas ? {} : { activo: true }) },
    orderBy: ORDEN_CUENTAS,
  });
  return cuentas.map(proyectarCuentaConcepto);
}

/**
 * Agrega una cuenta al concepto (UNA transacción con bitácora, A2/A7).
 *
 * ⭐ **La PRIMERA cuenta nace default** (misma regla que el proveedor): capturar una cuenta y que el
 * sistema no sepa a cuál pagar sería una trampa. Las siguientes nacen sin marca y se promueven con
 * el PATCH — así el alta nunca compite por la default, y una cuenta nueva tampoco le roba el lugar
 * a las que ya estaban.
 */
export async function crearCuentaConcepto(
  sesion: SesionUsuario,
  idConcepto: number,
  entrada: z.input<typeof esquemaConceptoPagoCuentaCrear>,
  bd?: ContextoBd,
): Promise<ConceptoPagoCuentaSalida> {
  verificarPermiso(sesion, 'conceptos-pago.administrar');
  const datos = validarEntrada(esquemaConceptoPagoCuentaCrear, entrada);

  const cuenta = await enTransaccion(async (tx) => {
    await exigirConcepto(tx, idConcepto);
    await bloquearCuentasDelConcepto(tx, idConcepto);

    const numero = exigirCuentaValida(datos.tipoCuenta, datos.cuenta);
    await exigirCuentaLibre(tx, idConcepto, numero);

    // ¿Es LA PRIMERA? Mira las ACTIVAS (no sólo la marca): si ya hay cuentas y ninguna es default
    // —alguien quitó la marca, o retiró la que la tenía—, la nueva NO se la queda a escondidas.
    const yaHayCuentas = await tx.conceptoPagoCuenta.findFirst({
      where: { idConcepto, OR: [{ activo: true }, { esDefault: true }] },
      select: { id: true },
    });

    const creada = await tx.conceptoPagoCuenta
      .create({
        data: {
          idConcepto,
          beneficiario: datos.beneficiario,
          banco: datos.banco === undefined || datos.banco === '' ? null : datos.banco,
          tipoCuenta: datos.tipoCuenta,
          cuenta: numero,
          alias: datos.alias === undefined || datos.alias === '' ? null : datos.alias,
          esFiscal: datos.esFiscal ?? false,
          esDefault: yaHayCuentas === null ? true : null,
          notas: datos.notas === undefined || datos.notas === '' ? null : datos.notas,
          ...datosCreacion(sesion),
        },
      })
      .catch(traducirChoque);

    await registrarBitacora(tx, sesion, {
      entidad: 'ConceptoPagoCuenta',
      idEntidad: creada.id,
      accion: 'CREAR',
      datos: {
        idConcepto,
        beneficiario: creada.beneficiario,
        tipoCuenta: creada.tipoCuenta,
        esFiscal: creada.esFiscal,
        esDefault: creada.esDefault === true,
      },
    });
    return creada;
  }, bd);

  return proyectarCuentaConcepto(cuenta);
}

/** Campos de TEXTO editables de una cuenta (clave del payload === clave del modelo). */
const CAMPOS_TEXTO_CUENTA = ['beneficiario', 'banco', 'alias', 'notas'] as const;

/**
 * Edita una cuenta del concepto, la promueve a default, la retira o la revive. UNA transacción con
 * bitácora (A2/A7). El cruce de las tres reglas lo decide `cuentas-pago-reglas.ts`, compartido con
 * el proveedor.
 */
export async function actualizarCuentaConcepto(
  sesion: SesionUsuario,
  idConcepto: number,
  idCuenta: number,
  entrada: z.input<typeof esquemaConceptoPagoCuentaEditar>,
  bd?: ContextoBd,
): Promise<ConceptoPagoCuentaSalida> {
  verificarPermiso(sesion, 'conceptos-pago.administrar');
  const datos = validarEntrada(esquemaConceptoPagoCuentaEditar, entrada);

  const actualizada = await enTransaccion(async (tx) => {
    await bloquearCuentasDelConcepto(tx, idConcepto);
    const actual = await exigirCuentaDelConcepto(tx, idConcepto, idCuenta);

    const cambios: Prisma.ConceptoPagoCuentaUncheckedUpdateInput = {
      ...datosModificacion(sesion),
    };
    const detalle: Record<string, unknown> = {};

    for (const campo of CAMPOS_TEXTO_CUENTA) {
      const crudo = datos[campo];
      if (crudo === undefined) continue;
      const nuevo = crudo === null || crudo === '' ? null : crudo;
      // `beneficiario` nunca queda en null: el esquema lo exige con ≥1 carácter si viene.
      if (campo === 'beneficiario' && nuevo === null) continue;
      const anterior = actual[campo];
      if (nuevo !== anterior) {
        (cambios as Record<string, unknown>)[campo] = nuevo;
        detalle[campo] = { de: anterior, a: nuevo };
      }
    }

    // El par (tipo, número) se valida ENTERO aunque venga sólo la mitad: el resto está en la base.
    const tipoEfectivo = datos.tipoCuenta ?? actual.tipoCuenta;
    const numeroEfectivo = exigirCuentaValida(tipoEfectivo, datos.cuenta ?? actual.cuenta);
    if (tipoEfectivo !== actual.tipoCuenta) {
      cambios.tipoCuenta = tipoEfectivo;
      detalle.tipoCuenta = { de: actual.tipoCuenta, a: tipoEfectivo };
    }
    if (numeroEfectivo !== actual.cuenta) {
      await exigirCuentaLibre(tx, idConcepto, numeroEfectivo, idCuenta);
      cambios.cuenta = numeroEfectivo;
      // El número NO se copia a la bitácora: basta con saber que cambió (dato bancario, A7).
      detalle.cuenta = { cambio: true };
    }

    if (datos.esFiscal !== undefined && datos.esFiscal !== actual.esFiscal) {
      cambios.esFiscal = datos.esFiscal;
      detalle.esFiscal = { de: actual.esFiscal, a: datos.esFiscal };
    }

    const juego = resolverJuegoDeDefault(actual, datos);
    const { retira, revive, promueve, degrada } = juego;
    if (retira) {
      cambios.activo = false;
    } else if (revive) {
      cambios.activo = true;
    }

    if (promoverExigeReactivar(actual, juego)) {
      throw new ErrorValidacion(MENSAJE_PROMOVER_RETIRADA);
    }
    if (promueve) {
      await apagarDefaultActual(tx, sesion, idConcepto, idCuenta);
      cambios.esDefault = true;
    } else if (degrada) {
      cambios.esDefault = null;
    }

    if (Object.keys(detalle).length === 0 && !retira && !revive && !promueve && !degrada) {
      return actual;
    }

    const guardada = await tx.conceptoPagoCuenta
      .update({ where: { id: idCuenta }, data: cambios })
      .catch(traducirChoque);

    await registrarBitacora(tx, sesion, {
      entidad: 'ConceptoPagoCuenta',
      idEntidad: idCuenta,
      accion: retira ? 'DESACTIVAR' : 'MODIFICAR',
      datos: {
        idConcepto,
        ...detalle,
        ...(retira ? { operacion: 'retirar', beneficiario: actual.beneficiario } : {}),
        ...(revive ? { operacion: 'reactivar' } : {}),
        ...(promueve ? { operacion: 'default' } : {}),
        ...(degrada ? { operacion: 'quitar-default' } : {}),
      },
    });

    return guardada;
  }, bd);

  return proyectarCuentaConcepto(actualizada);
}
