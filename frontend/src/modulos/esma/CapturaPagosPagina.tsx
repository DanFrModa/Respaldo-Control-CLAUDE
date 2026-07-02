import { Loader2Icon, Printer, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { imprimirPagoEsMa, useCargosEsMa, useCrearPagoEsMa } from '@/api/esma';
import { useProveedores } from '@/api/proveedores';
import type { CargosEsMaQuery } from '@/api/tipos';
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
import { moneda } from './comun';

/** Fecha de hoy en formato YYYY-MM-DD. */
function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * CAPTURA DE PAGOS a un maquilero (F6-E4, decisión g "prendas por pagar"): se elige el maquilero,
 * se listan sus cargos VALIDADOS con saldo por pagar y se cubre una cantidad de prendas de cada uno.
 * El backend deriva el importe y BLOQUEA el doble pago (el error se refleja en un toast). Al guardar,
 * se ofrece imprimir el recibo de pago (PDF, R9).
 *
 * `esma.ver-pagos` gobierna pagar y la lectura de cuenta (el backend re-verifica, A1). Los importes se
 * ocultan sin `consultas.ver-importes` (el backend los devuelve en `null` → "—").
 */
export function CapturaPagosPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedePagar = tienePermiso('esma.ver-pagos');

  const [idMaquilero, setIdMaquilero] = useState<string>('');
  const [fecha, setFecha] = useState(hoyISO());
  const [conFactura, setConFactura] = useState<'' | 'con' | 'sin'>('');
  const [observaciones, setObservaciones] = useState('');
  // Cargos seleccionados: idCargo → cantidad (texto). La presencia de la clave = incluido.
  const [seleccion, setSeleccion] = useState<Record<number, string>>({});
  const [pagoImpreso, setPagoImpreso] = useState<number | null>(null);

  const maquileros = useProveedores({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });

  const idNum = idMaquilero === '' ? undefined : Number(idMaquilero);

  const query: CargosEsMaQuery = {
    estado: 'validado',
    ...(idNum !== undefined ? { idMaquilero: idNum } : {}),
  };
  const cargos = useCargosEsMa(query, { enabled: idNum !== undefined });
  // Pagables = cargos validados, con costo y con prendas por pagar.
  const pagables = useMemo(
    () => (cargos.data?.filas ?? []).filter((c) => !c.sinCosto && c.porPagar > 0),
    [cargos.data],
  );

  const crear = useCrearPagoEsMa();

  const aplicaciones = Object.entries(seleccion)
    .map(([id, cant]) => ({ idCargo: Number(id), cantidad: Number(cant) }))
    .filter((a) => Number.isFinite(a.cantidad) && a.cantidad > 0);
  const hayInvalidos = Object.values(seleccion).some(
    (c) => c.trim() === '' || !Number.isFinite(Number(c)) || Number(c) <= 0,
  );
  const puedeGuardar =
    puedePagar && idNum !== undefined && aplicaciones.length > 0 && !hayInvalidos && fecha !== '';

  function alternar(idCargo: number, porPagar: number): void {
    setSeleccion((prev) => {
      const copia = { ...prev };
      if (idCargo in copia) {
        delete copia[idCargo];
      } else {
        copia[idCargo] = String(porPagar);
      }
      return copia;
    });
  }

  function ajustarCantidad(idCargo: number, valor: string): void {
    setSeleccion((prev) => ({ ...prev, [idCargo]: valor }));
  }

  function limpiar(): void {
    setSeleccion({});
    setObservaciones('');
  }

  function guardar(): void {
    if (!puedeGuardar || idNum === undefined) {
      return;
    }
    setPagoImpreso(null);
    crear.mutate(
      {
        idMaquilero: idNum,
        fecha,
        aplicaciones,
        ...(conFactura !== '' ? { conFactura: conFactura === 'con' } : {}),
        ...(observaciones.trim().length > 0 ? { observaciones: observaciones.trim() } : {}),
      },
      {
        onSuccess: (pago) => {
          toast.success(`Pago registrado a ${pago.maquilero}.`);
          setPagoImpreso(pago.id);
          limpiar();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="captura-pagos">
      <header className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-sidebar-accent/40 text-sidebar-accent-foreground">
          <Wallet className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Pagos a maquileros</h1>
          <p className="text-sm text-muted-foreground">
            Paga cargos validados (prendas por pagar) e imprime el recibo del pago.
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Datos del pago</CardTitle>
          <CardDescription>Elige el maquilero, la fecha y la facturación.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field>
              <FieldLabel htmlFor="pago-maquilero">Maquilero</FieldLabel>
              <SelectNativo
                id="pago-maquilero"
                value={idMaquilero}
                onChange={(e) => {
                  setIdMaquilero(e.target.value);
                  setSeleccion({});
                  setPagoImpreso(null);
                }}
                data-testid="pago-maquilero"
              >
                <option value="">Elige un maquilero…</option>
                {(maquileros.data?.datos ?? []).map((m) => (
                  <option key={m.id} value={String(m.id)}>
                    {m.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="pago-fecha">Fecha</FieldLabel>
              <Input
                id="pago-fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                data-testid="pago-fecha"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="pago-con-factura">Facturación</FieldLabel>
              <SelectNativo
                id="pago-con-factura"
                value={conFactura}
                onChange={(e) => setConFactura(e.target.value as '' | 'con' | 'sin')}
                data-testid="pago-con-factura"
              >
                <option value="">Según proveedor</option>
                <option value="con">Con factura</option>
                <option value="sin">Sin factura</option>
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="pago-obs">Observaciones</FieldLabel>
              <Input
                id="pago-obs"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Opcional"
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      {idNum !== undefined ? <SaldoMaquilero idMaquilero={idNum} /> : null}

      {idNum === undefined ? (
        <p className="text-sm text-muted-foreground">
          Selecciona un maquilero para ver sus cargos por pagar.
        </p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Cargos por pagar</CardTitle>
            <CardDescription>
              Marca los cargos y ajusta cuántas prendas cubre este pago.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {cargos.isPending ? (
              <p className="text-sm text-muted-foreground">Cargando cargos…</p>
            ) : cargos.isError ? (
              <p className="text-sm text-destructive" role="alert">
                {cargos.error.message}
              </p>
            ) : pagables.length === 0 ? (
              <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                Este maquilero no tiene cargos con prendas por pagar.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table data-testid="pago-cargos-tabla">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>Orden</TableHead>
                      <TableHead>Proceso</TableHead>
                      <TableHead className="text-right">Por pagar</TableHead>
                      <TableHead className="text-right">Precio</TableHead>
                      <TableHead className="text-right">A pagar (pzas)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagables.map((c) => {
                      const incluido = c.id in seleccion;
                      return (
                        <TableRow key={c.id} data-testid="pago-cargo-fila">
                          <TableCell>
                            <input
                              type="checkbox"
                              className="size-4"
                              checked={incluido}
                              onChange={() => alternar(c.id, c.porPagar)}
                              aria-label={`Incluir cargo ${String(c.id)}`}
                              data-testid={`pago-cargo-check-${String(c.id)}`}
                            />
                          </TableCell>
                          <TableCell>#{c.folioOrden}</TableCell>
                          <TableCell>{c.tipoProceso}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {c.porPagar.toLocaleString('es-MX')}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {moneda(c.precioReal)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={1}
                              max={c.porPagar}
                              step="1"
                              className="ml-auto w-24 text-right"
                              value={seleccion[c.id] ?? ''}
                              disabled={!incluido}
                              onChange={(e) => ajustarCantidad(c.id, e.target.value)}
                              data-testid={`pago-cargo-cant-${String(c.id)}`}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              {pagoImpreso !== null ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => imprimirPagoEsMa(pagoImpreso)}
                  data-testid="pago-imprimir"
                >
                  <Printer aria-hidden /> Imprimir recibo
                </Button>
              ) : null}
              <Button
                type="button"
                onClick={guardar}
                disabled={!puedeGuardar || crear.isPending}
                data-testid="pago-guardar"
              >
                {crear.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
                Registrar pago
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
