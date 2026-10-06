import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

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
import { hayStockDeAvio, type ExistenciaAvioEnAlmacen } from './stock-avios';

/** Un renglón capturado de avío: avío×cantidad. */
export interface RenglonAvio {
  idAvio: number;
  avio: string;
  descripcion: string;
  cantidad: number;
}

/**
 * La existencia que se pinta para un avío con el stock CONOCIDO: si no tiene renglón en la vista de
 * existencias es que **nunca entró a ese almacén**, y vale CERO (no un hueco en blanco).
 */
function existenciaDe(
  stock: ReadonlyMap<number, ExistenciaAvioEnAlmacen>,
  idAvio: number,
): ExistenciaAvioEnAlmacen {
  return stock.get(idAvio) ?? { existencia: 0, unidad: null };
}

/**
 * Cómo se dice la existencia de un avío del almacén de donde sale, junto a la cantidad que se quiere
 * sacar. El CERO se dice con su nombre —no como «Excede · hay 0»—: lo que hay que hacer no es bajar
 * la cantidad, es tener el avío en ese almacén.
 */
function LeyendaExistencia({
  existencia,
  cantidad,
  testid,
}: {
  existencia: ExistenciaAvioEnAlmacen;
  cantidad: number;
  testid: string;
}): React.JSX.Element {
  const unidad = existencia.unidad !== null ? ` ${existencia.unidad}` : '';
  if (existencia.existencia <= 0) {
    return (
      <span className="font-semibold text-crit" data-testid={testid}>
        Sin existencia
      </span>
    );
  }
  if (cantidad > existencia.existencia) {
    return (
      <span className="font-semibold text-crit" data-testid={testid}>
        Excede · hay {existencia.existencia.toLocaleString('es-MX')}
        {unidad}
      </span>
    );
  }
  return (
    <span className="text-muted-foreground tabular-nums" data-testid={testid}>
      Hay {existencia.existencia.toLocaleString('es-MX')}
      {unidad}
    </span>
  );
}

/**
 * CAPTURA DE RENGLONES DE AVÍO (F4-E1). El usuario elige un avío y la cantidad; los renglones se
 * acumulan. Presentación pura (A1): no decide negocio; el backend valida no-negativo. No maneja lote
 * (el inventario de avíos es por avío×almacén, R4). La usan la salida sin orden, el ajuste y el
 * traspaso de avíos.
 *
 * ⭐⭐ FILA 0.233 — **UN AVÍO SIN EXISTENCIA NO SE PUEDE ELEGIR PARA SACARLO.** Es el punto 07c del
 * repaso de DANIEL (§Post-F9.243): *«que no deje meter los avíos que no hay stock, ANTES de
 * meterlos»*. La fila 0.216 lo arregló en la nota de salida; esta captura —la de las otras tres
 * pantallas que sacan avíos— no mencionaba stock en ninguna línea. Con `stockOrigen`:
 *  • elegir un avío sin existencia en el almacén de donde sale **se rechaza con su razón** (el
 *    selector sigue buscando en TODO el catálogo: lo hace el servidor y no sabe de existencias);
 *  • «Agregar» vuelve a mirar, por si el almacén cambió después de elegir el avío;
 *  • la existencia se PINTA, también cuando es CERO, junto al avío elegido y en cada renglón.
 *
 * 🔑 Sin `stockOrigen` (`undefined`) **no se sabe** —o no aplica, como en un ajuste de ENTRADA— y
 * la captura se comporta como siempre: ni pinta ni frena. La guarda de verdad sigue en el servidor
 * (A1), que rechaza la salida bajo bloqueo y por suma de movimientos.
 */
export function CapturaRenglonesAvio({
  renglones,
  onChange,
  soloLectura = false,
  stockOrigen,
}: {
  renglones: RenglonAvio[];
  onChange: (renglones: RenglonAvio[]) => void;
  soloLectura?: boolean;
  /**
   * ⭐ Fila 0.233 — existencia por avío en el almacén del que SALE el material (el ORIGEN de un
   * traspaso), o `undefined` cuando **no se sabe** o **no aplica** (ajuste de entrada). Ver
   * `useStockAvioEnAlmacen`.
   */
  stockOrigen?: ReadonlyMap<number, ExistenciaAvioEnAlmacen> | undefined;
}): React.JSX.Element {
  const [avio, setAvio] = useState<Avio | undefined>(undefined);
  const [cantidad, setCantidad] = useState<string>('');
  /**
   * ⭐ Fila 0.233 — cuántas selecciones se han RECHAZADO por falta de existencia. Es la `key` del
   * combobox, que lo REMONTA tras cada rechazo: el combobox escribe su texto al clickear, antes de
   * saber si el padre acepta, y sin remontarlo se quedaría enseñando el avío que NO entró. Mismo
   * recurso que la nota de salida (fila 0.216).
   */
  const [rechazos, setRechazos] = useState(0);

  /** Rechaza el avío sin existencia: lo dice, suelta la selección y limpia el combobox. */
  function rechazarSinExistencia(clave: string): void {
    toast.error(
      `El avío ${clave} no tiene existencia en el almacén de donde sale: no se puede sacar. Elige otro o revisa el almacén.`,
    );
    setAvio(undefined);
    setRechazos((n) => n + 1);
  }

  /**
   * 🔴 LA PUERTA DE LA FILA 0.233: el avío sin existencia NO queda elegido. Si se le quitara la
   * condición, se podría capturar el renglón y el error saldría al guardar — el *«no me deja»* de
   * Daniel, una pantalla más tarde.
   */
  function elegir(nuevo: Avio): void {
    if (!hayStockDeAvio(stockOrigen, nuevo.id)) {
      rechazarSinExistencia(nuevo.clave);
      return;
    }
    setAvio(nuevo);
  }

  function agregar(): void {
    if (avio === undefined || cantidad === '') return;
    // Se vuelve a mirar al agregar: el avío pudo elegirse antes de escoger el almacén (stock aún no
    // conocido) o con OTRO almacén elegido.
    if (!hayStockDeAvio(stockOrigen, avio.id)) {
      rechazarSinExistencia(avio.clave);
      return;
    }
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
        <SelectorAvio
          key={rechazos}
          idSeleccionado={avio?.id}
          alSeleccionar={elegir}
          testid="captura-avio"
        />
        {avio !== undefined && stockOrigen !== undefined ? (
          <p className="text-xs">
            <LeyendaExistencia
              existencia={existenciaDe(stockOrigen, avio.id)}
              cantidad={Number(cantidad)}
              testid="captura-avio-existencia"
            />
          </p>
        ) : null}
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
                {stockOrigen !== undefined ? (
                  <TableHead className="text-right">Existencia</TableHead>
                ) : null}
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
                  {stockOrigen !== undefined ? (
                    <TableCell className="text-right text-xs">
                      <LeyendaExistencia
                        existencia={existenciaDe(stockOrigen, r.idAvio)}
                        cantidad={r.cantidad}
                        testid={`captura-avio-existencia-${String(r.idAvio)}`}
                      />
                    </TableCell>
                  ) : null}
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
