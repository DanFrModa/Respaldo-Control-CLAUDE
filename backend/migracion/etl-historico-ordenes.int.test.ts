/**
 * Integración del ETL del ARCHIVO HISTÓRICO DE ÓRDENES y del DIRECTORIO DE TERCEROS (§Post-F9.26 a
 * §Post-F9.28) — corre en CI (testcontainers), NO en local.
 *
 * Como el resto de los ETL, `Respaldo CLAUDE/TABLAS/` no existe en CI: se apunta a un dump de
 * juguete committeado (`__fixtures__/tablas-historico/`) vía `TABLAS_DIR`.
 *
 * Lo que fija (los dos defectos que encontró la revisión, además del camino feliz):
 *  • **La idempotencia vale aunque la corrida se caiga a media carga.** Si una corrida escribe las
 *    cabeceras y muere antes del detalle, re-correr TIENE que completar las celdas y los procesos
 *    que faltan — antes las daba por cargadas e insertaba 0, dejando miles de órdenes vacías para
 *    siempre.
 *  • **El directorio no descarta a nadie que tenga datos de contacto.** Varios talleres y
 *    estampadores tienen su identidad solo en `Corto` ("Bordaprint", "Fit Print", "Eurobordados"),
 *    con su teléfono y su dirección — que es literalmente lo que la libreta existe para conservar.
 *    Lo que aun así se descarta (fichas vacías) se REPORTA (§7: nada en silencio).
 */
import { fileURLToPath } from 'node:url';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient } from '../src/datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../src/pruebas/contexto.js';

import { ENTIDAD_MAPEO, guardarMapeo } from './comun/mapeo.js';
import { Reporte } from './comun/reporte.js';
import { cargarDirectorioTerceros } from './loaders/directorio-terceros.js';
import { cargarHistoricoOrdenes } from './loaders/historico-ordenes.js';

const DIR_FIXTURES = fileURLToPath(new URL('./__fixtures__/tablas-historico', import.meta.url));

let cliente: PrismaClient;
let empresa: Empresa;
let tablasDirPrevio: string | undefined;

beforeEach(async () => {
  cliente = clientePruebas();
  tablasDirPrevio = process.env.TABLAS_DIR;
  process.env.TABLAS_DIR = DIR_FIXTURES;
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
  // La orden 1003 apunta a la empresa 9, que NO se mapea: es una de las "empresas muertas".
  await guardarMapeo(cliente, ENTIDAD_MAPEO.empresa, '1', empresa.id);
});

afterAll(async () => {
  if (tablasDirPrevio === undefined) delete process.env.TABLAS_DIR;
  else process.env.TABLAS_DIR = tablasDirPrevio;
  await cliente.$disconnect();
});

/** Corre el loader del archivo con un reporte limpio. */
async function cargarArchivo() {
  const reporte = new Reporte();
  const resultado = await cargarHistoricoOrdenes(cliente, reporte);
  return { resultado, reporte };
}

describe('Archivo histórico de órdenes (§Post-F9.26/27)', () => {
  it('carga cabeceras, matriz color×talla y los cinco documentos de producción', async () => {
    const { resultado } = await cargarArchivo();

    expect(resultado.ordenes).toBe(2); // 1001 y 1002 (la 1003 no tiene empresa mapeada)
    expect(resultado.sinEmpresa).toBe(1);
    expect(resultado.celdas).toBe(3); // MARINO 10+5 y ROJO 3 (los ceros no emiten fila)
    expect(resultado.procesos).toBe(5); // 1 corte + 2 entregas + 1 recibo + 1 estampado
    expect(resultado.reparadas).toBe(0);

    const orden = await cliente.historicoOrdenV1.findFirstOrThrow({
      where: { idOrdenV1: '1001' },
    });
    expect(orden.numero).toBe('5001');
    expect(orden.cliente).toBe('Comercial Uno');
    expect(orden.totalPiezas).toBe(18);
    // §Post-F9.27 — TODOS los que la trabajaron, ordenados y sin repetir.
    expect(orden.cortadores).toBe('Oscar Aragon');
    expect(orden.maquileros).toBe('MONT · Taller Sosa');
    expect(orden.estampadores).toBe('Bordados SA');
  });

  it('re-correrlo NO duplica nada (idempotencia por (idEmpresa, idOrdenV1))', async () => {
    await cargarArchivo();
    const { resultado } = await cargarArchivo();

    expect(resultado.ordenes).toBe(0);
    expect(resultado.existentes).toBe(2);
    expect(resultado.celdas).toBe(0);
    expect(resultado.procesos).toBe(0);
    // …y NADA se cuenta como "reparado". La 1002 tiene renglón en `OrdenesDet` pero TODO en ceros,
    // así que no emite ninguna celda: con la condición vieja ("tiene filas en OrdenesDet") se
    // contaba como reparada en CADA corrida —inflando la nota del reporte— sin insertar una fila.
    expect(resultado.reparadas).toBe(0);
    expect(await cliente.historicoOrdenV1.count()).toBe(2);
    expect(await cliente.historicoOrdenV1Linea.count()).toBe(3);
    expect(await cliente.historicoOrdenV1Proceso.count()).toBe(5);
  });

  it('re-correrlo COMPLETA una orden que quedó SIN detalle (corrida interrumpida)', async () => {
    await cargarArchivo();
    const orden = await cliente.historicoOrdenV1.findFirstOrThrow({ where: { idOrdenV1: '1001' } });
    // Simula la caída: las cabeceras quedaron escritas, el detalle no.
    await cliente.historicoOrdenV1Linea.deleteMany({ where: { idOrden: orden.id } });
    await cliente.historicoOrdenV1Proceso.deleteMany({ where: { idOrden: orden.id } });

    const { resultado } = await cargarArchivo();

    expect(resultado.reparadas).toBe(1);
    expect(resultado.ordenes).toBe(0); // la cabecera ya estaba: no se re-inserta
    expect(resultado.celdas).toBe(3);
    expect(resultado.procesos).toBe(5);
    // Y no se duplicó nada de lo que sí había quedado.
    expect(await cliente.historicoOrdenV1.count()).toBe(2);
    expect(await cliente.historicoOrdenV1Linea.count()).toBe(3);
    expect(await cliente.historicoOrdenV1Proceso.count()).toBe(5);
  });
});

describe('Directorio histórico de terceros (§Post-F9.28)', () => {
  it('conserva a los que solo tienen CLAVE CORTA — con su teléfono y su dirección', async () => {
    const reporte = new Reporte();
    const resultado = await cargarDirectorioTerceros(cliente, reporte);

    // 1 proveedor + 1 cortador + 3 maquileros + 1 estampador (las 3 fichas vacías, fuera).
    expect(resultado.creados).toBe(6);
    expect(resultado.descartados).toBe(3);

    // El taller que en el Access solo tiene `Corto`: antes se perdía en silencio.
    const soloCorto = await cliente.directorioTerceroV1.findFirstOrThrow({
      where: { fuente: 'Maquileros', idViejo: '21' },
    });
    expect(soloCorto.nombre).toBe('MONT');
    expect(soloCorto.telefono).toBe('5555-3333');
    expect(soloCorto.direccion).toBe('Calle 2');

    // El caso real que motivó el arreglo (Bordaprint/Fit Print/Eurobordados en `Estampadores`).
    const bordaprint = await cliente.directorioTerceroV1.findFirstOrThrow({
      where: { fuente: 'Estampadores', idViejo: '17' },
    });
    expect(bordaprint.nombre).toBe('Bordaprint');
    expect(bordaprint.telefono).toBe('5360-5001');
    expect(bordaprint.direccion).toBe('Atenco 27 Naucalpan');
  });

  it('lo que aun así se descarta se REPORTA, nunca en silencio', async () => {
    const reporte = new Reporte();
    await cargarDirectorioTerceros(cliente, reporte);

    const detalle = reporte
      .obtenerSecciones()
      .filter((s) => s.titulo.includes('ficha VACÍA'))
      .flatMap((s) => s.renglones);
    expect(detalle).toHaveLength(3);
    expect(detalle.join(' ')).toContain('Maquileros #22');
    expect(reporte.obtenerNotas().join(' ')).toMatch(/3 fichas del Access quedaron fuera/);
  });

  it('la última actividad sale de los documentos del viejo, sin ventana de años', async () => {
    const reporte = new Reporte();
    await cargarDirectorioTerceros(cliente, reporte);

    // El taller 21 tiene una entrega de 2019 y una NOTA de 2026: manda la más reciente.
    const taller = await cliente.directorioTerceroV1.findFirstOrThrow({
      where: { fuente: 'Maquileros', idViejo: '21' },
    });
    expect(taller.ultimaActividad?.toISOString().slice(0, 10)).toBe('2026-03-03');
    expect(taller.documentos).toBe(2);
  });

  it('re-correrlo no duplica: los ya cargados se cuentan como existentes', async () => {
    await cargarDirectorioTerceros(cliente, new Reporte());
    const resultado = await cargarDirectorioTerceros(cliente, new Reporte());

    expect(resultado.creados).toBe(0);
    expect(resultado.existentes).toBe(6);
    expect(await cliente.directorioTerceroV1.count()).toBe(6);
  });
});
