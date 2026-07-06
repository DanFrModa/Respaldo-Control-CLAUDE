import { useMemo } from 'react';

import { usePrecosto, type Precosto, type PrecostoLinea } from '@/api/precostos';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatearMoneda } from '@/lib/formato';

/**
 * COMPARADOR de dos versiones de precosto (F8-E5): "v anterior vs v nueva". Reusa el `GET /precostos/:id`
 * de E3 (hook `usePrecosto`) para traer ambas versiones y muestra los renglones que CAMBIARON + el delta
 * de costo. NO recalcula precios en el cliente (A1): sólo agrupa/diferencia lo que el backend ya devolvió.
 * Los importes salen "—" sin `consultas.ver-importes` (el backend los manda null).
 *
 * El match de renglones es por `concepto||descripcion` (clave estable de un insumo del BOM/manual): así
 * un renglón que subió de precio se ve como CAMBIO, uno que desapareció como QUITADO y uno nuevo como
 * AGREGADO.
 */
function claveLinea(l: PrecostoLinea): string {
  return `${l.conceptoCodigo}||${l.descripcion}`;
}

interface FilaComparacion {
  clave: string;
  concepto: string;
  descripcion: string;
  importeAnterior: number | null;
  importeNuevo: number | null;
  /** 'igual' | 'cambio' | 'agregado' | 'quitado' (según exista en cada versión y difiera el importe). */
  estado: 'igual' | 'cambio' | 'agregado' | 'quitado';
}

function compararLineas(anterior: Precosto, nuevo: Precosto): FilaComparacion[] {
  const porClaveAnterior = new Map(anterior.lineas.map((l) => [claveLinea(l), l]));
  const porClaveNuevo = new Map(nuevo.lineas.map((l) => [claveLinea(l), l]));
  const claves = new Set<string>([...porClaveAnterior.keys(), ...porClaveNuevo.keys()]);

  const filas: FilaComparacion[] = [];
  for (const clave of claves) {
    const a = porClaveAnterior.get(clave);
    const n = porClaveNuevo.get(clave);
    const base = a ?? n;
    if (base === undefined) {
      continue; // inalcanzable: la clave vino de la unión de ambos mapas
    }
    const importeAnterior = a?.importe ?? null;
    const importeNuevo = n?.importe ?? null;
    let estado: FilaComparacion['estado'];
    if (a === undefined) {
      estado = 'agregado';
    } else if (n === undefined) {
      estado = 'quitado';
    } else {
      estado = importeAnterior === importeNuevo ? 'igual' : 'cambio';
    }
    filas.push({
      clave,
      concepto: base.conceptoNombre,
      descripcion: base.descripcion,
      importeAnterior,
      importeNuevo,
      estado,
    });
  }
  // Los que cambiaron primero (agregado/quitado/cambio), luego los iguales; dentro, por concepto.
  const peso = { cambio: 0, agregado: 1, quitado: 2, igual: 3 } as const;
  return filas.sort(
    (x, y) => peso[x.estado] - peso[y.estado] || x.concepto.localeCompare(y.concepto),
  );
}

const ETIQUETA_ESTADO: Record<FilaComparacion['estado'], string> = {
  igual: '',
  cambio: 'cambió',
  agregado: 'agregado',
  quitado: 'quitado',
};

/** Muestra la comparación entre dos versiones de precosto (por sus ids). */
export function ComparadorVersiones({
  idAnterior,
  idNuevo,
  verImportes,
}: {
  idAnterior: number;
  idNuevo: number;
  verImportes: boolean;
}): React.JSX.Element {
  const anterior = usePrecosto(idAnterior);
  const nuevo = usePrecosto(idNuevo);

  const filas = useMemo(() => {
    if (anterior.data === undefined || nuevo.data === undefined) {
      return [];
    }
    return compararLineas(anterior.data, nuevo.data);
  }, [anterior.data, nuevo.data]);

  if (anterior.isPending || nuevo.isPending) {
    return <p className="text-sm text-muted-foreground">Cargando comparación…</p>;
  }
  if (
    anterior.isError ||
    nuevo.isError ||
    anterior.data === undefined ||
    nuevo.data === undefined
  ) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {anterior.error?.message ?? nuevo.error?.message ?? 'No se pudo cargar la comparación.'}
      </p>
    );
  }

  const totalAnterior = anterior.data.costoTotal;
  const totalNuevo = nuevo.data.costoTotal;
  const delta = totalAnterior !== null && totalNuevo !== null ? totalNuevo - totalAnterior : null;
  const soloCambios = filas.filter((f) => f.estado !== 'igual');

  return (
    <div className="space-y-2" data-testid="comparador-versiones">
      <p className="text-sm text-muted-foreground">
        Comparando <span className="font-medium text-foreground">v{anterior.data.version}</span> vs{' '}
        <span className="font-medium text-foreground">v{nuevo.data.version}</span>
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Concepto / insumo</TableHead>
              <TableHead className="text-right">v{anterior.data.version}</TableHead>
              <TableHead className="text-right">v{nuevo.data.version}</TableHead>
              <TableHead className="text-right">Cambio</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(soloCambios.length > 0 ? soloCambios : filas).map((f) => (
              <TableRow key={f.clave} data-testid="fila-comparacion" data-estado={f.estado}>
                <TableCell>
                  <span className="font-medium">{f.descripcion}</span>
                  <span className="block text-xs text-muted-foreground">
                    {f.concepto}
                    {ETIQUETA_ESTADO[f.estado] ? ` · ${ETIQUETA_ESTADO[f.estado]}` : ''}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {verImportes ? formatearMoneda(f.importeAnterior) : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {verImportes ? formatearMoneda(f.importeNuevo) : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {verImportes && f.importeAnterior !== null && f.importeNuevo !== null
                    ? formatearMoneda(f.importeNuevo - f.importeAnterior)
                    : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap justify-end gap-4 text-sm" data-testid="comparador-totales">
        <span>
          Costo v{anterior.data.version}:{' '}
          <span className="font-semibold">
            {verImportes ? formatearMoneda(totalAnterior) : '—'}
          </span>
        </span>
        <span>
          Costo v{nuevo.data.version}:{' '}
          <span className="font-semibold">{verImportes ? formatearMoneda(totalNuevo) : '—'}</span>
        </span>
        <span>
          Delta:{' '}
          <span className="font-semibold" data-testid="comparador-delta">
            {verImportes && delta !== null ? formatearMoneda(delta) : '—'}
          </span>
        </span>
      </div>
    </div>
  );
}
