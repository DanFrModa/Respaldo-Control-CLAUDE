import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2Icon,
  LockOpen,
  Pencil,
  RotateCcw,
  Undo2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  useAgregarRenglonReceta,
  useEditarRenglonReceta,
  useLiberarReceta,
  useMarcarRecetaRevisada,
  useQuitarRenglonReceta,
  useRecetaOrden,
  useRestaurarRenglonReceta,
} from '@/api/receta-orden';
import { useMedidasAvio as useMedidasDelCatalogo } from '@/api/medidas-avio';
import type {
  RecetaOrden,
  RecetaOrdenArte,
  RecetaOrdenAvio,
  RecetaOrdenTela,
  TipoRenglonReceta,
} from '@/api/tipos';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { ChipEstado } from '@/components/dominio/ChipEstado';
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
import { formatearMoneda } from '@/lib/formato';
import { SelectorAvio } from '@/modulos/inventarios/SelectorAvio';
import { SelectorTela } from '@/modulos/inventarios/SelectorTela';

/**
 * RECETA CONGELADA DE LA ORDEN (V1-E3d, §Post-F9.43) — el bloque del detalle de la OP donde vive
 * *"lo que ESTA orden lleva"*.
 *
 * Daniel (14-ago-2026): *"en ocasiones se negocia con el cliente que ya no lleve alguna cosa (por
 * ejemplo, quitarle una jareta para abaratar el costo)… **El BOM debe de vivir en la OP**"*.
 *
 * Lo que la pantalla tiene que dejar claro, y por qué:
 *
 *  • **La receta es de la orden, no del modelo.** Se copió al crearla; el modelo es la plantilla.
 *  • **El estado por renglón** (*sin revisar / revisado / ajustado*). ⚠️ **NO se pide el OK uno por
 *    uno**: el 89 % de las órdenes lleva la receta del modelo tal cual, y 8 clics por OP entrenan a
 *    la gente a clickear sin leer. Por eso hay UN botón de «marcar todo revisado» y el renglón
 *    desviado se pinta distinto para pedir atención solo.
 *  • **La puerta antes de COMPRAR**: sin liberar no se explota el MRP ni se generan OC. Cortar y
 *    producir NO se bloquean, y la pantalla lo dice para que nadie crea que paró la producción.
 *  • **Los dos avisos de desalineación** contra el BOM vivo del modelo, calculados al vuelo por el
 *    servidor (A1: aquí no se compara nada). Si la orden ya tiene OC el aviso se pinta más fuerte:
 *    ahí ya se comprometió dinero.
 *
 * Presentación pura (A1): todas las reglas —qué se excluye, qué se borra, cuándo se puede liberar—
 * las decide el backend; esta pantalla solo pide y pinta.
 */
export function PanelRecetaOrden({
  idOrden,
  puedeAdministrar,
  ordenCancelada,
}: {
  idOrden: number;
  /** `desarrollo.administrar`: sin él la receta es de solo lectura. */
  puedeAdministrar: boolean;
  /** Una orden cancelada no se toca (el backend también lo rechaza). */
  ordenCancelada: boolean;
}): React.JSX.Element {
  const receta = useRecetaOrden(idOrden);
  const marcar = useMarcarRecetaRevisada();
  const liberar = useLiberarReceta();
  const quitar = useQuitarRenglonReceta();
  const restaurar = useRestaurarRenglonReceta();
  const agregar = useAgregarRenglonReceta();
  const [aQuitar, setAQuitar] = useState<{
    tipo: TipoRenglonReceta;
    id: number;
    nombre: string;
  } | null>(null);
  const [motivo, setMotivo] = useState('');

  if (receta.isPending) {
    return <p className="text-sm text-muted-foreground">Cargando la receta de la orden…</p>;
  }
  if (receta.isError) {
    return <p className="text-sm text-destructive">{receta.error.message}</p>;
  }

  const d = receta.data;
  const editable = puedeAdministrar && !ordenCancelada;
  const ocupado =
    marcar.isPending ||
    liberar.isPending ||
    quitar.isPending ||
    restaurar.isPending ||
    agregar.isPending;

  function alQuitarConfirmado(): void {
    if (aQuitar === null) return;
    const objetivo = aQuitar;
    quitar.mutate(
      {
        idOrden,
        tipo: objetivo.tipo,
        idRenglon: objetivo.id,
        ...(motivo.trim() === '' ? {} : { motivo: motivo.trim() }),
      },
      {
        onSuccess: () => {
          toast.success(`"${objetivo.nombre}" ya no va en esta orden.`);
          setAQuitar(null);
          setMotivo('');
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="space-y-4" data-testid="receta-orden">
      <CabeceraReceta
        receta={d}
        editable={editable}
        ocupado={ocupado}
        alMarcarTodo={() => {
          marcar.mutate(idOrden, {
            onSuccess: () => toast.success('Receta marcada como revisada.'),
            onError: (error) => toast.error(error.message),
          });
        }}
        alLiberar={() => {
          liberar.mutate(idOrden, {
            onSuccess: () => toast.success('Receta liberada: ya se puede comprar para esta orden.'),
            onError: (error) => toast.error(error.message),
          });
        }}
      />

      <AvisosDesalineacion receta={d} />

      <SeccionTelas
        receta={d}
        idOrden={idOrden}
        editable={editable}
        ocupado={ocupado}
        alQuitar={(id, nombre) => {
          setAQuitar({ tipo: 'tela', id, nombre });
        }}
        alRestaurar={(id) => {
          restaurar.mutate(
            { idOrden, tipo: 'tela', idRenglon: id },
            {
              onSuccess: () => toast.success('Renglón restaurado al valor del modelo.'),
              onError: (error) => toast.error(error.message),
            },
          );
        }}
        alAgregar={(idTela, consumo) => {
          agregar.mutate(
            { idOrden, cuerpo: { tipo: 'tela', idTela, consumoPorPrenda: consumo } },
            {
              onSuccess: () => toast.success('Tela agregada a la receta de esta orden.'),
              onError: (error) => toast.error(error.message),
            },
          );
        }}
      />

      <SeccionAvios
        receta={d}
        idOrden={idOrden}
        editable={editable}
        ocupado={ocupado}
        alQuitar={(id, nombre) => {
          setAQuitar({ tipo: 'avio', id, nombre });
        }}
        alRestaurar={(id) => {
          restaurar.mutate(
            { idOrden, tipo: 'avio', idRenglon: id },
            {
              onSuccess: () => toast.success('Renglón restaurado al valor del modelo.'),
              onError: (error) => toast.error(error.message),
            },
          );
        }}
        alAgregar={(idAvio, consumo) => {
          agregar.mutate(
            { idOrden, cuerpo: { tipo: 'avio', idAvio, consumoPorPrenda: consumo } },
            {
              onSuccess: () => toast.success('Avío agregado a la receta de esta orden.'),
              onError: (error) => toast.error(error.message),
            },
          );
        }}
      />

      <SeccionArtes
        receta={d}
        idOrden={idOrden}
        editable={editable}
        ocupado={ocupado}
        alQuitar={(id, nombre) => {
          setAQuitar({ tipo: 'arte', id, nombre });
        }}
        alRestaurar={(id) => {
          restaurar.mutate(
            { idOrden, tipo: 'arte', idRenglon: id },
            {
              onSuccess: () => toast.success('Arte restaurado al del modelo.'),
              onError: (error) => toast.error(error.message),
            },
          );
        }}
      />

      <Dialog
        open={aQuitar !== null}
        onOpenChange={(abierto) => {
          if (!abierto) {
            setAQuitar(null);
            setMotivo('');
          }
        }}
      >
        <DialogContent data-testid="dialogo-quitar-renglon-receta">
          <DialogHeader>
            <DialogTitle>Quitar de esta orden</DialogTitle>
            <DialogDescription>
              &quot;{aQuitar?.nombre}&quot; dejará de contar para el MRP, la habilitación y el costo
              de ESTA orden. El modelo no se toca, y ninguna otra orden se entera.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="motivo-quitar-receta">Motivo (opcional)</FieldLabel>
            <Input
              id="motivo-quitar-receta"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej. el cliente la negoció fuera"
              data-testid="motivo-quitar-receta"
            />
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAQuitar(null);
                setMotivo('');
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={quitar.isPending}
              onClick={alQuitarConfirmado}
              data-testid="confirmar-quitar-receta"
            >
              {quitar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Quitar de esta orden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Cabecera: estado de revisión + la puerta de compra ──────────────────────────────────────

/** Resumen + los dos botones (marcar todo revisado / liberar). */
function CabeceraReceta({
  receta,
  editable,
  ocupado,
  alMarcarTodo,
  alLiberar,
}: {
  receta: RecetaOrden;
  editable: boolean;
  ocupado: boolean;
  alMarcarTodo: () => void;
  alLiberar: () => void;
}): React.JSX.Element {
  const r = receta.resumen;
  return (
    <div className="space-y-2 rounded-lg border p-3" data-testid="receta-cabecera">
      <div className="flex flex-wrap items-center gap-2">
        {receta.puedeComprar ? (
          <Badge variant="default" data-testid="receta-liberada">
            <CheckCircle2 className="size-3.5" aria-hidden /> Receta liberada
          </Badge>
        ) : (
          <Badge variant="secondary" data-testid="receta-sin-liberar">
            <CircleDashed className="size-3.5" aria-hidden /> Sin liberar
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {r.total} renglones · {r.sinRevisar} sin revisar · {r.ajustados} ajustados
          {r.excluidos > 0 ? ` · ${r.excluidos} quitados de esta orden` : ''}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        {receta.puedeComprar
          ? `Desarrollo liberó esta receta${receta.liberadaPor === null && receta.liberadaEn !== null ? ' (migración)' : ''}: ya se puede explotar el MRP y generar órdenes de compra.`
          : 'Hasta que Desarrollo libere la receta no se puede explotar el MRP ni generar órdenes de compra. Cortar y producir NO están bloqueados.'}
      </p>

      {editable ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={ocupado || r.sinRevisar === 0}
            onClick={alMarcarTodo}
            data-testid="receta-marcar-revisado"
          >
            <CheckCircle2 aria-hidden /> Marcar todo revisado
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={ocupado}
            onClick={alLiberar}
            data-testid="receta-liberar"
          >
            <LockOpen aria-hidden /> {receta.puedeComprar ? 'Re-liberar' : 'Liberar receta'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ── Los dos avisos de desalineación (§Post-F9.43(d)) ────────────────────────────────────────

/**
 * Los avisos de que el BOM del modelo se movió desde que esta receta se congeló. Se calculan AL
 * VUELO en el servidor —sin evento, sin outbox y sin estado acumulado— y aquí solo se pintan.
 *
 * Con OC ya hecha el bloque va en rojo: ahí ya se comprometió dinero, y ése es exactamente el caso
 * en el que Daniel quería que alguien se enterara.
 */
function AvisosDesalineacion({ receta }: { receta: RecetaOrden }): React.JSX.Element | null {
  const d = receta.desalineacion;
  if (!d.hayCambios) return null;
  // El ROJO lo decide el SERVIDOR (`critico`), no la pantalla: hay OC hecha **y** el cambio lo
  // provocó una persona tocando el modelo. Un movimiento del precio de COMPRA se informa igual,
  // pero no da la alarma — si no, cada OC que se autoriza dejaría en rojo a todas las órdenes vivas
  // con esa tela y el aviso se volvería ruido de fondo.
  const critico = d.critico;
  return (
    <div
      className={
        critico
          ? 'space-y-1 rounded-lg border border-destructive/50 bg-destructive/5 p-3'
          : 'space-y-1 rounded-lg border border-warn/50 bg-warn/5 p-3'
      }
      data-testid="receta-desalineacion"
    >
      <p
        className={
          critico
            ? 'flex items-center gap-1.5 text-sm font-medium text-destructive'
            : 'flex items-center gap-1.5 text-sm font-medium text-warn'
        }
      >
        <AlertTriangle className="size-4" aria-hidden />
        {critico
          ? 'El modelo cambió DESPUÉS de que esta orden ya tiene compras'
          : 'Algo se movió desde que se congeló esta receta'}
      </p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs">
        {d.cambios.map((c, i) => (
          <li key={`${c.tipo}-${String(c.idRenglon)}-${c.que}-${String(i)}`}>{c.detalle}</li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        La receta de esta orden NO se movió (para eso está congelada). Si algún cambio debe entrar,
        usa «Restaurar» en el renglón.
        {d.cambios.some((c) => c.que === 'agregado') ? (
          <>
            {' '}
            Para los materiales que el modelo <strong>agregó</strong>, usa «Agregar»: como ya viven
            en el modelo, el renglón se trae solo su precio, su proveedor amarrado y sus medidas por
            talla.
          </>
        ) : null}
      </p>
    </div>
  );
}

// ── Chips por renglón ───────────────────────────────────────────────────────────────────────

/** Chip del estado de revisión + las marcas de "esto se desvía a propósito". */
function ChipsRenglon({
  estado,
  agregadoAMano,
  excluido,
  cambios,
}: {
  estado: string;
  agregadoAMano: boolean;
  excluido: boolean;
  cambios: readonly string[];
}): React.JSX.Element {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {excluido ? (
        <Badge variant="destructive" className="text-[10px]">
          No va en esta orden
        </Badge>
      ) : estado === 'sin_revisar' ? (
        <Badge variant="secondary" className="text-[10px]">
          Sin revisar
        </Badge>
      ) : estado === 'ajustado' ? (
        <Badge variant="outline" className="border-warn text-[10px] text-warn">
          Ajustado
        </Badge>
      ) : (
        <Badge variant="outline" className="text-[10px]">
          Revisado
        </Badge>
      )}
      {agregadoAMano ? (
        <Badge variant="outline" className="text-[10px]">
          Agregado aquí
        </Badge>
      ) : null}
      {cambios.length > 0 ? (
        <Badge variant="outline" className="border-destructive text-[10px] text-destructive">
          El modelo cambió
        </Badge>
      ) : null}
    </span>
  );
}

/** Una talla en captura dentro de la OP (consumo como TEXTO + el amarre a la medida del avío). */
interface RenglonTallaOrden {
  idTalla: number;
  etiqueta: string;
  /** Texto: `''` = SIN CAPTURAR (no viaja en el set-completo). Un `'0'` tecleado sí viaja. */
  consumo: string;
  enLaOrden: boolean;
  idAvioMedida: number | null;
}

/**
 * MEDIDAS POR TALLA del avío, **capturables en la orden** (§Post-F9.43(c): *"Desarrollo ajusta,
 * **define las medidas por talla** y libera"*).
 *
 * ⭐ Extiende a la OP lo que V1-E3c resolvió en el modelo (`EditorMedidasAvio` +
 * `medidas-avio-talla.ts`) — no lo reinventa:
 *  - Los renglones **nacen del universo de tallas** (aquí, la matriz color×talla de LA ORDEN), no
 *    de las filas que alguien haya alcanzado a capturar. Sin esto, un avío `consumoPorTalla` cuyo
 *    modelo nunca capturó medidas se quedaba sin forma de capturarlas desde la orden.
 *  - **`null` ≠ `0`**: vacío es "sin capturar" y no viaja en el set-completo; un `0` tecleado sí
 *    viaja (es un cero a propósito, y el MRP lo respeta).
 *  - **Amarre `idAvioMedida`** contra el catálogo de medidas del avío, deshabilitado mientras no
 *    haya consumo (el amarre vive en la fila, y sin consumo no hay fila donde guardarlo).
 *  - **Toggle `consumoPorTalla`**, para poder encenderlo/apagarlo desde la orden.
 *
 * El PATCH del renglón ya es SET-COMPLETO, así que se manda el juego entero de una vez.
 */
function MedidasPorTalla({
  avio,
  editable,
  ocupado,
  alGuardar,
}: {
  avio: RecetaOrdenAvio;
  editable: boolean;
  ocupado: boolean;
  alGuardar: (cuerpo: {
    consumoPorTalla?: boolean;
    // `consumo` es OPCIONAL (V1-E3g): en modo `medida` no se captura por talla y lo resuelve el
    // dominio con el consumo por prenda congelado del renglón.
    tallas?: { idTalla: number; consumo?: number; idAvioMedida: number | null }[];
  }) => void;
}): React.JSX.Element {
  const [abierto, setAbierto] = useState(false);
  const [renglones, setRenglones] = useState<RenglonTallaOrden[]>([]);
  const catalogoMedidas = useMedidasDelCatalogo(abierto ? avio.idAvio : undefined);

  // Se siembra desde el servidor cada vez que llega/cambia la receta (es la autoridad, A1).
  useEffect(() => {
    setRenglones(
      avio.tallas.map((t) => ({
        idTalla: t.idTalla,
        etiqueta: t.etiqueta,
        consumo: t.consumo === null ? '' : String(t.consumo),
        enLaOrden: t.enLaOrden,
        idAvioMedida: t.idAvioMedida,
      })),
    );
  }, [avio.tallas]);

  function cambiar(idTalla: number, cambios: Partial<RenglonTallaOrden>): void {
    setRenglones((prev) => prev.map((r) => (r.idTalla === idTalla ? { ...r, ...cambios } : r)));
  }

  // ⭐ V1-E3g: el MODO lo manda el servidor (`modoCaptura`), no esta pantalla. En modo `medida`
  // (cierres) por talla se elige QUÉ se pide y la cantidad ni se captura ni se manda; en modo
  // `consumo` (elástico) se captura CUÁNTO, con la unidad del avío pegada al campo.
  const porMedida = avio.modoCaptura === 'medida';

  function guardar(): void {
    alGuardar(
      porMedida
        ? {
            // Sólo viajan las tallas con medida elegida (set-completo: lo que no viene, no está —
            // así se des-captura una talla dejándola en "Sin medida"). El `consumo` no se manda:
            // lo resuelve el dominio con el consumo por prenda congelado del renglón.
            consumoPorTalla: false,
            tallas: renglones
              .filter((r) => r.idAvioMedida !== null)
              .map((r) => ({ idTalla: r.idTalla, idAvioMedida: r.idAvioMedida })),
          }
        : {
            // Las tallas en BLANCO NO se mandan: el set-completo las borra, que es justo cómo se
            // "descaptura" una cantidad. Mandarlas como 0 crearía ceros reales que envenenan el MRP.
            tallas: renglones
              .filter((r) => r.consumo.trim() !== '')
              .map((r) => ({
                idTalla: r.idTalla,
                consumo: Number(r.consumo.replace(',', '.')),
                idAvioMedida: r.idAvioMedida,
              })),
          },
    );
  }

  const medidasCatalogo = (catalogoMedidas.data?.datos ?? []).filter((m) => m.activo);
  const resumen = porMedida
    ? avio.tallas
        .filter((t) => t.medidaAmarrada !== null)
        .map((t) => `${t.etiqueta} ${String(t.medidaAmarrada)}`)
        .join(' · ')
    : avio.tallas
        .filter((t) => t.consumo !== null)
        .map((t) => `${t.etiqueta} ${String(t.consumo)}`)
        .join(' · ');
  const etiquetaPanel = porMedida ? 'medida' : 'consumo';

  return (
    <span className="ml-1 align-middle text-xs" data-testid={`receta-avio-tallas-${avio.id}`}>
      <button
        type="button"
        className="text-muted-foreground underline decoration-dotted underline-offset-2"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
        data-testid={`toggle-medidas-receta-avio-${avio.id}`}
      >
        (por talla: {resumen === '' ? `sin ${etiquetaPanel} capturado` : resumen})
      </button>

      {abierto ? (
        <span
          className="mt-1 block space-y-1.5 rounded-md border bg-card p-2"
          data-testid={`panel-medidas-receta-avio-${avio.id}`}
        >
          {avio.avisoCaptura === null ? null : (
            <span
              className="block rounded-md border border-warn/40 bg-warn-soft px-2 py-1.5"
              data-testid={`aviso-captura-receta-avio-${avio.id}`}
            >
              {avio.avisoCaptura}
            </span>
          )}

          {porMedida ? (
            <span className="block text-muted-foreground" data-testid={`modo-medida-receta-${avio.id}`}>
              Este avío se compra POR MEDIDA: por talla se elige <b>qué medida</b> se pide, no
              cuánto se gasta. La cantidad es la del renglón y no cambia entre tallas.
            </span>
          ) : (
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                className="size-4 rounded border-input accent-primary"
                checked={avio.consumoPorTalla}
                disabled={!editable || ocupado}
                onChange={(e) => alGuardar({ consumoPorTalla: e.target.checked })}
                data-testid={`consumo-por-talla-receta-${avio.id}`}
              />
              ¿Este avío se consume por talla EN ESTA ORDEN?
            </label>
          )}

          {!avio.tieneTallas ? (
            <span className="block text-muted-foreground" data-testid={`sin-tallas-${avio.id}`}>
              Esta orden todavía no tiene tallas capturadas en su matriz: captúralas para poder
              definir {porMedida ? 'la medida' : 'el consumo'} por talla.
            </span>
          ) : (
            <>
              {renglones.map((r) => (
                <span key={r.idTalla} className="flex flex-wrap items-center gap-2">
                  <label
                    htmlFor={`medida-receta-avio-${String(avio.id)}-${String(r.idTalla)}`}
                    className="flex w-20 shrink-0 items-center gap-1 font-medium"
                  >
                    {r.etiqueta}
                    {r.enLaOrden ? null : (
                      <ChipEstado tono="warn" sinPunto>
                        no va en esta orden
                      </ChipEstado>
                    )}
                  </label>
                  {porMedida ? null : (
                    <>
                      <Input
                        id={`medida-receta-avio-${String(avio.id)}-${String(r.idTalla)}`}
                        type="number"
                        min={0}
                        step="0.0001"
                        inputMode="decimal"
                        className="h-7 w-24"
                        placeholder="sin capturar"
                        value={r.consumo}
                        disabled={!editable || ocupado}
                        onChange={(e) => cambiar(r.idTalla, { consumo: e.target.value })}
                        data-testid={`medida-receta-avio-${avio.id}-${r.idTalla}`}
                      />
                      {/* La unidad, PEGADA al campo (0.75 m ≠ 75 cm). */}
                      {avio.unidad === null ? null : (
                        <span className="text-muted-foreground" aria-hidden>
                          {avio.unidad}
                        </span>
                      )}
                    </>
                  )}
                  {medidasCatalogo.length > 0 ? (
                    <SelectNativo
                      className="w-48"
                      aria-label={`Medida del avío para la talla ${r.etiqueta}`}
                      title={
                        !porMedida && r.consumo.trim() === ''
                          ? 'Captura primero el consumo de esta talla para poder amarrarle una medida.'
                          : undefined
                      }
                      disabled={!editable || ocupado || (!porMedida && r.consumo.trim() === '')}
                      value={r.idAvioMedida === null ? '' : String(r.idAvioMedida)}
                      onChange={(e) =>
                        cambiar(r.idTalla, {
                          idAvioMedida: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                      data-testid={`medida-amarre-receta-avio-${avio.id}-${r.idTalla}`}
                    >
                      <option value="">Sin medida amarrada</option>
                      {medidasCatalogo.map((m) => (
                        <option key={m.id} value={String(m.id)}>
                          {m.medida} — {formatearMoneda(m.precio)}
                        </option>
                      ))}
                    </SelectNativo>
                  ) : null}
                </span>
              ))}

              {editable ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={guardar}
                  disabled={ocupado}
                  data-testid={`guardar-medidas-receta-avio-${avio.id}`}
                >
                  Guardar {porMedida ? 'medida por talla' : 'consumo por talla'}
                </Button>
              ) : null}
            </>
          )}
        </span>
      ) : null}
    </span>
  );
}

/** Celda numérica editable (consumo o precio): guarda al salir del campo, si de verdad cambió. */
function CeldaNumero({
  valor,
  editable,
  ocupado,
  testid,
  alGuardar,
  compacto = false,
}: {
  valor: number | null;
  editable: boolean;
  ocupado: boolean;
  testid: string;
  alGuardar: (nuevo: number) => void;
  /** Caja angosta para las medidas por talla, que van varias en la misma línea. */
  compacto?: boolean;
}): React.JSX.Element {
  const [texto, setTexto] = useState<string | null>(null);
  const mostrado = texto ?? (valor === null ? '' : String(valor));
  if (!editable) {
    return (
      <span className={compacto ? 'num text-xs' : 'num text-sm'}>
        {valor === null ? '—' : valor}
      </span>
    );
  }
  return (
    <Input
      className={compacto ? 'h-6 w-14 px-1 text-right text-xs' : 'h-8 w-24 text-right'}
      inputMode="decimal"
      value={mostrado}
      disabled={ocupado}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => {
        if (texto === null) return;
        const n = Number(texto.replace(',', '.'));
        setTexto(null);
        if (!Number.isFinite(n) || n < 0 || n === valor) return;
        alGuardar(n);
      }}
      data-testid={testid}
    />
  );
}

/** Botonera por renglón (restaurar / quitar). */
function AccionesRenglon({
  editable,
  ocupado,
  enElModelo,
  excluido,
  alRestaurar,
  alQuitar,
  testid,
}: {
  editable: boolean;
  ocupado: boolean;
  enElModelo: boolean;
  excluido: boolean;
  alRestaurar: () => void;
  alQuitar: () => void;
  testid: string;
}): React.JSX.Element | null {
  if (!editable) return null;
  return (
    <span className="flex justify-end gap-1">
      {enElModelo ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          title={excluido ? 'Traerlo de vuelta con el valor del modelo' : 'Restaurar al modelo'}
          disabled={ocupado}
          onClick={alRestaurar}
          data-testid={`restaurar-${testid}`}
        >
          {excluido ? (
            <Undo2 className="size-4" aria-hidden />
          ) : (
            <RotateCcw className="size-4" aria-hidden />
          )}
        </Button>
      ) : null}
      {excluido ? null : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          title="Quitar de esta orden"
          disabled={ocupado}
          onClick={alQuitar}
          data-testid={`quitar-${testid}`}
        >
          <X className="size-4" aria-hidden />
        </Button>
      )}
    </span>
  );
}

/** Clase de la fila: la excluida se ve tachada (sigue ahí, pero no cuenta). */
function claseFila(excluido: boolean): string {
  return excluido ? 'opacity-60 line-through decoration-1' : '';
}

// ── Secciones ───────────────────────────────────────────────────────────────────────────────

/** Envoltorio común de cada sección (título + tabla o vacío). */
function Seccion({
  titulo,
  vacio,
  children,
  testid,
  agregar,
}: {
  titulo: string;
  vacio: boolean;
  children: React.ReactNode;
  testid: string;
  agregar?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="space-y-2" data-testid={testid}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {titulo}
        </h4>
        {agregar}
      </div>
      {vacio ? (
        <p className="rounded-lg border border-dashed px-3 py-3 text-center text-sm text-muted-foreground">
          Esta orden no lleva {titulo.toLowerCase()}.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">{children}</div>
      )}
    </div>
  );
}

/** Selector + consumo para agregar un renglón de tela/avío a ESTA orden. */
function AgregarRenglon({
  tipo,
  ocupado,
  idsYaVivos,
  alAgregar,
}: {
  tipo: 'tela' | 'avio';
  ocupado: boolean;
  /**
   * Ids que la receta YA lleva VIVOS: el selector NO los ofrece. Volver a "agregar" uno vivo es un
   * 409 del dominio (borraría su precio congelado y su amarre); lo que se quiere ahí es editarlo en
   * su renglón. Los EXCLUIDOS sí se ofrecen: agregarlos es justamente revivir la lápida.
   */
  idsYaVivos: readonly number[];
  alAgregar: (id: number, consumo: number) => void;
}): React.JSX.Element {
  const [abierto, setAbierto] = useState(false);
  const [id, setId] = useState<number | undefined>(undefined);
  const [etiqueta, setEtiqueta] = useState<string | undefined>(undefined);
  const [consumo, setConsumo] = useState('1');

  function cerrar(): void {
    setAbierto(false);
    setId(undefined);
    setEtiqueta(undefined);
    setConsumo('1');
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setAbierto(true)}
        data-testid={`agregar-receta-${tipo}`}
      >
        <Pencil aria-hidden /> Agregar {tipo === 'tela' ? 'tela' : 'avío'}
      </Button>
      <Dialog open={abierto} onOpenChange={(v) => (v ? setAbierto(true) : cerrar())}>
        <DialogContent data-testid={`dialogo-agregar-receta-${tipo}`}>
          <DialogHeader>
            <DialogTitle>Agregar {tipo === 'tela' ? 'tela' : 'avío'} a esta orden</DialogTitle>
            <DialogDescription>
              Se agrega SOLO a esta orden; el modelo no se toca. Si el material ya vive en el BOM
              del modelo, el renglón hereda su precio, su proveedor amarrado y sus medidas por
              talla; si no, queda marcado como agregado a mano.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {tipo === 'tela' ? (
              <SelectorTela
                idSeleccionado={id}
                idsExcluidos={idsYaVivos}
                etiquetaSeleccion={etiqueta}
                alSeleccionar={(t) => {
                  setId(t.id);
                  setEtiqueta(t.nombre);
                }}
                testid="selector-receta-tela"
              />
            ) : (
              <SelectorAvio
                idSeleccionado={id}
                idsExcluidos={idsYaVivos}
                etiquetaSeleccion={etiqueta}
                alSeleccionar={(a) => {
                  setId(a.id);
                  setEtiqueta(a.clave);
                }}
                testid="selector-receta-avio"
              />
            )}
            <Field>
              <FieldLabel htmlFor={`consumo-nuevo-${tipo}`}>Consumo por prenda</FieldLabel>
              <Input
                id={`consumo-nuevo-${tipo}`}
                inputMode="decimal"
                value={consumo}
                onChange={(e) => setConsumo(e.target.value)}
                data-testid={`consumo-nuevo-${tipo}`}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={cerrar}>
              Cancelar
            </Button>
            <Button
              disabled={ocupado || id === undefined}
              onClick={() => {
                const n = Number(consumo.replace(',', '.'));
                if (id === undefined || !Number.isFinite(n) || n < 0) return;
                alAgregar(id, n);
                cerrar();
              }}
              data-testid={`confirmar-agregar-receta-${tipo}`}
            >
              Agregar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Sección de TELAS de la receta (el viejo no las congelaba; en v2 alimentan el MRP). */
function SeccionTelas({
  receta,
  idOrden,
  editable,
  ocupado,
  alQuitar,
  alRestaurar,
  alAgregar,
}: {
  receta: RecetaOrden;
  idOrden: number;
  editable: boolean;
  ocupado: boolean;
  alQuitar: (id: number, nombre: string) => void;
  alRestaurar: (id: number) => void;
  alAgregar: (idTela: number, consumo: number) => void;
}): React.JSX.Element {
  const editar = useEditarRenglonReceta();
  return (
    <Seccion
      titulo="Telas"
      testid="receta-seccion-telas"
      vacio={receta.telas.length === 0}
      agregar={
        editable ? (
          <AgregarRenglon
            tipo="tela"
            ocupado={ocupado}
            idsYaVivos={receta.telas.filter((t) => !t.excluido).map((t) => t.idTela)}
            alAgregar={alAgregar}
          />
        ) : undefined
      }
    >
      <TablaDensa>
        <TablaDensaEncabezado>
          <TablaDensaFila>
            <TablaDensaHead>Tela</TablaDensaHead>
            <TablaDensaHead>Estado</TablaDensaHead>
            <TablaDensaHead numerica className="w-32">
              Consumo
            </TablaDensaHead>
            <TablaDensaHead numerica className="w-32">
              Precio
            </TablaDensaHead>
            <TablaDensaHead className="w-20" />
          </TablaDensaFila>
        </TablaDensaEncabezado>
        <TablaDensaCuerpo>
          {receta.telas.map((t: RecetaOrdenTela) => (
            <TablaDensaFila key={t.id} className={claseFila(t.excluido)}>
              <TablaDensaCelda>
                <span className="text-sm">{t.nombre}</span>
                {t.unidad === null ? null : (
                  <span className="ml-1 text-xs text-muted-foreground">({t.unidad})</span>
                )}
              </TablaDensaCelda>
              <TablaDensaCelda>
                <ChipsRenglon
                  estado={t.estado}
                  agregadoAMano={t.agregadoAMano}
                  excluido={t.excluido}
                  cambios={t.cambios}
                />
              </TablaDensaCelda>
              <TablaDensaCelda numerica>
                <CeldaNumero
                  valor={t.consumoPorPrenda}
                  editable={editable && !t.excluido}
                  ocupado={ocupado || editar.isPending}
                  testid={`consumo-receta-tela-${t.id}`}
                  alGuardar={(n) =>
                    editar.mutate(
                      { idOrden, tipo: 'tela', idRenglon: t.id, cuerpo: { consumoPorPrenda: n } },
                      { onError: (error) => toast.error(error.message) },
                    )
                  }
                />
              </TablaDensaCelda>
              <TablaDensaCelda numerica>
                <CeldaNumero
                  valor={t.precio}
                  editable={editable && !t.excluido}
                  ocupado={ocupado || editar.isPending}
                  testid={`precio-receta-tela-${t.id}`}
                  alGuardar={(n) =>
                    editar.mutate(
                      { idOrden, tipo: 'tela', idRenglon: t.id, cuerpo: { precio: n } },
                      { onError: (error) => toast.error(error.message) },
                    )
                  }
                />
              </TablaDensaCelda>
              <TablaDensaCelda>
                <AccionesRenglon
                  editable={editable}
                  ocupado={ocupado}
                  enElModelo={t.enElModelo}
                  excluido={t.excluido}
                  alRestaurar={() => alRestaurar(t.id)}
                  alQuitar={() => alQuitar(t.id, t.nombre)}
                  testid={`receta-tela-${t.id}`}
                />
              </TablaDensaCelda>
            </TablaDensaFila>
          ))}
        </TablaDensaCuerpo>
      </TablaDensa>
    </Seccion>
  );
}

/** Sección de AVÍOS — el heredero directo de `OrdenesHab` del viejo (cantidad y precio por orden). */
function SeccionAvios({
  receta,
  idOrden,
  editable,
  ocupado,
  alQuitar,
  alRestaurar,
  alAgregar,
}: {
  receta: RecetaOrden;
  idOrden: number;
  editable: boolean;
  ocupado: boolean;
  alQuitar: (id: number, nombre: string) => void;
  alRestaurar: (id: number) => void;
  alAgregar: (idAvio: number, consumo: number) => void;
}): React.JSX.Element {
  const editar = useEditarRenglonReceta();
  return (
    <Seccion
      titulo="Avíos"
      testid="receta-seccion-avios"
      vacio={receta.avios.length === 0}
      agregar={
        editable ? (
          <AgregarRenglon
            tipo="avio"
            ocupado={ocupado}
            idsYaVivos={receta.avios.filter((a) => !a.excluido).map((a) => a.idAvio)}
            alAgregar={alAgregar}
          />
        ) : undefined
      }
    >
      <TablaDensa>
        <TablaDensaEncabezado>
          <TablaDensaFila>
            <TablaDensaHead>Avío</TablaDensaHead>
            <TablaDensaHead>Estado</TablaDensaHead>
            <TablaDensaHead numerica className="w-32">
              Consumo
            </TablaDensaHead>
            <TablaDensaHead numerica className="w-32">
              Precio
            </TablaDensaHead>
            <TablaDensaHead className="w-20" />
          </TablaDensaFila>
        </TablaDensaEncabezado>
        <TablaDensaCuerpo>
          {receta.avios.map((a: RecetaOrdenAvio) => (
            <TablaDensaFila key={a.id} className={claseFila(a.excluido)}>
              <TablaDensaCelda>
                <span className="text-sm">
                  {a.clave} — {a.descripcion}
                </span>
                {/* Se muestra aunque el toggle esté apagado: es el único lugar donde se puede
                    ENCENDER el consumo por talla de esta orden (antes solo aparecía si ya venía
                    encendido, así que no había forma de activarlo desde la OP). */}
                {a.tieneTallas || a.consumoPorTalla ? (
                  <MedidasPorTalla
                    avio={a}
                    editable={editable && !a.excluido}
                    ocupado={ocupado || editar.isPending}
                    alGuardar={(cuerpo) =>
                      editar.mutate(
                        { idOrden, tipo: 'avio', idRenglon: a.id, cuerpo },
                        {
                          onSuccess: () => toast.success('Consumo por talla guardado.'),
                          onError: (error) => toast.error(error.message),
                        },
                      )
                    }
                  />
                ) : null}
              </TablaDensaCelda>
              <TablaDensaCelda>
                <ChipsRenglon
                  estado={a.estado}
                  agregadoAMano={a.agregadoAMano}
                  excluido={a.excluido}
                  cambios={a.cambios}
                />
              </TablaDensaCelda>
              <TablaDensaCelda numerica>
                <CeldaNumero
                  valor={a.consumoPorPrenda}
                  editable={editable && !a.excluido}
                  ocupado={ocupado || editar.isPending}
                  testid={`consumo-receta-avio-${a.id}`}
                  alGuardar={(n) =>
                    editar.mutate(
                      { idOrden, tipo: 'avio', idRenglon: a.id, cuerpo: { consumoPorPrenda: n } },
                      { onError: (error) => toast.error(error.message) },
                    )
                  }
                />
              </TablaDensaCelda>
              <TablaDensaCelda numerica>
                <CeldaNumero
                  valor={a.precio}
                  editable={editable && !a.excluido}
                  ocupado={ocupado || editar.isPending}
                  testid={`precio-receta-avio-${a.id}`}
                  alGuardar={(n) =>
                    editar.mutate(
                      { idOrden, tipo: 'avio', idRenglon: a.id, cuerpo: { precio: n } },
                      { onError: (error) => toast.error(error.message) },
                    )
                  }
                />
              </TablaDensaCelda>
              <TablaDensaCelda>
                <AccionesRenglon
                  editable={editable}
                  ocupado={ocupado}
                  enElModelo={a.enElModelo}
                  excluido={a.excluido}
                  alRestaurar={() => alRestaurar(a.id)}
                  alQuitar={() => alQuitar(a.id, `${a.clave} — ${a.descripcion}`)}
                  testid={`receta-avio-${a.id}`}
                />
              </TablaDensaCelda>
            </TablaDensaFila>
          ))}
        </TablaDensaCuerpo>
      </TablaDensa>
    </Seccion>
  );
}

/** Sección de ARTES congelados (§Post-F9.35: el precio real del arte se define en la OP). */
function SeccionArtes({
  receta,
  idOrden,
  editable,
  ocupado,
  alQuitar,
  alRestaurar,
}: {
  receta: RecetaOrden;
  idOrden: number;
  editable: boolean;
  ocupado: boolean;
  alQuitar: (id: number, nombre: string) => void;
  alRestaurar: (id: number) => void;
}): React.JSX.Element {
  const editar = useEditarRenglonReceta();
  return (
    <Seccion titulo="Arte" testid="receta-seccion-artes" vacio={receta.artes.length === 0}>
      <TablaDensa>
        <TablaDensaEncabezado>
          <TablaDensaFila>
            <TablaDensaHead>Arte</TablaDensaHead>
            <TablaDensaHead>Estado</TablaDensaHead>
            <TablaDensaHead numerica className="w-32">
              Precio
            </TablaDensaHead>
            <TablaDensaHead className="w-20" />
          </TablaDensaFila>
        </TablaDensaEncabezado>
        <TablaDensaCuerpo>
          {receta.artes.map((a: RecetaOrdenArte) => (
            <TablaDensaFila key={a.id} className={claseFila(a.excluido)}>
              <TablaDensaCelda>
                <span className="text-sm">{a.descripcion}</span>
                <span className="ml-1 text-xs text-muted-foreground">
                  ({a.tipoArte.toLocaleLowerCase('es')}
                  {a.posicion === null ? '' : ` · ${a.posicion}`})
                </span>
              </TablaDensaCelda>
              <TablaDensaCelda>
                <ChipsRenglon
                  estado={a.estado}
                  agregadoAMano={a.agregadoAMano}
                  excluido={a.excluido}
                  cambios={a.cambios}
                />
              </TablaDensaCelda>
              <TablaDensaCelda numerica>
                <CeldaNumero
                  valor={a.precio}
                  editable={editable && !a.excluido}
                  ocupado={ocupado || editar.isPending}
                  testid={`precio-receta-arte-${a.id}`}
                  alGuardar={(n) =>
                    editar.mutate(
                      { idOrden, tipo: 'arte', idRenglon: a.id, cuerpo: { precio: n } },
                      { onError: (error) => toast.error(error.message) },
                    )
                  }
                />
              </TablaDensaCelda>
              <TablaDensaCelda>
                <AccionesRenglon
                  editable={editable}
                  ocupado={ocupado}
                  enElModelo={a.enElModelo}
                  excluido={a.excluido}
                  alRestaurar={() => alRestaurar(a.id)}
                  alQuitar={() => alQuitar(a.id, a.descripcion)}
                  testid={`receta-arte-${a.id}`}
                />
              </TablaDensaCelda>
            </TablaDensaFila>
          ))}
        </TablaDensaCuerpo>
      </TablaDensa>
    </Seccion>
  );
}
