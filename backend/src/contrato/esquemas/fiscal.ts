/**
 * Validadores fiscales reutilizables (F1-E1B, R15 — proveedores; reutilizables por
 * Finanzas/CFDI en F8). Son funciones PURAS sin dependencias para poder probarlas
 * sueltas y compartirlas entre el contrato Zod del front y el back.
 *
 * Doc de negocio: `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §4
 * (campos fiscales del proveedor) y D12.
 */

/** Monedas aceptadas en el catálogo (R15 §4: MXN/USD). */
export const MONEDAS = ['MXN', 'USD'] as const;
/** Clave de moneda. */
export type Moneda = (typeof MONEDAS)[number];

/** Métodos de pago del CFDI (R15 §4): PUE (una exhibición) / PPD (parcialidades/diferido). */
export const METODOS_PAGO = ['PUE', 'PPD'] as const;
/** Clave de método de pago. */
export type MetodoPago = (typeof METODOS_PAGO)[number];

/**
 * ¿Es un RFC mexicano con forma válida? Acepta persona MORAL (12 caracteres) y
 * FÍSICA (13). NO valida contra el SAT (no hay padrón aquí), solo la forma:
 * 3–4 letras (la inicial puede ser `&` o `Ñ` en morales), 6 dígitos de fecha
 * (AAMMDD) y 3 de homoclave. Se normaliza a mayúsculas antes de validar.
 *
 * @example esRfcValido("XAXX010101000") // true (genérico nacional)
 */
export function esRfcValido(rfc: string): boolean {
  const limpio = rfc.trim().toUpperCase();
  // Moral: 3 + fecha(6) + homoclave(3) = 12. Física: 4 + 6 + 3 = 13.
  const patron = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
  if (!patron.test(limpio)) {
    return false;
  }
  // La parte de fecha debe ser plausible (mes 01–12, día 01–31).
  const fecha = limpio.length === 13 ? limpio.slice(4, 10) : limpio.slice(3, 9);
  const mes = Number(fecha.slice(2, 4));
  const dia = Number(fecha.slice(4, 6));
  return mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31;
}

/**
 * ¿Es una CLABE interbancaria válida? Exige 18 dígitos y verifica el DÍGITO DE
 * CONTROL (posición 18) con el algoritmo del Banco de México: a las primeras 17
 * cifras se les aplican los pesos 3, 7, 1 (cíclicos), se suma `(cifra*peso) mod 10`
 * de cada una, y el dígito de control es `(10 - (suma mod 10)) mod 10`.
 *
 * @example esClabeValida("002010077777777771") // true
 */
export function esClabeValida(clabe: string): boolean {
  const limpio = clabe.trim();
  if (!/^\d{18}$/.test(limpio)) {
    return false;
  }
  const PESOS = [3, 7, 1];
  let suma = 0;
  for (let i = 0; i < 17; i += 1) {
    const cifra = Number(limpio.charAt(i));
    const peso = PESOS[i % 3] ?? 1; // i%3 ∈ {0,1,2}; el `?? 1` satisface al compilador
    suma += (cifra * peso) % 10;
  }
  const control = (10 - (suma % 10)) % 10;
  return control === Number(limpio.charAt(17));
}
