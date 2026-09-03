import { describe, expect, it } from 'vitest';

import { sesionDePrueba } from '../../../pruebas/sesiones.js';
import { MAX_FILAS_PDF } from '../../../comun/impreso-topes.js';
import type { ExistenciasTelaColorLista } from '../../../contrato/index.js';
import {
  armarDatosImpresoInventarioTelas,
  armarFilasImpreso,
  generarPdfInventarioTelas,
  impresoInventarioTelas,
} from './impreso-inventario-telas.js';

/**
 * Unit del impreso 'Inventario de telas' (F4-E1, R9). SIN BD: se inyecta un
 * `consultarExistenciasTelaColor` fake.
 *
 * 🔴 El caso que da nombre a esta prueba: hasta v0.097 el impreso leía la consulta LEGADA por lote
 * (`consultarExistenciasTela`) mientras la pantalla que se usa lee la de COLOR, así que la hoja
 * salía prácticamente en blanco. Por eso el fake que se inyecta aquí es el de COLOR: si alguien
 * vuelve a colgar el impreso de la consulta vieja, este archivo deja de compilar.
 */
const listaFake: ExistenciasTelaColorLista = {
  telas: [
    {
      idTela: 1,
      nombre: 'Felpa Suiza',
      categoria: 'Punto',
      idProveedor: 2,
      proveedor: 'Textiles SA',
      nombreProveedor: 'FELPA-800',
      unidadMedida: 'KG',
      nombreCuerpo: 'Felpa',
      nombreComplemento: 'Cardigan',
      totalCuerpo: 130,
      totalComplemento: 45,
      colores: [
        {
          idTelaColor: 10,
          nombre: 'Marino',
          pantone: '19-3920',
          existenciaCuerpo: 130,
          existenciaComplemento: 45,
          almacenes: [
            { idAlmacen: 5, almacen: 'Bodega A', cuerpo: 100, complemento: 40 },
            { idAlmacen: 6, almacen: 'Bodega B', cuerpo: 30, complemento: 5 },
          ],
        },
      ],
    },
    {
      idTela: 2,
      nombre: 'Lisa Algodón',
      categoria: null,
      idProveedor: null,
      proveedor: null,
      nombreProveedor: null,
      unidadMedida: 'M',
      nombreCuerpo: null,
      // SIN complemento: la pantalla pinta "—", no un 0 — el impreso tiene que decir lo mismo.
      nombreComplemento: null,
      totalCuerpo: 7,
      totalComplemento: 0,
      colores: [
        {
          idTelaColor: 20,
          nombre: 'Negro',
          pantone: null,
          existenciaCuerpo: 7,
          existenciaComplemento: 0,
          almacenes: [{ idAlmacen: 5, almacen: 'Bodega A', cuerpo: 7, complemento: 0 }],
        },
      ],
    },
  ],
  totalCuerpo: 137,
  totalComplemento: 45,
};

const sesion = sesionDePrueba({ permisos: ['inventario-telas.ver'] });

describe('impreso inventario de telas (R9, inventario VIGENTE por color)', () => {
  it('desdobla tela → color → ALMACÉN en un renglón por almacén', () => {
    const filas = armarFilasImpreso(listaFake);
    // 2 almacenes del color Marino + 1 del color Negro = 3 renglones (no 2 colores).
    expect(filas).toHaveLength(3);
    expect(filas.map((f) => f.almacen)).toEqual(['Bodega A', 'Bodega B', 'Bodega A']);
    expect(filas[0]?.tela).toBe('Felpa Suiza');
    expect(filas[0]?.color).toBe('Marino');
    expect(filas[0]?.cuerpo).toBe(100);
    expect(filas[1]?.cuerpo).toBe(30);
  });

  it('pinta el CUERPO y el COMPLEMENTO por almacén, y "—" (null) en la tela que no lleva', () => {
    const filas = armarFilasImpreso(listaFake);
    expect(filas[0]?.complemento).toBe(40);
    expect(filas[1]?.complemento).toBe(5);
    // La tela SIN complemento no imprime 0: imprime "no lleva" (null → "—" en el PDF).
    expect(filas[2]?.complemento).toBeNull();
  });

  it('lleva la unidad, el pantone y el contexto (tipo/proveedor) que enseña la pantalla', () => {
    const filas = armarFilasImpreso(listaFake);
    expect(filas[0]?.unidad).toBe('kg');
    expect(filas[2]?.unidad).toBe('m');
    expect(filas[0]?.pantone).toBe('19-3920');
    expect(filas[2]?.pantone).toBe('—');
    expect(filas[0]?.contextoTela).toBe('Punto · Textiles SA · FELPA-800');
    // Tela sin categoría ni proveedor: no queda un "· ·" colgando.
    expect(filas[2]?.contextoTela).toBe('—');
  });

  it('armarDatos toma los totales DE LA CONSULTA (los mismos del pie de la pantalla)', async () => {
    const datos = await armarDatosImpresoInventarioTelas(sesion, {}, undefined, {
      consultarExistenciasTelaColor: () => Promise.resolve(listaFake),
    });
    expect(datos.empresa).toBe(sesion.nombreEmpresaActiva);
    expect(datos.totalRenglones).toBe(3);
    expect(datos.totalColores).toBe(2);
    expect(datos.totalCuerpo).toBe(137);
    expect(datos.totalComplemento).toBe(45);
  });

  it('le pasa los FILTROS de la pantalla a la consulta (el papel dice lo que se está viendo)', async () => {
    let recibidos: unknown;
    await armarDatosImpresoInventarioTelas(
      sesion,
      { idAlmacen: 5, busqueda: 'felpa', incluirCeros: true },
      undefined,
      {
        consultarExistenciasTelaColor: (_s, parametros) => {
          recibidos = parametros;
          return Promise.resolve(listaFake);
        },
      },
    );
    expect(recibidos).toEqual({ idAlmacen: 5, busqueda: 'felpa', incluirCeros: true });
  });

  it('genera un PDF (Buffer que empieza con %PDF)', async () => {
    const datos = await armarDatosImpresoInventarioTelas(sesion, {}, undefined, {
      consultarExistenciasTelaColor: () => Promise.resolve(listaFake),
    });
    const buffer = await generarPdfInventarioTelas(datos);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('topa las filas a MAX_FILAS_PDF pero conserva el conteo y las Σ del universo completo', async () => {
    const n = MAX_FILAS_PDF + 25;
    const listaGrande: ExistenciasTelaColorLista = {
      telas: Array.from({ length: n }, (_, i) => ({
        idTela: i + 1,
        nombre: `Tela ${String(i)}`,
        categoria: null,
        idProveedor: null,
        proveedor: null,
        nombreProveedor: null,
        unidadMedida: 'KG' as const,
        nombreCuerpo: null,
        nombreComplemento: null,
        totalCuerpo: 1,
        totalComplemento: 0,
        colores: [
          {
            idTelaColor: i + 1,
            nombre: 'Rojo',
            pantone: null,
            existenciaCuerpo: 1,
            existenciaComplemento: 0,
            almacenes: [{ idAlmacen: 1, almacen: 'Bodega', cuerpo: 1, complemento: 0 }],
          },
        ],
      })),
      totalCuerpo: n,
      totalComplemento: 0,
    };
    const datos = await armarDatosImpresoInventarioTelas(sesion, {}, undefined, {
      consultarExistenciasTelaColor: () => Promise.resolve(listaGrande),
    });
    expect(datos.filas).toHaveLength(MAX_FILAS_PDF);
    expect(datos.totalRenglones).toBe(n);
    expect(datos.totalColores).toBe(n);
    expect(datos.totalCuerpo).toBe(n);
  });

  it('impresoInventarioTelas devuelve un Buffer PDF (end-to-end con fake)', async () => {
    const buffer = await impresoInventarioTelas(sesion, {}, undefined, {
      consultarExistenciasTelaColor: () => Promise.resolve(listaFake),
    });
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
