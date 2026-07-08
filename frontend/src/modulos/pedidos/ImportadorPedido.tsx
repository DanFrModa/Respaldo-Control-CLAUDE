import {
  CheckIcon,
  ChevronRight,
  FileSpreadsheet,
  InfoIcon,
  Loader2Icon,
  Upload,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useSubirAdjuntoPedido } from '@/api/adjuntos-pedido';
import {
  archivoABase64,
  useAnalizarImportacion,
  useConfirmarImportacion,
  useGuardarPlantilla,
} from '@/api/importacion-pedido';
import { useCandidatosDesarrollo } from '@/api/pedidos-mes';
import { useClientes } from '@/api/clientes';
import type {
  AnalizarImportacion,
  GrupoImportacion,
  MapeoColumna,
  RolColumnaImportacion,
} from '@/api/tipos';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { ComboboxBuscable, normalizarTexto } from '@/components/dominio/ComboboxBuscable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';
import { cn } from '@/lib/utils';

/**
 * IMPORTADOR del pedido del cliente (rediseño R8, B15 — proto §4.1 "Etapa 3"): asistente de 3 pasos
 * que toma el Excel del cliente y, reusando el motor del backend, crea el pedido interno + una OP por
 * modelo (con su matriz color×talla) + su Ruta Crítica.
 *
 *  • Paso 1 · Origen: cliente + archivo (avisa si el cliente ya tiene formato guardado → se pre-mapea).
 *  • Paso 2 · Formato: por cada columna, qué es (Modelo/Color/Talla/Cantidad/Precio/ignorar). Se
 *    guarda como plantilla del cliente (versión nueva); la próxima vez se mapea solo.
 *  • Paso 3 · Vista previa: reconocidos ✓ y sin reconocer (con selector de desarrollo para ligar a
 *    mano); al confirmar nace el pedido + OPs + RC. El motor real (parseo/plantilla/amarre/alta) es
 *    BACKEND (A1); esta pantalla sólo orquesta.
 */

/** Roles que puede tener una columna del archivo. */
const ROLES: { valor: RolColumnaImportacion; etiqueta: string }[] = [
  { valor: 'ignorar', etiqueta: 'Ignorar' },
  { valor: 'modeloCliente', etiqueta: 'Modelo del cliente' },
  { valor: 'color', etiqueta: 'Color' },
  { valor: 'talla', etiqueta: 'Talla' },
  { valor: 'cantidad', etiqueta: 'Cantidad' },
  { valor: 'precio', etiqueta: 'Precio' },
];

/** Adivina el rol de una columna por su encabezado (pre-mapeo; el usuario ajusta). */
function adivinarRol(encabezado: string): RolColumnaImportacion {
  const t = normalizarTexto(encabezado);
  if (/(modelo|estilo|style|sku|clave|articulo|item)/.test(t)) return 'modeloCliente';
  if (/(color|colour)/.test(t)) return 'color';
  if (/(talla|size)/.test(t)) return 'talla';
  if (/(cant|pieza|qty|quantity|unidad)/.test(t)) return 'cantidad';
  if (/(precio|price|costo|importe)/.test(t)) return 'precio';
  return 'ignorar';
}

/** Construye el mapeo (una entrada por columna) desde los roles elegidos. */
function construirMapeo(
  columnas: string[],
  roles: Record<number, RolColumnaImportacion>,
): MapeoColumna[] {
  return columnas.map((columna, indice) => ({ indice, columna, rol: roles[indice] ?? 'ignorar' }));
}

export function ImportadorPedido({
  alCerrar,
  alImportado,
}: {
  alCerrar: () => void;
  /** Callback tras crear el pedido (refresca la consulta y cierra). */
  alImportado: () => void;
}): React.JSX.Element {
  const [paso, setPaso] = useState<1 | 2 | 3>(1);

  // Paso 1 — origen.
  const [idCliente, setIdCliente] = useState<number | null>(null);
  const [textoCliente, setTextoCliente] = useState('');
  const busquedaCliente = useDebounce(textoCliente.trim(), 250);
  const [ocCliente, setOcCliente] = useState('');
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [base64, setBase64] = useState('');
  // El File original: tras confirmar se adjunta al pedido por el flujo presigned (como todos los
  // adjuntos del repo); no viaja en el confirm (ahí sólo va el base64 para armar la matriz).
  const [archivo, setArchivo] = useState<File | null>(null);

  // Análisis del backend (columnas, muestras, plantilla vigente, vista previa).
  const [analisis, setAnalisis] = useState<AnalizarImportacion | null>(null);
  // Paso 2 — roles por columna (índice → rol).
  const [roles, setRoles] = useState<Record<number, RolColumnaImportacion>>({});
  // Paso 3 — ligas manuales (modelo del cliente → idDesarrollo).
  const [ligas, setLigas] = useState<Record<string, number>>({});
  const [busquedaLiga, setBusquedaLiga] = useState('');
  const busquedaLigaDeb = useDebounce(busquedaLiga.trim(), 250);

  const clientes = useClientes({
    pagina: 1,
    porPagina: 100,
    ...(busquedaCliente === '' ? {} : { busqueda: busquedaCliente }),
  });
  const candidatos = useCandidatosDesarrollo(busquedaLigaDeb, idCliente ?? undefined);

  const analizar = useAnalizarImportacion();
  const guardarPlantilla = useGuardarPlantilla();
  const confirmar = useConfirmarImportacion();
  const subirAdjunto = useSubirAdjuntoPedido();
  const ocupado =
    analizar.isPending ||
    guardarPlantilla.isPending ||
    confirmar.isPending ||
    subirAdjunto.isPending;

  const opcionesCliente = useMemo(
    () => (clientes.data?.datos ?? []).map((c) => ({ id: c.id, nombre: c.nombre })),
    [clientes.data],
  );
  const opcionesDesarrollo = useMemo(
    () =>
      (candidatos.data ?? []).map((c) => ({
        id: c.idDesarrollo,
        nombre:
          `#${c.codigoModelo}` +
          (c.descripcionModelo !== null ? ` · ${c.descripcionModelo}` : '') +
          (c.numeroCliente !== null ? ` (${c.numeroCliente})` : ''),
      })),
    [candidatos.data],
  );

  const preview = analisis?.preview ?? null;

  /** Un grupo se importará si el backend lo reconoció o el usuario lo ligó a mano. */
  function idDesarrolloDe(grupo: GrupoImportacion): number | null {
    return grupo.idDesarrollo ?? ligas[grupo.modeloCliente] ?? null;
  }
  const gruposAImportar = (preview?.grupos ?? []).filter((g) => idDesarrolloDe(g) !== null);
  const bloqueoMatriz = gruposAImportar.find(
    (g) => g.coloresNoResueltos.length > 0 || g.tallasNoResueltas.length > 0,
  );
  const puedeConfirmar = gruposAImportar.length > 0 && bloqueoMatriz === undefined;

  // ── Acciones ──────────────────────────────────────────────────────────────

  async function alElegirArchivo(archivo: File | undefined): Promise<void> {
    if (archivo === undefined) return;
    try {
      const b64 = await archivoABase64(archivo);
      setBase64(b64);
      setNombreArchivo(archivo.name);
      setArchivo(archivo);
    } catch {
      toast.error('No se pudo leer el archivo.');
    }
  }

  /** Paso 1 → analiza sin mapeo: si el cliente tiene formato guardado, salta a la vista previa. */
  function continuarDesdeOrigen(): void {
    if (idCliente === null) {
      toast.error('Elige el cliente del pedido.');
      return;
    }
    if (base64 === '') {
      toast.error('Carga el archivo del cliente.');
      return;
    }
    analizar.mutate(
      { idCliente, nombreArchivo, archivoBase64: base64 },
      {
        onSuccess: (res) => {
          setAnalisis(res);
          // Roles guardados de la plantilla vigente (por índice), si tiene.
          const guardados: Record<number, RolColumnaImportacion> = {};
          if (res.plantillaVigente !== null) {
            for (const m of res.plantillaVigente.mapeo) guardados[m.indice] = m.rol;
          }
          if (res.plantillaVigente !== null && res.preview !== null) {
            // Ya tiene formato y el backend armó la vista previa: va directo al paso 3.
            setRoles(guardados);
            setPaso(3);
          } else {
            // Sin formato (o formato incompleto): pre-adivina los roles que falten y va a Formato.
            const roles: Record<number, RolColumnaImportacion> = { ...guardados };
            res.columnas.forEach((col, i) => {
              if (roles[i] === undefined) roles[i] = adivinarRol(col);
            });
            setRoles(roles);
            setPaso(2);
          }
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  /** Paso 2 → guarda la plantilla y arma la vista previa con el mapeo. */
  function guardarFormato(): void {
    if (analisis === null || idCliente === null) return;
    const mapeo = construirMapeo(analisis.columnas, roles);
    guardarPlantilla.mutate(
      { idCliente, cuerpo: { mapeo } },
      {
        onSuccess: () => {
          analizar.mutate(
            { idCliente, nombreArchivo, archivoBase64: base64, mapeo },
            {
              onSuccess: (res) => {
                setAnalisis(res);
                setPaso(3);
                toast.success('Formato guardado · la próxima vez se mapea solo');
              },
              onError: (error) => toast.error(error.message),
            },
          );
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  /** Paso 3 → confirma: crea pedido + OPs + RC. */
  function confirmarImportacion(): void {
    if (analisis === null || idCliente === null) return;
    const mapeo = construirMapeo(analisis.columnas, roles);
    const resoluciones = Object.entries(ligas).map(([modeloCliente, idDesarrollo]) => ({
      modeloCliente,
      idDesarrollo,
    }));
    confirmar.mutate(
      {
        idCliente,
        nombreArchivo,
        archivoBase64: base64,
        mapeo,
        ocCliente: ocCliente.trim() === '' ? null : ocCliente.trim(),
        resoluciones,
      },
      {
        onSuccess: (res) => {
          const nOp = res.ordenes.length;
          const fuera = res.noReconocidos.length;
          toast.success(
            `Pedido ${res.folioPedido}-F importado · ${nOp} OP(s) con su matriz + RC` +
              (fuera > 0 ? ` · ${fuera} sin reconocer quedaron fuera` : ''),
          );
          // Adjunta la OC original al pedido recién creado por el flujo presigned estándar (igual que
          // todos los adjuntos del repo). Es NO-FATAL: el pedido ya existe; si el PUT falla, sólo se
          // avisa (se puede subir luego desde el pedido). Cerramos tras que el adjunto asiente.
          if (archivo !== null) {
            subirAdjunto.mutate(
              { idPedido: res.idPedido, archivo },
              {
                onSuccess: () => alImportado(),
                onError: () => {
                  toast.warning(
                    'El pedido se creó, pero no se pudo adjuntar el Excel original. Puedes subirlo desde el pedido.',
                  );
                  alImportado();
                },
              },
            );
          } else {
            alImportado();
          }
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/45"
      role="dialog"
      aria-modal="true"
      aria-label="Importar pedido del cliente"
      data-testid="importador-pedido"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !ocupado) alCerrar();
      }}
    >
      <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-background shadow-xl">
        {/* Encabezado */}
        <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
            IM
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">Importar pedido del cliente</h2>
            <p className="truncate text-xs text-muted-foreground">
              Plantilla de mapeo por cliente → pedido interno + OPs con su matriz + Ruta Crítica
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={alCerrar}
            disabled={ocupado}
            aria-label="Cerrar"
            data-testid="importador-cerrar"
          >
            <X className="size-5" aria-hidden />
          </Button>
        </header>

        {/* Stepper */}
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5 text-xs">
          {(
            [
              [1, 'Origen'],
              [2, 'Formato'],
              [3, 'Vista previa'],
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
              idCliente={idCliente}
              onIdCliente={setIdCliente}
              onTextoCliente={setTextoCliente}
              ocCliente={ocCliente}
              onOcCliente={setOcCliente}
              nombreArchivo={nombreArchivo}
              onArchivo={(f) => void alElegirArchivo(f)}
            />
          ) : null}

          {paso === 2 && analisis !== null ? (
            <PasoFormato
              analisis={analisis}
              roles={roles}
              onRol={(indice, rol) => setRoles((r) => ({ ...r, [indice]: rol }))}
            />
          ) : null}

          {paso === 3 && preview !== null ? (
            <PasoVistaPrevia
              preview={preview}
              ligas={ligas}
              idDesarrolloDe={idDesarrolloDe}
              opcionesDesarrollo={opcionesDesarrollo}
              onLigar={(modeloCliente, id) =>
                setLigas((prev) => {
                  const siguiente = { ...prev };
                  if (id === null) delete siguiente[modeloCliente];
                  else siguiente[modeloCliente] = id;
                  return siguiente;
                })
              }
              onBuscarDesarrollo={setBusquedaLiga}
              bloqueo={bloqueoMatriz}
              ocCliente={ocCliente}
            />
          ) : null}
        </div>

        {/* Pie de acciones */}
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t px-4 py-3">
          <Button variant="outline" onClick={alCerrar} disabled={ocupado}>
            Cancelar
          </Button>
          {paso === 1 ? (
            <Button
              onClick={continuarDesdeOrigen}
              disabled={ocupado || idCliente === null || base64 === ''}
              data-testid="importador-continuar-origen"
            >
              {analizar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Continuar
              <ChevronRight aria-hidden />
            </Button>
          ) : paso === 2 ? (
            <Button
              onClick={guardarFormato}
              disabled={ocupado}
              data-testid="importador-guardar-formato"
            >
              {guardarPlantilla.isPending || analizar.isPending ? (
                <Loader2Icon className="animate-spin" aria-hidden />
              ) : (
                <CheckIcon aria-hidden />
              )}
              Guardar formato y continuar
            </Button>
          ) : (
            <Button
              onClick={confirmarImportacion}
              disabled={ocupado || !puedeConfirmar}
              data-testid="importador-confirmar"
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

/** Paso 1 · Origen: cliente + OC + archivo. */
function PasoOrigen({
  opcionesCliente,
  idCliente,
  onIdCliente,
  onTextoCliente,
  ocCliente,
  onOcCliente,
  nombreArchivo,
  onArchivo,
}: {
  opcionesCliente: { id: number; nombre: string }[];
  idCliente: number | null;
  onIdCliente: (id: number | null) => void;
  onTextoCliente: (texto: string) => void;
  ocCliente: string;
  onOcCliente: (valor: string) => void;
  nombreArchivo: string;
  onArchivo: (archivo: File | undefined) => void;
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
              placeholder="Elige el cliente"
              etiqueta="Cliente del pedido"
              testid="importador-cliente"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">OC del cliente (referencia)</span>
            <Input
              value={ocCliente}
              onChange={(e) => onOcCliente(e.target.value)}
              placeholder="OC-CA-4471"
              data-testid="importador-oc"
            />
          </label>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Archivo del cliente (Excel)
        </h3>
        <label
          className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center text-sm transition-colors hover:border-primary hover:bg-primary-soft/40"
          data-testid="importador-dropzone"
        >
          {nombreArchivo === '' ? (
            <>
              <Upload className="size-6 text-muted-foreground" aria-hidden />
              <span className="text-muted-foreground">
                Elige el archivo del cliente (.xlsx) con Estilo · Color · Talla · Piezas · Precio
              </span>
            </>
          ) : (
            <span className="flex items-center gap-2 font-medium">
              <FileSpreadsheet className="size-5 text-primary" aria-hidden />
              {nombreArchivo}
              <span className="text-xs font-normal text-muted-foreground">(clic para cambiar)</span>
            </span>
          )}
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            data-testid="importador-archivo"
            onChange={(e) => onArchivo(e.target.files?.[0] ?? undefined)}
          />
        </label>
      </section>
    </div>
  );
}

/** Paso 2 · Formato: por cada columna, qué es. */
function PasoFormato({
  analisis,
  roles,
  onRol,
}: {
  analisis: AnalizarImportacion;
  roles: Record<number, RolColumnaImportacion>;
  onRol: (indice: number, rol: RolColumnaImportacion) => void;
}): React.JSX.Element {
  const muestra = analisis.muestras[0] ?? [];
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
        <span>
          <b>Enséñale el formato del cliente (una sola vez):</b> di qué es cada columna. Se guarda
          como <b>plantilla del cliente</b> y la próxima vez se mapea solo.
        </span>
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm" data-testid="importador-tabla-formato">
          <thead className="bg-secondary">
            <tr className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <th className="px-3 py-1.5 text-left">Columna del archivo</th>
              <th className="px-3 py-1.5 text-left">Ejemplo</th>
              <th className="px-3 py-1.5 text-left">¿Qué es?</th>
            </tr>
          </thead>
          <tbody>
            {analisis.columnas.map((columna, indice) => (
              <tr key={indice} className="border-t">
                <td className="num px-3 py-1.5 font-medium">{columna}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{muestra[indice] ?? ''}</td>
                <td className="px-3 py-1.5">
                  <SelectNativo
                    className="h-8 w-52 text-sm"
                    aria-label={`Rol de la columna ${columna}`}
                    value={roles[indice] ?? 'ignorar'}
                    onChange={(e) => onRol(indice, e.target.value as RolColumnaImportacion)}
                    data-testid="importador-rol"
                  >
                    {ROLES.map((rol) => (
                      <option key={rol.valor} value={rol.valor}>
                        {rol.etiqueta}
                      </option>
                    ))}
                  </SelectNativo>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Paso 3 · Vista previa: reconocidos ✓ y sin reconocer (con selector para ligar a mano). */
function PasoVistaPrevia({
  preview,
  ligas,
  idDesarrolloDe,
  opcionesDesarrollo,
  onLigar,
  onBuscarDesarrollo,
  bloqueo,
  ocCliente,
}: {
  preview: NonNullable<AnalizarImportacion['preview']>;
  ligas: Record<string, number>;
  idDesarrolloDe: (grupo: GrupoImportacion) => number | null;
  opcionesDesarrollo: { id: number; nombre: string }[];
  onLigar: (modeloCliente: string, id: number | null) => void;
  onBuscarDesarrollo: (texto: string) => void;
  bloqueo: GrupoImportacion | undefined;
  ocCliente: string;
}): React.JSX.Element {
  const aImportar = preview.grupos.filter((g) => idDesarrolloDe(g) !== null).length;
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground">
        <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
        <span>
          Se aplicó el formato y se amarró cada modelo del cliente con <b>nuestro desarrollo</b>{' '}
          (por su nº de cliente). Revisa, liga lo que no reconoció y genera. Como el archivo trae{' '}
          <b>color y talla</b>, al generar nacen el <b>pedido interno</b> y las{' '}
          <b>OPs con su matriz</b> (y su RC)
          {ocCliente.trim() !== '' ? (
            <>
              , guardando la <b>OC del cliente</b> (<span className="num">{ocCliente}</span>) como
              referencia
            </>
          ) : null}
          .
        </span>
      </p>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm" data-testid="importador-tabla-preview">
          <thead className="bg-secondary">
            <tr className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <th className="px-3 py-1.5 text-left">Modelo del cliente</th>
              <th className="px-3 py-1.5 text-left">Liga a desarrollo</th>
              <th className="px-3 py-1.5 text-right">Piezas</th>
              <th className="px-3 py-1.5 text-left">Estatus</th>
            </tr>
          </thead>
          <tbody>
            {preview.grupos.map((grupo) => {
              const reconocido = grupo.reconocido;
              const ligado = ligas[grupo.modeloCliente] ?? null;
              const sinMatriz =
                grupo.coloresNoResueltos.length > 0 || grupo.tallasNoResueltas.length > 0;
              const seImporta = idDesarrolloDe(grupo) !== null;
              return (
                <tr
                  key={grupo.modeloCliente}
                  className="border-t align-top"
                  data-testid="importador-grupo"
                >
                  <td className="num px-3 py-2 font-medium">{grupo.modeloCliente}</td>
                  <td className="px-3 py-2">
                    {reconocido ? (
                      <span className="num text-xs">
                        #{grupo.codigoModelo}
                        {grupo.descripcionModelo !== null ? (
                          <span className="text-faint"> · {grupo.descripcionModelo}</span>
                        ) : null}
                      </span>
                    ) : (
                      <div className="w-64">
                        <ComboboxBuscable
                          opciones={opcionesDesarrollo}
                          valor={ligado}
                          onChange={(id) => onLigar(grupo.modeloCliente, id)}
                          alCambiarTexto={onBuscarDesarrollo}
                          placeholder="Ligar a un desarrollo…"
                          etiqueta={`Ligar ${grupo.modeloCliente} a un desarrollo`}
                          testid="importador-ligar"
                        />
                      </div>
                    )}
                    {seImporta && sinMatriz ? (
                      <p className="mt-1 text-[11px] text-crit" data-testid="importador-sin-matriz">
                        Sin catálogo:{' '}
                        {[
                          ...grupo.coloresNoResueltos.map((c) => `color "${c}"`),
                          ...grupo.tallasNoResueltas.map((t) => `talla "${t}"`),
                        ].join(', ')}
                      </p>
                    ) : null}
                    {grupo.cantidadesIlegibles > 0 ? (
                      <p
                        className="mt-1 text-[11px] text-warn"
                        data-testid="importador-cantidades-ilegibles"
                      >
                        {grupo.cantidadesIlegibles} renglón(es) con cantidad ilegible (no numérica):
                        se toman como 0. Revisa el archivo del cliente.
                      </p>
                    ) : null}
                  </td>
                  <td className="num px-3 py-2 text-right">
                    {grupo.totalPiezas.toLocaleString('es-MX')}
                  </td>
                  <td className="px-3 py-2">
                    {reconocido ? (
                      <ChipEstado tono="ok">reconocido</ChipEstado>
                    ) : ligado !== null ? (
                      <ChipEstado tono="info">ligado a mano</ChipEstado>
                    ) : (
                      <ChipEstado tono="crit">sin reconocer</ChipEstado>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-faint">
        <b>{aImportar}</b> de {preview.totalGrupos} modelos se importarán ·{' '}
        {preview.totalPiezas.toLocaleString('es-MX')} pz en el archivo.
        {bloqueo !== undefined ? (
          <span className="text-crit">
            {' '}
            Corrige el catálogo del modelo <b>{bloqueo.modeloCliente}</b> antes de generar.
          </span>
        ) : null}
      </p>
    </div>
  );
}
