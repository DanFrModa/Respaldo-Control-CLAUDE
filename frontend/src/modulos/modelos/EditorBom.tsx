import { ChevronRight, Loader2Icon, Trash2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useProveedoresDeAvio, type Avio } from '@/api/avios';
import {
  useReemplazarAviosBom,
  useReemplazarTelasBom,
  type ModeloAvio,
  type ModeloFicha,
  type ModeloTela,
} from '@/api/modelos';
import { useTelaProveedores } from '@/api/tela-proveedores';
import { type Tela } from '@/api/telas';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { formatearMoneda } from '@/lib/formato';
import { cn } from '@/lib/utils';

import { SelectorAvio } from '../inventarios/SelectorAvio';
import { SelectorTela } from '../inventarios/SelectorTela';

import { CopiarBomDialogo } from './CopiarBomDialogo';
import { CurvaDelModelo } from './CurvaDelModelo';
import { EditorMedidasAvio } from './EditorMedidasAvio';
import { SeccionArte } from './SeccionArte';
import { SugerenciaAviosFavoritos } from './SugerenciaAviosFavoritos';

/** Las tres secciones de la receta (telas y avíos son SET completo; el ARTE es CRUD por renglón). */
type SeccionBom = 'telas' | 'avios' | 'artes';

/** De qué escalón de la cascada salió el precio que costea (lo resuelve el backend). */
type OrigenPrecio = ModeloTela['origenPrecio'];

/**
 * Renglón de tela/avío en captura: consumo como texto + 3 banderas + el AMARRE de precio (R17).
 * El amarre viaja con su etiqueta/precio ya resueltos para poder pintarlos sin volver a consultar.
 */
interface RenglonComponente {
  id: number;
  /** Nombre/clave del componente para mostrar. */
  etiqueta: string;
  /** Segunda línea (descripción del avío), si la hay. */
  detalle: string | null;
  /** Consumo por prenda como texto (`<input type=number>` entrega string). */
  consumo: string;
  paraPreCosto: boolean;
  paraProduccion: boolean;
  paraCosto: boolean;
  /** Id del amarre (R17): `TelaProveedor.id` en telas, `idProveedor` en avíos. Null = sin amarre. */
  idAmarre: number | null;
  /** Nombre del proveedor amarrado (para pintar sin re-consultar). */
  proveedorAmarrado: string | null;
  /**
   * ¿El proveedor amarrado cotiza POR COLOR? Entonces el precio que se ve es solo el piso: la
   * cascada usará el del color de la orden (`TelaProveedorColor`), que puede ser MAYOR. Se pinta
   * en el renglón para que nadie lea el base como si fuera el precio final.
   */
  precioPorColor: boolean;
  /**
   * 🔑 El precio con el que se VA A COSTEAR, tal como lo resolvió el motor en el servidor. La
   * receta muestra SIEMPRE este número (regla de Daniel, 15-ago-2026: la pantalla nunca enseña una
   * cifra distinta de la que costea) y {@link RenglonComponente.origenPrecio} dice de dónde salió.
   */
  precioCosteo: number | null;
  /** Escalón de la cascada que ganó (última compra · amarre · más barato · promedio · referencia). */
  origenPrecio: OrigenPrecio;
  /** Proveedor del que salió `precioCosteo` (null si salió del catálogo o del promedio). */
  proveedorPrecio: string | null;
  /**
   * ⚠️ Hay amarre pero el precio que costea NO lo firmó el proveedor amarrado. **Lo decide el
   * servidor** (compara ids de proveedor): la UI ya no puede deducirlo del origen, porque desde
   * §Post-F9.48 un renglón amarrado costea normalmente por `ultimo-precio-compra` —la última
   * compra A ESE proveedor—, y solo es "amarre ignorado" cuando la compra fue a OTRO.
   */
  amarreIgnorado: boolean;
  /** Último escalón del catálogo: solo costea cuando `origenPrecio === 'referencia'`. */
  precioReferencia: number | null;
  /**
   * El amarre se cambió en pantalla y AÚN NO se guarda, así que `precioCosteo` sigue siendo el que
   * costea HOY (el del amarre anterior). Desde V1-E3e el escalón que gana depende del **histórico
   * de compras**, que el navegador no tiene: predecirlo aquí sería justo la "cifra distinta de la
   * que costea" que prohíbe §Post-F9.47. Se dice que falta guardar y el servidor devuelve la real.
   */
  pendienteRecalculo: boolean;
}

/** Convierte un renglón de tela del API a su forma de captura. */
function aRenglonTela(t: ModeloTela): RenglonComponente {
  return {
    id: t.idTela,
    etiqueta: t.nombre,
    detalle: null,
    consumo: String(t.consumoPorPrenda),
    paraPreCosto: t.paraPreCosto,
    paraProduccion: t.paraProduccion,
    paraCosto: t.paraCosto,
    idAmarre: t.idTelaProveedor,
    proveedorAmarrado: t.proveedorAmarrado,
    precioPorColor: t.precioPorColor,
    precioCosteo: t.precioCosteo,
    origenPrecio: t.origenPrecio,
    proveedorPrecio: t.proveedorPrecio,
    amarreIgnorado: t.amarreIgnorado,
    precioReferencia: t.precioReferencia,
    pendienteRecalculo: false,
  };
}

/** Convierte un renglón de avío del API a su forma de captura. */
function aRenglonAvio(a: ModeloAvio): RenglonComponente {
  return {
    id: a.idAvio,
    etiqueta: a.clave,
    detalle: a.descripcion,
    consumo: String(a.consumoPorPrenda),
    paraPreCosto: a.paraPreCosto,
    paraProduccion: a.paraProduccion,
    paraCosto: a.paraCosto,
    idAmarre: a.idAvioProveedor,
    proveedorAmarrado: a.proveedorAmarrado,
    // El avío no cotiza por color (eso es de la tela).
    precioPorColor: false,
    precioCosteo: a.precioCosteo,
    origenPrecio: a.origenPrecio,
    proveedorPrecio: a.proveedorPrecio,
    amarreIgnorado: a.amarreIgnorado,
    precioReferencia: a.precioReferencia,
    pendienteRecalculo: false,
  };
}

/**
 * ¿La captura de avíos difiere de lo que trae la ficha (o sea, hay cambios SIN guardar)?
 *
 * Lo usa la sugerencia de favoritos (V1-E3v): aceptar escribe en el servidor y recarga la ficha,
 * lo que RESIEMBRA esta captura — si se pudiera aceptar con cambios pendientes, lo tecleado se
 * perdería sin avisar. Se compara renglón por renglón sobre lo que el PUT del BOM manda de verdad
 * (componente, consumo, las tres banderas 🔑 y el amarre); el orden no cuenta, porque agregar un
 * renglón y guardarlo lo devuelve ordenado por clave.
 */
function difiereDeLaFicha(captura: RenglonComponente[], guardados: ModeloAvio[]): boolean {
  if (captura.length !== guardados.length) return true;
  const porId = new Map(guardados.map((a) => [a.idAvio, a]));
  return captura.some((r) => {
    const g = porId.get(r.id);
    return (
      g === undefined ||
      // El consumo viaja como texto: se compara por VALOR (un "1.0" tecleado sobre un 1 no es un
      // cambio real, y bloquear por eso sería mentirle al usuario).
      Number(r.consumo) !== g.consumoPorPrenda ||
      r.paraPreCosto !== g.paraPreCosto ||
      r.paraProduccion !== g.paraProduccion ||
      r.paraCosto !== g.paraCosto ||
      r.idAmarre !== g.idAvioProveedor
    );
  });
}

/**
 * Editor de la RECETA de un modelo (F1-E4): tres pestañas (Telas / Avíos / Arte).
 *
 * Telas y avíos se capturan en una TABLA DENSA de renglones compactos (~44 px) con un panel
 * expandible por renglón (V1-E3c: antes cada renglón era una tarjeta de ~130 px y ocho avíos
 * medían más de mil píxeles). En el renglón se ve lo que se consulta a diario —componente, de
 * dónde sale su precio y el consumo—; en el panel, lo que se ajusta de vez en cuando: las TRES
 * banderas 🔑 (siguen ahí: sirven para negociar quitarle piezas al modelo) y el AMARRE de precio.
 * El botón "Guardar receta" envía el SET COMPLETO de esa sección (el backend reemplaza en una
 * transacción A2).
 *
 * Los componentes se agregan con el COMBOBOX de búsqueda server-side del kit
 * ({@link SelectorTela}/{@link SelectorAvio}): con 877 telas, el `<select>` nativo con tope de 100
 * dejaba 777 inalcanzables y solo "buscaba" por prefijo (el typeahead del navegador).
 *
 * El ARTE va aparte (`SeccionArte`): desde V1-E3d es un HIJO del modelo con su propia ficha y su
 * FOTO, así que se administra RENGLÓN POR RENGLÓN, sin "guardar receta". Además, un botón "Copiar
 * receta de…" clona el BOM de otro modelo.
 *
 * El estado de captura de telas/avíos vive aquí (sembrado desde la ficha); el backend valida
 * (componentes activos, sin repetir, amarres que sí son de ese componente) y es la autoridad (A1).
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

  const guardarTelas = useReemplazarTelasBom();
  const guardarAvios = useReemplazarAviosBom();

  // ── Helpers de agregar/quitar/editar renglones ───────────────────────────────
  const idsTela = new Set(telas.map((r) => r.id));
  const idsAvio = new Set(avios.map((r) => r.id));
  // Avíos YA guardados en el BOM: solo ellos pueden tener medidas por talla (R18); el endpoint
  // exige el renglón. Los recién agregados (aún sin guardar) muestran un aviso.
  const idsAviosGuardados = new Set(ficha.avios.map((a) => a.idAvio));

  function agregarTela(tela: Tela): void {
    if (idsTela.has(tela.id)) {
      toast.error(`La receta ya tiene la tela "${tela.nombre}".`);
      return;
    }
    setTelas((prev) => [
      ...prev,
      {
        id: tela.id,
        etiqueta: tela.nombre,
        detalle: null,
        consumo: '',
        paraPreCosto: true,
        paraProduccion: true,
        paraCosto: true,
        idAmarre: null,
        proveedorAmarrado: null,
        precioPorColor: false,
        // Renglón recién agregado, aún sin guardar: lo único que se conoce en cliente es el
        // catálogo. Al guardar, el servidor devuelve el escalón real de la cascada.
        precioCosteo: tela.precioSugerido,
        origenPrecio: tela.precioSugerido === null ? 'sin-precio' : 'referencia',
        proveedorPrecio: null,
        amarreIgnorado: false,
        precioReferencia: tela.precioSugerido,
        // Renglón nuevo: el escalón real (¿ya se compró esta tela?) lo resuelve el servidor.
        pendienteRecalculo: true,
      },
    ]);
  }

  function agregarAvio(avio: Avio): void {
    if (idsAvio.has(avio.id)) {
      toast.error(`La receta ya tiene el avío "${avio.clave}".`);
      return;
    }
    setAvios((prev) => [
      ...prev,
      {
        id: avio.id,
        etiqueta: avio.clave,
        detalle: avio.descripcion,
        consumo: '',
        paraPreCosto: true,
        paraProduccion: true,
        paraCosto: true,
        idAmarre: null,
        proveedorAmarrado: null,
        precioPorColor: false,
        precioCosteo: avio.precioReferencia,
        origenPrecio: avio.precioReferencia === null ? 'sin-precio' : 'referencia',
        proveedorPrecio: null,
        amarreIgnorado: false,
        precioReferencia: avio.precioReferencia,
        // Renglón nuevo: el escalón real (¿ya se compró este avío?) lo resuelve el servidor.
        pendienteRecalculo: true,
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
          idTelaProveedor: r.idAmarre,
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
          idAvioProveedor: r.idAmarre,
        })),
      },
      {
        onSuccess: () => toast.success('Avíos de la receta guardados.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  const guardando = guardarTelas.isPending || guardarAvios.isPending;

  // V1-E3v: la sugerencia de favoritos no puede pisar captura sin guardar (ver `difiereDeLaFicha`).
  const aviosSinGuardar = useMemo(() => difiereDeLaFicha(avios, ficha.avios), [avios, ficha.avios]);

  return (
    <div className="space-y-4" data-testid="editor-bom">
      {/* ⭐ V1-E3r (§Post-F9.81) — LA CURVA, ARRIBA DE TODO. Es lo que explica qué tallas trae la
          matriz de cada avío de abajo, y era exactamente la pregunta de Daniel ("¿de dónde toma las
          tallas realmente?"). Avisa si difiere de la de sus OP; propone si el modelo no tiene. */}
      <CurvaDelModelo ficha={ficha} puedeAdministrar={puedeAdministrar} />

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
          alGuardar={guardarSeccionTelas}
          unidadAyuda="Consumo de tela por prenda."
          selectorAgregar={
            <SelectorTela
              idSeleccionado={undefined}
              alSeleccionar={agregarTela}
              testid="agregar-tela-bom"
            />
          }
          renderAmarre={(r, alAmarrar) => (
            <AmarreTela
              renglon={r}
              deshabilitado={!puedeAdministrar || guardando}
              alAmarrar={alAmarrar}
            />
          )}
        />
      ) : seccion === 'avios' ? (
        <div className="space-y-3">
          {/* ⭐ V1-E3v (§Post-F9.90) — los favoritos se SUGIEREN aquí arriba y se aceptan de un
              acto. Quién es favorito y con cuánta cantidad lo dice el servidor (A1). */}
          <SugerenciaAviosFavoritos
            idModelo={ficha.id}
            puedeAdministrar={puedeAdministrar}
            hayCambiosSinGuardar={aviosSinGuardar}
            deshabilitado={guardando}
          />
          <SeccionComponentes
            titulo="avíos"
            renglones={avios}
            alCambiar={setAvios}
            puedeAdministrar={puedeAdministrar}
            guardando={guardarAvios.isPending}
            deshabilitadoGlobal={guardando}
            alGuardar={guardarSeccionAvios}
            unidadAyuda="Consumo de avío por prenda (los avíos que se consumen por talla lo capturan en su panel)."
            selectorAgregar={
              <SelectorAvio
                idSeleccionado={undefined}
                alSeleccionar={agregarAvio}
                testid="agregar-avio-bom"
              />
            }
            renderAmarre={(r, alAmarrar) => (
              <AmarreAvio
                renglon={r}
                deshabilitado={!puedeAdministrar || guardando}
                alAmarrar={alAmarrar}
              />
            )}
            renderExtra={(r) =>
              idsAviosGuardados.has(r.id) ? (
                <EditorMedidasAvio
                  idModelo={ficha.id}
                  idAvio={r.id}
                  puedeAdministrar={puedeAdministrar}
                  tieneCurvaModelo={ficha.tallasCurva.length > 0}
                />
              ) : (
                <p className="border-t pt-2 text-xs text-muted-foreground">
                  Guarda la receta para capturar por talla este avío (su medida o su consumo).
                </p>
              )
            }
          />
        </div>
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

/**
 * Cambios que emite el selector de amarre: **solo el amarre**, nunca el precio.
 *
 * ⚠️ **V1-E3e retiró la re-resolución en cliente.** Hasta agosto de 2026 el selector re-calculaba
 * aquí la cascada (amarre → más barato → referencia) para adelantar el precio. Desde §Post-F9.48 el
 * escalón que gana depende del **histórico de COMPRAS** —la última compra a ese proveedor—, que el
 * navegador no tiene; adivinarlo produciría exactamente la "cifra distinta de la que costea" que
 * prohíbe §Post-F9.47. Además, esa copia de la cascada en TSX era una quinta fuente de divergencia.
 * Ahora el renglón conserva el precio que costea HOY, se marca `pendienteRecalculo` y al guardar el
 * servidor devuelve el número real (la ficha se recarga y siembra la captura otra vez).
 */
interface CambioAmarre {
  idAmarre: number | null;
  proveedorAmarrado: string | null;
  /** ¿El proveedor recién amarrado cotiza por color? (el renglón lo marca de inmediato). */
  precioPorColor: boolean;
  /** Siempre `true`: el precio del renglón quedó pendiente de que lo resuelva el servidor. */
  pendienteRecalculo: true;
}

/** Sección de telas o avíos: tabla densa de renglones compactos con panel expandible. */
function SeccionComponentes({
  titulo,
  renglones,
  alCambiar,
  puedeAdministrar,
  guardando,
  deshabilitadoGlobal,
  alGuardar,
  unidadAyuda,
  selectorAgregar,
  renderAmarre,
  renderExtra,
}: {
  titulo: string;
  renglones: RenglonComponente[];
  alCambiar: React.Dispatch<React.SetStateAction<RenglonComponente[]>>;
  puedeAdministrar: boolean;
  guardando: boolean;
  deshabilitadoGlobal: boolean;
  alGuardar: () => void;
  unidadAyuda: string;
  /** Combobox de búsqueda server-side para agregar un componente (alcanza TODO el catálogo). */
  selectorAgregar: React.ReactNode;
  /** Selector del AMARRE de precio del renglón (R17), dentro del panel expandible. */
  renderAmarre: (
    r: RenglonComponente,
    alAmarrar: (cambio: CambioAmarre) => void,
  ) => React.ReactNode;
  /** Contenido extra por renglón (p. ej. consumo por talla del avío, R18). Opcional. */
  renderExtra?: (r: RenglonComponente) => React.ReactNode;
}): React.JSX.Element {
  const [expandidos, setExpandidos] = useState<ReadonlySet<number>>(new Set());
  const clave = titulo === 'avíos' ? 'avios' : 'telas';

  function alternar(id: number): void {
    setExpandidos((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) {
        siguiente.delete(id);
      } else {
        siguiente.add(id);
      }
      return siguiente;
    });
  }

  function actualizar(id: number, cambios: Partial<RenglonComponente>): void {
    alCambiar((prev) => prev.map((r) => (r.id === id ? { ...r, ...cambios } : r)));
  }
  function quitar(id: number): void {
    alCambiar((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="space-y-3" data-testid={`seccion-bom-${clave}`}>
      {puedeAdministrar ? <div className="max-w-md">{selectorAgregar}</div> : null}

      {renglones.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          La receta no tiene {titulo}.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <TablaDensa>
            <TablaDensaEncabezado>
              <TablaDensaFila>
                <TablaDensaHead className="w-8" />
                <TablaDensaHead>{titulo === 'avíos' ? 'Avío' : 'Tela'}</TablaDensaHead>
                <TablaDensaHead>Precio</TablaDensaHead>
                <TablaDensaHead numerica className="w-28">
                  Consumo
                </TablaDensaHead>
                <TablaDensaHead className="w-10" />
              </TablaDensaFila>
            </TablaDensaEncabezado>
            <TablaDensaCuerpo>
              {renglones.map((r) => (
                <RenglonBom
                  key={r.id}
                  renglon={r}
                  clave={clave}
                  abierto={expandidos.has(r.id)}
                  puedeAdministrar={puedeAdministrar}
                  deshabilitadoGlobal={deshabilitadoGlobal}
                  alAlternar={() => alternar(r.id)}
                  alActualizar={(cambios) => actualizar(r.id, cambios)}
                  alQuitar={() => quitar(r.id)}
                  renderAmarre={renderAmarre}
                  {...(renderExtra === undefined ? {} : { renderExtra })}
                />
              ))}
            </TablaDensaCuerpo>
          </TablaDensa>
        </div>
      )}

      <p className="text-xs text-muted-foreground">{unidadAyuda}</p>

      {puedeAdministrar ? (
        <Button
          type="button"
          size="sm"
          onClick={alGuardar}
          disabled={deshabilitadoGlobal}
          data-testid={`guardar-bom-${clave}`}
        >
          {guardando ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
          Guardar receta
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Un renglón de la receta: fila COMPACTA (componente · precio · consumo) + fila expandible con las
 * tres banderas 🔑, el amarre de precio y lo que aporte la sección (consumo por talla del avío).
 */
function RenglonBom({
  renglon,
  clave,
  abierto,
  puedeAdministrar,
  deshabilitadoGlobal,
  alAlternar,
  alActualizar,
  alQuitar,
  renderAmarre,
  renderExtra,
}: {
  renglon: RenglonComponente;
  clave: 'telas' | 'avios';
  abierto: boolean;
  puedeAdministrar: boolean;
  deshabilitadoGlobal: boolean;
  alAlternar: () => void;
  alActualizar: (cambios: Partial<RenglonComponente>) => void;
  alQuitar: () => void;
  renderAmarre: (
    r: RenglonComponente,
    alAmarrar: (cambio: CambioAmarre) => void,
  ) => React.ReactNode;
  renderExtra?: (r: RenglonComponente) => React.ReactNode;
}): React.JSX.Element {
  const r = renglon;
  const casillas = [
    ['paraPreCosto', 'Pre-costo', 'pre-costo'],
    ['paraProduccion', 'Producción', 'produccion'],
    ['paraCosto', 'Costo', 'costo'],
  ] as const;

  return (
    <>
      <TablaDensaFila seleccionada={abierto} data-testid={`renglon-bom-${r.id}`}>
        <TablaDensaCelda className="p-0 pl-2">
          <button
            type="button"
            onClick={alAlternar}
            className="grid size-7 place-items-center rounded hover:bg-muted"
            aria-label={
              abierto ? `Ocultar detalle de ${r.etiqueta}` : `Ver detalle de ${r.etiqueta}`
            }
            aria-expanded={abierto}
            data-testid={`expandir-bom-${r.id}`}
          >
            <ChevronRight
              className={cn('size-4 transition-transform', abierto && 'rotate-90')}
              aria-hidden
            />
          </button>
        </TablaDensaCelda>
        <TablaDensaCelda>
          <span className="font-medium">{r.etiqueta}</span>
          {r.detalle !== null && r.detalle !== '' ? (
            <span className="block truncate text-xs text-muted-foreground">{r.detalle}</span>
          ) : null}
        </TablaDensaCelda>
        <TablaDensaCelda>
          <PrecioRenglon renglon={r} />
        </TablaDensaCelda>
        <TablaDensaCelda numerica>
          <Input
            type="number"
            min={0}
            step="0.0001"
            inputMode="decimal"
            className="h-7 w-24 text-right"
            placeholder="0"
            aria-label={`Consumo de ${r.etiqueta}`}
            value={r.consumo}
            disabled={!puedeAdministrar || deshabilitadoGlobal}
            onChange={(e) => alActualizar({ consumo: e.target.value })}
            data-testid={`consumo-bom-${r.id}`}
          />
        </TablaDensaCelda>
        <TablaDensaCelda className="p-0 pr-2">
          {puedeAdministrar ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={alQuitar}
              disabled={deshabilitadoGlobal}
              aria-label={`Quitar ${r.etiqueta}`}
              data-testid={`quitar-bom-${r.id}`}
            >
              <Trash2Icon className="text-destructive" aria-hidden />
            </Button>
          ) : null}
        </TablaDensaCelda>
      </TablaDensaFila>

      {abierto ? (
        <TablaDensaFila className="bg-muted/20 hover:bg-muted/20">
          <TablaDensaCelda />
          <TablaDensaCelda colSpan={4} className="py-3">
            <div className="space-y-3" data-testid={`detalle-bom-${r.id}`}>
              {/* Las TRES banderas 🔑 (doc 01-Modelos §2): siguen aquí — sirven para negociar
                  quitarle piezas al modelo (p. ej. una jareta) sin sacarlas de la receta. */}
              <fieldset className="flex flex-wrap items-center gap-4">
                <legend className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  ¿Dónde entra este componente?
                </legend>
                {casillas.map(([campo, etiqueta, testid]) => (
                  <label key={campo} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-input accent-primary"
                      checked={r[campo]}
                      disabled={!puedeAdministrar || deshabilitadoGlobal}
                      onChange={(e) => alActualizar({ [campo]: e.target.checked })}
                      data-testid={`${testid}-bom-${r.id}`}
                    />
                    {etiqueta}
                  </label>
                ))}
              </fieldset>

              {/* AMARRE de precio (R17): el proveedor con el que de verdad se va a costear. */}
              <div data-testid={`amarre-bom-${clave}-${r.id}`}>
                <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Precio amarrado (proveedor)
                </p>
                {renderAmarre(r, (cambio) => alActualizar(cambio))}
              </div>

              {renderExtra === undefined ? null : renderExtra(r)}
            </div>
          </TablaDensaCelda>
        </TablaDensaFila>
      ) : null}
    </>
  );
}

/**
 * Precio del componente en el renglón. ⭐ Regla de Daniel (§Post-F9.47): **la receta nunca enseña
 * una cifra distinta de la que va a costear** — muestra la que costea y dice de dónde salió. El
 * escalón lo resuelve el SERVIDOR con el mismo motor del precosto
 * (`dominio/costos/resolucion-precios.ts`); aquí solo se pinta:
 *
 *  • `ultimo-precio-compra` — ⭐ §Post-F9.48: el precio de la última COMPRA REAL (OC autorizada), que
 *                         desde V1-E3e MANDA sobre todo el catálogo. Se dice a quién se le compró.
 *  • `amarre`           — precio negociado de catálogo, con su proveedor: a ese proveedor todavía no
 *                         se le ha comprado. Si además cotiza por color, se marca: el costeo usará
 *                         el precio del color de la orden, que puede ser mayor.
 *  • `mas-barato`       — NO está negociado: es el más barato del avío (normalizado ÷ factor R1).
 *                         Se dice de qué proveedor salió y se conserva la marca de "falta amarrar".
 *                         Si encima había un amarre, es que ese proveedor no tiene precio: se grita.
 *  • `promedio-medidas` — avío "por medida": promedio de los precios de sus medidas. GANA a todo.
 *  • `referencia`       — catálogo: material NUEVO que nunca se ha comprado ni tiene proveedor.
 *  • `sin-precio`       — no hay precio en ningún escalón: el costeo lo tomaría como 0.
 */
function PrecioRenglon({ renglon }: { renglon: RenglonComponente }): React.JSX.Element {
  const importe = (
    <span className="num text-sm font-medium">{formatearMoneda(renglon.precioCosteo)}</span>
  );
  // ⚠️ «Tu amarre no se está usando» ya NO se deduce del origen: lo dice el SERVIDOR
  // (`amarreIgnorado`), que compara ids de proveedor. Desde §Post-F9.48 el escalón normal de un
  // renglón amarrado es `ultimo-precio-compra` —la última compra A ESE proveedor—, así que ése no
  // es amarre ignorado... salvo cuando la compra fue a OTRO, y ése es justo el caso que hay que
  // gritar: se amarró un proveedor sin precio capturado y el costeo se fue con un tercero.
  // Mientras el amarre esté sin guardar, la bandera del servidor es del amarre ANTERIOR: se calla
  // (el chip «falta guardar» ya dice que el escalón está por resolverse).
  const amarreIgnorado = renglon.amarreIgnorado && !renglon.pendienteRecalculo;

  // El amarre cambió y falta guardar: el número de al lado sigue siendo el que costea HOY. No se
  // adivina el nuevo (depende del histórico de compras, que el navegador no tiene): se avisa, se
  // dice a quién quedó amarrado y —si ese proveedor cotiza por color— se conserva la advertencia.
  // UNA sola definición del chip crítico: el mismo hecho («el amarre no manda») en los tres
  // escalones que pueden llegar a él. El título dice a dónde se fue el precio cuando se sabe.
  const chipAmarreIgnorado = (
    <ChipEstado
      tono="crit"
      sinPunto
      title={
        `El proveedor amarrado (${renglon.proveedorAmarrado ?? '—'}) no tiene precio capturado ` +
        `ni compras, así que el costeo lo salta` +
        (renglon.proveedorPrecio === null ? '.' : ` y usa el de ${renglon.proveedorPrecio}.`)
      }
    >
      amarre sin precio
    </ChipEstado>
  );

  const pendiente = renglon.pendienteRecalculo ? (
    <>
      {renglon.proveedorAmarrado === null ? null : (
        <span className="truncate text-xs text-muted-foreground">
          amarrado: {renglon.proveedorAmarrado}
        </span>
      )}
      {renglon.precioPorColor ? (
        <ChipEstado
          tono="info"
          sinPunto
          title="Este proveedor cotiza por color: el costeo usará el precio del color de la orden, que puede ser mayor."
        >
          precio por color
        </ChipEstado>
      ) : null}
      <ChipEstado
        tono="warn"
        sinPunto
        title="El precio que se ve es el que costea HOY. Guarda la receta: el servidor resuelve el escalón con el amarre nuevo (desde §Post-F9.48 depende de las compras reales, que el navegador no conoce)."
      >
        falta guardar
      </ChipEstado>
    </>
  ) : null;

  switch (renglon.origenPrecio) {
    case 'ultimo-precio-compra':
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          {importe}
          <span className="truncate text-xs text-muted-foreground">
            última compra: {renglon.proveedorPrecio ?? '—'}
          </span>
          {amarreIgnorado ? chipAmarreIgnorado : null}
          {pendiente}
        </span>
      );

    case 'amarre':
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          {importe}
          <span className="truncate text-xs text-muted-foreground">
            {renglon.proveedorPrecio ?? renglon.proveedorAmarrado ?? 'proveedor amarrado'}
          </span>
          {/* Con el amarre recién cambiado la marca de color la pinta `pendiente` (junto al
              proveedor nuevo): pintarla aquí también la duplicaría. */}
          {renglon.precioPorColor && !renglon.pendienteRecalculo ? (
            <ChipEstado
              tono="info"
              sinPunto
              title="Este proveedor cotiza por color: el costeo usará el precio del color de la orden, que puede ser mayor."
            >
              precio por color
            </ChipEstado>
          ) : null}
          {pendiente}
        </span>
      );

    case 'mas-barato':
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          {importe}
          <span className="truncate text-xs text-muted-foreground">
            el más barato: {renglon.proveedorPrecio ?? '—'}
          </span>
          {amarreIgnorado ? (
            chipAmarreIgnorado
          ) : (
            <ChipEstado
              tono="warn"
              sinPunto
              title="Este precio NO está negociado: falta amarrarlo."
            >
              sin amarrar
            </ChipEstado>
          )}
          {pendiente}
        </span>
      );

    case 'promedio-medidas':
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          {importe}
          <ChipEstado
            tono="info"
            sinPunto
            title="Este avío se compra POR MEDIDA: el costeo usa el promedio de los precios de sus medidas activas, aunque tenga proveedor amarrado."
          >
            promedio de medidas
          </ChipEstado>
          {pendiente}
        </span>
      );

    case 'referencia':
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          {importe}
          {amarreIgnorado ? (
            chipAmarreIgnorado
          ) : (
            <ChipEstado
              tono="warn"
              sinPunto
              title="Ningún proveedor tiene precio capturado: se costea con el precio de catálogo."
            >
              referencia
            </ChipEstado>
          )}
          {pendiente}
        </span>
      );

    default:
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="num text-sm text-muted-foreground">—</span>
          <ChipEstado
            tono="crit"
            sinPunto
            title="No hay precio en ningún escalón: el costeo lo tomaría como 0."
          >
            sin precio
          </ChipEstado>
          {pendiente}
        </span>
      );
  }
}

/** Opciones del amarre de una TELA: sus renglones proveedor–precio (`TelaProveedor`). */
function AmarreTela({
  renglon,
  deshabilitado,
  alAmarrar,
}: {
  renglon: RenglonComponente;
  deshabilitado: boolean;
  alAmarrar: (cambio: CambioAmarre) => void;
}): React.JSX.Element {
  // Se monta SOLO con el panel abierto: así la receta no dispara una consulta por renglón.
  const consulta = useTelaProveedores(renglon.id);
  const opciones = (consulta.data ?? []).filter((p) => p.activo || p.id === renglon.idAmarre);

  return (
    <SelectorAmarre
      cargando={consulta.isPending}
      error={consulta.isError ? consulta.error.message : null}
      vacio="Esta tela no tiene proveedores con precio. Captúralos en el catálogo de telas."
      valor={renglon.idAmarre}
      etiqueta={`Proveedor amarrado a ${renglon.etiqueta}`}
      testid={`selector-amarre-tela-${renglon.id}`}
      deshabilitado={deshabilitado}
      opciones={opciones.map((p) => ({
        id: p.id,
        nombre: p.nombreProveedor,
        precio: p.precio,
        porColor: p.manejaPrecioPorColor,
        nota: p.manejaPrecioPorColor ? 'precio por color' : null,
      }))}
      alElegir={(id) => {
        // Solo se registra el AMARRE. El precio lo resuelve el servidor al guardar: desde
        // §Post-F9.48 el escalón que gana es la última COMPRA REAL a ese proveedor, y el
        // navegador no tiene el histórico de compras (ver {@link CambioAmarre}).
        const elegido = opciones.find((p) => p.id === id);
        alAmarrar({
          idAmarre: elegido?.id ?? null,
          proveedorAmarrado: elegido?.nombreProveedor ?? null,
          precioPorColor: elegido?.manejaPrecioPorColor ?? false,
          pendienteRecalculo: true,
        });
      }}
    />
  );
}

/** Opciones del amarre de un AVÍO: los proveedores que lo surten (el amarre guarda el proveedor). */
function AmarreAvio({
  renglon,
  deshabilitado,
  alAmarrar,
}: {
  renglon: RenglonComponente;
  deshabilitado: boolean;
  alAmarrar: (cambio: CambioAmarre) => void;
}): React.JSX.Element {
  const consulta = useProveedoresDeAvio(renglon.id);
  const proveedores = consulta.data ?? [];
  // El precio que se compara y se muestra es el de UNIDAD DE CONSUMO (precio ÷ factor R1): lo
  // calcula el backend (A1), para que el número no cambie entre "recién amarrado" y "ya guardado".
  const precioDe = (p: (typeof proveedores)[number]): number | null =>
    p.precioUnidadConsumo ?? p.precio;

  return (
    <SelectorAmarre
      cargando={consulta.isPending}
      error={consulta.isError ? consulta.error.message : null}
      vacio="Este avío no tiene proveedores con precio. Captúralos en el catálogo de avíos."
      valor={renglon.idAmarre}
      etiqueta={`Proveedor amarrado a ${renglon.etiqueta}`}
      testid={`selector-amarre-avio-${renglon.id}`}
      deshabilitado={deshabilitado}
      opciones={proveedores.map((p) => ({
        id: p.idProveedor,
        nombre: p.nombreProveedor,
        precio: precioDe(p),
        nota: p.condiciones,
      }))}
      alElegir={(id) => {
        // Igual que en la tela: se registra el amarre y NADA MÁS. La cascada que antes se
        // re-implementaba aquí (amarre → más barato → referencia) era una copia que ya no puede
        // acertar —le falta el histórico de compras— y era, en sí misma, una fuente de divergencia.
        const elegido = proveedores.find((p) => p.idProveedor === id);
        alAmarrar({
          idAmarre: elegido?.idProveedor ?? null,
          proveedorAmarrado: elegido?.nombreProveedor ?? null,
          precioPorColor: false,
          pendienteRecalculo: true,
        });
      }}
    />
  );
}

/** Una opción de amarre (proveedor con su precio). */
interface OpcionAmarre {
  id: number;
  nombre: string;
  precio: number | null;
  /** ¿Este proveedor cotiza por color? (solo telas). */
  porColor?: boolean;
  nota: string | null;
}

/**
 * Selector del amarre de precio: lista corta (los proveedores de ESE componente), así que un
 * `<select>` nativo basta — el problema de las 877 telas no aplica aquí. "Sin amarrar" es una
 * opción explícita: deja al renglón costeando por el escalón que siga en la cascada (que el
 * renglón dice, no adivina).
 */
function SelectorAmarre({
  opciones,
  valor,
  cargando,
  error,
  vacio,
  etiqueta,
  testid,
  deshabilitado,
  alElegir,
}: {
  opciones: readonly OpcionAmarre[];
  valor: number | null;
  cargando: boolean;
  error: string | null;
  vacio: string;
  etiqueta: string;
  testid: string;
  deshabilitado: boolean;
  /** Emite el id elegido (o null al desamarrar); el llamador resuelve la cascada de SU tipo. */
  alElegir: (id: number | null) => void;
}): React.JSX.Element {
  if (error !== null) {
    return (
      <p className="text-xs text-destructive" role="alert">
        {error}
      </p>
    );
  }
  if (!cargando && opciones.length === 0) {
    return <p className="text-xs text-muted-foreground">{vacio}</p>;
  }
  return (
    <SelectNativo
      className="max-w-md"
      aria-label={etiqueta}
      data-testid={testid}
      disabled={deshabilitado || cargando}
      value={valor === null ? '' : String(valor)}
      onChange={(e) => alElegir(e.target.value === '' ? null : Number(e.target.value))}
    >
      <option value="">{cargando ? 'Cargando…' : 'Sin amarrar (usa la cascada de precios)'}</option>
      {opciones.map((o) => (
        <option key={o.id} value={String(o.id)}>
          {o.nombre} — {formatearMoneda(o.precio)}
          {o.nota !== null && o.nota.trim() !== '' ? ` · ${o.nota}` : ''}
        </option>
      ))}
    </SelectNativo>
  );
}
