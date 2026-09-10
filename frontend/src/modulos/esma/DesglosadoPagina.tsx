import { FileSpreadsheet, Printer } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';

import { descargarExcelEstadoCuenta, imprimirEstadoCuenta, useDesglosado } from '@/api/esma';
import type { EsMaEstadoCuentaQuery } from '@/api/tipos';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import { SaldoMaquilero } from './SaldoMaquilero';
import { SelectorMaquilero, type TipoMaquilero } from './SelectorMaquilero';
import { moneda } from './comun';

/**
 * ESTADO DE CUENTA DESGLOSADO (F6-E5, ex `EsMa_EdoDesglosado`): el detalle por orden/modelo/cantidad/
 * precio/importe del maquilero, exportable a Excel (botón `ParaCopiar` del viejo) y descargable como
 * PDF (impreso del estado de cuenta, R9). Debajo de los cargos, si las hubo, las PRENDAS
 * INCOMPLETAS que entregó (V1-E8k, §Post-F9.136): informativas, sin importe, fuera del saldo. Lectura de cuenta con `esma.ver-pagos`; importes "—" sin
 * `consultas.ver-importes`.
 */
export function DesglosadoPagina(): React.JSX.Element {
  const location = useLocation();
  const inicio = (location.state ?? null) as { idMaquilero?: number; tipo?: TipoMaquilero } | null;

  const [tipo, setTipo] = useState<TipoMaquilero>(inicio?.tipo ?? '');
  const [idMaquilero, setIdMaquilero] = useState(
    inicio?.idMaquilero !== undefined ? String(inicio.idMaquilero) : '',
  );
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [conFactura, setConFactura] = useState<'' | 'con' | 'sin'>('');

  const idNum = idMaquilero === '' ? undefined : Number(idMaquilero);
  const filtro: EsMaEstadoCuentaQuery = {
    ...(desde !== '' ? { desde } : {}),
    ...(hasta !== '' ? { hasta } : {}),
    ...(conFactura !== '' ? { conFactura } : {}),
  };
  const consulta = useDesglosado(idNum, filtro);
  const datos = consulta.data;

  return (
    <div className="h-full overflow-y-auto space-y-6 p-4 md:p-6" data-testid="desglosado-esma">
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Estado de cuenta desglosado
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            El detalle por orden/modelo, exportable a Excel y como PDF del estado de cuenta.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Maquilero y periodo</CardTitle>
          <CardDescription>Elige el maquilero y (opcional) el rango de fechas.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <SelectorMaquilero
              tipo={tipo}
              onCambioTipo={(t) => {
                setTipo(t);
                setIdMaquilero('');
              }}
              idMaquilero={idMaquilero}
              onCambioMaquilero={setIdMaquilero}
              idPrefijo="desg"
            />
            <Field>
              <FieldLabel htmlFor="desg-desde">Desde</FieldLabel>
              <Input
                id="desg-desde"
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                data-testid="desg-desde"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="desg-hasta">Hasta</FieldLabel>
              <Input
                id="desg-hasta"
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                data-testid="desg-hasta"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="desg-factura">Facturación</FieldLabel>
              <SelectNativo
                id="desg-factura"
                value={conFactura}
                onChange={(e) => setConFactura(e.target.value as '' | 'con' | 'sin')}
                data-testid="desg-factura"
              >
                <option value="">Todo</option>
                <option value="con">Con factura</option>
                <option value="sin">Sin factura</option>
              </SelectNativo>
            </Field>
          </div>
        </CardContent>
      </Card>

      {idNum === undefined ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Elige un maquilero para ver el desglosado.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => descargarExcelEstadoCuenta(idNum, filtro)}
              data-testid="desg-excel"
            >
              <FileSpreadsheet aria-hidden /> Exportar a Excel
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => imprimirEstadoCuenta(idNum, filtro)}
              data-testid="desg-pdf"
            >
              <Printer aria-hidden /> Descargar PDF
            </Button>
          </div>

          <SaldoMaquilero idMaquilero={idNum} />

          <Card>
            <CardHeader>
              <CardTitle>Cargos (maquila)</CardTitle>
              <CardDescription>
                Detalle por orden / modelo / cantidad / precio / importe.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {consulta.isPending ? (
                <p className="text-sm text-muted-foreground">Cargando…</p>
              ) : consulta.isError ? (
                <p className="text-sm text-destructive" role="alert">
                  {consulta.error.message}
                </p>
              ) : (datos?.cargos.length ?? 0) === 0 ? (
                <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Sin cargos en el periodo.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <TablaDensa data-testid="desg-tabla">
                    <TablaDensaEncabezado>
                      <TablaDensaFila>
                        <TablaDensaHead>Fecha</TablaDensaHead>
                        <TablaDensaHead>Orden</TablaDensaHead>
                        <TablaDensaHead>Modelo</TablaDensaHead>
                        <TablaDensaHead>Proceso</TablaDensaHead>
                        <TablaDensaHead numerica>Cantidad</TablaDensaHead>
                        <TablaDensaHead numerica>Precio</TablaDensaHead>
                        <TablaDensaHead numerica>Importe</TablaDensaHead>
                      </TablaDensaFila>
                    </TablaDensaEncabezado>
                    <TablaDensaCuerpo>
                      {(datos?.cargos ?? []).map((c) => (
                        <TablaDensaFila key={c.idCargo} data-testid="desg-fila">
                          <TablaDensaCelda>{c.fecha}</TablaDensaCelda>
                          <TablaDensaCelda>#{c.folioOrden}</TablaDensaCelda>
                          <TablaDensaCelda>
                            {c.descripcionModelo
                              ? `${c.codigoModelo} — ${c.descripcionModelo}`
                              : c.codigoModelo}
                          </TablaDensaCelda>
                          <TablaDensaCelda>
                            {c.tipoProceso}
                            {c.sinCosto ? (
                              <span className="ml-1 text-xs text-muted-foreground">
                                (sin costo)
                              </span>
                            ) : null}
                          </TablaDensaCelda>
                          <TablaDensaCelda numerica>
                            {c.cantidad === null ? '—' : c.cantidad.toLocaleString('es-MX')}
                          </TablaDensaCelda>
                          <TablaDensaCelda numerica>{moneda(c.precio)}</TablaDensaCelda>
                          <TablaDensaCelda numerica>
                            {c.sinCosto ? moneda(0) : moneda(c.importe)}
                          </TablaDensaCelda>
                        </TablaDensaFila>
                      ))}
                    </TablaDensaCuerpo>
                  </TablaDensa>
                </div>
              )}
            </CardContent>
          </Card>

          {/* PRENDAS INCOMPLETAS (V1-E8k, §Post-F9.136): FUERA de los cargos, sin importe. Es el
              mismo bloque que trae el PDF y la hoja del Excel — sale de la misma consulta. */}
          {(datos?.incompletas.filas.length ?? 0) > 0 ? (
            <Card data-testid="desg-incompletas">
              <CardHeader>
                <CardTitle>Prendas incompletas entregadas</CardTitle>
                <CardDescription>
                  Prendas que llegaron sin terminar de coser. Se entregaron, pero <b>no se pagan</b>{' '}
                  ni entran a inventario: <b>no afectan el saldo</b>.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <TablaDensa data-testid="desg-incompletas-tabla">
                    <TablaDensaEncabezado>
                      <TablaDensaFila>
                        <TablaDensaHead>Fecha</TablaDensaHead>
                        <TablaDensaHead>Recibo</TablaDensaHead>
                        <TablaDensaHead>Orden</TablaDensaHead>
                        <TablaDensaHead>Modelo</TablaDensaHead>
                        <TablaDensaHead>Proceso</TablaDensaHead>
                        <TablaDensaHead numerica>Piezas</TablaDensaHead>
                      </TablaDensaFila>
                    </TablaDensaEncabezado>
                    <TablaDensaCuerpo>
                      {(datos?.incompletas.filas ?? []).map((f) => (
                        <TablaDensaFila key={f.idRecibo} data-testid="desg-incompletas-fila">
                          <TablaDensaCelda>{f.fecha}</TablaDensaCelda>
                          <TablaDensaCelda>#{f.folioRecibo}</TablaDensaCelda>
                          <TablaDensaCelda>#{f.folioOrden}</TablaDensaCelda>
                          <TablaDensaCelda>
                            {f.descripcionModelo
                              ? `${f.codigoModelo} — ${f.descripcionModelo}`
                              : f.codigoModelo}
                          </TablaDensaCelda>
                          <TablaDensaCelda>{f.tipoProceso}</TablaDensaCelda>
                          <TablaDensaCelda numerica>
                            {f.piezas.toLocaleString('es-MX')}
                          </TablaDensaCelda>
                        </TablaDensaFila>
                      ))}
                    </TablaDensaCuerpo>
                  </TablaDensa>
                </div>
                <p className="mt-3 text-sm font-medium" data-testid="desg-incompletas-total">
                  Total de prendas incompletas:{' '}
                  {(datos?.incompletas.totalPiezas ?? 0).toLocaleString('es-MX')}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
