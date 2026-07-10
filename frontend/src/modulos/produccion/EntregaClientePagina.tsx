import { Ban, Loader2Icon, Printer, Truck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import {
  useCancelarEntrega,
  useCrearEntrega,
  useEntregasOrden,
  useSeguimientoEntrega,
  urlComprobanteEntrega,
} from '@/api/entregas-cliente';
import { useOrden } from '@/api/ordenes';
import type { EntregaHistorial, Orden } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  MatrizColorTalla,
  type MatrizLinea,
  type MatrizTalla,
} from '@/componentes/matriz-color-talla/MatrizColorTalla';
import { useSesion } from '@/sesion/useSesion';

import { SelectorOrden } from './SelectorOrden';
import { coloresDeOrden, lineasVaciasDeOrden, tallasDeOrden, totalMatriz } from './matriz-orden';

/** Fecha de hoy en YYYY-MM-DD (zona local). */
function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * ENTREGA A CLIENTE (F3-E5, doc 03-Produccion "Entrega"): CIERRE del ciclo de la orden. Saca el
 * producto terminado del almacén PT elegido hacia el cliente (salida de kardex) y deja el
 * seguimiento del pedido (entregado/faltante) DERIVADO. La matriz se acota a lo DISPONIBLE en el
 * almacén (existencia) y a lo FALTANTE del pedido; el servidor es la verdad: no deja entregar más
 * de la existencia (no-negativo estricto) ni de lo no producido.
 *
 * `produccion.entrega` gobierna la captura; `produccion.cancelar` cancela una entrega (inverso de
 * kardex que devuelve la existencia y el pendiente).
 */
export function EntregaClientePagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeEntregar = tienePermiso('produccion.entrega');

  const [idOrden, setIdOrden] = useState<number | undefined>(undefined);
  const [idAlmacen, setIdAlmacen] = useState<string>('');
  const [fecha, setFecha] = useState(hoy());
  const [observaciones, setObservaciones] = useState('');
  const [lineas, setLineas] = useState<MatrizLinea[]>([]);
  const [tallas, setTallas] = useState<MatrizTalla[]>([]);
  const [ultimaEntrega, setUltimaEntrega] = useState<{ id: number; folio: number } | null>(null);

  const orden = useOrden(idOrden);
  const crear = useCrearEntrega();

  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });

  // Seguimiento del pedido (pedido − entregado) con el disponible del almacén elegido (si hay).
  const seguimiento = useSeguimientoEntrega(
    idOrden,
    idAlmacen !== '' ? { idAlmacen: Number(idAlmacen) } : {},
    idOrden !== undefined,
  );

  function alElegirOrden(o: Orden): void {
    setIdOrden(o.id);
    setTallas(tallasDeOrden(o));
    setLineas(lineasVaciasDeOrden(o));
    setUltimaEntrega(null);
  }

  // Disponible por celda (color:talla → existencia en el almacén elegido) para acotar la captura en UI.
  const disponible = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const c of seguimiento.data?.celdas ?? []) {
      mapa.set(`${c.idColor}:${c.idTalla}`, c.disponible);
    }
    return mapa;
  }, [seguimiento.data]);

  // Aviso de exceso en UI (el server bloquea; aquí solo informamos en vivo): por encima del disponible.
  const excede = useMemo(() => {
    if (idAlmacen === '') {
      return 0;
    }
    let total = 0;
    for (const linea of lineas) {
      for (const [idTalla, cantidad] of Object.entries(linea.cantidades)) {
        const disp = disponible.get(`${linea.idColor}:${Number(idTalla)}`) ?? 0;
        if (cantidad > disp) {
          total += cantidad - Math.max(disp, 0);
        }
      }
    }
    return total;
  }, [lineas, disponible, idAlmacen]);

  const total = totalMatriz(lineas);
  const puedeGuardar =
    puedeEntregar &&
    idOrden !== undefined &&
    idAlmacen !== '' &&
    total > 0 &&
    excede === 0 &&
    !crear.isPending;

  /** Convierte la matriz al cuerpo `lineas` que espera el API (descartando ceros). */
  function construirLineas(): {
    idColor: number;
    tallas: { idTalla: number; cantidad: number }[];
  }[] {
    return lineas
      .map((linea) => ({
        idColor: linea.idColor,
        tallas: Object.entries(linea.cantidades)
          .map(([idTalla, cantidad]) => ({ idTalla: Number(idTalla), cantidad }))
          .filter((t) => t.cantidad > 0),
      }))
      .filter((l) => l.tallas.length > 0);
  }

  function guardar(): void {
    if (idOrden === undefined || idAlmacen === '') {
      return;
    }
    crear.mutate(
      {
        idOrden,
        idAlmacen: Number(idAlmacen),
        fecha,
        ...(observaciones.trim().length > 0 ? { observaciones: observaciones.trim() } : {}),
        lineas: construirLineas(),
      },
      {
        onSuccess: (entrega) => {
          toast.success(
            `Entrega #${entrega.folio} a ${entrega.cliente ?? 'cliente'} guardada (${entrega.totalPiezas} pzas).`,
          );
          setUltimaEntrega({ id: entrega.id, folio: entrega.folio });
          if (orden.data) {
            setLineas(lineasVaciasDeOrden(orden.data));
          }
          void seguimiento.refetch();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Entrega a cliente
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Saca producto terminado del inventario hacia el cliente. Cierra el ciclo del pedido.
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Orden</CardTitle>
            <CardDescription>Elige la orden a entregar.</CardDescription>
          </CardHeader>
          <CardContent>
            <SelectorOrden
              idSeleccionada={idOrden}
              alSeleccionar={alElegirOrden}
              testid="entrega-selector-orden"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {orden.data ? `Orden #${orden.data.folio}` : 'Datos de la entrega'}
            </CardTitle>
            <CardDescription>
              {orden.data
                ? `${orden.data.codigoModelo} · ${orden.data.cliente}`
                : 'Selecciona una orden para capturar su entrega.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {idOrden === undefined ? (
              <p className="text-sm text-muted-foreground">Sin orden seleccionada.</p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="almacen-origen">Almacén de salida</FieldLabel>
                    <SelectNativo
                      id="almacen-origen"
                      value={idAlmacen}
                      onChange={(e) => setIdAlmacen(e.target.value)}
                      disabled={!puedeEntregar}
                      data-testid="entrega-almacen"
                    >
                      <option value="">Elige un almacén…</option>
                      {(almacenes.data?.datos ?? []).map((a) => (
                        <option key={a.id} value={String(a.id)}>
                          {a.nombre}
                        </option>
                      ))}
                    </SelectNativo>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="fecha-entrega">Fecha de entrega</FieldLabel>
                    <Input
                      id="fecha-entrega"
                      type="date"
                      value={fecha}
                      onChange={(e) => setFecha(e.target.value)}
                      disabled={!puedeEntregar}
                      data-testid="entrega-fecha"
                    />
                  </Field>
                  <Field className="sm:col-span-2">
                    <FieldLabel htmlFor="obs-entrega">
                      Observaciones / referencia de pedido
                    </FieldLabel>
                    <Input
                      id="obs-entrega"
                      value={observaciones}
                      onChange={(e) => setObservaciones(e.target.value)}
                      placeholder="Opcional (p. ej. número de pedido del cliente)"
                      disabled={!puedeEntregar}
                      data-testid="entrega-observaciones"
                    />
                  </Field>
                </div>

                {seguimiento.data ? (
                  <div className="grid gap-3 rounded-md border bg-muted/40 p-3 text-sm sm:grid-cols-3">
                    <span>
                      Pedido:{' '}
                      <strong>{seguimiento.data.totalPedido.toLocaleString('es-MX')}</strong>
                    </span>
                    <span>
                      Entregado:{' '}
                      <strong>{seguimiento.data.totalEntregado.toLocaleString('es-MX')}</strong>
                    </span>
                    <span>
                      Faltante:{' '}
                      <strong>{seguimiento.data.totalFaltante.toLocaleString('es-MX')}</strong>
                    </span>
                  </div>
                ) : null}

                <div>
                  <h3 className="mb-2 text-sm font-medium">
                    Cantidades a entregar (color × talla)
                    {idAlmacen !== '' ? ' · acotado a la existencia del almacén' : ''}
                  </h3>
                  <MatrizColorTalla
                    testid="entrega-matriz"
                    tallas={tallas}
                    lineas={lineas}
                    coloresDisponibles={orden.data ? coloresDeOrden(orden.data) : []}
                    tallasDisponibles={tallas}
                    onLineasChange={setLineas}
                    onTallasChange={setTallas}
                    soloLectura={!puedeEntregar || idAlmacen === ''}
                  />
                </div>

                {idAlmacen === '' ? (
                  <p className="text-sm text-muted-foreground">
                    Elige un almacén de salida para ver la existencia disponible y capturar la
                    entrega.
                  </p>
                ) : null}

                {excede > 0 ? (
                  <p
                    className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    role="alert"
                    data-testid="entrega-aviso-exceso"
                  >
                    Estás entregando {excede} pieza(s) por encima de la existencia en este almacén.
                    Ajusta las cantidades: el servidor no lo permitirá.
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">
                    Total a entregar: <strong>{total.toLocaleString('es-MX')}</strong> pzas
                  </span>
                  <Button onClick={guardar} disabled={!puedeGuardar} data-testid="entrega-guardar">
                    {crear.isPending ? 'Guardando…' : 'Guardar entrega'}
                  </Button>
                </div>

                {ultimaEntrega !== null ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 p-3">
                    <span className="text-sm font-medium">
                      Última entrega guardada: #{ultimaEntrega.folio}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        window.open(urlComprobanteEntrega(ultimaEntrega.id), '_blank', 'noopener')
                      }
                      data-testid="entrega-pdf"
                    >
                      <Printer className="mr-1.5 size-4" aria-hidden /> Comprobante PDF
                    </Button>
                    <BotonCancelarEntrega
                      entrega={ultimaEntrega}
                      alCancelar={() => {
                        setUltimaEntrega(null);
                        void seguimiento.refetch();
                      }}
                    />
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {idOrden !== undefined ? <HistorialEntregasOrden idOrden={idOrden} /> : null}
    </div>
  );
}

/**
 * HISTORIAL de entregas de la orden (F3-E5): VIVAS y CANCELADAS (las canceladas se conservan,
 * marcadas). En cada entrega viva, un botón "Cancelar" abre el diálogo de motivo (el backend
 * revierte la salida de kardex con un inverso). `produccion.wip-ver` ve el historial;
 * `produccion.cancelar`, los botones.
 */
function HistorialEntregasOrden({ idOrden }: { idOrden: number }): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeCancelar = tienePermiso('produccion.cancelar');
  const consulta = useEntregasOrden(idOrden);
  const [aCancelar, setACancelar] = useState<EntregaHistorial | null>(null);

  const entregas = consulta.data?.entregas ?? [];

  return (
    <>
      <Card data-testid="historial-entregas">
        <CardHeader>
          <CardTitle>Entregas de la orden</CardTitle>
          <CardDescription>
            Entregas capturadas (las canceladas se conservan como historial).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {consulta.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {consulta.error.message}
            </p>
          ) : consulta.isPending ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : entregas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Esta orden aún no tiene entregas.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {entregas.map((entrega) => (
                <li
                  key={entrega.id}
                  className={`flex items-center justify-between gap-3 p-3 ${entrega.cancelado ? 'opacity-60' : ''}`}
                  data-testid="historial-entrega"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Truck className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        Entrega #{entrega.folio}
                        {entrega.cancelado ? (
                          <Badge variant="secondary" data-testid="historial-entrega-cancelada">
                            Cancelada
                          </Badge>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {entrega.cliente ?? 'Cliente'} · {entrega.totalPiezas} pzas ·{' '}
                        {entrega.fecha}
                        {entrega.cancelado && entrega.motivoCancelacion
                          ? ` · Motivo: ${entrega.motivoCancelacion}`
                          : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        window.open(urlComprobanteEntrega(entrega.id), '_blank', 'noopener')
                      }
                      aria-label={`Comprobante de la entrega ${entrega.folio}`}
                    >
                      <Printer className="size-4" aria-hidden />
                    </Button>
                    {puedeCancelar && !entrega.cancelado ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setACancelar(entrega)}
                        data-testid="historial-entrega-cancelar"
                      >
                        <Ban className="mr-1.5 size-4" aria-hidden /> Cancelar
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <DialogoCancelarEntrega entrega={aCancelar} alCerrar={() => setACancelar(null)} />
    </>
  );
}

/**
 * Botón + diálogo de CANCELACIÓN de la entrega recién guardada. Cancelación SUAVE que EXIGE un
 * motivo (lo re-valida el backend, que registra el inverso de kardex). Solo aparece con
 * `produccion.cancelar`.
 */
function BotonCancelarEntrega({
  entrega,
  alCancelar,
}: {
  entrega: { id: number; folio: number };
  alCancelar: () => void;
}): React.JSX.Element | null {
  const { tienePermiso } = useSesion();
  const puedeCancelar = tienePermiso('produccion.cancelar');
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const cancelar = useCancelarEntrega();

  useEffect(() => {
    if (abierto) {
      setMotivo('');
    }
  }, [abierto]);

  if (!puedeCancelar) {
    return null;
  }

  const sinMotivo = motivo.trim().length === 0;

  function confirmar(): void {
    const limpio = motivo.trim();
    if (limpio.length === 0) {
      return;
    }
    cancelar.mutate(
      { id: entrega.id, cuerpo: { motivo: limpio } },
      {
        onSuccess: () => {
          toast.success(`Entrega #${entrega.folio} cancelada.`);
          setAbierto(false);
          alCancelar();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setAbierto(true)}
        data-testid="entrega-cancelar"
      >
        <Ban className="mr-1.5 size-4" aria-hidden /> Cancelar entrega
      </Button>

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar entrega #{entrega.folio}</DialogTitle>
            <DialogDescription>
              La entrega se conserva como historial (cancelación suave) y se revierte su salida de
              inventario con un movimiento inverso. Escribe el motivo.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <Field data-invalid={sinMotivo}>
              <FieldLabel htmlFor="entrega-motivo-cancelar">Motivo</FieldLabel>
              <textarea
                id="entrega-motivo-cancelar"
                rows={3}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Por qué se cancela esta entrega"
                className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
                data-testid="entrega-motivo-cancelar"
              />
            </Field>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAbierto(false)}
              disabled={cancelar.isPending}
            >
              Volver
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmar}
              disabled={cancelar.isPending || sinMotivo}
              data-testid="confirmar-cancelar-entrega"
            >
              {cancelar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Cancelar entrega
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Diálogo de CANCELACIÓN de una entrega del HISTORIAL. Cancelación SUAVE que EXIGE un motivo (lo
 * re-valida el backend, que revierte la salida de kardex con un inverso). Mismo patrón que
 * `DialogoCancelarEtapa` del historial de etapas.
 */
function DialogoCancelarEntrega({
  entrega,
  alCerrar,
}: {
  entrega: EntregaHistorial | null;
  alCerrar: () => void;
}): React.JSX.Element {
  const cancelar = useCancelarEntrega();
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    if (entrega !== null) {
      setMotivo('');
    }
  }, [entrega]);

  const sinMotivo = motivo.trim().length === 0;

  function confirmar(): void {
    if (entrega === null) {
      return;
    }
    const limpio = motivo.trim();
    if (limpio.length === 0) {
      return;
    }
    cancelar.mutate(
      { id: entrega.id, cuerpo: { motivo: limpio } },
      {
        onSuccess: () => {
          toast.success(`Entrega #${entrega.folio} cancelada.`);
          alCerrar();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={entrega !== null} onOpenChange={(abierto) => (abierto ? undefined : alCerrar())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar entrega {entrega ? `#${entrega.folio}` : ''}</DialogTitle>
          <DialogDescription>
            La entrega se conserva como historial (cancelación suave) y se revierte su salida de
            inventario con un movimiento inverso. Escribe el motivo.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Field data-invalid={sinMotivo}>
            <FieldLabel htmlFor="historial-entrega-motivo">Motivo</FieldLabel>
            <textarea
              id="historial-entrega-motivo"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por qué se cancela esta entrega"
              className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
              data-testid="historial-entrega-motivo"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={alCerrar} disabled={cancelar.isPending}>
            Volver
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={confirmar}
            disabled={cancelar.isPending || sinMotivo}
            data-testid="confirmar-cancelar-entrega-historial"
          >
            {cancelar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Cancelar entrega
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
