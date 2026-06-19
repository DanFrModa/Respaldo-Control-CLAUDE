import { FileText, Printer, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  useCrearEnvio,
  usePendientesOrden,
  urlFichaEstampado,
  urlImpresoEnvio,
} from '@/api/etapas';
import { useOrden } from '@/api/ordenes';
import { useProveedores, useRolesProveedor } from '@/api/proveedores';
import { useTiposProceso } from '@/api/tipos-proceso';
import type { Orden } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  aLineasApi,
  coloresDeOrden,
  lineasVaciasDeOrden,
  mapaCortadoPorEnviar,
  tallasDeOrden,
  totalMatriz,
} from './matriz-orden';
import { HistorialEtapasOrden } from './HistorialEtapasOrden';

/** Fecha de hoy en YYYY-MM-DD (zona local). */
function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Mapeo `TipoProceso.codigo` → `RolProveedor.codigo` (espejo del dominio, D12/R15): costura usa el
 * rol `maquila-costura`; el resto es identidad. Sirve para filtrar el maquilero por proceso en la
 * UI; el servidor es la AUTORIDAD (re-valida el rol).
 */
function rolDelProceso(codigoProceso: string): string {
  return codigoProceso === 'costura' ? 'maquila-costura' : codigoProceso;
}

/**
 * ENVÍO A MAQUILA UNIFICADO (F3-E2, doc 03-Produccion Paso 4 + flujo paralelo de estampado). UNA
 * pantalla parametrizada por TipoProceso (D8): cambiar el proceso a estampado en la MISMA pantalla
 * hace un envío al estampador (no es otra pantalla). El maquilero se filtra por el rol del proceso;
 * la matriz se limita al cortado disponible para ese proceso (no deja exceder en UI, pero el server
 * es la verdad: sobre-envío estricto, decisión (g)). Botones para descargar el PDF de envío y la
 * ficha de estampado del último envío guardado.
 *
 * `produccion.envio` gobierna la captura.
 */
export function EnvioMaquilaPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeEnviar = tienePermiso('produccion.envio');

  const [idOrden, setIdOrden] = useState<number | undefined>(undefined);
  const [idTipoProceso, setIdTipoProceso] = useState<string>('');
  const [idMaquilero, setIdMaquilero] = useState<string>('');
  const [fecha, setFecha] = useState(hoy());
  const [fechaCompromiso, setFechaCompromiso] = useState('');
  const [precioPactado, setPrecioPactado] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [lineas, setLineas] = useState<MatrizLinea[]>([]);
  const [tallas, setTallas] = useState<MatrizTalla[]>([]);
  const [ultimoEnvio, setUltimoEnvio] = useState<{ id: number; folio: number } | null>(null);

  const orden = useOrden(idOrden);
  const pendientes = usePendientesOrden(idOrden, idOrden !== undefined);
  const procesos = useTiposProceso({
    pagina: 1,
    porPagina: 50,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  const crear = useCrearEnvio();

  const procesoSel = procesos.data?.datos.find((p) => String(p.id) === idTipoProceso);
  const codigoProceso = procesoSel?.codigo;

  // Maquilero filtrado por el rol que mapea al proceso elegido.
  const roles = useRolesProveedor();
  const idRolMaquilero =
    codigoProceso === undefined
      ? undefined
      : roles.data?.find((r) => r.codigo === rolDelProceso(codigoProceso))?.id;
  const maquileros = useProveedores({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    ...(idRolMaquilero === undefined ? {} : { rol: idRolMaquilero }),
  });

  // Al cambiar de proceso, limpia el maquilero elegido (su rol pudo dejar de aplicar).
  useEffect(() => {
    setIdMaquilero('');
  }, [idTipoProceso]);

  function alElegirOrden(o: Orden): void {
    setIdOrden(o.id);
    setTallas(tallasDeOrden(o));
    setLineas(lineasVaciasDeOrden(o));
    setUltimoEnvio(null);
  }

  // Cortado disponible para ESTE proceso, por celda (limita la matriz en UI).
  const cortadoPorEnviar = mapaCortadoPorEnviar(
    pendientes.data,
    procesoSel ? procesoSel.id : undefined,
  );

  // Aviso de exceso en UI (el server bloquea; aquí solo informamos en vivo).
  const excede = useMemo(() => {
    let total = 0;
    for (const linea of lineas) {
      for (const [idTalla, cantidad] of Object.entries(linea.cantidades)) {
        const disponible = cortadoPorEnviar.get(`${linea.idColor}:${Number(idTalla)}`) ?? 0;
        if (cantidad > disponible) {
          total += cantidad - Math.max(disponible, 0);
        }
      }
    }
    return total;
  }, [lineas, cortadoPorEnviar]);

  const total = totalMatriz(lineas);
  const puedeGuardar =
    puedeEnviar &&
    idOrden !== undefined &&
    idTipoProceso !== '' &&
    idMaquilero !== '' &&
    total > 0 &&
    excede === 0 &&
    !crear.isPending;

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
        ...(fechaCompromiso !== '' ? { fechaCompromiso } : {}),
        ...(precioPactado.trim() !== '' ? { precioPactado: Number(precioPactado) } : {}),
        ...(observaciones.trim().length > 0 ? { observaciones: observaciones.trim() } : {}),
        lineas: aLineasApi(lineas),
      },
      {
        onSuccess: (etapa) => {
          toast.success(
            `Envío #${etapa.folio} a ${etapa.tipoProceso} guardado (${etapa.totalPiezas} pzas).`,
          );
          setUltimoEnvio({ id: etapa.id, folio: etapa.folio });
          if (orden.data) {
            setLineas(lineasVaciasDeOrden(orden.data));
          }
          void pendientes.refetch();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const esEstampado = codigoProceso === 'estampado' || codigoProceso === 'aplicacion';

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
          <Send className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Envío a maquila</h1>
          <p className="text-sm text-muted-foreground">
            Costura, estampado, bordado o lavado desde una sola pantalla. No deja exceder lo
            cortado.
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Orden</CardTitle>
            <CardDescription>Elige la orden a enviar.</CardDescription>
          </CardHeader>
          <CardContent>
            <SelectorOrden
              idSeleccionada={idOrden}
              alSeleccionar={alElegirOrden}
              testid="envio-selector-orden"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{orden.data ? `Orden #${orden.data.folio}` : 'Datos del envío'}</CardTitle>
            <CardDescription>
              {orden.data
                ? `${orden.data.codigoModelo} · ${orden.data.cliente}`
                : 'Selecciona una orden para capturar su envío.'}
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
                      disabled={!puedeEnviar}
                      data-testid="envio-proceso"
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
                      {esEstampado ? 'Estampador' : 'Maquilero'}
                    </FieldLabel>
                    <SelectNativo
                      id="maquilero"
                      value={idMaquilero}
                      onChange={(e) => setIdMaquilero(e.target.value)}
                      disabled={!puedeEnviar || idTipoProceso === ''}
                      data-testid="envio-maquilero"
                    >
                      <option value="">
                        {idTipoProceso === '' ? 'Elige el proceso primero…' : 'Elige uno…'}
                      </option>
                      {(maquileros.data?.datos ?? []).map((m) => (
                        <option key={m.id} value={String(m.id)}>
                          {m.nombre}
                        </option>
                      ))}
                    </SelectNativo>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="fecha-envio">Fecha de envío</FieldLabel>
                    <Input
                      id="fecha-envio"
                      type="date"
                      value={fecha}
                      onChange={(e) => setFecha(e.target.value)}
                      disabled={!puedeEnviar}
                      data-testid="envio-fecha"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="fecha-compromiso">Fecha compromiso</FieldLabel>
                    <Input
                      id="fecha-compromiso"
                      type="date"
                      value={fechaCompromiso}
                      onChange={(e) => setFechaCompromiso(e.target.value)}
                      disabled={!puedeEnviar}
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
                      disabled={!puedeEnviar}
                      data-testid="envio-precio"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="obs-envio">Observaciones</FieldLabel>
                    <Input
                      id="obs-envio"
                      value={observaciones}
                      onChange={(e) => setObservaciones(e.target.value)}
                      placeholder="Opcional"
                      disabled={!puedeEnviar}
                    />
                  </Field>
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-medium">
                    Cantidades a enviar (color × talla)
                    {procesoSel ? ` · limitado a lo cortado para ${procesoSel.nombre}` : ''}
                  </h3>
                  <MatrizColorTalla
                    testid="envio-matriz"
                    tallas={tallas}
                    lineas={lineas}
                    coloresDisponibles={orden.data ? coloresDeOrden(orden.data) : []}
                    tallasDisponibles={tallas}
                    onLineasChange={setLineas}
                    onTallasChange={setTallas}
                    soloLectura={!puedeEnviar || idTipoProceso === ''}
                  />
                </div>

                {idTipoProceso === '' ? (
                  <p className="text-sm text-muted-foreground">
                    Elige un proceso para ver el cortado disponible y capturar el envío.
                  </p>
                ) : null}

                {excede > 0 ? (
                  <p
                    className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    role="alert"
                    data-testid="envio-aviso-exceso"
                  >
                    Estás enviando {excede} pieza(s) por encima del cortado disponible para este
                    proceso. Ajusta las cantidades: el servidor no lo permitirá.
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">
                    Total a enviar: <strong>{total.toLocaleString('es-MX')}</strong> pzas
                  </span>
                  <Button onClick={guardar} disabled={!puedeGuardar} data-testid="envio-guardar">
                    {crear.isPending ? 'Guardando…' : 'Guardar envío'}
                  </Button>
                </div>

                {ultimoEnvio !== null ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 p-3">
                    <span className="text-sm font-medium">
                      Último envío guardado: #{ultimoEnvio.folio}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        window.open(urlImpresoEnvio(ultimoEnvio.id), '_blank', 'noopener')
                      }
                      data-testid="envio-pdf"
                    >
                      <Printer className="mr-1.5 size-4" aria-hidden /> PDF de envío
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        window.open(urlFichaEstampado(ultimoEnvio.id), '_blank', 'noopener')
                      }
                      data-testid="envio-ficha"
                    >
                      <FileText className="mr-1.5 size-4" aria-hidden /> Ficha de estampado
                    </Button>
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
