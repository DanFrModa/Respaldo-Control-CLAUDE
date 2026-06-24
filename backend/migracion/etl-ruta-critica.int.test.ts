/**
 * Integración del ETL de RUTA CRÍTICA (F5-E7, Pieza B) — corre en CI (testcontainers), NO en local.
 *
 * Como en F1/F2/F3/F4, `Respaldo CLAUDE/TABLAS/` NO existe en CI: apunta el ETL a fixtures committeados
 * (`migracion/__fixtures__/tablas-f5/`, los CSV REALES de la RC + un `Usuarios.csv`/`Ordenes.csv`
 * recortados). Antes de correr el ETL siembra el ESTADO que consume con los SEEDS REALES de E1/E2
 * (`sembrarRutaCritica` + `sembrarRutaCriticaPlantillas`): 26 procesos, 18 roles funcionales,
 * familias/artículos/factores/telas/aplicaciones, 2 plantillas. Además crea la empresa favorita, un
 * usuario v2 `dmasri` (para casar `UsuarioRol`) y mapea 2 órdenes RC (4938/4939) a órdenes v2.
 *
 * Verifica:
 *  • Catálogos: 26 procesos (no se re-crean), 7 telas, 9 aplicaciones, 11 factores, 6 artículos, 1 fam.
 *  • Roles responsables N:M: 54 vigentes materializadas (ProcesoDefRol), 14 HUÉRFANAS listadas.
 *  • Plantillas: las 6 del CSV (2 ya sembradas por E2 → existentes; 4 nuevas).
 *  • UsuarioRol: dmasri (v2 existe) recibe rol Administrador; blanca/lina/jose quedan PENDIENTES F9.
 *  • Rutas históricas: las órdenes mapeadas (4938/4939) migran sus renglones + checklist IP3/IP4;
 *    la orden 0 y las no mapeadas se OMITEN.
 *  • Estado RC de órdenes: 4938/4939 reciben sus campos RC; 9999 (sin mapeo) se omite.
 *  • Colchón de costura: se fija en la ConfiguracionEmpresa de la favorita.
 *  • IDEMPOTENCIA: 2ª corrida = MISMOS conteos.
 */
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sembrarRutaCritica } from '../prisma/seed-ruta-critica.js';
import { sembrarRutaCriticaPlantillas } from '../prisma/seed-ruta-critica-plantillas.js';
import type { PrismaClient } from '../src/datos/index.js';
import { clientePruebas, limpiarBaseDatos, sembrarPermisos } from '../src/pruebas/contexto.js';

import { ejecutarEtlRutaCritica } from './etl-ruta-critica.js';
import { ENTIDAD_MAPEO, guardarMapeo } from './comun/mapeo.js';

let cliente: PrismaClient;
const DIR_FIXTURES = fileURLToPath(new URL('./__fixtures__/tablas-f5', import.meta.url));
let tablasDirPrevio: string | undefined;

let idEmpresaFR: number;

beforeAll(() => {
  cliente = clientePruebas();
  tablasDirPrevio = process.env.TABLAS_DIR;
  process.env.TABLAS_DIR = DIR_FIXTURES;
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  await sembrarEstado();
});

afterAll(async () => {
  if (tablasDirPrevio === undefined) delete process.env.TABLAS_DIR;
  else process.env.TABLAS_DIR = tablasDirPrevio;
  await cliente.$disconnect();
});

/** Siembra: permisos + rol Administrador + empresa favorita + seeds RC (E1/E2) + usuario v2 + mapeos. */
async function sembrarEstado(): Promise<void> {
  await sembrarPermisos(cliente);

  // Rol Administrador (F0): los seeds RC lo REÚSAN (no lo crean). Sin él, los ProcesoDefRol con
  // 'Administrador' del seed no se materializan.
  await cliente.rol.upsert({
    where: { nombre: 'Administrador' },
    update: {},
    create: { nombre: 'Administrador', descripcion: 'Administrador', esSistema: true },
  });

  const empresa = await cliente.empresa.upsert({
    where: { nombre: 'FR Moda' },
    update: {},
    create: { nombre: 'FR Moda', favorita: true, paraIpt: true, paraEdr: true },
  });
  idEmpresaFR = empresa.id;

  // Seeds reales de E1/E2: procesos + roles + N:M + dependencias; familias/artículos/reglas/plantillas.
  await sembrarRutaCritica(cliente);
  await sembrarRutaCriticaPlantillas(cliente);

  // Usuario v2 `dmasri` (para casar UsuarioRol del viejo). better-auth exige email único.
  await cliente.usuario.create({
    data: {
      username: 'dmasri',
      nombre: 'Daniel Masri',
      email: 'dmasri@control.local',
    },
  });

  // Mapea 2 órdenes RC del fixture (4938/4939) a órdenes v2 reales (folio cualquiera).
  const cliNegocio = await cliente.cliente.create({ data: { nombre: 'Cliente X' } });
  const modelo = await cliente.modelo.create({ data: { codigo: 'M-RC-1' } });
  for (const idViejo of [4938, 4939]) {
    const o = await cliente.orden.create({
      data: {
        folio: BigInt(90000 + idViejo),
        idEmpresa: empresa.id,
        idModelo: modelo.id,
        idCliente: cliNegocio.id,
        estado: 'capturada',
      },
    });
    await guardarMapeo(cliente, ENTIDAD_MAPEO.orden, idViejo, o.id);
  }
}

describe('ETL de Ruta Crítica F5-E7 (integración, fixtures committeados)', () => {
  it('carga catálogos, roles N:M, plantillas, usuarios, rutas y es IDEMPOTENTE', async () => {
    const r1 = await ejecutarEtlRutaCritica(cliente);

    // ── Catálogos: los siembra E1/E2; el ETL solo verifica (creados=0, existentes>0). ──
    expect(await cliente.procesoDef.count()).toBe(26);
    expect(await cliente.duracionPorTipoTela.count()).toBe(7);
    expect(await cliente.duracionPorAplicacion.count()).toBe(9);
    expect(await cliente.factorCantidad.count()).toBe(11);
    expect(await cliente.articuloRC.count()).toBe(6);
    expect(await cliente.familiaArticulo.count()).toBe(1);

    // ── Roles responsables N:M: 54 vigentes, 14 huérfanas LISTADAS. ──
    expect(r1.catalogos.procUsuaVigentes).toBe(54);
    expect(r1.catalogos.procUsuaHuerfanas).toBe(14);
    // El seed E1 ya creó las 54; el ETL inserta 0 (idempotente) y la BD tiene 54.
    expect(await cliente.procesoDefRol.count()).toBe(54);

    // ── Plantillas: 6 artículos en CP_Tiempos; 2 ya las sembró E2, 4 nuevas. ──
    expect(r1.plantillas.creadas + r1.plantillas.existentes).toBe(6);
    expect(await cliente.plantillaRuta.count()).toBe(6);

    // ── UsuarioRol: dmasri (v2 existe) recibe rol; blanca/lina/jose pendientes F9. ──
    expect(r1.usuariosRoles.conTipo).toBe(4); // dmasri, blanca, lina, jose
    expect(r1.usuariosRoles.casadosV2).toBe(1); // solo dmasri existe en v2
    expect(r1.usuariosRoles.pendientesF9).toBe(3); // blanca, lina, jose
    expect(r1.usuariosRoles.activosSinTipo).toBe(1); // juan (viejo es inactivo)
    const dmasri = await cliente.usuario.findFirstOrThrow({ where: { username: 'dmasri' } });
    const rolesDmasri = await cliente.usuarioRol.count({ where: { idUsuario: dmasri.id } });
    expect(rolesDmasri).toBeGreaterThanOrEqual(1);

    // ── Rutas históricas: 4938 (26) y 4939 (26) migran; la orden 0 y no mapeadas se OMITEN. ──
    expect(r1.rutas.ordenes).toBe(2);
    expect(r1.rutas.renglones).toBe(52);
    expect(r1.rutas.ordenesSinMapeo).toBeGreaterThan(0); // 0, 5492, 5493, 5494, 5495, 5488
    expect(await cliente.rutaOrden.count()).toBe(52);
    // Checklist: el fixture IP3/IP4 referencia IdRC 12/38 (orden 4938/4939). Cada IP aporta 9 ítems.
    expect(r1.rutas.itemsChecklist).toBeGreaterThan(0);

    // ── Estado RC de órdenes: 4938/4939 actualizadas; 9999 sin mapeo. ──
    expect(r1.ordenesEstadoRc.actualizadas).toBe(2);
    expect(r1.ordenesEstadoRc.sinMapeo).toBe(1);
    const orden4938 = await cliente.orden.findFirstOrThrow({ where: { folio: BigInt(94938) } });
    expect(orden4938.rcViva).toBe(true);
    expect(orden4938.fechaInicioRC).not.toBeNull();

    // ── Colchón de costura fijado en la empresa favorita. ──
    expect(r1.propiedades.aplicado).toBe(true);
    const config = await cliente.configuracionEmpresa.findUniqueOrThrow({
      where: { idEmpresa: idEmpresaFR },
    });
    expect(config.colchonCostura).toBe(1);

    // ── IDEMPOTENCIA: 2ª corrida = MISMOS conteos. ──
    const conteos1 = await conteosV2();
    await ejecutarEtlRutaCritica(cliente);
    expect(await conteosV2()).toEqual(conteos1);
  }, 180_000);

  it('crea los 54 ProcesoDefRol cuando faltan (no solo cuenta)', async () => {
    // Borra los ProcesoDefRol que sembró E1 → el ETL debe MATERIALIZAR las 54 vigentes.
    await cliente.procesoDefRol.deleteMany();
    expect(await cliente.procesoDefRol.count()).toBe(0);

    const r = await ejecutarEtlRutaCritica(cliente);
    expect(r.catalogos.rolesResponsablesInsertados).toBe(54);
    expect(await cliente.procesoDefRol.count()).toBe(54);
  }, 120_000);

  it('preserva la captura y las fechas históricas de la ruta (KPI D11)', async () => {
    await ejecutarEtlRutaCritica(cliente);
    const orden4938 = await cliente.orden.findFirstOrThrow({ where: { folio: BigInt(94938) } });
    const renglones = await cliente.rutaOrden.findMany({
      where: { idOrden: orden4938.id },
      orderBy: { secuencia: 'asc' },
    });
    expect(renglones.length).toBe(26);
    // Al menos un renglón con fecha planeada (FechaEst del viejo) conservada.
    expect(renglones.some((x) => x.fechaPlaneadaOriginal !== null)).toBe(true);
    // Los completados (con FechaReal) llevan origenCaptura='manual' y capturadoPorId legacy si aplica.
    const completados = renglones.filter((x) => x.estado === 'completado');
    for (const c of completados) {
      expect(c.fechaReal).not.toBeNull();
      expect(c.origenCaptura).toBe('manual');
    }
  }, 120_000);
});

/** Conteos de las tablas que el ETL toca (para el chequeo de idempotencia). */
async function conteosV2(): Promise<Record<string, number>> {
  return {
    procesoDef: await cliente.procesoDef.count(),
    procesoDefRol: await cliente.procesoDefRol.count(),
    plantillaRuta: await cliente.plantillaRuta.count(),
    plantillaRutaProceso: await cliente.plantillaRutaProceso.count(),
    factorCantidad: await cliente.factorCantidad.count(),
    duracionPorTipoTela: await cliente.duracionPorTipoTela.count(),
    duracionPorAplicacion: await cliente.duracionPorAplicacion.count(),
    rutaOrden: await cliente.rutaOrden.count(),
    rutaOrdenChecklist: await cliente.rutaOrdenChecklist.count(),
    usuarioRol: await cliente.usuarioRol.count(),
    configuracionEmpresa: await cliente.configuracionEmpresa.count(),
  };
}
