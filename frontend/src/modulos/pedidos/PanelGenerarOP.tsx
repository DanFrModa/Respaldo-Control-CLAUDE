import { CheckIcon, InfoIcon, Loader2Icon, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useCamposCliente } from '@/api/clientes';
import { usePropuestaProduccion } from '@/api/modelos';
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
import { useSesion } from '@/sesion/useSesion';
import { cn } from '@/lib/utils';
import { AgregarColorMatriz } from '@/modulos/ordenes/AgregarColorMatriz';

/**
 * PANEL "GENERAR OP" (rediseño R3, §4.1 — proto `renderOpGen`): la SALIDA A PRODUCCIÓN de un
 * renglón del pedido. Aquí NACE la matriz color×talla de la orden (se eligen colores/tallas del
 * catálogo y se distribuye la cantidad del renglón, con la guía cuadra/faltan/sobran) + las
 * referencias del cliente (D7, opcionales). Al confirmar, el backend en UNA transacción crea la
 * OP, copia el snapshot de la OC, liga al desarrollo, PASA EL MODELO A PRODUCCIÓN si todavía era
 * de desarrollo y encola la RC automática — el toast lo resume.
 *
 * ⚠️ El nº de producción se CONFIRMA aquí (§Post-F9.34 punto 4 + §Post-F9.46). Daniel encontró
 * probando (OP 5558) que la OP se quedaba con el modelo de DESARROLLO: *"habíamos acordado que el
 * sistema iba a proponer un modelo de producción y yo solo lo confirmaría"*. Por eso, cuando el
 * renglón trae un modelo de desarrollo, el panel enseña el nº de 5 dígitos **ya precargado** con el
 * siguiente libre y lo manda al confirmar; se puede cambiar antes de generar.
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

  const tallas = useTallasActivas();
  const campos = useCamposCliente(pedido.idCliente);

  // Nº de producción: sólo cuando el modelo del renglón TODAVÍA es de desarrollo. Si ya está en
  // producción, la OP hereda su número y aquí no hay nada que decidir.
  const esModeloDeDesarrollo = renglon.origenModelo === 'desarrollo';
  const propuesta = usePropuestaProduccion(esModeloDeDesarrollo ? renglon.idModelo : undefined);
  const [numeroProduccion, setNumeroProduccion] = useState('');
  const [numeroTocado, setNumeroTocado] = useState(false);
  const propuestoCodigo = propuesta.data?.codigo ?? null;
  useEffect(() => {
    if (!numeroTocado && propuestoCodigo !== null) {
      setNumeroProduccion(propuestoCodigo);
    }
  }, [propuestoCodigo, numeroTocado]);
  const numeroValido = /^\d{5}$/.test(numeroProduccion.trim());

  const [lineas, setLineas] = useState<MatrizLinea[]>([]);
  const [columnas, setColumnas] = useState<MatrizTalla[]>([]);
  const [referencias, setReferencias] = useState<Record<number, string>>({});

  // Alta de color AL VUELO (mismo criterio que la matriz de la OP, §Post-F9.11): la opción de
  // crear solo se ofrece con el permiso que exige el endpoint; el backend re-valida (A1).
  const { tienePermiso } = useSesion();
  const puedeCrearColor = tienePermiso('colores.administrar');
  const idsColoresUsados = useMemo(() => new Set(lineas.map((l) => l.idColor)), [lineas]);
  // Contador propio para REMONTAR el combobox tras agregar (que no quede pegado lo tecleado).
  // No se usa `lineas.length`: quitar una fila también lo cambiaría, remontando sin necesidad.
  const [vecesAgregado, setVecesAgregado] = useState(0);
  const agregarColorFila = useCallback((idColor: number, nombre: string): void => {
    setLineas((previas) =>
      previas.some((l) => l.idColor === idColor)
        ? previas
        : [...previas, { idColor, color: nombre, cantidades: {} }],
    );
    setVecesAgregado((n) => n + 1);
  }, []);
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
    if (esModeloDeDesarrollo && !numeroValido) {
      toast.error('Confirma el número de producción del modelo (5 dígitos).');
      return;
    }
    const cuerpo: SalidaProduccionCuerpo = {
      lineas: lineas.map((linea) => ({
        idColor: linea.idColor,
        ...(linea.pantone !== undefined && linea.pantone !== null && linea.pantone.trim() !== ''
          ? { pantone: linea.pantone.trim() }
          : {}),
        tallas: columnas
          .map((col) => ({ idTalla: col.idTalla, cantidad: linea.cantidades[col.idTalla] ?? 0 }))
          .filter((t) => t.cantidad > 0),
      })),
      ...(esModeloDeDesarrollo ? { numeroProduccion: Number(numeroProduccion.trim()) } : {}),
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
            `OP ${resultado.orden.folio} creada` +
              (resultado.numeroProduccion === null
                ? ''
                : ` · modelo de producción ${String(resultado.numeroProduccion)}`) +
              (resultado.codigoModeloAnterior === null
                ? ''
                : ` (antes ${resultado.codigoModeloAnterior}, que se conserva)`) +
              (resultado.ligaCreada ? ' · ligado a su desarrollo' : '') +
              ' · Ruta Crítica programándose sola',
          );
          for (const aviso of resultado.avisosNumeroProduccion) {
            toast.warning(aviso);
          }
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

          {esModeloDeDesarrollo ? (
            <section
              className="space-y-2 rounded-md border border-primary/40 bg-primary-soft px-3 py-2.5"
              data-testid="confirmar-numero-produccion"
            >
              <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Nº de producción del modelo
              </h3>
              <p className="text-xs text-muted-foreground">
                <b>{renglon.codigoModelo}</b> todavía es un modelo de <b>desarrollo</b>. Al generar
                la OP entra al catálogo de producción con este número; su nº de desarrollo se
                conserva y sigue siendo buscable.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={numeroProduccion}
                  onChange={(e) => {
                    setNumeroTocado(true);
                    setNumeroProduccion(e.target.value.replace(/\D/g, ''));
                  }}
                  inputMode="numeric"
                  maxLength={5}
                  className="mono h-8 w-28"
                  aria-label="Número de producción del modelo"
                  aria-invalid={!numeroValido}
                  data-testid="numero-produccion-op"
                />
                <span className="text-xs text-muted-foreground">
                  {propuesta.isPending
                    ? 'Calculando el siguiente libre…'
                    : propuesta.data?.serie !== undefined
                      ? `Serie ${propuesta.data.serie.par} · quedan ${propuesta.data.serie.libres.toLocaleString('es-MX')} de 999`
                      : ''}
                </span>
              </div>
              {(propuesta.data?.avisos ?? []).map((aviso) => (
                <p key={aviso} className="text-xs text-amber-700" data-testid="aviso-produccion-op">
                  {aviso}
                </p>
              ))}
              {propuesta.isError ? (
                <p className="text-xs text-destructive" role="alert">
                  {propuesta.error.message}
                </p>
              ) : null}
            </section>
          ) : null}

          <MatrizColorTalla
            tallas={columnas}
            lineas={lineas}
            /* El catálogo completo ya NO se precarga: el combobox del slot busca en servidor. Se
               pasan solo los colores YA en la matriz, que es lo que la tabla necesita para
               pintar sus nombres. */
            coloresDisponibles={lineas.map((l) => ({ id: l.idColor, nombre: l.color }))}
            tallasDisponibles={tallasDisponibles}
            onLineasChange={setLineas}
            onTallasChange={setColumnas}
            onPantoneChange={(idColor, pantone) =>
              setLineas((prev) => prev.map((l) => (l.idColor === idColor ? { ...l, pantone } : l)))
            }
            testid="matriz-op"
            /* V1-E4 (punto 7): el `<select>` nativo de la matriz se alimentaba de la PRIMERA
               PÁGINA del catálogo de colores (100). El catálogo la rebasa —el importador de OC por
               PDF crea colores al vuelo, y hasta §Post-F9.129 creaba UNO POR PACK (`Blanco A`,
               `Blanco B`…), que es por lo que el catálogo creció tanto; hoy crea uno por OC, pero
               los que ya nacieron así siguen ahí y el catálogo sigue rebasando la página—, así que
               un color existente podía ser INALCANZABLE aquí y el usuario terminaba duplicándolo.
               Se reusa el MISMO combobox con búsqueda server-side + alta al vuelo que la matriz de
               la OP ya usa desde §Post-F9.11 (`AgregarColorMatriz`), no uno nuevo. */
            slotAgregarColor={
              <AgregarColorMatriz
                key={vecesAgregado}
                idsUsados={idsColoresUsados}
                alAgregar={agregarColorFila}
                puedeCrear={puedeCrearColor}
              />
            }
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
