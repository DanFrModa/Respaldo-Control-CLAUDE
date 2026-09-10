import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from './cliente';
import { ErrorDeApi } from './errores';
import type { paths } from './esquema.gen';
import { subirArchivoPrefirmado } from './subida-archivo';

/**
 * Capa de datos de las FOTOS DEL ARTE **POR ORDEN** (§Post-F9.177, DANIEL: *"un modelo de desarrollo
 * que se va a usar para 4 órdenes diferentes no puede usar la misma foto ni del modelo ni de arte
 * para todas las OP… aplica para fotos de la prenda pero también del arte"*).
 *
 * Tres cosas, y sólo dos de ellas tocan archivos:
 *  • **listar** — lo que enseña cada renglón: heredadas del arte del modelo (con las apagadas
 *    marcadas) + las que subió esta OP. Una sola llamada; el servidor ya decide (A1).
 *  • **ocultar / mostrar** — 🔴 **NO borran nada ni tocan R2 (D3)**: ponen y quitan una MARCA por
 *    *(renglón, foto)*. La foto sigue en el arte del modelo y otra orden la sigue viendo.
 *  • **subir / quitar** — ésas sí son archivos, y son de ESTA orden: quitarlas las borra de verdad.
 *
 * Mismo ESTÁNDAR que el resto de la casa: cliente TIPADO del OpenAPI, normalización
 * (`data`/`ErrorDeApi`) y mutaciones que invalidan la lista. CERO lógica de negocio (A1).
 */

// ── Alias de tipos del contrato ────────────────────────────────────────────────
/** Artes de la orden con sus fotos (`GET /api/ordenes/{idOrden}/artes/fotos`). */
export type OrdenArtesConFotosLista =
  paths['/api/ordenes/{idOrden}/artes/fotos']['get']['responses']['200']['content']['application/json'];
/** Un renglón de arte de la orden con las fotos que enseña. */
export type OrdenArteConFotos = OrdenArtesConFotosLista['datos'][number];
/** Una foto tal como la enseña el renglón (heredada del modelo o subida a la orden). */
export type OrdenArteFoto = OrdenArteConFotos['fotos'][number];

/** Clave de cache de las fotos de arte de UNA orden. */
function claveFotosArte(idOrden: number): readonly unknown[] {
  return ['orden-artes-fotos', idOrden];
}

/** Lista qué fotos enseña cada renglón de arte de esta orden. */
async function listar(idOrden: number): Promise<OrdenArteConFotos[]> {
  const { data, error } = await api.GET('/api/ordenes/{idOrden}/artes/fotos', {
    params: { path: { idOrden } },
  });
  if (!data) throw new ErrorDeApi(error);
  return data.datos;
}

/** Fotos de arte de una orden (deshabilitada si no hay id). */
export function useFotosArteOrden(
  idOrden: number | undefined,
): UseQueryResult<OrdenArteConFotos[], ErrorDeApi> {
  return useQuery({
    queryKey: claveFotosArte(idOrden ?? 0),
    queryFn: () => listar(idOrden as number),
    enabled: idOrden !== undefined,
  });
}

/** Argumentos de las dos mutaciones sobre una foto HEREDADA (ocultar y traerla de vuelta). */
export interface ArgsFotoArteHeredada {
  idOrden: number;
  /** Renglón de arte DE ESTA ORDEN (`OrdenArte.id`). */
  idOrdenArte: number;
  /** Id de la foto del ARTE DEL MODELO (`ModeloArteFoto.id`), no de un archivo de la orden. */
  idModeloArteFoto: number;
}

/** Quita de este renglón una foto heredada del arte del modelo (la del modelo NO se toca). */
async function ocultar({
  idOrden,
  idOrdenArte,
  idModeloArteFoto,
}: ArgsFotoArteHeredada): Promise<void> {
  const { data, error } = await api.POST(
    '/api/ordenes/{idOrden}/artes/{idOrdenArte}/fotos-ocultas',
    { params: { path: { idOrden, idOrdenArte } }, body: { idModeloArteFoto } },
  );
  if (!data) throw new ErrorDeApi(error);
}

/** Vuelve a enseñar en este renglón una foto heredada que estaba apagada. */
async function mostrar({
  idOrden,
  idOrdenArte,
  idModeloArteFoto,
}: ArgsFotoArteHeredada): Promise<void> {
  const { data, error } = await api.DELETE(
    '/api/ordenes/{idOrden}/artes/{idOrdenArte}/fotos-ocultas/{idModeloArteFoto}',
    { params: { path: { idOrden, idOrdenArte, idModeloArteFoto } } },
  );
  if (!data) throw new ErrorDeApi(error);
}

/** Quita de esta OP una foto heredada e invalida la lista. Reversible con {@link useMostrarFotoArteOrden}. */
export function useOcultarFotoArteOrden(): UseMutationResult<
  void,
  ErrorDeApi,
  ArgsFotoArteHeredada
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ocultar,
    onSuccess: (_resultado, variables) =>
      void queryClient.invalidateQueries({ queryKey: claveFotosArte(variables.idOrden) }),
  });
}

/** Trae de vuelta a esta OP una foto heredada que se había quitado, e invalida la lista. */
export function useMostrarFotoArteOrden(): UseMutationResult<
  void,
  ErrorDeApi,
  ArgsFotoArteHeredada
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: mostrar,
    onSuccess: (_resultado, variables) =>
      void queryClient.invalidateQueries({ queryKey: claveFotosArte(variables.idOrden) }),
  });
}

/** Argumentos de la subida de una foto propia al renglón de arte. */
export interface ArgsSubirFotoArteOrden {
  idOrden: number;
  idOrdenArte: number;
  /** La imagen elegida por el usuario. */
  archivo: File;
}

/**
 * Sube una foto de arte a ESTE renglón en DOS pasos (flujo presigned de F0), igual que los demás
 * módulos de archivos: metadatos al backend → URL PUT prefirmada → `PUT` directo a R2. Si el PUT
 * falla se quita el registro que el paso 1 ya creó (si no, el renglón listaría una foto que nunca
 * llegó); el detalle vive en `subida-archivo.ts`.
 */
async function subir({ idOrden, idOrdenArte, archivo }: ArgsSubirFotoArteOrden): Promise<void> {
  const tipoMime = archivo.type || 'image/jpeg';
  const { data, error } = await api.POST('/api/ordenes/{idOrden}/artes/{idOrdenArte}/fotos', {
    params: { path: { idOrden, idOrdenArte } },
    body: { nombreOriginal: archivo.name, tipoMime, tamanoBytes: archivo.size },
  });
  if (!data) throw new ErrorDeApi(error);

  await subirArchivoPrefirmado({
    urlSubida: data.urlSubida,
    archivo,
    tipoMime,
    sustantivo: 'la imagen',
    limpiar: () => quitar({ idOrden, idOrdenArte, idFoto: data.idFoto }),
  });
}

/** Sube una foto de arte a la OP (presigned PUT) e invalida la lista. */
export function useSubirFotoArteOrden(): UseMutationResult<
  void,
  ErrorDeApi,
  ArgsSubirFotoArteOrden
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: subir,
    onSuccess: (_resultado, variables) =>
      void queryClient.invalidateQueries({ queryKey: claveFotosArte(variables.idOrden) }),
  });
}

/** Argumentos de quitar una foto PROPIA del renglón. */
export interface ArgsQuitarFotoArteOrden {
  idOrden: number;
  idOrdenArte: number;
  /** Id de la foto SUBIDA A LA ORDEN (`OrdenArteFoto.id`). Una heredada no entra por aquí. */
  idFoto: number;
}

/** Quita una foto que subió esta OP (ésta sí se borra de verdad: nació aquí). */
async function quitar({ idOrden, idOrdenArte, idFoto }: ArgsQuitarFotoArteOrden): Promise<void> {
  const { error, response } = await api.DELETE(
    '/api/ordenes/{idOrden}/artes/{idOrdenArte}/fotos/{idFoto}',
    { params: { path: { idOrden, idOrdenArte, idFoto } } },
  );
  // 204 No Content: éxito sin cuerpo; cualquier !ok es error.
  if (!response.ok) throw new ErrorDeApi(error);
}

/** Quita una foto propia de la OP e invalida la lista. */
export function useQuitarFotoArteOrden(): UseMutationResult<
  void,
  ErrorDeApi,
  ArgsQuitarFotoArteOrden
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: quitar,
    onSuccess: (_resultado, variables) =>
      void queryClient.invalidateQueries({ queryKey: claveFotosArte(variables.idOrden) }),
  });
}
