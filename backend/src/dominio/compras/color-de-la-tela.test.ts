import { describe, expect, it } from 'vitest';

import { ErrorPermiso } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  asignarColorDeTela,
  coloresDeTelaDeOrden,
  motivoNoCambiarColor,
} from './color-de-la-tela.js';
import {
  algunaRecibida,
  ESTATUS_OC_COMPROMETIDA,
  ESTATUS_OC_QUE_CUBREN,
} from './comprometido-en-oc.js';

/**
 * Unit de **la tela se compra por color** (V1-E3u) + ⭐ **V1-E4c: hasta cuándo se puede cambiar**
 * — SIN Postgres. Cubre lo que no necesita la base:
 *  • el guard de permisos (A4, deny-by-default);
 *  • la función PURA que redacta el motivo de por qué un color ya no se puede cambiar;
 *  • y el invariante de las DOS listas de estatus de OC, que es de donde sale la regla.
 *
 * El bloqueo real contra la base (crear la OC, autorizarla y que el `PUT` la rechace) vive en
 * `color-de-la-tela.int.test.ts`, que corre en CI.
 */

const sesionSinNada = () => sesionDePrueba({ permisos: [] });
const sesionVer = () => sesionDePrueba({ permisos: ['compras.ver'] });

describe('color de la tela — permisos (A4, deny-by-default)', () => {
  it('leer los colores sin `compras.ver` lanza ErrorPermiso (antes de la BD)', async () => {
    await expect(coloresDeTelaDeOrden(sesionSinNada(), 1)).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('amarrar el color con `compras.ver` NO alcanza: exige `compras.administrar`', async () => {
    await expect(
      asignarColorDeTela(sesionVer(), 1, { idTela: 1, idColor: 1, idTelaColor: 1 }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

/**
 * ⭐⭐ **V1-E4c — LA REGLA DE CUÁNDO SE PUEDE CAMBIAR EL COLOR**, en su función pura.
 *
 * Con la OC en BORRADOR se cambia; ya AUTORIZADA, no — y el mensaje tiene que decir que el camino
 * es des-autorizar. ⚠️ La regla es un **default del lead (23-ago-2026) que Daniel no objetó**
 * (§Post-F9.96(f)), **no una frase suya**. Es la misma regla de §Post-F9.79 y sale de la MISMA
 * lista de estatus.
 */
describe('V1-E4c — motivoNoCambiarColor (función pura)', () => {
  it('sin compra comprometida se puede cambiar (null): capturar es el proceso NORMAL', () => {
    expect(motivoNoCambiarColor('Marino Alsa 3040', undefined)).toBeNull();
    expect(motivoNoCambiarColor('Marino Alsa 3040', { folios: [], recibida: false })).toBeNull();
  });

  it('con OC AUTORIZADA no se puede, y el mensaje manda a DES-AUTORIZAR nombrando el folio', () => {
    const motivo = motivoNoCambiarColor('Marino Alsa 3040', { folios: [812], recibida: false });
    expect(motivo).not.toBeNull();
    expect(motivo).toContain('Marino Alsa 3040');
    expect(motivo).toContain('#812');
    // 🔴 Lo que la pone roja si alguien recorta el mensaje a un "no se puede" a secas.
    expect(motivo).toContain('DES-AUTORIZAR');
    expect(motivo).toContain('BORRADOR');
  });

  it('con VARIAS OC las nombra todas, sin repetir y ordenadas', () => {
    const motivo = motivoNoCambiarColor('Grana 7700', {
      folios: [900, 812, 900],
      recibida: false,
    });
    expect(motivo).toContain('#812, #900');
    expect(motivo).toContain('las órdenes de compra');
  });

  it('🔴 si ya se RECIBIÓ, NO manda a des-autorizar: ese camino no existe', () => {
    const motivo = motivoNoCambiarColor('Grana 7700', { folios: [812], recibida: true });
    expect(motivo).toContain('RECIBIÓ');
    expect(motivo).toContain('devolución');
    // Daniel, 20-ago-2026: *"una vez recibido no se puede desautorizar"* — mandarlo a ese botón
    // sería mandarlo a un 409.
    expect(motivo).not.toContain('DES-AUTORIZAR');
  });
});

/**
 * 🔴 **LAS DOS LISTAS DE ESTATUS RESPONDEN PREGUNTAS DISTINTAS, Y ESO NO PUEDE DERIVAR.**
 * `ESTATUS_OC_QUE_CUBREN` contesta *"¿hace falta volver a comprar esto?"* (el borrador SÍ cubre);
 * `ESTATUS_OC_COMPROMETIDA` contesta *"¿ya me comprometí con el proveedor?"* (el borrador NO). Si
 * alguien las unificara "porque se parecen", V1-E4c dejaría de dejar cambiar el color en borrador
 * —justo lo que Daniel pidió que sí se pudiera— o §Post-F9.79 dejaría de proteger lo comprado.
 */
describe('V1-E4c — las dos listas de estatus de OC', () => {
  it('el BORRADOR cubre la compra pero NO la compromete', () => {
    expect(ESTATUS_OC_QUE_CUBREN).toContain('borrador');
    expect(ESTATUS_OC_COMPROMETIDA).not.toContain('borrador');
    expect(ESTATUS_OC_COMPROMETIDA).not.toContain('pendiente_autorizacion');
  });

  it('la CANCELADA no está en ninguna de las dos', () => {
    expect(ESTATUS_OC_QUE_CUBREN).not.toContain('cancelada');
    expect(ESTATUS_OC_COMPROMETIDA).not.toContain('cancelada');
  });

  it('`algunaRecibida` distingue el camino sin salida del que sí lo tiene', () => {
    expect(algunaRecibida(['autorizada'])).toBe(false);
    expect(algunaRecibida(['autorizada', 'recibida_parcial'])).toBe(true);
    expect(algunaRecibida(['recibida_total'])).toBe(true);
  });
});
