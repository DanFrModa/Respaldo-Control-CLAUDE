import { BarChart3 } from 'lucide-react';
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
      className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-5"
      data-testid="tablero-productividad"
    >
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
        >
          <BarChart3 className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Productividad vs estándar</h1>
          <p className="truncate text-xs text-muted-foreground">
            Índices agregados por periodo, actividad y persona
          </p>
        </div>
      </header>

      {/* ── Card: filtros + tabla ───────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
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
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {filas.length.toLocaleString('es-MX')} periodos
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {consulta.isError ? (
            <p className="p-6 text-sm text-destructive" role="alert">
              {consulta.error.message}
            </p>
          ) : consulta.isPending ? (
            <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
          ) : filas.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Sin registros en el periodo.</p>
          ) : (
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
                    <TablaDensaCelda numerica>{porcentaje(f.porcentajeTrabajado)}</TablaDensaCelda>
                    <TablaDensaCelda numerica>{numero(f.estandar)}</TablaDensaCelda>
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          )}
        </div>
      </div>
    </div>
  );
}
