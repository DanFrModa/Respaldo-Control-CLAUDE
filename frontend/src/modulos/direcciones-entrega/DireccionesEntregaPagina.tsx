import { useState } from 'react';
import { toast } from 'sonner';

import {
  useDesactivarDireccionEntrega,
  useDireccionesEntrega,
  useReactivarDireccionEntrega,
} from '@/api/direcciones-entrega';
import type { DireccionEntrega, DireccionesEntregaQuery } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { useDebounce } from '@/lib/useDebounce';
import {
  TablaCatalogo,
  type ColumnaCatalogo,
  type PaginacionCatalogo,
} from '@/modulos/TablaCatalogo';
import { useSesion } from '@/sesion/useSesion';

import { DialogoDireccionEntrega } from './DialogoDireccionEntrega';

/** Renglones por página del listado. */
const POR_PAGINA = 10;

/**
 * Pantalla del catálogo de DIRECCIONES DE ENTREGA (§Post-F9.18 — petición de Daniel: *"la dirección
 * de entrega debe de ser un catálogo de los que se llenan automáticamente, para que la dirección,
 * que en el 95% es la misma, tenga la dirección correcta y escrita siempre de la misma manera"*).
 *
 * Tabla-first como los demás catálogos. La FAVORITA se distingue con un chip: es la que la captura
 * de la orden de compra preselecciona. Sin permisos propios: se gobierna con `compras.ver` /
 * `compras.administrar` (A1 — el backend decide).
 */
export function DireccionesEntregaPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('compras.administrar');

  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: DireccionesEntregaQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  };

  const consulta = useDireccionesEntrega(query);
  const desactivar = useDesactivarDireccionEntrega();
  const reactivar = useReactivarDireccionEntrega();

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [enEdicion, setEnEdicion] = useState<DireccionEntrega | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<DireccionEntrega | null>(null);

  function abrirAlta(): void {
    setEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(direccion: DireccionEntrega): void {
    setEnEdicion(direccion);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Dirección "${objetivo.nombre}" desactivada.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  function reactivarDireccion(direccion: DireccionEntrega): void {
    reactivar.mutate(direccion.id, {
      onSuccess: () => toast.success(`Dirección "${direccion.nombre}" activada.`),
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

  const columnas: ColumnaCatalogo<DireccionEntrega>[] = [
    {
      encabezado: 'Nombre',
      render: (d) => (
        <span className="flex items-center gap-2">
          <span className="font-semibold">{d.nombre}</span>
          {d.favorita ? (
            <ChipEstado tono="ok" sinPunto>
              La de siempre
            </ChipEstado>
          ) : null}
        </span>
      ),
    },
    {
      encabezado: 'Dirección',
      render: (d) => <span className="text-muted-foreground">{d.direccion}</span>,
    },
    {
      encabezado: 'Contacto',
      render: (d) => (
        <span className="text-muted-foreground">
          {d.contacto ?? '—'}
          {d.telefono === null ? '' : ` · ${d.telefono}`}
        </span>
      ),
    },
  ];

  return (
    <>
      <TablaCatalogo<DireccionEntrega>
        testid="direccion-entrega"
        titulo="Direcciones de entrega"
        descripcion="Catálogo base · a dónde entregan los proveedores"
        unidad="direcciones"
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(d) => d.id}
        obtenerActivo={(d) => d.activo}
        columnas={columnas}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay direcciones que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nueva dirección"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarDireccion}
      />

      <DialogoDireccionEntrega
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        direccion={enEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar dirección de entrega"
        descripcion={
          <>
            ¿Seguro que quieres desactivar{' '}
            <span className="font-medium text-foreground">{aDesactivar?.nombre}</span>? Dejará de
            ofrecerse al capturar órdenes de compra; las que ya la usan no cambian.
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
