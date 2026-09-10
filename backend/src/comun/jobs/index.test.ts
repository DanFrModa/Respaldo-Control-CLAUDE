/**
 * Tests UNITARIOS del motor de jobs (F5-E3) — la lógica SIN BD: la `singletonKey`, la POLÍTICA que
 * hace que esa clave sirva de algo, la conciliación de políticas al arrancar, y el NO-OP cuando el
 * motor está inactivo. El transporte real de pg-boss (que un `send` duplicado devuelva `null`
 * contra Postgres) se prueba en integración / Railway, no aquí.
 *
 * ⚠️ QUÉ SE PUEDE FIJAR SIN BASE Y QUÉ NO — la distinción importa, porque este archivo nació de un
 * defecto que era exactamente eso: un comentario que prometía una garantía del motor que el motor no
 * daba, y NADA que lo desmintiera.
 *  • SIN BD (aquí): que cada cola DECLARE una política; que la declarada exista de verdad en el
 *    pg-boss instalado; y —lo importante— que pg-boss RESPALDE esa política con un índice único
 *    sobre `singleton_key`, leído de su propio `getConstructionPlans()` (API pública). Eso hace que
 *    quitar la política, o subir a un pg-boss que la retire, ponga el CI en rojo.
 *  • SÓLO CON BD (integración/Railway): que dos `send` con la misma clave devuelvan un id y `null`.
 *    Aquí no se levanta Postgres (regla del proyecto: nada de Docker local).
 */
import { readFileSync } from 'node:fs';

import { getConstructionPlans, policies } from 'pg-boss';
import type * as ModuloPgBoss from 'pg-boss';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  COLAS_JOBS,
  POLITICA_POR_COLA,
  claveSerializacion,
  conciliarPoliticasColas,
  encolarJob,
  fijarMotorJobs,
  jobsActivos,
  iniciarMotorJobs,
  motorJobs,
  opcionesDeCola,
  registrarHandler,
  type MotorColas,
  type NombreColaJob,
  type PoliticaCola,
} from './index.js';

/**
 * Estado observable del pg-boss de mentira (ver `vi.mock` abajo). Se declara con `vi.hoisted` porque
 * `vi.mock` se iza por encima de los imports.
 */
const espiaPgBoss = vi.hoisted(() => ({
  politicas: new Map<string, string>(),
  creadas: [] as { nombre: string; politica: string | undefined }[],
  borradas: [] as string[],
}));

/**
 * Doble de `PgBoss` que imita LO ÚNICO que importa aquí: `createQueue` sobre una cola que ya existe
 * NO cambia su política (el `ON CONFLICT DO NOTHING` real de pg-boss). Todo lo demás del módulo
 * —`policies`, `getConstructionPlans`— se deja intacto: esos tests SÍ deben leer la librería real.
 */
vi.mock('pg-boss', async (importarOriginal) => {
  const real = await importarOriginal<typeof ModuloPgBoss>();
  class PgBossFalso {
    on(): void {
      /* el motor sólo engancha 'error' */
    }
    start(): Promise<void> {
      return Promise.resolve();
    }
    stop(): Promise<void> {
      return Promise.resolve();
    }
    createQueue(nombre: string, opciones?: { policy?: string }): Promise<void> {
      espiaPgBoss.creadas.push({ nombre, politica: opciones?.policy });
      if (!espiaPgBoss.politicas.has(nombre)) {
        espiaPgBoss.politicas.set(nombre, opciones?.policy ?? 'standard');
      }
      return Promise.resolve();
    }
    getQueue(nombre: string): Promise<{ policy?: string } | null> {
      const politica = espiaPgBoss.politicas.get(nombre);
      return Promise.resolve(politica === undefined ? null : { policy: politica });
    }
    deleteQueue(nombre: string): Promise<void> {
      espiaPgBoss.borradas.push(nombre);
      espiaPgBoss.politicas.delete(nombre);
      return Promise.resolve();
    }
  }
  return { ...real, PgBoss: PgBossFalso };
});

afterEach(() => {
  fijarMotorJobs(null);
  delete process.env.JOBS_ACTIVOS;
  espiaPgBoss.politicas.clear();
  espiaPgBoss.creadas.length = 0;
  espiaPgBoss.borradas.length = 0;
});

describe('claveSerializacion', () => {
  it('combina cola + id de recurso (misma orden, misma cola → misma clave)', () => {
    const a = claveSerializacion(COLAS_JOBS.recalcularRutaOrden, 42);
    const b = claveSerializacion(COLAS_JOBS.recalcularRutaOrden, 42);
    expect(a).toBe(b);
    expect(a).toBe('rc-recalcular-ruta:42');
  });

  it('recursos distintos NO comparten clave (no se serializan entre sí)', () => {
    expect(claveSerializacion(COLAS_JOBS.recalcularRutaOrden, 1)).not.toBe(
      claveSerializacion(COLAS_JOBS.recalcularRutaOrden, 2),
    );
  });
});

describe('jobsActivos (guarda por entorno)', () => {
  it('activo por defecto; inactivo solo con JOBS_ACTIVOS="false"', () => {
    delete process.env.JOBS_ACTIVOS;
    expect(jobsActivos()).toBe(true);
    process.env.JOBS_ACTIVOS = 'false';
    expect(jobsActivos()).toBe(false);
    process.env.JOBS_ACTIVOS = 'true';
    expect(jobsActivos()).toBe(true);
  });
});

describe('encolarJob / registrarHandler sin motor (NO-OP seguro)', () => {
  it('encolarJob devuelve null cuando el motor no está arrancado (no lanza)', async () => {
    fijarMotorJobs(null);
    expect(motorJobs()).toBeNull();
    const id = await encolarJob(COLAS_JOBS.recalcularRutaOrden, 7, {
      idOrden: 7,
      idEmpresa: 1,
      motivo: 'generar',
    });
    expect(id).toBeNull();
  });

  it('registrarHandler es no-op (no lanza) cuando el motor no está arrancado', async () => {
    fijarMotorJobs(null);
    await expect(
      registrarHandler(COLAS_JOBS.recalcularRutaOrden, async () => {
        /* no se invoca: no hay motor */
      }),
    ).resolves.toBeUndefined();
  });
});

// ── La POLÍTICA de cada cola: lo que hace REAL la serialización por `singletonKey` ────────────────

/** Las colas que se encolan con `singletonKey` (o sea, las que pasan por `encolarJob`). */
const COLAS_SERIALIZADAS = (Object.values(COLAS_JOBS) as NombreColaJob[]).filter(
  (cola) => POLITICA_POR_COLA[cola] !== 'standard',
);

/**
 * Los `CREATE UNIQUE INDEX` que el pg-boss INSTALADO declara, leídos de su API pública
 * `getConstructionPlans()`. Se consulta a la librería en vez de repetir aquí lo que creemos que hace:
 * si una versión futura retira una política, esto lo ve.
 */
function indicesUnicosDePgBoss(): string[] {
  return [
    ...getConstructionPlans('pgboss').matchAll(/CREATE UNIQUE INDEX [\s\S]*?(?=\$cmd\$)/g),
  ].map((coincidencia) => coincidencia[0]);
}

/** El índice único que pg-boss crea para restringir `singleton_key` bajo una política, si existe. */
function indiceQueSerializa(politica: string): string | undefined {
  return indicesUnicosDePgBoss().find(
    (indice) => indice.includes('singleton_key') && indice.includes(`policy = '${politica}'`),
  );
}

describe('POLITICA_POR_COLA (la política es lo que serializa, no la clave)', () => {
  it('declara una política para TODAS las colas, sin huecos', () => {
    for (const cola of Object.values(COLAS_JOBS)) {
      expect(POLITICA_POR_COLA[cola], `la cola "${cola}" no declara política`).toBeDefined();
    }
    expect(Object.keys(POLITICA_POR_COLA).sort()).toEqual([...Object.values(COLAS_JOBS)].sort());
  });

  it('cada política declarada EXISTE en el pg-boss instalado', () => {
    for (const cola of Object.values(COLAS_JOBS)) {
      expect(Object.values(policies)).toContain(POLITICA_POR_COLA[cola]);
    }
  });

  it('las colas que se encolan con singletonKey son las del CPM y el refresco de KPIs', () => {
    // Los dos únicos `encolarJob` del sistema: `ruta-critica/rutaOrden.ts` + `autoAvance.ts` (CPM)
    // e `indicadores/kpis.ts` (refresco on-demand). Si alguien pasa una a `standard`, cae aquí Y
    // deja de compilar su llamada (`ColaSerializada`).
    expect(COLAS_SERIALIZADAS).toContain(COLAS_JOBS.recalcularRutaOrden);
    expect(COLAS_SERIALIZADAS).toContain(COLAS_JOBS.refrescarKpis);
  });

  it('⭐ pg-boss RESPALDA con un índice único sobre singleton_key la política de cada cola serializada', () => {
    // Ésta es la prueba que impide que la defensa vuelva a ser decorativa: no comprueba un nombre,
    // comprueba que la librería instalada instala el índice que restringe la clave.
    for (const cola of COLAS_SERIALIZADAS) {
      const politica = POLITICA_POR_COLA[cola];
      expect(
        indiceQueSerializa(politica),
        `pg-boss no restringe singleton_key bajo la política "${politica}" (cola "${cola}")`,
      ).toBeDefined();
    }
  });

  it('⭐ EN NEGATIVO: `standard` NO tiene índice único sobre singleton_key — por eso no sirve', () => {
    // El defecto original en una línea: la clave se guardaba y no restringía nada. Si un pg-boss
    // futuro le diera índice a `standard`, esto cae y habría que revisar todo este razonamiento.
    expect(indiceQueSerializa('standard')).toBeUndefined();
    expect(Object.values(policies)).toContain('standard'); // sigue existiendo: no es un typo
  });

  it('⭐ la política del CPM deja pasar UNO detrás del que corre (no descarta el evento)', () => {
    // `stately` indexa (name, STATE, singleton_key) → ≤1 por estado: uno activo + uno esperando.
    // `exclusive`/`short`/`singleton` NO llevan `state` en la clave y descartarían —o dejarían
    // correr— de una forma que perdería el disparo llegado a mitad de un recálculo. Si alguien
    // cambia la política por otra, esta aserción cae.
    const indice = indiceQueSerializa(POLITICA_POR_COLA[COLAS_JOBS.recalcularRutaOrden]);
    expect(indice).toMatch(/\(name,\s*state,\s*COALESCE\(singleton_key/);
    expect(indice).toMatch(/state <= 'active'/);
  });

  it('EN NEGATIVO: las colas de cron declaran `standard` a propósito y NO se serializan por clave', () => {
    // No usan `singletonKey`: el respaldo lo razona en `respaldo-bd.ts` (lo suyo es `expireInSeconds`
    // + el barrido) y el barrido de riesgo vive del throttle del cron. Si alguien les pusiera una
    // política "por si acaso", recrearía sus colas al arrancar sin ganar nada.
    expect(POLITICA_POR_COLA[COLAS_JOBS.respaldoBd]).toBe('standard');
    expect(POLITICA_POR_COLA[COLAS_JOBS.barridoRiesgoRc]).toBe('standard');
    expect(COLAS_SERIALIZADAS).not.toContain(COLAS_JOBS.respaldoBd);
    expect(COLAS_SERIALIZADAS).not.toContain(COLAS_JOBS.barridoRiesgoRc);
  });
});

describe('opcionesDeCola (política + extras, punto único)', () => {
  it('SIEMPRE lleva la política declarada, para toda cola', () => {
    for (const cola of Object.values(COLAS_JOBS)) {
      expect(opcionesDeCola(cola).policy).toBe(POLITICA_POR_COLA[cola]);
    }
  });

  it('el respaldo suma su ventana de expiración; el CPM NO la hereda', () => {
    expect(opcionesDeCola(COLAS_JOBS.respaldoBd).expireInSeconds).toBeGreaterThan(0);
    expect(opcionesDeCola(COLAS_JOBS.recalcularRutaOrden).expireInSeconds).toBeUndefined();
  });
});

// ── Conciliación de políticas al arrancar ────────────────────────────────────────────────────────

/**
 * Motor de colas de mentira: imita lo único que importa de pg-boss aquí — que `createQueue` sobre una
 * cola que YA existe NO cambia su política (el `ON CONFLICT DO NOTHING` real).
 */
function motorFalso(guardadas: Partial<Record<string, PoliticaCola>>): MotorColas & {
  creadas: { nombre: string; politica: string | undefined }[];
  borradas: string[];
} {
  const estado = { ...guardadas };
  const creadas: { nombre: string; politica: string | undefined }[] = [];
  const borradas: string[] = [];
  return {
    creadas,
    borradas,
    getQueue: (nombre) =>
      Promise.resolve(estado[nombre] === undefined ? null : { policy: estado[nombre] }),
    deleteQueue: (nombre) => {
      borradas.push(nombre);
      delete estado[nombre];
      return Promise.resolve();
    },
    createQueue: (nombre, opciones) => {
      creadas.push({ nombre, politica: opciones?.policy });
      estado[nombre] ??= (opciones?.policy ?? 'standard') as PoliticaCola; // ON CONFLICT DO NOTHING
      return Promise.resolve();
    },
  };
}

/** Estado "todo en orden": cada cola guardada con la política que declara. */
function guardadasCorrectas(): Partial<Record<string, PoliticaCola>> {
  return Object.fromEntries(
    Object.values(COLAS_JOBS).map((cola) => [cola, POLITICA_POR_COLA[cola]]),
  );
}

describe('conciliarPoliticasColas', () => {
  it('NO toca nada cuando lo guardado ya coincide con lo declarado', async () => {
    const motor = motorFalso(guardadasCorrectas());
    const log = vi.fn();
    await conciliarPoliticasColas(motor, log);
    expect(motor.borradas).toEqual([]);
    expect(motor.creadas).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it('recrea la cola que quedó con otra política (el caso de una base ya arrancada)', async () => {
    const estado = guardadasCorrectas();
    estado[COLAS_JOBS.recalcularRutaOrden] = 'standard'; // como está hoy en `prueba`
    const motor = motorFalso(estado);
    const log = vi.fn();

    await conciliarPoliticasColas(motor, log);

    expect(motor.borradas).toEqual([COLAS_JOBS.recalcularRutaOrden]);
    expect(motor.creadas).toEqual([
      { nombre: COLAS_JOBS.recalcularRutaOrden, politica: 'stately' },
    ]);
    // Y lo dice: recrear una cola tira sus jobs, no puede pasar en silencio.
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toContain(COLAS_JOBS.recalcularRutaOrden);
    expect(String(log.mock.calls[0]?.[0])).toContain('stately');
  });

  it('AVISA si tras recrearla la política sigue mal (no da por hecho que funcionó)', async () => {
    const motor = motorFalso({ ...guardadasCorrectas(), [COLAS_JOBS.refrescarKpis]: 'standard' });
    // Un motor que ignora la opción también al recrear: el fallo silencioso que se quiere detectar.
    const createQueueTerco: MotorColas['createQueue'] = (nombre) => {
      motor.creadas.push({ nombre, politica: undefined });
      return Promise.resolve();
    };
    const log = vi.fn();

    await conciliarPoliticasColas(
      {
        ...motor,
        createQueue: createQueueTerco,
        getQueue: () => Promise.resolve({ policy: 'standard' }),
      },
      log,
    );

    const mensajes = log.mock.calls.map((llamada) => String(llamada[0]));
    expect(mensajes.some((m) => m.includes('SIGUE con política'))).toBe(true);
  });

  it('NUNCA lanza y sigue con las demás colas si una falla', async () => {
    const estado = guardadasCorrectas();
    estado[COLAS_JOBS.recalcularRutaOrden] = 'standard';
    estado[COLAS_JOBS.refrescarKpis] = 'standard';
    const motor = motorFalso(estado);
    const log = vi.fn();
    const motorRoto: MotorColas = {
      ...motor,
      deleteQueue: (nombre) =>
        nombre === COLAS_JOBS.recalcularRutaOrden
          ? Promise.reject(new Error('la base parpadeó'))
          : motor.deleteQueue(nombre),
    };

    await expect(conciliarPoliticasColas(motorRoto, log)).resolves.toBeUndefined();

    // La que falló quedó registrada con su error…
    expect(log.mock.calls.some((l) => l[1] instanceof Error)).toBe(true);
    // …y la SIGUIENTE sí se concilió (el fallo de una no aborta el barrido).
    expect(motor.creadas).toEqual([{ nombre: COLAS_JOBS.refrescarKpis, politica: 'stately' }]);
  });
});

describe('iniciarMotorJobs (el cableado: sin esto, declarar la política sería decorativo)', () => {
  /** Corre `iniciarMotorJobs` con el doble de pg-boss y devuelve lo que registró en el log. */
  async function arrancarConColasGuardadas(
    guardadas: Record<string, string>,
  ): Promise<ReturnType<typeof vi.fn>> {
    for (const [cola, politica] of Object.entries(guardadas)) {
      espiaPgBoss.politicas.set(cola, politica);
    }
    const urlPrevia = process.env.DATABASE_URL;
    process.env.JOBS_ACTIVOS = 'true';
    process.env.DATABASE_URL = 'postgres://doble/no-se-conecta-a-nada';
    const log = vi.fn();
    try {
      await iniciarMotorJobs(log);
    } finally {
      if (urlPrevia === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = urlPrevia;
      }
    }
    return log;
  }

  it('crea las colas nuevas YA con su política declarada', async () => {
    await arrancarConColasGuardadas({}); // base virgen: ninguna cola existe
    for (const cola of Object.values(COLAS_JOBS)) {
      expect(espiaPgBoss.creadas).toContainEqual({
        nombre: cola,
        politica: POLITICA_POR_COLA[cola],
      });
      expect(espiaPgBoss.politicas.get(cola)).toBe(POLITICA_POR_COLA[cola]);
    }
    expect(espiaPgBoss.borradas).toEqual([]); // nada que conciliar
  });

  it('⭐ CONCILIA las colas que ya existían con otra política (el caso real de `prueba`)', async () => {
    // Así está hoy la base de `prueba`: las cuatro colas creadas cuando ninguna declaraba política.
    const comoEnPrueba = Object.fromEntries(
      Object.values(COLAS_JOBS).map((cola) => [cola, 'standard']),
    );
    await arrancarConColasGuardadas(comoEnPrueba);

    // Sólo se recrean las que de verdad cambian; las de cron ya estaban bien y se dejan en paz.
    expect(espiaPgBoss.borradas).toEqual([
      COLAS_JOBS.recalcularRutaOrden,
      COLAS_JOBS.refrescarKpis,
    ]);
    expect(espiaPgBoss.politicas.get(COLAS_JOBS.recalcularRutaOrden)).toBe('stately');
    expect(espiaPgBoss.politicas.get(COLAS_JOBS.refrescarKpis)).toBe('stately');
    expect(espiaPgBoss.politicas.get(COLAS_JOBS.respaldoBd)).toBe('standard');
    expect(espiaPgBoss.politicas.get(COLAS_JOBS.barridoRiesgoRc)).toBe('standard');
    // Y el motor quedó arriba: conciliar no puede costar el motor de jobs.
    expect(motorJobs()).not.toBeNull();
  });

  it('EN NEGATIVO: no recrea nada cuando las colas ya están como se declaran', async () => {
    const yaCorrectas = Object.fromEntries(
      Object.values(COLAS_JOBS).map((cola) => [cola, POLITICA_POR_COLA[cola] as string]),
    );
    await arrancarConColasGuardadas(yaCorrectas);
    expect(espiaPgBoss.borradas).toEqual([]);
  });
});

describe('encolarJob sólo admite colas que serializan (barrera de COMPILACIÓN)', () => {
  it('EN NEGATIVO: encolar en una cola `standard` NO compila', async () => {
    // La barrera vive en el tipo `ColaSerializada`. `@ts-expect-error` la vuelve verificable: si
    // alguien ensancha el parámetro de `encolarJob` a `NombreColaJob`, esta línea DEJA de dar error
    // y `tsc` falla por un `@ts-expect-error` sin uso. Así el guardarraíl no se puede quitar callado.
    // @ts-expect-error `respaldo-bd` declara `standard`: ahí una singletonKey no restringiría nada.
    const id = await encolarJob(COLAS_JOBS.respaldoBd, 0, { motivo: 'no debería compilar' });
    expect(id).toBeNull(); // el motor está inactivo; lo que se prueba es el error de tipo de arriba
  });
});

// ── GUARDIÁN DE PROSA: que el comentario no pueda volver a mentir ─────────────────────────────────

/**
 * El defecto que originó todo esto NO fue un `if` mal puesto: fue una FRASE que prometía una garantía
 * del motor que el motor no daba, con todos los gates en verde. Ningún typecheck, lint ni test de
 * comportamiento detecta eso — el código puede quedar impecable y la prosa mintiendo. Este guardián
 * es la única red posible: lee el FUENTE y exige que la prosa NOMBRE la política que la tabla
 * declara. (Misma familia que `receta-embudo.test.ts` y los guardianes de recetas: leer el código
 * real, no una copia de lo que creemos que dice.)
 *
 * Va en POSITIVO —"la prosa nombra lo que la tabla declara"— y no como lista negra de frases
 * prohibidas: así sigue sirviendo si mañana la política cambia a otra, en vez de quedarse cazando
 * una redacción concreta que ya nadie usa.
 */
describe('guardián: la prosa nombra la política que la tabla declara', () => {
  /**
   * DÓNDE vive la promesa en cada archivo. En `index.ts` y `cpm-job.ts` es la cabecera; en `kpis.ts`
   * la cabecera habla de tableros y la promesa está en el JSDoc de `encolarRefrescoKpis`, así que se
   * ancla a la función. (Que el ancla tenga que existir es parte del guardián: si alguien renombra
   * la función, esto falla ruidosamente en vez de dejar de vigilar en silencio.)
   */
  const LUGARES_DE_LA_PROMESA = [
    { ruta: './index.ts', ancla: null },
    { ruta: '../../dominio/ruta-critica/cpm-job.ts', ancla: null },
    {
      ruta: '../../dominio/indicadores/kpis.ts',
      ancla: 'export async function encolarRefrescoKpis',
    },
  ];

  /** El bloque `/** … *\/` que contiene la promesa: la cabecera, o el JSDoc que precede al ancla. */
  function bloqueDeLaPromesa(ruta: string, ancla: string | null): string {
    const fuente = readFileSync(new URL(ruta, import.meta.url), 'utf8');
    if (ancla === null) {
      const fin = fuente.indexOf('*/');
      expect(fin, `${ruta}: no tiene comentario de cabecera`).toBeGreaterThan(0);
      return fuente.slice(0, fin + 2);
    }
    const posAncla = fuente.indexOf(ancla);
    expect(posAncla, `${ruta}: ya no existe "${ancla}" (¿se renombró?)`).toBeGreaterThan(0);
    const inicio = fuente.lastIndexOf('/**', posAncla);
    expect(inicio, `${ruta}: "${ancla}" no lleva JSDoc delante`).toBeGreaterThan(0);
    return fuente.slice(inicio, fuente.indexOf('*/', inicio) + 2);
  }

  it('⭐ cada sitio que promete la serialización NOMBRA la política que la hace real', () => {
    const politica = POLITICA_POR_COLA[COLAS_JOBS.recalcularRutaOrden];
    for (const { ruta, ancla } of LUGARES_DE_LA_PROMESA) {
      expect(
        bloqueDeLaPromesa(ruta, ancla),
        `${ruta} promete serialización sin nombrar \`${politica}\`: o la prosa se quedó vieja, o ` +
          'describe una garantía que el código ya no da (que es EXACTAMENTE el defecto que este ' +
          'guardián existe para impedir).',
      ).toContain(`\`${politica}\``);
    }
  });

  it('la cabecera de `jobs/index.ts` nombra TODAS las políticas declaradas, no sólo una', () => {
    // Si mañana una cola pasa a otra política y la prosa sólo habla de la vieja, cae aquí.
    const cabecera = bloqueDeLaPromesa('./index.ts', null);
    for (const politica of new Set(Object.values(POLITICA_POR_COLA))) {
      expect(cabecera, `la cabecera no menciona \`${politica}\``).toContain(`\`${politica}\``);
    }
  });

  it('⭐ el CONTRATO PÚBLICO reconoce que `encolado:false` también significa "se dedupó"', () => {
    // El sitio más público del sistema: esta descripción viaja a `openapi.json` y al cliente
    // generado del frontend. Decía "false si el motor está inactivo" —cierto mientras la cola era
    // `standard`, FALSO desde que dedupa— y es la misma especie de defecto que el de la cabecera,
    // cometida dentro de su propio arreglo. No se le exige nombrar `stately` (el contrato habla el
    // idioma del negocio, no el de pg-boss): se le exige no callar la segunda causa.
    const contrato = readFileSync(
      new URL('../../contrato/esquemas/indicadores.ts', import.meta.url),
      'utf8',
    );
    const inicio = contrato.indexOf('export const esquemaRefrescoEncolado');
    expect(inicio, 'ya no existe `esquemaRefrescoEncolado` (¿se renombró?)').toBeGreaterThan(0);
    const bloque = contrato.slice(inicio, contrato.indexOf('export type RefrescoEncolado', inicio));
    expect(bloque, 'la descripción de `encolado` no menciona el dedup').toMatch(/dedup/i);
  });

  it('la cabecera dice que la clave SOLA no basta (lo que el comentario viejo callaba)', () => {
    const cabecera = bloqueDeLaPromesa('./index.ts', null);
    expect(cabecera).toContain('singletonKey');
    expect(cabecera).toContain('POLITICA_POR_COLA');
  });
});
