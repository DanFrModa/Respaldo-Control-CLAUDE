import { Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useColores } from '@/api/colores';
import { urlImpresoTraspasoPt, useCrearTraspasoPt, useExistenciasPt } from '@/api/inventarios';
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
 * §Post-F9.40 — el traspaso mueve el bucket de UNA orden (la existencia de PT es por
 * modelo×color×talla×ORDEN×almacén): se elige entre las órdenes con existencia real en el origen,
 * más el bucket «sin orden». El destino recibe las piezas con la MISMA orden (no se pierde de qué
 * producción son). El disponible que se muestra y el aviso de sobre-traspaso son los de ESE bucket
 * —el mismo saldo que valida el servidor—, no el total del modelo.
 *
 * El selector es SIEMPRE de salida (descarta buckets en cero) y eso aquí es lo correcto en las DOS
 * patas: el destino no elige orden —hereda la del origen—, y un bucket sin piezas en el origen no
 * tiene nada que traspasar. La excepción de «entrada a un bucket en cero» (regresar del estampado)
 * vive en Movimientos, no aquí: un traspaso no crea piezas.
 *
 * Fila 0.100 (§Post-F9.193) — el MOTIVO es OBLIGATORIO y al guardar ofrece la HOJA DEL TRASPASO,
 * el papel que acompaña las prendas (antes de esta fila el inventario de PT no tenía NI UN solo
 * documento). La hoja NO es un folio nuevo: imprime el que el traspaso YA tiene, y se reimprime
 * desde el **kardex, en el modo «Por folio»** (`KardexPtPagina`), para que cerrar esta pantalla no
 * pierda el papel.
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
  // Fila 0.100 — MOTIVO obligatorio del traspaso (§Post-F9.193 decisión 3). Se guarda en las
  // observaciones de las DOS patas y sale IMPRESO en la hoja que acompaña las prendas.
  const [motivo, setMotivo] = useState('');
  const [lineas, setLineas] = useState<MatrizLinea[]>([]);
  const [tallas, setTallas] = useState<MatrizTalla[]>([]);
  // §Post-F9.40 — de qué ORDEN salen las piezas que se traspasan. `SIN_ORDEN` = bucket «sin orden».
  const [ordenBucket, setOrdenBucket] = useState<string>(SIN_ORDEN);
  // Fila 0.100 — el traspaso recién guardado, para imprimir la hoja que va con las prendas. NO es
  // la única vía: la reimpresión vive en el KARDEX, modo «Por folio» (`KardexPtPagina`), donde el
  // detalle de un traspaso vivo ofrece el mismo botón. Por eso cerrar esta pantalla no pierde el
  // papel: se busca el folio y se vuelve a sacar.
  const [recienGuardado, setRecienGuardado] = useState<{ id: number; folio: number } | null>(null);

  // Solo almacenes de PT: los DOS extremos del traspaso tienen que serlo (fila 0.137).
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
  // §Post-F9.40 — las órdenes CON EXISTENCIA REAL en el ORIGEN (más el bucket «sin orden»).
  const opcionesOrden = useMemo(
    () => ordenesConExistencia(existencias.data?.filas ?? []),
    [existencias.data],
  );
  // Si cambia el modelo/origen, el bucket elegido puede ya no existir → vuelve a «sin orden».
  const bucketValido =
    ordenBucket === SIN_ORDEN || opcionesOrden.some((o) => String(o.idOrden) === ordenBucket);
  const ordenElegida = bucketValido ? ordenBucket : SIN_ORDEN;
  const idOrdenElegida = aIdOrden(ordenElegida);

  // Disponible por artículo DENTRO del bucket elegido: el aviso de sobre-traspaso tiene que
  // compararse contra el MISMO saldo que valida el servidor (por orden), no contra el total del
  // modelo — si no, avisaría que "sí hay" piezas que están en otra orden.
  const disponiblePorArticulo = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const f of existencias.data?.filas ?? []) {
      if (f.idOrden !== idOrdenElegida) continue;
      const clave = `${f.idColor}:${f.idTalla}`;
      mapa.set(clave, (mapa.get(clave) ?? 0) + f.existencia);
    }
    return mapa;
  }, [existencias.data, idOrdenElegida]);

  /** Total disponible en el ORIGEN dentro del bucket elegido (lo que la barra de abajo anuncia). */
  const totalDisponibleBucket = useMemo(
    () => [...disponiblePorArticulo.values()].reduce((suma, v) => suma + v, 0),
    [disponiblePorArticulo],
  );

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
  // El mínimo es el MISMO que exige el contrato (3 caracteres, ya recortado): así el botón no
  // promete un guardado que el servidor va a rechazar.
  const motivoOk = motivo.trim().length >= 3;
  const puedeGuardar =
    puedeMover &&
    idAlmacenOrigen !== '' &&
    idAlmacenDestino !== '' &&
    !mismoAlmacen &&
    modelo !== undefined &&
    motivoOk &&
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
        motivo: motivo.trim(),
        lineas: aLineasApi(lineas, undefined, idOrdenElegida),
      },
      {
        onSuccess: (traspaso) => {
          toast.success(
            `Traspaso guardado (salida #${traspaso.salida.folio} → entrada #${traspaso.entrada.folio}).`,
          );
          setLineas([]);
          setTallas([]);
          setMotivo('');
          // El folio del traspaso es el de la pata de SALIDA (no se genera ninguno nuevo).
          setRecienGuardado({ id: traspaso.salida.id, folio: traspaso.salida.folio });
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
            Traspaso entre almacenes
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Mueve un modelo de un almacén a otro por color × talla, en una sola operación
          </p>
        </div>
      </header>

      {/* Hoja del traspaso RECIÉN guardado (fila 0.100): el papel que va con las prendas. Imprime
          el folio QUE YA EXISTE — no se genera documento nuevo. Si esta pantalla se cierra, la hoja
          se recupera en el kardex, modo «Por folio»: se busca este folio y el detalle ofrece el
          mismo botón. */}
      {recienGuardado !== null ? (
        <div
          className="flex flex-wrap items-center gap-3 rounded-md border bg-primary-soft px-3 py-2"
          data-testid="traspaso-pt-guardado"
        >
          <span className="text-sm">
            Traspaso <b className="num">#{recienGuardado.folio}</b> registrado. Imprime la hoja que
            va con las prendas.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              window.open(urlImpresoTraspasoPt(recienGuardado.id), '_blank', 'noopener')
            }
            data-testid="traspaso-pt-imprimir"
          >
            <Printer className="size-4" aria-hidden />
            Hoja del traspaso
          </Button>
        </div>
      ) : null}

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

              <div className="grid gap-4 sm:grid-cols-2">
                {/* §Post-F9.40 — de qué ORDEN salen las piezas del ORIGEN (el bucket que se mueve;
                    el destino las recibe con la MISMA orden: no se pierde el rastro). */}
                <SelectorOrdenPt
                  id="traspaso-orden"
                  opciones={opcionesOrden}
                  valor={ordenElegida}
                  alCambiar={setOrdenBucket}
                  deshabilitado={!puedeMover || !hayOrigen}
                  cargando={hayOrigen && existencias.isPending}
                  hayError={existencias.isError}
                  alReintentar={() => void existencias.refetch()}
                  ayuda={
                    hayOrigen
                      ? 'De qué producción salen las piezas; el destino las recibe con esa misma orden.'
                      : 'Elige el almacén de origen para ver de qué órdenes hay piezas ahí.'
                  }
                  testid="traspaso-orden"
                />
                <Field data-invalid={!motivoOk}>
                  <FieldLabel htmlFor="traspaso-motivo">Motivo (obligatorio)</FieldLabel>
                  <Input
                    id="traspaso-motivo"
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Por qué se mueve (embarque, reacomodo, va a estampado…)"
                    disabled={!puedeMover}
                    data-testid="traspaso-motivo"
                  />
                  <FieldDescription>
                    Sale IMPRESO en la hoja que acompaña las prendas. Mínimo 3 caracteres.
                  </FieldDescription>
                </Field>
              </div>

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
                    Existencia disponible en el origen{' '}
                    {idOrdenElegida === null
                      ? '(bucket «sin orden»)'
                      : `(orden ${String(
                          opcionesOrden.find((o) => o.idOrden === idOrdenElegida)?.folioOrden ??
                            idOrdenElegida,
                        )})`}
                    : <strong>{totalDisponibleBucket.toLocaleString('es-MX')}</strong> pzas.
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
