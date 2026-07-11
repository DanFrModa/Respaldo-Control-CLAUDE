import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { usePreCosto } from '@/api/costos';
import { useModelos } from '@/api/modelos';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDebounce } from '@/lib/useDebounce';

import { moneda } from './comun';

/**
 * PRE-COSTO por modelo (F7-E1; doc 06-Costos-y-EDR §2): busca un modelo y muestra su costo estimado —
 * la receta (telas/avíos/bordados) valuada a precios de catálogo + la maquila base + el precio de
 * venta sugerido. Accesible también desde Modelos (mismo dato). `precostos.consultar`; los importes
 * salen en "—" sin `consultas.ver-importes`. La regalía va sobre la venta (lista de precios), no aquí.
 */
export function PreCostoPagina(): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const idParam = params.get('idModelo');
  const idModelo = idParam !== null && /^\d+$/.test(idParam) ? Number(idParam) : null;

  const [busqueda, setBusqueda] = useState('');
  const debounced = useDebounce(busqueda, 300);
  const modelos = useModelos({ busqueda: debounced, porPagina: 8 });
  const pre = usePreCosto(idModelo);

  function elegir(id: number): void {
    setParams({ idModelo: String(id) });
    setBusqueda('');
  }

  return (
    <div className="h-full overflow-y-auto space-y-6 p-4 md:p-6" data-testid="pre-costo">
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Pre-costo por modelo
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Costo estimado del modelo (receta × precios de catálogo + maquila) y precio sugerido.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Elige un modelo</CardTitle>
          <CardDescription>Busca por código o descripción.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field className="max-w-md">
            <FieldLabel htmlFor="pre-costo-buscar">Modelo</FieldLabel>
            <Input
              id="pre-costo-buscar"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Código o descripción…"
              data-testid="pre-costo-buscar"
            />
          </Field>
          {debounced.length > 0 && (modelos.data?.datos.length ?? 0) > 0 && (
            <ul className="max-w-md divide-y rounded-md border">
              {modelos.data?.datos.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => elegir(m.id)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                    data-testid={`pre-costo-opcion-${m.id}`}
                  >
                    <span className="font-medium">{m.codigo}</span>
                    <span className="text-muted-foreground">{m.descripcion ?? ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {idModelo !== null && (
        <>
          {pre.isPending ? (
            <p className="text-sm text-muted-foreground">Cargando pre-costo…</p>
          ) : pre.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {pre.error.message}
            </p>
          ) : pre.data ? (
            <Card data-testid="pre-costo-detalle">
              <CardHeader>
                <CardTitle>
                  {pre.data.codigo}
                  {pre.data.descripcion ? ` — ${pre.data.descripcion}` : ''}
                </CardTitle>
                <CardDescription>
                  Costo estimado {moneda(pre.data.costoTotal)} · Precio sugerido{' '}
                  <span className="font-semibold text-foreground">
                    {moneda(pre.data.precioSugerido)}
                  </span>
                  {pre.data.utilidadSugerida !== null && pre.data.regaliasBase !== null
                    ? ` (utilidad ${pre.data.utilidadSugerida}% + regalías ${pre.data.regaliasBase}% sobre la venta, redondeo al alza)`
                    : ''}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Telas</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tela</TableHead>
                        <TableHead className="text-right">Consumo</TableHead>
                        <TableHead className="text-right">Precio</TableHead>
                        <TableHead className="text-right">Importe</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pre.data.telas.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-muted-foreground">
                            Sin telas en la receta.
                          </TableCell>
                        </TableRow>
                      ) : (
                        pre.data.telas.map((t) => (
                          <TableRow key={t.idTela}>
                            <TableCell>{t.tela}</TableCell>
                            <TableCell className="text-right">{t.consumoPorPrenda}</TableCell>
                            <TableCell className="text-right">{moneda(t.precioUnitario)}</TableCell>
                            <TableCell className="text-right">{moneda(t.importe)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                  <p className="mt-1 text-right text-sm font-medium">
                    Total telas: {moneda(pre.data.totalTela)}
                  </p>
                </section>

                <section>
                  <h3 className="mb-2 text-sm font-semibold">Avíos</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Avío</TableHead>
                        <TableHead className="text-right">Consumo</TableHead>
                        <TableHead className="text-right">Precio</TableHead>
                        <TableHead className="text-right">Importe</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pre.data.avios.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-muted-foreground">
                            Sin avíos en la receta.
                          </TableCell>
                        </TableRow>
                      ) : (
                        pre.data.avios.map((a) => (
                          <TableRow key={a.idAvio}>
                            <TableCell>
                              {a.clave} — {a.descripcion}
                            </TableCell>
                            <TableCell className="text-right">{a.consumoPorPrenda}</TableCell>
                            <TableCell className="text-right">{moneda(a.precioUnitario)}</TableCell>
                            <TableCell className="text-right">{moneda(a.importe)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                  <p className="mt-1 text-right text-sm font-medium">
                    Total avíos: {moneda(pre.data.totalAvios)}
                  </p>
                </section>

                <section>
                  <h3 className="mb-2 text-sm font-semibold">Bordados / estampados</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bordado</TableHead>
                        <TableHead className="text-right">Precio</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pre.data.bordados.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={2} className="text-muted-foreground">
                            Sin bordados.
                          </TableCell>
                        </TableRow>
                      ) : (
                        pre.data.bordados.map((b) => (
                          <TableRow key={b.idBordado}>
                            <TableCell>{b.bordado}</TableCell>
                            <TableCell className="text-right">{moneda(b.precio)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                  <p className="mt-1 text-right text-sm font-medium">
                    Total bordado: {moneda(pre.data.totalBordado)} · Maquila:{' '}
                    {moneda(pre.data.maquila)}
                  </p>
                </section>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
