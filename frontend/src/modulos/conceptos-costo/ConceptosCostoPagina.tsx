import { useState } from 'react';
import { toast } from 'sonner';

import {
  useConceptosCosto,
  useDesactivarConceptoCosto,
  useReactivarConceptoCosto,
  type ConceptoCosto,
  type ConceptosCostoQuery,
} from '@/api/conceptos-costo';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { TipoBadge } from '@/components/dominio/visuales';
import { useDebounce } from '@/lib/useDebounce';
import {
  TablaCatalogo,
  type ColumnaCatalogo,
  type PaginacionCatalogo,
} from '@/modulos/TablaCatalogo';
import { useSesion } from '@/sesion/useSesion';

import { DialogoConceptoCosto } from './DialogoConceptoCosto';

/** Renglones por página del listado. */
const POR_PAGINA = 10;

/**
 * Pantalla de Conceptos de costo (F8-E1, Administración) — re-vestida R9 a TABLA-FIRST (proto
 * `vCat`, mismo molde que "Tipos de proceso"): tabla densa con el concepto, su código, su orden y
 * su tipo (Fijo/Abierto), con acciones inline. Alta/edición por diálogo; borrado suave.
 *
 * Es ADMIN-ONLY: `concepto-costo.ver` gobierna el acceso y `concepto-costo.administrar` las
 * escrituras (el backend es la autoridad, A1). Los conceptos con bandera `fijo` NO se pueden
 * desactivar (el backend lo rechaza): su botón Desactivar se pinta deshabilitado con la razón.
 */
export function ConceptosCostoPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('concepto-costo.administrar');

  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: ConceptosCostoQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'orden',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  };

  const consulta = useConceptosCosto(query);
  const desactivar = useDesactivarConceptoCosto();
  const reactivar = useReactivarConceptoCosto();

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [enEdicion, setEnEdicion] = useState<ConceptoCosto | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<ConceptoCosto | null>(null);

  function abrirAlta(): void {
    setEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(concepto: ConceptoCosto): void {
    setEnEdicion(concepto);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Concepto de costo "${objetivo.nombre}" desactivado.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  function reactivarConcepto(concepto: ConceptoCosto): void {
    reactivar.mutate(concepto.id, {
      onSuccess: () => toast.success(`Concepto de costo "${concepto.nombre}" activado.`),
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

  const columnas: ColumnaCatalogo<ConceptoCosto>[] = [
    {
      encabezado: 'Concepto',
      render: (c) => <span className="font-semibold">{c.nombre}</span>,
    },
    { encabezado: 'Código', render: (c) => <span className="num text-faint">{c.codigo}</span> },
    { encabezado: 'Orden', numerica: true, render: (c) => <span className="num">{c.orden}</span> },
    {
      encabezado: 'Tipo',
      render: (c) =>
        c.fijo ? (
          <TipoBadge tono="pt">Fijo</TipoBadge>
        ) : (
          <TipoBadge tono="neutro">Abierto</TipoBadge>
        ),
    },
  ];

  return (
    <>
      <TablaCatalogo<ConceptoCosto>
        testid="concepto-costo"
        titulo="Conceptos de costo"
        descripcion="Catálogo global de conceptos del pre-costeo · los fijos (tela, avíos, maquila) no se desactivan"
        unidad="conceptos"
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(c) => c.id}
        obtenerActivo={(c) => c.activo}
        columnas={columnas}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay conceptos de costo que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo concepto"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarConcepto}
        razonNoDesactivar={(c) =>
          c.fijo ? 'Los conceptos fijos (tela/avíos/maquila) no se pueden desactivar.' : undefined
        }
        renderTarjeta={(c) => (
          <>
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 truncate font-semibold">{c.nombre}</span>
              {c.fijo ? (
                <TipoBadge tono="pt">Fijo</TipoBadge>
              ) : (
                <TipoBadge tono="neutro">Abierto</TipoBadge>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
              <span>
                Código <b className="num text-foreground">{c.codigo}</b>
              </span>
              <span>
                Orden <b className="num text-foreground">{c.orden}</b>
              </span>
            </div>
          </>
        )}
      />

      <DialogoConceptoCosto
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        concepto={enEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar concepto de costo"
        descripcion={
          <>
            ¿Seguro que quieres desactivar el concepto{' '}
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
