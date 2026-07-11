import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useCrearCorte, usePendientesOrden } from '@/api/etapas';
import { useOrden } from '@/api/ordenes';
import { useProveedores, useRolesProveedor } from '@/api/proveedores';
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
  mapaPorCortar,
  tallasDeOrden,
  totalMatriz,
} from './matriz-orden';
import { HistorialEtapasOrden } from './HistorialEtapasOrden';

/** Fecha de hoy en YYYY-MM-DD (zona local), para el default del campo fecha. */
function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * CAPTURA DE CORTE (F3-E2, doc 03-Produccion Paso 3). Elige una orden, el cortador (Proveedor con
 * rol "corte"), la fecha y observaciones; captura la matriz color×talla (reusa el componente) y
 * muestra "por cortar" por color×talla en vivo (orden − corte). Sobre-corte LIBRE (decisión (f)):
 * la pantalla AVISA cuánto excede lo pedido pero NO bloquea (el servidor acepta).
 *
 * `produccion.corte` gobierna la captura; sin él, los controles de escritura no aparecen.
 */
export function CapturaCortePagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeCortar = tienePermiso('produccion.corte');

  const [idOrden, setIdOrden] = useState<number | undefined>(undefined);
  const [idCortador, setIdCortador] = useState<string>('');
  const [fecha, setFecha] = useState(hoy());
  const [observaciones, setObservaciones] = useState('');
  const [lineas, setLineas] = useState<MatrizLinea[]>([]);
  const [tallas, setTallas] = useState<MatrizTalla[]>([]);

  const orden = useOrden(idOrden);
  const pendientes = usePendientesOrden(idOrden, idOrden !== undefined);
  const crear = useCrearCorte();

  // Cortadores: proveedores con el rol "corte". La consulta queda DESHABILITADA hasta resolver el
  // rol (idRolCorte definido): así nunca lista TODOS los proveedores sin filtro.
  const roles = useRolesProveedor();
  const idRolCorte = roles.data?.find((r) => r.codigo === 'corte')?.id;
  const cortadores = useProveedores(
    {
      pagina: 1,
      porPagina: 100,
      ordenarPor: 'nombre',
      direccion: 'asc',
      ...(idRolCorte === undefined ? {} : { rol: idRolCorte }),
    },
    { enabled: idRolCorte !== undefined },
  );

  // Aviso reintentable si falla algún catálogo de la captura (roles o cortadores).
  const catalogoError = roles.isError || cortadores.isError;
  function reintentarCatalogos(): void {
    void roles.refetch();
    void cortadores.refetch();
  }

  function alElegirOrden(o: Orden): void {
    setIdOrden(o.id);
    setTallas(tallasDeOrden(o));
    setLineas(lineasVaciasDeOrden(o));
  }

  const porCortar = mapaPorCortar(pendientes.data);

  // Aviso de sobre-corte: por cada celda capturada, cuánto excede lo pendiente por cortar.
  const avisoSobreCorte = useMemo(() => {
    let excede = 0;
    for (const linea of lineas) {
      for (const [idTalla, cantidad] of Object.entries(linea.cantidades)) {
        const pendiente = porCortar.get(`${linea.idColor}:${Number(idTalla)}`) ?? 0;
        if (cantidad > pendiente) {
          excede += cantidad - Math.max(pendiente, 0);
        }
      }
    }
    return excede;
  }, [lineas, porCortar]);

  const total = totalMatriz(lineas);
  const puedeGuardar =
    puedeCortar && idOrden !== undefined && idCortador !== '' && total > 0 && !crear.isPending;

  function guardar(): void {
    if (idOrden === undefined || idCortador === '') {
      return;
    }
    crear.mutate(
      {
        idOrden,
        idCortador: Number(idCortador),
        fecha,
        ...(observaciones.trim().length > 0 ? { observaciones: observaciones.trim() } : {}),
        lineas: aLineasApi(lineas),
      },
      {
        onSuccess: (etapa) => {
          toast.success(`Corte #${etapa.folio} guardado (${etapa.totalPiezas} pzas).`);
          // Limpia la matriz para capturar otro corte de la misma orden; refresca pendientes.
          if (orden.data) {
            setLineas(lineasVaciasDeOrden(orden.data));
          }
          void pendientes.refetch();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="h-full overflow-y-auto space-y-6 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Captura de corte
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Registra el corte de una orden por color × talla. El sobre-corte se permite (solo
            avisa).
          </p>
        </div>
      </header>

      {catalogoError ? (
        <div
          className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2"
          role="alert"
          data-testid="corte-error-catalogo"
        >
          <p className="text-sm text-destructive">
            No se pudieron cargar los catálogos de la captura (cortadores).
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
            <CardDescription>Elige la orden a cortar.</CardDescription>
          </CardHeader>
          <CardContent>
            <SelectorOrden idSeleccionada={idOrden} alSeleccionar={alElegirOrden} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{orden.data ? `Orden #${orden.data.folio}` : 'Datos del corte'}</CardTitle>
            <CardDescription>
              {orden.data
                ? `${orden.data.codigoModelo} · ${orden.data.cliente}`
                : 'Selecciona una orden para capturar su corte.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {idOrden === undefined ? (
              <p className="text-sm text-muted-foreground">Sin orden seleccionada.</p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="cortador">Cortador</FieldLabel>
                    <SelectNativo
                      id="cortador"
                      value={idCortador}
                      onChange={(e) => setIdCortador(e.target.value)}
                      disabled={!puedeCortar}
                      data-testid="corte-cortador"
                    >
                      <option value="">Elige un cortador…</option>
                      {(cortadores.data?.datos ?? []).map((c) => (
                        <option key={c.id} value={String(c.id)}>
                          {c.nombre}
                        </option>
                      ))}
                    </SelectNativo>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="fecha">Fecha</FieldLabel>
                    <Input
                      id="fecha"
                      type="date"
                      value={fecha}
                      onChange={(e) => setFecha(e.target.value)}
                      disabled={!puedeCortar}
                      data-testid="corte-fecha"
                    />
                  </Field>
                </div>

                <Field>
                  <FieldLabel htmlFor="obs">Observaciones</FieldLabel>
                  <Input
                    id="obs"
                    value={observaciones}
                    onChange={(e) => setObservaciones(e.target.value)}
                    placeholder="Opcional"
                    disabled={!puedeCortar}
                  />
                </Field>

                <div>
                  <h3 className="mb-2 text-sm font-medium">Cantidades cortadas (color × talla)</h3>
                  <MatrizColorTalla
                    testid="corte-matriz"
                    tallas={tallas}
                    lineas={lineas}
                    coloresDisponibles={orden.data ? coloresDeOrden(orden.data) : []}
                    tallasDisponibles={tallas}
                    onLineasChange={setLineas}
                    onTallasChange={setTallas}
                    soloLectura={!puedeCortar}
                  />
                </div>

                {avisoSobreCorte > 0 ? (
                  <p
                    className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                    role="status"
                    data-testid="corte-aviso-sobrecorte"
                  >
                    Estás cortando {avisoSobreCorte} pieza(s) por encima de lo pendiente de la
                    orden. Se permite (solo es un aviso).
                  </p>
                ) : null}

                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">
                    Total a cortar: <strong>{total.toLocaleString('es-MX')}</strong> pzas
                  </span>
                  <Button onClick={guardar} disabled={!puedeGuardar} data-testid="corte-guardar">
                    {crear.isPending ? 'Guardando…' : 'Guardar corte'}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {idOrden !== undefined ? <HistorialEtapasOrden idOrden={idOrden} /> : null}
    </div>
  );
}
