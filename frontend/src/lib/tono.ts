/**
 * Tonos explicativos y sus utilidades de clase (rediseño R1 verde). Vive
 * aparte de los componentes visuales (`components/dominio/visuales.tsx`) para no
 * mezclar exportaciones de funciones con las de componentes (regla fast-refresh).
 *
 * Colores EXPLICATIVOS que ayudan a leer la pantalla de un vistazo. A diferencia
 * de los tokens de `index.css` (que retematizan toda la app), aqui se usan
 * utilidades de la paleta de Tailwind con su variante `dark:` por tono, porque son
 * acentos informativos puntuales (no superficies base).
 *
 * Tonos por tipo de catalogo/material:
 *   - Telas      → indigo
 *   - Avios      → cian
 *   - Servicios  → rosa
 *   - PT         → esmeralda (el verde de marca del rediseño)
 *   - neutro     → gris (sin clasificar / generico)
 */

/** Tono explicativo de un tipo (material/catalogo) o estado generico. */
export type Tono = 'telas' | 'avios' | 'servicios' | 'pt' | 'neutro';

/** Clases del chip/badge (fondo + texto) por tono, con variante oscura. */
export const CLASES_BADGE_TONO: Record<Tono, string> = {
  telas: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300',
  avios: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-300',
  servicios: 'bg-pink-100 text-pink-700 dark:bg-pink-400/15 dark:text-pink-300',
  pt: 'bg-primary-soft text-primary-soft-foreground',
  neutro: 'bg-slate-100 text-slate-600 dark:bg-slate-400/15 dark:text-slate-300',
};

/** Degradado del avatar por tono (cuadro/circulo con iniciales o icono). */
const CLASES_AVATAR_TONO: Record<Tono, string> = {
  telas: 'bg-gradient-to-br from-indigo-400 to-indigo-600 text-white',
  avios: 'bg-gradient-to-br from-cyan-400 to-cyan-600 text-white',
  servicios: 'bg-gradient-to-br from-pink-400 to-pink-600 text-white',
  pt: 'bg-gradient-to-br from-emerald-500 to-emerald-700 text-white',
  neutro:
    'bg-gradient-to-br from-slate-300 to-slate-500 text-white dark:from-slate-500 dark:to-slate-700',
};

/**
 * Devuelve las clases del degradado de avatar para un tono. Util cuando se quiere
 * componer el avatar a mano (p. ej. con un icono en vez de iniciales).
 */
export function avatarPorTono(tono: Tono): string {
  return CLASES_AVATAR_TONO[tono];
}

/** Toma hasta dos iniciales de un nombre (para el avatar). */
export function iniciales(nombre: string): string {
  // Solo palabras que empiezan con letra/dígito: nombres con puntuación colgante
  // ("360 Equilibrium -", "FR moda -") no producen iniciales tipo "3-" o "F-".
  const todas = nombre.trim().split(/\s+/).filter(Boolean);
  const partes = todas.filter((p) => /^[\p{L}\p{N}]/u.test(p));
  const base = partes.length > 0 ? partes : todas;
  if (base.length === 0) {
    return '?';
  }
  const primera = base[0]?.charAt(0) ?? '';
  const segunda = base.length > 1 ? (base[base.length - 1]?.charAt(0) ?? '') : '';
  return (primera + segunda).toUpperCase() || '?';
}
