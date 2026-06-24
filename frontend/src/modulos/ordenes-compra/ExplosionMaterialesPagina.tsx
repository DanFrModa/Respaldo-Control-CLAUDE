import { Calculator, Printer, ShoppingCart } from 'lucide-react';
import { useState } from 'react';

import { useExplosion, useGenerarOc, imprimirExplosion } from '@/api/mrp';
import { useConsultaOrdenes } from '@/api/ordenes-consulta';
import type { Requerimiento } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { formatearMoneda } from '@/lib/formato';
import { useDebounce } from '@/lib/useDebounce';

/**
 * EXPLOSIÓN DE MATERIALES por orden (F4-E4, R3): se elige una orden de producción y el backend
 * explosiona su BOM contra la matriz color×talla → qué/cuánto comprar, AGRUPADO por proveedor
 * sugerido (R1), con el neteo de genéricos visible (decisión d) y las DIFERENCIAS contra el snapshot
 * previo marcadas. Desde aquí se generan las OC (una por proveedor) con selección múltiple en un clic.
 * Solo presenta: el cálculo, el neteo, el snapshot y la generación los hace el SERVIDOR (A1).
 */
export function ExplosionMaterialesPagina(): React.JSX.Element {
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [idOrden, setIdOrden] = useState<number | null>(null);
  // Selección de renglones a comprar; vacío = todo lo pendiente con proveedor.
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());

  const ordenes = useConsultaOrdenes({
    pagina: 1,
    porPagina: 20,
    incluirCanceladas: 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  const explosion = useExplosion(idOrden ?? undefined);
  const generar = useGenerarOc();

  function elegirOrden(id: number): void {
    setIdOrden(id);
    setSeleccion(new Set());
    generar.reset();
  }

  function alternar(id: number): void {
    setSeleccion((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) {
        siguiente.delete(id);
      } else {
        siguiente.add(id);
      }
      return siguiente;
    });
  }

  function generarOc(): void {
    if (idOrden === null) {
      return;
    }
    generar.mutate(
      { idOrden, cuerpo: { idsRequerimiento: [...seleccion] } },
      { onSuccess: () => setSeleccion(new Set()) },
    );
  }

  const datos = explosion.data;
  // Renglones COMPRABLES (con proveedor sugerido y cantidad a comprar > 0).
  const comprables = (datos?.grupos ?? [])
    .flatMap((g) => g.renglones)
    .filter((r) => r.idProveedorSugerido !== null && r.cantidadAComprar > 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b p-4 lg:px-6">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground"
        >
          <Calculator className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Explosión de materiales</h1>
          <p className="text-sm text-muted-foreground">
            Qué y cuánto comprar para una orden, agrupado por proveedor.
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
        {/* Paso 1: elegir orden */}
        <div className="max-w-xl space-y-2">
          <label htmlFor="exp-buscar-orden" className="text-sm font-medium">
            Orden de producción
          </label>
          <Input
            id="exp-buscar-orden"
            type="search"
            placeholder="Buscar por folio, modelo o cliente…"
            value={textoBusqueda}
            onChange={(e) => setTextoBusqueda(e.target.value)}
            data-testid="exp-buscar-orden"
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
              <ul data-testid="exp-lista-ordenes">
                {(ordenes.data?.datos ?? []).map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => elegirOrden(o.id)}
                      aria-pressed={idOrden === o.id}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted ${
                        idOrden === o.id ? 'bg-primary-soft' : ''
                      }`}
                      data-testid="exp-orden-opcion"
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

        {/* Paso 2: explosión */}
        {idOrden !== null ? (
          <div className="mt-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ShoppingCart className="size-4" aria-hidden />
                Materiales requeridos
                {datos ? ` · orden ${datos.folioOrden} · ${datos.totalPiezas} pzas` : ''}
              </h2>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => imprimirExplosion(idOrden)}
                  data-testid="exp-imprimir"
                >
                  <Printer aria-hidden /> Imprimir
                </Button>
                <Button
                  size="sm"
                  onClick={generarOc}
                  disabled={generar.isPending || comprables.length === 0}
                  data-testid="exp-generar-oc"
                >
                  Generar OC desde la explosión
                </Button>
              </div>
            </div>

            {datos?.huboCambios ? (
              <p
                className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800"
                data-testid="exp-aviso-cambios"
              >
                El BOM cambió desde la última explosión: los renglones afectados están marcados.
              </p>
            ) : null}

            {generar.isError ? (
              <p className="mb-3 text-sm text-destructive" data-testid="exp-error-generar">
                {generar.error.message}
              </p>
            ) : null}
            {generar.isSuccess ? (
              <p
                className="mb-3 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-800"
                data-testid="exp-ok-generar"
              >
                Se generaron {generar.data.ordenesCompra.length} orden(es) de compra:{' '}
                {generar.data.ordenesCompra
                  .map((oc) => `OC ${oc.numCompra} (${oc.proveedor})`)
                  .join(', ')}
                .
              </p>
            ) : null}

            {explosion.isPending ? (
              <div className="space-y-2" data-testid="exp-cargando">
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-16 w-full rounded-lg" />
              </div>
            ) : explosion.isError ? (
              <p className="text-sm text-destructive">{explosion.error.message}</p>
            ) : (datos?.grupos ?? []).length === 0 ? (
              <p
                className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground"
                data-testid="exp-vacio"
              >
                Esta orden no requiere materiales (BOM vacío o sin piezas capturadas).
              </p>
            ) : (
              <div className="space-y-5" data-testid="exp-grupos">
                {(datos?.grupos ?? []).map((grupo) => (
                  <div
                    key={grupo.idProveedor ?? 'sin-proveedor'}
                    className="rounded-lg border"
                    data-testid="exp-grupo"
                  >
                    <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
                      <span className="font-medium">{grupo.proveedor}</span>
                      <span className="text-xs text-muted-foreground">
                        {grupo.renglones.length} material(es)
                      </span>
                    </div>
                    <ul>
                      {grupo.renglones.map((r) => (
                        <RenglonRequerimiento
                          key={r.id}
                          renglon={r}
                          seleccionado={seleccion.has(r.id)}
                          onToggle={() => alternar(r.id)}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Un renglón de material requerido (con su neteo, diff y casilla de selección). */
function RenglonRequerimiento({
  renglon,
  seleccionado,
  onToggle,
}: {
  renglon: Requerimiento;
  seleccionado: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const comprable = renglon.idProveedorSugerido !== null && renglon.cantidadAComprar > 0;
  return (
    <li
      className="flex flex-wrap items-start gap-3 border-t px-3 py-2 first:border-t-0"
      data-testid="exp-renglon"
    >
      <input
        type="checkbox"
        className="mt-1 size-4 shrink-0"
        checked={seleccionado}
        onChange={onToggle}
        disabled={!comprable}
        aria-label={`Seleccionar ${renglon.material}`}
        data-testid="exp-renglon-check"
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          <span className="truncate">{renglon.material}</span>
          <DiffBadge diff={renglon.diff} />
          <GenericoBadge renglon={renglon} />
        </p>
        <p className="text-xs text-muted-foreground">
          Requerido {formatearCantidad(renglon.cantidadRequerida)}
          {renglon.unidad ? ` ${renglon.unidad}` : ''}
          {renglon.esGenerico ? ` · en stock ${formatearCantidad(renglon.existenciaStock)}` : ''}
        </p>
      </div>
      <div className="text-right">
        <p className="font-medium tabular-nums" data-testid="exp-renglon-comprar">
          {formatearCantidad(renglon.cantidadAComprar)}
          {renglon.unidad ? ` ${renglon.unidad}` : ''}
        </p>
        <p className="text-xs text-muted-foreground">
          {renglon.precioSugerido === null
            ? 'sin precio'
            : `${formatearMoneda(renglon.precioSugerido)} c/u`}
        </p>
      </div>
    </li>
  );
}

/** Cantidad con hasta 4 decimales (formato es-MX). */
function formatearCantidad(valor: number): string {
  return valor.toLocaleString('es-MX', { maximumFractionDigits: 4 });
}

/** Etiqueta del diff contra el snapshot previo (solo cuando hay cambio). */
function DiffBadge({ diff }: { diff: Requerimiento['diff'] }): React.JSX.Element | null {
  if (diff === 'sin-cambio') {
    return null;
  }
  const etiqueta =
    diff === 'nuevo' ? 'Nuevo' : diff === 'eliminado' ? 'Retirado' : 'Cantidad cambiada';
  return (
    <span
      className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
      data-testid="exp-diff-badge"
    >
      {etiqueta}
    </span>
  );
}

/** Etiqueta del estado de un genérico tras netear (decisión d). */
function GenericoBadge({ renglon }: { renglon: Requerimiento }): React.JSX.Element | null {
  if (!renglon.esGenerico) {
    return null;
  }
  const cubierto = renglon.estadoGenerico === 'cubierto-por-stock';
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
        cubierto ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'
      }`}
      data-testid="exp-generico-badge"
    >
      {cubierto ? 'Cubierto por stock' : 'Genérico · faltante'}
    </span>
  );
}
