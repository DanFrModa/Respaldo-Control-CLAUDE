import { Loader2Icon, MapPin } from 'lucide-react';
import { useEffect, useState } from 'react';

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

/** Tope del texto libre: el mismo que valida el contrato del servidor. */
const LARGO_MAX = 120;

/**
 * ⭐⭐ FILA 0.103 — DÓNDE ESTÁ GUARDADO EL MATERIAL. Diálogo COMPARTIDO por el inventario de telas
 * por color y el de avíos: en los dos la pregunta es la misma (*¿dónde está este material dentro de
 * ESTE almacén?*) y la respuesta es **texto libre** — Daniel, 3-sep-2026: *«de texto libre está
 * bien. Por ahora NO un catálogo de posiciones»*. Por eso no hay desplegable, ni formato, ni
 * validación de contenido: sólo un techo para que quepa en la tabla.
 *
 * **Vaciar el campo BORRA la ubicación** (no guarda una cadena vacía), y se dice en la pantalla para
 * que nadie tenga que descubrirlo. El servidor es la autoridad: recorta, guarda y contesta lo que
 * quedó; esta pantalla sólo presenta (A1).
 */
export function DialogoUbicacionMaterial({
  abierto,
  material,
  almacen,
  ubicacionActual,
  cargando,
  alCerrar,
  alGuardar,
}: {
  abierto: boolean;
  /** Qué material se está ubicando, en palabras del almacén ("Felpa · Marino", "CIE-01"). */
  material: string;
  /** En qué almacén. La ubicación es por material × almacén: el mismo color vive en varios. */
  almacen: string;
  /** Lo que hay anotado hoy, o `null` si nadie lo ha anotado. */
  ubicacionActual: string | null;
  cargando: boolean;
  alCerrar: () => void;
  alGuardar: (ubicacion: string) => void;
}): React.JSX.Element {
  const [texto, setTexto] = useState('');

  // Al abrir se siembra con lo que ya estaba: editar es lo normal, capturar de cero es lo raro.
  useEffect(() => {
    if (abierto) setTexto(ubicacionActual ?? '');
  }, [abierto, ubicacionActual]);

  const limpio = texto.trim();
  const borra = limpio.length === 0 && ubicacionActual !== null;

  return (
    <Dialog open={abierto} onOpenChange={(o) => (o ? undefined : alCerrar())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="size-4 text-primary" aria-hidden />
            Dónde está guardado
          </DialogTitle>
          <DialogDescription>
            {material} · almacén <b>{almacen}</b>. Escribe el lugar como lo diga el almacén («Rack
            4, nivel 2», «pasillo B, caja 3»). Si lo dejas vacío, se borra la ubicación.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <Field>
            <FieldLabel htmlFor="material-ubicacion">Ubicación</FieldLabel>
            <Input
              id="material-ubicacion"
              value={texto}
              maxLength={LARGO_MAX}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !cargando) alGuardar(limpio);
              }}
              placeholder="Rack 4, nivel 2"
              autoFocus
              data-testid="material-ubicacion"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={alCerrar} disabled={cargando}>
            Volver
          </Button>
          <Button
            type="button"
            onClick={() => alGuardar(limpio)}
            disabled={cargando}
            data-testid="guardar-ubicacion-material"
          >
            {cargando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            {borra ? 'Borrar ubicación' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * ⭐⭐ FILA 0.103 — la ubicación EN LA CELDA: se lee siempre y se edita sólo con permiso. Cuando no
 * hay nada anotado NO se pinta un hueco mudo: con permiso invita a capturarla, sin permiso dice «—».
 * Compartido por el inventario de telas por color y el de avíos, para que se vea igual en los dos.
 */
export function BotonUbicacion({
  ubicacion,
  editable,
  alEditar,
  etiqueta,
  idPrueba,
}: {
  ubicacion: string | null;
  editable: boolean;
  alEditar: () => void;
  /** Qué material y en qué almacén, para que el lector de pantalla sepa qué botón es éste. */
  etiqueta: string;
  idPrueba: string;
}): React.JSX.Element {
  if (!editable) {
    return (
      <span className="text-xs text-muted-foreground" data-testid={idPrueba}>
        {ubicacion ?? '—'}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={alEditar}
      aria-label={`Dónde está guardado ${etiqueta}`}
      className="flex items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-muted"
      data-testid={idPrueba}
    >
      <MapPin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {ubicacion ?? <span className="text-faint italic">Anotar…</span>}
    </button>
  );
}
