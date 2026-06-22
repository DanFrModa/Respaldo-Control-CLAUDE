import { ClipboardList, Printer } from 'lucide-react';
import { useState } from 'react';

import { useEstatusMateriales, imprimirEstatusMateriales } from '@/api/mrp';
import { useConsultaOrdenes } from '@/api/ordenes-consulta';
import type { EstatusMaterialFila } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/lib/useDebounce';

/** Estatus → etiqueta + color del semáforo (R7). */
const SEMAFORO: Record<EstatusMaterialFila['estatus'], { etiqueta: string; clase: string }> = {
  pendiente: { etiqueta: 'Pendiente', clase: 'bg-red-100 text-red-800' },
  'en-oc': { etiqueta: 'En OC', clase: 'bg-amber-100 text-amber-800' },
  'recibido-parcial': { etiqueta: 'Recibido parcial', clase: 'bg-sky-100 text-sky-800' },
  completo: { etiqueta: 'Completo', clase: 'bg-emerald-100 text-emerald-800' },
  'cubierto-por-stock': {
    etiqueta: 'Cubierto por stock',
    clase: 'bg-emerald-100 text-emerald-800',
  },
};

/**
 * TABLERO "qué tengo / qué falta" por orden (F4-E4, R7) — criterio de salida de la fase: reemplaza el
 * drive manual. Se elige una orden y el backend cruza, por material requerido, lo REQUERIDO vs lo que
 * está EN OC vs lo RECIBIDO → semáforo. Las líneas de OC sin requerido salen como "no identificado".
 * Diseñado para leerse bien en MÓVIL (tarjetas) y en escritorio (tabla). Solo presenta (A1).
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

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b p-4 lg:px-6">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground"
        >
          <ClipboardList className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Qué tengo / qué falta</h1>
          <p className="text-sm text-muted-foreground">
            Estatus de materiales por orden: requerido vs en compra vs recibido.
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

            {estatus.data && !estatus.data.tieneSnapshot ? (
              <p
                className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800"
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

                {/* ESCRITORIO: tabla. */}
                <div
                  className="hidden overflow-x-auto rounded-lg border md:block"
                  data-testid="est-tabla"
                >
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Material</th>
                        <th className="px-3 py-2 text-right font-medium">Requerido</th>
                        <th className="px-3 py-2 text-right font-medium">En OC</th>
                        <th className="px-3 py-2 text-right font-medium">Recibido</th>
                        <th className="px-3 py-2 font-medium">Estatus</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filas.map((f, i) => (
                        <tr key={`${f.material}-${i}`} className="border-t" data-testid="est-fila">
                          <td className="px-3 py-2">{f.material}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatearCantidad(f.requerido)}
                            {f.unidad ? ` ${f.unidad}` : ''}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatearCantidad(f.enOc)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatearCantidad(f.recibido)}
                          </td>
                          <td className="px-3 py-2">
                            <SemaforoBadge estatus={f.estatus} tipo={f.tipo} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
      <dd className="font-medium tabular-nums">
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
      <span
        className="shrink-0 rounded px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground"
        data-testid="est-semaforo"
      >
        No identificado
      </span>
    );
  }
  const s = SEMAFORO[estatus];
  return (
    <span
      className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${s.clase}`}
      data-testid="est-semaforo"
    >
      {s.etiqueta}
    </span>
  );
}

/** Cantidad con hasta 4 decimales (formato es-MX). */
function formatearCantidad(valor: number): string {
  return valor.toLocaleString('es-MX', { maximumFractionDigits: 4 });
}
