import { AlertTriangle } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { HabilitacionAvio } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { StockDeAvios } from '../inventarios/stock-avios';

import {
  aviosAEnviar,
  faltantesSinExistencia,
  filasPreliminar,
  seleccionInicial,
  type FilaPreliminarAvio,
} from './preliminar-avios';

/**
 * ⭐⭐ FILA 0.220 — EL PRELIMINAR DE «TRAER AVÍOS DE LA ORDEN» (punto 07b de Daniel).
 *
 * Antes de meter nada a la nota, enseña TODOS los avíos de la receta de la orden con su clave,
 * descripción, cantidad propuesta (lo que le FALTA a la orden) y existencia en el almacén origen,
 * cada uno con su casilla. Al confirmar entran a la nota **sólo los marcados**.
 *
 *  • **Lo ya surtido no se propone**: sale «Ya surtido», desmarcado y sin poder marcarse.
 *
 *  • **Sólo se marcan los que hay.** Los que no tienen existencia se ven, deshabilitados y con
 *    «Sin existencia» — no se esconden: la receta los pide y alguien tiene que ir a comprarlos.
 *  • **Si no se sabe la existencia, se deja marcar** (misma regla de las filas 0.216 y 0.233:
 *    bloquear sería inventar un cero), pero no viene marcado solo.
 *  • **Por omisión vienen marcados los que tienen existencia**: abrir y confirmar es el mismo clic
 *    rápido de antes.
 *  • La cantidad NO se edita aquí: se edita en los renglones, que ya lo permiten.
 *
 *  • **Lo que ESTA nota ya lleva se descuenta**: si lo que falta ya va completo en sus renglones,
 *    sale «Ya en esta nota» y no se puede marcar (traer dos veces no duplica).
 *
 * Se monta cada vez que se abre (el padre lo pinta sólo con el preliminar pedido), así que la
 * selección inicial se calcula con los datos de ESE momento. Las filas, en cambio, se recalculan
 * EN VIVO con la habilitación, la existencia y los renglones que lleguen: si algo cambia con el
 * preliminar abierto, la casilla lo refleja y {@link aviosAEnviar} no deja colar lo que ya no se
 * puede mandar. Mientras la habilitación se refresca (o si su refresco falló), no se deja confirmar.
 *
 * ⚠️ No sustituye la guarda del servidor (A1): el no-negativo del avío lo sigue validando el dominio
 * al confirmar la nota.
 */
export function PreliminarAviosOrden({
  folioOrden,
  avios,
  stock,
  enNota,
  avisoDatos = null,
  alConfirmar,
  alCancelar,
}: {
  folioOrden: number;
  /** Avíos de la habilitación de la orden, EN VIVO (los extras se ignoran: no son de la receta). */
  avios: readonly HabilitacionAvio[];
  /** Existencia del almacén origen; `undefined` = no se sabe. */
  stock: StockDeAvios;
  /** Lo que ESTA nota ya lleva de cada avío para esta orden (idAvio → cantidad). */
  enNota: ReadonlyMap<number, number>;
  /**
   * Por qué los datos de la orden no son confiables AHORA (se están refrescando, o el refresco
   * falló), o `null`. Mientras haya aviso, no se deja confirmar: se mandaría con cifras viejas.
   */
  avisoDatos?: string | null;
  /**
   * Recibe los avíos MARCADOS (y que se pueden mandar) y, de la MISMA fuente, los que faltan y no
   * hay (para el aviso que sale al cerrar).
   */
  alConfirmar: (seleccionados: FilaPreliminarAvio[], sinExistencia: FilaPreliminarAvio[]) => void;
  alCancelar: () => void;
}): React.JSX.Element {
  const filas = useMemo(() => filasPreliminar(avios, stock, enNota), [avios, stock, enNota]);
  const [marcados, setMarcados] = useState<Set<number>>(() =>
    seleccionInicial(filasPreliminar(avios, stock, enNota)),
  );

  const aEnviar = useMemo(() => aviosAEnviar(filas, marcados), [filas, marcados]);
  const seleccionables = filas.filter((f) => f.seleccionable);
  // Los que faltan Y no hay: los que alguien tiene que ir a comprar (una sola fuente).
  const sinExistencia = faltantesSinExistencia(filas);
  const todosSurtidos = filas.every((f) => f.yaSurtido);
  const nadaPendiente = filas.every((f) => f.yaSurtido || f.yaEnNota);
  const todosMarcados =
    seleccionables.length > 0 && seleccionables.every((f) => marcados.has(f.idAvio));

  function marcar(idAvio: number, chk: boolean): void {
    setMarcados((prev) => {
      const sig = new Set(prev);
      if (chk) sig.add(idAvio);
      else sig.delete(idAvio);
      return sig;
    });
  }

  function marcarTodos(chk: boolean): void {
    setMarcados(chk ? new Set(seleccionables.map((f) => f.idAvio)) : new Set());
  }

  return (
    <Dialog
      open
      onOpenChange={(abierto) => {
        if (!abierto) alCancelar();
      }}
    >
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
        data-testid="preliminar-avios"
      >
        <DialogHeader>
          <DialogTitle>Avíos de la orden {folioOrden}</DialogTitle>
          <DialogDescription>
            Marca los avíos que vas a mandar. Sólo se pueden marcar los que hay en el almacén
            origen; la cantidad la ajustas después en los renglones.
          </DialogDescription>
        </DialogHeader>

        {seleccionables.length === 0 ? (
          <p
            className="rounded-md bg-crit-soft px-2.5 py-1.5 text-xs text-crit"
            role="note"
            data-testid="preliminar-nada-que-mandar"
          >
            {todosSurtidos
              ? 'La orden ya tiene surtidos todos los avíos de su receta: no hay nada que mandar.'
              : nadaPendiente
                ? 'Lo que le falta a la orden ya va en esta nota: no hay nada más que mandar.'
                : 'Ninguno de los avíos que le faltan a la orden tiene existencia en este almacén: no hay nada que mandar.'}
          </p>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="preliminar-tabla">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-2">
                  <input
                    type="checkbox"
                    aria-label="Marcar todos los que hay"
                    checked={todosMarcados}
                    disabled={seleccionables.length === 0}
                    onChange={(e) => marcarTodos(e.target.checked)}
                    data-testid="preliminar-marcar-todos"
                  />
                </th>
                <th className="py-2 pr-3">Avío</th>
                <th className="py-2 pr-3 text-right">Falta por surtir</th>
                <th className="py-2 text-right">Existencia</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <FilaPreliminar
                  key={f.idAvio}
                  fila={f}
                  marcado={f.seleccionable && marcados.has(f.idAvio)}
                  alMarcar={(chk) => marcar(f.idAvio, chk)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {sinExistencia.length > 0 && seleccionables.length > 0 ? (
          <p
            className="flex items-start gap-1.5 rounded-md border border-warn/30 bg-warn-soft p-2 text-xs text-warn"
            role="note"
            data-testid="preliminar-sin-existencia"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {`Sin existencia en este almacén (no se pueden mandar): ${sinExistencia
              .map((f) => f.clave)
              .join(', ')}.`}
          </p>
        ) : null}

        {avisoDatos !== null ? (
          <p
            className="rounded-md border border-warn/30 bg-warn-soft p-2 text-xs text-warn"
            role="note"
            data-testid="preliminar-aviso-datos"
          >
            {avisoDatos}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={alCancelar}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => alConfirmar(aEnviar, sinExistencia)}
            disabled={aEnviar.length === 0 || avisoDatos !== null}
            data-testid="preliminar-confirmar"
          >
            {aEnviar.length === 1
              ? 'Agregar 1 avío a la nota'
              : `Agregar ${String(aEnviar.length)} avíos a la nota`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FilaPreliminar({
  fila,
  marcado,
  alMarcar,
}: {
  fila: FilaPreliminarAvio;
  marcado: boolean;
  alMarcar: (chk: boolean) => void;
}): React.JSX.Element {
  const un = fila.unidad !== null ? ` ${fila.unidad}` : '';
  return (
    <tr
      className={`border-b ${marcado ? 'bg-primary-soft/40' : ''} ${fila.seleccionable ? '' : 'text-muted-foreground'}`}
      data-testid="preliminar-fila"
      data-id-avio={fila.idAvio}
    >
      <td className="py-2 pr-2">
        <input
          type="checkbox"
          aria-label={`Mandar ${fila.clave}`}
          checked={marcado}
          disabled={!fila.seleccionable}
          onChange={(e) => alMarcar(e.target.checked)}
          data-testid="preliminar-chk"
        />
      </td>
      <td className="py-2 pr-3">
        <div className="font-medium">{fila.clave}</div>
        <div className="text-xs text-muted-foreground">{fila.descripcion}</div>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums" data-testid="preliminar-cantidad">
        {fila.yaSurtido ? (
          <span className="font-medium text-ok">Ya surtido</span>
        ) : fila.yaEnNota ? (
          <span className="font-medium text-ok">Ya en esta nota</span>
        ) : (
          <>
            {fila.cantidad.toLocaleString('es-MX')}
            {un}
            {fila.enEstaNota > 0 ? (
              <div className="text-xs text-muted-foreground">
                {`${fila.enEstaNota.toLocaleString('es-MX')}${un} ya en esta nota`}
              </div>
            ) : null}
          </>
        )}
      </td>
      <td className="py-2 text-right tabular-nums" data-testid="preliminar-existencia">
        {fila.existencia === null ? (
          <span className="text-muted-foreground">No se sabe</span>
        ) : fila.existencia > 0 ? (
          <>
            {fila.existencia.toLocaleString('es-MX')}
            {un}
          </>
        ) : (
          <span className="font-semibold text-crit">Sin existencia</span>
        )}
      </td>
    </tr>
  );
}
