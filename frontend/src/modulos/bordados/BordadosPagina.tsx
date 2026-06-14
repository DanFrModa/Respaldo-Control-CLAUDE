import { FileText, Hash, Image as ImageIcon, Sparkles, Tag } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useBordados,
  useDesactivarBordado,
  useReactivarBordado,
  type Bordado,
  type BordadosQuery,
} from '@/api/bordados';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar, TipoBadge } from '@/components/dominio/visuales';
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';
import type { Tono } from '@/lib/tono';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoBordado } from './DialogoBordado';
import { MiniaturaFoto } from './MiniaturaFoto';
import { ETIQUETAS_TIPO_BORDADO, TIPOS_BORDADO, type TipoBordadoClave } from './esquemas';

/** Renglones por pagina del listado (volumen ~2,964: SIEMPRE modo servidor). */
const POR_PAGINA = 12;

/** Valor del filtro de tipo que significa "todos" (sin filtrar). */
const TIPO_TODOS = 'TODOS';

/** Tono explicativo (color del avatar/chip) por tipo de bordado. */
const TONO_POR_TIPO: Record<TipoBordadoClave, Tono> = {
  BORDADO: 'telas',
  ESTAMPADO: 'servicios',
};

/** Formatea un precio en pesos (es-MX). */
function formatearPrecio(precio: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(precio);
}

/**
 * Pantalla de Bordados/estampados — CRUD del catalogo sobre el motor LISTA + DETALLE
 * (rediseño "Teal fresco"). Lista con busqueda (debounce), filtro por tipo, paginacion
 * de SERVIDOR (volumen alto) y toggle de inactivos; el detalle muestra los datos del
 * bordado (tipo, puntadas, precio, descripcion) y su FOTO, y permite editar / desactivar
 * / reactivar. Borrado suave reversible; toasts; consciente de permisos.
 *
 * `bordados.ver` gobierna el acceso a la pantalla; `bordados.administrar` decide las
 * acciones de escritura. La decision real la toma el backend (A1).
 */
export function BordadosPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('bordados.administrar');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [tipoFiltro, setTipoFiltro] = useState<TipoBordadoClave | typeof TIPO_TODOS>(TIPO_TODOS);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: BordadosQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'nombre',
    direccion: 'asc',
    incluirInactivos: incluirInactivos ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(tipoFiltro !== TIPO_TODOS ? { tipo: tipoFiltro } : {}),
  };

  const consulta = useBordados(query);
  const desactivar = useDesactivarBordado();
  const reactivar = useReactivarBordado();

  // ── Dialogos ───────────────────────────────────────────────────────────────
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [bordadoEnEdicion, setBordadoEnEdicion] = useState<Bordado | undefined>(undefined);
  const [aDesactivar, setADesactivar] = useState<Bordado | null>(null);

  function abrirAlta(): void {
    setBordadoEnEdicion(undefined);
    setDialogoAbierto(true);
  }

  function abrirEdicion(bordado: Bordado): void {
    setBordadoEnEdicion(bordado);
    setDialogoAbierto(true);
  }

  function confirmarDesactivar(): void {
    if (aDesactivar === null) {
      return;
    }
    const objetivo = aDesactivar;
    desactivar.mutate(objetivo.id, {
      onSuccess: () => {
        toast.success(`Bordado "${objetivo.nombre}" desactivado.`);
        setADesactivar(null);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  // Reactivar es NO destructivo: directo, sin dialogo de confirmacion.
  function reactivarBordado(bordado: Bordado): void {
    reactivar.mutate(bordado.id, {
      onSuccess: () => toast.success(`Bordado "${bordado.nombre}" activado.`),
      onError: (error) => toast.error(error.message),
    });
  }

  // Cambiar busqueda, tipo o inactivos reinicia a la pagina 1.
  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
    setPagina(1);
  }

  function alCambiarTipo(valor: string): void {
    setTipoFiltro(valor as TipoBordadoClave | typeof TIPO_TODOS);
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
      <ListaDetalle<Bordado>
        testid="bordado"
        titulo="Bordados y estampados"
        descripcion="Catálogo de bordados y estampados con su foto."
        icono={Sparkles}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(b) => b.id}
        obtenerTitulo={(b) => b.nombre}
        obtenerActivo={(b) => b.activo}
        obtenerSecundaria={(b) => ETIQUETAS_TIPO_BORDADO[b.tipo]}
        renderAvatarLista={(b) =>
          b.idArchivoFoto ? (
            <MiniaturaFoto idBordado={b.id} nombre={b.nombre} tamano="sm" />
          ) : (
            <Avatar nombre={b.nombre} tono={TONO_POR_TIPO[b.tipo]} tamano="sm" />
          )
        }
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        filtros={
          <SelectNativo
            value={tipoFiltro}
            onChange={(e) => alCambiarTipo(e.target.value)}
            aria-label="Filtrar bordados por tipo"
            data-testid="filtro-tipo-bordado"
          >
            <option value={TIPO_TODOS}>Todos los tipos</option>
            {TIPOS_BORDADO.map((tipo) => (
              <option key={tipo} value={tipo}>
                {ETIQUETAS_TIPO_BORDADO[tipo]}
              </option>
            ))}
          </SelectNativo>
        }
        incluirInactivos={incluirInactivos}
        alAlternarInactivos={alAlternarInactivos}
        textoVacio="No hay bordados que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={puedeAdministrar}
        alNuevo={abrirAlta}
        textoNuevo="Nuevo bordado"
        alEditar={abrirEdicion}
        alDesactivar={setADesactivar}
        alReactivar={reactivarBordado}
        renderAvatarDetalle={(b) =>
          b.idArchivoFoto ? (
            <MiniaturaFoto idBordado={b.id} nombre={b.nombre} tamano="lg" />
          ) : (
            <Avatar nombre={b.nombre} tono={TONO_POR_TIPO[b.tipo]} tamano="lg" />
          )
        }
        renderMeta={(b) => (
          <TipoBadge tono={TONO_POR_TIPO[b.tipo]}>{ETIQUETAS_TIPO_BORDADO[b.tipo]}</TipoBadge>
        )}
        renderDetalle={(b) => <DetalleBordado b={b} />}
      />

      {/* Dialogos */}
      <DialogoBordado
        abierto={dialogoAbierto}
        alCambiarAbierto={setDialogoAbierto}
        bordado={bordadoEnEdicion}
      />
      <DialogoConfirmacion
        abierto={aDesactivar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setADesactivar(null);
          }
        }}
        titulo="Desactivar bordado"
        descripcion={
          <>
            ¿Seguro que quieres desactivar el bordado{' '}
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

/**
 * Panel de DETALLE de un bordado: la FOTO grande (o placeholder NoFoto) y los datos
 * —tipo, puntadas, precio, descripcion— en una rejilla. Cada campo con valor; los
 * vacios no se pintan (M2). Usa las piezas de `@/modulos/detalle` para verse igual que
 * el resto.
 */
function DetalleBordado({ b }: { b: Bordado }): React.JSX.Element {
  return (
    <>
      <SeccionDetalle titulo="Foto" icono={ImageIcon}>
        <MiniaturaFoto idBordado={b.id} nombre={b.nombre} tamano="grande" />
      </SeccionDetalle>

      <SeccionDetalle titulo="Datos del bordado" icono={Sparkles}>
        <RejillaCampos>
          <CampoDetalle icono={Tag} etiqueta="Tipo">
            <TipoBadge tono={TONO_POR_TIPO[b.tipo]}>{ETIQUETAS_TIPO_BORDADO[b.tipo]}</TipoBadge>
          </CampoDetalle>
          {b.puntadas !== null ? (
            <CampoDetalle icono={Hash} etiqueta="Puntadas">
              {b.puntadas.toLocaleString('es-MX')}
            </CampoDetalle>
          ) : null}
          {b.precio !== null ? (
            <CampoDetalle icono={Tag} etiqueta="Precio de referencia">
              {formatearPrecio(b.precio)}
            </CampoDetalle>
          ) : null}
          {b.descripcion !== null && b.descripcion.trim() !== '' ? (
            <CampoDetalle icono={FileText} etiqueta="Descripción" anchoCompleto>
              {b.descripcion}
            </CampoDetalle>
          ) : null}
        </RejillaCampos>
      </SeccionDetalle>

      <Historial creadoEn={b.creadoEn} modificadoEn={b.modificadoEn} />
    </>
  );
}
