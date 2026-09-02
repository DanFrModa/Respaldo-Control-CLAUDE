/**
 * ⭐⭐ BANDEJA «Recetas por revisar» — **LA REJA DEL IMPORTE** (V1-E9p, §Post-F9.144(b)).
 *
 * 🔴 **Por qué este archivo nace ahora.** V1-E9p le añadió a la bandeja la columna `costoPrometido`
 * —*«la información que vendí»*, en palabras de Daniel— y la publicó bajo el permiso que abre la
 * bandeja, `modelos.ver`. Y **`modelos.ver` no se resta en ningún escalón de `prisma/seed.ts`**: la
 * tienen Ventas, Logística, Asistente y Secretarial, que son EXACTAMENTE los roles a los que se les
 * quitó `consultas.ver-importes` por decisión. El costo con el que se cerró la mesa les habría
 * llegado por la puerta de al lado.
 *
 * 🔑 **No es un juicio de diseño: es el mismo dato con dos rejas distintas.**
 * `desarrollo/negociacion.ts` publica esa MISMA columna como
 * `costoEstimado: verImportes ? … : null`, y `consultarMetaPrometida` —de esta misma etapa— exige
 * `consultas.ver-importes` para el mismo número. Aquí se cierra la tercera puerta.
 *
 * ⚠️ **Se oculta el IMPORTE, no la FILA**: quien no ve importes sigue viendo qué falta por revisar,
 * de qué padre salió y qué pedido está esperando. La cola es su trabajo; el precio no.
 *
 * El `cliente` de estas pruebas es un **doble que reparte por la SQL que recibe** (la del `COUNT` y
 * la de las filas), así que no puede pasar por construcción: si la consulta dejara de pedir la
 * columna, la fila llegaría vacía y las aserciones caerían.
 */
import { describe, expect, it } from 'vitest';

import { ErrorPermiso } from '../../comun/errores.js';
import type { ClavePermiso } from '../../contrato/index.js';
import { Prisma } from '../../datos/index.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { consultarRecetasPorRevisar } from './recetas-por-revisar.js';

/** Una fila cruda como la devolvería Postgres, con la meta que la mesa dejó guardada. */
function filaCruda(costoPrometido: number | null): Record<string, unknown> {
  return {
    idModelo: 812,
    codigo: 'CYA-26-71-001-01',
    descripcion: 'Sudadera sin cierre (negociada)',
    codigoPadre: 'CYA-26-71-001',
    versionDesarrollo: 1,
    revisionEstado: 'pendiente',
    revisionNota: null,
    creadoEn: new Date('2026-08-20T16:00:00.000Z'),
    cliente: 'C&A México',
    proyecto: 'Otoño-Invierno 26',
    fechaCompromiso: null,
    piezasPedidas: 1200n,
    costoPrometido: costoPrometido === null ? null : new Prisma.Decimal(costoPrometido),
  };
}

/**
 * Cliente de mentiras que **reparte según la SQL**: la consulta del `COUNT` recibe el total y la de
 * las filas recibe la fila. Si alguien invirtiera las dos consultas, esto se pone rojo en vez de
 * devolver algo plausible.
 */
function clienteFalso(costoPrometido: number | null): { cliente: never } {
  const cliente = {
    $queryRaw: (sql: Prisma.Sql) => {
      if (sql.text.includes('COUNT(*)')) {
        return Promise.resolve([{ total: 1n }]);
      }
      if (!sql.text.includes('"costoPrometido"')) {
        throw new Error('la consulta de las filas no pide la meta');
      }
      return Promise.resolve([filaCruda(costoPrometido)]);
    },
  };
  return { cliente: cliente as never };
}

const sesion = (permisos: ClavePermiso[]) => sesionDePrueba({ idEmpresaActiva: 1, permisos });

describe('consultarRecetasPorRevisar — el importe va tras la reja de importes', () => {
  it('⭐ CON `consultas.ver-importes` llega la meta', async () => {
    const pagina = await consultarRecetasPorRevisar(
      sesion(['modelos.ver', 'consultas.ver-importes']),
      {},
      clienteFalso(43),
    );
    expect(pagina.datos[0]?.costoPrometido).toBe(43);
  });

  it('⭐⭐ SIN `consultas.ver-importes` la meta llega en NULL, aunque la base la traiga', async () => {
    // 🔴 LA aserción del defecto: el doble devuelve 43 igual; lo que tiene que taparlo es el
    // DOMINIO. Si la ocultación se cayera, aquí saldría 43 y esta prueba moriría.
    const pagina = await consultarRecetasPorRevisar(sesion(['modelos.ver']), {}, clienteFalso(43));
    expect(pagina.datos[0]?.costoPrometido).toBeNull();
  });

  it('⭐⭐ …pero la FILA se sigue viendo entera: se oculta el precio, no el trabajo', async () => {
    // La pareja de la anterior. Sin ella, «esconder la fila» —que sería el arreglo fácil y
    // equivocado— pasaría la prueba de arriba y le quitaría a Ventas una cola que sí es suya.
    const pagina = await consultarRecetasPorRevisar(sesion(['modelos.ver']), {}, clienteFalso(43));
    expect(pagina.total).toBe(1);
    expect(pagina.datos[0]).toMatchObject({
      idModelo: 812,
      codigo: 'CYA-26-71-001-01',
      codigoPadre: 'CYA-26-71-001',
      cliente: 'C&A México',
      estado: 'pendiente',
      conPedido: true,
      piezasPedidas: 1200,
    });
  });

  it('y una versión sin mesa llega en null para todos (no es lo mismo, pero se ve igual)', async () => {
    const pagina = await consultarRecetasPorRevisar(
      sesion(['modelos.ver', 'consultas.ver-importes']),
      {},
      clienteFalso(null),
    );
    expect(pagina.datos[0]?.costoPrometido).toBeNull();
  });

  it('sin `modelos.ver` no se abre siquiera', async () => {
    await expect(
      consultarRecetasPorRevisar(sesion(['consultas.ver-importes']), {}, clienteFalso(43)),
    ).rejects.toThrow(ErrorPermiso);
  });
});
