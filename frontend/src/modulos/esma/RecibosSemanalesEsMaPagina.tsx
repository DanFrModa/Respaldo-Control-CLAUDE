import { useState } from 'react';

import { useRecibosSemanalesEsMa } from '@/api/esma';
import type { EsMaRecibosSemanalesQuery } from '@/api/tipos';
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
import { Input } from '@/components/ui/input';

import { SelectorMaquilero, type TipoMaquilero } from './SelectorMaquilero';
import { moneda } from './comun';

/** Formatea un entero con separadores de miles (es-MX). */
function fmt(n: number): string {
  return n.toLocaleString('es-MX');
}

/**
 * RECIBOS SEMANALES DE MAQUILA (F6-E5, ex `RecibosSemanalesMaq`, menú 3.8): los recibos del periodo por
 * maquilero/modelo, valuados al precio pactado. Filtros: rango de fechas + maquilero (opcional). A
 * diferencia de la consulta de producción, aquí SÍ hay importes (visibles solo con
 * `consultas.ver-importes`). Lectura de cuenta con `esma.ver-pagos`.
 */
export function RecibosSemanalesEsMaPagina(): React.JSX.Element {
  const [tipo, setTipo] = useState<TipoMaquilero>('');
  const [idMaquilero, setIdMaquilero] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const query: EsMaRecibosSemanalesQuery = {
    ...(desde !== '' ? { desde } : {}),
    ...(hasta !== '' ? { hasta } : {}),
    ...(idMaquilero !== '' ? { idMaquilero: Number(idMaquilero) } : {}),
  };
  const consulta = useRecibosSemanalesEsMa(query);
  const filas = consulta.data?.filas ?? [];

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="recibos-semanales-esma">
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Recibos semanales de maquila
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Los recibos del periodo por maquilero y modelo, valuados al precio pactado.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>Acota por maquilero (opcional) y rango de fechas.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SelectorMaquilero
              tipo={tipo}
              onCambioTipo={(t) => {
                setTipo(t);
                setIdMaquilero('');
              }}
              idMaquilero={idMaquilero}
              onCambioMaquilero={setIdMaquilero}
              idPrefijo="recsem"
            />
            <Field>
              <FieldLabel htmlFor="recsem-desde">Desde</FieldLabel>
              <Input
                id="recsem-desde"
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                data-testid="recsem-desde"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="recsem-hasta">Hasta</FieldLabel>
              <Input
                id="recsem-hasta"
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                data-testid="recsem-hasta"
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      {consulta.isPending ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : consulta.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {consulta.error.message}
        </p>
      ) : filas.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No hay recibos que coincidan con el filtro.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="recsem-total">
            {filas.length} recibo(s) · {fmt(consulta.data?.totalCantidad ?? 0)} pzas · importe{' '}
            <strong>{moneda(consulta.data?.totalImporte ?? null)}</strong>.
          </p>
          <div className="overflow-x-auto rounded-md border">
            <TablaDensa data-testid="recsem-tabla">
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Recibo</TablaDensaHead>
                  <TablaDensaHead>Fecha</TablaDensaHead>
                  <TablaDensaHead>Maquilero</TablaDensaHead>
                  <TablaDensaHead>Orden</TablaDensaHead>
                  <TablaDensaHead>Modelo</TablaDensaHead>
                  <TablaDensaHead>Proceso</TablaDensaHead>
                  <TablaDensaHead numerica>Cantidad</TablaDensaHead>
                  <TablaDensaHead numerica>Importe</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filas.map((r) => (
                  <TablaDensaFila key={r.idRecibo} data-testid="recsem-fila">
                    <TablaDensaCelda>#{r.folioRecibo}</TablaDensaCelda>
                    <TablaDensaCelda>{r.fecha}</TablaDensaCelda>
                    <TablaDensaCelda className="font-medium">{r.maquilero}</TablaDensaCelda>
                    <TablaDensaCelda>#{r.folioOrden}</TablaDensaCelda>
                    <TablaDensaCelda>{r.codigoModelo}</TablaDensaCelda>
                    <TablaDensaCelda>{r.tipoProceso}</TablaDensaCelda>
                    <TablaDensaCelda numerica>{fmt(r.cantidad)}</TablaDensaCelda>
                    <TablaDensaCelda numerica>{moneda(r.importe)}</TablaDensaCelda>
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          </div>
        </>
      )}
    </div>
  );
}
