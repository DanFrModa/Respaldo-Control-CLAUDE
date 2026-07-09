import { ScanLine } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useExactitudCiclico, useGenerarAjusteCiclico } from '@/api/inventario-ciclico';
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

/**
 * EXACTITUD + generación del AJUSTE de un inventario cíclico (F7-E5; doc 05 §Almacén; re-vestida R9).
 * page-head + KPIs de vistazo (totales del SERVIDOR) + TABLA DENSA con teórico/real/exactitud
 * (=real−teórico) por artículo; aplica el ajuste como MOVIMIENTO de kardex (D3). Permiso
 * `indicadores.ciclicos-consulta` (el backend re-verifica, A1).
 */
export function ExactitudCiclicoPagina(): React.JSX.Element {
  const { id: idParam } = useParams<{ id: string }>();
  const id = Number(idParam);
  const consulta = useExactitudCiclico(Number.isNaN(id) ? null : id);
  const generar = useGenerarAjusteCiclico();
  const [confirmando, setConfirmando] = useState(false);

  const datos = consulta.data;
  const puedeAjustar = datos?.estado === 'contado';

  function ajustar(): void {
    generar.mutate(id, {
      onSuccess: () => {
        toast.success('Ajuste generado como movimiento de kardex.');
        setConfirmando(false);
      },
      onError: (err) => {
        toast.error(err.message);
        setConfirmando(false);
      },
    });
  }

  const kpis: Kpi[] = datos
    ? [
        {
          clave: 'total',
          etiqueta: 'Artículos',
          valor: datos.totales.total.toLocaleString('es-MX'),
        },
        {
          clave: 'contados',
          etiqueta: 'Contados',
          valor: datos.totales.contados.toLocaleString('es-MX'),
        },
        {
          clave: 'exactos',
          etiqueta: 'Exactos',
          valor: datos.totales.exactos.toLocaleString('es-MX'),
        },
        {
          clave: 'diferencias',
          etiqueta: 'Diferencias',
          valor: datos.totales.diferencias.toLocaleString('es-MX'),
          ...(datos.totales.diferencias > 0 ? { tonoPie: 'crit' as const } : {}),
        },
        {
          clave: 'teorico',
          etiqueta: 'Teórico',
          valor: datos.totales.teorico.toLocaleString('es-MX'),
        },
        {
          clave: 'real',
          etiqueta: 'Real (contado)',
          valor: datos.totales.real.toLocaleString('es-MX'),
        },
      ]
    : [];

  return (
    <div className="h-full overflow-y-auto" data-testid="ciclico-exactitud">
      <div className="flex flex-col gap-3 p-4 md:p-5">
        {/* ── Encabezado ─────────────────────────────────────────────────────── */}
        <header className="flex shrink-0 flex-wrap items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
          >
            <ScanLine className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">
              Exactitud{datos ? ` · Cíclico #${datos.folio}` : ''}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {datos ? `Almacén: ${datos.almacen} · ${datos.fecha}` : 'Teórico vs. real.'}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/indicadores/ciclicos">Volver</Link>
          </Button>
        </header>

        {consulta.isPending ? (
          <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
        ) : consulta.isError || datos === undefined ? (
          <p className="p-6 text-sm text-destructive" role="alert">
            {consulta.error?.message ?? 'No se pudo cargar el inventario.'}
          </p>
        ) : (
          <>
            {/* ── KPIs ──────────────────────────────────────────────────────── */}
            <KpiTiles kpis={kpis} className="shrink-0" />

            {/* ── Renglones ─────────────────────────────────────────────────── */}
            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  Renglones <EstadoBadge estado={datos.estado} />
                </h3>
                {puedeAjustar &&
                  (confirmando ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        ¿Aplicar el ajuste al kardex?
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        onClick={ajustar}
                        disabled={generar.isPending}
                        data-testid="ex-confirmar-ajuste"
                      >
                        Sí, generar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmando(false)}
                      >
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setConfirmando(true)}
                      data-testid="ex-generar-ajuste"
                    >
                      Generar ajuste
                    </Button>
                  ))}
                {datos.estado === 'abierto' && (
                  <span className="text-sm text-muted-foreground">
                    Faltan renglones por contar.
                  </span>
                )}
                {datos.estado === 'cerrado' && (
                  <span className="text-sm text-muted-foreground">
                    Ajuste ya aplicado al kardex.
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <TablaDensa>
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead>Modelo</TablaDensaHead>
                      <TablaDensaHead>Color</TablaDensaHead>
                      <TablaDensaHead>Talla</TablaDensaHead>
                      <TablaDensaHead>Orden</TablaDensaHead>
                      <TablaDensaHead numerica>Teórico</TablaDensaHead>
                      <TablaDensaHead numerica>Real</TablaDensaHead>
                      <TablaDensaHead numerica>Exactitud</TablaDensaHead>
                      <TablaDensaHead numerica>Ajuste</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {datos.renglones.map((r) => (
                      <TablaDensaFila key={r.idDet} data-testid={`ex-fila-${r.idDet}`}>
                        <TablaDensaCelda className="font-medium">{r.modelo}</TablaDensaCelda>
                        <TablaDensaCelda>{r.color}</TablaDensaCelda>
                        <TablaDensaCelda>{r.etiquetaTalla}</TablaDensaCelda>
                        <TablaDensaCelda>
                          {r.folioOrden === null ? '—' : `#${r.folioOrden}`}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica>{r.cantTeorica}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{r.cantReal ?? '—'}</TablaDensaCelda>
                        <TablaDensaCelda numerica>
                          <Exactitud valor={r.exactitud} />
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica className="text-muted-foreground">
                          {r.folioMovimientoAjuste === null ? '—' : `#${r.folioMovimientoAjuste}`}
                        </TablaDensaCelda>
                      </TablaDensaFila>
                    ))}
                  </TablaDensaCuerpo>
                </TablaDensa>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Exactitud({ valor }: { valor: number | null }): React.JSX.Element {
  if (valor === null) return <span className="text-muted-foreground">—</span>;
  if (valor === 0) return <span>0</span>;
  return (
    <span className={valor > 0 ? 'font-medium text-ok' : 'font-medium text-crit'}>
      {valor > 0 ? `+${valor}` : valor}
    </span>
  );
}

function EstadoBadge({ estado }: { estado: string }): React.JSX.Element {
  if (estado === 'cancelado') return <ChipEstado tono="crit">Cancelado</ChipEstado>;
  if (estado === 'cerrado') return <ChipEstado tono="ok">Cerrado (ajustado)</ChipEstado>;
  if (estado === 'contado') return <ChipEstado tono="warn">Contado</ChipEstado>;
  return <ChipEstado tono="neutro">Abierto</ChipEstado>;
}
