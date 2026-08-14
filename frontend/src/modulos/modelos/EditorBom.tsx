import { Loader2Icon, Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useAvios } from '@/api/avios';
import {
  useReemplazarAviosBom,
  useReemplazarTelasBom,
  type ModeloAvio,
  type ModeloFicha,
  type ModeloTela,
} from '@/api/modelos';
import { useTelas } from '@/api/telas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import { CopiarBomDialogo } from './CopiarBomDialogo';
import { EditorMedidasAvio } from './EditorMedidasAvio';
import { SeccionArte } from './SeccionArte';

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

/** Las tres secciones de la receta (telas y avíos son SET completo; el ARTE es CRUD por renglón). */
type SeccionBom = 'telas' | 'avios' | 'artes';

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

/**
 * Editor de la RECETA de un modelo (F1-E4): tres pestañas (Telas / Avíos / Arte).
 *
 * Telas y avíos tienen un buscador de componente para agregar renglones, captura de consumo + 3
 * banderas 🔑 y un botón "Guardar receta" que envía el SET COMPLETO de esa sección (el backend
 * reemplaza en una transacción A2). El ARTE va aparte (`SeccionArte`): desde V1-E3d es un HIJO del
 * modelo con su propia ficha y su FOTO, así que se administra RENGLÓN POR RENGLÓN, sin "guardar
 * receta". Además, un botón "Copiar receta de…" clona el BOM de otro modelo.
 *
 * El estado de captura de telas/avíos vive aquí (sembrado desde la ficha); el backend valida
 * (componentes activos, sin repetir) y es la autoridad (A1).
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

  // Sembrar la captura desde la ficha cada vez que cambia (al recargarla tras guardar).
  useEffect(() => {
    setTelas(ficha.telas.map(aRenglonTela));
    setAvios(ficha.avios.map(aRenglonAvio));
  }, [ficha]);

  const catalogoTelas = useTelas(QUERY_CATALOGO);
  const catalogoAvios = useAvios(QUERY_CATALOGO_AVIOS);

  const guardarTelas = useReemplazarTelasBom();
  const guardarAvios = useReemplazarAviosBom();

  // ── Helpers de agregar/quitar/editar renglones ───────────────────────────────
  const idsTela = new Set(telas.map((r) => r.id));
  const idsAvio = new Set(avios.map((r) => r.id));
  // Avíos YA guardados en el BOM: solo ellos pueden tener medidas por talla (R18); el endpoint
  // exige el renglón. Los recién agregados (aún sin guardar) muestran un aviso.
  const idsAviosGuardados = new Set(ficha.avios.map((a) => a.idAvio));

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

  const guardando = guardarTelas.isPending || guardarAvios.isPending;

  return (
    <div className="space-y-4" data-testid="editor-bom">
      {/* Pestañas + copiar receta */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="tablist" aria-label="Secciones de la receta">
          {(
            [
              ['telas', 'Telas'],
              ['avios', 'Avíos'],
              ['artes', 'Arte'],
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
          renderExtra={(r) =>
            idsAviosGuardados.has(r.id) ? (
              <EditorMedidasAvio
                idModelo={ficha.id}
                idAvio={r.id}
                puedeAdministrar={puedeAdministrar}
              />
            ) : (
              <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                Guarda la receta para capturar medidas por talla de este avío.
              </p>
            )
          }
        />
      ) : (
        <SeccionArte idModelo={ficha.id} artes={ficha.artes} puedeAdministrar={puedeAdministrar} />
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
  renderExtra,
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
  /** Contenido extra por renglón (p. ej. medidas por talla del avío, R18). Opcional. */
  renderExtra?: (r: RenglonComponente) => React.ReactNode;
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
              {renderExtra ? renderExtra(r) : null}
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
