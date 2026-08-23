import { describe, expect, it } from 'vitest';

import { sesionDePrueba } from '../../../pruebas/sesiones.js';
import { MAX_FILAS_PDF } from '../../../comun/impreso-topes.js';
import type { PrismaClient } from '../../../datos/index.js';
import type { ListaPreciosSalida } from '../../../contrato/index.js';

import {
  armarDatosImpresoListaPrecios,
  generarPdfListaPrecios,
  type DatosImpresoListaPrecios,
} from './impreso-lista-precios.js';

/**
 * Unit del impreso de LISTA DE PRECIOS sugeridos (F7-E1, R9) + su TOPE (blindaje de PDFs). SIN Postgres:
 * se inyecta un `listaPrecios` fake y un cliente mínimo. Verifica que se DIBUJAN a lo más `MAX_FILAS_PDF`
 * modelos y que el conteo del universo completo queda para el aviso de truncado.
 */
const sesion = sesionDePrueba({ permisos: ['costos.ver', 'consultas.ver-importes'] });

const bdFake = {
  cliente: {
    empresa: {
      findUnique: () => Promise.resolve({ razonSocial: 'FR MODA SA DE CV', nombre: 'FR Moda' }),
    },
  } as unknown as PrismaClient,
};

function listaFake(n: number): ListaPreciosSalida {
  return {
    utilidadSugerida: 40,
    regaliasBase: 8,
    filas: Array.from({ length: n }, (_, i) => ({
      idModelo: i + 1,
      codigo: `M-${String(i)}`,
      descripcion: `Modelo ${String(i)}`,
      genero: 'Dama',
      activo: true,
      costo: 50,
      precioSugerido: 90,
    })),
  };
}

describe('impreso lista de precios (F7-E1) — tope', () => {
  it('no topa cuando hay pocos modelos', async () => {
    const datos = await armarDatosImpresoListaPrecios(sesion, {}, bdFake, {
      listaPrecios: () => Promise.resolve(listaFake(5)),
    });
    expect(datos.lista.filas).toHaveLength(5);
    expect(datos.totalFilas).toBe(5);
  });

  it('topa a MAX_FILAS_PDF y guarda el conteo completo para el aviso', async () => {
    const n = MAX_FILAS_PDF + 60;
    const datos = await armarDatosImpresoListaPrecios(sesion, {}, bdFake, {
      listaPrecios: () => Promise.resolve(listaFake(n)),
    });
    expect(datos.lista.filas).toHaveLength(MAX_FILAS_PDF);
    expect(datos.totalFilas).toBe(n);
  });

  it('renderiza un PDF con la leyenda de truncado (pocas filas dibujadas, total alto)', async () => {
    const datos: DatosImpresoListaPrecios = {
      pagador: 'FR MODA SA DE CV',
      lista: listaFake(4),
      totalFilas: 800,
    };
    const buffer = await generarPdfListaPrecios(datos);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
