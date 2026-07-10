import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useColores } from '@/api/colores';
import { useCrearTraspasoPt, useExistenciasPt } from '@/api/inventarios';
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

/** Fecha de hoy en YYYY-MM-DD (zona local). */
function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * TRASPASO entre almacenes (F3-E3, doc 04-Inventarios — Transferencia entre almacenes). Mueve un
 * modelo de un almacén ORIGEN a uno DESTINO (distintos) por color×talla, en UNA operación (el backend
 * la materializa como salida + entrada atómicas). Muestra la existencia DISPONIBLE en el origen para
 * cada artículo capturado; el servidor es la autoridad (no deja el origen en negativo).
 *
 * `inventario-pt.mover` gobierna la captura.
 */
export function TraspasosPtPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeMover = tienePermiso('inventario-pt.mover');

  const [idAlmacenOrigen, setIdAlmacenOrigen] = useState<string>('');
  const [idAlmacenDestino, setIdAlmacenDestino] = useState<string>('');
  const [modelo, setModelo] = useState<Modelo | undefined>(undefined);
  const [fecha, setFecha] = useState(hoy());
  const [observaciones, setObservaciones] = useState('');
  const [lineas, setLineas] = useState<MatrizLinea[]>([]);
  const [tallas, setTallas] = useState<MatrizTalla[]>([]);

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
  const crear = useCrearTraspasoPt();

  // Existencias disponibles en el ORIGEN para el modelo elegido (para guiar al usuario). La query
  // queda DESHABILITADA hasta que haya modelo y origen válidos: así no se dispara un GET con un
  // idModelo inválido (que el backend rechazaría con 400) al abrir la pantalla.
  const hayOrigen = modelo !== undefined && idAlmacenOrigen !== '';
  const existencias = useExistenciasPt(
    hayOrigen
      ? { idModelo: modelo.id, idAlmacen: Number(idAlmacenOrigen) }
      : { idModelo: modelo?.id ?? 0 },
    hayOrigen,
  );
  const disponiblePorArticulo = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const f of existencias.data?.filas ?? []) {
      mapa.set(`${f.idColor}:${f.idTalla}`, f.existencia);
    }
    return mapa;
  }, [existencias.data]);

  const coloresDisponibles = useMemo(
    () => coloresOpciones(colores.data?.datos ?? []),
    [colores.data],
  );
  const tallasDisponibles = useMemo(
    () => tallasColumnas(tallasCat.data?.datos ?? []),
    [tallasCat.data],
  );

  // Aviso de sobre-traspaso (UI): cuántas piezas capturadas exceden lo disponible en el origen.
  const avisoExcede = useMemo(() => {
    let excede = 0;
    for (const linea of lineas) {
      for (const [idTalla, cantidad] of Object.entries(linea.cantidades)) {
        const disponible = disponiblePorArticulo.get(`${linea.idColor}:${Number(idTalla)}`) ?? 0;
        if (cantidad > disponible) {
          excede += cantidad - Math.max(disponible, 0);
        }
      }
    }
    return excede;
  }, [lineas, disponiblePorArticulo]);

  const total = totalMatriz(lineas);
  const mismoAlmacen = idAlmacenOrigen !== '' && idAlmacenOrigen === idAlmacenDestino;
  const puedeGuardar =
    puedeMover &&
    idAlmacenOrigen !== '' &&
    idAlmacenDestino !== '' &&
    !mismoAlmacen &&
    modelo !== undefined &&
    total > 0 &&
    !crear.isPending;

  function guardar(): void {
    if (idAlmacenOrigen === '' || idAlmacenDestino === '' || modelo === undefined) {
      return;
    }
    crear.mutate(
      {
        idAlmacenOrigen: Number(idAlmacenOrigen),
        idAlmacenDestino: Number(idAlmacenDestino),
        idModelo: modelo.id,
        fecha,
        ...(observaciones.trim().length > 0 ? { observaciones: observaciones.trim() } : {}),
        lineas: aLineasApi(lineas),
      },
      {
        onSuccess: (traspaso) => {
          toast.success(
            `Traspaso guardado (salida #${traspaso.salida.folio} → entrada #${traspaso.entrada.folio}).`,
          );
          setLineas([]);
          setTallas([]);
          void existencias.refetch();
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
            Traspaso entre almacenes
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Mueve un modelo de un almacén a otro por color × talla, en una sola operación
          </p>
        </div>
      </header>

      {/* ── Card única: riel del módulo + captura (estándar del grupo, proto `vInventarios`) ── */}
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <PestanasInventarioPt activa="traspasos" />
          <div className="w-64 [&_input]:h-8 [&_input]:text-sm">
            <SelectorModelo
              idSeleccionado={modelo?.id}
              alSeleccionar={setModelo}
              alLimpiar={() => setModelo(undefined)}
            />
          </div>
          {/* Identidad VISIBLE del modelo elegido: código + descripción (el value del input no
              es un nodo de texto). */}
          {modelo !== undefined ? (
            <span
              className="truncate text-xs text-muted-foreground"
              data-testid="traspaso-modelo-sel"
            >
              <span className="num font-medium text-foreground">{modelo.codigo}</span>
              {modelo.descripcion !== null ? <> — {modelo.descripcion}</> : null}
            </span>
          ) : null}
        </div>

        <div className="space-y-4 p-4">
          {modelo === undefined ? (
            <p className="text-sm text-muted-foreground">
              Selecciona un modelo para capturar su traspaso.
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="origen">Almacén origen</FieldLabel>
                  <SelectNativo
                    id="origen"
                    value={idAlmacenOrigen}
                    onChange={(e) => setIdAlmacenOrigen(e.target.value)}
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
                <h3 className="mb-2 text-sm font-medium">Cantidades a traspasar (color × talla)</h3>
                <MatrizColorTalla
                  testid="traspaso-matriz"
                  tallas={tallas}
                  lineas={lineas}
                  coloresDisponibles={coloresDisponibles}
                  tallasDisponibles={tallasDisponibles}
                  onLineasChange={setLineas}
                  onTallasChange={setTallas}
                  soloLectura={!puedeMover}
                />
                {idAlmacenOrigen !== '' ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Existencia total disponible en el origen:{' '}
                    <strong>
                      {(existencias.data?.totalExistencia ?? 0).toLocaleString('es-MX')}
                    </strong>{' '}
                    pzas.
                  </p>
                ) : null}
              </div>

              {avisoExcede > 0 ? (
                <p
                  className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                  role="status"
                  data-testid="traspaso-aviso-excede"
                >
                  Estás traspasando {avisoExcede} pieza(s) por encima de lo disponible en el origen.
                  El servidor lo rechazará.
                </p>
              ) : null}
            </>
          )}
        </div>

        {/* ── Barra al pie (estándar de totales del grupo): total capturado + guardar ── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-secondary px-3 py-1.5">
          <span className="flex items-baseline gap-1.5 text-xs">
            <span className="text-[10.5px] font-medium text-faint uppercase">
              Total a traspasar:
            </span>
            <b className="num text-primary">{total.toLocaleString('es-MX')} pzas</b>
          </span>
          <Button
            size="sm"
            onClick={guardar}
            disabled={!puedeGuardar}
            data-testid="traspaso-guardar"
          >
            {crear.isPending ? 'Guardando…' : 'Guardar traspaso'}
          </Button>
        </div>
      </div>
    </div>
  );
}
