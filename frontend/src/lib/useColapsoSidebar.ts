import { useCallback, useState } from 'react';

/**
 * Estado de colapso del sidebar de escritorio, persistido en localStorage (clave
 * `control-v2-sidebar`). Mismo patron `try/catch` silencioso que `tema.ts`: si no
 * hay localStorage (modo privado, etc.) el colapso sigue funcionando en memoria.
 *
 * Por defecto el sidebar arranca EXPANDIDO. El usuario lo contrae para ganar
 * espacio; en modo colapsado solo se ven los iconos (con tooltip).
 */

/** Clave de localStorage donde se persiste el colapso del sidebar. */
const CLAVE_COLAPSO_SIDEBAR = 'control-v2-sidebar';

/** Lee el colapso persistido; `false` (expandido) si no hay nada guardado. */
function leerColapso(): boolean {
  try {
    return localStorage.getItem(CLAVE_COLAPSO_SIDEBAR) === 'colapsado';
  } catch {
    return false;
  }
}

/** Guarda el colapso (silencioso si no se puede). */
function guardarColapso(colapsado: boolean): void {
  try {
    localStorage.setItem(CLAVE_COLAPSO_SIDEBAR, colapsado ? 'colapsado' : 'expandido');
  } catch {
    // Sin persistencia disponible; el estado sigue en memoria.
  }
}

/** Resultado de {@link useColapsoSidebar}. */
interface UsoColapsoSidebar {
  /** ¿El sidebar esta colapsado (solo iconos)? */
  colapsado: boolean;
  /** Alterna entre expandido y colapsado, persistiendo el cambio. */
  alternar: () => void;
  /**
   * Fuerza la expansion (persistida): la usa el riel colapsado cuando el
   * usuario abre un desplegable (los hijos no caben en 62px).
   */
  expandir: () => void;
}

/** Hook del colapso del sidebar de escritorio (persistido). */
export function useColapsoSidebar(): UsoColapsoSidebar {
  const [colapsado, setColapsado] = useState<boolean>(() => leerColapso());

  const alternar = useCallback(() => {
    setColapsado((anterior) => {
      const siguiente = !anterior;
      guardarColapso(siguiente);
      return siguiente;
    });
  }, []);

  const expandir = useCallback(() => {
    guardarColapso(false);
    setColapsado(false);
  }, []);

  return { colapsado, alternar, expandir };
}
