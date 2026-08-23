import { CheckCircle, Hash } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useDesactivarTipoProducto,
  useReactivarTipoProducto,
  useTiposProducto,
} from '@/api/calidad';
import type { TipoProducto, TiposProductoQuery } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar } from '@/components/dominio/visuales';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoTipoProducto } from './DialogoTipoProducto';

const POR_PAGINA = 10;

/**
 * Pantalla de Tipos de producto — CRUD simple (patron ListaDetalle / Almacenes).
 * `calidad.ver` gobierna el acceso; `calidad.administrar-catalogo` las acciones
 * de escritura. La decision real la toma el backend (A1).
 */
export function TiposProductoPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('calidad.administrar-catalogo');

  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: TiposProductoQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  };

  const consulta = useTiposProducto(query);
  const desactivar = useDesactivarTipoProducto();
  const reactivar = useReactivarTipoProducto();

  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [tipoEnEdicion, setTipoEnEdicion] = useState<TipoProducto | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<TipoProducto | null>(null);

  function abrirAlta(): void {
    setTipoEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(tipo: TipoProducto): void {
    setTipoEnEdicion(tipo);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) return;
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Tipo "${objetivo.nombre}" desactivado.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  function reactivarTipo(tipo: TipoProducto): void {
    reactivar.mutate(tipo.id, {
      onSuccess: () => toast.success(`Tipo "${tipo.nombre}" activado.`),
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
      <ListaDetalle<TipoProducto>
        testid="tipo-producto"
        titulo="Tipos de producto"
        descripcion="Categorías de producto para clasificar defectos y auditorías AQL."
        icono={CheckCircle}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(t) => t.id}
        obtenerTitulo={(t) =>
          // El dígito de concepto va en el título (V1-E3n): es lo que decide si a un modelo de este
          // tipo se le puede armar código, así que tiene que verse sin abrir el detalle.
          t.digitoConcepto === null ? t.nombre : `${t.nombre} · ${String(t.digitoConcepto)}`
        }
        obtenerActivo={(t) => t.activo}
        renderAvatarLista={(t) => (
          <Avatar nombre={t.nombre} tono="avios" tamano="sm">
            <CheckCircle className="size-4" aria-hidden />
          </Avatar>
        )}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay tipos de producto que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo tipo"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarTipo}
        renderAvatarDetalle={(t) => (
          <Avatar nombre={t.nombre} tono="avios" tamano="lg">
            <CheckCircle className="size-7" aria-hidden />
          </Avatar>
        )}
        renderDetalle={(t) => (
          <SeccionDetalle titulo="Datos del tipo">
            <RejillaCampos>
              <CampoDetalle etiqueta="Dígito de concepto" icono={Hash}>
                {t.digitoConcepto === null ? (
                  <span className="text-muted-foreground">
                    sin capturar — los modelos de este tipo no se pueden numerar
                  </span>
                ) : (
                  <span className="mono">{t.digitoConcepto}</span>
                )}
              </CampoDetalle>
            </RejillaCampos>
            <Historial creadoEn={t.creadoEn} modificadoEn={t.modificadoEn} />
          </SeccionDetalle>
        )}
      />

      <DialogoTipoProducto
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        tipo={tipoEnEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) setADesactivar(null);
        }}
        titulo="Desactivar tipo de producto"
        descripcion={
          <>
            ¿Seguro que quieres desactivar el tipo{' '}
            <span className="font-medium text-foreground">{aDesactivar?.nombre}</span>? Podrás
            volver a activarlo después.
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
