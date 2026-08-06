import { useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useTraspasarTelaColor } from '@/api/inventario-materiales';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useSesion } from '@/sesion/useSesion';

import { CapturaRenglonesTelaColor, type RenglonTelaColor } from './CapturaRenglonesTelaColor';

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * TRASPASO de telas por COLOR entre almacenes (inventario NUEVO, etapa A2): dos patas ATÓMICAS
 * (salida del origen + entrada al destino) con AMBAS cantidades (cuerpo y complemento) juntas en
 * cada renglón. El backend valida que el ORIGEN aguante los dos componentes (bajo lock, D3).
 * Permiso `inventario-telas.mover`. El traspaso del flujo viejo por lote sigue en "Traspaso de
 * materiales".
 */
export function TraspasoTelaColorPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeMover = tienePermiso('inventario-telas.mover');

  const [idAlmacenOrigen, setIdAlmacenOrigen] = useState<string>('');
  const [idAlmacenDestino, setIdAlmacenDestino] = useState<string>('');
  const [fecha, setFecha] = useState(hoy());
  const [observaciones, setObservaciones] = useState('');
  const [renglones, setRenglones] = useState<RenglonTelaColor[]>([]);

  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  const traspasar = useTraspasarTelaColor();

  const almacenesDistintos =
    idAlmacenOrigen !== '' && idAlmacenDestino !== '' && idAlmacenOrigen !== idAlmacenDestino;
  const puedeGuardar =
    puedeMover && almacenesDistintos && renglones.length > 0 && !traspasar.isPending;

  function guardar(): void {
    if (!almacenesDistintos) return;
    traspasar.mutate(
      {
        idAlmacenOrigen: Number(idAlmacenOrigen),
        idAlmacenDestino: Number(idAlmacenDestino),
        fecha,
        ...(observaciones.trim().length > 0 ? { observaciones: observaciones.trim() } : {}),
        lineas: renglones.map((r) => ({
          idTelaColor: r.idTelaColor,
          cantidad: r.cantidad,
          ...(r.nombreComplemento !== null ? { cantidadComplemento: r.cantidadComplemento } : {}),
        })),
      },
      {
        onSuccess: (t) => {
          toast.success(
            `Traspaso registrado (salida #${t.salida.folio} → entrada #${t.entrada.folio}).`,
          );
          setRenglones([]);
          setObservaciones('');
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
            Traspaso de telas por color
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Dos movimientos atómicos (salida del origen + entrada al destino) · cuerpo y complemento
            viajan juntos
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Datos del traspaso</CardTitle>
          <CardDescription>
            El origen debe tener existencia suficiente de AMBOS componentes (el servidor valida).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="traspaso-color-origen">Almacén de origen</FieldLabel>
              <SelectNativo
                id="traspaso-color-origen"
                value={idAlmacenOrigen}
                onChange={(e) => setIdAlmacenOrigen(e.target.value)}
                disabled={!puedeMover}
                data-testid="traspaso-color-origen"
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
              <FieldLabel htmlFor="traspaso-color-destino">Almacén de destino</FieldLabel>
              <SelectNativo
                id="traspaso-color-destino"
                value={idAlmacenDestino}
                onChange={(e) => setIdAlmacenDestino(e.target.value)}
                disabled={!puedeMover}
                data-testid="traspaso-color-destino"
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
              <FieldLabel htmlFor="traspaso-color-fecha">Fecha</FieldLabel>
              <Input
                id="traspaso-color-fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                disabled={!puedeMover}
                data-testid="traspaso-color-fecha"
              />
            </Field>
          </div>
          {idAlmacenOrigen !== '' && idAlmacenOrigen === idAlmacenDestino ? (
            <p className="text-xs text-destructive" data-testid="traspaso-color-iguales">
              El origen y el destino deben ser almacenes distintos.
            </p>
          ) : null}

          <Field>
            <FieldLabel htmlFor="traspaso-color-obs">Observaciones (opcional)</FieldLabel>
            <Input
              id="traspaso-color-obs"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              disabled={!puedeMover}
              data-testid="traspaso-color-obs"
            />
          </Field>

          <CapturaRenglonesTelaColor
            renglones={renglones}
            onChange={setRenglones}
            soloLectura={!puedeMover}
          />

          <div className="flex items-center justify-end gap-3">
            <Button onClick={guardar} disabled={!puedeGuardar} data-testid="traspaso-color-guardar">
              {traspasar.isPending ? 'Guardando…' : 'Registrar traspaso'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
