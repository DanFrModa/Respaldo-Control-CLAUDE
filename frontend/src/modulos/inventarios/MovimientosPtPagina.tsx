import { ArrowLeftRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useColores } from '@/api/colores';
import { useCrearMovimientoPt, useTiposMovimiento } from '@/api/inventarios';
import { useTallas } from '@/api/tallas';
import type { Modelo } from '@/api/modelos';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import {
  MatrizColorTalla,
  type MatrizLinea,
  type MatrizTalla,
} from '@/componentes/matriz-color-talla/MatrizColorTalla';
import { useSesion } from '@/sesion/useSesion';

import { PestanasInventarioPt } from './PestanasInventarioPt';
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
  const colores = useColores({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: 'false',
  });
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
    <div className="flex flex-col gap-3 p-4 md:p-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Movimientos de inventario
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Entradas, salidas y ajustes de producto terminado por color × talla
          </p>
        </div>
      </header>

      {/* ── Card única: riel del módulo + captura (estándar del grupo, proto `vInventarios`) ── */}
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <PestanasInventarioPt activa="movimientos" />
          <div className="w-64 [&_input]:h-8 [&_input]:text-sm">
            <SelectorModelo
              idSeleccionado={modelo?.id}
              alSeleccionar={setModelo}
              alLimpiar={() => setModelo(undefined)}
            />
          </div>
          {modelo?.descripcion != null ? (
            <span className="truncate text-xs text-muted-foreground">{modelo.descripcion}</span>
          ) : null}
        </div>

        <div className="space-y-4 p-4">
          {modelo === undefined ? (
            <p className="text-sm text-muted-foreground">
              Selecciona un modelo para capturar su movimiento.
            </p>
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
            </>
          )}
        </div>

        {/* ── Barra al pie (estándar de totales del grupo): total capturado + guardar ── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-secondary px-3 py-1.5">
          <span className="flex items-baseline gap-1.5 text-xs">
            <span className="text-[10.5px] font-medium text-faint uppercase">Total:</span>
            <b className="num text-primary">{total.toLocaleString('es-MX')} pzas</b>
          </span>
          <Button size="sm" onClick={guardar} disabled={!puedeGuardar} data-testid="mov-guardar">
            {crear.isPending ? 'Guardando…' : 'Guardar movimiento'}
          </Button>
        </div>
      </div>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <ArrowLeftRight className="size-3.5" aria-hidden />
        Para mover mercancía entre almacenes usa la pantalla de Traspasos.
      </p>
    </div>
  );
}
