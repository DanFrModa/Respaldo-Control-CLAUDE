import { useState } from 'react';

import { useModelos, type Modelo } from '@/api/modelos';
import { ComboboxBuscable, OpcionRica } from '@/components/dominio/ComboboxBuscable';
import { useDebounce } from '@/lib/useDebounce';

/**
 * SELECTOR DE MODELO reutilizable (F3-E3, pulido R9): combobox con búsqueda server-side por código
 * o descripción; al elegir emite el modelo completo. Lo usan las pantallas de movimientos,
 * traspasos, kardex y existencias para fijar el modelo sobre el que se opera. La lista vive en el
 * POPOVER del {@link ComboboxBuscable} unificado del kit (modo `busquedaServidor`: anti-carrera,
 * no infla el layout del toolbar). Presentación pura (A1): solo consulta y emite.
 *
 * ⚠️ **Busca en los DOS catálogos (`origen: 'todos'`) a propósito** (V1-E3n). Nació así porque el
 * default del API era `produccion` —§Post-F9.34 punto 2 habla del **catálogo y la galería**, lo que se
 * NAVEGA, y ahí Daniel no quería "basura"—, y esto es otra cosa: un buscador donde alguien TECLEA un
 * código que ya conoce; si escondiera los de desarrollo, ligar un modelo de desarrollo a un proyecto o
 * mover una muestra de PT sería imposible sin explicación. **Desde V1-E8j (§Post-F9.134) el default del
 * API ya es `todos`**, así que este valor dejó de ser necesario y se queda como CANDADO: es explícito,
 * y lo fija una prueba (`origen-buscadores.test.tsx`), para que un default futuro no vuelva a acotarlo.
 * Las opciones marcan cuál es de desarrollo.
 *
 * ⭐ **`recientesPrimero` — EL ORDEN DE ARRANQUE ES UNA DECISIÓN DE NEGOCIO, Y NO ES LA MISMA PARA
 * TODOS (fila 0.209).** Default: por código, como siempre. Quien captura algo que va a producirse lo
 * enciende. **Daniel, 19-sep-2026:** *«todos los modelos que ya están dados de alta no se van a
 * volver a repetir… Un modelo que se repite, usualmente se repite en un lapso máximo de unos 6
 * meses. Pasado ese tiempo, el modelo no vuelve a repetirse nunca más.»*
 *
 * 🔴 **Por qué el orden por código es dañino ahí:** los de PRODUCCIÓN son 5 dígitos
 * (`codigoDeNumeroProduccion`) y los de DESARROLLO llevan letras (`CYA-26-71-001`), y en orden de
 * texto los dígitos van **antes** que las letras ⇒ los ~4,987 migrados de Access ocupan la primera
 * página entera y la agotan mucho antes de la primera letra. 📌 Es el patrón: *una decisión
 * razonable se vuelve dañina cuando cambia el tamaño del dato, y nada avisa, porque el orden no
 * estaba fechado ni justificado contra un número real.*
 *
 * ⛔ **FRONTERA QUE NO HAY QUE CRUZAR (Daniel, 19-sep-2026):** la regla de los 6 meses habla de
 * **reusar un modelo de producción tal cual**, NO de copiar la receta de uno de desarrollo. De eso
 * dijo lo contrario: *«es importante siempre poder jalar un modelo de desarrollo aunque sea muy
 * viejo… todos los modelos que generemos acá de desarrollo deberían de tener la posibilidad de poder
 * copiarlos en cualquier momento del futuro»*. ⇒ **copiar receta (`CopiarBomDialogo`) NO lleva este
 * orden**, y en ningún sitio se filtra por antigüedad: se ORDENA, nunca se OCULTA.
 *
 * ⚠️ **Y el orden NO es la garantía: la garantía es el BUSCADOR.** Lo que hace alcanzable a
 * cualquiera de los ~5,400 es que lo tecleado viaja al servidor; el orden sólo decide qué se ve sin
 * teclear. Un arreglo que dependiera del orden volvería a romperse en cuanto crezca el catálogo.
 *
 * ⚠️ **Límite conocido y ASUMIDO:** los modelos que entraron por el ETL de Access no traen su fecha
 * real — nada fija `creadoEn` en el camino de migración, así que toman el `@default(now())` del
 * momento en que corrió el ETL y quedan **empatados** entre sí. El orden sólo es informativo de
 * verdad para lo que se capture de aquí en adelante (`CLAUDE.md` REGLA 0-B: *lo nuevo se hace bien;
 * lo viejo no se compensa*).
 */
export function SelectorModelo({
  idSeleccionado,
  codigoSeleccionado,
  alSeleccionar,
  alLimpiar,
  deshabilitado = false,
  invalido = false,
  recientesPrimero = false,
  etiqueta = 'Buscar modelo',
  idInput,
  testid = 'selector-modelo',
  origen = 'todos',
}: {
  idSeleccionado: number | undefined;
  /**
   * Código del modelo ya seleccionado cuando NO cae en la página de la búsqueda (edición,
   * deep-link). Sin esto el campo se ve VACÍO aunque por dentro sí haya modelo elegido: con
   * typeahead server-side la primera página trae 8 códigos y el guardado casi nunca está entre
   * ellos. Es el mismo cuidado que `SelectorColor.nombreSeleccionado` (fila 0.192).
   */
  codigoSeleccionado?: string | undefined;
  alSeleccionar: (modelo: Modelo) => void;
  /** Si viene, el combobox muestra ✕ para limpiar la selección (uso como filtro). */
  alLimpiar?: () => void;
  /** Apaga el selector cuando la pantalla no deja operar (sin permiso, guardando…). */
  deshabilitado?: boolean;
  /** Marca el campo como inválido (`aria-invalid`) cuando la pantalla ya pinta su error. */
  invalido?: boolean;
  /**
   * Ordena la lista de arranque por «lo más reciente primero» en vez de por código. **Lo enciende
   * quien captura algo que va a producirse** (hoy, el renglón del pedido) — ver el encabezado del
   * módulo. Default `false`: orden alfabético por código, que es lo que quieren las pantallas de
   * inventario y de consulta.
   */
  recientesPrimero?: boolean;
  /**
   * Etiqueta accesible del input. Se parametriza porque el selector dejó de vivir sólo en
   * toolbars de una sola instancia: en el editor de renglones del pedido hay UNO POR FILA, y
   * «Buscar modelo» repetido N veces no identifica a ninguno.
   */
  etiqueta?: string;
  /** `id` del input, para que un `<label htmlFor>` externo lo enfoque (formularios con Field). */
  idInput?: string | undefined;
  testid?: string;
  /** Catálogo(s) donde buscar. Default `todos` — ver el encabezado del módulo. */
  origen?: 'produccion' | 'desarrollo' | 'todos';
}): React.JSX.Element {
  const [texto, setTexto] = useState('');
  const busqueda = useDebounce(texto.trim(), 300);
  const consulta = useModelos({
    pagina: 1,
    porPagina: 8,
    ...(recientesPrimero
      ? { ordenarPor: 'creadoEn' as const, direccion: 'desc' as const }
      : { ordenarPor: 'codigo' as const, direccion: 'asc' as const }),
    origen,
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  const modelos = consulta.data?.datos ?? [];
  /**
   * Lo TECLEADO aún no está resuelto (debounce en vuelo o consulta cargando): el combobox no debe
   * ofrecer las opciones viejas — clickearlas seleccionaba el modelo EQUIVOCADO (carrera del e2e).
   *
   * 🔴 **`isFetching` es imprescindible, y `isPending` NO basta** (fila 0.209). `useModelos` va con
   * `placeholderData: keepPreviousData` (`api/modelos.ts`), así que en cuanto el debounce dispara la
   * búsqueda NUEVA la consulta deja de estar «pendiente» —sigue teniendo los datos de la anterior— y
   * `isPending` se apaga: sin esta mitad, la página ANTERIOR queda clickeable durante todo el viaje
   * al servidor. Es exactamente lo que ya documenta su hermano `SelectorColor` contra el mismo kit;
   * que dos selectores se comporten distinto es la asimetría que dentro de un mes nadie sabe
   * explicar. Muerde de verdad desde que este selector captura RENGLONES DE PEDIDO: ahí elegir el
   * modelo equivocado no es un filtro mal puesto, es un pedido mal capturado.
   */
  const resolviendo = texto.trim() !== busqueda || consulta.isPending || consulta.isFetching;

  return (
    <ComboboxBuscable
      opciones={modelos.map((m) => ({ ...m, nombre: m.codigo }))}
      valor={idSeleccionado ?? null}
      {...(codigoSeleccionado === undefined ? {} : { etiquetaSeleccion: codigoSeleccionado })}
      onChange={(id) => {
        if (id === null) {
          alLimpiar?.();
          return;
        }
        const modelo = modelos.find((m) => m.id === id);
        if (modelo !== undefined) {
          alSeleccionar(modelo);
        }
      }}
      alCambiarTexto={setTexto}
      busquedaServidor
      renderOpcion={(o) => (
        <OpcionRica
          principal={o.codigo}
          secundario={
            o.origen === 'desarrollo'
              ? `Desarrollo · ${o.descripcion ?? 'sin descripción'}`
              : o.descripcion
          }
        />
      )}
      mensajeError={consulta.isError ? consulta.error.message : undefined}
      conLupa
      permitirLimpiar={alLimpiar !== undefined}
      cargando={resolviendo}
      deshabilitado={deshabilitado}
      invalido={invalido}
      placeholder="Buscar modelo por código o descripción…"
      etiqueta={etiqueta}
      textoVacio="No hay modelos que coincidan."
      testid={testid}
      testidInput={`${testid}-busqueda`}
      idInput={idInput}
    />
  );
}
