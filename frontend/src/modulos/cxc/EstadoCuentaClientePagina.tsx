import { Ban, Plus, Printer } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';

import {
  imprimirEstadoCuentaCxc,
  useCancelarMovimientoCxc,
  useEstadoCuentaCliente,
  useRegistrarMovimientoCxc,
} from '@/api/cxc';
import type { CxcEstadoCuentaMovimiento, CxcEstadoCuentaQuery, CxcOrigen } from '@/api/tipos';
import { CajonDetalle } from '@/components/dominio/CajonDetalle';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useSesion } from '@/sesion/useSesion';

import { SelectorCliente } from './SelectorCliente';
import { ETIQUETAS_ORIGEN_CXC, etiquetaOrigen, hoyISO, moneda } from './comun';

/** ¿El renglón se puede cancelar? Solo los del MOTOR, no cancelados ni inversos. */
function esCancelable(m: CxcEstadoCuentaMovimiento): boolean {
  return m.fuente === 'motor' && !m.cancelado && !m.esInverso;
}

/**
 * ESTADO DE CUENTA de un CLIENTE (CxC, F9-E4): selector de cliente + periodo + vista, la línea de tiempo
 * de sus movimientos con su saldo derivado, captura de cobros/abonos/descuentos/NC/cargos y cancelación
 * (inverso auditado). Impreso PDF (R9).
 *
 * Lectura con `cxc.ver` (el backend re-verifica, A1). La vista FISCAL exige `terceros.fiscal`. Capturar
 * y cancelar exigen `cxc.administrar`. Importes en "—" sin `consultas.ver-importes`.
 */
export function EstadoCuentaClientePagina(): React.JSX.Element {
  const location = useLocation();
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('cxc.administrar');
  const puedeFiscal = tienePermiso('terceros.fiscal');

  const inicio = (location.state ?? null) as { idCliente?: number } | null;
  const [idCliente, setIdCliente] = useState<number | null>(inicio?.idCliente ?? null);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [vista, setVista] = useState<'operativa' | 'fiscal'>('operativa');

  const [capturaAbierta, setCapturaAbierta] = useState(false);
  const [movACancelar, setMovACancelar] = useState<CxcEstadoCuentaMovimiento | null>(null);

  const query: CxcEstadoCuentaQuery = {
    vista,
    ...(desde !== '' ? { desde } : {}),
    ...(hasta !== '' ? { hasta } : {}),
  };
  const consulta = useEstadoCuentaCliente(idCliente, query);
  const cuenta = consulta.data;
  const movimientos = cuenta?.movimientos ?? [];

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="cxc-estado-cuenta">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Estado de cuenta del cliente
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Cuenta corriente de un cliente: cargos, cobros, abonos, descuentos y notas de crédito.
          </p>
        </div>
        {idCliente !== null ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => imprimirEstadoCuentaCxc(idCliente, query)}
            data-testid="cxc-edc-pdf"
          >
            <Printer aria-hidden /> PDF
          </Button>
        ) : null}
        {idCliente !== null && puedeAdministrar ? (
          <Button
            type="button"
            size="sm"
            onClick={() => setCapturaAbierta(true)}
            data-testid="cxc-edc-capturar"
          >
            <Plus aria-hidden /> Movimiento
          </Button>
        ) : null}
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Cliente y periodo</CardTitle>
          <CardDescription>Elige el cliente, el rango de fechas y la vista.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field>
              <FieldLabel htmlFor="cxc-edc-cliente-busqueda">Cliente</FieldLabel>
              <SelectorCliente
                idSeleccionado={idCliente ?? undefined}
                alSeleccionar={(c) => setIdCliente(c.id)}
                alLimpiar={() => setIdCliente(null)}
                testid="cxc-edc-cliente"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cxc-edc-desde">Desde</FieldLabel>
              <Input
                id="cxc-edc-desde"
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                data-testid="cxc-edc-desde"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cxc-edc-hasta">Hasta</FieldLabel>
              <Input
                id="cxc-edc-hasta"
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                data-testid="cxc-edc-hasta"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cxc-edc-vista">Vista</FieldLabel>
              <SelectNativo
                id="cxc-edc-vista"
                value={vista}
                onChange={(e) => setVista(e.target.value as 'operativa' | 'fiscal')}
                data-testid="cxc-edc-vista"
              >
                <option value="operativa">Operativa (todo)</option>
                {puedeFiscal ? <option value="fiscal">Fiscal (solo CFDI)</option> : null}
              </SelectNativo>
            </Field>
          </div>
        </CardContent>
      </Card>

      {idCliente === null ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Elige un cliente para ver su estado de cuenta.
        </p>
      ) : (
        <>
          {cuenta ? <SaldoCliente cuenta={cuenta} /> : null}

          <Card>
            <CardHeader>
              <CardTitle>Movimientos</CardTitle>
              <CardDescription>
                Cuenta corriente por fecha. La vista fiscal muestra solo el CFDI.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {consulta.isPending ? (
                <p className="text-sm text-muted-foreground">Cargando…</p>
              ) : consulta.isError ? (
                <p className="text-sm text-destructive" role="alert">
                  {consulta.error.message}
                </p>
              ) : movimientos.length === 0 ? (
                <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Sin movimientos en el periodo.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <TablaDensa data-testid="cxc-edc-tabla">
                    <TablaDensaEncabezado>
                      <TablaDensaFila>
                        <TablaDensaHead>Fecha</TablaDensaHead>
                        <TablaDensaHead>Concepto</TablaDensaHead>
                        <TablaDensaHead>Observaciones</TablaDensaHead>
                        <TablaDensaHead>Vence</TablaDensaHead>
                        <TablaDensaHead>Fiscal</TablaDensaHead>
                        <TablaDensaHead numerica>Importe</TablaDensaHead>
                        {puedeAdministrar ? <TablaDensaHead numerica>Acción</TablaDensaHead> : null}
                      </TablaDensaFila>
                    </TablaDensaEncabezado>
                    <TablaDensaCuerpo>
                      {movimientos.map((m) => (
                        <TablaDensaFila
                          key={`${m.fuente}-${m.id}`}
                          className={m.cancelado ? 'text-muted-foreground line-through' : undefined}
                          data-testid="cxc-edc-fila"
                        >
                          <TablaDensaCelda>{m.fecha}</TablaDensaCelda>
                          <TablaDensaCelda>{etiquetaOrigen(m.origen)}</TablaDensaCelda>
                          <TablaDensaCelda className="max-w-xs truncate">
                            {m.observaciones ?? '—'}
                          </TablaDensaCelda>
                          <TablaDensaCelda>{m.fechaVencimiento ?? '—'}</TablaDensaCelda>
                          <TablaDensaCelda>
                            {m.esFiscal ? (
                              <Badge variant="secondary">Fiscal</Badge>
                            ) : (
                              <span className="text-faint">—</span>
                            )}
                          </TablaDensaCelda>
                          <TablaDensaCelda numerica className="font-medium">
                            {moneda(m.monto)}
                          </TablaDensaCelda>
                          {puedeAdministrar ? (
                            <TablaDensaCelda numerica>
                              {esCancelable(m) ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setMovACancelar(m)}
                                  data-testid="cxc-edc-cancelar"
                                >
                                  <Ban aria-hidden /> Cancelar
                                </Button>
                              ) : null}
                            </TablaDensaCelda>
                          ) : null}
                        </TablaDensaFila>
                      ))}
                    </TablaDensaCuerpo>
                  </TablaDensa>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {idCliente !== null ? (
        <CajonCaptura
          idCliente={idCliente}
          abierto={capturaAbierta}
          alCerrar={() => setCapturaAbierta(false)}
        />
      ) : null}
      <CajonCancelar movimiento={movACancelar} alCerrar={() => setMovACancelar(null)} />
    </div>
  );
}

/** Tarjeta con el saldo derivado del cliente (por cobrar + fiscal). */
function SaldoCliente({
  cuenta,
}: {
  cuenta: NonNullable<ReturnType<typeof useEstadoCuentaCliente>['data']>;
}): React.JSX.Element {
  const s = cuenta.saldo;
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="cxc-edc-saldo">
      <Tarjeta etiqueta="Saldo por cobrar" valor={moneda(s.saldo)} fuerte />
      <Tarjeta etiqueta="Saldo fiscal" valor={moneda(s.saldoFiscal)} />
    </div>
  );
}

/** Una tarjeta de saldo. */
function Tarjeta({
  etiqueta,
  valor,
  fuerte = false,
}: {
  etiqueta: string;
  valor: string;
  fuerte?: boolean;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-card px-3.5 py-3">
      <span className="text-xs font-semibold tracking-[0.04em] text-muted-foreground uppercase">
        {etiqueta}
      </span>
      <p
        className={`num mt-1 ${fuerte ? 'text-[22px] font-bold text-primary' : 'text-lg font-semibold'}`}
      >
        {valor}
      </p>
    </div>
  );
}

/** Cajón de captura de un movimiento de CxC (gated `cxc.administrar` por la pantalla + el backend). */
function CajonCaptura({
  idCliente,
  abierto,
  alCerrar,
}: {
  idCliente: number;
  abierto: boolean;
  alCerrar: () => void;
}): React.JSX.Element {
  const registrar = useRegistrarMovimientoCxc();
  const [origen, setOrigen] = useState<CxcOrigen>('pago');
  const [importe, setImporte] = useState('');
  const [fecha, setFecha] = useState(hoyISO());
  const [esFiscal, setEsFiscal] = useState<'no' | 'si'>('no');
  const [observaciones, setObservaciones] = useState('');

  function enviar(e: React.FormEvent): void {
    e.preventDefault();
    const monto = Number(importe);
    if (!Number.isFinite(monto) || monto <= 0) {
      toast.error('Captura un importe mayor a 0.');
      return;
    }
    registrar.mutate(
      {
        idCliente,
        cuerpo: {
          fecha,
          origen,
          importe: monto,
          esFiscal: esFiscal === 'si',
          ...(observaciones.trim() === '' ? {} : { observaciones: observaciones.trim() }),
        },
      },
      {
        onSuccess: () => {
          toast.success('Movimiento registrado.');
          setImporte('');
          setObservaciones('');
          alCerrar();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <CajonDetalle
      abierto={abierto}
      alCambiarAbierto={(v) => {
        if (!v) alCerrar();
      }}
      titulo="Nuevo movimiento"
      subtitulo="Cobro, abono, descuento, nota de crédito o cargo sin factura"
    >
      <form className="space-y-4" onSubmit={enviar} data-testid="cxc-captura-form">
        <Field>
          <FieldLabel htmlFor="cxc-cap-origen">Tipo</FieldLabel>
          <SelectNativo
            id="cxc-cap-origen"
            value={origen}
            onChange={(e) => setOrigen(e.target.value as CxcOrigen)}
            data-testid="cxc-cap-origen"
          >
            {(Object.keys(ETIQUETAS_ORIGEN_CXC) as CxcOrigen[]).map((o) => (
              <option key={o} value={o}>
                {ETIQUETAS_ORIGEN_CXC[o]}
              </option>
            ))}
          </SelectNativo>
        </Field>
        <Field>
          <FieldLabel htmlFor="cxc-cap-importe">Importe</FieldLabel>
          <Input
            id="cxc-cap-importe"
            type="number"
            min="0.01"
            step="0.01"
            value={importe}
            onChange={(e) => setImporte(e.target.value)}
            data-testid="cxc-cap-importe"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="cxc-cap-fecha">Fecha</FieldLabel>
          <Input
            id="cxc-cap-fecha"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            data-testid="cxc-cap-fecha"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="cxc-cap-fiscal">¿Fiscal (con CFDI)?</FieldLabel>
          <SelectNativo
            id="cxc-cap-fiscal"
            value={esFiscal}
            onChange={(e) => setEsFiscal(e.target.value as 'no' | 'si')}
            data-testid="cxc-cap-fiscal"
          >
            <option value="no">No</option>
            <option value="si">Sí</option>
          </SelectNativo>
        </Field>
        <Field>
          <FieldLabel htmlFor="cxc-cap-obs">Observaciones</FieldLabel>
          <Input
            id="cxc-cap-obs"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            data-testid="cxc-cap-obs"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={alCerrar}>
            Cancelar
          </Button>
          <Button type="submit" disabled={registrar.isPending} data-testid="cxc-cap-guardar">
            Guardar
          </Button>
        </div>
      </form>
    </CajonDetalle>
  );
}

/** Cajón de cancelación (inverso auditado) de un movimiento de CxC. */
function CajonCancelar({
  movimiento,
  alCerrar,
}: {
  movimiento: CxcEstadoCuentaMovimiento | null;
  alCerrar: () => void;
}): React.JSX.Element {
  const cancelar = useCancelarMovimientoCxc();
  const [motivo, setMotivo] = useState('');

  function enviar(e: React.FormEvent): void {
    e.preventDefault();
    if (movimiento === null) {
      return;
    }
    if (motivo.trim() === '') {
      toast.error('El motivo es obligatorio.');
      return;
    }
    cancelar.mutate(
      { idMovimiento: movimiento.id, cuerpo: { motivo: motivo.trim() } },
      {
        onSuccess: () => {
          toast.success('Movimiento cancelado (inverso auditado).');
          setMotivo('');
          alCerrar();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <CajonDetalle
      abierto={movimiento !== null}
      alCambiarAbierto={(v) => {
        if (!v) alCerrar();
      }}
      titulo="Cancelar movimiento"
      subtitulo={
        movimiento
          ? `${etiquetaOrigen(movimiento.origen)} · ${moneda(movimiento.monto)}`
          : undefined
      }
    >
      <form className="space-y-4" onSubmit={enviar} data-testid="cxc-cancelar-form">
        <p className="text-sm text-muted-foreground">
          Se registra el movimiento inverso (nunca se borra, D3). El motivo queda en la bitácora.
        </p>
        <Field>
          <FieldLabel htmlFor="cxc-cancel-motivo">Motivo</FieldLabel>
          <Input
            id="cxc-cancel-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            data-testid="cxc-cancel-motivo"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={alCerrar}>
            Cerrar
          </Button>
          <Button
            type="submit"
            variant="destructive"
            disabled={cancelar.isPending}
            data-testid="cxc-cancel-confirmar"
          >
            Cancelar movimiento
          </Button>
        </div>
      </form>
    </CajonDetalle>
  );
}
