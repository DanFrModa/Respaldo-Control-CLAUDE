/**
 * Tests de integración del motor de KARDEX (F3-E1, ADR-0010). Postgres efímero (testcontainers).
 *
 * Cubre lo que la ficha exige: entrada, salida, traspaso atómico (si falla a la mitad no deja
 * nada — A2), inverso (cancelación), folio concurrente que no choca (A3), costoUnit NULL en F3
 * (D1/D2), dos renglones del mismo artículo suman bien en la vista (nit #3), y el traspaso no
 * cambia la existencia TOTAL y mueve la cantidad de origen a destino (nit #1).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  Almacen,
  Color,
  Empresa,
  Modelo,
  PrismaClient,
  Talla,
  TipoMovimientoInventario,
} from '../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../pruebas/contexto.js';
import { sesionDePrueba } from '../pruebas/sesiones.js';
import { ErrorConflicto, ErrorValidacion } from './errores.js';
import {
  bloquearArticuloPt,
  cancelarMovimientoPt,
  existenciaPtBloqueada,
  registrarMovimientoPt,
  registrarTraspasoPt,
} from './kardex.js';
import { ORIGEN } from './origenes.js';
import { enTransaccion } from './transaccion.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let colorRojo: Color;
let tallaM: Talla;
let entradaInicial: TipoMovimientoInventario;
let salidaCliente: TipoMovimientoInventario;
let traspasoSalida: TipoMovimientoInventario; // dirección salida (pata de origen del traspaso)
let traspasoEntrada: TipoMovimientoInventario; // dirección entrada (pata de destino del traspaso)
let traspasoTipo: TipoMovimientoInventario; // dirección 'traspaso' (NO debe usarse en mov. simple)
let almPrimeras: Almacen;
let almTransito: Almacen;

const sesion = () => sesionDePrueba({ idEmpresaActiva: empresa.id });
const bd = () => ({ cliente });

/** Suma de la vista existencia_pt para un artículo×almacén (TOTAL sobre todos los buckets de orden,
 * F6-E2: la vista ahora agrega por …×ORDEN×almacén, así que se SUMA sobre las órdenes). */
async function existenciaVista(idAlmacen: number): Promise<number> {
  const filas = await cliente.$queryRaw<{ existencia: bigint | null }[]>`
    SELECT COALESCE(SUM(existencia), 0)::bigint AS existencia FROM existencia_pt
    WHERE id_modelo = ${modelo.id} AND id_color = ${colorRojo.id}
      AND id_talla = ${tallaM.id} AND id_almacen = ${idAlmacen}
  `;
  return Number(filas[0]?.existencia ?? 0n);
}

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  empresa = await crearEmpresaPrueba(cliente);
  modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 1 } });
  almPrimeras = await cliente.almacen.create({ data: { nombre: 'Primeras', tipo: 'PT' } });
  almTransito = await cliente.almacen.create({ data: { nombre: 'Tránsito', tipo: 'PT' } });
  entradaInicial = await cliente.tipoMovimientoInventario.create({
    data: { codigo: 'inventario-inicial', nombre: 'Inventario Inicial', direccion: 'entrada' },
  });
  salidaCliente = await cliente.tipoMovimientoInventario.create({
    data: { codigo: 'entrega-cliente', nombre: 'Entrega a Cliente', direccion: 'salida' },
  });
  traspasoSalida = await cliente.tipoMovimientoInventario.create({
    data: { codigo: 'salida-maquilero', nombre: 'Salida a Maquilero', direccion: 'salida' },
  });
  traspasoEntrada = await cliente.tipoMovimientoInventario.create({
    data: { codigo: 'otras-entradas', nombre: 'Otras Entradas', direccion: 'entrada' },
  });
  traspasoTipo = await cliente.tipoMovimientoInventario.create({
    data: {
      codigo: 'transferencia-almacenes',
      nombre: 'Transferencia entre almacenes',
      direccion: 'traspaso',
    },
  });
});

describe('Motor de kardex PT (F3-E1, D3/ADR-0010)', () => {
  describe('registrarMovimientoPt', () => {
    it('una ENTRADA suma a la existencia y deja costoUnit NULL (D1/D2)', async () => {
      const mov = await registrarMovimientoPt(
        sesion(),
        {
          idEmpresa: empresa.id,
          idTipoMov: entradaInicial.id,
          idAlmacen: almPrimeras.id,
          fecha: new Date('2026-06-17'),
          origenTipo: ORIGEN.movimientoManual,
          lineas: [
            { idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 10 },
          ],
        },
        bd(),
      );

      expect(mov.folio).toBe(1n);
      expect(await existenciaVista(almPrimeras.id)).toBe(10);

      // costoUnit NULL en TODA F3 (política del ADR §4).
      const det = await cliente.movimientoDetPt.findFirstOrThrow({
        where: { idMovimiento: mov.id },
      });
      expect(det.costoUnit).toBeNull();

      // Bitácora del movimiento (A7).
      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Movimiento', idEntidad: String(mov.id), accion: 'CREAR' },
      });
    });

    it('una SALIDA resta a la existencia', async () => {
      await registrarMovimientoPt(
        sesion(),
        {
          idEmpresa: empresa.id,
          idTipoMov: entradaInicial.id,
          idAlmacen: almPrimeras.id,
          fecha: new Date(),
          origenTipo: ORIGEN.movimientoManual,
          lineas: [
            { idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 10 },
          ],
        },
        bd(),
      );
      await registrarMovimientoPt(
        sesion(),
        {
          idEmpresa: empresa.id,
          idTipoMov: salidaCliente.id,
          idAlmacen: almPrimeras.id,
          fecha: new Date(),
          origenTipo: ORIGEN.entregaCliente,
          lineas: [{ idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 4 }],
        },
        bd(),
      );
      expect(await existenciaVista(almPrimeras.id)).toBe(6);
    });

    it('NIT #3: dos renglones del MISMO artículo en un movimiento suman bien en la vista', async () => {
      await registrarMovimientoPt(
        sesion(),
        {
          idEmpresa: empresa.id,
          idTipoMov: entradaInicial.id,
          idAlmacen: almPrimeras.id,
          fecha: new Date(),
          origenTipo: ORIGEN.movimientoManual,
          lineas: [
            { idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 7 },
            { idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 5 },
          ],
        },
        bd(),
      );
      // Sin @@unique en el detalle, los dos renglones existen y la vista los suma (7+5=12).
      expect(await cliente.movimientoDetPt.count()).toBe(2);
      expect(await existenciaVista(almPrimeras.id)).toBe(12);
    });

    it('rechaza un movimiento sin renglones o con cantidad no positiva', async () => {
      const base = {
        idEmpresa: empresa.id,
        idTipoMov: entradaInicial.id,
        idAlmacen: almPrimeras.id,
        fecha: new Date(),
        origenTipo: ORIGEN.movimientoManual,
      };
      await expect(
        registrarMovimientoPt(sesion(), { ...base, lineas: [] }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      await expect(
        registrarMovimientoPt(
          sesion(),
          {
            ...base,
            lineas: [
              { idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 0 },
            ],
          },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('RECHAZA un tipo de dirección "traspaso" en un movimiento simple (no perder existencia)', async () => {
      await expect(
        registrarMovimientoPt(
          sesion(),
          {
            idEmpresa: empresa.id,
            idTipoMov: traspasoTipo.id, // dirección 'traspaso' → debe rechazarse
            idAlmacen: almPrimeras.id,
            fecha: new Date(),
            origenTipo: ORIGEN.movimientoManual,
            lineas: [
              { idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 5 },
            ],
          },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      // Nada quedó escrito (la existencia sigue en 0).
      expect(await cliente.movimiento.count()).toBe(0);
      expect(await existenciaVista(almPrimeras.id)).toBe(0);
    });
  });

  describe('registrarTraspasoPt (nit #1)', () => {
    it('mueve la cantidad de origen a destino y la existencia TOTAL no cambia', async () => {
      await registrarMovimientoPt(
        sesion(),
        {
          idEmpresa: empresa.id,
          idTipoMov: entradaInicial.id,
          idAlmacen: almPrimeras.id,
          fecha: new Date(),
          origenTipo: ORIGEN.movimientoManual,
          lineas: [
            { idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 10 },
          ],
        },
        bd(),
      );

      const totalAntes =
        (await existenciaVista(almPrimeras.id)) + (await existenciaVista(almTransito.id));

      const { salida, entrada } = await registrarTraspasoPt(
        sesion(),
        {
          idEmpresa: empresa.id,
          idTipoMovSalida: traspasoSalida.id,
          idTipoMovEntrada: traspasoEntrada.id,
          idAlmacenOrigen: almPrimeras.id,
          idAlmacenDestino: almTransito.id,
          fecha: new Date(),
          lineas: [{ idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 4 }],
        },
        bd(),
      );

      // Dos movimientos distintos (dos patas), enlazados informativamente.
      expect(salida.id).not.toBe(entrada.id);
      expect(entrada.origenId).toBe(String(salida.id));

      expect(await existenciaVista(almPrimeras.id)).toBe(6); // 10 − 4
      expect(await existenciaVista(almTransito.id)).toBe(4); // 0 + 4
      const totalDespues =
        (await existenciaVista(almPrimeras.id)) + (await existenciaVista(almTransito.id));
      expect(totalDespues).toBe(totalAntes); // la existencia TOTAL no cambia
    });

    it('rechaza origen == destino', async () => {
      await expect(
        registrarTraspasoPt(
          sesion(),
          {
            idEmpresa: empresa.id,
            idTipoMovSalida: traspasoSalida.id,
            idTipoMovEntrada: traspasoEntrada.id,
            idAlmacenOrigen: almPrimeras.id,
            idAlmacenDestino: almPrimeras.id,
            fecha: new Date(),
            lineas: [
              { idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 1 },
            ],
          },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('ATÓMICO (A2): si la pata de entrada falla, NO queda la de salida', async () => {
      await registrarMovimientoPt(
        sesion(),
        {
          idEmpresa: empresa.id,
          idTipoMov: entradaInicial.id,
          idAlmacen: almPrimeras.id,
          fecha: new Date(),
          origenTipo: ORIGEN.movimientoManual,
          lineas: [
            { idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 10 },
          ],
        },
        bd(),
      );
      const movsAntes = await cliente.movimiento.count();

      // Tipo de entrada inválido (no existe) → la 2ª pata truena; la transacción revierte TODO.
      await expect(
        registrarTraspasoPt(
          sesion(),
          {
            idEmpresa: empresa.id,
            idTipoMovSalida: traspasoSalida.id,
            idTipoMovEntrada: 999_999,
            idAlmacenOrigen: almPrimeras.id,
            idAlmacenDestino: almTransito.id,
            fecha: new Date(),
            lineas: [
              { idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 4 },
            ],
          },
          bd(),
        ),
      ).rejects.toBeTruthy();

      // Ni la pata de salida quedó escrita (atomicidad).
      expect(await cliente.movimiento.count()).toBe(movsAntes);
      expect(await existenciaVista(almPrimeras.id)).toBe(10);
    });
  });

  describe('cancelarMovimientoPt (inverso auditado, D3/A7)', () => {
    it('genera el inverso que neutraliza la existencia y enlaza el par', async () => {
      const original = await registrarMovimientoPt(
        sesion(),
        {
          idEmpresa: empresa.id,
          idTipoMov: entradaInicial.id,
          idAlmacen: almPrimeras.id,
          fecha: new Date(),
          origenTipo: ORIGEN.movimientoManual,
          lineas: [{ idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 8 }],
        },
        bd(),
      );
      expect(await existenciaVista(almPrimeras.id)).toBe(8);

      const inverso = await cancelarMovimientoPt(sesion(), original.id, salidaCliente.id, bd());
      expect(inverso.idMovimientoInverso).toBe(original.id);
      expect(inverso.origenTipo).toBe(ORIGEN.cancelacion);
      expect(await existenciaVista(almPrimeras.id)).toBe(0); // entrada 8 − salida 8 = 0

      // El original NO se editó ni borró (D3): sigue ahí.
      expect(await cliente.movimiento.findUnique({ where: { id: original.id } })).not.toBeNull();
      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Movimiento', idEntidad: String(original.id), accion: 'CANCELAR' },
      });
    });

    it('no se puede cancelar dos veces el mismo movimiento', async () => {
      const original = await registrarMovimientoPt(
        sesion(),
        {
          idEmpresa: empresa.id,
          idTipoMov: entradaInicial.id,
          idAlmacen: almPrimeras.id,
          fecha: new Date(),
          origenTipo: ORIGEN.movimientoManual,
          lineas: [{ idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 8 }],
        },
        bd(),
      );
      await cancelarMovimientoPt(sesion(), original.id, salidaCliente.id, bd());
      await expect(
        cancelarMovimientoPt(sesion(), original.id, salidaCliente.id, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('exige que el tipo inverso tenga dirección OPUESTA', async () => {
      const original = await registrarMovimientoPt(
        sesion(),
        {
          idEmpresa: empresa.id,
          idTipoMov: entradaInicial.id,
          idAlmacen: almPrimeras.id,
          fecha: new Date(),
          origenTipo: ORIGEN.movimientoManual,
          lineas: [{ idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 8 }],
        },
        bd(),
      );
      // Original entrada → inverso DEBE ser salida; pasar otra entrada es ErrorValidacion.
      await expect(
        cancelarMovimientoPt(sesion(), original.id, traspasoEntrada.id, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });
  });

  describe('folio concurrente (A3)', () => {
    it('20 entradas CONCURRENTES sacan 20 folios únicos y consecutivos', async () => {
      const movs = await Promise.all(
        Array.from({ length: 20 }, () =>
          registrarMovimientoPt(
            sesion(),
            {
              idEmpresa: empresa.id,
              idTipoMov: entradaInicial.id,
              idAlmacen: almPrimeras.id,
              fecha: new Date(),
              origenTipo: ORIGEN.movimientoManual,
              lineas: [
                { idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 1 },
              ],
            },
            bd(),
          ),
        ),
      );
      const folios = movs.map((m) => Number(m.folio));
      expect(new Set(folios).size).toBe(20); // sin duplicados (jamás Max()+1)
      expect(folios.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      // La existencia total es la suma (cada entrada de 1) = 20.
      expect(await existenciaVista(almPrimeras.id)).toBe(20);
    });
  });

  describe('existenciaPtBloqueada (suma directa, NUNCA la vista — ADR §3)', () => {
    it('coincide con la vista y se puede tomar bajo bloqueo dentro de una transacción', async () => {
      await registrarMovimientoPt(
        sesion(),
        {
          idEmpresa: empresa.id,
          idTipoMov: entradaInicial.id,
          idAlmacen: almPrimeras.id,
          fecha: new Date(),
          origenTipo: ORIGEN.movimientoManual,
          lineas: [{ idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 9 }],
        },
        bd(),
      );
      const directo = await enTransaccion(async (tx) => {
        await bloquearArticuloPt(
          tx,
          empresa.id,
          almPrimeras.id,
          modelo.id,
          colorRojo.id,
          tallaM.id,
          null,
        );
        return existenciaPtBloqueada(
          tx,
          empresa.id,
          almPrimeras.id,
          modelo.id,
          colorRojo.id,
          tallaM.id,
          null,
        );
      }, bd());
      expect(directo).toBe(9);
      expect(directo).toBe(await existenciaVista(almPrimeras.id));
    });

    it('entrada + su cancelación → la SUMA DIRECTA bloqueada devuelve 0 (no solo la vista, nit #3)', async () => {
      const original = await registrarMovimientoPt(
        sesion(),
        {
          idEmpresa: empresa.id,
          idTipoMov: entradaInicial.id,
          idAlmacen: almPrimeras.id,
          fecha: new Date(),
          origenTipo: ORIGEN.movimientoManual,
          lineas: [{ idModelo: modelo.id, idColor: colorRojo.id, idTalla: tallaM.id, cantidad: 6 }],
        },
        bd(),
      );
      // El inverso (salida) neutraliza la entrada: entrada 6 − salida 6 = 0.
      await cancelarMovimientoPt(sesion(), original.id, salidaCliente.id, bd());

      const directo = await enTransaccion(async (tx) => {
        await bloquearArticuloPt(
          tx,
          empresa.id,
          almPrimeras.id,
          modelo.id,
          colorRojo.id,
          tallaM.id,
          null,
        );
        return existenciaPtBloqueada(
          tx,
          empresa.id,
          almPrimeras.id,
          modelo.id,
          colorRojo.id,
          tallaM.id,
          null,
        );
      }, bd());
      // La ruta bloqueada (la que usarán E4/E5 para validar) ve el neto en 0, no solo la vista.
      expect(directo).toBe(0);
      expect(directo).toBe(await existenciaVista(almPrimeras.id));
    });
  });
});
