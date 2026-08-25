import {
  ArrowRightLeftIcon,
  CheckIcon,
  ChevronLeft,
  GitBranchIcon,
  ChevronRight,
  FileText,
  Grid3x3,
  Image as ImageIcon,
  Layers,
  Package,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  Ruler,
  Scissors,
  Shirt,
  Tag,
  Trash2,
  Users,
  XIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useExistenciasPt } from '@/api/inventarios';
import {
  useCrearVersionModelo,
  useDescontinuarModelo,
  useFichaModelo,
  useModelos,
  useReactivarModelo,
  type Modelo,
  type ModelosQuery,
} from '@/api/modelos';
import { useTemporadas } from '@/api/temporadas';
import type { ExistenciaPtCelda } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { BuscadorToolbar } from '@/components/dominio/BuscadorToolbar';
import { CajonDetalle } from '@/components/dominio/CajonDetalle';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { ChipsFiltro } from '@/components/dominio/ChipsFiltro';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Avatar, EstadoBadge } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import { SelectNativo } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/lib/useDebounce';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoModelo } from './DialogoModelo';
import { DialogoPasarAProduccion } from './DialogoPasarAProduccion';
import { DialogoRevisionModelo } from './DialogoRevisionModelo';
import { EditorBom } from './EditorBom';
import { FotosModelo } from './FotosModelo';

/** Renglones por página (volumen ~4,987: SIEMPRE modo servidor). */
const POR_PAGINA = 15;

/**
 * ⭐ V1-E7d — Cómo se lee la REVISIÓN de una versión (§Post-F9.110). Los tonos son los semánticos
 * de siempre: aprobada = ok (puede producirse), rechazada = crit (no puede y hay que corregir),
 * pendiente = warn (no puede todavía, y depende de que alguien la firme).
 */
const ETIQUETA_REVISION = {
  pendiente: 'Revisión pendiente',
  aprobada: 'Revisión aprobada',
  rechazada: 'Revisión rechazada',
} as const;

const TONO_REVISION = {
  pendiente: 'warn',
  aprobada: 'ok',
  rechazada: 'crit',
} as const;

/** Valor del filtro de temporada que significa "todas". */
const TEMPORADA_TODAS = 'TODAS';

/** Formatea un precio en pesos (es-MX). */
function formatearPrecio(precio: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(precio);
}

/** Nombre "humano" del modelo para el título/avatar: la descripción, o el código si no tiene. */
function nombreModelo(modelo: Modelo): string {
  const descripcion = modelo.descripcion?.trim() ?? '';
  return descripcion !== '' ? descripcion : modelo.codigo;
}

/**
 * Lee de forma DEFENSIVA el `idModelo` del state de navegación (deep-link desde la galería).
 * Devuelve el id si viene un entero positivo válido; si no hay state o no es válido, `null`
 * (comportamiento por defecto intacto).
 */
function leerIdDeepLink(state: unknown): number | null {
  if (typeof state !== 'object' || state === null || !('idModelo' in state)) {
    return null;
  }
  const id = state.idModelo;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Devuelve los registros a mostrar, inyectando al principio el modelo del deep-link si su ficha
 * ya cargó y NO está en la página visible (así `ListaDetalle` puede seleccionarlo y abrir su
 * ficha aunque la paginación/filtro lo dejen fuera). Si no hay deep-link o ya está presente,
 * devuelve la lista tal cual.
 */
function conDeepLinkInyectado(
  visibles: readonly Modelo[],
  fichaDeepLink: Modelo | undefined,
  idAbrir: number | null,
): readonly Modelo[] {
  if (idAbrir === null || fichaDeepLink === undefined || fichaDeepLink.id !== idAbrir) {
    return visibles;
  }
  if (visibles.some((m) => m.id === idAbrir)) {
    return visibles;
  }
  return [fichaDeepLink, ...visibles];
}

/**
 * Pantalla de Modelos (Módulo 2, F1-E4) — TABLA-FIRST fiel al proto `vModelos`:
 * page-head con conteo vivo («… · N modelos · M mostrados») + «Nuevo modelo»; toolbar con
 * buscador (código/nombre), chips de estado (Activos | Todos), filtro por temporada, el conteo
 * plano «M de N» y el SEGMENTADO Tabla | Galería (proto `.seg`); TABLA DENSA con las columnas
 * del proto (Modelo con MINIATURA de foto real + nombre/código · Temporada como badge neutral
 * con punto · Tela principal · Tallas · Stock PT · Costo · Estado — los agregados los sirve el
 * LISTADO del backend por fila, sin N+1) y paginación de SERVIDOR al pie. Al hacer clic en un
 * renglón se abre el CAJÓN (proto `drawerModelo`): encabezado con foto hero 46px + nombre +
 * estado + línea `código · Temporada`; secciones Ficha (tela principal, rango de tallas,
 * maquila base, existencia PT), Receta / BOM (editor de 3 pestañas + copiar), MATRIZ color ×
 * talla · existencia (rollup `porColorTalla` YA sumado en servidor a través de almacenes, A1;
 * `inventario-pt.ver`), Fotos y el historial. Conserva el DEEP-LINK (`state.idModelo`).
 *
 * FIDELIDAD vs proto — huecos restantes (reportados, no inventados): columna «Colores»
 * (swatches) NO va (decisión D14 de Daniel: los colores no son atributo del modelo); botón
 * «Exportar» (sin endpoint); filtro por tela; «Ficha PDF» del cajón.
 *
 * `modelos.ver` gobierna el acceso; `modelos.administrar` decide las acciones de escritura (A1).
 */
export function ModelosPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('modelos.administrar');
  // ⭐ V1-E7b (§Post-F9.110) — aprobar la RECETA creando la versión es un permiso APARTE, que
  // llega hasta Gerencial (Daniel: *"Aurora podría hacerlo aparte de mí"*) mientras
  // `modelos.administrar` se corta en Directivo. Por eso NO se cuelga de `puedeAdministrar`: si lo
  // hiciera, a quien Daniel le encargó el trabajo no le aparecería el botón.
  const puedeVersionar = tienePermiso('modelos.aprobar-receta');

  // Deep-link desde la galería (u otra vista): `state.idModelo` abre la ficha de ESE modelo.
  const navigate = useNavigate();
  const location = useLocation();
  const idDeepLink = leerIdDeepLink(location.state);
  // Lo guardamos en estado local para que sobreviva al `navigate(..., { state: null })` que
  // limpia el state del historial (evita re-disparar en un refresh o al volver).
  const [idAbrir, setIdAbrir] = useState<number | null>(idDeepLink);
  // El cajón guarda el ID; el modelo mostrado se DERIVA de la lista viva. Arranca en el deep-link.
  const [seleccionId, setSeleccionId] = useState<number | null>(idDeepLink);
  useEffect(() => {
    if (idDeepLink !== null) {
      setIdAbrir(idDeepLink);
      setSeleccionId(idDeepLink);
      // Consume el state: limpia el historial para que un refresh/volver no lo re-aplique.
      // navigate() es asíncrono en React Router 7; no necesitamos esperarlo.
      void navigate(location.pathname, { replace: true, state: null });
    }
  }, [idDeepLink, location.pathname, navigate]);

  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [temporadaFiltro, setTemporadaFiltro] = useState<string>(TEMPORADA_TODAS);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  // Filtro de ORIGEN (§Post-F9.34 punto 2): el catálogo enseña PRODUCCIÓN por default, para no
  // llenarse de los modelos de desarrollo que nunca salen. Los de desarrollo quedan a un clic.
  const [origen, setOrigen] = useState<'produccion' | 'desarrollo' | 'todos'>('produccion');
  const [pagina, setPagina] = useState(1);

  const query: ModelosQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'codigo',
    direccion: 'asc',
    origen,
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(temporadaFiltro !== TEMPORADA_TODAS ? { idTemporada: Number(temporadaFiltro) } : {}),
  };

  const consulta = useModelos(query);
  // Deep-link: trae la ficha del modelo a abrir (datos generales + BOM). Sirve para SELECCIONARLO
  // aunque no esté en la página/filtro visibles (se inyecta en la lista). Deshabilitada si no
  // hay deep-link. `ModeloFicha` es un superconjunto de `Modelo`, así que sirve como registro.
  const fichaDeepLink = useFichaModelo(idAbrir ?? undefined);
  const temporadas = useTemporadas({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: 'false',
  });
  const descontinuar = useDescontinuarModelo();
  const reactivar = useReactivarModelo();
  const crearVersion = useCrearVersionModelo();

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [modeloEnEdicion, setModeloEnEdicion] = useState<Modelo | undefined>(undefined);
  const [aDescontinuar, setADescontinuar] = useState<Modelo | null>(null);
  const [aPromover, setAPromover] = useState<Modelo | null>(null);
  const [aVersionar, setAVersionar] = useState<Modelo | null>(null);
  // ⭐ V1-E7d — qué versión se está revisando y en qué sentido (§Post-F9.110).
  const [aRevisar, setARevisar] = useState<{
    modelo: Modelo;
    accion: 'aprobar' | 'rechazar';
  } | null>(null);

  function abrirAlta(): void {
    setModeloEnEdicion(undefined);
    setDialogoAbierto(true);
  }
  function abrirEdicion(modelo: Modelo): void {
    setModeloEnEdicion(modelo);
    setDialogoAbierto(true);
  }

  /**
   * ⭐ V1-E7b — Crea la VERSIÓN del modelo y ABRE LA NUEVA. El código, el sufijo y la copia de la
   * receta los decide el servidor (A1): aquí sólo se pide y se navega al resultado, reusando el
   * mismo camino del deep-link (`idAbrir` trae la ficha del modelo aunque no esté en la página).
   */
  function confirmarVersion(): void {
    if (aVersionar === null) {
      return;
    }
    const padre = aVersionar;
    crearVersion.mutate(
      { id: padre.id },
      {
        onSuccess: (nuevo) => {
          toast.success(`Nació el modelo "${nuevo.codigo}" con la receta de "${padre.codigo}".`);
          setAVersionar(null);
          setIdAbrir(nuevo.id);
          setSeleccionId(nuevo.id);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function confirmarDescontinuar(): void {
    if (aDescontinuar === null) {
      return;
    }
    const objetivo = aDescontinuar;
    descontinuar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Modelo "${objetivo.codigo}" descontinuado.`);
        setADescontinuar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  function reactivarModelo(modelo: Modelo): void {
    reactivar.mutate(modelo.id, {
      onSuccess: () => toast.success(`Modelo "${modelo.codigo}" reactivado.`),
      onError: (error) => toast.error(error.message),
    });
  }

  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
    setPagina(1);
  }
  function alCambiarTemporada(valor: string): void {
    setTemporadaFiltro(valor);
    setPagina(1);
  }
  function alAlternarInactivos(): void {
    setIncluirInactivos((v) => !v);
    setPagina(1);
  }
  function alCambiarOrigen(valor: string): void {
    setOrigen(valor as 'produccion' | 'desarrollo' | 'todos');
    setPagina(1);
  }

  const datos = consulta.data;
  const total = datos?.total ?? 0;
  const totalPaginas = datos?.totalPaginas ?? 1;

  // Registros a mostrar. Si hay deep-link y el modelo NO está en la página visible, lo
  // inyectamos al principio para que el cajón pueda seleccionarlo y abrir su ficha (sin
  // depender de la paginación/filtro). El conteo del paginador (servidor) no se altera.
  const registros = conDeepLinkInyectado(datos?.datos ?? [], fichaDeepLink.data, idAbrir);
  const seleccion = registros.find((m) => m.id === seleccionId) ?? null;
  // El cajón abre en cuanto hay un id seleccionado, y con el DEEP-LINK eso ocurre ANTES de que
  // llegue el registro (listado y ficha viajan por su cuenta). En ese hueco el cajón enseñaba un
  // panel EN BLANCO —justo en el camino «toco el arte → se abre su modelo»—; ahora enseña su
  // estado de carga, o el error si la ficha del deep-link no se pudo traer.
  const esperandoSeleccion = seleccionId !== null && seleccion === null;
  const errorFichaDeepLink = esperandoSeleccion ? fichaDeepLink.error : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:p-5 lg:overflow-visible">
      {/* ── Encabezado (proto .page-head: conteo vivo en el sub) ─────────────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">Modelos</h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Catálogo de producto
            {datos !== undefined
              ? ` · ${total.toLocaleString('es-MX')} modelos · ${registros.length.toLocaleString('es-MX')} mostrados`
              : ''}
          </p>
        </div>
        {puedeAdministrar ? (
          <Button size="sm" onClick={abrirAlta} data-testid="nuevo-modelo">
            <Plus aria-hidden />
            Nuevo modelo
          </Button>
        ) : null}
      </header>

      {/* ── Card: toolbar + tabla + totales ─────────────────────────────────── */}
      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border bg-card lg:min-h-0 lg:flex-1 lg:shrink">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2.5">
          <BuscadorToolbar
            valor={textoBusqueda}
            alCambiar={alBuscar}
            placeholder="Buscar por código, nº de desarrollo o nombre…"
            etiqueta="Buscar modelos por código, nº de desarrollo o nombre"
            testid="buscar-modelo"
          />
          <ChipsFiltro
            etiqueta="Filtrar por origen"
            opciones={[
              { valor: 'produccion', etiqueta: 'Producción', testid: 'origen-produccion' },
              { valor: 'desarrollo', etiqueta: 'Desarrollo', testid: 'origen-desarrollo' },
              { valor: 'todos', etiqueta: 'Todos', testid: 'origen-todos' },
            ]}
            valor={origen}
            alCambiar={alCambiarOrigen}
          />
          <ChipsFiltro
            etiqueta="Filtrar por estado"
            opciones={[
              { valor: 'activos', etiqueta: 'Activos' },
              // El testid heredado vive en «Todos»: los e2e lo clickean para incluir inactivos.
              { valor: 'todos', etiqueta: 'Todos', testid: 'mostrar-desactivados' },
            ]}
            valor={incluirInactivos ? 'todos' : 'activos'}
            alCambiar={() => alAlternarInactivos()}
          />
          <span className="w-44">
            <SelectNativo
              className="h-[30px] text-xs"
              value={temporadaFiltro}
              onChange={(e) => alCambiarTemporada(e.target.value)}
              aria-label="Filtrar modelos por temporada"
              data-testid="filtro-temporada-modelo"
            >
              <option value={TEMPORADA_TODAS}>Todas las temporadas</option>
              {(temporadas.data?.datos ?? []).map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.nombre}
                </option>
              ))}
            </SelectNativo>
          </span>
          <div className="ml-auto flex items-center gap-2">
            {/* Conteo plano del proto (`.count`): "8 de 214". */}
            <span className="text-[12px] text-faint">
              {registros.length.toLocaleString('es-MX')} de {total.toLocaleString('es-MX')}
            </span>
            {/* Segmentado Tabla | Galería (proto `.seg`): la galería es la otra vista. */}
            <div
              className="inline-flex overflow-hidden rounded-[8px] border"
              role="group"
              aria-label="Cambiar de vista"
            >
              <span
                aria-current="page"
                className="bg-primary px-[11px] py-[5px] text-[12px] font-semibold text-primary-foreground"
              >
                Tabla
              </span>
              <Link
                to="/modelos/galeria"
                data-testid="ir-a-galeria-modelos"
                className="bg-panel-2 px-[11px] py-[5px] text-[12px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Galería
              </Link>
            </div>
          </div>
        </div>

        {/* ── Cuerpo scrolleable ─────────────────────────────────────────── */}
        <div className="overflow-auto lg:min-h-0 lg:flex-1">
          {consulta.isError ? (
            <div className="space-y-2 p-6">
              <p className="text-sm text-destructive" role="alert">
                {consulta.error.message}
              </p>
              <Button variant="outline" size="sm" onClick={() => void consulta.refetch()}>
                Reintentar
              </Button>
            </div>
          ) : consulta.isPending ? (
            <p className="p-6 text-sm text-muted-foreground">Cargando modelos…</p>
          ) : registros.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground" data-testid="modelo-vacio">
              No hay modelos que coincidan con la búsqueda.
            </p>
          ) : (
            <>
              {/* Móvil (<lg): tarjetas apiladas — la tabla de 7 columnas se apachurra en teléfono.
                  Mismo clic (selecciona → cajón) que la fila. */}
              <div className="space-y-2 p-3 lg:hidden" data-testid="modelo-tarjetas">
                {registros.map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() => setSeleccionId(m.id)}
                    data-testid="modelo-tarjeta"
                    className={cn(
                      'w-full rounded-lg border bg-card p-3 text-left',
                      seleccion?.id === m.id && 'ring-2 ring-primary',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <MiniaturaModelo modelo={m} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate font-semibold">{nombreModelo(m)}</div>
                            {m.descripcion !== null && m.descripcion.trim() !== '' ? (
                              <div className="mono truncate text-xs text-muted-foreground">
                                {m.codigo}
                              </div>
                            ) : null}
                          </div>
                          <EstadoBadge activo={m.activo} />
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      {m.temporada !== null ? (
                        <ChipEstado tono="neutro">{m.temporada}</ChipEstado>
                      ) : null}
                      <span className="text-muted-foreground">Tela: {m.telaPrincipal ?? '—'}</span>
                      <span className="text-muted-foreground">Tallas: {m.curvaTalla ?? '—'}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      <span>
                        Stock{' '}
                        <span
                          className={cn(
                            'num font-medium',
                            m.stockPt === 0 || m.stockPt === null
                              ? 'text-muted-foreground'
                              : 'text-foreground',
                          )}
                        >
                          {m.stockPt === null ? '—' : m.stockPt.toLocaleString('es-MX')}
                        </span>
                      </span>
                      <span>
                        Costo{' '}
                        <span className="mono font-medium">
                          {m.costoActual === null ? '—' : formatearPrecio(m.costoActual)}
                        </span>
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              {/* Escritorio (≥lg): tabla densa completa. */}
              <div className="hidden lg:block" data-testid="modelos-tabla">
                <TablaDensa>
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead>Modelo</TablaDensaHead>
                      <TablaDensaHead>Temporada</TablaDensaHead>
                      <TablaDensaHead>Tela principal</TablaDensaHead>
                      <TablaDensaHead>Tallas</TablaDensaHead>
                      <TablaDensaHead numerica>Stock PT</TablaDensaHead>
                      <TablaDensaHead numerica>Costo</TablaDensaHead>
                      <TablaDensaHead>Estado</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {registros.map((m) => (
                      <TablaDensaFila
                        key={m.id}
                        seleccionada={seleccion?.id === m.id}
                        className="cursor-pointer"
                        onClick={() => setSeleccionId(m.id)}
                        data-testid="fila-modelo"
                      >
                        <TablaDensaCelda>
                          <div className="flex items-center gap-2">
                            <MiniaturaModelo modelo={m} />
                            <div className="min-w-0">
                              {/* Proto `.cell-strong`/`.cell-code`: NOMBRE arriba, código abajo. */}
                              <div className="flex items-center gap-1.5">
                                <span className="truncate font-semibold">{nombreModelo(m)}</span>
                                {m.origen === 'desarrollo' ? (
                                  <ChipEstado tono="neutro">Desarrollo</ChipEstado>
                                ) : null}
                              </div>
                              {/* El código VIGENTE y, si el modelo fue promovido, también su nº de
                                  DESARROLLO: los dos son suyos y los dos son buscables (D3). */}
                              {m.descripcion !== null && m.descripcion.trim() !== '' ? (
                                <div className="mono truncate text-xs text-muted-foreground">
                                  {m.codigo}
                                </div>
                              ) : null}
                              {m.codigoDesarrollo !== null && m.codigoDesarrollo !== m.codigo ? (
                                <div className="mono truncate text-xs text-faint">
                                  desarrollo {m.codigoDesarrollo}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </TablaDensaCelda>
                        <TablaDensaCelda>
                          {m.temporada !== null ? (
                            // Proto: badge NEUTRAL con punto (`.badge.neutral > .d`).
                            <ChipEstado tono="neutro">{m.temporada}</ChipEstado>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TablaDensaCelda>
                        <TablaDensaCelda>{m.telaPrincipal ?? '—'}</TablaDensaCelda>
                        <TablaDensaCelda>{m.curvaTalla ?? '—'}</TablaDensaCelda>
                        {/* Proto: stock en 0 se atenúa (`.cell-sub`); el dato lo agrega el backend. */}
                        <TablaDensaCelda
                          numerica
                          className={m.stockPt === 0 ? 'text-muted-foreground' : undefined}
                        >
                          {m.stockPt === null ? '—' : m.stockPt.toLocaleString('es-MX')}
                        </TablaDensaCelda>
                        {/* Costo del último costeo (F7); null (sin costeo o sin permiso) → "—". */}
                        <TablaDensaCelda numerica className="mono">
                          {m.costoActual === null ? '—' : formatearPrecio(m.costoActual)}
                        </TablaDensaCelda>
                        <TablaDensaCelda>
                          <EstadoBadge activo={m.activo} />
                        </TablaDensaCelda>
                      </TablaDensaFila>
                    ))}
                  </TablaDensaCuerpo>
                </TablaDensa>
              </div>
            </>
          )}
        </div>

        {/* ── Barra de totales al pie ────────────────────────────────────── */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-t bg-secondary px-3 py-1.5 text-xs">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] font-medium text-faint uppercase">Modelos (filtro)</span>
            <b className="num">{total.toLocaleString('es-MX')}</b>
          </span>
          <span className="ml-auto flex items-center gap-1 text-muted-foreground">
            Página {pagina} de {totalPaginas}
            <Button
              variant="ghost"
              size="icon"
              disabled={pagina <= 1 || consulta.isFetching}
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              aria-label="Página anterior"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={pagina >= totalPaginas || consulta.isFetching}
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              aria-label="Página siguiente"
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </span>
        </div>
      </div>

      {/* ── Cajón de detalle del modelo (ancho: fotos + BOM necesitan espacio) ── */}
      <CajonDetalle
        ancho="amplio"
        abierto={seleccionId !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) setSeleccionId(null);
        }}
        titulo={
          seleccion !== null ? (
            // Proto `drawer-head`: hero 46px + nombre + estado, y abajo `código · Temporada`.
            // Todo vive en el título del cajón para no tocar el componente compartido; el
            // nombre accesible del heading conserva el CÓDIGO (los e2e lo buscan ahí).
            <span className="flex items-center gap-3">
              <MiniaturaModelo modelo={seleccion} hero />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-[15px]">
                  {nombreModelo(seleccion)}
                  <EstadoBadge activo={seleccion.activo} />
                </span>
                <span className="mono text-xs font-normal text-muted-foreground">
                  {seleccion.codigo}
                  {seleccion.codigoDesarrollo !== null &&
                  seleccion.codigoDesarrollo !== seleccion.codigo
                    ? ` · desarrollo ${seleccion.codigoDesarrollo}`
                    : ''}
                  {seleccion.temporada !== null ? ` · Temporada ${seleccion.temporada}` : ''}
                </span>
                {/* ⭐ V1-E7b — El LINAJE: de qué modelo nació esta versión, con liga para ir a
                    verlo. El sufijo del código ya lo insinúa; esto lo dice con todas sus letras y
                    lo hace navegable. */}
                {seleccion.versionDesarrollo !== null && seleccion.codigoPadre !== null ? (
                  <span
                    className="text-xs font-normal text-muted-foreground"
                    data-testid="linaje-modelo"
                  >
                    Versión {seleccion.versionDesarrollo} de{' '}
                    <button
                      type="button"
                      className="mono underline underline-offset-2 hover:text-foreground"
                      onClick={() => {
                        if (seleccion.idModeloPadre !== null) {
                          setIdAbrir(seleccion.idModeloPadre);
                          setSeleccionId(seleccion.idModeloPadre);
                        }
                      }}
                    >
                      {seleccion.codigoPadre}
                    </button>
                  </span>
                ) : null}
                {/* ⭐ V1-E7d — LA REVISIÓN antes de mandar a producir (§Post-F9.110). Sólo aparece
                    en las versiones (en cualquier otro modelo `revisionEstado` viene null: no
                    lleva revisión). Dice en qué quedó, quién firmó y cuándo; el rechazo enseña
                    además el motivo, porque es lo único que le sirve a quien tiene que corregir.

                    ⭐ V1-E7e (§Post-F9.116) — Y ahora la nota se enseña TAMBIÉN en `pendiente`,
                    porque «pendiente» ya no significa una sola cosa: puede ser una versión que
                    nadie ha mirado, o una que SÍ se aprobó y perdió la firma porque después le
                    cambiaron la receta. Sin la nota, la pantalla diría "nadie la ha revisado" de
                    una versión que Aurora sí revisó — y quien la vuelva a mirar no sabría qué
                    cambió desde entonces. El texto sin firmante y la nota se excluyen: o hay
                    firma, o hay explicación de por qué ya no la hay. */}
                {seleccion.revisionEstado !== null ? (
                  <span
                    className="flex flex-wrap items-center gap-2 text-xs font-normal text-muted-foreground"
                    data-testid="revision-modelo"
                  >
                    <ChipEstado tono={TONO_REVISION[seleccion.revisionEstado]}>
                      {ETIQUETA_REVISION[seleccion.revisionEstado]}
                    </ChipEstado>
                    {seleccion.revisadoPor !== null ? (
                      <span>
                        por {seleccion.revisadoPor}
                        {seleccion.revisadoEn !== null
                          ? ` · ${new Date(seleccion.revisadoEn).toLocaleDateString('es-MX')}`
                          : ''}
                      </span>
                    ) : seleccion.revisionNota === null ? (
                      <span>Nadie la ha revisado todavía; no puede mandarse a producir.</span>
                    ) : null}
                    {seleccion.revisionEstado !== 'aprobada' && seleccion.revisionNota !== null ? (
                      <span className="text-crit">«{seleccion.revisionNota}»</span>
                    ) : null}
                  </span>
                ) : null}
              </span>
            </span>
          ) : errorFichaDeepLink !== null ? (
            'No se pudo abrir el modelo'
          ) : esperandoSeleccion ? (
            'Abriendo modelo…'
          ) : (
            ''
          )
        }
        acciones={
          seleccion !== null && (puedeAdministrar || puedeVersionar) ? (
            <>
              {/* ⭐ V1-E7b — «Crear versión» va bajo SU permiso, no bajo el de administrar: si se
                  colgara de `puedeAdministrar`, Gerencial (Aurora) no lo vería nunca. Y sólo se
                  pinta si el modelo TIENE número de desarrollo: el sufijo cuelga de él, así que
                  sin código de desarrollo el botón sería una puerta cerrada. */}
              {puedeVersionar && seleccion.codigoDesarrollo !== null ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAVersionar(seleccion)}
                  data-testid="crear-version-modelo"
                >
                  <GitBranchIcon aria-hidden />
                  Crear versión
                </Button>
              ) : null}
              {/* ⭐ V1-E7d — Firmar la REVISIÓN. Va bajo el MISMO permiso que crear la versión
                  (`modelos.aprobar-receta`, hasta Gerencial) y sólo se pinta en las versiones y
                  mientras no estén ya en producción — después, la revisión ya no gobierna nada.
                  Ocultarlo es cortesía: quien de verdad niega producir sin revisión es el backend,
                  dentro del núcleo de la promoción (por eso también cubre «generar la OP»). */}
              {puedeVersionar &&
              seleccion.revisionEstado !== null &&
              seleccion.origen === 'desarrollo' ? (
                <>
                  {seleccion.revisionEstado === 'aprobada' ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setARevisar({ modelo: seleccion, accion: 'aprobar' })}
                      data-testid="aprobar-revision-modelo"
                    >
                      <CheckIcon aria-hidden />
                      Aprobar revisión
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setARevisar({ modelo: seleccion, accion: 'rechazar' })}
                    data-testid="rechazar-revision-modelo"
                  >
                    <XIcon aria-hidden />
                    Rechazar revisión
                  </Button>
                </>
              ) : null}
              {puedeAdministrar ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => abrirEdicion(seleccion)}
                    data-testid="editar-modelo"
                  >
                    <Pencil aria-hidden />
                    Editar
                  </Button>
                  {seleccion.origen === 'desarrollo' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAPromover(seleccion)}
                      data-testid="pasar-a-produccion"
                    >
                      <ArrowRightLeftIcon aria-hidden />
                      Pasar a producción
                    </Button>
                  ) : null}
                  {seleccion.activo ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setADescontinuar(seleccion)}
                      data-testid="desactivar-modelo"
                    >
                      <Trash2 aria-hidden />
                      Descontinuar
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => reactivarModelo(seleccion)}
                      data-testid="activar-modelo"
                    >
                      <RotateCcw aria-hidden />
                      Reactivar
                    </Button>
                  )}
                </>
              ) : null}
            </>
          ) : undefined
        }
      >
        {seleccion !== null ? (
          <DetalleModelo modelo={seleccion} puedeAdministrar={puedeAdministrar} />
        ) : errorFichaDeepLink !== null ? (
          <p className="text-sm text-destructive" role="alert">
            {errorFichaDeepLink.message}
          </p>
        ) : esperandoSeleccion ? (
          <div className="space-y-3" data-testid="detalle-modelo-cargando">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : null}
      </CajonDetalle>

      {/* ⭐ V1-E7b — La confirmación dice qué va a pasar, y por eso mismo NO enseña un código de
          ejemplo. Lo enseñaba, armado como «código del padre + -01», y al versionar un modelo que
          YA era una versión escribía `CYA-26-71-001-01-01`: justo la forma ANIDADA que Daniel
          descartó —*"en tres temporadas hay -01-02-01 y nadie lo lee"*— exhibida como promesa a
          quien está a punto de aprobar. El servidor creaba bien el `-02`; mentía el texto.

          Y no se arregla calculándolo mejor en el cliente, por dos razones independientes:
           1. El sufijo es `max(la familia) + 1` leído BAJO LOCK (ver `dominio/modelos/versiones.ts`).
              El cliente no tiene la familia: aunque partiera de la RAÍZ, un modelo cuya familia ya
              tiene `-01` y `-02` recibe `-03`, no `-01`. Seguiría prometiendo un número que el
              servidor puede desmentir — y peor, fallando sólo a veces, que es cuando se le cree.
           2. Derivar la raíz aquí obligaría a COPIAR `raizDeCodigoDesarrollo` al frontend: lógica
              de negocio fuera de `backend/src/dominio` (A1), y una copia que puede divergir del
              original. Backend y frontend sólo comparten el OpenAPI (ADR-0002): «la misma función»
              no está disponible, sólo una copia — que es exactamente lo que no se debe hacer.

          Así que se dice la FORMA y quién decide el número, y el número real se ve al abrirse el
          modelo nuevo. Prometer menos y cumplirlo. */}
      <DialogoConfirmacion
        abierto={aVersionar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) setAVersionar(null);
        }}
        titulo="Crear versión del modelo"
        descripcion={
          <>
            Va a nacer un modelo NUEVO a partir de{' '}
            <span className="font-medium text-foreground">{aVersionar?.codigo}</span>, con{' '}
            <span className="font-medium text-foreground">la misma receta</span> (telas, avíos y
            arte) y un número de versión al final del código. El número lo asigna el sistema —el
            siguiente libre de la familia— y lo verás al terminar, porque se abre el modelo nuevo.
            El modelo actual <span className="font-medium text-foreground">queda igual</span>: lo
            que ya se produjo con él no se toca.
          </>
        }
        textoConfirmar="Crear versión"
        procesando={crearVersion.isPending}
        alConfirmar={confirmarVersion}
      />

      <DialogoRevisionModelo
        abierto={aRevisar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) setARevisar(null);
        }}
        modelo={aRevisar?.modelo ?? null}
        accion={aRevisar?.accion ?? 'aprobar'}
      />

      <DialogoPasarAProduccion
        abierto={aPromover !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) setAPromover(null);
        }}
        modelo={aPromover}
      />

      <DialogoModelo
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        modelo={modeloEnEdicion}
      />
      <DialogoConfirmacion
        abierto={aDescontinuar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADescontinuar(null);
          }
        }}
        titulo="Descontinuar modelo"
        descripcion={
          <>
            ¿Seguro que quieres descontinuar el modelo{' '}
            <span className="font-medium text-foreground">{aDescontinuar?.codigo}</span>? Podrás
            volver a activarlo después; su receta y fotos se conservan.
          </>
        }
        textoConfirmar="Descontinuar"
        variante="destructive"
        procesando={descontinuar.isPending}
        alConfirmar={confirmarDescontinuar}
      />
    </div>
  );
}

/**
 * Miniatura del modelo (proto `.thumb` 30px / `.dt-hero` 46px): la FOTO principal real si el
 * listado la trae (`urlFotoPrincipal`, ya resuelta por el backend — sin N+1), o el avatar de
 * iniciales como respaldo. `hero` usa el tamaño grande del encabezado del cajón.
 */
function MiniaturaModelo({
  modelo,
  hero = false,
}: {
  modelo: Modelo;
  hero?: boolean;
}): React.JSX.Element {
  if (modelo.urlFotoPrincipal !== null) {
    return (
      <img
        src={modelo.urlFotoPrincipal}
        alt=""
        aria-hidden
        loading="lazy"
        data-testid="miniatura-fila-modelo"
        className={cn(
          'shrink-0 border object-cover',
          hero ? 'size-[46px] rounded-[11px]' : 'size-8 rounded-lg',
        )}
      />
    );
  }
  return (
    <Avatar
      nombre={nombreModelo(modelo)}
      tono="pt"
      tamano={hero ? 'md' : 'sm'}
      {...(hero ? { className: 'size-[46px] rounded-[11px] text-[15px]' } : {})}
    />
  );
}

/**
 * Matriz color × talla · existencia (proto `drawerModelo` `.matrix`): pinta el rollup
 * `porColorTalla` que el SERVIDOR ya agregó (existencia por color×talla sumada a través de
 * almacenes/órdenes — `agrupar=color-talla`, A1). Aquí ya no se pivota nada: solo se acomoda la
 * rejilla (columnas por el orden del catálogo de tallas) y el Σ del renglón para mostrar.
 */
function MatrizExistenciaModelo({
  celdas,
}: {
  celdas: readonly ExistenciaPtCelda[];
}): React.JSX.Element {
  // Tallas presentes (columnas), por el orden del catálogo; colores presentes (renglones).
  const tallas = [...new Map(celdas.map((c) => [c.idTalla, c])).values()].sort(
    (a, b) => a.ordenTalla - b.ordenTalla || a.etiquetaTalla.localeCompare(b.etiquetaTalla),
  );
  const colores = [...new Map(celdas.map((c) => [c.idColor, c])).values()].sort((a, b) =>
    a.color.localeCompare(b.color),
  );
  const porCelda = new Map(celdas.map((c) => [`${c.idColor}:${c.idTalla}`, c.existencia]));
  // Σ del renglón (total del color): suma de las celdas YA agregadas por el servidor.
  const porColor = new Map<number, number>();
  for (const c of celdas) {
    porColor.set(c.idColor, (porColor.get(c.idColor) ?? 0) + c.existencia);
  }

  return (
    <div className="overflow-x-auto rounded-[9px] border">
      <table className="w-full border-collapse text-xs" data-testid="matriz-existencia-modelo">
        <thead>
          <tr>
            <th className="border-b bg-secondary px-2 py-1.5 text-left text-[11px] font-semibold text-muted-foreground">
              Color
            </th>
            {tallas.map((t) => (
              <th
                key={t.idTalla}
                className="border-b border-l bg-secondary px-2 py-1.5 text-center text-[11px] font-semibold text-muted-foreground"
              >
                {t.etiquetaTalla}
              </th>
            ))}
            <th className="border-b border-l bg-secondary px-2 py-1.5 text-center text-[11px] font-semibold text-muted-foreground">
              Σ
            </th>
          </tr>
        </thead>
        <tbody>
          {colores.map((c) => (
            <tr key={c.idColor} className="last:[&>td]:border-b-0">
              <td className="border-b bg-secondary px-2 py-1.5 text-left">{c.color}</td>
              {tallas.map((t) => {
                const v = porCelda.get(`${c.idColor}:${t.idTalla}`) ?? 0;
                return (
                  <td
                    key={t.idTalla}
                    className={cn(
                      'num border-b border-l px-2 py-1.5 text-center',
                      v === 0 ? 'text-faint' : '',
                    )}
                  >
                    {v.toLocaleString('es-MX')}
                  </td>
                );
              })}
              <td className="num border-b border-l px-2 py-1.5 text-center font-bold">
                {(porColor.get(c.idColor) ?? 0).toLocaleString('es-MX')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Panel de DETALLE de un modelo (proto `drawerModelo`): trae la FICHA completa (datos + BOM) por
 * id y, si el usuario puede ver inventario PT, las EXISTENCIAS del modelo (UNA consulta por
 * cajón, no por fila). Secciones en el orden del proto: Ficha → Receta / BOM → Matriz color ×
 * talla → Fotos → Historial. El BOM se edita por sección con guardado independiente (el backend
 * reemplaza el set en una transacción A2).
 */
function DetalleModelo({
  modelo,
  puedeAdministrar,
}: {
  modelo: Modelo;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const ficha = useFichaModelo(modelo.id);
  // Existencia PT del modelo (suma de kardex, D3). Solo si tiene el permiso del módulo de
  // inventarios; si no, la consulta ni se dispara y las piezas de existencia no se muestran.
  // `agrupar=color-talla` pide además el rollup de la matriz YA sumado en servidor (A1).
  const puedeVerInventario = tienePermiso('inventario-pt.ver');
  const existencias = useExistenciasPt(
    { idModelo: modelo.id, agrupar: 'color-talla' },
    puedeVerInventario,
  );
  const celdasExistencia = existencias.data?.porColorTalla ?? [];

  // Tela principal (proto): el primer renglón de tela del BOM (el modelo viejo la lista primero).
  const telaPrincipal = ficha.data?.telas[0]?.nombre ?? null;

  return (
    <div data-testid="detalle-modelo">
      <SeccionDetalle titulo="Ficha" icono={Shirt}>
        <RejillaCampos>
          {telaPrincipal !== null ? (
            <CampoDetalle icono={Scissors} etiqueta="Tela principal">
              {telaPrincipal}
            </CampoDetalle>
          ) : null}
          {modelo.curvaTalla !== null ? (
            <CampoDetalle icono={Ruler} etiqueta="Rango de tallas">
              {modelo.curvaTalla}
            </CampoDetalle>
          ) : null}
          {modelo.maquilaBase !== null ? (
            <CampoDetalle icono={Tag} etiqueta="Maquila base">
              {formatearPrecio(modelo.maquilaBase)}
            </CampoDetalle>
          ) : null}
          {puedeVerInventario && existencias.data !== undefined ? (
            <CampoDetalle icono={Package} etiqueta="Existencia PT">
              {existencias.data.totalExistencia.toLocaleString('es-MX')} pzas
            </CampoDetalle>
          ) : null}
          {modelo.genero !== null ? (
            <CampoDetalle icono={Users} etiqueta="Género">
              {modelo.genero}
            </CampoDetalle>
          ) : null}
          {modelo.descripcion !== null && modelo.descripcion.trim() !== '' ? (
            <CampoDetalle icono={FileText} etiqueta="Descripción" anchoCompleto>
              {modelo.descripcion}
            </CampoDetalle>
          ) : null}
          {/* ¿Lleva arte? (Daniel 26-jul-2026): es el requisito ARTE del estado de sus órdenes, así
              que se ve SIEMPRE (marcado o no), no solo cuando "hay dato". */}
          <CampoDetalle icono={Palette} etiqueta="Arte">
            {modelo.llevaArte
              ? ficha.data !== undefined && ficha.data.artes.length === 0
                ? 'Lleva arte — falta capturarlo'
                : 'Lleva arte'
              : 'No lleva arte'}
          </CampoDetalle>
          {/* Composición del DESARROLLO (Daniel 24-jul-2026): la fuente que heredan las órdenes. */}
          {modelo.composicion !== null && modelo.composicion.trim() !== '' ? (
            <CampoDetalle icono={Scissors} etiqueta="Composición" anchoCompleto>
              {modelo.composicion}
            </CampoDetalle>
          ) : null}
        </RejillaCampos>
      </SeccionDetalle>

      <SeccionDetalle titulo="Receta / BOM" icono={Layers}>
        {ficha.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : ficha.isError ? (
          <p className="text-sm text-destructive">{ficha.error.message}</p>
        ) : ficha.data ? (
          <EditorBom ficha={ficha.data} puedeAdministrar={puedeAdministrar} />
        ) : null}
      </SeccionDetalle>

      {puedeVerInventario && celdasExistencia.length > 0 ? (
        <SeccionDetalle titulo="Matriz color × talla · existencia" icono={Grid3x3}>
          <MatrizExistenciaModelo celdas={celdasExistencia} />
        </SeccionDetalle>
      ) : null}

      <SeccionDetalle titulo="Fotos" icono={ImageIcon}>
        <FotosModelo
          idModelo={modelo.id}
          nombre={modelo.codigo}
          puedeAdministrar={puedeAdministrar}
        />
      </SeccionDetalle>

      <Historial creadoEn={modelo.creadoEn} modificadoEn={modelo.modificadoEn} />
    </div>
  );
}
