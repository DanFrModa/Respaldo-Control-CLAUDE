import { RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useOrdenCompra } from '@/api/ordenes-compra';
import {
  useLineasPendientesDeOc,
  useOcsRecibibles,
  useRecepcionesDeOc,
  useRecibir,
  useReversarRecepcion,
} from '@/api/recepciones';
import type { OrdenCompraLinea, Recepcion, RecepcionLineaEntrada } from '@/api/tipos';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';
import { SelectorProveedor } from '@/modulos/cxp/SelectorProveedor';
import { useSesion } from '@/sesion/useSesion';

import { descripcionMaterial, EstatusOcBadge, fechaCortaOc } from './piezas';

/** Fecha de hoy en YYYY-MM-DD (zona local). */
function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Tipo del material de un renglón de OC (decide qué captura pide la recepción). */
function tipoLinea(linea: OrdenCompraLinea): 'tela' | 'avio' | 'libre' {
  if (linea.idTela !== null) return 'tela';
  if (linea.idAvio !== null) return 'avio';
  return 'libre';
}

/** Estado de captura de UN renglón de OC en la recepción. */
interface CapturaRenglon {
  /** ¿Se incluye este renglón en la recepción? */
  incluir: boolean;
  /** Cantidad de CUERPO a recibir (en la presentación de la OC). */
  cantidad: string;
  /**
   * COLOR de la tela que llegó (B1: obligatorio en telas).
   * ⭐⭐ V1-E3u (§Post-F9.89): aquí decía *"la OC no lo define"* — ya lo define
   * (`OrdenCompraLinea.idTelaColor`). Sigue siendo obligatorio capturarlo porque manda **lo
   * que de verdad llegó**, pero ya no se adivina: la captura lo PRESELECCIONA desde la OC.
   */
  idTelaColor: string;
  /** Cantidad del COMPLEMENTO (cardigan) que llegó junto (solo telas que lo llevan). */
  cantidadComplemento: string;
  /** Número de lote del PROVEEDOR de la partida (opcional). */
  loteProveedor: string;
  /** Precio unitario del COMPLEMENTO (el cardigan tiene su propio precio; la OC trae uno solo). */
  precioComplemento: string;
}

/**
 * RECEPCIÓN de compras (F4-E3, R7; reescrita en B1). Selecciona una OC AUTORIZADA (o recibida
 * parcial) y recibe su material (parcial o total): captura factura, almacén destino y la cantidad
 * por renglón. Para los renglones de TELA la captura es POR COLOR (el inventario de telas opera por
 * tela+color desde A2): se EXIGE el color que llegó — desde V1-E3u la OC **sí** lo dice y la
 * captura lo preselecciona, pero manda lo que de verdad llegó (§Post-F9.89) —, se
 * captura junto el COMPLEMENTO (cardigan) si la tela lo lleva y, opcionalmente, el lote del
 * proveedor; el backend crea la PARTIDA, convierte a unidad de consumo (R1), mueve el kardex por
 * color y recalcula el estatus de la OC. El historial de recepciones se muestra abajo (con su
 * reverso auditado, D3). `compras.recibir` gobierna.
 */
export function RecepcionComprasPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeRecibir = tienePermiso('compras.recibir');

  const [idOc, setIdOc] = useState<number | null>(null);
  const [proveedor, setProveedor] = useState<{ id: number; nombre: string } | null>(null);
  const [textoNumOc, setTextoNumOc] = useState('');
  const [idAlmacen, setIdAlmacen] = useState<string>('');
  const [factura, setFactura] = useState('');
  const [fecha, setFecha] = useState(hoy());
  const [observaciones, setObservaciones] = useState('');
  const [captura, setCaptura] = useState<Record<number, CapturaRenglon>>({});

  /**
   * §Post-F9.87 — SE EMPIEZA POR EL PROVEEDOR. Quien llega al almacén es el proveedor con su
   * mercancía; el número de OC es lo que hay que AVERIGUAR, no lo que se sabe. El número queda de
   * ATAJO (el de la remisión) y ACOTA: los dos filtros están a la vista, así que el resultado
   * siempre se puede explicar mirando la pantalla.
   *
   * Antes esto era un `<select>` alimentado por DOS consultas de 100 (una `autorizada`, otra
   * `recibida_parcial`): las OC de más abajo eran INALCANZABLES —no incómodas: inalcanzables— y
   * empeoraba sola, porque cada OC nueva empujaba a las viejas fuera del tope. Ahora la búsqueda
   * vive en el SERVIDOR y lo que se recorte se DICE (`truncado`).
   */
  const numOcBuscado = useDebounce(textoNumOc.trim(), 300);
  const numCompra = /^\d+$/.test(numOcBuscado) ? Number(numOcBuscado) : undefined;
  const filtrosOcs = useMemo(
    () => ({
      ...(proveedor === null ? {} : { idProveedor: proveedor.id }),
      ...(numCompra === undefined ? {} : { numCompra }),
    }),
    [proveedor, numCompra],
  );
  const hayFiltro = proveedor !== null || numCompra !== undefined;
  const ocsAbiertas = useOcsRecibibles(filtrosOcs);
  const listaOcs = ocsAbiertas.data?.datos ?? [];

  /**
   * La OC elegida se pide POR ID (no se busca dentro de una página): así la pantalla nunca depende
   * de que la orden venga en la lista de arriba — que es exactamente de dónde salía el defecto.
   */
  const detalleOc = useOrdenCompra(idOc ?? undefined);
  const ocSeleccionada = detalleOc.data;

  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  const recepciones = useRecepcionesDeOc(ocSeleccionada?.id);
  /**
   * Pendiente por recibir de CADA renglón (lo calcula el dominio, A1). Antes la captura precargaba
   * lo PEDIDO COMPLETO ignorando lo ya recibido, y como el backend solo impide repetir un renglón
   * dentro de la MISMA recepción, recibir tres veces el 100 % pasaba en silencio. Ahora se precarga
   * lo que FALTA y se muestra lo ya recibido: la sobre-recepción sigue permitida (puede ser
   * legítima), pero el usuario la VE.
   */
  const pendientes = useLineasPendientesDeOc(ocSeleccionada?.id);
  const pendientePorLinea = useMemo(
    () => new Map((pendientes.data ?? []).map((p) => [p.idOrdenCompraLinea, p])),
    [pendientes.data],
  );
  const recibir = useRecibir();
  const reversar = useReversarRecepcion();

  /**
   * Marca de la última precarga aplicada (`idOc:intento`): la cantidad pendiente llega DESPUÉS de
   * elegir la OC (otra consulta), así que la precarga se aplica en un efecto — una sola vez por
   * selección, para no pisar lo que el usuario ya esté capturando.
   */
  const precargaAplicada = useRef<string>('');
  const [intentoPrecarga, setIntentoPrecarga] = useState(0);

  /**
   * Elige una OC y reinicia la captura. Los renglones ya NO se siembran aquí: el detalle de la OC
   * llega por su propia consulta (`useOrdenCompra`), así que la siembra vive en el efecto de abajo.
   */
  const elegirOc = useCallback((valor: number | null): void => {
    setIdOc(valor);
    setCaptura({});
    setIntentoPrecarga((n) => n + 1);
  }, []);

  /** Cambiar de proveedor suelta la OC elegida: era de otro (o de la búsqueda anterior). */
  function elegirProveedor(nuevo: { id: number; nombre: string } | null): void {
    setProveedor(nuevo);
    elegirOc(null);
  }

  /** Marca de la última siembra de renglones aplicada (`idOc:intento`), ver el efecto de abajo. */
  const siembraAplicada = useRef<string>('');

  /**
   * SIEMBRA los renglones en blanco en cuanto llega el detalle de la OC elegida. Arrancan vacíos a
   * propósito: la cantidad real (lo que FALTA) la pone la precarga cuando el servidor dice cuánto
   * se ha recibido. Poner aquí lo pedido volvería a invitar al doble conteo durante ese parpadeo.
   */
  useEffect(() => {
    if (ocSeleccionada === undefined) return;
    const marca = `${String(ocSeleccionada.id)}:${String(intentoPrecarga)}`;
    if (siembraAplicada.current === marca) return;
    siembraAplicada.current = marca;
    const inicial: Record<number, CapturaRenglon> = {};
    for (const linea of ocSeleccionada.lineas) {
      inicial[linea.id] = {
        incluir: false,
        cantidad: '',
        idTelaColor: '',
        cantidadComplemento: '',
        precioComplemento: '',
        loteProveedor: '',
      };
    }
    setCaptura(inicial);
  }, [ocSeleccionada, intentoPrecarga]);

  /**
   * Si la búsqueda deja UNA SOLA OC abierta, queda elegida sola (Daniel): con una sola opción no
   * hay nada que escoger. La marca por conjunto de ids evita que el efecto pelee con el usuario
   * cuando la misma respuesta se re-entrega desde la cache.
   */
  const autoElegida = useRef<string>('');
  useEffect(() => {
    if (ocsAbiertas.data === undefined) return;
    const marca = ocsAbiertas.data.datos.map((o) => String(o.id)).join(',');
    if (autoElegida.current === marca) return;
    autoElegida.current = marca;
    const unica = ocsAbiertas.data.datos.length === 1 ? ocsAbiertas.data.datos[0] : undefined;
    if (unica !== undefined) {
      elegirOc(unica.id);
    }
  }, [ocsAbiertas.data, elegirOc]);

  /**
   * Precarga de cantidades = lo PENDIENTE (pedido − recibido, con la banda de tolerancia del
   * dominio). Se espera a que la consulta termine (`isFetching`) para no fijar valores viejos tras
   * recibir, y se marca el intento para no re-pisar la captura en cada refetch de fondo.
   *
   * SI LA CONSULTA FALLA **no se precarga nada**: los renglones se quedan EN BLANCO y la pantalla
   * lo dice con un aviso fijo (abajo). Caer a "lo pedido" sería reintroducir justo el defecto que
   * esta pantalla vino a matar — con `retry: false` en el QueryClient (`App.tsx`), un solo 500
   * dejaría precargado el 100 % de una OC que ya trae 40 recibidos, sin decir nada, y confirmar
   * metería el doble al kardex.
   */
  useEffect(() => {
    if (ocSeleccionada === undefined || pendientes.isFetching || pendientes.data === undefined) {
      return;
    }
    const marca = `${String(ocSeleccionada.id)}:${String(intentoPrecarga)}`;
    if (precargaAplicada.current === marca) return;
    precargaAplicada.current = marca;
    const porLinea = new Map(pendientes.data.map((p) => [p.idOrdenCompraLinea, p]));
    setCaptura((prev) => {
      const siguiente: Record<number, CapturaRenglon> = {};
      for (const linea of ocSeleccionada.lineas) {
        const base = prev[linea.id];
        const pendiente = porLinea.get(linea.id);
        siguiente[linea.id] = {
          incluir: base?.incluir ?? false,
          // Sin dato del renglón (no debería pasar: el servidor devuelve TODOS), en blanco: la
          // cantidad la teclea quien recibe, nunca la adivina la pantalla.
          cantidad: pendiente === undefined ? '' : String(pendiente.pendiente),
          idTelaColor: base?.idTelaColor ?? '',
          cantidadComplemento: base?.cantidadComplemento ?? '',
          precioComplemento: base?.precioComplemento ?? '',
          loteProveedor: base?.loteProveedor ?? '',
        };
      }
      return siguiente;
    });
  }, [ocSeleccionada, pendientes.data, pendientes.isFetching, intentoPrecarga]);

  function actualizar(idLinea: number, cambios: Partial<CapturaRenglon>): void {
    setCaptura((prev) => {
      const r = prev[idLinea];
      if (r === undefined) return prev;
      return { ...prev, [idLinea]: { ...r, ...cambios } };
    });
  }

  const lineasIncluidas = ocSeleccionada
    ? ocSeleccionada.lineas.filter((l) => captura[l.id]?.incluir)
    : [];

  function guardar(): void {
    if (ocSeleccionada === undefined || idAlmacen === '') return;
    const lineas: RecepcionLineaEntrada[] = [];
    for (const linea of ocSeleccionada.lineas) {
      const r = captura[linea.id];
      if (r === undefined || !r.incluir) continue;
      const cantidad = Number(r.cantidad);
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        toast.error(`Captura una cantidad válida para "${descripcionMaterial(linea)}".`);
        return;
      }
      if (tipoLinea(linea) === 'tela') {
        // B1: el color es OBLIGATORIO (el backend lo re-exige; aquí sólo evitamos el viaje).
        if (r.idTelaColor === '') {
          toast.error(`Elige el color que llegó de "${descripcionMaterial(linea)}".`);
          return;
        }
        const complemento = Number(r.cantidadComplemento);
        const precioComplemento = Number(r.precioComplemento);
        lineas.push({
          idOrdenCompraLinea: linea.id,
          cantidad,
          telaColor: {
            idTelaColor: Number(r.idTelaColor),
            ...(r.cantidadComplemento.trim().length > 0 && Number.isFinite(complemento)
              ? { cantidadComplemento: complemento }
              : {}),
            // El precio del cardigan (la OC sólo trae el del cuerpo): opcional, va al kardex.
            ...(r.precioComplemento.trim().length > 0 && Number.isFinite(precioComplemento)
              ? { precioUnitComplemento: precioComplemento }
              : {}),
            ...(r.loteProveedor.trim().length > 0 ? { loteProveedor: r.loteProveedor.trim() } : {}),
          },
        });
      } else {
        lineas.push({ idOrdenCompraLinea: linea.id, cantidad });
      }
    }
    if (lineas.length === 0) {
      toast.error('Marca al menos un renglón para recibir.');
      return;
    }
    recibir.mutate(
      {
        idOrdenCompra: ocSeleccionada.id,
        cuerpo: {
          idOrdenCompra: ocSeleccionada.id,
          idAlmacen: Number(idAlmacen),
          fecha,
          ...(factura.trim().length > 0 ? { factura: factura.trim() } : {}),
          ...(observaciones.trim().length > 0 ? { observaciones: observaciones.trim() } : {}),
          lineas,
        },
      },
      {
        onSuccess: (rec) => {
          toast.success(`Recepción #${rec.folio} registrada (OC ${ocSeleccionada.numCompra}).`);
          // Reinicia la captura tras recibir (la OC puede pasar a parcial/total).
          elegirOc(idOc);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function reversarRecepcion(rec: Recepcion): void {
    if (ocSeleccionada === undefined) return;
    const motivo = window.prompt('Motivo del reverso de la recepción:');
    if (motivo === null || motivo.trim().length === 0) return;
    reversar.mutate(
      { id: rec.id, idOrdenCompra: ocSeleccionada.id, cuerpo: { motivo: motivo.trim() } },
      {
        onSuccess: () => toast.success(`Recepción #${rec.folio} reversada.`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const totalRecibir = lineasIncluidas.reduce(
    (s, l) => s + Number(captura[l.id]?.cantidad || 0),
    0,
  );
  const puedeGuardar =
    puedeRecibir &&
    ocSeleccionada !== undefined &&
    idAlmacen !== '' &&
    lineasIncluidas.length > 0 &&
    !recibir.isPending;

  return (
    <div className="h-full overflow-y-auto space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Recepción de compra
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Recibe (parcial o total) el material de una OC autorizada: crea el lote de la tela y da
            entrada al inventario
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>¿Quién llegó a entregar?</CardTitle>
            <CardDescription>
              Busca al proveedor y salen sus OC abiertas. Si traes el número en la remisión,
              tecléalo y llegas directo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field>
              <FieldLabel htmlFor="rec-proveedor-busqueda">Proveedor</FieldLabel>
              <SelectorProveedor
                idInput="rec-proveedor-busqueda"
                idSeleccionado={proveedor?.id}
                nombreSeleccionado={proveedor?.nombre}
                alSeleccionar={(p) => elegirProveedor({ id: p.id, nombre: p.nombre })}
                alLimpiar={() => elegirProveedor(null)}
                deshabilitado={!puedeRecibir}
                testid="rec-proveedor"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="rec-num-oc">…o el número de OC (atajo)</FieldLabel>
              <Input
                id="rec-num-oc"
                inputMode="numeric"
                value={textoNumOc}
                onChange={(e) => {
                  setTextoNumOc(e.target.value);
                  elegirOc(null);
                }}
                placeholder="El de la remisión"
                disabled={!puedeRecibir}
                data-testid="rec-num-oc"
              />
            </Field>

            {/* LAS OC ABIERTAS DEL PROVEEDOR. Cada una dice qué trae pendiente: al recibir, eso es
                lo que permite reconocerla sin abrirla una por una. Quien manda sobre "¿hay lista?"
                es `data`: sin filtro la consulta va DESHABILITADA y en TanStack eso deja
                `isPending` en true para siempre (mostraría "Buscando…" sin buscar nada). */}
            {ocsAbiertas.isError ? (
              <div
                className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
                role="alert"
                data-testid="rec-error-ocs"
              >
                <p>No se pudieron consultar las órdenes abiertas: {ocsAbiertas.error.message}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void ocsAbiertas.refetch()}
                  data-testid="rec-reintentar-ocs"
                >
                  Reintentar
                </Button>
              </div>
            ) : ocsAbiertas.data === undefined ? (
              hayFiltro ? (
                <p className="text-sm text-muted-foreground">Buscando órdenes abiertas…</p>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="rec-sin-filtro">
                  Empieza por el proveedor que llegó a entregar.
                </p>
              )
            ) : listaOcs.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="rec-ocs-vacio">
                No hay OC abiertas que coincidan. Solo se reciben las autorizadas o recibidas
                parcialmente.
              </p>
            ) : (
              <>
                <ul className="space-y-2" data-testid="rec-ocs">
                  {listaOcs.map((oc) => (
                    <li key={oc.id}>
                      <button
                        type="button"
                        onClick={() => elegirOc(oc.id)}
                        disabled={!puedeRecibir}
                        aria-pressed={idOc === oc.id}
                        data-testid={`rec-oc-${oc.id}`}
                        className={`flex w-full flex-col gap-1 rounded-lg border p-2.5 text-left transition-colors ${
                          idOc === oc.id ? 'border-primary bg-primary-soft' : 'hover:bg-accent/60'
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">OC {oc.numCompra}</span>
                          <EstatusOcBadge estatus={oc.estatus} />
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {fechaCortaOc(oc.fecha)} · {oc.renglonesPendientes} de {oc.renglones}{' '}
                          {oc.renglones === 1 ? 'renglón' : 'renglones'} por recibir
                        </span>
                        {oc.materialesPendientes.length > 0 ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {oc.materialesPendientes.join(' · ')}
                            {oc.materialesPendientesMas > 0
                              ? ` +${oc.materialesPendientesMas} más`
                              : ''}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
                {/* SIN TOPES SILENCIOSOS: si algo quedó fuera, se dice y se ofrece la salida. */}
                {ocsAbiertas.data.truncado ? (
                  <p
                    className="rounded-md border border-warn/40 bg-warn-soft p-2 text-xs text-warn"
                    role="alert"
                    data-testid="rec-ocs-truncado"
                  >
                    Se muestran {listaOcs.length} de {ocsAbiertas.data.total} OC abiertas. Escribe
                    el número de la OC para llegar a las demás.
                  </p>
                ) : null}
              </>
            )}

            {ocSeleccionada !== undefined ? (
              <div
                className="space-y-2 rounded-lg border p-3 text-sm"
                data-testid="rec-oc-seleccionada"
              >
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Orden</span>
                  <span className="font-medium">OC {ocSeleccionada.numCompra}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Estatus</span>
                  <EstatusOcBadge estatus={ocSeleccionada.estatus} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Proveedor</span>
                  <span>{ocSeleccionada.proveedor}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Fecha</span>
                  <span>{fechaCortaOc(ocSeleccionada.fecha)}</span>
                </div>
              </div>
            ) : null}

            <Field>
              <FieldLabel htmlFor="rec-almacen">Almacén destino</FieldLabel>
              <SelectNativo
                id="rec-almacen"
                value={idAlmacen}
                onChange={(e) => setIdAlmacen(e.target.value)}
                disabled={!puedeRecibir}
                data-testid="rec-almacen"
              >
                <option value="">Elige el almacén…</option>
                {(almacenes.data?.datos ?? []).map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="rec-factura">Factura</FieldLabel>
                <Input
                  id="rec-factura"
                  value={factura}
                  onChange={(e) => setFactura(e.target.value)}
                  placeholder="Opcional"
                  disabled={!puedeRecibir}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="rec-fecha">Fecha</FieldLabel>
                <Input
                  id="rec-fecha"
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  disabled={!puedeRecibir}
                  data-testid="rec-fecha"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="rec-obs">Observaciones</FieldLabel>
              <Input
                id="rec-obs"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Opcional"
                disabled={!puedeRecibir}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {ocSeleccionada ? `Renglones de la OC ${ocSeleccionada.numCompra}` : 'Renglones'}
            </CardTitle>
            <CardDescription>
              {ocSeleccionada
                ? 'Marca lo que llegó y captura la cantidad; para telas, captura el lote.'
                : 'Selecciona una orden de compra para capturar su recepción.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {ocSeleccionada === undefined ? (
              <p className="text-sm text-muted-foreground">Sin orden seleccionada.</p>
            ) : (
              <>
                {/* Si no se pudo saber lo YA RECIBIDO, se dice FUERTE y FIJO (no un toast que se
                    va): las cantidades quedan en blanco y hay que teclearlas mirando la orden. El
                    QueryClient no reintenta ni refresca al volver al foco, así que el botón de
                    reintentar es la única salida sin recargar la página. */}
                {pendientes.isError ? (
                  <div
                    className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
                    role="alert"
                    data-testid="rec-error-pendientes"
                  >
                    <p>
                      <b>No se pudo consultar lo ya recibido de esta orden.</b> Las cantidades NO se
                      precargaron (en blanco a propósito: precargar lo pedido invitaría a recibir
                      dos veces lo mismo). Captura a mano lo que llegó, o reintenta.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void pendientes.refetch()}
                      data-testid="rec-reintentar-pendientes"
                    >
                      Reintentar
                    </Button>
                  </div>
                ) : null}

                <ul className="space-y-3">
                  {ocSeleccionada.lineas.map((linea) => {
                    const r = captura[linea.id];
                    if (r === undefined) return null;
                    const tipo = tipoLinea(linea);
                    // §Post-F9.14 (Daniel, 7-ago-2026): la TELA ya no se recibe desde la orden
                    // de compra — se recibe capturando la factura del proveedor y ligando cada
                    // renglón a su renglón de OC. El renglón se muestra (para ver qué falta) pero
                    // NO se puede marcar, y se dice a dónde ir. El servidor lo rechaza igual (A1).
                    const esTela = tipo === 'tela';
                    const pendiente = pendientePorLinea.get(linea.id);
                    return (
                      <li key={linea.id} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="flex items-center gap-2 text-sm font-medium">
                            <input
                              type="checkbox"
                              checked={r.incluir}
                              onChange={(e) => actualizar(linea.id, { incluir: e.target.checked })}
                              disabled={!puedeRecibir || esTela}
                              data-testid={`rec-incluir-${linea.id}`}
                            />
                            {descripcionMaterial(linea)}
                            <ChipEstado tono="neutro" sinPunto>
                              {tipo}
                            </ChipEstado>
                          </label>
                          {/* Lo pedido, lo YA RECIBIDO y lo que falta — a la vista, para que la
                              sobre-recepción (que sigue permitida) nunca sea accidental. */}
                          <span
                            className="text-xs text-muted-foreground"
                            data-testid={`rec-pendiente-${linea.id}`}
                          >
                            Pedido: {Number(linea.cantidad).toLocaleString('es-MX')}{' '}
                            {linea.unidad ?? ''}
                            {pendiente !== undefined ? (
                              <>
                                {' · '}
                                Recibido: {pendiente.recibido.toLocaleString('es-MX')}
                                {' · '}
                                {pendiente.surtido ? (
                                  <b className="text-ok">Ya surtido</b>
                                ) : (
                                  <>
                                    Falta: <b>{pendiente.pendiente.toLocaleString('es-MX')}</b>
                                  </>
                                )}
                              </>
                            ) : null}
                          </span>
                        </div>
                        {esTela ? (
                          <p
                            className="mt-2 text-xs text-muted-foreground"
                            data-testid={`rec-tela-por-factura-${linea.id}`}
                          >
                            La tela se recibe capturando la <strong>factura o remisión</strong> del
                            proveedor en <em>Inventarios › Telas › Entradas</em> y ligando ahí este
                            renglón a la orden. Al confirmarla, la orden queda marcada como
                            recibida.
                          </p>
                        ) : null}

                        {r.incluir ? (
                          <div className="mt-3 space-y-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Field>
                                <FieldLabel htmlFor={`rec-cant-${linea.id}`}>
                                  Cantidad recibida
                                </FieldLabel>
                                <Input
                                  id={`rec-cant-${linea.id}`}
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={r.cantidad}
                                  onChange={(e) =>
                                    actualizar(linea.id, { cantidad: e.target.value })
                                  }
                                  disabled={!puedeRecibir}
                                  data-testid={`rec-cant-${linea.id}`}
                                />
                              </Field>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>

                <div className="flex items-center justify-between gap-3 border-t pt-3">
                  <span className="text-sm text-muted-foreground">
                    Renglones a recibir: <strong>{lineasIncluidas.length}</strong> · Total:{' '}
                    <strong>{totalRecibir.toLocaleString('es-MX')}</strong>
                  </span>
                  <Button onClick={guardar} disabled={!puedeGuardar} data-testid="rec-guardar">
                    {recibir.isPending ? 'Recibiendo…' : 'Registrar recepción'}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {ocSeleccionada !== undefined ? (
        <Card>
          <CardHeader>
            <CardTitle>Historial de recepciones</CardTitle>
            <CardDescription>
              Recepciones de la OC {ocSeleccionada.numCompra} (la reversa neutraliza el inventario
              sin borrar nada).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(recepciones.data?.recepciones ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin recepciones todavía.</p>
            ) : (
              <ul className="space-y-2" data-testid="rec-historial">
                {(recepciones.data?.recepciones ?? []).map((rec) => (
                  <li
                    key={rec.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">Recepción #{rec.folio}</span>
                      <span className="text-muted-foreground">{fechaCortaOc(rec.fecha)}</span>
                      {rec.factura !== null ? (
                        <span className="text-muted-foreground">· Factura {rec.factura}</span>
                      ) : null}
                      <span className="text-muted-foreground">· {rec.almacen}</span>
                      <span className="text-muted-foreground">
                        · {rec.lineas.length} renglón(es)
                      </span>
                      {rec.reversada ? (
                        <ChipEstado tono="crit">Reversada</ChipEstado>
                      ) : (
                        <ChipEstado tono="ok">Activa</ChipEstado>
                      )}
                    </div>
                    {!rec.reversada && puedeRecibir ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => reversarRecepcion(rec)}
                        disabled={reversar.isPending}
                        data-testid={`rec-reversar-${rec.id}`}
                      >
                        <RotateCcw className="size-4" aria-hidden /> Reversar
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
