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
import { TipoBadge } from '@/components/dominio/visuales';
import { useDebounce } from '@/lib/useDebounce';
import {
  TablaCatalogo,
  type ColumnaCatalogo,
  type PaginacionCatalogo,
} from '@/modulos/TablaCatalogo';
import { useSesion } from '@/sesion/useSesion';

import { DialogoEstadoLista } from './DialogoEstadoLista';

/** Renglones por página del listado. */
const POR_PAGINA = 10;

/**
 * Pantalla de Estados de lista de precios (F8-E1, Administración) — re-vestida R9 a TABLA-FIRST
 * (proto `vCat`, mismo molde que "Tipos de proceso"): tabla densa con el estado, su código, su
 * orden y su ciclo (Cierre/Abierto), con acciones inline. Alta/edición por diálogo; borrado suave.
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

  const columnas: ColumnaCatalogo<EstadoLista>[] = [
    {
      encabezado: 'Estado',
      render: (e) => <span className="font-semibold">{e.nombre}</span>,
    },
    { encabezado: 'Código', render: (e) => <span className="num text-faint">{e.codigo}</span> },
    { encabezado: 'Orden', numerica: true, render: (e) => <span className="num">{e.orden}</span> },
    {
      encabezado: 'Ciclo',
      render: (e) =>
        e.esCierre ? (
          <TipoBadge tono="pt">Cierre</TipoBadge>
        ) : (
          <TipoBadge tono="neutro">Abierto</TipoBadge>
        ),
    },
  ];

  return (
    <>
      <TablaCatalogo<EstadoLista>
        testid="estado-lista"
        titulo="Estados de lista de precios"
        descripcion="Catálogo global de estados del ciclo de vida de una lista de precios"
        unidad="estados"
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(e) => e.id}
        obtenerActivo={(e) => e.activo}
        columnas={columnas}
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
