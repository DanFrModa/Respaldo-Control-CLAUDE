import { Download, Medal, Printer, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import {
  descargarExcelKpisCalidad,
  imprimirKpisCalidad,
  useKpisCalidad,
  useRefrescarKpis,
} from '@/api/indicadores';
import type { KpisCalidadQuery } from '@/api/tipos';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Button } from '@/components/ui/button';
import { SelectNativo } from '@/components/ui/native-select';

import { MESES, entero, etiquetaMes, porcentaje, selloDatosAl } from './comun';
import { BadgeHistorico } from './piezas';

/**
 * TABLERO de CALIDAD por maquilero (F7-E3, F6; proto `vIndicadores` — re-vestido R9): % de aprobación
 * por maquilero, defectos más frecuentes y tendencia mensual de aprobación. page-head (periodo +
 * refrescar/PDF/Excel) + TABLAS DENSAS. Desde las auditorías vivas, calculado en segundo plano. Solo
 * lectura (`indicadores.ver`).
 */
export function TableroCalidadPagina(): React.JSX.Element {
  const [anio, setAnio] = useState('');
  const [mes, setMes] = useState('');

  const query: KpisCalidadQuery = {
    ...(anio === '' ? {} : { anio: Number(anio) }),
    ...(mes === '' ? {} : { mes: Number(mes) }),
  };
  const consulta = useKpisCalidad(query);
  const refrescar = useRefrescarKpis();
  const datos = consulta.data;

  return (
    <div className="h-full overflow-y-auto" data-testid="tablero-calidad">
      <div className="flex flex-col gap-3 p-4 md:p-5">
        {/* ── Encabezado ─────────────────────────────────────────────────────── */}
        <header className="flex shrink-0 flex-wrap items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
          >
            <Medal className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">Calidad por maquilero</h1>
            <p className="truncate text-xs text-muted-foreground" data-testid="cal-datos-al">
              {selloDatosAl(datos?.datosAl)}
            </p>
          </div>
          <SelectNativo
            className="h-8 w-24 text-sm"
            value={anio}
            onChange={(e) => setAnio(e.target.value)}
            aria-label="Año"
            data-testid="cal-anio"
          >
            <option value="">Año</option>
            {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </SelectNativo>
          <SelectNativo
            className="h-8 w-auto text-sm"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            aria-label="Mes"
            data-testid="cal-mes"
          >
            <option value="">Todos</option>
            {MESES.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </SelectNativo>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refrescar.mutate()}
            disabled={refrescar.isPending}
            data-testid="cal-refrescar"
          >
            <RefreshCw aria-hidden />
            Refrescar
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => imprimirKpisCalidad(query)}
            data-testid="cal-pdf"
          >
            <Printer aria-hidden />
            PDF
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => descargarExcelKpisCalidad(query)}
            data-testid="cal-excel"
          >
            <Download aria-hidden />
            Excel
          </Button>
        </header>

        {consulta.isError ? (
          <p className="p-6 text-sm text-destructive" role="alert">
            {consulta.error.message}
          </p>
        ) : consulta.isPending ? (
          <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
        ) : datos === undefined ? null : (
          <>
            {/* Aprobación por maquilero */}
            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="border-b px-3 py-2">
                <h3 className="text-sm font-semibold">Aprobación por maquilero</h3>
                <p className="text-xs text-muted-foreground">
                  % aprobación = aprobadas ÷ auditorías con veredicto.
                </p>
              </div>
              {datos.maquileros.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Sin auditorías registradas.</p>
              ) : (
                <div className="overflow-x-auto">
                  <TablaDensa>
                    <TablaDensaEncabezado>
                      <TablaDensaFila>
                        <TablaDensaHead>Maquilero</TablaDensaHead>
                        <TablaDensaHead numerica>Auditorías</TablaDensaHead>
                        <TablaDensaHead numerica>Aprobadas</TablaDensaHead>
                        <TablaDensaHead numerica>Calificadas</TablaDensaHead>
                        <TablaDensaHead numerica>% aprob.</TablaDensaHead>
                      </TablaDensaFila>
                    </TablaDensaEncabezado>
                    <TablaDensaCuerpo>
                      {datos.maquileros.map((m) => (
                        <TablaDensaFila
                          key={m.idMaquilero}
                          data-testid={`cal-maq-${m.idMaquilero}`}
                        >
                          <TablaDensaCelda>{m.maquilero}</TablaDensaCelda>
                          <TablaDensaCelda numerica>{m.numAuditorias}</TablaDensaCelda>
                          <TablaDensaCelda numerica>{m.aprobadas}</TablaDensaCelda>
                          <TablaDensaCelda numerica>{m.calificadas}</TablaDensaCelda>
                          <TablaDensaCelda numerica>{porcentaje(m.porcentaje)}</TablaDensaCelda>
                        </TablaDensaFila>
                      ))}
                    </TablaDensaCuerpo>
                  </TablaDensa>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {/* Defectos más frecuentes */}
              <div className="overflow-hidden rounded-xl border bg-card">
                <div className="border-b px-3 py-2">
                  <h3 className="text-sm font-semibold">Defectos más frecuentes</h3>
                  <p className="text-xs text-muted-foreground">Suma de fallas contadas (top 10).</p>
                  <BadgeHistorico />
                </div>
                {datos.defectosTop.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">Sin defectos registrados.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <TablaDensa>
                      <TablaDensaEncabezado>
                        <TablaDensaFila>
                          <TablaDensaHead>Clave</TablaDensaHead>
                          <TablaDensaHead>Defecto</TablaDensaHead>
                          <TablaDensaHead numerica>Fallas</TablaDensaHead>
                        </TablaDensaFila>
                      </TablaDensaEncabezado>
                      <TablaDensaCuerpo>
                        {datos.defectosTop.map((d) => (
                          <TablaDensaFila key={d.idDefecto}>
                            <TablaDensaCelda className="font-medium">{d.clave}</TablaDensaCelda>
                            <TablaDensaCelda>{d.descripcion}</TablaDensaCelda>
                            <TablaDensaCelda numerica>{entero(d.totalFallas)}</TablaDensaCelda>
                          </TablaDensaFila>
                        ))}
                      </TablaDensaCuerpo>
                    </TablaDensa>
                  </div>
                )}
              </div>

              {/* Tendencia mensual */}
              <div className="overflow-hidden rounded-xl border bg-card">
                <div className="border-b px-3 py-2">
                  <h3 className="text-sm font-semibold">Tendencia mensual</h3>
                  <p className="text-xs text-muted-foreground">% de aprobación por mes.</p>
                </div>
                {datos.tendencia.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">Sin datos.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <TablaDensa>
                      <TablaDensaEncabezado>
                        <TablaDensaFila>
                          <TablaDensaHead>Mes</TablaDensaHead>
                          <TablaDensaHead numerica>Auditorías</TablaDensaHead>
                          <TablaDensaHead numerica>Aprobadas</TablaDensaHead>
                          <TablaDensaHead numerica>% aprob.</TablaDensaHead>
                        </TablaDensaFila>
                      </TablaDensaEncabezado>
                      <TablaDensaCuerpo>
                        {datos.tendencia.map((t) => (
                          <TablaDensaFila key={`${t.anio}-${t.mes}`}>
                            <TablaDensaCelda>{etiquetaMes(t.mes, t.anio)}</TablaDensaCelda>
                            <TablaDensaCelda numerica>{t.numAuditorias}</TablaDensaCelda>
                            <TablaDensaCelda numerica>{t.aprobadas}</TablaDensaCelda>
                            <TablaDensaCelda numerica>{porcentaje(t.porcentaje)}</TablaDensaCelda>
                          </TablaDensaFila>
                        ))}
                      </TablaDensaCuerpo>
                    </TablaDensa>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
