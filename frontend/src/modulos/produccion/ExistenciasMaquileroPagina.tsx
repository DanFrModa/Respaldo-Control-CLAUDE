import { Warehouse } from 'lucide-react';
import { useState } from 'react';

import { useExistenciaMaquilero } from '@/api/wip';
import type { ExistenciaMaquileroQuery } from '@/api/tipos';
import { FiltroProveedor } from '@/components/dominio/FiltroProveedor';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
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
 * EXISTENCIAS EN PODER DEL MAQUILERO (F3-E5, form `MaqExis` del viejo): lo que cada maquilero tiene
 * pendiente de devolver = enviado − recibido, por orden y proceso (Σ de etapas, sin acumuladores).
 * Filtro por maquilero. RESPONSIVE: tabla en escritorio, tarjetas en móvil (consultar también es
 * móvil, regla del plan).
 *
 * `produccion.wip-ver` gobierna el acceso a la pantalla. (Esta misma cuenta la reusa EsMa en F6.)
 */
export function ExistenciasMaquileroPagina(): React.JSX.Element {
  const [idMaquilero, setIdMaquilero] = useState<string>(TODOS);
  // Nombre del maquilero filtrado: con búsqueda server-side el combobox sólo conoce su página.
  const [nombreMaquilero, setNombreMaquilero] = useState<string | undefined>(undefined);

  const query: ExistenciaMaquileroQuery = {
    ...(idMaquilero !== TODOS ? { idMaquilero: Number(idMaquilero) } : {}),
  };
  const consulta = useExistenciaMaquilero(query);
  const filas = consulta.data?.filas ?? [];

  return (
    <div
      className="h-full overflow-y-auto space-y-6 p-4 md:p-6"
      data-testid="existencias-maquilero"
    >
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Existencias en poder del maquilero
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Piezas enviadas que el maquilero aún no devuelve (enviado − recibido), por orden y
            proceso.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>Acota por un maquilero.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="maquilero">Maquilero</FieldLabel>
              {/* V1-E7g (§Post-F9.52 punto 7): se busca por CUALQUIER palabra, en el SERVIDOR. El
                  `<select>` de aquí topaba en 100 y sólo dejaba teclear el prefijo. */}
              <FiltroProveedor
                idProveedor={idMaquilero === TODOS ? null : Number(idMaquilero)}
                nombreInicial={nombreMaquilero}
                alCambiar={(maquilero) => {
                  setIdMaquilero(maquilero === null ? TODOS : String(maquilero.id));
                  setNombreMaquilero(maquilero?.nombre);
                }}
                etiqueta="Maquilero"
                placeholder="Todos"
                idInput="maquilero"
                testid="exist-maq-maquilero"
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      {consulta.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {consulta.error.message}
        </p>
      ) : consulta.isPending ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No hay piezas en poder de maquileros para el filtro seleccionado.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Total en poder: <strong>{fmt(consulta.data?.totalEnPoder ?? 0)}</strong> pzas en{' '}
            {filas.length} renglón(es).
          </p>

          {/* Móvil: tarjetas apiladas. */}
          <div className="space-y-3 md:hidden" data-testid="exist-maq-tarjetas">
            {filas.map((f) => (
              <Card key={`${f.idMaquilero ?? 'sin'}-${f.idTipoProceso}-${f.idOrden}`}>
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium">{f.maquilero}</p>
                    <p className="text-xs text-muted-foreground">
                      #{f.folioOrden} · {f.codigoModelo} · {f.tipoProceso}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fmt(f.enviado)} enviadas · {fmt(f.recibido)} recibidas
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-right">
                    <Warehouse className="size-4 text-muted-foreground" aria-hidden />
                    <span className="text-lg font-semibold tabular-nums">{fmt(f.enPoder)}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Escritorio: tabla. */}
          <div
            className="hidden overflow-x-auto rounded-md border md:block"
            data-testid="exist-maq-tabla"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Maquilero</TableHead>
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
                  <TableRow key={`${f.idMaquilero ?? 'sin'}-${f.idTipoProceso}-${f.idOrden}`}>
                    <TableCell className="font-medium">{f.maquilero}</TableCell>
                    <TableCell>#{f.folioOrden}</TableCell>
                    <TableCell>{f.codigoModelo}</TableCell>
                    <TableCell>{f.tipoProceso}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(f.enviado)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(f.recibido)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {fmt(f.enPoder)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
