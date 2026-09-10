import { esClabeValida } from '@/api/esquemas';
import type { ProveedorCuentaPago } from '@/api/tipos';

/**
 * Piezas de PRESENTACIÓN y de captura de las cuentas de pago del proveedor (0.112), fuera del
 * componente para que las comparta la pantalla (el cajón de detalle) sin romper el fast-refresh.
 */

/** Tipo de cuenta, tal como viaja en el contrato. */
export type TipoCuenta = ProveedorCuentaPago['tipoCuenta'];

/**
 * ⚠️ **ESPEJO de `backend/src/contrato/esquemas/proveedor.ts`** (`LARGO_CLABE`,
 * `LARGO_TARJETA_MIN/MAX`, `motivoCuentaInvalida`). Mismo criterio que `esClabeValida`, que ya vivía
 * duplicado en `api/esquemas.ts`: el front no importa del back, y el aviso al capturar tiene que
 * decir lo MISMO que va a contestar el servidor. Si cambian allá, cambian aquí — están anotados en
 * los dos lados. La autoridad sigue siendo el backend (A1): esto sólo evita el viaje.
 */
const LARGO_CLABE = 18;
const LARGO_TARJETA_MIN = 15;
const LARGO_TARJETA_MAX = 19;

/** Deja sólo los dígitos de un número capturado o pegado del banco (con espacios o guiones). */
export function soloDigitos(cuenta: string): string {
  return cuenta.replace(/\D/g, '');
}

/**
 * ¿Qué tiene de malo este número para el tipo declarado? Devuelve el mensaje, o `null` si está bien.
 * Espejo de `motivoCuentaInvalida` del contrato — ver la nota de arriba.
 */
export function motivoCuentaInvalida(tipo: TipoCuenta, cuenta: string): string | null {
  const digitos = soloDigitos(cuenta);
  if (digitos === '') {
    return 'Escribe el número de la cuenta.';
  }
  if (tipo === 'clabe') {
    if (digitos.length !== LARGO_CLABE) {
      return `La CLABE debe tener ${LARGO_CLABE} dígitos (llevas ${digitos.length}).`;
    }
    return esClabeValida(digitos)
      ? null
      : 'La CLABE no es válida: su dígito de control no cuadra. Revisa el número.';
  }
  if (digitos.length < LARGO_TARJETA_MIN || digitos.length > LARGO_TARJETA_MAX) {
    return `El número de tarjeta debe tener entre ${LARGO_TARJETA_MIN} y ${LARGO_TARJETA_MAX} dígitos (llevas ${digitos.length}).`;
  }
  return null;
}

/** Nombre corto del tipo de cuenta tal como se lee en pantalla. */
export function etiquetaTipoCuenta(tipo: TipoCuenta): string {
  return tipo === 'clabe' ? 'CLABE' : 'Tarjeta';
}

/**
 * Agrupa el número de 4 en 4 para poder leerlo/teclearlo sin perder la cuenta. **Completo, sin
 * enmascarar**: se usa en el EDITOR, que es donde se captura y desde donde se copia a la
 * transferencia.
 */
export function numeroLegible(cuenta: string): string {
  return cuenta.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * El número con sólo los ÚLTIMOS CUATRO a la vista. Se usa en el cajón de detalle de la lista, que
 * sirve para RECONOCER la cuenta ("ah, es la que termina en 7771"), no para transferir desde ahí:
 * un dato bancario completo no tiene por qué estar a la vista de cualquiera que abra una ficha.
 * Quien lo necesite entero lo tiene en el editor, a un clic.
 */
export function numeroEnmascarado(cuenta: string): string {
  const digitos = soloDigitos(cuenta);
  return digitos.length <= 4 ? digitos : `•••• ${digitos.slice(-4)}`;
}
