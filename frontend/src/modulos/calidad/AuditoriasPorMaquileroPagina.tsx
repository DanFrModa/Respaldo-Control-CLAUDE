import { Printer } from 'lucide-react';
import { useState } from 'react';

import { imprimirAuditoria, useHistorialMaquilero } from '@/api/calidad';
import { ETIQUETAS_TIPO_AUDITORIA } from '@/api/esquemas';
import { useProveedores } from '@/api/proveedores';
import type { HistorialMaquileroQuery } from '@/api/tipos';
import { KpiTiles, type Kpi } from '@/components/dominio/KpiTiles';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import { ResultadoBadge } from './ConsultaAuditoriasPagina';

/**
 * HISTORIAL POR MAQUILERO (F6-E3 — re-vestido R9 al kit): elige un maquilero y un rango de fechas → sus
 * auditorías (no canceladas) con el % de APROBACIÓN operativo (aprobadas / calificadas) en KpiTiles y la
 * TABLA DENSA. Con 1 aprobada y 1 reprobada el porcentaje es 50%. `calidad.ver` gobierna la consulta (el
 * backend re-verifica, A1).
 */
export function AuditoriasPorMaquileroPagina(): React.JSX.Element {
  const [idMaquilero, setIdMaquilero] = useState<number | undefined>(undefined);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const proveedores = useProveedores({ pagina: 1, porPagina: 100, ordenarPor: 'nombre' });
  const query: HistorialMaquileroQuery = {
    ...(desde !== '' ? { desde } : {}),
    ...(hasta !== '' ? { hasta } : {}),
  };
  const historial = useHistorialMaquilero(idMaquilero, query);
  const datos = historial.data;

  const kpis: Kpi[] =
    datos === undefined
      ? []
      : [
          {
            clave: 'aprobacion',
            etiqueta: 'Aprobación',
            valor:
              datos.porcentajeAprobacion === null
                ? 'N/D'
                : datos.porcentajeAprobacion.toLocaleString('es-MX'),
            ...(datos.porcentajeAprobacion === null ? {} : { sufijo: '%' }),
            pie: `${datos.aprobadas} de ${datos.total} vivas`,
            ...(datos.porcentajeAprobacion !== null && datos.porcentajeAprobacion >= 90
              ? { tonoPie: 'ok' as const }
              : {}),
          },
          {
            clave: 'total',
            etiqueta: 'Total (vivas)',
            valor: datos.total.toLocaleString('es-MX'),
            pie: 'en el rango elegido',
          },
          {
            clave: 'aprobadas',
            etiqueta: 'Aprobadas',
            valor: datos.aprobadas.toLocaleString('es-MX'),
          },
          {
            clave: 'reprobadas',
            etiqueta: 'Reprobadas / sin calificar',
            valor: `${datos.reprobadas} / ${datos.noCalificadas}`,
            ...(datos.reprobadas > 0
              ? { tonoPie: 'crit' as const, pie: 'requieren reproceso' }
              : {}),
          },
        ];

  return (
    <div className="h-full overflow-y-auto space-y-4 p-4 md:p-5">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Auditorías por maquilero
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Historial y porcentaje de aprobación operativo de un maquilero
          </p>
        </div>
      </header>

      {/* ── Filtros ─────────────────────────────────────────────────────────── */}
      <div className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="hist-maquilero">Maquilero</FieldLabel>
          <SelectNativo
            id="hist-maquilero"
            value={idMaquilero === undefined ? '' : String(idMaquilero)}
            onChange={(e) =>
              setIdMaquilero(e.target.value === '' ? undefined : Number(e.target.value))
            }
            data-testid="historial-maquilero"
          >
            <option value="">Elige un maquilero…</option>
            {(proveedores.data?.datos ?? []).map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.nombre}
              </option>
            ))}
          </SelectNativo>
        </Field>
        <Field>
          <FieldLabel htmlFor="hist-desde">Desde</FieldLabel>
          <Input
            id="hist-desde"
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            data-testid="historial-desde"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="hist-hasta">Hasta</FieldLabel>
          <Input
            id="hist-hasta"
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            data-testid="historial-hasta"
          />
        </Field>
      </div>

      {idMaquilero === undefined ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Selecciona un maquilero para ver su historial.
        </p>
      ) : historial.isPending ? (
        <p className="text-sm text-muted-foreground">Cargando historial…</p>
      ) : historial.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {historial.error.message}
        </p>
      ) : datos !== undefined ? (
        <>
          <KpiTiles kpis={kpis} />

          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
              <h2 className="text-sm font-semibold">Auditorías de {datos.maquilero}</h2>
              <span className="ml-auto text-[12px] text-faint">
                {datos.total.toLocaleString('es-MX')} vivas
              </span>
            </div>
            <div className="overflow-x-auto" data-testid="historial-tabla">
              {datos.auditorias.length === 0 ? (
                <p className="m-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Sin auditorías en el rango elegido.
                </p>
              ) : (
                <TablaDensa>
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead>Auditoría</TablaDensaHead>
                      <TablaDensaHead>Orden</TablaDensaHead>
                      <TablaDensaHead>Fecha</TablaDensaHead>
                      <TablaDensaHead>Tipo</TablaDensaHead>
                      <TablaDensaHead>Resultado</TablaDensaHead>
                      <TablaDensaHead numerica>Fallas</TablaDensaHead>
                      <TablaDensaHead className="text-right">PDF</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {datos.auditorias.map((a) => (
                      <TablaDensaFila key={a.id} data-testid="historial-fila">
                        <TablaDensaCelda className="font-medium">#{a.numAuditoria}</TablaDensaCelda>
                        <TablaDensaCelda className="text-muted-foreground">
                          {a.folioOrden === null ? '—' : `#${a.folioOrden}`}
                        </TablaDensaCelda>
                        <TablaDensaCelda>{a.fechaAuditoria}</TablaDensaCelda>
                        <TablaDensaCelda>
                          {ETIQUETAS_TIPO_AUDITORIA[a.tipoAuditoria]}
                        </TablaDensaCelda>
                        <TablaDensaCelda>
                          <ResultadoBadge resultado={a.resultado} />
                        </TablaDensaCelda>
                        <TablaDensaCelda
                          numerica
                          className={a.totalFallas > 0 ? 'font-semibold text-warn' : ''}
                        >
                          {a.totalFallas.toLocaleString('es-MX')}
                        </TablaDensaCelda>
                        <TablaDensaCelda className="text-right">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => imprimirAuditoria(a.id)}
                            aria-label={`Imprimir auditoría ${a.numAuditoria}`}
                          >
                            <Printer className="size-4" aria-hidden />
                          </Button>
                        </TablaDensaCelda>
                      </TablaDensaFila>
                    ))}
                  </TablaDensaCuerpo>
                </TablaDensa>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
