/**
 * "GENERAR EVALUACIÓN SEMANAL" del tablero Análisis RC (R7): export a EXCEL de la tabla de DESEMPEÑO
 * del equipo (scoring + bono). Default de bajo riesgo (decisión de diseño R7): reusa `desempenoRc`
 * (A1: la lógica NO se duplica) y vuelca sus filas a un `.xlsx` — MISMO patrón que `excel-concentrado`
 * (F5-E7), SIN tabla nueva ni estado persistido. La ruta valida permiso (`rc.programar`) + llama aquí
 * y responde el binario. El nombre "evaluación semanal" es de negocio: la tendencia y las capturas se
 * leen sobre la semana; la foto de vencidos/activos es de HOY.
 */
import ExcelJS from 'exceljs';

import type { BadgeDesempeno } from '../../../contrato/index.js';
import type { SesionUsuario } from '../../../comun/permisos.js';
import type { ContextoBd } from '../../../comun/transaccion.js';

import { desempenoRc } from '../analisisRc.js';

const TEAL = 'FF0D9488';

/** Etiqueta legible del badge de desempeño. */
const ETIQUETA_BADGE: Record<BadgeDesempeno, string> = {
  excelente: 'Excelente',
  bien: 'Bien',
  regular: 'Regular',
  bajo: 'Bajo',
};

/** Relleno (ARGB) del badge de la fila (verde/azul/ámbar/rojo claros). */
const RELLENO_BADGE: Record<BadgeDesempeno, string> = {
  excelente: 'FFDCFCE7',
  bien: 'FFDBEAFE',
  regular: 'FFFEF3C7',
  bajo: 'FFFEE2E2',
};

/** Dependencias inyectables (los tests inyectan un `desempenoRc` fake para no tocar BD). */
export interface DepsExcelDesempeno {
  desempenoRc?: typeof desempenoRc;
}

/** Resultado del export: el buffer del `.xlsx` listo para responder. */
export interface ExcelDesempeno {
  buffer: Buffer;
}

/** Un valor numérico o '—' si es null (para celdas que pueden no tener dato). */
function oGuion(valor: number | null): number | string {
  return valor === null ? '—' : valor;
}

/**
 * Genera el `.xlsx` del desempeño del equipo (A9: scope por la empresa activa, ya lo impone
 * `desempenoRc`). MISMO resultado que el tablero.
 */
export async function excelDesempenoRc(
  sesion: SesionUsuario,
  bd?: ContextoBd,
  ahora?: Date,
  deps: DepsExcelDesempeno = {},
): Promise<ExcelDesempeno> {
  const calcular = deps.desempenoRc ?? desempenoRc;
  const { personas } = await calcular(sesion, bd, ahora);

  const libro = new ExcelJS.Workbook();
  libro.creator = 'CONTROL v2';
  libro.created = ahora ?? new Date();
  const hoja = libro.addWorksheet('Desempeño RC', { views: [{ state: 'frozen', ySplit: 1 }] });

  hoja.columns = [
    { header: 'Persona', key: 'persona', width: 26 },
    { header: 'Área', key: 'area', width: 24 },
    { header: 'A cargo', key: 'activos', width: 9 },
    { header: 'Vencidos', key: 'vencidos', width: 10 },
    { header: '% en tiempo', key: 'onTime', width: 12 },
    { header: 'Reacción (h)', key: 'reaccion', width: 12 },
    { header: 'Tendencia', key: 'tendencia', width: 11 },
    { header: 'Calificación', key: 'calificacion', width: 12 },
    { header: 'Nivel', key: 'nivel', width: 12 },
    { header: 'Bono', key: 'bono', width: 8 },
    { header: 'Sobrecarga', key: 'sobrecarga', width: 11 },
  ];

  const encabezado = hoja.getRow(1);
  encabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  encabezado.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } };
  encabezado.alignment = { vertical: 'middle' };

  for (const p of personas) {
    const renglon = hoja.addRow({
      persona: p.nombre,
      area: p.area,
      activos: p.activos,
      vencidos: p.vencidos,
      onTime: p.onTimePct === null ? '—' : `${p.onTimePct}%`,
      reaccion: oGuion(p.reaccionHoras),
      tendencia: p.tendencia === null ? '—' : `${p.tendencia > 0 ? '+' : ''}${p.tendencia}%`,
      calificacion: oGuion(p.calificacion),
      nivel: p.badge === null ? '—' : ETIQUETA_BADGE[p.badge],
      bono: p.bono ? 'Sí' : '—',
      sobrecarga: p.sobrecarga ? 'Sí' : '—',
    });
    if (p.badge !== null) {
      renglon.getCell('nivel').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: RELLENO_BADGE[p.badge] },
      };
    }
  }

  const datos = await libro.xlsx.writeBuffer();
  return { buffer: Buffer.from(datos) };
}
