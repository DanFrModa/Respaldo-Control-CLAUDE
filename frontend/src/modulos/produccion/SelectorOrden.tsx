import { useState } from 'react';

import { useOrdenes } from '@/api/ordenes';
import type { Orden } from '@/api/tipos';
import { ComboboxBuscable, OpcionRica } from '@/components/dominio/ComboboxBuscable';
import { useDebounce } from '@/lib/useDebounce';

/**
 * SELECTOR DE ORDEN reutilizable (F3-E2, pulido R9): busca órdenes VIVAS (todas menos las
 * canceladas) por folio, modelo, cliente o referencia, y al elegir una emite su id. Lo usan las
 * pantallas de corte, envío, recibo, entrega, salida de tela, nota de salida de tela y alta de
 * auditoría para fijar la orden sobre la que se captura. La lista de resultados vive en el POPOVER
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
 */
export function SelectorOrden({
  idSeleccionada,
  alSeleccionar,
  testid = 'selector-orden',
}: {
  idSeleccionada: number | undefined;
  alSeleccionar: (orden: Orden) => void;
  testid?: string;
}): React.JSX.Element {
  const [texto, setTexto] = useState('');
  const busqueda = useDebounce(texto.trim(), 300);
  const consulta = useOrdenes({
    pagina: 1,
    porPagina: 8,
    incluirCanceladas: 'false',
    ordenarPor: 'folio',
    direccion: 'desc',
    ...(busqueda.length > 0 ? { busqueda } : {}),
  });

  const ordenes = consulta.data?.datos ?? [];
  // Lo TECLEADO aún no está resuelto (debounce en vuelo o consulta cargando): el combobox no debe
  // ofrecer las opciones viejas — clickearlas seleccionaba la orden EQUIVOCADA (carrera del e2e).
  const resolviendo = texto.trim() !== busqueda || consulta.isPending;

  return (
    <ComboboxBuscable
      opciones={ordenes.map((o) => ({ ...o, nombre: `Orden #${o.folio}` }))}
      valor={idSeleccionada ?? null}
      onChange={(id) => {
        const orden = ordenes.find((o) => o.id === id);
        if (orden !== undefined) {
          alSeleccionar(orden);
        }
      }}
      alCambiarTexto={setTexto}
      busquedaServidor
      renderOpcion={(o) => (
        <OpcionRica
          principal={`Orden #${o.folio}`}
          secundario={`${o.codigoModelo} · ${o.cliente} · ${o.totalPiezas} pzas`}
        />
      )}
      mensajeError={consulta.isError ? consulta.error.message : undefined}
      conLupa
      // La orden es el campo REQUERIDO de estas capturas: se cambia eligiendo otra, no se "des-elige".
      permitirLimpiar={false}
      cargando={resolviendo}
      placeholder="Buscar orden por folio, modelo, cliente o referencia…"
      etiqueta="Buscar orden"
      textoVacio="No hay órdenes que coincidan."
      testid={testid}
      testidInput={`${testid}-busqueda`}
    />
  );
}
