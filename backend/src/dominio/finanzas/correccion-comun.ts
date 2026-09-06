/**
 * PIEZAS COMUNES de la CORRECCIÓN de un movimiento SIN FACTURA (fila 0.145; `DECISIONES.md`
 * §Post-F9.203). Puro: sin base de datos, sin Prisma, sin sesión.
 *
 * Existe porque el acto es el MISMO en los dos libros del proveedor —el motor de terceros (CxP) y
 * EsMa (maquila)— y sus dos implementaciones no pueden contestar distinto a las mismas preguntas:
 * *¿esto es «sin factura»?*, *¿qué valores quedan al final?*, *¿de verdad cambió algo?* y *¿qué se
 * le dice a quien lo intenta y no se puede?*. Cada libro pone lo suyo (el motor compone
 * cancelar+registrar con folio A3; EsMa deshace la aplicación del pago a los cargos); esto es lo que
 * comparten, y vive fuera de los dos para que no haya una copia que se quede atrás.
 */

import type { DatosCorreccionSinFactura } from '../../contrato/index.js';

/** Redondeo monetario a 2 decimales (misma norma que el resto de finanzas). */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * ⭐ ¿El movimiento es SIN FACTURA? Mismo criterio que la partición de siempre
 * (`formula-saldo.ts` §segmento): `false` **o** sin definir. El `null` cuenta como «sin factura» a
 * propósito y no por descuido — es lo que hace `whereSegmentoFactura('sin')`, y así lo migrado con
 * la modalidad vacía se puede corregir igual (REGLA 0-B: el dato viejo se tolera, no se repara).
 */
export function esSinFactura(conFactura: boolean | null): boolean {
  return conFactura !== true;
}

/**
 * ⭐⭐ EL IMPORTE GUARDADO de un movimiento, **SIEMPRE POSITIVO** — la forma en que se captura, la
 * que el cajón de corrección enseña y la que se manda de vuelta (el signo lo pone el servidor por el
 * tipo de movimiento).
 *
 * Existe como helper compartido, y no como una línea repetida en cada proyección, por una regresión
 * real: el motor aplicaba `Math.abs` y **las seis ramas de EsMa no**, así que un movimiento migrado
 * con `monto` NEGATIVO —los *«saldo anterior»* del sistema viejo, que el ETL carga tal cual (ver
 * `dominio/esma/migracion.ts`)— llegaba a la pantalla en negativo. Ahí el cajón lo precargaba, dejaba
 * tocar el importe… y al guardar cortaba con *«Captura un importe mayor a 0»* **aunque el usuario
 * sólo hubiera cambiado la fecha**. O sea: sobre esos renglones el botón «Corregir» no servía para
 * nada, y el mensaje ni siquiera decía por qué.
 *
 * 🔑 **REGLA 0-B no exime de esto: lo exige.** Su tabla dice que ante un dato migrado al que le falte
 * lo que la función necesita, la función **no debe tronar**. Aquí tronaba. Arreglarlo no es reparar
 * el dato viejo —no se toca ni una fila—: es que la función nueva cumpla su propio contrato.
 *
 * 🔴 **El `null` significa UNA SOLA COSA: quien consulta no puede ver importes.** Esa promesa es la
 * que deja al cajón decir *«no tienes permiso para ver importes»* sin mentir, así que ningún llamador
 * puede usar este `null` para expresar otra cosa **en un renglón corregible**. (El CARGO de EsMa sí
 * viaja en `null` con permiso, porque no tiene importe capturado —se deriva de cantidad × precio—,
 * y justo por eso **nunca es corregible** y no pasa por aquí.)
 */
export function importeGuardadoDe(monto: number, puedeVerImportes: boolean): number | null {
  return puedeVerImportes ? redondear2(Math.abs(monto)) : null;
}

/**
 * Mensaje único del renglón que TIENE factura (lo dicen igual EsMa y el motor de terceros).
 *
 * ⚠️ Se llama `MENSAJE_TIENE_FACTURA` y no `..._CON_FACTURA` a propósito: la guardia del segmento
 * (`esma/segmento-factura.test.ts`) persigue la cadena `con_factura` seguida de `=` para cazar el
 * criterio escrito a mano en SQL crudo, y un identificador `..._CON_FACTURA =` la dispara sin ser
 * un criterio. Antes que eximir la línea —aflojando una guardia que sí sirve— se cambió el nombre.
 */
export const MENSAJE_TIENE_FACTURA =
  'Ese movimiento tiene factura: no se corrige desde aquí. Un comprobante fiscal se cancela ante ' +
  'el SAT y se vuelve a capturar, no se edita por dentro.';

/** Mensaje de la carrera perdida (dos correcciones del mismo renglón a la vez). */
export const MENSAJE_CARRERA =
  'Ese movimiento cambió mientras se corregía (alguien lo corrigió o lo canceló en paralelo). ' +
  'Vuelve a consultarlo antes de decidir.';

/** Mensaje único de la corrección que no cambia nada. */
export const MENSAJE_SIN_CAMBIOS =
  'La corrección no cambia nada: el importe, la fecha y las observaciones son los mismos que ya ' +
  'tenía el movimiento.';

/**
 * Los valores efectivos de la corrección: lo que el usuario mandó, o lo que el movimiento ya tenía.
 * Devuelve también si hubo algún cambio REAL — mandar el mismo importe que ya estaba no es corregir.
 */
export interface CambiosResueltos {
  monto: number;
  fecha: string;
  observaciones: string | null;
  hayCambio: boolean;
}

/**
 * Resuelve los valores nuevos contra los viejos. Se exporta —y se prueba suelta— porque es la pieza
 * que decide si una corrección tiene sentido, y esa decisión no debería necesitar una base de datos
 * para comprobarse.
 */
export function resolverCambios(
  actual: { monto: number; fecha: string; observaciones: string | null },
  datos: Pick<DatosCorreccionSinFactura, 'importe' | 'fecha' | 'observaciones'>,
): CambiosResueltos {
  const monto = datos.importe === undefined ? actual.monto : redondear2(datos.importe);
  const fecha = datos.fecha ?? actual.fecha;
  const observaciones =
    datos.observaciones === undefined
      ? actual.observaciones
      : datos.observaciones === null || datos.observaciones === ''
        ? null
        : datos.observaciones;
  return {
    monto,
    fecha,
    observaciones,
    hayCambio:
      monto !== actual.monto || fecha !== actual.fecha || observaciones !== actual.observaciones,
  };
}

/**
 * ⭐ ¿Este renglón del MOTOR se puede CORREGIR (fila 0.145)? Cinco condiciones, todas necesarias:
 * la BANDERA de quien pregunta, que sea SIN factura (y sin nada de CFDI colgando), que esté vivo y
 * que no sea él mismo un inverso de cancelación.
 *
 * Vive aquí —y no en la pantalla— porque es la MISMA regla que el servidor va a exigir al corregir:
 * si la pantalla la adivinara por su cuenta, acabaría ofreciendo un botón que el servidor rechaza.
 * Una corrección SÍ se puede volver a corregir (se encadenan): eso no es una excepción, es lo mismo
 * que pasa con cualquier movimiento bueno.
 */
export function esCorregibleMotor(
  m: {
    esFiscal: boolean;
    uuidCfdi: string | null;
    idArchivoCfdi: string | null;
    cancelado: boolean;
    idMovimientoInverso: number | null;
  },
  puedeCorregir: boolean,
): boolean {
  return (
    puedeCorregir &&
    !m.esFiscal &&
    m.uuidCfdi === null &&
    m.idArchivoCfdi === null &&
    !m.cancelado &&
    m.idMovimientoInverso === null
  );
}
