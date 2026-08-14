import type { NotaSalida, NotaSalidaLineaEntrada } from '@/api/tipos';

/**
 * Modelo de CAPTURA de los renglones de una nota de salida (F4-E5). El formulario edita renglones
 * con la cantidad como TEXTO y la liga a una orden de producción destino. Estos helpers convierten
 * entre el modelo de captura y el cuerpo del API; la validación REAL (no-negativo del avío al
 * confirmar, ligas del renglón) la hace el backend (A1) — aquí solo se cuida la UX.
 *
 * §Post-F9.38 (V1-E3b) — la nota de salida es **de AVÍOS**: la salida de tela a una orden NO lleva
 * nota (basta su movimiento de kardex), así que ya NO se capturan renglones de tela. Los que
 * quedaron en notas viejas se conservan tal cual y se re-envían igual al guardar (la edición
 * reemplaza el SET COMPLETO de renglones: si no viajaran de vuelta, editar una nota vieja los
 * borraría en silencio). Por eso el modelo de captura sigue llevando sus campos —incluidos el
 * nombre de la tela y la clave del lote, solo para MOSTRARLOS sin volver a pedir el catálogo—.
 */

/**
 * Qué es un renglón en captura: `avio` (lo único que se captura hoy), `tela` (histórico de notas
 * viejas) o `historico` — un renglón MIGRADO del sistema anterior, que no apunta a catálogo alguno
 * y solo trae su texto libre (`descripcionLegacy`).
 */
export type TipoMaterialNota = 'avio' | 'tela' | 'historico';

/** Un renglón en CAPTURA (cantidad como texto; campos según el tipo). */
export interface RenglonNotaCaptura {
  /** Clave estable de fila para React (no se envía). */
  clave: string;
  tipo: TipoMaterialNota;
  /** Orden de producción destino del renglón (obligatoria). */
  idOrden: number | null;
  /** Avío elegido (tipo = avio), o null. */
  idAvio: number | null;
  /** Tela del renglón histórico (tipo = tela), o null. Ya no se captura (§Post-F9.38). */
  idTela: number | null;
  /** Nombre de la tela del renglón histórico (solo para mostrarlo), o null. */
  telaNombre: string | null;
  /** Lote del renglón histórico (tipo = tela), o null. */
  idLote: number | null;
  /** Clave del lote del renglón histórico (solo para mostrarla), o null. */
  loteClave: string | null;
  /** Movimiento `salida-tela-orden` de E1 referenciado (tipo = tela), o null. */
  idMovimientoSalidaTela: number | null;
  /** Cantidad enviada como texto (vacío = 0). En tela, la trae la salida-a-orden elegida. */
  cantidad: string;
  /** Unidad/presentación (texto libre, opcional). */
  unidad: string;
  /** Texto libre del renglón MIGRADO del sistema anterior (tipo = historico), o null. */
  descripcionLegacy: string | null;
}

let contador = 0;
/** Genera una clave de fila estable y única para un renglón nuevo. */
export function nuevaClaveRenglon(): string {
  contador += 1;
  return `r-${String(contador)}-${String(Date.now())}`;
}

/** Un renglón de captura vacío (siempre de AVÍO: la tela ya no se captura — §Post-F9.38). */
export function renglonVacio(): RenglonNotaCaptura {
  return {
    clave: nuevaClaveRenglon(),
    tipo: 'avio',
    idOrden: null,
    idAvio: null,
    idTela: null,
    telaNombre: null,
    idLote: null,
    loteClave: null,
    idMovimientoSalidaTela: null,
    cantidad: '',
    unidad: '',
    descripcionLegacy: null,
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
 * avío exige `idAvio`. El renglón de TELA de una nota vieja ya viene completo (no se edita), y sus
 * campos se re-envían tal cual — por eso su regla se conserva.
 *
 * El renglón MIGRADO (`historico`) NO se puede enviar: no tiene avío ni tela, así que el contrato
 * de captura lo rechazaría. No es un caso vivo —el ETL crea las notas migradas como `confirmada`
 * (`dominio/notas/migracion.ts`), y una nota confirmada no se edita—, pero si alguna apareciera en
 * borrador es mejor que el botón de guardar no se habilite a que el servidor devuelva un 400.
 */
export function renglonCompleto(r: RenglonNotaCaptura): boolean {
  if (r.idOrden === null || aNumero(r.cantidad) <= 0) {
    return false;
  }
  if (r.tipo === 'avio') {
    return r.idAvio !== null;
  }
  if (r.tipo === 'historico') {
    return false;
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
    // Nombres del renglón histórico de tela: se toman de la propia nota para poder MOSTRARLO sin
    // pedir el catálogo de telas (su captura ya no existe — §Post-F9.38).
    telaNombre: linea.tela,
    idLote: linea.idLote,
    loteClave: linea.loteClave,
    idMovimientoSalidaTela: linea.idMovimientoSalidaTela,
    cantidad: String(linea.cantidad),
    unidad: linea.unidad ?? '',
    // Texto libre del renglón migrado: es lo ÚNICO que ese renglón tiene (sin él se mostraba vacío).
    descripcionLegacy: linea.descripcionLegacy,
  }));
}
