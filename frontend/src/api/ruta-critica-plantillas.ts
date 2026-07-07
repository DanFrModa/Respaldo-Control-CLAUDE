import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type {
  ArticuloRc,
  ArticuloRcCrear,
  ArticuloRcEditar,
  CalendarioRc,
  CalendarioRcActualizar,
  DuracionAplicacionRc,
  DuracionAplicacionRcCrear,
  DuracionAplicacionRcEditar,
  DuracionTelaRc,
  DuracionTelaRcCrear,
  DuracionTelaRcEditar,
  FactorCantidadRc,
  FactorCantidadRcCrear,
  FactorCantidadRcEditar,
  FamiliaRc,
  FamiliaRcCrear,
  FamiliaRcEditar,
  FestivoRc,
  FestivoRcCrear,
  FestivoRcEditar,
  PlantillaRc,
  PlantillaRcCrear,
  PlantillaRcEditar,
  RangoDificultadRc,
  RangoDificultadRcCrear,
  RangoDificultadRcEditar,
} from './tipos';

/**
 * Capa de datos de PLANTILLAS, REGLAS DE DURACIÓN, FAMILIAS/ARTÍCULOS y CALENDARIO de la Ruta
 * Crítica (F5-E2) — mismo ESTÁNDAR que `ruta-critica.ts`: llama al cliente tipado del OpenAPI,
 * normaliza (`data`/`ErrorDeApi`) y expone hooks de TanStack Query. CERO lógica de negocio (A1):
 * el rechazo de ciclos, las validaciones y la autorización viven en el backend.
 */

export const CLAVE_FAMILIAS_RC = ['ruta-critica', 'familias'] as const;
export const CLAVE_ARTICULOS_RC = ['ruta-critica', 'articulos'] as const;
export const CLAVE_PLANTILLAS_RC = ['ruta-critica', 'plantillas'] as const;
export const CLAVE_REGLAS_RC = ['ruta-critica', 'reglas-duracion'] as const;
export const CLAVE_CALENDARIO_RC = ['ruta-critica', 'calendario'] as const;

// ── Familias ───────────────────────────────────────────────────────────────────

async function listarFamilias(incluirInactivos: boolean): Promise<FamiliaRc[]> {
  const { data, error } = await api.GET('/api/ruta-critica/familias', {
    params: { query: { incluirInactivos: incluirInactivos ? 'true' : 'false' } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

export function useFamiliasRc(incluirInactivos = false): UseQueryResult<FamiliaRc[], ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_FAMILIAS_RC, { incluirInactivos }],
    queryFn: () => listarFamilias(incluirInactivos),
  });
}

export function useCrearFamiliaRc(): UseMutationResult<FamiliaRc, ErrorDeApi, FamiliaRcCrear> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cuerpo: FamiliaRcCrear) => {
      const { data, error } = await api.POST('/api/ruta-critica/familias', { body: cuerpo });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_FAMILIAS_RC }),
  });
}

export function useActualizarFamiliaRc(): UseMutationResult<
  FamiliaRc,
  ErrorDeApi,
  { id: number; cuerpo: FamiliaRcEditar }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, cuerpo }: { id: number; cuerpo: FamiliaRcEditar }) => {
      const { data, error } = await api.PATCH('/api/ruta-critica/familias/{id}', {
        params: { path: { id } },
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CLAVE_FAMILIAS_RC });
      void qc.invalidateQueries({ queryKey: CLAVE_ARTICULOS_RC });
    },
  });
}

export function useDesactivarFamiliaRc(): UseMutationResult<FamiliaRc, ErrorDeApi, number> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await api.DELETE('/api/ruta-critica/familias/{id}', {
        params: { path: { id } },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_FAMILIAS_RC }),
  });
}

// ── Artículos ────────────────────────────────────────────────────────────────

async function listarArticulos(incluirInactivos: boolean): Promise<ArticuloRc[]> {
  const { data, error } = await api.GET('/api/ruta-critica/articulos', {
    params: { query: { incluirInactivos: incluirInactivos ? 'true' : 'false' } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

export function useArticulosRc(incluirInactivos = false): UseQueryResult<ArticuloRc[], ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_ARTICULOS_RC, { incluirInactivos }],
    queryFn: () => listarArticulos(incluirInactivos),
  });
}

export function useCrearArticuloRc(): UseMutationResult<ArticuloRc, ErrorDeApi, ArticuloRcCrear> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cuerpo: ArticuloRcCrear) => {
      const { data, error } = await api.POST('/api/ruta-critica/articulos', { body: cuerpo });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_ARTICULOS_RC }),
  });
}

export function useActualizarArticuloRc(): UseMutationResult<
  ArticuloRc,
  ErrorDeApi,
  { id: number; cuerpo: ArticuloRcEditar }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, cuerpo }: { id: number; cuerpo: ArticuloRcEditar }) => {
      const { data, error } = await api.PATCH('/api/ruta-critica/articulos/{id}', {
        params: { path: { id } },
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_ARTICULOS_RC }),
  });
}

export function useDesactivarArticuloRc(): UseMutationResult<ArticuloRc, ErrorDeApi, number> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await api.DELETE('/api/ruta-critica/articulos/{id}', {
        params: { path: { id } },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_ARTICULOS_RC }),
  });
}

// ── Plantillas ─────────────────────────────────────────────────────────────────

async function listarPlantillas(incluirInactivos: boolean): Promise<PlantillaRc[]> {
  const { data, error } = await api.GET('/api/ruta-critica/plantillas', {
    params: { query: { incluirInactivos: incluirInactivos ? 'true' : 'false' } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data;
}

export function usePlantillasRc(
  incluirInactivos = false,
): UseQueryResult<PlantillaRc[], ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_PLANTILLAS_RC, { incluirInactivos }],
    queryFn: () => listarPlantillas(incluirInactivos),
  });
}

export function useCrearPlantillaRc(): UseMutationResult<
  PlantillaRc,
  ErrorDeApi,
  PlantillaRcCrear
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cuerpo: PlantillaRcCrear) => {
      const { data, error } = await api.POST('/api/ruta-critica/plantillas', { body: cuerpo });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_PLANTILLAS_RC }),
  });
}

export function useActualizarPlantillaRc(): UseMutationResult<
  PlantillaRc,
  ErrorDeApi,
  { id: number; cuerpo: PlantillaRcEditar }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, cuerpo }: { id: number; cuerpo: PlantillaRcEditar }) => {
      const { data, error } = await api.PATCH('/api/ruta-critica/plantillas/{id}', {
        params: { path: { id } },
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_PLANTILLAS_RC }),
  });
}

export function useDesactivarPlantillaRc(): UseMutationResult<PlantillaRc, ErrorDeApi, number> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await api.DELETE('/api/ruta-critica/plantillas/{id}', {
        params: { path: { id } },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_PLANTILLAS_RC }),
  });
}

// ── Reglas de duración: factor por cantidad ──────────────────────────────────

export function useFactoresCantidadRc(
  incluirInactivos = false,
): UseQueryResult<FactorCantidadRc[], ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_REGLAS_RC, 'cantidad', { incluirInactivos }],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/ruta-critica/reglas-duracion/cantidad', {
        params: { query: { incluirInactivos: incluirInactivos ? 'true' : 'false' } },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
  });
}

export function useCrearFactorCantidadRc(): UseMutationResult<
  FactorCantidadRc,
  ErrorDeApi,
  FactorCantidadRcCrear
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cuerpo: FactorCantidadRcCrear) => {
      const { data, error } = await api.POST('/api/ruta-critica/reglas-duracion/cantidad', {
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_REGLAS_RC }),
  });
}

export function useActualizarFactorCantidadRc(): UseMutationResult<
  FactorCantidadRc,
  ErrorDeApi,
  { id: number; cuerpo: FactorCantidadRcEditar }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, cuerpo }: { id: number; cuerpo: FactorCantidadRcEditar }) => {
      const { data, error } = await api.PATCH('/api/ruta-critica/reglas-duracion/cantidad/{id}', {
        params: { path: { id } },
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_REGLAS_RC }),
  });
}

export function useDesactivarFactorCantidadRc(): UseMutationResult<
  FactorCantidadRc,
  ErrorDeApi,
  number
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await api.DELETE('/api/ruta-critica/reglas-duracion/cantidad/{id}', {
        params: { path: { id } },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_REGLAS_RC }),
  });
}

// ── Reglas de duración: por tipo de tela ───────────────────────────────────────

export function useDuracionesTelaRc(
  incluirInactivos = false,
): UseQueryResult<DuracionTelaRc[], ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_REGLAS_RC, 'tela', { incluirInactivos }],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/ruta-critica/reglas-duracion/tela', {
        params: { query: { incluirInactivos: incluirInactivos ? 'true' : 'false' } },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
  });
}

export function useCrearDuracionTelaRc(): UseMutationResult<
  DuracionTelaRc,
  ErrorDeApi,
  DuracionTelaRcCrear
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cuerpo: DuracionTelaRcCrear) => {
      const { data, error } = await api.POST('/api/ruta-critica/reglas-duracion/tela', {
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_REGLAS_RC }),
  });
}

export function useActualizarDuracionTelaRc(): UseMutationResult<
  DuracionTelaRc,
  ErrorDeApi,
  { id: number; cuerpo: DuracionTelaRcEditar }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, cuerpo }: { id: number; cuerpo: DuracionTelaRcEditar }) => {
      const { data, error } = await api.PATCH('/api/ruta-critica/reglas-duracion/tela/{id}', {
        params: { path: { id } },
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_REGLAS_RC }),
  });
}

export function useDesactivarDuracionTelaRc(): UseMutationResult<
  DuracionTelaRc,
  ErrorDeApi,
  number
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await api.DELETE('/api/ruta-critica/reglas-duracion/tela/{id}', {
        params: { path: { id } },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_REGLAS_RC }),
  });
}

// ── Reglas de duración: rangos de DIFICULTAD por # de operaciones (R4, B7) ─────

export function useRangosDificultadRc(
  incluirInactivos = false,
): UseQueryResult<RangoDificultadRc[], ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_REGLAS_RC, 'dificultad', { incluirInactivos }],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/ruta-critica/reglas-duracion/dificultad', {
        params: { query: { incluirInactivos: incluirInactivos ? 'true' : 'false' } },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
  });
}

export function useCrearRangoDificultadRc(): UseMutationResult<
  RangoDificultadRc,
  ErrorDeApi,
  RangoDificultadRcCrear
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cuerpo: RangoDificultadRcCrear) => {
      const { data, error } = await api.POST('/api/ruta-critica/reglas-duracion/dificultad', {
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_REGLAS_RC }),
  });
}

export function useActualizarRangoDificultadRc(): UseMutationResult<
  RangoDificultadRc,
  ErrorDeApi,
  { id: number; cuerpo: RangoDificultadRcEditar }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, cuerpo }: { id: number; cuerpo: RangoDificultadRcEditar }) => {
      const { data, error } = await api.PATCH('/api/ruta-critica/reglas-duracion/dificultad/{id}', {
        params: { path: { id } },
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_REGLAS_RC }),
  });
}

export function useDesactivarRangoDificultadRc(): UseMutationResult<
  RangoDificultadRc,
  ErrorDeApi,
  number
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await api.DELETE(
        '/api/ruta-critica/reglas-duracion/dificultad/{id}',
        { params: { path: { id } } },
      );
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_REGLAS_RC }),
  });
}

// ── Reglas de duración: por aplicación ─────────────────────────────────────────

export function useDuracionesAplicacionRc(
  incluirInactivos = false,
): UseQueryResult<DuracionAplicacionRc[], ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_REGLAS_RC, 'aplicacion', { incluirInactivos }],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/ruta-critica/reglas-duracion/aplicacion', {
        params: { query: { incluirInactivos: incluirInactivos ? 'true' : 'false' } },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
  });
}

export function useCrearDuracionAplicacionRc(): UseMutationResult<
  DuracionAplicacionRc,
  ErrorDeApi,
  DuracionAplicacionRcCrear
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cuerpo: DuracionAplicacionRcCrear) => {
      const { data, error } = await api.POST('/api/ruta-critica/reglas-duracion/aplicacion', {
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_REGLAS_RC }),
  });
}

export function useActualizarDuracionAplicacionRc(): UseMutationResult<
  DuracionAplicacionRc,
  ErrorDeApi,
  { id: number; cuerpo: DuracionAplicacionRcEditar }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, cuerpo }: { id: number; cuerpo: DuracionAplicacionRcEditar }) => {
      const { data, error } = await api.PATCH('/api/ruta-critica/reglas-duracion/aplicacion/{id}', {
        params: { path: { id } },
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_REGLAS_RC }),
  });
}

export function useDesactivarDuracionAplicacionRc(): UseMutationResult<
  DuracionAplicacionRc,
  ErrorDeApi,
  number
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await api.DELETE(
        '/api/ruta-critica/reglas-duracion/aplicacion/{id}',
        { params: { path: { id } } },
      );
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_REGLAS_RC }),
  });
}

// ── Calendario laboral + festivos ──────────────────────────────────────────────

export function useCalendarioRc(idEmpresa: number): UseQueryResult<CalendarioRc, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CALENDARIO_RC, 'dias', idEmpresa],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/ruta-critica/calendario/{idEmpresa}', {
        params: { path: { idEmpresa } },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    enabled: idEmpresa > 0,
  });
}

export function useGuardarCalendarioRc(): UseMutationResult<
  CalendarioRc,
  ErrorDeApi,
  { idEmpresa: number; cuerpo: CalendarioRcActualizar }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      idEmpresa,
      cuerpo,
    }: {
      idEmpresa: number;
      cuerpo: CalendarioRcActualizar;
    }) => {
      const { data, error } = await api.PUT('/api/ruta-critica/calendario/{idEmpresa}', {
        params: { path: { idEmpresa } },
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_CALENDARIO_RC }),
  });
}

export function useFestivosRc(
  idEmpresa: number,
  incluirInactivos = false,
): UseQueryResult<FestivoRc[], ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_CALENDARIO_RC, 'festivos', idEmpresa, { incluirInactivos }],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/ruta-critica/calendario/{idEmpresa}/festivos', {
        params: {
          path: { idEmpresa },
          query: { incluirInactivos: incluirInactivos ? 'true' : 'false' },
        },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    enabled: idEmpresa > 0,
  });
}

export function useCrearFestivoRc(): UseMutationResult<
  FestivoRc,
  ErrorDeApi,
  { idEmpresa: number; cuerpo: FestivoRcCrear }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ idEmpresa, cuerpo }: { idEmpresa: number; cuerpo: FestivoRcCrear }) => {
      const { data, error } = await api.POST('/api/ruta-critica/calendario/{idEmpresa}/festivos', {
        params: { path: { idEmpresa } },
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_CALENDARIO_RC }),
  });
}

export function useActualizarFestivoRc(): UseMutationResult<
  FestivoRc,
  ErrorDeApi,
  { id: number; cuerpo: FestivoRcEditar }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, cuerpo }: { id: number; cuerpo: FestivoRcEditar }) => {
      const { data, error } = await api.PATCH('/api/ruta-critica/calendario/festivos/{id}', {
        params: { path: { id } },
        body: cuerpo,
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_CALENDARIO_RC }),
  });
}

export function useDesactivarFestivoRc(): UseMutationResult<FestivoRc, ErrorDeApi, number> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await api.DELETE('/api/ruta-critica/calendario/festivos/{id}', {
        params: { path: { id } },
      });
      if (!data) throw new ErrorDeApi(error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_CALENDARIO_RC }),
  });
}
