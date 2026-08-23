/**
 * Pruebas del CUERPO del respaldo a R2 (V1-E6a), con todas sus dependencias falseadas: sin R2, sin
 * `pg_dump` y sin base de datos.
 *
 * Lo que se persigue aquí es el requisito que manda la etapa: **que un fallo NO pase inadvertido**.
 * El riesgo no es teórico — la configuración de R2 del ambiente `prueba` está rota hoy (las fotos no
 * suben, `docs/GUIA-RAILWAY-R2.md` §9.1), así que el primer intento real de subir un respaldo
 * probablemente falle. Estas pruebas fijan que cuando eso pase quede un rastro, y que el rastro diga
 * en qué paso fue.
 *
 * El caso más traicionero es el que se prueba en «el PUT no lanzó pero el objeto NO está»: un
 * almacén que acepta la subida y no guarda nada es indistinguible del éxito si uno se conforma con
 * que no haya excepción. Por eso el respaldo VERIFICA con HeadObject.
 */
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PasoRespaldo } from '../../datos/index.js';
import type { ConfigRespaldo } from '../respaldo/config.js';
import { claveRespaldo, type ObjetoRespaldo } from '../respaldo/retencion.js';

import {
  ejecutarRespaldoBd,
  type AlmacenRespaldos,
  type DepsRespaldo,
  type RegistroCorrida,
} from './respaldo-bd.js';

const CONFIG: ConfigRespaldo = {
  frase: 'frase-de-pruebas-suficientemente-larga-2026',
  retencion: 12,
  prefijo: 'respaldos/bd',
  cron: '0 8 1 * *',
  pgDump: 'pg_dump',
};

const AHORA = new Date('2026-08-17T08:00:00.000Z');

let carpeta: string;

beforeAll(async () => {
  carpeta = await mkdtemp(join(tmpdir(), 'prueba-respaldo-'));
});

afterAll(async () => {
  await rm(carpeta, { recursive: true, force: true });
});

/**
 * Almacén de mentira que se comporta como R2 pero en memoria, y que se puede AVERIAR a voluntad
 * para reproducir cada forma de fallar.
 */
function almacenFalso(opciones?: {
  /** Simula "el PUT no lanza pero el objeto no queda" (el fallo silencioso clásico). */
  tragaSubidas?: boolean;
  /** Simula una transferencia cortada: el objeto queda, pero incompleto. */
  bytesQueGuarda?: (bytes: number) => number;
  /** El PUT lanza (credenciales sin permiso de escritura: el caso vivo de `prueba` hoy). */
  errorAlSubir?: Error;
  /** El borrado de la retención falla. */
  errorAlBorrar?: Error;
  /** Objetos que ya existen en el bucket. */
  existentes?: ObjetoRespaldo[];
}): AlmacenRespaldos & { subidos: Map<string, number>; borrados: string[] } {
  const subidos = new Map<string, number>();
  const borrados: string[] = [];
  const existentes = new Map<string, ObjetoRespaldo>(
    (opciones?.existentes ?? []).map((objeto) => [objeto.key, objeto]),
  );
  return {
    bucket: 'control-v2-prueba',
    subidos,
    borrados,
    async subirArchivo(key, ruta) {
      if (opciones?.errorAlSubir !== undefined) {
        throw opciones.errorAlSubir;
      }
      const info = await stat(ruta);
      if (opciones?.tragaSubidas !== true) {
        subidos.set(key, opciones?.bytesQueGuarda?.(info.size) ?? info.size);
      }
      return info.size;
    },
    tamanoObjeto(key) {
      return Promise.resolve(subidos.get(key) ?? existentes.get(key)?.tamanoBytes ?? null);
    },
    listarObjetos(prefijo) {
      const deExistentes = [...existentes.values()].filter((objeto) =>
        objeto.key.startsWith(prefijo),
      );
      const deSubidos = [...subidos.entries()]
        .filter(([key]) => key.startsWith(prefijo))
        .map(([key, tamanoBytes]) => ({ key, tamanoBytes, ultimaModificacion: AHORA }));
      return Promise.resolve([...deExistentes, ...deSubidos]);
    },
    eliminarObjeto(key) {
      if (opciones?.errorAlBorrar !== undefined) {
        return Promise.reject(opciones.errorAlBorrar);
      }
      borrados.push(key);
      existentes.delete(key);
      subidos.delete(key);
      return Promise.resolve();
    },
  };
}

/** Arma las dependencias con un volcado de mentira (un archivo con contenido) y rastro en memoria. */
function deps(
  almacen: AlmacenRespaldos,
  extra?: Partial<DepsRespaldo>,
): DepsRespaldo & {
  rastro: RegistroCorrida[];
  abiertos: Date[];
  cerradosSobre: (bigint | null)[];
} {
  const rastro: RegistroCorrida[] = [];
  const abiertos: Date[] = [];
  const cerradosSobre: (bigint | null)[] = [];
  return {
    config: CONFIG,
    almacen,
    rastro,
    abiertos,
    cerradosSobre,
    dirTemporal: carpeta,
    ahora: () => AHORA,
    generarVolcado: async (destino) => {
      await writeFile(destino, 'volcado-de-mentira'.repeat(100));
      const info = await stat(destino);
      return info.size;
    },
    iniciarRastro: () => {
      abiertos.push(AHORA);
      return Promise.resolve(77n);
    },
    persistir: (registro, idAbierto) => {
      rastro.push(registro);
      cerradosSobre.push(idAbierto);
      return Promise.resolve();
    },
    registrarError: () => {
      /* silenciado en pruebas: lo que se afirma es el RASTRO, no el log */
    },
    ...extra,
  };
}

describe('respaldo · camino feliz', () => {
  it('vuelca, cifra, sube, VERIFICA y deja rastro de éxito', async () => {
    const almacen = almacenFalso();
    const dependencias = deps(almacen);

    const resultado = await ejecutarRespaldoBd(dependencias);

    expect(resultado.estado).toBe('EXITO');
    expect(resultado.paso).toBe(PasoRespaldo.RETENCION);
    expect(resultado.key).toBe(claveRespaldo(CONFIG.prefijo, AHORA));
    expect(resultado.error).toBeUndefined();
    expect(almacen.subidos.has(resultado.key as string)).toBe(true);
    // El rastro se escribe SIEMPRE, y es lo que se persiste.
    expect(dependencias.rastro).toHaveLength(1);
    expect(dependencias.rastro[0]).toStrictEqual(resultado);
  });

  it('lo subido es el archivo CIFRADO, no el volcado en claro, y queda su huella', async () => {
    const almacen = almacenFalso();
    const resultado = await ejecutarRespaldoBd(deps(almacen));
    const subido = almacen.subidos.get(resultado.key as string) as number;
    // El cifrado pesa el volcado + cabecera (37 bytes) + etiqueta (16).
    expect(subido).toBe((resultado.tamanoDumpBytes as number) + 53);
    expect(resultado.tamanoSubidoBytes).toBe(subido);
    // SHA-256 del archivo cifrado: permite comprobar el respaldo SIN la llave y ANTES del desastre.
    expect(resultado.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ABRE el rastro antes de trabajar y lo CIERRA sobre esa misma fila', async () => {
    const dependencias = deps(almacenFalso());
    await ejecutarRespaldoBd(dependencias);
    expect(dependencias.abiertos).toHaveLength(1); // fila EN_CURSO al empezar
    expect(dependencias.cerradosSobre).toStrictEqual([77n]); // se actualizó ESA fila, no otra nueva
  });

  it('no deja temporales tirados en el disco (ni el volcado en claro)', async () => {
    const antes = await import('node:fs/promises').then((fs) => fs.readdir(carpeta));
    await ejecutarRespaldoBd(deps(almacenFalso()));
    const despues = await import('node:fs/promises').then((fs) => fs.readdir(carpeta));
    expect(despues).toStrictEqual(antes);
  });
});

describe('respaldo · que NO falle en silencio', () => {
  it('⭐ si el almacén acepta el PUT pero el objeto NO queda, lo DETECTA y lo reporta', async () => {
    // Este es el fallo silencioso que la etapa persigue: sin la verificación, esta corrida se
    // habría dado por buena y el respaldo de hoy simplemente no existiría.
    const almacen = almacenFalso({ tragaSubidas: true });
    const dependencias = deps(almacen);

    const resultado = await ejecutarRespaldoBd(dependencias);

    expect(resultado.estado).toBe('FALLO');
    expect(resultado.paso).toBe(PasoRespaldo.VERIFICACION);
    expect(resultado.error).toMatch(/NO ESTÁ en el bucket/);
    expect(dependencias.rastro).toHaveLength(1);
    expect(dependencias.rastro[0]?.estado).toBe('FALLO');
  });

  it('⭐ si el objeto queda TRUNCADO (tamaño distinto), lo detecta: no se podría descifrar', async () => {
    const almacen = almacenFalso({ bytesQueGuarda: (bytes) => Math.floor(bytes / 2) });
    const resultado = await ejecutarRespaldoBd(deps(almacen));

    expect(resultado.estado).toBe('FALLO');
    expect(resultado.paso).toBe(PasoRespaldo.VERIFICACION);
    expect(resultado.error).toMatch(/INCOMPLETO/);
  });

  it('⭐ si R2 rechaza la subida (llave sin permiso de escritura), lo reporta con el paso SUBIDA', async () => {
    // Es exactamente lo que pasa hoy en `prueba` con las fotos: token S3 de solo lectura → 403.
    const almacen = almacenFalso({
      errorAlSubir: new Error('AccessDenied: no permission to write to this bucket'),
    });
    const dependencias = deps(almacen);

    const resultado = await ejecutarRespaldoBd(dependencias);

    expect(resultado.estado).toBe('FALLO');
    expect(resultado.paso).toBe(PasoRespaldo.SUBIDA);
    expect(resultado.error).toMatch(/AccessDenied/);
    expect(dependencias.rastro[0]?.error).toMatch(/AccessDenied/);
  });

  it('si `pg_dump` truena, el rastro dice VOLCADO y no se sube nada', async () => {
    const almacen = almacenFalso();
    const dependencias = deps(almacen, {
      generarVolcado: () => Promise.reject(new Error('pg_dump: no se encontró el ejecutable')),
    });

    const resultado = await ejecutarRespaldoBd(dependencias);

    expect(resultado.estado).toBe('FALLO');
    expect(resultado.paso).toBe(PasoRespaldo.VOLCADO);
    expect(almacen.subidos.size).toBe(0);
    expect(dependencias.rastro).toHaveLength(1);
  });

  it('si el cifrado truena, el rastro dice CIFRADO y no se sube nada', async () => {
    const almacen = almacenFalso();
    const dependencias = deps(almacen, {
      cifrar: () => Promise.reject(new Error('sin entropía')),
    });

    const resultado = await ejecutarRespaldoBd(dependencias);

    expect(resultado.estado).toBe('FALLO');
    expect(resultado.paso).toBe(PasoRespaldo.CIFRADO);
    expect(almacen.subidos.size).toBe(0);
  });

  it('⭐ si NI SIQUIERA se puede crear el directorio temporal, NO lanza y deja rastro', async () => {
    // Escenario "disco lleno / TMPDIR mal puesto". Era el único de la lista que se perdía: el
    // `mkdtemp` estaba FUERA del try, así que su excepción se saltaba el rastro y subía al worker,
    // rompiendo el contrato ("NO lanza") del que depende quien lo llama. El job quedaba anotado
    // sólo dentro del esquema `pgboss`… que es justo el que este respaldo EXCLUYE del volcado.
    const dependencias = deps(almacenFalso(), {
      dirTemporal: join(carpeta, 'ruta', 'que', 'no', 'existe'),
    });

    const resultado = await ejecutarRespaldoBd(dependencias);

    expect(resultado.estado).toBe('FALLO');
    expect(resultado.paso).toBe(PasoRespaldo.VOLCADO);
    expect(resultado.error).toMatch(/ENOENT|no such file/i);
    expect(dependencias.rastro).toHaveLength(1);
    expect(dependencias.rastro[0]?.estado).toBe('FALLO');
  });

  it('si no se puede ABRIR el rastro, la corrida sigue igual (el respaldo importa más)', async () => {
    const dependencias = deps(almacenFalso(), {
      iniciarRastro: () => Promise.reject(new Error('la base no responde')),
    });

    const resultado = await ejecutarRespaldoBd(dependencias);

    expect(resultado.estado).toBe('EXITO');
    // Al cerrar sin fila abierta se crea la fila entera (idAbierto = null).
    expect(dependencias.cerradosSobre).toStrictEqual([null]);
  });

  it('el cuerpo NUNCA lanza: devuelve el fallo para que el llamador decida', async () => {
    const resultado = await ejecutarRespaldoBd(
      deps(almacenFalso(), { generarVolcado: () => Promise.reject(new Error('lo que sea')) }),
    );
    expect(resultado.estado).toBe('FALLO');
  });

  it('limpia los temporales incluso cuando la corrida falla', async () => {
    const antes = await import('node:fs/promises').then((fs) => fs.readdir(carpeta));
    await ejecutarRespaldoBd(deps(almacenFalso({ tragaSubidas: true })));
    const despues = await import('node:fs/promises').then((fs) => fs.readdir(carpeta));
    expect(despues).toStrictEqual(antes);
  });
});

describe('respaldo · retención (la única operación destructiva de la etapa)', () => {
  /** Un respaldo ya guardado, de hace `meses` meses (30 días cada uno). */
  function haceMeses(meses: number): ObjetoRespaldo {
    const fecha = new Date(AHORA.getTime() - meses * 30 * 24 * 60 * 60 * 1000);
    return {
      key: claveRespaldo(CONFIG.prefijo, fecha),
      ultimaModificacion: fecha,
      tamanoBytes: 1_000,
    };
  }

  /** Un año de respaldos mensuales ya guardados (del más nuevo al más viejo). */
  function unAno(): ObjetoRespaldo[] {
    return Array.from({ length: 12 }, (_, indice) => haceMeses(indice + 1));
  }

  it('⭐ borra lo VIEJO que sobra del tope y conserva lo NUEVO (incluido el de hoy)', async () => {
    // 12 guardados + el de esta corrida = 13; con tope 12 sobra exactamente el más viejo.
    const almacen = almacenFalso({ existentes: unAno() });

    const resultado = await ejecutarRespaldoBd(deps(almacen));

    expect(resultado.estado).toBe('EXITO');
    expect(almacen.borrados).toStrictEqual([haceMeses(12).key]);
    expect(resultado.objetosBorrados).toBe(1);
    // Los que caben y el recién subido siguen ahí.
    expect(almacen.borrados).not.toContain(haceMeses(1).key);
    expect(almacen.borrados).not.toContain(haceMeses(11).key);
    expect(almacen.borrados).not.toContain(resultado.key);
    expect(await almacen.tamanoObjeto(resultado.key as string)).not.toBeNull();
  });

  it('mientras quepan en el tope, no borra ninguno', async () => {
    const almacen = almacenFalso({ existentes: [haceMeses(1), haceMeses(2), haceMeses(3)] });
    const resultado = await ejecutarRespaldoBd(deps(almacen));
    expect(resultado.estado).toBe('EXITO');
    expect(almacen.borrados).toStrictEqual([]);
  });

  it('⭐ NO borra nada si la subida de hoy falló: primero se confirma el nuevo', async () => {
    // El orden importa: la retención va DESPUÉS de verificar. Si se invirtiera, una corrida que no
    // logró subir habría borrado el respaldo más viejo a cambio de nada.
    const almacen = almacenFalso({ existentes: unAno(), tragaSubidas: true });

    const resultado = await ejecutarRespaldoBd(deps(almacen));

    expect(resultado.estado).toBe('FALLO');
    expect(almacen.borrados).toStrictEqual([]);
    expect(resultado.objetosBorrados).toBe(0);
  });

  it('con el bucket vacío no borra nada y la corrida sale bien', async () => {
    const almacen = almacenFalso();
    const resultado = await ejecutarRespaldoBd(deps(almacen));
    expect(resultado.estado).toBe('EXITO');
    expect(almacen.borrados).toStrictEqual([]);
  });

  it('un borrado que falla NO tumba la corrida (el respaldo de hoy ya está verificado)', async () => {
    const almacen = almacenFalso({
      existentes: unAno(),
      errorAlBorrar: new Error('R2 no responde'),
    });

    const resultado = await ejecutarRespaldoBd(deps(almacen));

    expect(resultado.estado).toBe('EXITO');
    expect(resultado.objetosBorrados).toBe(0);
  });

  it('respeta una retención distinta a la de fábrica', async () => {
    const almacen = almacenFalso({ existentes: unAno() });
    const resultado = await ejecutarRespaldoBd(
      deps(almacen, { config: { ...CONFIG, retencion: 24 } }),
    );
    expect(resultado.estado).toBe('EXITO');
    expect(almacen.borrados).toStrictEqual([]); // con tope 24 caben los 13
  });
});
