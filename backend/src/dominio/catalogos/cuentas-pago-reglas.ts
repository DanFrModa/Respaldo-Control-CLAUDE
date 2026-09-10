/**
 * ⭐ LAS REGLAS DE UNA CUENTA / DESTINO DE PAGO — **DEFINICIÓN ÚNICA** (fila 0.125).
 *
 * Hay DOS tablas de cuentas de pago con la misma forma: la del **proveedor**
 * (`ProveedorCuentaPago`, 0.112) y la del **concepto que no es proveedor**
 * (`ConceptoPagoCuenta`, 0.125 — Daniel: *«que sean un catálogo aparte, no proveedores»*). Son dos
 * tablas a propósito: un concepto no tiene RFC ni estado de cuenta, y meterlo en la del proveedor
 * pediría una FK nullable y un CHECK polimórfico en una tabla que Daniel ya está cargando a mano.
 *
 * **Pero las REGLAS son una sola**, y aquí viven. Este archivo NO toca la base: sólo decide. Las dos
 * implementaciones (`proveedor-cuentas-pago.ts` y `conceptos-pago-cuentas.ts`) ponen la plomería de
 * Prisma y le preguntan a esto **todo lo que es una decisión**:
 *
 *  • si el par (tipo, número) es válido → {@link exigirCuentaValida} (que a su vez usa la función
 *    pura del contrato, la MISMA que valida el Zod del alta y la que usa el espejo del frontend);
 *  • qué decir cuando el número ya estaba capturado → {@link mensajeCuentaDuplicada};
 *  • cómo se resuelven las TRES reglas que se cruzan al editar (retirar / revivir / promover) →
 *    {@link resolverJuegoDeDefault}.
 *
 * El día que Daniel cambie una de estas reglas, se cambia UNA vez. Escribirlas dos veces es
 * exactamente el defecto que la fila 0.115 destapó en la fórmula del saldo: la misma pregunta
 * contestada en dos archivos, y sólo uno arreglado.
 *
 * ⚠️ Lo que NO está aquí: la unicidad «una sola default», que la garantiza **la base** con
 * `@@unique([dueño, esDefault])` y el truco de `true`/NULL (los NULL son distintos entre sí en
 * Postgres). Esto decide QUÉ hacer; la base impide que dos decisiones concurrentes se pisen.
 */
import { motivoCuentaInvalida, normalizarNumeroDeCuenta } from '../../contrato/index.js';
import type { TipoCuentaPagoClave } from '../../contrato/index.js';

import { ErrorConflicto, ErrorValidacion } from '../../comun/errores.js';

/**
 * Valida el par EFECTIVO (tipo, número) y devuelve el número ya normalizado (sólo dígitos).
 *
 * Se valida ENTERO aunque en una edición venga sólo la mitad: cambiar el tipo de una CLABE a
 * «tarjeta» tiene que revalidarse contra el número guardado. Por eso la decisión vive en el dominio
 * y no en el Zod del alta (que sólo ve cuerpos completos) — la autoridad es el servidor (A1).
 */
export function exigirCuentaValida(tipo: TipoCuentaPagoClave, cuenta: string): string {
  const motivo = motivoCuentaInvalida(tipo, cuenta);
  if (motivo !== null) {
    throw new ErrorValidacion(motivo);
  }
  return normalizarNumeroDeCuenta(cuenta);
}

/**
 * El mensaje de «esa cuenta ya está capturada aquí», con el matiz que importa: si la que choca está
 * RETIRADA, la salida es **revivirla**, no capturarla de nuevo (es historial reutilizable, D3).
 * Capturarla otra vez dejaría dos filas para el mismo destino y la relación de pago tendría dos
 * renglones idénticos con distinto id.
 *
 * @param dueño  cómo llamar al dueño en el mensaje: `'Este proveedor'` / `'Este concepto'`.
 */
export function mensajeCuentaDuplicada(
  dueño: string,
  existente: { activo: boolean; beneficiario: string },
): ErrorConflicto {
  return new ErrorConflicto(
    existente.activo
      ? `${dueño} ya tiene esa cuenta registrada (a nombre de "${existente.beneficiario}").`
      : `${dueño} ya tuvo esa cuenta (a nombre de "${existente.beneficiario}"); está retirada y ` +
          `puedes reactivarla en vez de capturarla de nuevo.`,
  );
}

/** Lo que el PATCH pide sobre el estado y la marca de default de una cuenta. */
export interface PeticionDefault {
  /** `false` retira la cuenta, `true` la revive, `undefined` no toca el estado. */
  activo?: boolean | undefined;
  /** `true` la promueve a cuenta por omisión, `false` le quita la marca. */
  esDefault?: boolean | undefined;
}

/** Cómo está HOY la cuenta que se va a editar. */
export interface EstadoCuentaActual {
  activo: boolean;
  /** La columna vale `true` / NULL, nunca `false`: aquí el "no" se escribe NULL. */
  esDefault: boolean | null;
}

/** Qué hay que hacer, ya resuelto el cruce de las tres reglas. */
export interface JuegoDeDefault {
  /** La cuenta pasa a retirada (borrado suave, D3). */
  retira: boolean;
  /** La cuenta vuelve del historial. */
  revive: boolean;
  /** Hay que apagar la default anterior y encender ésta. */
  promueve: boolean;
  /** Hay que quitarle la marca sin promover a nadie más. */
  degrada: boolean;
}

/**
 * ⭐ LAS TRES REGLAS QUE SE CRUZAN AL EDITAR UNA CUENTA, y en qué orden se resuelven. Es la parte
 * que de verdad no puede estar escrita dos veces: cada una existe por un motivo concreto y las tres
 * se contradicen si se aplican en otro orden.
 *
 *  1. **Retirar gana sobre promover.** Una cuenta que ya no se usa no puede ser «la de siempre». Si
 *     el mismo cuerpo trae `activo: false` y `esDefault: true`, retirar es la intención dominante y
 *     la marca se apaga.
 *  2. **Revivir NO promueve.** Una cuenta rescatada del historial vuelve SIN marca: la default de
 *     hoy sigue siendo la de hoy hasta que alguien diga lo contrario.
 *  3. **Quitar la marca no promueve a nadie.** `esDefault: false` deja al dueño SIN default hasta
 *     que alguien elija otra: promover a ciegas «la que quedaba» es justo la clase de magia que
 *     hace que un pago salga a la cuenta equivocada.
 *
 * Un caso que NO se decide aquí porque no es una decisión sino un error de uso: promover una cuenta
 * RETIRADA sin revivirla en el mismo cuerpo. Lo detecta {@link promoverExigeReactivar}.
 */
export function resolverJuegoDeDefault(
  actual: EstadoCuentaActual,
  datos: PeticionDefault,
): JuegoDeDefault {
  const eraDefault = actual.esDefault === true;
  const retira = datos.activo === false && actual.activo;
  const revive = datos.activo === true && !actual.activo;
  // Regla 1 (retirar gana) + regla 2 (revivir no promueve: al revivir simplemente no se enciende
  // nada, porque una cuenta inactiva nunca fue default).
  const quiereDefault = retira ? false : (datos.esDefault ?? eraDefault);
  return {
    retira,
    revive,
    promueve: quiereDefault && !eraDefault,
    // Regla 3: quitar la marca no promueve a nadie más.
    degrada: !quiereDefault && eraDefault,
  };
}

/**
 * ¿Este PATCH intenta dejar como cuenta por omisión una cuenta que está RETIRADA y que tampoco se
 * está reactivando? Es un error de uso, no una decisión: la salida es reactivarla primero.
 */
export function promoverExigeReactivar(actual: EstadoCuentaActual, juego: JuegoDeDefault): boolean {
  return juego.promueve && !actual.activo && !juego.revive;
}

/** El mensaje de ese error de uso, igual en los dos catálogos. */
export const MENSAJE_PROMOVER_RETIRADA =
  'Esa cuenta está retirada: reactívala antes de dejarla como la cuenta por omisión.';
