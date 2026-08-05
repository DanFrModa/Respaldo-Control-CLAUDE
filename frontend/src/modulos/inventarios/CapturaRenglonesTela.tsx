import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { useExistenciasTela } from '@/api/inventario-materiales';
import type { Tela } from '@/api/telas';
import { Button } from '@/components/ui/button';
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

import { SelectorTela } from './SelectorTela';

/** Un renglón capturado: tela×lote×cantidad, con sus etiquetas para mostrar. */
export interface RenglonTela {
  idTela: number;
  tela: string;
  idLote: number;
  loteClave: string;
  cantidad: number;
  /** Existencia disponible de ese lote en el almacén (para guiar; el servidor es la autoridad). */
  disponible: number;
}

/**
 * CAPTURA DE RENGLONES DE TELA por LOTE (F4-E1). El usuario elige una tela, luego un LOTE concreto
 * (de los que tienen existencia en el almacén dado) y la cantidad; los renglones se acumulan en una
 * tabla. Presentación pura (A1): no decide nada de negocio; muestra lo disponible (consulta de
 * existencias filtrada por tela+almacén) solo como guía — el backend valida no-negativo bajo lock.
 *
 * `idAlmacen` acota los lotes disponibles a ese almacén (la salida/traspaso sale de un almacén).
 */
export function CapturaRenglonesTela({
  idAlmacen,
  renglones,
  onChange,
  soloLectura = false,
}: {
  idAlmacen: number | undefined;
  renglones: RenglonTela[];
  onChange: (renglones: RenglonTela[]) => void;
  soloLectura?: boolean;
}): React.JSX.Element {
  const [tela, setTela] = useState<{ id: number; nombre: string } | undefined>(undefined);
  const [idLote, setIdLote] = useState<string>('');
  const [cantidad, setCantidad] = useState<string>('');

  // Existencias de la tela elegida EN el almacén (para listar sus lotes con saldo > 0).
  const hayConsulta = tela !== undefined && idAlmacen !== undefined;
  const existencias = useExistenciasTela(hayConsulta ? { idTela: tela.id, idAlmacen } : {});
  const lotesDeTela = hayConsulta
    ? (existencias.data?.filas ?? []).filter((f) => f.idTela === tela.id && f.idLote !== null)
    : [];

  // TELAS AL TONO del lote elegido (D5 — un lote es una partida de UN color con N telas dentro:
  // felpa + su cardigan). Daniel (30-jul-2026): *"normalmente se descargan las telas al mismo tiempo
  // cuando están relacionadas"*. Se OFRECEN, no se descuentan solas: cada cantidad se teclea (su
  // regla, sin estimaciones ni proporciones). El servidor sigue siendo la autoridad del saldo.
  const idLoteNum = idLote === '' ? undefined : Number(idLote);
  const hayLote = idLoteNum !== undefined && idAlmacen !== undefined;
  const delLote = useExistenciasTela(hayLote ? { idLote: idLoteNum, idAlmacen } : {});
  const telasAlTono = hayLote
    ? (delLote.data?.filas ?? []).filter(
        (f) =>
          f.idLote === idLoteNum &&
          f.idTela !== tela?.id &&
          f.existencia > 0 &&
          !renglones.some((r) => r.idTela === f.idTela && r.idLote === idLoteNum),
      )
    : [];

  /**
   * La existencia de la combinación tela × lote × almacén elegida. Si no existe, esa tela NO está en
   * ese lote (pasa al conservar el lote y cambiar de tela): no hay nada que capturar. Se deriva aquí
   * para que el botón se DESHABILITE en vez de no hacer nada al pulsarlo.
   */
  const filaSeleccionada =
    tela === undefined || idLoteNum === undefined
      ? undefined
      : (lotesDeTela.find((f) => f.idLote === idLoteNum) ??
        (delLote.data?.filas ?? []).find((f) => f.idLote === idLoteNum && f.idTela === tela.id));

  function agregar(): void {
    if (tela === undefined || idLoteNum === undefined || cantidad === '') return;
    const cantidadNum = Number(cantidad);
    if (!Number.isFinite(cantidadNum) || cantidadNum <= 0) return;
    const fila = filaSeleccionada;
    if (fila === undefined) {
      return;
    }
    // Evita duplicar la misma tela×lote: si ya está, suma la cantidad.
    const sinDuplicado = renglones.filter((r) => !(r.idTela === tela.id && r.idLote === idLoteNum));
    const existentePrev = renglones.find((r) => r.idTela === tela.id && r.idLote === idLoteNum);
    onChange([
      ...sinDuplicado,
      {
        idTela: tela.id,
        tela: tela.nombre,
        idLote: idLoteNum,
        loteClave: fila.loteClave ?? String(idLoteNum),
        cantidad: cantidadNum + (existentePrev?.cantidad ?? 0),
        disponible: fila.existencia,
      },
    ]);
    // El LOTE se conserva (solo se limpia la cantidad): así, tras capturar la felpa, el panel de
    // "telas al tono" queda a la vista con lo que falta de esa misma partida.
    setCantidad('');
  }

  function quitar(idTela: number, idLote: number): void {
    onChange(renglones.filter((r) => !(r.idTela === idTela && r.idLote === idLote)));
  }

  return (
    <div className="space-y-4" data-testid="captura-renglones-tela">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">Agregar renglón</p>
          <SelectorTela
            idSeleccionado={tela?.id}
            etiquetaSeleccion={tela?.nombre}
            alSeleccionar={(t: Tela) => setTela({ id: t.id, nombre: t.nombre })}
            testid="captura-tela"
          />
          {tela !== undefined ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="captura-lote">Lote</FieldLabel>
                <SelectNativo
                  id="captura-lote"
                  value={idLote}
                  onChange={(e) => setIdLote(e.target.value)}
                  disabled={soloLectura}
                  data-testid="captura-lote"
                >
                  <option value="">
                    {idAlmacen === undefined
                      ? 'Elige primero el almacén'
                      : existencias.isPending
                        ? 'Cargando lotes…'
                        : lotesDeTela.length === 0
                          ? 'Sin lotes con existencia'
                          : 'Elige un lote…'}
                  </option>
                  {lotesDeTela.map((f) => (
                    <option key={f.idLote} value={String(f.idLote)}>
                      {f.loteClave ?? `Lote ${f.idLote ?? ''}`} ({f.color ?? '—'}) ·{' '}
                      {f.existencia.toLocaleString('es-MX')} disp.
                    </option>
                  ))}
                </SelectNativo>
              </Field>
              <Field>
                <FieldLabel htmlFor="captura-cantidad">Cantidad</FieldLabel>
                <Input
                  id="captura-cantidad"
                  type="number"
                  min={0}
                  step="any"
                  value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                  disabled={soloLectura}
                  data-testid="captura-cantidad"
                />
              </Field>
            </div>
          ) : null}
          {tela !== undefined && idLoteNum !== undefined && filaSeleccionada === undefined ? (
            <p className="text-xs text-warn" data-testid="captura-combinacion-invalida">
              Esa tela no está en el lote elegido (o ya no tiene existencia en este almacén). Elige
              otro lote.
            </p>
          ) : null}
          {telasAlTono.length > 0 ? (
            <div
              className="rounded-md border border-primary/40 bg-primary-soft p-2.5"
              data-testid="captura-telas-al-tono"
            >
              <p className="text-xs font-medium">
                Este lote trae {telasAlTono.length === 1 ? 'otra tela' : 'otras telas'} al tono:
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {telasAlTono.map((f) => (
                  <Button
                    key={f.idTela}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={soloLectura}
                    onClick={() => {
                      setTela({ id: f.idTela, nombre: f.tela });
                      setCantidad('');
                    }}
                    data-testid={`captura-al-tono-${f.idTela}`}
                  >
                    {f.tela} · {f.existencia.toLocaleString('es-MX')} disp.
                  </Button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Se capturan con su propia cantidad; nada se descuenta solo.
              </p>
            </div>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            onClick={agregar}
            disabled={soloLectura || filaSeleccionada === undefined || !(Number(cantidad) > 0)}
            data-testid="captura-agregar"
          >
            <Plus className="mr-1.5 size-4" aria-hidden /> Agregar
          </Button>
        </div>
      </div>

      {renglones.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          Aún no hay renglones. Agrega una tela, su lote y la cantidad.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border" data-testid="captura-tabla">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tela</TableHead>
                <TableHead>Lote</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Disponible</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {renglones.map((r) => {
                const excede = r.cantidad > r.disponible;
                return (
                  <TableRow key={`${r.idTela}-${r.idLote}`}>
                    <TableCell className="font-medium">{r.tela}</TableCell>
                    <TableCell>{r.loteClave}</TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${excede ? 'text-amber-600 dark:text-amber-400' : ''}`}
                    >
                      {r.cantidad.toLocaleString('es-MX')}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.disponible.toLocaleString('es-MX')}
                    </TableCell>
                    <TableCell className="text-right">
                      {!soloLectura ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => quitar(r.idTela, r.idLote)}
                          data-testid={`captura-quitar-${r.idTela}-${r.idLote}`}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
