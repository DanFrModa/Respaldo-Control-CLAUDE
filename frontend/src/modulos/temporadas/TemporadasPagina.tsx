import { CalendarRange } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useDesactivarTemporada, useReactivarTemporada, useTemporadas } from '@/api/temporadas';
import type { Temporada, TemporadasQuery } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar } from '@/components/dominio/visuales';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import { Historial } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoTemporada } from './DialogoTemporada';

/** Renglones por pagina del listado. */
const POR_PAGINA = 10;

/**
 * Pantalla de Temporadas — CRUD del catalogo de temporadas (ciclos comerciales)
 * sobre el motor LISTA + DETALLE (rediseño "Teal fresco"). Lista con busqueda
 * (debounce), paginacion de servidor y toggle de inactivos; el detalle muestra el
 * historial y permite editar / desactivar / reactivar. Borrado suave reversible;
 * toasts; consciente de permisos. `temporadas.ver` gobierna el acceso;
 * `temporadas.administrar` decide las acciones. El backend decide (A1).
 */
export function TemporadasPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('temporadas.administrar');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: TemporadasQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  };

  const consulta = useTemporadas(query);
  const desactivar = useDesactivarTemporada();
  const reactivar = useReactivarTemporada();

  // ── Dialogos ───────────────────────────────────────────────────────────────
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [temporadaEnEdicion, setTemporadaEnEdicion] = useState<Temporada | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<Temporada | null>(null);

  function abrirAlta(): void {
    setTemporadaEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(temporada: Temporada): void {
    setTemporadaEnEdicion(temporada);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Temporada "${objetivo.nombre}" desactivada.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  // Reactivar es NO destructivo: se aplica directo, sin dialogo de confirmacion.
  function reactivarTemporada(temporada: Temporada): void {
    reactivar.mutate(temporada.id, {
      onSuccess: () => toast.success(`Temporada "${temporada.nombre}" activada.`),
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
      <ListaDetalle<Temporada>
        testid="temporada"
        titulo="Temporadas"
        descripcion="Ciclos comerciales del año."
        icono={CalendarRange}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(t) => t.id}
        obtenerTitulo={(t) => t.nombre}
        obtenerActivo={(t) => t.activo}
        renderAvatarLista={(t) => (
          <Avatar nombre={t.nombre} tono="pt" tamano="sm">
            <CalendarRange className="size-4" aria-hidden />
          </Avatar>
        )}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay temporadas que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nueva temporada"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarTemporada}
        renderAvatarDetalle={(t) => (
          <Avatar nombre={t.nombre} tono="pt" tamano="lg">
            <CalendarRange className="size-7" aria-hidden />
          </Avatar>
        )}
        renderDetalle={(t) => <Historial creadoEn={t.creadoEn} modificadoEn={t.modificadoEn} />}
      />

      {/* Dialogos */}
      <DialogoTemporada
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        temporada={temporadaEnEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar temporada"
        descripcion={
          <>
            ¿Seguro que quieres desactivar la temporada{' '}
            <span className="font-medium text-foreground">{aDesactivar?.nombre}</span>? Podrás
            volver a activarla después; su historial se conserva.
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
