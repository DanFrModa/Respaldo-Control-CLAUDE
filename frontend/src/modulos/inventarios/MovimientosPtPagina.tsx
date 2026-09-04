import { ArrowLeftRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useColores } from '@/api/colores';
import { useCrearMovimientoPt, useExistenciasPt, useTiposMovimiento } from '@/api/inventarios';
import { useTallas } from '@/api/tallas';
import type { Modelo } from '@/api/modelos';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
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
import { SelectorOrdenPt } from './SelectorOrdenPt';
import {
  SIN_ORDEN,
  aIdOrden,
  aLineasApi,
  coloresOpciones,
  ordenesConExistencia,
  tallasColumnas,
  totalMatriz,
} from './matriz-inventario';

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
 * §Post-F9.40 — el movimiento dice de qué ORDEN salen (o a cuál entran) las piezas: la existencia de
 * PT es por modelo×color×talla×ORDEN×almacén. Antes el movimiento manual solo podía tocar «sin
 * orden», así que lo que producía la fábrica —etiquetado con su orden por el recibo de maquila— no
 * salía por aquí. Lo que ofrece el selector depende de la DIRECCIÓN del tipo elegido:
 *  • SALIDA: las órdenes con existencia REAL de ese modelo en ese almacén (de un bucket vacío no se
 *    puede sacar; es el mismo saldo que valida el servidor).
 *  • ENTRADA: las órdenes del modelo con movimientos de PT en la empresa, INCLUIDAS las que quedaron
 *    en cero. Es el va-y-ven de estampado que esta pantalla existe para operar: las piezas salen a
 *    Aplicación (el bucket de la orden queda en 0) y al volver tienen que poder REGRESAR a su orden;
 *    si el cero las excluyera, entrarían a «sin orden» y la entrega al cliente de esa orden diría
 *    "no hay existencia" con la mercancía físicamente en el almacén.
 * En ambos casos el bucket «sin orden» (default) siempre está.
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
  // §Post-F9.25 — nº de la orden del sistema VIEJO que fabricó estas prendas. Es lo que permite ir a
  // consultar la orden en Control viejo: esas órdenes no se migraron (la migración lleva 2025-2026).
  const [numOrdenV1, setNumOrdenV1] = useState('');
  // §Post-F9.40 — de qué ORDEN de v2 salen (o a cuál entran) las piezas. `SIN_ORDEN` = el bucket
  // «sin orden», que es el default y donde cae lo capturado a mano y lo migrado.
  const [ordenBucket, setOrdenBucket] = useState<string>(SIN_ORDEN);
  const [lineas, setLineas] = useState<MatrizLinea[]>([]);
  const [tallas, setTallas] = useState<MatrizTalla[]>([]);

  // Solo entrada/salida (los `traspaso` van por la otra pantalla).
  const tiposMov = useTiposMovimiento();
  const tiposCaptura = (tiposMov.data?.datos ?? []).filter((t) => t.direccion !== 'traspaso');

  // Solo almacenes de PT: el dominio rechaza un movimiento de producto terminado contra una bodega de telas o de avíos (fila 0.137), así que el desplegable ni los ofrece.
  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    tipo: 'PT',
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

  // §Post-F9.40 — de qué buckets se puede elegir depende de la DIRECCIÓN del tipo de movimiento.
  const tipoElegido = tiposCaptura.find((t) => String(t.id) === idTipoMov);
  const esEntrada = tipoElegido?.direccion === 'entrada';
  const hayModelo = modelo !== undefined;
  const hayArticulo = hayModelo && idAlmacen !== '';

  // SALIDA: buckets con existencia REAL del modelo en el almacén elegido (el saldo que el servidor
  // va a validar). Apagada hasta tener modelo y almacén: sin ellos no hay qué preguntar.
  const existenciasSalida = useExistenciasPt(
    {
      idModelo: modelo?.id ?? 0,
      ...(idAlmacen === '' ? {} : { idAlmacen: Number(idAlmacen) }),
    },
    hayArticulo && !esEntrada,
  );
  // ENTRADA: órdenes del modelo con movimientos de PT en la empresa, incluidas las que quedaron en
  // CERO (`incluirCeros`) y sin filtrar por almacén — las piezas pueden volver del estampado a un
  // almacén distinto del que salieron y no por eso pierden su orden. Query aparte (clave propia)
  // para que ningún dato de un modo se pinte en el otro mientras se recarga.
  const existenciasEntrada = useExistenciasPt(
    { idModelo: modelo?.id ?? 0, incluirCeros: 'true' },
    hayModelo && esEntrada,
  );
  const existencias = esEntrada ? existenciasEntrada : existenciasSalida;
  /** ¿Ya hay con qué preguntar por los buckets? (la entrada no necesita el almacén). */
  const hayConsultaOrden = esEntrada ? hayModelo : hayArticulo;
  const opcionesOrden = useMemo(
    () => ordenesConExistencia(existencias.data?.filas ?? [], { incluirCeros: esEntrada }),
    [existencias.data, esEntrada],
  );
  // Si cambia el artículo/almacén, el bucket elegido puede ya no existir → vuelve a «sin orden»
  // (nunca se manda una orden que esta pantalla no ofreció).
  const bucketValido =
    ordenBucket === SIN_ORDEN || opcionesOrden.some((o) => String(o.idOrden) === ordenBucket);
  const ordenElegida = bucketValido ? ordenBucket : SIN_ORDEN;

  const coloresDisponibles = useMemo(
    () => coloresOpciones(colores.data?.datos ?? []),
    [colores.data],
  );
  const tallasDisponibles = useMemo(
    () => tallasColumnas(tallasCat.data?.datos ?? []),
    [tallasCat.data],
  );

  // Aviso reintentable si falla algún catálogo de la captura.
  const catalogoError =
    tiposMov.isError || almacenes.isError || colores.isError || tallasCat.isError;
  function reintentarCatalogos(): void {
    void tiposMov.refetch();
    void almacenes.refetch();
    void colores.refetch();
    void tallasCat.refetch();
  }

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
        lineas: aLineasApi(lineas, numOrdenV1, aIdOrden(ordenElegida)),
      },
      {
        onSuccess: (mov) => {
          toast.success(`Movimiento #${mov.folio} guardado (${mov.totalPiezas} pzas).`);
          limpiarMatriz();
          setNumOrdenV1('');
          void existencias.refetch();
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
            Movimientos de inventario
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Entradas, salidas y ajustes de producto terminado por color × talla
          </p>
        </div>
      </header>

      {catalogoError ? (
        <div
          className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2"
          role="alert"
          data-testid="mov-error-catalogo"
        >
          <p className="text-sm text-destructive">
            No se pudieron cargar los catálogos de la captura (tipos, almacenes, colores o tallas).
          </p>
          <Button size="sm" variant="outline" onClick={reintentarCatalogos}>
            Reintentar
          </Button>
        </div>
      ) : null}

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
          {/* Identidad VISIBLE del modelo elegido: código + descripción (el value del input no
              es un nodo de texto). */}
          {modelo !== undefined ? (
            <span className="truncate text-xs text-muted-foreground" data-testid="mov-modelo-sel">
              <span className="num font-medium text-foreground">{modelo.codigo}</span>
              {modelo.descripcion !== null ? <> — {modelo.descripcion}</> : null}
            </span>
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

              {/* §Post-F9.40 — de qué ORDEN salen (o a cuál entran) las piezas. En la SALIDA solo
                  las órdenes con piezas de ESTE modelo en ESTE almacén; en la ENTRADA también las
                  que quedaron en cero (el regreso del estampado). Siempre, «sin orden». */}
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectorOrdenPt
                  id="mov-orden"
                  opciones={opcionesOrden}
                  valor={ordenElegida}
                  modo={esEntrada ? 'entrada' : 'salida'}
                  alCambiar={setOrdenBucket}
                  deshabilitado={!puedeMover || !hayConsultaOrden}
                  cargando={hayConsultaOrden && existencias.isPending}
                  hayError={existencias.isError}
                  alReintentar={() => void existencias.refetch()}
                  ayuda={
                    hayConsultaOrden
                      ? undefined
                      : 'Elige el almacén para ver de qué órdenes hay piezas aquí.'
                  }
                  testid="mov-orden"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-[1fr_16rem]">
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
                <Field>
                  <FieldLabel htmlFor="mov-orden-v1">Orden de Control viejo</FieldLabel>
                  <Input
                    id="mov-orden-v1"
                    value={numOrdenV1}
                    onChange={(e) => setNumOrdenV1(e.target.value)}
                    placeholder="Ej. 12345"
                    disabled={!puedeMover}
                    data-testid="mov-orden-v1"
                  />
                  <FieldDescription>
                    De qué orden salieron estas prendas, para poder consultarla en Control viejo.
                  </FieldDescription>
                </Field>
              </div>

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
