/**
 * Loader del DIRECTORIO HISTÓRICO DE TERCEROS del sistema viejo (§Post-F9.28).
 *
 * Daniel (10-ago-2026): *"Al no pasar la información de los maquileros, ¿qué hacemos con la
 * información de ellos si quisiera encontrar algún teléfono o nombre? ¿Habrá manera de mantener la
 * información acá, sin tener toda la información basura en el catálogo? ¿Podríamos guardarlo en
 * algún otro repositorio que no sea el catálogo de proveedores?"*
 *
 * Carga los **1,052** terceros de los cuatro catálogos del Access con sus datos de contacto, como
 * una libreta de direcciones **plana y de solo lectura** — deliberadamente fuera del catálogo
 * `Proveedor`, para que la depuración (§Post-F9.23) siga sirviendo de algo.
 *
 * ENTRAN TODOS, también los 155 que sobrevivieron: se marcan con `enCatalogo` para que la pantalla
 * pueda decir *"este ya está dado de alta"*. Así el directorio es la foto completa del Access y
 * nadie tiene que preguntarse en cuál de los dos lados buscar.
 *
 * LA ÚLTIMA ACTIVIDAD es lo que hace útil al directorio: contesta de un vistazo *"¿hace cuánto que
 * no trabajamos con este?"*. Se calcula de los mismos documentos con los que la depuración decide
 * quién sigue vivo (`comun/proveedores-activos.ts`), pero aquí sin ventana: interesa la fecha real,
 * sea de 2026 o de 2008.
 *
 * ESCRITURA DIRECTA CON PRISMA, no vía dominio (misma excepción consciente a A1 que el archivo de
 * órdenes): no hay regla de negocio que proteger — sin folios, sin estados, sin FKs — y el dominio
 * solo lo lee. POR LOTES, e IDEMPOTENTE por `(fuente, idViejo)`.
 */
import type { Prisma, PrismaClient } from '../../src/datos/index.js';

import { leerCsv } from '../comun/csv.js';
import type { ClienteMapeo } from '../comun/mapeo.js';
import type { Reporte } from '../comun/reporte.js';
import { normalizarParaDedup, parsearFecha, parsearTexto } from '../comun/valores.js';

/** Tamaño de tanda de `createMany`. */
const LOTE = 500;

export interface ResultadoDirectorioTerceros {
  /** Terceros insertados en esta corrida. */
  creados: number;
  /** Ya existían (re-corrida idempotente). */
  existentes: number;
  /** De los cargados, cuántos SÍ están en el catálogo depurado. */
  enCatalogo: number;
}

/** Un documento del viejo que "cuenta" como actividad de un tercero. */
interface FuenteActividad {
  archivo: string;
  campoId: string;
  campoFecha: string;
  /** A qué catálogo apunta ese campo (ver el hallazgo de los estampadores en §Post-F9.23). */
  catalogo: 'Proveedores' | 'Cortadores' | 'Maquileros';
}

/**
 * De dónde sale la actividad de cada tipo de tercero.
 *
 * ⚠️ `EntregasEst`/`RecibosEst` traen la columna `IdMaquileros` y apuntan al catálogo de
 * **Maquileros**, NO al de Estampadores (verificado en §Post-F9.23: de los ids que estampan, ninguno
 * existe en `Estampadores`). Por eso su actividad suma a los maquileros.
 */
const FUENTES: readonly FuenteActividad[] = [
  {
    archivo: 'OrdCompra.csv',
    campoId: 'IdProveedor',
    campoFecha: 'Fecha',
    catalogo: 'Proveedores',
  },
  { archivo: 'Corte.csv', campoId: 'IdCortadores', campoFecha: 'Fecha', catalogo: 'Cortadores' },
  { archivo: 'Entregas.csv', campoId: 'IdMaquileros', campoFecha: 'Fecha', catalogo: 'Maquileros' },
  { archivo: 'Recibos.csv', campoId: 'IdMaquileros', campoFecha: 'Fecha', catalogo: 'Maquileros' },
  {
    archivo: 'Notas.csv',
    campoId: 'IdMaquileros',
    campoFecha: 'FechaElaboracion',
    catalogo: 'Maquileros',
  },
  {
    archivo: 'EntregasEst.csv',
    campoId: 'IdMaquileros',
    campoFecha: 'Fecha',
    catalogo: 'Maquileros',
  },
  {
    archivo: 'RecibosEst.csv',
    campoId: 'IdMaquileros',
    campoFecha: 'Fecha',
    catalogo: 'Maquileros',
  },
];

/** Última fecha y número de documentos de un tercero. */
interface Actividad {
  ultima: Date | null;
  documentos: number;
}

/** Recorre los documentos del viejo y resume la actividad por `catalogo:id`. */
function calcularActividad(): Map<string, Actividad> {
  const mapa = new Map<string, Actividad>();
  for (const f of FUENTES) {
    for (const fila of leerCsv(f.archivo)) {
      const id = (fila[f.campoId] ?? '').trim();
      // `"0"` es el nulo del viejo: no hay tercero #0.
      if (id === '' || id === '0') continue;
      const clave = `${f.catalogo}:${id}`;
      const previo = mapa.get(clave) ?? { ultima: null, documentos: 0 };
      const fecha = parsearFecha(fila[f.campoFecha]);
      mapa.set(clave, {
        documentos: previo.documentos + 1,
        ultima:
          fecha === null
            ? previo.ultima
            : previo.ultima === null
              ? fecha
              : fecha > previo.ultima
                ? fecha
                : previo.ultima,
      });
    }
  }
  return mapa;
}

/** Junta varios textos en las `notas`, saltando los vacíos. */
function juntarNotas(partes: (string | null)[]): string | null {
  const vivas = partes.filter((p): p is string => p !== null && p.trim() !== '');
  return vivas.length === 0 ? null : vivas.join(' · ');
}

export async function cargarDirectorioTerceros(
  cliente: ClienteMapeo,
  reporte: Reporte,
): Promise<ResultadoDirectorioTerceros> {
  const cli = cliente as PrismaClient;
  const actividad = calcularActividad();

  // Quién SÍ quedó en el catálogo depurado. Se cruza por nombre normalizado —el mismo criterio con
  // el que el ETL de proveedores deduplicó—, y solo para pintar una marca informativa: si el cruce
  // falla, el peor caso es que el directorio no diga "ya está dado de alta". Nada operativo depende.
  const enCatalogo = new Set(
    (await cli.proveedor.findMany({ select: { nombre: true } })).map((p) =>
      normalizarParaDedup(p.nombre),
    ),
  );

  const yaCargados = new Set(
    (await cli.directorioTerceroV1.findMany({ select: { fuente: true, idViejo: true } })).map(
      (d) => `${d.fuente}:${d.idViejo}`,
    ),
  );

  const filas: Prisma.DirectorioTerceroV1CreateManyInput[] = [];
  let existentes = 0;

  /** Agrega un tercero al lote, si no estaba ya. `catalogoActividad` puede diferir de `fuente`. */
  function agregar(
    fuente: string,
    idViejo: string,
    catalogoActividad: string,
    datos: Omit<
      Prisma.DirectorioTerceroV1CreateManyInput,
      'fuente' | 'idViejo' | 'ultimaActividad' | 'documentos' | 'enCatalogo'
    >,
  ): void {
    if (idViejo === '' || datos.nombre.trim() === '') return;
    if (yaCargados.has(`${fuente}:${idViejo}`)) {
      existentes += 1;
      return;
    }
    const act = actividad.get(`${catalogoActividad}:${idViejo}`);
    filas.push({
      ...datos,
      fuente,
      idViejo,
      ultimaActividad: act?.ultima ?? null,
      documentos: act?.documentos ?? 0,
      enCatalogo: enCatalogo.has(normalizarParaDedup(datos.nombre)),
    });
  }

  for (const f of leerCsv('Proveedores.csv')) {
    agregar('Proveedores', (f.IdProveedor ?? '').trim(), 'Proveedores', {
      nombre: (f.Proveedor ?? '').trim(),
      razonSocial: parsearTexto(f.RazonSocialProv),
      telefono: parsearTexto(f.Telefono),
      contacto: parsearTexto(f.Contacto),
      notas: juntarNotas([parsearTexto(f.Condiciones)]),
      servicios:
        { T: 'Vende telas', H: 'Vende avíos', S: 'Servicios' }[(f.TipoProv ?? '').trim()] ?? null,
    });
  }

  for (const f of leerCsv('Cortadores.csv')) {
    agregar('Cortadores', (f.IdCortadores ?? '').trim(), 'Cortadores', {
      nombre: (f.Cortador ?? '').trim(),
      telefono: parsearTexto(f.Telefonos),
      servicios: 'Corte',
    });
  }

  for (const f of leerCsv('Maquileros.csv')) {
    const servicios: string[] = [];
    if ((f.Costura ?? '').trim() !== '' && (f.Costura ?? '') !== '0') servicios.push('Costura');
    if ((f.Proceso ?? '').trim() !== '' && (f.Proceso ?? '') !== '0') servicios.push('Estampado');
    agregar('Maquileros', (f.IdMaquileros ?? '').trim(), 'Maquileros', {
      nombre: `${(f.Nombre ?? '').trim()} ${(f.Apellidos ?? '').trim()}`.trim(),
      corto: parsearTexto(f.Corto),
      telefono: parsearTexto(f.Telefonos),
      direccion: parsearTexto(f.Direccion),
      notas: juntarNotas([parsearTexto(f.Observaciones), parsearTexto(f.ObsPago)]),
      servicios: servicios.length === 0 ? null : servicios.join(' · '),
    });
  }

  // `Estampadores` es un catálogo MUERTO (§Post-F9.23: ningún documento le apunta por id), pero sus
  // 44 fichas SÍ traen teléfono y dirección — que es justo lo que se quiere conservar. Entran sin
  // actividad, con una clave de actividad que no existe a propósito.
  for (const f of leerCsv('Estampadores.csv')) {
    agregar('Estampadores', (f.IdEstampadores ?? '').trim(), 'Estampadores', {
      nombre: `${(f.Nombre ?? '').trim()} ${(f.Apellidos ?? '').trim()}`.trim(),
      corto: parsearTexto(f.Corto),
      telefono: parsearTexto(f.Telefonos),
      direccion: parsearTexto(f.Direccion),
      notas: parsearTexto(f.Observaciones),
      servicios: 'Estampado',
    });
  }

  for (let i = 0; i < filas.length; i += LOTE) {
    await cli.directorioTerceroV1.createMany({
      data: filas.slice(i, i + LOTE),
      skipDuplicates: true,
    });
  }

  const conCatalogo = filas.filter((f) => f.enCatalogo === true).length;
  reporte.nota(
    `Directorio histórico: ${String(filas.length)} terceros cargados; ${String(conCatalogo)} de ellos SÍ están ` +
      `en el catálogo depurado (los demás viven solo aquí, para consultar su teléfono o dirección).`,
  );

  return { creados: filas.length, existentes, enCatalogo: conCatalogo };
}
