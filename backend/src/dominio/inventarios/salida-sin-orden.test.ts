import { describe, expect, it } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { ORIGEN } from '../../comun/origenes.js';
import { CATALOGO_PERMISOS, type ClavePermiso } from '../../contrato/index.js';
import {
  PERFILES_ACCESO_TOTAL,
  SOLO_ADMINISTRADOR,
  TIPOS_MOVIMIENTO_A_SEMBRAR,
  definirRoles,
} from '../../../prisma/seed.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { registrarSalidaAvioSinOrden, type EntradaSalidaAvioSinOrden } from './avios.js';
import {
  registrarSalidaTelaColorSinOrden,
  type EntradaSalidaTelaColorSinOrden,
} from './partidas-telas.js';
import {
  CODIGO_TIPO_MOV_POR_CONCEPTO,
  PERMISO_SALIDA_SIN_ORDEN,
  exigirPermisoParaCancelarSalidaSinOrden,
  exigirPermisoSalidaSinOrden,
} from './salida-sin-orden.js';

/**
 * ⭐ LA SALIDA QUE NO ES POR OP (fila 0.104) — unit, SIN Postgres.
 *
 * Aquí se mide lo que es PURO: **quién puede** (que es el corazón de la fila, porque Daniel dijo
 * *«siempre autorizada sólo por mí. Nadie más»*) y la forma de la captura. Lo que necesita una base
 * de datos —que la existencia BAJE por el motor de kardex, que no se pueda dejar en negativo, que
 * cancelar deje el inverso sin borrar nada y que el alcance por empresa se respete— se mide en
 * `salida-sin-orden.int.test.ts`.
 *
 * 🔴 La prueba que más importa es la de «`.mover` NO basta»: es exactamente el hueco que la fila
 * vino a cerrar, y el que se abriría solo si algún día alguien "simplificara" reusando el permiso
 * de los ajustes.
 */

/** Quien mueve inventario TODOS LOS DÍAS: tiene las dos llaves de kardex… y ninguna más. */
const PERMISOS_MOVER: ClavePermiso[] = [
  'inventario-telas.ver',
  'inventario-telas.mover',
  'inventario-avios.ver',
  'inventario-avios.mover',
];

const sesionSoloMover = () => sesionDePrueba({ permisos: PERMISOS_MOVER });
const sesionConLlave = () =>
  sesionDePrueba({ permisos: [...PERMISOS_MOVER, PERMISO_SALIDA_SIN_ORDEN] });

const salidaTela: EntradaSalidaTelaColorSinOrden = {
  concepto: 'devolucion-proveedor',
  idAlmacen: 1,
  fecha: '2026-09-05',
  motivo: 'Devolución al proveedor de la factura 8842',
  lineas: [{ idTelaColor: 1, cantidad: 25 }],
};

const salidaAvio: EntradaSalidaAvioSinOrden = {
  concepto: 'venta',
  idAlmacen: 1,
  fecha: '2026-09-05',
  motivo: 'Venta de cierres descontinuados',
  lineas: [{ idAvio: 1, cantidad: 500 }],
};

describe('salida sin orden — la llave es de Daniel (A4, deny-by-default)', () => {
  it('⭐ TELA: `inventario-telas.mover` NO basta — hace falta el permiso propio', async () => {
    await expect(
      registrarSalidaTelaColorSinOrden(sesionSoloMover(), salidaTela),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('⭐ AVÍO: `inventario-avios.mover` NO basta — hace falta el permiso propio', async () => {
    await expect(registrarSalidaAvioSinOrden(sesionSoloMover(), salidaAvio)).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('la sesión SIN nada tampoco pasa (ni tela ni avío)', async () => {
    const nadie = sesionDePrueba({ permisos: [] });
    await expect(registrarSalidaTelaColorSinOrden(nadie, salidaTela)).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
    await expect(registrarSalidaAvioSinOrden(nadie, salidaAvio)).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('el permiso se exige ANTES de mirar la captura: con basura, sigue siendo 403 y no 400', async () => {
    // Si el orden estuviera al revés, a quien no puede se le diría «te falta el motivo» — y de
    // paso se le confirmaría que la pantalla existe. Deny-by-default también en el mensaje.
    await expect(
      registrarSalidaTelaColorSinOrden(sesionSoloMover(), {
        ...salidaTela,
        motivo: '',
        lineas: [],
      }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('`exigirPermisoSalidaSinOrden` deja pasar a quien SÍ trae la llave', () => {
    expect(() => {
      exigirPermisoSalidaSinOrden(sesionConLlave());
    }).not.toThrow();
  });
});

/**
 * Un `tx` de mentira que sólo sabe leer movimientos por id, para ejercitar el RECORRIDO de la
 * cadena de inversos sin base de datos. `leidos` deja ver CUÁNTAS veces se consultó: así se puede
 * afirmar que un movimiento que no es una cancelación **no cuesta ninguna consulta**.
 */
function txDeMentira(
  porId: Record<number, { origenTipo: string | null; idMovimientoInverso: number | null }>,
) {
  const leidos: number[] = [];
  const tx = {
    movimiento: {
      findUnique: ({ where }: { where: { id: number } }) => {
        leidos.push(where.id);
        return Promise.resolve(porId[where.id] ?? null);
      },
    },
  };
  return {
    tx: tx as unknown as Parameters<typeof exigirPermisoParaCancelarSalidaSinOrden>[0],
    leidos,
  };
}

describe('salida sin orden — cancelar pide la MISMA llave (y sólo para estas salidas)', () => {
  const salidaSinOrden = { origenTipo: ORIGEN.salidaSinOrden, idMovimientoInverso: null };

  it('⭐ cancelar una salida sin orden con sólo `.mover` se rechaza', async () => {
    const { tx } = txDeMentira({});
    await expect(
      exigirPermisoParaCancelarSalidaSinOrden(tx, sesionSoloMover(), salidaSinOrden),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('con la llave del dueño, se puede cancelar', async () => {
    const { tx } = txDeMentira({});
    await expect(
      exigirPermisoParaCancelarSalidaSinOrden(tx, sesionConLlave(), salidaSinOrden),
    ).resolves.toBeUndefined();
  });

  it('NO estorba a las cancelaciones normales: otro origen (o ninguno) pasa con `.mover`, y sin consultar nada', async () => {
    for (const origen of [ORIGEN.movimientoManual, ORIGEN.salidaTelaOrden, ORIGEN.traspaso, null]) {
      const { tx, leidos } = txDeMentira({});
      await expect(
        exigirPermisoParaCancelarSalidaSinOrden(tx, sesionSoloMover(), {
          origenTipo: origen,
          idMovimientoInverso: null,
        }),
      ).resolves.toBeUndefined();
      expect(leidos, 'una cancelación normal no debería costar consultas').toEqual([]);
    }
  });

  it('⭐ SIGUE LA CADENA: el inverso de una salida sin orden también pide la llave', async () => {
    // El inverso nace con `origenTipo = cancelacion` y apunta al original por
    // `idMovimientoInverso`. Mirando sólo el movimiento de enfrente, esta puerta quedaba abierta.
    const { tx, leidos } = txDeMentira({
      7: { origenTipo: ORIGEN.salidaSinOrden, idMovimientoInverso: null },
    });
    await expect(
      exigirPermisoParaCancelarSalidaSinOrden(tx, sesionSoloMover(), {
        origenTipo: ORIGEN.cancelacion,
        idMovimientoInverso: 7,
      }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    expect(leidos).toEqual([7]);
  });

  it('y la sigue VARIOS eslabones (cancelar la cancelación de la cancelación)', async () => {
    const { tx } = txDeMentira({
      9: { origenTipo: ORIGEN.cancelacion, idMovimientoInverso: 8 },
      8: { origenTipo: ORIGEN.salidaSinOrden, idMovimientoInverso: null },
    });
    await expect(
      exigirPermisoParaCancelarSalidaSinOrden(tx, sesionSoloMover(), {
        origenTipo: ORIGEN.cancelacion,
        idMovimientoInverso: 9,
      }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('la cadena de un AJUSTE normal termina sin pedir nada', async () => {
    const { tx } = txDeMentira({
      3: { origenTipo: ORIGEN.movimientoManual, idMovimientoInverso: null },
    });
    await expect(
      exigirPermisoParaCancelarSalidaSinOrden(tx, sesionSoloMover(), {
        origenTipo: ORIGEN.cancelacion,
        idMovimientoInverso: 3,
      }),
    ).resolves.toBeUndefined();
  });

  it('un CICLO en los datos no cuelga el servidor, y falla CERRADO', async () => {
    // El enlace es un dato, no una garantía del esquema. Sin corte, un ciclo sería un bucle
    // infinito dentro de una transacción abierta; el conjunto de visitados lo detecta al
    // reencontrar el primer id. Y como la cadena NO tiene origen, es imposible saber qué se está
    // deshaciendo: ante la duda, en una guarda se pide la llave.
    const { tx, leidos } = txDeMentira({
      1: { origenTipo: ORIGEN.cancelacion, idMovimientoInverso: 2 },
      2: { origenTipo: ORIGEN.cancelacion, idMovimientoInverso: 1 },
    });
    await expect(
      exigirPermisoParaCancelarSalidaSinOrden(tx, sesionSoloMover(), {
        origenTipo: ORIGEN.cancelacion,
        idMovimientoInverso: 1,
      }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    expect(leidos.length, 'el ciclo se corta en cuanto se repite un id').toBeLessThan(5);
  });

  /**
   * Encadena `n` cancelaciones y devuelve el mapa: `n` → `n-1` → … → 1 → `origenDelFondo`.
   * Cancelar el eslabón `n` obliga a recorrer los `n` para llegar al fondo.
   */
  function cadenaDeCancelaciones(
    n: number,
    origenDelFondo: string | null,
  ): Record<number, { origenTipo: string | null; idMovimientoInverso: number | null }> {
    const porId: Record<number, { origenTipo: string | null; idMovimientoInverso: number | null }> =
      { 1: { origenTipo: origenDelFondo, idMovimientoInverso: null } };
    for (let i = 2; i <= n; i += 1) {
      porId[i] = { origenTipo: ORIGEN.cancelacion, idMovimientoInverso: i - 1 };
    }
    return porId;
  }

  it('🔴 NINGUNA profundidad deja pasar a `.mover`: la guarda no falla ABIERTA (3ª ronda)', async () => {
    // ⚠️ EL DEFECTO QUE ESTA PRUEBA CIERRA. El recorrido llevaba un tope de 20 eslabones y, **al
    // agotarse, salía del bucle sin exigir nada**. El reviewer lo midió: «PROFUNDIDAD EN QUE
    // `.mover` YA PUEDE CANCELAR = 20». O sea, la función que existe para pedir la llave dejaba de
    // pedirla justo cuando la cadena se hacía larga — un fail-open en una guarda de seguridad.
    //
    // Se barre bien pasado el tope viejo, y a CADA profundidad: si alguien vuelve a meter un corte
    // por conteo, esta prueba nombra el número exacto en que empezó a fallar.
    const profundidadesQuePasaron: number[] = [];
    for (let profundidad = 1; profundidad <= 40; profundidad += 1) {
      const { tx } = txDeMentira(cadenaDeCancelaciones(profundidad, ORIGEN.salidaSinOrden));
      const veredicto = await exigirPermisoParaCancelarSalidaSinOrden(
        tx,
        sesionSoloMover(),
        // Cancelar el eslabón de más arriba: hay que recorrer TODA la cadena hasta el fondo.
        { origenTipo: ORIGEN.cancelacion, idMovimientoInverso: profundidad },
      ).then(
        () => 'PASÓ' as const,
        (error: unknown) => (error instanceof ErrorPermiso ? ('rechazó' as const) : 'otro-error'),
      );
      if (veredicto !== 'rechazó') profundidadesQuePasaron.push(profundidad);
    }
    expect(
      profundidadesQuePasaron,
      'a NINGUNA profundidad puede un `.mover` deshacer una salida sin orden',
    ).toEqual([]);
  });

  it('…y sin meter una falsa negación: una cadena LARGA de un ajuste normal sigue pasando', async () => {
    // La otra mitad del arreglo, y la razón de no haber puesto «fail-closed al agotar»: 25
    // cancelaciones encadenadas de un movimiento manual no tienen nada que ver con esta fila, y
    // quien sólo trae `.mover` tiene que poder deshacerlas. Un tope que fallara cerrado habría
    // cambiado un agujero por un bloqueo.
    const { tx } = txDeMentira(cadenaDeCancelaciones(25, ORIGEN.movimientoManual));
    await expect(
      exigirPermisoParaCancelarSalidaSinOrden(tx, sesionSoloMover(), {
        origenTipo: ORIGEN.cancelacion,
        idMovimientoInverso: 25,
      }),
    ).resolves.toBeUndefined();
  });

  it('un ESLABÓN ROTO (apunta a un movimiento que no existe) también falla CERRADO', async () => {
    // Hoy inalcanzable —el enlace lo escribe sólo el motor y cancelar NUNCA borra (D3)—, pero es
    // la misma decisión de diseño que el ciclo: sin origen no se puede decidir, así que se pide la
    // llave en vez de dejar pasar.
    const { tx } = txDeMentira({
      5: { origenTipo: ORIGEN.cancelacion, idMovimientoInverso: 404 },
    });
    await expect(
      exigirPermisoParaCancelarSalidaSinOrden(tx, sesionSoloMover(), {
        origenTipo: ORIGEN.cancelacion,
        idMovimientoInverso: 5,
      }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('y el DUEÑO sí puede en todos esos casos raros (la llave abre, no sólo cierra)', async () => {
    const ciclo = txDeMentira({
      1: { origenTipo: ORIGEN.cancelacion, idMovimientoInverso: 2 },
      2: { origenTipo: ORIGEN.cancelacion, idMovimientoInverso: 1 },
    });
    await expect(
      exigirPermisoParaCancelarSalidaSinOrden(ciclo.tx, sesionConLlave(), {
        origenTipo: ORIGEN.cancelacion,
        idMovimientoInverso: 1,
      }),
    ).resolves.toBeUndefined();
    const roto = txDeMentira({});
    await expect(
      exigirPermisoParaCancelarSalidaSinOrden(roto.tx, sesionConLlave(), {
        origenTipo: ORIGEN.cancelacion,
        idMovimientoInverso: 404,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('salida sin orden — la captura (con la llave puesta)', () => {
  it('TELA: rechaza renglones vacíos', async () => {
    await expect(
      registrarSalidaTelaColorSinOrden(sesionConLlave(), { ...salidaTela, lineas: [] }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('AVÍO: rechaza renglones vacíos', async () => {
    await expect(
      registrarSalidaAvioSinOrden(sesionConLlave(), { ...salidaAvio, lineas: [] }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('⭐ el MOTIVO es obligatorio: una salida sin orden tiene que decir por qué existe', async () => {
    await expect(
      registrarSalidaTelaColorSinOrden(sesionConLlave(), { ...salidaTela, motivo: '  ' }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    await expect(
      registrarSalidaAvioSinOrden(sesionConLlave(), { ...salidaAvio, motivo: 'x' }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('el CONCEPTO es un enum cerrado: no se cuela una causa inventada', async () => {
    await expect(
      registrarSalidaTelaColorSinOrden(sesionConLlave(), {
        ...salidaTela,
        // @ts-expect-error — a propósito: el contrato sólo admite los tres conceptos.
        concepto: 'regalo',
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('AVÍO: no se repite el mismo avío en dos renglones', async () => {
    await expect(
      registrarSalidaAvioSinOrden(sesionConLlave(), {
        ...salidaAvio,
        lineas: [
          { idAvio: 1, cantidad: 10 },
          { idAvio: 1, cantidad: 5 },
        ],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

describe('salida sin orden — las decisiones escritas', () => {
  it('⭐ el permiso existe en el catálogo y es de su propio módulo', () => {
    const definicion = CATALOGO_PERMISOS.find((p) => p.clave === PERMISO_SALIDA_SIN_ORDEN);
    expect(definicion, `${PERMISO_SALIDA_SIN_ORDEN} no está en el catálogo`).toBeDefined();
    // El módulo propio es media fila: si mañana alguien lo mueve a `inventario-telas`, el permiso
    // se mezcla en la pantalla de roles con el `.mover` que lleva medio organigrama.
    expect(definicion?.modulo).toBe('salida-material');
  });

  it('cada concepto tiene su tipo de movimiento, y devolución ≠ venta', () => {
    expect(CODIGO_TIPO_MOV_POR_CONCEPTO['devolucion-proveedor']).toBe('devolucion-proveedor');
    expect(CODIGO_TIPO_MOV_POR_CONCEPTO.venta).toBe('venta-material');
    // «Otra causa» NO estrena tipo: reusa el «Otras Salidas» de los 19 canónicos del viejo.
    expect(CODIGO_TIPO_MOV_POR_CONCEPTO.otro).toBe('otras-salidas');
    const codigos = Object.values(CODIGO_TIPO_MOV_POR_CONCEPTO);
    expect(
      new Set(codigos).size,
      'dos conceptos comparten tipo: el kardex no podría distinguirlos',
    ).toBe(codigos.length);
  });
});

describe('⛔ el SEED siembra lo que la guarda exige (la cicatriz del despliegue)', () => {
  // 🔴 POR QUÉ ESTAS TRES. Una fila del proyecto se rechazó **por el despliegue, no por el
  // código**: la siembra no creaba algo que la guarda pedía, así que en `prueba` la función habría
  // rechazado SIEMPRE. Todo lo de esta fila que se resuelve por NOMBRE contra la base —el permiso
  // y los tres tipos de movimiento— se cruza aquí a máquina contra el seed, no a ojo.

  it('⭐ los TRES tipos de movimiento del mapeo están en la lista que el seed siembra', () => {
    const sembrados = new Set(TIPOS_MOVIMIENTO_A_SEMBRAR.map((t) => t.codigo));
    const faltantes = Object.values(CODIGO_TIPO_MOV_POR_CONCEPTO).filter((c) => !sembrados.has(c));
    expect(
      faltantes,
      `El dominio resuelve estos tipos por código y el seed NO los siembra: ${faltantes.join(', ')}. ` +
        `En "prueba" la salida sin orden nacería muerta (ErrorValidacion "re-sembrar") sin que ` +
        `ninguna prueba de dominio lo cazara.`,
    ).toEqual([]);
  });

  it('los dos tipos NUEVOS son de dirección SALIDA (sacar material no puede sumar)', () => {
    for (const codigo of ['devolucion-proveedor', 'venta-material', 'otras-salidas']) {
      const tipo = TIPOS_MOVIMIENTO_A_SEMBRAR.find((t) => t.codigo === codigo);
      expect(tipo, `${codigo} no está sembrado`).toBeDefined();
      expect(tipo?.direccion, `${codigo} no es una salida`).toBe('salida');
    }
  });

  it('⭐ «NADIE MÁS»: el permiso es del administrador y NINGÚN perfil operativo lo otorga', () => {
    // Daniel, 3-sep-2026: *«siempre autorizada sólo por mí. Nadie más»*. `SOLO_ADMINISTRADOR` es
    // la forma de decirlo en el seed: lo llevan `Administrador` y `AdministracionDireccion` (los
    // niveles 1 y 20 del viejo, que tienen el catálogo entero) y nadie más lo nombra.
    const declarado = SOLO_ADMINISTRADOR.find((e) => e.clave === PERMISO_SALIDA_SIN_ORDEN);
    expect(
      declarado,
      `${PERMISO_SALIDA_SIN_ORDEN} no está en SOLO_ADMINISTRADOR: sin eso, o no lo tiene nadie o ` +
        `alguien acabará repartiéndolo`,
    ).toBeDefined();

    const total: readonly string[] = PERFILES_ACCESO_TOTAL;
    const conElPermiso = definirRoles()
      .filter((rol) => !total.includes(rol.nombre))
      .filter((rol) => (rol.permisos as string[]).includes(PERMISO_SALIDA_SIN_ORDEN))
      .map((rol) => rol.nombre);
    expect(
      conElPermiso,
      `Estos perfiles llevan ${PERMISO_SALIDA_SIN_ORDEN}: ${conElPermiso.join(', ')}. Daniel lo ` +
        `reservó para él: «siempre autorizada sólo por mí. Nadie más».`,
    ).toEqual([]);

    // Y los dos de acceso total SÍ lo llevan (lo toman con `[...CLAVES_PERMISO]`): si no,
    // la función no la podría usar ni el dueño.
    for (const nombre of PERFILES_ACCESO_TOTAL) {
      const rol = definirRoles().find((r) => r.nombre === nombre);
      expect(
        (rol?.permisos ?? []) as string[],
        `${nombre} no lleva ${PERMISO_SALIDA_SIN_ORDEN}`,
      ).toContain(PERMISO_SALIDA_SIN_ORDEN);
    }
  });
});
