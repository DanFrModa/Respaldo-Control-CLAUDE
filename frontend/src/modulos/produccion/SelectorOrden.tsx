import { useState } from 'react';

import { useOrdenes } from '@/api/ordenes';
import { useConsultaOrdenes } from '@/api/ordenes-consulta';
import type { Orden } from '@/api/tipos';
import { ComboboxBuscable, OpcionRica } from '@/components/dominio/ComboboxBuscable';
import {
  AvisoCerradasOcultas,
  InterruptorCerradas,
} from '@/components/dominio/InterruptorCerradas';
import { estaCerrada, textoAvisoCerradasOcultas } from '@/lib/orden-cerrada';
import { useDebounce } from '@/lib/useDebounce';

/** Cuántas cerradas se NOMBRAN en el aviso (el resto se cuenta: «y N más»). */
const FOLIOS_EN_AVISO = 5;

/**
 * SELECTOR DE ORDEN reutilizable (F3-E2, pulido R9): busca órdenes VIVAS (todas menos las
 * canceladas) por folio, modelo, cliente o referencia, y al elegir una emite su id. Lo usan TRES
 * pantallas para fijar la orden sobre la que se captura: **entrega a cliente**, **salida de tela por
 * orden** y **alta de auditoría**.
 *
 * ⚠️ **Este docblock listaba SIETE pantallas (corte, envío, recibo, entrega, salida de tela, nota de
 * salida de tela, alta de auditoría) y era FALSO** — corte, envío y recibo viven en
 * `AvanceProduccion.tsx`, que recibe `idOrden: number` como prop: ahí la orden ya viene elegida y no
 * se busca. La lista falsa **ya engañó a alguien**: el 26-sep-2026 se publicó «seis pantallas de
 * captura» en la fila 0.214 citando este comentario como si fuera una medición. Si cambias quién usa
 * este componente, **mide con `grep -rn "SelectorOrden'" frontend/src` y actualiza esta línea** — y su
 * gemela del docblock de `SelectorOrden.test.tsx`, que llevaba la misma lista falsa.
 *
 * La lista de resultados vive en el POPOVER
 * del {@link ComboboxBuscable} unificado del kit (modo `busquedaServidor`: anti-carrera) — antes se
 * pintaba SIEMPRE inline y reventaba el layout de las tarjetas. Presentación pura (A1): solo
 * consulta y emite.
 *
 * ⚠️ NO filtra por `estado: 'completa'` (26-jul-2026). Lo hacía, y era el ÚNICO gate del sistema
 * sobre ese estado: al volverse AUTOMÁTICO (hoy: tallas + receta liberada, y arte si aplica — ver
 * `requisitos-orden.ts`), una orden a la que le faltara cualquiera de esos requisitos —cosa común
 * en lo migrado de Access, que llegó sin receta— dejaba de aparecer aquí y
 * NO se podía cortar, enviar, recibir ni entregar, sin más explicación que un "no hay órdenes que
 * coincidan". El filtro correcto es el mismo que ya usan los demás pickers (MRP, notas por orden,
 * costeo): **fuera las canceladas**, que es lo único que el backend rechaza de verdad
 * (`etapas.ts`, `recibos.ts`, `entregas-cliente.ts`, `precios-orden.ts`). El estado `completa` es
 * informativo (semáforo de captura), NUNCA una llave para operar.
 *
 * ⭐⭐ 0.227 (§Post-F9.244, etapa 2) — **OCULTA LAS CERRADAS POR OMISIÓN, con interruptor y aviso.**
 * Las tres pantallas que lo usan son de CAPTURA (Daniel: *«todas las pantallas donde sean de meter
 * información, ya no deberían aparecer esas órdenes»*), así que el selector pide al SERVIDOR
 * `cerradas: 'ocultar'` —nunca filtra en el cliente una página de resultados, que escondería órdenes
 * sin decirlo—. Y como el precedente de arriba enseñó que un filtro mudo deja órdenes inoperables:
 *  • el interruptor «Mostrar cerradas» está SIEMPRE a la vista y las vuelve a traer (marcadas);
 *  • si lo buscado existe pero está cerrado, se DICE —«La orden N está cerrada: actívala con
 *    “Mostrar cerradas”…»—, en la lista y debajo del buscador, en vez de «no hay coincidencias».
 * Elegir una cerrada con el interruptor encendido funciona como en la etapa 1: la pantalla avisa con
 * `AvisoOrdenCerrada` y apaga el guardar. Cerrada ≠ estado: el filtro mira `cerradaEn` en el servidor.
 */
export function SelectorOrden({
  idSeleccionada,
  alSeleccionar,
  etiquetaSeleccion,
  testid = 'selector-orden',
}: {
  idSeleccionada: number | undefined;
  alSeleccionar: (orden: Orden) => void;
  /**
   * Cómo rotular la orden ya elegida cuando no viene en la página de resultados (llegada por
   * deep-link, o una cerrada elegida antes de apagar el interruptor). Sin esto el buscador se vería
   * vacío con una orden elegida.
   */
  etiquetaSeleccion?: string | undefined;
  testid?: string;
}): React.JSX.Element {
  const [texto, setTexto] = useState('');
  const [mostrarCerradas, setMostrarCerradas] = useState(false);
  // La ÚLTIMA búsqueda escrita (no se borra al salir del buscador): el aviso de cerradas tiene que
  // seguir a la vista después del blur, que es cuando el usuario va a pulsar el interruptor.
  const [ultimaBusqueda, setUltimaBusqueda] = useState('');
  const busqueda = useDebounce(texto.trim(), 300);
  const busquedaAviso = useDebounce(ultimaBusqueda, 300);
  const consulta = useOrdenes({
    pagina: 1,
    porPagina: 8,
    incluirCanceladas: 'false',
    cerradas: mostrarCerradas ? 'incluir' : 'ocultar',
    ordenarPor: 'folio',
    direccion: 'desc',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });
  // Sólo con el interruptor APAGADO y algo escrito: ¿lo buscado existe pero está CERRADO?
  const buscarCerradas = !mostrarCerradas && busquedaAviso.length > 0;
  const consultaCerradas = useConsultaOrdenes(
    {
      pagina: 1,
      porPagina: FOLIOS_EN_AVISO,
      incluirCanceladas: 'false',
      cerradas: 'solo',
      ordenarPor: 'folio',
      direccion: 'desc',
      busqueda: busquedaAviso,
    },
    { habilitado: buscarCerradas },
  );
  // Ni con datos de OTRA búsqueda (placeholder) ni con el interruptor encendido.
  const cerradasQueCoinciden =
    buscarCerradas && consultaCerradas.data !== undefined && !consultaCerradas.isPlaceholderData
      ? consultaCerradas.data
      : undefined;
  const foliosCerrados = cerradasQueCoinciden?.datos.map((o) => o.folio) ?? [];
  const totalCerradas = cerradasQueCoinciden?.total ?? 0;

  const ordenes = consulta.data?.datos ?? [];
  // Lo TECLEADO aún no está resuelto (debounce en vuelo o consulta cargando): el combobox no debe
  // ofrecer las opciones viejas — clickearlas seleccionaba la orden EQUIVOCADA (carrera del e2e).
  const resolviendo = texto.trim() !== busqueda || consulta.isPending;
  const textoVacio = mostrarCerradas
    ? 'No hay órdenes que coincidan.'
    : busqueda === busquedaAviso && totalCerradas > 0
      ? textoAvisoCerradasOcultas(foliosCerrados, totalCerradas)
      : 'No hay órdenes abiertas que coincidan.';

  return (
    <div className="space-y-1.5">
      <ComboboxBuscable
        opciones={ordenes.map((o) => ({ ...o, nombre: `Orden #${o.folio}` }))}
        valor={idSeleccionada ?? null}
        etiquetaSeleccion={etiquetaSeleccion}
        onChange={(id) => {
          const orden = ordenes.find((o) => o.id === id);
          if (orden !== undefined) {
            setUltimaBusqueda('');
            alSeleccionar(orden);
          }
        }}
        alCambiarTexto={(nuevo) => {
          setTexto(nuevo);
          if (nuevo.trim().length > 0) setUltimaBusqueda(nuevo.trim());
        }}
        busquedaServidor
        renderOpcion={(o) => (
          <OpcionRica
            principal={`Orden #${o.folio}`}
            secundario={`${o.codigoModelo} · ${o.cliente} · ${o.totalPiezas} pzas${
              estaCerrada(o) ? ' · Cerrada' : ''
            }`}
          />
        )}
        mensajeError={consulta.isError ? consulta.error.message : undefined}
        conLupa
        // La orden es el campo REQUERIDO de estas capturas: se cambia eligiendo otra, no se "des-elige".
        permitirLimpiar={false}
        cargando={resolviendo}
        placeholder="Buscar orden por folio, modelo, cliente o referencia…"
        etiqueta="Buscar orden"
        textoVacio={textoVacio}
        testid={testid}
        testidInput={`${testid}-busqueda`}
      />
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <AvisoCerradasOcultas
          folios={foliosCerrados}
          total={totalCerradas}
          className="min-w-0 flex-1"
          testid={`${testid}-aviso-cerradas`}
        />
        <InterruptorCerradas
          activo={mostrarCerradas}
          alCambiar={setMostrarCerradas}
          className="ml-auto"
          testid={`${testid}-mostrar-cerradas`}
        />
      </div>
    </div>
  );
}
