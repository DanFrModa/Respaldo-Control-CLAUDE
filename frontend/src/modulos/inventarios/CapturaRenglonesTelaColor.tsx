import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

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

/** Un renglón capturado del flujo por COLOR: tela+color con AMBAS cantidades juntas. */
export interface RenglonTelaColor {
  idTelaColor: number;
  tela: string;
  color: string;
  /** null = la tela NO lleva complemento (no se captura esa cantidad). */
  nombreComplemento: string | null;
  /** Cantidad del CUERPO (puede ser 0 si la entrada es solo complemento). */
  cantidad: number;
  /** Cantidad del COMPLEMENTO (solo telas que lo llevan). */
  cantidadComplemento: number;
  /** Número de lote del PROVEEDOR (solo entradas — dato de la partida). */
  loteProveedor?: string;
}

/**
 * CAPTURA DE RENGLONES por TELA+COLOR (inventario NUEVO, etapa A2): el usuario elige la tela
 * (typeahead server-side), luego UNO de SUS colores (hijos de la tela, §Post-F9.11) y las DOS
 * cantidades — cuerpo y complemento — que viajan JUNTAS en el mismo renglón (Daniel: el
 * complemento es parte de la misma tela; comprar solo cardigan = cuerpo en 0). Con
 * `conLoteProveedor` (ajustes de ENTRADA) se captura además el número de lote del proveedor de la
 * partida. Presentación pura (A1): el backend valida no-negativo de ambos componentes bajo lock.
 */
export function CapturaRenglonesTelaColor({
  renglones,
  onChange,
  soloLectura = false,
  conLoteProveedor = false,
}: {
  renglones: RenglonTelaColor[];
  onChange: (renglones: RenglonTelaColor[]) => void;
  soloLectura?: boolean;
  conLoteProveedor?: boolean;
}): React.JSX.Element {
  const [tela, setTela] = useState<Tela | undefined>(undefined);
  const [idTelaColor, setIdTelaColor] = useState<string>('');
  const [cantidad, setCantidad] = useState<string>('');
  const [cantidadComplemento, setCantidadComplemento] = useState<string>('');
  const [loteProveedor, setLoteProveedor] = useState<string>('');

  const llevaComplemento = tela !== undefined && tela.nombreComplemento !== null;
  const colorElegido = tela?.colores.find((c) => String(c.id) === idTelaColor);
  const cuerpoNum = cantidad === '' ? 0 : Number(cantidad);
  const complementoNum = cantidadComplemento === '' ? 0 : Number(cantidadComplemento);
  const cantidadesValidas =
    Number.isFinite(cuerpoNum) &&
    cuerpoNum >= 0 &&
    Number.isFinite(complementoNum) &&
    complementoNum >= 0 &&
    (cuerpoNum > 0 || (llevaComplemento && complementoNum > 0));

  function elegirTela(t: Tela): void {
    setTela(t);
    setIdTelaColor('');
    setCantidadComplemento('');
  }

  function agregar(): void {
    if (tela === undefined || colorElegido === undefined || !cantidadesValidas) return;
    const nuevo: RenglonTelaColor = {
      idTelaColor: colorElegido.id,
      tela: tela.nombre,
      color: colorElegido.nombre,
      nombreComplemento: tela.nombreComplemento,
      cantidad: cuerpoNum,
      cantidadComplemento: llevaComplemento ? complementoNum : 0,
      ...(conLoteProveedor && loteProveedor.trim().length > 0
        ? { loteProveedor: loteProveedor.trim() }
        : {}),
    };
    if (conLoteProveedor) {
      // ENTRADA: el MISMO tela+color PUEDE repetirse — una factura con dos lotes del mismo color
      // son DOS partidas (DECISIONES §Post-F9.11 punto 4). NUNCA se fusionan renglones (fusionar
      // perdería el lote del proveedor del renglón previo).
      onChange([...renglones, nuevo]);
    } else {
      // SALIDA/TRASPASO: sin partida no hay qué distinga dos renglones del mismo color — si ya
      // está, se SUMAN las cantidades (el backend rechaza el color duplicado).
      const previo = renglones.find((r) => r.idTelaColor === colorElegido.id);
      const sinDuplicado = renglones.filter((r) => r.idTelaColor !== colorElegido.id);
      onChange([
        ...sinDuplicado,
        {
          ...nuevo,
          cantidad: cuerpoNum + (previo?.cantidad ?? 0),
          cantidadComplemento: llevaComplemento
            ? complementoNum + (previo?.cantidadComplemento ?? 0)
            : 0,
        },
      ]);
    }
    setCantidad('');
    setCantidadComplemento('');
    setLoteProveedor('');
  }

  function quitar(indice: number): void {
    onChange(renglones.filter((_, i) => i !== indice));
  }

  const hayComplementoEnTabla = renglones.some((r) => r.nombreComplemento !== null);

  return (
    <div className="space-y-4" data-testid="captura-renglones-tela-color">
      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">Agregar renglón (tela → color → cantidades)</p>
        <SelectorTela
          idSeleccionado={tela?.id}
          etiquetaSeleccion={tela?.nombre}
          alSeleccionar={elegirTela}
          testid="captura-color-tela"
        />
        {tela !== undefined ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field>
              <FieldLabel htmlFor="captura-color-color">Color de la tela</FieldLabel>
              <SelectNativo
                id="captura-color-color"
                value={idTelaColor}
                onChange={(e) => setIdTelaColor(e.target.value)}
                disabled={soloLectura}
                data-testid="captura-color-color"
              >
                <option value="">
                  {tela.colores.length === 0 ? 'Esta tela no tiene colores' : 'Elige el color…'}
                </option>
                {tela.colores.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.nombre}
                    {c.pantone !== null ? ` · ${c.pantone}` : ''}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="captura-color-cantidad">
                {tela.nombreCuerpo ?? 'Cuerpo'}
              </FieldLabel>
              <Input
                id="captura-color-cantidad"
                type="number"
                min={0}
                step="any"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                disabled={soloLectura}
                data-testid="captura-color-cantidad"
              />
            </Field>
            {llevaComplemento ? (
              <Field>
                <FieldLabel htmlFor="captura-color-complemento">
                  {tela.nombreComplemento}
                </FieldLabel>
                <Input
                  id="captura-color-complemento"
                  type="number"
                  min={0}
                  step="any"
                  value={cantidadComplemento}
                  onChange={(e) => setCantidadComplemento(e.target.value)}
                  disabled={soloLectura}
                  data-testid="captura-color-complemento"
                />
              </Field>
            ) : null}
            {conLoteProveedor ? (
              <Field>
                <FieldLabel htmlFor="captura-color-lote-prov">Lote del proveedor</FieldLabel>
                <Input
                  id="captura-color-lote-prov"
                  value={loteProveedor}
                  onChange={(e) => setLoteProveedor(e.target.value)}
                  placeholder="Opcional"
                  disabled={soloLectura}
                  data-testid="captura-color-lote-prov"
                />
              </Field>
            ) : null}
          </div>
        ) : null}
        {tela !== undefined && llevaComplemento ? (
          <p className="text-[11px] text-muted-foreground">
            {tela.nombreCuerpo ?? 'Cuerpo'} y {tela.nombreComplemento} viajan JUNTOS en el mismo
            renglón (solo {tela.nombreComplemento} = {tela.nombreCuerpo ?? 'cuerpo'} en 0).
          </p>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          onClick={agregar}
          disabled={soloLectura || colorElegido === undefined || !cantidadesValidas}
          data-testid="captura-color-agregar"
        >
          <Plus className="mr-1.5 size-4" aria-hidden /> Agregar
        </Button>
      </div>

      {renglones.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          Aún no hay renglones. Elige la tela, su color y las cantidades.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border" data-testid="captura-color-tabla">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tela</TableHead>
                <TableHead>Color</TableHead>
                <TableHead className="text-right">Cuerpo</TableHead>
                {hayComplementoEnTabla ? (
                  <TableHead className="text-right">Complemento</TableHead>
                ) : null}
                {conLoteProveedor ? <TableHead>Lote prov.</TableHead> : null}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* La llave va por ÍNDICE: en entradas el mismo tela+color puede repetirse (dos
                  lotes = dos partidas). */}
              {renglones.map((r, i) => (
                <TableRow key={`${r.idTelaColor}-${i}`}>
                  <TableCell className="font-medium">{r.tela}</TableCell>
                  <TableCell>{r.color}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.cantidad.toLocaleString('es-MX')}
                  </TableCell>
                  {hayComplementoEnTabla ? (
                    <TableCell className="text-right tabular-nums">
                      {r.nombreComplemento !== null
                        ? r.cantidadComplemento.toLocaleString('es-MX')
                        : '—'}
                    </TableCell>
                  ) : null}
                  {conLoteProveedor ? (
                    <TableCell className="text-xs text-muted-foreground">
                      {r.loteProveedor ?? '—'}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right">
                    {!soloLectura ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => quitar(i)}
                        data-testid={`captura-color-quitar-${i}`}
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
