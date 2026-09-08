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
  FECHA_VACIA_AUTOCERRADA,
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

  it('🔻 una celda de fecha VACÍA no HEREDA la fecha de la celda de al lado (las dos formas)', () => {
    // Una celda de fecha sin valor viene de dos formas y CADA UNA la para una guarda distinta:
    //   · autocerrada  `<c … t="d"/>`      → se salta la celda entera;
    //   · abierta y vacía `<c … t="d"></c>` → el `<v>` que sigue es de OTRA celda, y se descarta.
    // Sin ellas, el barrido se lleva el `<v>` del vecino y la fecha de uno se copia en el otro.
    //
    // ⚠️ Esto SÓLO se ve con dos columnas de fecha PEGADAS, y el listado de SINUBE no las tiene (C,
    // Q y T, con texto en medio): ahí lo que se heredaría es un texto, que no parsea como fecha y
    // deja el mismo `null` que el comportamiento correcto. Por eso las dos guardas seguían sin que
    // nada las midiera aunque la prueba «de la celda vacía» existiera (H5 de la revisión), y por eso
    // aquí la hoja se escribe en crudo.
    const buffer = construirXlsxSinube([], {
      filasExtra: [
        '<row r="9"><c r="A9" t="d" s="1"/><c r="B9" t="d" s="1"><v>2026-12-25T00:00:00</v></c></row>',
        '<row r="10"><c r="A10" t="d" s="1"></c><c r="B10" t="d" s="1"><v>2026-11-30T00:00:00</v></c></row>',
      ],
    });
    const fechas = fechasIsoDeHoja(buffer);

    // La autocerrada ni siquiera entra al mapa (no hay nada que corregirle a exceljs: está vacía).
    expect(fechas.has('A9')).toBe(false);
    // La abierta y vacía entra con `null` = «hay una fecha aquí y NO se pudo leer».
    expect(fechas.has('A10')).toBe(true);
    expect(fechas.get('A10')).toBeNull();
    // Lo que importa de las dos: ninguna se quedó con la fecha de su vecina…
    expect(fechas.get('B9')?.toISOString().slice(0, 10)).toBe('2026-12-25');
    expect(fechas.get('B10')?.toISOString().slice(0, 10)).toBe('2026-11-30');
    // …y las vecinas sí se leyeron (si el barrido se hubiera desincronizado, se perderían).
    expect([...fechas.keys()].sort()).toEqual(['A10', 'B10', 'B9']);
  });

  it('🔻 y de punta a punta: el renglón con la fecha vacía no se carga, aborta', async () => {
    const buffer = construirXlsxSinube([
      renglonIngreso({
        Fecha: FECHA_VACIA_AUTOCERRADA,
        'Pago probable': '2026-12-25T00:00:00',
      }),
    ]);
    expect(fechasIsoDeHoja(buffer).has('C2')).toBe(false); // C = Fecha: vacía
    expect(fechasIsoDeHoja(buffer).get('Q2')?.toISOString().slice(0, 10)).toBe('2026-12-25');
    const renglones = await leerListadoSinube(buffer);
    expect(renglones[0]!.fecha).toBeNull();
    expect(clasificarSinube(renglones).problemas[0]!.motivo).toMatch(/SIN fecha/);
  });

  it('la fecha se ancla a UTC: no se corre un día fuera de UTC', async () => {
    // El CI corre en UTC, así que el anclaje explícito a medianoche UTC no lo mide nadie ahí. Con una
    // zona al oeste, construir la fecha en hora local devolvería el día ANTERIOR.
    const tzOriginal = process.env.TZ;
    try {
      process.env.TZ = 'America/Mexico_City';
      const renglones = await leerListadoSinube(
        construirXlsxSinube([renglonIngreso({ Fecha: '2026-08-31T00:00:00' })]),
      );
      expect(renglones[0]!.fecha?.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    } finally {
      if (tzOriginal === undefined) delete process.env.TZ;
      else process.env.TZ = tzOriginal;
    }
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

  it('⭐ un Saldo ILEGIBLE ABORTA; sólo la celda de verdad vacía se lee como saldada', async () => {
    // `N/D`, `(500)`, `1.234,56` (coma decimal europea)… son celdas CON algo dentro que no es un
    // número. Leerlas como «saldado» dejaba el renglón fuera de la carga y el cuadre declaraba que
    // había dejado fuera 0.00 — el número tranquilizador. Y `1.234,56` era peor: se cargaba como
    // 1.234 (H3 de la revisión). Ahora abortan, como el saldo negativo.
    for (const texto of ['N/D', 'no disponible', '(500)', '1.234,56', '1,5']) {
      const c = await leerYClasificar([renglonIngreso({ Saldo: texto as unknown as number })]);
      expect(c.aperturas, texto).toEqual([]);
      expect(c.problemas[0]?.motivo, texto).toMatch(/Saldo ILEGIBLE/);
      expect(c.problemas[0]?.detalle, texto).toContain(texto);
    }
    // La celda DE VERDAD vacía conserva el descarte (documento saldado).
    const vacia = await leerYClasificar([renglonIngreso({ Saldo: '' })]);
    expect(vacia.problemas).toEqual([]);
    expect(vacia.resumen.descartesPorMotivo[MOTIVO_DESCARTE.saldoVacio]).toBe(1);
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

  it('⭐ los estatus VIGENTES con «cancel» ya NO se tiran como cancelados: ABORTAN nombrados', async () => {
    // «Cancelable…» y «No cancelable» dicen si el comprobante SE PUEDE cancelar, no que lo esté. Con
    // la comparación por subcadena los tres se caían de la carga como «CFDI CANCELADO»: deuda REAL
    // fuera, y con una etiqueta que además mentía sobre el motivo (H2 de la revisión).
    //
    // 🔑 Lo que NO se hace es lo contrario —darlos por vigentes y cargarlos—, porque eso sería el
    // mismo pecado en la otra dirección: adivinar el vocabulario de un archivo que no está en el
    // repositorio. Abortan NOMBRADOS, igual que un `Tipo fiscal` o una `Moneda` desconocidos, y quien
    // sepa qué significan los añade a `ESTATUS_SAT_CANCELADO` o los deja pasar.
    for (const estatus of [
      'Cancelable sin aceptación',
      'Cancelable con aceptación',
      'No cancelable',
      'En proceso de cancelación',
    ]) {
      const c = await leerYClasificar([renglonIngreso({ 'Estatus en SAT': estatus })]);
      expect(c.aperturas, estatus).toEqual([]);
      // Lo importante: NO se descarta en silencio como cancelado.
      expect(c.descartes, estatus).toEqual([]);
      expect(c.problemas[0]?.motivo, estatus).toMatch(/NO se sabe si es un CFDI cancelado/);
      expect(c.problemas[0]?.detalle, estatus).toContain(estatus);
    }
  });

  it('⭐ los estatus que SÍ son cancelados siguen descartándose (lista exacta)', async () => {
    for (const estatus of [
      'Cancelado',
      'Cancelada',
      'Cancelado sin aceptación',
      'Cancelada con aceptación',
    ]) {
      const c = await leerYClasificar([renglonIngreso({ 'Estatus en SAT': estatus })]);
      expect(c.problemas, estatus).toEqual([]);
      expect(c.aperturas, estatus).toEqual([]);
      expect(c.resumen.descartesPorMotivo[MOTIVO_DESCARTE.canceladoSat], estatus).toBe(1);
    }
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
