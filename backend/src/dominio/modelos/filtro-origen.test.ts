import { describe, expect, it, vi } from 'vitest';

import { esquemaModelosQuery } from '../../contrato/esquemas/modelo.js';
import type { Prisma } from '../../datos/index.js';
import { configR2DesdeEnv, crearClienteR2, crearServicioArchivos } from '../../comun/archivos.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { listarModelos } from './modelos.js';

/**
 * ⭐ V1-E8j (§Post-F9.134) — **LAS DOS PUERTAS DEL SERVIDOR**, probadas SIN Postgres.
 *
 * El default del filtro de `origen` vive en CUATRO sitios: el Zod del dominio
 * (`esquemaListarModelosDominio`), el del contrato (`esquemaModelosQuery`) y los `useState` del
 * catálogo y de la galería. Los dos del frontend los cubren sus pruebas de componente; **los dos
 * del servidor los cubren de verdad las de integración** (`nomenclatura.int.test.ts` y
 * `api/modelos/modelos.int.test.ts`), que listan modelos REALES contra Postgres.
 *
 * Esto es lo que se puede correr **sin base de datos**, y sirve para lo que las de integración no
 * pueden: quedar al alcance de cualquiera en cualquier momento. Mide **la FORMA de la consulta**
 * (mismo recurso que `etapas.rutas.test.ts` estrenó en V1-E8i): con un Prisma falso se captura el
 * `where` que el dominio arma y se comprueba que, sin filtro, **no lleva `origen`** — que es
 * exactamente lo que decide si Daniel ve o no el modelo que acaba de crear.
 *
 * ⚠️ Lo que este archivo **NO** prueba: que la pantalla no mande su propio `origen`. Ése era el
 * defecto real, y sólo lo cazan las pruebas de `ModelosPagina` y `GaleriaModelos`.
 */

/** Servicio de archivos real con credenciales falsas (firma local, sin red). */
function archivosDePrueba() {
  const config = configR2DesdeEnv({
    R2_ACCOUNT_ID: 'cuenta123',
    R2_ACCESS_KEY_ID: 'llave-falsa',
    R2_SECRET_ACCESS_KEY: 'secreto-falso',
    R2_BUCKET: 'control-v2-prueba',
  });
  return crearServicioArchivos({ cliente: crearClienteR2(config), bucket: config.bucket });
}

/**
 * Prisma FALSO que sólo sabe contestar el listado vacío, y que GUARDA el `where` con el que lo
 * consultaron. Devolver cero modelos es a propósito: así el listado corta antes de los agregados
 * (foto principal, tela, stock, costo) y la prueba se queda con lo único que mide.
 */
function prismaFalso() {
  const wheres: Prisma.ModeloWhereInput[] = [];
  const cliente = {
    modelo: {
      count: vi.fn((args: { where: Prisma.ModeloWhereInput }) => {
        wheres.push(args.where);
        return Promise.resolve(0);
      }),
      findMany: vi.fn((args: { where: Prisma.ModeloWhereInput }) => {
        wheres.push(args.where);
        return Promise.resolve([]);
      }),
    },
  };
  return { cliente, wheres };
}

const sesion = () => sesionDePrueba({ permisos: ['modelos.ver'] });

describe('el filtro de ORIGEN del listado de modelos (§Post-F9.134)', () => {
  it('PUERTA 1 (dominio): sin filtro, la consulta NO acota por origen', async () => {
    const { cliente, wheres } = prismaFalso();

    await listarModelos(sesion(), {}, { cliente: cliente as never }, archivosDePrueba());

    // Las dos consultas del listado (count + findMany) comparten el mismo `where`.
    expect(wheres).toHaveLength(2);
    for (const where of wheres) {
      // `origen` AUSENTE, no `origen: 'todos'`: 'todos' no es un valor de la columna.
      expect(where).not.toHaveProperty('origen');
      // Y lo que sí debe seguir estando (que el `where` no se vació de más).
      expect(where.activo).toBe(true);
    }
  });

  it('PUERTA 1 (dominio): pedir una sola cara SÍ acota', async () => {
    const { cliente, wheres } = prismaFalso();

    await listarModelos(
      sesion(),
      { origen: 'desarrollo' },
      { cliente: cliente as never },
      archivosDePrueba(),
    );

    expect(wheres[0]).toMatchObject({ origen: 'desarrollo' });
  });

  it('PUERTA 2 (contrato): una URL sin `origen` no pide sólo producción', () => {
    // Es la querystring tal como llega a `GET /api/modelos` cuando nadie manda el parámetro.
    expect(esquemaModelosQuery.parse({}).origen).toBe('todos');
    // Y el parámetro sigue sirviendo cuando sí viene.
    expect(esquemaModelosQuery.parse({ origen: 'produccion' }).origen).toBe('produccion');
  });
});
