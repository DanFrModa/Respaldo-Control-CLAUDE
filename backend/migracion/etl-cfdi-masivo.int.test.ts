/**
 * Integración del importador MASIVO de CFDI (F9-E6) — Postgres efímero (testcontainers) + fake del
 * motor de archivos (no toca R2). Genera XML sintéticos (reusa `construirCfdi` de E3) en una carpeta
 * temporal. Verifica:
 *  • decide COMPRA/VENTA por el RFC de la empresa y resuelve el tercero por RFC (proveedor/cliente);
 *  • crea el cargo FISCAL ligado (factura +, nota de crédito −), con el XML "subido" (server-side);
 *  • el CFDI cuyo emisor/receptor no es empresa nuestra se OMITE; un XML corrupto cuenta como error;
 *  • IDEMPOTENCIA: la 2ª corrida no importa nada (UUID ya presente → duplicado contado).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { ServicioArchivos } from '../src/comun/archivos.js';
import type { PrismaClient } from '../src/datos/index.js';
import { clientePruebas, limpiarBaseDatos, sembrarPermisos } from '../src/pruebas/contexto.js';
import { construirCfdi } from '../src/pruebas/cfdi-fixtures.js';

import { ejecutarEtlCfdiMasivo } from './etl-cfdi-masivo.js';

const RFC_EMPRESA = 'FRM010101AAA';
const RFC_PROVEEDOR = 'AAA010101AA1';
const RFC_CLIENTE = 'XAXX010101000';

let cliente: PrismaClient;
let dir: string;
let idProveedor: number;
let idCliente: number;
let subirSpy: Mock;

/** Fake del motor de archivos: `subirContenido` no toca R2 (devuelve la key). */
function archivosFalsos(): ServicioArchivos {
  return {
    solicitarSubida() {
      throw new Error('El importador masivo usa subirContenido (server-side).');
    },
    subirContenido(solicitud) {
      subirSpy(solicitud);
      const carpeta = solicitud.carpeta ?? 'general';
      return Promise.resolve({
        bucket: 'control-v2-prueba',
        key: `${carpeta}/fake/${solicitud.nombreOriginal}`,
        nombreOriginal: solicitud.nombreOriginal,
        tipoMime: solicitud.tipoMime,
        tamanoBytes: solicitud.contenido.byteLength,
      });
    },
    urlDescarga(key) {
      return Promise.resolve(`https://r2.fake/get/${key}`);
    },
    descargarContenido(key) {
      return Promise.resolve(Buffer.from(`contenido-falso:${key}`, 'utf8'));
    },
    eliminarObjeto() {
      return Promise.resolve();
    },
  };
}

beforeAll(() => {
  cliente = clientePruebas();
  dir = mkdtempSync(join(tmpdir(), 'cfdi-masivo-'));
  // COMPRA (proveedor → empresa): factura + nota de crédito.
  writeFileSync(
    join(dir, 'compra-factura.xml'),
    construirCfdi({
      tipo: 'I',
      emisorRfc: RFC_PROVEEDOR,
      receptorRfc: RFC_EMPRESA,
      uuid: 'C1',
      total: '1160.00',
    }),
  );
  writeFileSync(
    join(dir, 'compra-nc.xml'),
    construirCfdi({
      tipo: 'E',
      emisorRfc: RFC_PROVEEDOR,
      receptorRfc: RFC_EMPRESA,
      uuid: 'C2',
      total: '100.00',
    }),
  );
  // VENTA (empresa → cliente).
  writeFileSync(
    join(dir, 'venta.xml'),
    construirCfdi({
      tipo: 'I',
      emisorRfc: RFC_EMPRESA,
      receptorRfc: RFC_CLIENTE,
      uuid: 'V1',
      total: '500.00',
    }),
  );
  // Ajeno (ni emisor ni receptor son empresa nuestra) → OMITIDO.
  writeFileSync(
    join(dir, 'ajeno.xml'),
    construirCfdi({
      tipo: 'I',
      emisorRfc: 'BBB020202BB2',
      receptorRfc: 'CCC030303CC3',
      uuid: 'X1',
    }),
  );
  // XML corrupto → error.
  writeFileSync(join(dir, 'corrupto.xml'), '<esto no es un cfdi>');
});

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  await sembrarPermisos(cliente);
  await cliente.empresa.create({
    data: { nombre: 'FR Moda', favorita: true, paraIpt: true, paraEdr: true, rfc: RFC_EMPRESA },
  });
  idProveedor = (
    await cliente.proveedor.create({
      data: { nombre: 'Telas del Norte', rfc: RFC_PROVEEDOR, diasCredito: 30 },
    })
  ).id;
  idCliente = (
    await cliente.cliente.create({
      data: { nombre: 'Cliente Uno', rfc: RFC_CLIENTE, diasCredito: 15 },
    })
  ).id;
  subirSpy = vi.fn();
});

describe('ETL CFDI masivo F9-E6 (integración)', () => {
  it('importa compras y ventas, omite ajenos/corruptos, y es IDEMPOTENTE', async () => {
    const { resumen } = await ejecutarEtlCfdiMasivo(cliente, dir, { archivos: archivosFalsos() });

    expect(resumen.archivos).toBe(5);
    expect(resumen.importados).toBe(3);
    expect(resumen.compras).toBe(2); // factura + nota de crédito
    expect(resumen.ventas).toBe(1);
    expect(resumen.errores).toBe(2); // el ajeno + el corrupto
    // Cada importado subió su XML server-side.
    expect(subirSpy).toHaveBeenCalledTimes(3);

    // CxP del proveedor: factura +1160, nota de crédito −100 → 1060.
    const saldoProv = await cliente.movimientoTercero.aggregate({
      where: { idProveedor },
      _sum: { monto: true },
    });
    expect(Number(saldoProv._sum.monto)).toBe(1060);
    // La factura es fiscal y ligada al XML.
    const factura = await cliente.movimientoTercero.findFirstOrThrow({ where: { uuidCfdi: 'C1' } });
    expect(factura.origen).toBe('factura_proveedor');
    expect(factura.esFiscal).toBe(true);
    expect(factura.idArchivoCfdi).not.toBeNull();
    // La nota de crédito baja el saldo.
    const nc = await cliente.movimientoTercero.findFirstOrThrow({ where: { uuidCfdi: 'C2' } });
    expect(nc.origen).toBe('nota_credito');
    expect(Number(nc.monto)).toBe(-100);

    // CxC del cliente: factura de venta +500.
    const saldoCli = await cliente.movimientoTercero.aggregate({
      where: { idCliente },
      _sum: { monto: true },
    });
    expect(Number(saldoCli._sum.monto)).toBe(500);
    const venta = await cliente.movimientoTercero.findFirstOrThrow({ where: { uuidCfdi: 'V1' } });
    expect(venta.origen).toBe('factura_cliente');
    expect(venta.tipoTercero).toBe('cliente');

    // IDEMPOTENCIA: 2ª corrida no importa nada (UUID ya presente → duplicados).
    const segunda = await ejecutarEtlCfdiMasivo(cliente, dir, { archivos: archivosFalsos() });
    expect(segunda.resumen.importados).toBe(0);
    expect(segunda.resumen.duplicados).toBe(3);
    expect(await cliente.movimientoTercero.count()).toBe(3);
  }, 120_000);
});
