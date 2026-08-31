/**
 * ⭐⭐ V1-E8y — LA PRUEBA QUE CEMENTA **EL DEFECTO QUE ESTA ETAPA VINO A EVITAR**: que copiar un
 * modelo se lleve la receta y **deje los costos atrás**.
 *
 * `maquilaBase` y `corteBase` NO están en el BOM: son columnas de `Modelo`, y `generarPrecosto` las
 * lee de ahí para armar los renglones ancla de maquila y de corte. Copiar un modelo sólo con
 * `copiarBom` produce uno que precostea con **$0 de maquila y $0 de corte, en silencio** — y de ese
 * precosto sale el precio que se le da al cliente en la cara, en plena cita.
 *
 * Por eso la prueba es explícita campo por campo: si alguien quita una línea de
 * {@link fichaHeredadaDeModelo} «porque el BOM ya lo trae», esto se pone rojo.
 *
 * PURA: no toca base de datos (por eso la función recibe números planos y no `Decimal`).
 */
import { describe, expect, it } from 'vitest';

import { fichaHeredadaDeModelo, type FichaModeloOrigen } from './modelo-en-la-mesa.js';

/** Un modelo origen COMPLETO (todos los opcionales con valor). */
function origenCompleto(): FichaModeloOrigen {
  return {
    descripcion: 'Sudadera con jareta',
    composicion: '80% algodón 20% poliéster',
    maquilaBase: 38.5,
    corteBase: 7.25,
    numOperaciones: 14,
    idTemporada: 3,
    idCurvaTalla: 9,
    idMaquileroCotizado: 21,
    secuenciaEstampado: 'despues',
    llevaArte: false,
  };
}

/** Un modelo origen VACÍO de opcionales (lo que el sistema tolera sin rellenar, REGLA 0-B). */
function origenPelado(): FichaModeloOrigen {
  return {
    descripcion: null,
    composicion: null,
    maquilaBase: null,
    corteBase: null,
    numOperaciones: null,
    idTemporada: null,
    idCurvaTalla: null,
    idMaquileroCotizado: null,
    secuenciaEstampado: 'antes',
    llevaArte: true,
  };
}

describe('fichaHeredadaDeModelo', () => {
  it('🔴 se lleva LA MAQUILA y EL CORTE — sin ellos el modelo copiado precostea en cero', () => {
    const ficha = fichaHeredadaDeModelo(origenCompleto());
    expect(ficha.maquilaBase).toBe(38.5);
    expect(ficha.corteBase).toBe(7.25);
  });

  it('se lleva el resto de la ficha que gobierna el costo y la producción', () => {
    const ficha = fichaHeredadaDeModelo(origenCompleto());
    expect(ficha.numOperaciones).toBe(14);
    expect(ficha.composicion).toBe('80% algodón 20% poliéster');
    expect(ficha.idCurvaTalla).toBe(9);
    expect(ficha.idTemporada).toBe(3);
    expect(ficha.idMaquileroCotizado).toBe(21);
    expect(ficha.secuenciaEstampado).toBe('despues');
    expect(ficha.llevaArte).toBe(false);
    expect(ficha.descripcion).toBe('Sudadera con jareta');
  });

  it('🔴 los NULL se OMITEN (no se mandan como null: el esquema del alta es `.optional()`, no `.nullable()`)', () => {
    const ficha = fichaHeredadaDeModelo(origenPelado());
    for (const clave of [
      'descripcion',
      'composicion',
      'maquilaBase',
      'corteBase',
      'numOperaciones',
      'idTemporada',
      'idCurvaTalla',
      'idMaquileroCotizado',
    ] as const) {
      expect(Object.hasOwn(ficha, clave), `"${clave}" no debe venir en el objeto`).toBe(false);
    }
    // Un `null` colado reventaría el alta con un 400 por contrato: se comprueba el VALOR también,
    // porque `hasOwn` no distingue "no está" de "está en undefined" en un objeto construido a mano.
    expect(Object.values(ficha).every((v) => v !== null)).toBe(true);
  });

  it('los dos que SIEMPRE viajan (tienen default en la columna, nunca son null) sí van en el pelado', () => {
    const ficha = fichaHeredadaDeModelo(origenPelado());
    expect(ficha.secuenciaEstampado).toBe('antes');
    expect(ficha.llevaArte).toBe(true);
  });

  it('no inventa el código ni los dos dígitos: ésos los pone quien mintea (no están en la ficha)', () => {
    const ficha = fichaHeredadaDeModelo(origenCompleto()) as Record<string, unknown>;
    expect(Object.hasOwn(ficha, 'codigo')).toBe(false);
    expect(Object.hasOwn(ficha, 'idGenero')).toBe(false);
    expect(Object.hasOwn(ficha, 'idTipoProducto')).toBe(false);
  });
});
