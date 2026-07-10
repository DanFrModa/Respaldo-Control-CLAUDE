import {
  BadgeCheck,
  Copy,
  FileSpreadsheet,
  MinusCircle,
  PlusCircle,
  Printer,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
  descargarExcelEstadoCuenta,
  imprimirEstadoCuenta,
  useEstadoCuenta,
  useRevisarMovimiento,
} from '@/api/esma';
import { useExistenciaMaquilero } from '@/api/wip';
import type {
  EsMaConceptoRevisable,
  EsMaEstadoCuentaMovimiento,
  EsMaEstadoCuentaQuery,
} from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSesion } from '@/sesion/useSesion';

import { SaldoMaquilero } from './SaldoMaquilero';
import { SelectorMaquilero, type TipoMaquilero } from './SelectorMaquilero';
import { moneda, type PartidaInicial } from './comun';

/** Etiquetas legibles de cada concepto. */
const ETIQUETA_CONCEPTO: Record<EsMaEstadoCuentaMovimiento['concepto'], string> = {
  cargo: 'Cargo',
  abono: 'Abono',
  descuento: 'Descuento',
  pago: 'Pago',
};

/** Ruta de captura por concepto (para "Agregar" y "Duplicar partida"). */
const RUTA_CAPTURA: Record<EsMaConceptoRevisable, string> = {
  abono: '/esma/abonos',
  descuento: '/esma/descuentos',
  pago: '/esma/pagos',
};

/** ¿El concepto se puede capturar/duplicar/revisar? (los cargos nacen de los recibos, no aquí). */
function esRevisable(
  concepto: EsMaEstadoCuentaMovimiento['concepto'],
): concepto is EsMaConceptoRevisable {
  return concepto !== 'cargo';
}

/**
 * ESTADO DE CUENTA del maquilero (F6-E5, ex `EsMa_EdoCta` — la pantalla central). Selector tipo +
 * maquilero, la línea de tiempo unificada de los 4 conceptos con sus marcas de pendiente, la tarjeta
 * de saldo, botones para agregar cada concepto, "Duplicar partida", accesos al desglosado/PDF/Excel y
 * a las existencias en poder del maquilero. RESPONSIVE: tabla en escritorio, tarjetas en móvil; desde
 * el móvil se puede AUTORIZAR una partida pendiente (revisar, `esma.modificar`).
 *
 * Lectura de cuenta con `esma.ver-pagos` (el backend re-verifica, A1). Importes "—" sin
 * `consultas.ver-importes`. Revisar exige `esma.modificar`.
 */
export function EstadoCuentaPagina(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { tienePermiso } = useSesion();
  const puedeModificar = tienePermiso('esma.modificar');
  const puedePagar = tienePermiso('esma.ver-pagos');
  const verWip = tienePermiso('produccion.wip-ver');

  // Drill-down desde el tablero de saldos: pre-selecciona el maquilero por router state.
  const inicio = (location.state ?? null) as { idMaquilero?: number; tipo?: TipoMaquilero } | null;
  const [tipo, setTipo] = useState<TipoMaquilero>(inicio?.tipo ?? '');
  const [idMaquilero, setIdMaquilero] = useState(
    inicio?.idMaquilero !== undefined ? String(inicio.idMaquilero) : '',
  );
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [conFactura, setConFactura] = useState<'' | 'con' | 'sin'>('');

  const idNum = idMaquilero === '' ? undefined : Number(idMaquilero);
  const filtro: EsMaEstadoCuentaQuery = {
    ...(desde !== '' ? { desde } : {}),
    ...(hasta !== '' ? { hasta } : {}),
    ...(conFactura !== '' ? { conFactura } : {}),
  };
  const estado = useEstadoCuenta(idNum, filtro);
  const revisar = useRevisarMovimiento();

  const movimientos = estado.data?.movimientos ?? [];

  function agregar(concepto: EsMaConceptoRevisable): void {
    if (idNum === undefined) {
      return;
    }
    const inicial: PartidaInicial = { idMaquilero: idNum };
    // navigate() es asíncrono en React Router 7; no necesitamos esperarlo.
    void navigate(RUTA_CAPTURA[concepto], { state: inicial });
  }

  function duplicar(m: EsMaEstadoCuentaMovimiento): void {
    if (!esRevisable(m.concepto) || idNum === undefined) {
      return;
    }
    const inicial: PartidaInicial = {
      idMaquilero: idNum,
      ...(m.monto !== null ? { monto: String(Math.abs(m.monto)) } : {}),
      observaciones: m.referencia,
    };
    void navigate(RUTA_CAPTURA[m.concepto], { state: inicial });
  }

  function autorizar(m: EsMaEstadoCuentaMovimiento): void {
    if (!esRevisable(m.concepto)) {
      return;
    }
    revisar.mutate(
      { concepto: m.concepto, id: m.id },
      {
        onSuccess: () => toast.success('Partida autorizada.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="estado-cuenta">
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Estado de cuenta
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            La cuenta corriente de un maquilero: cargos, abonos, descuentos y pagos por fecha.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Maquilero y periodo</CardTitle>
          <CardDescription>
            Elige el tipo, el maquilero y (opcional) el rango de fechas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <SelectorMaquilero
              tipo={tipo}
              onCambioTipo={(t) => {
                setTipo(t);
                setIdMaquilero('');
              }}
              idMaquilero={idMaquilero}
              onCambioMaquilero={setIdMaquilero}
              idPrefijo="edc"
            />
            <Field>
              <FieldLabel htmlFor="edc-desde">Desde</FieldLabel>
              <Input
                id="edc-desde"
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                data-testid="edc-desde"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="edc-hasta">Hasta</FieldLabel>
              <Input
                id="edc-hasta"
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                data-testid="edc-hasta"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="edc-factura">Facturación</FieldLabel>
              <SelectNativo
                id="edc-factura"
                value={conFactura}
                onChange={(e) => setConFactura(e.target.value as '' | 'con' | 'sin')}
                data-testid="edc-factura"
              >
                <option value="">Todo</option>
                <option value="con">Con factura</option>
                <option value="sin">Sin factura</option>
              </SelectNativo>
            </Field>
          </div>
        </CardContent>
      </Card>

      {idNum === undefined ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Elige un maquilero para ver su estado de cuenta.
        </p>
      ) : (
        <>
          <SaldoMaquilero idMaquilero={idNum} />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => agregar('abono')}
              disabled={!puedeModificar}
              data-testid="edc-agregar-abono"
            >
              <PlusCircle aria-hidden /> Abono
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => agregar('descuento')}
              disabled={!puedeModificar}
              data-testid="edc-agregar-descuento"
            >
              <MinusCircle aria-hidden /> Descuento
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => agregar('pago')}
              disabled={!puedePagar}
              data-testid="edc-agregar-pago"
            >
              <Wallet aria-hidden /> Pago
            </Button>
            <span className="mx-1 hidden h-6 w-px bg-border sm:inline-block" aria-hidden />
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void navigate('/esma/desglosado', { state: { idMaquilero: idNum, tipo } })
              }
              data-testid="edc-ir-desglosado"
            >
              <FileSpreadsheet aria-hidden /> Desglosado
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => imprimirEstadoCuenta(idNum, filtro)}
              data-testid="edc-pdf"
            >
              <Printer aria-hidden /> PDF
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => descargarExcelEstadoCuenta(idNum, filtro)}
              data-testid="edc-excel"
            >
              <FileSpreadsheet aria-hidden /> Excel
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Movimientos</CardTitle>
              <CardDescription>
                Los 4 conceptos por fecha. Las partidas pendientes están marcadas.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {estado.isPending ? (
                <p className="text-sm text-muted-foreground">Cargando…</p>
              ) : estado.isError ? (
                <p className="text-sm text-destructive" role="alert">
                  {estado.error.message}
                </p>
              ) : movimientos.length === 0 ? (
                <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Sin movimientos en el periodo.
                </p>
              ) : (
                <>
                  {/* Móvil: tarjetas. */}
                  <div className="space-y-3 md:hidden" data-testid="edc-tarjetas">
                    {movimientos.map((m) => (
                      <div
                        key={`${m.concepto}-${m.id}`}
                        className="rounded-lg border p-3"
                        data-testid="edc-tarjeta"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{ETIQUETA_CONCEPTO[m.concepto]}</span>
                          <span className="tabular-nums">{moneda(m.monto)}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {m.fecha} · {m.referencia}
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          {m.pendienteRevision ? (
                            <Badge variant="destructive">Pendiente</Badge>
                          ) : (
                            <Badge variant="secondary">Revisado</Badge>
                          )}
                          {puedeModificar && m.pendienteRevision && esRevisable(m.concepto) ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => autorizar(m)}
                              data-testid="edc-autorizar"
                            >
                              <BadgeCheck aria-hidden /> Autorizar
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Escritorio: tabla. */}
                  <div className="hidden overflow-x-auto md:block">
                    <Table data-testid="edc-tabla">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Concepto</TableHead>
                          <TableHead>Referencia</TableHead>
                          <TableHead>Revisión</TableHead>
                          <TableHead className="text-right">Importe</TableHead>
                          <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {movimientos.map((m) => (
                          <TableRow key={`${m.concepto}-${m.id}`} data-testid="edc-fila">
                            <TableCell>{m.fecha}</TableCell>
                            <TableCell>{ETIQUETA_CONCEPTO[m.concepto]}</TableCell>
                            <TableCell className="max-w-xs truncate">{m.referencia}</TableCell>
                            <TableCell>
                              {m.pendienteRevision ? (
                                <Badge variant="destructive">Pendiente</Badge>
                              ) : (
                                <Badge variant="secondary">Revisado</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {moneda(m.monto)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                {esRevisable(m.concepto) ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => duplicar(m)}
                                    disabled={!puedeModificar && m.concepto !== 'pago'}
                                    data-testid="edc-duplicar"
                                  >
                                    <Copy aria-hidden /> Duplicar
                                  </Button>
                                ) : null}
                                {puedeModificar &&
                                m.pendienteRevision &&
                                esRevisable(m.concepto) ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => autorizar(m)}
                                  >
                                    <BadgeCheck aria-hidden /> Autorizar
                                  </Button>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {verWip ? <ExistenciasMaquileroSeccion idMaquilero={idNum} /> : null}
        </>
      )}
    </div>
  );
}

/**
 * Existencias EN PODER del maquilero (enviado − recibido, F3). Componente aparte para que el hook solo
 * se dispare cuando hay maquilero elegido y el usuario tiene `produccion.wip-ver`.
 */
function ExistenciasMaquileroSeccion({ idMaquilero }: { idMaquilero: number }): React.JSX.Element {
  const consulta = useExistenciaMaquilero({ idMaquilero });
  const filas = consulta.data?.filas ?? [];

  return (
    <Card data-testid="edc-existencias">
      <CardHeader>
        <CardTitle>Existencias en poder del maquilero</CardTitle>
        <CardDescription>Piezas enviadas y aún no recibidas (por orden y proceso).</CardDescription>
      </CardHeader>
      <CardContent>
        {consulta.isPending ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : consulta.isError ? (
          <p className="text-sm text-destructive" role="alert">
            {consulta.error.message}
          </p>
        ) : filas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin piezas pendientes de recibir.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Orden</TableHead>
                  <TableHead>Modelo</TableHead>
                  <TableHead>Proceso</TableHead>
                  <TableHead className="text-right">Enviado</TableHead>
                  <TableHead className="text-right">Recibido</TableHead>
                  <TableHead className="text-right">En poder</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((f) => (
                  <TableRow key={`${f.idOrden}-${f.idTipoProceso}`}>
                    <TableCell>#{f.folioOrden}</TableCell>
                    <TableCell>{f.codigoModelo}</TableCell>
                    <TableCell>{f.tipoProceso}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {f.enviado.toLocaleString('es-MX')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {f.recibido.toLocaleString('es-MX')}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {f.enPoder.toLocaleString('es-MX')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
