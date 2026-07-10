import { PackageCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useDesactivarTipoProceso,
  useReactivarTipoProceso,
  useTiposProceso,
} from '@/api/tipos-proceso';
import type { TipoProceso, TiposProcesoQuery } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { TipoBadge } from '@/components/dominio/visuales';
import { useDebounce } from '@/lib/useDebounce';
import {
  TablaCatalogo,
  type ColumnaCatalogo,
  type PaginacionCatalogo,
} from '@/modulos/TablaCatalogo';
import { useSesion } from '@/sesion/useSesion';

import { DialogoTipoProceso } from './DialogoTipoProceso';

/** Renglones por página del listado. */
const POR_PAGINA = 10;

/**
 * Pantalla de Tipos de proceso (Módulo Producción, F3-E1) — re-vestida R9 a TABLA-FIRST (proto
 * `vCat`): tabla densa con el proceso, su código, «genera entrada a PT» (badge) y su estado, con
 * acciones inline. La bandera **`generaEntradaPt`** (decisión (e)) se MUESTRA a todos pero solo la
 * EDITA un administrador (el diálogo deshabilita el control para los demás; el backend es la
 * autoridad, A1/§9.2).
 *
 * FIDELIDAD vs proto: el proto pinta una columna "Categoría" (Maquila M / Aplicación A), pero el
 * backend de v2 no guarda esa categoría en `TipoProceso` (solo código/nombre/generaEntradaPt) → se
 * omite (hueco reportado). `tipos-proceso.ver` gobierna el acceso; `tipos-proceso.administrar` las
 * acciones; `roles.administrar` (marcador de admin) habilita editar la bandera.
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
  const paginacion: PaginacionCatalogo | undefined = datos
    ? {
        total: datos.total,
        pagina: datos.pagina,
        totalPaginas,
        ocupado: consulta.isFetching,
        alAnterior: () => setPagina((p) => Math.max(1, p - 1)),
        alSiguiente: () => setPagina((p) => Math.min(totalPaginas, p + 1)),
      }
    : undefined;

  // Proto `CAT_TIPOSPROC`: renglón plano (sin thumb) — nombre en `cell-strong`.
  const columnas: ColumnaCatalogo<TipoProceso>[] = [
    {
      encabezado: 'Proceso',
      render: (t) => <span className="font-semibold">{t.nombre}</span>,
    },
    { encabezado: 'Código', render: (t) => <span className="num text-faint">{t.codigo}</span> },
    {
      encabezado: 'Genera entrada a PT',
      render: (t) =>
        t.generaEntradaPt ? (
          <TipoBadge tono="pt">
            <PackageCheck className="size-3" aria-hidden /> Sí
          </TipoBadge>
        ) : (
          <TipoBadge tono="neutro">No</TipoBadge>
        ),
    },
  ];

  return (
    <>
      <TablaCatalogo<TipoProceso>
        testid="tipo-proceso"
        titulo="Tipos de proceso"
        descripcion="Catálogo base · costura (M) y aplicación (A) — motor de producción"
        unidad="tipos"
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(t) => t.id}
        obtenerActivo={(t) => t.activo}
        columnas={columnas}
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
