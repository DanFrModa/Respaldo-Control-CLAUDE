import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  useFichaOrden,
  useFichasConfiables,
  useVerificarFichaOrden,
} from '@/api/fichas-confiables';
import { useBuscarOrdenes } from '@/api/ordenes-consulta';
import type { FichasConfiablesQuery } from '@/api/tipos';
import { ChipEstado } from '@/components/dominio/ChipEstado';
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
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/lib/useDebounce';

import { porcentaje } from './comun';

/**
 * FICHAS CONFIABLES (F7-E4; doc 05 §A.2; re-vestida R9). Arriba, el checklist por orden: se busca la
 * orden, se marcan los reactivos OK y se guarda (upsert por filas, A6). Abajo, el indicador de % de
 * fichas confiables (KPIs de vistazo + tabla por orden), agregado en el SERVIDOR. Todo bajo
 * `indicadores.ip-confiabilidad`.
 */
export function FichasConfiablesPagina(): React.JSX.Element {
  const [busqueda, setBusqueda] = useState('');
  const [idOrden, setIdOrden] = useState<number | null>(null);
  const q = useDebounce(busqueda, 300);
  const resultados = useBuscarOrdenes(q);

  return (
    <div className="h-full overflow-y-auto" data-testid="fichas-confiables">
      <div className="flex flex-col gap-3 p-4 md:p-5">
        {/* ── Encabezado ─────────────────────────────────────────────────────── */}
        <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="min-w-0 flex-1">
            <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
              Fichas confiables
            </h1>
            <p className="truncate text-[12.5px] text-muted-foreground">
              Verifica la confiabilidad de la ficha técnica por orden
            </p>
          </div>
        </header>

        {/* ── Checklist por orden ─────────────────────────────────────────────── */}
        <div className="rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold">Checklist por orden</h3>
          <p className="text-xs text-muted-foreground">
            Busca una orden por folio, modelo o cliente.
          </p>
          <div className="relative mt-3 max-w-md">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Folio, modelo o cliente…"
              className="h-8 pl-8 text-sm"
              data-testid="fc-buscar"
              aria-label="Buscar orden"
            />
          </div>
          {q.length > 0 && (resultados.data?.datos.length ?? 0) > 0 && (
            <div className="mt-3 flex flex-wrap gap-2" data-testid="fc-resultados">
              {resultados.data?.datos.map((o) => (
                <Button
                  key={o.id}
                  type="button"
                  variant={idOrden === o.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setIdOrden(o.id)}
                >
                  #{o.folio} · {o.codigoModelo} · {o.cliente}
                </Button>
              ))}
            </div>
          )}
          {idOrden !== null && <ChecklistOrden idOrden={idOrden} />}
        </div>

        <IndicadorConfiables alSeleccionar={setIdOrden} />
      </div>
    </div>
  );
}

/** Checklist editable de una orden. */
function ChecklistOrden({ idOrden }: { idOrden: number }): React.JSX.Element {
  const consulta = useFichaOrden(idOrden);
  const guardar = useVerificarFichaOrden();
  const [estado, setEstado] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (consulta.data) {
      const inicial: Record<number, boolean> = {};
      for (const item of consulta.data.items) inicial[item.idReactivo] = item.hecho;
      setEstado(inicial);
    }
  }, [consulta.data]);

  if (consulta.isPending)
    return <p className="mt-3 text-sm text-muted-foreground">Cargando checklist…</p>;
  if (consulta.isError)
    return (
      <p className="mt-3 text-sm text-destructive" role="alert">
        {consulta.error.message}
      </p>
    );
  const ficha = consulta.data;
  if (ficha === undefined) return <></>;

  return (
    <div className="mt-4 rounded-lg border p-4" data-testid="fc-checklist">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          Orden #{ficha.folio} · {ficha.codigoModelo ?? '—'}
        </p>
        <ChipEstado tono={ficha.porcentaje === 1 ? 'ok' : 'warn'}>
          {ficha.hechos}/{ficha.totalReactivos} · {porcentaje(ficha.porcentaje)}
        </ChipEstado>
      </div>
      <ul className="space-y-2">
        {ficha.items.map((item) => (
          <li key={item.idReactivo} className="flex items-center gap-2">
            <input
              id={`fc-r-${item.idReactivo}`}
              type="checkbox"
              className="size-4"
              checked={estado[item.idReactivo] ?? false}
              onChange={(e) =>
                setEstado((prev) => ({ ...prev, [item.idReactivo]: e.target.checked }))
              }
              data-testid={`fc-reactivo-${item.idReactivo}`}
            />
            <label htmlFor={`fc-r-${item.idReactivo}`}>{item.etiqueta}</label>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <Button
          type="button"
          disabled={guardar.isPending}
          data-testid="fc-guardar"
          onClick={() =>
            guardar.mutate(
              {
                idOrden,
                cuerpo: {
                  items: ficha.items.map((i) => ({
                    idReactivo: i.idReactivo,
                    hecho: estado[i.idReactivo] ?? false,
                  })),
                },
              },
              {
                onSuccess: () => toast.success('Checklist guardado.'),
                onError: (err) => toast.error(err.message),
              },
            )
          }
        >
          Guardar checklist
        </Button>
      </div>
    </div>
  );
}

/** Indicador agregado de % de fichas confiables. */
function IndicadorConfiables({
  alSeleccionar,
}: {
  alSeleccionar: (idOrden: number) => void;
}): React.JSX.Element {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const query: FichasConfiablesQuery = {
    ...(desde === '' ? {} : { desde }),
    ...(hasta === '' ? {} : { hasta }),
  };
  const consulta = useFichasConfiables(query);
  const datos = consulta.data;

  const kpis: Kpi[] = datos
    ? [
        {
          clave: 'evaluadas',
          etiqueta: 'Órdenes evaluadas',
          valor: datos.global.ordenesEvaluadas.toLocaleString('es-MX'),
        },
        {
          clave: 'confiables',
          etiqueta: 'Confiables (100%)',
          valor: datos.global.ordenesConfiables.toLocaleString('es-MX'),
        },
        {
          clave: 'reactivos',
          etiqueta: 'Reactivos OK',
          valor: `${datos.global.reactivosOk}/${datos.global.reactivosTotales}`,
        },
        {
          clave: 'porcentaje',
          etiqueta: '% confiable',
          valor: porcentaje(datos.global.porcentaje),
          ...((datos.global.porcentaje ?? 0) >= 0.9 ? { tonoPie: 'ok' as const } : {}),
        },
      ]
    : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">% de fichas confiables</h3>
        <span className="text-xs text-muted-foreground">
          Reactivos OK ÷ reactivos evaluados (global y por orden)
        </span>
        <div className="ml-auto flex items-center gap-2">
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
        </div>
      </div>

      {consulta.isPending ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : datos === undefined ? null : (
        <>
          <KpiTiles kpis={kpis} />
          <div className="overflow-hidden rounded-xl border bg-card">
            {datos.datos.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Sin órdenes evaluadas.</p>
            ) : (
              <div className="overflow-x-auto">
                <TablaDensa>
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead>Folio</TablaDensaHead>
                      <TablaDensaHead>Modelo</TablaDensaHead>
                      <TablaDensaHead>Cliente</TablaDensaHead>
                      <TablaDensaHead numerica>OK</TablaDensaHead>
                      <TablaDensaHead numerica>%</TablaDensaHead>
                      <TablaDensaHead>Confiable</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {datos.datos.map((o) => (
                      <TablaDensaFila
                        key={o.idOrden}
                        className="cursor-pointer"
                        onClick={() => alSeleccionar(o.idOrden)}
                        data-testid={`fc-orden-${o.idOrden}`}
                      >
                        <TablaDensaCelda className="font-medium">#{o.folio}</TablaDensaCelda>
                        <TablaDensaCelda>{o.codigoModelo}</TablaDensaCelda>
                        <TablaDensaCelda className="text-muted-foreground">
                          {o.cliente}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica>
                          {o.hechos}/{o.totalReactivos}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica>{porcentaje(o.porcentaje)}</TablaDensaCelda>
                        <TablaDensaCelda>
                          {o.confiable ? (
                            <ChipEstado tono="ok">Sí</ChipEstado>
                          ) : (
                            <ChipEstado tono="neutro">No</ChipEstado>
                          )}
                        </TablaDensaCelda>
                      </TablaDensaFila>
                    ))}
                  </TablaDensaCuerpo>
                </TablaDensa>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
