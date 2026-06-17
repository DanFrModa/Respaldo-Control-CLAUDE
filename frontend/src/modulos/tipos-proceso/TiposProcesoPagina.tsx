import { Cog, PackageCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useDesactivarTipoProceso,
  useReactivarTipoProceso,
  useTiposProceso,
} from '@/api/tipos-proceso';
import type { TipoProceso, TiposProcesoQuery } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar, TipoBadge } from '@/components/dominio/visuales';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoTipoProceso } from './DialogoTipoProceso';

/** Renglones por página del listado. */
const POR_PAGINA = 10;

/**
 * Pantalla de Tipos de proceso (Módulo Producción, F3-E1) — CRUD del catálogo de procesos de
 * maquila sobre el motor LISTA + DETALLE. La bandera **`generaEntradaPt`** (decisión (e)) se
 * MUESTRA a todos pero solo la EDITA un administrador (el diálogo deshabilita el control para los
 * demás; el backend es la autoridad, A1/§9.2).
 *
 * `tipos-proceso.ver` gobierna el acceso a la pantalla; `tipos-proceso.administrar` las acciones
 * de escritura; `roles.administrar` (marcador de admin) habilita editar la bandera.
 */
export function TiposProcesoPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('tipos-proceso.administrar');
  const puedeEditarBandera = tienePermiso('roles.administrar');

  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: TiposProcesoQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  };

  const consulta = useTiposProceso(query);
  const desactivar = useDesactivarTipoProceso();
  const reactivar = useReactivarTipoProceso();

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [enEdicion, setEnEdicion] = useState<TipoProceso | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<TipoProceso | null>(null);

  function abrirAlta(): void {
    setEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(tipo: TipoProceso): void {
    setEnEdicion(tipo);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Tipo de proceso "${objetivo.nombre}" desactivado.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  function reactivarTipo(tipo: TipoProceso): void {
    reactivar.mutate(tipo.id, {
      onSuccess: () => toast.success(`Tipo de proceso "${tipo.nombre}" activado.`),
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
      <ListaDetalle<TipoProceso>
        testid="tipo-proceso"
        titulo="Tipos de proceso"
        descripcion="Procesos de maquila (costura, estampado, bordado, lavado…). La marca «genera entrada a PT» define qué proceso deja prenda terminada."
        icono={Cog}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(t) => t.id}
        obtenerTitulo={(t) => t.nombre}
        obtenerActivo={(t) => t.activo}
        obtenerSecundaria={(t) => t.codigo}
        renderAvatarLista={(t) => (
          <Avatar nombre={t.nombre} tono="servicios" tamano="sm">
            <Cog className="size-4" aria-hidden />
          </Avatar>
        )}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay tipos de proceso que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo tipo de proceso"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarTipo}
        renderAvatarDetalle={(t) => (
          <Avatar nombre={t.nombre} tono="servicios" tamano="lg">
            <Cog className="size-7" aria-hidden />
          </Avatar>
        )}
        renderMeta={(t) =>
          t.generaEntradaPt ? (
            <TipoBadge tono="pt">Genera entrada a PT</TipoBadge>
          ) : (
            <TipoBadge tono="neutro">No mete a inventario</TipoBadge>
          )
        }
        renderDetalle={(t) => (
          <>
            <SeccionDetalle titulo="Datos del proceso">
              <RejillaCampos>
                <CampoDetalle icono={Cog} etiqueta="Código">
                  {t.codigo}
                </CampoDetalle>
                <CampoDetalle icono={PackageCheck} etiqueta="¿Genera entrada a PT?">
                  {t.generaEntradaPt ? 'Sí (su recibo mete prenda a inventario)' : 'No'}
                </CampoDetalle>
              </RejillaCampos>
            </SeccionDetalle>
            <Historial creadoEn={t.creadoEn} modificadoEn={t.modificadoEn} />
          </>
        )}
      />

      <DialogoTipoProceso
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        tipo={enEdicion}
        puedeEditarBandera={puedeEditarBandera}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar tipo de proceso"
        descripcion={
          <>
            ¿Seguro que quieres desactivar el tipo de proceso{' '}
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
