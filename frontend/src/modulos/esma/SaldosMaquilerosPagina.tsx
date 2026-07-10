import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useSaldosTodos } from '@/api/esma';
import type { EsMaSaldosTodosQuery } from '@/api/tipos';
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

import { moneda } from './comun';

/**
 * SALDOS DE TODOS LOS MAQUILEROS (F6-E5, ex `EsMa_SaldosMaq`): tabla de los maquileros ACTIVOS con
 * saldo ≠ 0, con drill-down al estado de cuenta. Segmentable con/sin factura. RESPONSIVE: tabla en
 * escritorio, tarjetas en móvil. Lectura de cuenta con `esma.ver-pagos`; importes "—" sin
 * `consultas.ver-importes` (aun así el maquilero aparece: el filtro saldo≠0 lo hace el servidor).
 */
export function SaldosMaquilerosPagina(): React.JSX.Element {
  const navigate = useNavigate();
  const [conFactura, setConFactura] = useState<'' | 'con' | 'sin'>('');
  const query: EsMaSaldosTodosQuery = conFactura === '' ? {} : { conFactura };
  const consulta = useSaldosTodos(query);
  const filas = consulta.data?.filas ?? [];

  function verEstadoCuenta(idMaquilero: number): void {
    // navigate() es asíncrono en React Router 7; no necesitamos esperarlo.
    void navigate('/esma/estado-cuenta', { state: { idMaquilero } });
  }

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="saldos-maquileros">
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Saldos de maquileros
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Maquileros activos con saldo distinto de cero. Toca uno para ver su estado de cuenta.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Saldos</CardTitle>
              <CardDescription>
                Σ cargos + abonos − pagos − descuentos, por maquilero.
              </CardDescription>
            </div>
            <Field className="w-44">
              <FieldLabel htmlFor="saldos-segmento">Facturación</FieldLabel>
              <SelectNativo
                id="saldos-segmento"
                value={conFactura}
                onChange={(e) => setConFactura(e.target.value as '' | 'con' | 'sin')}
                data-testid="saldos-segmento"
              >
                <option value="">Todo</option>
                <option value="con">Con factura</option>
                <option value="sin">Sin factura</option>
              </SelectNativo>
            </Field>
          </div>
        </CardHeader>
        <CardContent>
          {consulta.isPending ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : consulta.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {consulta.error.message}
            </p>
          ) : filas.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No hay maquileros con saldo pendiente.
            </p>
          ) : (
            <>
              {consulta.data ? (
                <p className="mb-3 text-sm text-muted-foreground" data-testid="saldos-total">
                  {filas.length} maquilero(s) · saldo total{' '}
                  <strong>{moneda(consulta.data.totalSaldo)}</strong>.
                </p>
              ) : null}

              {/* Móvil: tarjetas. */}
              <div className="space-y-3 md:hidden" data-testid="saldos-tarjetas">
                {filas.map((f) => (
                  <button
                    key={f.idMaquilero}
                    type="button"
                    onClick={() => verEstadoCuenta(f.idMaquilero)}
                    className="block w-full rounded-lg border p-3 text-left"
                    data-testid="saldos-tarjeta"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{f.maquilero}</span>
                      <span className="font-semibold tabular-nums">{moneda(f.saldo)}</span>
                    </div>
                    {f.corto ? <p className="text-xs text-muted-foreground">{f.corto}</p> : null}
                  </button>
                ))}
              </div>

              {/* Escritorio: tabla. */}
              <div className="hidden overflow-x-auto md:block">
                <Table data-testid="saldos-tabla">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Maquilero</TableHead>
                      <TableHead className="text-right">Cargos</TableHead>
                      <TableHead className="text-right">Abonos</TableHead>
                      <TableHead className="text-right">Pagos</TableHead>
                      <TableHead className="text-right">Descuentos</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filas.map((f) => (
                      <TableRow
                        key={f.idMaquilero}
                        className="cursor-pointer"
                        onClick={() => verEstadoCuenta(f.idMaquilero)}
                        data-testid="saldos-fila"
                      >
                        <TableCell className="font-medium">
                          {f.maquilero}
                          {f.corto ? (
                            <span className="ml-1 text-xs text-muted-foreground">({f.corto})</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {moneda(f.totalCargos)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {moneda(f.totalAbonos)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {moneda(f.totalPagos)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {moneda(f.totalDescuentos)}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {moneda(f.saldo)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-3 flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void navigate('/esma/estado-cuenta')}
                  data-testid="saldos-ir-estado-cuenta"
                >
                  Abrir estado de cuenta
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
