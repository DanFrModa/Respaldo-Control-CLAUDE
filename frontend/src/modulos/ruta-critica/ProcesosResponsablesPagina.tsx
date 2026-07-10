import { ChevronRight, Pencil, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { useProcesosRc, useFijarDependenciasProcesoRc } from '@/api/ruta-critica';
import {
  useActualizarRangoDificultadRc,
  useCrearRangoDificultadRc,
  useDesactivarRangoDificultadRc,
  useDuracionesTelaRc,
  useRangosDificultadRc,
} from '@/api/ruta-critica-plantillas';
import type { ProcesoRc, RangoDificultadRc } from '@/api/tipos';
import { ComboboxBuscable } from '@/components/dominio/ComboboxBuscable';
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
import { Label } from '@/components/ui/label';
import { useSesion } from '@/sesion/useSesion';

import { DialogoProcesoRc } from './DialogoProcesoRc';
import { EditorRolesProceso } from './EditorRolesProceso';
import { EVENTO_RC_DESCRIPCION, esProcesoAutomatico } from './piezas';

/**
 * PROCESOS Y RESPONSABLES (rediseño R4 — proto §4.9, bajo SISTEMA): el catálogo de los procesos de
 * la Ruta Crítica como lo pidió Daniel — #secuencia · proceso · responsables (roles N:M, chips) ·
 * TIEMPO con renglón EXPANDIBLE (días por dificultad si `porDificultad`, la dependencia de
 * catálogo si `porTipoTela`, etc.) · "¿Cómo se completa?" (⟳ Automático + evento / ✋ Manual) ·
 * DEPENDENCIAS editables ("Espera a" con chips ✕ + agregar antecesor; el "Detona →" se DERIVA y
 * recalcula solo; los ciclos los rechaza el servidor con error claro). Cards laterales: la TABLA
 * DE DIFICULTAD por # de operaciones (CRUD de `RangoDificultad`, B7) y la DURACIÓN POR CATÁLOGO
 * (las `DuracionPorTipoTela`, re-vestidas: la velocidad con que llega la tela).
 *
 * Los procesos del catálogo son DATOS (la lista real la define Daniel con la operación); esta
 * pantalla solo los administra. Gate `rc.catalogo-ver`; mutar exige `rc.catalogo-administrar`
 * (el servidor decide, A4). Las demás vistas de configuración (Plantillas / Reglas de duración /
 * Dependencias / catálogo completo) quedan enlazadas desde aquí (sub-nav, decisión R4).
 */

/** El catálogo completo cabe en una página (26 procesos reales; tope del API = 100). */
const POR_PAGINA = 100;

export function ProcesosResponsablesPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('rc.catalogo-administrar');

  const consulta = useProcesosRc({
    pagina: 1,
    porPagina: POR_PAGINA,
    ordenarPor: 'creadoEn',
    direccion: 'asc',
    incluirInactivos: 'false',
  });

  // Orden estable de "secuencia" (#): por id ascendente (el seed creó los 26 en su orden real).
  const procesos = useMemo(
    () => [...(consulta.data?.datos ?? [])].sort((a, b) => a.id - b.id),
    [consulta.data],
  );

  const [expandido, setExpandido] = useState<number | null>(null);
  const [dialogoProceso, setDialogoProceso] = useState<{
    abierto: boolean;
    proceso: ProcesoRc | undefined;
  }>({ abierto: false, proceso: undefined });

  const nAuto = procesos.filter((p) => esProcesoAutomatico(p.tipoEvento)).length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b bg-background px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
              Procesos y responsables
            </h1>
            <p className="text-[12.5px] text-muted-foreground">
              Catálogo de procesos de la Ruta Crítica · responsable · tiempo por operación (la
              costura, por # de operaciones) · variables · auto-completado
            </p>
          </div>
          {puedeAdministrar ? (
            <Button
              onClick={() => setDialogoProceso({ abierto: true, proceso: undefined })}
              data-testid="pyr-nuevo-proceso"
            >
              <Plus className="size-4" aria-hidden />
              Nuevo proceso
            </Button>
          ) : null}
        </div>
        {/* Sub-nav: las demás vistas de configuración de la RC siguen vivas y se llega desde aquí. */}
        <nav className="mt-3 flex flex-wrap gap-2 text-xs" data-testid="pyr-subnav">
          <Link
            className="rounded-full border px-2.5 py-1 hover:bg-secondary"
            to="/ruta-critica/plantillas"
          >
            Plantillas de ruta
          </Link>
          <Link
            className="rounded-full border px-2.5 py-1 hover:bg-secondary"
            to="/ruta-critica/reglas-duracion"
          >
            Reglas de duración
          </Link>
          <Link
            className="rounded-full border px-2.5 py-1 hover:bg-secondary"
            to="/ruta-critica/dependencias"
          >
            Grafo de dependencias
          </Link>
          <Link
            className="rounded-full border px-2.5 py-1 hover:bg-secondary"
            to="/ruta-critica/procesos"
          >
            Catálogo completo (banderas y checklists)
          </Link>
        </nav>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <p className="mb-4 rounded-lg border bg-secondary/50 p-3 text-sm text-muted-foreground">
          La <b>mayoría de las prendas</b> llevan estos procesos; por <b>orden/prenda</b> se{' '}
          <b>agregan o quitan</b>. Cada proceso tiene su <b>responsable</b> y su <b>tiempo</b>, que
          puede variar por la{' '}
          <b>
            dificultad de la prenda (que se DERIVA del # de operaciones definido en el desarrollo
            del modelo → impacta sobre todo la costura, ver tabla abajo)
          </b>{' '}
          o depender de un catálogo (ej. <b>velocidad de recepción de la tela</b>). Los tiempos
          alimentan la ruta <b>hacia atrás</b>. Casi todos se marcan <b>solos</b>. Abre cada renglón
          (▸) para el detalle.
        </p>

        {consulta.isPending ? (
          <p className="text-sm text-muted-foreground" data-testid="pyr-cargando">
            Cargando procesos…
          </p>
        ) : consulta.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {consulta.error.message}
          </p>
        ) : (
          <section className="overflow-hidden rounded-lg border bg-card" data-testid="pyr-tabla">
            <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
              <h2 className="text-sm font-semibold">Secuencia de procesos</h2>
              <span className="text-xs text-faint tabular-nums">{procesos.length}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {nAuto} automáticos · {procesos.length - nAuto} manuales
              </span>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b bg-secondary text-left text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                    <th className="w-8 px-2 py-2" />
                    <th className="w-10 px-2 py-2 text-right">#</th>
                    <th className="px-3 py-2">Proceso</th>
                    <th className="px-3 py-2">Responsables</th>
                    <th className="px-3 py-2 text-right">Tiempo</th>
                    <th className="px-3 py-2">¿Cómo se completa?</th>
                    <th className="w-20 px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {procesos.map((p, i) => (
                    <FilaProceso
                      key={p.id}
                      proceso={p}
                      numero={i + 1}
                      procesos={procesos}
                      expandido={expandido === p.id}
                      alExpandir={() => setExpandido(expandido === p.id ? null : p.id)}
                      alEditar={() => setDialogoProceso({ abierto: true, proceso: p })}
                      puedeAdministrar={puedeAdministrar}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <CardTablaDificultad puedeAdministrar={puedeAdministrar} />
          <CardDuracionPorCatalogo />
        </div>
      </div>

      <DialogoProcesoRc
        abierto={dialogoProceso.abierto}
        alCambiarAbierto={(abierto) => setDialogoProceso((d) => ({ ...d, abierto }))}
        proceso={dialogoProceso.proceso}
      />
    </div>
  );
}

/** Etiqueta corta de la columna Tiempo según el tipo de duración. */
function celdaTiempo(p: ProcesoRc): React.JSX.Element {
  if (p.tipoDuracion === 'fija' || p.tipoDuracion === 'porCantidad') {
    return (
      <span className="text-xs text-muted-foreground">
        {p.tipoDuracion === 'fija' ? 'fijo · por plantilla' : 'por cantidad'}
      </span>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px]">
      variable ·{' '}
      {p.tipoDuracion === 'porDificultad'
        ? '# de operaciones'
        : p.tipoDuracion === 'porTipoTela'
          ? 'velocidad de recepción'
          : 'aplicación'}
    </Badge>
  );
}

/** Renglón del catálogo + su detalle expandible (tiempos, reglas y dependencias editables). */
function FilaProceso({
  proceso,
  numero,
  procesos,
  expandido,
  alExpandir,
  alEditar,
  puedeAdministrar,
}: {
  proceso: ProcesoRc;
  numero: number;
  procesos: readonly ProcesoRc[];
  expandido: boolean;
  alExpandir: () => void;
  alEditar: () => void;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const esAuto = esProcesoAutomatico(proceso.tipoEvento);
  // "Detona →" se DERIVA: los procesos que tienen a ESTE como antecesor (vista inversa, no se guarda).
  const detona = procesos.filter((x) => x.antecesores.some((a) => a.idProceso === proceso.id));

  return (
    <>
      <tr className="border-b hover:bg-secondary/40" data-testid="pyr-proceso">
        <td className="px-2 py-2">
          <button
            type="button"
            onClick={alExpandir}
            className="grid size-6 place-items-center rounded hover:bg-secondary"
            title="Ver detalle"
            data-testid="pyr-expandir"
          >
            <ChevronRight
              className={`size-4 transition-transform ${expandido ? 'rotate-90' : ''}`}
              aria-hidden
            />
          </button>
        </td>
        <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{numero}</td>
        <td className="px-3 py-2">
          <span className="font-medium">{proceso.nombre}</span>
          {proceso.condicionAplicabilidad === 'soloSiLlevaAplicacion' ? (
            <Badge
              variant="outline"
              className="ml-2 text-[10px]"
              title="Solo si la prenda lleva estampado o bordado"
            >
              condicional
            </Badge>
          ) : null}
        </td>
        <td className="px-3 py-2">
          {proceso.roles.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {proceso.roles.map((r) => (
                <Badge key={r.idRol} variant="secondary" className="text-[10px]">
                  {r.nombre}
                </Badge>
              ))}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">— sin responsable —</span>
          )}
        </td>
        <td className="px-3 py-2 text-right">{celdaTiempo(proceso)}</td>
        <td className="px-3 py-2">
          {esAuto ? (
            <span className="text-xs">
              <Badge variant="secondary" className="mr-1 text-[10px]">
                ⟳ Auto
              </Badge>
              <span className="text-muted-foreground">
                al registrar: {EVENTO_RC_DESCRIPCION[proceso.tipoEvento]}
              </span>
            </span>
          ) : (
            <span className="text-xs">
              <Badge
                variant="outline"
                className="mr-1 border-amber-400 text-[10px] text-amber-700 dark:border-amber-600 dark:text-amber-300"
              >
                ✋ Manual
              </Badge>
              <span className="text-muted-foreground">se marca a mano</span>
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          {puedeAdministrar ? (
            <Button variant="ghost" size="sm" onClick={alEditar} data-testid="pyr-editar">
              <Pencil className="size-3.5" aria-hidden />
              Editar
            </Button>
          ) : null}
        </td>
      </tr>
      {expandido ? (
        <tr className="border-b bg-secondary/30">
          <td colSpan={7} className="px-4 py-3">
            <div className="flex flex-wrap gap-6">
              <DetalleTiempo proceso={proceso} />
              <div className="min-w-60">
                <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Responsables (roles)
                </h4>
                <EditorRolesProceso proceso={proceso} puedeAdministrar={puedeAdministrar} />
              </div>
              <EditorDependencias
                proceso={proceso}
                procesos={procesos}
                detona={detona}
                puedeAdministrar={puedeAdministrar}
              />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** Detalle del TIEMPO del proceso en el renglón expandible (según su tipo de duración). */
function DetalleTiempo({ proceso }: { proceso: ProcesoRc }): React.JSX.Element {
  const rangos = useRangosDificultadRc(false);
  const telas = useDuracionesTelaRc(false);

  return (
    <div className="min-w-64 max-w-md" data-testid="pyr-detalle-tiempo">
      <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        Tiempo
      </h4>
      {proceso.tipoDuracion === 'porDificultad' ? (
        <>
          <p className="mb-1.5 text-xs text-muted-foreground">
            Según el <b># de operaciones</b> del modelo (tabla de dificultad):
          </p>
          <ul className="space-y-1 text-xs">
            {(rangos.data ?? []).map((r) => (
              <li
                key={r.id}
                className="flex justify-between gap-4 rounded border bg-card px-2 py-1"
              >
                <span>
                  {r.opsDesde}
                  {r.opsHasta === null ? '+' : `–${String(r.opsHasta)}`} oper. · <b>{r.nombre}</b>
                </span>
                <b className="tabular-nums">{r.diasCostura} d</b>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Se configura en la <b>tabla de dificultad</b> (abajo). El # de operaciones viene del
            desarrollo del modelo.
          </p>
        </>
      ) : proceso.tipoDuracion === 'porTipoTela' ? (
        <>
          <p className="mb-1.5 text-xs text-muted-foreground">
            Según la <b>velocidad de recepción de la tela</b> (catálogo):
          </p>
          <ul className="space-y-1 text-xs">
            {(telas.data ?? []).map((t) => (
              <li
                key={t.id}
                className="flex justify-between gap-4 rounded border bg-card px-2 py-1"
              >
                <span>{t.nombre}</span>
                <b className="tabular-nums">{t.dias} d</b>
              </li>
            ))}
          </ul>
        </>
      ) : proceso.tipoDuracion === 'porAplicacion' ? (
        <p className="text-xs text-muted-foreground">
          Según la <b>aplicación/estampado</b> elegida al programar (catálogo en{' '}
          <Link className="underline" to="/ruta-critica/reglas-duracion">
            Reglas de duración
          </Link>
          ).
        </p>
      ) : proceso.tipoDuracion === 'porCantidad' ? (
        <p className="text-xs text-muted-foreground">
          Tiempo estándar de la plantilla × <b>factor por cantidad</b> de piezas (catálogo en{' '}
          <Link className="underline" to="/ruta-critica/reglas-duracion">
            Reglas de duración
          </Link>
          ).
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          <b>Tiempo fijo</b>: los días estándar se capturan por plantilla (en{' '}
          <Link className="underline" to="/ruta-critica/plantillas">
            Plantillas de ruta
          </Link>
          ).
        </p>
      )}
    </div>
  );
}

/** Bloque "Dependencias en la ruta (CPM)": Espera a (chips ✕ + agregar) / Detona → (derivado). */
function EditorDependencias({
  proceso,
  procesos,
  detona,
  puedeAdministrar,
}: {
  proceso: ProcesoRc;
  procesos: readonly ProcesoRc[];
  detona: readonly ProcesoRc[];
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const fijar = useFijarDependenciasProcesoRc();
  const [nuevoAntecesor, setNuevoAntecesor] = useState<number | null>(null);

  const idsActuales = proceso.antecesores.map((a) => a.idProceso);
  const candidatos = procesos.filter((x) => x.id !== proceso.id && !idsActuales.includes(x.id));

  function guardar(idsAntecesores: number[], mensajeOk: string): void {
    fijar.mutate(
      { id: proceso.id, cuerpo: { idsAntecesores } },
      {
        onSuccess: () => {
          toast.success(mensajeOk);
          setNuevoAntecesor(null);
        },
        // El SERVIDOR rechaza los ciclos con un mensaje claro (grafo.ts); aquí solo se muestra.
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <div className="min-w-72 max-w-md" data-testid="pyr-dependencias">
      <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        Dependencias en la ruta (CPM) · <span className="text-primary">editable</span>
      </h4>
      <p className="mb-1 text-xs font-medium">Espera a (antecesores):</p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {proceso.antecesores.length > 0 ? (
          proceso.antecesores.map((a) => (
            <span
              key={a.idProceso}
              className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs"
              data-testid="pyr-chip-antecesor"
            >
              {a.nombre}
              {puedeAdministrar ? (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  title="Quitar antecesor"
                  disabled={fijar.isPending}
                  onClick={() =>
                    guardar(
                      idsActuales.filter((id) => id !== a.idProceso),
                      `Antecesor quitado de ${proceso.nombre}.`,
                    )
                  }
                  data-testid="pyr-quitar-antecesor"
                >
                  <X className="size-3" aria-hidden />
                </button>
              ) : null}
            </span>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">— es el inicio —</span>
        )}
      </div>
      {puedeAdministrar ? (
        <div className="mb-2 flex items-center gap-1.5">
          <div className="w-56">
            <ComboboxBuscable
              opciones={candidatos.map((c) => ({ id: c.id, nombre: c.nombre }))}
              valor={nuevoAntecesor}
              onChange={setNuevoAntecesor}
              placeholder="+ agregar antecesor…"
              etiqueta="Agregar antecesor"
              testid="pyr-antecesor"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={nuevoAntecesor === null || fijar.isPending}
            onClick={() => {
              if (nuevoAntecesor === null) return;
              const nombre = procesos.find((x) => x.id === nuevoAntecesor)?.nombre ?? '';
              guardar(
                [...idsActuales, nuevoAntecesor],
                `Antecesor agregado: ${nombre} → ${proceso.nombre}.`,
              );
            }}
            data-testid="pyr-agregar-antecesor"
          >
            <Plus className="size-3.5" aria-hidden />
            Agregar
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        <b>Detona →</b>{' '}
        {detona.length > 0 ? detona.map((d) => d.nombre).join(', ') : <span>— fin —</span>}
      </p>
    </div>
  );
}

// ── Card: tabla de dificultad por # de operaciones (CRUD de RangoDificultad, B7) ──

/** Formulario del alta/edición de un rango (estado local simple). */
interface FormRango {
  opsDesde: string;
  opsHasta: string;
  nombre: string;
  diasCostura: string;
}

function CardTablaDificultad({
  puedeAdministrar,
}: {
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const consulta = useRangosDificultadRc(false);
  const crear = useCrearRangoDificultadRc();
  const actualizar = useActualizarRangoDificultadRc();
  const desactivar = useDesactivarRangoDificultadRc();

  const [dialogo, setDialogo] = useState<{ abierto: boolean; rango: RangoDificultadRc | null }>({
    abierto: false,
    rango: null,
  });
  const [form, setForm] = useState<FormRango>({
    opsDesde: '',
    opsHasta: '',
    nombre: '',
    diasCostura: '',
  });

  function abrir(rango: RangoDificultadRc | null): void {
    setForm(
      rango === null
        ? { opsDesde: '', opsHasta: '', nombre: '', diasCostura: '' }
        : {
            opsDesde: String(rango.opsDesde),
            opsHasta: rango.opsHasta === null ? '' : String(rango.opsHasta),
            nombre: rango.nombre,
            diasCostura: String(rango.diasCostura),
          },
    );
    setDialogo({ abierto: true, rango });
  }

  function guardar(): void {
    const opsDesde = Number(form.opsDesde);
    const opsHasta = form.opsHasta.trim() === '' ? null : Number(form.opsHasta);
    const diasCostura = Number(form.diasCostura);
    const cuerpo = { opsDesde, opsHasta, nombre: form.nombre.trim(), diasCostura };
    const alExito = (): void => {
      toast.success('Tabla de dificultad actualizada.');
      setDialogo({ abierto: false, rango: null });
    };
    const alError = (e: { message: string }): void => {
      toast.error(e.message);
    };
    if (dialogo.rango === null) {
      crear.mutate(cuerpo, { onSuccess: alExito, onError: alError });
    } else {
      actualizar.mutate({ id: dialogo.rango.id, cuerpo }, { onSuccess: alExito, onError: alError });
    }
  }

  const guardando = crear.isPending || actualizar.isPending;

  return (
    <section
      className="overflow-hidden rounded-lg border bg-card"
      data-testid="pyr-card-dificultad"
    >
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">Tabla de dificultad por # de operaciones</h2>
        <span className="text-xs text-faint tabular-nums">{consulta.data?.length ?? 0} rangos</span>
        {puedeAdministrar ? (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => abrir(null)}
            data-testid="pyr-agregar-rango"
          >
            <Plus className="size-3.5" aria-hidden />
            Agregar rango
          </Button>
        ) : null}
      </header>
      <div className="p-3">
        {consulta.isPending ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                <th className="px-2 py-1.5"># de operaciones</th>
                <th className="px-2 py-1.5">Dificultad</th>
                <th className="px-2 py-1.5 text-right">Tiempo de costura</th>
                <th className="w-24 px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {(consulta.data ?? []).map((r) => (
                <tr key={r.id} className="border-b last:border-b-0" data-testid="pyr-rango">
                  <td className="px-2 py-1.5 tabular-nums">
                    {r.opsDesde} – {r.opsHasta === null ? '∞' : r.opsHasta}
                  </td>
                  <td className="px-2 py-1.5 font-medium">{r.nombre}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.diasCostura} d</td>
                  <td className="px-2 py-1.5 text-right">
                    {puedeAdministrar ? (
                      <span className="inline-flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => abrir(r)}
                          data-testid="pyr-editar-rango"
                        >
                          Editar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={desactivar.isPending}
                          onClick={() =>
                            desactivar.mutate(r.id, {
                              onSuccess: () => toast.success(`Rango "${r.nombre}" desactivado.`),
                              onError: (e) => toast.error(e.message),
                            })
                          }
                          data-testid="pyr-desactivar-rango"
                        >
                          Quitar
                        </Button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Esta tabla la <b>defines tú</b>: cuántos niveles, sus rangos de operaciones, nombres y el
          tiempo de costura de cada uno (no es una escala fija 1-6). El <b># de operaciones</b> de
          cada prenda se captura en el <b>desarrollo del modelo</b> y cae en uno de estos rangos →
          determina su dificultad y su tiempo de costura. Deja el límite superior vacío para un
          rango abierto ("33+"). Los rangos no pueden traslaparse (lo valida el servidor).
        </p>
      </div>

      <Dialog
        open={dialogo.abierto}
        onOpenChange={(abierto) => setDialogo((d) => ({ ...d, abierto }))}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogo.rango === null ? 'Agregar rango' : 'Editar rango'}</DialogTitle>
            <DialogDescription>
              Rango de # de operaciones → nombre de dificultad + días de costura.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="rango-desde">Operaciones desde</Label>
                <Input
                  id="rango-desde"
                  type="number"
                  min={1}
                  value={form.opsDesde}
                  onChange={(e) => setForm((f) => ({ ...f, opsDesde: e.target.value }))}
                  data-testid="rango-ops-desde"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="rango-hasta">Hasta (vacío = abierto)</Label>
                <Input
                  id="rango-hasta"
                  type="number"
                  min={1}
                  value={form.opsHasta}
                  onChange={(e) => setForm((f) => ({ ...f, opsHasta: e.target.value }))}
                  data-testid="rango-ops-hasta"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rango-nombre">Nombre de la dificultad</Label>
              <Input
                id="rango-nombre"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                placeholder="Muy sencillo, Medio, Complejo…"
                data-testid="rango-nombre"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rango-dias">Días de costura</Label>
              <Input
                id="rango-dias"
                type="number"
                min={0}
                value={form.diasCostura}
                onChange={(e) => setForm((f) => ({ ...f, diasCostura: e.target.value }))}
                data-testid="rango-dias"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogo({ abierto: false, rango: null })}
              disabled={guardando}
            >
              Cancelar
            </Button>
            <Button
              onClick={guardar}
              disabled={
                guardando ||
                form.opsDesde.trim() === '' ||
                form.nombre.trim() === '' ||
                form.diasCostura.trim() === ''
              }
              data-testid="rango-guardar"
            >
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ── Card: duración por catálogo (DuracionPorTipoTela re-vestida — velocidad de recepción) ──

function CardDuracionPorCatalogo(): React.JSX.Element {
  const consulta = useDuracionesTelaRc(false);
  return (
    <section className="overflow-hidden rounded-lg border bg-card" data-testid="pyr-card-catalogo">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">Duración por catálogo</h2>
        <span className="text-xs text-muted-foreground">velocidad de recepción de la tela</span>
        <Link
          className="ml-auto text-xs underline"
          to="/ruta-critica/reglas-duracion"
          data-testid="pyr-editar-catalogo"
        >
          Editar en Reglas de duración
        </Link>
      </header>
      <div className="p-3">
        {consulta.isPending ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {(consulta.data ?? []).map((t) => (
              <li key={t.id} className="flex justify-between gap-4 rounded border px-2.5 py-1.5">
                <span>{t.nombre}</span>
                <b className="tabular-nums">{t.dias} d</b>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Es la <b>velocidad con que llega la tela</b> (no el material): Local · Nacional ·
          Importada, con sus días de espera. Alimenta los procesos con tiempo "según la velocidad de
          recepción" (p. ej. Recepción de tela). El catálogo real lo define Daniel.
        </p>
      </div>
    </section>
  );
}
