import { Info, Printer } from 'lucide-react';
import { useState } from 'react';

import { useEstatusMateriales, imprimirEstatusMateriales } from '@/api/mrp';
import { useConsultaOrdenes } from '@/api/ordenes-consulta';
import type { EstatusMaterialFila } from '@/api/tipos';
import { ChipEstado, type TonoEstado } from '@/components/dominio/ChipEstado';
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
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/lib/useDebounce';

/** Estatus → etiqueta + tono semántico del semáforo (R7). */
const SEMAFORO: Record<EstatusMaterialFila['estatus'], { etiqueta: string; tono: TonoEstado }> = {
  pendiente: { etiqueta: 'Pendiente', tono: 'crit' },
  'en-oc': { etiqueta: 'En OC', tono: 'warn' },
  'recibido-parcial': { etiqueta: 'Recibido parcial', tono: 'info' },
  completo: { etiqueta: 'Completo', tono: 'ok' },
  'cubierto-por-stock': { etiqueta: 'Cubierto por stock', tono: 'ok' },
};

/**
 * TABLERO "qué tengo / qué falta" por orden (F4-E4, R7 — re-vestido R9): criterio de salida de la fase,
 * reemplaza el drive manual. Se elige una orden y el backend cruza, por material requerido, lo
 * REQUERIDO vs lo que está EN OC vs lo RECIBIDO → semáforo (ChipEstado). Un BANNER de faltantes resume
 * lo pendiente (aclaración Daniel §vCompras). Las líneas de OC sin requerido salen como "no
 * identificado". Se lee bien en MÓVIL (tarjetas) y escritorio (tabla densa). Solo presenta (A1).
 */
export function EstatusMaterialesPagina(): React.JSX.Element {
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [idOrden, setIdOrden] = useState<number | null>(null);

  const ordenes = useConsultaOrdenes({
    pagina: 1,
    porPagina: 20,
    incluirCanceladas: 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  const estatus = useEstatusMateriales(idOrden ?? undefined);
  const filas = estatus.data?.filas ?? [];
  // Faltantes = materiales requeridos aún pendientes (ni en OC ni recibidos).
  const pendientes = filas.filter((f) => f.tipo !== 'no-identificado' && f.estatus === 'pendiente');

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b p-4 lg:px-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Qué tengo / qué falta
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Estatus de materiales por orden: requerido vs en compra vs recibido
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        {/* Paso 1: elegir orden */}
        <div className="max-w-xl space-y-2">
          <label htmlFor="est-buscar-orden" className="text-sm font-medium">
            Orden de producción
          </label>
          <Input
            id="est-buscar-orden"
            type="search"
            placeholder="Buscar por folio, modelo o cliente…"
            value={textoBusqueda}
            onChange={(e) => setTextoBusqueda(e.target.value)}
            data-testid="est-buscar-orden"
          />
          <div className="max-h-48 overflow-y-auto rounded-md border">
            {ordenes.isPending ? (
              <p className="p-3 text-sm text-muted-foreground">Cargando órdenes…</p>
            ) : ordenes.isError ? (
              <p className="p-3 text-sm text-destructive">{ordenes.error.message}</p>
            ) : (ordenes.data?.datos ?? []).length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                No hay órdenes que coincidan con la búsqueda.
              </p>
            ) : (
              <ul data-testid="est-lista-ordenes">
                {(ordenes.data?.datos ?? []).map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => setIdOrden(o.id)}
                      aria-pressed={idOrden === o.id}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                        idOrden === o.id ? 'bg-primary-soft' : ''
                      }`}
                      data-testid="est-orden-opcion"
                    >
                      <span className="font-medium">Orden {o.folio}</span>
                      <span className="truncate text-muted-foreground">
                        {o.codigoModelo} · {o.cliente}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Paso 2: tablero */}
        {idOrden !== null ? (
          <div className="mt-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">
                Materiales{estatus.data ? ` · orden ${estatus.data.folioOrden}` : ''}
              </h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => imprimirEstatusMateriales(idOrden)}
                data-testid="est-imprimir"
              >
                <Printer aria-hidden /> Imprimir
              </Button>
            </div>

            {/* Banner de faltantes (vCompras): resume cuántos materiales requeridos siguen pendientes. */}
            {pendientes.length > 0 ? (
              <div
                className="mb-3 flex items-center gap-2 rounded-md border border-crit/30 bg-crit-soft px-3 py-2 text-xs text-crit"
                data-testid="est-banner-faltantes"
              >
                <Info className="size-4 shrink-0" aria-hidden />
                <span>
                  <b>{pendientes.length}</b> material(es) requeridos aún <b>pendientes</b> (ni en OC
                  ni recibidos) para esta orden.
                </span>
              </div>
            ) : null}

            {estatus.data && !estatus.data.tieneSnapshot ? (
              <p
                className="mb-3 rounded-md border border-warn/30 bg-warn-soft p-2 text-xs text-warn"
                data-testid="est-sin-snapshot"
              >
                Esta orden aún no se ha explosionado: el cruce solo muestra lo que ya esté en
                órdenes de compra. Explosiona la orden para ver el requerido.
              </p>
            ) : null}

            {estatus.isPending ? (
              <div className="space-y-2" data-testid="est-cargando">
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-12 w-full rounded-lg" />
              </div>
            ) : estatus.isError ? (
              <p className="text-sm text-destructive">{estatus.error.message}</p>
            ) : filas.length === 0 ? (
              <p
                className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground"
                data-testid="est-vacio"
              >
                Sin materiales para mostrar.
              </p>
            ) : (
              <>
                {/* MÓVIL: tarjetas (cada material con su semáforo). */}
                <ul className="space-y-2 md:hidden" data-testid="est-tarjetas">
                  {filas.map((f, i) => (
                    <li
                      key={`${f.material}-${i}`}
                      className="rounded-lg border p-3"
                      data-testid="est-fila"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 truncate font-medium">{f.material}</span>
                        <SemaforoBadge estatus={f.estatus} tipo={f.tipo} />
                      </div>
                      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                        <Celda etiqueta="Requerido" valor={f.requerido} unidad={f.unidad} />
                        <Celda etiqueta="En OC" valor={f.enOc} unidad={f.unidad} />
                        <Celda etiqueta="Recibido" valor={f.recibido} unidad={f.unidad} />
                      </dl>
                    </li>
                  ))}
                </ul>

                {/* ESCRITORIO: tabla densa. */}
                <div className="hidden md:block" data-testid="est-tabla">
                  <TablaDensa>
                    <TablaDensaEncabezado>
                      <TablaDensaFila>
                        <TablaDensaHead>Material</TablaDensaHead>
                        <TablaDensaHead numerica>Requerido</TablaDensaHead>
                        <TablaDensaHead numerica>En OC</TablaDensaHead>
                        <TablaDensaHead numerica>Recibido</TablaDensaHead>
                        <TablaDensaHead>Estatus</TablaDensaHead>
                      </TablaDensaFila>
                    </TablaDensaEncabezado>
                    <TablaDensaCuerpo>
                      {filas.map((f, i) => (
                        <TablaDensaFila key={`${f.material}-${i}`} data-testid="est-fila">
                          <TablaDensaCelda className="font-medium">{f.material}</TablaDensaCelda>
                          <TablaDensaCelda numerica>
                            {formatearCantidad(f.requerido)}
                            {f.unidad ? ` ${f.unidad}` : ''}
                          </TablaDensaCelda>
                          <TablaDensaCelda numerica>{formatearCantidad(f.enOc)}</TablaDensaCelda>
                          <TablaDensaCelda numerica>
                            {formatearCantidad(f.recibido)}
                          </TablaDensaCelda>
                          <TablaDensaCelda>
                            <SemaforoBadge estatus={f.estatus} tipo={f.tipo} />
                          </TablaDensaCelda>
                        </TablaDensaFila>
                      ))}
                    </TablaDensaCuerpo>
                  </TablaDensa>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Una celda etiqueta/valor de la tarjeta móvil. */
function Celda({
  etiqueta,
  valor,
  unidad,
}: {
  etiqueta: string;
  valor: number;
  unidad: string | null;
}): React.JSX.Element {
  return (
    <div>
      <dt className="text-muted-foreground">{etiqueta}</dt>
      <dd className="num font-medium">
        {formatearCantidad(valor)}
        {unidad ? ` ${unidad}` : ''}
      </dd>
    </div>
  );
}

/** Badge del semáforo (no-identificado tiene su propia etiqueta neutra). */
function SemaforoBadge({
  estatus,
  tipo,
}: {
  estatus: EstatusMaterialFila['estatus'];
  tipo: EstatusMaterialFila['tipo'];
}): React.JSX.Element {
  if (tipo === 'no-identificado') {
    return (
      <ChipEstado tono="neutro" data-testid="est-semaforo">
        No identificado
      </ChipEstado>
    );
  }
  const s = SEMAFORO[estatus];
  return (
    <ChipEstado tono={s.tono} data-testid="est-semaforo">
      {s.etiqueta}
    </ChipEstado>
  );
}

/** Cantidad con hasta 4 decimales (formato es-MX). */
function formatearCantidad(valor: number): string {
  return valor.toLocaleString('es-MX', { maximumFractionDigits: 4 });
}
