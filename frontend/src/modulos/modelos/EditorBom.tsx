import { Loader2Icon, Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useAvios } from '@/api/avios';
import { useBordados } from '@/api/bordados';
import {
  useReemplazarAviosBom,
  useReemplazarBordadosBom,
  useReemplazarTelasBom,
  type ModeloAvio,
  type ModeloBordado,
  type ModeloFicha,
  type ModeloTela,
} from '@/api/modelos';
import { useTelas } from '@/api/telas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import { CopiarBomDialogo } from './CopiarBomDialogo';

/** Tope alto: trae los catálogos activos para los selectores de componentes (ordenados por nombre). */
const QUERY_CATALOGO = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'nombre',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;

/** Igual que `QUERY_CATALOGO` pero los avíos se ordenan por su `clave` (no tienen `nombre`). */
const QUERY_CATALOGO_AVIOS = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'clave',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;

/** Las tres secciones del BOM. */
type SeccionBom = 'telas' | 'avios' | 'bordados';

/** Renglón de tela/avío en captura: consumo como texto + 3 banderas. */
interface RenglonComponente {
  id: number;
  /** Nombre/clave del componente para mostrar. */
  etiqueta: string;
  /** Consumo por prenda como texto (`<input type=number>` entrega string). */
  consumo: string;
  paraPreCosto: boolean;
  paraProduccion: boolean;
  paraCosto: boolean;
}

/** Renglón de bordado en captura: precio como texto (sin banderas). */
interface RenglonBordado {
  id: number;
  etiqueta: string;
  precio: string;
}

/** Convierte un renglón de tela del API a su forma de captura. */
function aRenglonTela(t: ModeloTela): RenglonComponente {
  return {
    id: t.idTela,
    etiqueta: t.nombre,
    consumo: String(t.consumoPorPrenda),
    paraPreCosto: t.paraPreCosto,
    paraProduccion: t.paraProduccion,
    paraCosto: t.paraCosto,
  };
}

/** Convierte un renglón de avío del API a su forma de captura. */
function aRenglonAvio(a: ModeloAvio): RenglonComponente {
  return {
    id: a.idAvio,
    etiqueta: `${a.clave} — ${a.descripcion}`,
    consumo: String(a.consumoPorPrenda),
    paraPreCosto: a.paraPreCosto,
    paraProduccion: a.paraProduccion,
    paraCosto: a.paraCosto,
  };
}

/** Convierte un renglón de bordado del API a su forma de captura. */
function aRenglonBordado(b: ModeloBordado): RenglonBordado {
  return { id: b.idBordado, etiqueta: b.nombre, precio: b.precio === null ? '' : String(b.precio) };
}

/**
 * Editor de la RECETA/BOM de un modelo (F1-E4): tres pestañas (Telas / Avíos / Bordados).
 * Cada pestaña tiene un buscador de componente para agregar renglones, captura de consumo + 3
 * banderas 🔑 (telas/avíos) o precio (bordados, pre-llenado desde el catálogo), y un botón
 * "Guardar receta" que envía el SET COMPLETO de esa sección (el backend reemplaza en una
 * transacción A2). Además, un botón "Copiar receta de…" clona el BOM de otro modelo.
 *
 * El estado de captura vive aquí (sembrado desde la ficha); el backend valida (componentes
 * activos, sin repetir) y es la autoridad (A1).
 */
export function EditorBom({
  ficha,
  puedeAdministrar,
}: {
  ficha: ModeloFicha;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const [seccion, setSeccion] = useState<SeccionBom>('telas');
  const [copiarAbierto, setCopiarAbierto] = useState(false);

  const [telas, setTelas] = useState<RenglonComponente[]>([]);
  const [avios, setAvios] = useState<RenglonComponente[]>([]);
  const [bordados, setBordados] = useState<RenglonBordado[]>([]);
  // Ids de bordados con precio vacío al intentar guardar (precio requerido en UI, decisión #2).
  const [bordadosInvalidos, setBordadosInvalidos] = useState<ReadonlySet<number>>(new Set());

  // Sembrar la captura desde la ficha cada vez que cambia (al recargarla tras guardar).
  useEffect(() => {
    setTelas(ficha.telas.map(aRenglonTela));
    setAvios(ficha.avios.map(aRenglonAvio));
    setBordados(ficha.bordados.map(aRenglonBordado));
    setBordadosInvalidos(new Set());
  }, [ficha]);

  const catalogoTelas = useTelas(QUERY_CATALOGO);
  const catalogoAvios = useAvios(QUERY_CATALOGO_AVIOS);
  const catalogoBordados = useBordados(QUERY_CATALOGO);

  const guardarTelas = useReemplazarTelasBom();
  const guardarAvios = useReemplazarAviosBom();
  const guardarBordados = useReemplazarBordadosBom();

  // ── Helpers de agregar/quitar/editar renglones ───────────────────────────────
  const idsTela = new Set(telas.map((r) => r.id));
  const idsAvio = new Set(avios.map((r) => r.id));
  const idsBordado = new Set(bordados.map((r) => r.id));

  function agregarTela(id: number): void {
    const tela = catalogoTelas.data?.datos.find((t) => t.id === id);
    if (!tela || idsTela.has(id)) {
      return;
    }
    setTelas((prev) => [
      ...prev,
      {
        id,
        etiqueta: tela.nombre,
        consumo: '',
        paraPreCosto: true,
        paraProduccion: true,
        paraCosto: true,
      },
    ]);
  }

  function agregarAvio(id: number): void {
    const avio = catalogoAvios.data?.datos.find((a) => a.id === id);
    if (!avio || idsAvio.has(id)) {
      return;
    }
    setAvios((prev) => [
      ...prev,
      {
        id,
        etiqueta: `${avio.clave} — ${avio.descripcion}`,
        consumo: '',
        paraPreCosto: true,
        paraProduccion: true,
        paraCosto: true,
      },
    ]);
  }

  function agregarBordado(id: number): void {
    const bordado = catalogoBordados.data?.datos.find((b) => b.id === id);
    if (!bordado || idsBordado.has(id)) {
      return;
    }
    // Pre-llena el precio con el del catálogo (editable).
    setBordados((prev) => [
      ...prev,
      {
        id,
        etiqueta: bordado.nombre,
        precio: bordado.precio === null ? '' : String(bordado.precio),
      },
    ]);
  }

  // ── Guardar cada sección (set completo) ──────────────────────────────────────
  function guardarSeccionTelas(): void {
    guardarTelas.mutate(
      {
        id: ficha.id,
        telas: telas.map((r) => ({
          idTela: r.id,
          consumoPorPrenda: Number(r.consumo),
          paraPreCosto: r.paraPreCosto,
          paraProduccion: r.paraProduccion,
          paraCosto: r.paraCosto,
        })),
      },
      {
        onSuccess: () => toast.success('Telas de la receta guardadas.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function guardarSeccionAvios(): void {
    guardarAvios.mutate(
      {
        id: ficha.id,
        avios: avios.map((r) => ({
          idAvio: r.id,
          consumoPorPrenda: Number(r.consumo),
          paraPreCosto: r.paraPreCosto,
          paraProduccion: r.paraProduccion,
          paraCosto: r.paraCosto,
        })),
      },
      {
        onSuccess: () => toast.success('Avíos de la receta guardados.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function guardarSeccionBordados(): void {
    // Decisión cerrada #2: el precio del bordado es REQUERIDO en la captura por UI (nullable
    // solo en BD para el ETL). Si algún renglón quedó sin precio, no se guarda: aviso claro y
    // se marca el campo (`bordadosInvalidos`) sin perder el pre-llenado.
    const sinPrecio = bordados.filter((r) => r.precio.trim() === '');
    if (sinPrecio.length > 0) {
      setBordadosInvalidos(new Set(sinPrecio.map((r) => r.id)));
      toast.error('Captura el precio de cada bordado de la receta.');
      return;
    }
    setBordadosInvalidos(new Set());
    guardarBordados.mutate(
      {
        id: ficha.id,
        bordados: bordados.map((r) => ({ idBordado: r.id, precio: Number(r.precio) })),
      },
      {
        onSuccess: () => toast.success('Bordados de la receta guardados.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const guardando = guardarTelas.isPending || guardarAvios.isPending || guardarBordados.isPending;

  return (
    <div className="space-y-4" data-testid="editor-bom">
      {/* Pestañas + copiar receta */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="tablist" aria-label="Secciones de la receta">
          {(
            [
              ['telas', 'Telas'],
              ['avios', 'Avíos'],
              ['bordados', 'Bordados'],
            ] as const
          ).map(([clave, etiqueta]) => (
            <Button
              key={clave}
              type="button"
              variant={seccion === clave ? 'secondary' : 'ghost'}
              size="sm"
              role="tab"
              aria-selected={seccion === clave}
              onClick={() => setSeccion(clave)}
              data-testid={`tab-bom-${clave}`}
            >
              {etiqueta}
            </Button>
          ))}
        </div>
        {puedeAdministrar ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCopiarAbierto(true)}
            data-testid="abrir-copiar-bom"
          >
            Copiar receta de…
          </Button>
        ) : null}
      </div>

      {/* Sección activa */}
      {seccion === 'telas' ? (
        <SeccionComponentes
          titulo="telas"
          renglones={telas}
          alCambiar={setTelas}
          puedeAdministrar={puedeAdministrar}
          guardando={guardarTelas.isPending}
          deshabilitadoGlobal={guardando}
          catalogo={(catalogoTelas.data?.datos ?? []).map((t) => ({
            id: t.id,
            etiqueta: t.nombre,
          }))}
          cargandoCatalogo={catalogoTelas.isPending}
          idsUsados={idsTela}
          alAgregar={agregarTela}
          alGuardar={guardarSeccionTelas}
          unidadAyuda="Consumo de tela por prenda."
        />
      ) : seccion === 'avios' ? (
        <SeccionComponentes
          titulo="avíos"
          renglones={avios}
          alCambiar={setAvios}
          puedeAdministrar={puedeAdministrar}
          guardando={guardarAvios.isPending}
          deshabilitadoGlobal={guardando}
          catalogo={(catalogoAvios.data?.datos ?? []).map((a) => ({
            id: a.id,
            etiqueta: `${a.clave} — ${a.descripcion}`,
          }))}
          cargandoCatalogo={catalogoAvios.isPending}
          idsUsados={idsAvio}
          alAgregar={agregarAvio}
          alGuardar={guardarSeccionAvios}
          unidadAyuda="Consumo de avío por prenda."
        />
      ) : (
        <SeccionBordados
          renglones={bordados}
          alCambiar={setBordados}
          invalidos={bordadosInvalidos}
          alEditarPrecio={(id) =>
            setBordadosInvalidos((prev) => {
              if (!prev.has(id)) {
                return prev;
              }
              const siguiente = new Set(prev);
              siguiente.delete(id);
              return siguiente;
            })
          }
          puedeAdministrar={puedeAdministrar}
          guardando={guardarBordados.isPending}
          deshabilitadoGlobal={guardando}
          catalogo={(catalogoBordados.data?.datos ?? []).map((b) => ({
            id: b.id,
            etiqueta: b.nombre,
          }))}
          cargandoCatalogo={catalogoBordados.isPending}
          idsUsados={idsBordado}
          alAgregar={agregarBordado}
          alGuardar={guardarSeccionBordados}
        />
      )}

      <CopiarBomDialogo
        abierto={copiarAbierto}
        alCambiarAbierto={setCopiarAbierto}
        idDestino={ficha.id}
      />
    </div>
  );
}

/** Opción de catálogo para el selector de "agregar". */
interface OpcionCatalogo {
  id: number;
  etiqueta: string;
}

/** Sección de telas o avíos (consumo + 3 banderas 🔑). */
function SeccionComponentes({
  titulo,
  renglones,
  alCambiar,
  puedeAdministrar,
  guardando,
  deshabilitadoGlobal,
  catalogo,
  cargandoCatalogo,
  idsUsados,
  alAgregar,
  alGuardar,
  unidadAyuda,
}: {
  titulo: string;
  renglones: RenglonComponente[];
  alCambiar: React.Dispatch<React.SetStateAction<RenglonComponente[]>>;
  puedeAdministrar: boolean;
  guardando: boolean;
  deshabilitadoGlobal: boolean;
  catalogo: readonly OpcionCatalogo[];
  cargandoCatalogo: boolean;
  idsUsados: ReadonlySet<number>;
  alAgregar: (id: number) => void;
  alGuardar: () => void;
  unidadAyuda: string;
}): React.JSX.Element {
  const disponibles = catalogo.filter((o) => !idsUsados.has(o.id));

  function actualizar(id: number, cambios: Partial<RenglonComponente>): void {
    alCambiar((prev) => prev.map((r) => (r.id === id ? { ...r, ...cambios } : r)));
  }
  function quitar(id: number): void {
    alCambiar((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div
      className="space-y-3"
      data-testid={`seccion-bom-${titulo === 'avíos' ? 'avios' : 'telas'}`}
    >
      {puedeAdministrar ? (
        <SelectorAgregar
          etiqueta={`Agregar ${titulo === 'avíos' ? 'avío' : 'tela'}…`}
          disponibles={disponibles}
          cargando={cargandoCatalogo}
          deshabilitado={deshabilitadoGlobal}
          alAgregar={alAgregar}
          testid={`agregar-${titulo === 'avíos' ? 'avio' : 'tela'}-bom`}
        />
      ) : null}

      {renglones.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          La receta no tiene {titulo}.
        </p>
      ) : (
        <ul className="space-y-2">
          {renglones.map((r) => (
            <li key={r.id} className="rounded-lg border p-3" data-testid={`renglon-bom-${r.id}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.etiqueta}</span>
                {puedeAdministrar ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => quitar(r.id)}
                    disabled={deshabilitadoGlobal}
                    aria-label={`Quitar ${r.etiqueta}`}
                    data-testid={`quitar-bom-${r.id}`}
                  >
                    <Trash2Icon className="text-destructive" aria-hidden />
                  </Button>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <div>
                  <label
                    htmlFor={`consumo-${r.id}`}
                    className="block text-xs text-muted-foreground"
                  >
                    Consumo
                  </label>
                  <Input
                    id={`consumo-${r.id}`}
                    type="number"
                    min={0}
                    step="0.0001"
                    inputMode="decimal"
                    className="w-32"
                    placeholder="0"
                    value={r.consumo}
                    disabled={!puedeAdministrar || deshabilitadoGlobal}
                    onChange={(e) => actualizar(r.id, { consumo: e.target.value })}
                    data-testid={`consumo-bom-${r.id}`}
                  />
                </div>
                <fieldset className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-input accent-primary"
                      checked={r.paraPreCosto}
                      disabled={!puedeAdministrar || deshabilitadoGlobal}
                      onChange={(e) => actualizar(r.id, { paraPreCosto: e.target.checked })}
                      data-testid={`pre-costo-bom-${r.id}`}
                    />
                    Pre-costo
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-input accent-primary"
                      checked={r.paraProduccion}
                      disabled={!puedeAdministrar || deshabilitadoGlobal}
                      onChange={(e) => actualizar(r.id, { paraProduccion: e.target.checked })}
                      data-testid={`produccion-bom-${r.id}`}
                    />
                    Producción
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-input accent-primary"
                      checked={r.paraCosto}
                      disabled={!puedeAdministrar || deshabilitadoGlobal}
                      onChange={(e) => actualizar(r.id, { paraCosto: e.target.checked })}
                      data-testid={`costo-bom-${r.id}`}
                    />
                    Costo
                  </label>
                </fieldset>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">{unidadAyuda}</p>

      {puedeAdministrar ? (
        <Button
          type="button"
          size="sm"
          onClick={alGuardar}
          disabled={deshabilitadoGlobal}
          data-testid={`guardar-bom-${titulo === 'avíos' ? 'avios' : 'telas'}`}
        >
          {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
          Guardar receta
        </Button>
      ) : null}
    </div>
  );
}

/** Sección de bordados (precio por renglón REQUERIDO, pre-llenado; sin banderas). */
function SeccionBordados({
  renglones,
  alCambiar,
  invalidos,
  alEditarPrecio,
  puedeAdministrar,
  guardando,
  deshabilitadoGlobal,
  catalogo,
  cargandoCatalogo,
  idsUsados,
  alAgregar,
  alGuardar,
}: {
  renglones: RenglonBordado[];
  alCambiar: React.Dispatch<React.SetStateAction<RenglonBordado[]>>;
  /** Ids de bordados marcados con precio inválido (vacío) al intentar guardar. */
  invalidos: ReadonlySet<number>;
  /** Avisa al padre que se editó el precio de un bordado (para limpiar su marca de inválido). */
  alEditarPrecio: (id: number) => void;
  puedeAdministrar: boolean;
  guardando: boolean;
  deshabilitadoGlobal: boolean;
  catalogo: readonly OpcionCatalogo[];
  cargandoCatalogo: boolean;
  idsUsados: ReadonlySet<number>;
  alAgregar: (id: number) => void;
  alGuardar: () => void;
}): React.JSX.Element {
  const disponibles = catalogo.filter((o) => !idsUsados.has(o.id));

  function actualizar(id: number, precio: string): void {
    alCambiar((prev) => prev.map((r) => (r.id === id ? { ...r, precio } : r)));
    alEditarPrecio(id);
  }
  function quitar(id: number): void {
    alCambiar((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="space-y-3" data-testid="seccion-bom-bordados">
      {puedeAdministrar ? (
        <SelectorAgregar
          etiqueta="Agregar bordado…"
          disponibles={disponibles}
          cargando={cargandoCatalogo}
          deshabilitado={deshabilitadoGlobal}
          alAgregar={alAgregar}
          testid="agregar-bordado-bom"
        />
      ) : null}

      {renglones.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          La receta no tiene bordados.
        </p>
      ) : (
        <ul className="space-y-2">
          {renglones.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-2 rounded-lg border p-3"
              data-testid={`renglon-bom-bordado-${r.id}`}
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.etiqueta}</span>
              <div>
                <label
                  htmlFor={`precio-bordado-${r.id}`}
                  className="sr-only"
                >{`Precio del bordado ${r.etiqueta}`}</label>
                <Input
                  id={`precio-bordado-${r.id}`}
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  className="w-28"
                  placeholder="Precio"
                  required
                  aria-invalid={invalidos.has(r.id)}
                  value={r.precio}
                  disabled={!puedeAdministrar || deshabilitadoGlobal}
                  onChange={(e) => actualizar(r.id, e.target.value)}
                  data-testid={`precio-bordado-bom-${r.id}`}
                />
                {invalidos.has(r.id) ? (
                  <p
                    className="mt-1 text-xs text-destructive"
                    data-testid={`error-precio-bordado-${r.id}`}
                  >
                    Captura el precio.
                  </p>
                ) : null}
              </div>
              {puedeAdministrar ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => quitar(r.id)}
                  disabled={deshabilitadoGlobal}
                  aria-label={`Quitar ${r.etiqueta}`}
                  data-testid={`quitar-bom-bordado-${r.id}`}
                >
                  <Trash2Icon className="text-destructive" aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Precio del bordado/estampado en este modelo (se pre-llena con el del catálogo).
      </p>

      {puedeAdministrar ? (
        <Button
          type="button"
          size="sm"
          onClick={alGuardar}
          disabled={deshabilitadoGlobal}
          data-testid="guardar-bom-bordados"
        >
          {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
          Guardar receta
        </Button>
      ) : null}
    </div>
  );
}

/** Selector de "agregar un componente" (no repetible). */
function SelectorAgregar({
  etiqueta,
  disponibles,
  cargando,
  deshabilitado,
  alAgregar,
  testid,
}: {
  etiqueta: string;
  disponibles: readonly OpcionCatalogo[];
  cargando: boolean;
  deshabilitado: boolean;
  alAgregar: (id: number) => void;
  testid: string;
}): React.JSX.Element {
  return (
    <SelectNativo
      aria-label={etiqueta}
      data-testid={testid}
      disabled={deshabilitado || cargando || disponibles.length === 0}
      value=""
      onChange={(e) => {
        const id = Number(e.target.value);
        if (Number.isFinite(id) && id > 0) {
          alAgregar(id);
        }
      }}
    >
      <option value="">
        {cargando ? 'Cargando…' : disponibles.length === 0 ? 'No hay más por agregar' : etiqueta}
      </option>
      {disponibles.map((o) => (
        <option key={o.id} value={String(o.id)}>
          {o.etiqueta}
        </option>
      ))}
    </SelectNativo>
  );
}
