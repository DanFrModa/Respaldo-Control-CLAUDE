import { RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useOrdenesCompra } from '@/api/ordenes-compra';
import {
  useLineasPendientesDeOc,
  useRecepcionesDeOc,
  useRecibir,
  useReversarRecepcion,
} from '@/api/recepciones';
import type { OrdenCompra, OrdenCompraLinea, Recepcion, RecepcionLineaEntrada } from '@/api/tipos';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
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
  /** COLOR de la tela que llegó (B1: obligatorio en telas — la OC no lo define). */
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
 * tela+color desde A2): se EXIGE el color que llegó — la OC se pide por tela y no lo define —, se
 * captura junto el COMPLEMENTO (cardigan) si la tela lo lleva y, opcionalmente, el lote del
 * proveedor; el backend crea la PARTIDA, convierte a unidad de consumo (R1), mueve el kardex por
 * color y recalcula el estatus de la OC. El historial de recepciones se muestra abajo (con su
 * reverso auditado, D3). `compras.recibir` gobierna.
 */
export function RecepcionComprasPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeRecibir = tienePermiso('compras.recibir');

  const [idOc, setIdOc] = useState<string>('');
  const [idAlmacen, setIdAlmacen] = useState<string>('');
  const [factura, setFactura] = useState('');
  const [fecha, setFecha] = useState(hoy());
  const [observaciones, setObservaciones] = useState('');
  const [captura, setCaptura] = useState<Record<number, CapturaRenglon>>({});

  // OC recibibles: autorizadas o recibidas parcialmente (lo que el backend acepta, decisión b).
  const ocsAutorizadas = useOrdenesCompra({
    pagina: 1,
    porPagina: 100,
    estatus: 'autorizada',
    ordenarPor: 'numCompra',
    direccion: 'desc',
  });
  const ocsParciales = useOrdenesCompra({
    pagina: 1,
    porPagina: 100,
    estatus: 'recibida_parcial',
    ordenarPor: 'numCompra',
    direccion: 'desc',
  });
  const ocsRecibibles = useMemo<OrdenCompra[]>(
    () => [...(ocsAutorizadas.data?.datos ?? []), ...(ocsParciales.data?.datos ?? [])],
    [ocsAutorizadas.data, ocsParciales.data],
  );

  const ocSeleccionada = ocsRecibibles.find((o) => String(o.id) === idOc);

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

  /** Reinicia la captura al elegir una OC (un renglón por línea, telas con su componente base). */
  function elegirOc(valor: string): void {
    setIdOc(valor);
    setCaptura({});
    setIntentoPrecarga((n) => n + 1);
    const oc = ocsRecibibles.find((o) => String(o.id) === valor);
    if (oc === undefined) return;
    const inicial: Record<number, CapturaRenglon> = {};
    for (const linea of oc.lineas) {
      inicial[linea.id] = {
        incluir: false,
        // Arranca en blanco: la cantidad real (lo que FALTA) la pone la precarga en cuanto el
        // servidor dice cuánto se ha recibido. Poner aquí lo pedido volvería a invitar al doble
        // conteo durante ese parpadeo.
        cantidad: '',
        idTelaColor: '',
        cantidadComplemento: '',
        precioComplemento: '',
        loteProveedor: '',
      };
    }
    setCaptura(inicial);
  }

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
            <CardTitle>Orden de compra</CardTitle>
            <CardDescription>
              Solo se reciben OC autorizadas o recibidas parcialmente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field>
              <FieldLabel htmlFor="rec-oc">Orden de compra</FieldLabel>
              <SelectNativo
                id="rec-oc"
                value={idOc}
                onChange={(e) => elegirOc(e.target.value)}
                disabled={!puedeRecibir}
                data-testid="rec-oc"
              >
                <option value="">Elige la OC…</option>
                {ocsRecibibles.map((o) => (
                  <option key={o.id} value={String(o.id)}>
                    OC {o.numCompra} · {o.proveedor}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            {ocSeleccionada !== undefined ? (
              <div className="space-y-2 rounded-lg border p-3 text-sm">
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
