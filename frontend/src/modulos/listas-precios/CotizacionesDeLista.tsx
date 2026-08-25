import { FileText, Loader2Icon, Plus, XCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  imprimirCotizacionPdf,
  useCancelarCotizacion,
  useCotizaciones,
  type CotizacionResumen,
} from '@/api/cotizaciones';
import type { ListaDetalle } from '@/api/listas-precios';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { formatearFecha, formatearMoneda } from '@/lib/formato';
import { useSesion } from '@/sesion/useSesion';

import { DialogoEmitirCotizacion } from './DialogoEmitirCotizacion';

/**
 * Bloque de **COTIZACIONES EMITIDAS** de una lista (V1-E7c, §Post-F9.109): el historial de *qué se le
 * mandó al cliente y cuándo*, con el PDF de cada una y la cancelación con motivo.
 *
 * Es de sólo-lectura por diseño: una cotización **no se edita** (otra vuelta = otra cotización, con
 * todos los modelos) y **no se borra** (D3) — se cancela con motivo y el documento se queda ahí,
 * legible, marcado. Por eso las únicas acciones por renglón son "PDF" y "Cancelar".
 *
 * Permisos: se ve con `listas.ver`; emitir/cancelar exigen `listas.negociar` (quien está en la mesa);
 * el PDF exige además `consultas.ver-importes` (el documento ES precios).
 */
export function CotizacionesDeLista({ lista }: { lista: ListaDetalle }): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeNegociar = tienePermiso('listas.negociar');
  const verImportes = tienePermiso('consultas.ver-importes');

  const consulta = useCotizaciones({ idLista: lista.id });
  const [emitirAbierto, setEmitirAbierto] = useState(false);
  const [aCancelar, setACancelar] = useState<CotizacionResumen | null>(null);

  const cotizaciones = consulta.data ?? [];

  return (
    <section className="shrink-0 rounded-xl border bg-card" data-testid="cotizaciones-de-lista">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-3.5 py-2.5">
        <div className="min-w-0">
          <h2 className="text-[13.5px] font-semibold">Cotizaciones emitidas</h2>
          <p className="text-[12px] text-muted-foreground">
            El documento que se le manda al cliente. Cada emisión congela precios y modelos: no se
            edita — si algo cambia, se emite otra con todos los modelos.
          </p>
        </div>
        {puedeNegociar ? (
          <Button
            type="button"
            size="sm"
            onClick={() => setEmitirAbierto(true)}
            data-testid="emitir-cotizacion"
          >
            <Plus aria-hidden />
            Emitir cotización
          </Button>
        ) : null}
      </header>

      <div className="px-3.5 py-2.5">
        {consulta.isPending ? (
          <p className="text-[12.5px] text-muted-foreground">Cargando cotizaciones…</p>
        ) : consulta.isError ? (
          <p className="text-[12.5px] text-destructive" role="alert">
            {consulta.error.message}
          </p>
        ) : cotizaciones.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            Todavía no se le ha mandado ninguna cotización al cliente por esta lista.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Cotización</TablaDensaHead>
                  <TablaDensaHead>Fecha</TablaDensaHead>
                  <TablaDensaHead numerica>Modelos</TablaDensaHead>
                  <TablaDensaHead numerica>Suma de precios</TablaDensaHead>
                  <TablaDensaHead>Estado</TablaDensaHead>
                  <TablaDensaHead className="text-right" />
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {cotizaciones.map((cotizacion) => (
                  <TablaDensaFila key={cotizacion.id}>
                    <TablaDensaCelda>
                      <span className="font-semibold">#{cotizacion.folio}</span>
                    </TablaDensaCelda>
                    <TablaDensaCelda>{formatearFecha(cotizacion.fecha)}</TablaDensaCelda>
                    <TablaDensaCelda numerica>{cotizacion.totalRenglones}</TablaDensaCelda>
                    <TablaDensaCelda numerica>
                      {cotizacion.total === null ? '—' : formatearMoneda(cotizacion.total)}
                    </TablaDensaCelda>
                    <TablaDensaCelda>
                      <ChipEstado tono={cotizacion.estado === 'cancelada' ? 'crit' : 'ok'}>
                        {cotizacion.estado === 'cancelada' ? 'Cancelada' : 'Emitida'}
                      </ChipEstado>
                    </TablaDensaCelda>
                    <TablaDensaCelda className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {verImportes ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => imprimirCotizacionPdf(cotizacion.id)}
                            data-testid={`cotizacion-pdf-${String(cotizacion.id)}`}
                          >
                            <FileText aria-hidden />
                            PDF
                          </Button>
                        ) : null}
                        {puedeNegociar && cotizacion.estado !== 'cancelada' ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setACancelar(cotizacion)}
                            data-testid={`cancelar-cotizacion-${String(cotizacion.id)}`}
                          >
                            <XCircle aria-hidden />
                            Cancelar
                          </Button>
                        ) : null}
                      </div>
                    </TablaDensaCelda>
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          </div>
        )}
      </div>

      <DialogoEmitirCotizacion
        abierto={emitirAbierto}
        alCambiarAbierto={setEmitirAbierto}
        lista={lista}
      />
      <DialogoCancelarCotizacion cotizacion={aCancelar} alCerrar={() => setACancelar(null)} />
    </section>
  );
}

/**
 * Cancelación de una cotización: **el motivo es obligatorio**. No hay borrado — el documento se
 * conserva íntegro y sólo se le pone el sello de "cancelada" con quién, cuándo y por qué (D3). Lo que
 * se mandó el 12 de marzo se mandó; cancelar dice que ya no está vigente, no que no pasó.
 */
function DialogoCancelarCotizacion({
  cotizacion,
  alCerrar,
}: {
  cotizacion: CotizacionResumen | null;
  alCerrar: () => void;
}): React.JSX.Element {
  const cancelar = useCancelarCotizacion();
  const [motivo, setMotivo] = useState('');

  function confirmar(): void {
    if (cotizacion === null) {
      return;
    }
    cancelar.mutate(
      { id: cotizacion.id, cuerpo: { motivo: motivo.trim() } },
      {
        onSuccess: () => {
          toast.success(`Cotización #${String(cotizacion.folio)} cancelada.`);
          setMotivo('');
          alCerrar();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog
      open={cotizacion !== null}
      onOpenChange={(abierto) => {
        if (!abierto) {
          setMotivo('');
          alCerrar();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar la cotización #{cotizacion?.folio ?? ''}</DialogTitle>
          <DialogDescription>
            El documento NO se borra: queda con su contenido íntegro y marcado como cancelado, con
            el motivo, quién y cuándo. Para ofrecer otra cosa, emite una cotización nueva.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Field>
            <FieldLabel htmlFor="cotizacion-motivo">Motivo de la cancelación</FieldLabel>
            <Input
              id="cotizacion-motivo"
              value={motivo}
              maxLength={500}
              placeholder="Ej. El cliente cambió la curva de tallas"
              disabled={cancelar.isPending}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={alCerrar} disabled={cancelar.isPending}>
            Volver
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={confirmar}
            disabled={cancelar.isPending || motivo.trim().length < 3}
            data-testid="confirmar-cancelar-cotizacion"
          >
            {cancelar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
            Cancelar cotización
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
