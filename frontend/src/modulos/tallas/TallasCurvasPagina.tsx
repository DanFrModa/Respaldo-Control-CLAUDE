import { LayoutGrid, Ruler, type LucideIcon } from 'lucide-react';
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
import { useDebounce } from '@/lib/useDebounce';
import { cn } from '@/lib/utils';
import {
  TablaCatalogo,
  type ColumnaCatalogo,
  type PaginacionCatalogo,
} from '@/modulos/TablaCatalogo';
import { useSesion } from '@/sesion/useSesion';

import { DialogoCurva } from './DialogoCurva';
import { DialogoTalla } from './DialogoTalla';

/** Renglones por pagina de cada listado. */
const POR_PAGINA = 10;

/** Pestañas de la pantalla. */
type Pestana = 'tallas' | 'curvas';

/**
 * Pantalla de Tallas y curvas (F1-E2, PIEZA B — D4) — re-vestida R9 a TABLA-FIRST (proto `vCat`).
 * Dos pestañas: el catálogo de tallas individuales (etiqueta + orden) y las curvas (conjuntos
 * ORDENADOS de tallas, mostradas como chips). Ambas tablas densas con búsqueda, inactivos y acciones
 * inline. `tallas.ver` gobierna el acceso; `tallas.administrar` decide las acciones. El backend
 * decide (A1). Regla de negocio (la aplica el backend, se muestra en toast): una talla usada por una
 * curva activa no se puede desactivar.
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
  const paginacion: PaginacionCatalogo | undefined = datos
    ? {
        total: datos.total,
        pagina: datos.pagina,
        totalPaginas,
        ocupado: consulta.isFetching,
        alAnterior: () => setPagina((p) => Math.max(1, p - 1)),
        alSiguiente: () => setPagina((p) => Math.min(totalPaginas, p + 1)),
      }
    : undefined;

  // Proto `vCat` tallas: renglón plano (sin thumb). La columna «Curva» del proto no existe por
  // talla en v2 (una talla puede vivir en varias curvas; las curvas tienen su pestaña propia).
  const columnas: ColumnaCatalogo<Talla>[] = [
    {
      encabezado: 'Talla',
      render: (t) => <span className="font-semibold">{t.etiqueta}</span>,
    },
    { encabezado: 'Orden', numerica: true, render: (t) => t.orden },
  ];

  return (
    <>
      <TablaCatalogo<Talla>
        testid="talla"
        titulo="Tallas"
        descripcion="Catálogo base · tallas individuales (D4)"
        unidad="tallas"
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(t) => t.id}
        obtenerActivo={(t) => t.activo}
        columnas={columnas}
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
  const paginacion: PaginacionCatalogo | undefined = datos
    ? {
        total: datos.total,
        pagina: datos.pagina,
        totalPaginas,
        ocupado: consulta.isFetching,
        alAnterior: () => setPagina((p) => Math.max(1, p - 1)),
        alSiguiente: () => setPagina((p) => Math.min(totalPaginas, p + 1)),
      }
    : undefined;

  const columnas: ColumnaCatalogo<Curva>[] = [
    {
      encabezado: 'Curva',
      render: (c) => <span className="font-semibold">{c.nombre}</span>,
    },
    {
      encabezado: 'Tallas (en orden)',
      render: (c) =>
        c.items.length === 0 ? (
          <span className="text-faint">—</span>
        ) : (
          <ol className="flex flex-wrap gap-1" data-testid="detalle-curva-tallas">
            {c.items.map((item) => (
              <li
                key={item.idTalla}
                className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-xs text-primary-soft-foreground"
              >
                <span className="tabular-nums opacity-70">{item.posicion + 1}</span>
                <span className="font-medium">{item.etiqueta}</span>
              </li>
            ))}
          </ol>
        ),
    },
  ];

  return (
    <>
      <TablaCatalogo<Curva>
        testid="curva"
        titulo="Curvas"
        descripcion="Catálogo base · conjuntos ordenados de tallas (D4)"
        unidad="curvas"
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(c) => c.id}
        obtenerActivo={(c) => c.activo}
        columnas={columnas}
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
