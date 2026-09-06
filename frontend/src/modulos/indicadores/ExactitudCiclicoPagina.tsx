import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useExactitudCiclico, useGenerarAjusteCiclico } from '@/api/inventario-ciclico';
import type { CiclicoArticuloMovido, ExactitudCiclico } from '@/api/tipos';
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
 * EXACTITUD + generación del AJUSTE de un inventario cíclico (F7-E5; tres dimensiones desde la fila
 * 0.099). page-head + KPIs de vistazo (totales del SERVIDOR) + TABLA DENSA con teórico/real/
 * exactitud (= real − teórico) por artículo; aplica el ajuste como MOVIMIENTO de kardex (D3).
 *
 * ⭐ **El AVISO de la decisión 6.** Si el almacén se movió entre el alta de la hoja y el cierre, el
 * servidor responde 200 SIN aplicar nada y con la lista de qué se movió. La pantalla la enseña —lo
 * congelado, lo que hay ahora, lo contado y en cuánto quedará— y deja confirmar: *avisar y dejar
 * decidir, NO bloquear* (§Post-F9.193).
 *
 * Permiso `indicadores.ciclicos-consulta` (el backend re-verifica, A1; en telas y avíos exige además
 * el `.mover` de esa dimensión).
 */
export function ExactitudCiclicoPagina(): React.JSX.Element {
  const { id: idParam } = useParams<{ id: string }>();
  const id = Number(idParam);
  const consulta = useExactitudCiclico(Number.isNaN(id) ? null : id);
  const generar = useGenerarAjusteCiclico();
  const [confirmando, setConfirmando] = useState(false);
  const [movidos, setMovidos] = useState<CiclicoArticuloMovido[] | null>(null);

  const datos = consulta.data;
  const puedeAjustar = datos?.estado === 'contado';

  function ajustar(confirmarMovimiento: boolean): void {
    generar.mutate(
      { id, confirmarMovimiento },
      {
        onSuccess: (resultado) => {
          if (!resultado.aplicado) {
            // NO se escribió nada: el almacén se movió y hay que decidir.
            setMovidos(resultado.aviso?.articulos ?? []);
            setConfirmando(false);
            toast.warning('El almacén se movió desde que se abrió la hoja: revisa el aviso.');
            return;
          }
          setMovidos(null);
          setConfirmando(false);
          toast.success('Ajuste generado como movimiento de kardex.');
        },
        onError: (err) => {
          toast.error(err.message);
          setConfirmando(false);
        },
      },
    );
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
        <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="min-w-0 flex-1">
            <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
              Exactitud{datos ? ` · Cíclico #${datos.folio}` : ''}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {datos
                ? `${etiquetaDimension(datos.dimension)} · Almacén: ${datos.almacen} · ${datos.fecha}`
                : 'Teórico vs. real.'}
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

            {/* ── AVISO: el almacén se movió (decisión 6) ───────────────────── */}
            {movidos !== null && movidos.length > 0 && (
              <AvisoMovimiento
                articulos={movidos}
                aplicando={generar.isPending}
                alAplicar={() => ajustar(true)}
                alDescartar={() => setMovidos(null)}
              />
            )}

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
                        onClick={() => ajustar(false)}
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
                    {datos.totales.total === 0
                      ? 'La hoja está vacía.'
                      : 'Faltan renglones por contar.'}
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
                      <TablaDensaHead>Artículo</TablaDensaHead>
                      <TablaDensaHead>Detalle</TablaDensaHead>
                      <TablaDensaHead>Componente</TablaDensaHead>
                      <TablaDensaHead numerica>Teórico</TablaDensaHead>
                      <TablaDensaHead numerica>Real</TablaDensaHead>
                      <TablaDensaHead numerica>Exactitud</TablaDensaHead>
                      <TablaDensaHead numerica>Ajuste</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {datos.renglones.map((r) => (
                      <TablaDensaFila key={r.idDet} data-testid={`ex-fila-${r.idDet}`}>
                        <TablaDensaCelda className="font-medium">{r.titulo}</TablaDensaCelda>
                        <TablaDensaCelda>{r.subtitulo ?? '—'}</TablaDensaCelda>
                        <TablaDensaCelda className="text-muted-foreground">
                          {r.nombreComplemento === null ? '—' : `cuerpo / ${r.nombreComplemento}`}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica>
                          {cifra(r.cantTeorica, r.unidad)}
                          {r.cantTeoricaComplemento !== null && (
                            <span className="block text-xs text-muted-foreground">
                              {cifra(r.cantTeoricaComplemento, r.unidad)}
                            </span>
                          )}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica>
                          {r.cantReal === null ? '—' : cifra(r.cantReal, r.unidad)}
                          {r.nombreComplemento !== null && (
                            <span className="block text-xs text-muted-foreground">
                              {r.cantRealComplemento === null
                                ? '—'
                                : cifra(r.cantRealComplemento, r.unidad)}
                            </span>
                          )}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica>
                          <Exactitud valor={r.exactitud} />
                          {r.nombreComplemento !== null && (
                            <span className="block text-xs">
                              <Exactitud valor={r.exactitudComplemento} />
                            </span>
                          )}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica className="text-muted-foreground">
                          {r.ajustes.length === 0
                            ? '—'
                            : r.ajustes
                                .map(
                                  (a) =>
                                    `#${String(a.folio)} ${a.direccion === 'entrada' ? '↑' : '↓'}`,
                                )
                                .join(' · ')}
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

/** Cómo se le dice al usuario qué cuenta esta hoja. */
function etiquetaDimension(dimension: ExactitudCiclico['dimension']): string {
  if (dimension === 'TELA') return 'Telas';
  if (dimension === 'AVIO') return 'Avíos';
  return 'Producto terminado';
}

/** Cantidad con su unidad (las telas y los avíos llevan metros o kilos; el PT, piezas). */
function cifra(valor: number, unidad: string | null): string {
  const texto = valor.toLocaleString('es-MX');
  return unidad === null ? texto : `${texto} ${unidad}`;
}

/**
 * AVISO de la decisión 6: qué artículos se movieron entre el alta y el cierre, y en cuánto quedará
 * la existencia si se aplica el ajuste. No bloquea — informa y deja decidir.
 */
function AvisoMovimiento({
  articulos,
  aplicando,
  alAplicar,
  alDescartar,
}: {
  articulos: CiclicoArticuloMovido[];
  aplicando: boolean;
  alAplicar: () => void;
  alDescartar: () => void;
}): React.JSX.Element {
  return (
    <div
      className="overflow-hidden rounded-xl border border-warn/40 bg-warn-soft"
      role="alert"
      data-testid="ex-aviso-movimiento"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-warn/40 px-3 py-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            El almacén se movió mientras la hoja estaba abierta
          </h3>
          <p className="text-[12.5px] text-muted-foreground">
            {articulos.length.toLocaleString('es-MX')} artículo(s) ya no tienen la existencia que se
            congeló al abrir el conteo. No se ha escrito nada todavía.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={alAplicar}
            disabled={aplicando}
            data-testid="ex-aviso-aplicar"
          >
            Aplicar de todos modos
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={alDescartar}>
            No aplicar
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <TablaDensa>
          <TablaDensaEncabezado>
            <TablaDensaFila>
              <TablaDensaHead>Artículo</TablaDensaHead>
              <TablaDensaHead>Componente</TablaDensaHead>
              <TablaDensaHead numerica>Congelado</TablaDensaHead>
              <TablaDensaHead numerica>Ahora</TablaDensaHead>
              <TablaDensaHead numerica>Contado</TablaDensaHead>
              <TablaDensaHead numerica>Ajuste</TablaDensaHead>
              <TablaDensaHead numerica>Quedará en</TablaDensaHead>
            </TablaDensaFila>
          </TablaDensaEncabezado>
          <TablaDensaCuerpo>
            {articulos.map((a) => (
              <TablaDensaFila key={`${String(a.idDet)}-${a.componente}`}>
                <TablaDensaCelda className="font-medium">
                  {a.titulo}
                  {a.subtitulo !== null && (
                    <span className="block text-xs text-muted-foreground">{a.subtitulo}</span>
                  )}
                </TablaDensaCelda>
                <TablaDensaCelda className="text-muted-foreground">{a.componente}</TablaDensaCelda>
                <TablaDensaCelda numerica>{a.cantTeorica.toLocaleString('es-MX')}</TablaDensaCelda>
                <TablaDensaCelda numerica>
                  {a.existenciaActual.toLocaleString('es-MX')}
                </TablaDensaCelda>
                <TablaDensaCelda numerica>
                  {a.cantReal === null ? '—' : a.cantReal.toLocaleString('es-MX')}
                </TablaDensaCelda>
                <TablaDensaCelda numerica>
                  <Exactitud valor={a.ajuste} />
                </TablaDensaCelda>
                <TablaDensaCelda numerica className="font-medium">
                  {a.existenciaResultante.toLocaleString('es-MX')}
                </TablaDensaCelda>
              </TablaDensaFila>
            ))}
          </TablaDensaCuerpo>
        </TablaDensa>
      </div>
    </div>
  );
}

function Exactitud({ valor }: { valor: number | null }): React.JSX.Element {
  if (valor === null) return <span className="text-muted-foreground">—</span>;
  if (valor === 0) return <span>0</span>;
  return (
    <span className={valor > 0 ? 'font-medium text-ok' : 'font-medium text-crit'}>
      {valor > 0 ? `+${valor.toLocaleString('es-MX')}` : valor.toLocaleString('es-MX')}
    </span>
  );
}

function EstadoBadge({ estado }: { estado: string }): React.JSX.Element {
  if (estado === 'cancelado') return <ChipEstado tono="crit">Cancelado</ChipEstado>;
  if (estado === 'cerrado') return <ChipEstado tono="ok">Cerrado (ajustado)</ChipEstado>;
  if (estado === 'contado') return <ChipEstado tono="warn">Contado</ChipEstado>;
  return <ChipEstado tono="neutro">Abierto</ChipEstado>;
}
