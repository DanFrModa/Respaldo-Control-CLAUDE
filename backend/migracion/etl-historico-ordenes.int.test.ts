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
 *  • **NINGUNA orden se descarta por su empresa** (§Post-F9.29). Las de las 6 empresas viejas que no
 *    migran se cuelgan de la empresa PRINCIPAL conservando su empresa original en `empresaV1`; las
 *    que sí mapean su empresa **se quedan en la suya** — rescatar no es reasignar.
 *  • **El directorio no descarta a nadie que tenga datos de contacto.** Varios talleres y
 *    estampadores tienen su identidad solo en `Corto` ("Bordaprint", "Fit Print", "Eurobordados"),
 *    con su teléfono y su dirección — que es literalmente lo que la libreta existe para conservar.
 *    Lo que aun así se descarta (fichas vacías) se REPORTA (§7: nada en silencio).
 */
import { fileURLToPath } from 'node:url';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient } from '../src/datos/index.js';
import { listarHistoricoOrdenes } from '../src/dominio/consultas/historico-ordenes.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../src/pruebas/contexto.js';
import { sesionDePrueba } from '../src/pruebas/sesiones.js';

import { ENTIDAD_MAPEO, guardarMapeo } from './comun/mapeo.js';
import { Reporte } from './comun/reporte.js';
import { cargarDirectorioTerceros } from './loaders/directorio-terceros.js';
import { cargarHistoricoOrdenes } from './loaders/historico-ordenes.js';

const DIR_FIXTURES = fileURLToPath(new URL('./__fixtures__/tablas-historico', import.meta.url));

let cliente: PrismaClient;
let empresa: Empresa;
let segundaEmpresa: Empresa;
let tablasDirPrevio: string | undefined;

beforeEach(async () => {
  cliente = clientePruebas();
  tablasDirPrevio = process.env.TABLAS_DIR;
  process.env.TABLAS_DIR = DIR_FIXTURES;
  await limpiarBaseDatos(cliente);
  // DOS empresas vivas, a propósito: con una sola, "la rescatada cuelga de la principal" y "la que
  // mapea se queda en la suya" serían indistinguibles. La primera (id menor) es la PRINCIPAL — en
  // pruebas ninguna se llama "FR Moda" ni es favorita, así que el loader cae al tercer escalón.
  empresa = await crearEmpresaPrueba(cliente);
  segundaEmpresa = await crearEmpresaPrueba(cliente, 'Marilyn Fitness de Prueba');
  // La orden 1003 apunta a la empresa 9 (Zipora), que NO se mapea: es una de las "empresas muertas".
  await guardarMapeo(cliente, ENTIDAD_MAPEO.empresa, '1', empresa.id);
  await guardarMapeo(cliente, ENTIDAD_MAPEO.empresa, '2', segundaEmpresa.id);
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

describe('Archivo histórico de órdenes (§Post-F9.26/27/29)', () => {
  it('carga cabeceras, matriz color×talla y los cinco documentos de producción', async () => {
    const { resultado } = await cargarArchivo();

    // LAS CUATRO: ninguna se descarta por su empresa (§Post-F9.29).
    expect(resultado.ordenes).toBe(4);
    expect(resultado.rescatadas).toBe(1); // la 1003, de la empresa 9 (Zipora), que no migra
    expect(resultado.celdas).toBe(3); // MARINO 10+5 y ROJO 3 (los ceros no emiten fila)
    expect(resultado.procesos).toBe(5); // 1 corte + 2 entregas + 1 recibo + 1 estampado
    // ⭐ V1-E3d (§Post-F9.43(e)): la HABILITACIÓN del viejo (`OrdenesHab`), que antes se tiraba.
    expect(resultado.habilitacion).toBe(4);
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

  it('⭐ carga la HABILITACIÓN del viejo con el avío como TEXTO, sin tocar el catálogo (V1-E3d)', async () => {
    await cargarArchivo();

    const orden = await cliente.historicoOrdenV1.findFirstOrThrow({
      where: { idOrdenV1: '1001' },
      include: { habilitacion: { orderBy: { avio: 'asc' } } },
    });
    expect(orden.habilitacion).toHaveLength(2);
    // El avío llega con su descripción del catálogo VIEJO, resuelta una sola vez al migrar.
    expect(orden.habilitacion[0]).toMatchObject({ avio: 'Etiqueta de lavado', claveV1: 'E01' });
    // Y con SU cantidad y SU precio — el "precio del día" (catálogo $0.14, la orden $0.15).
    expect(orden.habilitacion[0]?.cantidad?.toNumber()).toBe(1);
    expect(orden.habilitacion[0]?.precio?.toNumber()).toBe(0.15);
    // Un avío sin descripción cae a su CLAVE: peor es un renglón mudo.
    expect(orden.habilitacion[1]?.avio).toBe('G18');

    // Un avío que ni existe en el catálogo viejo NO se pierde ni inventa nada: queda nombrado.
    const otra = await cliente.historicoOrdenV1.findFirstOrThrow({
      where: { idOrdenV1: '1002' },
      include: { habilitacion: true },
    });
    expect(otra.habilitacion.some((h) => h.avio.includes('#99'))).toBe(true);

    // ⚠️ LA CONDICIÓN DE DANIEL: ni un solo registro nuevo en el catálogo de avíos de v2.
    expect(await cliente.avio.count()).toBe(0);
  });

  it('rescata la orden de una empresa EXTINTA y guarda de cuál era (§Post-F9.29)', async () => {
    const { resultado, reporte } = await cargarArchivo();

    const rescatada = await cliente.historicoOrdenV1.findFirstOrThrow({
      where: { idOrdenV1: '1003' },
    });
    // Existe (antes se saltaba), cuelga de la empresa PRINCIPAL y dice de quién era de verdad.
    expect(rescatada.idEmpresa).toBe(empresa.id);
    expect(rescatada.empresaV1).toBe('Zipora');
    expect(resultado.rescatadas).toBe(1);

    // Y no pasa en silencio (plan §7): el reporte dice cuántas y de qué empresa.
    const renglones = reporte
      .obtenerSecciones()
      .filter((s) => s.titulo.includes('rescatadas'))
      .flatMap((s) => s.renglones);
    expect(renglones.join(' ')).toContain('Zipora');
    expect(reporte.obtenerNotas().join(' ')).toMatch(/1 órdenes de las empresas viejas/);
  });

  it('la orden de una empresa que SÍ mapea se queda en la suya (rescatar no es reasignar)', async () => {
    await cargarArchivo();

    const propia = await cliente.historicoOrdenV1.findFirstOrThrow({
      where: { idOrdenV1: '1004' },
    });
    expect(propia.idEmpresa).toBe(segundaEmpresa.id);
    expect(propia.idEmpresa).not.toBe(empresa.id);
    // `empresaV1` se llena TAMBIÉN aquí: un vacío sería ambiguo (¿activa, o sin nombre en el CSV?).
    expect(propia.empresaV1).toBe('Marilyn Fitness de Prueba');
  });

  it('SIN mapeos de empresa se niega a correr (el orden con `etl-catalogos` importa)', async () => {
    // Correrlo antes de `etl-catalogos` cargaría LAS 5,451 como rescatadas —colgadas de una sola
    // empresa y sin modelo— y re-correrlo NO lo repararía (la idempotencia nunca reescribe la
    // cabecera). Antes del rescate el error era inocuo porque se saltaban todas; ahora hay guarda.
    await cliente.mapeoMigracion.deleteMany({ where: { entidad: ENTIDAD_MAPEO.empresa } });

    await expect(cargarArchivo()).rejects.toThrow(/etl-catalogos/);
    expect(await cliente.historicoOrdenV1.count()).toBe(0);
  });

  it('la empresa vieja se puede BUSCAR desde la caja libre', async () => {
    await cargarArchivo();

    const pagina = await listarHistoricoOrdenes(
      sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: ['ordenes.ver'] }),
      { busqueda: 'zipo' },
      { cliente },
    );
    expect(pagina.datos.map((o) => o.numero)).toEqual(['5003']);
  });

  it('re-correrlo NO duplica nada (idempotencia por (idEmpresa, idOrdenV1))', async () => {
    await cargarArchivo();
    const { resultado } = await cargarArchivo();

    expect(resultado.ordenes).toBe(0);
    expect(resultado.existentes).toBe(4);
    // La rescatada ya está cargada: en la segunda corrida no se "rescata" otra vez.
    expect(resultado.rescatadas).toBe(0);
    expect(resultado.celdas).toBe(0);
    expect(resultado.procesos).toBe(0);
    // …y NADA se cuenta como "reparado". La 1002 tiene renglón en `OrdenesDet` pero TODO en ceros,
    // así que no emite ninguna celda: con la condición vieja ("tiene filas en OrdenesDet") se
    // contaba como reparada en CADA corrida —inflando la nota del reporte— sin insertar una fila.
    expect(resultado.reparadas).toBe(0);
    expect(await cliente.historicoOrdenV1.count()).toBe(4);
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
    expect(await cliente.historicoOrdenV1.count()).toBe(4);
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
