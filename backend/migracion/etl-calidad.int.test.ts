/**
 * Integración del ETL de CALIDAD (F6-E6, Pieza A) — corre en CI (testcontainers), NO en local.
 *
 * Como en F1/F2/F3, `Respaldo CLAUDE/TABLAS/` NO existe en CI: apunta el ETL a fixtures
 * committeados (`migracion/__fixtures__/tablas-f6-calidad/`) vía `TABLAS_DIR`. Antes de correr el
 * ETL siembra el ESTADO que consume: permisos, empresa, un maquilero (Proveedor con rol) con su
 * mapeo de F1, y las ÓRDENES 100/101 con su mapeo de F2 (la orden 999 NO se siembra → su auditoría
 * queda OMITIDA). Los defectos los carga el propio ETL desde el fixture.
 *
 * Verifica:
 *  • Conteos EXACTOS (defectos, auditorías, detalle) + IDEMPOTENCIA (2ª corrida no duplica).
 *  • Severidad INFERIDA del AQL + favorito + aplicaGeneral (catálogo de defectos).
 *  • Mapeo de resultado/tipo (QueResultado/QueTipoAudit), maquilero (0/sin-mapeo → null),
 *    fechas (FechaAuditoria cae a FechaElaboracion), usuarios viejos como texto, cancelación suave.
 *  • Detalle: defecto sin mapeo OMITIDO; auditoría con orden sin mapeo OMITIDA; pares duplicados
 *    (auditoría, defecto) FUSIONADOS sumando fallas → mismo AuditoriaDefecto.
 *  • Secuencia "auditoria" recalibrada al máximo folio migrado (captura nueva no chocaría).
 */
import { fileURLToPath } from 'node:url';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/datos/index.js';
import { clientePruebas, limpiarBaseDatos, sembrarPermisos } from '../src/pruebas/contexto.js';

import { ejecutarEtlCalidad } from './etl-calidad.js';
import { ENTIDAD_MAPEO, guardarMapeo, leerMapeo } from './comun/mapeo.js';

let cliente: PrismaClient;
const DIR_FIXTURES = fileURLToPath(new URL('./__fixtures__/tablas-f6-calidad', import.meta.url));
let tablasDirPrevio: string | undefined;

let idEmpresaFR: number;
let idOrden100: number;
let idOrden101: number;
let idMaquilero: number;

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

/**
 * Siembra el estado que el ETL de calidad consume: permisos, empresa, maquilero (Proveedor con rol)
 * + su mapeo de F1 (clave vieja 7), y las órdenes 100/101 con su mapeo de F2. La orden 999 NO se
 * siembra (la auditoría 13 quedará omitida).
 */
async function sembrarEstado(): Promise<void> {
  await sembrarPermisos(cliente);

  const empresa = await cliente.empresa.upsert({
    where: { nombre: 'FR Moda' },
    update: {},
    create: { nombre: 'FR Moda', favorita: true, paraIpt: true, paraEdr: true },
  });
  idEmpresaFR = empresa.id;

  const rol = await cliente.rolProveedor.upsert({
    where: { codigo: 'maquila-costura' },
    update: {},
    create: { codigo: 'maquila-costura', nombre: 'Maquila costura' },
  });
  const prov = await cliente.proveedor.create({
    data: { nombre: 'Maquilero Costura', roles: { create: { idRolProveedor: rol.id } } },
  });
  idMaquilero = prov.id;
  await guardarMapeo(cliente, ENTIDAD_MAPEO.proveedorPorIdMaquileros, 7, prov.id);

  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Cliente X' } });
  const modelo = await cliente.modelo.create({ data: { codigo: 'M100' } });
  idOrden100 = await crearOrden(empresa.id, clienteNegocio.id, modelo.id, 9100);
  await guardarMapeo(cliente, ENTIDAD_MAPEO.orden, 100, idOrden100);
  idOrden101 = await crearOrden(empresa.id, clienteNegocio.id, modelo.id, 9101);
  await guardarMapeo(cliente, ENTIDAD_MAPEO.orden, 101, idOrden101);
}

/** Crea una orden mínima (la auditoría no lee la matriz color×talla). */
async function crearOrden(
  idEmpresa: number,
  idCliente: number,
  idModelo: number,
  folio: number,
): Promise<number> {
  const o = await cliente.orden.create({
    data: {
      folio: BigInt(folio),
      idEmpresa,
      idModelo,
      idCliente,
      estado: 'completa',
      fechaCompletada: new Date(),
    },
  });
  return o.id;
}

/** Conteos para idempotencia y aserciones. */
async function conteos(): Promise<Record<string, number>> {
  return {
    defectos: await cliente.defectoCatalogo.count(),
    auditorias: await cliente.auditoria.count(),
    detalle: await cliente.auditoriaDefecto.count(),
  };
}

describe('ETL de calidad F6-E6 (integración, fixtures committeados)', () => {
  it('carga con conteos EXACTOS y es IDEMPOTENTE', async () => {
    await ejecutarEtlCalidad(cliente);
    const t1 = await conteos();

    expect(t1.defectos).toBe(4); // CC_Catalogo del fixture
    expect(t1.auditorias).toBe(3); // 10, 11, 12 (la 13 se omite: orden 999 sin mapeo)
    // aud10: cat1/cat2/cat3 = 3 (cat999 omitido); aud11: cat1/cat4 = 2; aud12: cat1 (dedup) = 1 → 6
    expect(t1.detalle).toBe(6);

    await ejecutarEtlCalidad(cliente);
    expect(await conteos()).toEqual(t1);
  }, 120_000);

  it('DEFECTOS: severidad inferida del AQL, favorito y aplicaGeneral', async () => {
    await ejecutarEtlCalidad(cliente);
    const porClave = new Map((await cliente.defectoCatalogo.findMany()).map((d) => [d.clave, d]));
    expect(porClave.get('ETM2')?.severidad).toBe('critico'); // AQL 1
    expect(porClave.get('ETM1')?.severidad).toBe('mayor'); // AQL 2.5
    expect(porClave.get('MAN1')?.severidad).toBe('menor'); // AQL 10
    expect(porClave.get('ETM1')?.favorito).toBe(true);
    expect(porClave.get('MAN1')?.favorito).toBe(false);
    expect(Number(porClave.get('ETM1')?.nivelAQL)).toBe(2.5);
    for (const d of porClave.values()) {
      expect(d.aplicaGeneral).toBe(true);
    }
  });

  it('AUDITORÍA 10: aprobado/final, maquilero mapeado, obs multilínea, usuario viejo como texto', async () => {
    await ejecutarEtlCalidad(cliente);
    const a = await cliente.auditoria.findFirstOrThrow({
      where: { idEmpresa: idEmpresaFR, numAuditoria: 10n },
    });
    expect(a.idOrden).toBe(idOrden100);
    expect(a.resultado).toBe('aprobado');
    expect(a.tipoAuditoria).toBe('final');
    expect(a.resultadoManual).toBe(true);
    expect(a.cancelada).toBe(false);
    expect(a.idMaquilero).toBe(idMaquilero);
    expect(a.elaboroPorId).toBe('31');
    expect(a.auditorPorId).toBe('31');
    expect(a.tamanoMuestra).toBe(32);
    expect(a.observaciones).toContain('\n'); // multilínea preservada por el parser CSV real
  });

  it('AUDITORÍA 11: reprobado/en_piso, maquilero null, fechaAuditoria cae a elaboración, auditor 0→null', async () => {
    await ejecutarEtlCalidad(cliente);
    const a = await cliente.auditoria.findFirstOrThrow({
      where: { idEmpresa: idEmpresaFR, numAuditoria: 11n },
    });
    expect(a.resultado).toBe('reprobado');
    expect(a.tipoAuditoria).toBe('en_piso');
    expect(a.idMaquilero).toBeNull(); // IdMaquilero = 0
    expect(a.auditorPorId).toBeNull(); // IdUsuariosAuditor = 0
    expect(a.elaboroPorId).toBe('31');
    expect(a.tamanoMuestra).toBe(0);
    expect(a.fechaAuditoria.getTime()).toBe(a.fechaElaboracion.getTime()); // fallback de fecha
  });

  it('AUDITORÍA 12: cancelación suave, no_calificado, maquilero sin mapeo→null, fallas SUMADAS', async () => {
    await ejecutarEtlCalidad(cliente);
    const a = await cliente.auditoria.findFirstOrThrow({
      where: { idEmpresa: idEmpresaFR, numAuditoria: 12n },
      include: { defectos: true },
    });
    expect(a.cancelada).toBe(true);
    expect(a.canceladaEn).not.toBeNull();
    expect(a.canceladaPorId).not.toBeNull();
    expect(a.resultado).toBe('no_calificado');
    expect(a.tipoAuditoria).toBe('no_definida');
    expect(a.idMaquilero).toBeNull(); // IdMaquilero 999 sin mapeo
    expect(a.elaboroPorId).toBe('2');
    // dets 7 (cat1, 0) + 8 (cat1, 5) → UN renglón con 5 fallas (par duplicado fusionado).
    expect(a.defectos).toHaveLength(1);
    expect(a.defectos[0]?.numFallas).toBe(5);
  });

  it('DETALLE: defecto sin mapeo OMITIDO y auditoría con orden sin mapeo NO migrada', async () => {
    await ejecutarEtlCalidad(cliente);
    expect(
      await cliente.auditoria.count({ where: { idEmpresa: idEmpresaFR, numAuditoria: 13n } }),
    ).toBe(0);
    const a10 = await cliente.auditoria.findFirstOrThrow({
      where: { idEmpresa: idEmpresaFR, numAuditoria: 10n },
      include: { defectos: true },
    });
    expect(a10.defectos).toHaveLength(3); // det4 (cat 999 sin mapeo) omitido
  });

  it('MAPEO del detalle: los IdCC_AuditoriasDet duplicados apuntan al MISMO AuditoriaDefecto', async () => {
    await ejecutarEtlCalidad(cliente);
    const m7 = await leerMapeo(cliente, ENTIDAD_MAPEO.auditoriaDefecto, '7');
    const m8 = await leerMapeo(cliente, ENTIDAD_MAPEO.auditoriaDefecto, '8');
    expect(m7).not.toBeNull();
    expect(m7).toBe(m8); // det 7 y 8 (ambos cat1 de la auditoría 12) → mismo AuditoriaDefecto
  });

  it('SECUENCIA "auditoria" recalibrada al máximo folio migrado', async () => {
    await ejecutarEtlCalidad(cliente);
    const sec = await cliente.secuencia.findFirstOrThrow({
      where: { idEmpresa: idEmpresaFR, clave: 'auditoria' },
    });
    expect(sec.valor).toBe(12n); // máximo numAuditoria migrado (aud 12; la 13 quedó omitida)
  });
});
