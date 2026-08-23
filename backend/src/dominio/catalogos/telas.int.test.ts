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
  actualizarComposicionTela,
  actualizarTela,
  actualizarTelaCategoria,
  crearComposicionTela,
  crearTela,
  crearTelaCategoria,
  crearTelaMigracion,
  reconciliarColoresTelaMigracion,
  desactivarComposicionTela,
  desactivarTela,
  desactivarTelaCategoria,
  listarColoresDeTela,
  listarComposicionesTela,
  listarTelas,
  listarTelasCategorias,
  obtenerTela,
  reactivarComposicionTela,
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

// Ids sembrados en cada test (se rellenan en beforeEach). `colorPrendaBlanco` es un color
// del catálogo de PRENDA: los colores de TELA ya no cuelgan de él (§Post-F9.11) y solo lo
// usa la prueba del filtro LEGACY por `idColor`.
let colorPrendaBlanco: number;
let categoriaFelpa: number;
let proveedorAlsatex: number;

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  // Un color de PRENDA (solo para la liga/filtro LEGACY), una categoría y el proveedor
  // dueño que el alta de tela exige (§Post-F9.11).
  const blanco = await cliente.color.create({ data: { nombre: 'Blanco' } });
  const felpa = await cliente.telaCategoria.create({ data: { nombre: 'Felpa' } });
  const alsatex = await cliente.proveedor.create({ data: { nombre: 'Alsatex' } });
  colorPrendaBlanco = blanco.id;
  categoriaFelpa = felpa.id;
  proveedorAlsatex = alsatex.id;
});

describe('Catálogo Telas (F1-E3, telas unificadas — global ADR-0007)', () => {
  describe('permisos en servidor (PLANMAESTRO §9.2)', () => {
    it('sin permiso no se puede ni leer ni escribir', async () => {
      const sinPermisos = sesionDePrueba();
      await expect(
        crearTela(
          sinPermisos,
          { nombre: 'X', unidadMedida: 'KG', idProveedor: proveedorAlsatex, colores: [] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarTelas(sinPermisos, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarTelasCategorias(sinPermisos, {}, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({ permisos: ['telas.ver'] });
      await expect(
        crearTela(
          soloVer,
          { nombre: 'X', unidadMedida: 'KG', idProveedor: proveedorAlsatex, colores: [] },
          bd(),
        ),
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
          idProveedor: proveedorAlsatex,
          descripcion: 'Felpa pesada',
          idCategoria: categoriaFelpa,
          tipoComponente: 'CUERPO',
          favorito: true,
          precioSugerido: 120.5,
          paraProduccion: true,
          colores: [{ nombre: 'Negro', precio: 95 }, { nombre: 'Blanco' }],
        },
        bd(),
      );

      expect(tela).toMatchObject({
        nombre: 'Felpa 100% algodón',
        unidadMedida: 'KG',
        idProveedor: proveedorAlsatex,
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
      expect(tela.colores.map((c) => c.nombre)).toEqual(['Blanco', 'Negro']);
      const negro = tela.colores.find((c) => c.nombre === 'Negro');
      const blanco = tela.colores.find((c) => c.nombre === 'Blanco');
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
        { nombre: 'Muestra', unidadMedida: 'KG', idProveedor: proveedorAlsatex, colores: [] },
        bd(),
      );
      expect(tela.idCategoria).toBeNull();
      expect(tela.colores).toHaveLength(0);
      // Defaults: OTRO / favorito false / paraProduccion true.
      expect(tela.tipoComponente).toBe('OTRO');
      expect(tela.favorito).toBe(false);
      expect(tela.paraProduccion).toBe(true);
    });

    // REGRESIÓN A1.1 (puntos 4-5): `tipoComponente` y `paraProduccion` son LEGADO — la UI ya
    // no los manda. Un PATCH SIN esos campos NO debe resetearlos a su default: si algún día
    // el contrato de EDICIÓN les pusiera un `.default()` (la trampa que el CI cazó en F1-E1),
    // este test truena antes de que una tela vieja pierda sus valores en silencio.
    it('editar sin mandar tipoComponente/paraProduccion NO resetea los valores legado', async () => {
      const sesion = sesionAdmin();
      const vieja = await crearTela(
        sesion,
        {
          nombre: 'Vieja con legado',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          tipoComponente: 'CUERPO',
          paraProduccion: false,
          colores: [],
        },
        bd(),
      );
      expect(vieja.tipoComponente).toBe('CUERPO');
      expect(vieja.paraProduccion).toBe(false);

      // PATCH como el que hoy arma la UI: toca otros campos, OMITE los legado.
      const editada = await actualizarTela(
        sesion,
        { id: vieja.id, descripcion: 'depurada', favorito: true },
        bd(),
      );
      expect(editada.descripcion).toBe('depurada');
      expect(editada.tipoComponente).toBe('CUERPO');
      expect(editada.paraProduccion).toBe(false);

      // Verificación directa en BD (no solo la proyección devuelta).
      const enBd = await cliente.tela.findUniqueOrThrow({ where: { id: vieja.id } });
      expect(enBd.tipoComponente).toBe('CUERPO');
      expect(enBd.paraProduccion).toBe(false);
    });

    // A1.1 (Daniel, 6-ago-2026): peso (gr/m²) y ancho (m) de la tela — informativos, opcionales.
    it('guarda peso y ancho (A1.1) en el alta, los edita con bitácora y los vacía (M1)', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        {
          nombre: 'Felpa 280',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          peso: 280,
          ancho: 1.8,
          colores: [],
        },
        bd(),
      );
      expect(tela.peso?.toNumber()).toBe(280);
      expect(tela.ancho?.toNumber()).toBe(1.8);

      // Editar los cambia y la bitácora registra el detalle (A7).
      const editada = await actualizarTela(sesion, { id: tela.id, peso: 300.5, ancho: 1.6 }, bd());
      expect(editada.peso?.toNumber()).toBe(300.5);
      expect(editada.ancho?.toNumber()).toBe(1.6);
      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Tela', idEntidad: String(tela.id), accion: 'MODIFICAR' },
      });
      expect(bitacora.datos).toMatchObject({
        peso: { de: 280, a: 300.5 },
        ancho: { de: 1.8, a: 1.6 },
      });

      // `null` los borra; omitirlos NO los toca (M1).
      const vaciada = await actualizarTela(sesion, { id: tela.id, peso: null }, bd());
      expect(vaciada.peso).toBeNull();
      expect(vaciada.ancho?.toNumber()).toBe(1.6);

      // Un alta SIN peso/ancho los deja en null (opcionales); negativos se rechazan.
      const sinFicha = await crearTela(
        sesion,
        { nombre: 'Sin ficha', unidadMedida: 'M', idProveedor: proveedorAlsatex, colores: [] },
        bd(),
      );
      expect(sinFicha.peso).toBeNull();
      expect(sinFicha.ancho).toBeNull();
      await expect(
        crearTela(
          sesion,
          {
            nombre: 'Peso negativo',
            unidadMedida: 'KG',
            idProveedor: proveedorAlsatex,
            peso: -1,
            colores: [],
          },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    // §Post-F9.11: los colores son HIJOS de la tela — nombre libre, NO catálogo global.
    it('rechaza nombres de color repetidos en la misma tela, sin importar mayúsculas', async () => {
      await expect(
        crearTela(
          sesionAdmin(),
          {
            nombre: 'Con repetidos',
            unidadMedida: 'KG',
            idProveedor: proveedorAlsatex,
            colores: [{ nombre: 'Negro' }, { nombre: 'NEGRO' }],
          },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      expect(await cliente.tela.count({ where: { nombre: 'Con repetidos' } })).toBe(0);
      expect(await cliente.telaColor.count()).toBe(0);
    });

    it('dos telas DISTINTAS pueden tener cada una su "Negro" (unicidad POR tela)', async () => {
      const sesion = sesionAdmin();
      const una = await crearTela(
        sesion,
        {
          nombre: 'Felpa A',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          colores: [{ nombre: 'Negro', precio: 90 }],
        },
        bd(),
      );
      const otra = await crearTela(
        sesion,
        {
          nombre: 'Felpa B',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          colores: [{ nombre: 'Negro', precio: 120 }],
        },
        bd(),
      );
      expect(una.colores[0]?.nombre).toBe('Negro');
      expect(otra.colores[0]?.nombre).toBe('Negro');
      expect(await cliente.telaColor.count({ where: { nombre: 'Negro' } })).toBe(2);
    });

    it('dar de alta un color de TELA NO lo mete al catálogo de color de PRENDA', async () => {
      const antes = await cliente.color.count();
      const tela = await crearTela(
        sesionAdmin(),
        {
          nombre: 'Felpa marina',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          colores: [{ nombre: 'Marino Alsa 3040', pantone: '19-4024 TCX' }],
        },
        bd(),
      );
      // El catálogo de prenda quedó INTACTO y la fila nueva nace SIN liga legacy.
      expect(await cliente.color.count()).toBe(antes);
      const fila = await cliente.telaColor.findFirstOrThrow({ where: { idTela: tela.id } });
      expect(fila.nombre).toBe('Marino Alsa 3040');
      expect(fila.idColor).toBeNull();
    });

    it('rechaza una categoría inexistente → ErrorValidacion (y NO crea la tela)', async () => {
      await expect(
        crearTela(
          sesionAdmin(),
          {
            nombre: 'Sin cat',
            unidadMedida: 'KG',
            idProveedor: proveedorAlsatex,
            idCategoria: 999999,
            colores: [],
          },
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
          {
            nombre: 'Cat apagada',
            unidadMedida: 'KG',
            idProveedor: proveedorAlsatex,
            idCategoria: categoriaFelpa,
            colores: [],
          },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza nombre duplicado, sin importar mayúsculas → ErrorConflicto', async () => {
      await crearTela(
        sesionAdmin(),
        { nombre: 'Jersey', unidadMedida: 'KG', idProveedor: proveedorAlsatex, colores: [] },
        bd(),
      );
      await expect(
        crearTela(
          sesionAdmin(),
          { nombre: 'jersey', unidadMedida: 'KG', idProveedor: proveedorAlsatex, colores: [] },
          bd(),
        ),
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
          idProveedor: proveedorAlsatex,
          colores: [
            { nombre: 'Negro', precio: 90 },
            { nombre: 'Blanco', precio: 80 },
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
            { nombre: 'Negro', precio: 99 },
            { nombre: 'Rojo', precio: 50 },
          ],
        },
        bd(),
      );

      expect(actualizado.colores.map((c) => c.nombre).sort()).toEqual(['Negro', 'Rojo']);
      const negro = actualizado.colores.find((c) => c.nombre === 'Negro');
      const rojo = actualizado.colores.find((c) => c.nombre === 'Rojo');
      expect(negro?.precio?.toNumber()).toBe(99);
      expect(rojo?.precio?.toNumber()).toBe(50);
      expect(await cliente.telaColor.count({ where: { idTela: tela.id } })).toBe(2);
      // El blanco se quitó.
      expect(await cliente.telaColor.count({ where: { idTela: tela.id, nombre: 'Blanco' } })).toBe(
        0,
      );
    });

    it('mandar colores: [] VACÍA el grid (a diferencia de los tipos del maquilero)', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        {
          nombre: 'Tela',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          colores: [{ nombre: 'Negro' }],
        },
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
          idProveedor: proveedorAlsatex,
          colores: [{ nombre: 'Negro' }, { nombre: 'Blanco' }],
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
        {
          nombre: 'Tela',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          favorito: false,
          colores: [],
        },
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
          idProveedor: proveedorAlsatex,
        },
        bd(),
      );
      expect(actualizado).toMatchObject({
        favorito: true,
        tipoComponente: 'CARDIGAN',
        unidadMedida: 'M',
        idProveedor: proveedorAlsatex,
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
          idProveedor: proveedorAlsatex,
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
        {
          nombre: 'Tela',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          descripcion: 'x',
          colores: [],
        },
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
        { nombre: 'Tela', unidadMedida: 'KG', idProveedor: proveedorAlsatex, colores: [] },
        bd(),
      );
      await expect(
        actualizarTela(sesion, { id: tela.id, idCategoria: 999999 }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('cambiar el nombre a uno ya usado → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      await crearTela(
        sesion,
        { nombre: 'Uno', unidadMedida: 'KG', idProveedor: proveedorAlsatex, colores: [] },
        bd(),
      );
      const segunda = await crearTela(
        sesion,
        { nombre: 'Dos', unidadMedida: 'KG', idProveedor: proveedorAlsatex, colores: [] },
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
        { nombre: 'Tela', unidadMedida: 'KG', idProveedor: proveedorAlsatex, colores: [] },
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
        {
          nombre: 'Tela',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          colores: [{ nombre: 'Negro' }],
        },
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
        { nombre: 'Tela', unidadMedida: 'KG', idProveedor: proveedorAlsatex, colores: [] },
        bd(),
      );
      await desactivarTela(sesion, tela.id, bd());
      await expect(desactivarTela(sesion, tela.id, bd())).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('reactivar una tela desactivada funciona', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        { nombre: 'Tela', unidadMedida: 'KG', idProveedor: proveedorAlsatex, colores: [] },
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
        { nombre: 'Repe', unidadMedida: 'KG', idProveedor: proveedorAlsatex, colores: [] },
        bd(),
      );
      await desactivarTela(sesion, tela.id, bd());
      await expect(
        crearTela(
          sesion,
          { nombre: 'Repe', unidadMedida: 'KG', idProveedor: proveedorAlsatex, colores: [] },
          bd(),
        ),
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
          idProveedor: proveedorAlsatex,
          idCategoria: categoriaFelpa,
          colores: [{ nombre: 'Negro', precio: 10 }],
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
          idProveedor: proveedorAlsatex,
          colores: [{ nombre: 'Negro', precio: 10 }, { nombre: 'Blanco' }],
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
        {
          nombre: 'Felpa A',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          idCategoria: categoriaFelpa,
          colores: [],
        },
        bd(),
      );
      await crearTela(
        sesion,
        {
          nombre: 'Jersey A',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          idCategoria: jersey.id,
          colores: [],
        },
        bd(),
      );
      await crearTela(
        sesion,
        { nombre: 'Sin cat', unidadMedida: 'KG', idProveedor: proveedorAlsatex, colores: [] },
        bd(),
      );

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
          idProveedor: proveedorAlsatex,
          colores: [{ nombre: 'Negro' }, { nombre: 'Blanco' }],
        },
        bd(),
      );
      await crearTela(
        sesion,
        {
          nombre: 'Jersey liviano',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          colores: [],
        },
        bd(),
      );

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
        {
          nombre: 'Felpa pesada',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          colores: [{ nombre: 'Negro' }],
        },
        bd(),
      );
      await crearTela(
        sesion,
        {
          nombre: 'Jersey liviano',
          unidadMedida: 'M',
          idProveedor: proveedorAlsatex,
          colores: [{ nombre: 'Blanco' }],
        },
        bd(),
      );

      // El texto pega con el nombre del COLOR aunque no diga nada del nombre de la tela.
      const porColor = await listarTelas(sesion, { busqueda: 'negr' }, bd());
      expect(porColor.total).toBe(1);
      expect(porColor.datos[0]?.nombre).toBe('Felpa pesada');

      // El filtro por `idColor` es LEGACY (§Post-F9.11): pesca por la liga al color de
      // PRENDA de las filas MIGRADAS. Se simula una: se liga el "Blanco" del jersey.
      await cliente.telaColor.updateMany({
        where: { nombre: 'Blanco' },
        data: { idColor: colorPrendaBlanco },
      });
      const filtrada = await listarTelas(sesion, { idColor: colorPrendaBlanco }, bd());
      expect(filtrada.total).toBe(1);
      expect(filtrada.datos[0]?.nombre).toBe('Jersey liviano');

      // Sin coincidencia ni en tela ni en color: vacío (la búsqueda no se abrió de más).
      expect((await listarTelas(sesion, { busqueda: 'zzz' }, bd())).total).toBe(0);
    });

    it('guarda la UNIDAD como se eligió (kilos o metros), y no acepta otra', async () => {
      const sesion = sesionAdmin();
      const enMetros = await crearTela(
        sesion,
        { nombre: 'Chifón', unidadMedida: 'M', idProveedor: proveedorAlsatex, colores: [] },
        bd(),
      );
      expect(enMetros.unidadMedida).toBe('M');
      const enKilos = await crearTela(
        sesion,
        { nombre: 'Felpa', unidadMedida: 'KG', idProveedor: proveedorAlsatex, colores: [] },
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
      await crearTela(
        sesion,
        { nombre: 'Activa', unidadMedida: 'KG', idProveedor: proveedorAlsatex, colores: [] },
        bd(),
      );
      const inactiva = await crearTela(
        sesion,
        { nombre: 'Inactiva', unidadMedida: 'KG', idProveedor: proveedorAlsatex, colores: [] },
        bd(),
      );
      await desactivarTela(sesion, inactiva.id, bd());

      expect((await listarTelas(sesion, {}, bd())).total).toBe(1);
      expect((await listarTelas(sesion, { incluirInactivos: true }, bd())).total).toBe(2);
    });

    it('pagina y respeta el orden por nombre', async () => {
      const sesion = sesionAdmin();
      for (const nombre of ['Ccc', 'Aaa', 'Bbb']) {
        await crearTela(
          sesion,
          { unidadMedida: 'KG', idProveedor: proveedorAlsatex, nombre, colores: [] },
          bd(),
        );
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
        {
          nombre: 'Tela',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          idCategoria: categoriaFelpa,
          colores: [],
        },
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
        {
          nombre: 'Tela',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          idCategoria: categoriaFelpa,
          colores: [],
        },
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

describe('Reestructura A1 del catálogo de telas (§Post-F9.11)', () => {
  describe('composiciones de tela (catálogo simple sin permiso propio)', () => {
    it('sin permiso no se puede ni leer ni escribir', async () => {
      const sinPermisos = sesionDePrueba();
      await expect(
        crearComposicionTela(sinPermisos, { nombre: '100% Algodón' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarComposicionesTela(sinPermisos, {}, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
      const soloVer = sesionDePrueba({ permisos: ['telas.ver'] });
      await expect(
        crearComposicionTela(soloVer, { nombre: '100% Algodón' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarComposicionesTela(soloVer, {}, bd())).resolves.toBeTruthy();
    });

    it('crea con bitácora (A7), lista y rechaza nombre duplicado sin importar mayúsculas', async () => {
      const sesion = sesionAdmin();
      const composicion = await crearComposicionTela(
        sesion,
        { nombre: '50% Algodón, 50% Poliéster' },
        bd(),
      );
      expect(composicion.activo).toBe(true);
      expect(composicion.creadoPorId).toBe(sesion.id);
      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'ComposicionTela', idEntidad: String(composicion.id), accion: 'CREAR' },
      });

      await expect(
        crearComposicionTela(sesion, { nombre: '50% algodón, 50% POLIÉSTER' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
      expect((await listarComposicionesTela(sesion, {}, bd())).total).toBe(1);
    });

    it('NO se puede desactivar una composición usada por una tela ACTIVA → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const composicion = await crearComposicionTela(sesion, { nombre: '100% Algodón' }, bd());
      await crearTela(
        sesion,
        {
          nombre: 'Felpa',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          idComposicion: composicion.id,
          colores: [],
        },
        bd(),
      );
      await expect(desactivarComposicionTela(sesion, composicion.id, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
    });

    it('una composición usada solo por telas INACTIVAS sí se desactiva; y se reactiva', async () => {
      const sesion = sesionAdmin();
      const composicion = await crearComposicionTela(sesion, { nombre: '100% Algodón' }, bd());
      const tela = await crearTela(
        sesion,
        {
          nombre: 'Felpa',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          idComposicion: composicion.id,
          colores: [],
        },
        bd(),
      );
      await desactivarTela(sesion, tela.id, bd());
      const desactivada = await desactivarComposicionTela(sesion, composicion.id, bd());
      expect(desactivada.activo).toBe(false);
      const reactivada = await reactivarComposicionTela(sesion, composicion.id, bd());
      expect(reactivada.activo).toBe(true);
    });

    it('renombra con bitácora MODIFICAR y excluye inactivas por defecto en el listado', async () => {
      const sesion = sesionAdmin();
      const composicion = await crearComposicionTela(sesion, { nombre: '100% Algodon' }, bd());
      const renombrada = await actualizarComposicionTela(
        sesion,
        { id: composicion.id, nombre: '100% Algodón' },
        bd(),
      );
      expect(renombrada.nombre).toBe('100% Algodón');
      await cliente.bitacora.findFirstOrThrow({
        where: {
          entidad: 'ComposicionTela',
          idEntidad: String(composicion.id),
          accion: 'MODIFICAR',
        },
      });

      const otra = await crearComposicionTela(sesion, { nombre: 'Poliéster' }, bd());
      await desactivarComposicionTela(sesion, otra.id, bd());
      expect((await listarComposicionesTela(sesion, {}, bd())).total).toBe(1);
      expect((await listarComposicionesTela(sesion, { incluirInactivos: true }, bd())).total).toBe(
        2,
      );
    });
  });

  describe('identidad de la tela en 4 datos + complemento', () => {
    it('crea con composición, proveedor dueño, nombres y colores con pantone y dos precios', async () => {
      const sesion = sesionAdmin();
      const composicion = await crearComposicionTela(
        sesion,
        { nombre: '50% Algodón, 50% Poliéster' },
        bd(),
      );
      const tela = await crearTela(
        sesion,
        {
          nombre: 'Felpa Suiza Alsatex',
          unidadMedida: 'KG',
          idCategoria: categoriaFelpa,
          idComposicion: composicion.id,
          idProveedor: proveedorAlsatex,
          nombreProveedor: 'Felpa Suiza',
          nombreCuerpo: 'Felpa',
          nombreComplemento: 'Cardigan',
          colores: [
            { nombre: 'Negro', precio: 95, precioComplemento: 60, pantone: '19-4005 TCX' },
            { nombre: 'Blanco' },
          ],
        },
        bd(),
      );

      expect(tela).toMatchObject({
        idComposicion: composicion.id,
        idProveedor: proveedorAlsatex,
        nombreProveedor: 'Felpa Suiza',
        nombreCuerpo: 'Felpa',
        nombreComplemento: 'Cardigan',
      });
      expect(tela.composicion?.nombre).toBe('50% Algodón, 50% Poliéster');
      expect(tela.proveedor?.nombre).toBe('Alsatex');

      const negro = tela.colores.find((c) => c.nombre === 'Negro');
      const blanco = tela.colores.find((c) => c.nombre === 'Blanco');
      expect(negro?.precio?.toNumber()).toBe(95);
      expect(negro?.precioComplemento?.toNumber()).toBe(60);
      expect(negro?.pantone).toBe('19-4005 TCX');
      expect(blanco?.precio).toBeNull();
      expect(blanco?.precioComplemento).toBeNull();
      expect(blanco?.pantone).toBeNull();

      // El endpoint suelto de colores también expone los datos nuevos.
      const colores = await listarColoresDeTela(sesion, tela.id, bd());
      expect(colores.find((c) => c.nombre === 'Negro')?.pantone).toBe('19-4005 TCX');
      expect(colores.find((c) => c.nombre === 'Negro')?.precioComplemento?.toNumber()).toBe(60);
    });

    it('el alta SIN proveedor se RECHAZA (contrato §Post-F9.11) y no crea nada', async () => {
      await expect(
        // El TIPO estricto ya no deja omitir el proveedor (H8): se fuerza para probar
        // que el RUNTIME también lo rechaza (defensa en profundidad).
        crearTela(
          sesionAdmin(),
          { nombre: 'Sin dueño', unidadMedida: 'KG', colores: [] } as never,
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      expect(await cliente.tela.count({ where: { nombre: 'Sin dueño' } })).toBe(0);
    });

    it('rechaza proveedor inexistente o desactivado → ErrorValidacion', async () => {
      const sesion = sesionAdmin();
      await expect(
        crearTela(
          sesion,
          { nombre: 'Fantasma', unidadMedida: 'KG', idProveedor: 999999, colores: [] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);

      await cliente.proveedor.update({
        where: { id: proveedorAlsatex },
        data: { activo: false },
      });
      await expect(
        crearTela(
          sesion,
          { nombre: 'Apagado', unidadMedida: 'KG', idProveedor: proveedorAlsatex, colores: [] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza composición inexistente o desactivada → ErrorValidacion', async () => {
      const sesion = sesionAdmin();
      await expect(
        crearTela(
          sesion,
          {
            nombre: 'Sin comp',
            unidadMedida: 'KG',
            idProveedor: proveedorAlsatex,
            idComposicion: 999999,
            colores: [],
          },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);

      const composicion = await crearComposicionTela(sesion, { nombre: 'Lino' }, bd());
      await desactivarComposicionTela(sesion, composicion.id, bd());
      await expect(
        crearTela(
          sesion,
          {
            nombre: 'Comp apagada',
            unidadMedida: 'KG',
            idProveedor: proveedorAlsatex,
            idComposicion: composicion.id,
            colores: [],
          },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('el modo MIGRACIÓN sí crea sin proveedor (telas viejas), y editarla no lo exige', async () => {
      const sesion = sesionAdmin();
      // Así nacen las 877 migradas: sin proveedor dueño (el viejo no lo traía como campo).
      const migrada = await crearTelaMigracion(
        sesion,
        { nombre: 'FelpaAlsa100', unidadMedida: 'KG', colores: [] },
        bd(),
      );
      expect(migrada.idProveedor).toBeNull();

      // Editar una migrada SIN mandar proveedor funciona (no se exige en edición).
      const editada = await actualizarTela(
        sesion,
        { id: migrada.id, descripcion: 'depurando' },
        bd(),
      );
      expect(editada.descripcion).toBe('depurando');
      expect(editada.idProveedor).toBeNull();

      // Y ponérselo después (la depuración) también funciona.
      const conDueno = await actualizarTela(
        sesion,
        { id: migrada.id, idProveedor: proveedorAlsatex },
        bd(),
      );
      expect(conDueno.idProveedor).toBe(proveedorAlsatex);
      expect(conDueno.proveedor?.nombre).toBe('Alsatex');
    });

    it('el complemento se declara, se edita y se VACÍA con null/"" (PATCH M1)', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        {
          nombre: 'Felpa con cardigan',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          nombreCuerpo: 'Felpa',
          nombreComplemento: 'Cardigan',
          colores: [],
        },
        bd(),
      );
      expect(tela.nombreComplemento).toBe('Cardigan');

      // '' vacía el complemento (se guarda null, nunca ''): la tela deja de llevarlo.
      const sinComplemento = await actualizarTela(
        sesion,
        { id: tela.id, nombreComplemento: '' },
        bd(),
      );
      expect(sinComplemento.nombreComplemento).toBeNull();
      const enBd = await cliente.tela.findUniqueOrThrow({ where: { id: tela.id } });
      expect(enBd.nombreComplemento).toBeNull();
    });

    it('actualiza pantone y precio del complemento de un color existente (diff del grid)', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        {
          nombre: 'Felpa',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          nombreComplemento: 'Cardigan',
          colores: [{ nombre: 'Negro', precio: 90 }],
        },
        bd(),
      );
      const actualizada = await actualizarTela(
        sesion,
        {
          id: tela.id,
          colores: [{ nombre: 'Negro', precio: 90, precioComplemento: 55, pantone: '19-0303 TCX' }],
        },
        bd(),
      );
      const negro = actualizada.colores.find((c) => c.nombre === 'Negro');
      expect(negro?.precio?.toNumber()).toBe(90);
      expect(negro?.precioComplemento?.toNumber()).toBe(55);
      expect(negro?.pantone).toBe('19-0303 TCX');
    });

    // H2 (invariante A1): el precio del complemento SOLO existe si la tela lo lleva.
    it('RECHAZA precio de complemento si la tela NO lleva complemento (alta y edición)', async () => {
      const sesion = sesionAdmin();
      await expect(
        crearTela(
          sesion,
          {
            nombre: 'Lisa',
            unidadMedida: 'KG',
            idProveedor: proveedorAlsatex,
            colores: [{ nombre: 'Negro', precioComplemento: 55 }],
          },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      expect(await cliente.tela.count({ where: { nombre: 'Lisa' } })).toBe(0);

      const sinComplemento = await crearTela(
        sesion,
        {
          nombre: 'Lisa 2',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          colores: [{ nombre: 'Negro' }],
        },
        bd(),
      );
      await expect(
        actualizarTela(
          sesion,
          { id: sinComplemento.id, colores: [{ nombre: 'Negro', precioComplemento: 55 }] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);

      // Y si la MISMA edición declara el complemento, entonces SÍ se acepta.
      const conAmbos = await actualizarTela(
        sesion,
        {
          id: sinComplemento.id,
          nombreComplemento: 'Cardigan',
          colores: [{ nombre: 'Negro', precioComplemento: 55 }],
        },
        bd(),
      );
      expect(conAmbos.colores[0]?.precioComplemento?.toNumber()).toBe(55);
    });

    it('al DEJAR de llevar complemento se LIMPIA el precio del complemento de TODOS sus colores', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        {
          nombre: 'Felpa con cardigan 2',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          nombreComplemento: 'Cardigan',
          colores: [
            { nombre: 'Negro', precio: 90, precioComplemento: 55 },
            { nombre: 'Blanco', precioComplemento: 40 },
          ],
        },
        bd(),
      );

      // Se desmarca el complemento SIN mandar colores: la limpieza corre igual (misma tx).
      const sinComplemento = await actualizarTela(
        sesion,
        { id: tela.id, nombreComplemento: null },
        bd(),
      );
      expect(sinComplemento.nombreComplemento).toBeNull();
      expect(sinComplemento.colores.every((c) => c.precioComplemento === null)).toBe(true);
      // Y en la BASE (no solo la proyección): cero precios de complemento colgando.
      expect(
        await cliente.telaColor.count({
          where: { idTela: tela.id, precioComplemento: { not: null } },
        }),
      ).toBe(0);
      // El precio del CUERPO no se tocó.
      expect(
        (
          await cliente.telaColor.findFirstOrThrow({
            where: { idTela: tela.id, nombre: 'Negro' },
          })
        ).precio?.toNumber(),
      ).toBe(90);
    });
  });

  describe('liga legacy y reconciliación del ETL (§Post-F9.11, R2-1/R2-3)', () => {
    it('editar un color migrado con OTRO casing conserva su id y su LIGA legacy (update en sitio)', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        {
          nombre: 'Felpa migrada',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          colores: [{ nombre: 'Negro', precio: 90 }],
        },
        bd(),
      );
      // Se simula la fila MIGRADA: liga legacy puesta a mano (como la deja el ETL).
      await cliente.telaColor.updateMany({
        where: { idTela: tela.id, nombre: 'Negro' },
        data: { idColor: colorPrendaBlanco },
      });
      const fila = await cliente.telaColor.findFirstOrThrow({
        where: { idTela: tela.id, nombre: 'Negro' },
      });

      // Re-mandar el MISMO color con otro casing + otro precio/pantone: es la rama
      // `aActualizar` (la llave del diff es el nombre NORMALIZADO). Si el diff comparara
      // sin minúsculas, esto sería delete+create: id NUEVO y liga PERDIDA — la mutación
      // que esta prueba existe para matar (R2-3).
      const editada = await actualizarTela(
        sesion,
        { id: tela.id, colores: [{ nombre: 'NEGRO', precio: 99, pantone: '19-4005 TCX' }] },
        bd(),
      );

      const tras = await cliente.telaColor.findUniqueOrThrow({ where: { id: fila.id } });
      expect(tras.id).toBe(fila.id); // MISMA fila (update en sitio, no delete+create)
      expect(tras.idColor).toBe(colorPrendaBlanco); // la liga legacy SOBREVIVE
      expect(tras.nombre).toBe('NEGRO'); // el casing sí se corrigió
      expect(tras.precio?.toNumber()).toBe(99);
      expect(tras.pantone).toBe('19-4005 TCX');
      expect(editada.colores).toHaveLength(1);
    });

    // R3-1: con el `id` de la fila, un RENOMBRE REAL (no de casing) es update en sitio.
    it('renombrar de verdad un color migrado CON su id conserva la fila y su LIGA legacy', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTela(
        sesion,
        {
          nombre: 'Felpa renombrable',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          colores: [{ nombre: 'Marino', precio: 57, pantone: '19-4024 TCX' }, { nombre: 'Blanco' }],
        },
        bd(),
      );
      // Se simula la fila MIGRADA: liga legacy puesta a mano (como la deja el ETL).
      await cliente.telaColor.updateMany({
        where: { idTela: tela.id, nombre: 'Marino' },
        data: { idColor: colorPrendaBlanco },
      });
      const fila = await cliente.telaColor.findFirstOrThrow({
        where: { idTela: tela.id, nombre: 'Marino' },
      });
      const blanco = await cliente.telaColor.findFirstOrThrow({
        where: { idTela: tela.id, nombre: 'Blanco' },
      });

      // Renombre REAL (la clave normalizada CAMBIA): sin el `id` esto sería quitar+crear y
      // la liga se perdería en silencio — el hallazgo R3-1. El pantone viaja en el payload
      // porque el grid es reemplazo completo (así lo manda la UI real vía `aColoresCuerpo`);
      // lo que R3-1 garantiza conservar es la FILA (id/liga/auditoría), no campos omitidos.
      const editada = await actualizarTela(
        sesion,
        {
          id: tela.id,
          colores: [
            { id: fila.id, nombre: 'Marino Alsa 3040', precio: 60, pantone: '19-4024 TCX' },
            { id: blanco.id, nombre: 'Blanco' },
          ],
        },
        bd(),
      );

      const tras = await cliente.telaColor.findUniqueOrThrow({ where: { id: fila.id } });
      expect(tras.nombre).toBe('Marino Alsa 3040'); // el nombre nuevo entró
      expect(tras.idColor).toBe(colorPrendaBlanco); // la liga legacy SOBREVIVE
      expect(tras.pantone).toBe('19-4024 TCX'); // el pantone del payload (reemplazo completo)
      expect(tras.precio?.toNumber()).toBe(60);
      // No hubo quitar+crear: siguen siendo las MISMAS dos filas.
      expect(editada.colores.map((c) => c.id).sort()).toEqual([fila.id, blanco.id].sort());
      // Y el filtro LEGACY sigue encontrando la tela (la liga no se perdió).
      const filtrada = await listarTelas(sesion, { idColor: colorPrendaBlanco }, bd());
      expect(filtrada.datos.some((t) => t.id === tela.id)).toBe(true);
    });

    it('un `id` de color que NO pertenece a esa tela se RECHAZA (nunca en silencio)', async () => {
      const sesion = sesionAdmin();
      const una = await crearTela(
        sesion,
        {
          nombre: 'Tela una',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          colores: [{ nombre: 'Negro' }],
        },
        bd(),
      );
      const otra = await crearTela(
        sesion,
        {
          nombre: 'Tela otra',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          colores: [{ nombre: 'Rojo' }],
        },
        bd(),
      );
      const ajena = await cliente.telaColor.findFirstOrThrow({ where: { idTela: otra.id } });

      await expect(
        actualizarTela(sesion, { id: una.id, colores: [{ id: ajena.id, nombre: 'Robado' }] }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      // La fila ajena quedó intacta en SU tela.
      const intacta = await cliente.telaColor.findUniqueOrThrow({ where: { id: ajena.id } });
      expect(intacta.idTela).toBe(otra.id);
      expect(intacta.nombre).toBe('Rojo');
    });

    // R2-1 (lección del PR #153): re-correr el ETL NO borra la depuración manual.
    it('reconciliar (ETL) conserva la depuración manual y solo actualiza el precio del CSV', async () => {
      const sesion = sesionAdmin();
      // 1ª corrida del ETL: la tela migrada nace con su color del CSV, ligado.
      const tela = await crearTelaMigracion(
        sesion,
        { nombre: 'FelpaAlsa200', unidadMedida: 'KG', colores: [] },
        bd(),
      );
      await reconciliarColoresTelaMigracion(
        sesion,
        { id: tela.id, colores: [{ nombre: 'marino', precio: 57 }] },
        bd(),
      );
      await cliente.telaColor.updateMany({
        where: { idTela: tela.id },
        data: { idColor: colorPrendaBlanco }, // la liga que el loader fija data-only
      });

      // DEPURACIÓN manual: complemento declarado, casing corregido, pantone y precio del
      // complemento capturados, y un color agregado a mano que el CSV no conoce.
      await actualizarTela(sesion, { id: tela.id, nombreComplemento: 'Cardigan' }, bd());
      const migrada = await cliente.telaColor.findFirstOrThrow({
        where: { idTela: tela.id },
      });
      await cliente.telaColor.update({
        where: { id: migrada.id },
        data: { nombre: 'Marino', pantone: '19-4024 TCX', precioComplemento: 40 },
      });
      await cliente.telaColor.create({
        data: { idTela: tela.id, nombre: 'Agregado a mano', precio: 10 },
      });

      // 2ª corrida del ETL con el MISMO CSV pero precio nuevo (crudo, en minúsculas).
      const tras2 = await reconciliarColoresTelaMigracion(
        sesion,
        { id: tela.id, colores: [{ nombre: 'marino', precio: 60 }] },
        bd(),
      );

      // TODO lo depurado se conserva; SOLO el precio del CSV se actualizó.
      expect(tras2.colores).toHaveLength(2);
      const marino = await cliente.telaColor.findUniqueOrThrow({ where: { id: migrada.id } });
      expect(marino.nombre).toBe('Marino'); // el casing corregido NO se pisa con el crudo
      expect(marino.pantone).toBe('19-4024 TCX');
      expect(marino.precioComplemento?.toNumber()).toBe(40);
      expect(marino.idColor).toBe(colorPrendaBlanco); // la liga sobrevive
      expect(marino.precio?.toNumber()).toBe(60); // el precio del CSV SÍ entra
      // El color agregado a mano NO se borró (antes iría a `aQuitar`).
      expect(
        await cliente.telaColor.count({ where: { idTela: tela.id, nombre: 'Agregado a mano' } }),
      ).toBe(1);

      // 3ª corrida idéntica: idempotente — no escribe nada ni deja bitácora nueva.
      const bitacorasAntes = await cliente.bitacora.count();
      await reconciliarColoresTelaMigracion(
        sesion,
        { id: tela.id, colores: [{ nombre: 'marino', precio: 60 }] },
        bd(),
      );
      expect(await cliente.bitacora.count()).toBe(bitacorasAntes);
    });

    it('reconciliar crea las claves NUEVAS del CSV sin tocar las demás filas', async () => {
      const sesion = sesionAdmin();
      const tela = await crearTelaMigracion(
        sesion,
        { nombre: 'FelpaAlsa300', unidadMedida: 'KG', colores: [] },
        bd(),
      );
      await reconciliarColoresTelaMigracion(
        sesion,
        { id: tela.id, colores: [{ nombre: 'Negro', precio: 50 }] },
        bd(),
      );
      const tras = await reconciliarColoresTelaMigracion(
        sesion,
        {
          id: tela.id,
          colores: [
            { nombre: 'Negro', precio: 50 },
            { nombre: 'Blanco', precio: 45 },
          ],
        },
        bd(),
      );
      expect(tras.colores.map((c) => c.nombre).sort()).toEqual(['Blanco', 'Negro']);
      // La nueva nace SIN liga (la pone el paso data-only del loader).
      const blanco = await cliente.telaColor.findFirstOrThrow({
        where: { idTela: tela.id, nombre: 'Blanco' },
      });
      expect(blanco.idColor).toBeNull();
      expect(blanco.precio?.toNumber()).toBe(45);
    });
  });

  describe('búsqueda ampliada (nombre propio, nombre del proveedor, proveedor, color, pantone)', () => {
    it('encuentra por PANTONE, por nombre del proveedor y por nombre DEL PROVEEDOR (el tercero)', async () => {
      const sesion = sesionAdmin();
      await crearTela(
        sesion,
        {
          nombre: 'Felpa pesada',
          unidadMedida: 'KG',
          idProveedor: proveedorAlsatex,
          nombreProveedor: 'Felpa Suiza',
          colores: [{ nombre: 'Negro', pantone: '19-4005 TCX' }],
        },
        bd(),
      );
      const otroProveedor = await cliente.proveedor.create({ data: { nombre: 'Texmex' } });
      await crearTela(
        sesion,
        {
          nombre: 'Jersey liviano',
          unidadMedida: 'M',
          idProveedor: otroProveedor.id,
          colores: [{ nombre: 'Blanco' }],
        },
        bd(),
      );

      // Por pantone (el nombre de la tela no dice nada de "4005").
      const porPantone = await listarTelas(sesion, { busqueda: '19-4005' }, bd());
      expect(porPantone.total).toBe(1);
      expect(porPantone.datos[0]?.nombre).toBe('Felpa pesada');

      // Por el nombre que le da el proveedor ("suiza").
      const porNombreProveedor = await listarTelas(sesion, { busqueda: 'suiza' }, bd());
      expect(porNombreProveedor.total).toBe(1);
      expect(porNombreProveedor.datos[0]?.nombre).toBe('Felpa pesada');

      // Por el nombre del PROVEEDOR dueño ("alsatex").
      const porProveedor = await listarTelas(sesion, { busqueda: 'alsatex' }, bd());
      expect(porProveedor.total).toBe(1);
      expect(porProveedor.datos[0]?.nombre).toBe('Felpa pesada');

      // La paginación no se descuadra: una tela con varios pegues sigue siendo UNA fila.
      const porTexmex = await listarTelas(sesion, { busqueda: 'texmex' }, bd());
      expect(porTexmex.total).toBe(1);
      expect(porTexmex.datos[0]?.nombre).toBe('Jersey liviano');
      expect((await listarTelas(sesion, { busqueda: 'zzz' }, bd())).total).toBe(0);
    });
  });
});
