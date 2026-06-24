import type { NotaSalida, NotaSalidaLineaEntrada } from '@/api/tipos';

/**
 * Modelo de CAPTURA de los renglones de una nota de salida (F4-E5). El formulario edita renglones
 * con la cantidad como TEXTO, el tipo de material (avío / tela) y la liga a una orden de producción
 * destino. Estos helpers convierten entre el modelo de captura y el cuerpo del API; la validación
 * REAL (XOR avío/tela, liga del renglón de tela a su salida-a-orden, no-negativo del avío al
 * confirmar) la hace el backend (A1) — aquí solo se cuida la UX.
 *
 * Renglón de TELA (decisión e): NO se captura cantidad libre como descuento; se ELIGE una
 * salida-a-orden YA registrada (E1) de esa orden/tela, que aporta `idLote` + `idMovimientoSalidaTela`
 * + la cantidad documentada. La nota solo DOCUMENTA ese envío, no descuenta tela.
 */

/** Tipo de material de un renglón en captura. */
export type TipoMaterialNota = 'avio' | 'tela';

/** Un renglón en CAPTURA (cantidad como texto; campos según el tipo). */
export interface RenglonNotaCaptura {
  /** Clave estable de fila para React (no se envía). */
  clave: string;
  tipo: TipoMaterialNota;
  /** Orden de producción destino del renglón (obligatoria). */
  idOrden: number | null;
  /** Avío elegido (tipo = avio), o null. */
  idAvio: number | null;
  /** Tela elegida (tipo = tela), o null. */
  idTela: number | null;
  /** Lote de la salida-a-orden elegida (tipo = tela; lo aporta el movimiento), o null. */
  idLote: number | null;
  /** Movimiento `salida-tela-orden` de E1 referenciado (tipo = tela), o null. */
  idMovimientoSalidaTela: number | null;
  /** Cantidad enviada como texto (vacío = 0). En tela, la trae la salida-a-orden elegida. */
  cantidad: string;
  /** Unidad/presentación (texto libre, opcional). */
  unidad: string;
}

let contador = 0;
/** Genera una clave de fila estable y única para un renglón nuevo. */
export function nuevaClaveRenglon(): string {
  contador += 1;
  return `r-${String(contador)}-${String(Date.now())}`;
}

/** Un renglón de captura vacío (avío por defecto). */
export function renglonVacio(): RenglonNotaCaptura {
  return {
    clave: nuevaClaveRenglon(),
    tipo: 'avio',
    idOrden: null,
    idAvio: null,
    idTela: null,
    idLote: null,
    idMovimientoSalidaTela: null,
    cantidad: '',
    unidad: '',
  };
}

/** Normaliza un texto a número ≥ 0 (vacío/inválido = 0). */
export function aNumero(texto: string): number {
  const limpio = texto.trim();
  if (limpio === '') {
    return 0;
  }
  const valor = Number(limpio);
  return Number.isFinite(valor) && valor >= 0 ? valor : 0;
}

/**
 * ¿El renglón es válido para enviarse? (UX; el backend re-valida). Orden obligatoria + cantidad > 0;
 * avío exige `idAvio`; tela exige `idTela` + `idLote` + `idMovimientoSalidaTela` (la salida-a-orden).
 */
export function renglonCompleto(r: RenglonNotaCaptura): boolean {
  if (r.idOrden === null || aNumero(r.cantidad) <= 0) {
    return false;
  }
  if (r.tipo === 'avio') {
    return r.idAvio !== null;
  }
  return r.idTela !== null && r.idLote !== null && r.idMovimientoSalidaTela !== null;
}

/** Convierte un renglón de captura al cuerpo del API. */
export function renglonApi(renglon: RenglonNotaCaptura): NotaSalidaLineaEntrada {
  const base = {
    idOrden: renglon.idOrden as number,
    cantidad: aNumero(renglon.cantidad),
    unidad: renglon.unidad.trim() || null,
  };
  if (renglon.tipo === 'avio') {
    return { ...base, idAvio: renglon.idAvio as number };
  }
  return {
    ...base,
    idTela: renglon.idTela as number,
    idLote: renglon.idLote as number,
    idMovimientoSalidaTela: renglon.idMovimientoSalidaTela as number,
  };
}

/** Reconstruye los renglones de captura desde una nota existente (para editar). */
export function capturaDesdeNota(nota: NotaSalida): RenglonNotaCaptura[] {
  return nota.lineas.map((linea) => ({
    clave: nuevaClaveRenglon(),
    tipo: linea.tipo,
    idOrden: linea.idOrden,
    idAvio: linea.idAvio,
    idTela: linea.idTela,
    idLote: linea.idLote,
    idMovimientoSalidaTela: linea.idMovimientoSalidaTela,
    cantidad: String(linea.cantidad),
    unidad: linea.unidad ?? '',
  }));
}
