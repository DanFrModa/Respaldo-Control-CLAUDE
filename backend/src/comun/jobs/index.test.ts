/**
 * Tests UNITARIOS del motor de jobs (F5-E3) — la lógica SIN BD: construcción de la `singletonKey`
 * de serialización y el comportamiento NO-OP cuando el motor está inactivo/sin arrancar. El
 * transporte real de pg-boss (encolado, dedup, reintentos contra Postgres) se prueba en integración
 * / Railway, no aquí (no se levanta pg-boss en el unit ni en CI).
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  COLAS_JOBS,
  claveSerializacion,
  encolarJob,
  fijarMotorJobs,
  jobsActivos,
  motorJobs,
  registrarHandler,
} from './index.js';

afterEach(() => {
  fijarMotorJobs(null);
  delete process.env.JOBS_ACTIVOS;
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
