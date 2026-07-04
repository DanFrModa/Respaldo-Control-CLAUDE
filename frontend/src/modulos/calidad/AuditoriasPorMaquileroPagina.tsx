import { Medal, Printer } from 'lucide-react';
import { useState } from 'react';

import { imprimirAuditoria, useHistorialMaquilero } from '@/api/calidad';
import { ETIQUETAS_TIPO_AUDITORIA } from '@/api/esquemas';
import { useProveedores } from '@/api/proveedores';
import type { HistorialMaquileroQuery } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';

import { ResultadoBadge } from './ConsultaAuditoriasPagina';

/**
 * HISTORIAL POR MAQUILERO (F6-E3): elige un maquilero y un rango de fechas → sus auditorías (no
 * canceladas) con el % de APROBACIÓN operativo (aprobadas / calificadas). Con 1 aprobada y 1 reprobada
 * el porcentaje es 50%. `calidad.ver` gobierna la consulta (el backend re-verifica, A1).
 */
export function AuditoriasPorMaquileroPagina(): React.JSX.Element {
  const [idMaquilero, setIdMaquilero] = useState<number | undefined>(undefined);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const proveedores = useProveedores({ pagina: 1, porPagina: 100, ordenarPor: 'nombre' });
  const query: HistorialMaquileroQuery = {
    ...(desde !== '' ? { desde } : {}),
    ...(hasta !== '' ? { hasta } : {}),
  };
  const historial = useHistorialMaquilero(idMaquilero, query);
  const datos = historial.data;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
          <Medal className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Auditorías por maquilero</h1>
          <p className="text-sm text-muted-foreground">
            Historial y porcentaje de aprobación operativo de un maquilero.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>
            Elige el maquilero y, opcionalmente, un rango de fechas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="hist-maquilero">Maquilero</FieldLabel>
              <SelectNativo
                id="hist-maquilero"
                value={idMaquilero === undefined ? '' : String(idMaquilero)}
                onChange={(e) =>
                  setIdMaquilero(e.target.value === '' ? undefined : Number(e.target.value))
                }
                data-testid="historial-maquilero"
              >
                <option value="">Elige un maquilero…</option>
                {(proveedores.data?.datos ?? []).map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="hist-desde">Desde</FieldLabel>
              <Input
                id="hist-desde"
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                data-testid="historial-desde"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="hist-hasta">Hasta</FieldLabel>
              <Input
                id="hist-hasta"
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                data-testid="historial-hasta"
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      {idMaquilero === undefined ? (
        <p className="text-sm text-muted-foreground">
          Selecciona un maquilero para ver su historial.
        </p>
      ) : historial.isPending ? (
        <p className="text-sm text-muted-foreground">Cargando historial…</p>
      ) : historial.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {historial.error.message}
        </p>
      ) : datos !== undefined ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <TarjetaMetrica
              etiqueta="Aprobación"
              valor={
                datos.porcentajeAprobacion === null
                  ? 'N/D'
                  : `${datos.porcentajeAprobacion.toLocaleString('es-MX')}%`
              }
              destacado
              testid="historial-porcentaje"
            />
            <TarjetaMetrica etiqueta="Total (vivas)" valor={String(datos.total)} />
            <TarjetaMetrica etiqueta="Aprobadas" valor={String(datos.aprobadas)} />
            <TarjetaMetrica
              etiqueta="Reprobadas / sin calificar"
              valor={`${datos.reprobadas} / ${datos.noCalificadas}`}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Auditorías de {datos.maquilero}</CardTitle>
              <CardDescription>
                {datos.total === 0
                  ? 'Sin auditorías en el rango elegido.'
                  : `${datos.total} auditoría(s) viva(s).`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="historial-tabla">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-2">No.</th>
                      <th className="py-2 pr-2">Orden</th>
                      <th className="py-2 pr-2">Fecha</th>
                      <th className="py-2 pr-2">Tipo</th>
                      <th className="py-2 pr-2">Resultado</th>
                      <th className="py-2 pr-2 text-right">Fallas</th>
                      <th className="py-2 pr-2 text-right">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.auditorias.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-3 text-muted-foreground">
                          Sin auditorías.
                        </td>
                      </tr>
                    ) : (
                      datos.auditorias.map((a) => (
                        <tr key={a.id} className="border-b" data-testid="historial-fila">
                          <td className="py-1.5 pr-2 font-medium">#{a.numAuditoria}</td>
                          <td className="py-1.5 pr-2">
                            {a.folioOrden === null ? '—' : `#${a.folioOrden}`}
                          </td>
                          <td className="py-1.5 pr-2">{a.fechaAuditoria}</td>
                          <td className="py-1.5 pr-2">
                            {ETIQUETAS_TIPO_AUDITORIA[a.tipoAuditoria]}
                          </td>
                          <td className="py-1.5 pr-2">
                            <ResultadoBadge resultado={a.resultado} />
                          </td>
                          <td className="py-1.5 pr-2 text-right">{a.totalFallas}</td>
                          <td className="py-1.5 pr-2 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => imprimirAuditoria(a.id)}
                              aria-label={`Imprimir auditoría ${a.numAuditoria}`}
                            >
                              <Printer aria-hidden />
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

/** Tarjeta de una métrica del historial (etiqueta + valor grande). */
function TarjetaMetrica({
  etiqueta,
  valor,
  destacado = false,
  testid,
}: {
  etiqueta: string;
  valor: string;
  destacado?: boolean;
  testid?: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-muted/30 p-3" data-testid={testid}>
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className={destacado ? 'text-2xl font-semibold text-primary' : 'text-2xl font-semibold'}>
        {valor}
      </p>
    </div>
  );
}
