import {
  CalendarRange,
  FileText,
  Image as ImageIcon,
  Layers,
  Ruler,
  Shirt,
  Tag,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
import { Avatar } from '@/components/dominio/visuales';
import { SelectNativo } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
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
 * Pantalla de Modelos (Módulo 2, F1-E4) sobre el motor LISTA + DETALLE ("Teal fresco"). Lista
 * con búsqueda (debounce, por código/descripción), filtro por temporada, paginación de SERVIDOR
 * (volumen alto) y toggle de descontinuados. El detalle muestra los datos generales, las FOTOS
 * (galería con subida) y la RECETA/BOM (3 pestañas: telas/avíos/bordados + copiar receta), y
 * permite editar / descontinuar / reactivar.
 *
 * `modelos.ver` gobierna el acceso; `modelos.administrar` decide las acciones de escritura. La
 * decisión real la toma el backend (A1).
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
  useEffect(() => {
    if (idDeepLink !== null) {
      setIdAbrir(idDeepLink);
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
  const totalPaginas = datos?.totalPaginas ?? 0;
  const paginacion: PaginacionListaDetalle | undefined = datos
    ? {
        total: datos.total,
        pagina: datos.pagina,
        totalPaginas,
        ocupado: consulta.isFetching,
        alAnterior: () => setPagina((p) => Math.max(1, p - 1)),
        alSiguiente: () => setPagina((p) => Math.min(totalPaginas, p + 1)),
      }
    : undefined;

  // Registros a mostrar. Si hay deep-link y el modelo NO está en la página visible, lo
  // inyectamos al principio para que `ListaDetalle` pueda seleccionarlo y abrir su ficha (sin
  // depender de la paginación/filtro). El conteo del paginador (servidor) no se altera.
  const registros = conDeepLinkInyectado(datos?.datos ?? [], fichaDeepLink.data, idAbrir);

  return (
    <>
      <ListaDetalle<Modelo>
        testid="modelo"
        titulo="Modelos"
        descripcion="Catálogo de modelos con sus fotos y su receta (BOM)."
        icono={Shirt}
        registros={registros}
        seleccionInicialId={idAbrir}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(m) => m.id}
        obtenerTitulo={(m) => m.codigo}
        obtenerActivo={(m) => m.activo}
        obtenerSecundaria={(m) => m.descripcion ?? m.temporada ?? '—'}
        renderAvatarLista={(m) => <Avatar nombre={m.codigo} tono="pt" tamano="sm" />}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        filtros={
          <SelectNativo
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
        }
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay modelos que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo modelo"
        alEditar={abrirEdicion}
        alDesactivar={setADescontinuar}
        alReactivar={reactivarModelo}
        renderAvatarDetalle={(m) => <Avatar nombre={m.codigo} tono="pt" tamano="lg" />}
        renderMeta={(m) =>
          m.temporada ? <span className="text-xs text-muted-foreground">{m.temporada}</span> : null
        }
        renderDetalle={(m) => <DetalleModelo modelo={m} puedeAdministrar={puedeAdministrar} />}
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
    </>
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
    <>
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
    </>
  );
}
