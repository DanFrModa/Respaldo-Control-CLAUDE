/**
 * Helpers de formato para presentar valores del API en español (es-MX). Las
 * entidades traen `creadoEn` / `modificadoEn` como cadenas ISO; estos helpers las
 * vuelven legibles para el panel de detalle (seccion "Historial"). Una fecha
 * faltante o invalida devuelve el guion largo "—" (mismo placeholder que usa la UI
 * para "sin dato").
 */

/** Placeholder de "sin dato" usado en toda la UI. */
const SIN_DATO = '—';

/** Intenta construir una fecha valida a partir de una cadena ISO (o `null`). */
function aFecha(valor: string | null | undefined): Date | null {
  if (valor === null || valor === undefined || valor === '') {
    return null;
  }
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/**
 * Formatea una fecha ISO como fecha corta es-MX (p. ej. "13 jun 2026"). Vacia o
 * invalida -> "—".
 */
export function formatearFecha(valor: string | null | undefined): string {
  const fecha = aFecha(valor);
  if (fecha === null) {
    return SIN_DATO;
  }
  return fecha.toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Formatea una fecha ISO con hora es-MX (p. ej. "13 jun 2026, 14:05"). Vacia o
 * invalida -> "—".
 */
export function formatearFechaHora(valor: string | null | undefined): string {
  const fecha = aFecha(valor);
  if (fecha === null) {
    return SIN_DATO;
  }
  return fecha.toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Formatea un monto como moneda mexicana (p. ej. 1234.5 -> "$1,234.50"). No finito -> "—".
 * Solo presentación: el backend deriva todos los totales/subtotales (A1).
 */
export function formatearMoneda(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) {
    return SIN_DATO;
  }
  return valor.toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Formatea un tamaño en bytes a una unidad legible (B, KB, MB, GB) con una cifra
 * decimal a partir de KB (p. ej. 1536 -> "1.5 KB"). Se usa para mostrar el tamaño
 * de los adjuntos PDF de un proveedor.
 */
export function formatearTamano(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return SIN_DATO;
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const unidades = ['KB', 'MB', 'GB', 'TB'];
  let valor = bytes / 1024;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i += 1;
  }
  return `${valor.toFixed(1)} ${unidades[i]}`;
}

/**
 * ⭐ V1-E8q — CÓMO SE NOMBRA AL AUTOR de un evento de negociación (o de cualquier log inmutable con
 * `registradoPorId` + `nombreRegistradoPor` resuelto en el servidor).
 *
 * Vive aquí, en UNA función, porque el hilo se pinta en DOS pantallas —el panel de negociación de la
 * lista y el expediente de desarrollo de la orden— y **las dos tienen que decir lo mismo**. Copiar el
 * criterio en cada una es cómo se abren las puertas gemelas: la del expediente pintaba el **id crudo**
 * (`cm3x9k2q0000abcd1234`) mientras la otra ya mostraba el nombre.
 *
 * Distingue TRES casos, porque colapsarlos miente:
 *  1. **Sin `registradoPorId`** → `'Sistema'`. No lo escribió nadie: es un asiento del sistema.
 *  2. **Con id y con nombre** → el nombre de la persona.
 *  3. **Con id pero sin nombre** → `'Usuario dado de baja'`. 🔴 Lo escribió una PERSONA y no se le
 *     puede poner nombre; decir «Sistema» aquí **le atribuiría al sistema lo que dijo alguien en una
 *     mesa de negociación**. Ojo: dar de baja a un usuario es borrado SUAVE (la fila se queda), así
 *     que su nombre SÍ resuelve — este caso es el de un id que ya no tiene fila.
 */
export function autorDeEvento(evento: {
  registradoPorId: string | null;
  nombreRegistradoPor: string | null;
}): string {
  return nombreDeAutor(evento.registradoPorId, evento.nombreRegistradoPor) ?? 'Sistema';
}

/**
 * ⭐ V1 «los nombres, en vez de los ids» — el MISMO criterio de {@link autorDeEvento}, pero suelto,
 * para las tablas cuyo par de campos NO se llama `registradoPorId`/`nombreRegistradoPor`:
 * `OrdenComentario` (`idUsuario`), `HitoOrden` (`registradoPorId`), `Archivo` (`subidoPorId`, en
 * adjuntos de orden y de desarrollo) y `Desarrollo` (`apagadoPorId`). Cinco pantallas pintaban ahí
 * el **id crudo** (`cm3x9k2q0000abcd1234`); tres de ellas en el MISMO diálogo de orden.
 *
 * Devuelve:
 *  • `null` cuando NO hay id — «no lo hizo nadie». Se devuelve `null` en vez de `'Sistema'` para que
 *    cada pantalla conserve lo que ya hacía en ese caso: el panel de comentarios dice «Sistema»,
 *    mientras los adjuntos/hitos/desarrollos simplemente OMITEN el « · por …». Colapsarlo aquí
 *    cambiaría cinco pantallas de golpe por un detalle que no es el de esta etapa.
 *  • el nombre, cuando resuelve.
 *  • `'Usuario dado de baja'` cuando hay id pero no nombre. 🔴 Nunca el id crudo: lo escribió una
 *    PERSONA, y un cuid no nombra a nadie. Ojo — la baja es borrado SUAVE, así que el nombre de un
 *    usuario inactivo SÍ resuelve y se sigue pintando (D3); este caso es el del id sin fila.
 *
 * ⚠️ El renglón se ve SIEMPRE, resuelva o no: dar de baja a alguien no borra lo que escribió.
 *
 * ## 🔴 La ÚNICA excepción, y por qué: la BITÁCORA
 *
 * `administracion/BitacoraPagina.tsx` usa `nombreUsuario ?? idUsuario ?? '(sistema)'` — o sea,
 * cuando el nombre no resuelve **sí cae al id crudo**, en vez de decir «Usuario dado de baja». NO es
 * un descuido y NO debe «arreglarse» para igualarlo:
 *
 *  • La bitácora es la pantalla de AUDITORÍA, y `idUsuario` es su **clave de filtro** (tiene un campo
 *    «Id de usuario» a un centímetro). El id ahí es dato operable, no ruido.
 *  • Un id que ya no resuelve es justo lo que un auditor necesita VER: es la última evidencia de
 *    quién actuó. Sustituirlo por «Usuario dado de baja» **destruiría información forense**.
 *
 * En las pantallas OPERATIVAS (las de esta función) manda lo contrario: nadie filtra por cuid, y un
 * cuid no nombra a nadie. Ambas reglas son deliberadas; esto es lo que dice cuál gobierna dónde.
 */
export function nombreDeAutor(id: string | null, nombre: string | null): string | null {
  if (id === null) return null;
  return nombre ?? 'Usuario dado de baja';
}
