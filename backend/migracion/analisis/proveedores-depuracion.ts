/**
 * ANÁLISIS: depuración del catálogo de proveedores (§Post-F9.23).
 *
 * Daniel (10-ago-2026): *"Solo vamos a jalar esos proveedores y corregirlos porque les falta mucha
 * información."* Este script contesta las dos preguntas de esa frase, SIN tocar la base de datos —
 * solo lee los CSV del Access:
 *
 *  1. **¿Quiénes se quedan?** Los que movieron algo desde el año de corte (misma regla que el ETL,
 *     `comun/proveedores-activos.ts`: se comparte el módulo para que el análisis y la carga no
 *     puedan discrepar).
 *  2. **¿Qué les falta?** Campo por campo, para que la corrección sea una lista de pendientes y no
 *     una cacería. Escribe además un **CSV** con los supervivientes y las columnas vacías que hay
 *     que llenar (RFC, régimen, etc.), para trabajarlo fuera del sistema si conviene.
 *
 * Se corre así (desde `backend/`), eligiendo el año de corte:
 *     ETL_PROVEEDORES_DESDE=2025 npx tsx migracion/analisis/proveedores-depuracion.ts
 *
 * NO necesita `--env-file=.env` (no toca la BD) ni que el ETL haya corrido.
 */
import { writeFileSync } from 'node:fs';

import { leerCsv } from '../comun/csv.js';
import {
  resolverProveedoresActivos,
  type FuenteTercero,
  type ProveedoresActivos,
} from '../comun/proveedores-activos.js';

/** Un tercero superviviente, ya normalizado a una sola forma sin importar de qué catálogo salió. */
interface Superviviente {
  fuente: FuenteTercero;
  idViejo: string;
  nombre: string;
  telefono: string;
  contacto: string;
  razonSocial: string;
  direccion: string;
  condiciones: string;
  tipo: string;
}

const vacio = (v: string | undefined): string => (v ?? '').trim();

/** Junta los cuatro catálogos del viejo en una sola lista, ya filtrada por movimiento. */
function supervivientes(activos: ProveedoresActivos): Superviviente[] {
  const lista: Superviviente[] = [];
  const agregar = (s: Superviviente): void => {
    if (s.nombre !== '' && activos.activo(s.fuente, s.idViejo)) lista.push(s);
  };

  for (const f of leerCsv('Proveedores.csv')) {
    agregar({
      fuente: 'comercial',
      idViejo: vacio(f.IdProveedor),
      nombre: vacio(f.Proveedor),
      telefono: vacio(f.Telefono),
      contacto: vacio(f.Contacto),
      razonSocial: vacio(f.RazonSocialProv),
      direccion: '',
      condiciones: vacio(f.Condiciones),
      tipo: vacio(f.TipoProv),
    });
  }
  for (const f of leerCsv('Cortadores.csv')) {
    agregar({
      fuente: 'cortador',
      idViejo: vacio(f.IdCortadores),
      nombre: vacio(f.Cortador),
      telefono: vacio(f.Telefonos),
      contacto: '',
      razonSocial: '',
      direccion: '',
      condiciones: '',
      tipo: '',
    });
  }
  for (const f of leerCsv('Maquileros.csv')) {
    agregar({
      fuente: 'taller',
      idViejo: vacio(f.IdMaquileros),
      nombre: `${vacio(f.Nombre)} ${vacio(f.Apellidos)}`.trim(),
      telefono: vacio(f.Telefonos),
      contacto: '',
      razonSocial: '',
      direccion: vacio(f.Direccion),
      condiciones: '',
      tipo: '',
    });
  }
  return lista;
}

/** Campos que el Access SÍ traía: se mide cuántos supervivientes los tienen capturados. */
const CAMPOS_VIEJOS = [
  ['nombre', 'Nombre'],
  ['razonSocial', 'Razón social'],
  ['telefono', 'Teléfono'],
  ['contacto', 'Contacto'],
  ['direccion', 'Dirección'],
  ['condiciones', 'Condiciones'],
  ['tipo', 'Tipo (T/H/S)'],
] as const;

/**
 * Campos que el Access **NUNCA** tuvo y que el sistema nuevo sí necesita. No se miden (están al
 * 0 % por definición): se listan para que quede claro que la captura es TODA manual.
 */
const CAMPOS_NUEVOS = [
  '¿Emite factura (CFDI)?',
  'RFC',
  'Régimen fiscal (SAT)',
  'Uso de CFDI',
  'CP de expedición',
  'Retiene IVA / ISR',
  'Email',
  'Días de crédito',
  'Moneda',
  'Forma y método de pago',
  'Banco / CLABE',
  'Lead time (días)',
];

function main(): void {
  const activos = resolverProveedoresActivos();
  if (activos.desde === 0) {
    console.log(
      'Sin año de corte: corre con ETL_PROVEEDORES_DESDE=2025 para ver la depuración.\n' +
        'Ejemplo: ETL_PROVEEDORES_DESDE=2025 npx tsx migracion/analisis/proveedores-depuracion.ts',
    );
    return;
  }

  const totales = {
    comercial: leerCsv('Proveedores.csv').length,
    cortador: leerCsv('Cortadores.csv').length,
    taller: leerCsv('Maquileros.csv').length,
    estampador: leerCsv('Estampadores.csv').length,
  };
  const vivos = supervivientes(activos);

  console.log(
    `\n=== Depuración del catálogo de proveedores (movimiento desde ${String(activos.desde)}) ===\n`,
  );
  const totalFilas = Object.values(totales).reduce((a, b) => a + b, 0);
  console.log(`  Access:      ${String(totalFilas)} filas en 4 catálogos`);
  console.log(`  Se quedan:   ${String(vivos.length)}`);
  console.log(`  Se depuran:  ${String(totalFilas - vivos.length)}\n`);
  for (const [fuente, total] of Object.entries(totales) as [FuenteTercero, number][]) {
    const quedan = vivos.filter((v) => v.fuente === fuente).length;
    const nota =
      fuente === 'estampador'
        ? '  ← catálogo muerto: ningún documento le apunta (quien estampa es un taller)'
        : '';
    console.log(
      `    ${fuente.padEnd(11)} ${String(quedan).padStart(4)} de ${String(total).padStart(4)}${nota}`,
    );
  }

  console.log(`\n  Lo que YA traen (de ${String(vivos.length)}):`);
  for (const [campo, etiqueta] of CAMPOS_VIEJOS) {
    const con = vivos.filter((v) => v[campo] !== '').length;
    const pct = Math.round((con / vivos.length) * 100);
    console.log(`    ${etiqueta.padEnd(16)} ${String(con).padStart(4)}  (${String(pct)}%)`);
  }

  console.log(`\n  Lo que hay que capturar A MANO (el Access nunca lo tuvo, 0% en todos):`);
  for (const c of CAMPOS_NUEVOS) console.log(`    · ${c}`);

  // Sin nombre = no se puede identificar: hay que resolverlos uno por uno antes de cargar.
  const sinNombre = vivos.filter((v) => v.nombre === '');
  if (sinNombre.length > 0) {
    console.log(
      `\n  ⚠️  ${String(sinNombre.length)} con movimiento pero SIN nombre en el catálogo.`,
    );
  }

  const salida = 'proveedores-a-corregir.csv';
  const cab = [
    'fuente',
    'idViejo',
    'nombre',
    'razonSocial',
    'telefono',
    'contacto',
    'direccion',
    'condiciones',
    'tipo',
    ...CAMPOS_NUEVOS,
  ];
  const escapar = (v: string): string => `"${v.replace(/"/g, '""')}"`;
  const filas = vivos.map((v) =>
    [
      v.fuente,
      v.idViejo,
      v.nombre,
      v.razonSocial,
      v.telefono,
      v.contacto,
      v.direccion,
      v.condiciones,
      v.tipo,
      ...CAMPOS_NUEVOS.map(() => ''),
    ]
      .map(escapar)
      .join(','),
  );
  // BOM para que Excel abra los acentos bien (el archivo se va a llenar a mano en Excel). Va en
  // escape explícito: el carácter literal es invisible en el código fuente.
  const BOM = '\uFEFF';
  writeFileSync(salida, `${BOM}${cab.map(escapar).join(',')}\n${filas.join('\n')}\n`, 'utf8');
  console.log(`\n  Escrito: backend/${salida} (${String(vivos.length)} renglones a completar)\n`);
}

main();
