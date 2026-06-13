import { Percent, Tags } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useDesactivarEtiquetaMarca,
  useEtiquetasMarca,
  useReactivarEtiquetaMarca,
} from '@/api/etiquetas-marca';
import type { EtiquetaMarca, EtiquetasMarcaQuery } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar } from '@/components/dominio/visuales';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoEtiquetaMarca } from './DialogoEtiquetaMarca';

/** Renglones por pagina del listado. */
const POR_PAGINA = 10;

/** Formato del porcentaje de regalías (hasta 2 decimales, sin ceros sobrantes). */
const FORMATO_PORCENTAJE = new Intl.NumberFormat('es-MX', {
  maximumFractionDigits: 2,
});

/** Muestra las regalías como porcentaje legible (p. ej. "12.5%"). */
function regaliasComoTexto(regalias: number): string {
  return `${FORMATO_PORCENTAJE.format(regalias)}%`;
}

/**
 * Pantalla de Etiquetas de marca — CRUD del catalogo sobre el motor LISTA +
 * DETALLE (rediseño "Teal fresco"). Lista con busqueda (debounce), paginacion de
 * servidor y toggle de inactivos; el detalle muestra el porcentaje de regalías
 * (alimenta el costeo) y permite editar / desactivar / reactivar. Borrado suave
 * reversible; toasts; consciente de permisos. `etiquetas-marca.ver` gobierna el
 * acceso; `etiquetas-marca.administrar` decide las acciones. El backend decide (A1).
 */
export function EtiquetasMarcaPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('etiquetas-marca.administrar');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: EtiquetasMarcaQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  };

  const consulta = useEtiquetasMarca(query);
  const desactivar = useDesactivarEtiquetaMarca();
  const reactivar = useReactivarEtiquetaMarca();

  // ── Dialogos ───────────────────────────────────────────────────────────────
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [etiquetaEnEdicion, setEtiquetaEnEdicion] = useState<EtiquetaMarca | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<EtiquetaMarca | null>(null);

  function abrirAlta(): void {
    setEtiquetaEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(etiqueta: EtiquetaMarca): void {
    setEtiquetaEnEdicion(etiqueta);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Etiqueta "${objetivo.nombre}" desactivada.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  // Reactivar es NO destructivo: se aplica directo, sin dialogo de confirmacion.
  function reactivarEtiqueta(etiqueta: EtiquetaMarca): void {
    reactivar.mutate(etiqueta.id, {
      onSuccess: () => toast.success(`Etiqueta "${etiqueta.nombre}" activada.`),
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
      <ListaDetalle<EtiquetaMarca>
        testid="etiqueta-marca"
        titulo="Etiquetas de marca"
        descripcion="Etiquetas de marca y su porcentaje de regalías (alimenta el costeo)."
        icono={Tags}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(e) => e.id}
        obtenerTitulo={(e) => e.nombre}
        obtenerActivo={(e) => e.activo}
        obtenerSecundaria={(e) => `Regalías ${regaliasComoTexto(e.regalias)}`}
        renderAvatarLista={(e) => (
          <Avatar nombre={e.nombre} tono="servicios" tamano="sm">
            <Tags className="size-4" aria-hidden />
          </Avatar>
        )}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay etiquetas que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nueva etiqueta"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarEtiqueta}
        renderAvatarDetalle={(e) => (
          <Avatar nombre={e.nombre} tono="servicios" tamano="lg">
            <Tags className="size-7" aria-hidden />
          </Avatar>
        )}
        renderDetalle={(e) => (
          <>
            <SeccionDetalle titulo="Datos de la etiqueta">
              <RejillaCampos>
                <CampoDetalle icono={Percent} etiqueta="Regalías">
                  <span className="tabular-nums">{regaliasComoTexto(e.regalias)}</span>
                </CampoDetalle>
              </RejillaCampos>
            </SeccionDetalle>
            <Historial creadoEn={e.creadoEn} modificadoEn={e.modificadoEn} />
          </>
        )}
      />

      {/* Dialogos */}
      <DialogoEtiquetaMarca
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        etiqueta={etiquetaEnEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar etiqueta de marca"
        descripcion={
          <>
            ¿Seguro que quieres desactivar la etiqueta{' '}
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
