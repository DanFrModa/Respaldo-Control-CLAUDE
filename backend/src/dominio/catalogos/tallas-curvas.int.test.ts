import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarCurva,
  actualizarTalla,
  crearCurva,
  crearTalla,
  desactivarCurva,
  desactivarTalla,
  listarCurvas,
  listarTallas,
  obtenerCurva,
  obtenerTalla,
  reactivarCurva,
  reactivarTalla,
} from './tallas-curvas.js';

let cliente: PrismaClient;

const sesionAdmin = () => sesionDePrueba({ permisos: ['tallas.ver', 'tallas.administrar'] });

const bd = () => ({ cliente });

/**
 * Crea una talla rápida para los tests de curvas; devuelve su id. Desde V1-E3r el `orden` NO se
 * fuerza a 0 (el contrato exige ≥1 y el 0 quedó como sentinela): omitirlo deja que el dominio lo
 * deduzca, que es el camino real del ETL y de la pantalla.
 */
async function nuevaTalla(etiqueta: string, orden?: number): Promise<number> {
  const talla = await crearTalla(
    sesionAdmin(),
    { etiqueta, ...(orden === undefined ? {} : { orden }) },
    bd(),
  );
  return talla.id;
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
});

describe('Catálogo Tallas (CRUD patrón, F1-E2 — global ADR-0007)', () => {
  describe('permisos en servidor (PLANMAESTRO §9.2)', () => {
    it('sin permiso no se puede ni leer ni escribir', async () => {
      const sinPermisos = sesionDePrueba();
      await expect(crearTalla(sinPermisos, { etiqueta: 'M' }, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
      await expect(listarTallas(sinPermisos, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({ permisos: ['tallas.ver'] });
      await expect(crearTalla(soloVer, { etiqueta: 'M' }, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
      await expect(listarTallas(soloVer, {}, bd())).resolves.toBeTruthy();
    });
  });

  describe('crear', () => {
    it('crea con etiqueta + orden y bitácora (A7)', async () => {
      const sesion = sesionAdmin();
      const talla = await crearTalla(sesion, { etiqueta: 'CH', orden: 2 }, bd());

      expect(talla.etiqueta).toBe('CH');
      expect(talla.orden).toBe(2);
      expect(talla.activo).toBe(true);

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Talla', idEntidad: String(talla.id), accion: 'CREAR' },
      });
      expect(bitacora.idUsuario).toBe(sesion.id);
    });

    /*
     * ⭐ V1-E3r (§Post-F9.81) — antes esta prueba decía "orden por omisión es 0", que es JUSTO el
     * hueco por el que se colaron las 94 tallas del Access (el ETL llama sin `orden`). Ahora, si
     * nadie lo da, el dominio lo DEDUCE de la etiqueta; sólo se queda en 0 lo que la escala no
     * reconoce.
     */
    it('sin `orden`, lo DEDUCE de la etiqueta (V1-E3r)', async () => {
      const xch = await crearTalla(sesionAdmin(), { etiqueta: 'XC' }, bd());
      const m = await crearTalla(sesionAdmin(), { etiqueta: 'M' }, bd());
      const doce = await crearTalla(sesionAdmin(), { etiqueta: '12' }, bd());

      expect(xch.orden).toBeGreaterThan(0);
      expect(m.orden).toBeGreaterThan(xch.orden);
      // Los números van ANTES que las letras (medido sobre el volcado real).
      expect(doce.orden).toBeLessThan(xch.orden);
    });

    it('una etiqueta que la escala NO reconoce se queda en el sentinela 0', async () => {
      const rara = await crearTalla(sesionAdmin(), { etiqueta: 'UT' }, bd());
      expect(rara.orden).toBe(0);
    });

    /*
     * 🔴 LA FRONTERA DEL `orden` MANUAL. El 0 es el sentinela ("nadie le puso orden") y el contrato
     * lo prohíbe como captura: si se aceptara, un 0 puesto a propósito sería indistinguible de uno
     * heredado y la reparación del seed lo pisaría. El 1 es el primer valor legítimo y MANDA sobre
     * la deducción.
     */
    it('`orden: 0` se RECHAZA (el 0 es sentinela, no un valor capturable)', async () => {
      await expect(
        crearTalla(sesionAdmin(), { etiqueta: 'M', orden: 0 }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('`orden: 1` se acepta y MANDA sobre la deducción', async () => {
      const talla = await crearTalla(sesionAdmin(), { etiqueta: 'XC', orden: 1 }, bd());
      expect(talla.orden).toBe(1);
    });

    it('normaliza la etiqueta (trim) y rechaza vacía → ErrorValidacion', async () => {
      const talla = await crearTalla(sesionAdmin(), { etiqueta: '  G  ' }, bd());
      expect(talla.etiqueta).toBe('G');
      await expect(crearTalla(sesionAdmin(), { etiqueta: '   ' }, bd())).rejects.toBeInstanceOf(
        ErrorValidacion,
      );
    });

    it('rechaza etiqueta duplicada, sin importar mayúsculas → ErrorConflicto', async () => {
      await crearTalla(sesionAdmin(), { etiqueta: 'M' }, bd());
      await expect(crearTalla(sesionAdmin(), { etiqueta: 'm' }, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
    });
  });

  describe('actualizar / desactivar / reactivar (borrado suave)', () => {
    it('cambia etiqueta y orden con bitácora del detalle', async () => {
      const sesion = sesionAdmin();
      const talla = await crearTalla(sesion, { etiqueta: 'M', orden: 1 }, bd());

      const actualizada = await actualizarTalla(sesion, { id: talla.id, orden: 5 }, bd());
      expect(actualizada.orden).toBe(5);

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Talla', idEntidad: String(talla.id), accion: 'MODIFICAR' },
      });
      expect(bitacora.datos).toMatchObject({ orden: { de: 1, a: 5 } });
    });

    /*
     * 🔴 RENOMBRAR RE-DEDUCE EL ORDEN (V1-E3r, §Post-F9.81 — defecto 2 de la ronda de corrección).
     *
     * `crearTalla` deduce el orden de la etiqueta; si el renombrado NO hiciera lo mismo, el defecto
     * que la etapa vino a matar entraría por otra puerta: `CH` (1040, zona de las letras) renombrada
     * a `3M` se quedaría **para siempre** ordenándose después de toda talla numérica, y el seed
     * jamás la repararía porque su orden ya no es el sentinela 0.
     *
     * Las cuatro pruebas de aquí abajo cubren las cuatro esquinas de la regla: se re-deduce cuando
     * el orden vigente lo puso la escala; se re-deduce cuando está en el sentinela; NO se re-deduce
     * cuando lo puso una persona; y un `orden` explícito en la misma llamada MANDA.
     */
    it('🔴 renombrar RE-DEDUCE el orden cuando lo había puesto la escala', async () => {
      const sesion = sesionAdmin();
      // Nace 'CH' → la escala le pone su peldaño de LETRA (por encima de 1000).
      const talla = await crearTalla(sesion, { etiqueta: 'CH' }, bd());
      expect(talla.orden).toBeGreaterThan(1000);

      const renombrada = await actualizarTalla(sesion, { id: talla.id, etiqueta: '3M' }, bd());

      // '3M' son 3 MESES: pertenece a la recta numérica, no a la de las letras.
      expect(renombrada.orden).toBe(3);
    });

    it('🔴 el orden re-deducido queda AUDITADO (nadie lo pidió: sin bitácora sería invisible)', async () => {
      const sesion = sesionAdmin();
      const talla = await crearTalla(sesion, { etiqueta: 'CH' }, bd());
      const ordenViejo = talla.orden;

      await actualizarTalla(sesion, { id: talla.id, etiqueta: '3M' }, bd());

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Talla', idEntidad: String(talla.id), accion: 'MODIFICAR' },
      });
      expect(bitacora.datos).toMatchObject({
        etiqueta: { de: 'CH', a: '3M' },
        orden: { de: ordenViejo, a: 3 },
        ordenRededucidoDeLaEtiqueta: true,
      });
    });

    it('renombrar RE-DEDUCE también desde el sentinela 0 (etiqueta que la escala no reconocía)', async () => {
      const sesion = sesionAdmin();
      const talla = await crearTalla(sesion, { etiqueta: 'UT' }, bd());
      expect(talla.orden).toBe(0);

      const renombrada = await actualizarTalla(sesion, { id: talla.id, etiqueta: '12' }, bd());
      expect(renombrada.orden).toBe(12);
    });

    it('renombrar hacia una etiqueta que la escala NO reconoce devuelve al sentinela 0', async () => {
      const sesion = sesionAdmin();
      const talla = await crearTalla(sesion, { etiqueta: 'CH' }, bd());

      // Quedarse con 1040 sería afirmar que "UT" va donde iba "CH": eso no se sabe.
      const renombrada = await actualizarTalla(sesion, { id: talla.id, etiqueta: 'UT' }, bd());
      expect(renombrada.orden).toBe(0);
    });

    it('🔴 renombrar NO pisa un orden que puso una PERSONA', async () => {
      const sesion = sesionAdmin();
      // 42 no es lo que la escala produce para 'CH' → lo puso alguien a mano.
      const talla = await crearTalla(sesion, { etiqueta: 'CH', orden: 42 }, bd());

      const renombrada = await actualizarTalla(sesion, { id: talla.id, etiqueta: '3M' }, bd());
      expect(renombrada.orden).toBe(42);
    });

    it('un `orden` explícito en la MISMA llamada manda sobre la re-deducción', async () => {
      const sesion = sesionAdmin();
      const talla = await crearTalla(sesion, { etiqueta: 'CH' }, bd());

      const renombrada = await actualizarTalla(
        sesion,
        { id: talla.id, etiqueta: '3M', orden: 7 },
        bd(),
      );
      expect(renombrada.orden).toBe(7);

      /*
       * ⚠️ Y la bitácora NO puede decir que hubo re-deducción: el 7 lo puso la persona. Sin esta
       * aserción, quitar la guarda `datos.orden === undefined` sobrevive —el `orden` explícito gana
       * igual, porque su rama va primero— y lo único que cambia es que el historial empieza a
       * atribuirle a la escala una decisión humana. Medido con mutación: sin esto, sobrevivía.
       */
      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Talla', idEntidad: String(talla.id), accion: 'MODIFICAR' },
      });
      expect(bitacora.datos).toMatchObject({ orden: { de: talla.orden, a: 7 } });
      expect(bitacora.datos).not.toHaveProperty('ordenRededucidoDeLaEtiqueta');
    });

    it('cambiar SÓLO el activo no toca el orden (no hay etiqueta nueva que deducir)', async () => {
      const sesion = sesionAdmin();
      const talla = await crearTalla(sesion, { etiqueta: 'CH' }, bd());

      const desactivada = await actualizarTalla(sesion, { id: talla.id, activo: false }, bd());
      expect(desactivada.orden).toBe(talla.orden);
    });

    it('sin cambios es idempotente: no escribe bitácora', async () => {
      const sesion = sesionAdmin();
      const talla = await crearTalla(sesion, { etiqueta: 'M', orden: 1 }, bd());
      const antes = await cliente.bitacora.count();
      await actualizarTalla(sesion, { id: talla.id, orden: 1 }, bd());
      expect(await cliente.bitacora.count()).toBe(antes);
    });

    it('desactiva una talla SIN uso y luego la reactiva', async () => {
      const sesion = sesionAdmin();
      const talla = await crearTalla(sesion, { etiqueta: 'M' }, bd());

      const desactivada = await desactivarTalla(sesion, talla.id, bd());
      expect(desactivada.activo).toBe(false);
      expect(await cliente.talla.count()).toBe(1);

      const reactivada = await reactivarTalla(sesion, talla.id, bd());
      expect(reactivada.activo).toBe(true);
    });

    it('desactivar dos veces → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const talla = await crearTalla(sesion, { etiqueta: 'M' }, bd());
      await desactivarTalla(sesion, talla.id, bd());
      await expect(desactivarTalla(sesion, talla.id, bd())).rejects.toBeInstanceOf(ErrorConflicto);
    });
  });

  describe('REGLA CLAVE (Gabriel): una talla en uso por una curva activa NO se puede desactivar', () => {
    it('desactivarTalla rechaza si la usa una curva activa → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const idM = await nuevaTalla('M');
      await crearCurva(sesion, { nombre: 'Básica', items: [idM] }, bd());

      await expect(desactivarTalla(sesion, idM, bd())).rejects.toBeInstanceOf(ErrorConflicto);
      // sigue activa: la operación no la tocó
      expect((await obtenerTalla(sesion, idM, bd())).activo).toBe(true);
    });

    it('actualizarTalla con activo:false también rechaza si está en uso activo', async () => {
      const sesion = sesionAdmin();
      const idM = await nuevaTalla('M');
      await crearCurva(sesion, { nombre: 'Básica', items: [idM] }, bd());

      await expect(
        actualizarTalla(sesion, { id: idM, activo: false }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('si la curva que la usa está DESACTIVADA, la talla SÍ se puede desactivar', async () => {
      const sesion = sesionAdmin();
      const idM = await nuevaTalla('M');
      const curva = await crearCurva(sesion, { nombre: 'Básica', items: [idM] }, bd());
      await desactivarCurva(sesion, curva.id, bd());

      const desactivada = await desactivarTalla(sesion, idM, bd());
      expect(desactivada.activo).toBe(false);
    });

    it('tras quitar la talla de la curva, ya se puede desactivar', async () => {
      const sesion = sesionAdmin();
      const idM = await nuevaTalla('M');
      const idG = await nuevaTalla('G');
      const curva = await crearCurva(sesion, { nombre: 'Básica', items: [idM, idG] }, bd());

      // Reescribe los items dejando solo G: M queda libre.
      await actualizarCurva(sesion, { id: curva.id, items: [idG] }, bd());
      const desactivada = await desactivarTalla(sesion, idM, bd());
      expect(desactivada.activo).toBe(false);
    });
  });

  describe('listar (búsqueda + orden + paginación EN SERVIDOR)', () => {
    it('busca, excluye inactivas por defecto y ordena por `orden`', async () => {
      const sesion = sesionAdmin();
      await crearTalla(sesion, { etiqueta: 'G', orden: 3 }, bd());
      await crearTalla(sesion, { etiqueta: 'CH', orden: 1 }, bd());
      const m = await crearTalla(sesion, { etiqueta: 'M', orden: 2 }, bd());
      await desactivarTalla(sesion, m.id, bd());

      expect((await listarTallas(sesion, {}, bd())).total).toBe(2);
      expect((await listarTallas(sesion, { incluirInactivos: true }, bd())).total).toBe(3);
      expect((await listarTallas(sesion, { busqueda: 'ch' }, bd())).total).toBe(1);

      const porOrden = await listarTallas(sesion, { incluirInactivos: true }, bd());
      expect(porOrden.datos.map((t) => t.etiqueta)).toEqual(['CH', 'M', 'G']);
    });
  });
});

describe('Catálogo Curvas (maestro-detalle ORDENADO, F1-E2 — D4)', () => {
  describe('crear (transacción A2: curva + items)', () => {
    it('crea con items y asigna la posición por el ORDEN del arreglo', async () => {
      const sesion = sesionAdmin();
      const idCH = await nuevaTalla('CH');
      const idM = await nuevaTalla('M');
      const idG = await nuevaTalla('G');

      const curva = await crearCurva(
        sesion,
        { nombre: 'Dama básica', items: [idG, idCH, idM] },
        bd(),
      );

      expect(curva.nombre).toBe('Dama básica');
      expect(curva.activo).toBe(true);
      // La salida viene ORDENADA por posición = orden del arreglo de entrada.
      expect(curva.items.map((i) => i.idTalla)).toEqual([idG, idCH, idM]);
      expect(curva.items.map((i) => i.posicion)).toEqual([0, 1, 2]);
      expect(curva.items.map((i) => i.talla.etiqueta)).toEqual(['G', 'CH', 'M']);

      // Los renglones puente existen (A2: todo o nada).
      expect(await cliente.curvaTallaItem.count({ where: { idCurva: curva.id } })).toBe(3);

      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Curva', idEntidad: String(curva.id), accion: 'CREAR' },
      });
    });

    it('exige al menos una talla (≥1): items vacíos → ErrorValidacion', async () => {
      await expect(
        crearCurva(sesionAdmin(), { nombre: 'Vacía', items: [] }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza tallas repetidas en la curva → ErrorValidacion', async () => {
      const idM = await nuevaTalla('M');
      await expect(
        crearCurva(sesionAdmin(), { nombre: 'Repetida', items: [idM, idM] }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza una talla inexistente → ErrorValidacion (y NO crea la curva: A2)', async () => {
      await expect(
        crearCurva(sesionAdmin(), { nombre: 'Fantasma', items: [999999] }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      expect(await cliente.curvaTalla.count({ where: { nombre: 'Fantasma' } })).toBe(0);
    });

    it('no se puede incluir una talla DESACTIVADA → ErrorValidacion', async () => {
      const sesion = sesionAdmin();
      const idM = await nuevaTalla('M');
      await desactivarTalla(sesion, idM, bd());
      await expect(
        crearCurva(sesion, { nombre: 'Con inactiva', items: [idM] }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza nombre duplicado, sin importar mayúsculas → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const idM = await nuevaTalla('M');
      await crearCurva(sesion, { nombre: 'Caballero', items: [idM] }, bd());
      await expect(
        crearCurva(sesion, { nombre: 'caballero', items: [idM] }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });
  });

  describe('actualizar (reemplaza/reordena el set de items en una transacción)', () => {
    it('reescribe el conjunto de items y reasigna posiciones', async () => {
      const sesion = sesionAdmin();
      const idCH = await nuevaTalla('CH');
      const idM = await nuevaTalla('M');
      const idG = await nuevaTalla('G');
      const curva = await crearCurva(sesion, { nombre: 'C', items: [idCH, idM] }, bd());

      const actualizada = await actualizarCurva(sesion, { id: curva.id, items: [idG, idCH] }, bd());
      expect(actualizada.items.map((i) => i.idTalla)).toEqual([idG, idCH]);
      expect(actualizada.items.map((i) => i.posicion)).toEqual([0, 1]);
      // M ya no está; el conteo refleja el nuevo set.
      expect(await cliente.curvaTallaItem.count({ where: { idCurva: curva.id } })).toBe(2);
    });

    it('reordena los mismos items (cambia posiciones) y deja bitácora', async () => {
      const sesion = sesionAdmin();
      const idCH = await nuevaTalla('CH');
      const idM = await nuevaTalla('M');
      const curva = await crearCurva(sesion, { nombre: 'C', items: [idCH, idM] }, bd());

      const reordenada = await actualizarCurva(sesion, { id: curva.id, items: [idM, idCH] }, bd());
      expect(reordenada.items.map((i) => i.idTalla)).toEqual([idM, idCH]);

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Curva', idEntidad: String(curva.id), accion: 'MODIFICAR' },
      });
      expect(bitacora.datos).toMatchObject({ items: [idM, idCH] });
    });

    it('mismo conjunto en el mismo orden es idempotente: no reescribe ni registra', async () => {
      const sesion = sesionAdmin();
      const idCH = await nuevaTalla('CH');
      const idM = await nuevaTalla('M');
      const curva = await crearCurva(sesion, { nombre: 'C', items: [idCH, idM] }, bd());
      const antes = await cliente.bitacora.count();

      await actualizarCurva(sesion, { id: curva.id, items: [idCH, idM] }, bd());
      expect(await cliente.bitacora.count()).toBe(antes);
    });

    it('cambia solo el nombre sin tocar items', async () => {
      const sesion = sesionAdmin();
      const idM = await nuevaTalla('M');
      const curva = await crearCurva(sesion, { nombre: 'Vieja', items: [idM] }, bd());

      const renombrada = await actualizarCurva(sesion, { id: curva.id, nombre: 'Nueva' }, bd());
      expect(renombrada.nombre).toBe('Nueva');
      expect(renombrada.items.map((i) => i.idTalla)).toEqual([idM]);
    });

    it('una edición de items con talla inexistente revierte TODO (A2)', async () => {
      const sesion = sesionAdmin();
      const idCH = await nuevaTalla('CH');
      const idM = await nuevaTalla('M');
      const curva = await crearCurva(sesion, { nombre: 'C', items: [idCH, idM] }, bd());

      await expect(
        actualizarCurva(sesion, { id: curva.id, items: [idCH, 999999] }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      // El set original quedó intacto (la tx hizo rollback del deleteMany).
      const sinCambios = await obtenerCurva(sesion, curva.id, bd());
      expect(sinCambios.items.map((i) => i.idTalla)).toEqual([idCH, idM]);
    });
  });

  describe('desactivar / reactivar (borrado suave)', () => {
    it('desactiva con bitácora DESACTIVAR; la curva y sus items siguen', async () => {
      const sesion = sesionAdmin();
      const idM = await nuevaTalla('M');
      const curva = await crearCurva(sesion, { nombre: 'C', items: [idM] }, bd());

      const desactivada = await desactivarCurva(sesion, curva.id, bd());
      expect(desactivada.activo).toBe(false);
      expect(await cliente.curvaTalla.count()).toBe(1);
      expect(await cliente.curvaTallaItem.count({ where: { idCurva: curva.id } })).toBe(1);

      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Curva', idEntidad: String(curva.id), accion: 'DESACTIVAR' },
      });
    });

    it('reactivar exige que las tallas de la curva sigan activas', async () => {
      const sesion = sesionAdmin();
      const idM = await nuevaTalla('M');
      const curva = await crearCurva(sesion, { nombre: 'C', items: [idM] }, bd());
      await desactivarCurva(sesion, curva.id, bd());
      // Con la curva apagada, la talla M ya se puede desactivar:
      await desactivarTalla(sesion, idM, bd());

      await expect(reactivarCurva(sesion, curva.id, bd())).rejects.toBeInstanceOf(ErrorValidacion);

      // Si reactivamos la talla primero, la curva sí se puede reactivar.
      await reactivarTalla(sesion, idM, bd());
      const reactivada = await reactivarCurva(sesion, curva.id, bd());
      expect(reactivada.activo).toBe(true);
    });
  });

  describe('obtener / listar', () => {
    it('obtener un id inexistente → ErrorNoEncontrado', async () => {
      await expect(obtenerCurva(sesionAdmin(), 9999, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
    });

    it('lista con búsqueda, excluye inactivas por defecto e incluye items', async () => {
      const sesion = sesionAdmin();
      const idM = await nuevaTalla('M');
      await crearCurva(sesion, { nombre: 'Dama', items: [idM] }, bd());
      const cab = await crearCurva(sesion, { nombre: 'Caballero', items: [idM] }, bd());
      await desactivarCurva(sesion, cab.id, bd());

      const activas = await listarCurvas(sesion, {}, bd());
      expect(activas.total).toBe(1);
      expect(activas.datos[0]?.items.map((i) => i.idTalla)).toEqual([idM]);

      expect((await listarCurvas(sesion, { incluirInactivos: true }, bd())).total).toBe(2);
      expect((await listarCurvas(sesion, { busqueda: 'dam' }, bd())).total).toBe(1);
    });
  });
});
