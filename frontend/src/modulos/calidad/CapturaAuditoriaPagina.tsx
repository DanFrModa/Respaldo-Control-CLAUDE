import { ArrowLeftRight, ClipboardCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useAuditoria, useCapturarResultado, useDefectos, useReclasificar } from '@/api/calidad';
import { ETIQUETAS_RESULTADO_AUDITORIA, RESULTADOS_AUDITORIA } from '@/api/esquemas';
import { useOrden } from '@/api/ordenes';
import type { AuditoriaDefecto, ResultadoAuditoria } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import {
  MatrizColorTalla,
  type MatrizLinea,
  type MatrizTalla,
} from '@/componentes/matriz-color-talla/MatrizColorTalla';
import {
  aLineasApi,
  coloresDeOrden,
  lineasVaciasDeOrden,
  tallasDeOrden,
  totalMatriz,
} from '@/modulos/produccion/matriz-orden';
import { useSesion } from '@/sesion/useSesion';

/** Una fila editable del grid de defectos (idDefecto + datos del defecto + fallas locales). */
type FilaDefecto = Pick<
  AuditoriaDefecto,
  'idDefecto' | 'clave' | 'descripcion' | 'nivelAQL' | 'favorito' | 'activo'
> & { numFallas: number };

/** Un nivel de la sugerencia recalculada en vivo. */
interface NivelSugerido {
  nivelAQL: number;
  totalFallas: number;
  aceptar: number;
  rechazar: number;
  sugerencia: 'aprobar' | 'reprobar';
}

/**
 * CAPTURA DE RESULTADOS de una auditoría (F6-E2, doc 09 §2). Grid de defectos × nº de fallas con la
 * SUGERENCIA por nivel AQL en vivo (Σ fallas del nivel vs su Ac/Re) — pero el VEREDICTO lo decide el
 * humano (decisión (a)): la sugerencia es solo informativa, NO determina el resultado. Permite
 * sobre-escribir la muestra (decisión (b)), agregar defectos no-favoritos y reclasificar prendas
 * Primeras↔Segundas (traspaso de kardex, D3). `calidad.actualizar-auditorias` gobierna la captura.
 */
export function CapturaAuditoriaPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeActualizar = tienePermiso('calidad.actualizar-auditorias');
  const params = useParams<{ id: string }>();
  const id = params.id !== undefined ? Number(params.id) : undefined;

  const consulta = useAuditoria(id);
  const capturar = useCapturarResultado();
  const auditoria = consulta.data;

  // Estado local de captura, sembrado del detalle (una vez por auditoría).
  const [cargado, setCargado] = useState<number | undefined>(undefined);
  const [filas, setFilas] = useState<FilaDefecto[]>([]);
  const [resultado, setResultado] = useState<ResultadoAuditoria>('no_calificado');
  const [observaciones, setObservaciones] = useState('');
  const [muestra, setMuestra] = useState('');

  useEffect(() => {
    if (auditoria !== undefined && cargado !== auditoria.id) {
      setFilas(auditoria.defectos.map((d) => ({ ...d })));
      setResultado(auditoria.resultado);
      setObservaciones(auditoria.observaciones ?? '');
      setMuestra(String(auditoria.tamanoMuestra));
      setCargado(auditoria.id);
    }
  }, [auditoria, cargado]);

  // Catálogo de defectos activos para agregar renglones no-favoritos.
  const catalogo = useDefectos({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'clave',
    direccion: 'asc',
    incluirInactivos: 'false',
  });
  const yaPuestos = new Set(filas.map((f) => f.idDefecto));
  const agregables = (catalogo.data?.datos ?? []).filter((d) => !yaPuestos.has(d.id));

  // Sugerencia por nivel recalculada EN VIVO a partir de las fallas locales + los límites del plan.
  const sugerencia: NivelSugerido[] = useMemo(() => {
    const niveles = auditoria?.sugerencia.niveles ?? [];
    const fallasPorNivel = new Map<number, number>();
    for (const f of filas) {
      fallasPorNivel.set(f.nivelAQL, (fallasPorNivel.get(f.nivelAQL) ?? 0) + f.numFallas);
    }
    return niveles.map((n) => {
      const totalFallas = fallasPorNivel.get(n.nivelAQL) ?? 0;
      return {
        nivelAQL: n.nivelAQL,
        totalFallas,
        aceptar: n.aceptar,
        rechazar: n.rechazar,
        sugerencia: totalFallas <= n.aceptar ? ('aprobar' as const) : ('reprobar' as const),
      };
    });
  }, [auditoria, filas]);
  const sugerenciaGlobal: 'aprobar' | 'reprobar' | null =
    auditoria?.sugerencia.resoluble === true
      ? sugerencia.some((n) => n.sugerencia === 'reprobar')
        ? 'reprobar'
        : 'aprobar'
      : null;

  const totalFallas = filas.reduce((s, f) => s + f.numFallas, 0);

  function cambiarFallas(idDefecto: number, valor: string): void {
    const n = Math.max(0, Math.floor(Number(valor) || 0));
    setFilas((prev) => prev.map((f) => (f.idDefecto === idDefecto ? { ...f, numFallas: n } : f)));
  }

  function agregarDefecto(idDefecto: string): void {
    if (idDefecto === '') return;
    const d = (catalogo.data?.datos ?? []).find((x) => x.id === Number(idDefecto));
    if (d === undefined) return;
    setFilas((prev) => [
      ...prev,
      {
        idDefecto: d.id,
        clave: d.clave,
        descripcion: d.descripcion,
        nivelAQL: d.nivelAQL,
        favorito: d.favorito,
        activo: d.activo,
        numFallas: 0,
      },
    ]);
  }

  function guardar(): void {
    if (id === undefined || auditoria === undefined) return;
    const muestraNum = Number(muestra);
    const cambiaMuestra =
      muestra.trim() !== '' &&
      Number.isFinite(muestraNum) &&
      muestraNum >= 1 &&
      muestraNum !== auditoria.tamanoMuestra;
    capturar.mutate(
      {
        id,
        cuerpo: {
          resultado,
          observaciones: observaciones.trim() === '' ? null : observaciones.trim(),
          defectos: filas.map((f) => ({ idDefecto: f.idDefecto, numFallas: f.numFallas })),
          ...(cambiaMuestra ? { tamanoMuestra: muestraNum } : {}),
        },
      },
      {
        onSuccess: (a) => toast.success(`Auditoría #${a.numAuditoria} guardada (${a.resultado}).`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  if (id === undefined) {
    return <p className="p-6 text-sm text-destructive">Falta el id de la auditoría.</p>;
  }
  if (consulta.isPending) {
    return <p className="p-6 text-sm text-muted-foreground">Cargando auditoría…</p>;
  }
  if (consulta.isError || auditoria === undefined) {
    return (
      <p className="p-6 text-sm text-destructive" role="alert">
        {consulta.error?.message ?? 'No se pudo cargar la auditoría.'}
      </p>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Auditoría #{auditoria.numAuditoria}
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Orden #{auditoria.folioOrden ?? '—'} · {auditoria.codigoModelo ?? '—'} ·{' '}
            {auditoria.maquilero ?? 'sin maquilero'}
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* Grid de defectos × fallas */}
        <Card>
          <CardHeader>
            <CardTitle>Fallas por defecto</CardTitle>
            <CardDescription>
              Captura cuántas prendas de la muestra ({auditoria.tamanoMuestra}) tienen cada defecto.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="auditoria-grid">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2">Clave</th>
                    <th className="py-2 pr-2">Defecto</th>
                    <th className="py-2 pr-2">AQL</th>
                    <th className="py-2 pr-2 text-right">Fallas</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-3 text-muted-foreground">
                        No hay defectos en esta auditoría. Agrega alguno abajo.
                      </td>
                    </tr>
                  ) : (
                    filas.map((f) => (
                      <tr key={f.idDefecto} className="border-b" data-testid="auditoria-fila">
                        <td className="py-1.5 pr-2 font-mono text-xs">{f.clave}</td>
                        <td className="py-1.5 pr-2">{f.descripcion}</td>
                        <td className="py-1.5 pr-2">
                          <Badge variant="secondary">AQL {f.nivelAQL}</Badge>
                        </td>
                        <td className="py-1.5 pr-2 text-right">
                          <Input
                            type="number"
                            min={0}
                            className="ml-auto w-20 text-right"
                            value={String(f.numFallas)}
                            onChange={(e) => cambiarFallas(f.idDefecto, e.target.value)}
                            disabled={!puedeActualizar}
                            aria-label={`Fallas de ${f.clave}`}
                            data-testid={`auditoria-fallas-${String(f.idDefecto)}`}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="font-medium">
                    <td colSpan={3} className="py-2 pr-2 text-right">
                      Total de fallas
                    </td>
                    <td className="py-2 pr-2 text-right" data-testid="auditoria-total-fallas">
                      {totalFallas}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {puedeActualizar ? (
              <Field>
                <FieldLabel htmlFor="agregar-defecto">Agregar defecto</FieldLabel>
                <SelectNativo
                  id="agregar-defecto"
                  value=""
                  onChange={(e) => agregarDefecto(e.target.value)}
                  data-testid="auditoria-agregar-defecto"
                >
                  <option value="">Elige un defecto…</option>
                  {agregables.map((d) => (
                    <option key={d.id} value={String(d.id)}>
                      {d.clave} — {d.descripcion}
                    </option>
                  ))}
                </SelectNativo>
              </Field>
            ) : null}
          </CardContent>
        </Card>

        {/* Sugerencia + veredicto */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="size-4" aria-hidden />
                Sugerencia AQL
              </CardTitle>
              <CardDescription>Informativa: el resultado lo decides tú.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {auditoria.sugerencia.resoluble ? (
                <>
                  <ul className="space-y-1.5 text-sm" data-testid="auditoria-sugerencia">
                    {sugerencia.map((n) => (
                      <li
                        key={n.nivelAQL}
                        className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5"
                      >
                        <span className="text-muted-foreground">AQL {n.nivelAQL}</span>
                        <span>
                          {n.totalFallas} / Ac {n.aceptar} · Re {n.rechazar}
                        </span>
                        <Badge variant={n.sugerencia === 'reprobar' ? 'destructive' : 'secondary'}>
                          {n.sugerencia === 'reprobar' ? 'Reprobar' : 'Aprobar'}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                  {sugerenciaGlobal !== null ? (
                    <p className="text-sm" data-testid="auditoria-sugerencia-global">
                      Sugerencia global:{' '}
                      <strong
                        className={
                          sugerenciaGlobal === 'reprobar' ? 'text-destructive' : 'text-emerald-600'
                        }
                      >
                        {sugerenciaGlobal === 'reprobar' ? 'Reprobar' : 'Aprobar'}
                      </strong>{' '}
                      (no vinculante)
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {auditoria.sugerencia.mensaje ?? 'Sin sugerencia; decide a mano.'}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Resultado</CardTitle>
              <CardDescription>El veredicto es manual (decisión del auditor).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field>
                <FieldLabel htmlFor="resultado">Resultado</FieldLabel>
                <SelectNativo
                  id="resultado"
                  value={resultado}
                  onChange={(e) => setResultado(e.target.value as ResultadoAuditoria)}
                  disabled={!puedeActualizar}
                  data-testid="auditoria-resultado"
                >
                  {RESULTADOS_AUDITORIA.map((r) => (
                    <option key={r} value={r}>
                      {ETIQUETAS_RESULTADO_AUDITORIA[r]}
                    </option>
                  ))}
                </SelectNativo>
              </Field>
              <Field>
                <FieldLabel htmlFor="observaciones">Observaciones</FieldLabel>
                <Input
                  id="observaciones"
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Justifica el veredicto (opcional)"
                  disabled={!puedeActualizar}
                  data-testid="auditoria-observaciones"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="muestra">Tamaño de muestra (override)</FieldLabel>
                <Input
                  id="muestra"
                  type="number"
                  min={1}
                  value={muestra}
                  onChange={(e) => setMuestra(e.target.value)}
                  disabled={!puedeActualizar}
                  data-testid="auditoria-muestra-override"
                />
                {auditoria.muestraManual ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    La muestra se capturó a mano (distinta del plan).
                  </p>
                ) : null}
              </Field>
              <Button
                onClick={guardar}
                disabled={!puedeActualizar || capturar.isPending}
                className="w-full"
                data-testid="auditoria-guardar"
              >
                {capturar.isPending ? 'Guardando…' : 'Guardar resultado'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {puedeActualizar ? (
        <ReclasificacionCard idAuditoria={id} idOrden={auditoria.idOrden} />
      ) : null}
    </div>
  );
}

/**
 * Reclasificación Primeras↔Segundas (traspaso de kardex, D3): captura una matriz color×talla de la
 * orden y un sentido, y mueve esas prendas entre los almacenes "Primeras" y "Segundas". Reusa el
 * componente de matriz y los helpers de orden.
 */
function ReclasificacionCard({
  idAuditoria,
  idOrden,
}: {
  idAuditoria: number;
  idOrden: number;
}): React.JSX.Element {
  const orden = useOrden(idOrden);
  const reclasificar = useReclasificar();
  const [sentido, setSentido] = useState<'a-segundas' | 'a-primeras'>('a-segundas');
  const [lineas, setLineas] = useState<MatrizLinea[]>([]);
  const [tallas, setTallas] = useState<MatrizTalla[]>([]);

  useEffect(() => {
    if (orden.data !== undefined) {
      setTallas(tallasDeOrden(orden.data));
      setLineas(lineasVaciasDeOrden(orden.data));
    }
  }, [orden.data]);

  const total = totalMatriz(lineas);

  function enviar(): void {
    if (total === 0) return;
    reclasificar.mutate(
      { id: idAuditoria, cuerpo: { sentido, lineas: aLineasApi(lineas) } },
      {
        onSuccess: () => {
          toast.success(`Reclasificadas ${total} pza(s) (${sentido}).`);
          if (orden.data !== undefined) setLineas(lineasVaciasDeOrden(orden.data));
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowLeftRight className="size-4" aria-hidden />
          Reclasificar prendas (Primeras ↔ Segundas)
        </CardTitle>
        <CardDescription>
          Mueve prendas entre almacenes con un traspaso de inventario (no edita existencias).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field>
          <FieldLabel htmlFor="sentido">Sentido</FieldLabel>
          <SelectNativo
            id="sentido"
            value={sentido}
            onChange={(e) => setSentido(e.target.value as 'a-segundas' | 'a-primeras')}
            data-testid="reclasif-sentido"
          >
            <option value="a-segundas">Primeras → Segundas (se hallaron defectos)</option>
            <option value="a-primeras">Segundas → Primeras (corrección)</option>
          </SelectNativo>
        </Field>

        {orden.data !== undefined ? (
          <MatrizColorTalla
            testid="reclasif-matriz"
            tallas={tallas}
            lineas={lineas}
            coloresDisponibles={coloresDeOrden(orden.data)}
            tallasDisponibles={tallas}
            onLineasChange={setLineas}
            onTallasChange={setTallas}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Cargando matriz de la orden…</p>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            Total a reclasificar: <strong>{total.toLocaleString('es-MX')}</strong> pzas
          </span>
          <Button
            onClick={enviar}
            disabled={total === 0 || reclasificar.isPending}
            data-testid="reclasif-guardar"
          >
            {reclasificar.isPending ? 'Moviendo…' : 'Reclasificar'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
