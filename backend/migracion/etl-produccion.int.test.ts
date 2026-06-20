/**
 * Integración del ETL de PRODUCCIÓN (F3-E6, Pieza A) — corre en CI (testcontainers), NO en local.
 *
 * Como en F1/F2, `Respaldo CLAUDE/TABLAS/` NO existe en CI: apunta el ETL a fixtures committeados
 * (`migracion/__fixtures__/tablas-f3-prod/`) vía `TABLAS_DIR`. Antes de correr el ETL siembra el
 * ESTADO que consume: catálogos + TipoProceso (costura/estampado) + proveedores con rol + las
 * ÓRDENES con su matriz color×talla y los mapeos `MapeoMigracion` de F1/F2 (proveedores → Proveedor,
 * IdOrdenes → Orden.id). NO usa los ETLs de F1/F2 (los desacopla).
 *
 * Verifica:
 *  • Conteos EXACTOS de los fixtures (cortes, envíos M/A, recibos M/A, cargos EsMa, detalle).
 *  • IDEMPOTENCIA: 2ª corrida no duplica.
 *  • Despivote color×talla (color del renglón OrdenesDet + talla por posición TC de la cadena Tallas).
 *  • VARIANTE SIN EFECTOS: los recibos NO crean Movimiento de kardex NI EsMaCargo (cero doble conteo).
 *  • Folios A3 de la secuencia "etapa-mov", únicos por (idEmpresa, folio), y captura nueva sin choque.
 *  • EsMa: estado validado/propuesto desde RevisionPendiente; idEtapaRecibo NULL; cantidad/precio reales.
 *  • Limpieza: orden sin mapeo OMITIDA (corte/envío/recibo/cargo); recibo sin TipoPrendas/Inventariado.
 */
import { fileURLToPath } from 'node:url';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { registrarCorte } from '../src/dominio/produccion/etapas.js';
import type { PrismaClient } from '../src/datos/index.js';
import { sesionDePrueba } from '../src/pruebas/sesiones.js';
import { clientePruebas, limpiarBaseDatos, sembrarPermisos } from '../src/pruebas/contexto.js';

import { ejecutarEtlProduccion } from './etl-produccion.js';
import { ENTIDAD_MAPEO, guardarMapeo } from './comun/mapeo.js';

let cliente: PrismaClient;
const DIR_FIXTURES = fileURLToPath(new URL('./__fixtures__/tablas-f3-prod', import.meta.url));
let tablasDirPrevio: string | undefined;

let idEmpresaFR: number;
/** ids nuevos de las órdenes 100/101 (para aserciones). */
let idOrden100: number;
let idOrden101: number;
let idProcCostura: number;
let idProcEstampado: number;

beforeEach(async () => {
  cliente = clientePruebas();
  tablasDirPrevio = process.env.TABLAS_DIR;
  process.env.TABLAS_DIR = DIR_FIXTURES;
  await limpiarBaseDatos(cliente);
  await sembrarEstado();
});

afterAll(async () => {
  if (tablasDirPrevio === undefined) {
    delete process.env.TABLAS_DIR;
  } else {
    process.env.TABLAS_DIR = tablasDirPrevio;
  }
  await cliente.$disconnect();
});

/** Crea un proveedor con un rol dado (vía RolProveedor) y mapea su clave vieja. */
async function crearProveedorMapeado(
  nombre: string,
  codigoRol: string,
  entidadMapeo: (typeof ENTIDAD_MAPEO)[keyof typeof ENTIDAD_MAPEO],
  claveVieja: number,
): Promise<void> {
  const rol = await cliente.rolProveedor.upsert({
    where: { codigo: codigoRol },
    update: {},
    create: { codigo: codigoRol, nombre: codigoRol },
  });
  const prov = await cliente.proveedor.create({
    data: { nombre, roles: { create: { idRolProveedor: rol.id } } },
  });
  await guardarMapeo(cliente, entidadMapeo, claveVieja, prov.id);
}

/**
 * Siembra TODO el estado que el ETL de producción consume: permisos, TipoProceso, proveedores
 * (cortador/maquilero/estampador) con su mapeo de F1, catálogos color/talla, y las órdenes 100/101
 * con su matriz + el mapeo de F2 (IdOrdenes → Orden.id). La orden 999 NO se siembra (sin mapeo).
 */
async function sembrarEstado(): Promise<void> {
  await sembrarPermisos(cliente);

  const empresa = await cliente.empresa.upsert({
    where: { nombre: 'FR Moda' },
    update: {},
    create: { nombre: 'FR Moda', favorita: true, paraIpt: true, paraEdr: true },
  });
  idEmpresaFR = empresa.id;

  // Tipos de proceso (costura/estampado) — el ETL los resuelve por código.
  const pc = await cliente.tipoProceso.upsert({
    where: { codigo: 'costura' },
    update: {},
    create: { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
  });
  idProcCostura = pc.id;
  const pe = await cliente.tipoProceso.upsert({
    where: { codigo: 'estampado' },
    update: {},
    create: { codigo: 'estampado', nombre: 'Estampado', generaEntradaPt: false },
  });
  idProcEstampado = pe.id;

  // Proveedores con su rol + mapeo de F1 (claves viejas de los fixtures: cortador 5, maquilero 7,
  // estampador 9).
  await crearProveedorMapeado('Cortador A', 'corte', ENTIDAD_MAPEO.proveedorPorIdCortadores, 5);
  await crearProveedorMapeado(
    'Maquilero Costura',
    'maquila-costura',
    ENTIDAD_MAPEO.proveedorPorIdMaquileros,
    7,
  );
  await crearProveedorMapeado(
    'Estampador A',
    'estampado',
    ENTIDAD_MAPEO.proveedorPorIdEstampadores,
    9,
  );

  // Cliente de negocio + colores + tallas.
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Cliente X' } });
  const colores = new Map<string, number>();
  for (const nombre of ['Rojo', 'Negro', 'Azul']) {
    const col = await cliente.color.create({ data: { nombre } });
    colores.set(nombre, col.id);
    // Mapeo texto→idColor de F1 (respaldo del despivote).
    await guardarMapeo(cliente, ENTIDAD_MAPEO.color, nombre, col.id);
  }
  const tallas = new Map<string, number>();
  let orden = 0;
  for (const etiqueta of ['CH', 'M', 'G', 'S', 'L']) {
    orden += 1;
    const t = await cliente.talla.create({ data: { etiqueta, orden } });
    tallas.set(etiqueta, t.id);
  }
  const modelo = await cliente.modelo.create({ data: { codigo: 'M100' } });
  const idColor = (n: string): number => colores.get(n) ?? 0;
  const idTalla = (e: string): number => tallas.get(e) ?? 0;

  // Orden 100: Tallas "CHM G " (CH,M,G). Colores Rojo (CH/M/G) + Negro (CH).
  const orden100 = await crearOrden(empresa.id, clienteNegocio.id, modelo.id, 9100, [
    { idColor: idColor('Rojo'), tallas: [idTalla('CH'), idTalla('M'), idTalla('G')] },
    { idColor: idColor('Negro'), tallas: [idTalla('CH')] },
  ]);
  idOrden100 = orden100;
  await guardarMapeo(cliente, ENTIDAD_MAPEO.orden, 100, orden100);

  // Orden 101: Tallas "S M L " (S,M,L). Color Azul (S/M/L).
  const orden101 = await crearOrden(empresa.id, clienteNegocio.id, modelo.id, 9101, [
    { idColor: idColor('Azul'), tallas: [idTalla('S'), idTalla('M'), idTalla('L')] },
  ]);
  idOrden101 = orden101;
  await guardarMapeo(cliente, ENTIDAD_MAPEO.orden, 101, orden101);
}

/** Crea una orden con su matriz color×talla (cantidad pedida fija 100/celda; lo único que importa
 * para el despivote es que el color y la talla PERTENEZCAN a la orden). */
async function crearOrden(
  idEmpresa: number,
  idCliente: number,
  idModelo: number,
  folio: number,
  lineas: { idColor: number; tallas: number[] }[],
): Promise<number> {
  const o = await cliente.orden.create({
    data: {
      folio: BigInt(folio),
      idEmpresa,
      idModelo,
      idCliente,
      estado: 'completa',
      fechaCompletada: new Date(),
      lineas: {
        create: lineas.map((l) => ({
          idColor: l.idColor,
          tallas: { create: l.tallas.map((idTalla) => ({ idTalla, cantidad: 100 })) },
        })),
      },
    },
  });
  return o.id;
}

/** Conteos para idempotencia y aserciones. */
async function conteos(): Promise<Record<string, number>> {
  return {
    cortes: await cliente.etapaMovimiento.count({ where: { tipo: 'corte' } }),
    envios: await cliente.etapaMovimiento.count({ where: { tipo: 'envio_maquila' } }),
    recibos: await cliente.etapaMovimiento.count({ where: { tipo: 'recibo_maquila' } }),
    detalle: await cliente.etapaMovimientoDet.count(),
    cargos: await cliente.esMaCargo.count(),
    movimientos: await cliente.movimiento.count(),
  };
}

describe('ETL de producción F3-E6 (integración, fixtures committeados)', () => {
  it('carga con conteos EXACTOS, sin efectos de kardex, y es IDEMPOTENTE', async () => {
    await ejecutarEtlProduccion(cliente);
    const tras1 = await conteos();

    // Cortes: 1 (orden 100) + 1 (orden 101) = 2 creados; el 3 (orden 999 sin mapeo) OMITIDO.
    expect(tras1.cortes).toBe(2);
    // Envíos: 1 costura + 1 estampado.
    expect(tras1.envios).toBe(2);
    // Recibos: 2 costura (555, 556) + 1 estampado.
    expect(tras1.recibos).toBe(3);
    // Cargos EsMa: 2 (orden 100); el 3 (orden 999 sin mapeo) OMITIDO.
    expect(tras1.cargos).toBe(2);
    // ⭐ VARIANTE SIN EFECTOS: CERO movimientos de kardex (el kardex es de la Pieza B).
    expect(tras1.movimientos).toBe(0);
    // Detalle: corte1(Rojo CH/M/G=3 + Negro CH=1)=4; corte2(Azul S/M=2)=2; envíoM(Rojo 3)=3;
    // envíoA(Rojo 3)=3; reciboM 555(Rojo 3)=3; reciboM 556(Negro 1)=1; reciboEst(Rojo 3)=3 → 19.
    expect(tras1.detalle).toBe(19);

    // Idempotencia.
    await ejecutarEtlProduccion(cliente);
    expect(await conteos()).toEqual(tras1);
  }, 180_000);

  it('DESPIVOTE: color del renglón + talla por posición TC contra la cadena Tallas', async () => {
    await ejecutarEtlProduccion(cliente);
    const corte = await cliente.etapaMovimiento.findFirstOrThrow({
      where: { tipo: 'corte', idOrden: idOrden100 },
      include: {
        detalles: { include: { color: true, talla: true }, orderBy: [{ idColor: 'asc' }] },
      },
    });
    // Rojo: CH=50, M=50, G=20; Negro: CH=30.
    const porColorTalla = new Map(
      corte.detalles.map((d) => [`${d.color.nombre}:${d.talla.etiqueta}`, d.cantidad]),
    );
    expect(porColorTalla.get('Rojo:CH')).toBe(50);
    expect(porColorTalla.get('Rojo:M')).toBe(50);
    expect(porColorTalla.get('Rojo:G')).toBe(20);
    expect(porColorTalla.get('Negro:CH')).toBe(30);
  });

  it('FOLIOS A3: únicos por (idEmpresa, folio) y captura nueva sale > máximo migrado', async () => {
    await ejecutarEtlProduccion(cliente);
    const etapas = await cliente.etapaMovimiento.findMany({
      where: { idEmpresa: idEmpresaFR },
      select: { folio: true },
    });
    const folios = etapas.map((e) => Number(e.folio));
    expect(new Set(folios).size).toBe(folios.length); // sin duplicados
    const maxMigrado = Math.max(...folios);

    // Una captura nueva por el servicio normal sale con folio > máximo migrado (secuencia calibrada).
    const sesion = sesionDePrueba({
      idEmpresaActiva: idEmpresaFR,
      permisos: ['produccion.corte', 'produccion.wip-ver'],
    });
    const cortador = await cliente.proveedor.findFirstOrThrow({ where: { nombre: 'Cortador A' } });
    const orden = await cliente.orden.findUniqueOrThrow({
      where: { id: idOrden101 },
      include: { lineas: { include: { tallas: true } } },
    });
    const linea = orden.lineas[0];
    const nuevo = await registrarCorte(
      sesion,
      {
        idOrden: idOrden101,
        idCortador: cortador.id,
        fecha: '2026-01-15',
        lineas: [
          {
            idColor: linea?.idColor ?? 0,
            tallas: [{ idTalla: linea?.tallas[0]?.idTalla ?? 0, cantidad: 5 }],
          },
        ],
      },
      { cliente },
    );
    expect(nuevo.folio).toBeGreaterThan(maxMigrado);
  }, 60_000);

  it('CARGOS EsMa: estado desde RevisionPendiente, idEtapaRecibo NULL, reales del viejo', async () => {
    await ejecutarEtlProduccion(cliente);
    const cargos = await cliente.esMaCargo.findMany({ orderBy: { idTipoProceso: 'asc' } });
    expect(cargos).toHaveLength(2);
    for (const c of cargos) {
      expect(c.idEtapaRecibo).toBeNull(); // sin liga formal al recibo (histórico)
      expect(c.idOrden).toBe(idOrden100);
    }
    const costura = cargos.find((c) => c.idTipoProceso === idProcCostura);
    const estampado = cargos.find((c) => c.idTipoProceso === idProcEstampado);
    // Costura: RevisionPendiente=0 → validado; precio 12.50.
    expect(costura?.estado).toBe('validado');
    expect(Number(costura?.precioReal)).toBe(12.5);
    expect(Number(costura?.cantidadReal)).toBe(118);
    expect(costura?.validadoEn).not.toBeNull();
    // Estampado: RevisionPendiente=1 → propuesto.
    expect(estampado?.estado).toBe('propuesto');
    expect(estampado?.idTipoProceso).toBe(idProcEstampado);
  });

  it('ENVÍOS: precio pactado conservado + proceso correcto (costura vs estampado)', async () => {
    await ejecutarEtlProduccion(cliente);
    const envioM = await cliente.etapaMovimiento.findFirstOrThrow({
      where: { tipo: 'envio_maquila', idTipoProceso: idProcCostura },
    });
    expect(Number(envioM.precioPactado)).toBe(12.5);
    expect(envioM.fechaCompromiso).not.toBeNull();
    const envioA = await cliente.etapaMovimiento.findFirstOrThrow({
      where: { tipo: 'envio_maquila', idTipoProceso: idProcEstampado },
    });
    expect(Number(envioA.precioPactado)).toBe(3);
  });

  it('RECIBOS: calidad todo PRIMERA, sin almacén destino, sin EsMaCargo derivado', async () => {
    await ejecutarEtlProduccion(cliente);
    const recibo = await cliente.etapaMovimiento.findFirstOrThrow({
      where: { tipo: 'recibo_maquila', idTipoProceso: idProcCostura, idOrden: idOrden100 },
      include: { detalles: true },
      orderBy: { folio: 'asc' },
    });
    expect(recibo.idAlmacenPrimeras).toBeNull();
    expect(recibo.idAlmacenSegundas).toBeNull();
    for (const d of recibo.detalles) {
      expect(d.cantidadPrimeras).toBe(d.cantidad); // todo primera
      expect(d.cantidadSegundas).toBe(0);
    }
    // El recibo migrado NO debe haber creado un EsMaCargo (esos vienen solo de EsMa_Recibos).
    const cargosDeRecibos = await cliente.esMaCargo.count({
      where: { idEtapaRecibo: { not: null } },
    });
    expect(cargosDeRecibos).toBe(0);
  });
});
