/**
 * Integración del ETL de APERTURA DE SALDOS desde SINUBE (fila 0.131, §Post-F9.224) — Postgres real.
 *
 * Mide contra la base lo que las unitarias no pueden:
 *  • el VENCIMIENTO que deja el motor: `fecha de la factura + Proveedor.diasCredito` (nunca la
 *    columna «Pago probable» del archivo, ni la mal etiquetada «Recepción»);
 *  • la nota de crédito viva entra en NEGATIVO y sin vencimiento (es un abono);
 *  • ⭐ TODO O NADA: si un proveedor no tiene días de crédito capturados, la corrida aborta
 *    nombrándolo y **no queda ni un movimiento escrito** (ni los de los proveedores que sí estaban
 *    bien);
 *  • IDEMPOTENCIA: la 2ª corrida no duplica (clave = UUID del CFDI);
 *  • el saldo del proveedor = Σ monto (D3) y el reporte de cuadre.
 *
 * El archivo de entrada es SINTÉTICO (`__fixtures__/sinube-apertura.ts`): el real es de proveedores
 * de verdad y este repositorio es público.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/datos/index.js';
import { cancelarMovimientoTerceroInterno } from '../src/dominio/terceros/cuenta-terceros.js';
import { insertarAperturasMigradas } from '../src/dominio/terceros/migracion.js';
import { clientePruebas, limpiarBaseDatos, sembrarPermisos } from '../src/pruebas/contexto.js';

import {
  RFC_FIXTURE_A,
  RFC_FIXTURE_B,
  construirXlsxSinube,
  renglonIngreso,
  type RenglonFixture,
} from './__fixtures__/sinube-apertura.js';
import { ENTIDAD_MAPEO } from './comun/mapeo.js';
import { sesionEtl } from './comun/sesion-etl.js';
import { ErrorAperturaSinube } from './loaders/sinube-apertura.js';
import { ejecutarEtlAperturaSinube } from './etl-apertura-sinube.js';

let cliente: PrismaClient;
let idEmpresa: number;
let idP90: number; // 90 días de crédito (el trato estándar de Daniel)
let idP0: number; // contado EXPLÍCITO (0 días) — válido
let idPSinPlazo: number; // días de crédito NULL — el hueco que debe abortar

/** RFC del proveedor de contado y del que no tiene plazo capturado. */
const RFC_SIN_PLAZO = 'NUL010101NN1';

/** Escribe un fixture a disco y devuelve su ruta (el ETL lee de una ruta, como en producción). */
function archivoFixture(renglones: RenglonFixture[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'sinube-'));
  const ruta = join(dir, 'listado-sinube.xlsx');
  writeFileSync(ruta, construirXlsxSinube(renglones));
  return ruta;
}

beforeEach(async () => {
  cliente = clientePruebas();
  await limpiarBaseDatos(cliente);
  await sembrarPermisos(cliente);

  idEmpresa = (
    await cliente.empresa.create({
      data: {
        nombre: 'FR Moda',
        favorita: true,
        paraIpt: true,
        paraEdr: true,
        rfc: 'FRM010101AAA',
      },
    })
  ).id;
  idP90 = (
    await cliente.proveedor.create({
      data: {
        modalidadFacturacion: 'solo_con',
        nombre: 'TELAS SINTETICAS DE PRUEBA SA DE CV',
        rfc: RFC_FIXTURE_A,
        diasCredito: 90,
      },
    })
  ).id;
  idP0 = (
    await cliente.proveedor.create({
      data: {
        modalidadFacturacion: 'solo_con',
        nombre: 'HILOS AL CONTADO SA',
        rfc: RFC_FIXTURE_B,
        diasCredito: 0,
      },
    })
  ).id;
  idPSinPlazo = (
    await cliente.proveedor.create({
      data: {
        modalidadFacturacion: 'solo_con',
        nombre: 'PROVEEDOR SIN PLAZO SA',
        rfc: RFC_SIN_PLAZO,
        diasCredito: null,
      },
    })
  ).id;
});

afterAll(async () => {
  await cliente.$disconnect();
});

/** Σ monto (saldo derivado, D3) de un proveedor. */
async function saldo(id: number): Promise<number> {
  const r = await cliente.movimientoTercero.aggregate({
    where: { idProveedor: id },
    _sum: { monto: true },
  });
  return Number(r._sum.monto ?? 0);
}

/** El listado "bueno" del que parten casi todas las pruebas. */
function listadoBueno(): RenglonFixture[] {
  return [
    // Dos facturas vivas del proveedor de 90 días (la 2ª con abono parcial: saldo ≠ importe).
    renglonIngreso({
      UUID: 'F-0001',
      Folio: '101',
      Fecha: '2026-06-30T00:00:00',
      Importe: 100_000,
      Saldo: 100_000,
    }),
    renglonIngreso({
      UUID: 'F-0002',
      Folio: '102',
      Fecha: '2026-07-15T00:00:00',
      Importe: 50_000,
      Saldo: 20_000,
    }),
    // Una factura del proveedor de CONTADO (0 días explícitos).
    renglonIngreso({
      UUID: 'F-0003',
      Folio: '103',
      Fecha: '2026-08-01T00:00:00',
      'RFC proveedor': RFC_FIXTURE_B,
      'Razón social proveedor': 'HILOS AL CONTADO SA',
      Importe: 7_000,
      Saldo: 7_000,
    }),
    // Una nota de crédito VIVA (Egreso) del proveedor de 90 días.
    renglonIngreso({
      UUID: 'E-0001',
      Folio: '9',
      Serie: 'NC',
      'Tipo fiscal': 'Egreso',
      Fecha: '2026-07-20T00:00:00',
      Importe: 5_000,
      Saldo: 5_000,
    }),
    // Ruido que NO se carga: un complemento de pago y una factura ya saldada.
    renglonIngreso({ UUID: 'P-0001', Folio: '500', 'Tipo fiscal': 'Pago', Saldo: 30_000 }),
    renglonIngreso({ UUID: 'F-0004', Folio: '104', Saldo: 0 }),
  ];
}

describe('ETL de apertura desde SINUBE', () => {
  it('carga sólo lo vivo, con el vencimiento CALCULADO y el saldo = Σ monto', async () => {
    const r = await ejecutarEtlAperturaSinube(cliente, archivoFixture(listadoBueno()));
    expect(r.creados).toBe(4);

    const movs = await cliente.movimientoTercero.findMany({
      orderBy: { uuidCfdi: 'asc' },
      select: {
        uuidCfdi: true,
        origen: true,
        monto: true,
        fecha: true,
        fechaVencimiento: true,
        esFiscal: true,
        rfcTercero: true,
        idProveedor: true,
        idEmpresa: true,
      },
    });
    expect(movs).toHaveLength(4);

    const porUuid = new Map(movs.map((m) => [m.uuidCfdi, m]));

    // ⭐ El vencimiento sale de la FECHA DE LA FACTURA + los días del proveedor, NUNCA de la columna
    //    «Pago probable» del archivo. Para que esto DISTINGA, el fixture pone en esa columna una
    //    fecha (2026-10-20) que no es `fecha + diasCredito` de ningún renglón: ningún movimiento
    //    puede llevarla. La primera versión del fixture ponía ahí justo `2026-09-28` —o sea,
    //    `2026-06-30 + 90`— y con eso la aserción pasaba igual si el ETL copiaba la columna.
    expect(movs.every((m) => m.fechaVencimiento?.toISOString().slice(0, 10) !== '2026-10-20')).toBe(
      true,
    );
    const f1 = porUuid.get('F-0001')!;
    expect(f1.fecha.toISOString().slice(0, 10)).toBe('2026-06-30');
    expect(f1.fechaVencimiento?.toISOString().slice(0, 10)).toBe('2026-09-28'); // 30-jun + 90
    expect(Number(f1.monto)).toBe(100_000);
    expect(f1.origen).toBe('factura_proveedor');
    expect(f1.esFiscal).toBe(true);
    expect(f1.rfcTercero).toBe(RFC_FIXTURE_A);
    expect(f1.idProveedor).toBe(idP90);
    expect(f1.idEmpresa).toBe(idEmpresa);

    // Se carga el SALDO (20 000), no el IMPORTE (50 000).
    const f2 = porUuid.get('F-0002')!;
    expect(Number(f2.monto)).toBe(20_000);
    expect(f2.fechaVencimiento?.toISOString().slice(0, 10)).toBe('2026-10-13'); // 15-jul + 90

    // Contado EXPLÍCITO: vence el mismo día. NO es lo mismo que "sin plazo capturado".
    const f3 = porUuid.get('F-0003')!;
    expect(f3.idProveedor).toBe(idP0);
    expect(f3.fechaVencimiento?.toISOString().slice(0, 10)).toBe('2026-08-01');

    // La nota de crédito viva: abono (monto negativo) y SIN vencimiento (un abono no vence).
    const nc = porUuid.get('E-0001')!;
    expect(nc.origen).toBe('nota_credito');
    expect(Number(nc.monto)).toBe(-5_000);
    expect(nc.fechaVencimiento).toBeNull();

    // Saldo del proveedor = Σ monto (D3): 100 000 + 20 000 − 5 000.
    expect(await saldo(idP90)).toBe(115_000);
    expect(await saldo(idP0)).toBe(7_000);

    // El complemento de pago y la factura saldada NO entraron.
    expect(porUuid.has('P-0001')).toBe(false);
    expect(porUuid.has('F-0004')).toBe(false);
  });

  it('el reporte de cuadre trae los conteos, la suma cargada y los descartes con su motivo', async () => {
    const r = await ejecutarEtlAperturaSinube(cliente, archivoFixture(listadoBueno()));
    expect(r.cuadre).toContain('Renglones leídos del archivo : 6');
    expect(r.cuadre).toContain('Renglones CARGADOS (vivos)   : 4');
    // 100 000 + 20 000 + 7 000 + 5 000 (la columna `Saldo` de los cuatro renglones vivos).
    expect(r.cuadre).toContain('SUMA DE SALDOS CARGADA     : 132000.00');
    // Efecto neto: la nota de crédito resta.
    expect(r.cuadre).toContain('Efecto NETO en la cuenta     : 122000.00');
    expect(r.cuadre).toMatch(/Complemento de pago/);
    expect(r.cuadre).toMatch(/Saldo = 0/);
    // La guarda de los días de crédito, comprobada del lado del resultado.
    expect(r.cuadre).toContain('Cargos SIN vencimiento     : 0');
    expect(r.cuadre).toContain('UUID del archivo encontrados : 4 de 4');
  });

  it('es IDEMPOTENTE: la 2ª corrida no duplica nada', async () => {
    const ruta = archivoFixture(listadoBueno());
    const primera = await ejecutarEtlAperturaSinube(cliente, ruta);
    expect(primera.creados).toBe(4);

    const segunda = await ejecutarEtlAperturaSinube(cliente, ruta);
    expect(segunda.creados).toBe(0);
    expect(segunda.existentes).toBe(4);
    expect(await cliente.movimientoTercero.count()).toBe(4);
    expect(await saldo(idP90)).toBe(115_000);

    // Y la idempotencia está anotada: un `MapeoMigracion` por UUID cargado.
    const mapeos = await cliente.mapeoMigracion.findMany({
      where: { entidad: ENTIDAD_MAPEO.aperturaTercero },
      select: { claveVieja: true },
    });
    expect(mapeos.map((m) => m.claveVieja).sort()).toEqual([
      'uuid:E-0001',
      'uuid:F-0001',
      'uuid:F-0002',
      'uuid:F-0003',
    ]);
  });

  it('⭐ TODO O NADA: un proveedor sin días de crédito aborta y NO deja nada escrito', async () => {
    const listado = [
      ...listadoBueno(),
      renglonIngreso({
        UUID: 'F-9999',
        Folio: '900',
        'RFC proveedor': RFC_SIN_PLAZO,
        'Razón social proveedor': 'PROVEEDOR SIN PLAZO SA',
        Importe: 4_000,
        Saldo: 4_000,
      }),
    ];
    await expect(
      ejecutarEtlAperturaSinube(cliente, archivoFixture(listado)),
    ).rejects.toBeInstanceOf(ErrorAperturaSinube);

    // Ni un movimiento: ni el del proveedor problemático ni los de los que sí estaban bien.
    expect(await cliente.movimientoTercero.count()).toBe(0);
    expect(await cliente.mapeoMigracion.count()).toBe(0);

    // Y el error nombra al proveedor (RFC, id y razón social) para poder arreglarlo.
    try {
      await ejecutarEtlAperturaSinube(cliente, archivoFixture(listado));
      expect.unreachable('debía abortar');
    } catch (e) {
      const p = (e as ErrorAperturaSinube).problemas;
      expect(p).toHaveLength(1);
      expect(p[0]!.motivo).toMatch(/SIN días de crédito/);
      expect(p[0]!.detalle).toContain(RFC_SIN_PLAZO);
      expect(p[0]!.detalle).toContain('PROVEEDOR SIN PLAZO SA');
      expect(p[0]!.detalle).toContain(`#${String(idPSinPlazo)}`);
    }
  });

  it('un RFC que no está en el catálogo también aborta sin escribir nada', async () => {
    const listado = [
      ...listadoBueno(),
      renglonIngreso({
        UUID: 'F-8888',
        'RFC proveedor': 'DES010101DD1',
        'Razón social proveedor': 'DESCONOCIDA SA DE CV',
        Saldo: 1_000,
      }),
    ];
    try {
      await ejecutarEtlAperturaSinube(cliente, archivoFixture(listado));
      expect.unreachable('debía abortar');
    } catch (e) {
      expect((e as ErrorAperturaSinube).problemas[0]!.motivo).toMatch(/NO existe en el catálogo/);
    }
    expect(await cliente.movimientoTercero.count()).toBe(0);
  });

  it('juntas: los problemas del archivo y los del catálogo salen en el MISMO aborto', async () => {
    const listado = [
      renglonIngreso({ UUID: 'F-1', Moneda: 'USD' }),
      renglonIngreso({
        UUID: 'F-2',
        'RFC proveedor': RFC_SIN_PLAZO,
        'Razón social proveedor': 'PROVEEDOR SIN PLAZO SA',
      }),
    ];
    try {
      await ejecutarEtlAperturaSinube(cliente, archivoFixture(listado));
      expect.unreachable('debía abortar');
    } catch (e) {
      const motivos = (e as ErrorAperturaSinube).problemas.map((p) => p.motivo);
      expect(motivos).toHaveLength(2);
      expect(motivos.some((m) => /Moneda distinta de pesos/.test(m))).toBe(true);
      expect(motivos.some((m) => /SIN días de crédito/.test(m))).toBe(true);
    }
    expect(await cliente.movimientoTercero.count()).toBe(0);
  });

  it('si un bloque NO se puede escribir, lo cuenta como fallido en vez de cantar victoria', async () => {
    // Folio 1 ocupado a mano (sin avanzar la secuencia): es la red de seguridad "FOLIO YA OCUPADO"
    // que documenta `migracion/README.md`. El bloque revienta al insertar y `cargarAperturas` es
    // tolerante — lo que NO puede pasar es que la corrida se vea exitosa.
    await cliente.movimientoTercero.create({
      data: {
        idEmpresa,
        folio: 1n,
        tipoTercero: 'proveedor',
        idProveedor: idP0,
        fecha: new Date('2026-01-01T00:00:00.000Z'),
        origen: 'factura_proveedor',
        monto: 1,
        esFiscal: false,
      },
    });
    const r = await ejecutarEtlAperturaSinube(cliente, archivoFixture(listadoBueno()));
    expect(r.fallidos).toBeGreaterThan(0);
    expect(r.creados).toBeLessThan(4);
    expect(r.reporte.aTexto()).toMatch(/Bloque de aperturas OMITIDO por error/);
    // Y el cuadre lo enseña: hay UUID del archivo que no están en la base.
    expect(r.cuadre).toMatch(/UUID QUE NO SE ENCONTRARON/);
  });

  it('`--simular` saca el cuadre sin escribir nada', async () => {
    const r = await ejecutarEtlAperturaSinube(cliente, archivoFixture(listadoBueno()), {
      simular: true,
    });
    expect(r.creados).toBe(0);
    expect(await cliente.movimientoTercero.count()).toBe(0);
    expect(r.cuadre).toContain('SUMA DE SALDOS CARGADA     : 132000.00');
    // Todavía no está en la base: el cuadre lo dice en vez de callarlo.
    expect(r.cuadre).toContain('UUID del archivo encontrados : 0 de 4');
  });

  it('no vuelve a cargar un CFDI que ya entró por otra vía (unique global del UUID)', async () => {
    // Simula que el mismo comprobante ya vive en la cuenta antes de correr la apertura. Se mete por
    // el MISMO motor (folio del bloque atómico, A3) y bajo OTRA entidad de mapeo, para que lo que
    // frene el duplicado sea la unique del `uuidCfdi` y no el `MapeoMigracion` de este ETL.
    await insertarAperturasMigradas(
      sesionEtl(idEmpresa),
      idEmpresa,
      { tipoTercero: 'proveedor', idTercero: idP90, diasCredito: 90 },
      'CfdiPrevioDePrueba',
      [
        {
          origen: 'factura_proveedor',
          fecha: new Date('2026-06-30T00:00:00.000Z'),
          importe: 100_000,
          esFiscal: true,
          uuidCfdi: 'F-0001',
          rfcTercero: RFC_FIXTURE_A,
          observaciones: null,
          refTipo: null,
          refId: null,
          claveFuente: 'previo:F-0001',
        },
      ],
      { cliente },
    );

    const r = await ejecutarEtlAperturaSinube(cliente, archivoFixture(listadoBueno()));
    expect(r.creados).toBe(3);
    expect(r.existentes).toBe(1);
    expect(r.fallidos).toBe(0);
    expect(await cliente.movimientoTercero.count({ where: { uuidCfdi: 'F-0001' } })).toBe(1);
  });

  // ── Las tres ALARMAS del cuadre, medidas de verdad (H4 de la revisión) ─────────────────────────
  // Las tres líneas de abajo son las que Daniel mira para decidir si la carga sirve. Estaban
  // ESCRITAS pero no MEDIDAS: el reviewer probó que se podían romper las tres y las pruebas seguían
  // en verde, porque ninguna corrida llegaba nunca a un estado que las encendiera. Cada prueba
  // FABRICA ese estado a propósito.

  it('⭐ el cuadre GRITA si un cargo quedó SIN vencimiento (la antigüedad no lo podría mostrar)', async () => {
    // Se fabrica a mano el estado que la guarda de días de crédito existe para impedir: un cargo
    // vivo, con su UUID, y SIN fecha de vencimiento. Entra por escritura directa —no por el motor—
    // justo porque el motor ya no lo permite; el cuadre es la red de abajo, para lo que llegue por
    // cualquier otra vía. Folio muy alto para no chocar con el bloque que reserva la corrida (A3).
    await cliente.movimientoTercero.create({
      data: {
        idEmpresa,
        folio: 900_001n,
        tipoTercero: 'proveedor',
        idProveedor: idP90,
        fecha: new Date('2026-06-30T00:00:00.000Z'),
        origen: 'factura_proveedor',
        monto: 100_000,
        fechaVencimiento: null, // ← el defecto que se está simulando
        esFiscal: true,
        uuidCfdi: 'F-0001',
        rfcTercero: RFC_FIXTURE_A,
      },
    });

    const r = await ejecutarEtlAperturaSinube(cliente, archivoFixture(listadoBueno()));
    expect(r.creados).toBe(3); // F-0001 ya estaba
    expect(r.existentes).toBe(1);
    // El importe coincide con el del archivo, así que la línea de la diferencia NO se enciende:
    // la única alarma que suena es la del vencimiento, y por eso esta prueba la aísla.
    expect(r.cuadre).toContain('Diferencia contra el archivo : 0.00  (cuadra)');
    expect(r.cuadre).toContain('Cargos SIN vencimiento     : 1');
    expect(r.cuadre).toContain('LA PANTALLA DE ANTIGÜEDAD NO LOS VA A PODER MOSTRAR');
    // Y se ve de quién es, que es lo que permite ir a arreglarlo.
    expect(r.cuadre).toMatch(/TELAS SINTETICAS DE PRUEBA SA DE CV.*sin vencimiento: 1/);
  });

  it('⭐ el cuadre NO CUADRA si un UUID ya existía con OTRO importe (choque con etl-cfdi-masivo)', async () => {
    // El choque real: `etl-cfdi-masivo.ts` carga el TOTAL del comprobante (100 000 + 30 000 de un
    // renglón que en SINUBE ya está abonado); la apertura manda el SALDO (100 000) y no lo toca,
    // porque el UUID es único global. La cuenta se queda con deuda que ya se pagó, y la ÚNICA
    // señal de eso es esta diferencia. Antes salía como un número más en la lista.
    await insertarAperturasMigradas(
      sesionEtl(idEmpresa),
      idEmpresa,
      { tipoTercero: 'proveedor', idTercero: idP90, diasCredito: 90 },
      'CfdiPrevioDePrueba',
      [
        {
          origen: 'factura_proveedor',
          fecha: new Date('2026-06-30T00:00:00.000Z'),
          importe: 130_000, // ← el TOTAL del CFDI, no el saldo
          esFiscal: true,
          uuidCfdi: 'F-0001',
          rfcTercero: RFC_FIXTURE_A,
          observaciones: null,
          refTipo: null,
          refId: null,
          claveFuente: 'previo:F-0001',
        },
      ],
      { cliente },
    );

    const r = await ejecutarEtlAperturaSinube(cliente, archivoFixture(listadoBueno()));
    expect(r.creados).toBe(3);
    expect(r.existentes).toBe(1);
    // 130 000 + 20 000 + 7 000 + 5 000 = 162 000 en la base contra 132 000 que manda el archivo.
    expect(r.cuadre).toContain('Σ |monto| en la base         : 162000.00');
    expect(r.cuadre).toContain('Diferencia contra el archivo : 30000.00  🔴 NO CUADRA');
    expect(r.cuadre).toContain('conservan su importe, no el saldo');
    // El aviso del propio ETL apunta al mismo sitio.
    expect(r.cuadre).toContain('Cargos SIN vencimiento     : 0');
  });

  it('⭐ un movimiento CANCELADO no cuenta en el cuadre (D3: se neutraliza, no se borra)', async () => {
    await ejecutarEtlAperturaSinube(cliente, archivoFixture(listadoBueno()));
    const f3 = await cliente.movimientoTercero.findFirstOrThrow({ where: { uuidCfdi: 'F-0003' } });
    // Cancelación de verdad, por el dominio: crea el INVERSO y marca el original (D3).
    await cancelarMovimientoTerceroInterno(
      sesionEtl(idEmpresa),
      f3.id,
      { motivo: 'prueba de cuadre' },
      { cliente },
    );

    const r = await ejecutarEtlAperturaSinube(cliente, archivoFixture(listadoBueno()));
    expect(r.creados).toBe(0);
    expect(r.existentes).toBe(4);
    // El cancelado (7 000) sale de las sumas: 132 000 − 7 000.
    expect(r.cuadre).toContain('Σ |monto| en la base         : 125000.00');
    expect(r.cuadre).toContain('Diferencia contra el archivo : -7000.00  🔴 NO CUADRA');
    // Pero el UUID SÍ se encontró: la fila no desapareció de la base, sólo dejó de pesar.
    expect(r.cuadre).toContain('UUID del archivo encontrados : 4 de 4');
    // Y el proveedor de contado ya no aparece en el desglose (su único movimiento está anulado).
    expect(r.cuadre).not.toContain('HILOS AL CONTADO SA');
    expect(await saldo(idP0)).toBe(0);
  });
});
