import { useEffect, useState } from 'react';

/**
 * Devuelve una version "retrasada" de `valor`: solo cambia cuando `valor` se
 * mantiene estable durante `ms` milisegundos. Util para no disparar una busqueda
 * en cada tecla (se espera a que el usuario deje de escribir).
 */
export function useDebounce<T>(valor: T, ms = 300): T {
  const [retrasado, setRetrasado] = useState(valor);

  useEffect(() => {
    const id = setTimeout(() => {
      setRetrasado(valor);
    }, ms);
    return () => {
      clearTimeout(id);
    };
  }, [valor, ms]);

  return retrasado;
}
