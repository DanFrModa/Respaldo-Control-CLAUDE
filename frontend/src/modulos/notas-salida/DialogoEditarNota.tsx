import { DownloadIcon, InfoIcon, Loader2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useHabilitacionOrden } from '@/api/habilitacion';
import { useExistenciasAvio } from '@/api/inventario-materiales';
import { useActualizarNota, useCrearNota } from '@/api/notas-salida';
import { useConsultaOrdenes } from '@/api/ordenes-consulta';
import type { NotaSalida, NotaSalidaCrear, NotaSalidaEditar } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { SelectorProveedor } from '@/modulos/cxp/SelectorProveedor';

import {
  capturaDesdeNota,
  nuevaClaveRenglon,
  renglonApi,
  renglonCompleto,
  renglonVacio,
  type RenglonNotaCaptura,
} from './captura';
import { EditorRenglonesNota, type ExistenciaAvioNota } from './EditorRenglonesNota';

/** Fecha de hoy en YYYY-MM-DD (zona local). */
function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Un renglón para pre-cargar el constructor (viene del panel de habilitación, §4.6). */
export interface PrefillRenglonNota {
  idOrden: number;
  idAvio: number;
  /** Clave del avío (la trae la habilitación): la muestra el combobox del renglón. */
  clave?: string | null;
  cantidad: number;
  unidad: string | null;
}

/** Datos para PRE-CARGAR el constructor desde la habilitación ("Pasar a nota de salida"). */
export interface PrefillNota {
  idMaquilero?: number | null;
  idAlmacen?: number | null;
  renglones?: PrefillRenglonNota[];
  /** Recetas conocidas (idOrden → ids de avío de su receta) para el flag ✓/⚠ ya pre-cargado. */
  recetaPorOrden?: Record<number, number[]>;
}

/**
 * Diálogo de CAPTURA / EDICIÓN de una nota de salida (F4-E5; rediseño R6 §4.6). Si recibe `nota`,
 * edita; si recibe `prefill`, da de alta PRE-CARGADO (desde "Pasar a nota de salida" de la
 * habilitación); si no, alta vacía. Encabezado (maquilero, almacén origen [decisión g], fechas,
 * observaciones) + **"Traer avíos de la orden"** (carga la receta con su cantidad sugerida, PROPONE
 * no LIMITA) + renglones de AVÍO (con flag de receta ✓/⚠ y existencia; la tela ya no se captura
 * aquí — §Post-F9.38: la salida de tela a una orden NO lleva nota). Una nota
 * confirmada/cancelada va en `soloLectura`. Acciones gobernadas por `notas.administrar`; el backend
 * es la autoridad (A1).
 */
export function DialogoEditarNota({
  abierto,
  alCambiarAbierto,
  nota,
  prefill,
  soloLectura = false,
  alGuardada,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Nota a editar; `undefined` = alta de un borrador nuevo. */
  nota?: NotaSalida | undefined;
  /** Datos para pre-cargar el alta (desde la habilitación); ignorado en edición. */
  prefill?: PrefillNota | undefined;
  /** Bloquea toda edición (nota confirmada/cancelada); el backend re-valida. */
  soloLectura?: boolean;
  /** Callback con el id de la nota guardada (para enfocarla en la lista). */
  alGuardada: (id: number) => void;
}): React.JSX.Element {
  const crear = useCrearNota();
  const actualizar = useActualizarNota();
  const guardando = crear.isPending || actualizar.isPending;
  const esEdicion = nota !== undefined;

  // ── Catálogos para los selectores. ───────────────────────────────────────────
  const almacenes = useAlmacenes({ pagina: 1, porPagina: 100, ordenarPor: 'nombre' });
  const ordenes = useConsultaOrdenes({ pagina: 1, porPagina: 100, incluirCanceladas: 'false' });

  // ── Estado del encabezado. ───────────────────────────────────────────────────
  const [idMaquilero, setIdMaquilero] = useState<number | null>(null);
  // Nombre del maquilero elegido: con búsqueda server-side el combobox sólo conoce su página, así
  // que al EDITAR una nota vieja el campo se vería en blanco sin esto.
  const [nombreMaquilero, setNombreMaquilero] = useState<string | undefined>(undefined);
  const [idAlmacen, setIdAlmacen] = useState<number | null>(null);
  const [fechaElaboracion, setFechaElaboracion] = useState('');
  const [fechaEnvio, setFechaEnvio] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [renglones, setRenglones] = useState<RenglonNotaCaptura[]>([]);
  // Recetas conocidas por orden (idOrden → ids de avío) para el flag ✓/⚠ del editor.
  const [recetas, setRecetas] = useState<Record<number, number[]>>({});
  // Orden elegida en el selector "Traer avíos de la orden".
  const [ordenTraer, setOrdenTraer] = useState<number | null>(null);

  // Habilitación de la orden elegida para "Traer avíos" (trae la receta + cantidad sugerida).
  const habTraer = useHabilitacionOrden(ordenTraer ?? undefined);
  const habLista =
    habTraer.data !== undefined && ordenTraer !== null && habTraer.data.idOrden === ordenTraer;

  // Existencias de avío del almacén origen elegido (aviso "excede"; apagada sin almacén).
  const existencias = useExistenciasAvio(
    idAlmacen === null ? {} : { idAlmacen, incluirCeros: 'true' },
    { habilitado: idAlmacen !== null },
  );
  const existenciaPorAvio = useMemo(() => {
    const mapa = new Map<number, ExistenciaAvioNota>();
    if (idAlmacen === null) return mapa;
    for (const f of existencias.data?.filas ?? []) {
      if (f.idAlmacen === idAlmacen)
        mapa.set(f.idAvio, { existencia: f.existencia, unidad: f.unidad });
    }
    return mapa;
  }, [existencias.data, idAlmacen]);

  const recetaPorOrden = useMemo(() => {
    const mapa = new Map<number, Set<number>>();
    for (const [clave, ids] of Object.entries(recetas)) mapa.set(Number(clave), new Set(ids));
    return mapa;
  }, [recetas]);

  // Al abrir, carga los datos de la nota (edición), el prefill (alta pre-cargada) o limpia (alta).
  useEffect(() => {
    if (!abierto) {
      return;
    }
    setOrdenTraer(null);
    if (nota !== undefined) {
      setIdMaquilero(nota.idMaquilero);
      setNombreMaquilero(nota.maquilero);
      setIdAlmacen(nota.idAlmacen);
      setFechaElaboracion(nota.fechaElaboracion);
      setFechaEnvio(nota.fechaEnvio ?? '');
      setObservaciones(nota.observaciones ?? '');
      setRenglones(capturaDesdeNota(nota));
      setRecetas({});
    } else if (prefill !== undefined) {
      setIdMaquilero(prefill.idMaquilero ?? null);
      // El prefill sólo trae el id; el nombre lo repone el combobox al resolver su página.
      setNombreMaquilero(undefined);
      setIdAlmacen(prefill.idAlmacen ?? null);
      setFechaElaboracion(hoy());
      setFechaEnvio('');
      setObservaciones('');
      setRenglones(
        (prefill.renglones ?? []).map((r) => ({
          clave: nuevaClaveRenglon(),
          tipo: 'avio' as const,
          idOrden: r.idOrden,
          idAvio: r.idAvio,
          avioEtiqueta: r.clave ?? null,
          idTela: null,
          telaNombre: null,
          idLote: null,
          loteClave: null,
          idMovimientoSalidaTela: null,
          cantidad: String(r.cantidad),
          unidad: r.unidad ?? '',
          descripcionLegacy: null,
        })),
      );
      setRecetas(prefill.recetaPorOrden ?? {});
    } else {
      setIdMaquilero(null);
      setIdAlmacen(null);
      setFechaElaboracion(hoy());
      setFechaEnvio('');
      setObservaciones('');
      setRenglones([renglonVacio()]);
      setRecetas({});
    }
  }, [abierto, nota, prefill]);

  /** Carga los avíos de la receta de la orden elegida (cantidad = requerido); PROPONE, no LIMITA. */
  function traerAvios(): void {
    if (!habLista || habTraer.data === undefined) {
      toast.error('Elige una orden y espera a que cargue su receta.');
      return;
    }
    const data = habTraer.data;
    const deReceta = data.avios.filter((a) => !a.esExtra);
    if (deReceta.length === 0) {
      toast.error('La orden no tiene avíos en su receta.');
      return;
    }
    const nuevos: RenglonNotaCaptura[] = deReceta.map((a) => ({
      clave: nuevaClaveRenglon(),
      tipo: 'avio',
      idOrden: data.idOrden,
      idAvio: a.idAvio,
      avioEtiqueta: a.clave,
      idTela: null,
      telaNombre: null,
      idLote: null,
      loteClave: null,
      idMovimientoSalidaTela: null,
      cantidad: String(a.requerido),
      unidad: a.unidad ?? '',
      descripcionLegacy: null,
    }));
    // Conserva los renglones ya capturados (descarta los vacíos, como en el proto).
    setRenglones((prev) => {
      const conContenido = prev.filter(
        (r) => r.idAvio !== null || r.idTela !== null || r.idOrden !== null || r.cantidad !== '',
      );
      return [...conContenido, ...nuevos];
    });
    setRecetas((prev) => ({ ...prev, [data.idOrden]: deReceta.map((a) => a.idAvio) }));
    if (idMaquilero === null && data.idMaquilero !== null) setIdMaquilero(data.idMaquilero);
    toast.success(
      `${nuevos.length} avíos de la orden ${data.folioOrden} agregados desde su receta.`,
    );
  }

  const renglonesValidos = renglones.length > 0 && renglones.every(renglonCompleto);
  const puedeGuardar =
    !guardando &&
    idMaquilero !== null &&
    idAlmacen !== null &&
    fechaElaboracion !== '' &&
    renglonesValidos;

  // Totales vivos (# órdenes distintas · # renglones), §4.6.
  const numOrdenes = new Set(renglones.map((r) => r.idOrden).filter((o) => o !== null)).size;

  function confirmar(): void {
    if (idMaquilero === null) {
      toast.error('Elige el maquilero destino de la nota.');
      return;
    }
    if (idAlmacen === null) {
      toast.error('Elige el almacén origen de la nota.');
      return;
    }
    if (!renglonesValidos) {
      toast.error('Completa todos los renglones (orden + material + cantidad).');
      return;
    }
    const cuerpo = {
      idMaquilero,
      idAlmacen,
      fechaElaboracion,
      fechaEnvio: fechaEnvio === '' ? null : fechaEnvio,
      observaciones: observaciones.trim() || null,
      lineas: renglones.map(renglonApi),
    };

    if (esEdicion && nota !== undefined) {
      const cuerpoEditar: NotaSalidaEditar = cuerpo;
      actualizar.mutate(
        { id: nota.id, cuerpo: cuerpoEditar },
        {
          onSuccess: (guardada) => {
            toast.success(`Nota de salida ${guardada.numNota} actualizada.`);
            alCambiarAbierto(false);
            alGuardada(guardada.id);
          },
          onError: (error) => toast.error(error.message),
        },
      );
    } else {
      const cuerpoCrear: NotaSalidaCrear = cuerpo;
      crear.mutate(cuerpoCrear, {
        onSuccess: (guardada) => {
          toast.success(`Nota de salida ${guardada.numNota} creada en borrador.`);
          alCambiarAbierto(false);
          alGuardada(guardada.id);
        },
        onError: (error) => toast.error(error.message),
      });
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {soloLectura
              ? `Nota de salida ${nota?.numNota ?? ''}`
              : esEdicion
                ? `Editar nota de salida ${nota?.numNota ?? ''}`
                : 'Nueva nota de salida'}
          </DialogTitle>
          <DialogDescription>
            {soloLectura
              ? 'Esta nota ya no está en borrador: se muestra en solo lectura.'
              : 'Captura el encabezado y los renglones. El folio lo asigna el sistema; los avíos se descuentan al confirmar.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Encabezado */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="nota-maquilero">Maquilero</FieldLabel>
              {/* V1-E7g (§Post-F9.52 punto 7): el maquilero se busca por CUALQUIER palabra, en el
                  SERVIDOR. El `<select>` de aquí sólo dejaba teclear el prefijo y topaba en 100. */}
              <SelectorProveedor
                idSeleccionado={idMaquilero ?? undefined}
                nombreSeleccionado={nombreMaquilero}
                alSeleccionar={(p) => {
                  setIdMaquilero(p.id);
                  setNombreMaquilero(p.nombre);
                }}
                alLimpiar={() => {
                  setIdMaquilero(null);
                  setNombreMaquilero(undefined);
                }}
                deshabilitado={soloLectura}
                placeholder="Elige un maquilero…"
                etiqueta="Maquilero"
                idInput="nota-maquilero"
                testid="nota-maquilero"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="nota-almacen">Almacén origen</FieldLabel>
              <SelectNativo
                id="nota-almacen"
                disabled={soloLectura || almacenes.isPending}
                value={idAlmacen === null ? '' : String(idAlmacen)}
                onChange={(e) =>
                  setIdAlmacen(e.target.value === '' ? null : Number(e.target.value))
                }
                data-testid="nota-almacen"
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
              <FieldLabel htmlFor="nota-fecha-elaboracion">Fecha de elaboración</FieldLabel>
              <Input
                id="nota-fecha-elaboracion"
                type="date"
                disabled={soloLectura}
                value={fechaElaboracion}
                onChange={(e) => setFechaElaboracion(e.target.value)}
                data-testid="nota-fecha-elaboracion"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="nota-fecha-envio">Fecha de envío</FieldLabel>
              <Input
                id="nota-fecha-envio"
                type="date"
                disabled={soloLectura}
                value={fechaEnvio}
                onChange={(e) => setFechaEnvio(e.target.value)}
                data-testid="nota-fecha-envio"
              />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="nota-observaciones">Observaciones</FieldLabel>
              <Input
                id="nota-observaciones"
                disabled={soloLectura}
                placeholder="Notas del envío"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                data-testid="nota-observaciones"
              />
            </Field>
          </div>

          {/* Traer avíos de la orden (la receta PROPONE, no LIMITA — §4.6). */}
          {!soloLectura ? (
            <div
              className="flex flex-col gap-2 rounded-md border bg-panel-2 p-3 sm:flex-row sm:items-end"
              data-testid="nota-traer-avios"
            >
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground sm:flex-1">
                <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                La receta del modelo ya dice qué avíos lleva la orden. Tráelos ya cargados con su
                cantidad sugerida.
              </p>
              <div className="flex items-end gap-2">
                <label className="text-xs text-muted-foreground">
                  Orden
                  <SelectNativo
                    className="mt-1"
                    aria-label="Orden para traer sus avíos"
                    value={ordenTraer === null ? '' : String(ordenTraer)}
                    onChange={(e) =>
                      setOrdenTraer(e.target.value === '' ? null : Number(e.target.value))
                    }
                    data-testid="nota-traer-orden"
                  >
                    <option value="">Elige una orden…</option>
                    {(ordenes.data?.datos ?? []).map((o) => (
                      <option key={o.id} value={String(o.id)}>
                        Orden {o.folio} · {o.codigoModelo}
                      </option>
                    ))}
                  </SelectNativo>
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={traerAvios}
                  disabled={ordenTraer === null || (ordenTraer !== null && habTraer.isPending)}
                  data-testid="nota-traer-boton"
                >
                  <DownloadIcon aria-hidden />
                  Traer avíos de la orden
                </Button>
              </div>
            </div>
          ) : null}

          {/* Renglones */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium text-muted-foreground">Renglones</h3>
              <span className="text-xs text-muted-foreground" data-testid="nota-totales">
                {numOrdenes} {numOrdenes === 1 ? 'orden' : 'órdenes'} · {renglones.length}{' '}
                {renglones.length === 1 ? 'renglón' : 'renglones'}
              </span>
            </div>
            <EditorRenglonesNota
              renglones={renglones}
              alCambiar={setRenglones}
              ordenes={ordenes.data?.datos ?? []}
              recetaPorOrden={recetaPorOrden}
              existenciaPorAvio={existenciaPorAvio}
              soloLectura={soloLectura}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={guardando}
          >
            {soloLectura ? 'Cerrar' : 'Cancelar'}
          </Button>
          {!soloLectura ? (
            <Button
              type="button"
              onClick={confirmar}
              disabled={!puedeGuardar}
              data-testid="confirmar-nota"
            >
              {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              {esEdicion ? 'Guardar cambios' : 'Crear nota de salida'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
