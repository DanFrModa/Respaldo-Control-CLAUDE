import {
  Banknote,
  Building2,
  CalendarRange,
  Handshake,
  Layers,
  Link2,
  Link2Off,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useExpedienteOrden,
  useLigarOrden,
  useQuitarLiga,
  useSugerenciaLiga,
  type EstadoDesarrollo,
} from '@/api/liga-orden';
import type { Orden } from '@/api/tipos';
import { DialogoConfirmacion } from '@/components/DialogoConfirmacion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { autorDeEvento, formatearFechaHora, formatearMoneda } from '@/lib/formato';
import { CampoDetalle, RejillaCampos } from '@/modulos/detalle';
import {
  ETIQUETA_ESTADO_DESARROLLO,
  VARIANTE_ESTADO_DESARROLLO,
} from '@/modulos/desarrollo/estados';

/** Badge del estado derivado de un desarrollo. */
function BadgeEstadoDesarrollo({ estado }: { estado: EstadoDesarrollo }): React.JSX.Element {
  return (
    <Badge variant={VARIANTE_ESTADO_DESARROLLO[estado]} data-testid="estado-desarrollo-orden">
      {ETIQUETA_ESTADO_DESARROLLO[estado]}
    </Badge>
  );
}

/**
 * Un importe ya formateado. NO decide nada de permisos: sin `consultas.ver-importes`
 * el campo entero (rótulo incluido) no se pinta — §Post-F9.68, «columna entera, no
 * celda vacía»: una celda en blanco haría creer que el dato no existe.
 */
function Importe({ valor }: { valor: number | null }): React.JSX.Element {
  return <span className="font-medium tabular-nums">{formatearMoneda(valor)}</span>;
}

/**
 * Sección "Desarrollo" del detalle de una ORDEN (F8-E6, enganche D13/R16). Amarra el expediente de
 * Desarrollo (proyecto → precosto → lista/precio negociado) a la orden que dispara el MRP/OC.
 *
 *  • Orden NO ligada: sugiere el desarrollo CANDIDATO (mismo modelo+cliente) con su precio PROPUESTO
 *    para el pedido (default editable, nunca candado) y un botón "Ligar" (con `desarrollo.administrar`).
 *  • Orden SÍ ligada: vista 360 (proyecto, precosto vigente, lista/precio, acuerdos de negociación,
 *    solo lectura) + "Quitar liga" (con confirmación).
 *
 * Los importes se DERIVAN del permiso real (`consultas.ver-importes`), no de inferir null (el backend
 * ya los oculta). Sin ese permiso el campo de dinero se va COMPLETO —rótulo incluido— y NO se pone
 * un letrero de permiso en su lugar (§Post-F9.68: esconder, no negar; una celda vacía haría creer
 * que el dato no existe). Los botones se gatéan por `desarrollo.administrar`; el backend re-decide (A1).
 */
export function SeccionDesarrolloOrden({
  orden,
  puedeAdministrar,
  verImportes,
}: {
  orden: Orden;
  puedeAdministrar: boolean;
  verImportes: boolean;
}): React.JSX.Element {
  const sugerencia = useSugerenciaLiga(orden.id);
  const yaLigada = sugerencia.data?.yaLigada ?? false;
  const expediente = useExpedienteOrden(orden.id, yaLigada);
  const ligar = useLigarOrden();
  const quitar = useQuitarLiga();
  const [confirmarQuitar, setConfirmarQuitar] = useState(false);

  function alLigar(idDesarrollo: number, precio: number | null): void {
    ligar.mutate(
      { idOrden: orden.id, idDesarrollo },
      {
        onSuccess: () =>
          toast.success(
            precio !== null && verImportes
              ? `Orden ligada. Precio sugerido para el pedido: ${formatearMoneda(precio)}.`
              : 'Orden ligada al desarrollo.',
          ),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function alQuitar(): void {
    quitar.mutate(orden.id, {
      onSuccess: () => {
        toast.success('Liga con el desarrollo quitada.');
        setConfirmarQuitar(false);
      },
      onError: (error) => toast.error(error.message),
    });
  }

  if (sugerencia.isPending) {
    return <p className="text-sm text-muted-foreground">Cargando desarrollo…</p>;
  }
  if (sugerencia.isError) {
    return <p className="text-sm text-destructive">{sugerencia.error.message}</p>;
  }

  // ── Orden ligada: vista 360 ────────────────────────────────────────────────
  if (yaLigada) {
    if (expediente.isPending) {
      return <p className="text-sm text-muted-foreground">Cargando expediente…</p>;
    }
    if (expediente.isError) {
      return <p className="text-sm text-destructive">{expediente.error.message}</p>;
    }
    const exp = expediente.data;
    return (
      <div className="space-y-4" data-testid="desarrollo-orden-ligada">
        <RejillaCampos>
          <CampoDetalle icono={Layers} etiqueta="Proyecto">
            <span className="font-medium">{exp.nombreProyecto}</span>
            <span className="block text-xs text-muted-foreground">#{exp.folioProyecto}</span>
          </CampoDetalle>
          <CampoDetalle icono={Building2} etiqueta="Cliente / Depto.">
            {exp.nombreCliente} · {exp.nombreDepartamento}
          </CampoDetalle>
          <CampoDetalle icono={CalendarRange} etiqueta="Temporada">
            {exp.temporada ?? '—'}
          </CampoDetalle>
          <CampoDetalle icono={Layers} etiqueta="Estado">
            <BadgeEstadoDesarrollo estado={exp.estadoDesarrollo} />
            {exp.numeroCliente ? (
              <span className="block text-xs text-muted-foreground">
                Nº cliente: {exp.numeroCliente}
              </span>
            ) : null}
          </CampoDetalle>
          {/* El PRECOSTO es puro dinero: sin permiso de importes se va el campo
              COMPLETO, rótulo incluido (§Post-F9.68). */}
          {verImportes ? (
            <CampoDetalle icono={Banknote} etiqueta="Precosto vigente">
              {exp.precostoVigente === null ? (
                <span className="text-xs text-muted-foreground">Sin versión congelada</span>
              ) : (
                <>
                  <span className="text-xs text-muted-foreground">
                    v{exp.precostoVigente.version} ·{' '}
                  </span>
                  <Importe valor={exp.precostoVigente.costoTotal} />
                </>
              )}
            </CampoDetalle>
          ) : null}
          {/* La LISTA no es solo dinero: sin importes se conserva el dato que sí
              se puede ver (folio y estado) y el rótulo cambia a «Lista», para no
              prometer un precio que no se está mostrando. */}
          <CampoDetalle icono={Banknote} etiqueta={verImportes ? 'Lista / precio' : 'Lista'}>
            {exp.lista === null ? (
              <span className="text-xs text-muted-foreground">No está en lista</span>
            ) : (
              <>
                {verImportes ? <Importe valor={exp.lista.precio} /> : null}
                <span className="block text-xs text-muted-foreground">
                  Lista #{exp.lista.folioLista} · {exp.lista.nombreEstadoLista}
                  {exp.lista.aprobado ? ' · aprobado' : ''}
                </span>
              </>
            )}
          </CampoDetalle>
        </RejillaCampos>

        {/* Acuerdos de negociación (solo lectura, cronológico). */}
        {exp.acuerdos.length > 0 ? (
          <div className="space-y-2" data-testid="acuerdos-negociacion-orden">
            <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Handshake className="size-4" aria-hidden />
              Acuerdos de negociación
            </p>
            <ul className="space-y-2">
              {exp.acuerdos.map((ev) => (
                <li
                  key={ev.id}
                  className="rounded-lg border p-2.5 text-sm"
                  data-testid="acuerdo-negociacion"
                >
                  <p>{ev.acuerdo}</p>
                  <p className="text-xs text-muted-foreground">
                    {verImportes && (ev.precioAnterior !== null || ev.precioNuevo !== null) ? (
                      <span>
                        {formatearMoneda(ev.precioAnterior)} → {formatearMoneda(ev.precioNuevo)}{' '}
                        ·{' '}
                      </span>
                    ) : null}
                    {formatearFechaHora(ev.registradoEn)}
                    {` · por ${autorDeEvento(ev)}`}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {puedeAdministrar ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmarQuitar(true)}
            data-testid="quitar-liga-desarrollo"
          >
            <Link2Off aria-hidden />
            Quitar liga
          </Button>
        ) : null}

        <DialogoConfirmacion
          abierto={confirmarQuitar}
          alCambiarAbierto={setConfirmarQuitar}
          titulo="Quitar liga con el desarrollo"
          descripcion="La orden dejará de estar ligada a su desarrollo. El expediente (precosto, lista, negociación) se conserva; sólo se quita la relación."
          textoConfirmar="Quitar liga"
          variante="destructive"
          procesando={quitar.isPending}
          alConfirmar={alQuitar}
        />
      </div>
    );
  }

  // ── Orden NO ligada: sugerencia + ligar ─────────────────────────────────────
  const candidato = sugerencia.data.candidato;
  if (candidato === null) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="desarrollo-orden-sin-candidato">
        No hay un desarrollo del mismo modelo y cliente listo para ligar. Crea o cotiza el
        desarrollo en el módulo Desarrollo.
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="desarrollo-orden-sugerencia">
      <div className="rounded-lg border p-3">
        <p className="text-xs font-medium text-muted-foreground">Desarrollo sugerido para ligar</p>
        <RejillaCampos>
          <CampoDetalle icono={Layers} etiqueta="Proyecto">
            <span className="font-medium">{candidato.nombreProyecto}</span>
            <span className="block text-xs text-muted-foreground">#{candidato.folioProyecto}</span>
          </CampoDetalle>
          <CampoDetalle icono={Layers} etiqueta="Estado">
            <BadgeEstadoDesarrollo estado={candidato.estado} />
            {candidato.numeroCliente ? (
              <span className="block text-xs text-muted-foreground">
                Nº cliente: {candidato.numeroCliente}
              </span>
            ) : null}
          </CampoDetalle>
          {/* Sin permiso de importes el campo entero desaparece: es un precio y
              nada más (§Post-F9.68). */}
          {verImportes ? (
            <CampoDetalle icono={Banknote} etiqueta="Precio sugerido al pedido" anchoCompleto>
              {candidato.precioSugeridoPedido === null ? (
                <span className="text-xs text-muted-foreground">Sin lista/precio aún</span>
              ) : (
                <>
                  <span
                    className="text-lg font-semibold tabular-nums"
                    data-testid="precio-sugerido-pedido"
                  >
                    {formatearMoneda(candidato.precioSugeridoPedido)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Default editable: aplícalo (o ajústalo) en el precio del renglón del pedido.
                  </span>
                </>
              )}
            </CampoDetalle>
          ) : null}
        </RejillaCampos>
      </div>

      {puedeAdministrar ? (
        <Button
          size="sm"
          onClick={() => alLigar(candidato.idDesarrollo, candidato.precioSugeridoPedido)}
          disabled={ligar.isPending}
          data-testid="ligar-desarrollo"
        >
          <Link2 aria-hidden />
          Ligar a este desarrollo
        </Button>
      ) : null}
    </div>
  );
}
