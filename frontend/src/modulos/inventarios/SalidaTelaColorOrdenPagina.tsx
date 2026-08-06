import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useSalidaTelaColorAOrden } from '@/api/inventario-materiales';
import { useOrden } from '@/api/ordenes';
import type { Orden } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { SelectorOrden } from '@/modulos/produccion/SelectorOrden';
import { useSesion } from '@/sesion/useSesion';

import { CapturaRenglonesTelaColor, type RenglonTelaColor } from './CapturaRenglonesTelaColor';

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
 * SALIDA DE TELA A UNA ORDEN por TELA+COLOR (inventario NUEVO, etapa A2 — Daniel §Post-F9.9): el
 * consumo EMPAREJA por color, NO por partida (las salidas no obligan a escoger partida), y el
 * cuerpo y el complemento viajan JUNTOS en el mismo renglón. Como puede haber PARTIDAS con tonos
 * distintos del mismo color, la pantalla AVISA el riesgo de tono SIN bloquear (DECISIONES
 * §Post-F9.11 punto 2). Conserva el deep-link `state.idOrden` de "Descargar tela" (avance de
 * producción / centro de órdenes). El servidor valida no-negativo de AMBOS componentes bajo lock
 * (D3). La salida vieja por lote sigue como "Salida a orden por lote (legado)".
 * `inventario-telas.mover` gobierna la captura.
 */
export function SalidaTelaColorOrdenPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeMover = tienePermiso('inventario-telas.mover');

  // DEEP-LINK desde el avance de producción / centro de órdenes (Daniel, 28-jul-2026): el enlace
  // trae la orden ya puesta. Se consume el `state` en cuanto llega para que un refresh o un
  // "atrás" no lo vuelvan a aplicar (patrón de la pantalla por lote que esta sustituye).
  const location = useLocation();
  const navigate = useNavigate();
  const [idDeepLink] = useState<number | null>(() => leerIdOrdenDeepLink(location.state));
  const ordenDeepLink = useOrden(idDeepLink ?? undefined);

  const [orden, setOrden] = useState<Orden | undefined>(undefined);
  const [idAlmacen, setIdAlmacen] = useState<string>('');
  const [fecha, setFecha] = useState(hoy());
  const [observaciones, setObservaciones] = useState('');
  const [renglones, setRenglones] = useState<RenglonTelaColor[]>([]);

  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  const crear = useSalidaTelaColorAOrden();

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

  const totalCuerpo = renglones.reduce((s, r) => s + r.cantidad, 0);
  const totalComplemento = renglones.reduce((s, r) => s + r.cantidadComplemento, 0);
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
          idTelaColor: r.idTelaColor,
          cantidad: r.cantidad,
          ...(r.nombreComplemento !== null ? { cantidadComplemento: r.cantidadComplemento } : {}),
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
            Salida de tela a orden
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Descuenta tela por color (cuerpo y complemento juntos) ligándola a una orden de
            producción
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
                    <FieldLabel htmlFor="salida-color-almacen">Almacén de origen</FieldLabel>
                    <SelectNativo
                      id="salida-color-almacen"
                      value={idAlmacen}
                      onChange={(e) => setIdAlmacen(e.target.value)}
                      disabled={!puedeMover}
                      data-testid="salida-color-almacen"
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
                    <FieldLabel htmlFor="salida-color-fecha">Fecha</FieldLabel>
                    <Input
                      id="salida-color-fecha"
                      type="date"
                      value={fecha}
                      onChange={(e) => setFecha(e.target.value)}
                      disabled={!puedeMover}
                      data-testid="salida-color-fecha"
                    />
                  </Field>
                </div>

                <Field>
                  <FieldLabel htmlFor="salida-color-obs">Observaciones</FieldLabel>
                  <Input
                    id="salida-color-obs"
                    value={observaciones}
                    onChange={(e) => setObservaciones(e.target.value)}
                    placeholder="Opcional"
                    disabled={!puedeMover}
                  />
                </Field>

                <div>
                  <h3 className="mb-2 text-sm font-medium">Telas a sacar (por color)</h3>
                  <CapturaRenglonesTelaColor
                    renglones={renglones}
                    onChange={setRenglones}
                    soloLectura={!puedeMover}
                  />
                </div>

                {/* AVISO DE RIESGO DE TONO (Daniel, DECISIONES §Post-F9.11 punto 2): el consumo
                    empareja por COLOR, no por partida — dos partidas del mismo color pueden traer
                    TONOS distintos del mismo pantone. La pantalla AVISA, nunca bloquea. */}
                {renglones.length > 0 ? (
                  <div
                    className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400"
                    role="note"
                    data-testid="salida-color-aviso-tono"
                  >
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      <strong>Riesgo de tono:</strong> la salida empareja por tela y color, no por
                      partida. Si hay varias partidas de este color, verifica físicamente que el
                      tono del rollo que sacas case con el resto de la orden. Este aviso no bloquea
                      la salida.
                    </span>
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">
                    Total a sacar: <strong>{totalCuerpo.toLocaleString('es-MX')}</strong>
                    {totalComplemento > 0 ? (
                      <>
                        {' '}
                        · complemento: <strong>{totalComplemento.toLocaleString('es-MX')}</strong>
                      </>
                    ) : null}
                  </span>
                  <Button
                    onClick={guardar}
                    disabled={!puedeGuardar}
                    data-testid="salida-color-guardar"
                  >
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
