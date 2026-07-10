import { FileText, Printer, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { toast } from 'sonner';

import { useClientes } from '@/api/clientes';
import { imprimirLoteOrdenes, imprimirOrden, useConsultaOrdenes } from '@/api/ordenes-consulta';
import type { EstadoOrden, OrdenesConsultaQuery, OrdenLigera } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ErrorDeApi } from '@/api/errores';
import { useDebounce } from '@/lib/useDebounce';
import { useSesion } from '@/sesion/useSesion';

import { fechaCorta } from './formato';
import { EstadoOrdenBadge } from './piezas';

/** Renglones por página de la consulta. */
const POR_PAGINA = 20;

/** Valor del filtro de cliente/estado que significa "todos". */
const TODOS = 'TODOS';

/** Años disponibles en el filtro (del actual hacia atrás). */
function aniosDisponibles(): number[] {
  const actual = new Date().getFullYear();
  const lista: number[] = [];
  for (let a = actual; a >= actual - 8; a -= 1) {
    lista.push(a);
  }
  return lista;
}

/** Lee de forma defensiva un entero positivo del `state` de navegación (deep-link del tablero). */
function leerEnteroState(state: unknown, clave: string): number | null {
  if (typeof state !== 'object' || state === null || !(clave in state)) {
    return null;
  }
  const valor = (state as Record<string, unknown>)[clave];
  return typeof valor === 'number' && Number.isInteger(valor) && valor > 0 ? valor : null;
}

/**
 * CONSULTA de Órdenes (F2-E4): la operación diaria de localizar/imprimir órdenes. Tabla LIGERA
 * (servidor) con filtros (cliente/año/modelo/estado/canceladas) + búsqueda combinada (folio, modelo,
 * cliente, referencia D7). Selección múltiple de filas para imprimir en LOTE (PDF consolidado) +
 * impresión individual. Cada fila enlaza al detalle de captura existente (módulo Órdenes de E3).
 * Los saltos a proceso/OC/notas/costos van como stubs deshabilitados (F3/F4/F7).
 *
 * Sin lógica de negocio (A1): el backend deriva todo (total agregado, estado). Funciona en PC y
 * MÓVIL (consultar también es móvil): la tabla scrollea en horizontal y los filtros se apilan.
 */
export function ConsultaOrdenesPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeImprimir = tienePermiso('ordenes.ver'); // imprimir es lectura

  // Deep-link desde el tablero "pedidos por mes": año/cliente iniciales (defensivo).
  const estadoNavegacion: unknown = useLocation().state;
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [idCliente, setIdCliente] = useState<number | null>(() =>
    leerEnteroState(estadoNavegacion, 'idCliente'),
  );
  const [anio, setAnio] = useState<number | null>(() => leerEnteroState(estadoNavegacion, 'anio'));
  const [estado, setEstado] = useState<EstadoOrden | null>(null);
  const [incluirCanceladas, setIncluirCanceladas] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [seleccion, setSeleccion] = useState<ReadonlySet<number>>(new Set());
  const [imprimiendoLote, setImprimiendoLote] = useState(false);

  // Selector de clientes (para el filtro): lista corta, primera página.
  const clientes = useClientes({ pagina: 1, porPagina: 100, ordenarPor: 'nombre' });

  const query: OrdenesConsultaQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'folio',
    direccion: 'desc',
    incluirCanceladas: incluirCanceladas ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(idCliente !== null ? { idCliente } : {}),
    ...(anio !== null ? { anio } : {}),
    ...(estado !== null ? { estado } : {}),
  };

  const consulta = useConsultaOrdenes(query);
  const datos = consulta.data;
  const filas = useMemo(() => datos?.datos ?? [], [datos]);

  /** Reinicia paginación + selección al cambiar cualquier filtro. */
  function reiniciar(): void {
    setPagina(1);
    setSeleccion(new Set());
  }

  function alternarFila(id: number): void {
    setSeleccion((prev) => {
      const proximo = new Set(prev);
      if (proximo.has(id)) {
        proximo.delete(id);
      } else {
        proximo.add(id);
      }
      return proximo;
    });
  }

  const todasSeleccionadas = filas.length > 0 && filas.every((o) => seleccion.has(o.id));
  function alternarTodas(): void {
    setSeleccion((prev) => {
      if (todasSeleccionadas) {
        const proximo = new Set(prev);
        for (const o of filas) proximo.delete(o.id);
        return proximo;
      }
      const proximo = new Set(prev);
      for (const o of filas) proximo.add(o.id);
      return proximo;
    });
  }

  async function imprimirSeleccionadas(): Promise<void> {
    const ids = [...seleccion];
    if (ids.length === 0) return;
    setImprimiendoLote(true);
    try {
      await imprimirLoteOrdenes(ids);
    } catch (error) {
      const mensaje =
        error instanceof ErrorDeApi ? error.message : 'No se pudo generar el PDF del lote.';
      toast.error(mensaje);
    } finally {
      setImprimiendoLote(false);
    }
  }

  const totalPaginas = datos?.totalPaginas ?? 0;

  return (
    <div className="h-full overflow-y-auto" data-testid="consulta-ordenes">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6">
        {/* Encabezado */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
              Consulta de órdenes
            </h1>
            <p className="text-[12.5px] text-muted-foreground">
              Localiza, imprime y salta a las órdenes de producción.
            </p>
          </div>
          {puedeImprimir ? (
            <Button
              onClick={() => void imprimirSeleccionadas()}
              disabled={seleccion.size === 0 || imprimiendoLote}
              data-testid="imprimir-lote"
            >
              <Printer aria-hidden />
              Imprimir {seleccion.size > 0 ? `(${seleccion.size})` : 'selección'}
            </Button>
          ) : null}
        </div>

        {/* Filtros */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={textoBusqueda}
              onChange={(e) => {
                setTextoBusqueda(e.target.value);
                reiniciar();
              }}
              placeholder="Folio, modelo, cliente o referencia"
              className="pl-8"
              data-testid="buscar-consulta"
              aria-label="Buscar órdenes"
            />
          </div>
          <SelectNativo
            value={idCliente === null ? TODOS : String(idCliente)}
            onChange={(e) => {
              setIdCliente(e.target.value === TODOS ? null : Number(e.target.value));
              reiniciar();
            }}
            aria-label="Filtrar por cliente"
            data-testid="filtro-cliente"
          >
            <option value={TODOS}>Todos los clientes</option>
            {(clientes.data?.datos ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </SelectNativo>
          <SelectNativo
            value={anio === null ? TODOS : String(anio)}
            onChange={(e) => {
              setAnio(e.target.value === TODOS ? null : Number(e.target.value));
              reiniciar();
            }}
            aria-label="Filtrar por año"
            data-testid="filtro-anio"
          >
            <option value={TODOS}>Todos los años</option>
            {aniosDisponibles().map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </SelectNativo>
          <SelectNativo
            value={estado === null ? TODOS : estado}
            onChange={(e) => {
              setEstado(e.target.value === TODOS ? null : (e.target.value as EstadoOrden));
              reiniciar();
            }}
            aria-label="Filtrar por estado"
            data-testid="filtro-estado"
          >
            <option value={TODOS}>Todos los estados</option>
            <option value="capturada">Capturada</option>
            <option value="completa">Completa</option>
            <option value="cancelada">Cancelada</option>
          </SelectNativo>
        </div>

        <label className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={incluirCanceladas}
            onChange={(e) => {
              setIncluirCanceladas(e.target.checked);
              reiniciar();
            }}
            data-testid="incluir-canceladas"
            className="size-4 rounded border-input"
          />
          Incluir canceladas
        </label>

        {/* Tabla */}
        {consulta.isError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
            <p className="text-sm text-destructive">{consulta.error.message}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void consulta.refetch()}
            >
              Reintentar
            </Button>
          </div>
        ) : (
          <div className="rounded-lg ring-1 ring-foreground/10">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={todasSeleccionadas}
                      onChange={alternarTodas}
                      aria-label="Seleccionar todas"
                      data-testid="seleccionar-todas"
                      className="size-4 rounded border-input"
                      disabled={filas.length === 0}
                    />
                  </TableHead>
                  <TableHead>Folio</TableHead>
                  <TableHead>Modelo</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Piezas</TableHead>
                  <TableHead>Entrega</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                      {consulta.isPending
                        ? 'Cargando…'
                        : 'No hay órdenes que coincidan con los filtros.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filas.map((orden) => (
                    <FilaConsulta
                      key={orden.id}
                      orden={orden}
                      seleccionada={seleccion.has(orden.id)}
                      alAlternar={() => alternarFila(orden.id)}
                      puedeImprimir={puedeImprimir}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Paginación */}
        {datos && datos.total > 0 ? (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {datos.total.toLocaleString('es-MX')} órdenes · página {datos.pagina} de{' '}
              {totalPaginas}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={datos.pagina <= 1 || consulta.isFetching}
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={datos.pagina >= totalPaginas || consulta.isFetching}
                onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              >
                Siguiente
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Una fila de la tabla de consulta: selección + datos + acciones (imprimir / detalle / stubs). */
function FilaConsulta({
  orden,
  seleccionada,
  alAlternar,
  puedeImprimir,
}: {
  orden: OrdenLigera;
  seleccionada: boolean;
  alAlternar: () => void;
  puedeImprimir: boolean;
}): React.JSX.Element {
  return (
    <TableRow data-testid="fila-consulta" data-state={seleccionada ? 'selected' : undefined}>
      <TableCell>
        <input
          type="checkbox"
          checked={seleccionada}
          onChange={alAlternar}
          aria-label={`Seleccionar orden ${orden.folio}`}
          data-testid="seleccionar-fila"
          className="size-4 rounded border-input"
        />
      </TableCell>
      <TableCell className="font-medium">
        <Link
          to="/produccion/ordenes"
          state={{ idOrden: orden.id }}
          className="text-primary hover:underline"
          data-testid="enlace-detalle"
        >
          {orden.folio}
        </Link>
      </TableCell>
      <TableCell>
        <span className="font-medium">{orden.codigoModelo}</span>
        {orden.descripcionModelo ? (
          <span className="block text-xs text-muted-foreground">{orden.descripcionModelo}</span>
        ) : null}
      </TableCell>
      <TableCell>{orden.cliente}</TableCell>
      <TableCell>
        <EstadoOrdenBadge estado={orden.estado} />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {orden.totalPiezas.toLocaleString('es-MX')}
      </TableCell>
      <TableCell>{fechaCorta(orden.fechaEntrega)}</TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          {puedeImprimir ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => imprimirOrden(orden.id)}
              aria-label={`Imprimir orden ${orden.folio}`}
              title="Imprimir esta orden"
              data-testid="imprimir-individual"
            >
              <Printer className="size-4" aria-hidden />
            </Button>
          ) : null}
          {/* Stubs de F3/F4/F7: proceso/OC/notas/costos aún no existen. */}
          <Button
            variant="ghost"
            size="icon-sm"
            disabled
            aria-label="Documentos (disponible en fases posteriores)"
            title="Proceso / OC / notas / costos: disponible en F3/F4/F7"
            data-testid="stub-documentos"
          >
            <FileText className="size-4" aria-hidden />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
