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
  Empresa,
  EmpresaConfiguracion,
  EmpresaConfiguracionEditar,
  EmpresaCrear,
  EmpresaEditar,
  EmpresasLista,
} from './tipos';

/**
 * Capa de datos de Empresas (administracion, multi-empresa A9). Replica del
 * ESTANDAR de catalogos, con diferencias del backend de empresas:
 *  - la lista NO viene paginada: es un array plano (favorita primero), asi que
 *    la busqueda/orden se hace en cliente;
 *  - el flag de borrado suave se llama `activa` (femenino), no `activo`;
 *  - reactivar = `PATCH { activa: true }`; desactivar = `DELETE`.
 *
 * Incluye tambien la CONFIGURACION por empresa (seccion secundaria). CERO logica
 * de negocio: el backend valida, autoriza y decide (A1).
 */

/** Clave raiz de la cache de empresas en TanStack Query. */
export const CLAVE_EMPRESAS = ['empresas'] as const;

/** Pide la lista completa de empresas (sin paginacion). */
async function listarEmpresas(): Promise<EmpresasLista> {
  const { data, error } = await api.GET('/api/empresas');
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Crea una empresa (`POST /api/empresas`). */
async function crearEmpresa(cuerpo: EmpresaCrear): Promise<Empresa> {
  const { data, error } = await api.POST('/api/empresas', { body: cuerpo });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza una empresa (`PATCH /api/empresas/{id}`). */
async function actualizarEmpresa(id: number, cuerpo: EmpresaEditar): Promise<Empresa> {
  const { data, error } = await api.PATCH('/api/empresas/{id}', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Desactiva una empresa (borrado SUAVE, `DELETE /api/empresas/{id}`). */
async function desactivarEmpresa(id: number): Promise<Empresa> {
  const { data, error } = await api.DELETE('/api/empresas/{id}', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Reactiva una empresa desactivada: `PATCH /api/empresas/{id}` con `{ activa: true }`. */
async function reactivarEmpresa(id: number): Promise<Empresa> {
  const { data, error } = await api.PATCH('/api/empresas/{id}', {
    params: { path: { id } },
    body: { activa: true },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Lee la configuracion de una empresa (`GET /api/empresas/{id}/configuracion`). */
async function obtenerConfiguracion(id: number): Promise<EmpresaConfiguracion> {
  const { data, error } = await api.GET('/api/empresas/{id}/configuracion', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Actualiza la configuracion de una empresa (`PATCH .../configuracion`). */
async function actualizarConfiguracion(
  id: number,
  cuerpo: EmpresaConfiguracionEditar,
): Promise<EmpresaConfiguracion> {
  const { data, error } = await api.PATCH('/api/empresas/{id}/configuracion', {
    params: { path: { id } },
    body: cuerpo,
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Lista todas las empresas (array plano; el filtrado/orden lo hace la pantalla). */
export function useEmpresas(): UseQueryResult<EmpresasLista, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_EMPRESAS, 'lista'],
    queryFn: listarEmpresas,
  });
}

/** Crea una empresa e invalida la lista para reflejarla. */
export function useCrearEmpresa(): UseMutationResult<Empresa, ErrorDeApi, EmpresaCrear> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: crearEmpresa,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_EMPRESAS }),
  });
}

/** Argumentos de la mutacion de edicion. */
export interface ArgsActualizarEmpresa {
  id: number;
  cuerpo: EmpresaEditar;
}

/** Edita una empresa e invalida la lista. */
export function useActualizarEmpresa(): UseMutationResult<
  Empresa,
  ErrorDeApi,
  ArgsActualizarEmpresa
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarEmpresa) => actualizarEmpresa(id, cuerpo),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_EMPRESAS }),
  });
}

/** Desactiva una empresa (borrado suave) e invalida la lista. */
export function useDesactivarEmpresa(): UseMutationResult<Empresa, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: desactivarEmpresa,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_EMPRESAS }),
  });
}

/** Reactiva una empresa desactivada e invalida la lista. */
export function useReactivarEmpresa(): UseMutationResult<Empresa, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivarEmpresa,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE_EMPRESAS }),
  });
}

/** Lee la configuracion de una empresa (habilitada solo cuando hay `id`). */
export function useConfiguracionEmpresa(
  id: number | null,
): UseQueryResult<EmpresaConfiguracion, ErrorDeApi> {
  return useQuery({
    queryKey: [...CLAVE_EMPRESAS, 'configuracion', id],
    queryFn: () => obtenerConfiguracion(id as number),
    enabled: id !== null,
  });
}

/** Argumentos de la mutacion de configuracion. */
export interface ArgsActualizarConfiguracion {
  id: number;
  cuerpo: EmpresaConfiguracionEditar;
}

/** Edita la configuracion de una empresa e invalida su cache de configuracion. */
export function useActualizarConfiguracion(): UseMutationResult<
  EmpresaConfiguracion,
  ErrorDeApi,
  ArgsActualizarConfiguracion
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cuerpo }: ArgsActualizarConfiguracion) =>
      actualizarConfiguracion(id, cuerpo),
    onSuccess: (_data, { id }) =>
      queryClient.invalidateQueries({ queryKey: [...CLAVE_EMPRESAS, 'configuracion', id] }),
  });
}
