import { useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useSalidaTelaAOrden } from '@/api/inventario-materiales';
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

/**
 * SALIDA DE TELA A UNA ORDEN (F4-E1, doc 04-Inventarios §"Cómo conecta"). Es LA única vía que
 * descuenta tela hacia una orden de producción (conserva la traza orden↔salida); la nota de salida
 * de E5 la referenciará SIN generar otro movimiento. Captura PC: orden + almacén + renglones
 * tela×lote. El servidor valida que no deje existencia negativa (D3, bajo lock). `inventario-telas.mover`
 * gobierna la captura.
 */
export function SalidaTelaOrdenPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeMover = tienePermiso('inventario-telas.mover');

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
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Salida de tela a orden</h1>
          <p className="truncate text-xs text-muted-foreground">
            Descuenta tela del inventario ligándola a una orden de producción (única vía que
            descuenta tela)
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
