import { Hash, ListChecks, Lock, Tag } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useEstadosLista,
  useDesactivarEstadoLista,
  useReactivarEstadoLista,
  type EstadoLista,
  type EstadosListaQuery,
} from '@/api/estados-lista';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar, TipoBadge } from '@/components/dominio/visuales';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoEstadoLista } from './DialogoEstadoLista';

/** Renglones por página del listado. */
const POR_PAGINA = 10;

/**
 * Pantalla de Estados de lista de precios (F8-E1, Administración) — CRUD del catálogo GLOBAL de
 * estados del ciclo de vida de una lista de precios, sobre el motor LISTA + DETALLE. Sigue el
 * molde de "Tipos de proceso".
 *
 * Es ADMIN-ONLY: `estado-lista.ver` gobierna el acceso y `estado-lista.administrar` las
 * escrituras (el backend es la autoridad, A1). La bandera `esCierre` marca los estados que
 * bloquean nuevas rondas/ediciones (la usa la negociación de E2+); se muestra como badge.
 */
export function EstadosListaPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('estado-lista.administrar');

  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: EstadosListaQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'orden',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  };

  const consulta = useEstadosLista(query);
  const desactivar = useDesactivarEstadoLista();
  const reactivar = useReactivarEstadoLista();

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [enEdicion, setEnEdicion] = useState<EstadoLista | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<EstadoLista | null>(null);

  function abrirAlta(): void {
    setEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(estado: EstadoLista): void {
    setEnEdicion(estado);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Estado de lista "${objetivo.nombre}" desactivado.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  function reactivarEstado(estado: EstadoLista): void {
    reactivar.mutate(estado.id, {
      onSuccess: () => toast.success(`Estado de lista "${estado.nombre}" activado.`),
      onError: (error) => toast.error(error.message),
    });
  }

  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
    setPagina(1);
  }

  function alAlternarInactivos(): void {
    setIncluirInactivos((v) => !v);
    setPagina(1);
  }

  const datos = consulta.data;
  const totalPaginas = datos?.totalPaginas ?? 0;
  const paginacion: PaginacionListaDetalle | undefined = datos
    ? {
        total: datos.total,
        pagina: datos.pagina,
        totalPaginas,
        ocupado: consulta.isFetching,
        alAnterior: () => setPagina((p) => Math.max(1, p - 1)),
        alSiguiente: () => setPagina((p) => Math.min(totalPaginas, p + 1)),
      }
    : undefined;

  return (
    <>
      <ListaDetalle<EstadoLista>
        testid="estado-lista"
        titulo="Estados de lista de precios"
        descripcion="Catálogo global de estados del ciclo de vida de una lista de precios."
        icono={ListChecks}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(e) => e.id}
        obtenerTitulo={(e) => e.nombre}
        obtenerActivo={(e) => e.activo}
        obtenerSecundaria={(e) => e.codigo}
        renderAvatarLista={(e) => (
          <Avatar nombre={e.nombre} tono="servicios" tamano="sm">
            <ListChecks className="size-4" aria-hidden />
          </Avatar>
        )}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay estados de lista que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo estado"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarEstado}
        renderAvatarDetalle={(e) => (
          <Avatar nombre={e.nombre} tono="servicios" tamano="lg">
            <ListChecks className="size-7" aria-hidden />
          </Avatar>
        )}
        renderMeta={(e) =>
          e.esCierre ? (
            <TipoBadge tono="pt">Cierre</TipoBadge>
          ) : (
            <TipoBadge tono="neutro">Abierto</TipoBadge>
          )
        }
        renderDetalle={(e) => (
          <>
            <SeccionDetalle titulo="Datos del estado">
              <RejillaCampos>
                <CampoDetalle icono={Tag} etiqueta="Código">
                  {e.codigo}
                </CampoDetalle>
                <CampoDetalle icono={Hash} etiqueta="Orden">
                  {e.orden}
                </CampoDetalle>
                <CampoDetalle icono={Lock} etiqueta="¿Estado de cierre?">
                  {e.esCierre ? 'Sí (bloquea nuevas rondas/ediciones)' : 'No'}
                </CampoDetalle>
              </RejillaCampos>
            </SeccionDetalle>
            <Historial creadoEn={e.creadoEn} modificadoEn={e.modificadoEn} />
          </>
        )}
      />

      <DialogoEstadoLista
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        estado={enEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar estado de lista"
        descripcion={
          <>
            ¿Seguro que quieres desactivar el estado{' '}
            <span className="font-medium text-foreground">{aDesactivar?.nombre}</span>? Podrás
            volver a activarlo después.
          </>
        }
        textoConfirmar="Desactivar"
        variante="destructive"
        procesando={desactivar.isPending}
        alConfirmar={confirmarDesactivar}
      />
    </>
  );
}
