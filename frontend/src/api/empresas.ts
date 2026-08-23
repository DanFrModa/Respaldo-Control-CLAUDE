import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { CLAVE_SESION } from '@/sesion/contexto';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import { subirArchivoPrefirmado } from './subida-archivo';
import type {
  Empresa,
  EmpresaConfiguracion,
  EmpresaConfiguracionEditar,
  EmpresaCrear,
  EmpresaEditar,
  EmpresaLogo,
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

// ── LOGO de la empresa (post-F9, branding pedido por Daniel el 25-jul-2026) ──
//
// Se sube UNA vez aqui y de ahi lo toman los 23 impresos PDF y toda la app.
// Flujo presigned en TRES pasos (y no en dos, como la foto de bordado): POST de
// metadatos -> PUT directo a R2 -> POST de CONFIRMACION. El paso extra existe
// porque el logo es la marca del sistema entero: hasta que se confirma, el
// backend no toca el logo vigente, asi que una subida a medias (PUT fallido,
// pestana cerrada) no deja al sistema sin marca. Al terminar se invalida tambien
// la SESION, porque el riel lee de ahi el id del logo (que hace de version).

/** Lee el logo de una empresa con su URL prefirmada (para la vista previa). */
async function obtenerLogo(id: number): Promise<EmpresaLogo> {
  const { data, error } = await api.GET('/api/empresas/{id}/logo', {
    params: { path: { id } },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }
  return data;
}

/** Argumentos de la mutacion de subida del logo. */
export interface ArgsSubirLogo {
  idEmpresa: number;
  /** La imagen elegida por el usuario (PNG o JPG, hasta 5 MB). */
  archivo: File;
}

/**
 * Sube el LOGO de la empresa a R2 en TRES pasos:
 *   1) `POST /api/empresas/{id}/logo` con los metadatos -> el backend registra el
 *      `Archivo` y devuelve una URL PUT prefirmada. **Todavia NO cambia el logo.**
 *   2) El navegador hace `PUT` de la imagen DIRECTO a esa URL (R2).
 *   3) `POST /api/empresas/{id}/logo/confirmar` -> recien aqui el logo nuevo pasa
 *      a ser el vigente y se borra el anterior.
 * Si el PUT falla se propaga como `ErrorDeApi` y el logo anterior sigue intacto.
 */
async function subirLogo({ idEmpresa, archivo }: ArgsSubirLogo): Promise<void> {
  const { data, error } = await api.POST('/api/empresas/{id}/logo', {
    params: { path: { id: idEmpresa } },
    body: {
      nombreOriginal: archivo.name,
      tipoMime: archivo.type as 'image/png' | 'image/jpeg',
      tamanoBytes: archivo.size,
    },
  });
  if (!data) {
    throw new ErrorDeApi(error);
  }

  // Paso 2: PUT directo a R2. Solo `Content-Type` (Content-Length lo fija el navegador y la URL
  // prefirmada no lo firma — ver backend `comun/archivos.ts`). SIN `limpiar`: aquí el registro del
  // paso 1 no ensucia nada porque el logo no se vuelve vigente hasta el paso 3, y el DELETE del
  // logo borraría el ANTERIOR, que sigue siendo el bueno.
  await subirArchivoPrefirmado({
    urlSubida: data.urlSubida,
    archivo,
    tipoMime: archivo.type,
    sustantivo: 'el logo',
  });

  // Paso 3: confirmar. Solo ahora el sistema cambia de logo.
  const confirmacion = await api.POST('/api/empresas/{id}/logo/confirmar', {
    params: { path: { id: idEmpresa } },
    body: { idArchivo: data.idArchivo },
  });
  if (!confirmacion.response.ok) {
    throw new ErrorDeApi(confirmacion.error);
  }
}

/** Quita el logo de la empresa (`DELETE /api/empresas/{id}/logo`). */
async function quitarLogo(idEmpresa: number): Promise<void> {
  const { error, response } = await api.DELETE('/api/empresas/{id}/logo', {
    params: { path: { id: idEmpresa } },
  });
  if (!response.ok) {
    throw new ErrorDeApi(error);
  }
}

/** Clave de cache del logo de UNA empresa. */
function claveLogo(idEmpresa: number): readonly unknown[] {
  return [...CLAVE_EMPRESAS, 'logo', idEmpresa];
}

/** Lee el logo de una empresa (deshabilitado si no hay id, p. ej. en un alta). */
export function useLogoEmpresa(idEmpresa: number | null): UseQueryResult<EmpresaLogo, ErrorDeApi> {
  return useQuery({
    queryKey: claveLogo(idEmpresa ?? 0),
    queryFn: () => obtenerLogo(idEmpresa as number),
    enabled: idEmpresa !== null,
  });
}

/**
 * Sube (o reemplaza) el logo e invalida el logo, la lista y la SESION: el riel
 * lee de la sesion el id del logo, asi que sin eso la marca seguiria vieja.
 */
export function useSubirLogoEmpresa(): UseMutationResult<void, ErrorDeApi, ArgsSubirLogo> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: subirLogo,
    onSuccess: (_resultado, { idEmpresa }) => {
      void queryClient.invalidateQueries({ queryKey: claveLogo(idEmpresa) });
      void queryClient.invalidateQueries({ queryKey: CLAVE_EMPRESAS });
      void queryClient.invalidateQueries({ queryKey: CLAVE_SESION });
    },
  });
}

/** Quita el logo (vuelve al empaquetado) e invalida lo mismo que la subida. */
export function useQuitarLogoEmpresa(): UseMutationResult<void, ErrorDeApi, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: quitarLogo,
    onSuccess: (_resultado, idEmpresa) => {
      void queryClient.invalidateQueries({ queryKey: claveLogo(idEmpresa) });
      void queryClient.invalidateQueries({ queryKey: CLAVE_EMPRESAS });
      void queryClient.invalidateQueries({ queryKey: CLAVE_SESION });
    },
  });
}
