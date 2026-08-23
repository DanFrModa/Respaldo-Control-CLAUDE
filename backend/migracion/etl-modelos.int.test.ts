/**
 * Integración del ETL de modelos (F1-E7) — corre en CI (testcontainers), NO en local.
 *
 * Patrón idéntico a `etl-catalogos.int.test.ts`:
 *  • Apunta el ETL a fixtures CSV COMMITEADOS (`migracion/__fixtures__/tablas/`).
 *  • Siembra primero E6 (catálogos/materiales) para que los mapeos estén disponibles.
 *  • Luego corre el ETL de E7 y verifica: conteos exactos + IDEMPOTENCIA (2ª corrida = mismos).
 *
 * Verifica:
 *  • Carga de modelos vía dominio (A1): conteos deterministas de los fixtures.
 *  • Idempotencia: dos corridas NO duplican nada.
 *  • BOM: renglones de tela/avío/bordado cargados correctamente con mapeos.
 *  • Renglones sin mapeo (IdModelos=99, IdTelasDis/IdHabilitacion/IdBordados inválidos)
 *    se OMITEN sin abortar (§7 — no null silencioso, reportados al reporte).
 *  • Modelo con `Activo=0` → descontinuado (borrado suave).
 *  • Código duplicado: el segundo se omite (ErrorConflicto reportado).
 *  • Mapeo `Modelo` persistido (`MapeoMigracion`).
 *
 * NO corre ni verifica fotos (dependen de R2 + carpeta física → unitarios de fotos.test.ts).
 */
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/datos/index.js';
import { clientePruebas, limpiarBaseDatos, sembrarPermisos } from '../src/pruebas/contexto.js';

import { ejecutarEtl as ejecutarEtlCatalogos } from './etl-catalogos.js';
import { ejecutarEtlModelos } from './etl-modelos.js';
import { cargarModelos } from './loaders/modelos.js';
import { cargarBom } from './loaders/bom-modelos.js';
import { sesionEtl } from './comun/sesion-etl.js';
import { Reporte } from './comun/reporte.js';
import { ENTIDAD_MAPEO } from './comun/mapeo.js';

let cliente: PrismaClient;

const DIR_FIXTURES = fileURLToPath(new URL('./__fixtures__/tablas', import.meta.url));

let tablasDirPrevio: string | undefined;
// Desactivar fotos en los tests de integración (no hay carpetas físicas en CI).
let fotosMod: string | undefined;
let fotosBor: string | undefined;

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

async function sembrarMinimo(): Promise<void> {
  await sembrarPermisos(cliente);
  await cliente.empresa.upsert({
    where: { nombre: 'FR Moda' },
    update: {},
    create: { nombre: 'FR Moda', favorita: true, paraIpt: true, paraEdr: true },
  });
  const roles = [
    { codigo: 'maquila-costura', nombre: 'Maquila (costura)' },
    { codigo: 'corte', nombre: 'Corte' },
    { codigo: 'estampado', nombre: 'Estampado' },
    { codigo: 'vende-telas', nombre: 'Vende telas' },
    { codigo: 'vende-avios', nombre: 'Vende avíos' },
    { codigo: 'otros-servicios', nombre: 'Otros servicios' },
  ];
  for (const r of roles) {
    await cliente.rolProveedor.upsert({ where: { codigo: r.codigo }, update: {}, create: r });
  }
  // V1-E3f: el tipo del arte es una FK al catálogo ÚNICO (`TipoProceso` con `esArte`,
  // §Post-F9.58). El loader resuelve el id desde el `codigo` que devuelve `mapearTipoArte`
  // (`bordado`/`estampado`), así que sin estas dos filas NINGÚN arte se puede crear — igual que en
  // la base real, donde las siembra el seed antes de correr el ETL.
  const tiposArte = [
    { codigo: 'bordado', nombre: 'Bordado', esArte: true, usaPuntadas: true },
    { codigo: 'estampado', nombre: 'Estampado', esArte: true, usaPuntadas: false },
  ];
  for (const t of tiposArte) {
    await cliente.tipoProceso.upsert({ where: { codigo: t.codigo }, update: {}, create: t });
  }
}

beforeEach(async () => {
  tablasDirPrevio = process.env.TABLAS_DIR;
  fotosMod = process.env.ETL_FOTOS_MOD_DIR;
  fotosBor = process.env.ETL_FOTOS_BOR_DIR;
  process.env.TABLAS_DIR = DIR_FIXTURES;
  // Sin fotos en CI — el ETL las salta limpio con aviso.
  delete process.env.ETL_FOTOS_MOD_DIR;
  delete process.env.ETL_FOTOS_BOR_DIR;

  await limpiarBaseDatos(cliente);
  await sembrarMinimo();
  // E7 depende de los mapeos de E6 → correr E6 primero.
  await ejecutarEtlCatalogos(cliente);
});

afterEach(() => {
  if (tablasDirPrevio === undefined) {
    delete process.env.TABLAS_DIR;
  } else {
    process.env.TABLAS_DIR = tablasDirPrevio;
  }
  if (fotosMod === undefined) {
    delete process.env.ETL_FOTOS_MOD_DIR;
  } else {
    process.env.ETL_FOTOS_MOD_DIR = fotosMod;
  }
  if (fotosBor === undefined) {
    delete process.env.ETL_FOTOS_BOR_DIR;
  } else {
    process.env.ETL_FOTOS_BOR_DIR = fotosBor;
  }
});

/** Snapshot de los conteos de E7 (para idempotencia). */
async function conteosE7(): Promise<Record<string, number>> {
  return {
    modelos: await cliente.modelo.count(),
    modelosActivos: await cliente.modelo.count({ where: { activo: true } }),
    bomTelas: await cliente.modeloTela.count(),
    bomAvios: await cliente.modeloAvio.count(),
    artes: await cliente.modeloArte.count(),
    fotoModelo: await cliente.modeloFoto.count(),
    mapeos: await cliente.mapeoMigracion.count({ where: { entidad: ENTIDAD_MAPEO.modelo } }),
  };
}

describe('ETL de modelos F1-E7 (integración, fixtures commiteados)', () => {
  it('carga modelos con conteos EXACTOS y es IDEMPOTENTE', async () => {
    await ejecutarEtlModelos(cliente);
    const tras1 = await conteosE7();

    // Fixtures: 5 filas. M001/M002 = activos (creados), M003 = inactivo (creado y descontinuado),
    // M-DUP dos veces: el primero (IdModelos=4) se crea, el segundo (IdModelos=5) da
    // ErrorConflicto (código duplicado) y se OMITE.
    expect(tras1.modelos).toBe(4); // M001, M002, M003, M-DUP (primer ocurrencia)
    expect(tras1.modelosActivos).toBe(3); // M001, M002, M-DUP (M003 descontinuado)
    // El mapeo persiste solo los creados correctamente (4 mapeos de Modelo).
    expect(tras1.mapeos).toBe(4);

    // 2ª corrida: nada se duplica (idempotencia).
    await ejecutarEtlModelos(cliente);
    expect(await conteosE7()).toEqual(tras1);
  }, 120_000);

  it('carga el BOM con renglones de tela/avío y el ARTE del modelo correctamente', async () => {
    await ejecutarEtlModelos(cliente);
    const tras1 = await conteosE7();

    // ModelosTela.csv: 4 filas, 1 con IdModelos=99 (sin mapeo → omitida).
    // M001↔tela1, M002↔tela1, M003↔tela2 = 3 renglones válidos.
    expect(tras1.bomTelas).toBe(3);

    // ModelosHab.csv: 5 filas, 1 con IdModelos=99 (sin mapeo → omitida).
    // M001↔avío1+avío2 (2 renglones), M002↔avío1 (1), M003↔avío2 (1) = 4 válidos.
    expect(tras1.bomAvios).toBe(4);

    // ModelosBor.csv: 4 filas. IdModelos=0 omitido, IdModelos=99 omitido.
    // M001↔arte1 (1), M002↔arte2 (1) = 2 artes creados DENTRO de su modelo. El 3er arte del
    // catálogo viejo NO lo usa ningún modelo: no se migra (depuración §Post-F9.35) y va al reporte.
    expect(tras1.artes).toBe(2);

    // 2ª corrida: idempotente.
    await ejecutarEtlModelos(cliente);
    expect(await conteosE7()).toEqual(tras1);
  }, 120_000);

  it('el conteo del BOM es HONESTO: 1ª corrida creados>0/existentes=0; 2ª creados=0/existentes>0', async () => {
    // Cargar modelos primero (el BOM necesita el mapeo Modelo).
    await cargarModelos(sesionEtl(), cliente, new Reporte());

    // 1ª corrida del BOM: todo nuevo → creados>0, existentes=0.
    const bom1 = await cargarBom(sesionEtl(), cliente, new Reporte());
    expect(bom1.telas.creados).toBe(3);
    expect(bom1.telas.existentes).toBe(0);
    expect(bom1.avios.creados).toBe(4);
    expect(bom1.avios.existentes).toBe(0);
    expect(bom1.artes.creados).toBe(2);
    expect(bom1.artes.existentes).toBe(0);

    // 2ª corrida idempotente: nada nuevo → creados=0, existentes = los mismos N (NO infla).
    const bom2 = await cargarBom(sesionEtl(), cliente, new Reporte());
    expect(bom2.telas.creados).toBe(0);
    expect(bom2.telas.existentes).toBe(3);
    expect(bom2.avios.creados).toBe(0);
    expect(bom2.avios.existentes).toBe(4);
    expect(bom2.artes.creados).toBe(0);
    expect(bom2.artes.existentes).toBe(2);
  }, 120_000);

  it('⭐ re-correr el ETL NO borra los AMARRES de precio capturados en v2 (R17)', async () => {
    // 1ª corrida: el BOM llega de Access, sin amarres (Access no los tiene).
    await ejecutarEtlModelos(cliente);
    // `orderBy` DETERMINISTA (lección del proyecto: los tests que leen "el primero" lo llevan;
    // sin él, el renglón elegido depende del plan de Postgres y el test se vuelve caprichoso).
    const telaBom = await cliente.modeloTela.findFirst({
      orderBy: [{ idModelo: 'asc' }, { idTela: 'asc' }],
    });
    const avioBom = await cliente.modeloAvio.findFirst({
      orderBy: [{ idModelo: 'asc' }, { idAvio: 'asc' }],
    });
    expect(telaBom).not.toBeNull();
    expect(avioBom).not.toBeNull();
    if (telaBom === null || avioBom === null) return;

    // Desarrollo amarra precios YA en v2 (lo que hace el editor de la receta).
    const proveedor = await cliente.proveedor.create({ data: { nombre: 'Proveedor amarre ETL' } });
    const telaProveedor = await cliente.telaProveedor.create({
      data: { idTela: telaBom.idTela, idProveedor: proveedor.id, precio: 55 },
    });
    await cliente.avioProveedor.create({
      data: { idAvio: avioBom.idAvio, idProveedor: proveedor.id, precio: 3 },
    });
    await cliente.modeloTela.update({
      where: { idModelo_idTela: { idModelo: telaBom.idModelo, idTela: telaBom.idTela } },
      data: { idTelaProveedor: telaProveedor.id },
    });
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo: avioBom.idModelo, idAvio: avioBom.idAvio } },
      data: { idAvioProveedor: proveedor.id },
    });

    // 2ª corrida del ETL (son re-corribles por diseño; F10 los vuelve a pasar): el set-completo
    // reescribe consumo y banderas desde el CSV, pero el amarre DEBE sobrevivir.
    await ejecutarEtlModelos(cliente);

    const telaTras = await cliente.modeloTela.findUnique({
      where: { idModelo_idTela: { idModelo: telaBom.idModelo, idTela: telaBom.idTela } },
    });
    const avioTras = await cliente.modeloAvio.findUnique({
      where: { idModelo_idAvio: { idModelo: avioBom.idModelo, idAvio: avioBom.idAvio } },
    });
    expect(telaTras?.idTelaProveedor).toBe(telaProveedor.id);
    expect(avioTras?.idAvioProveedor).toBe(proveedor.id);
  }, 120_000);

  it('⭐ D2: re-correr el ETL NO borra los renglones de BOM capturados en v2 (ni su consumo por talla)', async () => {
    // Daniel (15-ago-2026): *"la migración actualiza lo que viene del Access, pero nunca borra lo
    // que se capturó en el sistema nuevo"*. Antes de V1-E3e, el set-completo del ETL arrasaba estos
    // renglones —y por cascada sus `ModeloAvioTalla`— en cada re-corrida, en silencio.
    await ejecutarEtlModelos(cliente);

    const modeloConBom = await cliente.modeloAvio.findFirst({
      orderBy: [{ idModelo: 'asc' }, { idAvio: 'asc' }],
    });
    expect(modeloConBom).not.toBeNull();
    if (modeloConBom === null) return;
    const idModelo = modeloConBom.idModelo;

    // Alguien captura en v2 una tela y un avío que Access NUNCA tuvo…
    const telaNueva = await cliente.tela.create({ data: { nombre: 'Tela capturada en v2' } });
    const avioNuevo = await cliente.avio.create({
      data: { clave: 'V2-NEW', descripcion: 'Avío capturado en v2' },
    });
    await cliente.modeloTela.create({
      data: { idModelo, idTela: telaNueva.id, consumoPorPrenda: 2.5, paraCosto: false },
    });
    await cliente.modeloAvio.create({
      data: { idModelo, idAvio: avioNuevo.id, consumoPorPrenda: 4, consumoPorTalla: true },
    });
    // …y le captura su consumo POR TALLA (R18), que cuelga del renglón por FK con Cascade.
    const talla = await cliente.talla.create({ data: { etiqueta: 'V2-XG', orden: 99 } });
    await cliente.modeloAvioTalla.create({
      data: { idModelo, idAvio: avioNuevo.id, idTalla: talla.id, consumo: 1.75 },
    });

    // 2ª corrida del ETL (re-corrible por diseño; el ensayo lo pasa varias veces).
    await ejecutarEtlModelos(cliente);

    const telaTras = await cliente.modeloTela.findUnique({
      where: { idModelo_idTela: { idModelo, idTela: telaNueva.id } },
    });
    const avioTras = await cliente.modeloAvio.findUnique({
      where: { idModelo_idAvio: { idModelo, idAvio: avioNuevo.id } },
    });
    // El renglón sigue vivo y con SUS datos (no los pisó el CSV, que ni lo menciona).
    expect(telaTras).not.toBeNull();
    expect(telaTras?.consumoPorPrenda.toNumber()).toBe(2.5);
    expect(telaTras?.paraCosto).toBe(false);
    expect(avioTras).not.toBeNull();
    expect(avioTras?.consumoPorPrenda.toNumber()).toBe(4);
    expect(avioTras?.consumoPorTalla).toBe(true);
    // Y su consumo por talla sobrevivió (era lo que se iba por cascada).
    const medidaTras = await cliente.modeloAvioTalla.findFirst({
      where: { idModelo, idAvio: avioNuevo.id, idTalla: talla.id },
    });
    expect(medidaTras?.consumo.toNumber()).toBe(1.75);

    // Y lo que SÍ viene del Access se sigue actualizando: el renglón migrado sigue ahí.
    const migradoTras = await cliente.modeloAvio.findUnique({
      where: { idModelo_idAvio: { idModelo, idAvio: modeloConBom.idAvio } },
    });
    expect(migradoTras).not.toBeNull();
  }, 120_000);

  it('modelo con Activo=0 queda descontinuado (borrado suave)', async () => {
    await ejecutarEtlModelos(cliente);
    const m003 = await cliente.modelo.findFirst({ where: { codigo: 'M003' } });
    expect(m003).not.toBeNull();
    expect(m003?.activo).toBe(false);
  }, 60_000);

  it('código duplicado: solo UNO de los dos M-DUP (IdModelos 4/5) se crea; el otro se omite', async () => {
    await ejecutarEtlModelos(cliente);
    const dups = await cliente.modelo.findMany({ where: { codigo: 'M-DUP' } });
    // Solo uno de los dos M-DUP se crea (el otro da ErrorConflicto por código duplicado y se omite).
    expect(dups).toHaveLength(1);

    // El loader carga las filas en PARALELO (enLotes/CONCURRENCIA_ETL), así que CUÁL de las dos
    // (IdModelos=4 o =5) gana la creación es NO DETERMINISTA. La invariante real: de las dos claves
    // viejas {'4','5'}, EXACTAMENTE UNA tiene mapeo (la que ganó) y la otra es null (la omitida).
    const mapeo4 = await cliente.mapeoMigracion.findUnique({
      where: { entidad_claveVieja: { entidad: ENTIDAD_MAPEO.modelo, claveVieja: '4' } },
    });
    const mapeo5 = await cliente.mapeoMigracion.findUnique({
      where: { entidad_claveVieja: { entidad: ENTIDAD_MAPEO.modelo, claveVieja: '5' } },
    });
    // XOR: uno y solo uno de los dos mapeos existe.
    expect((mapeo4 === null) !== (mapeo5 === null)).toBe(true);

    // El mapeo que existe apunta al único modelo M-DUP creado (idNuevo se guarda como texto).
    const mapeoExistente = mapeo4 ?? mapeo5;
    expect(mapeoExistente?.idNuevo).toBe(String(dups[0]?.id));
  }, 60_000);

  it('renglones BOM con IdModelos=0 o sin mapeo se omiten sin abortar', async () => {
    // El test de idempotencia ya verifica los conteos; este confirma que el ETL
    // NO lanza excepción aunque haya renglones inválidos en los CSV.
    await expect(ejecutarEtlModelos(cliente)).resolves.not.toThrow();
  }, 60_000);

  it('fotos omitidas limpiamente cuando ETL_FOTOS_MOD_DIR y ETL_FOTOS_BOR_DIR no están', async () => {
    await ejecutarEtlModelos(cliente);
    // Sin carpetas configuradas → cero ModeloFoto.
    expect(await cliente.modeloFoto.count()).toBe(0);
  }, 60_000);
});
