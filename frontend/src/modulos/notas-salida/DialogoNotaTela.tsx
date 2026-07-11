import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useSalidaTelaAOrden } from '@/api/inventario-materiales';
import type { Orden } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel, LeyendaObligatorios, MarcaObligatoria } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { CapturaRenglonesTela, type RenglonTela } from '@/modulos/inventarios/CapturaRenglonesTela';
import { SelectorOrden } from '@/modulos/produccion/SelectorOrden';

/** Fecha de hoy en YYYY-MM-DD (zona local). */
function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * NOTA DE SALIDA DE TELAS (rediseño R6, §4.6 decisión 2 de Daniel): remisión de TELA a la producción
 * de una orden. Es una nota SEPARADA de la de avíos porque la tela sale de OTRO almacén (el almacén
 * de TELAS). Reusa el motor F4 "salida de tela a orden" (`registrarSalidaTelaAOrden`, `POST
 * /inventarios/telas/salidas-orden`): la ÚNICA vía que descuenta tela hacia una orden, con la traza
 * orden↔salida y el no-negativo bajo lock (D3) — SIN cambios de backend. La tela va a la producción
 * de la orden (que ya lleva su maquilero asignado); por eso el destino se muestra desde la orden.
 *
 * A diferencia de la nota de avíos (que documenta un envío al confirmar y descuenta el kardex de
 * avíos), aquí el mismo acto de registrar la salida descuenta la tela. Presentación pura (A1):
 * catálogos, existencias y el no-negativo los decide el backend. Permiso `inventario-telas.mover`.
 */
export function DialogoNotaTela({
  abierto,
  alCambiarAbierto,
  alGuardada,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  /** Callback tras registrar la salida (para refrescar/toast en el llamador). */
  alGuardada?: (() => void) | undefined;
}): React.JSX.Element {
  const crear = useSalidaTelaAOrden();
  const almacenes = useAlmacenes({ pagina: 1, porPagina: 100, ordenarPor: 'nombre' });

  const [orden, setOrden] = useState<Orden | undefined>(undefined);
  const [idAlmacen, setIdAlmacen] = useState('');
  const [fecha, setFecha] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [renglones, setRenglones] = useState<RenglonTela[]>([]);

  // Al abrir, limpia el formulario.
  useEffect(() => {
    if (!abierto) return;
    setOrden(undefined);
    setIdAlmacen('');
    setFecha(hoy());
    setObservaciones('');
    setRenglones([]);
  }, [abierto]);

  const total = renglones.reduce((s, r) => s + r.cantidad, 0);
  const puedeGuardar =
    !crear.isPending && orden !== undefined && idAlmacen !== '' && renglones.length > 0;

  function confirmar(): void {
    if (orden === undefined) {
      toast.error('Elige la orden que consume la tela.');
      return;
    }
    if (idAlmacen === '') {
      toast.error('Elige el almacén de telas de origen.');
      return;
    }
    if (renglones.length === 0) {
      toast.error('Agrega al menos un renglón de tela (tela + lote + cantidad).');
      return;
    }
    crear.mutate(
      {
        idOrden: orden.id,
        idAlmacen: Number(idAlmacen),
        fecha,
        ...(observaciones.trim().length > 0 ? { observaciones: observaciones.trim() } : {}),
        lineas: renglones.map((r) => ({
          idTela: r.idTela,
          idLote: r.idLote,
          cantidad: r.cantidad,
        })),
      },
      {
        onSuccess: (mov) => {
          toast.success(
            `Nota de tela registrada (folio #${mov.folio}, ligada a la orden #${orden.folio}, tela descontada).`,
          );
          alCambiarAbierto(false);
          alGuardada?.();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nueva nota de salida de telas</DialogTitle>
          <DialogDescription>
            Remisión de tela a la producción de una orden, desde el almacén de telas. Al registrar
            se descuenta la tela del inventario (única vía que la descuenta, D3).
          </DialogDescription>
        </DialogHeader>

        {/* Cuerpo desplazable: el footer queda FIJO fuera de este scroll (patrón transversal). */}
        <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2 pr-1">
          <LeyendaObligatorios />
          {/* Orden destino (aporta su maquilero) + almacén de telas + fecha. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="nota-tela-orden" required>
                Orden destino
              </FieldLabel>
              <SelectorOrden idSeleccionada={orden?.id} alSeleccionar={setOrden} />
            </Field>
            <Field>
              <FieldLabel htmlFor="nota-tela-maquilero">Maquilero (de la orden)</FieldLabel>
              <Input
                id="nota-tela-maquilero"
                readOnly
                value={orden?.maquilero ?? '—'}
                data-testid="nota-tela-maquilero"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="nota-tela-almacen" required>
                Almacén de telas (origen)
              </FieldLabel>
              <SelectNativo
                id="nota-tela-almacen"
                disabled={almacenes.isPending}
                value={idAlmacen}
                onChange={(e) => {
                  setIdAlmacen(e.target.value);
                  setRenglones([]); // los lotes dependen del almacén
                }}
                data-testid="nota-tela-almacen"
              >
                <option value="">Elige el almacén de telas…</option>
                {(almacenes.data?.datos ?? []).map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="nota-tela-fecha">Fecha</FieldLabel>
              <Input
                id="nota-tela-fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                data-testid="nota-tela-fecha"
              />
            </Field>
            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="nota-tela-obs">Observaciones</FieldLabel>
              <Input
                id="nota-tela-obs"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Ej. Entrega parcial para arranque de costura"
                data-testid="nota-tela-obs"
              />
            </Field>
          </div>

          {/* Renglones tela×lote con existencia (reusa la captura de F4). */}
          <div>
            <h3 className="mb-2 flex items-center gap-1 text-sm font-medium text-muted-foreground">
              Telas a enviar (por lote) <MarcaObligatoria />
            </h3>
            <CapturaRenglonesTela
              idAlmacen={idAlmacen === '' ? undefined : Number(idAlmacen)}
              renglones={renglones}
              onChange={setRenglones}
            />
          </div>

          <p className="text-sm text-muted-foreground">
            Total a enviar:{' '}
            <strong className="tabular-nums">{total.toLocaleString('es-MX')}</strong>
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={crear.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={confirmar}
            disabled={!puedeGuardar}
            data-testid="confirmar-nota-tela"
            className="w-full sm:w-auto"
          >
            {crear.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Registrar nota de telas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
