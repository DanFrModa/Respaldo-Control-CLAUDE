import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Images,
  Layers,
  Pencil,
  Plus,
  RotateCcw,
  Ruler,
  Shirt,
  Tag,
  Trash2,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
  useDescontinuarModelo,
  useFichaModelo,
  useModelos,
  useReactivarModelo,
  type Modelo,
  type ModelosQuery,
} from '@/api/modelos';
import { useTemporadas } from '@/api/temporadas';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { CajonDetalle } from '@/components/dominio/CajonDetalle';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Avatar, EstadoBadge, TipoBadge } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/lib/useDebounce';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoModelo } from './DialogoModelo';
import { EditorBom } from './EditorBom';
import { FotosModelo } from './FotosModelo';

/** Renglones por página (volumen ~4,987: SIEMPRE modo servidor). */
const POR_PAGINA = 15;

/** Valor del filtro de temporada que significa "todas". */
const TEMPORADA_TODAS = 'TODAS';

/** Formatea un precio en pesos (es-MX). */
function formatearPrecio(precio: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(precio);
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
 * Pantalla de Modelos (Módulo 2, F1-E4) — re-vestida R9 a TABLA-FIRST fiel al proto `vModelos`:
 * page-head (atajo a Galería + «Nuevo modelo») + toolbar (búsqueda por código/nombre, filtro por
 * temporada, inactivos) + TABLA DENSA (Modelo · Temporada · Curva de tallas · Género · Estado) +
 * barra de totales al pie con paginación de SERVIDOR (volumen alto). Al hacer clic en un renglón se
 * abre un CAJÓN ancho con los datos generales, las FOTOS (galería con subida) y la RECETA/BOM (3
 * pestañas + copiar receta); ahí se edita / descontinúa / reactiva. Conserva el DEEP-LINK
 * (`state.idModelo`) que abre directo la ficha de un modelo (desde la galería u otra vista).
 *
 * FIDELIDAD vs proto: el proto pinta columnas «Tela principal», «Colores» (swatches), «Stock PT» y
 * «Costo», y en el cajón una «Matriz color×talla · existencia» — ninguno viene en el payload de la
 * lista de modelos (tela/colores viven en el BOM/órdenes; existencia y costo son de otros módulos y
 * no hay endpoint por-modelo cableado aquí) → se omiten (huecos reportados). También se omite el
 * botón «Exportar» (sin endpoint de exportación de modelos).
 *
 * `modelos.ver` gobierna el acceso; `modelos.administrar` decide las acciones de escritura (A1).
 */
export function ModelosPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('modelos.administrar');

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
  const [pagina, setPagina] = useState(1);

  const query: ModelosQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'codigo',
    direccion: 'asc',
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

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [modeloEnEdicion, setModeloEnEdicion] = useState<Modelo | undefined>(undefined);
  const [aDescontinuar, setADescontinuar] = useState<Modelo | null>(null);

  function abrirAlta(): void {
    setModeloEnEdicion(undefined);
    setDialogoAbierto(true);
  }
  function abrirEdicion(modelo: Modelo): void {
    setModeloEnEdicion(modelo);
    setDialogoAbierto(true);
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

  const datos = consulta.data;
  const total = datos?.total ?? 0;
  const totalPaginas = datos?.totalPaginas ?? 1;

  // Registros a mostrar. Si hay deep-link y el modelo NO está en la página visible, lo
  // inyectamos al principio para que el cajón pueda seleccionarlo y abrir su ficha (sin
  // depender de la paginación/filtro). El conteo del paginador (servidor) no se altera.
  const registros = conDeepLinkInyectado(datos?.datos ?? [], fichaDeepLink.data, idAbrir);
  const seleccion = registros.find((m) => m.id === seleccionId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-5">
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">Modelos</h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Catálogo de producto · fotos y receta (BOM)
          </p>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/modelos/galeria" data-testid="ir-a-galeria-modelos">
            <Images aria-hidden />
            Galería
          </Link>
        </Button>
        {puedeAdministrar ? (
          <Button size="sm" onClick={abrirAlta} data-testid="nuevo-modelo">
            <Plus aria-hidden />
            Nuevo modelo
          </Button>
        ) : null}
      </header>

      {/* ── Card: filtros + tabla + totales ─────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <Input
            type="search"
            className="h-8 w-60 text-sm"
            placeholder="Buscar por código o nombre…"
            value={textoBusqueda}
            onChange={(e) => alBuscar(e.target.value)}
            data-testid="buscar-modelo"
          />
          {/* SelectNativo envuelve el <select> en un div `w-full`: se acota AQUÍ el ancho para
              que el toolbar quede en UN renglón compacto como el proto (chips/filtros en línea). */}
          <SelectNativo
            className="w-48 h-8 text-sm"
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
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={incluirInactivos}
              onChange={alAlternarInactivos}
              data-testid="mostrar-desactivados"
            />
            Incluir descontinuados
          </label>
          <div className="ml-auto">
            {/* Conteo del proto (`.count`): "visibles de total" ("8 de 214"). */}
            <span className="text-[12px] text-faint">
              {registros.length.toLocaleString('es-MX')} de {total.toLocaleString('es-MX')} modelos
            </span>
          </div>
        </div>

        {/* ── Cuerpo scrolleable ─────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-auto">
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
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Modelo</TablaDensaHead>
                  <TablaDensaHead>Temporada</TablaDensaHead>
                  <TablaDensaHead>Curva de tallas</TablaDensaHead>
                  <TablaDensaHead>Género</TablaDensaHead>
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
                        <Avatar nombre={m.codigo} tono="pt" tamano="sm" />
                        <div className="min-w-0">
                          {/* Proto: título del renglón en `cell-strong` (600). */}
                          <div className="truncate font-semibold">{m.codigo}</div>
                          {m.descripcion !== null && m.descripcion.trim() !== '' ? (
                            <div className="truncate text-xs text-muted-foreground">
                              {m.descripcion}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      {m.temporada !== null ? (
                        <TipoBadge tono="neutro">{m.temporada}</TipoBadge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TablaDensaCelda>
                    <TablaDensaCelda className="text-muted-foreground">
                      {m.curvaTalla ?? '—'}
                    </TablaDensaCelda>
                    <TablaDensaCelda className="text-muted-foreground">
                      {m.genero ?? '—'}
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      <EstadoBadge activo={m.activo} />
                    </TablaDensaCelda>
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
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
        className="sm:max-w-2xl lg:max-w-3xl"
        abierto={seleccionId !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) setSeleccionId(null);
        }}
        titulo={
          seleccion !== null ? (
            <span className="flex flex-wrap items-center gap-2">
              {seleccion.codigo}
              <EstadoBadge activo={seleccion.activo} />
            </span>
          ) : (
            ''
          )
        }
        subtitulo={
          seleccion !== null
            ? [seleccion.descripcion, seleccion.temporada].filter(Boolean).join(' · ') || undefined
            : undefined
        }
        acciones={
          seleccion !== null && puedeAdministrar ? (
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
          ) : undefined
        }
      >
        {seleccion !== null ? (
          <DetalleModelo modelo={seleccion} puedeAdministrar={puedeAdministrar} />
        ) : null}
      </CajonDetalle>

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
 * Panel de DETALLE de un modelo: trae la FICHA completa (datos + BOM) por id y muestra los
 * datos generales, las fotos y el editor de receta. El BOM se edita por sección con guardado
 * independiente (el backend reemplaza el set en una transacción A2).
 */
function DetalleModelo({
  modelo,
  puedeAdministrar,
}: {
  modelo: Modelo;
  puedeAdministrar: boolean;
}): React.JSX.Element {
  const ficha = useFichaModelo(modelo.id);

  return (
    <div data-testid="detalle-modelo">
      <SeccionDetalle titulo="Datos generales" icono={Shirt}>
        <RejillaCampos>
          <CampoDetalle icono={Tag} etiqueta="Código">
            {modelo.codigo}
          </CampoDetalle>
          {modelo.maquilaBase !== null ? (
            <CampoDetalle icono={Tag} etiqueta="Maquila base">
              {formatearPrecio(modelo.maquilaBase)}
            </CampoDetalle>
          ) : null}
          {modelo.temporada !== null ? (
            <CampoDetalle icono={CalendarRange} etiqueta="Temporada">
              {modelo.temporada}
            </CampoDetalle>
          ) : null}
          {modelo.curvaTalla !== null ? (
            <CampoDetalle icono={Ruler} etiqueta="Curva de tallas">
              {modelo.curvaTalla}
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
        </RejillaCampos>
      </SeccionDetalle>

      <SeccionDetalle titulo="Fotos" icono={ImageIcon}>
        <FotosModelo
          idModelo={modelo.id}
          nombre={modelo.codigo}
          puedeAdministrar={puedeAdministrar}
        />
      </SeccionDetalle>

      <SeccionDetalle titulo="Receta (BOM)" icono={Layers}>
        {ficha.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : ficha.isError ? (
          <p className="text-sm text-destructive">{ficha.error.message}</p>
        ) : ficha.data ? (
          <EditorBom ficha={ficha.data} puedeAdministrar={puedeAdministrar} />
        ) : null}
      </SeccionDetalle>

      <Historial creadoEn={modelo.creadoEn} modificadoEn={modelo.modificadoEn} />
    </div>
  );
}
