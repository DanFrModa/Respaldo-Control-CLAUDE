import { Scale } from 'lucide-react';
import { useState } from 'react';

import { useConciliacionEsMa } from '@/api/esma';
import { useProveedores } from '@/api/proveedores';
import type { EsMaConciliacionQuery } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';
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

/** Valor del filtro de maquilero que significa "todos". */
const TODOS = 'TODOS';

/** Formatea un entero con separadores de miles (es-MX). */
function fmt(n: number): string {
  return n.toLocaleString('es-MX');
}

/**
 * CONCILIACIÓN DE CARGOS EsMa (F6-E4): cuadra por orden+maquilero+proceso lo RECIBIDO de maquila vs
 * lo YA CARGADO a EsMa, resaltando lo que FALTA por cargar; abajo, los cargos sin recibo ligado.
 * Filtros al servidor (rango de fechas + maquilero) y un filtro local "solo con faltante". RESPONSIVE:
 * tabla en escritorio, tarjetas en móvil.
 *
 * `esma.ver-pagos` gobierna la lectura de cuenta (el backend re-verifica, A1). Solo maneja CANTIDADES
 * (no importes), así que no aplica el ocultamiento por `consultas.ver-importes`.
 */
export function ConciliacionCargosPagina(): React.JSX.Element {
  const [idMaquilero, setIdMaquilero] = useState<string>(TODOS);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [soloFaltantes, setSoloFaltantes] = useState(false);

  const maquileros = useProveedores({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });

  const query: EsMaConciliacionQuery = {
    ...(desde !== '' ? { desde } : {}),
    ...(hasta !== '' ? { hasta } : {}),
    ...(idMaquilero !== TODOS ? { idMaquilero: Number(idMaquilero) } : {}),
  };
  const consulta = useConciliacionEsMa(query);
  const datos = consulta.data;

  const filas = (datos?.filas ?? []).filter((f) => !soloFaltantes || f.faltantePorCargar > 0);
  const cargosSinRecibo = datos?.cargosSinRecibo ?? [];

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="conciliacion-esma">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
          <Scale className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Conciliación de cargos</h1>
          <p className="text-sm text-muted-foreground">
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
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="conc-maquilero">Maquilero</FieldLabel>
              <SelectNativo
                id="conc-maquilero"
                value={idMaquilero}
                onChange={(e) => setIdMaquilero(e.target.value)}
                data-testid="conc-maquilero"
              >
                <option value={TODOS}>Todos</option>
                {(maquileros.data?.datos ?? []).map((m) => (
                  <option key={m.id} value={String(m.id)}>
                    {m.nombre}
                  </option>
                ))}
              </SelectNativo>
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
              <strong>{fmt(datos.totales.faltantePorCargar)}</strong> · cargos sin recibo{' '}
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
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Escritorio: tabla. */}
              <div
                className="hidden overflow-x-auto rounded-md border md:block"
                data-testid="conc-tabla"
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Orden</TableHead>
                      <TableHead>Maquilero</TableHead>
                      <TableHead>Proceso</TableHead>
                      <TableHead className="text-right">Recibido</TableHead>
                      <TableHead className="text-right">Ya cargado</TableHead>
                      <TableHead className="text-right">Falta por cargar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filas.map((f) => (
                      <TableRow
                        key={`${f.idOrden}-${f.idMaquilero ?? 'sin'}-${f.idTipoProceso ?? 'sin'}`}
                      >
                        <TableCell>#{f.folioOrden}</TableCell>
                        <TableCell className="font-medium">{f.maquilero}</TableCell>
                        <TableCell>{f.tipoProceso}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(f.recibido)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(f.cargado)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {f.faltantePorCargar > 0 ? (
                            <span className="font-semibold text-destructive">
                              {fmt(f.faltantePorCargar)}
                            </span>
                          ) : (
                            fmt(f.faltantePorCargar)
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cargo</TableHead>
                        <TableHead>Orden</TableHead>
                        <TableHead>Maquilero</TableHead>
                        <TableHead>Proceso</TableHead>
                        <TableHead className="text-right">Cantidad</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cargosSinRecibo.map((c) => (
                        <TableRow key={c.idCargo}>
                          <TableCell>#{c.idCargo}</TableCell>
                          <TableCell>#{c.folioOrden}</TableCell>
                          <TableCell className="font-medium">{c.maquilero}</TableCell>
                          <TableCell>{c.tipoProceso}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {c.cantidad === null ? '—' : fmt(c.cantidad)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
