import { useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useTraspasarAvio, useTraspasarTela } from '@/api/inventario-materiales';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useSesion } from '@/sesion/useSesion';

import { CapturaRenglonesAvio, type RenglonAvio } from './CapturaRenglonesAvio';
import { CapturaRenglonesTela, type RenglonTela } from './CapturaRenglonesTela';

type Dimension = 'tela' | 'avio';

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * TRASPASO entre almacenes (F4-E1, doc 04-Inventarios §B.3 — Transferencia entre almacenes). Mueve
 * TELA (por lote) o AVÍO de un almacén ORIGEN a uno DESTINO (distintos), en UNA operación (el backend
 * la materializa como salida + entrada atómicas, A2). El servidor valida que el origen no quede
 * negativo (D3, bajo lock). Captura PC. `inventario-telas.mover`/`inventario-avios.mover` gobiernan.
 */
export function TraspasoMaterialesPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const [dimension, setDimension] = useState<Dimension>('tela');

  const puedeTela = tienePermiso('inventario-telas.mover');
  const puedeAvio = tienePermiso('inventario-avios.mover');
  const puedeMover = dimension === 'tela' ? puedeTela : puedeAvio;

  const [idAlmacenOrigen, setIdAlmacenOrigen] = useState<string>('');
  const [idAlmacenDestino, setIdAlmacenDestino] = useState<string>('');
  const [fecha, setFecha] = useState(hoy());
  const [observaciones, setObservaciones] = useState('');
  const [renglonesTela, setRenglonesTela] = useState<RenglonTela[]>([]);
  const [renglonesAvio, setRenglonesAvio] = useState<RenglonAvio[]>([]);

  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  const traspasarTela = useTraspasarTela();
  const traspasarAvio = useTraspasarAvio();

  const mismoAlmacen = idAlmacenOrigen !== '' && idAlmacenOrigen === idAlmacenDestino;
  const totalTela = renglonesTela.reduce((s, r) => s + r.cantidad, 0);
  const totalAvio = renglonesAvio.reduce((s, r) => s + r.cantidad, 0);
  const hayRenglones = dimension === 'tela' ? renglonesTela.length > 0 : renglonesAvio.length > 0;
  const cargando = traspasarTela.isPending || traspasarAvio.isPending;
  const puedeGuardar =
    puedeMover &&
    idAlmacenOrigen !== '' &&
    idAlmacenDestino !== '' &&
    !mismoAlmacen &&
    hayRenglones &&
    !cargando;

  function limpiar(): void {
    setRenglonesTela([]);
    setRenglonesAvio([]);
  }

  function guardar(): void {
    if (idAlmacenOrigen === '' || idAlmacenDestino === '') return;
    const base = {
      idAlmacenOrigen: Number(idAlmacenOrigen),
      idAlmacenDestino: Number(idAlmacenDestino),
      fecha,
      ...(observaciones.trim().length > 0 ? { observaciones: observaciones.trim() } : {}),
    };
    if (dimension === 'tela') {
      traspasarTela.mutate(
        {
          ...base,
          lineas: renglonesTela.map((r) => ({
            idTela: r.idTela,
            idLote: r.idLote,
            cantidad: r.cantidad,
          })),
        },
        {
          onSuccess: (t) => {
            toast.success(
              `Traspaso de tela guardado (salida #${t.salida.folio} → entrada #${t.entrada.folio}).`,
            );
            limpiar();
          },
          onError: (error) => toast.error(error.message),
        },
      );
    } else {
      traspasarAvio.mutate(
        {
          ...base,
          lineas: renglonesAvio.map((r) => ({ idAvio: r.idAvio, cantidad: r.cantidad })),
        },
        {
          onSuccess: (t) => {
            toast.success(
              `Traspaso de avío guardado (salida #${t.salida.folio} → entrada #${t.entrada.folio}).`,
            );
            limpiar();
          },
          onError: (error) => toast.error(error.message),
        },
      );
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Traspaso entre almacenes</h1>
          <p className="truncate text-xs text-muted-foreground">
            Mueve tela (por lote) o avío de un almacén a otro, en una sola operación
          </p>
        </div>
      </header>

      <div
        className="flex w-fit overflow-hidden rounded-md border text-xs"
        role="group"
        aria-label="Tipo de material"
      >
        <button
          type="button"
          onClick={() => setDimension('tela')}
          className={`cursor-pointer px-3 py-1 font-medium transition-colors ${
            dimension === 'tela'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted'
          }`}
          data-testid="traspaso-dim-tela"
        >
          Telas
        </button>
        <button
          type="button"
          onClick={() => setDimension('avio')}
          className={`cursor-pointer px-3 py-1 font-medium transition-colors ${
            dimension === 'avio'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted'
          }`}
          data-testid="traspaso-dim-avio"
        >
          Avíos
        </button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos del traspaso</CardTitle>
          <CardDescription>
            Elige origen y destino (distintos) y captura los renglones a mover.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="origen">Almacén origen</FieldLabel>
              <SelectNativo
                id="origen"
                value={idAlmacenOrigen}
                onChange={(e) => {
                  setIdAlmacenOrigen(e.target.value);
                  setRenglonesTela([]); // los lotes dependen del origen
                }}
                disabled={!puedeMover}
                data-testid="traspaso-origen"
              >
                <option value="">Elige el origen…</option>
                {(almacenes.data?.datos ?? []).map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="destino">Almacén destino</FieldLabel>
              <SelectNativo
                id="destino"
                value={idAlmacenDestino}
                onChange={(e) => setIdAlmacenDestino(e.target.value)}
                disabled={!puedeMover}
                data-testid="traspaso-destino"
              >
                <option value="">Elige el destino…</option>
                {(almacenes.data?.datos ?? []).map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.nombre}
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
                disabled={!puedeMover}
                data-testid="traspaso-fecha"
              />
            </Field>
          </div>

          {mismoAlmacen ? (
            <p className="text-sm text-destructive" role="alert">
              El origen y el destino deben ser almacenes distintos.
            </p>
          ) : null}

          <Field>
            <FieldLabel htmlFor="obs">Observaciones</FieldLabel>
            <Input
              id="obs"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Opcional"
              disabled={!puedeMover}
            />
          </Field>

          <div>
            <h3 className="mb-2 text-sm font-medium">Renglones a traspasar</h3>
            {dimension === 'tela' ? (
              <CapturaRenglonesTela
                idAlmacen={idAlmacenOrigen === '' ? undefined : Number(idAlmacenOrigen)}
                renglones={renglonesTela}
                onChange={setRenglonesTela}
                soloLectura={!puedeMover}
              />
            ) : (
              <CapturaRenglonesAvio
                renglones={renglonesAvio}
                onChange={setRenglonesAvio}
                soloLectura={!puedeMover}
              />
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              Total a traspasar:{' '}
              <strong>
                {(dimension === 'tela' ? totalTela : totalAvio).toLocaleString('es-MX')}
              </strong>
            </span>
            <Button onClick={guardar} disabled={!puedeGuardar} data-testid="traspaso-guardar">
              {cargando ? 'Guardando…' : 'Guardar traspaso'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
