/**
 * ⭐ CUENTAS / DESTINOS DE PAGO del proveedor (0.112) — el beneficiario y sus varias cuentas.
 *
 * 🔴 **Esto no salió de una entrevista: salió de LEER el Excel con el que Daniel paga cada semana**
 * (~150 beneficiarios). Dos hallazgos, y ninguno cabía en `Proveedor.banco` + `Proveedor.clabe`:
 *
 * 🔒 **Los nombres de aquí abajo («TALLER NORTE 1/2/3», «TALLER PONIENTE», «TALLER SUR») son
 * INVENTADOS.** Los reales son proveedores PERSONA FÍSICA y este repositorio es PÚBLICO: un alias
 * pegado a información de pago es dato personal (fila 0.123). **No los "restaures" nunca.**
 *
 *  1. **El BENEFICIARIO casi nunca es el proveedor.** El renglón «TALLER NORTE 1» se deposita a
 *     OTRA persona; «TALLER PONIENTE» y «TALLER SUR», igual. No había dónde guardar ese nombre.
 *  2. **«TALLER NORTE 1 / 2 / 3» no son tres proveedores: es UNO con TRES cuentas**, partido en
 *     tres renglones porque Excel no sabe modelar otra cosa. Daniel, textual: *«Estaría bien poder
 *     tener más de una cuenta, definir una como default, pero tener las demás como historial de
 *     cuentas, para poder reutilizarlas.»*
 *
 * Y la marca fiscal, también textual: *«Tendría una cuenta Fiscal, y podría tener más de una cuenta
 * no fiscal.»* `esFiscal` existe para habilitar la guarda de que **un pago CON factura sólo salga a
 * una cuenta fiscal** — si sale a la cuenta personal de alguien, el pago y el comprobante dejan de
 * corresponder. **Esa guarda la construye la fila que pague; aquí sólo vive la marca.**
 *
 * 📌 **Un pago PARTIDO son DOS pagos**, cada uno con su cuenta destino y su renglón en la relación
 * (*«así debe salir para poder hacer las dos transferencias»*). Nada de aquí asume "una cuenta por
 * proveedor por semana": la cuenta se elige POR PAGO.
 *
 * ── Las reglas que este archivo sostiene ──────────────────────────────────────────────────────
 *  • **Una sola default por proveedor**, garantizada por LA BASE: `@@unique([idProveedor,
 *    esDefault])` con `esDefault` = `true` / NULL (los NULL son distintos entre sí en Postgres).
 *    Aquí, además, se serializa con un `pg_advisory_xact_lock` por proveedor para que dos personas
 *    promoviendo a la vez se esperen en vez de chocar; el unique es la red de abajo.
 *  • **Retirar NO borra (D3):** `activo = false` deja la cuenta como HISTORIAL REUTILIZABLE. Una
 *    cuenta retirada pierde la marca de default (una cuenta que ya no se usa no puede ser "la de
 *    siempre") y se puede revivir después, sin robarle la default a nadie.
 *  • **Un proveedor SIN cuentas es normal** y no rompe nada — es el estado de todos los migrados
 *    (REGLA 0-B: `banco`/`clabe` viejos NO se convierten en cuentas; Daniel las captura en el
 *    arranque).
 *
 * SIN permisos nuevos: se gobierna con `proveedores.ver` / `proveedores.administrar`, que ya
 * existen. Todo cambio va en UNA transacción con su bitácora (A2/A7).
 */
import {
  esquemaProveedorCuentaPagoCrear,
  esquemaProveedorCuentaPagoEditarCuerpo,
  motivoCuentaInvalida,
  normalizarNumeroDeCuenta,
  type TipoCuentaPagoClave,
} from '../../contrato/index.js';
import type { Prisma, ProveedorCuentaPago } from '../../datos/index.js';

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

import { exigirProveedor } from './proveedores.js';

/**
 * Namespace del `pg_advisory_xact_lock` que serializa el juego de LA DEFAULT de UN proveedor.
 * Segunda clave = `idProveedor`. Inventario de la familia 20_5xx en `modelos/fotos-modelo.ts`;
 * éste estrena el 20_549.
 *
 * Sin él, dos promociones simultáneas se resuelven igual (el unique de la base impide las dos
 * defaults), pero una de las dos muere con un 409 que el usuario no entiende. Con él, la segunda
 * espera, ve el mundo ya cambiado y hace lo suyo: las dos terminan bien y la última manda.
 */
const NAMESPACE_LOCK_CUENTA_DEFAULT = 20_549;

/** Una cuenta de pago tal como sale del dominio (la ruta la proyecta al contrato). */
export type CuentaPagoProveedor = ProveedorCuentaPago;

/**
 * Orden de presentación: la DEFAULT primero, luego las activas, y al final las retiradas.
 *
 * ⚠️ `nulls: 'last'` NO es adorno. `esDefault` vale `true`/NULL, y en Postgres un `ORDER BY … DESC`
 * pone los NULL PRIMERO: sin esto, la default saldría hasta abajo — justo al revés.
 */
const ORDEN_CUENTAS = [
  { esDefault: { sort: 'desc', nulls: 'last' } },
  { activo: 'desc' },
  { id: 'asc' },
] satisfies Prisma.ProveedorCuentaPagoOrderByWithRelationInput[];

/**
 * Serializa por proveedor todo lo que toca la marca de default. Se toma SIEMPRE al entrar a una
 * escritura (no sólo cuando se promueve): retirar la default también la apaga, y eso compite.
 */
async function bloquearCuentasDelProveedor(tx: Tx, idProveedor: number): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NAMESPACE_LOCK_CUENTA_DEFAULT}::int, ${idProveedor}::int)`;
}

/**
 * Confirma que la cuenta EXISTE **y es de ese proveedor**. Un id de cuenta ajeno responde 404, no
 * un update silencioso a la ficha equivocada (A9: nunca se opera sobre lo ajeno).
 */
async function exigirCuentaDelProveedor(
  tx: Tx,
  idProveedor: number,
  idCuenta: number,
): Promise<ProveedorCuentaPago> {
  const cuenta = await tx.proveedorCuentaPago.findFirst({
    where: { id: idCuenta, idProveedor },
  });
  if (cuenta === null) {
    throw new ErrorNoEncontrado('ProveedorCuentaPago', idCuenta);
  }
  return cuenta;
}

/**
 * Valida el par EFECTIVO (tipo, número) con la MISMA función pura que usa el Zod del alta, y
 * devuelve el número ya normalizado (sólo dígitos). En la edición el par puede venir mitad del
 * cuerpo y mitad de la base: cambiar sólo el tipo de una CLABE a "tarjeta" tiene que revalidarse
 * contra el número guardado, y por eso esto vive aquí y no en el esquema.
 */
function exigirCuentaValida(tipo: TipoCuentaPagoClave, cuenta: string): string {
  const motivo = motivoCuentaInvalida(tipo, cuenta);
  if (motivo !== null) {
    throw new ErrorValidacion(motivo);
  }
  return normalizarNumeroDeCuenta(cuenta);
}

/**
 * Exige que el número no esté YA capturado en ese proveedor. Si choca con una RETIRADA lo dice: es
 * historial reutilizable, la salida es revivirla, no capturarla otra vez (D3).
 */
async function exigirCuentaLibre(
  tx: Tx,
  idProveedor: number,
  cuenta: string,
  idActual?: number,
): Promise<void> {
  const existente = await tx.proveedorCuentaPago.findFirst({
    where: { idProveedor, cuenta, ...(idActual === undefined ? {} : { id: { not: idActual } }) },
    select: { id: true, activo: true, beneficiario: true },
  });
  if (existente !== null) {
    throw new ErrorConflicto(
      existente.activo
        ? `Este proveedor ya tiene esa cuenta registrada (a nombre de "${existente.beneficiario}").`
        : `Este proveedor ya tuvo esa cuenta (a nombre de "${existente.beneficiario}"); está ` +
            `retirada y puedes reactivarla en vez de capturarla de nuevo.`,
    );
  }
}

/**
 * Apaga la marca de default de las demás cuentas del proveedor. Se llama SIEMPRE antes de encender
 * la nueva, dentro del lock: el unique `(idProveedor, esDefault)` no perdona el orden inverso.
 *
 * ⚠️ **La cuenta degradada es un CAMBIO SUYO, no un efecto secundario invisible (A7).** Por eso
 * lleva su `datosModificacion(sesion)` y su renglón de bitácora propio: sin lo primero, `@updatedAt`
 * movía la fecha mientras `modificadoPorId` se quedaba con quien la tocó la vez ANTERIOR —la fila
 * afirmando que la modificó alguien que no fue—; sin lo segundo, "a esta cuenta le quitaron la
 * default" no aparecía en ningún lado. Un `updateMany` no puede hacer ninguna de las dos, así que
 * primero se busca cuál era y luego se actualiza por id.
 *
 * Dentro del lock hay UNA como mucho (lo garantiza el unique), pero el barrido no lo da por hecho:
 * itera lo que encuentre.
 */
async function apagarDefaultActual(
  tx: Tx,
  sesion: SesionUsuario,
  idProveedor: number,
  exceptoId?: number,
): Promise<void> {
  const anteriores = await tx.proveedorCuentaPago.findMany({
    where: {
      idProveedor,
      esDefault: true,
      ...(exceptoId === undefined ? {} : { id: { not: exceptoId } }),
    },
    select: { id: true, beneficiario: true },
  });

  for (const anterior of anteriores) {
    await tx.proveedorCuentaPago.update({
      where: { id: anterior.id },
      data: { esDefault: null, ...datosModificacion(sesion) },
    });
    await registrarBitacora(tx, sesion, {
      entidad: 'ProveedorCuentaPago',
      idEntidad: anterior.id,
      accion: 'MODIFICAR',
      datos: {
        idProveedor,
        operacion: 'quitar-default',
        motivo: 'otra cuenta del proveedor la reemplazó como cuenta por omisión',
        ...(exceptoId === undefined ? {} : { laReemplazo: exceptoId }),
      },
    });
  }
}

/** Traduce el choque del unique de la base (carrera residual) a un error de negocio legible. */
function traducirChoque(error: unknown): never {
  if (codigoErrorPrisma(error) === CODIGO_PRISMA.unicidad) {
    throw new ErrorConflicto(
      'Otra persona cambió las cuentas de este proveedor al mismo tiempo. Vuelve a intentarlo.',
    );
  }
  throw error;
}

/**
 * Lista las cuentas de pago de un proveedor. Por omisión sólo las ACTIVAS; con `incluirInactivas`
 * salen también las retiradas, que es como se consulta el **historial reutilizable**.
 * Permiso `proveedores.ver`.
 */
export async function listarCuentasPagoProveedor(
  sesion: SesionUsuario,
  idProveedor: number,
  incluirInactivas = false,
  bd?: ContextoBd,
): Promise<CuentaPagoProveedor[]> {
  verificarPermiso(sesion, 'proveedores.ver');
  const cliente = clienteLectura(bd);
  const proveedor = await cliente.proveedor.findUnique({
    where: { id: idProveedor },
    select: { id: true },
  });
  if (proveedor === null) {
    throw new ErrorNoEncontrado('Proveedor', idProveedor);
  }
  return cliente.proveedorCuentaPago.findMany({
    where: { idProveedor, ...(incluirInactivas ? {} : { activo: true }) },
    orderBy: ORDEN_CUENTAS,
  });
}

/**
 * Agrega una cuenta al proveedor, en UNA transacción con su bitácora (A2/A7).
 *
 * ⭐ **La PRIMERA cuenta nace default.** Si el proveedor no tiene ninguna cuenta activa, ésta lo
 * queda: capturar una cuenta y que el sistema no sepa a cuál pagar sería una trampa. Las siguientes
 * nacen sin marca y se promueven con el PATCH — así el alta nunca compite por la default, y una
 * cuenta nueva tampoco le roba el lugar a las que ya estaban cuando el proveedor se quedó sin
 * default (eso se arregla marcando una a mano, que es lo que la pantalla pide).
 */
export async function crearCuentaPagoProveedor(
  sesion: SesionUsuario,
  idProveedor: number,
  entrada: unknown,
  bd?: ContextoBd,
): Promise<CuentaPagoProveedor> {
  verificarPermiso(sesion, 'proveedores.administrar');
  const datos = validarEntrada(esquemaProveedorCuentaPagoCrear, entrada);

  return enTransaccion(async (tx) => {
    await exigirProveedor(tx, idProveedor);
    await bloquearCuentasDelProveedor(tx, idProveedor);

    const numero = exigirCuentaValida(datos.tipoCuenta, datos.cuenta);
    await exigirCuentaLibre(tx, idProveedor, numero);

    // ⭐ ¿Ésta es LA PRIMERA? Sólo entonces nace default. La condición mira las ACTIVAS, no sólo la
    // marca: si el proveedor ya tiene cuentas activas y ninguna es la default (alguien quitó la
    // marca, o retiró la que la tenía), la nueva NO se la queda a escondidas — sería absurdo que la
    // recién capturada le ganara el lugar a tres que llevan meses ahí, y peor que se enterara el día
    // del pago. El `esDefault: true` del OR es cinturón: con una default viva jamás se enciende otra
    // aquí (el unique lo rebotaría con un 409 que nadie entendería).
    const yaHayCuentas = await tx.proveedorCuentaPago.findFirst({
      where: { idProveedor, OR: [{ activo: true }, { esDefault: true }] },
      select: { id: true },
    });

    const cuenta = await tx.proveedorCuentaPago
      .create({
        data: {
          idProveedor,
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
      entidad: 'ProveedorCuentaPago',
      idEntidad: cuenta.id,
      accion: 'CREAR',
      datos: {
        idProveedor,
        beneficiario: cuenta.beneficiario,
        tipoCuenta: cuenta.tipoCuenta,
        esFiscal: cuenta.esFiscal,
        esDefault: cuenta.esDefault === true,
      },
    });

    return cuenta;
  }, bd);
}

/** Campos de TEXTO editables de una cuenta (clave del payload === clave del modelo). */
const CAMPOS_TEXTO_CUENTA = ['beneficiario', 'banco', 'alias', 'notas'] as const;

/**
 * Edita una cuenta (PATCH parcial: omitir = no tocar; `null`/'' = borrar el dato opcional), la
 * promueve a default, la retira o la revive. Todo en UNA transacción con bitácora (A2/A7).
 *
 * ⭐ **Las tres reglas que se cruzan aquí, y en qué orden se resuelven:**
 *  1. **Retirar gana sobre promover.** `activo: false` retira la cuenta y le quita la default: una
 *     cuenta que ya no se usa no puede ser "la de siempre". Si en el mismo cuerpo venía
 *     `esDefault: true`, se ignora (retirar es la intención dominante).
 *  2. **Revivir NO promueve.** Una cuenta rescatada del historial vuelve SIN marca: la default de
 *     hoy sigue siendo la de hoy hasta que alguien diga lo contrario.
 *  3. **Promover apaga a la anterior** dentro del lock y ANTES de encender la nueva (el unique de
 *     la base no perdona el orden inverso). `esDefault: false` sólo quita la marca — el proveedor se
 *     queda sin default hasta que alguien elija otra: promover a ciegas la "que quedaba" es
 *     exactamente el tipo de magia que hace que un pago salga a la cuenta equivocada.
 */
export async function actualizarCuentaPagoProveedor(
  sesion: SesionUsuario,
  idProveedor: number,
  idCuenta: number,
  entrada: unknown,
  bd?: ContextoBd,
): Promise<CuentaPagoProveedor> {
  verificarPermiso(sesion, 'proveedores.administrar');
  const datos = validarEntrada(esquemaProveedorCuentaPagoEditarCuerpo, entrada);

  return enTransaccion(async (tx) => {
    await bloquearCuentasDelProveedor(tx, idProveedor);
    const actual = await exigirCuentaDelProveedor(tx, idProveedor, idCuenta);

    const cambios: Prisma.ProveedorCuentaPagoUncheckedUpdateInput = {
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
      await exigirCuentaLibre(tx, idProveedor, numeroEfectivo, idCuenta);
      cambios.cuenta = numeroEfectivo;
      // El número NO se copia a la bitácora: basta con saber que cambió (dato bancario, A7).
      detalle.cuenta = { cambio: true };
    }

    if (datos.esFiscal !== undefined && datos.esFiscal !== actual.esFiscal) {
      cambios.esFiscal = datos.esFiscal;
      detalle.esFiscal = { de: actual.esFiscal, a: datos.esFiscal };
    }

    const retira = datos.activo === false && actual.activo;
    const revive = datos.activo === true && !actual.activo;
    if (retira) {
      cambios.activo = false;
    } else if (revive) {
      cambios.activo = true;
    }

    // ── La default ────────────────────────────────────────────────────────────────────────────
    const eraDefault = actual.esDefault === true;
    // Regla 1: retirar gana. Regla 2: revivir no promueve (una cuenta inactiva nunca es default,
    // así que al revivir simplemente no se enciende nada).
    const quiereDefault = retira ? false : (datos.esDefault ?? eraDefault);
    let promueve = false;
    let degrada = false;

    if (quiereDefault && !eraDefault) {
      if (!actual.activo && !revive) {
        throw new ErrorValidacion(
          'Esa cuenta está retirada: reactívala antes de dejarla como la cuenta por omisión.',
        );
      }
      await apagarDefaultActual(tx, sesion, idProveedor, idCuenta);
      cambios.esDefault = true;
      promueve = true;
    } else if (!quiereDefault && eraDefault) {
      cambios.esDefault = null;
      degrada = true;
    }

    if (Object.keys(detalle).length === 0 && !retira && !revive && !promueve && !degrada) {
      return actual;
    }

    const actualizada = await tx.proveedorCuentaPago
      .update({ where: { id: idCuenta }, data: cambios })
      .catch(traducirChoque);

    await registrarBitacora(tx, sesion, {
      entidad: 'ProveedorCuentaPago',
      idEntidad: idCuenta,
      // Retirar una cuenta es un DESACTIVAR de libro (borrado suave), no un MODIFICAR más.
      accion: retira ? 'DESACTIVAR' : 'MODIFICAR',
      datos: {
        idProveedor,
        ...detalle,
        ...(retira ? { operacion: 'retirar', beneficiario: actual.beneficiario } : {}),
        ...(revive ? { operacion: 'reactivar' } : {}),
        ...(promueve ? { operacion: 'default' } : {}),
        ...(degrada ? { operacion: 'quitar-default' } : {}),
      },
    });

    return actualizada;
  }, bd);
}
