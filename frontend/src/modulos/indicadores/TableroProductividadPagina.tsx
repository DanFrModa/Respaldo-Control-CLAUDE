import { useState } from 'react';

import { useTableroProductividad } from '@/api/productividad';
import type { TableroProductividadQuery } from '@/api/tipos';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import { numero, porcentaje } from './comun';

type Area = 'ip' | 'almacen';
type Agrupacion = 'dia' | 'semana' | 'mes';

/**
 * TABLERO de productividad vs estándar (F7-E4; doc 05 §A.1/§B.1; proto `vIndicadores` — re-vestido R9).
 * Agrega en el SERVIDOR los registros diarios reales por periodo (día/semana ISO/mes) × actividad ×
 * persona — la variante limpia (Σ + promedio), no las heurísticas /5 y /30 del viejo. page-head (área/
 * agrupación/fechas) + TABLA DENSA. Solo lectura; el permiso lo re-verifica el backend.
 */
export function TableroProductividadPagina(): React.JSX.Element {
  const [area, setArea] = useState<Area>('ip');
  const [agrupacion, setAgrupacion] = useState<Agrupacion>('semana');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const query: TableroProductividadQuery = {
    area,
    agrupacion,
    ...(desde === '' ? {} : { desde }),
    ...(hasta === '' ? {} : { hasta }),
  };
  const consulta = useTableroProductividad(query);
  const filas = consulta.data?.filas ?? [];
  const etiquetaEstandar = area === 'ip' ? 'Peso (%D)' : 'Pz/pers/día';

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:p-5 lg:overflow-visible"
      data-testid="tablero-productividad"
    >
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Productividad vs estándar
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Índices agregados por periodo, actividad y persona
          </p>
        </div>
      </header>

      {/* ── Card: filtros + tabla ───────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border bg-card lg:min-h-0 lg:flex-1 lg:shrink">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <SelectNativo
            className="h-8 w-auto text-sm"
            value={area}
            onChange={(e) => setArea(e.target.value as Area)}
            aria-label="Área"
            data-testid="tp-area"
          >
            <option value="ip">Ingeniería del Producto</option>
            <option value="almacen">Almacén</option>
          </SelectNativo>
          <SelectNativo
            className="h-8 w-auto text-sm"
            value={agrupacion}
            onChange={(e) => setAgrupacion(e.target.value as Agrupacion)}
            aria-label="Agrupación"
            data-testid="tp-agrupacion"
          >
            <option value="dia">Día</option>
            <option value="semana">Semana</option>
            <option value="mes">Mes</option>
          </SelectNativo>
          <Input
            type="date"
            className="h-8 w-auto text-sm"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            aria-label="Desde"
          />
          <Input
            type="date"
            className="h-8 w-auto text-sm"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            aria-label="Hasta"
          />
          <div className="ml-auto">
            <span className="text-[12px] text-faint">
              {filas.length.toLocaleString('es-MX')} periodos
            </span>
          </div>
        </div>

        <div className="overflow-auto lg:min-h-0 lg:flex-1">
          {consulta.isError ? (
            <p className="p-6 text-sm text-destructive" role="alert">
              {consulta.error.message}
            </p>
          ) : consulta.isPending ? (
            <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
          ) : filas.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Sin registros en el periodo.</p>
          ) : (
            <>
              {/* Móvil (<lg): tarjetas compactas — la tabla de 10 columnas deja el ÍNDICE (la métrica
                  que da nombre a la pantalla) fuera de la vista en teléfono. */}
              <div className="space-y-2 p-3 lg:hidden" data-testid="tp-tarjetas">
                {filas.map((f, i) => (
                  <div
                    key={`${f.periodo}-${f.idActividad}-${f.idPersona ?? 0}-${i}`}
                    className="rounded-lg border bg-card p-3"
                    data-testid="tp-fila-tarjeta"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="num text-[11px] font-medium text-faint">{f.periodo}</div>
                        <div className="truncate font-medium">{f.actividad}</div>
                        {area === 'ip' ? (
                          <div className="truncate text-xs text-muted-foreground">
                            {f.persona ?? '—'}
                          </div>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="num text-lg leading-tight font-bold">
                          {numero(f.indiceTotal)}
                        </div>
                        <div className="text-[10.5px] text-faint uppercase">índice</div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
                      <span>
                        Prom <b className="num text-foreground">{numero(f.indicePromedio)}</b>
                      </span>
                      <span>
                        % trab{' '}
                        <b className="num text-foreground">{porcentaje(f.porcentajeTrabajado)}</b>
                      </span>
                      <span>
                        {etiquetaEstandar}{' '}
                        <b className="num text-foreground">{numero(f.estandar)}</b>
                      </span>
                      <span>
                        Cant <b className="num text-foreground">{numero(f.cantidad)}</b>
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Escritorio (≥lg): tabla densa intacta. */}
              <div className="hidden lg:block">
                <TablaDensa>
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead>Periodo</TablaDensaHead>
                      <TablaDensaHead>Actividad</TablaDensaHead>
                      {area === 'ip' && <TablaDensaHead>Persona</TablaDensaHead>}
                      <TablaDensaHead numerica>Reg.</TablaDensaHead>
                      <TablaDensaHead numerica>Cantidad</TablaDensaHead>
                      <TablaDensaHead numerica>Horas</TablaDensaHead>
                      <TablaDensaHead numerica>Índice total</TablaDensaHead>
                      <TablaDensaHead numerica>Índice prom.</TablaDensaHead>
                      <TablaDensaHead numerica>% trab.</TablaDensaHead>
                      <TablaDensaHead numerica>{etiquetaEstandar}</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {filas.map((f, i) => (
                      <TablaDensaFila
                        key={`${f.periodo}-${f.idActividad}-${f.idPersona ?? 0}-${i}`}
                        data-testid="tp-fila"
                      >
                        <TablaDensaCelda>{f.periodo}</TablaDensaCelda>
                        <TablaDensaCelda>{f.actividad}</TablaDensaCelda>
                        {area === 'ip' && <TablaDensaCelda>{f.persona ?? '—'}</TablaDensaCelda>}
                        <TablaDensaCelda numerica>{f.numRegistros}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{numero(f.cantidad)}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{numero(f.horasTrabajadas)}</TablaDensaCelda>
                        <TablaDensaCelda numerica className="font-medium">
                          {numero(f.indiceTotal)}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica>{numero(f.indicePromedio)}</TablaDensaCelda>
                        <TablaDensaCelda numerica>
                          {porcentaje(f.porcentajeTrabajado)}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica>{numero(f.estandar)}</TablaDensaCelda>
                      </TablaDensaFila>
                    ))}
                  </TablaDensaCuerpo>
                </TablaDensa>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
