/**
 * Unitarias del LECTOR + MAPEO del listado de SINUBE (fila 0.131, §Post-F9.224). Sin base de datos.
 *
 * Lo que se mide aquí:
 *  • ⭐ LA TRAMPA DE LAS FECHAS: `exceljs` 4.4.0 lee `1905-07-18` de una celda `t="d"` y el lector la
 *    corrige. Las dos mitades se afirman: el defecto EXISTE y el parche lo tapa.
 *  • Las reglas de Daniel: sólo lo vivo · se carga el `Saldo` (no el `Importe`) · el vencimiento se
 *    calcula (nunca se lee del archivo) · los complementos de pago no se cargan.
 *  • Las guardas duras que ABORTAN nombrando el caso, incluida la del proveedor sin días de crédito.
 */
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import {
  ENCABEZADO_SINUBE,
  RFC_FIXTURE_A,
  RFC_FIXTURE_B,
  construirXlsxSinube,
  renglonIngreso,
  type RenglonFixture,
} from '../__fixtures__/sinube-apertura.js';
import { fechasIsoDeHoja } from '../comun/xlsx-fechas-iso.js';

import {
  ErrorAperturaSinube,
  ErrorListadoSinube,
  MOTIVO_DESCARTE,
  clasificarSinube,
  leerListadoSinube,
  verificarProveedoresApertura,
  type ProveedorApertura,
} from './sinube-apertura.js';

/** Lee un fixture y lo clasifica de una vez (el camino completo del lector). */
async function leerYClasificar(renglones: RenglonFixture[]) {
  return clasificarSinube(await leerListadoSinube(construirXlsxSinube(renglones)));
}

// ── ⭐ La trampa de las fechas ──────────────────────────────────────────────────────────────────────

describe('fechas `t="d"` (ISO 8601 en la celda) — el defecto de exceljs y su parche', () => {
  it('DEMUESTRA el defecto: exceljs 4.4.0 devuelve 1905-07-18 para una fecha de 2026', async () => {
    const buffer = construirXlsxSinube([renglonIngreso({ Fecha: '2026-08-31T00:00:00' })]);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ArrayBuffer);
    const celda = libro.worksheets[0]!.getRow(2).getCell(3).value;
    // No lanza: DEVUELVE MAL. `parseFloat('2026-08-31T00:00:00')` = 2026 → serie 1900 → 1905-07-18.
    expect(celda).toBeInstanceOf(Date);
    expect((celda as Date).toISOString()).toBe('1905-07-18T00:00:00.000Z');
  });

  it('el lector devuelve la fecha REAL de la celda `t="d"`', async () => {
    const renglones = await leerListadoSinube(
      construirXlsxSinube([renglonIngreso({ Fecha: '2026-08-31T00:00:00' })]),
    );
    expect(renglones[0]!.fecha?.toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });

  it('corrige TODAS las fechas de la hoja, no sólo la primera', async () => {
    const renglones = await leerListadoSinube(
      construirXlsxSinube([
        renglonIngreso({ Fecha: '2026-01-02T00:00:00', UUID: 'A1', Folio: '1' }),
        renglonIngreso({ Fecha: '2026-06-30T00:00:00', UUID: 'A2', Folio: '2' }),
        renglonIngreso({ Fecha: '2026-12-31T00:00:00', UUID: 'A3', Folio: '3' }),
      ]),
    );
    expect(renglones.map((r) => r.fecha?.toISOString().slice(0, 10))).toEqual([
      '2026-01-02',
      '2026-06-30',
      '2026-12-31',
    ]);
  });

  it('NO rompe el formato clásico (número de serie de 1900), que exceljs sí entiende', async () => {
    const buffer = construirXlsxSinube([renglonIngreso({ Fecha: '2026-08-31T00:00:00' })], {
      fechasComoSerie: true,
    });
    expect(fechasIsoDeHoja(buffer).size).toBe(0); // no hay celdas `t="d"` que parchar
    const renglones = await leerListadoSinube(buffer);
    expect(renglones[0]!.fecha?.toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });

  it('🔻 una celda `t="d"` ILEGIBLE se queda SIN fecha, no cae al 1905 de exceljs', async () => {
    // `<v>2026</v>` dentro de una celda `t="d"` no es una fecha ISO. Y es JUSTO el valor que exceljs
    // convierte en 1905-07-18, así que caer a él sería reintroducir el defecto por la puerta de
    // atrás. La celda entra al mapa con `null` («no hay fecha») y el renglón vivo aborta por eso.
    const buffer = construirXlsxSinube([renglonIngreso({ Fecha: '2026' })]);
    expect(fechasIsoDeHoja(buffer).get('C2')).toBeNull();
    const renglones = await leerListadoSinube(buffer);
    expect(renglones[0]!.fecha).toBeNull();
    const c = clasificarSinube(renglones);
    expect(c.aperturas).toEqual([]);
    expect(c.problemas[0]!.motivo).toMatch(/SIN fecha/);
  });

  it('resuelve la hoja por su RELACIÓN, no adivinando `sheet1.xml`', () => {
    const buffer = construirXlsxSinube([renglonIngreso({ Fecha: '2026-03-04T00:00:00' })], {
      rutaHoja: 'worksheets/hoja-de-cuentas.xml',
    });
    const fechas = fechasIsoDeHoja(buffer);
    expect(fechas.get('C2')?.toISOString()).toBe('2026-03-04T00:00:00.000Z');
  });
});

// ── Lectura del archivo ────────────────────────────────────────────────────────────────────────────

describe('lectura del listado', () => {
  it('encuentra las columnas por NOMBRE aunque la hoja traiga 53', async () => {
    expect(ENCABEZADO_SINUBE).toHaveLength(53);
    const renglones = await leerListadoSinube(
      construirXlsxSinube([
        renglonIngreso({ Serie: 'B', Folio: '77', Importe: 5000, Saldo: 5000 }),
      ]),
    );
    expect(renglones).toHaveLength(1);
    expect(renglones[0]).toMatchObject({
      serie: 'B',
      folio: '77',
      importe: 5000,
      saldo: 5000,
      rfc: RFC_FIXTURE_A,
      tipoFiscal: 'Ingreso',
      moneda: 'MXN',
    });
  });

  it('aborta si el archivo no tiene la forma del listado (falta una columna clave)', async () => {
    const libro = new ExcelJS.Workbook();
    const hoja = libro.addWorksheet('Otra cosa');
    hoja.addRow(['Cliente', 'Total']);
    hoja.addRow(['ACME', 100]);
    const buffer = Buffer.from(await libro.xlsx.writeBuffer());
    await expect(leerListadoSinube(buffer)).rejects.toBeInstanceOf(ErrorListadoSinube);
    await expect(leerListadoSinube(buffer)).rejects.toThrow(/faltan las columnas/i);
  });

  it('ignora las filas totalmente vacías que deja Excel al final', async () => {
    const buffer = construirXlsxSinube([renglonIngreso(), {}, {}]);
    expect(await leerListadoSinube(buffer)).toHaveLength(1);
  });
});

// ── Reglas de negocio ──────────────────────────────────────────────────────────────────────────────

describe('reglas de Daniel: sólo lo vivo, y se carga el Saldo', () => {
  it('carga una factura viva como cargo FISCAL de proveedor, con el UUID de clave', async () => {
    const c = await leerYClasificar([
      renglonIngreso({ UUID: 'abcd-1234', Importe: 10_000, Saldo: 10_000 }),
    ]);
    expect(c.problemas).toEqual([]);
    expect(c.aperturas).toHaveLength(1);
    expect(c.aperturas[0]!.movimiento).toMatchObject({
      origen: 'factura_proveedor',
      importe: 10_000,
      esFiscal: true,
      // El UUID se guarda en MAYÚSCULAS (como lo sella el SAT y como lo escribe el importador de XML).
      uuidCfdi: 'ABCD-1234',
      claveFuente: 'uuid:ABCD-1234',
    });
    expect(c.aperturas[0]!.tipoTercero).toBe('proveedor');
  });

  it('carga el SALDO, no el IMPORTE, cuando hay abono parcial', async () => {
    const c = await leerYClasificar([renglonIngreso({ Importe: 10_000, Saldo: 2_500 })]);
    expect(c.aperturas[0]!.movimiento.importe).toBe(2_500);
    expect(c.resumen.sumaSaldoCargado).toBe(2_500);
    // Y lo dice en la nota, para que se vea de dónde salió la cifra.
    expect(c.aperturas[0]!.movimiento.observaciones).toContain('importe original 10000.00');
    expect(c.aperturas[0]!.movimiento.observaciones).toContain('abonado 7500.00');
  });

  it('NO carga los complementos de pago (Tipo fiscal = Pago)', async () => {
    const c = await leerYClasificar([
      renglonIngreso({ UUID: 'F-1' }),
      renglonIngreso({ UUID: 'P-1', 'Tipo fiscal': 'Pago', Saldo: 4_000 }),
    ]);
    expect(c.aperturas).toHaveLength(1);
    expect(c.resumen.descartesPorMotivo[MOTIVO_DESCARTE.complementoPago]).toBe(1);
    expect(c.resumen.sumaDescartadaPorMotivo[MOTIVO_DESCARTE.complementoPago]).toBe(4_000);
  });

  it('NO carga lo ya saldado (Saldo = 0) ni las celdas de Saldo vacías', async () => {
    const c = await leerYClasificar([
      renglonIngreso({ UUID: 'F-1' }),
      renglonIngreso({ UUID: 'F-2', Saldo: 0 }),
      renglonIngreso({ UUID: 'F-3', Saldo: '' }),
    ]);
    expect(c.aperturas).toHaveLength(1);
    expect(c.resumen.descartesPorMotivo[MOTIVO_DESCARTE.sinSaldo]).toBe(1);
    expect(c.resumen.descartesPorMotivo[MOTIVO_DESCARTE.saldoVacio]).toBe(1);
  });

  it('una NOTA DE CRÉDITO viva entra como abono y RESTA en el neto', async () => {
    const c = await leerYClasificar([
      renglonIngreso({ UUID: 'F-1', Importe: 10_000, Saldo: 10_000 }),
      renglonIngreso({ UUID: 'E-1', 'Tipo fiscal': 'Egreso', Importe: 1_500, Saldo: 1_500 }),
    ]);
    expect(c.aperturas.map((a) => a.movimiento.origen)).toEqual([
      'factura_proveedor',
      'nota_credito',
    ]);
    // La suma de la columna `Saldo` (lo que Daniel compara con su archivo) suma las dos…
    expect(c.resumen.sumaSaldoCargado).toBe(11_500);
    // …pero el efecto sobre la cuenta resta la nota de crédito.
    expect(c.resumen.netoCargado).toBe(8_500);
    expect(c.resumen.sumaSaldoPorTipoFiscal).toEqual({ Ingreso: 10_000, Egreso: 1_500 });
  });

  it('descarta un CFDI cancelado en el SAT (no crea deuda) y lo dice', async () => {
    const c = await leerYClasificar([
      renglonIngreso({ UUID: 'F-1' }),
      renglonIngreso({ UUID: 'F-2', 'Estatus en SAT': 'Cancelado', Saldo: 900 }),
    ]);
    expect(c.aperturas).toHaveLength(1);
    expect(c.resumen.descartesPorMotivo[MOTIVO_DESCARTE.canceladoSat]).toBe(1);
    expect(c.resumen.sumaDescartadaPorMotivo[MOTIVO_DESCARTE.canceladoSat]).toBe(900);
  });

  it('NUNCA toma la fecha de vencimiento del archivo: el movimiento sólo lleva la del documento', async () => {
    const c = await leerYClasificar([
      renglonIngreso({ Fecha: '2026-06-30T00:00:00', 'Pago probable': '2026-09-30T00:00:00' }),
    ]);
    const mov = c.aperturas[0]!.movimiento;
    expect(mov.fecha.toISOString()).toBe('2026-06-30T00:00:00.000Z');
    // `AperturaMigrada` no tiene campo de vencimiento: lo deriva el motor (`calcularVencimiento`).
    expect(Object.keys(mov)).not.toContain('fechaVencimiento');
    expect(JSON.stringify(mov)).not.toContain('2026-09-30');
  });

  it('avisa (sin bloquear) cuando el estatus dice PAGADA pero queda saldo', async () => {
    const c = await leerYClasificar([renglonIngreso({ 'Estatus pago': 'Pagada', Saldo: 300 })]);
    expect(c.aperturas).toHaveLength(1);
    expect(c.avisos).toHaveLength(1);
    expect(c.avisos[0]!.motivo).toMatch(/PAGADA/);
  });

  it('cuenta los renglones por Tipo fiscal, tal como vienen', async () => {
    const c = await leerYClasificar([
      renglonIngreso({ UUID: 'F-1' }),
      renglonIngreso({ UUID: 'F-2' }),
      renglonIngreso({ UUID: 'P-1', 'Tipo fiscal': 'Pago' }),
      renglonIngreso({ UUID: 'E-1', 'Tipo fiscal': 'Egreso' }),
    ]);
    expect(c.resumen.leidos).toBe(4);
    expect(c.resumen.porTipoFiscal).toEqual({ Ingreso: 2, Pago: 1, Egreso: 1 });
  });
});

// ── Guardas duras (abortan la corrida) ─────────────────────────────────────────────────────────────

describe('guardas duras: nombran el caso y abortan, nunca se lo saltan', () => {
  it('moneda distinta de pesos (la cuenta corriente no guarda moneda)', async () => {
    const c = await leerYClasificar([renglonIngreso({ Moneda: 'USD' })]);
    expect(c.aperturas).toEqual([]);
    expect(c.problemas[0]!.motivo).toMatch(/Moneda distinta de pesos/);
    expect(c.problemas[0]!.detalle).toContain('USD');
  });

  it('moneda vacía tampoco se supone MXN', async () => {
    const c = await leerYClasificar([renglonIngreso({ Moneda: '' })]);
    expect(c.problemas[0]!.motivo).toMatch(/Moneda distinta de pesos/);
  });

  it('acepta las variantes de peso que usa SINUBE', async () => {
    for (const m of ['MXN', 'MN', 'Pesos', 'mxp']) {
      const c = await leerYClasificar([renglonIngreso({ Moneda: m })]);
      expect(c.problemas, `moneda ${m}`).toEqual([]);
      expect(c.aperturas).toHaveLength(1);
    }
  });

  it('saldo NEGATIVO: no se interpreta el signo', async () => {
    const c = await leerYClasificar([renglonIngreso({ Saldo: -500 })]);
    expect(c.aperturas).toEqual([]);
    expect(c.problemas[0]!.motivo).toMatch(/Saldo NEGATIVO/);
  });

  it('renglón vivo sin fecha, sin RFC o sin UUID', async () => {
    const sinFecha = await leerYClasificar([renglonIngreso({ Fecha: '' })]);
    expect(sinFecha.problemas[0]!.motivo).toMatch(/SIN fecha/);
    const sinRfc = await leerYClasificar([renglonIngreso({ 'RFC proveedor': '' })]);
    expect(sinRfc.problemas[0]!.motivo).toMatch(/SIN RFC/);
    const sinUuid = await leerYClasificar([renglonIngreso({ UUID: '' })]);
    expect(sinUuid.problemas[0]!.motivo).toMatch(/SIN UUID/);
  });

  it('el mismo UUID dos veces en el archivo (no se escoge uno a ojo)', async () => {
    const c = await leerYClasificar([
      renglonIngreso({ UUID: 'REPE-1', Folio: '1' }),
      renglonIngreso({ UUID: 'repe-1', Folio: '2' }),
    ]);
    expect(c.problemas.map((p) => p.motivo)).toContain(
      'UUID de CFDI REPETIDO dentro del mismo archivo',
    );
    expect(c.problemas.find((p) => p.motivo.includes('REPETIDO'))!.detalle).toContain('filas 2, 3');
  });

  it('Tipo fiscal desconocido (ni Ingreso, ni Egreso, ni Pago)', async () => {
    const c = await leerYClasificar([renglonIngreso({ 'Tipo fiscal': 'Traslado' })]);
    expect(c.problemas[0]!.motivo).toMatch(/Tipo fiscal desconocido/);
  });

  it('renglón CON saldo vivo pero SIN Tipo fiscal', async () => {
    const c = await leerYClasificar([renglonIngreso({ 'Tipo fiscal': '', Saldo: 700 })]);
    expect(c.problemas[0]!.motivo).toMatch(/SIN "Tipo fiscal"/);
  });

  it('junta TODOS los problemas del archivo, no sólo el primero', async () => {
    const c = await leerYClasificar([
      renglonIngreso({ UUID: 'X1', Moneda: 'USD' }),
      renglonIngreso({ UUID: 'X2', Saldo: -1 }),
      renglonIngreso({ UUID: '', Folio: '9' }),
    ]);
    expect(c.problemas).toHaveLength(3);
  });
});

// ── La guarda del proveedor (contra el catálogo) ───────────────────────────────────────────────────

describe('verificarProveedoresApertura', () => {
  const apertura = (rfc: string, nombre = 'PROVEEDOR DE PRUEBA') => ({
    tipoTercero: 'proveedor' as const,
    rfc,
    nombre,
    empresaRef: null,
    saldoEsperado: null,
    movimiento: {
      origen: 'factura_proveedor' as const,
      fecha: new Date('2026-06-30T00:00:00.000Z'),
      importe: 100,
      esFiscal: true,
      uuidCfdi: 'U-1',
      rfcTercero: rfc,
      observaciones: null,
      refTipo: null,
      refId: null,
      claveFuente: 'uuid:U-1',
    },
  });
  const indice = (entradas: [string, ProveedorApertura | null][]) =>
    new Map<string, ProveedorApertura | null>(entradas);

  it('⭐ ABORTA nombrando al proveedor cuyos días de crédito son NULL (hueco)', () => {
    const i = indice([[RFC_FIXTURE_A, { id: 7, nombre: 'TELAS SIN PLAZO SA', diasCredito: null }]]);
    expect(() => verificarProveedoresApertura([apertura(RFC_FIXTURE_A)], i)).toThrow(
      ErrorAperturaSinube,
    );
    try {
      verificarProveedoresApertura([apertura(RFC_FIXTURE_A)], i);
      expect.unreachable('debía abortar');
    } catch (e) {
      const err = e as ErrorAperturaSinube;
      expect(err.problemas[0]!.motivo).toMatch(/SIN días de crédito/);
      // Nombra al proveedor: RFC, id y razón social, para poder arreglarlo sin adivinar.
      expect(err.problemas[0]!.detalle).toContain(RFC_FIXTURE_A);
      expect(err.problemas[0]!.detalle).toContain('TELAS SIN PLAZO SA');
      expect(err.problemas[0]!.detalle).toContain('#7');
      expect(err.message).toMatch(/No se escribió nada/);
    }
  });

  it('⭐ CONTADO EXPLÍCITO (0 días) es válido: es una decisión, no un hueco', () => {
    const i = indice([[RFC_FIXTURE_B, { id: 8, nombre: 'HILOS AL CONTADO', diasCredito: 0 }]]);
    const resueltos = verificarProveedoresApertura([apertura(RFC_FIXTURE_B)], i);
    expect(resueltos.get(RFC_FIXTURE_B)?.diasCredito).toBe(0);
  });

  it('aborta si el RFC del archivo no está en el catálogo', () => {
    try {
      verificarProveedoresApertura([apertura('ZZZ990909XX9', 'NUEVO SA')], indice([]));
      expect.unreachable('debía abortar');
    } catch (e) {
      const p = (e as ErrorAperturaSinube).problemas;
      expect(p[0]!.motivo).toMatch(/NO existe en el catálogo/);
      expect(p[0]!.detalle).toContain('ZZZ990909XX9');
      expect(p[0]!.detalle).toContain('NUEVO SA');
    }
  });

  it('aborta si dos proveedores comparten el RFC (no se sabe a cuál cargarle)', () => {
    try {
      verificarProveedoresApertura([apertura(RFC_FIXTURE_A)], indice([[RFC_FIXTURE_A, null]]));
      expect.unreachable('debía abortar');
    } catch (e) {
      expect((e as ErrorAperturaSinube).problemas[0]!.motivo).toMatch(
        /RFC repetido en el catálogo/,
      );
    }
  });

  it('junta TODOS los proveedores problemáticos en un solo aborto', () => {
    const i = indice([
      [RFC_FIXTURE_A, { id: 1, nombre: 'SIN PLAZO', diasCredito: null }],
      [RFC_FIXTURE_B, null],
    ]);
    try {
      verificarProveedoresApertura(
        [apertura(RFC_FIXTURE_A), apertura(RFC_FIXTURE_B), apertura('QQQ010101Q11')],
        i,
      );
      expect.unreachable('debía abortar');
    } catch (e) {
      expect((e as ErrorAperturaSinube).problemas).toHaveLength(3);
    }
  });

  it('no repite el mismo proveedor aunque traiga muchas facturas', () => {
    const i = indice([[RFC_FIXTURE_A, { id: 1, nombre: 'SIN PLAZO', diasCredito: null }]]);
    try {
      verificarProveedoresApertura(
        [apertura(RFC_FIXTURE_A), apertura(RFC_FIXTURE_A), apertura(RFC_FIXTURE_A)],
        i,
      );
      expect.unreachable('debía abortar');
    } catch (e) {
      expect((e as ErrorAperturaSinube).problemas).toHaveLength(1);
    }
  });
});
