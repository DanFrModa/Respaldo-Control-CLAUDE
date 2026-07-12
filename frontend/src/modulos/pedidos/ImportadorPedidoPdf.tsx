import {
  CheckIcon,
  ChevronRight,
  FileText,
  InfoIcon,
  Loader2Icon,
  Plus,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { archivoABase64 } from '@/api/importacion-pedido';
import { useAnalizarPdf, useConfirmarPdf, usePlantillaVigente } from '@/api/importacion-pdf';
import { useClientes } from '@/api/clientes';
import { useModelos, type Modelo } from '@/api/modelos';
import type { AnalizarPdf, RenglonPdfPreview } from '@/api/tipos';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { ComboboxBuscable } from '@/components/dominio/ComboboxBuscable';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounce } from '@/lib/useDebounce';
import { cn } from '@/lib/utils';
import { DialogoModelo } from '@/modulos/modelos/DialogoModelo';
import { useSesion } from '@/sesion/useSesion';

/**
 * IMPORTADOR de OC del cliente por PDF (petición Daniel — plantilla C&A): asistente de 2 pasos que toma
 * VARIOS PDFs de órdenes de compra de C&A y, reusando el motor del backend, crea UN pedido interno donde
 * cada PDF = 1 renglón + 1 OP (con su matriz color×talla) + su Ruta Crítica, y adjunta cada PDF a SU
 * orden.
 *
 *  • Paso 1 · Origen: cliente + (opcional) referencia general + los PDFs (varios).
 *  • Paso 2 · Vista previa (un renglón por PDF): el "Modelo ID" de C&A se liga a NUESTRO modelo (la
 *    sugerencia aprendida viene pre-cargada); se ven división, sub división, piezas por talla, precio y
 *    las advertencias de cuadre. Al generar nacen el pedido + las OPs. El motor real (parseo del PDF,
 *    reconocimiento y alta transaccional) es BACKEND (A1); esta pantalla sólo orquesta.
 */

/** Lee varios `File` como `{ nombreArchivo, archivoBase64 }` para mandarlos al backend. */
async function archivosABase64(
  files: File[],
): Promise<{ nombreArchivo: string; archivoBase64: string }[]> {
  return Promise.all(
    files.map(async (f) => ({ nombreArchivo: f.name, archivoBase64: await archivoABase64(f) })),
  );
}

export function ImportadorPedidoPdf({
  alCerrar,
  alImportado,
}: {
  alCerrar: () => void;
  /** Callback tras crear el pedido (refresca la consulta y cierra). */
  alImportado: () => void;
}): React.JSX.Element {
  const [paso, setPaso] = useState<1 | 2>(1);

  // Paso 1 — origen.
  const [idCliente, setIdCliente] = useState<number | null>(null);
  const [textoCliente, setTextoCliente] = useState('');
  const busquedaCliente = useDebounce(textoCliente.trim(), 250);
  const [referencia, setReferencia] = useState('');
  const [archivos, setArchivos] = useState<File[]>([]);
  // % ADICIONAL de producción por cliente (C&A ~7%): se pre-carga del formato guardado del cliente.
  const [pct, setPct] = useState(0);

  // Análisis del backend (un renglón por PDF).
  const [analisis, setAnalisis] = useState<AnalizarPdf | null>(null);
  // Ligas modelo-del-cliente → nuestro modelo (pre-cargadas con la sugerencia aprendida).
  const [ligas, setLigas] = useState<Record<string, number>>({});
  // Matriz EDITABLE por PDF (índice → talla → total a fabricar) prefilleada con la propuesta por packs, y
  // el pantone por PDF. Daniel: el sistema PROPONE el sobre-pedido, el usuario DECIDE celda por celda.
  const [matrices, setMatrices] = useState<Record<number, Record<string, number>>>({});
  const [pantones, setPantones] = useState<Record<number, string>>({});
  const [busquedaModelo, setBusquedaModelo] = useState('');
  const busquedaModeloDeb = useDebounce(busquedaModelo.trim(), 250);

  const clientes = useClientes({
    pagina: 1,
    porPagina: 100,
    ...(busquedaCliente === '' ? {} : { busqueda: busquedaCliente }),
  });
  const modelos = useModelos({
    pagina: 1,
    porPagina: 100,
    ...(busquedaModeloDeb === '' ? {} : { busqueda: busquedaModeloDeb }),
  });

  // Pre-carga el % adicional GUARDADO del cliente (formato pdf-cya) cuando se elige el cliente.
  const plantilla = usePlantillaVigente(idCliente);
  const pctGuardado = plantilla.data?.plantilla?.porcentajeAdicional ?? null;
  useEffect(() => {
    if (pctGuardado !== null) setPct(pctGuardado);
  }, [pctGuardado]);

  const analizar = useAnalizarPdf();
  const confirmar = useConfirmarPdf();
  const ocupado = analizar.isPending || confirmar.isPending;

  const opcionesCliente = useMemo(
    () => (clientes.data?.datos ?? []).map((c) => ({ id: c.id, nombre: c.nombre })),
    [clientes.data],
  );
  const opcionesModelo = useMemo(
    () =>
      (modelos.data?.datos ?? []).map((m) => ({
        id: m.id,
        nombre: `#${m.codigo}` + (m.descripcion !== null ? ` · ${m.descripcion}` : ''),
      })),
    [modelos.data],
  );

  const renglones = analisis?.renglones ?? [];
  /** Un renglón se importará si tiene liga (sugerida o elegida a mano) y no es un PDF con error. */
  function idModeloDe(r: RenglonPdfPreview): number | null {
    return r.error !== null ? null : (ligas[r.modeloCliente] ?? r.idModeloSugerido ?? null);
  }
  const cuantosImportan = renglones.filter((r) => idModeloDe(r) !== null).length;

  // ── Acciones ──────────────────────────────────────────────────────────────

  function alElegirArchivos(files: FileList | null): void {
    if (files === null) return;
    setArchivos(
      Array.from(files).filter((f) => f.type === 'application/pdf' || f.name.endsWith('.pdf')),
    );
  }

  /** Paso 1 → analiza los PDFs y arma la vista previa. */
  function continuarDesdeOrigen(): void {
    if (idCliente === null) {
      toast.error('Elige el cliente del pedido.');
      return;
    }
    if (archivos.length === 0) {
      toast.error('Carga al menos un PDF del cliente.');
      return;
    }
    void archivosABase64(archivos).then((archivosB64) => {
      analizar.mutate(
        { idCliente, archivos: archivosB64, porcentajeAdicional: pct },
        {
          onSuccess: (res) => {
            setAnalisis(res);
            // NO se pre-cargan las ligas sugeridas: `idModeloDe` cae a `idModeloSugerido` y el renglón
            // se muestra como "liga aprendida". Al confirmar, los renglones no tocados NO mandan liga
            // manual → el backend usa la liga aprendida (`ClienteModeloLiga`). Sólo lo que el usuario
            // cambia queda en `ligas`.
            setLigas({});
            // Prefill de la matriz editable (propuesta a fabricar por talla) y del pantone, por PDF.
            const m: Record<number, Record<string, number>> = {};
            const p: Record<number, string> = {};
            res.renglones.forEach((r, i) => {
              m[i] = Object.fromEntries(r.tallas.map((t) => [t.talla, t.piezasFabricar]));
              p[i] = r.pantone;
            });
            setMatrices(m);
            setPantones(p);
            setPaso(2);
          },
          onError: (error) => toast.error(error.message),
        },
      );
    });
  }

  /** Paso 2 → confirma: crea pedido + OPs + RC + adjuntos. */
  function confirmarImportacion(): void {
    if (idCliente === null) return;
    void archivosABase64(archivos).then((archivosB64) => {
      const resoluciones = Object.entries(ligas).map(([modeloCliente, idModelo]) => ({
        modeloCliente,
        idModelo,
      }));
      // Cada PDF viaja con su matriz EDITADA (total por talla) y su pantone. El orden de `archivosB64`
      // coincide 1:1 con las filas de la vista previa (mismo orden que se analizó), así que el índice liga.
      const archivosConAjuste = archivosB64.map((a, i) => ({
        ...a,
        matriz: Object.entries(matrices[i] ?? {}).map(([talla, cantidad]) => ({ talla, cantidad })),
        pantone: (pantones[i] ?? '').trim(),
      }));
      confirmar.mutate(
        {
          idCliente,
          referenciaGeneral: referencia.trim() === '' ? null : referencia.trim(),
          archivos: archivosConAjuste,
          ligas: resoluciones,
          porcentajeAdicional: pct,
        },
        {
          onSuccess: (res) => {
            const nOp = res.ordenes.length;
            const fuera = res.noReconocidos.length;
            toast.success(
              `Pedido ${res.folioPedido}-F importado · ${nOp} OP(s) con su matriz + RC` +
                (fuera > 0 ? ` · ${fuera} PDF(s) sin ligar quedaron fuera` : ''),
            );
            alImportado();
          },
          onError: (error) => toast.error(error.message),
        },
      );
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/45"
      role="dialog"
      aria-modal="true"
      aria-label="Importar OC del cliente por PDF"
      data-testid="importador-pdf"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !ocupado) alCerrar();
      }}
    >
      <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-background shadow-xl">
        {/* Encabezado */}
        <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
            PDF
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">Importar OC del cliente (PDF)</h2>
            <p className="truncate text-xs text-muted-foreground">
              Varios PDFs de C&amp;A → un pedido interno con una OP (matriz + Ruta Crítica) por PDF
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={alCerrar}
            disabled={ocupado}
            aria-label="Cerrar"
            data-testid="importador-pdf-cerrar"
          >
            <X className="size-5" aria-hidden />
          </Button>
        </header>

        {/* Stepper */}
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5 text-xs">
          {(
            [
              [1, 'Origen'],
              [2, 'Vista previa'],
            ] as const
          ).map(([n, etiqueta], i) => (
            <span key={n} className="flex items-center gap-2">
              {i > 0 ? <ChevronRight className="size-3.5 text-faint" aria-hidden /> : null}
              <span
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium',
                  paso === n
                    ? 'border-primary bg-primary text-primary-foreground'
                    : paso > n
                      ? 'border-primary/40 bg-primary-soft text-primary-soft-foreground'
                      : 'bg-card text-muted-foreground',
                )}
              >
                <b>{n}</b> {etiqueta}
              </span>
            </span>
          ))}
        </div>

        {/* Cuerpo con scroll */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {paso === 1 ? (
            <PasoOrigen
              opcionesCliente={opcionesCliente}
              cargandoClientes={clientes.isFetching}
              idCliente={idCliente}
              onIdCliente={setIdCliente}
              onTextoCliente={setTextoCliente}
              referencia={referencia}
              onReferencia={setReferencia}
              pct={pct}
              onPct={setPct}
              archivos={archivos}
              onArchivos={alElegirArchivos}
            />
          ) : (
            <PasoVistaPrevia
              renglones={renglones}
              porcentajeAdicional={analisis?.porcentajeAdicional ?? 0}
              matrices={matrices}
              pantones={pantones}
              onCelda={(i, talla, cantidad) =>
                setMatrices((prev) => ({
                  ...prev,
                  [i]: { ...(prev[i] ?? {}), [talla]: cantidad },
                }))
              }
              onPantone={(i, valor) => setPantones((prev) => ({ ...prev, [i]: valor }))}
              ligas={ligas}
              idModeloDe={idModeloDe}
              opcionesModelo={opcionesModelo}
              cargandoModelos={modelos.isFetching}
              onLigar={(modeloCliente, id) =>
                setLigas((prev) => {
                  const siguiente = { ...prev };
                  if (id === null) delete siguiente[modeloCliente];
                  else siguiente[modeloCliente] = id;
                  return siguiente;
                })
              }
              onBuscarModelo={setBusquedaModelo}
            />
          )}
        </div>

        {/* Pie de acciones */}
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3">
          <Button variant="outline" onClick={alCerrar} disabled={ocupado}>
            Cancelar
          </Button>
          {paso === 1 ? (
            <Button
              onClick={continuarDesdeOrigen}
              disabled={ocupado || idCliente === null || archivos.length === 0}
              data-testid="importador-pdf-continuar-origen"
            >
              {analizar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Continuar
              <ChevronRight aria-hidden />
            </Button>
          ) : (
            <Button
              onClick={confirmarImportacion}
              disabled={ocupado || cuantosImportan === 0}
              data-testid="importador-pdf-confirmar"
            >
              {confirmar.isPending ? (
                <Loader2Icon className="animate-spin" aria-hidden />
              ) : (
                <CheckIcon aria-hidden />
              )}
              Generar pedido interno + OPs
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}

/** Paso 1 · Origen: cliente + referencia general + los PDFs (varios). */
function PasoOrigen({
  opcionesCliente,
  cargandoClientes,
  idCliente,
  onIdCliente,
  onTextoCliente,
  referencia,
  onReferencia,
  pct,
  onPct,
  archivos,
  onArchivos,
}: {
  opcionesCliente: { id: number; nombre: string }[];
  cargandoClientes: boolean;
  idCliente: number | null;
  onIdCliente: (id: number | null) => void;
  onTextoCliente: (texto: string) => void;
  referencia: string;
  onReferencia: (valor: string) => void;
  pct: number;
  onPct: (valor: number) => void;
  archivos: File[];
  onArchivos: (files: FileList | null) => void;
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          ¿De qué cliente es el pedido?
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Cliente</span>
            <ComboboxBuscable
              opciones={opcionesCliente}
              valor={idCliente}
              onChange={onIdCliente}
              alCambiarTexto={onTextoCliente}
              cargando={cargandoClientes}
              placeholder="Elige el cliente"
              etiqueta="Cliente del pedido"
              testid="importador-pdf-cliente"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Referencia general (opcional)</span>
            <Input
              value={referencia}
              onChange={(e) => onReferencia(e.target.value)}
              placeholder="Ej. remesa / semana"
              data-testid="importador-pdf-referencia"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">% adicional de producción</span>
            <Input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={pct}
              onChange={(e) => onPct(Number(e.target.value) || 0)}
              placeholder="0"
              data-testid="importador-pdf-pct"
            />
            <span className="text-[11px] text-faint">
              C&amp;A acepta entregar hasta 5% de más; con la merma se fabrica ~7% arriba. Se
              recuerda por cliente.
            </span>
          </label>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          PDFs de las órdenes de compra (C&amp;A)
        </h3>
        <label
          className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center text-sm transition-colors hover:border-primary hover:bg-primary-soft/40"
          data-testid="importador-pdf-dropzone"
        >
          {archivos.length === 0 ? (
            <>
              <Upload className="size-6 text-muted-foreground" aria-hidden />
              <span className="text-muted-foreground">
                Elige uno o varios PDFs de C&amp;A (cada PDF será una orden con su matriz de tallas)
              </span>
            </>
          ) : (
            <span className="flex items-center gap-2 font-medium">
              <FileText className="size-5 text-primary" aria-hidden />
              {archivos.length} PDF(s) seleccionado(s)
              <span className="text-xs font-normal text-muted-foreground">(clic para cambiar)</span>
            </span>
          )}
          <input
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            data-testid="importador-pdf-archivos"
            onChange={(e) => onArchivos(e.target.files)}
          />
        </label>
        {archivos.length > 0 ? (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {archivos.map((a) => (
              <li key={a.name} className="flex items-center gap-2">
                <FileText className="size-3.5 shrink-0 text-primary" aria-hidden />
                <span className="truncate">{a.name}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

/** Suma de una matriz editable (talla → cantidad). */
function sumaMatriz(matriz: Record<string, number> | undefined): number {
  return Object.values(matriz ?? {}).reduce((s, n) => s + n, 0);
}

/** Paso 2 · Vista previa: un renglón por PDF (liga a modelo + matriz EDITABLE + packs + advertencias). */
function PasoVistaPrevia({
  renglones,
  porcentajeAdicional,
  matrices,
  pantones,
  onCelda,
  onPantone,
  ligas,
  idModeloDe,
  opcionesModelo,
  cargandoModelos,
  onLigar,
  onBuscarModelo,
}: {
  renglones: RenglonPdfPreview[];
  porcentajeAdicional: number;
  matrices: Record<number, Record<string, number>>;
  pantones: Record<number, string>;
  onCelda: (i: number, talla: string, cantidad: number) => void;
  onPantone: (i: number, valor: string) => void;
  ligas: Record<string, number>;
  idModeloDe: (r: RenglonPdfPreview) => number | null;
  opcionesModelo: { id: number; nombre: string }[];
  cargandoModelos: boolean;
  onLigar: (modeloCliente: string, id: number | null) => void;
  onBuscarModelo: (texto: string) => void;
}): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeCrearModelo = tienePermiso('modelos.administrar');
  // Alta de modelo NUEVO desde el preview (petición Daniel): abrir el alta ESTÁNDAR prellenada y, al
  // crear, dejar el modelo ligado a ese PDF. La creación es el POST normal (FUERA de la tx del
  // confirmar). `modelosCreados` recuerda el código para etiquetar el combobox (aún no está en la
  // búsqueda paginada). `advertirPara` sostiene la advertencia blanda cuando el Modelo ID ya está
  // ligado a otro modelo (3b: no bloquea, Daniel decide).
  const [crearPara, setCrearPara] = useState<{ modeloCliente: string; descripcion: string } | null>(
    null,
  );
  const [advertirPara, setAdvertirPara] = useState<{
    modeloCliente: string;
    descripcion: string;
    codigoLigado: string;
  } | null>(null);
  const [modelosCreados, setModelosCreados] = useState<
    Record<string, { id: number; codigo: string }>
  >({});

  function solicitarCrearModelo(r: RenglonPdfPreview): void {
    const base = { modeloCliente: r.modeloCliente, descripcion: r.descripcionArticulo };
    if (r.idModeloSugerido !== null && r.codigoModeloSugerido !== null) {
      setAdvertirPara({ ...base, codigoLigado: r.codigoModeloSugerido });
    } else {
      setCrearPara(base);
    }
  }

  function alModeloCreado(modeloCliente: string, modelo: Modelo): void {
    setModelosCreados((prev) => ({
      ...prev,
      [modeloCliente]: { id: modelo.id, codigo: modelo.codigo },
    }));
    onLigar(modeloCliente, modelo.id);
    setCrearPara(null);
  }

  const totalPiezas = renglones.reduce(
    (s, r) => s + r.tallas.reduce((ss, t) => ss + t.piezas, 0),
    0,
  );
  // Total a fabricar = suma de las matrices EDITADAS (refleja lo que el usuario decidió).
  const totalFabricar = renglones.reduce((s, _r, i) => s + sumaMatriz(matrices[i]), 0);
  const aImportar = renglones.filter((r) => idModeloDe(r) !== null).length;
  const conAdicional = porcentajeAdicional > 0;
  const cambio = totalFabricar !== totalPiezas;
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
        <span>
          Cada PDF es una orden de compra. Liga su <b>Modelo ID</b> a <b>nuestro modelo</b> (la
          sugerencia aprendida viene pre-cargada). El sistema <b>propone</b> el sobre-pedido por
          packs
          {conAdicional ? (
            <>
              {' '}
              (<b>+{porcentajeAdicional}%</b>)
            </>
          ) : null}{' '}
          y tú <b>ajustas la matriz</b> celda por celda antes de generar. El renglón del pedido
          conserva lo que pidió el cliente; la <b>OP se fabrica con la matriz de abajo</b>.
        </span>
      </p>

      <div className="space-y-3">
        {renglones.map((r, i) => {
          const creado = modelosCreados[r.modeloCliente];
          const etiquetaModeloCreado =
            creado !== undefined && idModeloDe(r) === creado.id ? `#${creado.codigo}` : undefined;
          return (
            <FilaPdf
              key={`${r.nombreArchivo}-${i}`}
              r={r}
              indice={i}
              matriz={matrices[i] ?? {}}
              pantone={pantones[i] ?? ''}
              onCelda={(talla, cantidad) => onCelda(i, talla, cantidad)}
              onPantone={(valor) => onPantone(i, valor)}
              valorLiga={idModeloDe(r)}
              usaSugerencia={ligas[r.modeloCliente] === undefined && r.idModeloSugerido !== null}
              etiquetaModeloCreado={etiquetaModeloCreado}
              opcionesModelo={opcionesModelo}
              cargandoModelos={cargandoModelos}
              onLigar={(id) => onLigar(r.modeloCliente, id)}
              onBuscarModelo={onBuscarModelo}
              puedeCrearModelo={puedeCrearModelo}
              onCrearModelo={() => solicitarCrearModelo(r)}
            />
          );
        })}
      </div>

      <p className="text-[11px] text-faint" data-testid="importador-pdf-total">
        <b>{aImportar}</b> de {renglones.length} PDF(s) se importarán · pedidas{' '}
        {totalPiezas.toLocaleString('es-MX')} pz
        {cambio ? (
          <>
            {' '}
            → a fabricar <b>{totalFabricar.toLocaleString('es-MX')} pz</b>
            {conAdicional ? ` (+${porcentajeAdicional}%)` : ''}
          </>
        ) : null}
        .
      </p>

      {/* 3b · Advertencia blanda: el Modelo ID ya está ligado a otro modelo (no bloquea). */}
      {advertirPara !== null ? (
        <DialogoConfirmacion
          abierto
          alCambiarAbierto={(a) => {
            if (!a) setAdvertirPara(null);
          }}
          titulo="Este Modelo ID ya está ligado"
          descripcion={
            <>
              El Modelo ID <b>{advertirPara.modeloCliente}</b> ya está ligado al modelo{' '}
              <b>{advertirPara.codigoLigado}</b>. ¿Crear de todas formas un modelo nuevo y ligarlo a
              este PDF?
            </>
          }
          textoConfirmar="Sí, crear nuevo"
          alConfirmar={() => {
            setCrearPara({
              modeloCliente: advertirPara.modeloCliente,
              descripcion: advertirPara.descripcion,
            });
            setAdvertirPara(null);
          }}
        />
      ) : null}

      {/* Alta ESTÁNDAR de modelo (reuso), prellenada con la descripción de la OC; al crear queda ligado. */}
      {crearPara !== null ? (
        <DialogoModelo
          abierto
          alCambiarAbierto={(a) => {
            if (!a) setCrearPara(null);
          }}
          modelo={undefined}
          prellenadoAlta={{ descripcion: crearPara.descripcion }}
          alCrear={(m) => alModeloCreado(crearPara.modeloCliente, m)}
        />
      ) : null}
    </div>
  );
}

/** Una tarjeta de vista previa por PDF (una OC): liga + matriz editable + desglose de packs + pantone. */
function FilaPdf({
  r,
  indice,
  matriz,
  pantone,
  onCelda,
  onPantone,
  valorLiga,
  usaSugerencia,
  etiquetaModeloCreado,
  opcionesModelo,
  cargandoModelos,
  onLigar,
  onBuscarModelo,
  puedeCrearModelo,
  onCrearModelo,
}: {
  r: RenglonPdfPreview;
  indice: number;
  matriz: Record<string, number>;
  pantone: string;
  onCelda: (talla: string, cantidad: number) => void;
  onPantone: (valor: string) => void;
  valorLiga: number | null;
  usaSugerencia: boolean;
  /** Etiqueta del modelo recién creado desde el preview (aún no está en la búsqueda paginada). */
  etiquetaModeloCreado: string | undefined;
  opcionesModelo: { id: number; nombre: string }[];
  cargandoModelos: boolean;
  onLigar: (id: number | null) => void;
  onBuscarModelo: (texto: string) => void;
  puedeCrearModelo: boolean;
  onCrearModelo: () => void;
}): React.JSX.Element {
  const [abierto, setAbierto] = useState(false);
  if (r.error !== null) {
    return (
      <div
        className="rounded-lg border border-crit/40 bg-crit-soft/30 px-3 py-2 text-xs"
        data-testid="importador-pdf-fila"
      >
        <div className="flex items-center gap-2 font-medium">
          <FileText className="size-4 shrink-0 text-crit" aria-hidden />
          <span className="truncate">{r.nombreArchivo}</span>
          <ChipEstado tono="crit">no se pudo leer</ChipEstado>
        </div>
        <p className="mt-1 text-crit">{r.error}</p>
      </div>
    );
  }
  const totalPiezas = r.tallas.reduce((s, t) => s + t.piezas, 0);
  const totalFabricar = sumaMatriz(matriz);
  const cambio = totalFabricar !== totalPiezas;
  return (
    <div className="rounded-lg border" data-testid="importador-pdf-fila">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 p-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText className="size-3.5 shrink-0 text-primary" aria-hidden />
            <span className="truncate">{r.nombreArchivo}</span>
          </div>
          <div className="text-sm font-medium">
            OC <span className="num">{r.numeroOrden}</span> · Modelo cliente{' '}
            <span className="num">{r.modeloCliente}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {r.descripcionArticulo}
            {r.division !== '' ? ` · ${r.division}` : ''}
            {r.subDivision !== '' ? ` · ${r.subDivision}` : ''}
          </div>
        </div>
        <div className="w-full sm:w-64">
          <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
            Liga a nuestro modelo
          </span>
          <ComboboxBuscable
            opciones={opcionesModelo}
            valor={valorLiga}
            etiquetaSeleccion={
              etiquetaModeloCreado ??
              (usaSugerencia && r.codigoModeloSugerido !== null
                ? `#${r.codigoModeloSugerido}`
                : undefined)
            }
            onChange={onLigar}
            alCambiarTexto={onBuscarModelo}
            cargando={cargandoModelos}
            placeholder="Elige el modelo…"
            etiqueta={`Ligar ${r.modeloCliente} a un modelo`}
            testid="importador-pdf-ligar"
          />
          {puedeCrearModelo ? (
            <button
              type="button"
              onClick={onCrearModelo}
              className="mt-1 flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              data-testid="importador-pdf-crear-modelo"
            >
              <Plus className="size-3" aria-hidden />
              Crear modelo nuevo
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2 text-xs">
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          className="font-medium text-primary hover:underline"
          data-testid="importador-pdf-toggle-tallas"
        >
          pedidas {totalPiezas.toLocaleString('es-MX')} pz
          {cambio ? ` → fabricar ${totalFabricar.toLocaleString('es-MX')} pz` : ''} en{' '}
          {r.tallas.length} talla(s){abierto ? ' ▲' : ' ▼'}
        </button>
        {r.colorGenerico !== '' ? (
          <span className="text-muted-foreground">
            Color <b>{r.colorGenerico}</b>
            {r.colorNuevo ? <span className="text-warn"> (nuevo)</span> : null}
          </span>
        ) : null}
        {r.tallasNuevas.length > 0 ? (
          <ChipEstado tono="info">{r.tallasNuevas.length} talla(s) nueva(s)</ChipEstado>
        ) : null}
        {r.costoUnitario !== null ? (
          <span className="text-muted-foreground">
            Precio <span className="num">${r.costoUnitario.toLocaleString('es-MX')}</span>
          </span>
        ) : null}
        {valorLiga === null ? (
          <ChipEstado tono="crit">sin ligar</ChipEstado>
        ) : usaSugerencia ? (
          <ChipEstado tono="ok">liga aprendida</ChipEstado>
        ) : (
          <ChipEstado tono="info">ligado a mano</ChipEstado>
        )}
      </div>

      {abierto ? (
        <div className="space-y-3 border-t px-3 py-3">
          <MatrizEditable r={r} matriz={matriz} onCelda={onCelda} />
          {r.grupos.length > 0 ? <DesglosePacks grupos={r.grupos} /> : null}
          <label className="flex items-center gap-2 text-[11px]">
            <span className="font-medium text-muted-foreground">PANTONE del color</span>
            <Input
              value={pantone}
              onChange={(e) => onPantone(e.target.value)}
              placeholder="p. ej. 11-0601 TCX (opcional)"
              className="h-7 w-48 text-xs"
              data-testid={`importador-pdf-pantone-${indice}`}
            />
          </label>
        </div>
      ) : null}

      {r.advertencias.length > 0 ? (
        <div className="border-t px-3 py-2" data-testid="importador-pdf-advertencias">
          {r.advertencias.map((a, i) => (
            <p key={i} className="text-[11px] text-warn">
              {a.mensaje}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Matriz EDITABLE por talla: fila "pidió" (solo lectura) + fila "a fabricar" (inputs) con su total. */
function MatrizEditable({
  r,
  matriz,
  onCelda,
}: {
  r: RenglonPdfPreview;
  matriz: Record<string, number>;
  onCelda: (talla: string, cantidad: number) => void;
}): React.JSX.Element {
  const totalPidio = r.tallas.reduce((s, t) => s + t.piezas, 0);
  const totalFabricar = sumaMatriz(matriz);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-[11px]">
        <thead>
          <tr className="text-muted-foreground">
            <th className="px-1.5 py-1 text-left font-medium"> </th>
            {r.tallas.map((t) => (
              <th key={t.talla} className="px-1.5 py-1 text-center font-medium num">
                {t.talla}
              </th>
            ))}
            <th className="px-1.5 py-1 text-center font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr className="text-muted-foreground">
            <td className="px-1.5 py-1 whitespace-nowrap">Cliente pidió</td>
            {r.tallas.map((t) => (
              <td key={t.talla} className="px-1.5 py-1 text-center num">
                {t.piezas.toLocaleString('es-MX')}
              </td>
            ))}
            <td className="px-1.5 py-1 text-center num font-medium">
              {totalPidio.toLocaleString('es-MX')}
            </td>
          </tr>
          <tr>
            <td className="px-1.5 py-1 font-medium whitespace-nowrap text-primary">A fabricar</td>
            {r.tallas.map((t) => (
              <td key={t.talla} className="px-1 py-1 text-center">
                <input
                  type="number"
                  min={0}
                  value={matriz[t.talla] ?? 0}
                  onChange={(e) =>
                    onCelda(t.talla, Math.max(0, Math.round(Number(e.target.value) || 0)))
                  }
                  className="h-7 w-14 rounded border bg-background px-1 text-center num tabular-nums"
                  aria-label={`A fabricar talla ${t.talla}`}
                  data-testid={`importador-pdf-celda-${t.talla}`}
                />
              </td>
            ))}
            <td className="px-1.5 py-1 text-center num font-semibold text-primary">
              {totalFabricar.toLocaleString('es-MX')}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Desglose de los packs (de dónde sale la propuesta): un renglón por grupo A/B/C. */
function DesglosePacks({ grupos }: { grupos: RenglonPdfPreview['grupos'] }): React.JSX.Element {
  return (
    <div
      className="space-y-1 rounded-md bg-muted/40 px-2 py-1.5"
      data-testid="importador-pdf-packs"
    >
      <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        Propuesta por packs
      </p>
      {grupos.map((g) => (
        <div key={g.grupo} className="flex flex-wrap items-center gap-x-2 text-[11px]">
          <span className="font-medium">
            {g.tipo === 'SKU' ? `Sueltas ${g.grupo}` : `Pack ${g.grupo}`}
          </span>
          <span className="text-muted-foreground">
            {g.tipo === 'SKU'
              ? `${g.desglose.reduce((s, c) => s + c.original, 0)} pz → ${g.desglose.reduce((s, c) => s + c.propuesta, 0)} pz`
              : `${g.packsOriginales} → ${g.packsPropuestos} packs`}
          </span>
          {g.advertencia !== null ? <span className="text-warn">· {g.advertencia}</span> : null}
        </div>
      ))}
    </div>
  );
}
