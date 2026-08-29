import { LockIcon, Loader2Icon, PlusIcon, RotateCcwIcon, Trash2Icon, WandIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useDesgloseCostoLinea } from '@/api/listas-precios';
import { useSimularMesa, type MesaCuerpo, type RenglonMesa } from '@/api/negociacion';
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
import { Input } from '@/components/ui/input';
import { formatearMoneda } from '@/lib/formato';
import { useDebounce } from '@/lib/useDebounce';
import { useSesion } from '@/sesion/useSesion';

/**
 * ⭐⭐ **EL NEGOCIADOR EN VIVO** (§Post-F9.138/.139/.144) — el renglón *"casi como si fuera un excel"*
 * de la mesa de negociación. Palabras de Daniel, con el cliente enfrente:
 *
 * > *"Tengo que tener todos los precios en un renglon para ir moviendo en vivo e ir viendo como se va
 * > moviendo el margen si modifico cada elemento… ponle una jareta mas barata y bajame 3 pesos"*
 *
 * Se persigue en **las dos direcciones a la vez**: escribes el **precio** y sale el **margen**; mueves
 * un **costo** y se mueven el margen **y** el precio sugerido. Los campos **nacen cargados con los
 * costos de la receta** (el desglose por concepto que el servidor ya calcula, §4.8), y de ahí se
 * mueven.
 *
 * 🔴 **NO ESCRIBE NADA** (§Post-F9.139): ni catálogo, ni receta, ni precosto, ni el renglón. Todo lo
 * que se teclea aquí es estado LOCAL de la pantalla; lo único que viaja al servidor es una **lectura**
 * (un POST sin efectos) para que la fórmula del margen siga viviendo en el dominio (A1) y no se
 * duplique aquí. Lo que se teclea son **METAS**, no datos (§Post-F9.144(b)): *"esa es mi estimacion en
 * ese momento… no es seguro que se consiga"*.
 *
 * 🔴 **NINGÚN botón saca de la pantalla.** La ÚNICA excepción es la que Daniel concedió —los **avíos**
 * (*"quitar y poner o mover"*)—, y vive en un panel que se abre encima, sin perder el hilo ni el
 * renglón.
 *
 * ⭐ **Sin `listas.aprobar` no se pide ni se pinta el margen** (§Post-F9.125(b), ratificado el
 * 29-ago-2026: *«Nadie mas que yo ve los factores por favor….»*). El renglón de costos se sigue
 * jugando —es trabajo de quien negocia—, pero el veredicto del sistema es del dueño.
 */

/** Un renglón editable de la mesa: etiqueta libre + importe como TEXTO (input controlado). */
interface RenglonEditable {
  /** Clave estable para React (el concepto de origen, o un consecutivo para los estimados). */
  clave: string;
  etiqueta: string;
  /** Texto del input; se convierte a número sólo al armar el cuerpo. */
  importe: string;
  /** ¿Nació de la receta (concepto del precosto) o lo agregó la mesa como estimado? */
  esEstimado: boolean;
}

/** Texto → número (vacío o basura = 0: en la mesa un campo en blanco es "no cuesta nada todavía"). */
function aNumero(texto: string): number {
  const n = Number(texto);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Formatea un porcentaje con un decimal, o "—" si el servidor lo ocultó. */
function pct(valor: number | null | undefined): string {
  return valor === null || valor === undefined ? '—' : `${valor.toFixed(1)}%`;
}

export function MesaNegociacion({
  idLinea,
  precioInicial,
}: {
  idLinea: number;
  /** Precio de partida: el aprobado del renglón, o el calculado (lo que hoy vale ese modelo). */
  precioInicial: number | null;
}): React.JSX.Element {
  const desglose = useDesgloseCostoLinea(idLinea);
  const { tienePermiso } = useSesion();
  // §Post-F9.125(b): el margen y los factores son del dueño. Sin el permiso NO se consulta siquiera.
  const verMargen = tienePermiso('listas.aprobar');

  const [renglones, setRenglones] = useState<RenglonEditable[]>([]);
  const [precio, setPrecio] = useState(precioInicial === null ? '' : String(precioInicial));
  const [aviosAbierto, setAviosAbierto] = useState(false);
  const [siguienteId, setSiguienteId] = useState(1);
  /** De qué renglón ya se sembró la mesa (para NO pisar lo que se está jugando en cada render). */
  const [sembradoDe, setSembradoDe] = useState<number | null>(null);

  const grupos = desglose.data?.grupos;

  /** La semilla: un campo por concepto del precosto, con su subtotal ya sumado por el servidor. */
  const semilla = useCallback(
    (): RenglonEditable[] =>
      (grupos ?? []).map((g) => ({
        clave: `concepto:${g.codigo}`,
        etiqueta: g.nombre,
        importe: g.subtotal === null ? '' : String(g.subtotal),
        esEstimado: false,
      })),
    [grupos],
  );

  // Los campos NACEN cargados con los costos de la receta (§Post-F9.138 punto 4). El desglose por
  // concepto lo suma el SERVIDOR (§4.8); aquí sólo se copia a los inputs.
  //
  // ⚠️ **Se siembra UNA sola vez por renglón, y el guard NO es un adorno**: sin él, cualquier render
  // que traiga un `data` con identidad nueva volvería a sembrar — borrando de un golpe lo que Daniel
  // acaba de teclear con el cliente enfrente, y realimentándose a sí mismo (setState → render →
  // setState). En la mesa, perder los números es perder la negociación.
  useEffect(() => {
    if (grupos === undefined || sembradoDe === idLinea) return;
    setRenglones(semilla());
    setSembradoDe(idLinea);
  }, [grupos, idLinea, sembradoDe, semilla]);

  function restablecer(): void {
    setRenglones(semilla());
    setPrecio(precioInicial === null ? '' : String(precioInicial));
  }

  function cambiarImporte(clave: string, valor: string): void {
    setRenglones((actual) => actual.map((r) => (r.clave === clave ? { ...r, importe: valor } : r)));
  }

  function agregarEstimado(): void {
    const clave = `estimado:${String(siguienteId)}`;
    setSiguienteId((n) => n + 1);
    setRenglones((actual) => [
      ...actual,
      { clave, etiqueta: 'Avío estimado', importe: '', esEstimado: true },
    ]);
  }

  function quitar(clave: string): void {
    setRenglones((actual) => actual.filter((r) => r.clave !== clave));
  }

  function renombrar(clave: string, etiqueta: string): void {
    setRenglones((actual) => actual.map((r) => (r.clave === clave ? { ...r, etiqueta } : r)));
  }

  // Cuerpo que viaja: etiquetas + importes LIBRES (§Post-F9.139: ningún id de catálogo). Se debouncea
  // ENTERO para no golpear el backend en cada tecla; el hook conserva el resultado anterior mientras
  // llega el nuevo, así el margen no parpadea.
  const cuerpo: MesaCuerpo = useMemo(
    () => ({
      renglones: renglones
        .filter((r) => r.etiqueta.trim() !== '')
        .map((r): RenglonMesa => ({ etiqueta: r.etiqueta.trim(), importe: aNumero(r.importe) })),
      precioObjetivo: aNumero(precio),
    }),
    [renglones, precio],
  );
  const cuerpoDebounced = useDebounce(cuerpo, 300);
  const mesa = useSimularMesa(idLinea, cuerpoDebounced, {
    habilitado: verMargen && cuerpoDebounced.renglones.length > 0,
  });

  const datos = mesa.data;
  const estimados = renglones.filter((r) => r.esEstimado);
  // Total local: lo que el usuario ve sumado mientras el servidor contesta (el número que MANDA es el
  // del servidor, `costoSimulado`; éste sólo evita un hueco cuando el margen está apagado).
  const totalLocal = cuerpo.renglones.reduce((suma, r) => suma + r.importe, 0);
  const cumple = datos?.cumpleObjetivo ?? false;

  if (desglose.isPending) {
    return <p className="text-sm text-muted-foreground">Cargando los costos de la receta…</p>;
  }
  if (desglose.isError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {desglose.error.message}
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3" data-testid="mesa-negociacion">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Mesa · costos y precio en vivo</p>
          <p className="text-xs text-muted-foreground">
            Los campos vienen con los costos de la receta. Muévelos y el margen se mueve solo.{' '}
            <b>Nada de lo que teclees aquí se guarda ni cambia la receta.</b>
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAviosAbierto(true)}
            data-testid="abrir-avios-mesa"
          >
            <WandIcon aria-hidden />
            Avíos ({estimados.length})
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={restablecer}
            data-testid="restablecer-mesa"
          >
            <RotateCcwIcon aria-hidden />
            Restablecer
          </Button>
        </div>
      </div>

      {/* EL RENGLÓN: todos los elementos a la vez, editables en el sitio (§Post-F9.138 punto 2). */}
      <div className="overflow-x-auto">
        <div className="flex min-w-max items-end gap-2" data-testid="renglon-mesa">
          {renglones.map((r) => (
            <label key={r.clave} className="block w-28 shrink-0">
              <span
                className="block truncate text-xs text-muted-foreground"
                title={r.etiqueta}
                data-testid="celda-etiqueta"
              >
                {r.etiqueta}
              </span>
              <Input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                className="tabular-nums"
                value={r.importe}
                onChange={(e) => cambiarImporte(r.clave, e.target.value)}
                aria-label={r.etiqueta}
                data-testid={`celda-costo-${r.clave}`}
              />
            </label>
          ))}

          <div className="w-32 shrink-0 border-l pl-2">
            <span className="block text-xs font-medium">Precio</span>
            <Input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              className="tabular-nums"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              aria-label="Precio de la mesa"
              data-testid="celda-precio"
            />
          </div>
        </div>
      </div>

      {/* EL VEREDICTO: costo simulado + delta + margen + precio sugerido (las dos direcciones). */}
      {!verMargen ? (
        <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
          <LockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            El <b>margen</b> y los factores del precio son facultad del <b>dueño</b>: aquí se juega
            con los costos, pero el veredicto no se muestra. Costo de la mesa:{' '}
            <b className="tabular-nums">{formatearMoneda(totalLocal)}</b>.
          </span>
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-5">
          <Dato
            etiqueta="Costo receta"
            valor={formatearMoneda(datos?.costoVigente ?? null)}
            testid="mesa-costo-vigente"
          />
          <Dato
            etiqueta="Costo mesa"
            valor={formatearMoneda(datos?.costoSimulado ?? totalLocal)}
            testid="mesa-costo-simulado"
          />
          <Dato
            etiqueta="Movimiento"
            valor={
              datos === undefined
                ? '—'
                : `${datos.deltaCosto > 0 ? '+' : ''}${formatearMoneda(datos.deltaCosto)}`
            }
            testid="mesa-delta"
          />
          <div>
            <span className="block text-xs text-muted-foreground">Margen</span>
            <span
              className={`font-semibold tabular-nums ${
                cumple
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-destructive dark:text-destructive'
              }`}
              data-testid="mesa-margen"
            >
              {pct(datos?.margenBrutoPct)}
            </span>
            <span className="block text-[11px] text-muted-foreground">
              obj. {pct(datos?.margenObjetivoPct)}
            </span>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground">Precio sugerido</span>
            <span className="font-semibold tabular-nums" data-testid="mesa-precio-sugerido">
              {formatearMoneda(datos?.precioSugerido ?? null)}
            </span>
            <Badge
              variant={cumple ? 'default' : 'destructive'}
              className="mt-0.5"
              data-testid="mesa-badge"
              data-cumple={cumple}
            >
              {cumple ? 'Cumple' : 'Debajo'}
            </Badge>
          </div>
        </div>
      )}

      {mesa.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {mesa.error.message}
        </p>
      ) : null}
      {mesa.isFetching ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
          Recalculando…
        </p>
      ) : null}

      <PanelAviosMesa
        abierto={aviosAbierto}
        alCambiarAbierto={setAviosAbierto}
        estimados={estimados}
        alAgregar={agregarEstimado}
        alQuitar={quitar}
        alRenombrar={renombrar}
        alCambiarImporte={cambiarImporte}
      />
    </div>
  );
}

/** Un número con etiqueta chica. */
function Dato({
  etiqueta,
  valor,
  testid,
}: {
  etiqueta: string;
  valor: string;
  testid: string;
}): React.JSX.Element {
  return (
    <div>
      <span className="block text-xs text-muted-foreground">{etiqueta}</span>
      <span className="font-medium tabular-nums" data-testid={testid}>
        {valor}
      </span>
    </div>
  );
}

/**
 * ⭐ **LA ÚNICA EXCEPCIÓN QUE DANIEL CONCEDIÓ** (§Post-F9.138 punto 3): *"posiblemente el unico campo
 * que si puedo pasar a otra pantalla para quitar y poner o mover, sean los avios"*. Se abre ENCIMA de
 * la mesa (no saca de la pantalla ni pierde el renglón) y lo que se mueve aquí se suma al instante
 * allá.
 *
 * 🔴 Son **estimados**: etiqueta libre + importe libre. **No se da de alta ningún avío** — el propio
 * Daniel: *"no esta dado de alta en el catalogo. No puedo ponerme a dar de alta una jareta ahi, que ni
 * certeza tengo de cuanto cuesta"* (§Post-F9.139). Buscar el avío de verdad es trabajo de la oficina,
 * después y de otra persona (§Post-F9.144(a)).
 */
function PanelAviosMesa({
  abierto,
  alCambiarAbierto,
  estimados,
  alAgregar,
  alQuitar,
  alRenombrar,
  alCambiarImporte,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  estimados: RenglonEditable[];
  alAgregar: () => void;
  alQuitar: (clave: string) => void;
  alRenombrar: (clave: string, etiqueta: string) => void;
  alCambiarImporte: (clave: string, valor: string) => void;
}): React.JSX.Element {
  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Avíos de la mesa (estimados)</DialogTitle>
          <DialogDescription>
            Quita, pon o mueve avíos con precios <b>estimados</b>. No se da de alta nada en el
            catálogo: son metas para cuadrar después en la oficina.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2" data-testid="panel-avios-mesa">
          {estimados.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="avios-vacio">
              Todavía no hay avíos estimados en esta mesa.
            </p>
          ) : (
            estimados.map((r) => (
              <div key={r.clave} className="flex items-center gap-2" data-testid="fila-avio-mesa">
                <Input
                  value={r.etiqueta}
                  onChange={(e) => alRenombrar(r.clave, e.target.value)}
                  aria-label="Qué avío es"
                  data-testid={`avio-etiqueta-${r.clave}`}
                />
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  className="w-28 shrink-0 tabular-nums"
                  value={r.importe}
                  onChange={(e) => alCambiarImporte(r.clave, e.target.value)}
                  aria-label="Costo estimado"
                  data-testid={`avio-importe-${r.clave}`}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => alQuitar(r.clave)}
                  aria-label={`Quitar ${r.etiqueta}`}
                  data-testid={`quitar-avio-${r.clave}`}
                >
                  <Trash2Icon aria-hidden />
                </Button>
              </div>
            ))
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={alAgregar}
            data-testid="agregar-avio-mesa"
          >
            <PlusIcon aria-hidden />
            Agregar avío estimado
          </Button>
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => alCambiarAbierto(false)}>
            Volver a la mesa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
