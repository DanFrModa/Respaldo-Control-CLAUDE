/**
 * Tests de INTEGRACIÓN de las MEDIDAS POR TALLA de un avío del BOM (F8-E1, R18). Contra Postgres
 * efímero (testcontainers): un modelo con un avío en el BOM + 2 tallas; guardar medidas
 * (`consumoPorTalla=true`, 2 tallas con consumo distinto), leerlas, reemplazar el set (actualizar
 * una / quitar otra) y los errores (avío fuera del BOM, talla inexistente). Corre en CI (NUNCA
 * Docker local, regla §7 de CLAUDE.md).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import type { ClavePermiso } from '../../contrato/index.js';
import type { Empresa, PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { guardarMedidasAvio, obtenerMedidasAvio } from './medidas-avio-talla.js';

let cliente: PrismaClient;
let empresa: Empresa;

const PERMISOS: ClavePermiso[] = ['modelos.ver', 'modelos.administrar'];
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
});

/** Crea un modelo con UN avío en el BOM + 2 tallas activas. */
async function prepararModeloConAvio() {
  const avio = await cliente.avio.create({
    data: { clave: 'CIE', descripcion: 'Cierre', precioReferencia: 5 },
  });
  const modelo = await cliente.modelo.create({
    data: {
      codigo: 'MOD-MEDIDAS',
      avios: { create: [{ idAvio: avio.id, consumoPorPrenda: 1 }] },
    },
  });
  const tallaCh = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  const tallaG = await cliente.talla.create({ data: { etiqueta: 'G', orden: 2 } });
  return { avio, modelo, tallaCh, tallaG };
}

describe('guardarMedidasAvio / obtenerMedidasAvio (R18)', () => {
  it('guarda las medidas por talla y las lee (consumoPorTalla=true)', async () => {
    const { avio, modelo, tallaCh, tallaG } = await prepararModeloConAvio();

    const guardado = await guardarMedidasAvio(
      sesion(),
      modelo.id,
      avio.id,
      {
        consumoPorTalla: true,
        tallas: [
          { idTalla: tallaCh.id, consumo: 0.5 },
          { idTalla: tallaG.id, consumo: 0.8 },
        ],
      },
      bd(),
    );

    expect(guardado.consumoPorTalla).toBe(true);
    expect(guardado.tallas).toHaveLength(2);
    // Ordenadas por el orden canónico de la talla.
    expect(guardado.tallas[0]).toMatchObject({
      idTalla: tallaCh.id,
      etiquetaTalla: 'CH',
      consumo: 0.5,
    });
    expect(guardado.tallas[1]).toMatchObject({
      idTalla: tallaG.id,
      etiquetaTalla: 'G',
      consumo: 0.8,
    });

    // Se lee lo persistido.
    const leido = await obtenerMedidasAvio(sesion(), modelo.id, avio.id, bd());
    expect(leido.consumoPorTalla).toBe(true);
    expect(leido.tallas.map((t) => t.consumo)).toEqual([0.5, 0.8]);

    // El toggle quedó persistido en el renglón ModeloAvio.
    const renglon = await cliente.modeloAvio.findUnique({
      where: { idModelo_idAvio: { idModelo: modelo.id, idAvio: avio.id } },
    });
    expect(renglon?.consumoPorTalla).toBe(true);
  });

  it('reemplaza el set: actualiza una talla y quita la otra', async () => {
    const { avio, modelo, tallaCh, tallaG } = await prepararModeloConAvio();
    await guardarMedidasAvio(
      sesion(),
      modelo.id,
      avio.id,
      {
        consumoPorTalla: true,
        tallas: [
          { idTalla: tallaCh.id, consumo: 0.5 },
          { idTalla: tallaG.id, consumo: 0.8 },
        ],
      },
      bd(),
    );

    // Set-completo: solo CH con consumo nuevo → G se quita.
    const resultado = await guardarMedidasAvio(
      sesion(),
      modelo.id,
      avio.id,
      { consumoPorTalla: true, tallas: [{ idTalla: tallaCh.id, consumo: 0.6 }] },
      bd(),
    );

    expect(resultado.tallas).toHaveLength(1);
    expect(resultado.tallas[0]).toMatchObject({ idTalla: tallaCh.id, consumo: 0.6 });

    const filas = await cliente.modeloAvioTalla.findMany({
      where: { idModelo: modelo.id, idAvio: avio.id },
    });
    expect(filas).toHaveLength(1);
    expect(filas[0]?.idTalla).toBe(tallaCh.id);
  });

  it('lanza ErrorNoEncontrado si el avío no está en el BOM del modelo', async () => {
    const { modelo, tallaCh } = await prepararModeloConAvio();
    const otroAvio = await cliente.avio.create({
      data: { clave: 'ELA', descripcion: 'Elástico' },
    });

    await expect(
      guardarMedidasAvio(
        sesion(),
        modelo.id,
        otroAvio.id,
        { consumoPorTalla: true, tallas: [{ idTalla: tallaCh.id, consumo: 0.5 }] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('lanza ErrorValidacion si una talla no existe', async () => {
    const { avio, modelo } = await prepararModeloConAvio();

    await expect(
      guardarMedidasAvio(
        sesion(),
        modelo.id,
        avio.id,
        { consumoPorTalla: true, tallas: [{ idTalla: 999999, consumo: 0.5 }] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
