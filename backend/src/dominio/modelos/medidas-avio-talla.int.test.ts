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

/** Igual que {@link prepararModeloConAvio} pero el modelo SÍ tiene curva (CH, G) — V1-E3c. */
async function prepararModeloConCurva() {
  const base = await prepararModeloConAvio();
  const curva = await cliente.curvaTalla.create({
    data: {
      nombre: 'Curva medidas',
      items: {
        create: [
          { idTalla: base.tallaCh.id, posicion: 0 },
          { idTalla: base.tallaG.id, posicion: 1 },
        ],
      },
    },
  });
  await cliente.modelo.update({
    where: { id: base.modelo.id },
    data: { idCurvaTalla: curva.id },
  });
  return { ...base, curva };
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

  it('⭐ vaciar una talla BORRA su medida, pero la deja ÍNTEGRA en la bitácora (D3)', async () => {
    const { avio, modelo, tallaCh, tallaG } = await prepararModeloConCurva();
    const medida = await cliente.avioMedida.create({
      data: { idAvio: avio.id, medida: '15 cm', precio: 5.8 },
    });
    await guardarMedidasAvio(
      sesion(),
      modelo.id,
      avio.id,
      {
        consumoPorTalla: true,
        tallas: [
          { idTalla: tallaCh.id, consumo: 0.4, idAvioMedida: medida.id },
          { idTalla: tallaG.id, consumo: 0.6 },
        ],
      },
      bd(),
    );

    // El usuario vacía CH (una tecla) y guarda: su medida y su amarre desaparecen.
    await guardarMedidasAvio(
      sesion(),
      modelo.id,
      avio.id,
      { consumoPorTalla: true, tallas: [{ idTalla: tallaG.id, consumo: 0.6 }] },
      bd(),
    );
    const filas = await cliente.modeloAvioTalla.findMany({
      where: { idModelo: modelo.id, idAvio: avio.id },
    });
    expect(filas).toHaveLength(1);

    // …y la bitácora conserva CON QUÉ se fue (sin esto no habría cómo reconstruirla).
    const bitacora = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'Modelo', idEntidad: String(modelo.id), accion: 'MODIFICAR' },
      orderBy: { id: 'desc' },
    });
    expect(bitacora.datos).toMatchObject({
      bom: 'medidas-avio',
      idAvio: avio.id,
    });
    const datos = bitacora.datos as {
      tallasRetiradas?: {
        idTalla: number;
        etiquetaTalla: string;
        consumo: number;
        idAvioMedida: number | null;
      }[];
    };
    expect(datos.tallasRetiradas).toEqual([
      {
        idTalla: tallaCh.id,
        etiquetaTalla: 'CH',
        consumo: 0.4,
        idAvioMedida: medida.id,
      },
    ]);
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

  it('⭐ arma la matriz desde la CURVA del modelo (consumo 0 sin capturar) y dice tieneCurva', async () => {
    const { avio, modelo, tallaCh, tallaG } = await prepararModeloConCurva();

    // Recién creado: NADIE ha capturado medidas, pero la matriz YA existe (una fila por talla de
    // la curva). Antes de V1-E3c esto salía vacío y la UI mentía con "el modelo no tiene curva".
    const inicial = await obtenerMedidasAvio(sesion(), modelo.id, avio.id, bd());
    expect(inicial.tieneCurva).toBe(true);
    expect(inicial.tallas).toHaveLength(2);
    expect(inicial.tallas.map((t) => t.etiquetaTalla)).toEqual(['CH', 'G']);
    // SIN capturar ⇒ `null` (fila de pantalla, no de BD). Si aquí saliera 0, la UI lo devolvería
    // en el set-completo, crearía la fila y hundiría el promedio del precosto.
    expect(inicial.tallas.every((t) => t.consumo === null && t.enCurva)).toBe(true);

    // Capturar UNA talla deja la otra en la matriz con 0 (no desaparece).
    const guardado = await guardarMedidasAvio(
      sesion(),
      modelo.id,
      avio.id,
      { consumoPorTalla: true, tallas: [{ idTalla: tallaCh.id, consumo: 0.5 }] },
      bd(),
    );
    expect(guardado.tallas).toHaveLength(2);
    expect(guardado.tallas[0]).toMatchObject({ idTalla: tallaCh.id, consumo: 0.5, enCurva: true });
    // La talla NO capturada sigue en la matriz para poder teclearla, pero con `consumo: null` y
    // SIN fila en BD (no entra al promedio del precosto ni apaga el aviso del MRP).
    expect(guardado.tallas[1]).toMatchObject({ idTalla: tallaG.id, consumo: null, enCurva: true });
    const filas = await cliente.modeloAvioTalla.findMany({
      where: { idModelo: modelo.id, idAvio: avio.id },
    });
    expect(filas).toHaveLength(1);
    expect(filas[0]?.idTalla).toBe(tallaCh.id);
  });

  it('un CERO capturado a propósito SÍ es una medida (fila real), distinta de "sin capturar"', async () => {
    const { avio, modelo, tallaCh, tallaG } = await prepararModeloConCurva();

    // CH lleva cero de verdad (esa talla no usa el avío); G no se captura.
    const guardado = await guardarMedidasAvio(
      sesion(),
      modelo.id,
      avio.id,
      { consumoPorTalla: true, tallas: [{ idTalla: tallaCh.id, consumo: 0 }] },
      bd(),
    );
    expect(guardado.tallas[0]).toMatchObject({ idTalla: tallaCh.id, consumo: 0 });
    expect(guardado.tallas[1]).toMatchObject({ idTalla: tallaG.id, consumo: null });

    // El cero SÍ existe en BD: es una decisión capturada, no un hueco.
    const filas = await cliente.modeloAvioTalla.findMany({
      where: { idModelo: modelo.id, idAvio: avio.id },
    });
    expect(filas).toHaveLength(1);
    expect(filas[0]?.idTalla).toBe(tallaCh.id);
    expect(filas[0]?.consumo.toNumber()).toBe(0);
  });

  it('un modelo SIN curva reporta tieneCurva=false (y solo muestra lo capturado)', async () => {
    const { avio, modelo, tallaCh } = await prepararModeloConAvio();
    const leido = await obtenerMedidasAvio(sesion(), modelo.id, avio.id, bd());
    expect(leido.tieneCurva).toBe(false);
    expect(leido.tallas).toHaveLength(0);

    // Lo capturado con otra curva NO se pierde: sale marcado fuera de curva.
    await guardarMedidasAvio(
      sesion(),
      modelo.id,
      avio.id,
      { consumoPorTalla: true, tallas: [{ idTalla: tallaCh.id, consumo: 0.4 }] },
      bd(),
    );
    const conHuerfana = await obtenerMedidasAvio(sesion(), modelo.id, avio.id, bd());
    expect(conHuerfana.tallas).toHaveLength(1);
    expect(conHuerfana.tallas[0]).toMatchObject({ consumo: 0.4, enCurva: false });
  });

  it('amarra la MEDIDA del avío a la talla (R5/B11) y la devuelve con su precio', async () => {
    const { avio, modelo, tallaCh } = await prepararModeloConCurva();
    const medida = await cliente.avioMedida.create({
      data: { idAvio: avio.id, medida: '15 cm', precio: 5.8 },
    });

    const guardado = await guardarMedidasAvio(
      sesion(),
      modelo.id,
      avio.id,
      {
        consumoPorTalla: true,
        tallas: [{ idTalla: tallaCh.id, consumo: 1, idAvioMedida: medida.id }],
      },
      bd(),
    );
    expect(guardado.tallas[0]).toMatchObject({
      idAvioMedida: medida.id,
      medidaAmarrada: '15 cm',
      precioMedida: 5.8,
    });

    const fila = await cliente.modeloAvioTalla.findUnique({
      where: {
        idModelo_idAvio_idTalla: {
          idModelo: modelo.id,
          idAvio: avio.id,
          idTalla: tallaCh.id,
        },
      },
    });
    expect(fila?.idAvioMedida).toBe(medida.id);
  });

  it('rechaza amarrar una medida que no es de ese avío o está desactivada', async () => {
    const { avio, modelo, tallaCh } = await prepararModeloConCurva();
    const otroAvio = await cliente.avio.create({
      data: { clave: 'ELA2', descripcion: 'Elástico' },
    });
    const medidaAjena = await cliente.avioMedida.create({
      data: { idAvio: otroAvio.id, medida: '3 cm', precio: 2 },
    });
    const medidaApagada = await cliente.avioMedida.create({
      data: { idAvio: avio.id, medida: '18 cm', precio: 6, activo: false },
    });

    await expect(
      guardarMedidasAvio(
        sesion(),
        modelo.id,
        avio.id,
        {
          consumoPorTalla: true,
          tallas: [{ idTalla: tallaCh.id, consumo: 1, idAvioMedida: medidaAjena.id }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    await expect(
      guardarMedidasAvio(
        sesion(),
        modelo.id,
        avio.id,
        {
          consumoPorTalla: true,
          tallas: [{ idTalla: tallaCh.id, consumo: 1, idAvioMedida: medidaApagada.id }],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
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
