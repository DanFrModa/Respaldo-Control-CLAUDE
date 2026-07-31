import { Download, Printer, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import {
  descargarExcelKpisRc,
  imprimirKpisRc,
  useKpisRc,
  useRefrescarKpis,
} from '@/api/indicadores';
import type { KpisRcQuery } from '@/api/tipos';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import { MESES, dias, entero, etiquetaMes, porcentaje, selloDatosAl } from './comun';
import { BadgeHistorico } from './piezas';

/**
 * TABLERO de KPIs de RUTA CRÍTICA (F7-E3, D11; proto `vIndicadores` — re-vestido R9): % de entregas a
 * tiempo (último proceso), lead time por proceso, cuellos de botella, desempeño por responsable y
 * tendencia mensual del % a tiempo. page-head (periodo + refrescar/PDF/Excel) + tarjeta HÉROE del %
 * a tiempo + TABLAS DENSAS. Los números se calculan en segundo plano (vistas materializadas); el sello
 * "datos al:" indica su frescura y Refrescar encola el recálculo. Solo lectura (`indicadores.ver`).
 */
export function TableroRcPagina(): React.JSX.Element {
  const [anio, setAnio] = useState('');
  const [mes, setMes] = useState('');

  const query: KpisRcQuery = {
    ...(anio === '' ? {} : { anio: Number(anio) }),
    ...(mes === '' ? {} : { mes: Number(mes) }),
  };
  const consulta = useKpisRc(query);
  const refrescar = useRefrescarKpis();
  const datos = consulta.data;

  return (
    <div className="h-full overflow-y-auto" data-testid="tablero-rc">
      <div className="flex flex-col gap-3 p-4 md:p-5">
        {/* ── Encabezado ─────────────────────────────────────────────────────── */}
        <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="min-w-0 flex-1">
            <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
              KPIs de Ruta Crítica
            </h1>
            <p className="truncate text-[12.5px] text-muted-foreground" data-testid="rc-datos-al">
              {selloDatosAl(datos?.datosAl)}
            </p>
          </div>
          <Input
            type="number"
            className="h-8 w-24 text-sm"
            value={anio}
            onChange={(e) => setAnio(e.target.value)}
            placeholder="Año"
            aria-label="Año"
            data-testid="rc-anio"
          />
          <SelectNativo
            className="h-8 w-auto text-sm"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            aria-label="Mes"
            data-testid="rc-mes"
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
            data-testid="rc-refrescar"
          >
            <RefreshCw aria-hidden />
            Refrescar
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => imprimirKpisRc(query)}
            data-testid="rc-pdf"
          >
            <Printer aria-hidden />
            PDF
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => descargarExcelKpisRc(query)}
            data-testid="rc-excel"
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
            {/* ── Héroe: % de entregas a tiempo ─────────────────────────────── */}
            <div className="rounded-xl border bg-card p-4" data-testid="rc-entregas">
              <h3 className="text-sm font-semibold">Entregas a tiempo</h3>
              <p className="text-xs text-muted-foreground">
                % sobre órdenes MEDIBLES: último proceso cumplido en o antes de su fecha planeada.
              </p>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <span className="num text-4xl font-bold text-primary" data-testid="rc-pct">
                  {porcentaje(datos.entregasATiempo.porcentaje)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {entero(datos.entregasATiempo.aTiempo)} a tiempo de{' '}
                  {entero(datos.entregasATiempo.medibles)} medibles
                </span>
              </div>
              {datos.entregasATiempo.completadasSinPlan > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground" data-testid="rc-sin-plan">
                  {entero(datos.entregasATiempo.completadasSinPlan)} completada(s) sin plan — no
                  medibles, fuera del %
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {/* Lead time por proceso */}
              <TarjetaTabla
                titulo="Lead time por proceso"
                subtitulo="Días reales promedio vs. estimado."
                historico
                vacio={datos.leadTime.length === 0}
              >
                <TablaDensa>
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead>Proceso</TablaDensaHead>
                      <TablaDensaHead numerica>n</TablaDensaHead>
                      <TablaDensaHead numerica>Real</TablaDensaHead>
                      <TablaDensaHead numerica>Estimado</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {datos.leadTime.map((l) => (
                      <TablaDensaFila key={l.idProcesoDef}>
                        <TablaDensaCelda>{l.nombreProceso}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{l.numProcesos}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{dias(l.diasRealesProm)}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{dias(l.diasEstimadoProm)}</TablaDensaCelda>
                      </TablaDensaFila>
                    ))}
                  </TablaDensaCuerpo>
                </TablaDensa>
              </TarjetaTabla>

              {/* Cuellos de botella */}
              <TarjetaTabla
                titulo="Cuellos de botella"
                subtitulo="Atraso medio (días) por proceso, mayor primero."
                historico
                vacio={datos.cuellosBotella.length === 0}
              >
                <TablaDensa>
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead>Proceso</TablaDensaHead>
                      <TablaDensaHead numerica>n</TablaDensaHead>
                      <TablaDensaHead numerica>Atraso medio</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {datos.cuellosBotella.map((c) => (
                      <TablaDensaFila key={c.idProcesoDef}>
                        <TablaDensaCelda>{c.nombreProceso}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{c.numProcesos}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{dias(c.atrasoMedioDias)}</TablaDensaCelda>
                      </TablaDensaFila>
                    ))}
                  </TablaDensaCuerpo>
                </TablaDensa>
              </TarjetaTabla>

              {/* Desempeño por responsable */}
              <TarjetaTabla
                titulo="Desempeño por responsable"
                subtitulo="Quién capturó el cumplimiento y su % a tiempo."
                historico
                vacio={datos.desempeno.length === 0}
              >
                <TablaDensa>
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead>Responsable</TablaDensaHead>
                      <TablaDensaHead numerica>Procesos</TablaDensaHead>
                      <TablaDensaHead numerica>A tiempo</TablaDensaHead>
                      <TablaDensaHead numerica>%</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {datos.desempeno.map((d) => (
                      <TablaDensaFila key={d.responsableId}>
                        <TablaDensaCelda>{d.responsable}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{d.numProcesos}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{d.aTiempo}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{porcentaje(d.porcentaje)}</TablaDensaCelda>
                      </TablaDensaFila>
                    ))}
                  </TablaDensaCuerpo>
                </TablaDensa>
              </TarjetaTabla>

              {/* Tendencia mensual (sin badge histórico: sí filtra por periodo) */}
              <TarjetaTabla
                titulo="Tendencia mensual del % a tiempo"
                subtitulo="Ciclo de cumplimiento por mes."
                vacio={datos.tendencia.length === 0}
              >
                <TablaDensa>
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead>Mes</TablaDensaHead>
                      <TablaDensaHead numerica>Completadas</TablaDensaHead>
                      <TablaDensaHead numerica>A tiempo</TablaDensaHead>
                      <TablaDensaHead numerica>%</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {datos.tendencia.map((t) => (
                      <TablaDensaFila key={`${t.anio}-${t.mes}`}>
                        <TablaDensaCelda>{etiquetaMes(t.mes, t.anio)}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{t.completadas}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{t.aTiempo}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{porcentaje(t.porcentaje)}</TablaDensaCelda>
                      </TablaDensaFila>
                    ))}
                  </TablaDensaCuerpo>
                </TablaDensa>
              </TarjetaTabla>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Tarjeta contenedora de una tabla del tablero (título + subtítulo + badge histórico opcional). */
function TarjetaTabla({
  titulo,
  subtitulo,
  historico = false,
  vacio,
  children,
}: {
  titulo: string;
  subtitulo: string;
  historico?: boolean;
  vacio: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="border-b px-3 py-2">
        <h3 className="text-sm font-semibold">{titulo}</h3>
        <p className="text-xs text-muted-foreground">{subtitulo}</p>
        {historico ? <BadgeHistorico /> : null}
      </div>
      {vacio ? (
        <p className="p-4 text-sm text-muted-foreground">Sin datos.</p>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </div>
  );
}
