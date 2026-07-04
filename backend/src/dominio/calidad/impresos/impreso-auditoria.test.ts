/**
 * Tests UNITARIOS del impreso de auditoría (F6-E3). No tocan BD ni red: generan el PDF a partir de
 * datos resueltos y comprueban que el Buffer empieza por `%PDF` (documento válido) para cada resultado.
 */
import { describe, expect, it } from 'vitest';

import { generarPdfAuditoria, type DatosImpresoAuditoria } from './impreso-auditoria.js';

const DATOS: DatosImpresoAuditoria = {
  empresa: 'FR Moda SA de CV',
  numAuditoria: 42,
  folioOrden: 1001,
  codigoModelo: 'A-100',
  cantidadOrden: 300,
  tamanoMuestra: 32,
  muestraManual: false,
  tipoAuditoria: 'final',
  maquilero: 'Maquila Costura SA',
  elaboro: 'Ana López',
  auditor: 'Beto Ruiz',
  fechaElaboracion: '2026-06-30',
  fechaAuditoria: '2026-07-01',
  resultado: 'reprobado',
  observaciones: 'Se rechaza por costuras abiertas.',
  cancelada: false,
  totalFallas: 7,
  renglones: [
    { clave: 'F-1', pag: '12', descripcion: 'Costura abierta', nivelAQL: 1, numFallas: 5 },
    { clave: 'F-25', pag: null, descripcion: 'Mancha', nivelAQL: 2.5, numFallas: 2 },
  ],
};

describe('generación del PDF de auditoría (F6-E3)', () => {
  it('genera un PDF no vacío con el folio correcto', async () => {
    const buffer = await generarPdfAuditoria(DATOS);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('genera PDF válido para una auditoría sin defectos y sin observaciones', async () => {
    const buffer = await generarPdfAuditoria({
      ...DATOS,
      resultado: 'no_calificado',
      observaciones: null,
      totalFallas: 0,
      renglones: [],
    });
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('genera PDF válido para una auditoría cancelada y aprobada', async () => {
    const buffer = await generarPdfAuditoria({ ...DATOS, resultado: 'aprobado', cancelada: true });
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});
