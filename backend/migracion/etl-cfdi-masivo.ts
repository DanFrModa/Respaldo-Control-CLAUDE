/**
 * ETL de importación MASIVA de CFDI históricos (F9-E6; R11/R12; doc
 * `Documentacion_MJD/PROPUESTA-Finanzas-y-Proveedores.md` §1/§2). Recorre una CARPETA de XML (los que
 * el contador/SINUBE entregue) y los concilia hacia atrás: por cada comprobante decide si es de VENTA
 * (CxC) o de COMPRA (CxP) según el RFC de la empresa activa, resuelve el tercero por RFC, sube el XML
 * a R2 y crea el cargo fiscal ligado — REUSANDO los servicios interactivos de E3/E4
 * (`importarCfdi` / `importarCfdiVenta`), SIN duplicarlos ni romperlos.
 *
 * COMPOSICIÓN: la única lógica NUEVA aquí es (1) decidir la DIRECCIÓN por RFC de empresa y (2) resolver
 * el tercero automáticamente por RFC (en la UI lo elige el humano; en masa no hay humano). El alta, la
 * validación del emisor/receptor, la subida server-side a R2 y el anti-duplicado por UUID son los de
 * E3/E4 tal cual. Idempotente POR NATURALEZA: el UUID es único global → re-importar el mismo XML lanza
 * `ErrorConflicto` (duplicado), que aquí se cuenta como "omitido", no como error. Por lotes (concurrencia
 * acotada). NO auto-liga OC/pedido (en masa no se adivina): el cargo entra sin `refTipo`.
 *
 * ⚠️ NO SE CORRE todavía (D15c): la carpeta de XML aún no existe. Se CONSTRUYE y PRUEBA con XML
 * sintéticos; se ejecuta cuando llegue el histórico, con:
 *
 *   npx tsx --env-file=.env migracion/etl-cfdi-masivo.ts -- --dir=./cfdi-historicos
 *
 * (Respeta `R2_SUBIDA_LOCAL`: en dev/CI la subida es no-op; en prod sube de verdad. NUNCA `npm run`.)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { crearClientePrisma, type PrismaClient } from '../src/datos/index.js';

import { opcionesClienteEtl } from './comun/cliente-etl.js';
import { servicioArchivos, type ServicioArchivos } from '../src/comun/archivos.js';
import { ErrorConflicto, ErrorDominio } from '../src/comun/errores.js';
import { importarCfdi } from '../src/dominio/terceros/cfdi/cfdi-proveedor.js';
import { importarCfdiVenta } from '../src/dominio/terceros/cfdi/cfdi-ventas.js';
import { parsearCfdi, normalizarRfc } from '../src/dominio/terceros/cfdi/parser-cfdi.js';

import { sesionEtl } from './comun/sesion-etl.js';
import { CONCURRENCIA_ETL, enLotes } from './comun/lotes.js';
import { Reporte } from './comun/reporte.js';

/** Resumen de la corrida del importador masivo. */
export interface ResultadoCfdiMasivo {
  /** Archivos vistos en la carpeta (con extensión .xml). */
  archivos: number;
  /** CFDI importados (cargos fiscales creados). */
  importados: number;
  /** CFDI de COMPRA (proveedor → CxP) importados. */
  compras: number;
  /** CFDI de VENTA (cliente → CxC) importados. */
  ventas: number;
  /** Omitidos por UUID ya importado (idempotencia). */
  duplicados: number;
  /** Omitidos por error (sin empresa/tercero, XML inválido, etc.) — detallados en el reporte. */
  errores: number;
}

/** Dirección de un CFDI respecto a la empresa: VENTA (emite la empresa) o COMPRA (la recibe). */
export type DireccionCfdi =
  | { tipo: 'venta'; idEmpresa: number }
  | { tipo: 'compra'; idEmpresa: number }
  | { tipo: 'indeterminada'; motivo: string };

/**
 * Decide la dirección de un CFDI comparando emisor/receptor contra los RFC de las empresas. VENTA si el
 * EMISOR es una empresa nuestra; COMPRA si el RECEPTOR lo es. Función PURA (para test): recibe el mapa
 * `rfc normalizado → idEmpresa`. Si ninguno coincide (o ambos, comprobante entre empresas propias) →
 * indeterminada (se reporta, no se fuerza).
 */
export function decidirDireccionCfdi(
  emisorRfc: string,
  receptorRfc: string,
  empresasPorRfc: Map<string, number>,
): DireccionCfdi {
  const empEmisor = empresasPorRfc.get(normalizarRfc(emisorRfc));
  const empReceptor = empresasPorRfc.get(normalizarRfc(receptorRfc));
  if (empEmisor !== undefined && empReceptor !== undefined) {
    return {
      tipo: 'indeterminada',
      motivo: 'emisor y receptor son empresas propias (comprobante entre empresas): elígelo a mano',
    };
  }
  if (empEmisor !== undefined) return { tipo: 'venta', idEmpresa: empEmisor };
  if (empReceptor !== undefined) return { tipo: 'compra', idEmpresa: empReceptor };
  return {
    tipo: 'indeterminada',
    motivo: `ni el emisor (${emisorRfc}) ni el receptor (${receptorRfc}) son una empresa con RFC capturado`,
  };
}

/** Estado de procesar un archivo. */
type EstadoArchivo =
  | { estado: 'importado'; direccion: 'venta' | 'compra' }
  | { estado: 'duplicado' }
  | { estado: 'error'; detalle: string };

/** Procesa UN archivo XML: decide dirección, resuelve tercero por RFC y delega en E3/E4. */
async function procesarArchivo(
  cliente: PrismaClient,
  archivos: ServicioArchivos,
  reporte: Reporte,
  nombre: string,
  xml: string,
  empresasPorRfc: Map<string, number>,
): Promise<EstadoArchivo> {
  let parsed;
  try {
    parsed = parsearCfdi(xml);
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    reporte.agregar('CFDI inválido (OMITIDO)', `${nombre}: ${detalle}`);
    return { estado: 'error', detalle };
  }

  const dir = decidirDireccionCfdi(parsed.emisorRfc, parsed.receptorRfc, empresasPorRfc);
  if (dir.tipo === 'indeterminada') {
    reporte.agregar('CFDI sin dirección (OMITIDO)', `${nombre}: ${dir.motivo}`);
    return { estado: 'error', detalle: dir.motivo };
  }

  const sesion = sesionEtl(dir.idEmpresa);
  try {
    if (dir.tipo === 'venta') {
      // El RECEPTOR es el cliente: resolver por RFC (en la UI lo elige el humano).
      const clienteNegocio = await cliente.cliente.findFirst({
        where: { rfc: { equals: parsed.receptorRfc, mode: 'insensitive' } },
        select: { id: true },
      });
      if (clienteNegocio === null) {
        const detalle = `sin cliente con RFC ${parsed.receptorRfc}`;
        reporte.agregar('CFDI de venta sin cliente en catálogo (OMITIDO)', `${nombre}: ${detalle}`);
        return { estado: 'error', detalle };
      }
      await importarCfdiVenta(sesion, { xml, idCliente: clienteNegocio.id }, { cliente }, archivos);
      return { estado: 'importado', direccion: 'venta' };
    }
    // COMPRA: el EMISOR es el proveedor.
    const proveedor = await cliente.proveedor.findFirst({
      where: { rfc: { equals: parsed.emisorRfc, mode: 'insensitive' } },
      select: { id: true },
    });
    if (proveedor === null) {
      const detalle = `sin proveedor con RFC ${parsed.emisorRfc}`;
      reporte.agregar(
        'CFDI de compra sin proveedor en catálogo (OMITIDO)',
        `${nombre}: ${detalle}`,
      );
      return { estado: 'error', detalle };
    }
    await importarCfdi(sesion, { xml, idProveedor: proveedor.id }, { cliente }, archivos);
    return { estado: 'importado', direccion: 'compra' };
  } catch (error) {
    // UUID ya importado → idempotencia (no es error). El chequeo previo de E3/E4 lanza ErrorConflicto.
    if (error instanceof ErrorConflicto && /ya fue importado/i.test(error.message)) {
      return { estado: 'duplicado' };
    }
    const detalle =
      error instanceof ErrorDominio
        ? `${error.codigo}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    reporte.agregar('CFDI OMITIDO por error', `${nombre}: ${detalle}`);
    return { estado: 'error', detalle };
  }
}

/**
 * Corre el importador masivo contra `cliente`, leyendo los `.xml` de `dir`. `archivos` inyectable (los
 * tests pasan un servicio en modo local sin R2 real). Devuelve el resumen; las incidencias van a `reporte`.
 */
export async function ejecutarEtlCfdiMasivo(
  cliente: PrismaClient,
  dir: string,
  opciones: { archivos?: ServicioArchivos } = {},
): Promise<{ resumen: ResultadoCfdiMasivo; reporte: Reporte }> {
  const archivos = opciones.archivos ?? servicioArchivos();
  const reporte = new Reporte();

  const empresas = await cliente.empresa.findMany({
    where: { rfc: { not: null } },
    select: { id: true, rfc: true },
  });
  const empresasPorRfc = new Map<string, number>();
  for (const e of empresas) {
    if (e.rfc !== null && e.rfc.trim() !== '') empresasPorRfc.set(normalizarRfc(e.rfc), e.id);
  }
  if (empresasPorRfc.size === 0) {
    reporte.nota(
      'Ninguna empresa tiene RFC capturado: no se puede decidir venta/compra. Captura el RFC en Administración › Empresas.',
    );
  }

  const nombres = readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.xml'));
  console.log(`ETL CFDI masivo F9-E6 — ${String(nombres.length)} XML en ${dir}`);

  const resultados = await enLotes(
    nombres,
    (nombre) => {
      const xml = readFileSync(join(dir, nombre), 'utf8');
      return procesarArchivo(cliente, archivos, reporte, nombre, xml, empresasPorRfc);
    },
    CONCURRENCIA_ETL,
  );

  const resumen: ResultadoCfdiMasivo = {
    archivos: nombres.length,
    importados: 0,
    compras: 0,
    ventas: 0,
    duplicados: 0,
    errores: 0,
  };
  for (const r of resultados) {
    if (!r.ok) {
      resumen.errores += 1;
      continue;
    }
    const e = r.valor;
    if (e.estado === 'importado') {
      resumen.importados += 1;
      if (e.direccion === 'venta') resumen.ventas += 1;
      else resumen.compras += 1;
    } else if (e.estado === 'duplicado') {
      resumen.duplicados += 1;
    } else {
      resumen.errores += 1;
    }
  }

  console.log(
    `  importados=${String(resumen.importados)} (compras=${String(resumen.compras)} ventas=${String(resumen.ventas)}) ` +
      `duplicados=${String(resumen.duplicados)} errores=${String(resumen.errores)}`,
  );
  return { resumen, reporte };
}

/** Lee un flag `--clave=valor` de argv (o null). */
function flag(clave: string): string | null {
  const pref = `--${clave}=`;
  const arg = process.argv.find((a) => a.startsWith(pref));
  return arg === undefined ? null : arg.slice(pref.length);
}

/** Punto de entrada del script. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (ver backend/.env.example)');
    process.exit(1);
  }
  const dir = flag('dir');
  if (dir === null) {
    console.error(
      'Falta --dir=<carpeta de XML>. Uso: npx tsx --env-file=.env migracion/etl-cfdi-masivo.ts -- --dir=./cfdi-historicos',
    );
    process.exit(1);
  }
  const cliente = crearClientePrisma(url, opcionesClienteEtl());
  try {
    const { reporte } = await ejecutarEtlCfdiMasivo(cliente, dir);
    const texto = reporte.aTexto();
    console.log('\n' + texto);
  } finally {
    await cliente.$disconnect();
  }
}

const ejecutadoComoScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoComoScript) {
  await main();
}
