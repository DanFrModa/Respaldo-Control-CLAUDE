import { useQuery } from '@tanstack/react-query';
import { CopyIcon, Loader2Icon, SaveIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { api } from '@/api/cliente';
import { useColores } from '@/api/colores';
import { ErrorDeApi } from '@/api/errores';
import { useFichaModelo } from '@/api/modelos';
import { useGuardarMatriz } from '@/api/ordenes';
import { useTallasActivas } from '@/api/tallas';
import type { Orden, OrdenMatriz } from '@/api/tipos';
import {
  MatrizColorTalla,
  type MatrizLinea,
  type MatrizTalla,
} from '@/componentes/matriz-color-talla/MatrizColorTalla';
import { Button } from '@/components/ui/button';

/**
 * Obtiene una curva de tallas por id (`GET /api/curvas-talla/{id}`), para usar sus tallas como
 * columnas iniciales de la matriz de una orden nueva. Deshabilitada si no hay curva.
 */
function useCurva(idCurva: number | null | undefined) {
  return useQuery({
    queryKey: ['curvas-talla', 'detalle', idCurva ?? 0],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/curvas-talla/{id}', {
        params: { path: { id: idCurva as number } },
      });
      if (!data) {
        throw new ErrorDeApi(error);
      }
      return data;
    },
    enabled: idCurva !== null && idCurva !== undefined,
  });
}

/** Tope alto: trae el catálogo de colores activos para el selector de filas. */
const QUERY_COLORES = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'nombre',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;

/** Construye las filas iniciales de la matriz a partir de las líneas que ya trae la orden. */
function filasDesdeOrden(orden: Orden): MatrizLinea[] {
  return orden.lineas.map((linea) => ({
    idColor: linea.idColor,
    color: linea.color,
    cantidades: Object.fromEntries(linea.tallas.map((t) => [t.idTalla, t.cantidad])),
  }));
}

/**
 * Construye las columnas iniciales: las tallas que ya tienen las líneas de la orden, UNIDAS a las de
 * la curva del modelo (sin duplicar), en orden de curva primero. Sin curva ni líneas → vacío.
 */
function columnasIniciales(
  orden: Orden,
  curvaItems: readonly { idTalla: number; etiqueta: string }[],
): MatrizTalla[] {
  const mapa = new Map<number, MatrizTalla>();
  for (const item of curvaItems) {
    mapa.set(item.idTalla, { idTalla: item.idTalla, etiqueta: item.etiqueta });
  }
  for (const linea of orden.lineas) {
    for (const talla of linea.tallas) {
      if (!mapa.has(talla.idTalla)) {
        mapa.set(talla.idTalla, { idTalla: talla.idTalla, etiqueta: talla.etiquetaTalla });
      }
    }
  }
  return [...mapa.values()];
}

/**
 * Panel de la MATRIZ color × talla de una orden (F2-E3). Alimenta el componente reutilizable con:
 * los colores del catálogo (filas), las tallas de la CURVA del modelo (columnas iniciales) unidas a
 * las que ya tiene la orden, y el catálogo de tallas para agregar columnas extra. Guarda el set
 * completo con `PUT /matriz`: al primer guardado con líneas el backend DERIVA estado='completa'.
 *
 * Solo lectura si la orden está cancelada o sin `ordenes.administrar` (el backend re-valida, A1).
 */
export function PanelMatriz({
  orden,
  puedeAdministrar,
  alCopiarMatriz,
}: {
  orden: Orden;
  puedeAdministrar: boolean;
  /** Abre el diálogo de copiar matriz de otra orden. */
  alCopiarMatriz: () => void;
}): React.JSX.Element {
  const soloLectura = orden.estado === 'cancelada' || !puedeAdministrar;

  const ficha = useFichaModelo(orden.idModelo);
  const curva = useCurva(ficha.data?.idCurvaTalla ?? null);
  const colores = useColores(QUERY_COLORES);
  const tallas = useTallasActivas();
  const guardar = useGuardarMatriz();

  // Estado local de captura (filas + columnas). Se resetea cuando cambia la orden o llega la curva.
  const [lineas, setLineas] = useState<MatrizLinea[]>(() => filasDesdeOrden(orden));
  const [columnas, setColumnas] = useState<MatrizTalla[]>([]);

  const curvaItems = curva.data?.items ?? [];

  // Reinicializa al cambiar de orden o cuando llega la curva (clave estable por id + curva).
  const claveReset = `${orden.id}:${orden.modificadoEn}:${ficha.data?.idCurvaTalla ?? 'sin'}:${curvaItems.length}`;
  useEffect(() => {
    setLineas(filasDesdeOrden(orden));
    setColumnas(columnasIniciales(orden, curvaItems));
    // Se reinicia con la clave (no con cada dependencia individual) para no pisar la captura en vivo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveReset]);

  const coloresDisponibles = useMemo(
    () => (colores.data?.datos ?? []).map((c) => ({ id: c.id, nombre: c.nombre })),
    [colores.data],
  );
  const tallasDisponibles = useMemo(
    () => (tallas.data?.datos ?? []).map((t) => ({ idTalla: t.id, etiqueta: t.etiqueta })),
    [tallas.data],
  );

  function alGuardar(): void {
    // Mapea las filas al cuerpo del API. Se conserva el `id` del renglón existente (para que el
    // backend actualice en vez de recrear) y se omiten las tallas en 0 (no aportan).
    const porColor = new Map(orden.lineas.map((l) => [l.idColor, l.id]));
    const cuerpo: OrdenMatriz = {
      lineas: lineas.map((linea) => {
        const idExistente = porColor.get(linea.idColor);
        const tallasCuerpo = columnas
          .map((col) => ({ idTalla: col.idTalla, cantidad: linea.cantidades[col.idTalla] ?? 0 }))
          .filter((t) => t.cantidad > 0);
        return {
          ...(idExistente === undefined ? {} : { id: idExistente }),
          idColor: linea.idColor,
          tallas: tallasCuerpo,
        };
      }),
    };
    guardar.mutate(
      { id: orden.id, cuerpo },
      {
        onSuccess: () => toast.success('Matriz guardada.'),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  if (ficha.isError) {
    return <p className="text-sm text-destructive">{ficha.error.message}</p>;
  }

  return (
    <div className="space-y-3">
      <MatrizColorTalla
        tallas={columnas}
        lineas={lineas}
        coloresDisponibles={coloresDisponibles}
        tallasDisponibles={tallasDisponibles}
        onLineasChange={setLineas}
        onTallasChange={setColumnas}
        soloLectura={soloLectura}
        testid="matriz-orden"
      />

      {!soloLectura ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={alGuardar}
            disabled={guardar.isPending}
            data-testid="guardar-matriz"
          >
            {guardar.isPending ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <SaveIcon aria-hidden />
            )}
            Guardar matriz
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={alCopiarMatriz}
            data-testid="abrir-copiar-matriz"
          >
            <CopyIcon aria-hidden />
            Copiar matriz de otra orden
          </Button>
        </div>
      ) : null}
    </div>
  );
}
