import { describe, expect, it } from 'vitest';

import { sesionDePrueba } from '../../../pruebas/sesiones.js';
import type { ExistenciasTelaLista } from '../../../contrato/index.js';
import {
  armarDatosImpresoInventarioTelas,
  armarFilasImpreso,
  generarPdfInventarioTelas,
  impresoInventarioTelas,
} from './impreso-inventario-telas.js';

/**
 * Unit del impreso 'Inventario de telas' (F4-E1, R9). SIN BD: se inyecta un `consultarExistenciasTela`
 * fake. Verifica el armado de la tabla (componentes del lote, D5) y que el PDF se genera (Buffer %PDF).
 */
const listaFake: ExistenciasTelaLista = {
  filas: [
    {
      idTela: 1,
      tela: 'Felpa',
      idLote: 7,
      loteClave: 'LOTE-A',
      idColor: 3,
      color: 'Rojo',
      idProveedor: 2,
      proveedor: 'Textiles SA',
      factura: 'F-100',
      idAlmacen: 5,
      almacen: 'Bodega A',
      existencia: 100,
      componentes: [
        { idTela: 1, tela: 'Felpa', cantidad: 100, peso: 25 },
        { idTela: 2, tela: 'Cardigan', cantidad: 40, peso: null },
      ],
    },
  ],
  totalExistencia: 100,
};

const sesion = sesionDePrueba({ permisos: ['inventario-telas.ver'] });

describe('impreso inventario de telas (F4-E1, R9)', () => {
  it('armarFilasImpreso lista los componentes del lote (D5)', () => {
    const filas = armarFilasImpreso(listaFake);
    expect(filas).toHaveLength(1);
    expect(filas[0]?.tela).toBe('Felpa');
    expect(filas[0]?.loteClave).toBe('LOTE-A');
    expect(filas[0]?.componentes).toEqual(['Felpa (100)', 'Cardigan (40)']);
  });

  it('armarDatos resuelve totales y empresa de la sesión', async () => {
    const datos = await armarDatosImpresoInventarioTelas(sesion, {}, undefined, {
      consultarExistenciasTela: () => Promise.resolve(listaFake),
    });
    expect(datos.empresa).toBe(sesion.nombreEmpresaActiva);
    expect(datos.totalRenglones).toBe(1);
    expect(datos.totalExistencia).toBe(100);
  });

  it('genera un PDF (Buffer que empieza con %PDF)', async () => {
    const datos = await armarDatosImpresoInventarioTelas(sesion, {}, undefined, {
      consultarExistenciasTela: () => Promise.resolve(listaFake),
    });
    const buffer = await generarPdfInventarioTelas(datos);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('impresoInventarioTelas devuelve un Buffer PDF (end-to-end con fake)', async () => {
    const buffer = await impresoInventarioTelas(sesion, {}, undefined, {
      consultarExistenciasTela: () => Promise.resolve(listaFake),
    });
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
