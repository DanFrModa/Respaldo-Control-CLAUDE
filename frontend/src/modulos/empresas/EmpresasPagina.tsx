import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, PlusIcon, SearchIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useDesactivarEmpresa, useEmpresas, useReactivarEmpresa } from '@/api/empresas';
import type { Empresa } from '@/api/tipos';
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
import { useSesion } from '@/sesion/useSesion';

import { type AccionesEmpresa, columnasEmpresas } from './columnas';
import { DialogoConfiguracion } from './DialogoConfiguracion';
import { DialogoEmpresa } from './DialogoEmpresa';

/**
 * Pantalla de Empresas — administracion de empresas (multi-empresa A9). A
 * diferencia de los catalogos, la lista NO viene paginada del servidor (array
 * plano, favorita primero), asi que la busqueda y el orden se hacen EN CLIENTE
 * con TanStack Table. Alta/edicion en dialogo; configuracion por empresa en un
 * dialogo secundario; borrado suave reversible (campo `activa`).
 *
 * Todo va gobernado por `empresas.administrar`. La decision real la toma el
 * backend en cada ruta (A1).
 */
export function EmpresasPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('empresas.administrar');

  const consulta = useEmpresas();
  const desactivar = useDesactivarEmpresa();
  const reactivar = useReactivarEmpresa();

  // ── Estado de la vista (filtrado/orden en cliente) ──────────────────────────
  const [busqueda, setBusqueda] = useState('');
  const [incluirInactivas, setIncluirInactivas] = useState(false);
  const [orden, setOrden] = useState<SortingState>([{ id: 'nombre', desc: false }]);

  // ── Dialogos ───────────────────────────────────────────────────────────────
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [empresaEnEdicion, setEmpresaEnEdicion] = useState<Empresa | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<Empresa | null>(null);
  const [aConfigurar, setAConfigurar] = useState<Empresa | null>(null);

  function abrirAlta(): void {
    setEmpresaEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(empresa: Empresa): void {
    setEmpresaEnEdicion(empresa);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Empresa "${objetivo.nombre}" desactivada.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  // Reactivar es NO destructivo: directo, sin dialogo de confirmacion.
  function reactivarEmpresa(empresa: Empresa): void {
    reactivar.mutate(empresa.id, {
      onSuccess: () => toast.success(`Empresa "${empresa.nombre}" activada.`),
      onError: (error) => toast.error(error.message),
    });
  }

  // ── Datos filtrados (oculta inactivas salvo que se pidan) ───────────────────
  const empresas = useMemo(() => {
    const todas = consulta.data ?? [];
    return incluirInactivas ? todas : todas.filter((empresa) => empresa.activa);
  }, [consulta.data, incluirInactivas]);

  const columnas = useMemo(() => columnasEmpresas({ alConfigurar: setAConfigurar }), []);

  const tabla = useReactTable<Empresa>({
    data: empresas,
    columns: columnas,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableMultiSort: false,
    state: { sorting: orden, globalFilter: busqueda },
    onSortingChange: setOrden,
    onGlobalFilterChange: setBusqueda,
    // Busqueda en cliente sobre nombre, razon social, identificador y UPC.
    globalFilterFn: (fila, _columnId, valor) => {
      const texto = String(valor).trim().toLowerCase();
      if (texto === '') {
        return true;
      }
      const e = fila.original;
      return [e.nombre, e.razonSocial, e.identificador, e.upc]
        .filter((campo): campo is string => typeof campo === 'string')
        .some((campo) => campo.toLowerCase().includes(texto));
    },
    meta: {
      acciones: {
        puedeAdministrar,
        alEditar: abrirEdicion,
        alDesactivar: setADesactivar,
        alReactivar: reactivarEmpresa,
      } satisfies AccionesEmpresa,
    },
  });

  const totalColumnas = tabla.getAllLeafColumns().length;
  const hayFilas = tabla.getRowModel().rows.length > 0;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Empresas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Empresas del grupo y su configuración de costeo e inventario.
          </p>
        </div>
        {puedeAdministrar ? (
          <Button onClick={abrirAlta} data-testid="nueva-empresa">
            <PlusIcon aria-hidden />
            Nueva empresa
          </Button>
        ) : null}
      </div>

      {/* Barra de herramientas: busqueda (cliente) + filtro de inactivas */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Buscar empresa…"
            className="pl-8"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            aria-label="Buscar empresas"
            data-testid="buscar-empresa"
          />
        </div>
        <Button
          type="button"
          variant={incluirInactivas ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setIncluirInactivas((v) => !v)}
          aria-pressed={incluirInactivas}
          aria-label="Mostrar también las empresas desactivadas"
          data-testid="mostrar-desactivadas"
        >
          {incluirInactivas ? 'Ocultar desactivadas' : 'Mostrar desactivadas'}
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
            ) : !hayFilas ? (
              <TableRow>
                <TableCell
                  colSpan={totalColumnas}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No hay empresas que coincidan con la búsqueda.
                </TableCell>
              </TableRow>
            ) : (
              tabla.getRowModel().rows.map((fila) => (
                <TableRow
                  key={fila.id}
                  data-testid="fila-empresa"
                  data-activa={fila.original.activa}
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

      {/* Dialogos */}
      <DialogoEmpresa
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        empresa={empresaEnEdicion}
      />
      <DialogoConfiguracion empresa={aConfigurar} alCerrar={() => setAConfigurar(null)} />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar empresa"
        descripcion={
          <>
            ¿Seguro que quieres desactivar la empresa{' '}
            <span className="font-medium text-foreground">{aDesactivar?.nombre}</span>? Podrás
            volver a activarla después; su historial se conserva.
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
    ReturnType<typeof useReactTable<Empresa>>['getHeaderGroups']
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

/** Filas de carga (skeleton) mientras llega la lista. */
function FilasEsqueleto({ columnas }: { columnas: number }): React.JSX.Element {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
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
