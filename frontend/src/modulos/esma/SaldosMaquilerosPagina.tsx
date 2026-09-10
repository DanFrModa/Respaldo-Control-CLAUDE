import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useSaldosTodos } from '@/api/esma';
import type { EsMaSaldosTodosQuery } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { SelectNativo } from '@/components/ui/native-select';

import { hayPendienteDeRevision, moneda, textoCargosPorValidar, textoPorRevisar } from './comun';

/**
 * SALDOS DE TODOS LOS MAQUILEROS (F6-E5, ex `EsMa_SaldosMaq`): tabla de los maquileros ACTIVOS con
 * saldo ≠ 0 —o con algo pendiente de revisión—, con drill-down al estado de cuenta. Segmentable
 * con/sin factura. RESPONSIVE: tabla en escritorio, tarjetas en móvil. Lectura de cuenta con
 * `esma.ver-pagos`; importes "—" sin `consultas.ver-importes` (aun así el maquilero aparece: el
 * corte lo hace el servidor con los importes reales).
 *
 * La columna «Por revisar» es lo capturado que TODAVÍA no entra al saldo (V1, fila 0.115): sin ella,
 * un maquilero con movimientos sin revisar se vería en ceros sin explicación — y con el corte viejo
 * (`saldo ≠ 0`) ni siquiera aparecería. Lleva SIEMPRE el conteo de partidas junto al importe
 * (`textoPorRevisar`, compartido con CxP): con los importes ocultos el neto se va en «—», y dos
 * partidas que netean cero se leerían como «$0.00» — en los dos casos parecería que no hay nada.
 *
 * ⭐ Y desde la fila 0.111 ese «por revisar» incluye los CARGOS SIN VALIDAR (los `propuesto`), que
 * antes no se contaban en ningún lado: un maquilero con diez cargos esperando decisión y nada más
 * tenía saldo 0, pendiente 0 y NO SALÍA en esta pantalla — justo lo que Daniel entra a revisar cada
 * semana, y sin pantalla nueva (*«no quiero otra pantalla para ver los pendientes»*). Como el
 * número de la columna creció, debajo va su desglose (`textoCargosPorValidar`): cuántos cargos,
 * cuánto suman y cuántos no se pueden valuar por falta de precio.
 *
 * Se dice «cargos» y no «recibos» porque desde la 0.114 el CORTE y el EMPAQUE proponen el suyo sin
 * generar recibo alguno (ver `textoCargosPorValidar` en `comun.ts`).
 */
export function SaldosMaquilerosPagina(): React.JSX.Element {
  const navigate = useNavigate();
  const [conFactura, setConFactura] = useState<'' | 'con' | 'sin'>('');
  const query: EsMaSaldosTodosQuery = conFactura === '' ? {} : { conFactura };
  const consulta = useSaldosTodos(query);
  const filas = consulta.data?.filas ?? [];
  // El aviso del total sale si CUALQUIER fila trae algo por revisar (el neto de todas puede dar 0
  // sin que eso signifique que no hay nada esperando decisión).
  const hayTotalPendiente = filas.some((f) => hayPendienteDeRevision(f.pendienteRevision));

  function verEstadoCuenta(idMaquilero: number): void {
    // navigate() es asíncrono en React Router 7; no necesitamos esperarlo.
    void navigate('/esma/estado-cuenta', { state: { idMaquilero } });
  }

  return (
    <div className="h-full overflow-y-auto space-y-6 p-4 md:p-6" data-testid="saldos-maquileros">
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Saldos de maquileros
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Maquileros activos con saldo distinto de cero —o con partidas por revisar—. Toca uno
            para ver su estado de cuenta.
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
              No hay maquileros con saldo ni partidas por revisar.
            </p>
          ) : (
            <>
              {consulta.data ? (
                <p className="mb-3 text-sm text-muted-foreground" data-testid="saldos-total">
                  {filas.length} maquilero(s) · saldo total{' '}
                  <strong>{moneda(consulta.data.totalSaldo)}</strong>
                  {hayTotalPendiente ? (
                    <>
                      {' '}
                      · por revisar <strong>{moneda(consulta.data.totalPendienteNeto)}</strong> (no
                      suma al saldo)
                      {consulta.data.totalCargosPorValidar > 0 ? (
                        <>
                          , incluidos{' '}
                          <strong>
                            {consulta.data.totalCargosPorValidar}{' '}
                            {consulta.data.totalCargosPorValidar === 1 ? 'cargo' : 'cargos'}
                          </strong>{' '}
                          por validar
                        </>
                      ) : null}
                    </>
                  ) : null}
                  .
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
                    {f.nombreCorto ? (
                      <p className="text-xs text-muted-foreground">{f.nombreCorto}</p>
                    ) : null}
                    {hayPendienteDeRevision(f.pendienteRevision) ? (
                      <p className="text-xs text-muted-foreground">
                        Por revisar {textoPorRevisar(f.pendienteRevision)} (no suma)
                      </p>
                    ) : null}
                    {textoCargosPorValidar(f.pendienteRevision) === null ? null : (
                      <p
                        className="text-xs text-muted-foreground"
                        data-testid="saldos-tarjeta-cargos"
                      >
                        {textoCargosPorValidar(f.pendienteRevision)}
                      </p>
                    )}
                  </button>
                ))}
              </div>

              {/* Escritorio: tabla. */}
              <div className="hidden md:block">
                <TablaDensa data-testid="saldos-tabla">
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead>Maquilero</TablaDensaHead>
                      <TablaDensaHead numerica>Cargos</TablaDensaHead>
                      <TablaDensaHead numerica>Abonos</TablaDensaHead>
                      <TablaDensaHead numerica>Pagos</TablaDensaHead>
                      <TablaDensaHead numerica>Descuentos</TablaDensaHead>
                      <TablaDensaHead
                        numerica
                        title="Capturado sin revisar + cargos sin validar: no suma al saldo (§Post-F9.188a)"
                      >
                        Por revisar
                      </TablaDensaHead>
                      <TablaDensaHead numerica>Saldo</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {filas.map((f) => (
                      <TablaDensaFila
                        key={f.idMaquilero}
                        className="cursor-pointer"
                        onClick={() => verEstadoCuenta(f.idMaquilero)}
                        data-testid="saldos-fila"
                      >
                        <TablaDensaCelda className="font-medium">
                          {f.maquilero}
                          {f.nombreCorto ? (
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({f.nombreCorto})
                            </span>
                          ) : null}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica>{moneda(f.totalCargos)}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{moneda(f.totalAbonos)}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{moneda(f.totalPagos)}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{moneda(f.totalDescuentos)}</TablaDensaCelda>
                        <TablaDensaCelda numerica className="text-muted-foreground">
                          {hayPendienteDeRevision(f.pendienteRevision)
                            ? textoPorRevisar(f.pendienteRevision)
                            : ''}
                          {/* El desglose de los cargos sin validar va DEBAJO y no en un tooltip: es
                              la mitad nueva del número (fila 0.111) y sólo aparece en las filas que
                              de verdad los tienen, así que no engorda la tabla. */}
                          {textoCargosPorValidar(f.pendienteRevision) === null ? null : (
                            <span
                              className="block text-[11px] leading-tight"
                              data-testid="saldos-cargos-por-validar"
                            >
                              {textoCargosPorValidar(f.pendienteRevision)}
                            </span>
                          )}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica className="font-semibold">
                          {moneda(f.saldo)}
                        </TablaDensaCelda>
                      </TablaDensaFila>
                    ))}
                  </TablaDensaCuerpo>
                </TablaDensa>
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
