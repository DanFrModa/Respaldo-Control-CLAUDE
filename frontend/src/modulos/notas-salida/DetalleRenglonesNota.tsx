import type { NotaSalida } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';

import { descripcionMaterialNota } from './piezas';

/**
 * Renglones de una nota de salida en SOLO LECTURA (F4-E5): tabla en pantallas anchas, tarjetas
 * apiladas en móvil (regla 10). Cada renglón muestra la orden destino, el tipo (avío/tela), el
 * material (con lote si es tela), la cantidad/unidad y la traza al movimiento de kardex
 * (descuento de avío o salida-a-orden de tela). Presentación pura (A1).
 */
export function DetalleRenglonesNota({ nota }: { nota: NotaSalida }): React.JSX.Element {
  if (nota.lineas.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
        Esta nota no tiene renglones.
      </p>
    );
  }

  return (
    <>
      {/* Tabla en pantallas medianas o más anchas. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm" data-testid="tabla-renglones-nota">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3">Orden</th>
              <th className="py-2 pr-3">Tipo</th>
              <th className="py-2 pr-3">Material</th>
              <th className="py-2 pr-3 text-right">Cantidad</th>
              <th className="py-2 pr-3">Unidad</th>
              <th className="py-2">Traza kardex</th>
            </tr>
          </thead>
          <tbody>
            {nota.lineas.map((linea) => (
              <tr key={linea.id} className="border-b" data-testid="fila-renglon-nota">
                <td className="py-2 pr-3">{linea.folioOrden ?? '—'}</td>
                <td className="py-2 pr-3">
                  <Badge variant={linea.tipo === 'avio' ? 'secondary' : 'outline'}>
                    {linea.tipo === 'avio' ? 'Avío' : 'Tela'}
                  </Badge>
                </td>
                <td className="py-2 pr-3">{descripcionMaterialNota(linea)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {linea.cantidad.toLocaleString('es-MX')}
                </td>
                <td className="py-2 pr-3">{linea.unidad ?? '—'}</td>
                <td className="py-2 text-xs text-muted-foreground">{trazaKardex(linea)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tarjetas apiladas en móvil. */}
      <ul className="space-y-2 md:hidden" data-testid="tarjetas-renglones-nota">
        {nota.lineas.map((linea) => (
          <li key={linea.id} className="rounded-lg border p-3" data-testid="tarjeta-renglon-nota">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium">{descripcionMaterialNota(linea)}</span>
              <Badge variant={linea.tipo === 'avio' ? 'secondary' : 'outline'}>
                {linea.tipo === 'avio' ? 'Avío' : 'Tela'}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Orden {linea.folioOrden ?? '—'} · {linea.cantidad.toLocaleString('es-MX')}
              {linea.unidad ? ` ${linea.unidad}` : ''}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{trazaKardex(linea)}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Texto de la traza al kardex de un renglón (descuento de avío / salida-a-orden de tela). */
function trazaKardex(linea: NotaSalida['lineas'][number]): string {
  if (linea.tipo === 'avio') {
    return linea.folioMovimientoAvio === null
      ? 'Sin descontar (borrador)'
      : `Descuento #${String(linea.folioMovimientoAvio)}`;
  }
  return linea.folioMovimientoSalidaTela === null
    ? 'Sin salida referenciada'
    : `Salida-a-orden #${String(linea.folioMovimientoSalidaTela)}`;
}
