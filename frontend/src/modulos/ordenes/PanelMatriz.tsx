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

/**
 * Construye las filas iniciales de la matriz a partir de las líneas que ya trae la orden. Una fila
 * por RENGLÓN (color × pack, §Post-F9.10): con dos tendidos del mismo color son dos filas.
 */
function filasDesdeOrden(orden: Orden): MatrizLinea[] {
  return orden.lineas.map((linea) => ({
    idColor: linea.idColor,
    color: linea.color,
    pack: linea.pack,
    cantidades: Object.fromEntries(linea.tallas.map((t) => [t.idTalla, t.cantidad])),
  }));
}

/** Llave de identidad de un renglón de la matriz: color × pack (la misma del `@@unique` de la tabla). */
function claveRenglon(idColor: number, pack: string | undefined): string {
  return `${idColor}:${pack ?? ''}`;
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
 * Color + PACK + tallas con cantidad de un renglón, sin ids de fila (el CONTENIDO que captura el
 * usuario).
 *
 * 🔑 EL PACK ENTRA EN EL CONTENIDO, y no es decorativo: de aquí sale la FIRMA con la que el diálogo
 * decide si hay cambios sin guardar. Si el pack quedara fuera, cambiarle el tendido a un renglón
 * —sin tocar una sola cantidad— no marcaría la sección como sucia y el cambio se perdería al
 * cerrar, sin aviso.
 */
function contenido(
  lineas: MatrizLinea[],
  columnas: MatrizTalla[],
): { idColor: number; pack: string; tallas: { idTalla: number; cantidad: number }[] }[] {
  return lineas.map((linea) => ({
    idColor: linea.idColor,
    // RECORTADO, igual que `normalizarPack` en el dominio: para el servidor `"A"` y `" A "` son el
    // MISMO tendido. Si aquí no se recortara, la llave de renglón de abajo no casaría con la que
    // devuelve el servidor y un renglón existente se mandaría como nuevo.
    pack: (linea.pack ?? '').trim(),
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
  // 🔴 EL ÍNDICE ES POR COLOR × PACK (§Post-F9.10). Indexado sólo por color, dos tendidos del mismo
  // color recibían EL MISMO `id` de renglón: el backend actualizaría el mismo `OrdenLinea` dos
  // veces, la segunda pisando a la primera, y el otro tendido desaparecería de la matriz sin que
  // nada lo dijera. En una orden sin packs el índice es idéntico al de siempre (todos con pack '').
  const porRenglon = new Map(orden.lineas.map((l) => [claveRenglon(l.idColor, l.pack), l.id]));
  return {
    lineas: contenido(lineas, columnas).map((linea) => {
      const idExistente = porRenglon.get(claveRenglon(linea.idColor, linea.pack));
      return { ...(idExistente === undefined ? {} : { id: idExistente }), ...linea };
    }),
  };
}

/**
 * ⭐ LOS DOS ESTADOS DE CAPTURA QUE §Post-F9.10 HACE POSIBLES Y EL SERVIDOR RECHAZA, derivados de
 * lo tecleado. Devuelve el motivo a enseñar, o `null` si la matriz es mandable.
 *
 * ⚠️ NO son todo lo que `sincronizarMatriz` rechaza —también rechaza un color desactivado y
 * re-empacar un color que ya tiene producción viva (los dos, con un 409)—, y a propósito: esos
 * dependen de datos que la pantalla no tiene (si el color se desactivó después, si la orden ya
 * tiene movimientos vivos), así que se contestan desde el servidor. Aquí sólo se adelantan los dos
 * que se leen de lo tecleado.
 *
 * 🔴 POR QUÉ EXISTE. Con tendidos, «agregar color» pone una fila SIN pack (es la única manera de
 * estrenar el segundo tendido: primero la fila, luego su letra). Eso deja, a propósito, dos estados
 * intermedios que `sincronizarMatriz` rechaza con un 400:
 *   • MEZCLADA — unos renglones con pack y otros sin. Es el estado normal justo después de agregar
 *     la fila, mientras el usuario no le ha escrito su letra.
 *   • REPETIDA — el mismo `(color, pack)` dos veces. Con packs, el combobox deja de esconder los
 *     colores ya usados (tiene que hacerlo), así que elegir dos veces el mismo color produce dos
 *     renglones `(color, '')` — el duplicado que la llave única de la tabla prohíbe.
 * Sin esto, «Guardar» quedaba encendido y el usuario se comía el 400 con la matriz ya tecleada; es
 * el MISMO estándar que el pre-chequeo del exceso en la captura de avance (`AvanceProduccion`).
 *
 * 🔑 NO se "arregla" el estado (no se rellena un pack ni se descarta la fila): se DECLARA inválido
 * y se bloquea el botón. La captura sigue siendo del usuario, y sigue marcada como sucia.
 */
function impedimentoDeLaMatriz(lineas: MatrizLinea[]): string | null {
  // Recortado, igual que `normalizarPack` del dominio: quien decide si dos packs son el mismo es el
  // servidor, y aquí se hace su misma pregunta (si no, `"A"` y `" A "` pasarían por distintos).
  const packs = lineas.map((l) => (l.pack ?? '').trim());
  if (packs.some((p) => p !== '') && packs.some((p) => p === '')) {
    return 'Falta el pack de algún renglón: o todos llevan pack, o ninguno.';
  }
  const claves = lineas.map((l, i) => claveRenglon(l.idColor, packs[i]));
  if (new Set(claves).size !== claves.length) {
    return packs.some((p) => p !== '')
      ? 'Hay dos renglones con el mismo color y pack: cámbiale el pack a uno.'
      : 'Hay dos renglones del mismo color: quita uno, o dale su pack a cada uno.';
  }
  return null;
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
  /**
   * ⭐ ¿ESTA orden se fabrica por TENDIDOS? (§Post-F9.10). Basta con que un renglón traiga pack —la
   * MISMA pregunta que hace el servidor (`packs.ts::ordenManejaPacks`)—. Gobierna DOS cosas: que el
   * combobox deje de esconder los colores ya usados, y que una orden en SOLO LECTURA enseñe su
   * columna de packs. (La columna EDITABLE no cuelga de esto: se ofrece siempre que se pueda editar,
   * porque es la única manera de estrenar tendidos en una orden que todavía no los tiene.)
   *
   * 🔑 Se mira el estado EN CAPTURA (`lineas`), no la orden guardada, y eso sí cambia el
   * comportamiento: en cuanto el usuario teclea el pack del PRIMER renglón, el combobox tiene que
   * dejarle agregar OTRA fila del mismo color para el segundo tendido. Con `orden.lineas` habría
   * que guardar y volver a entrar para poder capturar el segundo.
   */
  const manejaPacks = useMemo(() => lineas.some((l) => (l.pack ?? '') !== ''), [lineas]);
  /**
   * Los colores que YA están en la matriz (el combobox del alta al vuelo no los ofrece).
   *
   * ⚠️ VACÍO cuando la orden maneja packs: ahí el segundo tendido del Negro es otra fila del MISMO
   * color, y ocultarlo lo dejaría sin manera de capturarse.
   */
  const idsColoresUsados = useMemo(
    () => (manejaPacks ? new Set<number>() : new Set(lineas.map((l) => l.idColor))),
    [lineas, manejaPacks],
  );

  // R2-9: contador de AGREGADOS para remontar el combobox del alta al vuelo. Un contador
  // propio y no `lineas.length`: quitar una fila también cambia el length y remontaría el
  // combobox sin necesidad (perdiendo lo tecleado a media búsqueda).
  const [vecesAgregado, setVecesAgregado] = useState(0);

  /**
   * Agrega la fila de un color (elegido del catálogo o recién creado al vuelo).
   *
   * 🔴 CON TENDIDOS, EL COLOR REPETIDO SÍ ENTRA (§Post-F9.10). La guarda «si ya está, no lo
   * agregues» sigue en pie para las órdenes sin packs —ahí un color dos veces es el duplicado que
   * el servidor rechaza—, pero en una orden por tendidos el segundo Negro es OTRA fila del mismo
   * color. Sin este `manejaPacks`, el combobox ofrecía el color (porque `idsColoresUsados` va vacío)
   * y al elegirlo NO PASABA NADA: un botón que no hace nada y no dice por qué.
   */
  const agregarColorFila = useCallback(
    (idColor: number, nombre: string): void => {
      setLineas((previas) =>
        !manejaPacks && previas.some((l) => l.idColor === idColor)
          ? previas
          : [...previas, { idColor, color: nombre, cantidades: {} }],
      );
      setVecesAgregado((n) => n + 1);
    },
    [setLineas, manejaPacks],
  );
  const tallasDisponibles = useMemo(
    () => (tallas.data?.datos ?? []).map((t) => ({ idTalla: t.id, etiqueta: t.etiqueta })),
    [tallas.data],
  );

  // ¿Hay cambios sin guardar? Se compara el contenido capturado contra la firma con que se cargó.
  const cuerpo = useMemo(() => construirCuerpo(lineas, columnas, orden), [lineas, columnas, orden]);
  const sucio = firmaCargada !== null && firmaMatriz(lineas, columnas) !== firmaCargada;
  // ⭐ ¿Lo capturado es MANDABLE? (§Post-F9.10) Ver `impedimentoDeLaMatriz`. En solo lectura no hay
  // nada que mandar, así que tampoco hay nada que impedir.
  const impedimento = soloLectura ? null : impedimentoDeLaMatriz(lineas);

  // Guardado ÚNICO del diálogo: se captura el cuerpo AHORA y se devuelve el ejecutor.
  const idOrden = orden.id;
  const preparar = useCallback((): Promise<EjecutorGuardado | null> => {
    // La sección NO arma su guardado mientras la captura sea inválida: el botón ya está apagado,
    // y esto lo cierra también para cualquier otro camino que dispare el guardado (el contrato de
    // `PrepararGuardado`: `null` = captura inválida, no se manda NADA de ninguna sección).
    if (impedimento !== null) {
      return Promise.resolve(null);
    }
    const capturado = cuerpo;
    return Promise.resolve(async () => {
      await guardar.mutateAsync({ id: idOrden, cuerpo: capturado });
    });
  }, [cuerpo, guardar, idOrden, impedimento]);

  useSeccionGuardable('matriz', 'la matriz', !soloLectura && sucio, preparar, impedimento);

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
        // ⭐ El PACK / TENDIDO por renglón (§Post-F9.10). La columna aparece siempre que se pueda
        // editar: es la ÚNICA manera de ponerle tendidos a una orden capturada a mano, y en las
        // órdenes sin packs se queda vacía (que es lo que significa «sin pack»).
        {...(soloLectura && !manejaPacks
          ? {}
          : {
              onPackChange: (indice: number, pack: string) =>
                setLineas((previas) => previas.map((l, i) => (i === indice ? { ...l, pack } : l))),
            })}
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

      {impedimento !== null ? (
        // El motivo también sale en el PIE del diálogo (es lo que apaga «Guardar»), pero aquí es
        // donde el usuario está mirando: junto a los renglones que hay que arreglar.
        <p
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
          data-testid="matriz-orden-aviso-invalida"
        >
          {impedimento} No se puede guardar así: el servidor lo rechazaría.
        </p>
      ) : null}

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
