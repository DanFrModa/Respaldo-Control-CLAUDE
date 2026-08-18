import { Loader2, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useOrden } from '@/api/ordenes';
import { useAjustarRuta, useProgramarRc, useRutaOrden } from '@/api/ruta-critica-programacion';
import {
  useArticulosRc,
  useDuracionesAplicacionRc,
  useDuracionesTelaRc,
} from '@/api/ruta-critica-plantillas';
import type { RutaOrden } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import { useSesion } from '@/sesion/useSesion';

import { Semaforo, fechaRc } from './piezas';

/** Etiqueta legible del estado del cálculo de fechas (CPM). */
const ETIQUETA_RECALCULO: Record<RutaOrden['estadoRecalculo'], string> = {
  calculado: 'Fechas listas',
  recalculando: 'Recalculando…',
  'sin-ruta': 'Sin ruta',
};

/**
 * PROGRAMAR RC (F5-E5) — pantalla para GENERAR / RE-PROGRAMAR la Ruta Crítica de una orden y AJUSTAR
 * su ruta (sin tocar la plantilla, D10). Se llega desde el detalle de la orden. El formulario captura
 * artículo, tipo de tela, aplicación, fechas y resurtido (todos del catálogo de E2). Tras programar,
 * si el CPM sigue calculando (`estadoRecalculo === 'recalculando'`), se SONDEA el GET ruta sin
 * bloquear la pantalla hasta que termine. CERO lógica de negocio (A1): el cálculo de fechas, el
 * semáforo y la validación de ciclos viven en el backend; aquí solo se capturan datos y se disparan
 * mutaciones. La cierra la CAPA DE RUTA con `rc.programar` (`catalogo.ts`, §Post-F9.68): quien no
 * lo tiene NO ve ni el botón que lleva aquí ni la pantalla, en vez de entrar y leer un letrero de
 * permiso. El backend re-verifica igual (A4).
 */
export function ProgramarRcPagina(): React.JSX.Element {
  const { idOrden: idOrdenParam } = useParams<{ idOrden: string }>();
  const idOrden = idOrdenParam !== undefined ? Number(idOrdenParam) : undefined;
  const navigate = useNavigate();
  const { tienePermiso } = useSesion();
  const puedeVerRuta = tienePermiso('rc.ruta-ver');

  const orden = useOrden(idOrden);
  // Sondea mientras el CPM recalcula para que las fechas aparezcan solas al terminar.
  const consultaRuta = useRutaOrden(idOrden, { pollearMientrasRecalcula: true });
  const ruta = consultaRuta.data;
  const yaTieneRuta = ruta?.rcActiva === true;

  const articulos = useArticulosRc();
  const telas = useDuracionesTelaRc();
  const aplicaciones = useDuracionesAplicacionRc();

  const programar = useProgramarRc();

  // ── Estado del formulario ────────────────────────────────────────────────────
  const [idArticulo, setIdArticulo] = useState('');
  const [idTela, setIdTela] = useState('');
  const [idAplicacion, setIdAplicacion] = useState('');
  const [fechaEntrega, setFechaEntrega] = useState('');
  const [fechaInicio, setFechaInicio] = useState('');
  const [esResurtido, setEsResurtido] = useState(false);

  // Pre-llena el formulario con la ruta existente (re-programación) la primera vez que llega.
  const [precargado, setPrecargado] = useState(false);
  useEffect(() => {
    if (precargado || ruta === undefined) return;
    if (ruta.idArticuloRC != null) setIdArticulo(String(ruta.idArticuloRC));
    if (ruta.idTipoTela != null) setIdTela(String(ruta.idTipoTela));
    if (ruta.idAplicacion != null) setIdAplicacion(String(ruta.idAplicacion));
    // El contrato serializa las fechas como datetime ISO; un `<input type="date">` solo acepta
    // `YYYY-MM-DD`, así que recortamos a los primeros 10 caracteres (si no, queda vacío al editar).
    if (ruta.fechaEntregaRC != null) setFechaEntrega(ruta.fechaEntregaRC.slice(0, 10));
    setFechaInicio(ruta.fechaInicioRC?.slice(0, 10) ?? '');
    setEsResurtido(ruta.esResurtido);
    setPrecargado(true);
  }, [precargado, ruta]);

  const formularioListo =
    idArticulo !== '' && idTela !== '' && idAplicacion !== '' && fechaEntrega !== '';

  function enviar(): void {
    if (idOrden === undefined || !formularioListo) return;
    programar.mutate(
      {
        idOrden,
        cuerpo: {
          idArticuloRC: Number(idArticulo),
          idTipoTela: Number(idTela),
          idAplicacion: Number(idAplicacion),
          fechaEntregaRC: fechaEntrega,
          esResurtido,
          ...(fechaInicio !== '' ? { fechaInicioRC: fechaInicio } : {}),
        },
      },
      {
        onSuccess: () => toast.success('Ruta Crítica programada.'),
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
                Programar Ruta Crítica
              </h1>
              <p className="text-[12.5px] text-muted-foreground">
                {orden.data
                  ? `Orden ${orden.data.folio} · ${orden.data.codigoModelo} · ${orden.data.cliente}`
                  : 'Genera la ruta de procesos con sus fechas a partir de la plantilla.'}
              </p>
            </div>
          </div>
          {/* §Post-F9.68: el atajo a la ruta solo para quien puede abrirla. */}
          {idOrden !== undefined && puedeVerRuta ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void navigate(`/ruta-critica/ordenes/${idOrden}`)}
              data-testid="ir-ver-ruta"
            >
              Ver ruta
            </Button>
          ) : null}
        </header>

        {/* ── Formulario de programación ───────────────────────────────────── */}
        <section
          className="space-y-4 rounded-lg border bg-card p-4"
          data-testid="form-programar-rc"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="prog-articulo">Artículo</FieldLabel>
              <SelectNativo
                id="prog-articulo"
                value={idArticulo}
                onChange={(e) => setIdArticulo(e.target.value)}
                data-testid="prog-articulo"
              >
                <option value="">— Selecciona —</option>
                {(articulos.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="prog-tela">Tipo de tela</FieldLabel>
              <SelectNativo
                id="prog-tela"
                value={idTela}
                onChange={(e) => setIdTela(e.target.value)}
                data-testid="prog-tela"
              >
                <option value="">— Selecciona —</option>
                {(telas.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="prog-aplicacion">Aplicación</FieldLabel>
              <SelectNativo
                id="prog-aplicacion"
                value={idAplicacion}
                onChange={(e) => setIdAplicacion(e.target.value)}
                data-testid="prog-aplicacion"
              >
                <option value="">— Selecciona —</option>
                {(aplicaciones.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="prog-entrega">Fecha de entrega</FieldLabel>
              <Input
                id="prog-entrega"
                type="date"
                value={fechaEntrega}
                onChange={(e) => setFechaEntrega(e.target.value)}
                data-testid="prog-entrega"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="prog-inicio">Fecha de inicio (opcional)</FieldLabel>
              <Input
                id="prog-inicio"
                type="date"
                value={fechaInicio}
                onChange={(e) => setFechaInicio(e.target.value)}
                data-testid="prog-inicio"
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input accent-primary"
              checked={esResurtido}
              onChange={(e) => setEsResurtido(e.target.checked)}
              data-testid="prog-resurtido"
            />
            Es resurtido
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={enviar}
              disabled={!formularioListo || programar.isPending}
              data-testid="prog-enviar"
            >
              {programar.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {yaTieneRuta ? 'Re-programar' : 'Programar'}
            </Button>

            {ruta !== undefined && ruta.estadoRecalculo === 'recalculando' ? (
              <span
                className="inline-flex items-center gap-1.5 text-sm text-amber-600"
                data-testid="prog-recalculando"
              >
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Recalculando fechas…
              </span>
            ) : null}
          </div>

          <CopiarDeOrden
            onCopiado={(origen) => {
              if (origen.idArticuloRC != null) setIdArticulo(String(origen.idArticuloRC));
              if (origen.idTipoTela != null) setIdTela(String(origen.idTipoTela));
              if (origen.idAplicacion != null) setIdAplicacion(String(origen.idAplicacion));
              setEsResurtido(origen.esResurtido);
            }}
          />
        </section>

        {/* ── Resultado: encabezado + renglones con fechas ─────────────────── */}
        {yaTieneRuta && ruta !== undefined ? (
          <section className="space-y-3" data-testid="resultado-ruta">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-card p-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Estado general</span>
                <Semaforo semaforo={ruta.semaforo} />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Entrega</span>
                <span className="text-sm font-medium">{fechaRc(ruta.fechaEntregaRC)}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Cálculo</span>
                <span className="inline-flex items-center gap-1.5 text-sm">
                  {ruta.estadoRecalculo === 'recalculando' ? (
                    <Loader2 className="size-3.5 animate-spin text-amber-600" aria-hidden />
                  ) : null}
                  {ETIQUETA_RECALCULO[ruta.estadoRecalculo]}
                </span>
              </div>
            </div>

            <ul className="space-y-2" data-testid="renglones-ruta">
              {ruta.procesos.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {p.secuencia}.
                    </span>
                    <span className="truncate font-medium">{p.nombreProceso}</span>
                    {p.critico ? (
                      <Badge variant="destructive" className="shrink-0">
                        Crítico
                      </Badge>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {fechaRc(p.fechaPlaneadaVigente)}
                  </span>
                </li>
              ))}
            </ul>

            <AjustesRuta idOrden={idOrden} ruta={ruta} />
          </section>
        ) : null}
      </div>
    </div>
  );
}

/**
 * "Copiar de orden anterior": el usuario teclea el id de otra orden, se trae su ruta (GET ruta) y se
 * pre-llenan artículo/tela/aplicación/resurtido. Reusa el GET ruta; sin endpoint nuevo.
 */
function CopiarDeOrden({
  onCopiado,
}: {
  onCopiado: (origen: RutaOrden) => void;
}): React.JSX.Element {
  const [valor, setValor] = useState('');
  const [idOrigen, setIdOrigen] = useState<number | undefined>(undefined);
  const consulta = useRutaOrden(idOrigen, { habilitado: idOrigen !== undefined });

  // Cuando llega la ruta del origen, pre-llena (una sola vez por consulta).
  const [aplicado, setAplicado] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (
      consulta.data !== undefined &&
      consulta.data.rcActiva &&
      idOrigen !== undefined &&
      aplicado !== idOrigen
    ) {
      onCopiado(consulta.data);
      setAplicado(idOrigen);
      toast.success(`Datos copiados de la orden ${consulta.data.idOrden}.`);
    }
  }, [consulta.data, idOrigen, aplicado, onCopiado]);

  return (
    <div className="border-t pt-3">
      <p className="mb-1.5 text-xs text-muted-foreground">
        Copia los datos de programación de otra orden ya programada.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field className="w-40">
          <FieldLabel htmlFor="copiar-orden">Id de la orden</FieldLabel>
          <Input
            id="copiar-orden"
            type="number"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="p. ej. 1024"
            data-testid="copiar-orden-id"
          />
        </Field>
        <Button
          variant="outline"
          size="sm"
          disabled={valor.trim() === '' || consulta.isFetching}
          onClick={() => {
            const n = Number(valor);
            if (Number.isFinite(n) && n > 0) {
              setAplicado(undefined);
              setIdOrigen(n);
            }
          }}
          data-testid="copiar-orden-traer"
        >
          {consulta.isFetching ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Copiar
        </Button>
        {idOrigen !== undefined && consulta.isError ? (
          <span className="text-xs text-destructive" role="alert">
            {consulta.error.message}
          </span>
        ) : null}
        {idOrigen !== undefined && consulta.data !== undefined && !consulta.data.rcActiva ? (
          <span className="text-xs text-muted-foreground">
            Esa orden no tiene una ruta programada.
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Ajustes POR ORDEN: lista los procesos de la ruta con acción de quitar (PATCH .../ruta). La
 * plantilla NO se modifica (D10). El agregado de procesos extra reusa la misma mutación; se ofrece
 * el quitar por su uso más frecuente y se deja claro el alcance al usuario.
 */
function AjustesRuta({
  idOrden,
  ruta,
}: {
  idOrden: number | undefined;
  ruta: RutaOrden;
}): React.JSX.Element {
  const ajustar = useAjustarRuta();

  function quitar(idProcesoDef: number, nombre: string): void {
    if (idOrden === undefined) return;
    ajustar.mutate(
      { idOrden, cuerpo: { quitar: [idProcesoDef] } },
      {
        onSuccess: () => toast.success(`Proceso "${nombre}" quitado de la ruta.`),
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4" data-testid="ajustes-ruta">
      <h2 className="text-sm font-medium">Ajustes de esta orden</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Ajustas la ruta de ESTA orden; la plantilla no se modifica (D10).
      </p>
      <ul className="mt-3 space-y-1.5">
        {ruta.procesos.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm"
          >
            <span className="truncate">{p.nombreProceso}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={ajustar.isPending}
              onClick={() => quitar(p.idProcesoDef, p.nombreProceso)}
              aria-label={`Quitar ${p.nombreProceso}`}
              data-testid={`quitar-proceso-${p.idProcesoDef}`}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
