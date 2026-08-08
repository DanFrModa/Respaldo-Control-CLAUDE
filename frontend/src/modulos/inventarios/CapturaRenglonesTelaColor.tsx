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
  /** Precio por unidad del CUERPO (solo con `conPrecios`; viaja al kardex como costo, D1). */
  precioUnit?: number;
  /** Precio por unidad del COMPLEMENTO (solo con `conPrecios`; vive en el documento). */
  precioUnitComplemento?: number;
  /** Renglón de OC que SURTE este renglón (§Post-F9.14; solo la entrada por factura). */
  idOrdenCompraLinea?: number;
}

/** Renglón de OC pendiente de recibir, tal como lo ofrece el selector (§Post-F9.14). */
export interface LineaOcPendiente {
  idOrdenCompraLinea: number;
  numCompra: number;
  idTela: number;
  tela: string;
  unidad: string | null;
  pendiente: number;
  precio: number;
}

/**
 * CAPTURA DE RENGLONES por TELA+COLOR (inventario NUEVO, etapa A2): el usuario elige la tela
 * (typeahead server-side), luego UNO de SUS colores (hijos de la tela, §Post-F9.11) y las DOS
 * cantidades — cuerpo y complemento — que viajan JUNTAS en el mismo renglón (Daniel: el
 * complemento es parte de la misma tela; comprar solo cardigan = cuerpo en 0). Con
 * `conLoteProveedor` (ajustes de ENTRADA) se captura además el número de lote del proveedor de la
 * partida, y con `conPrecios` (documento de entrada por factura/remisión, B1) los DOS precios
 * unitarios — prellenados con los del catálogo del color como SUGERENCIA (la fuente de verdad del
 * costo es lo que se captura aquí, D1). Presentación pura (A1): el backend valida.
 *
 * Con `lineasOc` (entrada por factura, §Post-F9.14) cada renglón puede además AMARRARSE a su
 * renglón de orden de compra: el selector solo ofrece los renglones pendientes de la MISMA tela que
 * se está capturando —así no se puede ligar felpa contra una OC de mesh— y deja elegir "sin orden
 * de compra" para la tela suelta.
 */
export function CapturaRenglonesTelaColor({
  renglones,
  onChange,
  soloLectura = false,
  conLoteProveedor = false,
  conPrecios = false,
  lineasOc,
}: {
  renglones: RenglonTelaColor[];
  onChange: (renglones: RenglonTelaColor[]) => void;
  soloLectura?: boolean;
  conLoteProveedor?: boolean;
  /** Muestra y captura los precios unitarios de cuerpo y complemento (B1). */
  conPrecios?: boolean;
  /**
   * Renglones de OC pendientes del proveedor (§Post-F9.14). `undefined` = esta pantalla no liga a
   * órdenes de compra (ajuste, traspaso, salida); un arreglo (aunque sea vacío) enciende el
   * selector "Renglón de OC" del alta y su columna en la tabla.
   */
  lineasOc?: readonly LineaOcPendiente[];
}): React.JSX.Element {
  const [tela, setTela] = useState<Tela | undefined>(undefined);
  const [idTelaColor, setIdTelaColor] = useState<string>('');
  const [cantidad, setCantidad] = useState<string>('');
  const [cantidadComplemento, setCantidadComplemento] = useState<string>('');
  const [loteProveedor, setLoteProveedor] = useState<string>('');
  const [precioUnit, setPrecioUnit] = useState<string>('');
  const [precioComplemento, setPrecioComplemento] = useState<string>('');
  const [idLineaOc, setIdLineaOc] = useState<string>('');

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
    setPrecioUnit('');
    setPrecioComplemento('');
  }

  /**
   * Al elegir el color, PRE-LLENA los precios con los del catálogo (sugerencia editable): el precio
   * real de la factura manda y es el que se guarda (el catálogo no es la fuente de verdad, D1).
   */
  function elegirColor(valor: string): void {
    setIdTelaColor(valor);
    if (!conPrecios) return;
    const color = tela?.colores.find((c) => String(c.id) === valor);
    setPrecioUnit(color?.precio == null ? '' : String(color.precio));
    setPrecioComplemento(color?.precioComplemento == null ? '' : String(color.precioComplemento));
  }

  function agregar(): void {
    if (tela === undefined || colorElegido === undefined || !cantidadesValidas) return;
    const precioCuerpoNum = precioUnit === '' ? undefined : Number(precioUnit);
    const precioComplNum = precioComplemento === '' ? undefined : Number(precioComplemento);
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
      ...(conPrecios && precioCuerpoNum !== undefined && Number.isFinite(precioCuerpoNum)
        ? { precioUnit: precioCuerpoNum }
        : {}),
      ...(conPrecios &&
      llevaComplemento &&
      precioComplNum !== undefined &&
      Number.isFinite(precioComplNum)
        ? { precioUnitComplemento: precioComplNum }
        : {}),
      ...(idLineaOc === '' ? {} : { idOrdenCompraLinea: Number(idLineaOc) }),
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
    setPrecioUnit('');
    setPrecioComplemento('');
    setIdLineaOc('');
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
                onChange={(e) => elegirColor(e.target.value)}
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
            {/* §Post-F9.14 — a qué renglón de OC surte este renglón. Solo se ofrecen los
                pendientes de LA MISMA tela: ligar felpa contra una OC de otra tela es un error que
                el servidor rechazaría, y aquí ni siquiera se puede cometer. */}
            {lineasOc !== undefined ? (
              <Field>
                <FieldLabel htmlFor="captura-color-oc">Renglón de OC</FieldLabel>
                <SelectNativo
                  id="captura-color-oc"
                  value={idLineaOc}
                  onChange={(e) => setIdLineaOc(e.target.value)}
                  disabled={soloLectura}
                  data-testid="captura-color-oc"
                >
                  <option value="">Sin orden de compra</option>
                  {lineasOc
                    .filter((l) => l.idTela === tela.id)
                    .map((l) => (
                      <option key={l.idOrdenCompraLinea} value={String(l.idOrdenCompraLinea)}>
                        {`OC ${String(l.numCompra)} · faltan ${l.pendiente.toLocaleString('es-MX')}${
                          l.unidad === null ? '' : ` ${l.unidad}`
                        }`}
                      </option>
                    ))}
                </SelectNativo>
              </Field>
            ) : null}
            {conPrecios ? (
              <Field>
                <FieldLabel htmlFor="captura-color-precio">
                  Precio {(tela.nombreCuerpo ?? 'cuerpo').toLowerCase()}
                </FieldLabel>
                <Input
                  id="captura-color-precio"
                  type="number"
                  min={0}
                  step="any"
                  value={precioUnit}
                  onChange={(e) => setPrecioUnit(e.target.value)}
                  placeholder="Del catálogo"
                  disabled={soloLectura}
                  data-testid="captura-color-precio"
                />
              </Field>
            ) : null}
            {conPrecios && llevaComplemento ? (
              <Field>
                <FieldLabel htmlFor="captura-color-precio-compl">
                  Precio {(tela.nombreComplemento ?? '').toLowerCase()}
                </FieldLabel>
                <Input
                  id="captura-color-precio-compl"
                  type="number"
                  min={0}
                  step="any"
                  value={precioComplemento}
                  onChange={(e) => setPrecioComplemento(e.target.value)}
                  placeholder="Del catálogo"
                  disabled={soloLectura}
                  data-testid="captura-color-precio-compl"
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
                {lineasOc !== undefined ? <TableHead>Orden de compra</TableHead> : null}
                {conPrecios ? <TableHead className="text-right">Precio</TableHead> : null}
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
                  {lineasOc !== undefined ? (
                    <TableCell className="text-xs text-muted-foreground">
                      {r.idOrdenCompraLinea === undefined
                        ? '—'
                        : `OC ${String(
                            lineasOc.find((l) => l.idOrdenCompraLinea === r.idOrdenCompraLinea)
                              ?.numCompra ?? '',
                          )}`}
                    </TableCell>
                  ) : null}
                  {conPrecios ? (
                    <TableCell className="text-right text-xs tabular-nums">
                      {r.precioUnit === undefined ? '—' : r.precioUnit.toLocaleString('es-MX')}
                      {r.precioUnitComplemento === undefined
                        ? ''
                        : ` / ${r.precioUnitComplemento.toLocaleString('es-MX')}`}
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
