/**
 * Tests de INTEGRACIÓN de la EXTENSIÓN del pre-costo F7 con AMARRES de precio (F8-E1, R17). Contra
 * Postgres efímero (testcontainers): verifica las dos mitades del criterio de cierre —
 *  (a) NO-REGRESIÓN: un modelo SIN amarres precostea IDÉNTICO a F7 (tela = consumo × precioSugerido,
 *      avío = consumo × precioReferencia — F7 NO aplicaba "más barato" en el pre-costo);
 *  (b) AMARRE: un modelo con la tela amarrada a un `TelaProveedor` y el avío amarrado a un proveedor
 *      valúa con el precio del AMARRE (aunque exista un proveedor más barato no amarrado).
 * Corre en CI (NUNCA Docker local, regla §7 de CLAUDE.md).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ClavePermiso } from '../../contrato/index.js';

import { calcularPreCosto } from './pre-costo.js';

let cliente: PrismaClient;
let empresa: Empresa;

const PERMISOS: ClavePermiso[] = ['precostos.consultar', 'consultas.ver-importes'];
const sesion = () => sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERMISOS });
const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
  await cliente.configuracionEmpresa.create({
    data: { idEmpresa: empresa.id, utilidadSugerida: 50, regaliasBase: 10 },
  });
});

describe('calcularPreCosto — no-regresión F7 (modelo SIN amarres)', () => {
  it('valúa tela por precioSugerido y avío por precioReferencia, igual que F7', async () => {
    const tela = await cliente.tela.create({ data: { nombre: 'Felpa', precioSugerido: 20 } });
    const avio = await cliente.avio.create({
      data: { clave: 'BOT', descripcion: 'Botón', precioReferencia: 3 },
    });
    // Un proveedor MÁS BARATO existe pero NO hay amarre → NO debe influir (F7 usa precioReferencia).
    const provBarato = await cliente.proveedor.create({ data: { nombre: 'Botones Baratos' } });
    await cliente.avioProveedor.create({
      data: { idAvio: avio.id, idProveedor: provBarato.id, precio: 1 },
    });

    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'SIN-AMARRE',
        maquilaBase: 8,
        telas: { create: [{ idTela: tela.id, consumoPorPrenda: 1.5 }] },
        avios: { create: [{ idAvio: avio.id, consumoPorPrenda: 2 }] },
      },
    });

    const pre = await calcularPreCosto(sesion(), modelo.id, bd());
    expect(pre.totalTela).toBe(30); // 1.5 × 20 (precioSugerido)
    expect(pre.totalAvios).toBe(6); // 2 × 3 (precioReferencia) — NO el proveedor barato (1)
    expect(pre.maquila).toBe(8);
    expect(pre.costoTotal).toBe(44); // 30 + 6 + 0 bordado + 8
  });
});

describe('calcularPreCosto — con AMARRES (F8, R17)', () => {
  it('valúa tela y avío con el precio del proveedor amarrado (aunque exista uno más barato)', async () => {
    const tela = await cliente.tela.create({ data: { nombre: 'Felpa', precioSugerido: 20 } });
    const provTela = await cliente.proveedor.create({ data: { nombre: 'Telas SA' } });
    // Amarre de tela: precio 25 (distinto del sugerido 20) → debe ganar.
    const telaProv = await cliente.telaProveedor.create({
      data: { idTela: tela.id, idProveedor: provTela.id, precio: 25 },
    });

    const avio = await cliente.avio.create({
      data: { clave: 'BOT', descripcion: 'Botón', precioReferencia: 3 },
    });
    const provCaro = await cliente.proveedor.create({ data: { nombre: 'Botones Caros' } });
    const provBarato = await cliente.proveedor.create({ data: { nombre: 'Botones Baratos' } });
    // El amarrado (caro, 5) debe ganar sobre el más barato no amarrado (2).
    await cliente.avioProveedor.create({
      data: { idAvio: avio.id, idProveedor: provCaro.id, precio: 5 },
    });
    await cliente.avioProveedor.create({
      data: { idAvio: avio.id, idProveedor: provBarato.id, precio: 2 },
    });

    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'CON-AMARRE',
        maquilaBase: 8,
        telas: {
          create: [{ idTela: tela.id, consumoPorPrenda: 1.5, idTelaProveedor: telaProv.id }],
        },
        avios: {
          create: [{ idAvio: avio.id, consumoPorPrenda: 2, idAvioProveedor: provCaro.id }],
        },
      },
    });

    const pre = await calcularPreCosto(sesion(), modelo.id, bd());
    expect(pre.totalTela).toBe(37.5); // 1.5 × 25 (amarre, NO el sugerido 20)
    expect(pre.totalAvios).toBe(10); // 2 × 5 (amarre caro, NO el barato 2 ni la referencia 3)
    expect(pre.costoTotal).toBe(55.5); // 37.5 + 10 + 8
  });
});
