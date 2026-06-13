import { ClipboardList, Mail, Phone, ScrollText, Tag } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useDesactivarProveedor, useProveedores, useReactivarProveedor } from '@/api/proveedores';
import { ETIQUETAS_TIPO_PROVEEDOR, TIPOS_PROVEEDOR, type TipoProveedorClave } from '@/api/esquemas';
import type { Proveedor, ProveedoresQuery } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar, TipoBadge } from '@/components/dominio/visuales';
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';
import type { Tono } from '@/lib/tono';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import {
  CampoDetalle,
  Historial,
  RejillaCampos,
  SeccionDetalle,
  ValorVacio,
} from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoProveedor } from './DialogoProveedor';

/** Renglones por pagina del listado. */
const POR_PAGINA = 10;

/** Valor del filtro de tipo que significa "todos" (sin filtrar). */
const TIPO_TODOS = 'TODOS';

/** Tono explicativo (color del avatar/chip) por tipo de proveedor. */
const TONO_POR_TIPO: Record<TipoProveedorClave, Tono> = {
  TELAS: 'telas',
  AVIOS: 'avios',
  SERVICIOS: 'servicios',
  SIN_CLASIFICAR: 'neutro',
};

/**
 * Pantalla de Proveedores — CRUD del catalogo sobre el motor LISTA + DETALLE
 * (rediseño "Teal fresco"). Lista con busqueda (debounce), **filtro por tipo**,
 * paginacion de servidor y toggle de inactivos; el detalle muestra los datos del
 * proveedor y permite editar / desactivar / reactivar. Borrado suave reversible
 * (desactivar con confirmacion, reactivar directo); toasts; consciente de permisos.
 *
 * `proveedores.ver` gobierna el acceso a la pantalla; `proveedores.administrar`
 * decide las acciones de escritura. La decision real la toma el backend (A1).
 */
export function ProveedoresPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('proveedores.administrar');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [tipoFiltro, setTipoFiltro] = useState<TipoProveedorClave | typeof TIPO_TODOS>(TIPO_TODOS);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: ProveedoresQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(tipoFiltro !== TIPO_TODOS ? { tipo: tipoFiltro } : {}),
  };

  const consulta = useProveedores(query);
  const desactivar = useDesactivarProveedor();
  const reactivar = useReactivarProveedor();

  // ── Dialogos ───────────────────────────────────────────────────────────────
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [proveedorEnEdicion, setProveedorEnEdicion] = useState<Proveedor | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<Proveedor | null>(null);

  function abrirAlta(): void {
    setProveedorEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(proveedor: Proveedor): void {
    setProveedorEnEdicion(proveedor);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Proveedor "${objetivo.nombre}" desactivado.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  // Reactivar es NO destructivo: se aplica directo, sin dialogo de confirmacion.
  function reactivarProveedor(proveedor: Proveedor): void {
    reactivar.mutate(proveedor.id, {
      onSuccess: () => toast.success(`Proveedor "${proveedor.nombre}" activado.`),
      onError: (error) => toast.error(error.message),
    });
  }

  // Cambiar busqueda, tipo o el filtro de inactivos reinicia a la pagina 1.
  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
    setPagina(1);
  }

  function alCambiarTipo(valor: string): void {
    setTipoFiltro(valor as TipoProveedorClave | typeof TIPO_TODOS);
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
      <ListaDetalle<Proveedor>
        testid="proveedor"
        titulo="Proveedores"
        descripcion="Proveedores de telas, avíos y servicios."
        icono={ClipboardList}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(p) => p.id}
        obtenerTitulo={(p) => p.nombre}
        obtenerActivo={(p) => p.activo}
        obtenerSecundaria={(p) => p.contacto ?? ETIQUETAS_TIPO_PROVEEDOR[p.tipo]}
        renderAvatarLista={(p) => (
          <Avatar nombre={p.nombre} tono={TONO_POR_TIPO[p.tipo]} tamano="sm" />
        )}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        filtros={
          <SelectNativo
            value={tipoFiltro}
            onChange={(e) => alCambiarTipo(e.target.value)}
            aria-label="Filtrar proveedores por tipo"
            data-testid="filtro-tipo-proveedor"
          >
            <option value={TIPO_TODOS}>Todos los tipos</option>
            {TIPOS_PROVEEDOR.map((tipo) => (
              <option key={tipo} value={tipo}>
                {ETIQUETAS_TIPO_PROVEEDOR[tipo]}
              </option>
            ))}
          </SelectNativo>
        }
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay proveedores que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo proveedor"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarProveedor}
        renderAvatarDetalle={(p) => (
          <Avatar nombre={p.nombre} tono={TONO_POR_TIPO[p.tipo]} tamano="lg" />
        )}
        renderMeta={(p) => (
          <TipoBadge tono={TONO_POR_TIPO[p.tipo]}>{ETIQUETAS_TIPO_PROVEEDOR[p.tipo]}</TipoBadge>
        )}
        renderDetalle={(p) => (
          <>
            <SeccionDetalle titulo="Datos del proveedor">
              <RejillaCampos>
                <CampoDetalle icono={Mail} etiqueta="Contacto">
                  {p.contacto ?? <ValorVacio />}
                </CampoDetalle>
                <CampoDetalle icono={Phone} etiqueta="Teléfono">
                  {p.telefono ?? <ValorVacio />}
                </CampoDetalle>
                <CampoDetalle icono={Tag} etiqueta="Tipo">
                  <TipoBadge tono={TONO_POR_TIPO[p.tipo]}>
                    {ETIQUETAS_TIPO_PROVEEDOR[p.tipo]}
                  </TipoBadge>
                </CampoDetalle>
                <CampoDetalle icono={ScrollText} etiqueta="Condiciones de pago">
                  {p.condiciones ?? <ValorVacio />}
                </CampoDetalle>
                <CampoDetalle icono={ClipboardList} etiqueta="Razón social" anchoCompleto>
                  {p.razonSocial ?? <ValorVacio />}
                </CampoDetalle>
              </RejillaCampos>
            </SeccionDetalle>
            <Historial creadoEn={p.creadoEn} modificadoEn={p.modificadoEn} />
          </>
        )}
      />

      {/* Dialogos */}
      <DialogoProveedor
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        proveedor={proveedorEnEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar proveedor"
        descripcion={
          <>
            ¿Seguro que quieres desactivar el proveedor{' '}
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
