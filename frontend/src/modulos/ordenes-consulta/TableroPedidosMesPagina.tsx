import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useTableroPedidosMes } from '@/api/ordenes-consulta';
import type { TableroPedidosMesFila, TableroPedidosMesQuery } from '@/api/tipos';
import { FiltroCliente } from '@/components/dominio/FiltroCliente';
import { Button } from '@/components/ui/button';
import { SelectNativo } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/** Valor del filtro de cliente que significa "todos". */
const TODOS = 'TODOS';

/** Años disponibles en el filtro. */
function aniosDisponibles(): number[] {
  const actual = new Date().getFullYear();
  const lista: number[] = [];
  for (let a = actual; a >= actual - 8; a -= 1) lista.push(a);
  return lista;
}

/**
 * TABLERO "Pedidos por mes" (F2-E4): agrega las órdenes por mes con número de órdenes y total de
 * piezas. Filtros (año/cliente). SALTOS: cada mes lleva a la Consulta ya filtrada por ese año; los
 * saltos a compras/costos/proceso van como stubs hasta F3/F4/F7. El agregado lo calcula el backend
 * (A1); la forma es EXTENSIBLE (F3 sumará columnas de avance sin rehacer la pantalla).
 */
export function TableroPedidosMesPagina(): React.JSX.Element {
  const navigate = useNavigate();
  const [anio, setAnio] = useState<number | null>(new Date().getFullYear());
  const [idCliente, setIdCliente] = useState<number | null>(null);
  // El NOMBRE del cliente se conserva —no sólo su id— porque viaja en el deep-link: la Consulta
  // llega con el filtro puesto y, con búsqueda server-side, sin el nombre no tendría cómo
  // mostrarlo (enseñaría "Todos los clientes" estando filtrada).
  const [nombreCliente, setNombreCliente] = useState<string | null>(null);

  const query: TableroPedidosMesQuery = {
    ...(anio !== null ? { anio } : {}),
    ...(idCliente !== null ? { idCliente } : {}),
  };
  const consulta = useTableroPedidosMes(query);
  const datos = consulta.data;
  const filas = datos?.filas ?? [];

  /** Salta a la Consulta de órdenes filtrada por el año/cliente del tablero. */
  function saltarAConsulta(fila: TableroPedidosMesFila): void {
    void navigate('/produccion/consulta', {
      state: { anio: fila.anio, idCliente, nombreCliente },
    });
  }

  return (
    <div className="h-full overflow-y-auto" data-testid="tablero-pedidos-mes">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
              Pedidos por mes
            </h1>
            <p className="text-[12.5px] text-muted-foreground">
              Órdenes y piezas agregadas por mes. Toca un mes para ver sus órdenes.
            </p>
          </div>
        </div>

        {/* Filtros */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SelectNativo
            value={anio === null ? TODOS : String(anio)}
            onChange={(e) => setAnio(e.target.value === TODOS ? null : Number(e.target.value))}
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
          {/* V1-E4 (punto 7): era un <select> de la primera página del catálogo (100) y con
              ~117 clientes los del final del alfabeto NO aparecían. */}
          <FiltroCliente
            idCliente={idCliente}
            alCambiar={(c) => {
              setIdCliente(c?.id ?? null);
              setNombreCliente(c?.nombre ?? null);
            }}
            testid="filtro-cliente"
          />
        </div>

        {/* Salto a Pedidos reales (existe) + stubs (F3/F4/F7) */}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void navigate('/pedidos')}>
            <ExternalLink aria-hidden />
            Ir a Pedidos
          </Button>
          <Button variant="outline" size="sm" disabled title="Disponible en F4">
            Compras (F4)
          </Button>
          <Button variant="outline" size="sm" disabled title="Disponible en F7">
            Costos (F7)
          </Button>
          <Button variant="outline" size="sm" disabled title="Disponible en F3">
            Proceso (F3)
          </Button>
        </div>

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
                  <TableHead>Mes</TableHead>
                  <TableHead className="text-right">Órdenes</TableHead>
                  <TableHead className="text-right">Piezas</TableHead>
                  <TableHead className="text-right">Ver</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                      {consulta.isPending
                        ? 'Cargando…'
                        : 'No hay órdenes con fecha en el rango seleccionado.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filas.map((fila) => (
                    <TableRow key={fila.clave} data-testid="fila-mes">
                      <TableCell className="font-medium capitalize">{fila.etiqueta}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fila.numOrdenes.toLocaleString('es-MX')}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fila.totalPiezas.toLocaleString('es-MX')}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => saltarAConsulta(fila)}
                          data-testid="saltar-consulta"
                        >
                          <ExternalLink className="size-4" aria-hidden />
                          Ver órdenes
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              {datos && filas.length > 0 ? (
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-medium">Total</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {datos.totalOrdenes.toLocaleString('es-MX')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {datos.totalPiezas.toLocaleString('es-MX')}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              ) : null}
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
