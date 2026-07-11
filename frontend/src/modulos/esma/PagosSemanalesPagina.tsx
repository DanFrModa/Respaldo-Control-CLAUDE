import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { usePagosSemanales } from '@/api/esma';
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

import { finSemana, inicioSemana, moneda } from './comun';

/** Desplaza un `YYYY-MM-DD` en `dias` días (UTC). */
function desplazar(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * PAGOS SEMANALES (F6-E5, ex `EsMa_PagosSem`): los pagos de la semana con navegación semana
 * actual/anterior/siguiente y el total del periodo. Lectura de cuenta con `esma.ver-pagos`; importes
 * "—" sin `consultas.ver-importes`.
 */
export function PagosSemanalesPagina(): React.JSX.Element {
  const [semana, setSemana] = useState(() => inicioSemana(new Date()));
  const desde = semana;
  const hasta = finSemana(semana);
  const consulta = usePagosSemanales({ desde, hasta });
  const filas = consulta.data?.filas ?? [];

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="pagos-semanales">
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Pagos semanales
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Los pagos a maquileros de la semana, con su total.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Semana</CardTitle>
              <CardDescription data-testid="pagsem-rango">
                {desde} a {hasta}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSemana((s) => desplazar(s, -7))}
                data-testid="pagsem-anterior"
              >
                <ChevronLeft aria-hidden /> Anterior
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSemana(inicioSemana(new Date()))}
                data-testid="pagsem-actual"
              >
                Semana actual
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSemana((s) => desplazar(s, 7))}
                data-testid="pagsem-siguiente"
              >
                Siguiente <ChevronRight aria-hidden />
              </Button>
            </div>
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
              No hubo pagos en esta semana.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted-foreground" data-testid="pagsem-total">
                {filas.length} pago(s) · total{' '}
                <strong>{moneda(consulta.data?.total ?? null)}</strong>.
              </p>
              <div className="overflow-x-auto">
                <TablaDensa>
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead>Fecha</TablaDensaHead>
                      <TablaDensaHead>Maquilero</TablaDensaHead>
                      <TablaDensaHead>Facturación</TablaDensaHead>
                      <TablaDensaHead numerica>Cargos</TablaDensaHead>
                      <TablaDensaHead>Revisión</TablaDensaHead>
                      <TablaDensaHead numerica>Importe</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {filas.map((p) => (
                      <TablaDensaFila key={p.id} data-testid="pagsem-fila">
                        <TablaDensaCelda>{p.fecha}</TablaDensaCelda>
                        <TablaDensaCelda className="font-medium">{p.maquilero}</TablaDensaCelda>
                        <TablaDensaCelda>
                          {p.conFactura === null ? '—' : p.conFactura ? 'Con' : 'Sin'}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica>{p.numAplicaciones}</TablaDensaCelda>
                        <TablaDensaCelda>
                          {p.estadoRevision === 'revisado' ? 'Revisado' : 'Capturado'}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica>{moneda(p.monto)}</TablaDensaCelda>
                      </TablaDensaFila>
                    ))}
                  </TablaDensaCuerpo>
                </TablaDensa>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
