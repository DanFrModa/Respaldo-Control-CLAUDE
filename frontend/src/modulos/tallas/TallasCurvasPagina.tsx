import { LayoutGrid, ListChecks, Ruler, Tag, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useCurvas,
  useDesactivarCurva,
  useDesactivarTalla,
  useReactivarCurva,
  useReactivarTalla,
  useTallas,
} from '@/api/tallas';
import type { Curva, CurvasQuery, Talla, TallasQuery } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar } from '@/components/dominio/visuales';
import { useDebounce } from '@/lib/useDebounce';
import { cn } from '@/lib/utils';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import {
  CampoDetalle,
  Historial,
  RejillaCampos,
  SeccionDetalle,
  ValorVacio,
} from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoCurva } from './DialogoCurva';
import { DialogoTalla } from './DialogoTalla';

/** Renglones por pagina de cada listado. */
const POR_PAGINA = 10;

/** Pestañas de la pantalla. */
type Pestana = 'tallas' | 'curvas';

/**
 * Pantalla de Tallas y curvas (F1-E2, PIEZA B — D4) sobre el motor LISTA + DETALLE
 * (rediseño "Teal fresco"). Dos pestañas: el catalogo de tallas individuales y las
 * curvas (conjuntos ORDENADOS de tallas). Ambas con busqueda (debounce), paginacion de
 * servidor, toggle de inactivos, borrado suave reversible, toasts y conscientes de
 * permisos. `tallas.ver` gobierna el acceso; `tallas.administrar` decide las acciones.
 * El backend decide (A1). Regla de negocio (la aplica el backend y se muestra en un
 * toast): una talla usada por una curva activa no se puede desactivar.
 */
export function TallasCurvasPagina(): React.JSX.Element {
  const [pestana, setPestana] = useState<Pestana>('tallas');

  return (
    <div className="flex h-full flex-col">
      {/* Conmutador de pestañas */}
      <div className="flex items-center gap-1 border-b p-3 lg:px-6">
        <BotonPestana
          activa={pestana === 'tallas'}
          onClick={() => setPestana('tallas')}
          icono={Ruler}
          testid="pestana-tallas"
        >
          Tallas
        </BotonPestana>
        <BotonPestana
          activa={pestana === 'curvas'}
          onClick={() => setPestana('curvas')}
          icono={LayoutGrid}
          testid="pestana-curvas"
        >
          Curvas
        </BotonPestana>
      </div>

      {/* Panel activo (montado solo el visible, para aislar su estado) */}
      <div className="min-h-0 flex-1">
        {pestana === 'tallas' ? <PanelTallas /> : <PanelCurvas />}
      </div>
    </div>
  );
}

/** Boton de una pestaña (segmentado). */
function BotonPestana({
  activa,
  onClick,
  icono: Icono,
  testid,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  icono: LucideIcon;
  testid: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      data-testid={testid}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
        activa
          ? 'bg-primary-soft text-primary-soft-foreground'
          : 'text-muted-foreground hover:bg-muted',
      )}
    >
      <Icono className="size-4" aria-hidden />
      {children}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
//  Panel de TALLAS
// ════════════════════════════════════════════════════════════════════════════════

function PanelTallas(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('tallas.administrar');

  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: TallasQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'orden',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  };

  const consulta = useTallas(query);
  const desactivar = useDesactivarTalla();
  const reactivar = useReactivarTalla();

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [enEdicion, setEnEdicion] = useState<Talla | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<Talla | null>(null);

  function abrirAlta(): void {
    setEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(talla: Talla): void {
    setEnEdicion(talla);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Talla "${objetivo.etiqueta}" desactivada.`);
        setADesactivar(null);
      },
      // El backend rechaza desactivar una talla usada por una curva activa: el mensaje
      // explica por qué. Cerramos el diálogo para que el usuario lo lea en el toast.
      onError: (error) => {
        toast.error(error.message);
        setADesactivar(null);
      },
    });
  }

  function reactivarTalla(talla: Talla): void {
    reactivar.mutate(talla.id, {
      onSuccess: () => toast.success(`Talla "${talla.etiqueta}" activada.`),
      onError: (error) => toast.error(error.message),
    });
  }

  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
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

  return (
    <>
      <ListaDetalle<Talla>
        testid="talla"
        titulo="Tallas"
        descripcion="Catálogo de tallas individuales (D4)."
        icono={Ruler}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(t) => t.id}
        obtenerTitulo={(t) => t.etiqueta}
        obtenerActivo={(t) => t.activo}
        obtenerSecundaria={(t) => `Orden ${String(t.orden)}`}
        renderAvatarLista={(t) => (
          <Avatar nombre={t.etiqueta} tono="neutro" tamano="sm">
            <Ruler className="size-4" aria-hidden />
          </Avatar>
        )}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay tallas que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nueva talla"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarTalla}
        renderAvatarDetalle={(t) => (
          <Avatar nombre={t.etiqueta} tono="neutro" tamano="lg">
            <Ruler className="size-7" aria-hidden />
          </Avatar>
        )}
        renderDetalle={(t) => (
          <>
            <SeccionDetalle titulo="Datos de la talla">
              <RejillaCampos>
                <CampoDetalle icono={Tag} etiqueta="Etiqueta">
                  {t.etiqueta}
                </CampoDetalle>
                <CampoDetalle icono={ListChecks} etiqueta="Orden de despliegue">
                  <span className="tabular-nums">{t.orden}</span>
                </CampoDetalle>
              </RejillaCampos>
            </SeccionDetalle>
            <Historial creadoEn={t.creadoEn} modificadoEn={t.modificadoEn} />
          </>
        )}
      />

      <DialogoTalla
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        talla={enEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar talla"
        descripcion={
          <>
            ¿Seguro que quieres desactivar la talla{' '}
            <span className="font-medium text-foreground">{aDesactivar?.etiqueta}</span>? No se
            puede si la usa una curva activa. Podrás reactivarla después; su historial se conserva.
          </>
        }
        textoConfirmar="Desactivar"
        variante="destructive"
        procesando={desactivar.isPending}
        alConfirmar={confirmarDesactivar}
      />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
//  Panel de CURVAS
// ════════════════════════════════════════════════════════════════════════════════

function PanelCurvas(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('tallas.administrar');

  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: CurvasQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  };

  const consulta = useCurvas(query);
  const desactivar = useDesactivarCurva();
  const reactivar = useReactivarCurva();

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [enEdicion, setEnEdicion] = useState<Curva | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<Curva | null>(null);

  function abrirAlta(): void {
    setEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(curva: Curva): void {
    setEnEdicion(curva);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Curva "${objetivo.nombre}" desactivada.`);
        setADesactivar(null);
      },
      onError: (error) => {
        toast.error(error.message);
        setADesactivar(null);
      },
    });
  }

  function reactivarCurva(curva: Curva): void {
    reactivar.mutate(curva.id, {
      onSuccess: () => toast.success(`Curva "${curva.nombre}" activada.`),
      onError: (error) => toast.error(error.message),
    });
  }

  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
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

  return (
    <>
      <ListaDetalle<Curva>
        testid="curva"
        titulo="Curvas"
        descripcion="Conjuntos ordenados de tallas (D4)."
        icono={LayoutGrid}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(c) => c.id}
        obtenerTitulo={(c) => c.nombre}
        obtenerActivo={(c) => c.activo}
        obtenerSecundaria={(c) => `${String(c.items.length)} talla(s)`}
        renderAvatarLista={(c) => (
          <Avatar nombre={c.nombre} tono="servicios" tamano="sm">
            <LayoutGrid className="size-4" aria-hidden />
          </Avatar>
        )}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay curvas que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nueva curva"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarCurva}
        renderAvatarDetalle={(c) => (
          <Avatar nombre={c.nombre} tono="servicios" tamano="lg">
            <LayoutGrid className="size-7" aria-hidden />
          </Avatar>
        )}
        renderDetalle={(c) => (
          <>
            <SeccionDetalle titulo="Tallas de la curva (en orden)">
              {c.items.length === 0 ? (
                <ValorVacio />
              ) : (
                <ol
                  className="flex flex-wrap gap-2"
                  data-testid="detalle-curva-tallas"
                  aria-label="Tallas de la curva en orden"
                >
                  {c.items.map((item) => (
                    <li
                      key={item.idTalla}
                      className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-sm text-primary-soft-foreground"
                    >
                      <span className="text-xs tabular-nums opacity-70">{item.posicion + 1}</span>
                      <span className="font-medium">{item.etiqueta}</span>
                    </li>
                  ))}
                </ol>
              )}
            </SeccionDetalle>
            <Historial creadoEn={c.creadoEn} modificadoEn={c.modificadoEn} />
          </>
        )}
      />

      <DialogoCurva
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        curva={enEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar curva"
        descripcion={
          <>
            ¿Seguro que quieres desactivar la curva{' '}
            <span className="font-medium text-foreground">{aDesactivar?.nombre}</span>? Podrás
            reactivarla después; su historial se conserva.
          </>
        }
        textoConfirmar="Desactivar"
        variante="destructive"
        procesando={desactivar.isPending}
        alConfirmar={confirmarDesactivar}
      />
    </>
  );
}
