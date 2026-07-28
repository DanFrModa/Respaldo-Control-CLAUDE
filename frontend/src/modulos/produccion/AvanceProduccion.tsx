import { useQueryClient } from '@tanstack/react-query';
import { Ban, Loader2, Plus, Route, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import {
  CLAVE_ETAPAS,
  useCancelarCorte,
  useCancelarEnvio,
  useCrearCorte,
  useCrearEnvio,
  useEtapasOrden,
} from '@/api/etapas';
import { useOrden } from '@/api/ordenes';
import { CLAVE_ORDENES_CENTRO } from '@/api/ordenes-centro';
import { useProveedores, useRolesProveedor } from '@/api/proveedores';
import { CLAVE_RECIBOS, useCancelarRecibo, useCrearRecibo } from '@/api/recibos';
import { useTiposProceso } from '@/api/tipos-proceso';
import type { EtapaHistorial, TipoProceso, WipOrden } from '@/api/tipos';
import { CLAVE_WIP, useWipOrden } from '@/api/wip';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { ComboboxBuscable } from '@/components/dominio/ComboboxBuscable';
import { claveCelda, MatrizColorTalla } from '@/components/dominio/MatrizColorTalla';
import { StepperEtapas, type PasoEtapa } from '@/components/dominio/StepperEtapas';
import { Avatar } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';
import { useCerrarConAtras } from '@/lib/useCerrarConAtras';
import { cn } from '@/lib/utils';
import { useSesion } from '@/sesion/useSesion';

/**
 * AVANCE DE PRODUCCIÓN (rediseño R2, §4.3 — el form "Proceso" del Access, reconstruido): panel de
 * pantalla completa que se abre con DOBLE CLIC en una orden (o el botón "Registrar avance").
 *
 *  - Stepper de 5 ETAPAS (Corte / Entrega a maquila / Recibo de maquila / Entrega aplicación /
 *    Recibo aplicación) con su avance `x/total` y color de estado. Los totales salen DERIVADOS del
 *    servidor (`wipDeOrden`, F3-E5): aquí solo se combinan (costura = procesos que meten a PT).
 *  - Cada etapa es una LISTA de movimientos (multi-proveedor, §4.3): proveedor + fecha + desglose
 *    color×talla + "capturado por · fecha" (§4.4.4) + cancelar con motivo (suave, D3).
 *  - CAPTURA con candado: la matriz usa SOLO los colores/tallas de la orden (D4); pega directo a
 *    los endpoints F3 (corte/envíos/recibos) — la lógica vive en el backend (A1).
 *  - Al registrar: toast con la nota de que la Ruta Crítica se marca sola (auto-avance F3→F5).
 *  - Resumen abajo en DOS bloques: Costura y Estampado/Bordado (proto `.proc-summary`).
 */

/** Clave de cada etapa del stepper. */
type ClaveEtapa =
  | 'corte'
  | 'entrega-maquila'
  | 'recibo-maquila'
  | 'entrega-aplicacion'
  | 'recibo-aplicacion';

/** Definición visual de las 5 etapas (orden del proto). */
const ETAPAS: readonly { clave: ClaveEtapa; etiqueta: string; etiquetaProveedor: string }[] = [
  { clave: 'corte', etiqueta: 'Corte', etiquetaProveedor: 'Cortador' },
  { clave: 'entrega-maquila', etiqueta: 'Entrega a maquila', etiquetaProveedor: 'Maquilero' },
  { clave: 'recibo-maquila', etiqueta: 'Recibo de maquila', etiquetaProveedor: 'Maquilero' },
  { clave: 'entrega-aplicacion', etiqueta: 'Entrega aplicación', etiquetaProveedor: 'Aplicador' },
  { clave: 'recibo-aplicacion', etiqueta: 'Recibo aplicación', etiquetaProveedor: 'Aplicador' },
];

/** Fecha de hoy (YYYY-MM-DD) para el default de captura. */
function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Formatea una fecha date-only `YYYY-MM-DD` como "4 jul 2026". */
function fechaCorta(valor: string | null): string {
  if (valor === null) return '—';
  const [a, m, d] = valor.split('-').map(Number);
  if (a === undefined || m === undefined || d === undefined) return '—';
  return new Date(a, m - 1, d).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Mapeo `TipoProceso.codigo` → rol de proveedor (espejo del dominio, D12/R15). */
function rolDelProceso(codigoProceso: string): string {
  return codigoProceso === 'costura' ? 'maquila-costura' : codigoProceso;
}

/** A qué etapa del stepper pertenece un movimiento (costura vs aplicación por `generaEntradaPt`). */
export function claveEtapaDeMovimiento(
  movimiento: Pick<EtapaHistorial, 'tipo' | 'idTipoProceso'>,
  esCostura: (idTipoProceso: number) => boolean,
): ClaveEtapa | null {
  if (movimiento.tipo === 'corte') return 'corte';
  const costura = movimiento.idTipoProceso !== null && esCostura(movimiento.idTipoProceso);
  if (movimiento.tipo === 'envio_maquila') {
    return costura ? 'entrega-maquila' : 'entrega-aplicacion';
  }
  if (movimiento.tipo === 'recibo_maquila') {
    return costura ? 'recibo-maquila' : 'recibo-aplicacion';
  }
  return null;
}

/** Totales del stepper derivados del WIP del servidor (costura = procesos que meten a PT). */
export function pasosDesdeWip(wip: WipOrden): PasoEtapa[] {
  const porRecibirCostura = wip.porRecibir
    .filter((p) => p.generaEntradaPt)
    .reduce((s, p) => s + p.totalPendiente, 0);
  const enviadoCostura = wip.recibidoCostura + porRecibirCostura;
  const enviadoAplicacion = wip.enviado - enviadoCostura;
  const recibidoAplicacion = wip.recibido - wip.recibidoCostura;
  return [
    { clave: 'corte', etiqueta: 'Corte', hecho: wip.cortado, total: wip.pedido },
    {
      clave: 'entrega-maquila',
      etiqueta: 'Entrega a maquila',
      hecho: enviadoCostura,
      total: wip.pedido,
    },
    {
      clave: 'recibo-maquila',
      etiqueta: 'Recibo de maquila',
      hecho: wip.recibidoCostura,
      total: wip.pedido,
    },
    {
      clave: 'entrega-aplicacion',
      etiqueta: 'Entrega aplicación',
      hecho: enviadoAplicacion,
      total: wip.pedido,
    },
    {
      clave: 'recibo-aplicacion',
      etiqueta: 'Recibo aplicación',
      hecho: recibidoAplicacion,
      total: wip.pedido,
    },
  ];
}

/** Props del panel de avance. */
export interface PropsAvanceProduccion {
  idOrden: number;
  /** Folio del pedido interno (el `-F`), si el llamador lo conoce (encabezado). */
  folioPedido?: number | null;
  alCerrar: () => void;
}

/**
 * Panel de AVANCE de una orden, a pantalla completa (proto `#procScrim`/`#procPanel`). Se cierra
 * con Esc, el botón ✕, el clic en el fondo o el "atrás" del teléfono (el panel no es una ruta:
 * sin eso el "regresar" del celular sacaría al usuario del Centro de Órdenes).
 */
export function AvanceProduccion({
  idOrden,
  folioPedido,
  alCerrar,
}: PropsAvanceProduccion): React.JSX.Element {
  const { tienePermiso } = useSesion();
  // El panel solo existe montado (el llamador lo renderiza condicionalmente): siempre está abierto.
  useCerrarConAtras(true, alCerrar);
  const queryClient = useQueryClient();

  const orden = useOrden(idOrden);
  const wip = useWipOrden(idOrden);
  const etapas = useEtapasOrden(idOrden, true, true);
  const procesos = useTiposProceso({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });

  const [etapaActiva, setEtapaActiva] = useState<ClaveEtapa>('corte');
  const [capturaAbierta, setCapturaAbierta] = useState(false);
  const [aCancelar, setACancelar] = useState<EtapaHistorial | null>(null);

  // Esc cierra el panel — pero NO mientras el diálogo de cancelación está abierto: su propio Esc
  // lo cierra (Radix) y si este listener también corriera, tiraría el panel entero y se perdería
  // la matriz tecleada. (El Esc del ComboboxBuscable con lista abierta hace stopPropagation y no
  // llega hasta acá.)
  useEffect(() => {
    if (aCancelar !== null) {
      return;
    }
    function alTeclear(evento: KeyboardEvent): void {
      if (evento.key === 'Escape') {
        alCerrar();
      }
    }
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [alCerrar, aCancelar]);

  // Clasificador costura/aplicación por TipoProceso (generaEntradaPt = mete a PT = costura).
  const procesosPorId = useMemo(() => {
    const mapa = new Map<number, TipoProceso>();
    for (const p of procesos.data?.datos ?? []) {
      mapa.set(p.id, p);
    }
    return mapa;
  }, [procesos.data]);
  const esCostura = (idTipoProceso: number): boolean =>
    procesosPorId.get(idTipoProceso)?.generaEntradaPt === true;

  // Movimientos de la etapa activa (vivos y cancelados; el más reciente primero, ya viene así).
  const movimientos = useMemo(
    () =>
      (etapas.data?.etapas ?? []).filter(
        (m) => claveEtapaDeMovimiento(m, esCostura) === etapaActiva,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- esCostura depende solo de procesosPorId.
    [etapas.data, etapaActiva, procesosPorId],
  );

  const pasos = wip.data === undefined ? null : pasosDesdeWip(wip.data);
  const definicion = ETAPAS.find((e) => e.clave === etapaActiva) ?? {
    clave: 'corte' as const,
    etiqueta: 'Corte',
    etiquetaProveedor: 'Cortador',
  };

  async function refrescarTodo(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: CLAVE_ETAPAS }),
      queryClient.invalidateQueries({ queryKey: CLAVE_RECIBOS }),
      queryClient.invalidateQueries({ queryKey: CLAVE_WIP }),
      queryClient.invalidateQueries({ queryKey: CLAVE_ORDENES_CENTRO }),
    ]);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/45 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Avance de producción de la orden ${orden.data?.folio ?? idOrden}`}
      data-testid="avance-produccion"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) alCerrar();
      }}
    >
      <div className="flex w-full max-w-5xl flex-col overflow-hidden bg-background shadow-xl sm:rounded-xl">
        {/* ── Encabezado ─────────────────────────────────────────────────── */}
        <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
          <Avatar nombre={orden.data?.codigoModelo ?? '·'} tono="pt" tamano="md" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">
              Avance de producción · OP {orden.data?.folio ?? '…'}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {orden.data ? (
                <>
                  Modelo <b>{orden.data.codigoModelo}</b>
                  {folioPedido != null ? (
                    <>
                      {' '}
                      · Pedido interno <b>{folioPedido}-F</b>
                    </>
                  ) : null}{' '}
                  · Cliente <b>{orden.data.cliente}</b>
                </>
              ) : (
                'Cargando…'
              )}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={alCerrar}
            aria-label="Cerrar (Esc)"
            data-testid="avance-cerrar"
          >
            <X className="size-5" aria-hidden />
          </Button>
        </header>

        {/* ── Cuerpo con scroll ──────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {pasos !== null ? (
            <StepperEtapas
              pasos={pasos}
              activa={etapaActiva}
              onCambiar={(clave) => {
                setEtapaActiva(clave as ClaveEtapa);
                setCapturaAbierta(false);
              }}
              testid="avance-stepper"
            />
          ) : (
            <p className="text-sm text-muted-foreground">Cargando avance…</p>
          )}

          {/* Etapa activa: encabezado + captura + lista de movimientos. */}
          <section className="rounded-xl border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
              <h3 className="text-sm font-semibold">{definicion.etiqueta}</h3>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Route className="size-3.5 text-primary" aria-hidden />
                Se marca en Ruta Crítica automáticamente
              </span>
              {puedeCapturar(etapaActiva, tienePermiso) ? (
                <Button
                  size="sm"
                  className="ml-auto"
                  onClick={() => setCapturaAbierta((v) => !v)}
                  data-testid="avance-abrir-captura"
                >
                  <Plus aria-hidden />
                  Registrar {definicion.etiqueta.toLowerCase()}
                </Button>
              ) : null}
            </div>

            {capturaAbierta && orden.data !== undefined && wip.data !== undefined ? (
              <CapturaMovimiento
                etapa={etapaActiva}
                orden={orden.data}
                wip={wip.data}
                procesos={procesos.data?.datos ?? []}
                alRegistrado={() => {
                  setCapturaAbierta(false);
                  void refrescarTodo();
                }}
                alCancelar={() => setCapturaAbierta(false)}
              />
            ) : null}

            <ListaMovimientos
              movimientos={movimientos}
              etiquetaProveedor={definicion.etiquetaProveedor}
              conTipo={etapaActiva === 'entrega-aplicacion' || etapaActiva === 'recibo-aplicacion'}
              cargando={etapas.isPending}
              etiquetaEtapa={definicion.etiqueta}
              puedeCancelar={tienePermiso('produccion.cancelar')}
              alCancelar={setACancelar}
            />
          </section>

          {/* ── Resumen en dos bloques (proto `.proc-summary`) ────────────── */}
          {wip.data !== undefined && pasos !== null ? (
            <ResumenAvance wip={wip.data} pasos={pasos} />
          ) : null}
        </div>
      </div>

      <DialogoCancelarMovimiento
        movimiento={aCancelar}
        alCerrar={() => setACancelar(null)}
        alCancelado={() => void refrescarTodo()}
      />
    </div>
  );
}

/** ¿La sesión puede capturar la etapa activa? (la pantalla esconde; el servidor decide, A1). */
function puedeCapturar(
  etapa: ClaveEtapa,
  tienePermiso: (clave: 'produccion.corte' | 'produccion.envio' | 'produccion.recibo') => boolean,
): boolean {
  if (etapa === 'corte') return tienePermiso('produccion.corte');
  if (etapa === 'entrega-maquila' || etapa === 'entrega-aplicacion') {
    return tienePermiso('produccion.envio');
  }
  return tienePermiso('produccion.recibo');
}

/** Lista de MOVIMIENTOS de una etapa (proveedor + fecha + total + capturó + cancelación). */
function ListaMovimientos({
  movimientos,
  etiquetaProveedor,
  conTipo,
  cargando,
  etiquetaEtapa,
  puedeCancelar,
  alCancelar,
}: {
  movimientos: readonly EtapaHistorial[];
  etiquetaProveedor: string;
  conTipo: boolean;
  cargando: boolean;
  etiquetaEtapa: string;
  puedeCancelar: boolean;
  alCancelar: (movimiento: EtapaHistorial) => void;
}): React.JSX.Element {
  if (cargando) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">Cargando movimientos…</p>;
  }
  if (movimientos.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground" data-testid="avance-etapa-vacia">
        Aún no se registra {etiquetaEtapa.toLowerCase()} para esta orden.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-secondary text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <th className="px-3 py-1.5 text-left">Fecha</th>
            <th className="px-3 py-1.5 text-left">{etiquetaProveedor}</th>
            {conTipo ? <th className="px-3 py-1.5 text-left">Tipo</th> : null}
            <th className="px-3 py-1.5 text-right">Cantidad</th>
            <th className="px-3 py-1.5 text-left">Capturó</th>
            <th className="px-3 py-1.5 text-left">Observaciones</th>
            <th className="w-10" aria-hidden />
          </tr>
        </thead>
        <tbody>
          {movimientos.map((m) => (
            <tr
              key={m.id}
              className={cn('border-b', m.cancelado && 'opacity-55')}
              data-testid="avance-movimiento"
            >
              <td className="num px-3 py-1.5 whitespace-nowrap">{fechaCorta(m.fecha)}</td>
              <td className="px-3 py-1.5 font-medium">{m.tercero ?? '—'}</td>
              {conTipo ? (
                <td className="px-3 py-1.5">
                  <ChipEstado tono={m.tipoProceso === 'Bordado' ? 'info' : 'warn'}>
                    {m.tipoProceso ?? '—'}
                  </ChipEstado>
                </td>
              ) : null}
              <td className="num px-3 py-1.5 text-right font-semibold">
                {m.totalPiezas.toLocaleString('es-MX')}
              </td>
              {/* Capturado por · fecha (A7 / §4.4.4). */}
              <td className="px-3 py-1.5 text-xs text-muted-foreground">
                {m.creadoPorNombre ?? '—'} · {new Date(m.creadoEn).toLocaleDateString('es-MX')}
              </td>
              <td className="max-w-48 truncate px-3 py-1.5 text-xs text-muted-foreground">
                {m.cancelado ? (
                  <span className="text-crit">
                    Cancelado: {m.motivoCancelacion ?? 'sin motivo'}
                  </span>
                ) : (
                  (m.observaciones ?? '—')
                )}
              </td>
              <td className="px-2 py-1.5 text-right">
                {puedeCancelar && !m.cancelado ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => alCancelar(m)}
                    aria-label={`Cancelar el movimiento ${m.folio}`}
                    data-testid="avance-cancelar-movimiento"
                  >
                    <Ban className="size-4" aria-hidden />
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Captura de un movimiento nuevo de la etapa activa (matriz con candado + proveedor + fecha). */
function CapturaMovimiento({
  etapa,
  orden,
  wip,
  procesos,
  alRegistrado,
  alCancelar,
}: {
  etapa: ClaveEtapa;
  orden: NonNullable<ReturnType<typeof useOrden>['data']>;
  wip: WipOrden;
  procesos: readonly TipoProceso[];
  alRegistrado: () => void;
  /** Cierra la captura sin guardar (botón "Cancelar" del proto). */
  alCancelar: () => void;
}): React.JSX.Element {
  const { sesion } = useSesion();
  const [fecha, setFecha] = useState(hoy());
  const [idProveedor, setIdProveedor] = useState<number | null>(null);
  const [idProcesoAplicacion, setIdProcesoAplicacion] = useState<string>('');
  const [observaciones, setObservaciones] = useState('');
  const [valores, setValores] = useState<Record<string, number>>({});
  const [idAlmacenPrimeras, setIdAlmacenPrimeras] = useState<string>('');
  const [idAlmacenSegundas, setIdAlmacenSegundas] = useState<string>('');
  // El typeahead busca EN SERVIDOR (hay >1,700 maquileros reales; la página local de 100 no basta).
  const [textoProveedor, setTextoProveedor] = useState('');
  const busquedaProveedor = useDebounce(textoProveedor.trim(), 250);

  const crearCorte = useCrearCorte();
  const crearEnvio = useCrearEnvio();
  const crearRecibo = useCrearRecibo();

  const esAplicacion = etapa === 'entrega-aplicacion' || etapa === 'recibo-aplicacion';
  const esRecibo = etapa === 'recibo-maquila' || etapa === 'recibo-aplicacion';

  // Procesos de APLICACIÓN (estampado/bordado/…): los que NO meten a PT. El de COSTURA es el que sí.
  const procesosAplicacion = procesos.filter((p) => !p.generaEntradaPt && p.activo);
  const procesoCostura = procesos.find((p) => p.generaEntradaPt && p.activo);
  const procesoElegido = esAplicacion
    ? procesos.find((p) => String(p.id) === idProcesoAplicacion)
    : procesoCostura;

  // Proveedores filtrados por el ROL de la etapa (D12/R15; el servidor re-valida).
  const roles = useRolesProveedor();
  const codigoRol =
    etapa === 'corte'
      ? 'corte'
      : procesoElegido === undefined
        ? undefined
        : rolDelProceso(procesoElegido.codigo);
  const idRol =
    codigoRol === undefined ? undefined : roles.data?.find((r) => r.codigo === codigoRol)?.id;
  const proveedores = useProveedores({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    ...(idRol === undefined ? {} : { rol: idRol }),
    ...(busquedaProveedor === '' ? {} : { busqueda: busquedaProveedor }),
  });
  const opcionesProveedor = (proveedores.data?.datos ?? []).map((p) => ({
    id: p.id,
    nombre: p.nombre,
  }));

  // Almacenes destino (solo el recibo de COSTURA mete a PT).
  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  const almacenesPt = (almacenes.data?.datos ?? []).filter((a) => a.tipo === 'PT' && a.activo);
  const requiereAlmacen = etapa === 'recibo-maquila';

  // Matriz de la orden (candado D4): filas/columnas fijas.
  const tallas = useMemo(() => {
    const vistas = new Map<number, { idTalla: number; etiqueta: string }>();
    for (const linea of orden.lineas) {
      for (const t of linea.tallas) {
        if (!vistas.has(t.idTalla))
          vistas.set(t.idTalla, { idTalla: t.idTalla, etiqueta: t.etiquetaTalla });
      }
    }
    return [...vistas.values()];
  }, [orden]);
  const colores = useMemo(
    () => orden.lineas.map((l) => ({ idColor: l.idColor, nombre: l.color })),
    [orden],
  );

  // Referencia (pendiente) por celda de la etapa activa, DERIVADA del WIP del servidor. `null` =
  // sin referencia (estado NEUTRO en la matriz): el WIP solo enumera procesos YA usados, así que
  // el PRIMER movimiento de un proceso no debe validarse contra un 0 falso ("Sobran N", hallazgo
  // del reviewer). Para el primer ENVÍO el disponible real sí es derivable: lo CORTADO por celda
  // (matriz de la orden − porCortar); para el primer RECIBO no hay envío contra qué validar.
  const referencia = useMemo<Map<string, number> | null>(() => {
    const mapa = new Map<string, number>();
    if (etapa === 'corte') {
      for (const c of wip.porCortar) mapa.set(claveCelda(c.idColor, c.idTalla), c.cantidad);
      return mapa;
    }
    if (etapa === 'entrega-maquila' || etapa === 'entrega-aplicacion') {
      const entrada = wip.cortadoPorEnviar.find((p) =>
        etapa === 'entrega-maquila'
          ? p.generaEntradaPt
          : String(p.idTipoProceso) === idProcesoAplicacion,
      );
      if (entrada !== undefined) {
        for (const c of entrada.celdas) mapa.set(claveCelda(c.idColor, c.idTalla), c.cantidad);
        return mapa;
      }
      // Primer envío a este proceso: disponible = cortado por celda (pedido − porCortar).
      const porCortar = new Map(
        wip.porCortar.map((c) => [claveCelda(c.idColor, c.idTalla), c.cantidad] as const),
      );
      let hayCortado = false;
      for (const linea of orden.lineas) {
        for (const t of linea.tallas) {
          const clave = claveCelda(linea.idColor, t.idTalla);
          const cortado = t.cantidad - (porCortar.get(clave) ?? t.cantidad);
          if (cortado > 0) hayCortado = true;
          mapa.set(clave, cortado);
        }
      }
      return hayCortado ? mapa : null;
    }
    const entrada = wip.porRecibir.find((p) =>
      etapa === 'recibo-maquila'
        ? p.generaEntradaPt
        : String(p.idTipoProceso) === idProcesoAplicacion,
    );
    if (entrada === undefined) {
      return null;
    }
    for (const c of entrada.celdas) mapa.set(claveCelda(c.idColor, c.idTalla), c.cantidad);
    return mapa;
  }, [etapa, wip, orden, idProcesoAplicacion]);
  const totalReferencia =
    referencia === null
      ? undefined
      : [...referencia.values()].reduce((s, v) => s + Math.max(0, v), 0);

  const total = Object.values(valores).reduce((s, v) => s + v, 0);
  const ocupado = crearCorte.isPending || crearEnvio.isPending || crearRecibo.isPending;
  const procesoParaGuardar = esAplicacion
    ? procesoElegido
    : esRecibo || etapa === 'entrega-maquila'
      ? // El recibo/envío de costura usa el proceso YA USADO en la orden si existe (porRecibir), o
        // el proceso costura del catálogo.
        (procesos.find(
          (p) => p.id === wip.porRecibir.find((x) => x.generaEntradaPt)?.idTipoProceso,
        ) ?? procesoCostura)
      : undefined;

  const puedeGuardar =
    !ocupado &&
    total > 0 &&
    idProveedor !== null &&
    fecha !== '' &&
    (etapa === 'corte' || procesoParaGuardar !== undefined) &&
    (!requiereAlmacen || idAlmacenPrimeras !== '');

  /** Convierte la captura al cuerpo `lineas` del API (descarta ceros). */
  function lineasApi(): { idColor: number; tallas: { idTalla: number; cantidad: number }[] }[] {
    return colores
      .map((color) => ({
        idColor: color.idColor,
        tallas: tallas
          .map((t) => ({
            idTalla: t.idTalla,
            cantidad: valores[claveCelda(color.idColor, t.idTalla)] ?? 0,
          }))
          .filter((t) => t.cantidad > 0),
      }))
      .filter((l) => l.tallas.length > 0);
  }

  function alExito(folio: number, etiqueta: string): void {
    toast.success(`${etiqueta} #${folio} registrado · la Ruta Crítica se marca sola ✓`);
    alRegistrado();
  }

  function guardar(): void {
    if (idProveedor === null) return;
    const comunes = {
      idOrden: orden.id,
      fecha,
      ...(observaciones.trim() === '' ? {} : { observaciones: observaciones.trim() }),
      lineas: lineasApi(),
    };
    if (etapa === 'corte') {
      crearCorte.mutate(
        { ...comunes, idCortador: idProveedor },
        {
          onSuccess: (e) => alExito(e.folio, 'Corte'),
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    if (procesoParaGuardar === undefined) return;
    if (esRecibo) {
      crearRecibo.mutate(
        {
          ...comunes,
          idTipoProceso: procesoParaGuardar.id,
          idMaquilero: idProveedor,
          ...(requiereAlmacen && idAlmacenPrimeras !== ''
            ? { idAlmacenPrimeras: Number(idAlmacenPrimeras) }
            : {}),
          ...(requiereAlmacen && idAlmacenSegundas !== ''
            ? { idAlmacenSegundas: Number(idAlmacenSegundas) }
            : {}),
        },
        {
          onSuccess: (r) => alExito(r.folio, 'Recibo'),
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    crearEnvio.mutate(
      { ...comunes, idTipoProceso: procesoParaGuardar.id, idMaquilero: idProveedor },
      {
        onSuccess: (e) => alExito(e.folio, 'Envío'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const etiquetaProveedor = ETAPAS.find((e) => e.clave === etapa)?.etiquetaProveedor ?? 'Proveedor';

  return (
    <div className="space-y-3 border-b bg-panel-2 px-4 py-3" data-testid="avance-captura">
      <div className={cn('grid gap-3', esAplicacion ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
        <Field>
          <FieldLabel htmlFor="avance-fecha">Fecha</FieldLabel>
          <Input
            id="avance-fecha"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            data-testid="avance-fecha"
          />
        </Field>
        <Field>
          <FieldLabel>{etiquetaProveedor}</FieldLabel>
          <ComboboxBuscable
            opciones={opcionesProveedor}
            valor={idProveedor}
            onChange={setIdProveedor}
            alCambiarTexto={setTextoProveedor}
            cargando={proveedores.isFetching}
            placeholder={`Escribe el ${etiquetaProveedor.toLowerCase()}…`}
            etiqueta={etiquetaProveedor}
            testid="avance-proveedor"
          />
        </Field>
        {esAplicacion ? (
          <Field>
            <FieldLabel htmlFor="avance-tipo">Tipo</FieldLabel>
            <SelectNativo
              id="avance-tipo"
              value={idProcesoAplicacion}
              onChange={(e) => {
                setIdProcesoAplicacion(e.target.value);
                // El rol cambió: la selección Y la búsqueda anterior dejan de aplicar.
                setIdProveedor(null);
                setTextoProveedor('');
              }}
              data-testid="avance-tipo"
            >
              <option value="">Elige…</option>
              {procesosAplicacion.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.nombre}
                </option>
              ))}
            </SelectNativo>
          </Field>
        ) : null}
        <Field>
          <FieldLabel htmlFor="avance-obs">Observaciones</FieldLabel>
          <Input
            id="avance-obs"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Opcional"
            data-testid="avance-observaciones"
          />
        </Field>
      </div>

      {requiereAlmacen ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="avance-almacen-primeras">Almacén de primeras</FieldLabel>
            <SelectNativo
              id="avance-almacen-primeras"
              value={idAlmacenPrimeras}
              onChange={(e) => setIdAlmacenPrimeras(e.target.value)}
              data-testid="avance-almacen-primeras"
            >
              <option value="">Elige el almacén…</option>
              {almacenesPt.map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {a.nombre}
                </option>
              ))}
            </SelectNativo>
          </Field>
          <Field>
            <FieldLabel htmlFor="avance-almacen-segundas">
              Almacén de segundas (opcional)
            </FieldLabel>
            <SelectNativo
              id="avance-almacen-segundas"
              value={idAlmacenSegundas}
              onChange={(e) => setIdAlmacenSegundas(e.target.value)}
              data-testid="avance-almacen-segundas"
            >
              <option value="">Sin segundas</option>
              {almacenesPt.map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {a.nombre}
                </option>
              ))}
            </SelectNativo>
          </Field>
        </div>
      ) : null}

      <MatrizColorTalla
        tallas={tallas}
        colores={colores}
        valores={valores}
        onCambiar={(idColor, idTalla, cantidad) =>
          setValores((v) => ({ ...v, [claveCelda(idColor, idTalla)]: cantidad }))
        }
        {...(referencia === null ? {} : { referencia })}
        {...(totalReferencia === undefined ? {} : { totalReferencia })}
        etiquetaReferencia="pendiente de la etapa"
        testid="avance-matriz"
      />

      {/* Pie del form (proto `.pc-actions`): quién captura + Cancelar + total + guardar. */}
      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
        <span className="mr-auto flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          <span>
            Captura: <b className="text-foreground">{sesion?.nombre ?? '—'}</b>
          </span>
          <span>
            Total capturado: <b className="num text-foreground">{total.toLocaleString('es-MX')}</b>
          </span>
        </span>
        <Button variant="ghost" onClick={alCancelar} data-testid="avance-cancelar-captura">
          Cancelar
        </Button>
        <Button onClick={guardar} disabled={!puedeGuardar} data-testid="avance-guardar">
          {ocupado ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Guardar movimiento
        </Button>
      </div>
    </div>
  );
}

/** Resumen del avance en DOS bloques: costura y estampado/bordado (proto `.proc-summary`). */
function ResumenAvance({
  wip,
  pasos,
}: {
  wip: WipOrden;
  pasos: readonly PasoEtapa[];
}): React.JSX.Element {
  const enviadoCostura = pasos.find((p) => p.clave === 'entrega-maquila')?.hecho ?? 0;
  const enviadoAplicacion = pasos.find((p) => p.clave === 'entrega-aplicacion')?.hecho ?? 0;
  const recibidoAplicacion = pasos.find((p) => p.clave === 'recibo-aplicacion')?.hecho ?? 0;
  const faltaAplicacion = Math.max(0, enviadoAplicacion - recibidoAplicacion);
  const n = (v: number): string => v.toLocaleString('es-MX');
  return (
    <div className="space-y-3" data-testid="avance-resumen">
      <div>
        <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Resumen · costura (maquila)
        </h4>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <TarjetaResumen etiqueta="Ordenada" valor={n(wip.pedido)} />
          <TarjetaResumen
            etiqueta="Cortada"
            valor={n(wip.cortado)}
            pie={`por cortar ${n(Math.max(0, wip.pedido - wip.cortado))}`}
          />
          <TarjetaResumen
            etiqueta="Entregada"
            valor={n(enviadoCostura)}
            pie={`por entregar ${n(Math.max(0, wip.cortado - enviadoCostura))}`}
          />
          <TarjetaResumen
            etiqueta="Recibida"
            valor={n(wip.recibidoCostura)}
            pie={`por recibir ${n(Math.max(0, enviadoCostura - wip.recibidoCostura))}`}
          />
        </div>
      </div>
      <div>
        <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Resumen · arte (aplicación)
        </h4>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <TarjetaResumen etiqueta="Entregada" valor={n(enviadoAplicacion)} />
          <TarjetaResumen etiqueta="Recibida" valor={n(recibidoAplicacion)} />
          <TarjetaResumen
            etiqueta="Falta por recibir"
            valor={n(faltaAplicacion)}
            tono={faltaAplicacion > 0 ? 'warn' : 'ok'}
          />
        </div>
      </div>
    </div>
  );
}

/** Tarjeta chica del resumen (etiqueta + número + pie). */
function TarjetaResumen({
  etiqueta,
  valor,
  pie,
  tono,
}: {
  etiqueta: string;
  valor: string;
  pie?: string;
  tono?: 'warn' | 'ok';
}): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <p className="text-[11px] font-medium text-muted-foreground">{etiqueta}</p>
      <p
        className={cn(
          'num text-lg font-bold',
          tono === 'warn' && 'text-warn',
          tono === 'ok' && 'text-ok',
        )}
      >
        {valor}
      </p>
      {pie !== undefined ? <p className="text-[10.5px] text-faint">{pie}</p> : null}
    </div>
  );
}

/** Diálogo de cancelación SUAVE de un movimiento (corte/envío/recibo) con motivo obligatorio. */
function DialogoCancelarMovimiento({
  movimiento,
  alCerrar,
  alCancelado,
}: {
  movimiento: EtapaHistorial | null;
  alCerrar: () => void;
  alCancelado: () => void;
}): React.JSX.Element {
  const cancelarCorte = useCancelarCorte();
  const cancelarEnvio = useCancelarEnvio();
  const cancelarRecibo = useCancelarRecibo();
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    if (movimiento !== null) setMotivo('');
  }, [movimiento]);

  const tipo = movimiento?.tipo;
  const etiqueta = tipo === 'corte' ? 'corte' : tipo === 'recibo_maquila' ? 'recibo' : 'envío';
  const mutacion =
    tipo === 'corte' ? cancelarCorte : tipo === 'recibo_maquila' ? cancelarRecibo : cancelarEnvio;
  const sinMotivo = motivo.trim().length < 3;

  function confirmar(): void {
    if (movimiento === null || sinMotivo) return;
    mutacion.mutate(
      { id: movimiento.id, cuerpo: { motivo: motivo.trim() } },
      {
        onSuccess: () => {
          toast.success(`Movimiento #${movimiento.folio} cancelado (se conserva como historial).`);
          alCerrar();
          alCancelado();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog
      open={movimiento !== null}
      onOpenChange={(abierto) => (abierto ? undefined : alCerrar())}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Cancelar {etiqueta} {movimiento ? `#${movimiento.folio}` : ''}
          </DialogTitle>
          <DialogDescription>
            El movimiento se conserva como historial (cancelación suave, D3) y deja de contar en el
            avance. Escribe el motivo.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Field data-invalid={sinMotivo}>
            <FieldLabel htmlFor="avance-motivo-cancelar">Motivo</FieldLabel>
            <Input
              id="avance-motivo-cancelar"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por qué se cancela este movimiento"
              data-testid="avance-motivo-cancelar"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={alCerrar} disabled={mutacion.isPending}>
            Volver
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={confirmar}
            disabled={mutacion.isPending || sinMotivo}
            data-testid="avance-confirmar-cancelar"
          >
            {mutacion.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Cancelar {etiqueta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
