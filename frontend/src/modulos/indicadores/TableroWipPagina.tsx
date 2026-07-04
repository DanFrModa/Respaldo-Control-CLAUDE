import { Download, Package, Printer, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import {
  descargarExcelKpisWip,
  imprimirKpisWip,
  useKpisWip,
  useRefrescarKpis,
} from '@/api/indicadores';
import type { KpisWipQuery } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { SelectNativo } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { entero, selloDatosAl } from './comun';

/** Una tarjeta de total por etapa. */
function TarjetaTotal({
  titulo,
  valor,
  testid,
}: {
  titulo: string;
  valor: number;
  testid: string;
}): React.JSX.Element {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{titulo}</p>
        <p className="mt-1 text-2xl font-semibold" data-testid={testid}>
          {entero(valor)}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * TABLERO WIP analítico (F7-E3, F3): prendas atoradas por etapa (agregado) y avance por orden. Mismas
 * cifras que el tablero WIP de F3-E5 (suma directa de movimientos), pre-calculado en segundo plano.
 * Solo lectura (`indicadores.ver`).
 */
export function TableroWipPagina(): React.JSX.Element {
  const [soloPendientes, setSoloPendientes] = useState('true');
  const [pagina, setPagina] = useState(1);

  const query: KpisWipQuery = {
    soloPendientes,
    pagina,
    porPagina: 20,
  };
  const consulta = useKpisWip(query);
  const refrescar = useRefrescarKpis();
  const datos = consulta.data;
  const totales = datos?.totales;

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="tablero-wip">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
            <Package className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold">WIP analítico</h1>
            <p className="text-sm text-muted-foreground" data-testid="wip-datos-al">
              {selloDatosAl(datos?.datosAl)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field className="w-44">
            <FieldLabel htmlFor="wip-pendientes">Órdenes</FieldLabel>
            <SelectNativo
              id="wip-pendientes"
              value={soloPendientes}
              onChange={(e) => {
                setSoloPendientes(e.target.value);
                setPagina(1);
              }}
              data-testid="wip-pendientes"
            >
              <option value="true">Solo con pendientes</option>
              <option value="false">Todas</option>
            </SelectNativo>
          </Field>
          <Button
            type="button"
            variant="outline"
            onClick={() => refrescar.mutate()}
            disabled={refrescar.isPending}
            data-testid="wip-refrescar"
          >
            <RefreshCw className="mr-2 size-4" aria-hidden />
            Refrescar
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => imprimirKpisWip(query)}
            data-testid="wip-pdf"
          >
            <Printer className="mr-2 size-4" aria-hidden />
            PDF
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => descargarExcelKpisWip(query)}
            data-testid="wip-excel"
          >
            <Download className="mr-2 size-4" aria-hidden />
            Excel
          </Button>
        </div>
      </header>

      {consulta.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {consulta.error.message}
        </p>
      ) : consulta.isPending ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : datos === undefined || totales === undefined ? null : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <TarjetaTotal titulo="Por cortar" valor={totales.porCortar} testid="wip-por-cortar" />
            <TarjetaTotal
              titulo="Cortado por enviar"
              valor={totales.cortadoPorEnviar}
              testid="wip-por-enviar"
            />
            <TarjetaTotal
              titulo="Por recibir"
              valor={totales.porRecibir}
              testid="wip-por-recibir"
            />
            <TarjetaTotal
              titulo="Por entregar"
              valor={totales.porEntregar}
              testid="wip-por-entregar"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Órdenes</CardTitle>
              <CardDescription>
                {entero(datos.total)} orden(es) · página {datos.pagina} de {datos.totalPaginas}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {datos.datos.length === 0 ? (
                <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No hay órdenes para el filtro elegido.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Folio</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Modelo</TableHead>
                        <TableHead className="text-right">Pedido</TableHead>
                        <TableHead className="text-right">Cortado</TableHead>
                        <TableHead className="text-right">Enviado</TableHead>
                        <TableHead className="text-right">Recibido</TableHead>
                        <TableHead className="text-right">Entregado</TableHead>
                        <TableHead className="text-right">Por recibir</TableHead>
                        <TableHead className="text-right">Por entregar</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {datos.datos.map((o) => (
                        <TableRow key={o.idOrden} data-testid={`wip-fila-${o.idOrden}`}>
                          <TableCell className="font-medium">#{o.folio}</TableCell>
                          <TableCell>{o.cliente}</TableCell>
                          <TableCell>{o.codigoModelo}</TableCell>
                          <TableCell className="text-right">{o.pedido}</TableCell>
                          <TableCell className="text-right">{o.cortado}</TableCell>
                          <TableCell className="text-right">{o.enviado}</TableCell>
                          <TableCell className="text-right">{o.recibido}</TableCell>
                          <TableCell className="text-right">{o.entregado}</TableCell>
                          <TableCell className="text-right">{o.porRecibir}</TableCell>
                          <TableCell className="text-right">{o.porEntregar}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {datos.totalPaginas > 1 && (
                <div className="mt-4 flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={datos.pagina <= 1}
                    onClick={() => setPagina((p) => Math.max(1, p - 1))}
                    data-testid="wip-anterior"
                  >
                    Anterior
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={datos.pagina >= datos.totalPaginas}
                    onClick={() => setPagina((p) => p + 1)}
                    data-testid="wip-siguiente"
                  >
                    Siguiente
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
