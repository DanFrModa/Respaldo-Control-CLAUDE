import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useSalidaTelaAOrden } from '@/api/inventario-materiales';
import { useOrden } from '@/api/ordenes';
import type { Orden } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { SelectorOrden } from '@/modulos/produccion/SelectorOrden';
import { useSesion } from '@/sesion/useSesion';

import { CapturaRenglonesTela, type RenglonTela } from './CapturaRenglonesTela';

/** Fecha de hoy en YYYY-MM-DD (zona local). */
function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Lee `state.idOrden` del deep-link (enlace "Descargar tela" del avance de producción). */
function leerIdOrdenDeepLink(state: unknown): number | null {
  if (typeof state !== 'object' || state === null || !('idOrden' in state)) {
    return null;
  }
  const id = state.idOrden;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * SALIDA DE TELA A UNA ORDEN (F4-E1, doc 04-Inventarios §"Cómo conecta"). Es LA única vía que
 * descuenta tela hacia una orden de producción (conserva la traza orden↔salida); la nota de salida
 * de E5 la referenciará SIN generar otro movimiento. Captura PC: orden + almacén + renglones
 * tela×lote. El servidor valida que no deje existencia negativa (D3, bajo lock). `inventario-telas.mover`
 * gobierna la captura.
 *
 * ⚠️ VISTA LEGADA (etapa A2): la salida OPERATIVA es ahora POR TELA+COLOR
 * (`SalidaTelaColorOrdenPagina`, en `/inventarios/telas/salida-orden` — a donde apuntan el menú y
 * los deep-links). Esta pantalla por LOTE queda viva SOLO para el flujo viejo
 * (`/inventarios/telas/salida-orden-lote`).
 */
export function SalidaTelaOrdenPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeMover = tienePermiso('inventario-telas.mover');

  // DEEP-LINK desde el avance de producción (petición de Daniel, 28-jul-2026: al cortar hay que
  // descargar la tela, y el enlace debe traer la orden ya puesta). Se consume el `state` en cuanto
  // llega para que un refresh o un "atrás" no lo vuelvan a aplicar (patrón de NotasPorOrdenPagina).
  const location = useLocation();
  const navigate = useNavigate();
  const [idDeepLink] = useState<number | null>(() => leerIdOrdenDeepLink(location.state));
  const ordenDeepLink = useOrden(idDeepLink ?? undefined);

  const [orden, setOrden] = useState<Orden | undefined>(undefined);
  const [idAlmacen, setIdAlmacen] = useState<string>('');
  const [fecha, setFecha] = useState(hoy());
  const [observaciones, setObservaciones] = useState('');
  const [renglones, setRenglones] = useState<RenglonTela[]>([]);

  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  const crear = useSalidaTelaAOrden();

  // La orden del deep-link se fija SOLO una vez y solo si el usuario no eligió otra a mano.
  const ordenDeepLinkData = ordenDeepLink.data;
  useEffect(() => {
    if (idDeepLink === null) {
      return;
    }
    if (ordenDeepLinkData !== undefined) {
      setOrden((actual) => actual ?? ordenDeepLinkData);
    }
    // Se limpia el state aunque la orden falle (404/sin permiso): el deep-link ya se atendió.
    if (ordenDeepLinkData !== undefined || ordenDeepLink.isError) {
      void navigate(location.pathname, { replace: true, state: null });
    }
  }, [idDeepLink, ordenDeepLinkData, ordenDeepLink.isError, location.pathname, navigate]);

  const total = renglones.reduce((s, r) => s + r.cantidad, 0);
  const puedeGuardar =
    puedeMover &&
    orden !== undefined &&
    idAlmacen !== '' &&
    renglones.length > 0 &&
    !crear.isPending;

  function guardar(): void {
    if (orden === undefined || idAlmacen === '') return;
    crear.mutate(
      {
        idOrden: orden.id,
        idAlmacen: Number(idAlmacen),
        fecha,
        ...(observaciones.trim().length > 0 ? { observaciones: observaciones.trim() } : {}),
        lineas: renglones.map((r) => ({
          idTela: r.idTela,
          idLote: r.idLote,
          cantidad: r.cantidad,
        })),
      },
      {
        onSuccess: (mov) => {
          toast.success(
            `Salida registrada (folio #${mov.folio}, ligada a la orden #${orden.folio}).`,
          );
          setRenglones([]);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4 md:p-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Salida a orden por lote (legado)
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Vista LEGADA del flujo viejo por lote · la salida operativa es por tela y color en
            «Salida de tela a orden»
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Orden</CardTitle>
            <CardDescription>Elige la orden que consume la tela.</CardDescription>
          </CardHeader>
          <CardContent>
            <SelectorOrden idSeleccionada={orden?.id} alSeleccionar={setOrden} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {orden ? `Salida para la orden #${orden.folio}` : 'Datos de la salida'}
            </CardTitle>
            <CardDescription>
              {orden
                ? `${orden.codigoModelo} · ${orden.cliente}`
                : 'Selecciona una orden para capturar su salida de tela.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {orden === undefined ? (
              <p className="text-sm text-muted-foreground">Sin orden seleccionada.</p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="salida-almacen">Almacén de origen</FieldLabel>
                    <SelectNativo
                      id="salida-almacen"
                      value={idAlmacen}
                      onChange={(e) => {
                        setIdAlmacen(e.target.value);
                        setRenglones([]); // los lotes dependen del almacén
                      }}
                      disabled={!puedeMover}
                      data-testid="salida-almacen"
                    >
                      <option value="">Elige el almacén…</option>
                      {(almacenes.data?.datos ?? []).map((a) => (
                        <option key={a.id} value={String(a.id)}>
                          {a.nombre}
                        </option>
                      ))}
                    </SelectNativo>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="salida-fecha">Fecha</FieldLabel>
                    <Input
                      id="salida-fecha"
                      type="date"
                      value={fecha}
                      onChange={(e) => setFecha(e.target.value)}
                      disabled={!puedeMover}
                      data-testid="salida-fecha"
                    />
                  </Field>
                </div>

                <Field>
                  <FieldLabel htmlFor="salida-obs">Observaciones</FieldLabel>
                  <Input
                    id="salida-obs"
                    value={observaciones}
                    onChange={(e) => setObservaciones(e.target.value)}
                    placeholder="Opcional"
                    disabled={!puedeMover}
                  />
                </Field>

                <div>
                  <h3 className="mb-2 text-sm font-medium">Telas a sacar (por lote)</h3>
                  <CapturaRenglonesTela
                    idAlmacen={idAlmacen === '' ? undefined : Number(idAlmacen)}
                    renglones={renglones}
                    onChange={setRenglones}
                    soloLectura={!puedeMover}
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">
                    Total a sacar: <strong>{total.toLocaleString('es-MX')}</strong>
                  </span>
                  <Button onClick={guardar} disabled={!puedeGuardar} data-testid="salida-guardar">
                    {crear.isPending ? 'Guardando…' : 'Registrar salida'}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
