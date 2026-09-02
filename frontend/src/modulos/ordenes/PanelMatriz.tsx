import { useQuery } from '@tanstack/react-query';
import { CopyIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
import { useSesion } from '@/sesion/useSesion';

import { AgregarColorMatriz } from './AgregarColorMatriz';
import { useReinicioBloqueado, useSeccionGuardable, type EjecutorGuardado } from './guardado-orden';

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

/** Color + tallas con cantidad de un renglón, sin ids de fila (el CONTENIDO que captura el usuario). */
function contenido(
  lineas: MatrizLinea[],
  columnas: MatrizTalla[],
): { idColor: number; tallas: { idTalla: number; cantidad: number }[] }[] {
  return lineas.map((linea) => ({
    idColor: linea.idColor,
    tallas: columnas
      .map((col) => ({ idTalla: col.idTalla, cantidad: linea.cantidades[col.idTalla] ?? 0 }))
      .filter((t) => t.cantidad > 0),
  }));
}

/**
 * FIRMA del contenido capturado, para saber si hay cambios sin guardar. Deliberadamente NO incluye
 * los ids de renglón: no son dato del usuario y cambian con lo que devuelve el servidor.
 */
function firmaMatriz(lineas: MatrizLinea[], columnas: MatrizTalla[]): string {
  return JSON.stringify(contenido(lineas, columnas));
}

/**
 * Arma el cuerpo del `PUT /matriz` a partir del estado de captura. Conserva el `id` del renglón
 * existente (para que el backend actualice en vez de recrear) y omite las tallas en 0 (no aportan).
 */
function construirCuerpo(
  lineas: MatrizLinea[],
  columnas: MatrizTalla[],
  orden: Orden,
): OrdenMatriz {
  const porColor = new Map(orden.lineas.map((l) => [l.idColor, l.id]));
  return {
    lineas: contenido(lineas, columnas).map((linea) => {
      const idExistente = porColor.get(linea.idColor);
      return { ...(idExistente === undefined ? {} : { id: idExistente }), ...linea };
    }),
  };
}

/**
 * Panel de la MATRIZ color × talla de una orden (F2-E3). Alimenta el componente reutilizable con:
 * los colores del catálogo (filas), las tallas de la CURVA del modelo (columnas iniciales) unidas a
 * las que ya tiene la orden, y el catálogo de tallas para agregar columnas extra. Guarda el set
 * completo con `PUT /matriz`: el backend recalcula el estado en cada guardado con la regla completa
 * (`tallas + receta liberada, y arte si aplica`), así que guardar la matriz no la completa sola.
 *
 * NO tiene botón propio de guardar (Daniel 24-jul-2026): se registra en el guardado ÚNICO del
 * diálogo (`useSeccionGuardable`). Sí conserva "Copiar matriz de otra orden", que NO es una
 * captura pendiente sino una acción con su propio endpoint y su diálogo de confirmación.
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
  // Alta de color AL VUELO (§Post-F9.11): solo se ofrece con el permiso que exige el
  // endpoint de crear color (`colores.administrar`); el backend re-valida (A1).
  const { tienePermiso } = useSesion();
  const puedeCrearColor = tienePermiso('colores.administrar');

  const ficha = useFichaModelo(orden.idModelo);
  const curva = useCurva(ficha.data?.idCurvaTalla ?? null);
  const colores = useColores(QUERY_COLORES);
  const tallas = useTallasActivas();
  const guardar = useGuardarMatriz();

  // Estado local de captura (filas + columnas). Se resetea cuando cambia la orden o llega la curva.
  const [lineas, setLineas] = useState<MatrizLinea[]>(() => filasDesdeOrden(orden));
  const [columnas, setColumnas] = useState<MatrizTalla[]>([]);
  // FIRMA del contenido tal como se cargó del servidor. `null` = todavía no se ha cargado nada, así
  // que no hay contra qué comparar (si no, al abrir se anunciarían cambios que nadie hizo). Es la
  // referencia del "¿hay cambios?" — a propósito NO se deriva de `orden`, que puede refrescarse a
  // media tanda de guardado y dejaría de reflejar lo que el usuario tiene en pantalla.
  const [firmaCargada, setFirmaCargada] = useState<string | null>(null);

  const curvaItems = curva.data?.items ?? [];

  // Mientras se guarda (o tras un guardado a medias) NO se re-inicializa: si no, la respuesta del
  // encabezado tiraría la matriz que el usuario acaba de capturar y aún no se manda.
  const reinicioBloqueado = useReinicioBloqueado();

  // Reinicializa al cambiar de orden o cuando llega la curva (clave estable por id + curva).
  const claveReset = `${orden.id}:${orden.modificadoEn}:${ficha.data?.idCurvaTalla ?? 'sin'}:${curvaItems.length}`;
  useEffect(() => {
    if (reinicioBloqueado) {
      return;
    }
    const filas = filasDesdeOrden(orden);
    const cols = columnasIniciales(orden, curvaItems);
    setLineas(filas);
    setColumnas(cols);
    setFirmaCargada(firmaMatriz(filas, cols));
    // Se reinicia con la clave (no con cada dependencia individual) para no pisar la captura en vivo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveReset, reinicioBloqueado]);

  const coloresDisponibles = useMemo(
    () => (colores.data?.datos ?? []).map((c) => ({ id: c.id, nombre: c.nombre })),
    [colores.data],
  );
  // Los colores que YA están en la matriz (el combobox del alta al vuelo no los ofrece).
  const idsColoresUsados = useMemo(() => new Set(lineas.map((l) => l.idColor)), [lineas]);

  // R2-9: contador de AGREGADOS para remontar el combobox del alta al vuelo. Un contador
  // propio y no `lineas.length`: quitar una fila también cambia el length y remontaría el
  // combobox sin necesidad (perdiendo lo tecleado a media búsqueda).
  const [vecesAgregado, setVecesAgregado] = useState(0);

  /** Agrega la fila de un color (elegido del catálogo o recién creado al vuelo). */
  const agregarColorFila = useCallback(
    (idColor: number, nombre: string): void => {
      setLineas((previas) =>
        previas.some((l) => l.idColor === idColor)
          ? previas
          : [...previas, { idColor, color: nombre, cantidades: {} }],
      );
      setVecesAgregado((n) => n + 1);
    },
    [setLineas],
  );
  const tallasDisponibles = useMemo(
    () => (tallas.data?.datos ?? []).map((t) => ({ idTalla: t.id, etiqueta: t.etiqueta })),
    [tallas.data],
  );

  // ¿Hay cambios sin guardar? Se compara el contenido capturado contra la firma con que se cargó.
  const cuerpo = useMemo(() => construirCuerpo(lineas, columnas, orden), [lineas, columnas, orden]);
  const sucio = firmaCargada !== null && firmaMatriz(lineas, columnas) !== firmaCargada;

  // Guardado ÚNICO del diálogo: se captura el cuerpo AHORA y se devuelve el ejecutor.
  const idOrden = orden.id;
  const preparar = useCallback((): Promise<EjecutorGuardado | null> => {
    const capturado = cuerpo;
    return Promise.resolve(async () => {
      await guardar.mutateAsync({ id: idOrden, cuerpo: capturado });
    });
  }, [cuerpo, guardar, idOrden]);

  useSeccionGuardable('matriz', 'la matriz', !soloLectura && sucio, preparar);

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
        // Combobox con alta de color AL VUELO (§Post-F9.11): busca los existentes EN EL
        // SERVIDOR y, con permiso `colores.administrar`, crea el color aquí mismo y agrega
        // su fila. El `key` (contador de AGREGADOS, R2-9) lo REMONTA tras cada alta: así el
        // texto tecleado no queda pegado después de agregar.
        slotAgregarColor={
          soloLectura ? undefined : (
            <AgregarColorMatriz
              key={vecesAgregado}
              idsUsados={idsColoresUsados}
              alAgregar={agregarColorFila}
              puedeCrear={puedeCrearColor}
            />
          )
        }
      />

      {!soloLectura ? (
        <div className="flex flex-wrap items-center gap-2">
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
