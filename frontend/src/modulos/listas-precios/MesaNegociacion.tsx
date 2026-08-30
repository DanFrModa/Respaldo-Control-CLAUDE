import {
  ImageOffIcon,
  Loader2Icon,
  LockIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  Trash2Icon,
  WandIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useDesgloseCostoLinea } from '@/api/listas-precios';
import {
  useGuardarMesa,
  useSimularMesa,
  type MesaCuerpo,
  type RenglonMesa,
} from '@/api/negociacion';
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
 * ⭐⭐ **EL NEGOCIADOR EN VIVO** (§Post-F9.138/.139/.144 + ⭐ V1-E8w: .149/.150/.153) — el renglón
 * *"casi como si fuera un excel"* de la mesa de negociación. Palabras de Daniel, con el cliente
 * enfrente:
 *
 * > *"Tengo que tener todos los precios en un renglon para ir moviendo en vivo e ir viendo como se va
 * > moviendo el margen si modifico cada elemento… ponle una jareta mas barata y bajame 3 pesos"*
 *
 * Se persigue en **las dos direcciones a la vez**: escribes el **precio** y sale el **margen**; mueves
 * un **costo** y se mueven el margen **y** el precio sugerido. Los campos **nacen cargados con los
 * costos de la receta**, y de ahí se mueven.
 *
 * ⭐⭐ **LO QUE V1-E8w CAMBIÓ, y por qué la forma es ésta:**
 *  1. **La tela trae DOS perillas, precio y consumo** (§Post-F9.153): *«muchas veces voy estimando el
 *     nuevo peso en lugar del costo de multiplicar el consumo por el precio de la tela. O a veces
 *     decido meter una tela mas barata, pero el consumo es el mismo.»* El **producto lo hace el
 *     servidor** — un multiplicador que decide un precio es aritmética de negocio (A1).
 *  2. **Los avíos se abren DESGLOSADOS y se mueven ahí**: *«no solo el total, por que no se bien de
 *     que elementos se compone.»* El panel de avíos ya no trae sólo los estimados: trae **los avíos
 *     de la receta**, uno por uno.
 *  3. **La FOTO principal del modelo, a la vista**: *«Me gustaria ir viendo la foto del modelo.»*
 *  4. **El TARGET del cliente** (§Post-F9.150), si nos lo dio. **INFORMA, NO BLOQUEA.**
 *  5. **Los estimados SE GUARDAN** (§Post-F9.149): un botón explícito, al terminar. *«Voy jugando y
 *     al terminar la negociación guardo la última información que metí.»* **NO** hay autosave.
 *
 * 🔴 **SEGUIR JUGANDO NO ESCRIBE NADA** (§Post-F9.139): ni catálogo, ni receta, ni precosto, ni el
 * renglón. Lo único que escribe es el botón «Guardar la mesa», y lo que deja es una CONSTANCIA
 * inmutable en el hilo del renglón — no una decisión.
 *
 * 🔴 **CERO ARITMÉTICA AQUÍ** (A1). Importe de cada renglón, subtotal por concepto, costo total,
 * margen, precio sugerido y veredicto del target: **todos vienen del servidor**. La pantalla sólo
 * pinta lo que recibe.
 *
 * ⭐ **Sin `listas.aprobar` no se pinta el margen** (§Post-F9.125(b), ratificado el 29-ago-2026:
 * *«Nadie mas que yo ve los factores por favor….»*). El renglón de costos se sigue jugando —es
 * trabajo de quien negocia— y los costos se siguen viendo; el veredicto del sistema es del dueño.
 */

/** Un renglón editable de la mesa: los textos del input, sin convertir (input controlado). */
interface RenglonEditable {
  /** Clave estable para React (el id del renglón del precosto, o un consecutivo para los estimados). */
  clave: string;
  conceptoCodigo: string;
  conceptoNombre: string;
  etiqueta: string;
  /** Texto del input de consumo, o `null` cuando este costo va "a secas" (no lleva consumo). */
  consumo: string | null;
  /** Texto del input de precio unitario. */
  precioUnit: string;
}

/**
 * Con qué se manda un renglón al que le borraron el nombre. El contrato pide etiqueta no vacía, y el
 * importe **tiene que seguir contando**: es el dato, el nombre es sólo para acordarse.
 */
const ETIQUETA_DE_RESPALDO = 'Estimado sin nombre';

/** Concepto al que entran los avíos estimados que se agregan en la mesa. */
const CONCEPTO_AVIOS = { codigo: 'avios', nombre: 'Avíos' };

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
  codigoModelo,
}: {
  idLinea: number;
  /** Precio de partida: el aprobado del renglón, o el calculado (lo que hoy vale ese modelo). */
  precioInicial: number | null;
  /** Código del modelo, para rotular la foto sin esperar al desglose. */
  codigoModelo: string;
}): React.JSX.Element {
  const desglose = useDesgloseCostoLinea(idLinea);
  const guardar = useGuardarMesa();
  const { tienePermiso } = useSesion();
  // §Post-F9.125(b): el margen y los factores son del dueño. El resto de la mesa es de quien negocia.
  const verMargen = tienePermiso('listas.aprobar');

  const [renglones, setRenglones] = useState<RenglonEditable[]>([]);
  const [precio, setPrecio] = useState(precioInicial === null ? '' : String(precioInicial));
  const [aviosAbierto, setAviosAbierto] = useState(false);
  const [guardarAbierto, setGuardarAbierto] = useState(false);
  const [siguienteId, setSiguienteId] = useState(1);
  /** De qué renglón ya se sembró la mesa (para NO pisar lo que se está jugando en cada render). */
  const [sembradoDe, setSembradoDe] = useState<number | null>(null);

  const grupos = desglose.data?.grupos;

  /**
   * La semilla: **un campo por RENGLÓN de la receta**, no por concepto. Hasta la 0.059 se sembraba
   * el subtotal agrupado y por eso Daniel no podía mover ni el consumo de la tela ni un avío suelto:
   * el detalle existía en el precosto y la mesa nunca lo veía. Ahora el desglose lo trae (V1-E8w).
   */
  const semilla = useCallback(
    (): RenglonEditable[] =>
      (grupos ?? []).flatMap((g) =>
        g.lineas.map((l) => ({
          clave: `linea:${String(l.id)}`,
          conceptoCodigo: g.codigo,
          conceptoNombre: g.nombre,
          etiqueta: l.descripcion,
          consumo: l.consumo === null ? null : String(l.consumo),
          precioUnit: l.precioUnit === null ? '' : String(l.precioUnit),
        })),
      ),
    [grupos],
  );

  // Los campos NACEN cargados con los costos de la receta (§Post-F9.138 punto 4).
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

  function cambiarCampo(clave: string, campo: 'consumo' | 'precioUnit', valor: string): void {
    setRenglones((actual) => actual.map((r) => (r.clave === clave ? { ...r, [campo]: valor } : r)));
  }

  function agregarEstimado(): void {
    const clave = `estimado:${String(siguienteId)}`;
    setSiguienteId((n) => n + 1);
    setRenglones((actual) => [
      ...actual,
      {
        clave,
        conceptoCodigo: CONCEPTO_AVIOS.codigo,
        conceptoNombre: CONCEPTO_AVIOS.nombre,
        etiqueta: 'Avío estimado',
        consumo: null,
        precioUnit: '',
      },
    ]);
  }

  function quitar(clave: string): void {
    setRenglones((actual) => actual.filter((r) => r.clave !== clave));
  }

  function renombrar(clave: string, etiqueta: string): void {
    setRenglones((actual) => actual.map((r) => (r.clave === clave ? { ...r, etiqueta } : r)));
  }

  // Los renglones tal como viajan al servidor. Se debouncean ENTEROS para no golpear el backend en
  // cada tecla; el hook conserva el resultado anterior mientras llega el nuevo, así el margen no
  // parpadea.
  //
  // 🔴 **Una etiqueta vacía NO saca al renglón de la cuenta: se le pone una de respaldo.** El contrato
  // exige etiqueta no vacía (`esquemaRenglonMesa`), así que mandarla en blanco sería un 400 y el margen
  // desaparecería de la pantalla — pero **filtrar el renglón era peor**: borrar la etiqueta para
  // reescribirla dejaba su importe **visible en su celda y fuera del total**, bajando el costo sin un
  // solo aviso. El nombre es sólo para acordarse; **el importe es el dato, y el importe siempre cuenta.**
  const renglonesApi = useMemo(
    (): RenglonMesa[] =>
      renglones.map((r) => ({
        conceptoCodigo: r.conceptoCodigo,
        conceptoNombre: r.conceptoNombre,
        etiqueta: r.etiqueta.trim() === '' ? ETIQUETA_DE_RESPALDO : r.etiqueta.trim(),
        consumo: r.consumo === null ? null : aNumero(r.consumo),
        precioUnit: aNumero(r.precioUnit),
      })),
    [renglones],
  );
  const cuerpo: MesaCuerpo = useMemo(
    () => ({ renglones: renglonesApi, precioObjetivo: aNumero(precio) }),
    [renglonesApi, precio],
  );
  const cuerpoDebounced = useDebounce(cuerpo, 300);
  // ⭐ V1-E8w: se pide SIEMPRE, tenga o no `listas.aprobar` — el servidor ya oculta los cinco campos
  // derivados de los factores y devuelve el resto. Antes se gateaba la consulta entera con
  // `verMargen`, y por eso la pantalla tenía que sumar por su cuenta para enseñarle algo a quien
  // negocia. Con el costo partido en consumo × precio, esa suma local habría tenido que MULTIPLICAR.
  const mesa = useSimularMesa(idLinea, cuerpoDebounced, {
    habilitado: cuerpoDebounced.renglones.length > 0,
  });

  const datos = mesa.data;
  /** Importe resuelto por el SERVIDOR de cada renglón, por posición (misma orden que se mandó). */
  const importePorClave = useMemo(() => {
    const mapa = new Map<string, number>();
    // Sólo empata si el largo coincide: mientras el rebote no ha viajado, la respuesta anterior
    // puede tener otro número de renglones y casar por índice pintaría el importe del vecino.
    if (datos !== undefined && datos.renglones.length === renglones.length) {
      renglones.forEach((r, i) => {
        const importe = datos.renglones[i]?.importe;
        if (importe !== undefined) mapa.set(r.clave, importe);
      });
    }
    return mapa;
  }, [datos, renglones]);
  const aviosEnMesa = renglones.filter((r) => r.conceptoCodigo === CONCEPTO_AVIOS.codigo);
  /**
   * 🔴 **TRES estados, no dos: «cumple» · «debajo» · «todavía no sé».** `?? false` colapsaba el tercero
   * en el segundo, y el veredicto se pintaba **rojo y en «Debajo» antes de que el servidor contestara**
   * (300 ms de rebote + ida y vuelta, más si la red va lenta). El número era honesto —«—»— pero el
   * badge y el color mentían, en el widget exacto sobre el que se decide un precio con el cliente
   * enfrente. `null` = no hay dato todavía ⇒ el badge no aparece y el margen va en color neutro.
   */
  const cumple: boolean | null = datos?.cumpleObjetivo ?? null;

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* ⭐ V1-E8w: LA FOTO. *«Me gustaria ir viendo la foto del modelo. La principal.»* */}
        <div className="flex min-w-0 items-start gap-3">
          <FotoModelo url={desglose.data?.urlFotoModelo ?? null} codigoModelo={codigoModelo} />
          <div className="min-w-0">
            <p className="text-sm font-medium">Mesa · costos y precio en vivo</p>
            <p className="text-xs text-muted-foreground">
              Los campos vienen con los costos de la receta. Muévelos y el margen se mueve solo.{' '}
              <b>Nada de lo que teclees aquí cambia la receta.</b> Al terminar, guárdala.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAviosAbierto(true)}
            data-testid="abrir-avios-mesa"
          >
            <WandIcon aria-hidden />
            Avíos ({aviosEnMesa.length})
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
          {/* ⭐⭐ §Post-F9.149: guardado EXPLÍCITO, al terminar. NUNCA automático. */}
          <Button
            type="button"
            size="sm"
            onClick={() => setGuardarAbierto(true)}
            data-testid="abrir-guardar-mesa"
          >
            <SaveIcon aria-hidden />
            Guardar la mesa
          </Button>
        </div>
      </div>

      {/* EL RENGLÓN: todos los elementos a la vez, editables en el sitio (§Post-F9.138 punto 2). */}
      <div className="overflow-x-auto">
        <div className="flex min-w-max items-end gap-2" data-testid="renglon-mesa">
          {renglones.map((r) => (
            <div key={r.clave} className="w-32 shrink-0" data-testid="celda-mesa">
              <span
                className="block truncate text-xs text-muted-foreground"
                title={`${r.conceptoNombre} · ${r.etiqueta}`}
                data-testid="celda-etiqueta"
              >
                {r.etiqueta}
              </span>
              {/* ⭐ La perilla del CONSUMO, sólo donde la hay (tela y avíos por medida). */}
              {r.consumo === null ? null : (
                <Input
                  type="number"
                  step="0.0001"
                  min="0"
                  inputMode="decimal"
                  className="mb-1 tabular-nums"
                  value={r.consumo}
                  onChange={(e) => cambiarCampo(r.clave, 'consumo', e.target.value)}
                  aria-label={`Consumo de ${r.etiqueta}`}
                  data-testid={`celda-consumo-${r.clave}`}
                />
              )}
              <Input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                className="tabular-nums"
                value={r.precioUnit}
                onChange={(e) => cambiarCampo(r.clave, 'precioUnit', e.target.value)}
                aria-label={r.consumo === null ? r.etiqueta : `Precio de ${r.etiqueta}`}
                data-testid={`celda-costo-${r.clave}`}
              />
              {/* El importe lo calcula el SERVIDOR (consumo × precio): aquí sólo se pinta. */}
              <span
                className="block text-right text-[11px] tabular-nums text-muted-foreground"
                data-testid={`celda-importe-${r.clave}`}
              >
                {formatearMoneda(importePorClave.get(r.clave) ?? null)}
              </span>
            </div>
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
            {/* ⭐ §Post-F9.150: el TARGET del cliente, pegado al precio — que es contra lo que se
                compara. INFORMA, NO BLOQUEA: dice cómo va, y no impide nada. */}
            {datos?.precioTarget === null || datos?.precioTarget === undefined ? null : (
              <span
                className="mt-0.5 block text-[11px] text-muted-foreground"
                data-testid="mesa-target"
              >
                target <b className="tabular-nums">{formatearMoneda(datos.precioTarget)}</b>{' '}
                {datos.cumpleTarget === null ? null : (
                  <Badge
                    variant={datos.cumpleTarget ? 'default' : 'destructive'}
                    data-testid="mesa-badge-target"
                    data-cumple-target={datos.cumpleTarget}
                  >
                    {datos.cumpleTarget ? 'llega' : 'no llega'}
                  </Badge>
                )}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* SUBTOTALES por concepto — los suma el SERVIDOR (nunca la pantalla). */}
      {datos === undefined ? null : (
        <div
          className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground"
          data-testid="mesa-subtotales"
        >
          {datos.grupos.map((g) => (
            <span key={g.codigo} data-testid={`mesa-subtotal-${g.codigo}`}>
              {g.nombre}: <b className="tabular-nums">{formatearMoneda(g.subtotal)}</b>
            </span>
          ))}
        </div>
      )}

      {/* EL VEREDICTO: costo simulado + delta + margen + precio sugerido (las dos direcciones). */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-5">
        <Dato
          etiqueta="Costo receta"
          valor={formatearMoneda(datos?.costoVigente ?? null)}
          testid="mesa-costo-vigente"
        />
        <Dato
          etiqueta="Costo mesa"
          valor={formatearMoneda(datos?.costoSimulado ?? null)}
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
        {verMargen ? (
          <>
            <div>
              <span className="block text-xs text-muted-foreground">Margen</span>
              <span
                className={`font-semibold tabular-nums ${
                  cumple === null
                    ? 'text-muted-foreground'
                    : cumple
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
              {/* Sin dato NO se emite veredicto: un badge que dice «Debajo» sin saberlo es peor que
                  ningún badge (ver el comentario de `cumple`). */}
              {cumple === null ? null : (
                <Badge
                  variant={cumple ? 'default' : 'destructive'}
                  className="mt-0.5"
                  data-testid="mesa-badge"
                  data-cumple={cumple}
                >
                  {cumple ? 'Cumple' : 'Debajo'}
                </Badge>
              )}
            </div>
          </>
        ) : (
          <p className="col-span-2 flex items-start gap-1.5 text-[12px] text-muted-foreground">
            <LockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              El <b>margen</b> y los factores del precio son facultad del <b>dueño</b>: aquí se
              juega con los costos, pero el veredicto no se muestra.
            </span>
          </p>
        )}
      </div>

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
        avios={aviosEnMesa}
        importePorClave={importePorClave}
        alAgregar={agregarEstimado}
        alQuitar={quitar}
        alRenombrar={renombrar}
        alCambiarCampo={cambiarCampo}
      />

      <DialogoGuardarMesa
        abierto={guardarAbierto}
        alCambiarAbierto={setGuardarAbierto}
        costoMesa={datos?.costoSimulado ?? null}
        cantidadRenglones={renglonesApi.length}
        guardando={guardar.isPending}
        alGuardar={(acuerdo) => {
          guardar.mutate(
            {
              idLinea,
              cuerpo: { acuerdo, renglones: renglonesApi, precioObjetivo: aNumero(precio) },
            },
            {
              onSuccess: () => {
                toast.success('Mesa guardada: los costos estimados quedaron en el historial.');
                setGuardarAbierto(false);
              },
              onError: (error) => toast.error(error.message),
            },
          );
        }}
      />
    </div>
  );
}

/**
 * ⭐ V1-E8w — LA FOTO PRINCIPAL del modelo. Daniel: *«Me gustaria ir viendo la foto del modelo. La
 * principal.»* Un modelo sin fotos NO deja un hueco ni un icono roto: se dice que no tiene, porque
 * en una cita "no hay foto" es un dato (hay que conseguirla), no un fallo de la pantalla.
 */
function FotoModelo({
  url,
  codigoModelo,
}: {
  url: string | null;
  codigoModelo: string;
}): React.JSX.Element {
  if (url === null) {
    return (
      <div
        className="flex size-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed text-[10px] text-muted-foreground"
        data-testid="mesa-sin-foto"
      >
        <ImageOffIcon className="size-4" aria-hidden />
        sin foto
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={`Foto principal de ${codigoModelo}`}
      className="size-16 shrink-0 rounded-md border object-cover"
      data-testid="mesa-foto-modelo"
    />
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
 * ⭐ **LOS AVÍOS, DESGLOSADOS** (§Post-F9.138 punto 3 + V1-E8w). Daniel concedió que los avíos
 * salieran a otra pantalla —*"posiblemente el unico campo que si puedo pasar a otra pantalla para
 * quitar y poner o mover, sean los avios"*— y después pidió lo que le faltaba:
 *
 * > *«Para los avios, me gustaria poder abrir el desglose de los costos de los avios y poder mover los
 * > costos ahi. Desglosados… no solo el total, por que no se bien de que elementos se compone.»*
 *
 * Por eso este panel ya **no lista sólo los estimados**: lista **todos los avíos de la mesa**, los de
 * la receta incluidos, cada uno con su importe. Se abre ENCIMA (no saca de la pantalla ni pierde el
 * renglón) y lo que se mueve aquí se suma al instante allá.
 *
 * 🔴 Los que se AGREGAN son **estimados**: etiqueta libre + precio libre. **No se da de alta ningún
 * avío** — *"no esta dado de alta en el catalogo. No puedo ponerme a dar de alta una jareta ahi, que
 * ni certeza tengo de cuanto cuesta"* (§Post-F9.139). Buscar el avío de verdad es trabajo de la
 * oficina, después y de otra persona (§Post-F9.144(a)).
 */
function PanelAviosMesa({
  abierto,
  alCambiarAbierto,
  avios,
  importePorClave,
  alAgregar,
  alQuitar,
  alRenombrar,
  alCambiarCampo,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  avios: RenglonEditable[];
  importePorClave: ReadonlyMap<string, number>;
  alAgregar: () => void;
  alQuitar: (clave: string) => void;
  alRenombrar: (clave: string, etiqueta: string) => void;
  alCambiarCampo: (clave: string, campo: 'consumo' | 'precioUnit', valor: string) => void;
}): React.JSX.Element {
  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Avíos de la mesa</DialogTitle>
          <DialogDescription>
            Aquí están <b>desglosados</b> los avíos de la receta y los que agregues como estimados.
            Mueve sus costos y el margen se mueve allá. No se da de alta nada en el catálogo.
          </DialogDescription>
        </DialogHeader>

        <div
          className="max-h-[55vh] space-y-2 overflow-y-auto py-2 pr-1"
          data-testid="panel-avios-mesa"
        >
          {avios.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="avios-vacio">
              Esta receta no trae avíos, y todavía no hay ninguno estimado.
            </p>
          ) : (
            avios.map((r) => (
              <div key={r.clave} className="flex items-center gap-2" data-testid="fila-avio-mesa">
                <Input
                  value={r.etiqueta}
                  onChange={(e) => alRenombrar(r.clave, e.target.value)}
                  aria-label={`Qué avío es (${r.etiqueta})`}
                  data-testid={`avio-etiqueta-${r.clave}`}
                />
                {r.consumo === null ? null : (
                  <Input
                    type="number"
                    step="0.0001"
                    min="0"
                    inputMode="decimal"
                    className="w-20 shrink-0 tabular-nums"
                    value={r.consumo}
                    onChange={(e) => alCambiarCampo(r.clave, 'consumo', e.target.value)}
                    aria-label={`Consumo de ${r.etiqueta}`}
                    data-testid={`avio-consumo-${r.clave}`}
                  />
                )}
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  className="w-24 shrink-0 tabular-nums"
                  value={r.precioUnit}
                  onChange={(e) => alCambiarCampo(r.clave, 'precioUnit', e.target.value)}
                  aria-label={`Costo estimado de ${r.etiqueta}`}
                  data-testid={`avio-importe-${r.clave}`}
                />
                <span
                  className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground"
                  data-testid={`avio-total-${r.clave}`}
                >
                  {formatearMoneda(importePorClave.get(r.clave) ?? null)}
                </span>
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

/**
 * ⭐⭐ **GUARDAR LA MESA** (§Post-F9.149). Daniel: *«Estos son indispensables que se queden. Fue con
 * la información que vendí… Entre los costos que fui dando u los comentarios que voy metiendo es como
 * se va a armar la nueva receta.»*
 *
 * 🔴 Es un guardado **EXPLÍCITO y del ÚLTIMO estado**: *«Voy jugando y al terminar la negociación
 * guardo la última información que metí»*. No hay autosave por tecla ni rastro de los tanteos.
 * El comentario es obligatorio porque **los números sin la frase que los explica no cuentan la
 * negociación**, y son las dos cosas que Daniel nombró juntas.
 */
function DialogoGuardarMesa({
  abierto,
  alCambiarAbierto,
  costoMesa,
  cantidadRenglones,
  guardando,
  alGuardar,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  costoMesa: number | null;
  cantidadRenglones: number;
  guardando: boolean;
  alGuardar: (acuerdo: string) => void;
}): React.JSX.Element {
  const [acuerdo, setAcuerdo] = useState('');

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Guardar la mesa</DialogTitle>
          <DialogDescription>
            Queda constancia de <b>con qué vendiste</b>: los {cantidadRenglones} costos como están
            ahora mismo, con su comentario, en el historial del renglón. No cambia la receta ni el
            precio aprobado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2" data-testid="form-guardar-mesa">
          <p className="text-sm">
            Costo de la mesa:{' '}
            <b className="tabular-nums" data-testid="guardar-costo-mesa">
              {formatearMoneda(costoMesa)}
            </b>
          </p>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Qué quedó / qué se acordó</span>
            <textarea
              rows={3}
              className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
              value={acuerdo}
              onChange={(e) => setAcuerdo(e.target.value)}
              data-testid="guardar-mesa-acuerdo"
            />
          </label>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={guardando}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={guardando}
            onClick={() => {
              if (acuerdo.trim() === '') {
                toast.error(
                  'Escribe qué quedó: los costos sin la frase que los explica no cuentan la negociación.',
                );
                return;
              }
              alGuardar(acuerdo.trim());
            }}
            data-testid="confirmar-guardar-mesa"
          >
            {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Guardar la mesa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
