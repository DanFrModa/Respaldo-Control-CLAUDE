import { Tag, Warehouse } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes, useDesactivarAlmacen, useReactivarAlmacen } from '@/api/almacenes';
import { ETIQUETAS_TIPO_ALMACEN, TIPOS_ALMACEN, type TipoAlmacenClave } from '@/api/esquemas';
import type { Almacen, AlmacenesQuery } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar, TipoBadge } from '@/components/dominio/visuales';
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';
import type { Tono } from '@/lib/tono';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoAlmacen } from './DialogoAlmacen';

/** Renglones por pagina del listado. */
const POR_PAGINA = 10;

/** Valor del filtro de tipo que significa "todos" (sin filtrar). */
const TIPO_TODOS = 'TODOS';

/** Tono explicativo (color del avatar/chip) por tipo de almacen. */
const TONO_POR_TIPO: Record<TipoAlmacenClave, Tono> = {
  PT: 'pt',
  TELA: 'telas',
  AVIO: 'avios',
};

/**
 * Pantalla de Almacenes — CRUD del catalogo del kardex unico sobre el motor
 * LISTA + DETALLE (rediseño "Teal fresco"). Lista con busqueda (debounce),
 * **filtro por tipo** (PT/telas/avíos), paginacion de servidor y toggle de
 * inactivos; el detalle muestra el tipo y el historial, y permite editar /
 * desactivar / reactivar. Borrado suave reversible (desactivar con confirmacion,
 * reactivar directo); toasts; consciente de permisos.
 *
 * `almacenes.ver` gobierna el acceso a la pantalla; `almacenes.administrar`
 * decide las acciones de escritura. La decision real la toma el backend (A1).
 */
export function AlmacenesPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('almacenes.administrar');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [tipoFiltro, setTipoFiltro] = useState<TipoAlmacenClave | typeof TIPO_TODOS>(TIPO_TODOS);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: AlmacenesQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(tipoFiltro !== TIPO_TODOS ? { tipo: tipoFiltro } : {}),
  };

  const consulta = useAlmacenes(query);
  const desactivar = useDesactivarAlmacen();
  const reactivar = useReactivarAlmacen();

  // ── Dialogos ───────────────────────────────────────────────────────────────
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [almacenEnEdicion, setAlmacenEnEdicion] = useState<Almacen | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<Almacen | null>(null);

  function abrirAlta(): void {
    setAlmacenEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(almacen: Almacen): void {
    setAlmacenEnEdicion(almacen);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Almacén "${objetivo.nombre}" desactivado.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  // Reactivar es NO destructivo: se aplica directo, sin dialogo de confirmacion.
  function reactivarAlmacen(almacen: Almacen): void {
    reactivar.mutate(almacen.id, {
      onSuccess: () => toast.success(`Almacén "${almacen.nombre}" activado.`),
      onError: (error) => toast.error(error.message),
    });
  }

  // Cambiar busqueda, tipo o el filtro de inactivos reinicia a la pagina 1.
  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
    setPagina(1);
  }

  function alCambiarTipo(valor: string): void {
    setTipoFiltro(valor as TipoAlmacenClave | typeof TIPO_TODOS);
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
      <ListaDetalle<Almacen>
        testid="almacen"
        titulo="Almacenes"
        descripcion="Almacenes del kardex único (producto terminado, telas y avíos)."
        icono={Warehouse}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(a) => a.id}
        obtenerTitulo={(a) => a.nombre}
        obtenerActivo={(a) => a.activo}
        obtenerSecundaria={(a) => ETIQUETAS_TIPO_ALMACEN[a.tipo]}
        renderAvatarLista={(a) => (
          <Avatar nombre={a.nombre} tono={TONO_POR_TIPO[a.tipo]} tamano="sm">
            <Warehouse className="size-4" aria-hidden />
          </Avatar>
        )}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        filtros={
          <SelectNativo
            value={tipoFiltro}
            onChange={(e) => alCambiarTipo(e.target.value)}
            aria-label="Filtrar almacenes por tipo"
            data-testid="filtro-tipo-almacen"
          >
            <option value={TIPO_TODOS}>Todos los tipos</option>
            {TIPOS_ALMACEN.map((tipo) => (
              <option key={tipo} value={tipo}>
                {ETIQUETAS_TIPO_ALMACEN[tipo]}
              </option>
            ))}
          </SelectNativo>
        }
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay almacenes que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo almacén"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarAlmacen}
        renderAvatarDetalle={(a) => (
          <Avatar nombre={a.nombre} tono={TONO_POR_TIPO[a.tipo]} tamano="lg">
            <Warehouse className="size-7" aria-hidden />
          </Avatar>
        )}
        renderMeta={(a) => (
          <TipoBadge tono={TONO_POR_TIPO[a.tipo]}>{ETIQUETAS_TIPO_ALMACEN[a.tipo]}</TipoBadge>
        )}
        renderDetalle={(a) => (
          <>
            <SeccionDetalle titulo="Datos del almacén">
              <RejillaCampos>
                <CampoDetalle icono={Tag} etiqueta="Tipo">
                  <TipoBadge tono={TONO_POR_TIPO[a.tipo]}>
                    {ETIQUETAS_TIPO_ALMACEN[a.tipo]}
                  </TipoBadge>
                </CampoDetalle>
              </RejillaCampos>
            </SeccionDetalle>
            <Historial creadoEn={a.creadoEn} modificadoEn={a.modificadoEn} />
          </>
        )}
      />

      {/* Dialogos */}
      <DialogoAlmacen
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        almacen={almacenEnEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar almacén"
        descripcion={
          <>
            ¿Seguro que quieres desactivar el almacén{' '}
            <span className="font-medium text-foreground">{aDesactivar?.nombre}</span>? Podrás
            volver a activarlo después; su historial se conserva.
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
