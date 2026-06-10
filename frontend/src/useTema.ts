import { useCallback, useState } from 'react';

import { aplicarTema, guardarTema, type Tema, temaActual } from './tema.ts';

/** Resultado del hook `useTema`. */
export interface UsoTema {
  /** Tema activo en este momento. */
  tema: Tema;
  /** Alterna entre claro y oscuro, aplicando y persistiendo el cambio. */
  alternar: () => void;
}

/**
 * Hook de tema (claro / oscuro).
 *
 * El estado inicial se toma de la clase ya presente en `<html>`, que el script
 * inline de `index.html` coloca antes del render para evitar el parpadeo de
 * tema al recargar. A partir de ahi, `alternar` actualiza el estado de React,
 * la clase del `<html>` y localStorage de forma consistente.
 */
export function useTema(): UsoTema {
  const [tema, setTema] = useState<Tema>(() => temaActual());

  const alternar = useCallback(() => {
    setTema((anterior) => {
      const siguiente: Tema = anterior === 'claro' ? 'oscuro' : 'claro';
      aplicarTema(siguiente);
      guardarTema(siguiente);
      return siguiente;
    });
  }, []);

  return { tema, alternar };
}
