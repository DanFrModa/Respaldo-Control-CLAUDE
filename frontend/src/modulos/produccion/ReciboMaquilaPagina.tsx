import { Ban, Loader2Icon, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useOrden } from '@/api/ordenes';
import {
  useCancelarRecibo,
  useCrearRecibo,
  usePendientesRecibir,
  urlImpresoRecibo,
} from '@/api/recibos';
import { useTiposProceso } from '@/api/tipos-proceso';
import type { Orden } from '@/api/tipos';
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
import {
  coloresDeOrden,
  lineasVaciasDeOrden,
  mapaPendiente,
  piezasPorRecibir,
  tallasDeOrden,
  totalMatriz,
} from './matriz-orden';
import { HistorialEtapasOrden } from './HistorialEtapasOrden';

/** Fecha de hoy en YYYY-MM-DD (zona local). */
function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * RECIBO DE MAQUILA UNIFICADO (F3-E4, doc 03-Produccion Paso 5 + flujo paralelo de estampado).
 * UNA pantalla parametrizada por TipoProceso (D8): recibe prenda terminada de costura/estampado y, si
 * el proceso `generaEntradaPt` (costura), la mete a inventario PT (primeras y, opcionalmente,
 * segundas en otro almacén). El maquilero se filtra por el rol del proceso; la matriz se limita a lo
 * PENDIENTE por recibir de ese proceso (enviado − recibido; no deja exceder en UI, pero el server es
 * la verdad: recibido ≤ enviado). Calidad: con el interruptor "Capturar segundas" se pinta una
 * segunda matriz; por celda, primeras = total − segundas. Apagado, todo va como primeras.
 *
 * `produccion.recibo` gobierna la captura; `produccion.cancelar` cancela el último recibo.
 */
export function ReciboMaquilaPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeRecibir = tienePermiso('produccion.recibo');

  const [idOrden, setIdOrden] = useState<number | undefined>(undefined);
  const [idTipoProceso, setIdTipoProceso] = useState<string>('');
  const [idMaquilero, setIdMaquilero] = useState<string>('');
  const [fecha, setFecha] = useState(hoy());
  const [precioPactado, setPrecioPactado] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [lineas, setLineas] = useState<MatrizLinea[]>([]);
  const [tallas, setTallas] = useState<MatrizTalla[]>([]);
  const [capturarSegundas, setCapturarSegundas] = useState(false);
  const [lineasSegundas, setLineasSegundas] = useState<MatrizLinea[]>([]);
  const [idAlmacenPrimeras, setIdAlmacenPrimeras] = useState<string>('');
  const [idAlmacenSegundas, setIdAlmacenSegundas] = useState<string>('');
  const [ultimoRecibo, setUltimoRecibo] = useState<{ id: number; folio: number } | null>(null);

  const orden = useOrden(idOrden);
  const pendientes = usePendientesRecibir(idOrden, idOrden !== undefined);
  const procesos = useTiposProceso({
    pagina: 1,
    porPagina: 50,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  const crear = useCrearRecibo();

  const procesoSel = procesos.data?.datos.find((p) => String(p.id) === idTipoProceso);
  const codigoProceso = procesoSel?.codigo;
  const generaEntradaPt = procesoSel?.generaEntradaPt ?? false;

  // Solo se le puede recibir a quien SÍ recibió el corte (regla de Daniel, 28-jul-2026): la lista
  // sale del pendiente POR MAQUILERO que deriva el servidor, no del catálogo por rol. El servidor
  // lo re-valida al guardar; esto es la comodidad, no el candado. Se ofrecen los que aún deben
  // piezas: al que ya devolvió todo no hay nada que recibirle. Se mira `celdas`, no el total: en el
  // histórico migrado un maquilero puede traer +5 en una talla y −5 en otra (recibo capturado en la
  // talla equivocada en el Access) y el servidor SÍ aceptaría recibirle esas 5.
  const maquilerosPendientes = useMemo(() => {
    const entrada = pendientes.data?.porRecibir.find(
      (p) => procesoSel !== undefined && p.idTipoProceso === procesoSel.id,
    );
    return (entrada?.porMaquilero ?? []).filter(
      (m): m is typeof m & { idMaquilero: number } =>
        m.idMaquilero !== null && m.celdas.some((c) => c.cantidad > 0),
    );
  }, [pendientes.data, procesoSel]);
  // Entrega migrada SIN maquilero (`idTercero` NULL): no se le puede recibir a nadie, pero el
  // pendiente EXISTE — se dice, en vez de fingir que no hay nada (hallazgo del reviewer).
  const pendienteSinMaquilero = useMemo(() => {
    const entrada = pendientes.data?.porRecibir.find(
      (p) => procesoSel !== undefined && p.idTipoProceso === procesoSel.id,
    );
    return (entrada?.porMaquilero ?? [])
      .filter((m) => m.idMaquilero === null)
      .reduce((s, m) => s + piezasPorRecibir(m.celdas), 0);
  }, [pendientes.data, procesoSel]);

  // Almacenes destino (solo se usan cuando el proceso mete a PT).
  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });

  // Aviso reintentable si falla algún catálogo de la captura.
  // Los maquileros ya NO salen de un catálogo (vienen del pendiente de la orden), así que aquí solo
  // quedan los dos catálogos que la captura sí consulta.
  const catalogoError = procesos.isError || almacenes.isError;
  function reintentarCatalogos(): void {
    void procesos.refetch();
    void almacenes.refetch();
  }

  // Al cambiar de proceso, limpia el maquilero elegido: el pendiente por maquilero es de OTRO
  // proceso, así que quien estaba elegido puede no tener nada que devolver en el nuevo.
  useEffect(() => {
    setIdMaquilero('');
  }, [idTipoProceso]);

  function alElegirOrden(o: Orden): void {
    setIdOrden(o.id);
    setTallas(tallasDeOrden(o));
    setLineas(lineasVaciasDeOrden(o));
    setLineasSegundas(lineasVaciasDeOrden(o));
    setUltimoRecibo(null);
  }

  // Pendiente por recibir, por celda, del MAQUILERO elegido (limita la matriz en UI). Antes topaba
  // contra el pendiente del PROCESO entero: con dos maquileros en la orden, la pantalla dejaba
  // capturar lo que tenía el otro y el servidor lo rechazaba al guardar. Sin maquilero elegido no
  // hay referencia (todo excede) — el botón de guardar ya exige elegirlo.
  const porRecibir = useMemo(() => {
    const delMaquilero = maquilerosPendientes.find((m) => String(m.idMaquilero) === idMaquilero);
    return mapaPendiente(delMaquilero?.celdas ?? []);
  }, [maquilerosPendientes, idMaquilero]);

  // Aviso de exceso en UI (el server bloquea; aquí solo informamos en vivo).
  const excede = useMemo(() => {
    let total = 0;
    for (const linea of lineas) {
      for (const [idTalla, cantidad] of Object.entries(linea.cantidades)) {
        const disponible = porRecibir.get(`${linea.idColor}:${Number(idTalla)}`) ?? 0;
        if (cantidad > disponible) {
          total += cantidad - Math.max(disponible, 0);
        }
      }
    }
    return total;
  }, [lineas, porRecibir]);

  // Mapa rápido de segundas por celda (color:talla → cantidad).
  const mapaSegundas = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const linea of lineasSegundas) {
      for (const [idTalla, cantidad] of Object.entries(linea.cantidades)) {
        if (cantidad > 0) {
          mapa.set(`${linea.idColor}:${Number(idTalla)}`, cantidad);
        }
      }
    }
    return mapa;
  }, [lineasSegundas]);

  // Aviso si en alguna celda las segundas superan el total capturado (primeras quedarían negativas).
  const segundasInvalidas = useMemo(() => {
    if (!capturarSegundas) {
      return false;
    }
    for (const [clave, seg] of mapaSegundas) {
      const [colorStr, tallaStr] = clave.split(':');
      const total = lineas.find((l) => l.idColor === Number(colorStr))?.cantidades[
        Number(tallaStr)
      ];
      if (seg > (total ?? 0)) {
        return true;
      }
    }
    return false;
  }, [capturarSegundas, mapaSegundas, lineas]);

  const total = totalMatriz(lineas);
  const puedeGuardar =
    puedeRecibir &&
    idOrden !== undefined &&
    idTipoProceso !== '' &&
    idMaquilero !== '' &&
    total > 0 &&
    excede === 0 &&
    !segundasInvalidas &&
    (!generaEntradaPt || idAlmacenPrimeras !== '') &&
    (!generaEntradaPt || !capturarSegundas || idAlmacenSegundas !== '') &&
    !crear.isPending;

  /** Convierte las matrices (total + segundas) al cuerpo `lineas` que espera el API. */
  function construirLineas(): {
    idColor: number;
    tallas: {
      idTalla: number;
      cantidad: number;
      cantidadPrimeras?: number;
      cantidadSegundas?: number;
    }[];
  }[] {
    return lineas
      .map((linea) => ({
        idColor: linea.idColor,
        tallas: Object.entries(linea.cantidades)
          .map(([idTallaStr, cantidad]) => {
            const idTalla = Number(idTallaStr);
            if (!capturarSegundas) {
              return { idTalla, cantidad };
            }
            const seg = mapaSegundas.get(`${linea.idColor}:${idTalla}`) ?? 0;
            return {
              idTalla,
              cantidad,
              cantidadPrimeras: cantidad - seg,
              cantidadSegundas: seg,
            };
          })
          .filter((t) => t.cantidad > 0),
      }))
      .filter((l) => l.tallas.length > 0);
  }

  function guardar(): void {
    if (idOrden === undefined || idTipoProceso === '' || idMaquilero === '') {
      return;
    }
    crear.mutate(
      {
        idOrden,
        idTipoProceso: Number(idTipoProceso),
        idMaquilero: Number(idMaquilero),
        fecha,
        ...(generaEntradaPt && idAlmacenPrimeras !== ''
          ? { idAlmacenPrimeras: Number(idAlmacenPrimeras) }
          : {}),
        ...(generaEntradaPt && capturarSegundas && idAlmacenSegundas !== ''
          ? { idAlmacenSegundas: Number(idAlmacenSegundas) }
          : {}),
        ...(precioPactado.trim() !== '' ? { precioPactado: Number(precioPactado) } : {}),
        ...(observaciones.trim().length > 0 ? { observaciones: observaciones.trim() } : {}),
        lineas: construirLineas(),
      },
      {
        onSuccess: (recibo) => {
          toast.success(
            `Recibo #${recibo.folio} de ${recibo.tipoProceso ?? 'maquila'} guardado (${recibo.totalPiezas} pzas).`,
          );
          setUltimoRecibo({ id: recibo.id, folio: recibo.folio });
          if (orden.data) {
            setLineas(lineasVaciasDeOrden(orden.data));
            setLineasSegundas(lineasVaciasDeOrden(orden.data));
          }
          void pendientes.refetch();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const esEstampado = codigoProceso === 'estampado' || codigoProceso === 'aplicacion';

  return (
    <div className="h-full overflow-y-auto space-y-6 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Recibo de maquila
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Recibe prenda terminada de costura o arte. Lo de costura entra a inventario PT.
          </p>
        </div>
      </header>

      {catalogoError ? (
        <div
          className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2"
          role="alert"
          data-testid="recibo-error-catalogo"
        >
          <p className="text-sm text-destructive">
            No se pudieron cargar los catálogos de la captura (procesos, maquileros o almacenes).
          </p>
          <Button variant="outline" size="sm" onClick={reintentarCatalogos}>
            Reintentar
          </Button>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Orden</CardTitle>
            <CardDescription>Elige la orden a recibir.</CardDescription>
          </CardHeader>
          <CardContent>
            <SelectorOrden
              idSeleccionada={idOrden}
              alSeleccionar={alElegirOrden}
              testid="recibo-selector-orden"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{orden.data ? `Orden #${orden.data.folio}` : 'Datos del recibo'}</CardTitle>
            <CardDescription>
              {orden.data
                ? `${orden.data.codigoModelo} · ${orden.data.cliente}`
                : 'Selecciona una orden para capturar su recibo.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {idOrden === undefined ? (
              <p className="text-sm text-muted-foreground">Sin orden seleccionada.</p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="proceso">Proceso</FieldLabel>
                    <SelectNativo
                      id="proceso"
                      value={idTipoProceso}
                      onChange={(e) => setIdTipoProceso(e.target.value)}
                      disabled={!puedeRecibir}
                      data-testid="recibo-proceso"
                    >
                      <option value="">Elige un proceso…</option>
                      {(procesos.data?.datos ?? []).map((p) => (
                        <option key={p.id} value={String(p.id)}>
                          {p.nombre}
                        </option>
                      ))}
                    </SelectNativo>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="maquilero">
                      {esEstampado ? 'Prov. de Arte' : 'Maquilero'}
                    </FieldLabel>
                    <SelectNativo
                      id="maquilero"
                      value={idMaquilero}
                      onChange={(e) => setIdMaquilero(e.target.value)}
                      disabled={!puedeRecibir || idTipoProceso === ''}
                      data-testid="recibo-maquilero"
                    >
                      <option value="">
                        {idTipoProceso === ''
                          ? 'Elige el proceso primero…'
                          : pendientes.isPending
                            ? 'Cargando pendientes…'
                            : maquilerosPendientes.length === 0
                              ? 'Nadie tiene piezas por devolver'
                              : 'Elige a quién le recibes…'}
                      </option>
                      {maquilerosPendientes.map((m) => (
                        <option key={m.idMaquilero} value={String(m.idMaquilero)}>
                          {m.maquilero} · {piezasPorRecibir(m.celdas).toLocaleString('es-MX')}{' '}
                          pza(s)
                        </option>
                      ))}
                    </SelectNativo>
                    {pendienteSinMaquilero > 0 ? (
                      <p className="text-xs text-warn" data-testid="recibo-sin-maquilero">
                        Hay {pendienteSinMaquilero.toLocaleString('es-MX')} pza(s) entregadas SIN
                        maquilero (histórico migrado): hay que corregir esa entrega antes de poder
                        recibirlas.
                      </p>
                    ) : null}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="fecha-recibo">Fecha de recibo</FieldLabel>
                    <Input
                      id="fecha-recibo"
                      type="date"
                      value={fecha}
                      onChange={(e) => setFecha(e.target.value)}
                      disabled={!puedeRecibir}
                      data-testid="recibo-fecha"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="precio">Precio pactado</FieldLabel>
                    <Input
                      id="precio"
                      type="number"
                      min={0}
                      step="0.01"
                      value={precioPactado}
                      onChange={(e) => setPrecioPactado(e.target.value)}
                      placeholder="Opcional"
                      disabled={!puedeRecibir}
                      data-testid="recibo-precio"
                    />
                  </Field>
                  <Field className="sm:col-span-2">
                    <FieldLabel htmlFor="obs-recibo">Observaciones</FieldLabel>
                    <Input
                      id="obs-recibo"
                      value={observaciones}
                      onChange={(e) => setObservaciones(e.target.value)}
                      placeholder="Opcional"
                      disabled={!puedeRecibir}
                    />
                  </Field>
                </div>

                {generaEntradaPt ? (
                  <div className="grid gap-4 rounded-md border bg-muted/40 p-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="almacen-primeras">Almacén primeras</FieldLabel>
                      <SelectNativo
                        id="almacen-primeras"
                        value={idAlmacenPrimeras}
                        onChange={(e) => setIdAlmacenPrimeras(e.target.value)}
                        disabled={!puedeRecibir}
                        data-testid="recibo-almacen-primeras"
                      >
                        <option value="">Elige un almacén…</option>
                        {(almacenes.data?.datos ?? []).map((a) => (
                          <option key={a.id} value={String(a.id)}>
                            {a.nombre}
                          </option>
                        ))}
                      </SelectNativo>
                    </Field>
                    {capturarSegundas ? (
                      <Field>
                        <FieldLabel htmlFor="almacen-segundas">Almacén segundas</FieldLabel>
                        <SelectNativo
                          id="almacen-segundas"
                          value={idAlmacenSegundas}
                          onChange={(e) => setIdAlmacenSegundas(e.target.value)}
                          disabled={!puedeRecibir}
                          data-testid="recibo-almacen-segundas"
                        >
                          <option value="">Elige un almacén…</option>
                          {(almacenes.data?.datos ?? []).map((a) => (
                            <option key={a.id} value={String(a.id)}>
                              {a.nombre}
                            </option>
                          ))}
                        </SelectNativo>
                      </Field>
                    ) : null}
                  </div>
                ) : null}

                <div>
                  <h3 className="mb-2 text-sm font-medium">
                    Cantidades recibidas (color × talla)
                    {procesoSel ? ` · limitado a lo enviado de ${procesoSel.nombre}` : ''}
                  </h3>
                  <MatrizColorTalla
                    testid="recibo-matriz"
                    tallas={tallas}
                    lineas={lineas}
                    coloresDisponibles={orden.data ? coloresDeOrden(orden.data) : []}
                    tallasDisponibles={tallas}
                    onLineasChange={setLineas}
                    onTallasChange={setTallas}
                    soloLectura={!puedeRecibir || idTipoProceso === ''}
                  />
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={capturarSegundas}
                    onChange={(e) => setCapturarSegundas(e.target.checked)}
                    disabled={!puedeRecibir || idTipoProceso === ''}
                    className="size-4 rounded border-input"
                    data-testid="recibo-toggle-segundas"
                  />
                  Capturar piezas de segunda (calidad) por celda
                </label>

                {capturarSegundas ? (
                  <div>
                    <h3 className="mb-2 text-sm font-medium">
                      Piezas de SEGUNDA (color × talla) · no exceden el total recibido
                    </h3>
                    <MatrizColorTalla
                      testid="recibo-matriz-segundas"
                      tallas={tallas}
                      lineas={lineasSegundas}
                      coloresDisponibles={orden.data ? coloresDeOrden(orden.data) : []}
                      tallasDisponibles={tallas}
                      onLineasChange={setLineasSegundas}
                      onTallasChange={setTallas}
                      soloLectura={!puedeRecibir || idTipoProceso === ''}
                    />
                  </div>
                ) : null}

                {idTipoProceso === '' ? (
                  <p className="text-sm text-muted-foreground">
                    Elige un proceso para ver lo pendiente por recibir y capturar el recibo.
                  </p>
                ) : null}

                {excede > 0 ? (
                  <p
                    className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    role="alert"
                    data-testid="recibo-aviso-exceso"
                  >
                    Estás recibiendo {excede} pieza(s) por encima de lo enviado a este proceso.
                    Ajusta las cantidades: el servidor no lo permitirá.
                  </p>
                ) : null}

                {segundasInvalidas ? (
                  <p
                    className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    role="alert"
                    data-testid="recibo-aviso-segundas"
                  >
                    En alguna celda las piezas de segunda superan el total recibido. Las primeras no
                    pueden quedar negativas.
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">
                    Total a recibir: <strong>{total.toLocaleString('es-MX')}</strong> pzas
                  </span>
                  <Button onClick={guardar} disabled={!puedeGuardar} data-testid="recibo-guardar">
                    {crear.isPending ? 'Guardando…' : 'Guardar recibo'}
                  </Button>
                </div>

                {ultimoRecibo !== null ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 p-3">
                    <span className="text-sm font-medium">
                      Último recibo guardado: #{ultimoRecibo.folio}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        window.open(urlImpresoRecibo(ultimoRecibo.id), '_blank', 'noopener')
                      }
                      data-testid="recibo-pdf"
                    >
                      <Printer className="mr-1.5 size-4" aria-hidden /> PDF de recibo
                    </Button>
                    <BotonCancelarRecibo
                      recibo={ultimoRecibo}
                      alCancelar={() => {
                        setUltimoRecibo(null);
                        void pendientes.refetch();
                      }}
                    />
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {idOrden !== undefined ? <HistorialEtapasOrden idOrden={idOrden} /> : null}
    </div>
  );
}

/**
 * Botón + diálogo de CANCELACIÓN del recibo recién guardado. Cancelación SUAVE que EXIGE un motivo
 * (lo re-valida el backend, que además registra el inverso de kardex). Mismo patrón que
 * `DialogoCancelarEtapa`. Solo aparece con `produccion.cancelar`.
 */
function BotonCancelarRecibo({
  recibo,
  alCancelar,
}: {
  recibo: { id: number; folio: number };
  alCancelar: () => void;
}): React.JSX.Element | null {
  const { tienePermiso } = useSesion();
  const puedeCancelar = tienePermiso('produccion.cancelar');
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const cancelar = useCancelarRecibo();

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
      { id: recibo.id, cuerpo: { motivo: limpio } },
      {
        onSuccess: () => {
          toast.success(`Recibo #${recibo.folio} cancelado.`);
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
        data-testid="recibo-cancelar"
      >
        <Ban className="mr-1.5 size-4" aria-hidden /> Cancelar recibo
      </Button>

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar recibo #{recibo.folio}</DialogTitle>
            <DialogDescription>
              El recibo se conserva como historial (cancelación suave) y se revierte su entrada a
              inventario con un movimiento inverso. Escribe el motivo.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <Field data-invalid={sinMotivo}>
              <FieldLabel htmlFor="recibo-motivo-cancelar">Motivo</FieldLabel>
              <textarea
                id="recibo-motivo-cancelar"
                rows={3}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Por qué se cancela este recibo"
                className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
                data-testid="recibo-motivo-cancelar"
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
              data-testid="confirmar-cancelar-recibo"
            >
              {cancelar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Cancelar recibo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
