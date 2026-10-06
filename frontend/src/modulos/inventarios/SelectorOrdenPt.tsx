import { useState } from 'react';

import {
  AvisoCerradasOcultas,
  InterruptorCerradas,
} from '@/components/dominio/InterruptorCerradas';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { SelectNativo } from '@/components/ui/native-select';

import { SIN_ORDEN, type OpcionOrdenExistencia } from './matriz-inventario';

/**
 * Selector de la ORDEN de la que salen las piezas al mover PT a mano (§Post-F9.40, opción 1 de
 * Daniel). La existencia de PT es por modelo×color×talla×ORDEN×almacén (F6-E2: el recibo de maquila
 * etiqueta cada pieza con la orden que la produjo), así que el movimiento manual y el traspaso
 * tienen que decir de QUÉ bucket sacan.
 *
 * Ofrece SOLO órdenes del modelo que tienen movimientos de PT —no el catálogo entero de órdenes—
 * más el bucket «sin orden», que es donde cae lo capturado a mano en el arranque y lo migrado.
 * Presentación pura (A1): el servidor valida el no-negativo contra el bucket elegido.
 *
 * `modo` distingue los dos usos de la misma pantalla:
 *  • `'salida'`: solo órdenes CON PIEZAS en ese almacén, y se muestra cuántas (ese saldo SÍ es el
 *    tope que el servidor va a validar).
 *  • `'entrada'`: también las órdenes cuyo bucket quedó en CERO (volver del estampado a la orden de
 *    la que salieron), y NO se muestran piezas: en una entrada el disponible no es un tope, y
 *    anunciar "0 pzas" junto a la orden se leería como que no se puede elegir.
 *
 * Si las existencias NO se pudieron leer, se DICE y se ofrece reintentar; el selector queda
 * únicamente con «sin orden» (una opción explícita del usuario, no un relleno): un dato vacío se
 * nota, uno equivocado no.
 *
 * ⭐⭐ 0.227 (§Post-F9.244, etapa 2) — **las órdenes CERRADAS se ocultan por omisión**: mover o traspasar
 * PT es CAPTURA, y una cerrada no admite movimientos (el servidor lo rechaza, etapa 1). Aquí el filtro
 * va en el CLIENTE a propósito: la lista NO es una página de resultados de una búsqueda, son TODOS
 * los buckets del artículo que ya llegaron (con su propio aviso de tope, fila 0.143) ⇒ ocultar no
 * esconde nada que el servidor no haya mandado, y lo oculto se CUENTA y se nombra en el aviso. Con
 * el interruptor «Mostrar cerradas» vuelven (marcadas «· Cerrada») y elegir una sigue avisando y
 * apagando el guardar como en la etapa 1. Lo ya elegido nunca desaparece del desplegable: si al
 * apagar el interruptor la orden elegida era cerrada, se vuelve a «sin orden» (nunca se manda una
 * orden que la pantalla no muestra).
 */
export function SelectorOrdenPt({
  id,
  opciones,
  valor,
  alCambiar,
  modo = 'salida',
  deshabilitado = false,
  cargando = false,
  hayError = false,
  alReintentar,
  etiqueta = 'Orden de producción',
  ayuda,
  testid = 'selector-orden-pt',
}: {
  id: string;
  opciones: readonly OpcionOrdenExistencia[];
  valor: string;
  alCambiar: (valor: string) => void;
  modo?: 'salida' | 'entrada';
  deshabilitado?: boolean;
  cargando?: boolean;
  hayError?: boolean;
  alReintentar?: () => void;
  etiqueta?: string;
  ayuda?: string | undefined;
  testid?: string;
}): React.JSX.Element {
  const [mostrarCerradas, setMostrarCerradas] = useState(false);
  // El bucket «sin orden» siempre se ofrece: existe aunque hoy esté en cero (es donde entra lo que
  // se captura a mano). Las órdenes vienen de los movimientos reales del modelo.
  const todasConOrden = opciones.filter((o) => o.idOrden !== null);
  const sinOrden = opciones.find((o) => o.idOrden === null);
  // 0.227: las CERRADAS fuera por omisión (se cuentan y se nombran en el aviso de abajo).
  const cerradas = todasConOrden.filter((o) => o.ordenCerrada === true);
  const ocultas = mostrarCerradas ? [] : cerradas;
  const conOrden = mostrarCerradas
    ? todasConOrden
    : todasConOrden.filter((o) => o.ordenCerrada !== true);
  const esEntrada = modo === 'entrada';
  /** Sufijo " · N pzas" — solo en la SALIDA, donde ese saldo es de verdad el tope. */
  const piezas = (existencia: number): string =>
    esEntrada ? '' : ` · ${existencia.toLocaleString('es-MX')} pzas`;

  function cambiarMostrarCerradas(activo: boolean): void {
    setMostrarCerradas(activo);
    // Lo elegido nunca queda fuera del desplegable: si era una cerrada, vuelve a «sin orden».
    if (!activo && cerradas.some((o) => String(o.idOrden) === valor)) {
      alCambiar(SIN_ORDEN);
    }
  }

  return (
    <Field>
      <FieldLabel htmlFor={id}>{etiqueta}</FieldLabel>
      <SelectNativo
        id={id}
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        disabled={deshabilitado}
        data-testid={testid}
      >
        <option value={SIN_ORDEN}>
          Sin orden
          {sinOrden === undefined ? '' : piezas(sinOrden.existencia)}
        </option>
        {conOrden.map((o) => (
          <option key={o.idOrden ?? 0} value={String(o.idOrden)}>
            Orden {o.folioOrden ?? o.idOrden}
            {piezas(o.existencia)}
            {/* Sólo con «Mostrar cerradas» encendido (0.227): la cerrada se ve marcada, y si se
                elige la pantalla avisa y apaga el guardar (0.226b). */}
            {o.ordenCerrada === true ? ' · Cerrada' : ''}
          </option>
        ))}
      </SelectNativo>
      <InterruptorCerradas
        activo={mostrarCerradas}
        alCambiar={cambiarMostrarCerradas}
        deshabilitado={deshabilitado}
        testid={`${testid}-mostrar-cerradas`}
      />
      {/* 0.227: lo oculto se DICE (nunca un «no hay órdenes» mudo cuando sí las hay, cerradas). */}
      <AvisoCerradasOcultas
        folios={ocultas.map((o) => o.folioOrden ?? o.idOrden ?? '—')}
        total={ocultas.length}
        testid={`${testid}-aviso-cerradas`}
      />
      {hayError ? (
        <p className="text-xs text-destructive" role="alert" data-testid={`${testid}-error`}>
          No se pudieron leer las existencias: no se puede saber de qué órdenes hay piezas.{' '}
          {alReintentar !== undefined ? (
            <button type="button" className="underline" onClick={alReintentar}>
              Reintentar
            </button>
          ) : null}
        </p>
      ) : cargando ? (
        <FieldDescription>Buscando de qué órdenes hay piezas…</FieldDescription>
      ) : conOrden.length === 0 && ocultas.length > 0 ? null : conOrden.length === 0 ? (
        <FieldDescription>
          {ayuda ??
            (esEntrada
              ? 'Este modelo no tiene órdenes con movimientos de PT: la entrada cae en el bucket «sin orden».'
              : 'No hay piezas etiquetadas con una orden aquí: el movimiento sale del bucket «sin orden».')}
        </FieldDescription>
      ) : (
        <FieldDescription>
          {ayuda ??
            (esEntrada
              ? 'A qué producción REGRESAN las piezas (incluye órdenes cuyo saldo quedó en cero).'
              : 'De qué producción salen las piezas (solo las que tienen existencia aquí).')}
        </FieldDescription>
      )}
    </Field>
  );
}
