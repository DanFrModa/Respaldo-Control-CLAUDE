/**
 * Utilidades compartidas de las pantallas de LA CORRIDA SEMANAL DE PAGOS (fila 0.113). Viven aparte
 * de los componentes para no mezclar exportaciones de funciones con las de componentes (regla
 * fast-refresh).
 */
import type { CorridaResumen, FilaCorrida, RenglonCorrida, TotalesPago } from '@/api/tipos';

/**
 * Formatea un importe en pesos (o "—" si es `null`). El servidor manda `null` cuando el usuario NO
 * tiene `consultas.ver-importes`: "—" ES el ocultamiento de importes.
 */
export function moneda(monto: number | null | undefined): string {
  if (monto === null || monto === undefined) {
    return '—';
  }
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto);
}

/** Etiquetas de las secciones de la relación (el orden lo manda el servidor). */
export const ETIQUETA_RUBRO: Record<string, string> = {
  maquila: 'Maquileros',
  proveedores: 'Proveedores',
  nomina: 'Nómina por fuera',
  servicios: 'Servicios',
  caja_chica: 'Caja chica',
  otros: 'Otros',
};

/** Etiquetas de la forma de pago. */
export const ETIQUETA_FORMA: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
};

/** Etiquetas del estado de una corrida. */
export const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: 'Borrador',
  cerrada: 'Cerrada',
  ejecutada: 'Ejecutada',
};

/** Cómo se llama cada relación, en las palabras de Daniel. */
export function nombreSegmento(conFactura: boolean): string {
  return conFactura ? 'Con factura' : 'Sin factura';
}

/** Título humano de una corrida: «Semana del 31-ago · Sin factura (folio 12)». */
export function tituloCorrida(c: CorridaResumen): string {
  return `Semana del ${c.semana} · ${nombreSegmento(c.conFactura)} · folio ${String(c.folio)}`;
}

/** El lunes de la semana de una fecha, en `YYYY-MM-DD` (para proponer la corrida de esta semana). */
export function lunesDeLaSemana(fecha: Date): string {
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  const dia = d.getUTCDay(); // 0 = domingo … 6 = sábado
  d.setUTCDate(d.getUTCDate() + (dia === 0 ? -6 : 1 - dia));
  return d.toISOString().slice(0, 10);
}

/**
 * El texto del resumen de totales: efectivo y transferencia POR SEPARADO, que es como Daniel cierra
 * su relación (*«30,000 efectivo + 108,201 transferencia»*).
 */
export function textoTotales(t: TotalesPago): string {
  return `${moneda(t.efectivo)} efectivo · ${moneda(t.transferencia)} transferencia · total ${moneda(
    t.total,
  )}`;
}

/**
 * ¿Esta fila tiene algo capturado? Decide si el renglón se pinta destacado en la tabla. Se mide por
 * el CONTEO de renglones y no por el importe: con los importes ocultos (`consultas.ver-importes`)
 * el monto viaja en `null` y aun así hay que ver que ahí ya se decidió algo.
 */
export function tieneCaptura(fila: FilaCorrida): boolean {
  return fila.renglones.length > 0;
}

/**
 * Lo que va en la columna de REFERENCIA de una fila, según su sección. NUNCA es el número que se
 * paga (§Post-F9.189(b)): es lo que Daniel mira para decidir.
 *
 *  • maquileros → saldo, lo que espera revisión y lo recibido en la semana;
 *  • proveedores → saldo y la parte vencida;
 *  • conceptos → nada (nacen en cero).
 */
export function textoReferencia(fila: FilaCorrida): string {
  if (fila.origen === 'concepto') {
    return '';
  }
  const partes: string[] = [];
  if (fila.origen === 'maquila') {
    if (fila.porRevisarPartidas > 0) {
      partes.push(
        `por revisar ${moneda(fila.porRevisarNeto)} (${String(fila.porRevisarPartidas)} ${
          fila.porRevisarPartidas === 1 ? 'partida' : 'partidas'
        })`,
      );
    }
    if (fila.recibosSemanaCantidad > 0) {
      partes.push(
        `recibió ${new Intl.NumberFormat('es-MX').format(fila.recibosSemanaCantidad)} pzas ` +
          `(${moneda(fila.recibosSemanaImporte)})`,
      );
    }
    return partes.join(' · ');
  }
  if (fila.vencido !== null && fila.vencido !== 0) {
    partes.push(`vencido ${moneda(fila.vencido)}`);
  }
  return partes.join(' · ');
}

/**
 * ⭐ EL VALOR DEL CAMPO «a pagar esta semana», derivado SÓLO del renglón capturado.
 *
 * Es la regla más importante de esta pantalla y por eso vive aquí, como función pura y medible:
 * §Post-F9.189(b), *«yo voy decidiendo los montos a pagar de cada uno. Manualmente»*. El saldo, lo
 * que espera revisión, lo vencido y lo recibido en la semana están AL LADO para que Daniel decida —
 * **jamás** para llenarle el campo. Un campo pre-llenado con el saldo convierte «decidir» en
 * «aceptar», que es exactamente lo contrario de lo que pidió.
 *
 * 🔴 **Por qué es una función y no una expresión dentro del componente.** Lo era, y la mutación que
 * la hacía leer `fila.saldo` **sobrevivía**: el `useEffect` que resincroniza con el servidor
 * corregía el valor en el mismo tick y la prueba del DOM sólo veía el resultado ya corregido. O
 * sea, la prueba medía el efecto, no la regla — y el defecto real (un parpadeo con el saldo dentro
 * de un campo de dinero) se colaba. Extraída, la regla se puede romper y la prueba se pone roja.
 *
 * Devuelve TEXTO, no número: un `number` obligaría a decidir qué es `''` y convertiría un campo a
 * medio escribir en un `0` que parece una decisión tomada. Y `null` (importes ocultos) también sale
 * vacío: no se inventa un cero donde el servidor dijo «no puedes ver esto».
 */
export function montoEditable(renglon: RenglonCorrida | null): string {
  if (renglon === null || renglon.monto === null) {
    return '';
  }
  return String(renglon.monto);
}
