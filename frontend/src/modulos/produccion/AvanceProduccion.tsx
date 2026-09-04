import { useQueryClient } from '@tanstack/react-query';
import { Ban, FileText, Loader2, Plus, Printer, Route, Scissors, Wand2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import {
  useCerrarOrdenMaquila,
  useCierresMaquila,
  useDeshacerCierreMaquila,
} from '@/api/cierre-maquila';
import {
  CLAVE_ENTREGAS,
  useCancelarEntrega,
  useCrearEntrega,
  useEntregasOrden,
  useSeguimientoEntrega,
  urlComprobanteEntrega,
} from '@/api/entregas-cliente';
import {
  CLAVE_ETAPAS,
  useCancelarCorte,
  useCancelarEmpaque,
  useCancelarEnvio,
  useCrearCorte,
  useCrearEmpaque,
  useCrearEnvio,
  useEtapasOrden,
  useSugerenciaCaptura,
  urlFichaEstampado,
  urlImpresoEnvio,
} from '@/api/etapas';
import { useOrden } from '@/api/ordenes';
import { CLAVE_ORDENES_CENTRO } from '@/api/ordenes-centro';
import { useProveedores, useRolesProveedor } from '@/api/proveedores';
import { CLAVE_RECIBOS, useCancelarRecibo, useCrearRecibo, urlImpresoRecibo } from '@/api/recibos';
import { useTiposProceso } from '@/api/tipos-proceso';
import type {
  CierresMaquila,
  EntregaHistorial,
  EtapaHistorial,
  PendientesRecibir,
  TipoProceso,
  WipOrden,
} from '@/api/tipos';
import { CLAVE_WIP, useWipOrden } from '@/api/wip';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { ComboboxBuscable, OpcionRica } from '@/components/dominio/ComboboxBuscable';
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
import { type ClaveEtapaAvance } from './etapas-avance';
import { ejesDeOrden, ejesDeOrdenPlegados, piezasRecibibles } from './matriz-orden';
import { useCerrarConAtras } from '@/lib/useCerrarConAtras';
import { cn } from '@/lib/utils';
import { useSesion } from '@/sesion/useSesion';

/**
 * AVANCE DE PRODUCCIÓN (rediseño R2, §4.3 — el form "Proceso" del Access, reconstruido): panel de
 * pantalla completa que se abre con DOBLE CLIC en una orden (o el botón "Registrar avance").
 *
 *  - Stepper de 6 ETAPAS (Corte / Entrega a maquila / Recibo de maquila / Entrega de Arte /
 *    Recibo de Arte / Entrega a cliente) con su avance `x/total` y color de estado. Los totales
 *    salen DERIVADOS del servidor (`wipDeOrden`, F3-E5): aquí solo se combinan (costura = procesos
 *    que meten a PT).
 *  - Cada etapa es una LISTA de movimientos (multi-proveedor, §4.3): proveedor + fecha + desglose
 *    color×talla + "capturado por · fecha" (§4.4.4) + REIMPRESIÓN del PDF + cancelar con motivo
 *    (suave, D3).
 *  - CAPTURA con candado: la matriz usa SOLO los colores/tallas de la orden (D4); pega directo a
 *    los endpoints F3 (corte/envíos/recibos/entregas) — la lógica vive en el backend (A1).
 *  - Al registrar: toast con la nota de que la Ruta Crítica se marca sola (auto-avance F3→F5).
 *  - Resumen abajo en DOS bloques: Costura y Estampado/Bordado (proto `.proc-summary`).
 *
 * ⚠️ ES LA ÚNICA PANTALLA DE CAPTURA del corte, el envío y el recibo (Daniel, `DECISIONES.md
 * §Post-F9.36 punto 2`: *"Ok. Una sola pantalla está bien."*). En V1-E3a se retiraron
 * `/produccion/{corte,envios,recibos}` DESPUÉS de migrarle aquí lo que solo ellas tenían: las
 * SEGUNDAS del recibo, los IMPRESOS (hoja de envío / ficha de arte / recibo), el PRECIO PACTADO y la
 * FECHA COMPROMISO. Y en la misma etapa entró la ENTREGA A CLIENTE, que cierra el ciclo (antes el
 * stepper terminaba en "Recibo de Arte" y el producto entraba a PT sin salir nunca).
 *
 * ⚠️ "Entrega" significa TRES cosas distintas en este módulo y las tres viven en el stepper: a
 * MAQUILA (sale material a costura), de ARTE (sale material a estampado/bordado) y a CLIENTE (sale
 * producto terminado del almacén de PT). Las etiquetas nunca dicen "Entrega" a secas.
 */

/** Clave de cada etapa del stepper (las claves viven en `etapas-avance.ts`, como datos). */
type ClaveEtapa = ClaveEtapaAvance;

/** Definición visual de las 7 etapas (orden del proto + el empaque + el cierre del ciclo). */
const ETAPAS: readonly { clave: ClaveEtapa; etiqueta: string; etiquetaProveedor: string }[] = [
  { clave: 'corte', etiqueta: 'Corte', etiquetaProveedor: 'Cortador' },
  { clave: 'entrega-maquila', etiqueta: 'Entrega a maquila', etiquetaProveedor: 'Maquilero' },
  { clave: 'recibo-maquila', etiqueta: 'Recibo de maquila', etiquetaProveedor: 'Maquilero' },
  // Vocabulario de Daniel (24-jul + 28-jul-2026): la aplicación (estampado/bordado) se llama ARTE
  // y su proveedor, Prov. de Arte. El CÓDIGO conserva `aplicacion` (es el concepto del dominio y
  // los subtipos Bordado/Estampado siguen existiendo); lo que cambia es lo que el usuario lee.
  { clave: 'entrega-aplicacion', etiqueta: 'Entrega de Arte', etiquetaProveedor: 'Prov. de Arte' },
  { clave: 'recibo-aplicacion', etiqueta: 'Recibo de Arte', etiquetaProveedor: 'Prov. de Arte' },
  // ⭐ EMPAQUE (0.114): servicio sobre la orden, hermano del corte. Va aquí porque se empaca lo que
  // ya volvió terminado, justo antes de mandarlo. No toca inventario y su cantidad es propia.
  { clave: 'empaque', etiqueta: 'Empaque', etiquetaProveedor: 'Empacador' },
  // El CIERRE del ciclo (V1-E3a): saca producto terminado del almacén de PT hacia el cliente. No
  // tiene "proveedor" — el destinatario es el cliente de la orden.
  { clave: 'entrega-cliente', etiqueta: 'Entrega a cliente', etiquetaProveedor: 'Cliente' },
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

/**
 * A qué etapa del stepper pertenece un movimiento (costura vs aplicación por `generaEntradaPt`).
 * Devuelve `null` para la entrega a cliente: NO viaja en este historial (`listarEtapasOrden` solo
 * trae cortes, envíos y recibos), sino en el suyo (`GET /ordenes/{id}/entregas`), que la etapa
 * «Entrega a cliente» del stepper consulta aparte.
 */
export function claveEtapaDeMovimiento(
  movimiento: Pick<EtapaHistorial, 'tipo' | 'idTipoProceso'>,
  esCostura: (idTipoProceso: number) => boolean,
): ClaveEtapa | null {
  if (movimiento.tipo === 'corte') return 'corte';
  // 0.114: el empaque es su propia etapa (no lleva proceso: es un servicio sobre la orden).
  if (movimiento.tipo === 'empaque') return 'empaque';
  const costura = movimiento.idTipoProceso !== null && esCostura(movimiento.idTipoProceso);
  if (movimiento.tipo === 'envio_maquila') {
    return costura ? 'entrega-maquila' : 'entrega-aplicacion';
  }
  if (movimiento.tipo === 'recibo_maquila') {
    return costura ? 'recibo-maquila' : 'recibo-aplicacion';
  }
  return null;
}

/**
 * PENDIENTE POR RECIBIR de cada bloque del resumen (costura / arte), **consumido tal cual del
 * servidor**: se SUMAN los `totalPendiente` que `wipDeOrden` ya derivó por proceso — números que
 * **ya restan las prendas incompletas** (V1-E8v, §Post-F9.147).
 *
 * 🔴 NO se calcula como `enviado − recibido`, y ésa es toda la razón de que exista esta función. La
 * DÉCIMA puerta nació justo así: el resumen restaba `enviadoCostura − recibidoCostura`, que mientras
 * `enviadoCostura` fue un despeje del pendiente daba el número correcto por casualidad, y en cuanto
 * pasó a ser SUMA DIRECTA (el arreglo de la novena puerta) empezó a devolver `enviado − buenas`,
 * **con las incompletas dentro**. La pantalla decía *«por recibir 2»* mientras el mismo panel topaba
 * la captura en 0 y el resto del producto decía 0.
 *
 * ⭐ La lección, que vale para toda la etapa: **restar dos hechos publicados es re-derivar la regla**.
 * Si el servidor ya publica el pendiente, se consume; no se reconstruye a partir de sus insumos.
 *
 * `Math.max(0, …)` se conserva por el histórico migrado (recibos sin envío dan pendiente negativo):
 * un «por recibir −3» en una tarjeta no significa nada para quien la lee.
 */
export function pendientesDesdeWip(wip: WipOrden): { costura: number; aplicacion: number } {
  const suma = (deCostura: boolean): number =>
    wip.porRecibir
      .filter((p) => p.generaEntradaPt === deCostura)
      .reduce((s, p) => s + p.totalPendiente, 0);
  return { costura: Math.max(0, suma(true)), aplicacion: Math.max(0, suma(false)) };
}

/** Totales del stepper derivados del WIP del servidor (costura = procesos que meten a PT). */
export function pasosDesdeWip(wip: WipOrden): PasoEtapa[] {
  // 🔴 `enviadoCostura` lo publica el SERVIDOR (V1-E8v, A1). Hasta esta etapa se DESPEJABA aquí como
  // `recibidoCostura + Σ totalPendiente`, que **invierte la fórmula del pendiente**: en cuanto el
  // pendiente empezó a restar las prendas incompletas (§Post-F9.147) el despeje devolvía
  // `enviado − incompletas`, y el stepper decía «Entrega a maquila 1706/1726» cuando se habían
  // mandado las 1726 — regalándole esas 20 piezas al conteo de Arte. Una regla de negocio despejada
  // en el cliente se rompe cuando la regla cambia, y nadie se entera.
  // ⚠️ Estas DOS restas sí son legítimas, y la distinción importa para no confundirlas con la décima
  // puerta: son una PARTICIÓN de un total en dos conjuntos disjuntos (lo de costura y lo demás), no
  // la re-derivación de una regla. Los dos operandos son sumas directas del servidor, ninguna
  // incompleta interviene y el resultado no es un pendiente. Lo que estaba prohibido —y rompió— era
  // restar dos hechos para reconstruir un PENDIENTE que el servidor ya publica.
  const enviadoAplicacion = wip.enviado - wip.enviadoCostura;
  const recibidoAplicacion = wip.recibido - wip.recibidoCostura;
  return [
    { clave: 'corte', etiqueta: 'Corte', hecho: wip.cortado, total: wip.pedido },
    {
      clave: 'entrega-maquila',
      etiqueta: 'Entrega a maquila',
      hecho: wip.enviadoCostura,
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
      etiqueta: 'Entrega de Arte',
      hecho: enviadoAplicacion,
      total: wip.pedido,
    },
    {
      clave: 'recibo-aplicacion',
      etiqueta: 'Recibo de Arte',
      hecho: recibidoAplicacion,
      total: wip.pedido,
    },
    // ⭐ EMPAQUE (0.114): Σ de empaques VIVOS, derivado en servidor (`wip.empacado`) — NO se despeja
    // aquí a partir de otras cifras. El denominador sigue siendo lo PEDIDO, como en todos los pasos;
    // eso sí, empacar menos que lo pedido NO es un faltante (*«se fabrican 1,000 y se empacan 990»*):
    // el paso puede cerrar la orden sin llegar al total y eso es correcto.
    {
      clave: 'empaque',
      etiqueta: 'Empaque',
      hecho: wip.empacado,
      total: wip.pedido,
    },
    // El cierre del ciclo (V1-E3a): Σ de entregas VIVAS a cliente, derivado en servidor.
    {
      clave: 'entrega-cliente',
      etiqueta: 'Entrega a cliente',
      hecho: wip.entregado,
      total: wip.pedido,
    },
  ];
}

/** Props del panel de avance. */
export interface PropsAvanceProduccion {
  idOrden: number;
  /** Folio del pedido interno (el `-F`), si el llamador lo conoce (encabezado). */
  folioPedido?: number | null;
  /**
   * Etapa en la que abre el stepper (default `corte`). La usa quien manda al usuario a registrar UN
   * paso concreto —hoy la bandeja de la Ruta Crítica, vía `state.etapaAvance`—: un pendiente de
   * «recibo de estampado» debe aterrizar en esa etapa, no en Corte (V1-E3a).
   */
  etapaInicial?: ClaveEtapa;
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
  etapaInicial = 'corte',
  alCerrar,
}: PropsAvanceProduccion): React.JSX.Element {
  const { tienePermiso } = useSesion();
  // El panel solo existe montado (el llamador lo renderiza condicionalmente): siempre está abierto.
  useCerrarConAtras(true, alCerrar);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const orden = useOrden(idOrden);
  const wip = useWipOrden(idOrden);
  const etapas = useEtapasOrden(idOrden, true, true);
  const procesos = useTiposProceso({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });

  const [etapaActiva, setEtapaActiva] = useState<ClaveEtapa>(etapaInicial);
  const [capturaAbierta, setCapturaAbierta] = useState(false);
  const [aCancelar, setACancelar] = useState<MovimientoACancelar | null>(null);
  /**
   * Movimiento RECIÉN guardado en esta sesión del panel (V1-E3a): la barra que aparece bajo el
   * encabezado de la etapa ofrece su PDF en el momento — es el papel que va con el bulto al
   * maquilero. No sustituye a la reimpresión de la lista (que sirve para siempre): esto es para no
   * tener que buscarlo justo después de capturarlo, como hacían las pantallas viejas.
   */
  const [recienGuardado, setRecienGuardado] = useState<MovimientoImpreso | null>(null);
  /**
   * Proveedor elegido DENTRO de la captura abierta, levantado hasta aquí (§Post-F9.13): los puentes
   * a inventario ("descargar tela" / "mandar tela al cortador") viven en esta barra, arriba de la
   * captura, y necesitan saber a qué cortador se le está registrando el corte. Se limpia al
   * cambiar de etapa o al cerrar la captura para no arrastrar un cortador que ya no está a la vista.
   */
  const [proveedorEnCaptura, setProveedorEnCaptura] = useState<number | null>(null);
  useEffect(() => {
    if (!capturaAbierta) {
      setProveedorEnCaptura(null);
    }
  }, [capturaAbierta, etapaActiva]);
  // La barra del "recién guardado" pertenece a SU etapa: al cambiar de etapa se limpia para no
  // ofrecer el PDF de un envío estando parado en el recibo.
  useEffect(() => {
    setRecienGuardado(null);
  }, [etapaActiva]);

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

  // Entregas a cliente: viven en SU historial (otro endpoint), así que solo se consultan estando
  // parado en esa etapa — el total del stepper ya lo trae el WIP (`entregado`).
  const esEtapaEntrega = etapaActiva === 'entrega-cliente';
  const entregas = useEntregasOrden(idOrden, esEtapaEntrega);

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
      queryClient.invalidateQueries({ queryKey: CLAVE_ENTREGAS }),
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
                setRecienGuardado(null);
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
              {/* CORTAR = DESCARGAR TELA (petición de Daniel, 28-jul-2026: *"a la hora de cortar es
                  necesario descargar la tela de los inventarios… estaría bueno que en el mismo
                  avance de producción podamos poner un enlace"*). No se duplica la captura: se va a
                  la pantalla que YA es la única vía que descuenta tela hacia una orden (F4-E1),
                  llevándose la orden puesta. La otra vía —la nota de salida abierta— sigue viviendo
                  en su módulo, porque no cuelga de una orden. */}
              {etapaActiva === 'corte' && tienePermiso('inventario-telas.mover') ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() => {
                    // Salir de aquí es una NAVEGACIÓN de verdad: el panel de avance no es una ruta,
                    // así que la captura abierta se pierde y no se reabre al volver. Con la matriz
                    // ya tecleada (decenas de celdas en una orden real) hay que preguntar antes
                    // (hallazgo del reviewer).
                    if (
                      capturaAbierta &&
                      !window.confirm(
                        'Se va a salir del avance para descargar la tela y se perderá lo que ' +
                          'lleves capturado en el corte. ¿Continuar?',
                      )
                    ) {
                      return;
                    }
                    // §Post-F9.13: si ya se eligió el cortador, viaja con la orden para que la
                    // salida arranque en SU almacén (el ligado en el catálogo). Sin cortador
                    // elegido todavía, el enlace sigue funcionando igual que antes.
                    void navigate('/inventarios/telas/salida-orden', {
                      state: {
                        idOrden,
                        ...(proveedorEnCaptura === null ? {} : { idCortador: proveedorEnCaptura }),
                      },
                    });
                  }}
                  data-testid="avance-descargar-tela"
                >
                  <Scissors aria-hidden />
                  Descargar tela del inventario
                </Button>
              ) : null}
              {/* §Post-F9.13 (Daniel): "de ahí le mando la tela a un cortador y en ese momento
                  debo de hacer el movimiento entre almacenes al almacén del cortador para poder
                  descargarlo de ese almacén". El traspaso ANTECEDE a la descarga, así que el
                  atajo vive junto a ella y llega con el destino ya puesto. */}
              {etapaActiva === 'corte' &&
              proveedorEnCaptura !== null &&
              tienePermiso('inventario-telas.mover') ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (
                      capturaAbierta &&
                      !window.confirm(
                        'Se va a salir del avance para traspasar la tela y se perderá lo que ' +
                          'lleves capturado en el corte. ¿Continuar?',
                      )
                    ) {
                      return;
                    }
                    void navigate('/inventarios/telas/traspaso', {
                      state: { idCortador: proveedorEnCaptura },
                    });
                  }}
                  data-testid="avance-traspasar-tela"
                >
                  <Scissors aria-hidden />
                  Mandar tela al cortador
                </Button>
              ) : null}
              {puedeCapturar(etapaActiva, tienePermiso) ? (
                <Button
                  size="sm"
                  className={cn(
                    etapaActiva === 'corte' && tienePermiso('inventario-telas.mover')
                      ? ''
                      : 'ml-auto',
                  )}
                  onClick={() => setCapturaAbierta((v) => !v)}
                  data-testid="avance-abrir-captura"
                >
                  <Plus aria-hidden />
                  Registrar {definicion.etiqueta.toLowerCase()}
                </Button>
              ) : null}
            </div>

            {/* Barra del movimiento RECIÉN guardado: su PDF, en el momento (V1-E3a). Solo aparece
                si hay algo que imprimir — el CORTE no tiene impreso propio, y una barra sin acción
                no aporta nada sobre el aviso y el renglón que ya salieron en la lista. */}
            {recienGuardado !== null && recienGuardado.impresos.length > 0 ? (
              <div
                className="flex flex-wrap items-center gap-3 border-b bg-panel-2 px-4 py-2.5"
                data-testid="avance-recien-guardado"
              >
                <span className="text-sm font-medium">
                  {recienGuardado.etiqueta} #{recienGuardado.folio} guardado
                </span>
                <BotonesImpresos movimiento={recienGuardado} />
              </div>
            ) : null}

            {capturaAbierta && orden.data !== undefined && wip.data !== undefined ? (
              esEtapaEntrega ? (
                <CapturaEntregaCliente
                  orden={orden.data}
                  alRegistrado={(guardado) => {
                    setCapturaAbierta(false);
                    setRecienGuardado(guardado);
                    void refrescarTodo();
                  }}
                  alCancelar={() => setCapturaAbierta(false)}
                />
              ) : (
                <CapturaMovimiento
                  etapa={etapaActiva}
                  orden={orden.data}
                  wip={wip.data}
                  procesos={procesos.data?.datos ?? []}
                  procesosConError={procesos.isError}
                  alReintentarProcesos={() => void procesos.refetch()}
                  alElegirProveedor={setProveedorEnCaptura}
                  alRegistrado={(guardado) => {
                    setCapturaAbierta(false);
                    setRecienGuardado(guardado);
                    void refrescarTodo();
                  }}
                  alCancelar={() => setCapturaAbierta(false)}
                />
              )
            ) : null}

            {esEtapaEntrega ? (
              <ListaEntregas
                entregas={entregas.data?.entregas ?? []}
                cargando={entregas.isPending}
                puedeImprimir={tienePermiso('produccion.entrega')}
                puedeCancelar={tienePermiso('produccion.cancelar')}
                alCancelar={setACancelar}
              />
            ) : (
              <ListaMovimientos
                movimientos={movimientos}
                etiquetaProveedor={definicion.etiquetaProveedor}
                conTipo={
                  etapaActiva === 'entrega-aplicacion' || etapaActiva === 'recibo-aplicacion'
                }
                cargando={etapas.isPending}
                etiquetaEtapa={definicion.etiqueta}
                puedeCancelar={tienePermiso('produccion.cancelar')}
                alCancelar={setACancelar}
              />
            )}
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
        alCancelado={(cancelado) => {
          // Si lo que se acaba de cancelar es EL movimiento de la barra del "recién guardado", la
          // barra se va con él: si no, seguiría ofreciendo el PDF de un movimiento cancelado — justo
          // lo que la lista evita a propósito («su papel no debe volver a salir con un bulto»).
          setRecienGuardado((actual) =>
            actual !== null && actual.id === cancelado.id ? null : actual,
          );
          void refrescarTodo();
        }}
      />
    </div>
  );
}

/**
 * ¿La sesión puede capturar la etapa activa? (la pantalla esconde; el servidor decide, A1). Los
 * permisos son los MISMOS que exigía cada pantalla retirada, sin ensancharlos (A4).
 */
function puedeCapturar(
  etapa: ClaveEtapa,
  tienePermiso: (
    clave:
      | 'produccion.corte'
      | 'produccion.empaque'
      | 'produccion.envio'
      | 'produccion.recibo'
      | 'produccion.entrega',
  ) => boolean,
): boolean {
  if (etapa === 'corte') return tienePermiso('produccion.corte');
  // 0.114: el empaque tiene permiso PROPIO (no reusa el del corte): son dos actos, dos servicios y
  // dos proveedores distintos, y quien captura uno no tiene por qué poder capturar el otro.
  if (etapa === 'empaque') return tienePermiso('produccion.empaque');
  if (etapa === 'entrega-maquila' || etapa === 'entrega-aplicacion') {
    return tienePermiso('produccion.envio');
  }
  if (etapa === 'entrega-cliente') return tienePermiso('produccion.entrega');
  return tienePermiso('produccion.recibo');
}

/** Un movimiento con PDF: lo que la barra del "recién guardado" y la lista necesitan para imprimir. */
interface MovimientoImpreso {
  id: number;
  folio: number;
  /** Cómo se nombra en el aviso ("Envío", "Recibo", "Corte", "Entrega"). */
  etiqueta: string;
  /** Qué impresos ofrece: el corte no tiene ninguno. */
  impresos: readonly { clave: string; etiqueta: string; url: string; icono: 'pdf' | 'ficha' }[];
}

/** Movimiento a cancelar (etapa o entrega): el diálogo despacha por `tipo`. */
interface MovimientoACancelar {
  id: number;
  folio: number;
  tipo: EtapaHistorial['tipo'];
}

/**
 * Impresos de un ENVÍO: la hoja que va con el bulto y, si es de arte, su ficha. `conFicha` la pide
 * solo en las etapas de ARTE — en costura la ficha de estampado no dice nada.
 */
function impresosDeEnvio(id: number, conFicha: boolean): MovimientoImpreso['impresos'] {
  const hoja = {
    clave: 'envio',
    etiqueta: 'Hoja de envío',
    url: urlImpresoEnvio(id),
    icono: 'pdf' as const,
  };
  return conFicha
    ? [
        hoja,
        { clave: 'ficha', etiqueta: 'Ficha de arte', url: urlFichaEstampado(id), icono: 'ficha' },
      ]
    : [hoja];
}

/** Botones de descarga de los impresos de un movimiento (se abren en otra pestaña). */
function BotonesImpresos({
  movimiento,
  compactos = false,
}: {
  movimiento: MovimientoImpreso;
  compactos?: boolean;
}): React.JSX.Element | null {
  if (movimiento.impresos.length === 0) {
    return null;
  }
  return (
    <>
      {movimiento.impresos.map((impreso) => {
        const Icono = impreso.icono === 'ficha' ? FileText : Printer;
        return compactos ? (
          <Button
            key={impreso.clave}
            variant="ghost"
            size="icon"
            onClick={() => window.open(impreso.url, '_blank', 'noopener')}
            aria-label={`${impreso.etiqueta} del movimiento ${movimiento.folio}`}
            title={impreso.etiqueta}
            data-testid={`avance-imprimir-${impreso.clave}`}
          >
            <Icono className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button
            key={impreso.clave}
            variant="outline"
            size="sm"
            onClick={() => window.open(impreso.url, '_blank', 'noopener')}
            data-testid={`avance-imprimir-${impreso.clave}`}
          >
            <Icono className="size-4" aria-hidden />
            {impreso.etiqueta}
          </Button>
        );
      })}
    </>
  );
}

/**
 * Lista de MOVIMIENTOS de una etapa (proveedor + fecha + total + capturó + REIMPRESIÓN +
 * cancelación).
 *
 * La REIMPRESIÓN (V1-E3a) es la única vía de recuperar el papel de un movimiento viejo: antes los
 * PDF solo se ofrecían para el movimiento "recién guardado", así que al cerrar la pantalla la hoja
 * de envío del bulto ya no se recuperaba desde la app. Los movimientos CANCELADOS no se imprimen a
 * propósito: su papel no debe volver a salir con un bulto.
 */
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
  alCancelar: (movimiento: MovimientoACancelar) => void;
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
            <th className="px-3 py-1.5 text-right">Imprimir / cancelar</th>
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
              <td className="px-2 py-1.5 text-right whitespace-nowrap">
                {m.cancelado ? null : (
                  <BotonesImpresos movimiento={impresoDeMovimiento(m, conTipo)} compactos />
                )}
                {puedeCancelar && !m.cancelado ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => alCancelar({ id: m.id, folio: m.folio, tipo: m.tipo })}
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

/**
 * AVISO REINTENTABLE de los catálogos de la captura (V1-E3a). Las tres pantallas retiradas lo
 * tenían y el panel no: si fallaba la lectura de procesos / roles / proveedores / almacenes, el
 * combobox se quedaba vacío diciendo *"Sin coincidencias"* —que es MENTIRA: no es que no haya, es
 * que no se pudo leer— y sin forma de reintentar salvo recargar. Mismo criterio que ya se fijó en
 * compras (§V1-E2): un error de lectura se DICE, no se disfraza.
 */
function AvisoCatalogos({
  hayError,
  alReintentar,
  que,
}: {
  hayError: boolean;
  alReintentar: () => void;
  /** Qué catálogos cubre el aviso (para nombrarlos en el mensaje). */
  que: string;
}): React.JSX.Element | null {
  if (!hayError) {
    return null;
  }
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2"
      role="alert"
      data-testid="avance-error-catalogo"
    >
      <p className="text-sm text-destructive">
        No se pudieron cargar los catálogos de la captura ({que}). Las listas pueden verse vacías:
        no es que no haya datos, es que no se pudieron leer.
      </p>
      <Button variant="outline" size="sm" onClick={alReintentar} data-testid="avance-reintentar">
        Reintentar
      </Button>
    </div>
  );
}

/**
 * Impresos de un movimiento del historial de etapas. Ni el CORTE ni el EMPAQUE tienen impreso propio
 * (no acompañan un bulto: no sale ni entra mercancía), así que su lista va vacía y la barra del
 * "recién guardado" ni siquiera se pinta.
 */
function impresoDeMovimiento(m: EtapaHistorial, esArte: boolean): MovimientoImpreso {
  if (m.tipo === 'envio_maquila') {
    return { id: m.id, folio: m.folio, etiqueta: 'Envío', impresos: impresosDeEnvio(m.id, esArte) };
  }
  if (m.tipo === 'recibo_maquila') {
    return {
      id: m.id,
      folio: m.folio,
      etiqueta: 'Recibo',
      impresos: [
        { clave: 'recibo', etiqueta: 'PDF del recibo', url: urlImpresoRecibo(m.id), icono: 'pdf' },
      ],
    };
  }
  if (m.tipo === 'empaque') {
    return { id: m.id, folio: m.folio, etiqueta: 'Empaque', impresos: [] };
  }
  return { id: m.id, folio: m.folio, etiqueta: 'Corte', impresos: [] };
}

/**
 * Lista de ENTREGAS A CLIENTE de la orden (V1-E3a): cierre del ciclo. Vivas y canceladas (las
 * canceladas se conservan, D3), con su comprobante PDF reimprimible y la cancelación con motivo
 * (el backend revierte la salida de PT con un movimiento inverso).
 */
function ListaEntregas({
  entregas,
  cargando,
  puedeImprimir,
  puedeCancelar,
  alCancelar,
}: {
  entregas: readonly EntregaHistorial[];
  cargando: boolean;
  /**
   * El comprobante de la entrega exige `produccion.entrega` en el SERVIDOR (a diferencia de los
   * otros tres impresos, que van con `produccion.wip-ver` como esta lista). Sin este gate, quien
   * solo consulta veía la impresora y el clic le abría una pestaña con un 403.
   */
  puedeImprimir: boolean;
  puedeCancelar: boolean;
  alCancelar: (movimiento: MovimientoACancelar) => void;
}): React.JSX.Element {
  if (cargando) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">Cargando entregas…</p>;
  }
  if (entregas.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground" data-testid="avance-etapa-vacia">
        Aún no se entrega nada al cliente de esta orden.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-secondary text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <th className="px-3 py-1.5 text-left">Fecha</th>
            <th className="px-3 py-1.5 text-left">Cliente</th>
            <th className="px-3 py-1.5 text-left">Almacén de salida</th>
            <th className="px-3 py-1.5 text-right">Cantidad</th>
            <th className="px-3 py-1.5 text-left">Observaciones</th>
            <th className="px-3 py-1.5 text-right">Imprimir / cancelar</th>
          </tr>
        </thead>
        <tbody>
          {entregas.map((e) => (
            <tr
              key={e.id}
              className={cn('border-b', e.cancelado && 'opacity-55')}
              data-testid="avance-entrega"
            >
              <td className="num px-3 py-1.5 whitespace-nowrap">{fechaCorta(e.fecha)}</td>
              <td className="px-3 py-1.5 font-medium">{e.cliente ?? '—'}</td>
              <td className="px-3 py-1.5 text-muted-foreground">{e.almacen ?? '—'}</td>
              <td className="num px-3 py-1.5 text-right font-semibold">
                {e.totalPiezas.toLocaleString('es-MX')}
              </td>
              <td className="max-w-48 truncate px-3 py-1.5 text-xs text-muted-foreground">
                {e.cancelado ? (
                  <span className="text-crit">
                    Cancelada: {e.motivoCancelacion ?? 'sin motivo'}
                  </span>
                ) : (
                  (e.observaciones ?? '—')
                )}
              </td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap">
                {e.cancelado || !puedeImprimir ? null : (
                  <BotonesImpresos movimiento={impresoDeEntrega(e.id, e.folio)} compactos />
                )}
                {puedeCancelar && !e.cancelado ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      alCancelar({ id: e.id, folio: e.folio, tipo: 'entrega_cliente' })
                    }
                    aria-label={`Cancelar la entrega ${e.folio}`}
                    data-testid="avance-cancelar-entrega"
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

/** Impreso de una entrega a cliente: su comprobante (el que firma quien recibe). */
function impresoDeEntrega(id: number, folio: number): MovimientoImpreso {
  return {
    id,
    folio,
    etiqueta: 'Entrega',
    impresos: [
      {
        clave: 'entrega',
        etiqueta: 'Comprobante de entrega',
        url: urlComprobanteEntrega(id),
        icono: 'pdf',
      },
    ],
  };
}

/** Captura de un movimiento nuevo de la etapa activa (matriz con candado + proveedor + fecha). */
function CapturaMovimiento({
  etapa,
  orden,
  wip,
  procesos,
  procesosConError,
  alReintentarProcesos,
  alElegirProveedor,
  alRegistrado,
  alCancelar,
}: {
  etapa: ClaveEtapa;
  orden: NonNullable<ReturnType<typeof useOrden>['data']>;
  wip: WipOrden;
  procesos: readonly TipoProceso[];
  /** ¿Falló la lectura del catálogo de procesos? (lo consulta el panel, no esta captura). */
  procesosConError: boolean;
  /** Reintenta la lectura de procesos del panel (se une al Reintentar del aviso). */
  alReintentarProcesos: () => void;
  /**
   * Avisa al panel qué proveedor está elegido (§Post-F9.13): los puentes a inventario viven en la
   * barra de arriba y necesitan el cortador para llevarse SU almacén.
   */
  alElegirProveedor: (id: number | null) => void;
  /** Avisa qué se guardó, para ofrecer su impreso en el momento. */
  alRegistrado: (guardado: MovimientoImpreso) => void;
  /** Cierra la captura sin guardar (botón "Cancelar" del proto). */
  alCancelar: () => void;
}): React.JSX.Element {
  const { sesion } = useSesion();
  const [fecha, setFecha] = useState(hoy());
  // ENTREGA A MAQUILA: arranca con el maquilero YA PROGRAMADO en la OP (petición de Daniel,
  // 28-jul-2026: *"si ya tengo un maquilero programado en la OP… que me ponga por default el
  // maquilero que ya estaba definido"*). Es un default editable, no un candado. Solo aplica a
  // costura: la OP no programa Prov. de Arte (el que se ve en el Centro sale del primer envío).
  const [idProveedor, setIdProveedor] = useState<number | null>(
    etapa === 'entrega-maquila' ? (orden.idMaquilero ?? null) : null,
  );
  const [idProcesoAplicacion, setIdProcesoAplicacion] = useState<string>('');
  // Espeja el proveedor elegido hacia el panel (los puentes a inventario están fuera de aquí).
  useEffect(() => {
    alElegirProveedor(idProveedor);
  }, [idProveedor, alElegirProveedor]);
  const [observaciones, setObservaciones] = useState('');
  const [valores, setValores] = useState<Record<string, number>>({});
  const [idAlmacenPrimeras, setIdAlmacenPrimeras] = useState<string>('');
  const [idAlmacenSegundas, setIdAlmacenSegundas] = useState<string>('');
  /**
   * V1-E4b (§Post-F9.61) — ENVÍO DE PRENDAS YA TERMINADAS. `null` = "lo que sugiera la orden": el
   * valor efectivo se deriva más abajo (`prendaTerminada`) y esto solo guarda la decisión EXPLÍCITA
   * del usuario. Así el default puede seguir a la orden sin que un `useEffect` le pise la elección.
   */
  const [prendaTerminadaElegida, setPrendaTerminadaElegida] = useState<boolean | null>(null);
  const [idAlmacenOrigen, setIdAlmacenOrigen] = useState<string>('');
  /**
   * V1-E4b (hallazgo H1) — de QUÉ BUCKET de existencia salen las prendas. El inventario de PT se
   * lleva por modelo×color×talla×ORDEN×almacén, y el bucket «sin orden asignada» es donde vive TODO
   * el histórico migrado y TODO lo que se capture en el inventario físico de arranque. Sin poder
   * elegirlo, ese stock —que es el que hay el día uno— era inalcanzable desde esta pantalla.
   */
  const [stockSinOrdenElegido, setStockSinOrdenElegido] = useState<boolean | null>(null);
  /**
   * PRECIO PACTADO y FECHA COMPROMISO (migrados de las pantallas retiradas en V1-E3a): el precio de
   * maquila de ESTE movimiento — sin él el cargo EsMa nace sin precio y hay que teclearlo aparte, la
   * doble captura que v2 elimina. El campo se esconde sin `ordenes.ver-precio-real-maquila` porque
   * es el precio real de maquila (R2 §4.4.3, mismo gate con el que el backend REDACTA el dato).
   */
  const [precioPactado, setPrecioPactado] = useState('');
  const [fechaCompromiso, setFechaCompromiso] = useState('');
  /** SEGUNDAS del recibo (migradas de `/produccion/recibos`): por celda, primeras = total − segundas. */
  const [capturarSegundas, setCapturarSegundas] = useState(false);
  const [segundas, setSegundas] = useState<Record<string, number>>({});
  /**
   * PRENDAS INCOMPLETAS del recibo (V1-E8k, §Post-F9.136). Son prendas a las que les faltó una
   * pieza y nunca se terminaron de coser: el maquilero las trae de vuelta —Daniel se las exige
   * porque el faltante se le cobra— pero **no cuentan como producidas, no entran a inventario y no
   * se pagan**. Por eso viajan en su PROPIO campo del API (`cantidadIncompletas`), nunca sumadas a
   * la cantidad recibida: toda pieza que entre ahí se cobra y se inventaría.
   */
  const [capturarIncompletas, setCapturarIncompletas] = useState(false);
  const [incompletas, setIncompletas] = useState<Record<string, number>>({});
  /**
   * RECIBO CON LOS TENDIDOS REVUELTOS (§Post-F9.10) — *«que sea **opcional al recibir**»* (Daniel).
   * El maquilero pudo devolver los packs separados (se captura cada tendido con su letra) o
   * revueltos (se captura SIN pack, en un solo renglón por color). Con esto encendido la matriz
   * pliega los tendidos en una fila por color y lo capturado viaja sin pack, que es lo que el
   * dominio lee como «no sé de qué tendido es»: ese renglón consume del saldo AGREGADO de todos los
   * packs, no del de ninguno.
   */
  const [revueltos, setRevueltos] = useState(false);
  // El typeahead busca EN SERVIDOR (hay >1,700 maquileros reales; la página local de 100 no basta).
  const [textoProveedor, setTextoProveedor] = useState('');
  const busquedaProveedor = useDebounce(textoProveedor.trim(), 250);

  const crearCorte = useCrearCorte();
  const crearEmpaque = useCrearEmpaque();
  const crearEnvio = useCrearEnvio();
  const crearRecibo = useCrearRecibo();

  const esAplicacion = etapa === 'entrega-aplicacion' || etapa === 'recibo-aplicacion';
  const esRecibo = etapa === 'recibo-maquila' || etapa === 'recibo-aplicacion';
  /**
   * ⭐ Los dos SERVICIOS SOBRE LA ORDEN (0.114): corte y empaque. Comparten forma —no llevan proceso
   * de maquila, no tocan inventario, llevan precio por prenda y generan su cargo— y por eso la
   * captura los trata igual salvo en el rol del proveedor y en el endpoint al que pega.
   */
  const esServicio = etapa === 'corte' || etapa === 'empaque';
  /** ¿Es un ENVÍO a maquila? (los únicos que llevan fecha compromiso y bandera de prenda terminada). */
  const esEnvio = etapa === 'entrega-maquila' || etapa === 'entrega-aplicacion';

  // Procesos de APLICACIÓN (estampado/bordado/…): los que NO meten a PT. El de COSTURA es el que sí.
  const procesosAplicacion = procesos.filter((p) => !p.generaEntradaPt && p.activo);
  /**
   * ⚠️ LIMITACIÓN CONOCIDA (anotada en V1-E3a): las etapas de COSTURA no ofrecen selector de
   * proceso — toman **el primer** TipoProceso activo con `generaEntradaPt`. El modelo de datos
   * admite VARIOS (la bandera es una columna de `TipoProceso`, no un único registro), así que con
   * dos procesos que metan a PT el panel los confundiría en una sola etapa. Antes existía escape:
   * `/produccion/{envios,recibos}` tenían un `<select>` de proceso y se elegía a mano; al retirarlas
   * (una sola pantalla por acto) ese escape desapareció. Hoy NO afecta —el seed y el ETL dejan un
   * solo proceso `generaEntradaPt` (costura)— y por eso no se resuelve aquí; el arreglo correcto es
   * un selector de proceso en las etapas de costura, como el que ya tienen las de Arte. Si algún día
   * se da de alta un segundo proceso que meta a PT, esto hay que hacerlo ANTES.
   * (`porRecibir` sí desambigua por orden ya usada: ver `procesoParaGuardar`.)
   */
  const procesoCostura = procesos.find((p) => p.generaEntradaPt && p.activo);
  const procesoElegido = esAplicacion
    ? procesos.find((p) => String(p.id) === idProcesoAplicacion)
    : procesoCostura;

  // Proveedores filtrados por el ROL de la etapa (D12/R15; el servidor re-valida).
  const roles = useRolesProveedor();
  const codigoRol =
    // 0.114: el rol de un servicio ES su clave de etapa (`corte` → rol `corte`, `empaque` → rol
    // `empaque`). El servidor lo re-valida (`exigirTerceroConRol`): esta lista es la comodidad.
    esServicio
      ? etapa
      : procesoElegido === undefined
        ? undefined
        : rolDelProceso(procesoElegido.codigo);
  const idRol =
    codigoRol === undefined ? undefined : roles.data?.find((r) => r.codigo === codigoRol)?.id;
  // En el RECIBO la lista sale del WIP (los que tienen entrega viva), así que el catálogo ni se
  // consulta: la consulta queda deshabilitada en vez de traer 100 proveedores que nadie mira.
  const proveedores = useProveedores(
    {
      pagina: 1,
      porPagina: 100,
      ordenarPor: 'nombre',
      direccion: 'asc',
      ...(idRol === undefined ? {} : { rol: idRol }),
      ...(busquedaProveedor === '' ? {} : { busqueda: busquedaProveedor }),
    },
    { enabled: !esRecibo },
  );

  // ── RECIBO: solo los maquileros a los que SÍ se les entregó ─────────────────────────────────
  // Regla de Daniel (28-jul-2026): *"no puedo recibir un corte de un maquilero diferente al que se
  // lo entregué"*. El desglose `porMaquilero` (enviado − recibido − incompletas − saldados POR
  // TERCERO) lo deriva el
  // servidor (A1/B2); aquí NO se pivotea nada. El servidor además lo RE-VALIDA al guardar: esta
  // lista es la comodidad, no el candado. Se ofrecen solo los maquileros a los que TODAVÍA SE LES
  // PUEDE RECIBIR algo — que desde V1-E8v (§Post-F9.147) es EXACTAMENTE «los que aún deben piezas»:
  // quien devolvió 8 buenas + 2 incompletas de 10 ya entregó las 10 y no se le ofrece. El pendiente
  // (`cantidad`) y el tope de captura son el MISMO número desde que la incompleta sale del tránsito.
  const entradaRecibo = esRecibo
    ? wip.porRecibir.find((p) =>
        etapa === 'recibo-maquila'
          ? p.generaEntradaPt
          : String(p.idTipoProceso) === idProcesoAplicacion,
      )
    : undefined;
  // Se mira `celdas`, no el total: en el histórico migrado un maquilero puede traer +5 en una talla
  // y −5 en otra (recibo capturado en la talla equivocada en el Access) → total 0 pero el servidor
  // SÍ aceptaría recibirle esas 5 (hallazgo del reviewer).
  const maquilerosRecibibles = (entradaRecibo?.porMaquilero ?? []).filter(
    (m): m is typeof m & { idMaquilero: number } =>
      m.idMaquilero !== null && m.celdas.some((c) => c.cantidad > 0),
  );
  // Entrega migrada SIN maquilero (`idTercero` NULL): no hay a quién recibirle, pero el pendiente
  // EXISTE — se dice, en vez de fingir que no hay nada que recibir (hallazgo del reviewer).
  const pendienteSinMaquilero = (entradaRecibo?.porMaquilero ?? [])
    .filter((m) => m.idMaquilero === null)
    .reduce((s, m) => s + piezasRecibibles(m.celdas), 0);

  const opcionesProveedor: { id: number; nombre: string; pendiente: number | undefined }[] =
    esRecibo
      ? maquilerosRecibibles.map((m) => ({
          id: m.idMaquilero,
          nombre: m.maquilero,
          pendiente: piezasRecibibles(m.celdas),
        }))
      : (proveedores.data?.datos ?? []).map((p) => ({
          id: p.id,
          nombre: p.nombre,
          pendiente: undefined,
        }));

  // Almacenes destino (solo el recibo de COSTURA mete a PT).
  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  // El almacén de TRÁNSITO se EXCLUYE de TODOS los selectores (V1-E4b, hallazgo H5 del reviewer):
  // guarda lo que está físicamente en el taller de un tercero, y el servidor lo rechaza tanto de
  // origen (entrega a cliente) como de destino (recibo). Ofrecerlo solo servía para cosechar un 400
  // con la matriz ya tecleada. Las prendas que no vuelvan salen de ahí por un movimiento manual de
  // inventario, con su motivo — no por estas pantallas.
  const almacenesPt = (almacenes.data?.datos ?? []).filter(
    (a) => a.tipo === 'PT' && a.activo && !a.esTransitoProceso,
  );

  // ── V1-E4b · el tránsito de prendas a proceso (§Post-F9.61) ────────────────────────────────────
  // Cuando un proceso de ARTE va DESPUÉS de la costura, lo que se manda ya es producto terminado:
  // el envío lo SACA del almacén hacia el tránsito y el recibo lo devuelve (primeras y segundas a
  // su almacén; lo que no vuelve se queda vivo en tránsito). Aquí se resuelven las dos caras:
  //
  //  • ENVÍO: la bandera `prendaTerminada` + de qué almacén salen. El default SIGUE A LA ORDEN (si
  //    ya hay envíos de ese proceso, el mismo valor que ellos —el servidor no deja mezclarlos—; si
  //    no, "sí" en cuanto la orden ya tenga prendas recibidas de costura, que es justo el caso que
  //    Daniel hace hoy). Dejarlo apagado por default sería volver al inventario que miente.
  //  • RECIBO: si el envío sacó del almacén, este recibo DEVUELVE mercancía y por lo tanto pide
  //    almacén destino, aunque el proceso no sea el que crea el PT (`devuelveAPt`, del servidor).
  const procesoYaEnviado =
    procesoElegido === undefined
      ? undefined
      : wip.porRecibir.find((p) => p.idTipoProceso === procesoElegido.id);
  const devuelveAPt = procesoYaEnviado?.devuelveAPt === true;
  /** ¿La bandera del envío ya está decidida por los envíos vivos del proceso? (no se puede mezclar) */
  const prendaTerminadaFijada = procesoYaEnviado !== undefined;
  const prendaTerminada =
    etapa !== 'entrega-aplicacion'
      ? false
      : prendaTerminadaFijada
        ? devuelveAPt
        : (prendaTerminadaElegida ?? wip.recibidoCostura > 0);
  // El bucket también queda FIJADO por las entregas vivas del proceso (el servidor no deja mezclar
  // dos formas distintas: el recibo no sabría a qué bucket regresar las piezas). Default: el de la
  // orden, que es lo correcto para todo lo que este sistema produjo.
  const stockSinOrden =
    prendaTerminada &&
    (prendaTerminadaFijada
      ? procesoYaEnviado?.stockSinOrden === true
      : (stockSinOrdenElegido ?? false));

  const requiereAlmacen = etapa === 'recibo-maquila' || (esRecibo && devuelveAPt);

  // Aviso REINTENTABLE de los catálogos de la captura (ver `AvisoCatalogos`). `proveedores` solo
  // cuenta cuando de verdad se consulta (en el recibo la lista sale del WIP y va deshabilitada).
  const catalogoConError =
    procesosConError || roles.isError || (!esRecibo && proveedores.isError) || almacenes.isError;
  function reintentarCatalogos(): void {
    alReintentarProcesos();
    void roles.refetch();
    if (!esRecibo) {
      void proveedores.refetch();
    }
    void almacenes.refetch();
  }

  /**
   * ¿La orden se fabrica POR TENDIDOS? (§Post-F9.10). Basta con que UN renglón traiga pack — la
   * MISMA pregunta (y la misma forma de contestarla) que `packs.ts::ordenManejaPacks` en el
   * servidor, de la que cuelga que el pack sea obligatorio en el corte y en la entrega a maquila.
   */
  const manejaPacks = orden.lineas.some((l) => l.pack !== '');
  /** ¿ESTA captura se lleva sin distinguir tendido? Sólo el recibo puede, y sólo si hay tendidos. */
  const sinDistinguirPack = esRecibo && manejaPacks && revueltos;

  // Matriz de la orden (candado D4): filas/columnas fijas. Una fila por COLOR × PACK — salvo en el
  // recibo «revueltos», donde los tendidos se pliegan en una fila por color (§Post-F9.10).
  const { tallas, colores } = useMemo(
    () => (sinDistinguirPack ? ejesDeOrdenPlegados(orden) : ejesDeOrden(orden)),
    [orden, sinDistinguirPack],
  );

  // Referencia (pendiente) por celda de la etapa activa, DERIVADA del WIP del servidor.
  //
  // `null` = sin referencia (estado NEUTRO en la matriz). Se usa SOLO en el RECIBO: el WIP enumera
  // en `porRecibir` únicamente los procesos YA USADOS, así que del primer recibo de un proceso —o
  // de un maquilero sin entrega viva— no hay NADA contra qué comparar, y validar contra un 0 sería
  // inventarse un tope ("Sobran N" falso, hallazgo del reviewer).
  //
  // En el ENVÍO NUNCA es null: el disponible real siempre es derivable —lo CORTADO por celda
  // (matriz de la orden − `porCortar`)— y `porCortar` sí trae TODAS las celdas de la orden, con
  // ceros incluidos (`wip.ts` lo arma sobre pedido ∪ cortado sin filtrarlos). Con la orden sin
  // cortar, la referencia legítima es 0 en cada celda: no se puede enviar a maquila lo que no se ha
  // cortado (decisión (g), que el servidor rechaza bajo lock). Descartar ese mapa dejaba pasar la
  // captura entera para que el 400 llegara después, con la matriz ya tecleada.
  const referencia = useMemo<Map<string, number> | null>(() => {
    const mapa = new Map<string, number>();
    // ⭐ EMPAQUE (0.114): SIN referencia por celda, a propósito. Su cantidad es PROPIA —*«se fabrican
    // 1,000 y se empacan 990; se paga lo empacado y las 10 se quedan quietas en inventario»*— así
    // que no hay un pendiente contra el que topar cada celda. Pintar la matriz contra lo recibido
    // marcaría en rojo («Sobran N») el caso NORMAL del negocio. El aviso de "empacas más de lo
    // recibido" existe, pero es UN TOTAL informativo y va abajo, no celda por celda.
    if (etapa === 'empaque') {
      return null;
    }
    if (etapa === 'corte') {
      for (const c of wip.porCortar) mapa.set(claveCelda(c.idColor, c.idTalla, c.pack), c.cantidad);
      return mapa;
    }
    if (etapa === 'entrega-maquila' || etapa === 'entrega-aplicacion') {
      const entrada = wip.cortadoPorEnviar.find((p) =>
        etapa === 'entrega-maquila'
          ? p.generaEntradaPt
          : String(p.idTipoProceso) === idProcesoAplicacion,
      );
      if (entrada !== undefined) {
        for (const c of entrada.celdas)
          mapa.set(claveCelda(c.idColor, c.idTalla, c.pack), c.cantidad);
        return mapa;
      }
      // Primer envío a este proceso: el disponible es lo CORTADO por celda, y lo manda el servidor
      // ya sumado (`wip.cortadoCeldas`, V1-E8i). Antes se re-derivaba aquí restando
      // `pedido − porCortar` — la MISMA regla escrita en dos lados, que acaba derivando de la del
      // dominio. Viene SIEMPRE completo, incluso todo en cero: cero cortado es un tope real, no una
      // ausencia de dato (ver el comentario de arriba).
      for (const c of wip.cortadoCeldas)
        mapa.set(claveCelda(c.idColor, c.idTalla, c.pack), c.cantidad);
      return mapa;
    }
    const entrada = wip.porRecibir.find((p) =>
      etapa === 'recibo-maquila'
        ? p.generaEntradaPt
        : String(p.idTipoProceso) === idProcesoAplicacion,
    );
    if (entrada === undefined) {
      return null;
    }
    // El pendiente del RECIBO es el de ESE maquilero, no el del proceso entero: con dos maquileros
    // en la misma orden, la referencia del proceso le ofrecería a uno lo que el otro tiene en su
    // taller (y el servidor lo rechazaría al guardar). Sin maquilero elegido no hay referencia.
    if (idProveedor === null) {
      return null;
    }
    const delMaquilero = entrada.porMaquilero.find((m) => m.idMaquilero === idProveedor);
    if (delMaquilero === undefined) {
      return null;
    }
    // El tope es `c.cantidad`: el pendiente de ESE maquilero, que **lo calcula el servidor** con la
    // MISMA función que el tope de `registrarReciboMaquila` (`pendientePorCelda`) y que desde
    // V1-E8v (§Post-F9.147) ya descuenta las prendas incompletas que entregó. Aquí NO se re-deriva:
    // la misma regla escrita en dos lados acaba divergiendo, y el precio sería una matriz que
    // ofrece lo que el guardado rechaza.
    for (const c of delMaquilero.celdas) {
      // ⭐ CON LOS TENDIDOS REVUELTOS la referencia de la fila es el saldo AGREGADO del color×talla:
      // se SUMAN las celdas de todos los packs (incluida la de pack vacío, que sale NEGATIVA —lo ya
      // devuelto sin atribuir—), y esa suma es exactamente `Σ enviado − Σ devuelto − Σ saldado`, la
      // condición (1) que el servidor topa para un renglón sin pack (`packs.ts::excesosDelRecibo`). Leer sólo
      // el bucket de pack vacío habría dado un tope de 0 o negativo y la captura revuelta —la que
      // Daniel pidió que se pudiera hacer— habría quedado bloqueada siempre.
      const clave = sinDistinguirPack
        ? claveCelda(c.idColor, c.idTalla, '')
        : claveCelda(c.idColor, c.idTalla, c.pack);
      mapa.set(clave, (mapa.get(clave) ?? 0) + c.cantidad);
    }
    return mapa;
  }, [etapa, wip, idProcesoAplicacion, idProveedor, sinDistinguirPack]);
  /**
   * ⭐ EL SALDO AGREGADO POR COLOR×TALLA del maquilero, plegando TODOS los tendidos — la condición
   * (1) de `packs.ts::excesosDelRecibo`: `Σ R[p] + R[·] ≤ Σ E[p]`. Sólo el RECIBO la necesita.
   *
   * 🔴 NO ES REDUNDANTE con la referencia por celda, y el caso donde se separan es real: la celda de
   * pack VACÍO del desglose sale **negativa** cuando el maquilero ya devolvió piezas sin decir de
   * qué tendido eran. Ahí `Σ_p (E[p] − R[p])` es MAYOR que el agregado, así que una captura tendido
   * por tendido puede caber en cada pack y NO caber en total. Sin esto la pantalla la dejaría pasar
   * y el servidor la rechazaría con la matriz ya tecleada — justo el 400 que este pre-chequeo evita.
   *
   * Y al revés tampoco: el agregado no ve el reparto, así que 10 del pack A habiendo enviado 5 de A
   * y 5 de B cuadra en total y no cuadra por pack. Ninguna implica a la otra; van las dos.
   */
  const referenciaAgregada = useMemo<Map<string, number> | null>(() => {
    if (!esRecibo || idProveedor === null) return null;
    const entrada = wip.porRecibir.find((p) =>
      etapa === 'recibo-maquila'
        ? p.generaEntradaPt
        : String(p.idTipoProceso) === idProcesoAplicacion,
    );
    const delMaquilero = entrada?.porMaquilero.find((m) => m.idMaquilero === idProveedor);
    if (delMaquilero === undefined) return null;
    const mapa = new Map<string, number>();
    for (const c of delMaquilero.celdas) {
      const clave = `${c.idColor}:${c.idTalla}`;
      mapa.set(clave, (mapa.get(clave) ?? 0) + c.cantidad);
    }
    return mapa;
  }, [esRecibo, etapa, wip, idProcesoAplicacion, idProveedor]);
  /** Incompletas que ESE maquilero ya entregó de este proceso (para explicar el tope de arriba). */
  const incompletasYaEntregadas = useMemo(() => {
    if (!esRecibo || idProveedor === null) return 0;
    const entrada = wip.porRecibir.find((p) =>
      etapa === 'recibo-maquila'
        ? p.generaEntradaPt
        : String(p.idTipoProceso) === idProcesoAplicacion,
    );
    return entrada?.porMaquilero.find((m) => m.idMaquilero === idProveedor)?.totalIncompletas ?? 0;
  }, [esRecibo, etapa, wip, idProcesoAplicacion, idProveedor]);
  const totalReferencia =
    referencia === null
      ? undefined
      : [...referencia.values()].reduce((s, v) => s + Math.max(0, v), 0);

  const total = Object.values(valores).reduce((s, v) => s + v, 0);
  /**
   * Cuánto quedaría EMPACADO DE MÁS sobre lo recibido de costura si se guarda esta captura (0.114).
   * Puramente INFORMATIVO: alimenta un aviso ámbar y NO bloquea nada (`puedeGuardar` no lo mira).
   * Los dos operandos los publica el servidor (`wip.empacado`, `wip.recibidoCostura`).
   */
  const excedeEmpaque = Math.max(0, wip.empacado + total - wip.recibidoCostura);
  const ocupado =
    crearCorte.isPending || crearEmpaque.isPending || crearEnvio.isPending || crearRecibo.isPending;
  // Los SERVICIOS (corte/empaque) NO tienen proceso: ésa es justamente su marca (`idTipoProceso`
  // NULL en el servidor). Sin este `esServicio` de por medio, el empaque caía en la rama del envío.
  const procesoParaGuardar = esServicio
    ? undefined
    : esAplicacion
      ? procesoElegido
      : esRecibo || etapa === 'entrega-maquila'
        ? // El recibo/envío de costura usa el proceso YA USADO en la orden si existe (porRecibir), o
          // el proceso costura del catálogo.
          (procesos.find(
            (p) => p.id === wip.porRecibir.find((x) => x.generaEntradaPt)?.idTipoProceso,
          ) ?? procesoCostura)
        : undefined;

  // ── PRECARGA DE LA MATRIZ (V1-E8i, §Post-F9.131) ───────────────────────────────────────────
  // Petición de Daniel (28-ago-2026): *"marcar el corte como completo… y otro de entrega a maquila
  // con la información exacta de lo que se cortó"*. Hoy teclea talla por talla lo que casi siempre
  // es exactamente lo esperado.
  //
  // ⚠️ El botón PRECARGA, NO GUARDA: llena los campos y el usuario revisa y ajusta antes de dar
  // Guardar. Y el NÚMERO lo dice el servidor (`sugerencia-captura`): "cuánto se puede enviar
  // todavía" es la regla (g) —sobre-envío ESTRICTO— y calcularla aquí sería escribirla dos veces.
  // Por eso el botón del envío propone lo cortado MENOS lo ya enviado a ese proceso: precargar el
  // bruto tras un primer envío parcial daría un guardado que el servidor rechaza, y un botón que
  // produce un error no es un atajo, es una trampa.
  //
  // 🔴 H3 del reviewer — el atajo se APAGA con `prendaTerminada` (V1-E4b, §Post-F9.61). Ahí el
  // servidor exige DOS topes, no uno: `enviado ≤ cortado` **y** que el almacén de PT tenga las
  // prendas físicamente (`transito.ts` → `traspasarPrendasATransito` → `exigirExistenciaPt`). La
  // sugerencia sólo conoce el primero, así que con 1,000 cortadas y 400 recibidas de costura el
  // botón anunciaría «Llenar con lo que se cortó (1,000 pza)» y el Guardar se estrellaría contra la
  // existencia — la MISMA trampa que esta etapa vino a cerrar, en el flujo de al lado. Y no es un
  // caso raro: `prendaTerminada` arranca en `true` por default en cuanto la orden tiene prendas
  // recibidas de costura. La versión buena (que `sugerirCaptura` reciba el almacén de origen y tope
  // también por existencia) es OTRA etapa; aquí se apaga y se dice por qué.
  //
  // Se separan dos cosas: si la ETAPA admite atajo (y por tanto se pinta el bloque, con su razón) y
  // si HOY se puede precargar. Apagar el bloque entero dejaría al usuario sin saber por qué le
  // desapareció el botón: *primero el lugar para llenar, y el aviso sólo si de verdad no se puede.*
  const etapaConPrecarga =
    etapa === 'corte' || etapa === 'entrega-maquila' || etapa === 'entrega-aplicacion';
  const puedePrecargar = etapaConPrecarga && !prendaTerminada;
  // En el envío la base es el proceso al que se va a enviar; en el corte no hay proceso.
  const idProcesoSugerencia = etapa === 'corte' ? undefined : procesoParaGuardar?.id;
  /**
   * 🔴 H9 — UNA SOLA VERDAD para "¿la consulta de ESTA pantalla está viva?".
   *
   * Antes el `enabled` tenía dos factores y el botón sólo miraba uno (`puedePrecargar`, la rama de
   * `prendaTerminada`). El otro —"todavía no hay proceso elegido"— quedaba fuera, y eso no era
   * teórico: la clave de caché es `[…, idOrden, idTipoProceso ?? …]`, así que **el corte y «envío
   * sin proceso elegido» compartían entrada**, y una query deshabilitada SIGUE sirviendo el `data`
   * cacheado. Resultado: tras capturar un corte, abrir «Entrega a arte» —donde el proceso arranca
   * vacío, o sea que es lo primero que se ve— encendía el botón con «Llenar con lo que se cortó
   * (1,726 pza)», la cifra de *lo que falta por cortar*, mientras la nota de al lado pedía elegir el
   * proceso. Botón y nota contradiciéndose, y la matriz llenándose con la respuesta de otra pregunta.
   */
  const consultaSugerencia =
    puedePrecargar && (etapa === 'corte' || idProcesoSugerencia !== undefined);
  const sugerencia = useSugerenciaCaptura(orden.id, idProcesoSugerencia, consultaSugerencia);
  // H5 del reviewer: el botón y su mensaje cuelgan del MISMO dato —el `motivo` del servidor—, no uno
  // de `celdas.length` y el otro del motivo. Con dos fuentes, un día llegan desacopladas y sale un
  // botón gris con un texto que no explica nada.
  //
  // ⚠️ Y cuelga de `consultaSugerencia`, no basta con deshabilitar la query: TanStack conserva —y
  // sirve— el `data` de la entrada de caché, así que sin este gate el botón se queda encendido
  // anunciando el total de una pregunta que ya no es la de esta pantalla. Pasa por los dos lados: al
  // marcar «prendas ya terminadas» (H3) y al abrir el envío sin proceso elegido (H9).
  const hayQuePrecargar = consultaSugerencia && sugerencia.data?.motivo === 'hay';

  /**
   * PISA lo capturado, no suma (decisión de V1-E8i). Sumar haría que un segundo clic duplicara las
   * cantidades en silencio y sin vuelta atrás; pisar es reversible —se vuelve a picar el botón y
   * queda igual— y es lo que la etiqueta promete. Las celdas que el servidor no propone quedan
   * VACÍAS, no en su valor anterior: si no, un intento previo dejaría restos mezclados con la
   * propuesta y el total ya no sería "lo que falta".
   */
  function precargarMatriz(): void {
    const propuesta = sugerencia.data;
    if (propuesta === undefined || propuesta.celdas.length === 0) return;
    const nuevos: Record<string, number> = {};
    for (const c of propuesta.celdas) {
      // La sugerencia viene POR TENDIDO desde el servidor (`sugerirCaptura` llavea con el pack): si
      // aquí se plegara, el corte de dos tendidos del mismo color caería entero en una sola celda.
      nuevos[claveCelda(c.idColor, c.idTalla, c.pack)] = c.cantidad;
    }
    setValores(nuevos);
    toast.success(
      `Se llenaron ${propuesta.total.toLocaleString('es-MX')} pza(s). Revisa y ajusta antes de guardar.`,
    );
  }

  /**
   * Por qué NO se puede precargar, en palabras de taller. El MOTIVO lo decide el servidor (que es
   * quien sabe cuánto se pidió, se cortó y se envió); aquí solo se traduce. Un botón apagado sin
   * explicación es la cicatriz que este proyecto ya se hizo una vez.
   */
  function razonSinPrecarga(): string | null {
    if (!etapaConPrecarga) return null;
    // H3: va ANTES del resto — con el atajo apagado la consulta ni corre, así que no hay `motivo`
    // del servidor que traducir y el bloque se quedaría con el texto genérico de "sí se puede".
    if (prendaTerminada) {
      return 'Estas prendas salen del almacén de producto terminado y hay que respetar lo que hay en existencia: captura a mano lo que de verdad vas a mandar.';
    }
    if (etapa !== 'corte' && idProcesoSugerencia === undefined) {
      return 'Elige primero el proceso para saber qué falta por enviarle.';
    }
    if (sugerencia.isPending) return 'Consultando qué falta…';
    if (sugerencia.isError) return 'No se pudo consultar qué falta. Captura las cantidades a mano.';
    switch (sugerencia.data?.motivo) {
      case 'hay':
        return null;
      case 'orden-sin-matriz':
        return 'Esta orden no trae desglose por color y talla: no hay de dónde copiar cantidades.';
      case 'todo-cortado':
        return 'Ya está cortado todo lo que pide la orden. Si vas a cortar de más, tecléalo: se permite.';
      case 'nada-cortado':
        return 'Todavía no hay ningún corte capturado en esta orden, así que no hay nada que enviar.';
      case 'todo-enviado':
        return 'Todo lo cortado ya se le envió a este proceso: no queda nada por enviar.';
      default:
        return null;
    }
  }

  // ── SEGUNDAS (calidad): en alguna celda no pueden superar el total capturado ────────────────
  // Si las segundas exceden el total, las primeras quedarían NEGATIVAS. El servidor lo rechaza
  // (`primeras + segundas === cantidad`); aquí se avisa y se bloquea el botón para no cosechar 400s.
  const totalSegundas = capturarSegundas
    ? Object.entries(segundas).reduce(
        (s, [clave, v]) => (valores[clave] === undefined ? s : s + v),
        0,
      )
    : 0;
  const segundasInvalidas =
    capturarSegundas &&
    Object.entries(segundas).some(([clave, seg]) => seg > 0 && seg > (valores[clave] ?? 0));

  // ── PRENDAS INCOMPLETAS (V1-E8k) ────────────────────────────────────────────────────────────
  // No tienen tope propio contra el total recibido (no salen de él: son piezas APARTE). Lo que sí
  // topan, junto con lo recibido, es el pendiente de la etapa — y eso lo mira `excede` de abajo.
  const totalIncompletas = capturarIncompletas
    ? Object.values(incompletas).reduce((s, v) => s + v, 0)
    : 0;

  // ── EL EXCESO SOBRE EL PENDIENTE DE LA ETAPA ────────────────────────────────────────────────
  //
  // Las dos reglas de F3-E2 NO son iguales y aquí se distinguen (antes el panel no miraba el exceso
  // en absoluto y las pantallas viejas sí):
  //  • decisión (f) SOBRE-CORTE **LIBRE**: el servidor lo acepta. Solo se AVISA, en ámbar, diciendo
  //    que se permite (la matriz lo pinta rojo "Sobran N", que sin este aviso se lee como error).
  //  • decisión (g) SOBRE-ENVÍO / SOBRE-RECIBO **ESTRICTOS** (`etapas.ts` / `recibos.ts` los
  //    rechazan bajo lock): se bloquea el botón, para no mandar al usuario a comerse un 400.
  // Sin referencia (`null` = primer movimiento de un proceso, sin base contra qué comparar) no se
  // inventa un tope de 0: el exceso es 0 y decide el servidor.
  //
  // ⭐ Desde §Post-F9.10 el cálculo son DOS condiciones, no una — las MISMAS que el servidor aplica
  // bajo lock (`packs.ts::excesosDelRecibo`): (2) por celda/tendido y (1) por color×talla plegando
  // los tendidos. Ninguna implica a la otra; ver {@link referenciaAgregada}.

  /** Lo que ESTA captura devuelve en una celda: buenas + incompletas (V1-E8k), como topa el servidor. */
  function devuelveEnCelda(clave: string): number {
    return (valores[clave] ?? 0) + (capturarIncompletas ? (incompletas[clave] ?? 0) : 0);
  }
  /** Claves capturadas (con valor o con incompletas) — las mismas que se topan y que se guardan. */
  const clavesCapturadas = [...new Set([...Object.keys(valores), ...Object.keys(incompletas)])];
  /** (2) POR CELDA — cada renglón contra el pendiente de SU tendido (o el de su color sin packs). */
  const excedeCelda =
    referencia === null
      ? 0
      : clavesCapturadas.reduce((suma, clave) => {
          const pendiente = Math.max(0, referencia.get(clave) ?? 0);
          // V1-E8k: lo que topa es el total FÍSICO que el maquilero devuelve en esta captura —
          // buenas + incompletas—, igual que el tope del servidor. Si solo se miraran las buenas,
          // la pantalla dejaría pasar una captura que el guardado rechaza.
          const devuelve = devuelveEnCelda(clave);
          return devuelve > pendiente ? suma + (devuelve - pendiente) : suma;
        }, 0);
  /**
   * (1) TOTAL POR COLOR×TALLA — se SUMAN los renglones de esta captura que caen en la misma celda
   * (los de cada tendido y el de sin pack) y se topan JUNTOS contra el saldo agregado. Es la misma
   * condición que `packs.ts::excesosDelRecibo` aplica bajo lock, y la razón de que no baste con (2)
   * está en el comentario de {@link referenciaAgregada}.
   */
  const excedeAgregado =
    referenciaAgregada === null
      ? 0
      : [
          ...clavesCapturadas
            .reduce((acum, clave) => {
              // La llave es `color:talla:pack`; el agregado la quiere sin el pack. Se corta por los
              // DOS primeros separadores (color y talla son enteros), igual que en el servidor: un
              // `split(':')` truncaría en silencio un pack con `:` adentro.
              const corte1 = clave.indexOf(':');
              const corte2 = clave.indexOf(':', corte1 + 1);
              const celda = corte2 < 0 ? clave : clave.slice(0, corte2);
              acum.set(celda, (acum.get(celda) ?? 0) + devuelveEnCelda(clave));
              return acum;
            }, new Map<string, number>())
            .entries(),
        ].reduce((suma, [celda, devuelve]) => {
          const pendiente = Math.max(0, referenciaAgregada.get(celda) ?? 0);
          return devuelve > pendiente ? suma + (devuelve - pendiente) : suma;
        }, 0);
  /**
   * El exceso que la pantalla reporta y con el que bloquea. Es el MAYOR de los dos, NO su suma:
   * cuando las dos condiciones fallan en la misma celda miran las mismas piezas desde ángulos
   * distintos, y sumarlas contaría dos veces la misma pieza sobrante.
   *
   * ⚠️ Y ahí está su límite, dicho porque es real: si (1) y (2) fallan en celdas DISTINTAS, el
   * máximo se queda CORTO —3 de más en un tendido y 5 de más en el total de otra celda se reportan
   * como 5, no como 8—. Se acepta a propósito: lo que este número decide es BLOQUEAR (basta con que
   * sea > 0), y quién topa de verdad es el servidor bajo lock. Preferimos un número que nunca
   * exagera a una suma que inventa piezas que no sobran.
   */
  const excede = Math.max(excedeCelda, excedeAgregado);

  const puedeGuardar =
    !ocupado &&
    // V1-E8k: un recibo puede ser SOLO de prendas incompletas (el maquilero trajo las 5 que no
    // pudo coser y nada más). Exigir piezas buenas dejaba ese caso —el que Daniel describió—
    // incapturable por el único camino que hay.
    (total > 0 || (esRecibo && totalIncompletas > 0)) &&
    idProveedor !== null &&
    fecha !== '' &&
    (esServicio || procesoParaGuardar !== undefined) &&
    // V1-E8k: si la captura NO trae piezas buenas (recibo SOLO de incompletas), no entra nada a
    // inventario y el almacén deja de tener sentido — el servidor tampoco lo pide en ese caso
    // (`meteAPt` en `recibos.ts` incluye `totalRecibido > 0`). Exigirlo aquí bloquearía justo el
    // caso que Daniel describió.
    (!requiereAlmacen || total === 0 || idAlmacenPrimeras !== '') &&
    // Con segundas que entran a PT hay que decir a qué almacén van (igual que la pantalla vieja).
    (!requiereAlmacen ||
      total === 0 ||
      !capturarSegundas ||
      totalSegundas === 0 ||
      idAlmacenSegundas !== '') &&
    // V1-E4b: si el envío saca prendas terminadas, hay que decir de qué almacén salen.
    (!prendaTerminada || idAlmacenOrigen !== '') &&
    !segundasInvalidas &&
    // El sobre-corte SÍ se guarda (decisión (f)) y el EMPACAR DE MÁS también (0.114: cantidad
    // propia); el sobre-envío y el sobre-recibo, NO (decisión (g)). En el empaque `excede` ya vale 0
    // siempre (no tiene referencia): esto lo deja dicho en vez de depender de ese detalle.
    (esServicio || excede === 0);

  /**
   * Convierte la captura al cuerpo `lineas` del API (descarta ceros).
   *
   * ⭐ EL PACK VIAJA (§Post-F9.10): cada fila es un color×tendido y su pack va en el renglón. En una
   * orden sin packs va la cadena vacía, que el dominio lee como «sin pack» — el cuerpo es, punto por
   * punto, el de siempre. En el recibo «revueltos» las filas ya vienen plegadas con el pack vacío,
   * que es justo lo que el dominio necesita para cobrarlo del saldo agregado.
   */
  function lineasApi(): {
    idColor: number;
    pack: string;
    tallas: { idTalla: number; cantidad: number }[];
  }[] {
    return colores
      .map((color) => ({
        idColor: color.idColor,
        pack: color.pack,
        tallas: tallas
          .map((t) => ({
            idTalla: t.idTalla,
            cantidad: valores[claveCelda(color.idColor, t.idTalla, color.pack)] ?? 0,
          }))
          .filter((t) => t.cantidad > 0),
      }))
      .filter((l) => l.tallas.length > 0);
  }

  /**
   * Igual que {@link lineasApi} pero con el DESGLOSE DE CALIDAD por celda (recibo): primeras =
   * total − segundas. Sin el interruptor no se manda desglose y el backend lo lee como "todo
   * primeras" — que es exactamente lo que hacía el panel ANTES de V1-E3a, y por eso las segundas
   * eran incapturables por el camino principal.
   */
  function lineasReciboApi(): {
    idColor: number;
    pack: string;
    tallas: {
      idTalla: number;
      cantidad: number;
      cantidadPrimeras?: number;
      cantidadSegundas?: number;
      cantidadIncompletas?: number;
    }[];
  }[] {
    if (!capturarSegundas && !capturarIncompletas) {
      return lineasApi();
    }
    return colores
      .map((color) => ({
        idColor: color.idColor,
        pack: color.pack,
        tallas: tallas
          .map((t) => {
            const clave = claveCelda(color.idColor, t.idTalla, color.pack);
            const cantidad = valores[clave] ?? 0;
            const seg = capturarSegundas ? (segundas[clave] ?? 0) : 0;
            const inc = capturarIncompletas ? (incompletas[clave] ?? 0) : 0;
            return {
              idTalla: t.idTalla,
              cantidad,
              // El desglose de calidad solo se manda si se pidió: sin interruptor el backend lee
              // "todo primeras", que es el comportamiento de siempre.
              ...(capturarSegundas
                ? { cantidadPrimeras: cantidad - seg, cantidadSegundas: seg }
                : {}),
              // V1-E8k: campo APARTE, jamás sumado a `cantidad` (§Post-F9.136).
              ...(capturarIncompletas ? { cantidadIncompletas: inc } : {}),
            };
          })
          // Una celda entra si trae piezas buenas O incompletas: un recibo puede ser solo de
          // incompletas.
          .filter((t) => t.cantidad > 0 || (t.cantidadIncompletas ?? 0) > 0),
      }))
      .filter((l) => l.tallas.length > 0);
  }

  function alExito(guardado: MovimientoImpreso): void {
    toast.success(
      `${guardado.etiqueta} #${guardado.folio} registrado · la Ruta Crítica se marca sola ✓`,
    );
    alRegistrado(guardado);
  }

  /**
   * Precio pactado del movimiento, si se capturó.
   *
   * ⚠️ NO se gatea con `ordenes.ver-precio-real-maquila`: ese permiso gobierna la LECTURA (el
   * backend REDACTA el campo a `null` al devolver etapas y recibos — `etapas.ts`/`recibos.ts`),
   * **no la captura** (así lo fija `recibos.int.test.ts`: *"la captura no"*). Y en el seed ese
   * permiso llega hasta Ventas y no más abajo, mientras `produccion.envio`/`.recibo` los lleva todo
   * perfil menos `Basico`: gatear el campo dejaría SIN precio justo a los roles que capturan la
   * maquila diaria —Logística, Asistente, Secretarial— y,
   * como el cargo EsMa cae al `precioPactado` del recibo cuando la OP no trae precio
   * (`esma/cargos.ts`), el cargo nacería sin precio — la doble captura que v2 elimina.
   * La regla es: se puede TECLEAR el precio que se pactó hoy; NO se puede VER el que capturó otro.
   */
  function precioApi(): { precioPactado?: number } {
    if (precioPactado.trim() === '') {
      return {};
    }
    const valor = Number(precioPactado);
    return Number.isFinite(valor) && valor >= 0 ? { precioPactado: valor } : {};
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
        // 0.114: el corte ya lleva PRECIO por prenda — de ahí sale el cargo del cortador.
        { ...comunes, idCortador: idProveedor, ...precioApi() },
        {
          onSuccess: (e) => alExito({ id: e.id, folio: e.folio, etiqueta: 'Corte', impresos: [] }),
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    if (etapa === 'empaque') {
      crearEmpaque.mutate(
        { ...comunes, idEmpacador: idProveedor, ...precioApi() },
        {
          onSuccess: (e) =>
            alExito({ id: e.id, folio: e.folio, etiqueta: 'Empaque', impresos: [] }),
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
          lineas: lineasReciboApi(),
          idTipoProceso: procesoParaGuardar.id,
          idMaquilero: idProveedor,
          ...precioApi(),
          ...(requiereAlmacen && idAlmacenPrimeras !== ''
            ? { idAlmacenPrimeras: Number(idAlmacenPrimeras) }
            : {}),
          ...(requiereAlmacen && idAlmacenSegundas !== ''
            ? { idAlmacenSegundas: Number(idAlmacenSegundas) }
            : {}),
        },
        {
          onSuccess: (r) =>
            alExito({
              id: r.id,
              folio: r.folio,
              etiqueta: 'Recibo',
              impresos: [
                {
                  clave: 'recibo',
                  etiqueta: 'PDF del recibo',
                  url: urlImpresoRecibo(r.id),
                  icono: 'pdf',
                },
              ],
            }),
          onError: (error) => toast.error(error.message),
        },
      );
      return;
    }
    crearEnvio.mutate(
      {
        ...comunes,
        idTipoProceso: procesoParaGuardar.id,
        idMaquilero: idProveedor,
        ...precioApi(),
        ...(fechaCompromiso === '' ? {} : { fechaCompromiso }),
        // V1-E4b: prendas YA TERMINADAS ⇒ el envío las saca de este almacén hacia el tránsito.
        prendaTerminada,
        stockSinOrden,
        ...(prendaTerminada && idAlmacenOrigen !== ''
          ? { idAlmacenOrigen: Number(idAlmacenOrigen) }
          : {}),
      },
      {
        onSuccess: (e) =>
          alExito({
            id: e.id,
            folio: e.folio,
            etiqueta: 'Envío',
            impresos: impresosDeEnvio(e.id, esAplicacion),
          }),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const etiquetaProveedor = ETAPAS.find((e) => e.clave === etapa)?.etiquetaProveedor ?? 'Proveedor';

  return (
    <div className="space-y-3 border-b bg-panel-2 px-4 py-3" data-testid="avance-captura">
      <AvisoCatalogos
        hayError={catalogoConError}
        alReintentar={reintentarCatalogos}
        que={
          etapa === 'corte'
            ? 'cortadores'
            : etapa === 'empaque'
              ? 'empacadores'
              : 'procesos, proveedores o almacenes'
        }
      />
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
            // En el RECIBO la lista es corta y ya viene del WIP (los que tienen entrega viva): el
            // filtro es LOCAL y no se consulta el catálogo. En corte/entrega sigue el typeahead
            // server-side (hay >1,700 proveedores y la página de 100 no basta).
            {...(esRecibo
              ? {
                  renderOpcion: (o: { nombre: string; pendiente?: number | undefined }) => (
                    <OpcionRica
                      principal={o.nombre}
                      secundario={
                        o.pendiente === undefined
                          ? null
                          : `${o.pendiente.toLocaleString('es-MX')} pza(s) por recibirle`
                      }
                    />
                  ),
                }
              : { alCambiarTexto: setTextoProveedor, cargando: proveedores.isFetching })}
            // Default de la ENTREGA: el maquilero de la OP puede no venir en la página de 100 del
            // catálogo; sin su etiqueta el campo se vería vacío con el valor puesto.
            // Se pasa SOLO mientras la selección siga siendo la de la OP: si el usuario elige a
            // otro y el typeahead se resetea (la página vuelve sin él), esta etiqueta fija le
            // pisaría el nombre y el campo mostraría un maquilero DISTINTO del que se va a
            // guardar (bloqueante del reviewer).
            {...(etapa === 'entrega-maquila' &&
            orden.maquilero !== null &&
            idProveedor === orden.idMaquilero
              ? { etiquetaSeleccion: orden.maquilero }
              : {})}
            placeholder={
              esRecibo
                ? esAplicacion && idProcesoAplicacion === ''
                  ? 'Elige primero el tipo de arte…'
                  : maquilerosRecibibles.length === 0
                    ? 'Nadie tiene piezas por devolver'
                    : 'Elige a quién le recibes…'
                : `Escribe el ${etiquetaProveedor.toLowerCase()}…`
            }
            textoVacio={
              esRecibo
                ? 'Solo se puede recibir de quien tiene entrega viva en esta orden'
                : 'Sin coincidencias'
            }
            etiqueta={etiquetaProveedor}
            testid="avance-proveedor"
          />
          {pendienteSinMaquilero > 0 ? (
            <p className="text-xs text-warn" data-testid="avance-sin-maquilero">
              Hay {pendienteSinMaquilero.toLocaleString('es-MX')} pza(s) entregadas SIN maquilero
              (histórico migrado): hay que corregir esa entrega antes de poder recibirlas.
            </p>
          ) : null}
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

      {/* ⭐ CERRAR LA ORDEN CON ESTE MAQUILERO (V1, fila 0.109). Va AQUÍ, en la captura del recibo,
          porque DANIEL pidió que *«lo apriete quien recibe»* — no en una pantalla nueva. */}
      {esRecibo && procesoParaGuardar !== undefined ? (
        <BloqueCierreMaquilero
          idOrden={orden.id}
          idTipoProceso={procesoParaGuardar.id}
          maquilero={
            idProveedor === null
              ? null
              : ((entradaRecibo?.porMaquilero ?? []).find((m) => m.idMaquilero === idProveedor) ??
                null)
          }
        />
      ) : null}

      {/* PRECIO PACTADO (TODAS las etapas de esta captura) + FECHA COMPROMISO (solo el envío).
          Sin el precio, el cargo EsMa nace SIN precio y hay que teclearlo aparte en su módulo (la
          doble captura que v2 elimina).

          ⭐ 0.114 — el CORTE y el EMPAQUE también lo llevan. Daniel: *«sólo hay que poner su cantidad
          y precio para meterlo en la OP»*. Antes este bloque se escondía en el corte porque el corte
          no generaba cargo; ahora sí lo genera, y su precio es el ÚNICO que ese cargo puede
          proponer (la orden trae `maquilaOrd`/`aplicacionOrd`, que son precios de MAQUILA y no se
          le prestan a un servicio). */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* El precio se CAPTURA sin permiso extra: `ordenes.ver-precio-real-maquila` gobierna la
            LECTURA (el backend redacta el campo al devolverlo), no la escritura — ver `precioApi`. */}
        <Field>
          <FieldLabel htmlFor="avance-precio">Precio pactado por prenda</FieldLabel>
          <Input
            id="avance-precio"
            type="number"
            min={0}
            step="0.01"
            value={precioPactado}
            onChange={(e) => setPrecioPactado(e.target.value)}
            placeholder="Opcional"
            data-testid="avance-precio"
          />
        </Field>
        {esEnvio ? (
          <Field>
            <FieldLabel htmlFor="avance-fecha-compromiso">Fecha compromiso</FieldLabel>
            <Input
              id="avance-fecha-compromiso"
              type="date"
              value={fechaCompromiso}
              onChange={(e) => setFechaCompromiso(e.target.value)}
              data-testid="avance-fecha-compromiso"
            />
          </Field>
        ) : null}
      </div>

      {/* ── V1-E4b · ¿se mandan prendas YA TERMINADAS? (§Post-F9.61) ───────────────────────────
          Si el proceso va DESPUÉS de la costura, las prendas están en el almacén y salen de él: el
          envío las traspasa al tránsito y el recibo las devuelve. Sin esto, el almacén seguiría
          diciendo que están en el piso y las segundas y los faltantes del recibo no tendrían dónde
          caer. El interruptor se BLOQUEA cuando el proceso ya tiene entregas vivas: el servidor no
          deja mezclar las dos formas en la misma orden+proceso, así que ofrecer el cambio solo
          serviría para cosechar un 409. */}
      {etapa === 'entrega-aplicacion' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={prendaTerminada}
                disabled={prendaTerminadaFijada}
                onChange={(e) => {
                  setPrendaTerminadaElegida(e.target.checked);
                  if (!e.target.checked) setIdAlmacenOrigen('');
                }}
                className="size-4 rounded border-input"
                data-testid="avance-prenda-terminada"
              />
              Son prendas ya terminadas (salen del almacén)
            </label>
            <p className="text-xs text-muted-foreground">
              {prendaTerminadaFijada
                ? `Lo fija la entrega que ya tiene esta orden en ${procesoElegido?.nombre ?? 'este proceso'}: no se pueden mezclar las dos formas.`
                : prendaTerminada
                  ? 'El envío las descuenta del almacén y las deja en tránsito con el proveedor; el recibo las regresa.'
                  : 'Son bultos cortados: el envío no toca el inventario de producto terminado.'}
            </p>
          </div>
          {prendaTerminada ? (
            <Field>
              <FieldLabel htmlFor="avance-almacen-origen">Salen del almacén</FieldLabel>
              <SelectNativo
                id="avance-almacen-origen"
                value={idAlmacenOrigen}
                onChange={(e) => setIdAlmacenOrigen(e.target.value)}
                data-testid="avance-almacen-origen"
              >
                <option value="">Elige el almacén…</option>
                {almacenesPt.map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
          ) : null}
          {/* BUCKET de existencia (V1-E4b, H1): el inventario de PT se lleva por ORDEN, y el
              histórico migrado + el inventario físico de arranque viven en el bucket «sin orden
              asignada». Si las piezas que se mandan son de ese stock hay que decirlo, o el envío
              choca contra un saldo de 0 mientras la pantalla de existencias muestra piezas. */}
          {prendaTerminada ? (
            <Field>
              <FieldLabel htmlFor="avance-bucket-stock">De qué stock salen</FieldLabel>
              <SelectNativo
                id="avance-bucket-stock"
                value={stockSinOrden ? 'sin-orden' : 'orden'}
                disabled={prendaTerminadaFijada}
                onChange={(e) => setStockSinOrdenElegido(e.target.value === 'sin-orden')}
                data-testid="avance-bucket-stock"
              >
                <option value="orden">Del stock de esta orden</option>
                <option value="sin-orden">Del stock sin orden asignada (migrado / inicial)</option>
              </SelectNativo>
            </Field>
          ) : null}
        </div>
      ) : null}

      {requiereAlmacen ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="avance-almacen-primeras">
              {devuelveAPt && etapa !== 'recibo-maquila'
                ? 'Regresan al almacén (primeras)'
                : 'Almacén de primeras'}
            </FieldLabel>
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
          {/* El almacén de segundas solo se pide cuando SÍ se van a capturar segundas: antes se
              ofrecía siempre, en un camino que jamás podía mandar una (V1-E3a). */}
          {capturarSegundas ? (
            <Field>
              <FieldLabel htmlFor="avance-almacen-segundas">Almacén de segundas</FieldLabel>
              <SelectNativo
                id="avance-almacen-segundas"
                value={idAlmacenSegundas}
                onChange={(e) => setIdAlmacenSegundas(e.target.value)}
                data-testid="avance-almacen-segundas"
              >
                <option value="">Elige el almacén…</option>
                {almacenesPt.map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
          ) : null}
        </div>
      ) : null}

      {/* ── El atajo de captura de Daniel (V1-E8i): llenar la matriz de un clic ──────────────
          El botón vive PEGADO a la matriz que llena, y se muestra SIEMPRE (aunque esté apagado)
          junto a la razón por la que hoy no puede llenar nada. */}
      {etapaConPrecarga ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="avance-precarga">
          <Button
            variant="outline"
            size="sm"
            onClick={precargarMatriz}
            disabled={!hayQuePrecargar}
            data-testid="avance-precargar"
          >
            <Wand2 aria-hidden />
            {etapa === 'corte'
              ? 'Llenar con lo que falta por cortar'
              : 'Llenar con lo que se cortó'}
            {hayQuePrecargar && sugerencia.data !== undefined
              ? ` (${sugerencia.data.total.toLocaleString('es-MX')} pza)`
              : ''}
          </Button>
          <span className="text-xs text-muted-foreground" data-testid="avance-precarga-nota">
            {razonSinPrecarga() ??
              'Llena cada talla y reemplaza lo que ya hayas capturado. No guarda nada: revisa y ajusta antes de Guardar.'}
          </span>
          {consultaSugerencia && sugerencia.isError ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void sugerencia.refetch()}
              data-testid="avance-precarga-reintentar"
            >
              Reintentar
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* ── RECIBO CON LOS TENDIDOS REVUELTOS (§Post-F9.10) ─────────────────────────────────── */}
      {esRecibo && manejaPacks ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={revueltos}
            onChange={(e) => {
              setRevueltos(e.target.checked);
              // Las llaves de la captura llevan el pack: al plegar (o desplegar) las filas dejan de
              // significar lo mismo. Sin limpiar, lo tecleado antes seguiría contando en el total y
              // en el tope aunque su fila ya no exista en pantalla.
              //
              // 🔑 Y éste es el ÚNICO sitio donde hay que limpiar, medido: el otro cambio que movería
              // las llaves es cambiar de etapa, y el stepper cierra la captura al hacerlo
              // (`setCapturaAbierta(false)` junto a `setEtapaActiva`), así que este componente se
              // DESMONTA y su estado se va con él. `etapa` nunca cambia estando montado.
              setValores({});
              setSegundas({});
              setIncompletas({});
            }}
            className="size-4 rounded border-input"
            data-testid="avance-toggle-revueltos"
          />
          El maquilero devolvió los tendidos <b>revueltos</b> (no distingue pack)
        </label>
      ) : null}
      {sinDistinguirPack ? (
        <p className="text-xs text-muted-foreground" data-testid="avance-nota-revueltos">
          La captura va <b>sin pack</b>: un renglón por color, que se descuenta del saldo de{' '}
          <b>todos los tendidos juntos</b>. Se registra lo que volvió, pero ya no se sabrá de qué
          tendido era.
        </p>
      ) : null}

      {/* En el RECIBO la referencia ES el pendiente de ese maquilero, y desde V1-E8v (§Post-F9.147)
          eso coincide con lo que todavía se le puede recibir: la prenda incompleta que ya entregó
          salió del tránsito, así que baja las dos cifras a la vez. Entre V1-E8k y V1-E8v fueron dos
          números distintos y la etiqueta tuvo que distinguirlos; hoy es uno solo. */}
      <MatrizColorTalla
        tallas={tallas}
        colores={colores}
        valores={valores}
        onCambiar={(idColor, idTalla, pack, cantidad) =>
          setValores((v) => ({ ...v, [claveCelda(idColor, idTalla, pack)]: cantidad }))
        }
        {...(referencia === null ? {} : { referencia })}
        {...(totalReferencia === undefined ? {} : { totalReferencia })}
        etiquetaReferencia={esRecibo ? 'que se le puede recibir' : 'pendiente de la etapa'}
        sustantivoReferencia={esRecibo ? 'lo que todavía se le puede recibir' : 'el pendiente'}
        testid="avance-matriz"
      />

      {/* ── SEGUNDAS del recibo (migradas de `/produccion/recibos`, V1-E3a) ─────────────────── */}
      {esRecibo ? (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={capturarSegundas}
              onChange={(e) => {
                setCapturarSegundas(e.target.checked);
                if (!e.target.checked) {
                  // Al apagar el interruptor no queda un desglose fantasma: todo vuelve a primeras.
                  setSegundas({});
                  setIdAlmacenSegundas('');
                }
              }}
              className="size-4 rounded border-input"
              data-testid="avance-toggle-segundas"
            />
            Capturar piezas de segunda (calidad) por celda
          </label>
          {capturarSegundas ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Piezas de SEGUNDA por celda · no pueden exceder el total recibido (las primeras se
                calculan como total − segundas).
              </p>
              <MatrizColorTalla
                tallas={tallas}
                colores={colores}
                valores={segundas}
                onCambiar={(idColor, idTalla, pack, cantidad) =>
                  setSegundas((v) => ({ ...v, [claveCelda(idColor, idTalla, pack)]: cantidad }))
                }
                // La referencia de las segundas es el TOTAL capturado por celda: el tope real.
                referencia={new Map(Object.entries(valores).filter(([, v]) => v > 0))}
                totalReferencia={total}
                etiquetaReferencia="total recibido"
                testid="avance-matriz-segundas"
              />
            </div>
          ) : null}
          {segundasInvalidas ? (
            <p
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
              data-testid="avance-aviso-segundas"
            >
              En alguna celda las piezas de segunda superan el total recibido. Las primeras no
              pueden quedar negativas.
            </p>
          ) : null}

          {/* ── PRENDAS INCOMPLETAS (V1-E8k, §Post-F9.136) ──────────────────────────────────── */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={capturarIncompletas}
              onChange={(e) => {
                setCapturarIncompletas(e.target.checked);
                // Al apagar el interruptor no queda una captura fantasma de incompletas.
                if (!e.target.checked) setIncompletas({});
              }}
              className="size-4 rounded border-input"
              data-testid="avance-toggle-incompletas"
            />
            Capturar prendas incompletas entregadas
          </label>
          {capturarIncompletas ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Prendas que llegaron <b>sin terminar de coser</b> (les faltó una pieza). Se registra
                que el maquilero <b>sí las entregó</b>, pero{' '}
                <b>no cuentan como producidas, no entran a inventario y no se pagan</b>. Van aparte
                del total recibido: no las sumes arriba.
              </p>
              <MatrizColorTalla
                tallas={tallas}
                colores={colores}
                valores={incompletas}
                onCambiar={(idColor, idTalla, pack, cantidad) =>
                  setIncompletas((v) => ({ ...v, [claveCelda(idColor, idTalla, pack)]: cantidad }))
                }
                testid="avance-matriz-incompletas"
              />
            </div>
          ) : null}
          {incompletasYaEntregadas > 0 ? (
            // V1-E8v (§Post-F9.147): esas prendas YA volvieron, así que el pendiente de arriba ya
            // las descontó y no se pueden recibir como buenas. Sin esta línea, el pendiente
            // aparecería más bajo de lo que el usuario espera y no habría dónde leer por qué.
            <p
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
              role="status"
              data-testid="avance-aviso-incompletas-previas"
            >
              Este maquilero ya te entregó{' '}
              <b>{incompletasYaEntregadas.toLocaleString('es-MX')} prenda(s) incompleta(s)</b> de
              este proceso. Ya <b>salieron de su taller</b>, así que el pendiente de arriba las
              descuenta; pero <b>se pierden</b>: no entran a inventario y no se le pagan.
            </p>
          ) : null}
        </>
      ) : null}

      {/* ── Las DOS reglas del exceso, cada una con su tono (V1-E3a) ────────────────────────── */}
      {excede > 0 && etapa === 'corte' ? (
        // Decisión (f): el SOBRE-CORTE se permite. La matriz lo pinta rojo ("Sobran N pzas sobre el
        // pendiente"), que sin este aviso se lee como un error que hay que corregir.
        <p
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
          role="status"
          data-testid="avance-aviso-sobrecorte"
        >
          Estás cortando {excede.toLocaleString('es-MX')} pieza(s) por encima de lo pendiente de la
          orden. <b>Se permite</b> (solo es un aviso): el sobre-corte queda registrado tal cual.
        </p>
      ) : null}
      {/* ⭐ EMPAQUE (0.114): AVISO INFORMATIVO, nunca un tope. La cantidad del empaque es propia y el
          servidor la acepta tal cual; esto sólo pone un número donde antes no había ninguno, para
          que quien captura note que está empacando más de lo que la orden tiene recibido de costura.
          Se compara con `wip.empacado` + lo tecleado contra `wip.recibidoCostura`, DOS totales que
          publica el servidor — no se re-deriva ninguna regla, porque aquí no hay ninguna. */}
      {etapa === 'empaque' && wip.recibidoCostura > 0 && excedeEmpaque > 0 ? (
        <p
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
          role="status"
          data-testid="avance-aviso-empaque-excede"
        >
          Con esto llevarías {excedeEmpaque.toLocaleString('es-MX')} pieza(s) empacadas por encima
          de las {wip.recibidoCostura.toLocaleString('es-MX')} recibidas de costura en esta orden.{' '}
          <b>Se permite</b> (solo es un aviso): lo que se empaca se cuenta y se paga aparte.
        </p>
      ) : null}
      {excede > 0 && !esServicio ? (
        // Decisión (g): el sobre-envío y el sobre-recibo son ESTRICTOS en el servidor (bajo lock).
        // Se bloquea aquí para no mandar al usuario a comerse un 400 con la matriz ya tecleada.
        <p
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
          data-testid="avance-aviso-exceso"
        >
          Estás {esRecibo ? 'recibiendo' : 'enviando'} {excede.toLocaleString('es-MX')} pieza(s) por
          encima de lo pendiente de esta etapa
          {esRecibo && totalIncompletas > 0 ? ' (contando las prendas incompletas)' : ''}. Ajusta
          las cantidades: el servidor no lo permitirá.
        </p>
      ) : null}

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

/**
 * CAPTURA DE LA ENTREGA A CLIENTE (V1-E3a): el CIERRE del ciclo, dentro del panel de avance. Saca
 * producto terminado del almacén de PT elegido hacia el cliente de la orden.
 *
 * NO reimplementa nada: pega a los MISMOS endpoints que `EntregaClientePagina` —el dominio
 * `entregas-cliente.ts` es la autoridad (A1)— y acota la matriz con el `seguimiento-entrega` que
 * DERIVA el servidor (pedido − entregado, y el `disponible` del almacén elegido). El servidor
 * re-valida: no deja entregar más que la existencia (no-negativo estricto bajo lock, D3).
 */
function CapturaEntregaCliente({
  orden,
  alRegistrado,
  alCancelar,
}: {
  orden: NonNullable<ReturnType<typeof useOrden>['data']>;
  alRegistrado: (guardado: MovimientoImpreso) => void;
  alCancelar: () => void;
}): React.JSX.Element {
  const { sesion } = useSesion();
  const [fecha, setFecha] = useState(hoy());
  const [idAlmacen, setIdAlmacen] = useState<string>('');
  const [observaciones, setObservaciones] = useState('');
  const [valores, setValores] = useState<Record<string, number>>({});

  const crear = useCrearEntrega();
  // Solo almacenes de PT: el producto terminado no sale de una bodega de tela ni de avíos.
  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  // El almacén de TRÁNSITO se EXCLUYE de TODOS los selectores (V1-E4b, hallazgo H5 del reviewer):
  // guarda lo que está físicamente en el taller de un tercero, y el servidor lo rechaza tanto de
  // origen (entrega a cliente) como de destino (recibo). Ofrecerlo solo servía para cosechar un 400
  // con la matriz ya tecleada. Las prendas que no vuelvan salen de ahí por un movimiento manual de
  // inventario, con su motivo — no por estas pantallas.
  const almacenesPt = (almacenes.data?.datos ?? []).filter(
    (a) => a.tipo === 'PT' && a.activo && !a.esTransitoProceso,
  );

  // Seguimiento DERIVADO (pedido − entregado) + `disponible` del almacén elegido, para acotar.
  const seguimiento = useSeguimientoEntrega(
    orden.id,
    idAlmacen === '' ? {} : { idAlmacen: Number(idAlmacen) },
  );

  /**
   * ⭐ EJES PLEGADOS (§Post-F9.10): la entrega a cliente NO maneja packs — sale de inventario de
   * producto terminado, que se lleva por modelo×color×talla×orden×almacén y no guarda el tendido.
   * Sus celdas (`seguimiento-entrega`) vienen sin pack, así que las filas van igual: una por color.
   * Usar los ejes CON pack habría dado dos filas idénticas por cada color de dos tendidos, con la
   * misma existencia ofrecida dos veces y sin nada que las distinguiera en pantalla.
   */
  const { tallas, colores } = useMemo(() => ejesDeOrdenPlegados(orden), [orden]);

  /** Aviso reintentable: sin almacenes la captura no arranca, y sin seguimiento no hay tope. */
  function reintentarCatalogos(): void {
    void almacenes.refetch();
    void seguimiento.refetch();
  }

  /**
   * Referencia por celda = lo DISPONIBLE en el almacén elegido (que es el tope real de la salida).
   * Sin almacén no hay referencia: la matriz queda en estado NEUTRO en vez de fingir un tope de 0.
   */
  const referencia = useMemo<Map<string, number> | null>(() => {
    if (idAlmacen === '' || seguimiento.data === undefined) {
      return null;
    }
    const mapa = new Map<string, number>();
    for (const c of seguimiento.data.celdas) {
      // Pack vacío: la entrega a cliente no lo maneja y sus filas van plegadas por color.
      mapa.set(claveCelda(c.idColor, c.idTalla, ''), c.disponible);
    }
    return mapa;
  }, [idAlmacen, seguimiento.data]);
  const totalReferencia =
    referencia === null
      ? undefined
      : [...referencia.values()].reduce((s, v) => s + Math.max(0, v), 0);

  const total = Object.values(valores).reduce((s, v) => s + v, 0);
  // Exceso sobre el disponible: el servidor lo rechaza (no-negativo estricto); aquí se avisa en vivo.
  const excede =
    referencia === null
      ? 0
      : Object.entries(valores).reduce((s, [clave, cantidad]) => {
          const disponible = Math.max(0, referencia.get(clave) ?? 0);
          return cantidad > disponible ? s + (cantidad - disponible) : s;
        }, 0);

  const puedeGuardar = !crear.isPending && total > 0 && idAlmacen !== '' && excede === 0;

  function guardar(): void {
    if (idAlmacen === '') return;
    crear.mutate(
      {
        idOrden: orden.id,
        idAlmacen: Number(idAlmacen),
        fecha,
        ...(observaciones.trim() === '' ? {} : { observaciones: observaciones.trim() }),
        lineas: colores
          .map((color) => ({
            idColor: color.idColor,
            tallas: tallas
              .map((t) => ({
                idTalla: t.idTalla,
                cantidad: valores[claveCelda(color.idColor, t.idTalla, color.pack)] ?? 0,
              }))
              .filter((t) => t.cantidad > 0),
          }))
          .filter((l) => l.tallas.length > 0),
      },
      {
        onSuccess: (entrega) => {
          toast.success(
            `Entrega #${entrega.folio} a ${entrega.cliente ?? 'cliente'} registrada (${entrega.totalPiezas.toLocaleString('es-MX')} pzas) · la Ruta Crítica se marca sola ✓`,
          );
          alRegistrado(impresoDeEntrega(entrega.id, entrega.folio));
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="space-y-3 border-b bg-panel-2 px-4 py-3" data-testid="avance-captura">
      <AvisoCatalogos
        hayError={almacenes.isError || seguimiento.isError}
        alReintentar={reintentarCatalogos}
        que="almacenes o el seguimiento del pedido"
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="avance-entrega-fecha">Fecha de entrega</FieldLabel>
          <Input
            id="avance-entrega-fecha"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            data-testid="avance-entrega-fecha"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="avance-entrega-almacen">Almacén de salida</FieldLabel>
          <SelectNativo
            id="avance-entrega-almacen"
            value={idAlmacen}
            onChange={(e) => setIdAlmacen(e.target.value)}
            data-testid="avance-entrega-almacen"
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
          <FieldLabel htmlFor="avance-entrega-obs">
            Observaciones / referencia del pedido
          </FieldLabel>
          <Input
            id="avance-entrega-obs"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Opcional (p. ej. nº de pedido del cliente)"
            data-testid="avance-entrega-observaciones"
          />
        </Field>
      </div>

      {seguimiento.data !== undefined ? (
        <div
          className="grid gap-3 rounded-md border bg-card px-3 py-2 text-sm sm:grid-cols-3"
          data-testid="avance-entrega-seguimiento"
        >
          <span>
            Pedido: <b className="num">{seguimiento.data.totalPedido.toLocaleString('es-MX')}</b>
          </span>
          <span>
            Entregado:{' '}
            <b className="num">{seguimiento.data.totalEntregado.toLocaleString('es-MX')}</b>
          </span>
          <span>
            Faltante:{' '}
            <b className="num">{seguimiento.data.totalFaltante.toLocaleString('es-MX')}</b>
          </span>
        </div>
      ) : null}

      <MatrizColorTalla
        tallas={tallas}
        colores={colores}
        valores={valores}
        onCambiar={(idColor, idTalla, pack, cantidad) =>
          setValores((v) => ({ ...v, [claveCelda(idColor, idTalla, pack)]: cantidad }))
        }
        {...(referencia === null ? {} : { referencia })}
        {...(totalReferencia === undefined ? {} : { totalReferencia })}
        etiquetaReferencia="disponible en el almacén"
        deshabilitada={idAlmacen === ''}
        testid="avance-entrega-matriz"
      />

      {idAlmacen === '' ? (
        <p className="text-sm text-muted-foreground">
          Elige el almacén de salida para ver la existencia disponible y capturar la entrega.
        </p>
      ) : null}

      {excede > 0 ? (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
          data-testid="avance-entrega-aviso-exceso"
        >
          Estás entregando {excede.toLocaleString('es-MX')} pieza(s) por encima de la existencia de
          esta orden en el almacén. Ajusta las cantidades: el servidor no lo permitirá.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
        <span className="mr-auto flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          <span>
            Captura: <b className="text-foreground">{sesion?.nombre ?? '—'}</b>
          </span>
          <span>
            Total a entregar: <b className="num text-foreground">{total.toLocaleString('es-MX')}</b>
          </span>
        </span>
        <Button variant="ghost" onClick={alCancelar} data-testid="avance-cancelar-captura">
          Cancelar
        </Button>
        <Button onClick={guardar} disabled={!puedeGuardar} data-testid="avance-guardar">
          {crear.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Guardar entrega
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
  // ⭐ Los pendientes se CONSUMEN del servidor (ya restan las incompletas), no se restan aquí:
  // ver `pendientesDesdeWip`, y la décima puerta que nació de hacerlo al revés.
  const pendientes = pendientesDesdeWip(wip);
  const faltaAplicacion = pendientes.aplicacion;
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
            pie={`por recibir ${n(pendientes.costura)}`}
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
      {/* CIERRE del ciclo (V1-E3a): lo que ya salió al cliente y lo que le falta salir. Todo
          DERIVADO en servidor (`entregado` / `porEntregar` = recibido de costura − entregado). */}
      <div>
        <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Resumen · entrega al cliente
        </h4>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <TarjetaResumen etiqueta="Ordenada" valor={n(wip.pedido)} />
          <TarjetaResumen etiqueta="Entregada al cliente" valor={n(wip.entregado)} />
          <TarjetaResumen
            etiqueta="Lista por entregar"
            valor={n(Math.max(0, wip.porEntregar))}
            tono={wip.porEntregar > 0 ? 'warn' : 'ok'}
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

/**
 * Diálogo de cancelación SUAVE de un movimiento (corte / empaque / envío / recibo / entrega a
 * cliente) con motivo obligatorio. El backend conserva el movimiento como historial (D3) y, cuando
 * movió inventario (recibo y entrega), registra su INVERSO — nunca edita ni borra.
 *
 * ⭐ 0.114 — cancelar un CORTE o un EMPAQUE se lleva su CARGO EsMa: si el cargo ya está validado, el
 * servidor exige el permiso `esma.cargo-validar` y sin él rechaza la cancelación entera (el error
 * llega al toast tal cual). No hay inventario que revertir en ninguno de los dos.
 */
/** Un maquilero del desglose de pendientes (lo que la pantalla necesita para ofrecer el cierre). */
type MaquileroPendiente = PendientesRecibir['porRecibir'][number]['porMaquilero'][number];

/** Formatea un importe en pesos, o `—` si viene redactado (sin permiso de ver precios). */
function pesos(valor: number | null): string {
  return valor === null
    ? '—'
    : valor.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

/**
 * ⭐ CERRAR LA ORDEN CON UN MAQUILERO (V1, fila 0.109; DANIEL 3-sep-2026) — el botón y su
 * confirmación, más la lista de lo ya cerrado con su DESHACER.
 *
 * Qué pidió Daniel: *«un botón de cerrar la orden»*, que **lo aprieta quien recibe**, que **salda
 * siempre el pendiente** y que **PROPONE** el cobro esperando su visto bueno — *«nunca cobra
 * solo»*. Dos desenlaces, y los dos limpian la lista: cobrado o perdonado.
 *
 * 🔑 AQUÍ NO SE CALCULA NADA. Las piezas a saldar (`faltantesSaldables`), el precio y el importe
 * propuesto los manda el SERVIDOR ya derivados (A1/B2): la confirmación sólo los enseña. Si esta
 * pantalla multiplicara por su cuenta, sería la misma regla escrita en dos lados — y el número que
 * el usuario aprueba tiene que ser exactamente el que el servidor va a escribir.
 */
function BloqueCierreMaquilero({
  idOrden,
  idTipoProceso,
  maquilero,
}: {
  idOrden: number;
  idTipoProceso: number;
  /** El maquilero elegido en la captura, o `null` si todavía no se elige ninguno. */
  maquilero: MaquileroPendiente | null;
}): React.JSX.Element | null {
  const { tienePermiso } = useSesion();
  const cierres = useCierresMaquila(idOrden);
  const [abierto, setAbierto] = useState(false);
  const [aDeshacer, setADeshacer] = useState<CierresMaquila['filas'][number] | null>(null);

  const delProceso = (cierres.data?.filas ?? []).filter((c) => c.idTipoProceso === idTipoProceso);
  const vivos = delProceso.filter((c) => !c.deshecho);
  // 🔴 LA CONDICIÓN ES `faltantesSaldables`, NO `totalPendiente`. `totalPendiente` es una suma
  // PLANA y una celda negativa la compensa: con +5 en una talla y −5 en otra da 0, el botón no
  // aparecería y esa orden —del histórico migrado, que es el grueso de «la lista que nunca se
  // vacía»— no se podría cerrar nunca; y con +5 y −3 diría 2 mientras el servidor saldaría 5. El
  // número saldable lo deriva el SERVIDOR con la misma función que usa al escribir el cierre.
  const puedeCerrar =
    maquilero !== null && maquilero.idMaquilero !== null && maquilero.faltantesSaldables > 0;

  if (!puedeCerrar && vivos.length === 0) {
    return null;
  }

  return (
    <div className="rounded-md border bg-panel px-3 py-2 text-sm" data-testid="cierre-maquila">
      {puedeCerrar && maquilero !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted">
            A <strong className="text-fg">{maquilero.maquilero}</strong> le faltan{' '}
            <strong className="text-fg">
              {maquilero.faltantesSaldables.toLocaleString('es-MX')} pza(s)
            </strong>{' '}
            de esta orden. Si ya no las va a devolver, cierra la orden con él.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => setAbierto(true)}
            data-testid="cierre-maquila-abrir"
          >
            Cerrar la orden con este maquilero
          </Button>
        </div>
      ) : null}

      {vivos.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t pt-2" data-testid="cierre-maquila-lista">
          {vivos.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-muted">
                <strong className="text-fg">{c.maquilero}</strong>:{' '}
                {c.piezasFaltantes.toLocaleString('es-MX')} pza(s) faltantes{' '}
                {c.desenlace === 'cobrado' ? `cobradas (${pesos(c.importe)})` : 'perdonadas'} el{' '}
                {c.fecha}
                {c.desenlace === 'cobrado' && c.idDescuento === null
                  ? ' · sin descuento propuesto: el envío no traía precio pactado'
                  : c.descuentoRevisado
                    ? ' · descuento ya revisado'
                    : ' · descuento propuesto, esperando revisión'}
              </span>
              {tienePermiso('produccion.cancelar') ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setADeshacer(c)}
                  disabled={c.descuentoRevisado}
                  title={
                    c.descuentoRevisado
                      ? 'El descuento ya se revisó: ese importe ya está en el saldo del maquilero'
                      : 'Deshacer el cierre (las piezas vuelven al pendiente)'
                  }
                  data-testid={`cierre-maquila-deshacer-${String(c.id)}`}
                >
                  Deshacer
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {maquilero !== null && maquilero.idMaquilero !== null ? (
        <DialogoCerrarOrdenMaquilero
          abierto={abierto}
          alCerrar={() => setAbierto(false)}
          idOrden={idOrden}
          idTipoProceso={idTipoProceso}
          maquilero={maquilero}
        />
      ) : null}
      <DialogoDeshacerCierre cierre={aDeshacer} alCerrar={() => setADeshacer(null)} />
    </div>
  );
}

/** La confirmación del cierre: enseña QUÉ se salda y CUÁNTO se propone cobrar, antes de hacerlo. */
function DialogoCerrarOrdenMaquilero({
  abierto,
  alCerrar,
  idOrden,
  idTipoProceso,
  maquilero,
}: {
  abierto: boolean;
  alCerrar: () => void;
  idOrden: number;
  idTipoProceso: number;
  maquilero: MaquileroPendiente;
}): React.JSX.Element {
  const cerrar = useCerrarOrdenMaquila();
  const [desenlace, setDesenlace] = useState<'cobrado' | 'perdonado'>('cobrado');
  const [motivo, setMotivo] = useState('');
  const [factura, setFactura] = useState('');

  useEffect(() => {
    if (abierto) {
      setDesenlace('cobrado');
      setMotivo('');
      setFactura('');
    }
  }, [abierto]);

  const sinMotivoAlPerdonar = desenlace === 'perdonado' && motivo.trim().length < 3;

  function confirmar(): void {
    if (maquilero.idMaquilero === null || sinMotivoAlPerdonar) return;
    // El QUÉ se salda NO se manda: lo deriva el servidor bajo bloqueo (D3). Aquí sólo va la
    // decisión (a quién, de qué proceso, cobrar o perdonar).

    cerrar.mutate(
      {
        idOrden,
        cuerpo: {
          idMaquilero: maquilero.idMaquilero,
          idTipoProceso,
          fecha: hoy(),
          desenlace,
          ...(motivo.trim() === '' ? {} : { motivo: motivo.trim() }),
          ...(factura === '' ? {} : { conFactura: factura === 'con' }),
        },
      },
      {
        onSuccess: (c) => {
          toast.success(
            c.desenlace === 'perdonado'
              ? `Orden cerrada con ${c.maquilero}: ${String(c.piezasFaltantes)} pza(s) perdonadas.`
              : c.idDescuento === null
                ? `Orden cerrada con ${c.maquilero}. El envío no traía precio pactado: captura el descuento a mano en su estado de cuenta.`
                : `Orden cerrada con ${c.maquilero}. Se propuso descontarle ${pesos(c.importe)} — nadie cobra hasta que se revise.`,
          );
          alCerrar();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={(a) => (a ? undefined : alCerrar())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cerrar la orden con {maquilero.maquilero}</DialogTitle>
          <DialogDescription>
            Se dan por perdidas las {maquilero.faltantesSaldables.toLocaleString('es-MX')} pza(s)
            que nunca devolvió: dejan de aparecer como pendientes. El cobro sólo se PROPONE — no se
            le cobra nada hasta que alguien lo revise en su estado de cuenta.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-panel-2 px-3 py-2">
            {/* Las TRES cifras salen del servidor, derivadas con la MISMA función que va a escribir
                el cierre y el descuento (`faltantesSaldables`, `precioFaltante`,
                `importeFaltantePropuesto`). Esta pantalla no multiplica ni suma nada: el número que
                el usuario aprueba tiene que ser exactamente el que se va a guardar. */}
            <dt className="text-muted">Piezas que se saldan</dt>
            <dd className="text-right font-medium" data-testid="cierre-piezas">
              {maquilero.faltantesSaldables.toLocaleString('es-MX')}
            </dd>
            <dt className="text-muted">Precio pactado</dt>
            <dd className="text-right font-medium">{pesos(maquilero.precioFaltante)}</dd>
            <dt className="text-muted">Se propondría cobrarle</dt>
            <dd className="text-right font-medium" data-testid="cierre-importe">
              {pesos(maquilero.importeFaltantePropuesto)}
            </dd>
          </dl>
          {maquilero.precioFaltante === null ? (
            <p className="text-xs text-warn">
              El envío no trae precio pactado, así que no se puede proponer el cobro. La orden se
              cierra igual y el descuento se captura a mano en el estado de cuenta del maquilero.
            </p>
          ) : null}
          <Field>
            <FieldLabel htmlFor="cierre-desenlace">¿Qué se hace con el faltante?</FieldLabel>
            <SelectNativo
              id="cierre-desenlace"
              value={desenlace}
              onChange={(e) =>
                setDesenlace(e.target.value === 'perdonado' ? 'perdonado' : 'cobrado')
              }
              data-testid="cierre-desenlace"
            >
              <option value="cobrado">Cobrárselo (se propone el descuento)</option>
              <option value="perdonado">Perdonárselo (no se le cobra nada)</option>
            </SelectNativo>
          </Field>
          {desenlace === 'cobrado' ? (
            <Field>
              <FieldLabel htmlFor="cierre-factura">Con o sin factura</FieldLabel>
              <SelectNativo
                id="cierre-factura"
                value={factura}
                onChange={(e) => setFactura(e.target.value)}
                data-testid="cierre-factura"
              >
                <option value="">Según el catálogo del proveedor</option>
                <option value="con">Con factura</option>
                <option value="sin">Sin factura</option>
              </SelectNativo>
              <p className="text-xs text-muted">
                Sólo hace falta elegir cuando el maquilero factura de las dos formas.
              </p>
            </Field>
          ) : null}
          <Field data-invalid={sinMotivoAlPerdonar}>
            <FieldLabel htmlFor="cierre-motivo">
              Motivo {desenlace === 'perdonado' ? '(obligatorio)' : '(opcional)'}
            </FieldLabel>
            <Input
              id="cierre-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={
                desenlace === 'perdonado' ? 'Por qué se le perdona el faltante' : 'Nota del cierre'
              }
              data-testid="cierre-motivo"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={alCerrar} disabled={cerrar.isPending}>
            Volver
          </Button>
          <Button
            type="button"
            onClick={confirmar}
            disabled={cerrar.isPending || sinMotivoAlPerdonar}
            data-testid="cierre-confirmar"
          >
            {cerrar.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Cerrar la orden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** El DESHACER de un cierre: acto inverso auditado (D3), con su motivo obligatorio. */
function DialogoDeshacerCierre({
  cierre,
  alCerrar,
}: {
  cierre: CierresMaquila['filas'][number] | null;
  alCerrar: () => void;
}): React.JSX.Element {
  const deshacer = useDeshacerCierreMaquila();
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    if (cierre !== null) setMotivo('');
  }, [cierre]);

  const sinMotivo = motivo.trim().length < 3;

  function confirmar(): void {
    if (cierre === null || sinMotivo) return;
    deshacer.mutate(
      { id: cierre.id, cuerpo: { motivo: motivo.trim() } },
      {
        onSuccess: () => {
          toast.success(
            `Cierre deshecho: las ${String(cierre.piezasFaltantes)} pza(s) vuelven a estar pendientes.`,
          );
          alCerrar();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={cierre !== null} onOpenChange={(a) => (a ? undefined : alCerrar())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deshacer el cierre con {cierre?.maquilero ?? ''}</DialogTitle>
          <DialogDescription>
            Las piezas vuelven a estar pendientes y el descuento propuesto queda cancelado (se
            conserva como historial, D3). Escribe el motivo.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Field data-invalid={sinMotivo}>
            <FieldLabel htmlFor="cierre-motivo-deshacer">Motivo</FieldLabel>
            <Input
              id="cierre-motivo-deshacer"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por qué se deshace el cierre"
              data-testid="cierre-motivo-deshacer"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={alCerrar} disabled={deshacer.isPending}>
            Volver
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={confirmar}
            disabled={deshacer.isPending || sinMotivo}
            data-testid="cierre-confirmar-deshacer"
          >
            {deshacer.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Deshacer el cierre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogoCancelarMovimiento({
  movimiento,
  alCerrar,
  alCancelado,
}: {
  movimiento: MovimientoACancelar | null;
  alCerrar: () => void;
  /** Avisa QUÉ se canceló (el panel retira su barra de impresos si era ese movimiento). */
  alCancelado: (cancelado: MovimientoACancelar) => void;
}): React.JSX.Element {
  const cancelarCorte = useCancelarCorte();
  const cancelarEmpaque = useCancelarEmpaque();
  const cancelarEnvio = useCancelarEnvio();
  const cancelarRecibo = useCancelarRecibo();
  const cancelarEntrega = useCancelarEntrega();
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    if (movimiento !== null) setMotivo('');
  }, [movimiento]);

  const tipo = movimiento?.tipo;
  const etiqueta =
    tipo === 'corte'
      ? 'corte'
      : tipo === 'empaque'
        ? 'empaque'
        : tipo === 'recibo_maquila'
          ? 'recibo'
          : tipo === 'entrega_cliente'
            ? 'entrega'
            : 'envío';
  const mutacion =
    tipo === 'corte'
      ? cancelarCorte
      : tipo === 'empaque'
        ? cancelarEmpaque
        : tipo === 'recibo_maquila'
          ? cancelarRecibo
          : tipo === 'entrega_cliente'
            ? cancelarEntrega
            : cancelarEnvio;
  const sinMotivo = motivo.trim().length < 3;

  function confirmar(): void {
    if (movimiento === null || sinMotivo) return;
    mutacion.mutate(
      { id: movimiento.id, cuerpo: { motivo: motivo.trim() } },
      {
        onSuccess: () => {
          toast.success(`Movimiento #${movimiento.folio} cancelado (se conserva como historial).`);
          alCerrar();
          alCancelado(movimiento);
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
