import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type { AnalisisRc, DesempenoRc } from './tipos';

/**
 * Capa de datos del tablero de gestión "ANÁLISIS RC" (rediseño R7): dos consultas de solo lectura
 * (el tablero y el desempeño del equipo) + la URL del export a Excel de la evaluación semanal. Mismo
 * ESTÁNDAR que el resto del módulo RC: invoca el cliente tipado del OpenAPI, normaliza (`data`/
 * `ErrorDeApi`) y expone hooks de TanStack Query. CERO lógica de negocio (A1): la salud, el semáforo,
 * el forward pass, el scoring y la agregación los DERIVA el backend; aquí solo se pinta.
 */

/** Clave raíz de la caché del tablero Análisis RC. */
export const CLAVE_ANALISIS_RC = ['ruta-critica', 'analisis'] as const;

/**
 * Tablero Análisis RC: salud de órdenes, entrega/ciclo, alertas predictivas, riesgo por cliente y
 * cuellos. Se refresca solo cada `intervaloMs` (por defecto 2 min: es un tablero vivo de gestión).
 */
export function useAnalisisRc(
  opciones: { intervaloMs?: number } = {},
): UseQueryResult<AnalisisRc, ErrorDeApi> {
  const { intervaloMs = 120_000 } = opciones;
  return useQuery({
    queryKey: [...CLAVE_ANALISIS_RC, 'tablero'],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/ruta-critica/analisis');
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    refetchInterval: intervaloMs,
  });
}

/**
 * Desempeño del equipo (scoring + bono). SOLO para management (`rc.programar`): `habilitado` lo apaga
 * para el resto (el backend re-verifica con 403). No se pinta la tarjeta si no está habilitado.
 */
export function useDesempenoRc(
  opciones: { habilitado?: boolean } = {},
): UseQueryResult<DesempenoRc, ErrorDeApi> {
  const { habilitado = true } = opciones;
  return useQuery({
    queryKey: [...CLAVE_ANALISIS_RC, 'desempeno'],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/ruta-critica/analisis/desempeno');
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    enabled: habilitado,
    staleTime: 60_000,
  });
}

/**
 * URL del export a Excel de la "evaluación semanal" del equipo
 * (`GET /api/ruta-critica/analisis/desempeno/excel`). Binario server-side (igual que el Excel del
 * concentrado): la auth viaja por la cookie de sesión (mismo origen), así que basta `window.open`.
 */
export function urlEvaluacionSemanalExcel(): string {
  return '/api/ruta-critica/analisis/desempeno/excel';
}
