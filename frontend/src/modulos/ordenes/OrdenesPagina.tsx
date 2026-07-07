import {
  Building2,
  Calendar,
  Factory,
  Grid3x3,
  MessageSquare,
  Paperclip,
  Route,
  Tags,
  UserRound,
  Workflow,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useOrden, useOrdenes } from '@/api/ordenes';
import type { EstadoOrden, Orden, OrdenesQuery } from '@/api/tipos';
import { Avatar } from '@/components/dominio/visuales';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { AdjuntosOrden } from './AdjuntosOrden';
import { DialogoCancelarOrden } from './DialogoCancelarOrden';
import { DialogoCopiarMatriz } from './DialogoCopiarMatriz';
import { DialogoNuevaOrden } from './DialogoNuevaOrden';
import { EditorEncabezadoOrden } from './EditorEncabezadoOrden';
import { FotosModeloOrden } from './FotosModeloOrden';
import { PanelComentarios } from './PanelComentarios';
import { PanelMatriz } from './PanelMatriz';
import { PanelReferencias } from './PanelReferencias';
import { SeccionDesarrolloOrden } from './SeccionDesarrolloOrden';

/** Renglones por página del listado. */
const POR_PAGINA = 10;

/**
 * Lee `state.idOrden` del deep-link (mosaico "Modificar" del centro de comando, R2). Devuelve el
 * id si viene un entero positivo válido; si no, `null` (comportamiento por defecto intacto).
 */
function leerIdOrdenDeepLink(state: unknown): number | null {
  if (typeof state !== 'object' || state === null || !('idOrden' in state)) {
    return null;
  }
  const id = state.idOrden;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

/** Formatea una fecha date-only `YYYY-MM-DD` como "13 jun 2026" sin desfase de zona. */
function fechaCorta(valor: string | null): string {
  if (valor === null) {
    return '—';
  }
  const [a, m, d] = valor.split('-').map(Number);
  if (a === undefined || m === undefined || d === undefined) {
    return '—';
  }
  return new Date(a, m - 1, d).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Texto + variante del badge de estado DERIVADO de la orden. */
function badgeEstado(estado: EstadoOrden): {
  texto: string;
  variante: 'default' | 'secondary' | 'destructive';
} {
  if (estado === 'completa') {
    return { texto: 'Completa', variante: 'default' };
  }
  if (estado === 'cancelada') {
    return { texto: 'Cancelada', variante: 'destructive' };
  }
  return { texto: 'Capturada', variante: 'secondary' };
}

/** Badge del estado de una orden (estado derivado por el backend, sin acción de "marcar"). */
function EstadoOrdenBadge({ estado }: { estado: EstadoOrden }): React.JSX.Element {
  const { texto, variante } = badgeEstado(estado);
  return (
    <Badge variant={variante} data-testid="estado-orden">
      {texto}
    </Badge>
  );
}

/**
 * Pantalla de ÓRDENES de producción (F2-E3) sobre el motor LISTA + DETALLE. La lista busca (folio /
 * modelo / cliente / referencia) con paginación de servidor y toggle de canceladas; el detalle
 * muestra el encabezado (estado DERIVADO, sin "marcar completa"), el editor del encabezado, la
 * matriz color × talla, las referencias D7 del cliente y los comentarios. Crear sale de un renglón
 * de pedido; cancelar exige motivo. Las acciones de escritura se ocultan sin `ordenes.administrar`
 * (cancelar exige `ordenes.cancelar`); la decisión real la toma el backend (A1).
 */
export function OrdenesPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const navigate = useNavigate();
  const location = useLocation();
  const puedeAdministrar = tienePermiso('ordenes.administrar');
  const puedeCancelar = tienePermiso('ordenes.cancelar');
  const puedeRutaVer = tienePermiso('rc.ruta-ver');
  const puedeProgramar = tienePermiso('rc.programar');
  // Enganche Desarrollo↔orden (F8-E6): ver el expediente/sugerencia (desarrollo.ver), ligar/quitar
  // (desarrollo.administrar) y ver importes (consultas.ver-importes). El backend re-decide (A1).
  const puedeVerDesarrollo = tienePermiso('desarrollo.ver');
  const puedeAdministrarDesarrollo = tienePermiso('desarrollo.administrar');
  const verImportes = tienePermiso('consultas.ver-importes');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirCanceladas, setIncluirCanceladas] = useState(false);
  const [pagina, setPagina] = useState(1);

  const query: OrdenesQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'folio',
    direccion: 'desc',
    incluirCanceladas: incluirCanceladas ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  };

  const consulta = useOrdenes(query);

  // ── Diálogos ───────────────────────────────────────────────────────────────
  const [altaAbierta, setAltaAbierta] = useState(false);
  const [aCancelar, setACancelar] = useState<Orden | null>(null);
  const [aCopiarMatriz, setACopiarMatriz] = useState<Orden | null>(null);
  // Id a enfocar en la lista (deep-link): tras crear, la orden nueva; o el `state.idOrden` del
  // mosaico "Modificar" del centro de comando (R2). El state se consume (replace) para que un
  // refresh no lo re-aplique — mismo patrón que ModelosPagina.
  const [idAEnfocar, setIdAEnfocar] = useState<number | null>(leerIdOrdenDeepLink(location.state));
  const idDeepLink = leerIdOrdenDeepLink(location.state);
  useEffect(() => {
    if (idDeepLink !== null) {
      setIdAEnfocar(idDeepLink);
      void navigate(location.pathname, { replace: true, state: null });
    }
  }, [idDeepLink, location.pathname, navigate]);
  // Si la orden del deep-link no está en la página visible, se inyecta al frente para que
  // ListaDetalle pueda seleccionarla (mismo truco que ModelosPagina).
  const fichaDeepLink = useOrden(idAEnfocar ?? undefined);

  /** Tras crear, enfoca la orden NUEVA (encabeza la página 1 por orden de folio desc). */
  function alCreada(idNueva: number): void {
    setTextoBusqueda('');
    setPagina(1);
    setIdAEnfocar(idNueva);
  }

  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
    setPagina(1);
  }
  function alAlternarCanceladas(): void {
    setIncluirCanceladas((v) => !v);
    setPagina(1);
  }

  const datos = consulta.data;
  const visibles = datos?.datos ?? [];
  const registros =
    idAEnfocar !== null &&
    fichaDeepLink.data !== undefined &&
    fichaDeepLink.data.id === idAEnfocar &&
    !visibles.some((o) => o.id === idAEnfocar)
      ? [fichaDeepLink.data, ...visibles]
      : visibles;
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
      <ListaDetalle<Orden>
        testid="orden"
        titulo="Órdenes"
        descripcion="Órdenes de producción con su matriz color × talla."
        icono={Factory}
        registros={registros}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(o) => o.id}
        obtenerTitulo={(o) => `Orden ${o.folio}`}
        // "activo" = no cancelada (la cancelación suave es el "borrado" de la orden).
        obtenerActivo={(o) => o.estado !== 'cancelada'}
        obtenerSecundaria={(o) => `${o.codigoModelo} · ${o.cliente}`}
        renderAvatarLista={(o) => <Avatar nombre={o.codigoModelo} tono="neutro" tamano="sm" />}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        incluirInactivos={incluirCanceladas}
        alAlternarInactivos={alAlternarCanceladas}
        textoVacio="No hay órdenes que coincidan con la búsqueda."
        paginacion={paginacion}
        seleccionInicialId={idAEnfocar}
        puedeAdministrar={puedeAdministrar}
        alNuevo={() => setAltaAbierta(true)}
        textoNuevo="Nueva orden"
        // El editor del encabezado va en el cuerpo del detalle (no en el diálogo de "Editar").
        alEditar={() => undefined}
        // Cancelar = desactivar (suave). Reactivar no aplica: una orden cancelada no se reactiva.
        alDesactivar={setACancelar}
        alReactivar={() => undefined}
        renderAvatarDetalle={(o) => <Avatar nombre={o.codigoModelo} tono="neutro" tamano="lg" />}
        renderMeta={(o) => (
          <span className="flex flex-wrap items-center gap-2">
            <EstadoOrdenBadge estado={o.estado} />
            <span className="text-sm text-muted-foreground">
              {o.totalPiezas.toLocaleString('es-MX')} pz
            </span>
          </span>
        )}
        // El hero solo ofrece "Cancelar" (cuando aplica). Editar/Desactivar genéricos no encajan.
        ocultarAccionesBase
        accionesExtra={(o) =>
          puedeCancelar && o.estado !== 'cancelada' ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setACancelar(o)}
              data-testid="cancelar-orden"
            >
              <XCircle aria-hidden />
              Cancelar
            </Button>
          ) : null
        }
        renderDetalle={(o) => (
          <DetalleOrden
            orden={o}
            puedeAdministrar={puedeAdministrar}
            puedeRutaVer={puedeRutaVer}
            puedeProgramar={puedeProgramar}
            puedeVerDesarrollo={puedeVerDesarrollo}
            puedeAdministrarDesarrollo={puedeAdministrarDesarrollo}
            verImportes={verImportes}
            alCopiarMatriz={() => setACopiarMatriz(o)}
            alVerRuta={() => void navigate(`/ruta-critica/ordenes/${o.id}`)}
            alProgramarRuta={() => void navigate(`/ruta-critica/ordenes/${o.id}/programar`)}
          />
        )}
      />

      {/* Los diálogos con búsqueda interna (pedidos/órdenes) se montan SOLO al abrirse: así no
          consultan el API mientras están cerrados. */}
      {altaAbierta ? (
        <DialogoNuevaOrden abierto alCambiarAbierto={setAltaAbierta} alCreada={alCreada} />
      ) : null}
      {aCopiarMatriz !== null ? (
        <DialogoCopiarMatriz
          abierto
          alCambiarAbierto={(abierto) => {
            if (!abierto) {
              setACopiarMatriz(null);
            }
          }}
          orden={aCopiarMatriz}
        />
      ) : null}
      <DialogoCancelarOrden
        abierto={aCancelar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setACancelar(null);
          }
        }}
        orden={aCancelar ?? undefined}
      />
    </>
  );
}

/** Panel de DETALLE de una orden: encabezado, editor, matriz, referencias y comentarios. */
function DetalleOrden({
  orden,
  puedeAdministrar,
  puedeRutaVer,
  puedeProgramar,
  puedeVerDesarrollo,
  puedeAdministrarDesarrollo,
  verImportes,
  alCopiarMatriz,
  alVerRuta,
  alProgramarRuta,
}: {
  orden: Orden;
  puedeAdministrar: boolean;
  puedeRutaVer: boolean;
  puedeProgramar: boolean;
  puedeVerDesarrollo: boolean;
  puedeAdministrarDesarrollo: boolean;
  verImportes: boolean;
  alCopiarMatriz: () => void;
  alVerRuta: () => void;
  alProgramarRuta: () => void;
}): React.JSX.Element {
  return (
    <>
      <SeccionDetalle titulo="Datos de la orden" icono={Factory}>
        <RejillaCampos>
          <CampoDetalle icono={Factory} etiqueta="Modelo">
            <span className="font-medium">{orden.codigoModelo}</span>
            {orden.descripcionModelo ? (
              <span className="block text-xs text-muted-foreground">{orden.descripcionModelo}</span>
            ) : null}
          </CampoDetalle>
          <CampoDetalle icono={UserRound} etiqueta="Cliente">
            {orden.cliente}
          </CampoDetalle>
          <CampoDetalle icono={Building2} etiqueta="Estado">
            <EstadoOrdenBadge estado={orden.estado} />
          </CampoDetalle>
          <CampoDetalle icono={Calendar} etiqueta="Entrega">
            {fechaCorta(orden.fechaEntrega)}
          </CampoDetalle>
        </RejillaCampos>

        {orden.estado === 'cancelada' && orden.motivoCancelada ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <span className="font-medium text-destructive">Cancelada:</span> {orden.motivoCancelada}
          </p>
        ) : null}

        <FotosModeloOrden idModelo={orden.idModelo} codigoModelo={orden.codigoModelo} />

        {/* Ruta Crítica (F5-E5): consultar / programar la ruta de ESTA orden. La acción real la
            re-verifica el backend (A1); aquí solo se muestran los accesos según permiso. */}
        {(puedeRutaVer || puedeProgramar) && orden.estado !== 'cancelada' ? (
          <div className="flex flex-wrap gap-2" data-testid="acciones-rc-orden">
            {puedeRutaVer ? (
              <Button variant="outline" size="sm" onClick={alVerRuta} data-testid="orden-ver-ruta">
                <Route aria-hidden />
                Ver Ruta Crítica
              </Button>
            ) : null}
            {puedeProgramar ? (
              <Button size="sm" onClick={alProgramarRuta} data-testid="orden-programar-rc">
                <Route aria-hidden />
                Programar RC
              </Button>
            ) : null}
          </div>
        ) : null}
      </SeccionDetalle>

      <SeccionDetalle titulo="Encabezado" icono={Tags}>
        <EditorEncabezadoOrden orden={orden} puedeAdministrar={puedeAdministrar} />
      </SeccionDetalle>

      <SeccionDetalle titulo="Matriz color × talla" icono={Grid3x3}>
        <PanelMatriz
          orden={orden}
          puedeAdministrar={puedeAdministrar}
          alCopiarMatriz={alCopiarMatriz}
        />
      </SeccionDetalle>

      <SeccionDetalle titulo="Referencias del cliente" icono={Tags}>
        <PanelReferencias orden={orden} puedeAdministrar={puedeAdministrar} />
      </SeccionDetalle>

      {/* Enganche Desarrollo↔Producción (F8-E6): sugerencia+ligar o vista 360 del expediente. Solo
          para quien puede ver Desarrollo; el backend re-decide (A1). */}
      {puedeVerDesarrollo ? (
        <SeccionDetalle titulo="Desarrollo" icono={Workflow}>
          <SeccionDesarrolloOrden
            orden={orden}
            puedeAdministrar={puedeAdministrarDesarrollo}
            verImportes={verImportes}
          />
        </SeccionDetalle>
      ) : null}

      <SeccionDetalle titulo="Comentarios" icono={MessageSquare}>
        <PanelComentarios orden={orden} puedeAdministrar={puedeAdministrar} />
      </SeccionDetalle>

      {/* Adjuntos de apoyo de la orden en R2 (F8-E6, R6). Subir/eliminar con ordenes.administrar. */}
      <SeccionDetalle titulo="Adjuntos" icono={Paperclip}>
        <AdjuntosOrden idOrden={orden.id} puedeAdministrar={puedeAdministrar} />
      </SeccionDetalle>

      <Historial creadoEn={orden.creadoEn} modificadoEn={orden.modificadoEn} />
    </>
  );
}
