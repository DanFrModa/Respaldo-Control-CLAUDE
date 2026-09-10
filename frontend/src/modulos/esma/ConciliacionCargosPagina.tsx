import { useState } from 'react';

import { useConciliacionEsMa } from '@/api/esma';
import type { EsMaConciliacionQuery } from '@/api/tipos';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import { ComboboxMaquilero } from './SelectorMaquilero';

/** Formatea un entero con separadores de miles (es-MX). */
function fmt(n: number): string {
  return n.toLocaleString('es-MX');
}

/**
 * Marca DISCRETA del renglón cuyos recibos trajeron sólo prendas incompletas (`soloIncompletas`,
 * derivado en el servidor). `outline` a propósito: no es un error ni un pendiente, es la razón por
 * la que ese grupo no generó cargo. El `title` lleva la explicación completa sin ocupar la fila, y
 * dice LO MISMO que el `.describe()` del contrato — ni una palabra de más.
 */
function MarcaSoloIncompletas(): React.JSX.Element {
  return (
    <Badge
      variant="outline"
      className="font-normal text-muted-foreground"
      title="Todos los recibos vivos de este grupo trajeron solo prendas incompletas: no se producen ni se pagan, así que esos recibos no generaron cargo a EsMa."
      data-testid="conc-solo-incompletas"
    >
      Solo incompletas
    </Badge>
  );
}

/**
 * CONCILIACIÓN DE CARGOS EsMa (F6-E4): cuadra por orden+maquilero+proceso lo RECIBIDO de maquila vs
 * lo YA CARGADO a EsMa, resaltando lo que FALTA por cargar; abajo, los cargos sin recibo ligado.
 * Filtros al servidor (rango de fechas + maquilero) y un filtro local "solo con faltante". RESPONSIVE:
 * tabla en escritorio, tarjetas en móvil.
 *
 * ⭐ PRENDAS INCOMPLETAS (V1-E8k, §Post-F9.136). Un grupo cuyos recibos vivos trajeron SÓLO prendas
 * incompletas llega con `recibido` 0 (no se pagan → esos recibos no generaron cargo) y aun así
 * conserva su renglón: es la única huella que esa entrega deja aquí, así que NO se esconde ni por
 * default ni con un filtro nuevo (quien no lo quiera ver ya tiene "Solo con faltante por cargar").
 * Para que no se lea como una fila de ceros sin sentido, se pinta la columna «Incompletas» y una
 * marca DISCRETA —no una alarma: esto no es un error—. Las dos cosas las manda el servidor
 * (`incompletas`, `soloIncompletas`): aquí no se deduce la regla (A1).
 * ⚠️ La marca NO promete que el renglón cuadre: un cargo validado sin recibo (histórico o manual)
 * del mismo grupo entra en `cargado` y puede dejar «Falta por cargar» en negativo.
 *
 * `esma.ver-pagos` gobierna la lectura de cuenta (el backend re-verifica, A1). Solo maneja CANTIDADES
 * (no importes), así que no aplica el ocultamiento por `consultas.ver-importes`.
 */
export function ConciliacionCargosPagina(): React.JSX.Element {
  const [idMaquilero, setIdMaquilero] = useState<string>('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [soloFaltantes, setSoloFaltantes] = useState(false);
  const [pagadas, setPagadas] = useState<'todas' | 'pagadas' | 'no-pagadas'>('todas');

  const query: EsMaConciliacionQuery = {
    ...(desde !== '' ? { desde } : {}),
    ...(hasta !== '' ? { hasta } : {}),
    ...(idMaquilero !== '' ? { idMaquilero: Number(idMaquilero) } : {}),
    ...(pagadas !== 'todas' ? { pagadas } : {}),
  };
  const consulta = useConciliacionEsMa(query);
  const datos = consulta.data;

  const filas = (datos?.filas ?? []).filter((f) => !soloFaltantes || f.faltantePorCargar > 0);
  const cargosSinRecibo = datos?.cargosSinRecibo ?? [];

  return (
    <div className="h-full overflow-y-auto space-y-6 p-4 md:p-6" data-testid="conciliacion-esma">
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Conciliación de cargos
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Lo recibido de maquila contra lo ya cargado a EsMa, por orden, maquilero y proceso.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>Acota por rango de fechas y maquilero.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field>
              <FieldLabel htmlFor="conc-maquilero">Maquilero</FieldLabel>
              <ComboboxMaquilero
                idMaquilero={idMaquilero}
                onCambioMaquilero={setIdMaquilero}
                testid="conc-maquilero"
                placeholder="Todos los maquileros…"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="conc-desde">Desde</FieldLabel>
              <Input
                id="conc-desde"
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                data-testid="conc-desde"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="conc-hasta">Hasta</FieldLabel>
              <Input
                id="conc-hasta"
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                data-testid="conc-hasta"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="conc-pagadas">Pago de la orden</FieldLabel>
              <SelectNativo
                id="conc-pagadas"
                value={pagadas}
                onChange={(e) => setPagadas(e.target.value as 'todas' | 'pagadas' | 'no-pagadas')}
                data-testid="conc-pagadas"
              >
                <option value="todas">Todas</option>
                <option value="pagadas">Solo pagadas</option>
                <option value="no-pagadas">Solo no pagadas</option>
              </SelectNativo>
            </Field>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm" htmlFor="conc-solo-faltantes">
            <input
              id="conc-solo-faltantes"
              type="checkbox"
              className="size-4"
              checked={soloFaltantes}
              onChange={(e) => setSoloFaltantes(e.target.checked)}
              data-testid="conc-solo-faltantes"
            />
            Solo con faltante por cargar
          </label>
        </CardContent>
      </Card>

      {consulta.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {consulta.error.message}
        </p>
      ) : consulta.isPending ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <>
          {datos ? (
            <p className="text-sm text-muted-foreground" data-testid="conc-totales">
              Recibido <strong>{fmt(datos.totales.recibido)}</strong> · cargado{' '}
              <strong>{fmt(datos.totales.cargado)}</strong> · falta por cargar{' '}
              <strong>{fmt(datos.totales.faltantePorCargar)}</strong> · incompletas{' '}
              <strong>{fmt(datos.totales.incompletas)}</strong> · cargos sin recibo{' '}
              <strong>{fmt(datos.totales.numCargosSinRecibo)}</strong>.
            </p>
          ) : null}

          {filas.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No hay renglones que coincidan con el filtro seleccionado.
            </p>
          ) : (
            <>
              {/* Móvil: tarjetas. */}
              <div className="space-y-3 md:hidden" data-testid="conc-tarjetas">
                {filas.map((f) => (
                  <Card key={`${f.idOrden}-${f.idMaquilero ?? 'sin'}-${f.idTipoProceso ?? 'sin'}`}>
                    <CardContent className="space-y-1 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">{f.maquilero}</p>
                        {f.faltantePorCargar > 0 ? (
                          <Badge variant="destructive">Falta {fmt(f.faltantePorCargar)}</Badge>
                        ) : (
                          <Badge variant="secondary">Al día</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Orden #{f.folioOrden} · {f.tipoProceso}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Recibido {fmt(f.recibido)} · cargado {fmt(f.cargado)}
                        {f.incompletas > 0 ? <> · incompletas {fmt(f.incompletas)}</> : null}
                      </p>
                      {f.soloIncompletas ? <MarcaSoloIncompletas /> : null}
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Escritorio: tabla. */}
              <div
                className="hidden overflow-x-auto rounded-md border md:block"
                data-testid="conc-tabla"
              >
                <TablaDensa>
                  <TablaDensaEncabezado>
                    <TablaDensaFila>
                      <TablaDensaHead>Orden</TablaDensaHead>
                      <TablaDensaHead>Maquilero</TablaDensaHead>
                      <TablaDensaHead>Proceso</TablaDensaHead>
                      <TablaDensaHead numerica>Cortado</TablaDensaHead>
                      <TablaDensaHead numerica>Recibido</TablaDensaHead>
                      <TablaDensaHead numerica>Incompletas</TablaDensaHead>
                      <TablaDensaHead numerica>Entregado</TablaDensaHead>
                      <TablaDensaHead numerica>Ya cargado</TablaDensaHead>
                      <TablaDensaHead numerica>Falta por cargar</TablaDensaHead>
                      <TablaDensaHead>Pago</TablaDensaHead>
                    </TablaDensaFila>
                  </TablaDensaEncabezado>
                  <TablaDensaCuerpo>
                    {filas.map((f) => (
                      <TablaDensaFila
                        key={`${f.idOrden}-${f.idMaquilero ?? 'sin'}-${f.idTipoProceso ?? 'sin'}`}
                      >
                        <TablaDensaCelda>#{f.folioOrden}</TablaDensaCelda>
                        <TablaDensaCelda className="font-medium">{f.maquilero}</TablaDensaCelda>
                        <TablaDensaCelda>
                          {f.tipoProceso}
                          {f.soloIncompletas ? (
                            <span className="ml-2 align-middle">
                              <MarcaSoloIncompletas />
                            </span>
                          ) : null}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica>{fmt(f.cortado)}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{fmt(f.recibido)}</TablaDensaCelda>
                        <TablaDensaCelda numerica>
                          {f.incompletas === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            fmt(f.incompletas)
                          )}
                        </TablaDensaCelda>
                        <TablaDensaCelda numerica>{fmt(f.entregado)}</TablaDensaCelda>
                        <TablaDensaCelda numerica>{fmt(f.cargado)}</TablaDensaCelda>
                        <TablaDensaCelda numerica>
                          {f.faltantePorCargar > 0 ? (
                            <span className="font-semibold text-destructive">
                              {fmt(f.faltantePorCargar)}
                            </span>
                          ) : (
                            fmt(f.faltantePorCargar)
                          )}
                        </TablaDensaCelda>
                        <TablaDensaCelda>
                          {f.pagada ? (
                            <Badge variant="secondary">Pagada</Badge>
                          ) : (
                            <Badge variant="outline">Pendiente</Badge>
                          )}
                        </TablaDensaCelda>
                      </TablaDensaFila>
                    ))}
                  </TablaDensaCuerpo>
                </TablaDensa>
              </div>
            </>
          )}

          {cargosSinRecibo.length > 0 ? (
            <Card data-testid="conc-sin-recibo">
              <CardHeader>
                <CardTitle>Cargos sin recibo ligado</CardTitle>
                <CardDescription>
                  Cargos a EsMa que no corresponden a un recibo del periodo (revisar).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <TablaDensa>
                    <TablaDensaEncabezado>
                      <TablaDensaFila>
                        <TablaDensaHead>Cargo</TablaDensaHead>
                        <TablaDensaHead>Orden</TablaDensaHead>
                        <TablaDensaHead>Maquilero</TablaDensaHead>
                        <TablaDensaHead>Proceso</TablaDensaHead>
                        <TablaDensaHead numerica>Cantidad</TablaDensaHead>
                      </TablaDensaFila>
                    </TablaDensaEncabezado>
                    <TablaDensaCuerpo>
                      {cargosSinRecibo.map((c) => (
                        <TablaDensaFila key={c.idCargo}>
                          <TablaDensaCelda>#{c.idCargo}</TablaDensaCelda>
                          <TablaDensaCelda>#{c.folioOrden}</TablaDensaCelda>
                          <TablaDensaCelda className="font-medium">{c.maquilero}</TablaDensaCelda>
                          <TablaDensaCelda>{c.tipoProceso}</TablaDensaCelda>
                          <TablaDensaCelda numerica>
                            {c.cantidad === null ? '—' : fmt(c.cantidad)}
                          </TablaDensaCelda>
                        </TablaDensaFila>
                      ))}
                    </TablaDensaCuerpo>
                  </TablaDensa>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
