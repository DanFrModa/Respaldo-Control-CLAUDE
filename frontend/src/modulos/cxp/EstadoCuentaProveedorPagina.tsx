import { Ban, Plus, Printer } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';

import {
  imprimirEstadoCuentaCxp,
  useCancelarMovimientoCxp,
  useEstadoCuentaProveedor,
  useRegistrarMovimientoCxp,
} from '@/api/cxp';
import type { CxpEstadoCuentaMovimiento, CxpEstadoCuentaQuery, CxpOrigen } from '@/api/tipos';
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

import { SelectorProveedor } from './SelectorProveedor';
import { ETIQUETAS_ORIGEN_CXP, etiquetaOrigen, hoyISO, moneda } from './comun';

/** ¿El renglón se puede cancelar? Solo los del MOTOR, no cancelados ni inversos (los EsMa no aquí). */
function esCancelable(m: CxpEstadoCuentaMovimiento): boolean {
  return m.fuente === 'motor' && !m.cancelado && !m.esInverso;
}

/**
 * ESTADO DE CUENTA de un PROVEEDOR (CxP, F9-E2): selector de proveedor + periodo + vista, la línea de
 * tiempo de sus movimientos (motor + convivencia EsMa) con su saldo derivado, captura de
 * pagos/abonos/descuentos/NC/entradas y cancelación (inverso auditado). Impreso PDF (R9).
 *
 * Lectura con `cxp.ver` (el backend re-verifica, A1). La vista FISCAL exige `terceros.fiscal`. Capturar
 * y cancelar exigen `cxp.administrar`. Importes en "—" sin `consultas.ver-importes`.
 */
export function EstadoCuentaProveedorPagina(): React.JSX.Element {
  const location = useLocation();
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('cxp.administrar');
  const puedeFiscal = tienePermiso('terceros.fiscal');

  const inicio = (location.state ?? null) as { idProveedor?: number } | null;
  const [idProveedor, setIdProveedor] = useState<number | null>(inicio?.idProveedor ?? null);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [vista, setVista] = useState<'operativa' | 'fiscal'>('operativa');
  // §Post-F9.57: el segmento CON/SIN factura es OPERATIVO (no exige `terceros.fiscal`, a diferencia
  // de la vista fiscal). Daniel: *"hay proveedores de avíos o de telas que puede pasar que algunas
  // cosas sean con factura y otras sin factura"*.
  const [segmento, setSegmento] = useState<'todos' | 'con' | 'sin'>('todos');
  const [pagina, setPagina] = useState(1);

  const [capturaAbierta, setCapturaAbierta] = useState(false);
  const [movACancelar, setMovACancelar] = useState<CxpEstadoCuentaMovimiento | null>(null);

  // Cambiar de proveedor, periodo o vista siempre vuelve a la página 1 (si no, se pediría una página
  // fuera de rango del proveedor nuevo → tabla vacía).
  function reiniciarPagina(): void {
    setPagina(1);
  }

  // Los filtros (sin paginación) alimentan el PDF (que igual imprime hasta 100 movimientos).
  const query: CxpEstadoCuentaQuery = {
    vista,
    segmento,
    ...(desde !== '' ? { desde } : {}),
    ...(hasta !== '' ? { hasta } : {}),
  };
  const consulta = useEstadoCuentaProveedor(idProveedor, { ...query, pagina });
  const cuenta = consulta.data;
  const movimientos = cuenta?.movimientos ?? [];

  return (
    <div className="h-full overflow-y-auto space-y-6 p-4 md:p-6" data-testid="cxp-estado-cuenta">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Estado de cuenta del proveedor
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Cuenta corriente de un proveedor: cargos, pagos, abonos, descuentos y notas de crédito.
          </p>
        </div>
        {idProveedor !== null ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => imprimirEstadoCuentaCxp(idProveedor, query)}
            data-testid="cxp-edc-pdf"
          >
            <Printer aria-hidden /> PDF
          </Button>
        ) : null}
        {idProveedor !== null && puedeAdministrar ? (
          <Button
            type="button"
            size="sm"
            onClick={() => setCapturaAbierta(true)}
            data-testid="cxp-edc-capturar"
          >
            <Plus aria-hidden /> Movimiento
          </Button>
        ) : null}
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Proveedor y periodo</CardTitle>
          <CardDescription>Elige el proveedor, el rango de fechas y la vista.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field>
              <FieldLabel htmlFor="cxp-edc-proveedor-busqueda">Proveedor</FieldLabel>
              <SelectorProveedor
                idSeleccionado={idProveedor ?? undefined}
                nombreSeleccionado={cuenta?.tercero}
                alSeleccionar={(p) => {
                  setIdProveedor(p.id);
                  reiniciarPagina();
                }}
                alLimpiar={() => {
                  setIdProveedor(null);
                  reiniciarPagina();
                }}
                testid="cxp-edc-proveedor"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cxp-edc-desde">Desde</FieldLabel>
              <Input
                id="cxp-edc-desde"
                type="date"
                value={desde}
                onChange={(e) => {
                  setDesde(e.target.value);
                  reiniciarPagina();
                }}
                data-testid="cxp-edc-desde"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cxp-edc-hasta">Hasta</FieldLabel>
              <Input
                id="cxp-edc-hasta"
                type="date"
                value={hasta}
                onChange={(e) => {
                  setHasta(e.target.value);
                  reiniciarPagina();
                }}
                data-testid="cxp-edc-hasta"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cxp-edc-vista">Vista</FieldLabel>
              <SelectNativo
                id="cxp-edc-vista"
                value={vista}
                onChange={(e) => {
                  setVista(e.target.value as 'operativa' | 'fiscal');
                  reiniciarPagina();
                }}
                data-testid="cxp-edc-vista"
              >
                <option value="operativa">Operativa (todo)</option>
                {puedeFiscal ? <option value="fiscal">Fiscal (solo CFDI)</option> : null}
              </SelectNativo>
            </Field>
            {/* La vista fiscal YA es "solo con factura": combinarla con el segmento sería
                contradictorio (el backend lo rechaza), así que el selector solo sale en operativa. */}
            {vista === 'operativa' ? (
              <Field>
                <FieldLabel htmlFor="cxp-edc-segmento">Facturación</FieldLabel>
                <SelectNativo
                  id="cxp-edc-segmento"
                  value={segmento}
                  onChange={(e) => {
                    setSegmento(e.target.value as 'todos' | 'con' | 'sin');
                    reiniciarPagina();
                  }}
                  data-testid="cxp-edc-segmento"
                >
                  <option value="todos">Con y sin factura</option>
                  <option value="con">Solo con factura</option>
                  <option value="sin">Solo sin factura</option>
                </SelectNativo>
              </Field>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {idProveedor === null ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Elige un proveedor para ver su estado de cuenta.
        </p>
      ) : (
        <>
          {cuenta ? <SaldoProveedor cuenta={cuenta} /> : null}

          <Card>
            <CardHeader>
              <CardTitle>Movimientos</CardTitle>
              <CardDescription>
                Motor de cuenta corriente + maquila (EsMa), por fecha. La vista fiscal muestra solo
                el CFDI.
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
                  <TablaDensa data-testid="cxp-edc-tabla">
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
                          data-testid="cxp-edc-fila"
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
                                  data-testid="cxp-edc-cancelar"
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

              {/* ── Paginación de movimientos (el motor pagina; sin esto solo se veía la 1ª página) ── */}
              {cuenta && cuenta.totalPaginas > 1 ? (
                <div className="mt-3 flex items-center justify-end gap-2 border-t pt-3 text-xs">
                  <span className="text-faint">
                    Página {cuenta.pagina} de {cuenta.totalPaginas} · {cuenta.total} movimientos
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={cuenta.pagina <= 1}
                    onClick={() => setPagina((p) => Math.max(1, p - 1))}
                    data-testid="cxp-mov-anterior"
                  >
                    Anterior
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={cuenta.pagina >= cuenta.totalPaginas}
                    onClick={() => setPagina((p) => p + 1)}
                    data-testid="cxp-mov-siguiente"
                  >
                    Siguiente
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}

      {idProveedor !== null ? (
        <CajonCaptura
          idProveedor={idProveedor}
          abierto={capturaAbierta}
          alCerrar={() => setCapturaAbierta(false)}
        />
      ) : null}
      <CajonCancelar movimiento={movACancelar} alCerrar={() => setMovACancelar(null)} />
    </div>
  );
}

/** Tarjeta con el saldo derivado del proveedor (operativo + fiscal + maquila si aplica). */
function SaldoProveedor({
  cuenta,
}: {
  cuenta: NonNullable<ReturnType<typeof useEstadoCuentaProveedor>['data']>;
}): React.JSX.Element {
  const s = cuenta.saldo;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="cxp-edc-saldo">
      <Tarjeta etiqueta="Saldo por pagar" valor={moneda(s.saldo)} fuerte />
      {/* §Post-F9.57: el saldo partido en dos. Los dos segmentos SUMAN el total. */}
      <Tarjeta etiqueta="Con factura" valor={moneda(s.saldoFiscal)} />
      <Tarjeta etiqueta="Sin factura" valor={moneda(s.saldoSinFactura)} />
      <Tarjeta etiqueta="Motor (CxP)" valor={moneda(s.saldoMovimientos)} />
      {s.incluyeEsMa ? <Tarjeta etiqueta="Maquila (EsMa)" valor={moneda(s.saldoEsMa)} /> : null}
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

/** Cajón de captura de un movimiento de CxP (gated `cxp.administrar` por la pantalla + el backend). */
function CajonCaptura({
  idProveedor,
  abierto,
  alCerrar,
}: {
  idProveedor: number;
  abierto: boolean;
  alCerrar: () => void;
}): React.JSX.Element {
  const registrar = useRegistrarMovimientoCxp();
  const [origen, setOrigen] = useState<CxpOrigen>('pago');
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
        idProveedor,
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
      subtitulo="Pago, abono, descuento, nota de crédito o entrada sin factura"
    >
      <form className="space-y-4" onSubmit={enviar} data-testid="cxp-captura-form">
        <Field>
          <FieldLabel htmlFor="cxp-cap-origen">Tipo</FieldLabel>
          <SelectNativo
            id="cxp-cap-origen"
            value={origen}
            onChange={(e) => setOrigen(e.target.value as CxpOrigen)}
            data-testid="cxp-cap-origen"
          >
            {(Object.keys(ETIQUETAS_ORIGEN_CXP) as CxpOrigen[]).map((o) => (
              <option key={o} value={o}>
                {ETIQUETAS_ORIGEN_CXP[o]}
              </option>
            ))}
          </SelectNativo>
        </Field>
        <Field>
          <FieldLabel htmlFor="cxp-cap-importe">Importe</FieldLabel>
          <Input
            id="cxp-cap-importe"
            type="number"
            min="0.01"
            step="0.01"
            value={importe}
            onChange={(e) => setImporte(e.target.value)}
            data-testid="cxp-cap-importe"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="cxp-cap-fecha">Fecha</FieldLabel>
          <Input
            id="cxp-cap-fecha"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            data-testid="cxp-cap-fecha"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="cxp-cap-fiscal">¿Fiscal (con CFDI)?</FieldLabel>
          <SelectNativo
            id="cxp-cap-fiscal"
            value={esFiscal}
            onChange={(e) => setEsFiscal(e.target.value as 'no' | 'si')}
            data-testid="cxp-cap-fiscal"
          >
            <option value="no">No</option>
            <option value="si">Sí</option>
          </SelectNativo>
        </Field>
        <Field>
          <FieldLabel htmlFor="cxp-cap-obs">Observaciones</FieldLabel>
          <Input
            id="cxp-cap-obs"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            data-testid="cxp-cap-obs"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={alCerrar}>
            Cancelar
          </Button>
          <Button type="submit" disabled={registrar.isPending} data-testid="cxp-cap-guardar">
            Guardar
          </Button>
        </div>
      </form>
    </CajonDetalle>
  );
}

/** Cajón de cancelación (inverso auditado) de un movimiento de CxP. */
function CajonCancelar({
  movimiento,
  alCerrar,
}: {
  movimiento: CxpEstadoCuentaMovimiento | null;
  alCerrar: () => void;
}): React.JSX.Element {
  const cancelar = useCancelarMovimientoCxp();
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
      <form className="space-y-4" onSubmit={enviar} data-testid="cxp-cancelar-form">
        <p className="text-sm text-muted-foreground">
          Se registra el movimiento inverso (nunca se borra, D3). El motivo queda en la bitácora.
        </p>
        <Field>
          <FieldLabel htmlFor="cxp-cancel-motivo">Motivo</FieldLabel>
          <Input
            id="cxp-cancel-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            data-testid="cxp-cancel-motivo"
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
            data-testid="cxp-cancel-confirmar"
          >
            Cancelar movimiento
          </Button>
        </div>
      </form>
    </CajonDetalle>
  );
}
