import { Loader2, Lock, Pencil } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useCapturarReferencia, useReferenciasMaquila } from '@/api/referencias-maquila';
import type { ReferenciaMaquilaPatch, ReferenciaProcesoMaquila } from '@/api/tipos';
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
import { cn } from '@/lib/utils';
import { useSesion } from '@/sesion/useSesion';

/**
 * ⭐ Fila 0.242 (§Post-F9.255) — LAS REFERENCIAS DE PRECIO DE MAQUILA de la orden: el tope de lo que
 * se le paga al taller, UNA por proceso. Se pinta dentro del panel de precios.
 *
 *  • Costura (y todo proceso que no es arte): su referencia de la orden, pre-llenada del precosto o
 *    capturada a mano.
 *  • Arte (estampado, bordado…): la SUMA del precio de sus renglones de arte; se edita renglón por
 *    renglón.
 *
 * Sin referencia, el proceso NO sale a maquila; pasarse de referencia + 5 % lo autoriza Daniel. Todo
 * eso lo decide el servidor (A1): la pantalla sólo enseña lo que llega (montos null ⇒ •••••) y ofrece
 * editar con `ordenes.precio-maquila` mientras la orden esté abierta.
 */
export function BloqueReferenciasMaquila({
  idOrden,
  ordenCerrada,
}: {
  idOrden: number;
  ordenCerrada: boolean;
}): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeEditar = tienePermiso('ordenes.precio-maquila') && !ordenCerrada;
  const referencias = useReferenciasMaquila(idOrden);
  const [editando, setEditando] = useState<EdicionReferencia | null>(null);

  if (referencias.isPending) {
    return <p className="mt-3 text-xs text-muted-foreground">Cargando referencias…</p>;
  }
  if (referencias.isError) {
    return (
      <p className="mt-3 text-xs text-destructive" role="alert">
        {referencias.error.message}
      </p>
    );
  }
  const datos = referencias.data;

  return (
    <div className="mt-3" data-testid="referencias-maquila">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        Referencias de maquila · tope +5 %
      </p>
      <p className="mb-1.5 text-[10.5px] text-faint">
        Sin referencia el proceso no sale a maquila. Pasarse del tope lo autoriza Daniel.
      </p>
      {datos.procesos.length === 0 ? (
        <p className="text-xs text-muted-foreground">La orden no tiene procesos que topar.</p>
      ) : (
        <ul className="space-y-1.5">
          {datos.procesos.map((proceso) => (
            <FilaProceso
              key={proceso.idTipoProceso}
              proceso={proceso}
              ocultas={datos.ocultas}
              puedeEditar={puedeEditar}
              alEditar={setEditando}
            />
          ))}
        </ul>
      )}
      {editando !== null ? (
        <DialogoReferencia
          idOrden={idOrden}
          folioOrden={datos.folioOrden}
          edicion={editando}
          alCerrar={() => setEditando(null)}
        />
      ) : null}
    </div>
  );
}

/** Lo que se está editando: la referencia de un proceso, o el precio de un renglón de arte. */
interface EdicionReferencia {
  titulo: string;
  actual: number | null;
  cuerpo: (precio: number, nota: string | null) => ReferenciaMaquilaPatch;
}

/** `$12.50`, o la marca de tapado / ausente. */
function Monto({ valor, oculto }: { valor: number | null; oculto: boolean }): React.JSX.Element {
  if (oculto) return <span className="tracking-[2px] text-faint">•••••</span>;
  if (valor === null) return <span className="text-faint">—</span>;
  return <span className="num">${valor.toFixed(2)}</span>;
}

function FilaProceso({
  proceso,
  ocultas,
  puedeEditar,
  alEditar,
}: {
  proceso: ReferenciaProcesoMaquila;
  ocultas: boolean;
  puedeEditar: boolean;
  alEditar: (edicion: EdicionReferencia) => void;
}): React.JSX.Element {
  const falta = proceso.estado !== 'lista';
  return (
    <li
      className="rounded-md border bg-panel-2 px-2.5 py-1.5 text-xs"
      data-testid={`referencia-${proceso.codigo}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-semibold">{proceso.nombre}</span>
        {falta ? (
          <span
            className="rounded-full bg-warn-soft px-1.5 text-[10px] font-medium text-warn"
            data-testid={`referencia-${proceso.codigo}-falta`}
          >
            {proceso.estado === 'arte-sin-precio' ? 'falta precio de un arte' : 'sin referencia'}
          </span>
        ) : (
          <span className="text-muted-foreground">
            referencia <Monto valor={proceso.referencia} oculto={ocultas} /> · tope{' '}
            <Monto valor={proceso.tope} oculto={ocultas} />
          </span>
        )}
        {proceso.origen === 'precosto' ? (
          <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
            del precosto
          </span>
        ) : null}
        {!proceso.esArte && puedeEditar ? (
          <BotonEditar
            testid={`referencia-${proceso.codigo}-editar`}
            alPulsar={() =>
              alEditar({
                titulo: `Referencia de ${proceso.nombre}`,
                actual: proceso.referencia,
                cuerpo: (precio, nota) => ({
                  idTipoProceso: proceso.idTipoProceso,
                  precio,
                  ...(nota === null ? {} : { nota }),
                }),
              })
            }
          />
        ) : null}
      </div>
      {proceso.esArte ? (
        <ul className="mt-1 space-y-0.5 pl-2">
          {proceso.renglones.map((renglon) => (
            <li
              key={renglon.idOrdenArte}
              className="flex items-center gap-2 text-[11px]"
              data-testid={`referencia-arte-${renglon.idOrdenArte}`}
            >
              <span className="truncate">
                {renglon.descripcion}
                {renglon.posicion === null ? '' : ` · ${renglon.posicion}`}
              </span>
              <Monto valor={renglon.precio} oculto={ocultas} />
              {puedeEditar ? (
                <BotonEditar
                  testid={`referencia-arte-${renglon.idOrdenArte}-editar`}
                  alPulsar={() =>
                    alEditar({
                      titulo: `Precio del arte «${renglon.descripcion}»`,
                      actual: renglon.precio,
                      cuerpo: (precio, nota) => ({
                        idOrdenArte: renglon.idOrdenArte,
                        precio,
                        ...(nota === null ? {} : { nota }),
                      }),
                    })
                  }
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {proceso.ultimoCambio !== null ? (
        <p className="mt-0.5 text-[10.5px] text-faint">
          cambió {proceso.ultimoCambio.capturadoPor ?? '—'} ·{' '}
          {new Date(proceso.ultimoCambio.capturadoEn).toLocaleDateString('es-MX')}
        </p>
      ) : null}
    </li>
  );
}

function BotonEditar({
  testid,
  alPulsar,
}: {
  testid: string;
  alPulsar: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={alPulsar}
      className={cn(
        'inline-flex cursor-pointer items-center gap-0.5 rounded px-1 text-[10.5px] font-semibold',
        'text-primary hover:bg-primary-soft',
      )}
      data-testid={testid}
    >
      <Pencil className="size-2.5" aria-hidden />
      editar
    </button>
  );
}

/** Diálogo de captura de una referencia (deja rastro en el servidor). */
function DialogoReferencia({
  idOrden,
  folioOrden,
  edicion,
  alCerrar,
}: {
  idOrden: number;
  folioOrden: number;
  edicion: EdicionReferencia;
  alCerrar: () => void;
}): React.JSX.Element {
  const { sesion } = useSesion();
  const capturar = useCapturarReferencia();
  const [precio, setPrecio] = useState(edicion.actual === null ? '' : String(edicion.actual));
  const [nota, setNota] = useState('');
  const monto = Number(precio);
  const valido = precio.trim() !== '' && Number.isFinite(monto) && monto >= 0;

  function guardar(): void {
    if (!valido) return;
    capturar.mutate(
      { idOrden, cuerpo: edicion.cuerpo(monto, nota.trim() === '' ? null : nota.trim()) },
      {
        onSuccess: () => {
          toast.success(`Referencia actualizada · registrado por ${sesion?.nombre ?? 'la sesión'}`);
          alCerrar();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(abierto) => (abierto ? undefined : alCerrar())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {edicion.titulo} · OP {folioOrden}
          </DialogTitle>
          <DialogDescription>
            Es el tope de lo que se le paga al taller: el precio no puede pasar de esta referencia
            más 5 % sin la autorización de Daniel. El cambio queda registrado.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <Field data-invalid={!valido}>
            <FieldLabel htmlFor="referencia-precio">
              Precio de referencia por prenda ($) *
            </FieldLabel>
            <Input
              id="referencia-precio"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              data-testid="referencia-precio-input"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="referencia-nota">Por qué cambia</FieldLabel>
            <Input
              id="referencia-nota"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Opcional"
            />
          </Field>
          <p className="flex items-center gap-1.5 rounded-md bg-panel-2 px-2.5 py-1.5 text-xs text-muted-foreground">
            <Lock className="size-3 shrink-0" aria-hidden />
            Quedará registrado que lo cambió <b>{sesion?.nombre ?? 'la sesión'}</b> hoy.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={alCerrar} disabled={capturar.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={guardar}
            disabled={!valido || capturar.isPending}
            data-testid="referencia-guardar"
          >
            {capturar.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Guardar referencia
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
