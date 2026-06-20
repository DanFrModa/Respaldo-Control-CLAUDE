import { ArrowLeftRight, PackagePlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useColores } from '@/api/colores';
import { useCrearMovimientoPt, useTiposMovimiento } from '@/api/inventarios';
import { useTallas } from '@/api/tallas';
import type { Modelo } from '@/api/modelos';
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

import { SelectorModelo } from './SelectorModelo';
import { aLineasApi, coloresOpciones, tallasColumnas, totalMatriz } from './matriz-inventario';

/** Fecha de hoy en YYYY-MM-DD (zona local), para el default del campo fecha. */
function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * MOVIMIENTOS MANUALES de inventario PT (F3-E3, doc 04-Inventarios). Captura una entrada, salida o
 * ajuste de UN modelo en UN almacén, por color×talla. El dropdown de tipo de movimiento SOLO ofrece
 * direcciones entrada/salida (los `traspaso` van por la pantalla de traspaso). Deja operable el
 * va-y-ven de estampado por inventario: los tipos "Salida a Aplicación"/"Entrada de Aplicación" salen
 * solos en el dropdown. El servidor es la autoridad: las salidas no pueden dejar existencia negativa.
 *
 * `inventario-pt.mover` gobierna la captura.
 */
export function MovimientosPtPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeMover = tienePermiso('inventario-pt.mover');

  const [idTipoMov, setIdTipoMov] = useState<string>('');
  const [idAlmacen, setIdAlmacen] = useState<string>('');
  const [modelo, setModelo] = useState<Modelo | undefined>(undefined);
  const [fecha, setFecha] = useState(hoy());
  const [observaciones, setObservaciones] = useState('');
  const [lineas, setLineas] = useState<MatrizLinea[]>([]);
  const [tallas, setTallas] = useState<MatrizTalla[]>([]);

  // Solo entrada/salida (los `traspaso` van por la otra pantalla).
  const tiposMov = useTiposMovimiento();
  const tiposCaptura = (tiposMov.data?.datos ?? []).filter((t) => t.direccion !== 'traspaso');

  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  const colores = useColores({ pagina: 1, porPagina: 200, ordenarPor: 'nombre', direccion: 'asc' });
  const tallasCat = useTallas({ pagina: 1, porPagina: 100, ordenarPor: 'orden', direccion: 'asc' });

  const crear = useCrearMovimientoPt();

  const coloresDisponibles = useMemo(
    () => coloresOpciones(colores.data?.datos ?? []),
    [colores.data],
  );
  const tallasDisponibles = useMemo(
    () => tallasColumnas(tallasCat.data?.datos ?? []),
    [tallasCat.data],
  );

  const total = totalMatriz(lineas);
  const puedeGuardar =
    puedeMover &&
    idTipoMov !== '' &&
    idAlmacen !== '' &&
    modelo !== undefined &&
    total > 0 &&
    !crear.isPending;

  function limpiarMatriz(): void {
    setLineas([]);
    setTallas([]);
  }

  function guardar(): void {
    if (idTipoMov === '' || idAlmacen === '' || modelo === undefined) {
      return;
    }
    crear.mutate(
      {
        idTipoMov: Number(idTipoMov),
        idAlmacen: Number(idAlmacen),
        idModelo: modelo.id,
        fecha,
        ...(observaciones.trim().length > 0 ? { observaciones: observaciones.trim() } : {}),
        lineas: aLineasApi(lineas),
      },
      {
        onSuccess: (mov) => {
          toast.success(`Movimiento #${mov.folio} guardado (${mov.totalPiezas} pzas).`);
          limpiarMatriz();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
          <PackagePlus className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Movimientos de inventario</h1>
          <p className="text-sm text-muted-foreground">
            Entradas, salidas y ajustes de producto terminado por color × talla.
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Modelo</CardTitle>
            <CardDescription>Elige el modelo a mover.</CardDescription>
          </CardHeader>
          <CardContent>
            <SelectorModelo idSeleccionado={modelo?.id} alSeleccionar={setModelo} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{modelo ? `Modelo ${modelo.codigo}` : 'Datos del movimiento'}</CardTitle>
            <CardDescription>
              {modelo
                ? (modelo.descripcion ?? 'Captura el movimiento de este modelo.')
                : 'Selecciona un modelo para capturar su movimiento.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {modelo === undefined ? (
              <p className="text-sm text-muted-foreground">Sin modelo seleccionado.</p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field>
                    <FieldLabel htmlFor="tipo-mov">Tipo de movimiento</FieldLabel>
                    <SelectNativo
                      id="tipo-mov"
                      value={idTipoMov}
                      onChange={(e) => setIdTipoMov(e.target.value)}
                      disabled={!puedeMover}
                      data-testid="mov-tipo"
                    >
                      <option value="">Elige un tipo…</option>
                      {tiposCaptura.map((t) => (
                        <option key={t.id} value={String(t.id)}>
                          {t.nombre} ({t.direccion === 'entrada' ? '+' : '−'})
                        </option>
                      ))}
                    </SelectNativo>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="almacen">Almacén</FieldLabel>
                    <SelectNativo
                      id="almacen"
                      value={idAlmacen}
                      onChange={(e) => setIdAlmacen(e.target.value)}
                      disabled={!puedeMover}
                      data-testid="mov-almacen"
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
                    <FieldLabel htmlFor="fecha">Fecha</FieldLabel>
                    <Input
                      id="fecha"
                      type="date"
                      value={fecha}
                      onChange={(e) => setFecha(e.target.value)}
                      disabled={!puedeMover}
                      data-testid="mov-fecha"
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
                    disabled={!puedeMover}
                  />
                </Field>

                <div>
                  <h3 className="mb-2 text-sm font-medium">Cantidades (color × talla)</h3>
                  <MatrizColorTalla
                    testid="mov-matriz"
                    tallas={tallas}
                    lineas={lineas}
                    coloresDisponibles={coloresDisponibles}
                    tallasDisponibles={tallasDisponibles}
                    onLineasChange={setLineas}
                    onTallasChange={setTallas}
                    soloLectura={!puedeMover}
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">
                    Total: <strong>{total.toLocaleString('es-MX')}</strong> pzas
                  </span>
                  <Button onClick={guardar} disabled={!puedeGuardar} data-testid="mov-guardar">
                    {crear.isPending ? 'Guardando…' : 'Guardar movimiento'}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <ArrowLeftRight className="size-3.5" aria-hidden />
        Para mover mercancía entre almacenes usa la pantalla de Traspasos.
      </p>
    </div>
  );
}
