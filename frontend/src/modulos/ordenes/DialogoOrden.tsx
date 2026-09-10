import {
  Building2,
  Calendar,
  Factory,
  Grid3x3,
  Lock,
  LockOpen,
  ListChecks,
  Loader2Icon,
  MessageSquare,
  Paperclip,
  Route,
  SaveIcon,
  Tags,
  UserRound,
  Workflow,
  X,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useOrden } from '@/api/ordenes';
import type { EstadoOrden, Orden } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Avatar } from '@/components/dominio/visuales';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { AdjuntosOrden } from './AdjuntosOrden';
import { DialogoCancelarOrden } from './DialogoCancelarOrden';
import { DialogoCerrarOrden } from './DialogoCerrarOrden';
import { DialogoCopiarMatriz } from './DialogoCopiarMatriz';
import { EditorEncabezadoOrden } from './EditorEncabezadoOrden';
import { FotosModeloOrden } from './FotosModeloOrden';
import { ProveedorGuardadoOrden, useRegistroGuardadoOrden } from './guardado-orden';
import { PanelComentarios } from './PanelComentarios';
import { PanelHitosOrden } from './PanelHitosOrden';
import { PanelMatriz } from './PanelMatriz';
import { PanelReferencias } from './PanelReferencias';
import { textoFaltantes } from './requisitos';
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
  variante: 'default' | 'secondary' | 'destructive' | 'outline';
} {
  if (estado === 'completa') {
    return { texto: 'Completa', variante: 'default' };
  }
  if (estado === 'cancelada') {
    return { texto: 'Cancelada', variante: 'destructive' };
  }
  if (estado === 'cerrada') {
    // 0.061: la orden terminó su vida administrativa y su costo quedó CONGELADO. `outline` la
    // distingue de la cancelada (que es un fracaso) sin gritar: cerrar es el final NORMAL.
    return { texto: 'Cerrada', variante: 'outline' };
  }
  return { texto: 'Capturada', variante: 'secondary' };
}

/**
 * Badge del estado de una orden (estado AUTOMÁTICO, calculado por el backend: sin acción de
 * "marcar"). Cuando la orden todavía no está completa se dice **qué le falta** al lado —Daniel no
 * podía saber de dónde salía el estado (26-jul-2026).
 *
 * El "Falta: …" SOLO se pinta cuando el estado guardado es `capturada`: una orden `completa` o
 * `cancelada` no debe requisitos, y "Completa · Falta: arte" sería una contradicción en la misma
 * pantalla. Ese desfase es posible por diseño —una orden en producción NO se degrada aunque deje
 * de cumplir (ver `requisitos-orden.ts`)—, así que se resuelve mostrando el ESTADO, que es el dato
 * con el que se opera.
 */
function EstadoOrdenBadge({
  estado,
  faltantes = [],
}: {
  estado: EstadoOrden;
  faltantes?: readonly ('tallas' | 'receta' | 'arte')[];
}): React.JSX.Element {
  const { texto, variante } = badgeEstado(estado);
  const falta = estado === 'capturada' ? textoFaltantes(faltantes) : null;
  return (
    <>
      <Badge variant={variante} data-testid="estado-orden">
        {texto}
      </Badge>
      {falta !== null && (
        <span className="text-xs font-normal text-warn" data-testid="faltantes-orden">
          {falta}
        </span>
      )}
    </>
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
 *
 * GUARDADO ÚNICO (petición de Daniel, 24-jul-2026): las secciones con captura (encabezado, matriz,
 * referencias) YA NO tienen un botón cada una — se registran en `useRegistroGuardadoOrden` y las
 * guarda el único botón "Guardar" del pie, habilitado sólo si hay cambios. Y si se intenta cerrar
 * con cambios sin guardar, se pregunta antes de salir (Guardar y salir / Salir sin guardar /
 * Cancelar). Las acciones que NO son captura pendiente (comentarios, adjuntos, hitos, la liga con
 * Desarrollo, copiar matriz, cancelar la orden) conservan su acción propia: cada una es una
 * operación con su endpoint y su efecto inmediato, no un cambio en espera de guardarse.
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
  // ⭐ 0.061: cerrar la orden congela su costo y cierra la captura ⇒ permiso propio.
  const puedeCerrar = tienePermiso('ordenes.cerrar');
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
  // 0.061: `null` = ningún diálogo de cierre abierto; si no, en qué dirección va.
  const [aCerrar, setACerrar] = useState<'cerrar' | 'reabrir' | null>(null);

  // Guardado único de las secciones con captura + guardia de cierre con cambios sin guardar.
  const { valorContexto, hayCambios, impedimento, guardando, guardarTodo } =
    useRegistroGuardadoOrden(idOrden);
  const [confirmarSalida, setConfirmarSalida] = useState(false);

  /** Guarda todo lo pendiente; devuelve si quedó todo guardado. */
  const guardar = useCallback(async (): Promise<boolean> => {
    const resultado = await guardarTodo();
    if (resultado.ok) {
      toast.success('Cambios guardados.');
    } else if (resultado.error !== undefined) {
      toast.error(resultado.error);
    }
    return resultado.ok;
  }, [guardarTodo]);

  /** Cierra el diálogo, pero pregunta antes si hay cambios sin guardar. */
  const intentarCerrar = useCallback((): void => {
    if (hayCambios) {
      setConfirmarSalida(true);
      return;
    }
    alCerrar();
  }, [hayCambios, alCerrar]);

  // Esc cierra el diálogo (con el mismo guardia) — pero NO mientras un diálogo hijo (cancelar/
  // copiar/confirmar salida) está abierto: su propio Esc lo cierra (Radix) y si este listener
  // también corriera, tiraría el panel entero.
  useEffect(() => {
    if (
      !abierto ||
      aCancelar !== null ||
      aCopiarMatriz !== null ||
      aCerrar !== null ||
      confirmarSalida
    ) {
      return;
    }
    function alTeclear(evento: KeyboardEvent): void {
      if (evento.key === 'Escape') {
        intentarCerrar();
      }
    }
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [abierto, intentarCerrar, aCancelar, aCopiarMatriz, aCerrar, confirmarSalida]);

  if (!abierto || idOrden === null) {
    return null;
  }

  // El pie con el botón único sólo aparece donde hay algo que guardar (con permiso, no cancelada y
  // —0.061— no CERRADA: la orden cerrada es de solo lectura; el backend lo rechaza igual, esto sólo
  // evita ofrecer un botón que va a rebotar).
  const estaCerrada = orden !== undefined && orden.cerradaEn !== null;
  const puedeGuardar =
    orden !== undefined && puedeAdministrar && orden.estado !== 'cancelada' && !estaCerrada;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/45 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Orden ${String(orden?.folio ?? idOrden)}`}
      data-testid="dialogo-orden"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) intentarCerrar();
      }}
    >
      <div className="flex w-full max-w-4xl flex-col overflow-hidden bg-background shadow-xl sm:rounded-xl">
        {/* ── Encabezado (hero + acciones) ───────────────────────────────── */}
        <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
          <Avatar nombre={orden?.codigoModelo ?? '·'} tono="neutro" tamano="md" />
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 truncate text-base font-semibold">
              Orden {orden?.folio ?? '…'}
              {orden ? (
                <EstadoOrdenBadge estado={orden.estado} faltantes={orden.requisitos.faltantes} />
              ) : null}
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
          {/* ⭐ 0.061: Cerrar / Reabrir la orden. Cerrar CONGELA su costo y cierra la captura; la
              confirmación lo dice. Exige `ordenes.cerrar`; el backend re-decide (A1). Una orden
              CANCELADA no se cierra (no hay nada que cerrar). */}
          {orden !== undefined && puedeCerrar && orden.estado !== 'cancelada' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setACerrar(estaCerrada ? 'reabrir' : 'cerrar')}
              data-testid={estaCerrada ? 'reabrir-orden' : 'cerrar-orden'}
            >
              {estaCerrada ? <LockOpen aria-hidden /> : <Lock aria-hidden />}
              {estaCerrada ? 'Reabrir' : 'Cerrar'}
            </Button>
          ) : null}
          {/* Cancelar = desactivar (suave) de la orden; exige `ordenes.cancelar`. Una orden CERRADA
              tampoco se cancela: primero hay que reabrirla (0.061). */}
          {orden !== undefined && puedeCancelar && orden.estado !== 'cancelada' && !estaCerrada ? (
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
            onClick={intentarCerrar}
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
            <ProveedorGuardadoOrden value={valorContexto}>
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
            </ProveedorGuardadoOrden>
          )}
        </div>

        {/* ── Pie: UN SOLO botón de guardar para TODO el diálogo (Daniel 24-jul-2026) ── */}
        {puedeGuardar ? (
          <footer
            className="flex shrink-0 items-center justify-end gap-3 border-t px-4 py-3"
            data-testid="pie-orden"
          >
            {/* El impedimento MANDA sobre el "hay cambios": si algo capturado no se puede mandar,
                lo que el usuario necesita leer aquí es POR QUÉ el botón está apagado — no que tiene
                cambios (eso ya lo sabe). Lo capturado sigue vivo y el guardia de cierre sigue
                preguntando (§Post-F9.10). */}
            <p
              className={
                impedimento !== null
                  ? 'mr-auto text-xs text-destructive'
                  : 'mr-auto text-xs text-muted-foreground'
              }
              data-testid="aviso-cambios-orden"
              {...(impedimento !== null ? { role: 'alert' } : {})}
            >
              {impedimento ??
                (hayCambios ? 'Tienes cambios sin guardar.' : 'Sin cambios pendientes.')}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={intentarCerrar}
              disabled={guardando}
            >
              Cerrar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void guardar()}
              disabled={!hayCambios || guardando || impedimento !== null}
              data-testid="guardar-orden"
            >
              {guardando ? (
                <Loader2Icon className="animate-spin" aria-hidden />
              ) : (
                <SaveIcon aria-hidden />
              )}
              Guardar
            </Button>
          </footer>
        ) : null}
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
      {/* ⭐ 0.061: cerrar / reabrir la orden (congela y descongela su costo). */}
      <DialogoCerrarOrden
        abierto={aCerrar !== null}
        alCambiarAbierto={(abiertoNuevo) => {
          if (!abiertoNuevo) {
            setACerrar(null);
          }
        }}
        orden={orden}
        modo={aCerrar ?? 'cerrar'}
      />

      {/* Guardia de cierre con cambios sin guardar (Daniel 24-jul-2026). */}
      <DialogoConfirmacion
        abierto={confirmarSalida}
        alCambiarAbierto={(abiertoNuevo) => {
          if (!abiertoNuevo) {
            setConfirmarSalida(false);
          }
        }}
        titulo="Cambios sin guardar"
        descripcion={
          // 🔴 EL PIE NO ES EL ÚNICO CAMINO AL GUARDADO: "Guardar y salir" entra por aquí, y ese
          // botón no lo apaga el impedimento. Quien PARA la captura inválida es la sección misma
          // (su `preparar` devuelve `null`, contrato de `PrepararGuardado`); lo que falta es que el
          // usuario sepa POR QUÉ, porque este diálogo tapa el aviso en línea de la matriz. Por eso
          // el motivo se dice aquí, en lugar del texto genérico (§Post-F9.10).
          impedimento ??
          'Tienes cambios sin guardar en esta orden. ¿Quieres guardarlos antes de salir?'
        }
        textoCancelar="Cancelar"
        accionSecundaria={{
          texto: 'Salir sin guardar',
          testid: 'salir-sin-guardar-orden',
          alAccionar: () => {
            setConfirmarSalida(false);
            alCerrar();
          },
        }}
        textoConfirmar="Guardar y salir"
        procesando={guardando}
        alConfirmar={() => {
          void guardar().then((ok) => {
            if (ok) {
              setConfirmarSalida(false);
              alCerrar();
            }
            // Si falló, el diálogo de confirmación se queda: el usuario decide qué hacer.
          });
        }}
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
            <EstadoOrdenBadge estado={orden.estado} faltantes={orden.requisitos.faltantes} />
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

        {/* ⭐ §Post-F9.169(b) — la tira lleva `idOrden` PARA QUE ESTE DIÁLOGO RESPETE LO QUE LA OP
            QUITÓ. Sin él, `useFotosOcultasOrden` iba `enabled:false` y la foto ocultada en el Centro
            de Órdenes REAPARECÍA aquí, en la MISMA orden, un clic después — y el usuario no tenía
            forma de saber por qué.

            ⚠️ NO se pasa `puedeAdministrar` (default `false`) y es a propósito: aquí las fotos sólo
            se MIRAN. Quitarlas de la OP y traerlas de vuelta se hace en el Centro de Órdenes, así
            que ni el tile «+», ni la papelera, ni los botones de quitar/traer se encienden. */}
        <FotosModeloOrden
          idModelo={orden.idModelo}
          codigoModelo={orden.codigoModelo}
          idOrden={orden.id}
        />

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

      {/* ⭐ V1-E3h (§Post-F9.72) — LA RECETA YA NO VIVE AQUÍ. Vivía dentro de este diálogo, que solo
          abre quien tiene `ordenes.administrar`, y con ella vivía el botón de LIBERAR: *la puerta que
          abre la compra*. Daniel: *"ahí está y no tendría que estar ahí… nadie va a tener permiso de
          modificar la OP más que yo"*. Ahora está en el PANEL DE LA ORDEN del Centro de Órdenes,
          gobernada por `desarrollo.ver`/`desarrollo.administrar` — que es de quien es la
          responsabilidad. Si algún día vuelve a hacer falta aquí, que sea por una decisión, no por
          inercia. */}

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
