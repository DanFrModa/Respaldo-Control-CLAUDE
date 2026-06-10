/**
 * Utilidades del tema (claro / oscuro) de CONTROL v2.
 *
 * Convencion de theming compatible con shadcn/ui (que llega en E4): la clase
 * `dark` se aplica al elemento `<html>` y los colores son variables CSS
 * definidas en `index.css` (`:root` = claro; `.dark` = oscuro). Mantener esta
 * convencion permite que Tailwind v4 + shadcn la hereden sin refactor.
 *
 * El tema por defecto es CLARO: NO se sigue `prefers-color-scheme` del sistema
 * operativo; claro es la base y el usuario decide con el alternador.
 */

/** Temas disponibles. */
export type Tema = 'claro' | 'oscuro';

/** Clave de localStorage donde se persiste la eleccion del usuario. */
export const CLAVE_TEMA = 'control-v2-tema';

/** Tema usado cuando el usuario nunca ha elegido uno. */
export const TEMA_POR_DEFECTO: Tema = 'claro';

/**
 * Lee el tema persistido en localStorage. Devuelve `null` si no hay ninguno
 * guardado o si el valor almacenado no es valido.
 */
export function leerTemaGuardado(): Tema | null {
  try {
    const valor = localStorage.getItem(CLAVE_TEMA);
    return valor === 'claro' || valor === 'oscuro' ? valor : null;
  } catch {
    // localStorage puede no estar disponible (modo privado, etc.): sin persistencia.
    return null;
  }
}

/** Guarda el tema elegido en localStorage (silencioso si no se puede). */
export function guardarTema(tema: Tema): void {
  try {
    localStorage.setItem(CLAVE_TEMA, tema);
  } catch {
    // Sin persistencia disponible; el tema sigue funcionando en memoria.
  }
}

/** Aplica el tema al elemento `<html>` agregando/quitando la clase `dark`. */
export function aplicarTema(tema: Tema): void {
  document.documentElement.classList.toggle('dark', tema === 'oscuro');
}

/** Devuelve el tema actualmente aplicado segun la clase del `<html>`. */
export function temaActual(): Tema {
  return document.documentElement.classList.contains('dark') ? 'oscuro' : 'claro';
}
