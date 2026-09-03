import { useState } from 'react';

import { useSaldoMaquilero } from '@/api/esma';
import type { EsMaSaldoQuery } from '@/api/tipos';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { SelectNativo } from '@/components/ui/native-select';

import { hayPendienteDeRevision, moneda, partidas } from './comun';

/** Segmento de facturación del saldo: todo junto, solo con factura o solo sin factura. */
type Segmento = '' | 'con' | 'sin';

/**
 * Tarjeta de apoyo con el SALDO DERIVADO de un maquilero (Σcargos + Σabonos − Σpagos − Σdescuentos),
 * segmentable con/sin factura. Es LECTURA DE CUENTA (`esma.ver-pagos`); quien la monta ya validó ese
 * permiso. Los importes se muestran como "—" si el backend los oculta (sin `consultas.ver-importes`).
 *
 * Al saldo sólo entra lo REVISADO. Cuando queda algo capturado sin revisar, la tarjeta lo dice
 * debajo: el saldo sigue mandando y el pendiente lo acompaña, para que nadie vea un número más chico
 * sin entender por qué (V1, fila 0.115). Si los importes están ocultos, el aviso sigue apareciendo
 * con el CONTEO de partidas: saber que algo espera decisión no es ver dinero.
 */
export function SaldoMaquilero({ idMaquilero }: { idMaquilero: number }): React.JSX.Element {
  const [segmento, setSegmento] = useState<Segmento>('');
  const query: EsMaSaldoQuery = segmento === '' ? {} : { conFactura: segmento };
  const consulta = useSaldoMaquilero(idMaquilero, query);
  const saldo = consulta.data;

  return (
    <Card data-testid="saldo-maquilero">
      <CardHeader>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle>Saldo del maquilero</CardTitle>
            <CardDescription>Σ cargos + abonos − pagos − descuentos.</CardDescription>
          </div>
          <Field className="w-44">
            <FieldLabel htmlFor="saldo-segmento">Facturación</FieldLabel>
            <SelectNativo
              id="saldo-segmento"
              value={segmento}
              onChange={(e) => setSegmento(e.target.value as Segmento)}
              data-testid="saldo-segmento"
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
          <p className="text-sm text-muted-foreground">Cargando saldo…</p>
        ) : consulta.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {consulta.error.message}
          </p>
        ) : saldo ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Metrica etiqueta="Cargos" valor={moneda(saldo.totalCargos)} />
              <Metrica etiqueta="Abonos" valor={moneda(saldo.totalAbonos)} />
              <Metrica etiqueta="Pagos" valor={moneda(saldo.totalPagos)} />
              <Metrica etiqueta="Descuentos" valor={moneda(saldo.totalDescuentos)} />
              <Metrica etiqueta="Saldo" valor={moneda(saldo.saldo)} destacado />
            </div>
            {hayPendienteDeRevision(saldo.pendienteRevision) ? (
              <p className="mt-3 text-[12.5px] text-muted-foreground" data-testid="saldo-pendiente">
                {saldo.pendienteRevision.neto === null ? (
                  <>
                    Hay <strong>{partidas(saldo.pendienteRevision.partidas)}</strong> esperando
                    revisión, que <b>no</b> entran al saldo.
                  </>
                ) : (
                  <>
                    Además hay <strong>{moneda(saldo.pendienteRevision.neto)}</strong> pendiente de
                    revisión en {partidas(saldo.pendienteRevision.partidas)}, que <b>no</b> entra al
                    saldo: abonos {moneda(saldo.pendienteRevision.abonos)} · pagos{' '}
                    {moneda(saldo.pendienteRevision.pagos)} · descuentos{' '}
                    {moneda(saldo.pendienteRevision.descuentos)}. Se suma en cuanto se revise cada
                    partida.
                  </>
                )}
              </p>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Una métrica del saldo (etiqueta + valor). */
function Metrica({
  etiqueta,
  valor,
  destacado = false,
}: {
  etiqueta: string;
  valor: string;
  destacado?: boolean;
}): React.JSX.Element {
  return (
    <div
      className="rounded-lg border bg-card px-3.5 py-3"
      data-testid={`saldo-${etiqueta.toLowerCase()}`}
    >
      <span className="text-xs font-semibold tracking-[0.04em] text-muted-foreground uppercase">
        {etiqueta}
      </span>
      <p
        className={`num mt-1 ${destacado ? 'text-xl font-bold text-primary' : 'text-lg font-semibold'}`}
      >
        {valor}
      </p>
    </div>
  );
}
