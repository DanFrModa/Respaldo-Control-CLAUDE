import { useMemo } from 'react';

import { useExistenciasAvio } from '@/api/inventario-materiales';

import type { ExistenciaAvioEnAlmacen } from './stock-avios';

/**
 * ⭐⭐ FILA 0.233 — EL STOCK DE AVÍOS DE UN ALMACÉN, O `undefined` SI NO SE SABE.
 *
 * Es la lógica que la fila 0.216 escribió dentro de la nota de salida, sacada aquí para que las
 * cuatro pantallas que sacan avíos la compartan en vez de copiarla. Devuelve el mapa sólo cuando
 * se cumplen las cuatro condiciones, y ninguna sobra:
 *  • **almacén elegido** (`idAlmacen !== null`): sin él no hay a qué preguntarle (y la consulta va
 *    apagada). Quien llama pasa `null` también cuando el stock **no aplica** (un ajuste de ENTRADA)
 *    o cuando la sesión no puede leer existencias;
 *  • **respuesta en la mano** (`data !== undefined`): mientras carga, todo avío parecería tener
 *    cero y se bloquearía la captura entera;
 *  • **dato de ESTE almacén** (`!isPlaceholderData`): la consulta usa `keepPreviousData`, así que
 *    al cambiar de almacén sigue entregando los renglones del ANTERIOR mientras vuelve la nueva.
 *    Esos renglones son de otro `idAlmacen`, el filtro los descarta **todos** y el mapa quedaría
 *    vacío ⇒ sin esta condición, cambiar de almacén bloquearía cada avío durante ese hueco;
 *  • **sin error** (`!isError`): una consulta que falló no es un almacén vacío.
 *
 * La consulta es la MISMA de la pantalla de existencias (`GET /inventarios/avios/existencias`,
 * filtrada por almacén en el servidor): nada de pivotes en el navegador.
 */
export function useStockAvioEnAlmacen(
  idAlmacen: number | null,
): Map<number, ExistenciaAvioEnAlmacen> | undefined {
  const existencias = useExistenciasAvio(
    idAlmacen === null ? {} : { idAlmacen, incluirCeros: 'true' },
    { habilitado: idAlmacen !== null },
  );
  const stockConocido =
    idAlmacen !== null &&
    existencias.data !== undefined &&
    !existencias.isPlaceholderData &&
    !existencias.isError;
  return useMemo(() => {
    if (!stockConocido) return undefined;
    const mapa = new Map<number, ExistenciaAvioEnAlmacen>();
    for (const f of existencias.data?.filas ?? []) {
      if (f.idAlmacen === idAlmacen)
        mapa.set(f.idAvio, { existencia: f.existencia, unidad: f.unidad });
    }
    return mapa;
  }, [existencias.data, idAlmacen, stockConocido]);
}
