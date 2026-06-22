import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useAvios } from '@/api/avios';
import { useActualizarNota, useCrearNota } from '@/api/notas-salida';
import { useConsultaOrdenes } from '@/api/ordenes-consulta';
import { useProveedores } from '@/api/proveedores';
import { useTelas } from '@/api/telas';
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

import {
  capturaDesdeNota,
  renglonApi,
  renglonCompleto,
  renglonVacio,
  type RenglonNotaCaptura,
} from './captura';
import { EditorRenglonesNota } from './EditorRenglonesNota';

/** Fecha de hoy en YYYY-MM-DD (zona local). */
function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Diálogo de CAPTURA / EDICIÓN de una nota de salida (F4-E5). Si recibe `nota`, edita; si no, da de
 * alta. Encabezado (maquilero, almacén origen [decisión g], fechas, observaciones) + renglones
 * (editor avío/tela). Una nota confirmada/cancelada va en `soloLectura` (el backend igual bloquea,
 * A1). Acciones de escritura gobernadas por `notas.administrar` (la pantalla oculta el botón que abre
 * el diálogo); el backend es la autoridad. Reemplaza Notas/NotasSub del sistema viejo.
 */
export function DialogoEditarNota({
  abierto,
  alCambiarAbierto,
  nota,
  soloLectura = false,
  alGuardada,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Nota a editar; `undefined` = alta de un borrador nuevo. */
  nota?: NotaSalida | undefined;
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
  const proveedores = useProveedores({ pagina: 1, porPagina: 200, ordenarPor: 'nombre' });
  const almacenes = useAlmacenes({ pagina: 1, porPagina: 100, ordenarPor: 'nombre' });
  const avios = useAvios({ pagina: 1, porPagina: 500 });
  const telas = useTelas({ pagina: 1, porPagina: 500, ordenarPor: 'nombre' });
  const ordenes = useConsultaOrdenes({ pagina: 1, porPagina: 200, incluirCanceladas: 'false' });

  // ── Estado del encabezado. ───────────────────────────────────────────────────
  const [idMaquilero, setIdMaquilero] = useState<number | null>(null);
  const [idAlmacen, setIdAlmacen] = useState<number | null>(null);
  const [fechaElaboracion, setFechaElaboracion] = useState('');
  const [fechaEnvio, setFechaEnvio] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [renglones, setRenglones] = useState<RenglonNotaCaptura[]>([]);

  // Al abrir, carga los datos de la nota (edición) o limpia (alta).
  useEffect(() => {
    if (!abierto) {
      return;
    }
    if (nota !== undefined) {
      setIdMaquilero(nota.idMaquilero);
      setIdAlmacen(nota.idAlmacen);
      setFechaElaboracion(nota.fechaElaboracion);
      setFechaEnvio(nota.fechaEnvio ?? '');
      setObservaciones(nota.observaciones ?? '');
      setRenglones(capturaDesdeNota(nota));
    } else {
      setIdMaquilero(null);
      setIdAlmacen(null);
      setFechaElaboracion(hoy());
      setFechaEnvio('');
      setObservaciones('');
      setRenglones([renglonVacio()]);
    }
  }, [abierto, nota]);

  const renglonesValidos = renglones.length > 0 && renglones.every(renglonCompleto);
  const puedeGuardar =
    !guardando &&
    idMaquilero !== null &&
    idAlmacen !== null &&
    fechaElaboracion !== '' &&
    renglonesValidos;

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
              <SelectNativo
                id="nota-maquilero"
                disabled={soloLectura || proveedores.isPending}
                value={idMaquilero === null ? '' : String(idMaquilero)}
                onChange={(e) =>
                  setIdMaquilero(e.target.value === '' ? null : Number(e.target.value))
                }
                data-testid="nota-maquilero"
              >
                <option value="">Elige un maquilero…</option>
                {(proveedores.data?.datos ?? []).map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.nombre}
                  </option>
                ))}
              </SelectNativo>
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

          {/* Renglones */}
          <div>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">Renglones</h3>
            <EditorRenglonesNota
              renglones={renglones}
              alCambiar={setRenglones}
              avios={avios.data?.datos ?? []}
              telas={telas.data?.datos ?? []}
              ordenes={ordenes.data?.datos ?? []}
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
