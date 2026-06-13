import {
  type ColumnSort,
  flexRender,
  getCoreRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, PlusIcon, SearchIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useCortadores, useDesactivarCortador, useReactivarCortador } from '@/api/cortadores';
import type { Cortador, CortadoresQuery } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDebounce } from '@/lib/useDebounce';
import { useSesion } from '@/sesion/useSesion';

import { type AccionesCortador, columnasCortadores } from './columnas';
import { DialogoCortador } from './DialogoCortador';

/** Columnas por las que el backend sabe ordenar. */
type ColumnaOrden = NonNullable<CortadoresQuery['ordenarPor']>;

/** Renglones por pagina del listado. */
const POR_PAGINA = 10;

/** Orden inicial: por nombre, ascendente. */
const ORDEN_INICIAL: ColumnSort = { id: 'nombre', desc: false };

/**
 * Pantalla de Cortadores — CRUD del catalogo de cortadores (replica del patron de
 * Almacenes). Lista con busqueda (debounce), orden y paginacion de servidor;
 * alta/edicion en dialogo; borrado suave reversible; toasts; estados de
 * carga/vacio/error; consciente de permisos. `cortadores.ver` gobierna el acceso;
 * `cortadores.administrar` decide las acciones de escritura. El backend decide (A1).
 */
export function CortadoresPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('cortadores.administrar');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [orden, setOrden] = useState<SortingState>([ORDEN_INICIAL]);
  const [pagina, setPagina] = useState(1);

  const ordenActivo = orden[0] ?? ORDEN_INICIAL;
  const query: CortadoresQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: ordenActivo.id as ColumnaOrden,
    direccion: ordenActivo.desc ? 'desc' : 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  };

  const consulta = useCortadores(query);
  const desactivar = useDesactivarCortador();
  const reactivar = useReactivarCortador();

  // ── Dialogos ───────────────────────────────────────────────────────────────
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [cortadorEnEdicion, setCortadorEnEdicion] = useState<Cortador | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<Cortador | null>(null);

  function abrirAlta(): void {
    setCortadorEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(cortador: Cortador): void {
    setCortadorEnEdicion(cortador);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Cortador "${objetivo.nombre}" desactivado.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  // Reactivar es NO destructivo: se aplica directo, sin dialogo de confirmacion.
  function reactivarCortador(cortador: Cortador): void {
    reactivar.mutate(cortador.id, {
      onSuccess: () => toast.success(`Cortador "${cortador.nombre}" activado.`),
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

  // ── Tabla (TanStack Table en modo servidor) ────────────────────────────────
  const datos = consulta.data?.datos ?? [];
  const totalPaginas = consulta.data?.totalPaginas ?? 0;

  const tabla = useReactTable<Cortador>({
    data: datos,
    columns: columnasCortadores,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: totalPaginas,
    enableMultiSort: false,
    state: { sorting: orden },
    onSortingChange: (actualizador) => {
      setOrden((previo) => {
        const siguiente = typeof actualizador === 'function' ? actualizador(previo) : actualizador;
        return siguiente.length > 0 ? siguiente : [ORDEN_INICIAL];
      });
      setPagina(1);
    },
    meta: {
      acciones: {
        puedeAdministrar,
        alEditar: abrirEdicion,
        alDesactivar: setADesactivar,
        alReactivar: reactivarCortador,
      } satisfies AccionesCortador,
    },
  });

  const totalColumnas = tabla.getAllLeafColumns().length;
  const datosPagina = consulta.data;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cortadores</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Catálogo de cortadores (talleres de corte) y su precio de referencia.
          </p>
        </div>
        {puedeAdministrar ? (
          <Button onClick={abrirAlta} data-testid="nuevo-cortador">
            <PlusIcon aria-hidden />
            Nuevo cortador
          </Button>
        ) : null}
      </div>

      {/* Barra de herramientas: busqueda + filtro de inactivos */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Buscar por nombre…"
            className="pl-8"
            value={textoBusqueda}
            onChange={(e) => alBuscar(e.target.value)}
            aria-label="Buscar cortadores por nombre"
            data-testid="buscar-cortador"
          />
        </div>
        <Button
          type="button"
          variant={incluirInactivos ? 'secondary' : 'outline'}
          size="sm"
          onClick={alAlternarInactivos}
          aria-pressed={incluirInactivos}
          aria-label="Mostrar también los cortadores desactivados"
          data-testid="mostrar-desactivados"
        >
          {incluirInactivos ? 'Ocultar desactivados' : 'Mostrar desactivados'}
        </Button>
      </div>

      {/* Tabla / estados */}
      <div className="mt-4 rounded-xl border">
        <Table>
          <TableHeader>
            {tabla.getHeaderGroups().map((grupo) => (
              <TableRow key={grupo.id}>
                {grupo.headers.map((cabecera) => (
                  <TableHead key={cabecera.id} className={anchoColumna(cabecera.column.id)}>
                    {cabecera.column.getCanSort() ? (
                      <BotonOrden cabecera={cabecera} />
                    ) : (
                      flexRender(cabecera.column.columnDef.header, cabecera.getContext())
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {consulta.isPending ? (
              <FilasEsqueleto columnas={totalColumnas} />
            ) : consulta.isError ? (
              <TableRow>
                <TableCell colSpan={totalColumnas} className="py-10 text-center">
                  <p className="text-sm font-medium text-destructive">{consulta.error.message}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => void consulta.refetch()}
                  >
                    Reintentar
                  </Button>
                </TableCell>
              </TableRow>
            ) : datos.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={totalColumnas}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No hay cortadores que coincidan con la búsqueda.
                </TableCell>
              </TableRow>
            ) : (
              tabla.getRowModel().rows.map((fila) => (
                <TableRow
                  key={fila.id}
                  data-testid="fila-cortador"
                  data-activo={fila.original.activo}
                >
                  {fila.getVisibleCells().map((celda) => (
                    <TableCell key={celda.id}>
                      {flexRender(celda.column.columnDef.cell, celda.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Paginacion (servidor) */}
      {datosPagina && datosPagina.total > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground" data-testid="resumen-paginacion">
            {datosPagina.total} cortador{datosPagina.total === 1 ? '' : 'es'} · página{' '}
            {datosPagina.pagina} de {totalPaginas}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={datosPagina.pagina <= 1 || consulta.isFetching}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              disabled={datosPagina.pagina >= totalPaginas || consulta.isFetching}
            >
              Siguiente
            </Button>
          </div>
        </div>
      ) : null}

      {/* Dialogos */}
      <DialogoCortador
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        cortador={cortadorEnEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar cortador"
        descripcion={
          <>
            ¿Seguro que quieres desactivar el cortador{' '}
            <span className="font-medium text-foreground">{aDesactivar?.nombre}</span>? Podrás
            volver a activarlo después; su historial se conserva.
          </>
        }
        textoConfirmar="Desactivar"
        variante="destructive"
        procesando={desactivar.isPending}
        alConfirmar={confirmarDesactivar}
      />
    </div>
  );
}

/** Ancho fijo de la columna de acciones (las demas reparten el resto). */
function anchoColumna(id: string): string | undefined {
  return id === 'acciones' ? 'w-12' : undefined;
}

/** Boton de cabecera para ordenar una columna; muestra la flecha del orden activo. */
function BotonOrden({
  cabecera,
}: {
  cabecera: ReturnType<
    ReturnType<typeof useReactTable<Cortador>>['getHeaderGroups']
  >[number]['headers'][number];
}): React.JSX.Element {
  const orden = cabecera.column.getIsSorted();
  const Icono = orden === false ? ArrowUpDownIcon : orden === 'asc' ? ArrowUpIcon : ArrowDownIcon;
  return (
    <button
      type="button"
      onClick={cabecera.column.getToggleSortingHandler()}
      className="-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 font-medium hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {flexRender(cabecera.column.columnDef.header, cabecera.getContext())}
      <Icono className="size-3.5 text-muted-foreground" aria-hidden />
    </button>
  );
}

/** Filas de carga (skeleton) mientras llega la primera pagina. */
function FilasEsqueleto({ columnas }: { columnas: number }): React.JSX.Element {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: columnas }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-5 w-full max-w-32" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
