/**
 * Integración de **el nº de producción de cada OC, dicho ANTES de confirmar** (fila 0.151,
 * `numero-produccion-pdf.ts`) contra Postgres real. Lo que sólo la base puede demostrar:
 *
 *  (a) de una OC cuyo color todavía no tiene modelo NACE uno, y el número propuesto es el hueco
 *      libre más bajo de la serie del modelo;
 *  (b) ⭐ **dos OC del mismo modelo y COLORES distintos en la misma tanda reciben números
 *      DISTINTOS** — que es el caso de Daniel (cuatro colores, cuatro números) y lo único que
 *      impide que la vista previa precargue cuatro veces el mismo número y reviente al confirmar;
 *  (c) dos OC del mismo modelo y el MISMO color: la segunda sale `reusado`, no estrena número;
 *  (d) un color que YA tiene modelo de producción sale `reusado` con el número de ese modelo;
 *  (e) un modelo que ya es de producción sale `heredado`;
 *  (f) un modelo al que le faltan los dígitos de la nomenclatura NO tumba la vista previa: sale sin
 *      propuesta y con el motivo en `avisos`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { enTransaccion } from '../../comun/transaccion.js';
import type { PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { resolverNumerosDeProduccion } from './numero-produccion-pdf.js';

let cliente: PrismaClient;
let idTipoProducto: number;
let idGenero: number;

const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});
afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  await crearEmpresaPrueba(cliente);
  // Dígitos de la nomenclatura: pantalón (7) + caballero (1) → serie 71.
  const tipo = await cliente.tipoProducto.create({
    data: { nombre: 'Pantalón', digitoConcepto: 7 },
  });
  idTipoProducto = tipo.id;
  const genero = await cliente.genero.create({
    data: { nombre: 'Caballero', digitoNomenclatura: 1, digitoAlterno: 5 },
  });
  idGenero = genero.id;
});

/** Modelo de DESARROLLO con sus dos dígitos (el caso normal de una OC del cliente). */
async function crearDesarrollo(codigo: string, conDigitos = true): Promise<number> {
  const modelo = await cliente.modelo.create({
    data: {
      codigo,
      codigoDesarrollo: codigo,
      origen: 'desarrollo',
      ...(conDigitos ? { idTipoProducto, idGenero } : {}),
    },
    select: { id: true },
  });
  return modelo.id;
}

async function crearColor(nombre: string): Promise<number> {
  const color = await cliente.color.create({ data: { nombre }, select: { id: true } });
  return color.id;
}

/** Corre el resolvedor dentro de una transacción (pide `Tx`). */
async function resolver(renglones: Parameters<typeof resolverNumerosDeProduccion>[1]) {
  return enTransaccion((tx) => resolverNumerosDeProduccion(tx, renglones), bd());
}

describe('resolverNumerosDeProduccion (vista previa del importador por PDF)', () => {
  it('(a) un color sin modelo → NACE, con el hueco libre más bajo de su serie', async () => {
    const idModelo = await crearDesarrollo('CYA-26-71-001');
    const idColor = await crearColor('Blanco');

    const [uno] = await resolver([{ idModelo, idColor, claveColor: 'blanco' }]);

    expect(uno).toEqual({
      modeloDeProduccion: 'nacido',
      numeroProduccionPropuesto: 71_001,
      numeroProduccionModelo: null,
      avisos: [],
    });
  });

  it('⭐ (b) CUATRO OC de CUATRO colores del mismo modelo → CUATRO números distintos', async () => {
    const idModelo = await crearDesarrollo('CYA-26-71-001');
    const colores = await Promise.all(
      ['Blanco', 'Negro', 'Rojo', 'Azul'].map((n) => crearColor(n)),
    );

    const salida = await resolver(
      colores.map((idColor, i) => ({
        idModelo,
        idColor,
        claveColor: ['blanco', 'negro', 'rojo', 'azul'][i]!,
      })),
    );

    expect(salida.map((s) => s.modeloDeProduccion)).toEqual([
      'nacido',
      'nacido',
      'nacido',
      'nacido',
    ]);
    // 🔴 Sin apartar los ya propuestos, los cuatro traerían 71001: el usuario confirmaría creyendo
    // que son cuatro y el segundo nacimiento tumbaría la tanda entera.
    expect(salida.map((s) => s.numeroProduccionPropuesto)).toEqual([
      71_001, 71_002, 71_003, 71_004,
    ]);
  });

  it('(b2) dos DESARROLLOS distintos de la misma serie tampoco comparten número', async () => {
    const idA = await crearDesarrollo('CYA-26-71-001');
    const idB = await crearDesarrollo('CYA-26-71-002');
    const idColor = await crearColor('Blanco');

    const salida = await resolver([
      { idModelo: idA, idColor, claveColor: 'blanco' },
      { idModelo: idB, idColor, claveColor: 'blanco' },
    ]);

    expect(salida.map((s) => s.numeroProduccionPropuesto)).toEqual([71_001, 71_002]);
  });

  it('(c) dos OC del MISMO modelo y MISMO color: la segunda REUSA lo que nace en la primera', async () => {
    const idModelo = await crearDesarrollo('CYA-26-71-001');
    const idColor = await crearColor('Blanco');

    const salida = await resolver([
      { idModelo, idColor, claveColor: 'blanco' },
      { idModelo, idColor, claveColor: 'blanco' },
    ]);

    expect(salida[0]).toMatchObject({
      modeloDeProduccion: 'nacido',
      numeroProduccionPropuesto: 71_001,
    });
    expect(salida[1]).toMatchObject({
      modeloDeProduccion: 'reusado',
      numeroProduccionPropuesto: null,
      // El número que va a estrenar el PRIMERO: es con el que va a quedar esta OP.
      numeroProduccionModelo: 71_001,
    });
    expect(salida[1]?.avisos[0]).toContain('Otra OC de esta misma tanda');
  });

  it('(c2) dos colores NUEVOS distintos (ninguno existe todavía) NO se confunden entre sí', async () => {
    const idModelo = await crearDesarrollo('CYA-26-71-001');

    const salida = await resolver([
      { idModelo, idColor: null, claveColor: 'verde limon' },
      { idModelo, idColor: null, claveColor: 'azul rey' },
    ]);

    expect(salida.map((s) => s.modeloDeProduccion)).toEqual(['nacido', 'nacido']);
    expect(salida.map((s) => s.numeroProduccionPropuesto)).toEqual([71_001, 71_002]);
  });

  it('(d) un color que YA tiene modelo de producción sale REUSADO con el número de ése', async () => {
    const idModelo = await crearDesarrollo('CYA-26-71-001');
    const idColor = await crearColor('Blanco');
    await cliente.modelo.create({
      data: {
        codigo: '71007',
        origen: 'produccion',
        numeroProduccion: 71_007,
        idModeloDesarrollo: idModelo,
        idColor,
      },
    });

    const [uno] = await resolver([{ idModelo, idColor, claveColor: 'blanco' }]);

    expect(uno).toMatchObject({
      modeloDeProduccion: 'reusado',
      numeroProduccionPropuesto: null,
      numeroProduccionModelo: 71_007,
    });
    expect(uno?.avisos[0]).toContain('71007');
  });

  it('(e) un modelo que ya es de PRODUCCIÓN sale HEREDADO (rama legado del Access)', async () => {
    const modelo = await cliente.modelo.create({
      data: { codigo: '51783', origen: 'produccion', numeroProduccion: 51_783 },
      select: { id: true },
    });
    const idColor = await crearColor('Blanco');

    const [uno] = await resolver([{ idModelo: modelo.id, idColor, claveColor: 'blanco' }]);

    expect(uno).toEqual({
      modeloDeProduccion: 'heredado',
      numeroProduccionPropuesto: null,
      numeroProduccionModelo: 51_783,
      avisos: [],
    });
  });

  it('(f) un modelo SIN dígitos no tumba la previa: sale sin propuesta y con el motivo', async () => {
    const idModelo = await crearDesarrollo('SIN-DIGITOS', false);
    const idColor = await crearColor('Blanco');

    const [uno] = await resolver([{ idModelo, idColor, claveColor: 'blanco' }]);

    expect(uno).toMatchObject({
      modeloDeProduccion: 'nacido',
      numeroProduccionPropuesto: null,
    });
    expect(uno?.avisos[0]).toContain('No se puede numerar el modelo');
  });

  it('un PDF sin liga no habla de ningún modelo', async () => {
    const [uno] = await resolver([{ idModelo: null, idColor: null, claveColor: '' }]);

    expect(uno).toEqual({
      modeloDeProduccion: null,
      numeroProduccionPropuesto: null,
      numeroProduccionModelo: null,
      avisos: [],
    });
  });
});
