import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { Avio } from '@/api/avios';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { SelectorAvio } from './SelectorAvio';

/** Un renglón capturado de avío: avío×cantidad. */
export interface RenglonAvio {
  idAvio: number;
  avio: string;
  descripcion: string;
  cantidad: number;
}

/**
 * CAPTURA DE RENGLONES DE AVÍO (F4-E1). El usuario elige un avío y la cantidad; los renglones se
 * acumulan. Presentación pura (A1): no decide negocio; el backend valida no-negativo. No maneja lote
 * (el inventario de avíos es por avío×almacén, R4). Reusable por ajuste y traspaso de avíos.
 */
export function CapturaRenglonesAvio({
  renglones,
  onChange,
  soloLectura = false,
}: {
  renglones: RenglonAvio[];
  onChange: (renglones: RenglonAvio[]) => void;
  soloLectura?: boolean;
}): React.JSX.Element {
  const [avio, setAvio] = useState<Avio | undefined>(undefined);
  const [cantidad, setCantidad] = useState<string>('');

  function agregar(): void {
    if (avio === undefined || cantidad === '') return;
    const cantidadNum = Number(cantidad);
    if (!Number.isFinite(cantidadNum) || cantidadNum <= 0) return;
    const sinDuplicado = renglones.filter((r) => r.idAvio !== avio.id);
    const existentePrev = renglones.find((r) => r.idAvio === avio.id);
    onChange([
      ...sinDuplicado,
      {
        idAvio: avio.id,
        avio: avio.clave,
        descripcion: avio.descripcion,
        cantidad: cantidadNum + (existentePrev?.cantidad ?? 0),
      },
    ]);
    setCantidad('');
  }

  function quitar(idAvio: number): void {
    onChange(renglones.filter((r) => r.idAvio !== idAvio));
  }

  return (
    <div className="space-y-4" data-testid="captura-renglones-avio">
      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">Agregar renglón</p>
        <SelectorAvio idSeleccionado={avio?.id} alSeleccionar={setAvio} testid="captura-avio" />
        {avio !== undefined ? (
          <Field className="max-w-48">
            <FieldLabel htmlFor="captura-avio-cantidad">Cantidad</FieldLabel>
            <Input
              id="captura-avio-cantidad"
              type="number"
              min={0}
              step="any"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              disabled={soloLectura}
              data-testid="captura-avio-cantidad"
            />
          </Field>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          onClick={agregar}
          disabled={soloLectura || avio === undefined || cantidad === ''}
          data-testid="captura-avio-agregar"
        >
          <Plus className="mr-1.5 size-4" aria-hidden /> Agregar
        </Button>
      </div>

      {renglones.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          Aún no hay renglones. Agrega un avío y la cantidad.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border" data-testid="captura-avio-tabla">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Avío</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {renglones.map((r) => (
                <TableRow key={r.idAvio}>
                  <TableCell className="font-medium">{r.avio}</TableCell>
                  <TableCell>{r.descripcion}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.cantidad.toLocaleString('es-MX')}
                  </TableCell>
                  <TableCell className="text-right">
                    {!soloLectura ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => quitar(r.idAvio)}
                        data-testid={`captura-avio-quitar-${r.idAvio}`}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
