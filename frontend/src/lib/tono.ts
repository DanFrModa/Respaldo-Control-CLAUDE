/**
 * Tonos explicativos y sus utilidades de clase (rediseño "Teal fresco"). Vive
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
 *   - PT         → teal (la marca)
 *   - neutro     → gris (sin clasificar / generico)
 */

/** Tono explicativo de un tipo (material/catalogo) o estado generico. */
export type Tono = 'telas' | 'avios' | 'servicios' | 'pt' | 'neutro';

/** Clases del chip/badge (fondo + texto) por tono, con variante oscura. */
export const CLASES_BADGE_TONO: Record<Tono, string> = {
  telas: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300',
  avios: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-300',
  servicios: 'bg-pink-100 text-pink-700 dark:bg-pink-400/15 dark:text-pink-300',
  pt: 'bg-teal-100 text-teal-700 dark:bg-teal-400/15 dark:text-teal-300',
  neutro: 'bg-slate-100 text-slate-600 dark:bg-slate-400/15 dark:text-slate-300',
};

/** Degradado del avatar por tono (cuadro/circulo con iniciales o icono). */
const CLASES_AVATAR_TONO: Record<Tono, string> = {
  telas: 'bg-gradient-to-br from-indigo-400 to-indigo-600 text-white',
  avios: 'bg-gradient-to-br from-cyan-400 to-cyan-600 text-white',
  servicios: 'bg-gradient-to-br from-pink-400 to-pink-600 text-white',
  pt: 'bg-gradient-to-br from-teal-400 to-teal-600 text-white',
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
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) {
    return '?';
  }
  const primera = partes[0]?.charAt(0) ?? '';
  const segunda = partes.length > 1 ? (partes[partes.length - 1]?.charAt(0) ?? '') : '';
  return (primera + segunda).toUpperCase() || '?';
}
