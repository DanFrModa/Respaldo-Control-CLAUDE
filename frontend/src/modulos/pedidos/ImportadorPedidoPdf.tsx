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
import { useEffect, useMemo, useRef, useState } from 'react';
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

/** Un renglón-pack editable: su letra (o null = sin sufijo) y su corrida por talla. */
type RenglonPackEditable = { letra: string | null; tallas: Record<string, number> };

/**
 * Título del color (primera letra de cada palabra en Mayúscula, resto minúscula): "AZUL INDIGO" → "Azul
 * Indigo". Espeja `tituloColor` del backend para que la vista previa coincida con lo que se guarda.
 */
function tituloColor(base: string): string {
  return base
    .toLowerCase()
    .replace(/\p{L}[\p{L}'’]*/gu, (p) => p.charAt(0).toUpperCase() + p.slice(1));
}

/** Compone el color de un renglón-pack para mostrarlo: `{Base} {LETRA}` (o sólo `Base`). */
function componerColorUI(base: string, letra: string | null): string {
  const nombre = tituloColor(base);
  return letra !== null && letra !== '' ? `${nombre} ${letra.toUpperCase()}` : nombre;
}

/**
 * Deriva los RENGLONES-PACK editables de un renglón del análisis: un renglón por grupo (si la OC trae ≥2
 * packs, color `{color} {letra}`) o uno solo SIN sufijo (0/1 pack). Espeja `filasDesdePropuesta` del
 * backend para que la propuesta prefilleada coincida con lo que se crea si el usuario no edita.
 */
function filasDesdePreview(r: RenglonPdfPreview): RenglonPackEditable[] {
  if (r.grupos.length >= 2) {
    return r.grupos.map((g) => ({
      letra: g.grupo,
      tallas: Object.fromEntries(g.desglose.map((c) => [c.talla, c.propuesta])),
    }));
  }
  return [
    { letra: null, tallas: Object.fromEntries(r.tallas.map((t) => [t.talla, t.piezasFabricar])) },
  ];
}

/** Columnas (tallas) de la matriz por packs: las del PDF primero, luego cualquier extra de los packs. */
function columnasTallas(r: RenglonPdfPreview, filas: RenglonPackEditable[]): string[] {
  const vistas = new Set<string>();
  const orden: string[] = [];
  const registrar = (talla: string): void => {
    if (!vistas.has(talla)) {
      vistas.add(talla);
      orden.push(talla);
    }
  };
  for (const t of r.tallas) registrar(t.talla);
  for (const f of filas) for (const talla of Object.keys(f.tallas)) registrar(talla);
  return orden;
}

/** Suma de las tallas de un renglón-pack. */
function totalFila(fila: RenglonPackEditable): number {
  return Object.values(fila.tallas).reduce((s, n) => s + n, 0);
}

/** Suma de todos los renglones-pack de un PDF (total a fabricar). */
function totalFilas(filas: RenglonPackEditable[] | undefined): number {
  return (filas ?? []).reduce((s, f) => s + totalFila(f), 0);
}

export function ImportadorPedidoPdf({
  alCerrar,
  alImportado,
  idClienteInicial = null,
  archivosIniciales,
}: {
  alCerrar: () => void;
  /** Callback tras crear el pedido (refresca la consulta y cierra). */
  alImportado: () => void;
  /**
   * ⭐ §Post-F9.70 punto 1 — ENTRADA DESDE EL PEDIDO. El campo "Archivo de la OC" del constructor
   * reconoce el PDF y, si el usuario dice que sí, abre ESTE importador ya cargado: mismo cliente,
   * mismo archivo. Sin esto habría que reusar el importador copiándolo, que es como se acaban
   * teniendo dos importadores que se parecen.
   */
  idClienteInicial?: number | null;
  /** PDFs con los que arranca el asistente (cuando lo abre el constructor con el archivo ya elegido). */
  archivosIniciales?: File[];
}): React.JSX.Element {
  const [paso, setPaso] = useState<1 | 2>(1);

  // Paso 1 — origen.
  const [idCliente, setIdCliente] = useState<number | null>(idClienteInicial);
  const [textoCliente, setTextoCliente] = useState('');
  const busquedaCliente = useDebounce(textoCliente.trim(), 250);
  const [referencia, setReferencia] = useState('');
  const [archivos, setArchivos] = useState<File[]>(archivosIniciales ?? []);
  /**
   * % ADICIONAL de producción por cliente (C&A = 7%, §Post-F9.2): se pre-carga del formato guardado
   * del cliente.
   *
   * ⭐ V1-E3i — `null` NO es `0`. Antes arrancaba en `0` y ese cero VIAJABA: el backend hace
   * `datos.porcentajeAdicional ?? config.porcentajeAdicional`, así que un `0` explícito le GANA a la
   * plantilla del cliente. Mientras el % del cliente no haya llegado (viene por red), la pantalla no
   * tiene opinión: `null` = "usa el del cliente" y no se manda el campo. Un `0` sólo sale de aquí
   * cuando una persona lo escribió, que es cuando de verdad significa "cero por ciento".
   *
   * Esto NO es cosmético: el arranque automático desde el pedido (§Post-F9.70 punto 1) analiza al
   * montar, cuando el % del cliente todavía no llegó — con el cero de arranque, la OC de Daniel
   * (1,744 pzas) se proponía con 1,744 en vez de 1,866 y las OPs nacían con la cantidad exacta del
   * cliente: EL MISMO defecto (§Post-F9.70 punto 2) que esta etapa vino a cerrar, por la puerta
   * nueva. Y al confirmar, ese cero se GUARDABA como % del cliente, tumbando el 7% sembrado.
   */
  const [pct, setPct] = useState<number | null>(null);

  // Análisis del backend (un renglón por PDF).
  const [analisis, setAnalisis] = useState<AnalizarPdf | null>(null);
  // Ligas modelo-del-cliente → nuestro modelo (pre-cargadas con la sugerencia aprendida).
  const [ligas, setLigas] = useState<Record<string, number>>({});
  // Matriz EDITABLE por PDF (índice → RENGLONES-PACK) prefilleada con la propuesta por packs, y el pantone
  // por PDF. Daniel: cada OC de C&A trae un renglón POR PACK; el sistema PROPONE, el usuario DECIDE celda
  // por celda y renglón por renglón (para integrar un pack en otro, mueve los números entre renglones).
  const [matrices, setMatrices] = useState<Record<number, RenglonPackEditable[]>>({});
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

  /**
   * ⭐ V1-E3i — CAMBIAR DE CLIENTE DEVUELVE LA DECISIÓN DEL % AL CLIENTE NUEVO.
   *
   * El efecto de arriba sólo escribe `pct` cuando el cliente TIENE plantilla (`pctGuardado !== null`)
   * —y así debe ser, para no pisar lo que la persona tecleó cuando la consulta se refresca—, pero por
   * eso mismo no puede devolver `pct` a "sin opinión": si el cliente nuevo NO tiene plantilla, el %
   * del ANTERIOR se quedaba pegado. Consecuencia real: elegir C&A (7%), darse cuenta de que la OC es
   * de otro cliente, cambiarlo y confirmar → las OPs del otro cliente nacen con +7% que nadie pidió y
   * el backend le CREA una plantilla vigente al 7% con los campos variables de C&A encima. Silencioso
   * y permanente (`guardarPlantilla` no edita: crea versión nueva y baja la anterior, y el seed sólo
   * siembra cuando el cliente no tiene ninguna).
   *
   * Se limpia sólo cuando el cliente CAMBIA de verdad: volver a elegir al mismo no borra lo tecleado.
   */
  function elegirCliente(id: number | null): void {
    if (id !== idCliente) setPct(null);
    setIdCliente(id);
  }

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
  /**
   * ⭐ §Post-F9.70 punto 3 — EL BOTÓN MUDO. «Generar pedido interno + OPs» solo se enciende cuando al
   * menos un renglón está ligado a un modelo nuestro… y en la PRIMERA OC de un modelo esa liga
   * todavía no existe, porque se APRENDE. Deshabilitado y callado, la pantalla ofrecía una puerta sin
   * decir por qué no abre (el mismo defecto que V1-E6b barrió en otras pantallas). Aquí se dice qué
   * falta y CUÁNTOS renglones. `null` = no hay nada que explicar (el botón sí abre).
   */
  const motivoBloqueo: string | null = (() => {
    if (cuantosImportan > 0) return null;
    if (renglones.length === 0) return 'Todavía no hay ningún PDF analizado.';
    const conError = renglones.filter((r) => r.error !== null).length;
    const sinLiga = renglones.length - conError;
    if (sinLiga === 0) {
      return conError === 1
        ? 'El PDF no se pudo leer, así que no hay nada que importar. Revisa que sea una OC del cliente y vuelve a cargarlo.'
        : `Ninguno de los ${String(conError)} PDF se pudo leer, así que no hay nada que importar. Revisa que sean OC del cliente y vuelve a cargarlos.`;
    }
    return (
      `Falta ligar ${String(sinLiga)} de ${String(renglones.length)} renglón(es) con un modelo ` +
      'nuestro: elígelo en «Liga a nuestro modelo». La primera vez de cada modelo del cliente se ' +
      'elige a mano; a partir de ahí el sistema lo propone solo.' +
      (conError > 0
        ? ` (${String(conError)} PDF no se pudo leer y queda fuera aunque ligues los demás.)`
        : '')
    );
  })();

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
        {
          idCliente,
          archivos: archivosB64,
          // Sin opinión de la pantalla, manda el CLIENTE (su plantilla). Ver el comentario de `pct`.
          ...(pct === null ? {} : { porcentajeAdicional: pct }),
        },
        {
          onSuccess: (res) => {
            setAnalisis(res);
            // NO se pre-cargan las ligas sugeridas: `idModeloDe` cae a `idModeloSugerido` y el renglón
            // se muestra como "liga aprendida". Al confirmar, los renglones no tocados NO mandan liga
            // manual → el backend usa la liga aprendida (`ClienteModeloLiga`). Sólo lo que el usuario
            // cambia queda en `ligas`.
            setLigas({});
            // Prefill de la matriz editable (renglones-pack con la propuesta) y del pantone, por PDF.
            const m: Record<number, RenglonPackEditable[]> = {};
            const p: Record<number, string> = {};
            res.renglones.forEach((r, i) => {
              m[i] = filasDesdePreview(r);
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

  /**
   * ⭐ §Post-F9.70 punto 1 — si el importador se abrió DESDE el pedido (con cliente y archivo ya
   * puestos), el usuario ya dijo "sí, cárgala": obligarlo a pulsar "Continuar" otra vez sería
   * cobrarle un clic por una decisión que ya tomó. El `ref` es el guardia: el efecto se dispara UNA
   * sola vez aunque React vuelva a montar (StrictMode) o el análisis cambie el estado.
   *
   * Se re-analiza aquí en lugar de recibir el análisis del constructor: es una lectura sin efectos,
   * y pasar el resultado a medias obligaría a sincronizar dos copias del mismo estado — la clase de
   * atajo que después se paga.
   */
  const arranqueAutomatico = useRef(false);
  useEffect(() => {
    if (arranqueAutomatico.current) return;
    if (idClienteInicial === null || (archivosIniciales ?? []).length === 0) return;
    arranqueAutomatico.current = true;
    continuarDesdeOrigen();
    // Sólo debe correr en el montaje con lo precargado; `continuarDesdeOrigen` lee estado que en ese
    // momento ya viene de las props (los `useState` se inicializan con ellas).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Paso 2 → confirma: crea pedido + OPs + RC + adjuntos. */
  function confirmarImportacion(): void {
    if (idCliente === null) return;
    void archivosABase64(archivos).then((archivosB64) => {
      const resoluciones = Object.entries(ligas).map(([modeloCliente, idModelo]) => ({
        modeloCliente,
        idModelo,
      }));
      // Cada PDF viaja con su matriz EDITADA como RENGLONES-PACK ({letra, corrida}) y su pantone. El orden
      // de `archivosB64` coincide 1:1 con las filas de la vista previa (mismo orden analizado) → el índice liga.
      const archivosConAjuste = archivosB64.map((a, i) => ({
        ...a,
        matriz: (matrices[i] ?? []).map((fila) => ({
          letra: fila.letra,
          tallas: Object.entries(fila.tallas).map(([talla, cantidad]) => ({ talla, cantidad })),
        })),
        pantone: (pantones[i] ?? '').trim(),
      }));
      confirmar.mutate(
        {
          idCliente,
          referenciaGeneral: referencia.trim() === '' ? null : referencia.trim(),
          archivos: archivosConAjuste,
          ligas: resoluciones,
          // Igual que al analizar: sin opinión, no se manda — el backend RECUERDA el % que reciba,
          // así que mandar un 0 de arranque borraría el 7% del cliente.
          ...(pct === null ? {} : { porcentajeAdicional: pct }),
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
              onIdCliente={elegirCliente}
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
              onCelda={(i, filaIdx, talla, cantidad) =>
                setMatrices((prev) => {
                  const filas = prev[i] ?? [];
                  const nuevas = filas.map((f, fi) =>
                    fi === filaIdx ? { ...f, tallas: { ...f.tallas, [talla]: cantidad } } : f,
                  );
                  return { ...prev, [i]: nuevas };
                })
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
        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
          {/* §Post-F9.70 punto 3: el porqué del botón apagado va A LA VISTA, no escondido en un
              tooltip que en móvil ni existe. */}
          {paso === 2 && motivoBloqueo !== null ? (
            <p
              className="mr-auto max-w-xl rounded-md border border-warn/30 bg-warn-soft px-2 py-1.5 text-xs text-warn"
              data-testid="importador-pdf-motivo-bloqueo"
            >
              {motivoBloqueo}
            </p>
          ) : null}
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
              {...(motivoBloqueo === null ? {} : { title: motivoBloqueo })}
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
  /** `null` = sin opinión de la pantalla: manda el % guardado del cliente. */
  pct: number | null;
  onPct: (valor: number | null) => void;
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
              value={pct === null ? '' : pct}
              onChange={(e) => onPct(e.target.value === '' ? null : Number(e.target.value) || 0)}
              placeholder="el del cliente"
              data-testid="importador-pdf-pct"
            />
            <span className="text-[11px] text-faint">
              C&amp;A acepta entregar hasta 5% de más; con la merma se fabrica ~7% arriba. Se
              recuerda por cliente; en blanco se usa el suyo.
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

/** Paso 2 · Vista previa: un renglón por PDF (liga a modelo + matriz EDITABLE por packs + advertencias). */
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
  matrices: Record<number, RenglonPackEditable[]>;
  pantones: Record<number, string>;
  onCelda: (i: number, filaIdx: number, talla: string, cantidad: number) => void;
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
  // Total a fabricar = suma de las matrices EDITADAS por packs (refleja lo que el usuario decidió).
  const totalFabricar = renglones.reduce((s, _r, i) => s + totalFilas(matrices[i]), 0);
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
              filas={matrices[i] ?? []}
              pantone={pantones[i] ?? ''}
              onCelda={(filaIdx, talla, cantidad) => onCelda(i, filaIdx, talla, cantidad)}
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

/** Una tarjeta de vista previa por PDF (una OC): liga + matriz editable POR PACK + pantone. */
function FilaPdf({
  r,
  indice,
  filas,
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
  filas: RenglonPackEditable[];
  pantone: string;
  onCelda: (filaIdx: number, talla: string, cantidad: number) => void;
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
  const totalFabricar = totalFilas(filas);
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
            Color <b>{tituloColor(r.colorGenerico)}</b>
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
        {/* V1-E4 (punto 1): esta OC del cliente YA parió su OP. El renglón se marca fuerte —no se
            va a importar— para que nadie confirme creyendo que hace falta. */}
        {r.yaImportado !== null ? (
          <ChipEstado tono="crit">ya importada · OP {r.yaImportado.folioOrden}</ChipEstado>
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
          <MatrizPacksEditable r={r} filas={filas} onCelda={onCelda} />
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
            <p
              key={i}
              /* El duplicado NO es un aviso más: ese PDF no se importa. Va en rojo. */
              className={a.tipo === 'duplicado' ? 'text-[11px] text-crit' : 'text-[11px] text-warn'}
            >
              {a.mensaje}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Matriz EDITABLE POR PACK: una fila "Cliente pidió" (solo lectura, agregada) + una fila EDITABLE por pack
 * (`{color} {letra}`) con inputs por talla y su total, más el total general. Cada OC de C&A trae un renglón
 * POR PACK; para "integrar" un pack en otro el usuario mueve los números entre renglones (vaciar un pack =
 * ponerlo en 0 → no genera línea en la OP).
 */
function MatrizPacksEditable({
  r,
  filas,
  onCelda,
}: {
  r: RenglonPdfPreview;
  filas: RenglonPackEditable[];
  onCelda: (filaIdx: number, talla: string, cantidad: number) => void;
}): React.JSX.Element {
  const columnas = columnasTallas(r, filas);
  const colorBase = r.colorGenerico;
  const pidioPorTalla = new Map(r.tallas.map((t) => [t.talla, t.piezas] as const));
  const totalPidio = r.tallas.reduce((s, t) => s + t.piezas, 0);
  const granTotal = totalFilas(filas);
  return (
    <div className="overflow-x-auto" data-testid="importador-pdf-matriz">
      <table className="w-full min-w-max border-collapse text-[11px]">
        <thead>
          <tr className="text-muted-foreground">
            <th className="px-1.5 py-1 text-left font-medium">Pack</th>
            {columnas.map((talla) => (
              <th key={talla} className="num px-1.5 py-1 text-center font-medium">
                {talla}
              </th>
            ))}
            <th className="px-1.5 py-1 text-center font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr className="text-muted-foreground">
            <td className="px-1.5 py-1 whitespace-nowrap">Cliente pidió</td>
            {columnas.map((talla) => (
              <td key={talla} className="num px-1.5 py-1 text-center">
                {(pidioPorTalla.get(talla) ?? 0).toLocaleString('es-MX')}
              </td>
            ))}
            <td className="num px-1.5 py-1 text-center font-medium">
              {totalPidio.toLocaleString('es-MX')}
            </td>
          </tr>
          {filas.map((fila, fi) => (
            <tr key={fila.letra ?? `fila-${fi}`}>
              <td className="px-1.5 py-1 font-medium whitespace-nowrap text-primary">
                {componerColorUI(colorBase, fila.letra)}
              </td>
              {columnas.map((talla) => (
                <td key={talla} className="px-1 py-1 text-center">
                  <input
                    type="number"
                    min={0}
                    value={fila.tallas[talla] ?? 0}
                    onChange={(e) =>
                      onCelda(fi, talla, Math.max(0, Math.round(Number(e.target.value) || 0)))
                    }
                    className="num h-7 w-14 rounded border bg-background px-1 text-center tabular-nums"
                    aria-label={`A fabricar ${componerColorUI(colorBase, fila.letra)} talla ${talla}`}
                    data-testid={`importador-pdf-celda-${fi}-${talla}`}
                  />
                </td>
              ))}
              <td className="num px-1.5 py-1 text-center font-semibold text-primary">
                {totalFila(fila).toLocaleString('es-MX')}
              </td>
            </tr>
          ))}
          <tr className="border-t">
            <td className="px-1.5 py-1 font-medium whitespace-nowrap">A fabricar</td>
            {columnas.map((talla) => (
              <td key={talla} className="num px-1.5 py-1 text-center text-muted-foreground">
                {filas.reduce((s, f) => s + (f.tallas[talla] ?? 0), 0).toLocaleString('es-MX')}
              </td>
            ))}
            <td className="num px-1.5 py-1 text-center font-semibold text-primary">
              {granTotal.toLocaleString('es-MX')}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
