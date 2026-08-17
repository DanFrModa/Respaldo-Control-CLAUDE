/**
 * Pruebas de INTEGRACIÓN del respaldo a R2 (V1-E6a), contra un PostgreSQL real.
 *
 * Dos cosas que las pruebas unitarias no pueden demostrar y que son justo las que importan:
 *
 *  1. **Que el RASTRO se escribe de verdad** — la fila de `RespaldoCorrida` y el renglón de
 *     `Bitacora` en la misma transacción, salga la corrida bien o mal. Ese rastro es TODO el
 *     mecanismo de "no falla en silencio": si no se escribiera, un respaldo roto sería invisible.
 *
 *  2. **⭐ Que el respaldo SE PUEDE RESTAURAR.** Un respaldo que nadie sabe restaurar no es un
 *     respaldo. Aquí se hace el ciclo COMPLETO con las herramientas reales: `pg_dump` de una base
 *     con datos → cifrado → descifrado → `pg_restore` en OTRA base → y se comprueba que los datos
 *     están del otro lado. Es el ensayo de restauración, automatizado.
 *
 * El ciclo completo necesita el cliente de PostgreSQL (`pg_dump`/`pg_restore`) **de una versión no
 * menor que la del servidor**: pg_dump se niega a volcar un servidor más nuevo que él. Si la máquina
 * no lo tiene, esas pruebas se SALTAN con un aviso — nunca se dan por buenas en falso.
 */
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { inject } from 'vitest';

import { PasoRespaldo, type PrismaClient } from '../../datos/index.js';
// El ENSAYO invoca la función REAL del script de restauración (no una copia de sus argumentos):
// si alguien le quita `--dbname`, esta prueba se cae. El script sólo corre su CLI cuando se ejecuta
// directamente, así que importarlo aquí es seguro.
import { argumentosPgRestore, restaurar } from '../../../scripts/restaurar-respaldo.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { cifrarArchivo, descifrarArchivo } from '../respaldo/cifrado.js';
import type { ConfigRespaldo } from '../respaldo/config.js';
import { generarVolcado, versionPgDump } from '../respaldo/pg-dump.js';
import { claveRespaldo } from '../respaldo/retencion.js';

import {
  ejecutarRespaldoBd,
  iniciarCorrida,
  persistirCorrida,
  registrarRespaldoPeriodico,
  type AlmacenRespaldos,
} from './respaldo-bd.js';

const FRASE = 'frase-de-pruebas-suficientemente-larga-2026';

const CONFIG: ConfigRespaldo = {
  frase: FRASE,
  retencion: 12,
  prefijo: 'respaldos/bd',
  cron: '0 8 1 * *',
  pgDump: 'pg_dump',
};

const url = inject('urlBaseDatosPruebas');

/**
 * ¿Hay cliente de PostgreSQL utilizable CONTRA ESTE SERVIDOR? Se resuelve ANTES de registrar las
 * pruebas (top-level await) porque `skipIf` se evalúa al declararlas, no al correrlas. Si no se
 * puede, se dice EN VOZ ALTA por qué: una prueba que se salta callada es del mismo género de mentira
 * que un respaldo que falla callado.
 */
const { hayHerramientas, motivoSalto } = await (async (): Promise<{
  hayHerramientas: boolean;
  motivoSalto: string;
}> => {
  const versionCliente = await versionPgDump();
  if (versionCliente === null) {
    return { hayHerramientas: false, motivoSalto: 'no hay pg_dump en esta máquina' };
  }
  const sonda = clientePruebas();
  try {
    // pg_dump se NIEGA a volcar un servidor de major MAYOR que la suya. Se compara antes de
    // intentarlo, para decir POR QUÉ se salta en vez de fallar con un error críptico.
    const filas = await sonda.$queryRawUnsafe<{ server_version: string }[]>('SHOW server_version');
    const servidor = filas[0]?.server_version ?? '';
    if (Number(versionCliente.split('.')[0]) < Number(servidor.split('.')[0])) {
      return {
        hayHerramientas: false,
        motivoSalto: `pg_dump ${versionCliente} es más viejo que el servidor ${servidor}`,
      };
    }
    return { hayHerramientas: true, motivoSalto: '' };
  } finally {
    await sonda.$disconnect();
  }
})();

// ⚠️ EN CI NO SE SALTA: SE CAE. Si el ensayo de restauración puede saltarse en silencio, la
// garantía de esta etapa depende de que alguien recuerde mantener el paso que instala el cliente de
// PostgreSQL — y el día que ese paso se caiga o se borre, el CI seguiría verde sin que nadie
// verifique que el respaldo se puede restaurar. Fuera de CI (la máquina de alguien sin cliente
// instalado) sí se salta, con aviso ruidoso.
if (!hayHerramientas) {
  const aviso =
    `Respaldo (V1-E6a): NO se puede ejercitar el ciclo real de volcado/restauración porque ${motivoSalto}. ` +
    'Instala el cliente de PostgreSQL de la major del servidor (en CI lo hace el paso ' +
    '"Cliente PostgreSQL 17" de .github/workflows/ci.yml).';
  if (process.env.CI !== undefined && process.env.CI !== '' && process.env.CI !== 'false') {
    throw new Error(
      `⛔ ${aviso}\n   En CI esto es un FALLO, no un salto: sin este ensayo nadie comprueba que el ` +
        'respaldo se pueda RESTAURAR, que es la mitad del valor de la etapa.',
    );
  }
  console.warn(`⚠️  ${aviso}`);
}

let cliente: PrismaClient;
let carpeta: string;

beforeAll(async () => {
  cliente = clientePruebas();
  carpeta = await mkdtemp(join(tmpdir(), 'int-respaldo-'));
});

afterAll(async () => {
  await rm(carpeta, { recursive: true, force: true });
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
});

/** Almacén en memoria (aquí lo que se prueba es la BD y las herramientas, no R2). */
function almacenFalso(opciones?: { tragaSubidas?: boolean }): AlmacenRespaldos {
  const subidos = new Map<string, number>();
  return {
    bucket: 'bucket-de-pruebas',
    async subirArchivo(key, ruta) {
      const info = await stat(ruta);
      if (opciones?.tragaSubidas !== true) {
        subidos.set(key, info.size);
      }
      return info.size;
    },
    tamanoObjeto: (key) => Promise.resolve(subidos.get(key) ?? null),
    listarObjetos: () => Promise.resolve([]),
    eliminarObjeto: () => Promise.resolve(),
  };
}

describe('rastro de la corrida (lo que hace que un fallo NO pase inadvertido)', () => {
  it('una corrida EXITOSA deja su fila en RespaldoCorrida y su renglón de bitácora', async () => {
    const iniciadoEn = new Date('2026-08-17T08:00:00.000Z');
    await persistirCorrida(
      {
        iniciadoEn,
        terminadoEn: new Date('2026-08-17T08:01:00.000Z'),
        estado: 'EXITO',
        paso: PasoRespaldo.RETENCION,
        bucket: 'control-v2-prueba',
        key: claveRespaldo('respaldos/bd', iniciadoEn),
        tamanoDumpBytes: 12_345_678,
        tamanoSubidoBytes: 12_345_731,
        objetosBorrados: 2,
        duracionMs: 60_000,
      },
      null,
      { cliente },
    );

    const corridas = await cliente.respaldoCorrida.findMany();
    expect(corridas).toHaveLength(1);
    expect(corridas[0]?.estado).toBe('EXITO');
    expect(corridas[0]?.paso).toBe(PasoRespaldo.RETENCION);
    expect(corridas[0]?.tamanoDumpBytes).toBe(12_345_678n);
    expect(corridas[0]?.objetosBorrados).toBe(2);
    expect(corridas[0]?.error).toBeNull();

    // El renglón de bitácora es lo que hace VISIBLE la corrida en la pantalla que ya existe
    // (Administración › Bitácora, filtro de entidad `RespaldoBd`).
    const bitacora = await cliente.bitacora.findMany({ where: { entidad: 'RespaldoBd' } });
    expect(bitacora).toHaveLength(1);
    expect(bitacora[0]?.accion).toBe('CREAR');
    expect(bitacora[0]?.idEntidad).toBe(String(corridas[0]?.id));
    expect(bitacora[0]?.idUsuario).toBeNull(); // proceso del sistema, no una persona
  });

  it('una corrida FALLIDA deja rastro con el paso y el error, y bitácora en OTRO', async () => {
    const ahora = new Date();
    await persistirCorrida(
      {
        iniciadoEn: ahora,
        terminadoEn: ahora,
        estado: 'FALLO',
        paso: PasoRespaldo.SUBIDA,
        bucket: 'control-v2-prueba',
        objetosBorrados: 0,
        duracionMs: 900,
        error: 'AccessDenied: el token S3 no tiene permiso de escritura',
      },
      null,
      { cliente },
    );

    const [corrida] = await cliente.respaldoCorrida.findMany();
    expect(corrida?.estado).toBe('FALLO');
    expect(corrida?.paso).toBe(PasoRespaldo.SUBIDA);
    expect(corrida?.error).toMatch(/AccessDenied/);
    expect(corrida?.key).toBeNull();

    const [renglon] = await cliente.bitacora.findMany({ where: { entidad: 'RespaldoBd' } });
    // `OTRO` y no `CREAR`: no se creó ningún respaldo.
    expect(renglon?.accion).toBe('OTRO');
    expect(renglon?.datos).toMatchObject({ estado: 'FALLO', paso: PasoRespaldo.SUBIDA });
  });

  it('el rastro de la corrida se puede consultar por estado (última corrida buena / última mala)', async () => {
    const base = new Date('2026-08-10T08:00:00.000Z');
    for (let dia = 0; dia < 4; dia += 1) {
      const momento = new Date(base.getTime() + dia * 24 * 60 * 60 * 1000);
      await persistirCorrida(
        {
          iniciadoEn: momento,
          terminadoEn: momento,
          estado: dia === 3 ? 'FALLO' : 'EXITO',
          paso: dia === 3 ? PasoRespaldo.SUBIDA : PasoRespaldo.RETENCION,
          objetosBorrados: 0,
          duracionMs: 1_000,
          ...(dia === 3 ? { error: 'R2 no respondió' } : {}),
        },
        null,
        { cliente },
      );
    }

    const ultimaBuena = await cliente.respaldoCorrida.findFirst({
      where: { estado: 'EXITO' },
      orderBy: { iniciadoEn: 'desc' },
    });
    expect(ultimaBuena?.iniciadoEn.toISOString()).toBe('2026-08-12T08:00:00.000Z');
    expect(await cliente.respaldoCorrida.count({ where: { estado: 'FALLO' } })).toBe(1);
  });
});

describe('respaldo completo contra la base real', () => {
  it.skipIf(!hayHerramientas)(
    'vuelca la base de verdad, la cifra, la sube, la verifica y lo deja anotado',
    async () => {
      const resultado = await ejecutarRespaldoBd({
        config: CONFIG,
        almacen: almacenFalso(),
        dirTemporal: carpeta,
        generarVolcado: (destino) => generarVolcado({ url, destino }),
        iniciarRastro: (momento) => iniciarCorrida(momento, { cliente }),
        persistir: (registro, id) => persistirCorrida(registro, id, { cliente }),
        registrarError: () => {
          /* silenciado */
        },
      });

      expect(resultado.estado).toBe('EXITO');
      expect(resultado.tamanoDumpBytes).toBeGreaterThan(0);
      // El objeto cifrado pesa el volcado + cabecera (37) + etiqueta GCM (16).
      expect(resultado.tamanoSubidoBytes).toBe((resultado.tamanoDumpBytes as number) + 53);

      const [corrida] = await cliente.respaldoCorrida.findMany();
      expect(corrida?.estado).toBe('EXITO');
      expect(corrida?.key).toBe(resultado.key);
    },
    120_000,
  );

  it.skipIf(!hayHerramientas)(
    'un fallo de subida contra la base real también queda anotado',
    async () => {
      const resultado = await ejecutarRespaldoBd({
        config: CONFIG,
        almacen: almacenFalso({ tragaSubidas: true }),
        dirTemporal: carpeta,
        generarVolcado: (destino) => generarVolcado({ url, destino }),
        iniciarRastro: (momento) => iniciarCorrida(momento, { cliente }),
        persistir: (registro, id) => persistirCorrida(registro, id, { cliente }),
        registrarError: () => {
          /* silenciado */
        },
      });

      expect(resultado.estado).toBe('FALLO');
      const [corrida] = await cliente.respaldoCorrida.findMany();
      expect(corrida?.estado).toBe('FALLO');
      expect(corrida?.paso).toBe(PasoRespaldo.VERIFICACION);
    },
    120_000,
  );
});

describe('⭐ arranque: la AUSENCIA de respaldo también deja rastro', () => {
  /** Entorno con TODO bien configurado (llave larga y credenciales R2 que parecen reales). */
  const ENV_BUENO: Record<string, string> = {
    RESPALDO_LLAVE: 'Xk8sMq2vPz7RtL5nWc3bYh9jFd6gA4eU',
    R2_ACCOUNT_ID: 'cuenta-real-de-cloudflare',
    R2_ACCESS_KEY_ID: 'AKIAREALREALREAL',
    R2_SECRET_ACCESS_KEY: 'secreto-real-de-verdad-largo',
    R2_BUCKET: 'control-v2-prueba',
  };

  /** Corre el arranque con un entorno dado y devuelve las filas de rastro que dejó. */
  async function arrancarCon(env: Record<string, string | undefined>): Promise<{
    corridas: { estado: string; paso: string; error: string | null }[];
    bitacora: number;
  }> {
    const previo = { ...process.env };
    // Sin motor de jobs (en pruebas nunca se inicia pg-boss): es EXACTAMENTE el escenario en que
    // el backend arranca antes de que la BD responda, `iniciarMotorJobs` cae en su catch y la app
    // sigue sirviendo — la cicatriz de CLAUDE.md §8.
    try {
      for (const clave of Object.keys(ENV_BUENO)) {
        delete process.env[clave];
      }
      delete process.env.RESPALDO_ACTIVO;
      delete process.env.R2_SUBIDA_LOCAL;
      Object.assign(process.env, env);
      await registrarRespaldoPeriodico(() => {
        /* el log se silencia: lo que se afirma aquí es el RASTRO, no la línea de log */
      });
    } finally {
      for (const clave of Object.keys(process.env)) {
        if (!(clave in previo)) {
          delete process.env[clave];
        }
      }
      Object.assign(process.env, previo);
    }
    const corridas = await cliente.respaldoCorrida.findMany({
      select: { estado: true, paso: true, error: true },
    });
    const bitacora = await cliente.bitacora.count({ where: { entidad: 'RespaldoBd' } });
    return { corridas, bitacora };
  }

  it('⭐ configuración PERFECTA pero sin motor de jobs: deja fila ROJA (antes: cero rastro)', async () => {
    // Éste era el agujero: se salía ANTES de decidir nada, así que el sistema se quedaba sin
    // respaldo y el lugar designado para enterarse estaba vacío. Ni log, ni fila, ni bitácora.
    const { corridas, bitacora } = await arrancarCon(ENV_BUENO);

    expect(corridas).toHaveLength(1);
    expect(corridas[0]?.estado).toBe('FALLO');
    expect(corridas[0]?.paso).toBe('PROGRAMACION');
    expect(corridas[0]?.error).toMatch(/motor de jobs/i);
    expect(bitacora).toBe(1); // y se ve en la pantalla de bitácora que ya existe
  });

  it('falta la llave: fila roja con paso CONFIGURACION', async () => {
    const { corridas, bitacora } = await arrancarCon({ ...ENV_BUENO, RESPALDO_LLAVE: undefined });
    expect(corridas[0]?.estado).toBe('FALLO');
    expect(corridas[0]?.paso).toBe('CONFIGURACION');
    expect(corridas[0]?.error).toMatch(/RESPALDO_LLAVE/);
    expect(bitacora).toBe(1);
  });

  it('credenciales R2 de relleno: fila roja con paso CONFIGURACION', async () => {
    const { corridas } = await arrancarCon({ ...ENV_BUENO, R2_ACCESS_KEY_ID: 'dev' });
    expect(corridas[0]?.paso).toBe('CONFIGURACION');
    expect(corridas[0]?.error).toMatch(/relleno/i);
  });

  it('apagado a propósito: NO deja rastro rojo (es una decisión, no un fallo)', async () => {
    const { corridas, bitacora } = await arrancarCon({ ...ENV_BUENO, RESPALDO_ACTIVO: 'false' });
    expect(corridas).toStrictEqual([]);
    expect(bitacora).toBe(0);
  });
});

describe('corridas que mueren a media', () => {
  it('⭐ una corrida abierta y nunca cerrada se ve, y la siguiente la cierra como FALLO', async () => {
    // Simula el redeploy/OOM/SIGKILL durante el `pg_dump`: la fila queda EN_CURSO.
    const muerta = await iniciarCorrida(new Date('2026-07-01T08:00:00.000Z'), { cliente });
    const enCurso = await cliente.respaldoCorrida.findUniqueOrThrow({ where: { id: muerta } });
    expect(enCurso.estado).toBe('EN_CURSO');
    expect(enCurso.terminadoEn).toBeNull(); // se ve "lleva horas corriendo"

    // La corrida del mes siguiente la encuentra y la cierra.
    const nueva = await iniciarCorrida(new Date('2026-08-01T08:00:00.000Z'), { cliente });

    const cerrada = await cliente.respaldoCorrida.findUniqueOrThrow({ where: { id: muerta } });
    expect(cerrada.estado).toBe('FALLO');
    expect(cerrada.error).toMatch(/SIN TERMINAR/i);
    expect(await cliente.respaldoCorrida.findUniqueOrThrow({ where: { id: nueva } })).toMatchObject(
      {
        estado: 'EN_CURSO',
      },
    );
    // Y la muerte quedó anotada donde se mira.
    expect(
      await cliente.bitacora.count({ where: { entidad: 'RespaldoBd', idEntidad: String(muerta) } }),
    ).toBe(1);
  });

  it('el cierre ACTUALIZA la fila abierta, no crea una segunda', async () => {
    const id = await iniciarCorrida(new Date('2026-08-01T08:00:00.000Z'), { cliente });
    await persistirCorrida(
      {
        iniciadoEn: new Date('2026-08-01T08:00:00.000Z'),
        terminadoEn: new Date('2026-08-01T08:05:00.000Z'),
        estado: 'EXITO',
        paso: PasoRespaldo.RETENCION,
        bucket: 'b',
        key: 'k',
        sha256: 'a'.repeat(64),
        objetosBorrados: 0,
        duracionMs: 300_000,
      },
      id,
      { cliente },
    );
    const corridas = await cliente.respaldoCorrida.findMany();
    expect(corridas).toHaveLength(1);
    expect(corridas[0]?.estado).toBe('EXITO');
    expect(corridas[0]?.sha256).toBe('a'.repeat(64));
  });
});

describe('argumentos de pg_restore del script (la cicatriz de --dbname)', () => {
  it('incluye --dbname con la base destino: pg_restore NO lo toma de PGDATABASE', () => {
    const argumentos = argumentosPgRestore('/tmp/x.dump', {
      PGHOST: 'host',
      PGDATABASE: 'ensayo_restauracion',
    });
    expect(argumentos).toContain('--dbname');
    expect(argumentos[argumentos.indexOf('--dbname') + 1]).toBe('ensayo_restauracion');
    expect(argumentos.at(-1)).toBe('/tmp/x.dump');
  });
});

describe('⭐ ENSAYO DE RESTAURACIÓN (un respaldo que no se sabe restaurar no es un respaldo)', () => {
  it.skipIf(!hayHerramientas)(
    'ciclo completo: pg_dump → cifrar → descifrar → pg_restore en otra base → los datos están',
    async () => {
      // 1. Un dato reconocible en la base de origen. Se usa `RespaldoCorrida` misma: no depende de
      //    ningún otro módulo y su forma no va a cambiar por debajo de esta prueba.
      const sello = new Date('2026-08-17T08:00:00.000Z');
      await persistirCorrida(
        {
          iniciadoEn: sello,
          terminadoEn: sello,
          estado: 'EXITO',
          paso: PasoRespaldo.RETENCION,
          bucket: 'testigo-de-la-restauracion',
          key: 'respaldos/bd/2026/testigo.dump.enc',
          objetosBorrados: 7,
          duracionMs: 4_242,
        },
        null,
        { cliente },
      );

      // 2. Volcado + cifrado (exactamente lo que hace el job cada noche).
      const volcado = join(carpeta, 'ensayo.dump');
      const cifrado = join(carpeta, 'ensayo.dump.enc');
      await generarVolcado({ url, destino: volcado });
      await cifrarArchivo(volcado, cifrado, FRASE);

      // 3. Descifrado (exactamente lo que hace `scripts/restaurar-respaldo.ts`).
      const recuperado = join(carpeta, 'ensayo-recuperado.dump');
      await descifrarArchivo(cifrado, recuperado, FRASE);

      // 4. Base NUEVA y vacía donde restaurar (nunca encima de la de origen).
      const urlDestino = new URL(url);
      const nombreOrigen = urlDestino.pathname.replace(/^\//, '');
      const nombreDestino = `ensayo_restauracion_${String(Date.now())}`;
      await cliente.$executeRawUnsafe(`CREATE DATABASE "${nombreDestino}"`);
      urlDestino.pathname = `/${nombreDestino}`;

      try {
        // 5. pg_restore — invocando la FUNCIÓN REAL del script de restauración, no una copia de sus
        //    argumentos. Que la prueba repitiera la lista era una red decorativa: borrarle
        //    `--dbname` al script no rompía nada. Ahora sí.
        await restaurar(recuperado, urlDestino.toString());

        // 6. LA PRUEBA DE FUEGO: el dato está del otro lado, íntegro.
        const { crearClientePrisma } = await import('../../datos/index.js');
        const restaurado = crearClientePrisma(urlDestino.toString());
        try {
          const corridas = await restaurado.respaldoCorrida.findMany();
          expect(corridas).toHaveLength(1);
          expect(corridas[0]?.bucket).toBe('testigo-de-la-restauracion');
          expect(corridas[0]?.objetosBorrados).toBe(7);
          expect(corridas[0]?.duracionMs).toBe(4_242);
          expect(corridas[0]?.iniciadoEn.toISOString()).toBe(sello.toISOString());
          // El esquema entero viajó, no solo esa tabla.
          const tablas = await restaurado.$queryRaw<{ total: bigint }[]>`
            SELECT count(*)::bigint AS total FROM pg_tables WHERE schemaname = 'public'
          `;
          expect(Number(tablas[0]?.total ?? 0)).toBeGreaterThan(50);
        } finally {
          await restaurado.$disconnect();
        }
      } finally {
        await cliente.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${nombreDestino}" WITH (FORCE)`);
        expect(nombreOrigen).not.toBe(nombreDestino); // por si acaso: jamás se tocó el origen
      }
    },
    180_000,
  );
});
