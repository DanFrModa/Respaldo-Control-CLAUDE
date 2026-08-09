import type { OrdenCompra, OrdenCompraLinea } from '@/api/tipos';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { formatearMoneda } from '@/lib/formato';

import { descripcionMaterial } from './piezas';

/**
 * Tabla de RENGLONES de una OC en el detalle (solo lectura, F4-E2). Lista material, cantidad,
 * unidad, precio, subtotal y la orden ligada; los renglones con matriz talla×color la muestran
 * impresa como tabla bajo el renglón. Todos los importes son DERIVADOS por el backend (A1).
 */
export function DetalleRenglonesOc({ oc }: { oc: OrdenCompra }): React.JSX.Element {
  if (oc.lineas.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
        Esta orden de compra no tiene renglones.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* `min-w` da aire a la columna Material y ACTIVA el scroll-x del contenedor en pantallas
          angostas (el cajón móvil son 390px): sin él, `w-full` encoge la tabla y parte el material
          en ~10 líneas. En escritorio el cajón es más ancho que este mínimo, así que no cambia. */}
      <div className="overflow-x-auto">
        <table
          className="w-full min-w-[600px] border-collapse text-sm"
          data-testid="tabla-renglones-oc"
        >
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">Material</th>
              {/* §Post-F9.16: el TIPO del renglón. Sin esto, un renglón de "texto libre" (todas las
                  OCs migradas) se veía IGUAL que uno de tela del catálogo — y no había forma de
                  entender por qué la orden no ofrece "Dar entrada a la tela". */}
              <th className="px-2 py-1.5 font-medium">Tipo</th>
              <th className="px-2 py-1.5 text-right font-medium">Cantidad</th>
              <th className="px-2 py-1.5 font-medium">Unidad</th>
              <th className="px-2 py-1.5 text-right font-medium">Precio</th>
              <th className="px-2 py-1.5 text-right font-medium">Subtotal</th>
              <th className="px-2 py-1.5 font-medium">Orden</th>
            </tr>
          </thead>
          <tbody>
            {oc.lineas.map((linea) => (
              <tr key={linea.id} className="border-b align-top" data-testid="fila-renglon-oc">
                <td className="px-2 py-1.5">{descripcionMaterial(linea)}</td>
                <td className="px-2 py-1.5">
                  <ChipEstado tono={linea.idTela !== null ? 'ok' : 'neutro'} sinPunto>
                    {linea.idTela !== null
                      ? 'Tela'
                      : linea.idAvio !== null
                        ? 'Avío'
                        : 'Texto libre'}
                  </ChipEstado>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {linea.cantidad.toLocaleString('es-MX')}
                </td>
                <td className="px-2 py-1.5">{linea.unidad ?? '—'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {formatearMoneda(linea.precio)}
                </td>
                <td className="px-2 py-1.5 text-right font-medium tabular-nums">
                  {formatearMoneda(linea.subtotal)}
                </td>
                <td className="px-2 py-1.5">
                  {linea.folioOrden !== null ? `Orden ${linea.folioOrden}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="px-2 py-1.5" colSpan={5}>
                Total
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums" data-testid="total-detalle-oc">
                {formatearMoneda(oc.total)}
              </td>
              <td aria-hidden />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Matrices talla×color de los renglones que la usan (impresas como tabla). */}
      {oc.lineas
        .filter((linea) => linea.tallas.length > 0)
        .map((linea) => (
          <MatrizRenglon key={linea.id} linea={linea} />
        ))}
    </div>
  );
}

/** Imprime la matriz talla×color de un renglón como una tabla (filas=color, columnas=talla). */
function MatrizRenglon({ linea }: { linea: OrdenCompraLinea }): React.JSX.Element {
  // Tallas únicas (columnas), en el orden en que aparecen.
  const tallas: { idTalla: number; etiqueta: string }[] = [];
  const vistas = new Set<number>();
  for (const celda of linea.tallas) {
    if (!vistas.has(celda.idTalla)) {
      vistas.add(celda.idTalla);
      tallas.push({ idTalla: celda.idTalla, etiqueta: celda.etiquetaTalla });
    }
  }
  // Filas (color) -> { [idTalla]: cantidad }.
  const filas = new Map<number, { color: string; cantidades: Record<number, number> }>();
  for (const celda of linea.tallas) {
    const fila = filas.get(celda.idColor) ?? { color: celda.color, cantidades: {} };
    fila.cantidades[celda.idTalla] = celda.cantidad;
    filas.set(celda.idColor, fila);
  }

  return (
    <div className="rounded-md border p-3" data-testid="matriz-detalle-oc">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Detalle por talla × color — {descripcionMaterial(linea)}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="px-2 py-1 text-left font-medium">Color</th>
              {tallas.map((t) => (
                <th key={t.idTalla} className="px-1 py-1 text-center font-medium">
                  {t.etiqueta}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...filas.values()].map((fila) => (
              <tr key={fila.color} className="border-b">
                <td className="px-2 py-1 font-medium whitespace-nowrap">{fila.color}</td>
                {tallas.map((t) => (
                  <td key={t.idTalla} className="px-1 py-1 text-center tabular-nums">
                    {(fila.cantidades[t.idTalla] ?? 0).toLocaleString('es-MX')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
