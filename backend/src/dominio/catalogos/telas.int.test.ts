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
  actualizarTela,
  actualizarTelaCategoria,
  crearTela,
  crearTelaCategoria,
  desactivarTela,
  desactivarTelaCategoria,
  listarColoresDeTela,
  listarTelas,
  listarTelasCategorias,
  obtenerTela,
  reactivarTela,
  reactivarTelaCategoria,
} from './telas.js';

/**
 * Integración del dominio de Telas (F1-E3, PIEZA A — Telas unificadas, D5) contra Postgres
 * efímero (testcontainers). Cubre la integridad transaccional que el unit no puede:
 * tela+colores todo-o-nada (A2), unicidad de nombre global, categoría inexistente/inactiva
 * rechazada, diff del grid de colores con precio (altas/bajas/cambios), borrado suave +
 * reactivación, la regla "categoría en uso por tela activa no se desactiva", y el listado
 * paginado/buscado/filtrado por categoría.
 */

let cliente: PrismaClient;

const sesionAdmin = () => sesionDePrueba({ permisos: ['telas.ver', 'telas.administrar'] });
const bd = () => ({ cliente });

// Ids de colores y categoría sembrados en cada test (se rellenan en beforeEach).
let colorNegro: number;
let colorBlanco: number;
let colorRojo: number;
let categoriaFelpa: number;

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  // Colores base (los necesita el grid de la tela) y una categoría.
  const negro = await cliente.color.create({ data: { nombre: 'Negro' } });
  const blanco = await cliente.color.create({ data: { nombre: 'Blanco' } });
  const rojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  const felpa = await cliente.telaCategoria.create({ data: { nombre: 'Felpa' } });
  colorNegro = negro.id;
  colorBlanco = blanco.id;
  colorRojo = rojo.id;
  categoriaFelpa = felpa.id;
});

describe('Catálogo Telas (F1-E3, telas unificadas — global ADR-0007)', () => {
  describe('permisos en servidor (PLANMAESTRO §9.2)', () => {
    it('sin permiso no se puede ni leer ni escribir', async () => {
      const sinPermisos = sesionDePrueba();
      await expect(
        crearTela(sinPermisos, { nombre: 'X', unidadMedida: 'KG', colores: [] }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarTelas(sinPermisos, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarTelasCategorias(sinPermisos, {}, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({ permisos: ['telas.ver'] });
      await expect(
        crearTela(soloVer, { nombre: 'X', unidadMedida: 'KG', colores: [] }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarTelas(soloVer, {}, bd())).resolves.toBeTruthy();
    });
  });

  describe('crear (con grid de colores, transacción A2)', () => {
    it('crea con categoría, colores con/sin precio, auditoría y bitácora (A7)', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        {
          nombre: 'Felpa 100% algodón',
          unidadMedida: 'KG',
          descripcion: 'Felpa pesada',
          idCategoria: categoriaFelpa,
          tipoComponente: 'CUERPO',
          favorito: true,
          precioSugerido: 120.5,
          paraProduccion: true,
          colores: [{ idColor: colorNegro, precio: 95 }, { idColor: colorBlanco }],
        },
        bd(),
      );

      expect(tela).toMatchObject({
        nombre: 'Felpa 100% algodón',
        unidadMedida: 'KG',
        idCategoria: categoriaFelpa,
        tipoComponente: 'CUERPO',
        favorito: true,
        paraProduccion: true,
        activo: true,
        creadoPorId: sesion.id,
      });
      expect(tela.precioSugerido?.toNumber()).toBe(120.5);
      expect(tela.categoria?.nombre).toBe('Felpa');
      // Colores ordenados por nombre de color (Blanco, Negro).
      expect(tela.colores.map((c) => c.color.nombre)).toEqual(['Blanco', 'Negro']);
      const negro = tela.colores.find((c) => c.idColor === colorNegro);
      const blanco = tela.colores.find((c) => c.idColor === colorBlanco);
      expect(negro?.precio?.toNumber()).toBe(95);
      expect(blanco?.precio).toBeNull();

      // Los renglones puente TelaColor existen (transacción A2: o todo o nada).
      expect(await cliente.telaColor.count({ where: { idTela: tela.id } })).toBe(2);

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Tela', idEntidad: String(tela.id), accion: 'CREAR' },
      });
      expect(bitacora.idUsuario).toBe(sesion.id);
    });

    it('crea una tela SIN colores y SIN categoría (ambos opcionales)', async () => {
      const tela = await crearTela(
        sesionAdmin(),
        { nombre: 'Muestra', unidadMedida: 'KG', colores: [] },
        bd(),
      );
      expect(tela.idCategoria).toBeNull();
      expect(tela.colores).toHaveLength(0);
      // Defaults: OTRO / favorito false / paraProduccion true.
      expect(tela.tipoComponente).toBe('OTRO');
      expect(tela.favorito).toBe(false);
      expect(tela.paraProduccion).toBe(true);
    });

    it('rechaza un color inexistente → ErrorValidacion y NO crea la tela (atomicidad A2)', async () => {
      await expect(
        crearTela(
          sesionAdmin(),
          { nombre: 'Con fantasma', unidadMedida: 'KG', colores: [{ idColor: 999999 }] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      expect(await cliente.tela.count({ where: { nombre: 'Con fantasma' } })).toBe(0);
      expect(await cliente.telaColor.count()).toBe(0);
    });

    it('no se puede asignar un color DESACTIVADO → ErrorValidacion', async () => {
      await cliente.color.update({ where: { id: colorRojo }, data: { activo: false } });
      await expect(
        crearTela(
          sesionAdmin(),
          { nombre: 'Con rojo apagado', unidadMedida: 'KG', colores: [{ idColor: colorRojo }] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      expect(await cliente.tela.count({ where: { nombre: 'Con rojo apagado' } })).toBe(0);
    });

    it('rechaza una categoría inexistente → ErrorValidacion (y NO crea la tela)', async () => {
      await expect(
        crearTela(
          sesionAdmin(),
          { nombre: 'Sin cat', unidadMedida: 'KG', idCategoria: 999999, colores: [] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      expect(await cliente.tela.count({ where: { nombre: 'Sin cat' } })).toBe(0);
    });

    it('rechaza una categoría DESACTIVADA → ErrorValidacion', async () => {
      await cliente.telaCategoria.update({
        where: { id: categoriaFelpa },
        data: { activo: false },
      });
      await expect(
        crearTela(
          sesionAdmin(),
          { nombre: 'Cat apagada', unidadMedida: 'KG', idCategoria: categoriaFelpa, colores: [] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza nombre duplicado, sin importar mayúsculas → ErrorConflicto', async () => {
      await crearTela(sesionAdmin(), { nombre: 'Jersey', unidadMedida: 'KG', colores: [] }, bd());
      await expect(
        crearTela(sesionAdmin(), { nombre: 'jersey', unidadMedida: 'KG', colores: [] }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });
  });

  describe('actualizar (grid de colores + campos en una transacción)', () => {
    it('reemplaza el grid de colores (diff: alta, baja y cambio de precio) en la misma tx', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        {
          nombre: 'Tela',
          unidadMedida: 'KG',
          colores: [
            { idColor: colorNegro, precio: 90 },
            { idColor: colorBlanco, precio: 80 },
          ],
        },
        bd(),
      );

      // Quita blanco, mantiene negro con NUEVO precio, agrega rojo.
      const actualizado = await actualizarTela(
        sesion,
        {
          id: tela.id,
          colores: [
            { idColor: colorNegro, precio: 99 },
            { idColor: colorRojo, precio: 50 },
          ],
        },
        bd(),
      );

      expect(actualizado.colores.map((c) => c.color.nombre).sort()).toEqual(['Negro', 'Rojo']);
      const negro = actualizado.colores.find((c) => c.idColor === colorNegro);
      const rojo = actualizado.colores.find((c) => c.idColor === colorRojo);
      expect(negro?.precio?.toNumber()).toBe(99);
      expect(rojo?.precio?.toNumber()).toBe(50);
      expect(await cliente.telaColor.count({ where: { idTela: tela.id } })).toBe(2);
      // El blanco se quitó.
      expect(
        await cliente.telaColor.count({ where: { idTela: tela.id, idColor: colorBlanco } }),
      ).toBe(0);
    });

    it('mandar colores: [] VACÍA el grid (a diferencia de los tipos del maquilero)', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        { nombre: 'Tela', unidadMedida: 'KG', colores: [{ idColor: colorNegro }] },
        bd(),
      );
      const actualizado = await actualizarTela(sesion, { id: tela.id, colores: [] }, bd());
      expect(actualizado.colores).toHaveLength(0);
      expect(await cliente.telaColor.count({ where: { idTela: tela.id } })).toBe(0);
    });

    it('omitir `colores` NO toca el grid existente', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        {
          nombre: 'Tela',
          unidadMedida: 'KG',
          colores: [{ idColor: colorNegro }, { idColor: colorBlanco }],
        },
        bd(),
      );
      await actualizarTela(sesion, { id: tela.id, descripcion: 'nota' }, bd());
      expect(await cliente.telaColor.count({ where: { idTela: tela.id } })).toBe(2);
    });

    it('cambia datos generales con bitácora del detalle', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        { nombre: 'Tela', unidadMedida: 'KG', favorito: false, colores: [] },
        bd(),
      );
      const actualizado = await actualizarTela(
        sesion,
        {
          id: tela.id,
          favorito: true,
          tipoComponente: 'CARDIGAN',
          precioSugerido: 42,
          // La UNIDAD se maneja con los demás enums desde el 30-jul-2026 (antes iba con los campos
          // de texto). Si ese camino se rompiera, corregir un chifón de kilos a metros devolvería
          // 200 y un toast de "actualizada" SIN escribir nada — el fallo silencioso de siempre.
          unidadMedida: 'M',
        },
        bd(),
      );
      expect(actualizado).toMatchObject({
        favorito: true,
        tipoComponente: 'CARDIGAN',
        unidadMedida: 'M',
      });
      expect(actualizado.precioSugerido?.toNumber()).toBe(42);

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Tela', idEntidad: String(tela.id), accion: 'MODIFICAR' },
      });
      expect(bitacora.datos).toMatchObject({
        favorito: { de: false, a: true },
        unidadMedida: { de: 'KG', a: 'M' },
      });
    });

    it('vaciar descripción (null) la BORRA; quitar categoría (null) la deja en null', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        {
          nombre: 'Tela',
          unidadMedida: 'KG',
          descripcion: 'algo',
          idCategoria: categoriaFelpa,
          colores: [],
        },
        bd(),
      );
      const actualizado = await actualizarTela(
        sesion,
        { id: tela.id, descripcion: null, idCategoria: null },
        bd(),
      );
      expect(actualizado.descripcion).toBeNull();
      expect(actualizado.idCategoria).toBeNull();
      expect(actualizado.categoria).toBeNull();
    });

    it('una descripción que llega vacía ("") se normaliza a null (nunca se guarda "")', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        { nombre: 'Tela', unidadMedida: 'KG', descripcion: 'x', colores: [] },
        bd(),
      );
      const actualizado = await actualizarTela(sesion, { id: tela.id, descripcion: '' }, bd());
      expect(actualizado.descripcion).toBeNull();
      const enBd = await cliente.tela.findUniqueOrThrow({ where: { id: tela.id } });
      expect(enBd.descripcion).toBeNull();
    });

    it('cambiar a una categoría inexistente → ErrorValidacion', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        { nombre: 'Tela', unidadMedida: 'KG', colores: [] },
        bd(),
      );
      await expect(
        actualizarTela(sesion, { id: tela.id, idCategoria: 999999 }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('cambiar el nombre a uno ya usado → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      await crearTela(sesion, { nombre: 'Uno', unidadMedida: 'KG', colores: [] }, bd());
      const segunda = await crearTela(
        sesion,
        { nombre: 'Dos', unidadMedida: 'KG', colores: [] },
        bd(),
      );
      await expect(
        actualizarTela(sesion, { id: segunda.id, nombre: 'uno' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('sin cambio real es idempotente: no escribe bitácora', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        { nombre: 'Tela', unidadMedida: 'KG', colores: [] },
        bd(),
      );
      const antes = await cliente.bitacora.count();
      await actualizarTela(sesion, { id: tela.id, nombre: 'Tela' }, bd());
      expect(await cliente.bitacora.count()).toBe(antes);
    });

    it('un id inexistente → ErrorNoEncontrado', async () => {
      await expect(
        actualizarTela(sesionAdmin(), { id: 9999, nombre: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  describe('desactivar / reactivar (borrado suave, PLANMAESTRO §4)', () => {
    it('desactiva con bitácora DESACTIVAR; la tela y sus colores siguen existiendo', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        { nombre: 'Tela', unidadMedida: 'KG', colores: [{ idColor: colorNegro }] },
        bd(),
      );
      const desactivada = await desactivarTela(sesion, tela.id, bd());
      expect(desactivada.activo).toBe(false);
      expect(await cliente.tela.count()).toBe(1);
      // Los colores se conservan (no se borra el historial).
      expect(await cliente.telaColor.count({ where: { idTela: tela.id } })).toBe(1);
      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Tela', idEntidad: String(tela.id), accion: 'DESACTIVAR' },
      });
    });

    it('desactivar dos veces → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        { nombre: 'Tela', unidadMedida: 'KG', colores: [] },
        bd(),
      );
      await desactivarTela(sesion, tela.id, bd());
      await expect(desactivarTela(sesion, tela.id, bd())).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('reactivar una tela desactivada funciona', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        { nombre: 'Tela', unidadMedida: 'KG', colores: [] },
        bd(),
      );
      await desactivarTela(sesion, tela.id, bd());
      const reactivada = await reactivarTela(sesion, tela.id, bd());
      expect(reactivada.activo).toBe(true);
    });

    it('crear con el nombre de una tela desactivada choca (pide reactivarla) → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        { nombre: 'Repe', unidadMedida: 'KG', colores: [] },
        bd(),
      );
      await desactivarTela(sesion, tela.id, bd());
      await expect(
        crearTela(sesion, { nombre: 'Repe', unidadMedida: 'KG', colores: [] }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });
  });

  describe('obtener / colores de una tela', () => {
    it('obtiene la tela con su categoría y colores', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        {
          nombre: 'Tela',
          unidadMedida: 'KG',
          idCategoria: categoriaFelpa,
          colores: [{ idColor: colorNegro, precio: 10 }],
        },
        bd(),
      );
      const obtenida = await obtenerTela(sesion, tela.id, bd());
      expect(obtenida.id).toBe(tela.id);
      expect(obtenida.categoria?.nombre).toBe('Felpa');
      expect(obtenida.colores).toHaveLength(1);
    });

    it('lista los colores de una tela (con precio) por el endpoint suelto', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        {
          nombre: 'Tela',
          unidadMedida: 'KG',
          colores: [{ idColor: colorNegro, precio: 10 }, { idColor: colorBlanco }],
        },
        bd(),
      );
      const colores = await listarColoresDeTela(sesion, tela.id, bd());
      expect(colores.map((c) => c.nombre)).toEqual(['Blanco', 'Negro']);
      expect(colores.find((c) => c.nombre === 'Negro')?.precio?.toNumber()).toBe(10);
    });

    it('obtener / listar colores de un id inexistente → ErrorNoEncontrado', async () => {
      await expect(obtenerTela(sesionAdmin(), 9999, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
      await expect(listarColoresDeTela(sesionAdmin(), 9999, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
    });
  });

  describe('listar (búsqueda + filtro por categoría + paginación)', () => {
    it('filtra por categoría', async () => {
      const sesion = sesionAdmin();
      const jersey = await cliente.telaCategoria.create({ data: { nombre: 'Jersey' } });
      await crearTela(
        sesion,
        { nombre: 'Felpa A', unidadMedida: 'KG', idCategoria: categoriaFelpa, colores: [] },
        bd(),
      );
      await crearTela(
        sesion,
        { nombre: 'Jersey A', unidadMedida: 'KG', idCategoria: jersey.id, colores: [] },
        bd(),
      );
      await crearTela(sesion, { nombre: 'Sin cat', unidadMedida: 'KG', colores: [] }, bd());

      expect((await listarTelas(sesion, { idCategoria: categoriaFelpa }, bd())).total).toBe(1);
      expect((await listarTelas(sesion, { idCategoria: jersey.id }, bd())).total).toBe(1);
      expect((await listarTelas(sesion, {}, bd())).total).toBe(3);
    });

    it('busca por nombre (insensible a mayúsculas) y cada tela trae sus colores', async () => {
      const sesion = sesionAdmin();
      await crearTela(
        sesion,
        {
          nombre: 'Felpa pesada',
          unidadMedida: 'KG',
          colores: [{ idColor: colorNegro }, { idColor: colorBlanco }],
        },
        bd(),
      );
      await crearTela(sesion, { nombre: 'Jersey liviano', unidadMedida: 'KG', colores: [] }, bd());

      const pagina = await listarTelas(sesion, { busqueda: 'FELPA' }, bd());
      expect(pagina.total).toBe(1);
      expect(pagina.datos[0]?.colores).toHaveLength(2);
      expect((await listarTelas(sesion, { busqueda: 'zzz' }, bd())).total).toBe(0);
    });

    // Daniel (30-jul-2026): *"me gustaría poder buscar por color, por tipo de tela"* — en el
    // almacén se busca "negro" mucho más seguido que el nombre exacto de la tela.
    it('busca también por COLOR, y filtra por un color concreto', async () => {
      const sesion = sesionAdmin();
      await crearTela(
        sesion,
        { nombre: 'Felpa pesada', unidadMedida: 'KG', colores: [{ idColor: colorNegro }] },
        bd(),
      );
      await crearTela(
        sesion,
        { nombre: 'Jersey liviano', unidadMedida: 'M', colores: [{ idColor: colorBlanco }] },
        bd(),
      );

      // El texto pega con el nombre del COLOR aunque no diga nada del nombre de la tela.
      const porColor = await listarTelas(sesion, { busqueda: 'negr' }, bd());
      expect(porColor.total).toBe(1);
      expect(porColor.datos[0]?.nombre).toBe('Felpa pesada');

      // Y el filtro duro por id de color hace lo propio.
      const filtrada = await listarTelas(sesion, { idColor: colorBlanco }, bd());
      expect(filtrada.total).toBe(1);
      expect(filtrada.datos[0]?.nombre).toBe('Jersey liviano');

      // Sin coincidencia ni en tela ni en color: vacío (la búsqueda no se abrió de más).
      expect((await listarTelas(sesion, { busqueda: 'zzz' }, bd())).total).toBe(0);
    });

    it('guarda la UNIDAD como se eligió (kilos o metros), y no acepta otra', async () => {
      const sesion = sesionAdmin();
      const enMetros = await crearTela(
        sesion,
        { nombre: 'Chifón', unidadMedida: 'M', colores: [] },
        bd(),
      );
      expect(enMetros.unidadMedida).toBe('M');
      const enKilos = await crearTela(
        sesion,
        { nombre: 'Felpa', unidadMedida: 'KG', colores: [] },
        bd(),
      );
      expect(enKilos.unidadMedida).toBe('KG');

      // Alta sin unidad → rechazada por el contrato (no cae a un default silencioso).
      await expect(
        crearTela(sesion, { nombre: 'Sin unidad', colores: [] } as never, bd()),
      ).rejects.toThrow();
    });

    it('excluye inactivas por defecto', async () => {
      const sesion = sesionAdmin();
      await crearTela(sesion, { nombre: 'Activa', unidadMedida: 'KG', colores: [] }, bd());
      const inactiva = await crearTela(
        sesion,
        { nombre: 'Inactiva', unidadMedida: 'KG', colores: [] },
        bd(),
      );
      await desactivarTela(sesion, inactiva.id, bd());

      expect((await listarTelas(sesion, {}, bd())).total).toBe(1);
      expect((await listarTelas(sesion, { incluirInactivos: true }, bd())).total).toBe(2);
    });

    it('pagina y respeta el orden por nombre', async () => {
      const sesion = sesionAdmin();
      for (const nombre of ['Ccc', 'Aaa', 'Bbb']) {
        await crearTela(sesion, { unidadMedida: 'KG', nombre, colores: [] }, bd());
      }
      const p1 = await listarTelas(
        sesion,
        { pagina: 1, porPagina: 2, ordenarPor: 'nombre', direccion: 'asc' },
        bd(),
      );
      expect(p1.total).toBe(3);
      expect(p1.totalPaginas).toBe(2);
      expect(p1.datos.map((t) => t.nombre)).toEqual(['Aaa', 'Bbb']);
    });
  });

  describe('categorías de tela (catálogo simple sin permiso propio)', () => {
    it('crea, lista y rechaza nombre duplicado', async () => {
      const sesion = sesionAdmin();
      await crearTelaCategoria(sesion, { nombre: 'Rib' }, bd());
      await expect(crearTelaCategoria(sesion, { nombre: 'rib' }, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
      // La sembrada (Felpa) + la nueva (Rib) = 2.
      expect((await listarTelasCategorias(sesion, {}, bd())).total).toBe(2);
    });

    it('NO se puede desactivar una categoría usada por una tela ACTIVA → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      await crearTela(
        sesion,
        { nombre: 'Tela', unidadMedida: 'KG', idCategoria: categoriaFelpa, colores: [] },
        bd(),
      );
      await expect(desactivarTelaCategoria(sesion, categoriaFelpa, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
    });

    it('una categoría usada solo por telas INACTIVAS sí se puede desactivar', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        { nombre: 'Tela', unidadMedida: 'KG', idCategoria: categoriaFelpa, colores: [] },
        bd(),
      );
      await desactivarTela(sesion, tela.id, bd());
      const cat = await desactivarTelaCategoria(sesion, categoriaFelpa, bd());
      expect(cat.activo).toBe(false);
    });

    it('desactiva y reactiva una categoría libre', async () => {
      const sesion = sesionAdmin();
      const cat = await crearTelaCategoria(sesion, { nombre: 'Rib' }, bd());
      const desactivada = await desactivarTelaCategoria(sesion, cat.id, bd());
      expect(desactivada.activo).toBe(false);
      const reactivada = await reactivarTelaCategoria(sesion, cat.id, bd());
      expect(reactivada.activo).toBe(true);
    });

    it('renombrar una categoría con bitácora MODIFICAR', async () => {
      const sesion = sesionAdmin();
      const cat = await crearTelaCategoria(sesion, { nombre: 'Rib' }, bd());
      const actualizada = await actualizarTelaCategoria(
        sesion,
        { id: cat.id, nombre: 'Rib 2x1' },
        bd(),
      );
      expect(actualizada.nombre).toBe('Rib 2x1');
      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'TelaCategoria', idEntidad: String(cat.id), accion: 'MODIFICAR' },
      });
    });
  });
});
