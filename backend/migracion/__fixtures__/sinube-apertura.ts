/**
 * FIXTURE SINTÉTICO del listado de cuentas por pagar de SINUBE (fila 0.131).
 *
 * 🔒 **Los datos son INVENTADOS.** El archivo real que mandó Daniel es de proveedores reales y este
 * repositorio es PÚBLICO (cicatriz de la fila 0.123): ni el archivo ni su contenido entran aquí. Lo
 * que sí se reproduce —porque sin eso las pruebas no probarían nada— es su ESTRUCTURA medida:
 *
 *  • una sola hoja, encabezados en la fila 1, **53 columnas**: las **20 que el archivo real trae con
 *    nombre conocido** (de las cuales el ETL sólo lee **12** — ver `COL` en
 *    `loaders/sinube-apertura.ts`, y de ésas **6 son obligatorias**), más relleno, para que el lector
 *    tenga que buscarlas por NOMBRE y no por posición;
 *  • los textos en la tabla de cadenas compartidas (`sharedStrings`), como los escribe un exportador
 *    de verdad;
 *  • ⭐ **las fechas en celdas `t="d"`** (ISO 8601 dentro del `<v>`), que es la trampa que `exceljs`
 *    4.4.0 lee mal — ver `migracion/comun/xlsx-fechas-iso.ts`. Un fixture escrito con `exceljs`
 *    guardaría las fechas como número de serie y la prueba de la trampa quedaría VACÍA.
 *
 * El XLSX se escribe con un ZIP mínimo propio (`node:zlib`) por la misma razón que el lector no usa
 * `jszip`: es una dependencia transitiva que nadie declaró.
 */
import { crc32, deflateRawSync } from 'node:zlib';

import { letraColumna } from '../comun/xlsx-fechas-iso.js';

// ── Las columnas del listado (nombres EXACTOS del export de SINUBE) ────────────────────────────────

/**
 * Las 20 columnas con nombre conocido del listado real, en su orden.
 *
 * ⚠️ **No son «las que el ETL lee»**: el ETL lee **12** (`COL` en `loaders/sinube-apertura.ts`) y
 * exige **6** (`COLUMNAS_OBLIGATORIAS`). Las demás se reproducen para que el fixture se parezca al
 * archivo, no porque nadie las consulte. La primera versión de este comentario decía «las 20 que el
 * ETL usa» y era falso: el código lo desmiente.
 */
export const COLUMNAS_SINUBE = [
  'Serie',
  'Folio',
  'Fecha',
  'Razón social proveedor',
  'Importe',
  'Saldo',
  'Moneda',
  'Estatus pago',
  'RFC proveedor',
  'Estatus en SAT',
  'Met.Pag.',
  'Tipo fiscal',
  'Monto base',
  'Monto IVA',
  'Ret. ISR',
  'Ret. IVA',
  'Pago probable',
  'UUID',
  'Uso CFDI',
  'Fecha alta',
] as const;

/**
 * Marcador para pedirle al fixture una celda de fecha `t="d"` **autocerrada** (`<c … t="d"/>`), sin
 * `<v>`. Es el caso que destapa si el lector se come el valor de la celda de al lado.
 */
export const FECHA_VACIA_AUTOCERRADA = '\u0000celda-fecha-autocerrada';

/** Columnas de relleno hasta las 53 del archivo real (su contenido no lo lee nadie). */
const COLUMNAS_RELLENO = Array.from({ length: 33 }, (_, i) => `Extra ${String(i + 1)}`);

/** Encabezado completo de la hoja (53 columnas). */
export const ENCABEZADO_SINUBE: string[] = [...COLUMNAS_SINUBE, ...COLUMNAS_RELLENO];

/** Un renglón del fixture: sólo se declaran las columnas que importan. */
export type RenglonFixture = Partial<Record<(typeof COLUMNAS_SINUBE)[number], string | number>>;

/** Las columnas que se escriben como celda de FECHA `t="d"` (las demás van texto o número). */
const COLUMNAS_FECHA = new Set<string>(['Fecha', 'Pago probable', 'Fecha alta']);

/** Las columnas numéricas del listado. */
const COLUMNAS_NUMERO = new Set<string>([
  'Importe',
  'Saldo',
  'Monto base',
  'Monto IVA',
  'Ret. ISR',
  'Ret. IVA',
]);

// ── Escritura del XLSX ─────────────────────────────────────────────────────────────────────────────

/** Escapa lo mínimo para meter texto en un XML. */
function esc(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Una entrada a comprimir dentro del ZIP. */
interface EntradaSalida {
  nombre: string;
  contenido: Buffer;
  /** `true` = deflate (método 8); `false` = almacenada (método 0). Se usan los DOS a propósito. */
  comprimir: boolean;
}

/** Arma el ZIP (local headers + directorio central + EOCD). Sin ZIP64: los fixtures son diminutos. */
function escribirZip(entradas: EntradaSalida[]): Buffer {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entradas) {
    const nombre = Buffer.from(e.nombre, 'utf8');
    const datos = e.comprimir ? deflateRawSync(e.contenido) : e.contenido;
    const metodo = e.comprimir ? 8 : 0;
    const suma = crc32(e.contenido);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x0403_4b50, 0);
    local.writeUInt16LE(20, 4); // versión necesaria
    local.writeUInt16LE(0, 6); // banderas
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(0, 10); // hora
    local.writeUInt16LE(0x21, 12); // fecha (1980-01-01, determinista)
    local.writeUInt32LE(suma, 14);
    local.writeUInt32LE(datos.length, 18);
    local.writeUInt32LE(e.contenido.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    local.writeUInt16LE(0, 28); // extra
    partes.push(local, nombre, datos);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x0201_4b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(metodo, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(suma, 16);
    cd.writeUInt32LE(datos.length, 20);
    cd.writeUInt32LE(e.contenido.length, 24);
    cd.writeUInt16LE(nombre.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nombre);

    offset += local.length + nombre.length + datos.length;
  }

  const cuerpoCentral = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x0605_4b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entradas.length, 8);
  eocd.writeUInt16LE(entradas.length, 10);
  eocd.writeUInt32LE(cuerpoCentral.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...partes, cuerpoCentral, eocd]);
}

/**
 * Construye un XLSX con la forma del listado de SINUBE y los renglones que se le pasen.
 *
 * @param renglones filas de datos (sólo las columnas que importan; el resto sale vacío).
 * @param opciones  `fechasComoSerie` escribe las fechas al estilo CLÁSICO (número de serie de 1900,
 *                  que `exceljs` sí entiende) en vez de `t="d"`: existe SÓLO para que las pruebas
 *                  puedan contrastar los dos formatos y demostrar que el parche no rompe el normal.
 *                  `filasExtra` pega renglones `<row>` en CRUDO al final de la hoja: el listado de
 *                  SINUBE no tiene dos columnas de fecha PEGADAS, así que sin esto es imposible
 *                  medir si una celda de fecha vacía se hereda la fecha de su vecina — que es
 *                  justamente lo que el barrido de `xlsx-fechas-iso.ts` tiene que impedir.
 */
export function construirXlsxSinube(
  renglones: RenglonFixture[],
  opciones: { fechasComoSerie?: boolean; rutaHoja?: string; filasExtra?: string[] } = {},
): Buffer {
  // `exceljs` SÓLO reconoce las hojas que se llamen `xl/worksheets/sheetN.xml` (su lector las busca
  // con esa expresión regular, `lib/xlsx/xlsx.js`), así que el fixture normal usa ese nombre —como el
  // archivo real—. `rutaHoja` permite renombrarla para probar que el resolvedor de partes de
  // `xlsx-fechas-iso.ts` sigue la relación de verdad en lugar de adivinar `sheet1.xml`.
  const rutaHoja = opciones.rutaHoja ?? 'worksheets/sheet1.xml';
  // Tabla de cadenas compartidas: los textos van por índice, como en un export real.
  const cadenas: string[] = [];
  const indiceCadena = new Map<string, number>();
  const idCadena = (texto: string): number => {
    const ya = indiceCadena.get(texto);
    if (ya !== undefined) return ya;
    const i = cadenas.length;
    cadenas.push(texto);
    indiceCadena.set(texto, i);
    return i;
  };

  const filasXml: string[] = [];

  // Fila 1: encabezados.
  const celdasCabecera = ENCABEZADO_SINUBE.map(
    (h, i) => `<c r="${letraColumna(i + 1)}1" t="s"><v>${String(idCadena(h))}</v></c>`,
  ).join('');
  filasXml.push(`<row r="1">${celdasCabecera}</row>`);

  renglones.forEach((r, iFila) => {
    const nFila = iFila + 2;
    const celdas: string[] = [];
    ENCABEZADO_SINUBE.forEach((columna, iCol) => {
      const valor = (r as Record<string, string | number | undefined>)[columna];
      if (valor === undefined || valor === '') return;
      const dir = `${letraColumna(iCol + 1)}${String(nFila)}`;
      if (COLUMNAS_FECHA.has(columna)) {
        // Celda de fecha `t="d"` AUTOCERRADA (sin `<v>`): existe en archivos reales y es la que
        // obliga al lector a saltarla. ⚠️ En ESTE layout las columnas de fecha no son vecinas
        // (C, Q, T), así que lo que se heredaría es el `<v>` de una columna de texto y el daño no
        // se ve: la herencia de una fecha AJENA se mide con `filasExtra`, no aquí.
        if (valor === FECHA_VACIA_AUTOCERRADA) {
          celdas.push(`<c r="${dir}" t="d" s="1"/>`);
          return;
        }
        const iso = String(valor);
        if (opciones.fechasComoSerie === true) {
          // Serie de 1900 con el bug histórico de Lotus (1900 bisiesto): días desde 1899-12-30.
          const dias = Math.round(
            (Date.parse(`${iso.slice(0, 10)}T00:00:00.000Z`) - Date.UTC(1899, 11, 30)) / 86_400_000,
          );
          celdas.push(`<c r="${dir}" s="1"><v>${String(dias)}</v></c>`);
        } else {
          // ⭐ LA TRAMPA: fecha ISO 8601 en una celda `t="d"`.
          celdas.push(`<c r="${dir}" t="d" s="1"><v>${esc(iso)}</v></c>`);
        }
        return;
      }
      if (COLUMNAS_NUMERO.has(columna)) {
        // Una columna numérica puede traer TEXTO en el archivo real (`N/D`, `1.234,56`, `(500)`…), y
        // Excel lo guarda como celda de texto, NO como un `<v>` numérico con letras dentro. Escribirlo
        // por la ruta numérica producía un fixture que no existe y hacía IMPOSIBLE probar el caso —
        // por eso la primera versión no medía el saldo ilegible (H3 de la revisión).
        if (typeof valor === 'string' && !Number.isFinite(Number(valor))) {
          celdas.push(`<c r="${dir}" t="s"><v>${String(idCadena(valor))}</v></c>`);
          return;
        }
        celdas.push(`<c r="${dir}"><v>${String(valor)}</v></c>`);
        return;
      }
      celdas.push(`<c r="${dir}" t="s"><v>${String(idCadena(String(valor)))}</v></c>`);
    });
    filasXml.push(`<row r="${String(nFila)}">${celdas.join('')}</row>`);
  });

  for (const cruda of opciones.filasExtra ?? []) filasXml.push(cruda);

  const hoja = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${filasXml.join('')}</sheetData></worksheet>`;

  const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${String(cadenas.length)}" uniqueCount="${String(cadenas.length)}">${cadenas
    .map((c) => `<si><t xml:space="preserve">${esc(c)}</t></si>`)
    .join('')}</sst>`;

  const tipos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/${rutaHoja}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const libro = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Cuentas por pagar" sheetId="1" r:id="rId7"/></sheets></workbook>`;

  // El `r:id` NO es `rId1`: así el lector tiene que resolver la relación de verdad en vez de acertar
  // por casualidad con el identificador de siempre.
  const relsLibro = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${rutaHoja}"/><Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;

  const estilos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`;

  return escribirZip([
    // Mezcla deliberada de métodos, y NO al azar: de las tres partes que el lector de fechas abre
    // (`workbook.xml`, sus rels y la hoja), **las rels van ALMACENADAS** (método 0) y las otras dos
    // comprimidas (método 8), para que sus dos caminos de descompresión estén los dos MEDIDOS. Con
    // el método 0 sólo en partes que nadie lee, esa rama era código muerto: se comprobó quitándola
    // y las 32 unitarias seguían en verde.
    { nombre: '[Content_Types].xml', contenido: Buffer.from(tipos, 'utf8'), comprimir: false },
    { nombre: '_rels/.rels', contenido: Buffer.from(rels, 'utf8'), comprimir: true },
    { nombre: 'xl/workbook.xml', contenido: Buffer.from(libro, 'utf8'), comprimir: true },
    {
      nombre: 'xl/_rels/workbook.xml.rels',
      contenido: Buffer.from(relsLibro, 'utf8'),
      comprimir: false,
    },
    { nombre: 'xl/styles.xml', contenido: Buffer.from(estilos, 'utf8'), comprimir: true },
    { nombre: 'xl/sharedStrings.xml', contenido: Buffer.from(sst, 'utf8'), comprimir: true },
    { nombre: `xl/${rutaHoja}`, contenido: Buffer.from(hoja, 'utf8'), comprimir: true },
  ]);
}

// ── Renglones de ejemplo (todos inventados) ────────────────────────────────────────────────────────

/** RFC sintético del proveedor "principal" del fixture. */
export const RFC_FIXTURE_A = 'TSA010101AB1';
/** RFC sintético de un segundo proveedor (el de contado, `diasCredito = 0`). */
export const RFC_FIXTURE_B = 'HIL020202CD2';

/** Arma un renglón de factura (`Tipo fiscal = Ingreso`) con los valores por omisión del fixture. */
export function renglonIngreso(r: RenglonFixture = {}): RenglonFixture {
  const importe = Number(r.Importe ?? 10_000);
  return {
    Serie: 'A',
    Folio: '1001',
    Fecha: '2026-06-30T00:00:00',
    'Razón social proveedor': 'TELAS SINTETICAS DE PRUEBA SA DE CV',
    Importe: importe,
    Saldo: importe,
    Moneda: 'MXN',
    'Estatus pago': 'Pendiente',
    'RFC proveedor': RFC_FIXTURE_A,
    'Estatus en SAT': 'Vigente',
    'Met.Pag.': 'PPD',
    'Tipo fiscal': 'Ingreso',
    'Monto base': importe / 1.16,
    'Monto IVA': importe - importe / 1.16,
    'Ret. ISR': 0,
    'Ret. IVA': 0,
    // ⚠️ ESTE VALOR TIENE QUE SER DISTINTO DE `Fecha + diasCredito`, o la prueba del vencimiento se
    // vuelve VACUA. La primera versión del fixture ponía `2026-09-28`, que es EXACTAMENTE
    // `2026-06-30 + 90` — o sea, la aserción «el vencimiento se calcula, no se copia del archivo»
    // pasaba igual si el ETL copiaba la columna. Con `2026-10-20` los dos caminos dan resultados
    // distintos y la prueba por fin distingue. (El ETL no lee esta columna, ni la de «Recepción»:
    // reglas 3 y 5 de `loaders/sinube-apertura.ts`.)
    'Pago probable': '2026-10-20T00:00:00',
    UUID: '11111111-1111-4111-8111-111111111111',
    'Uso CFDI': 'G01',
    'Fecha alta': '2026-07-01T00:00:00',
    ...r,
  };
}
