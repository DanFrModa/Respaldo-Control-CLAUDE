import { CheckIcon, InfoIcon, Loader2Icon, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useCamposCliente } from '@/api/clientes';
import { useColores } from '@/api/colores';
import { useSalidaProduccion } from '@/api/pedidos-mes';
import { useTallasActivas } from '@/api/tallas';
import type { PedidoMesFila, PedidoMesRenglon, SalidaProduccionCuerpo } from '@/api/tipos';
import { CadenaTrazabilidad, type NodoTraza } from '@/components/dominio/CadenaTrazabilidad';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  MatrizColorTalla,
  type MatrizLinea,
  type MatrizTalla,
} from '@/componentes/matriz-color-talla/MatrizColorTalla';
import { cn } from '@/lib/utils';

/**
 * PANEL "GENERAR OP" (rediseño R3, §4.1 — proto `renderOpGen`): la SALIDA A PRODUCCIÓN de un
 * renglón del pedido. Aquí NACE la matriz color×talla de la orden (se eligen colores/tallas del
 * catálogo y se distribuye la cantidad del renglón, con la guía cuadra/faltan/sobran) + las
 * referencias del cliente (D7, opcionales). Al confirmar, el backend en UNA transacción crea la
 * OP, copia el snapshot de la OC, liga al desarrollo, MINTEA el nº interno de producción (1ª vez)
 * y encola la RC automática — el toast lo resume y el banner muestra el número minteado.
 *
 * Reusa el componente de captura F2 (`componentes/matriz-color-talla`): en este panel la matriz
 * se CONSTRUYE (agregar/quitar colores y tallas), a diferencia de la matriz con candado de R2.
 */
export function PanelGenerarOP({
  pedido,
  renglon,
  alCerrar,
  alCreada,
}: {
  pedido: PedidoMesFila;
  renglon: PedidoMesRenglon;
  alCerrar: () => void;
  /** Callback tras crear la OP (refresca la consulta). */
  alCreada: () => void;
}): React.JSX.Element {
  const navigate = useNavigate();
  const generar = useSalidaProduccion();

  const colores = useColores({ pagina: 1, porPagina: 100, ordenarPor: 'nombre', direccion: 'asc' });
  const tallas = useTallasActivas();
  const campos = useCamposCliente(pedido.idCliente);

  const [lineas, setLineas] = useState<MatrizLinea[]>([]);
  const [columnas, setColumnas] = useState<MatrizTalla[]>([]);
  const [referencias, setReferencias] = useState<Record<number, string>>({});

  const coloresDisponibles = useMemo(
    () => (colores.data?.datos ?? []).map((c) => ({ id: c.id, nombre: c.nombre })),
    [colores.data],
  );
  const tallasDisponibles = useMemo(
    () => (tallas.data?.datos ?? []).map((t) => ({ idTalla: t.id, etiqueta: t.etiqueta })),
    [tallas.data],
  );
  const camposActivos = useMemo(() => (campos.data ?? []).filter((c) => c.activo), [campos.data]);

  const total = useMemo(
    () =>
      lineas.reduce(
        (suma, linea) =>
          suma + columnas.reduce((s, col) => s + (linea.cantidades[col.idTalla] ?? 0), 0),
        0,
      ),
    [lineas, columnas],
  );
  const diferencia = total - renglon.cantidad;

  // Cadena de trazabilidad: la OP aún no existe ("por generar").
  const nodos: NodoTraza[] = [
    ...(pedido.ocCliente !== null
      ? [
          {
            clave: 'oc' as const,
            etiqueta: 'OC cliente',
            valor: pedido.ocCliente,
            activo: true,
            titulo: 'Orden de compra original del cliente (referencia)',
          },
        ]
      : []),
    {
      clave: 'desarrollo',
      etiqueta: 'Desarrollo',
      valor: renglon.idDesarrollo !== null ? `#${renglon.codigoModelo}` : '—',
      activo: renglon.idDesarrollo !== null,
      ...(renglon.idDesarrollo !== null
        ? {
            onNavegar: () =>
              void navigate('/desarrollo', { state: { idModelo: renglon.idModelo } }),
          }
        : { titulo: 'modelo anterior al módulo de Desarrollo' }),
    },
    {
      clave: 'lista',
      etiqueta: 'Lista de precios',
      valor: 'cotización',
      activo: renglon.idDesarrollo !== null,
      ...(renglon.idDesarrollo !== null
        ? { onNavegar: () => void navigate('/listas-precios') }
        : {}),
    },
    {
      clave: 'pedido',
      etiqueta: 'Pedido interno',
      valor: `${pedido.folio}-F`,
      activo: true,
    },
    { clave: 'op', etiqueta: 'OP · producción', valor: 'por generar', activo: false },
  ];

  function confirmar(): void {
    if (total === 0) {
      toast.error('Captura las cantidades por color y talla.');
      return;
    }
    const cuerpo: SalidaProduccionCuerpo = {
      lineas: lineas.map((linea) => ({
        idColor: linea.idColor,
        tallas: columnas
          .map((col) => ({ idTalla: col.idTalla, cantidad: linea.cantidades[col.idTalla] ?? 0 }))
          .filter((t) => t.cantidad > 0),
      })),
      ...(Object.entries(referencias).filter(([, v]) => v.trim() !== '').length > 0
        ? {
            referencias: Object.entries(referencias)
              .filter(([, valor]) => valor.trim() !== '')
              .map(([idCampo, valor]) => ({
                idClienteCampo: Number(idCampo),
                valor: valor.trim(),
              })),
          }
        : {}),
    };
    generar.mutate(
      { idLinea: renglon.id, cuerpo },
      {
        onSuccess: (resultado) => {
          toast.success(
            `OP ${resultado.orden.folio} creada · salió a producción como modelo #${resultado.numeroProduccion}` +
              (resultado.ligaCreada ? ` (ligado a desarrollo ${renglon.codigoModelo})` : '') +
              ' · Ruta Crítica programándose sola',
          );
          alCreada();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/45"
      role="dialog"
      aria-modal="true"
      aria-label={`Generar OP del modelo ${renglon.codigoModelo}`}
      data-testid="panel-generar-op"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) alCerrar();
      }}
    >
      <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-background shadow-xl">
        {/* ── Encabezado ─────────────────────────────────────────────────── */}
        <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
            OP
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">
              Generar OP · Modelo {renglon.codigoModelo}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {pedido.cliente} · Pedido interno {pedido.folio}-F
              {pedido.ocCliente !== null ? ` · OC cliente ${pedido.ocCliente}` : ''}
              {renglon.descripcionModelo !== null ? ` · ${renglon.descripcionModelo}` : ''}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={alCerrar}
            aria-label="Cerrar"
            data-testid="generar-op-cerrar"
          >
            <X className="size-5" aria-hidden />
          </Button>
        </header>

        {/* ── Cuerpo con scroll ──────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <CadenaTrazabilidad nodos={nodos} />

          {pedido.ocCliente !== null ? (
            <p className="rounded-md bg-panel-2 px-3 py-2 text-xs text-muted-foreground">
              Esta OP guarda la <b>OC original del cliente</b> como referencia:{' '}
              <b className="num">{pedido.ocCliente}</b> — queda amarrada a la orden aunque el pedido
              interno se reorganice.
            </p>
          ) : null}

          <p className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
            <span>
              <b>Generar la OP es la salida a producción:</b> el modelo entra al catálogo de
              producción (base distinta a Desarrollo) con su <b>nº interno de producción</b>
              {renglon.idDesarrollo !== null ? (
                <>
                  {' '}
                  y queda <b>ligado</b> a su ficha de desarrollo, de la que hereda BOM/telas/avíos.{' '}
                  <button
                    type="button"
                    className="font-medium text-primary hover:underline"
                    onClick={() =>
                      void navigate('/desarrollo', { state: { idModelo: renglon.idModelo } })
                    }
                    data-testid="generar-op-ver-desarrollo"
                  >
                    Ver desarrollo
                  </button>
                </>
              ) : (
                <>
                  . <b>Sin ficha de desarrollo</b> (modelo histórico).
                </>
              )}
            </span>
          </p>

          <p className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
            <span>
              La <b>matriz color×talla nace aquí</b>. Distribuye la cantidad del pedido (
              <b className="num">{renglon.cantidad.toLocaleString('es-MX')} pz</b>) por color y
              talla; al generar, su <b>Ruta Crítica se programa sola</b>.
            </span>
          </p>

          <MatrizColorTalla
            tallas={columnas}
            lineas={lineas}
            coloresDisponibles={coloresDisponibles}
            tallasDisponibles={tallasDisponibles}
            onLineasChange={setLineas}
            onTallasChange={setColumnas}
            testid="matriz-op"
          />

          {camposActivos.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Referencias del cliente (D7)
              </h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {camposActivos.map((campo) => (
                  <label key={campo.id} className="space-y-1 text-xs">
                    <span className="font-medium text-muted-foreground">{campo.etiqueta}</span>
                    <Input
                      value={referencias[campo.id] ?? ''}
                      onChange={(e) =>
                        setReferencias((r) => ({ ...r, [campo.id]: e.target.value }))
                      }
                      placeholder="Opcional"
                      data-testid="generar-op-referencia"
                    />
                  </label>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        {/* ── Pie: capturado vs pedido + acciones ────────────────────────── */}
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3">
          <p className="text-xs text-muted-foreground" data-testid="generar-op-capturado">
            Capturado <b className="num">{total.toLocaleString('es-MX')}</b> /{' '}
            {renglon.cantidad.toLocaleString('es-MX')} pz{' '}
            <span
              className={cn(
                'font-semibold',
                diferencia === 0 ? 'text-ok' : diferencia > 0 ? 'text-crit' : 'text-warn',
              )}
            >
              {diferencia === 0
                ? '· cuadra'
                : diferencia > 0
                  ? `· sobran ${diferencia.toLocaleString('es-MX')}`
                  : `· faltan ${(-diferencia).toLocaleString('es-MX')}`}
            </span>
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={alCerrar} disabled={generar.isPending}>
              Cancelar
            </Button>
            <Button
              onClick={confirmar}
              disabled={generar.isPending || total === 0}
              data-testid="confirmar-generar-op"
            >
              {generar.isPending ? (
                <Loader2Icon className="animate-spin" aria-hidden />
              ) : (
                <CheckIcon aria-hidden />
              )}
              Generar OP
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
