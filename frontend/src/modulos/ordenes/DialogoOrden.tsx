import {
  Building2,
  Calendar,
  Factory,
  Grid3x3,
  ListChecks,
  MessageSquare,
  Paperclip,
  Route,
  Tags,
  UserRound,
  Workflow,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useOrden } from '@/api/ordenes';
import type { EstadoOrden, Orden } from '@/api/tipos';
import { Avatar } from '@/components/dominio/visuales';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { AdjuntosOrden } from './AdjuntosOrden';
import { DialogoCancelarOrden } from './DialogoCancelarOrden';
import { DialogoCopiarMatriz } from './DialogoCopiarMatriz';
import { EditorEncabezadoOrden } from './EditorEncabezadoOrden';
import { FotosModeloOrden } from './FotosModeloOrden';
import { PanelComentarios } from './PanelComentarios';
import { PanelHitosOrden } from './PanelHitosOrden';
import { PanelMatriz } from './PanelMatriz';
import { PanelReferencias } from './PanelReferencias';
import { SeccionDesarrolloOrden } from './SeccionDesarrolloOrden';

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

/** Props del diálogo de edición de una orden. */
export interface PropsDialogoOrden {
  abierto: boolean;
  /** Orden a editar (la OP nace del pedido; este diálogo solo edita una existente). */
  idOrden: number | null;
  alCerrar: () => void;
}

/**
 * DIÁLOGO DE EDICIÓN de una orden de producción (rediseño: retiro del panel viejo de Órdenes) — la
 * CAPTURA/edición completa F2-E3 que antes vivía en la página `/produccion/ordenes/captura`
 * (plantilla de catálogo), ahora a pantalla completa y accesible con el mosaico "Modificar" del
 * centro de comando. Su valor real es el cuerpo `DetalleOrden`: encabezado, MATRIZ color × talla
 * (D4), referencias del cliente (D7), comentarios, adjuntos, hitos y el enganche con Desarrollo.
 *
 * La OP NO se crea aquí: nace del PEDIDO (R3, §4.1); "Nueva orden" abre el constructor de pedido.
 * Se cierra con Esc, el botón ✕ o el clic en el fondo (mismo patrón que el Avance de producción).
 * Las acciones de escritura se ocultan sin `ordenes.administrar` (cancelar exige `ordenes.cancelar`);
 * la decisión real la toma el backend (A1).
 */
export function DialogoOrden({
  abierto,
  idOrden,
  alCerrar,
}: PropsDialogoOrden): React.JSX.Element | null {
  const { tienePermiso } = useSesion();
  const navigate = useNavigate();
  const puedeAdministrar = tienePermiso('ordenes.administrar');
  const puedeCancelar = tienePermiso('ordenes.cancelar');
  const puedeRutaVer = tienePermiso('rc.ruta-ver');
  const puedeProgramar = tienePermiso('rc.programar');
  // Hitos de la orden (post-F9): capturar/cancelar exige `rc.capturar` (es un avance de RC).
  const puedeCapturarRc = tienePermiso('rc.capturar');
  // Enganche Desarrollo↔orden (F8-E6): ver el expediente/sugerencia (desarrollo.ver), ligar/quitar
  // (desarrollo.administrar) y ver importes (consultas.ver-importes). El backend re-decide (A1).
  const puedeVerDesarrollo = tienePermiso('desarrollo.ver');
  const puedeAdministrarDesarrollo = tienePermiso('desarrollo.administrar');
  const verImportes = tienePermiso('consultas.ver-importes');

  const consulta = useOrden(abierto && idOrden !== null ? idOrden : undefined);
  const orden = consulta.data;

  // Diálogos hijos (Radix): se montan SOLO al abrirse, así no consultan el API mientras cerrados.
  const [aCancelar, setACancelar] = useState<Orden | null>(null);
  const [aCopiarMatriz, setACopiarMatriz] = useState<Orden | null>(null);

  // Esc cierra el diálogo — pero NO mientras un diálogo hijo (cancelar/copiar) está abierto: su
  // propio Esc lo cierra (Radix) y si este listener también corriera, tiraría el panel entero.
  useEffect(() => {
    if (!abierto || aCancelar !== null || aCopiarMatriz !== null) {
      return;
    }
    function alTeclear(evento: KeyboardEvent): void {
      if (evento.key === 'Escape') {
        alCerrar();
      }
    }
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [abierto, alCerrar, aCancelar, aCopiarMatriz]);

  if (!abierto || idOrden === null) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/45 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Orden ${String(orden?.folio ?? idOrden)}`}
      data-testid="dialogo-orden"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) alCerrar();
      }}
    >
      <div className="flex w-full max-w-4xl flex-col overflow-hidden bg-background shadow-xl sm:rounded-xl">
        {/* ── Encabezado (hero + acciones) ───────────────────────────────── */}
        <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
          <Avatar nombre={orden?.codigoModelo ?? '·'} tono="neutro" tamano="md" />
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 truncate text-base font-semibold">
              Orden {orden?.folio ?? '…'}
              {orden ? <EstadoOrdenBadge estado={orden.estado} /> : null}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {orden ? (
                <>
                  Modelo <b>{orden.codigoModelo}</b> · {orden.cliente} ·{' '}
                  {orden.totalPiezas.toLocaleString('es-MX')} pz
                </>
              ) : (
                'Cargando…'
              )}
            </p>
          </div>
          {/* Cancelar = desactivar (suave) de la orden; exige `ordenes.cancelar`. */}
          {orden !== undefined && puedeCancelar && orden.estado !== 'cancelada' ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setACancelar(orden)}
              data-testid="cancelar-orden"
            >
              <XCircle aria-hidden />
              Cancelar
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            onClick={alCerrar}
            aria-label="Cerrar (Esc)"
            data-testid="dialogo-orden-cerrar"
          >
            <X className="size-5" aria-hidden />
          </Button>
        </header>

        {/* ── Cuerpo con scroll (el cuerpo del detalle es el mismo F2-E3) ── */}
        <div
          data-testid="detalle-orden"
          className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 lg:p-5"
        >
          {consulta.isPending ? (
            <p className="text-sm text-muted-foreground">Cargando detalle…</p>
          ) : consulta.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {consulta.error.message}
            </p>
          ) : orden === undefined ? (
            <p className="text-sm text-muted-foreground">Sin detalle.</p>
          ) : (
            <DetalleOrden
              orden={orden}
              puedeAdministrar={puedeAdministrar}
              puedeRutaVer={puedeRutaVer}
              puedeProgramar={puedeProgramar}
              puedeCapturarRc={puedeCapturarRc}
              puedeVerDesarrollo={puedeVerDesarrollo}
              puedeAdministrarDesarrollo={puedeAdministrarDesarrollo}
              verImportes={verImportes}
              alCopiarMatriz={() => setACopiarMatriz(orden)}
              alVerRuta={() => void navigate(`/ruta-critica/ordenes/${orden.id}`)}
              alProgramarRuta={() => void navigate(`/ruta-critica/ordenes/${orden.id}/programar`)}
            />
          )}
        </div>
      </div>

      {/* Los diálogos con búsqueda interna se montan SOLO al abrirse. */}
      {aCopiarMatriz !== null ? (
        <DialogoCopiarMatriz
          abierto
          alCambiarAbierto={(abiertoNuevo) => {
            if (!abiertoNuevo) {
              setACopiarMatriz(null);
            }
          }}
          orden={aCopiarMatriz}
        />
      ) : null}
      <DialogoCancelarOrden
        abierto={aCancelar !== null}
        alCambiarAbierto={(abiertoNuevo) => {
          if (!abiertoNuevo) {
            setACancelar(null);
          }
        }}
        orden={aCancelar ?? undefined}
      />
    </div>
  );
}

/** Panel de DETALLE de una orden: encabezado, editor, matriz, referencias y comentarios. */
function DetalleOrden({
  orden,
  puedeAdministrar,
  puedeRutaVer,
  puedeProgramar,
  puedeCapturarRc,
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
  puedeCapturarRc: boolean;
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

      {/* Hitos de la orden (post-F9): actos puntuales (revisión OP, fit, tono, avíos, empaque, arte)
          que auto-completan su proceso de la Ruta Crítica. Se muestra a quien puede ver la RC;
          registrar/cancelar exige `rc.capturar`. El backend re-decide (A1). */}
      {puedeRutaVer ? (
        <SeccionDetalle titulo="Hitos de la orden" icono={ListChecks}>
          <PanelHitosOrden orden={orden} puedeCapturar={puedeCapturarRc} />
        </SeccionDetalle>
      ) : null}

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
