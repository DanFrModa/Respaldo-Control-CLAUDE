import { GitCompareIcon, HandshakeIcon, Loader2Icon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useDesarrollo } from '@/api/desarrollos';
import type { ListaLinea } from '@/api/listas-precios';
import {
  useEventosLinea,
  useRegistrarAcuerdo,
  useRegistrarRonda,
  type NegociacionEvento,
} from '@/api/negociacion';
import { usePrecostosDesarrollo } from '@/api/precostos';
import { Badge } from '@/components/ui/badge';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatearFechaHora, formatearMoneda } from '@/lib/formato';
import { DialogoPrecosto } from '@/modulos/desarrollo/DialogoPrecosto';

import { ComparadorVersiones } from './ComparadorVersiones';

/** Clases del textarea (mismo estilo que el resto de formularios). */
const CLASES_TEXTAREA =
  'w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30';

/**
 * Panel de NEGOCIACIÓN de un renglón (F8-E5): historial de eventos (rondas + acuerdos) con comparador de
 * versiones, y las acciones "Nueva ronda" (re-costeo guiado) y "Registrar acuerdo" (sin re-costeo). Los
 * controles de negociar sólo se muestran con `listas.negociar` (el backend re-verifica, A1); los importes
 * salen "—" sin `consultas.ver-importes`.
 */
export function DialogoNegociacionRenglon({
  abierto,
  alCambiarAbierto,
  linea,
  verImportes,
  puedeNegociar,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  linea: ListaLinea;
  verImportes: boolean;
  puedeNegociar: boolean;
}): React.JSX.Element {
  const eventos = useEventosLinea(abierto ? linea.id : null);
  const [nuevaRondaAbierta, setNuevaRondaAbierta] = useState(false);
  const [acuerdoAbierto, setAcuerdoAbierto] = useState(false);

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Negociación — {linea.codigoModelo}</DialogTitle>
          <DialogDescription>
            Historial de rondas (re-costeo por versiones) y acuerdos de este renglón. Cada ronda
            cambia el desarrollo, congela una versión nueva del precosto y re-apunta el precio; nada
            se pierde.
          </DialogDescription>
        </DialogHeader>

        <div
          className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
          data-testid="panel-negociacion"
        >
          {eventos.isPending ? (
            <p className="text-sm text-muted-foreground">Cargando historial…</p>
          ) : eventos.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {eventos.error.message}
            </p>
          ) : (eventos.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="negociacion-vacia">
              Sin rondas ni acuerdos todavía.
            </p>
          ) : (
            <HistorialEventos eventos={eventos.data ?? []} verImportes={verImportes} />
          )}

          {puedeNegociar ? (
            <div className="flex flex-wrap gap-2 border-t pt-3">
              <Button
                type="button"
                onClick={() => setNuevaRondaAbierta(true)}
                data-testid="abrir-nueva-ronda"
              >
                <PlusIcon aria-hidden />
                Nueva ronda
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAcuerdoAbierto(true)}
                data-testid="abrir-acuerdo"
              >
                <HandshakeIcon aria-hidden />
                Registrar acuerdo
              </Button>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => alCambiarAbierto(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>

      <DialogoNuevaRonda
        abierto={nuevaRondaAbierta}
        alCambiarAbierto={setNuevaRondaAbierta}
        linea={linea}
      />
      <DialogoRegistrarAcuerdo
        abierto={acuerdoAbierto}
        alCambiarAbierto={setAcuerdoAbierto}
        linea={linea}
      />
    </Dialog>
  );
}

/** Tabla del historial de eventos con comparador expandible por ronda. */
function HistorialEventos({
  eventos,
  verImportes,
}: {
  eventos: NegociacionEvento[];
  verImportes: boolean;
}): React.JSX.Element {
  const [comparando, setComparando] = useState<number | null>(null);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cuándo</TableHead>
              <TableHead>Versión</TableHead>
              <TableHead className="text-right">Precio anterior</TableHead>
              <TableHead className="text-right">Precio nuevo</TableHead>
              <TableHead>Acuerdo</TableHead>
              <TableHead className="text-right">Comparar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {eventos.map((e) => {
              const esRonda = e.idPrecostoAnterior !== null && e.idPrecostoNuevo !== null;
              return (
                <TableRow key={e.id} data-testid="fila-evento-negociacion">
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatearFechaHora(e.registradoEn)}
                  </TableCell>
                  <TableCell>
                    {esRonda ? (
                      <span>
                        v{e.versionAnterior} →{' '}
                        <span className="font-medium">v{e.versionNueva}</span>
                      </span>
                    ) : (
                      <Badge variant="secondary">acuerdo</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {verImportes ? formatearMoneda(e.precioAnterior) : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {verImportes ? formatearMoneda(e.precioNuevo) : '—'}
                  </TableCell>
                  <TableCell className="max-w-[16rem] text-sm">{e.acuerdo}</TableCell>
                  <TableCell className="text-right">
                    {esRonda ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setComparando((actual) => (actual === e.id ? null : e.id))}
                        data-testid="comparar-evento"
                      >
                        <GitCompareIcon aria-hidden />
                      </Button>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {comparando !== null
        ? (() => {
            const evento = eventos.find((e) => e.id === comparando);
            if (
              evento === undefined ||
              evento.idPrecostoAnterior === null ||
              evento.idPrecostoNuevo === null
            ) {
              return null;
            }
            return (
              <div className="rounded-lg border bg-muted/30 p-3">
                <ComparadorVersiones
                  idAnterior={evento.idPrecostoAnterior}
                  idNuevo={evento.idPrecostoNuevo}
                  verImportes={verImportes}
                />
              </div>
            );
          })()
        : null}
    </div>
  );
}

/**
 * Flujo GUIADO de una nueva ronda: (1) ajustar el precosto (reusa el editor de E3: generar v+1 →
 * editar → congelar), (2) elegir la versión congelada nueva, (3) escribir el acuerdo (+ precio
 * acordado opcional), (4) confirmar → `registrarRonda`.
 */
function DialogoNuevaRonda({
  abierto,
  alCambiarAbierto,
  linea,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  linea: ListaLinea;
}): React.JSX.Element {
  const desarrollo = useDesarrollo(abierto ? linea.idDesarrollo : null);
  const historial = usePrecostosDesarrollo(abierto ? linea.idDesarrollo : null);
  const ronda = useRegistrarRonda();

  const [editorAbierto, setEditorAbierto] = useState(false);
  const [idVersion, setIdVersion] = useState('');
  const [acuerdo, setAcuerdo] = useState('');
  const [precio, setPrecio] = useState('');

  // Versiones congeladas ELEGIBLES: las que NO son la que el renglón ya usa (la ronda necesita otra).
  const congeladas = (historial.data ?? []).filter((v) => v.congelado && v.id !== linea.idPrecosto);

  function limpiar(): void {
    setIdVersion('');
    setAcuerdo('');
    setPrecio('');
  }

  function confirmar(): void {
    if (idVersion === '') {
      toast.error('Elige la versión congelada nueva.');
      return;
    }
    if (acuerdo.trim() === '') {
      toast.error('Escribe qué se cambió o acordó.');
      return;
    }
    const cuerpo: { idPrecostoNuevo: number; acuerdo: string; precioAcordado?: number } = {
      idPrecostoNuevo: Number(idVersion),
      acuerdo: acuerdo.trim(),
    };
    if (precio.trim() !== '') {
      const precioNum = Number(precio);
      if (!Number.isFinite(precioNum) || precioNum <= 0) {
        toast.error('El precio acordado debe ser mayor a cero.');
        return;
      }
      cuerpo.precioAcordado = precioNum;
    }
    ronda.mutate(
      { idLinea: linea.id, cuerpo },
      {
        onSuccess: () => {
          toast.success(`Ronda registrada para "${linea.codigoModelo}".`);
          limpiar();
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva ronda — {linea.codigoModelo}</DialogTitle>
          <DialogDescription>
            Ajusta el desarrollo y congela una versión nueva del precosto; luego elígela y registra
            el acuerdo. El precio se recalcula con los factores de la lista.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2" data-testid="form-nueva-ronda">
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="mb-2 font-medium">1. Ajusta el precosto</p>
            <p className="mb-2 text-muted-foreground">
              Genera una versión nueva, edítala (quita/agrega insumos) y congélala.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditorAbierto(true)}
              data-testid="abrir-editor-precosto"
            >
              Abrir editor de precosto
            </Button>
          </div>

          <Field>
            <FieldLabel htmlFor="ronda-version">2. Versión congelada nueva</FieldLabel>
            <SelectNativo
              id="ronda-version"
              value={idVersion}
              onChange={(e) => setIdVersion(e.target.value)}
              data-testid="ronda-version"
            >
              <option value="">Elige la versión…</option>
              {congeladas.map((v) => (
                <option key={v.id} value={String(v.id)}>
                  v{v.version}
                  {v.costoTotal !== null ? ` · ${formatearMoneda(v.costoTotal)}` : ''}
                </option>
              ))}
            </SelectNativo>
            {congeladas.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                No hay otra versión congelada aún. Genera y congela una en el editor.
              </span>
            ) : null}
          </Field>

          <Field>
            <FieldLabel htmlFor="ronda-acuerdo">3. Acuerdo (qué se cambió/pactó)</FieldLabel>
            <textarea
              id="ronda-acuerdo"
              rows={2}
              className={CLASES_TEXTAREA}
              value={acuerdo}
              onChange={(e) => setAcuerdo(e.target.value)}
              data-testid="ronda-acuerdo"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="ronda-precio">Precio acordado (opcional)</FieldLabel>
            <Input
              id="ronda-precio"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              placeholder="(se toma el calculado si se deja vacío)"
              data-testid="ronda-precio"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={ronda.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={confirmar}
            disabled={ronda.isPending}
            data-testid="confirmar-ronda"
          >
            {ronda.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Registrar ronda
          </Button>
        </DialogFooter>
      </DialogContent>

      <DialogoPrecosto
        abierto={editorAbierto}
        alCambiarAbierto={(v) => {
          setEditorAbierto(v);
          // Al cerrar el editor, refresca el historial para que la versión recién congelada
          // aparezca de inmediato en el selector de la ronda (no depende de la invalidación cruzada).
          if (!v) {
            void historial.refetch();
          }
        }}
        desarrollo={desarrollo.data}
      />
    </Dialog>
  );
}

/** Registrar un acuerdo SIN re-costeo (sólo nota + precio acordado opcional). */
function DialogoRegistrarAcuerdo({
  abierto,
  alCambiarAbierto,
  linea,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  linea: ListaLinea;
}): React.JSX.Element {
  const acuerdoMut = useRegistrarAcuerdo();
  const [acuerdo, setAcuerdo] = useState('');
  const [precio, setPrecio] = useState('');

  function confirmar(): void {
    if (acuerdo.trim() === '') {
      toast.error('Escribe qué se acordó.');
      return;
    }
    const cuerpo: { acuerdo: string; precioAcordado?: number } = { acuerdo: acuerdo.trim() };
    if (precio.trim() !== '') {
      const precioNum = Number(precio);
      if (!Number.isFinite(precioNum) || precioNum <= 0) {
        toast.error('El precio acordado debe ser mayor a cero.');
        return;
      }
      cuerpo.precioAcordado = precioNum;
    }
    acuerdoMut.mutate(
      { idLinea: linea.id, cuerpo },
      {
        onSuccess: () => {
          toast.success(`Acuerdo registrado para "${linea.codigoModelo}".`);
          setAcuerdo('');
          setPrecio('');
          alCambiarAbierto(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar acuerdo — {linea.codigoModelo}</DialogTitle>
          <DialogDescription>
            Deja constancia de un acuerdo sin re-costeo (ej. "el cliente pidió quitar bolsas"). No
            cambia el precosto ni el precio aprobado; sólo queda en la bitácora del renglón.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2" data-testid="form-acuerdo">
          <Field>
            <FieldLabel htmlFor="acuerdo-texto">Acuerdo</FieldLabel>
            <textarea
              id="acuerdo-texto"
              rows={3}
              className={CLASES_TEXTAREA}
              value={acuerdo}
              onChange={(e) => setAcuerdo(e.target.value)}
              data-testid="acuerdo-texto"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="acuerdo-precio">Precio acordado (opcional)</FieldLabel>
            <Input
              id="acuerdo-precio"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              data-testid="acuerdo-precio"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={acuerdoMut.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={confirmar}
            disabled={acuerdoMut.isPending}
            data-testid="confirmar-acuerdo"
          >
            {acuerdoMut.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Registrar acuerdo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
