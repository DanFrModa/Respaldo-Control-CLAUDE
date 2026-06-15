import { MergeIcon, Palette } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useColores, useDesactivarColor, useReactivarColor } from '@/api/colores';
import type { Color, ColoresQuery } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import { Historial } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoColor } from './DialogoColor';
import { DialogoFusionColores } from './DialogoFusionColores';

/** Renglones por pagina del listado. */
const POR_PAGINA = 10;

/**
 * Pantalla de Colores — CRUD del catalogo sobre el motor LISTA + DETALLE (rediseño
 * "Teal fresco"). Lista con busqueda (debounce), paginacion de servidor y toggle de
 * inactivos; alta con **alta rapida encadenada** (ver `DialogoColor`) y edicion en
 * dialogo; borrado suave reversible; toasts; consciente de permisos. `colores.ver`
 * gobierna el acceso; `colores.administrar` decide las acciones. El backend decide (A1).
 */
export function ColoresPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('colores.administrar');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: ColoresQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  };

  const consulta = useColores(query);
  const desactivar = useDesactivarColor();
  const reactivar = useReactivarColor();

  // ── Dialogos ───────────────────────────────────────────────────────────────
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [colorEnEdicion, setColorEnEdicion] = useState<Color | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<Color | null>(null);
  const [fusionAbierta, setFusionAbierta] = useState(false);

  function abrirAlta(): void {
    setColorEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(color: Color): void {
    setColorEnEdicion(color);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Color "${objetivo.nombre}" desactivado.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  // Reactivar es NO destructivo: se aplica directo, sin dialogo de confirmacion.
  function reactivarColor(color: Color): void {
    reactivar.mutate(color.id, {
      onSuccess: () => toast.success(`Color "${color.nombre}" activado.`),
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
      <ListaDetalle<Color>
        testid="color"
        titulo="Colores"
        descripcion="Catálogo de colores (úsalo para capturar varios colores seguidos)."
        icono={Palette}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(c) => c.id}
        obtenerTitulo={(c) => c.nombre}
        obtenerActivo={(c) => c.activo}
        renderAvatarLista={(c) => (
          <Avatar nombre={c.nombre} tono="servicios" tamano="sm">
            <Palette className="size-4" aria-hidden />
          </Avatar>
        )}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay colores que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo color"
        accionesEncabezado={
          <Button
            type="button"
            variant="outline"
            onClick={() => setFusionAbierta(true)}
            data-testid="abrir-fusion-colores"
          >
            <MergeIcon aria-hidden />
            Fusionar
          </Button>
        }
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarColor}
        renderAvatarDetalle={(c) => (
          <Avatar nombre={c.nombre} tono="servicios" tamano="lg">
            <Palette className="size-7" aria-hidden />
          </Avatar>
        )}
        renderDetalle={(c) => <Historial creadoEn={c.creadoEn} modificadoEn={c.modificadoEn} />}
      />

      {/* Dialogos */}
      <DialogoColor
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        color={colorEnEdicion}
      />
      <DialogoFusionColores abierto={fusionAbierta} alCambiarAbierto={setFusionAbierta} />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar color"
        descripcion={
          <>
            ¿Seguro que quieres desactivar el color{' '}
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
