/**
 * Tests de integración del CRUD de Tipos de proceso (F3-E1). Postgres efímero (testcontainers).
 * Cubre el patrón CRUD + la regla de la bandera `generaEntradaPt` editable SOLO por admin
 * (decisión (e)): un `tipos-proceso.administrar` SIN `roles.administrar` no puede tocarla.
 */
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
  actualizarTipoProceso,
  crearTipoProceso,
  desactivarTipoProceso,
  listarTiposProceso,
  obtenerTipoProceso,
  reactivarTipoProceso,
} from './tipos-proceso.js';

let cliente: PrismaClient;

/** Admin total: tiene `roles.administrar` → puede editar `generaEntradaPt`. */
const sesionAdmin = () =>
  sesionDePrueba({
    permisos: ['tipos-proceso.ver', 'tipos-proceso.administrar', 'roles.administrar'],
  });
/** Administra el catálogo pero NO es admin total → NO puede tocar `generaEntradaPt`. */
const sesionGestor = () =>
  sesionDePrueba({ permisos: ['tipos-proceso.ver', 'tipos-proceso.administrar'] });

const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
});

describe('CRUD Tipos de proceso (F3-E1, CRUD patrón)', () => {
  describe('permisos (PLANMAESTRO §9.2)', () => {
    it('sin permiso no se puede ni leer ni escribir', async () => {
      const sin = sesionDePrueba();
      await expect(
        crearTipoProceso(sin, { codigo: 'x', nombre: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarTiposProceso(sin, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({ permisos: ['tipos-proceso.ver'] });
      await expect(
        crearTipoProceso(soloVer, { codigo: 'x', nombre: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarTiposProceso(soloVer, {}, bd())).resolves.toBeTruthy();
    });
  });

  describe('crear', () => {
    it('crea con default generaEntradaPt=false y bitácora (A7)', async () => {
      const sesion = sesionAdmin();
      const tipo = await crearTipoProceso(sesion, { codigo: 'lavado', nombre: 'Lavado' }, bd());
      expect(tipo).toMatchObject({ codigo: 'lavado', generaEntradaPt: false, activo: true });
      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'TipoProceso', idEntidad: String(tipo.id), accion: 'CREAR' },
      });
    });

    it('un ADMIN sí puede crear con generaEntradaPt=true (decisión (e))', async () => {
      const tipo = await crearTipoProceso(
        sesionAdmin(),
        { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
        bd(),
      );
      expect(tipo.generaEntradaPt).toBe(true);
    });

    it('un GESTOR (no admin) NO puede fijar generaEntradaPt: queda en false', async () => {
      const tipo = await crearTipoProceso(
        sesionGestor(),
        { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
        bd(),
      );
      expect(tipo.generaEntradaPt).toBe(false); // el servidor descarta la bandera para no-admin
    });

    it('rechaza código duplicado → ErrorConflicto', async () => {
      // Unicidad REAL: el mismo código válido (lowercase) creado dos veces → conflicto.
      await crearTipoProceso(
        sesionAdmin(),
        { codigo: 'proceso-dup-test', nombre: 'Proceso dup' },
        bd(),
      );
      await expect(
        crearTipoProceso(sesionAdmin(), { codigo: 'proceso-dup-test', nombre: 'Otra' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('rechaza código en mayúsculas → ErrorValidacion (el código es lowercase-only por diseño)', async () => {
      // El `codigo` valida con regex `^[a-z][a-z0-9-]*$`: las mayúsculas se rechazan ANTES de la
      // comprobación de unicidad. Documenta que minúsculas-only es el diseño correcto.
      await expect(
        crearTipoProceso(sesionAdmin(), { codigo: 'COSTURA', nombre: 'Costura' }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });
  });

  describe('actualizar', () => {
    it('un GESTOR puede cambiar el nombre pero NO la bandera', async () => {
      const tipo = await crearTipoProceso(
        sesionAdmin(),
        { codigo: 'costura', nombre: 'Costura', generaEntradaPt: true },
        bd(),
      );
      const actualizado = await actualizarTipoProceso(
        sesionGestor(),
        { id: tipo.id, nombre: 'Costura premium', generaEntradaPt: false },
        bd(),
      );
      expect(actualizado.nombre).toBe('Costura premium');
      expect(actualizado.generaEntradaPt).toBe(true); // la bandera NO cambió (no es admin)
    });

    it('un ADMIN sí cambia la bandera y queda en bitácora', async () => {
      const tipo = await crearTipoProceso(
        sesionAdmin(),
        { codigo: 'estampado', nombre: 'Estampado' },
        bd(),
      );
      const actualizado = await actualizarTipoProceso(
        sesionAdmin(),
        { id: tipo.id, generaEntradaPt: true },
        bd(),
      );
      expect(actualizado.generaEntradaPt).toBe(true);
      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'TipoProceso', idEntidad: String(tipo.id), accion: 'MODIFICAR' },
      });
      expect(bitacora.datos).toMatchObject({ generaEntradaPt: { de: false, a: true } });
    });

    it('sin cambio real es idempotente: no escribe bitácora', async () => {
      const tipo = await crearTipoProceso(
        sesionAdmin(),
        { codigo: 'costura', nombre: 'Costura' },
        bd(),
      );
      const antes = await cliente.bitacora.count();
      await actualizarTipoProceso(sesionAdmin(), { id: tipo.id, nombre: 'Costura' }, bd());
      expect(await cliente.bitacora.count()).toBe(antes);
    });

    it('un id inexistente → ErrorNoEncontrado', async () => {
      await expect(
        actualizarTipoProceso(sesionAdmin(), { id: 9999, nombre: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  describe('desactivar / reactivar (borrado suave)', () => {
    it('desactiva, conserva el registro y reserva el código', async () => {
      const sesion = sesionAdmin();
      const tipo = await crearTipoProceso(sesion, { codigo: 'lavado', nombre: 'Lavado' }, bd());
      const desactivado = await desactivarTipoProceso(sesion, tipo.id, bd());
      expect(desactivado.activo).toBe(false);
      expect(await cliente.tipoProceso.count()).toBe(1);
      await expect(
        crearTipoProceso(sesion, { codigo: 'lavado', nombre: 'Otro' }, bd()),
      ).rejects.toThrow(/desactivado.*reactivarlo/);
      const reactivado = await reactivarTipoProceso(sesion, tipo.id, bd());
      expect(reactivado.activo).toBe(true);
    });
  });

  describe('obtener / listar', () => {
    it('obtiene por id o lanza, y lista con búsqueda/orden/paginación', async () => {
      const sesion = sesionAdmin();
      const costura = await crearTipoProceso(
        sesion,
        { codigo: 'costura', nombre: 'Costura' },
        bd(),
      );
      await crearTipoProceso(sesion, { codigo: 'bordado', nombre: 'Bordado' }, bd());
      const lavado = await crearTipoProceso(sesion, { codigo: 'lavado', nombre: 'Lavado' }, bd());
      await desactivarTipoProceso(sesion, lavado.id, bd());

      expect((await obtenerTipoProceso(sesion, costura.id, bd())).codigo).toBe('costura');
      await expect(obtenerTipoProceso(sesion, 9999, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );

      expect((await listarTiposProceso(sesion, {}, bd())).total).toBe(2); // solo activos
      expect((await listarTiposProceso(sesion, { incluirInactivos: true }, bd())).total).toBe(3);
      expect((await listarTiposProceso(sesion, { busqueda: 'cost' }, bd())).total).toBe(1);
    });
  });
});

/**
 * V1-E3f (§Post-F9.58) — este catálogo es AHORA también el de TIPOS DE ARTE (Daniel: *"De acuerdo.
 * Y un solo catálogo."*). Lo que se cuida aquí:
 *  • el filtro `soloArte` (lo que ve la pantalla de captura del arte);
 *  • que `esArte`/`usaPuntadas` las pueda fijar quien administra el catálogo, SIN ser admin total
 *    (a diferencia de `generaEntradaPt`, que sí mueve inventario);
 *  • el `codigoRolProveedor` que ACOTA el selector de proveedores del arte — y su degradado con
 *    gracia cuando no hay rol homónimo (§Post-F9.54, principio del "proceso raro").
 */
describe('catálogo ÚNICO: proceso y arte (V1-E3f)', () => {
  it('`soloArte` deja fuera a los procesos que NO son arte (la costura)', async () => {
    await crearTipoProceso(sesionAdmin(), { codigo: 'costura', nombre: 'Costura' }, bd());
    await crearTipoProceso(
      sesionAdmin(),
      { codigo: 'bordado', nombre: 'Bordado', esArte: true, usaPuntadas: true },
      bd(),
    );

    const todos = await listarTiposProceso(sesionAdmin(), {}, bd());
    expect(todos.total).toBe(2);

    const soloArte = await listarTiposProceso(sesionAdmin(), { soloArte: true }, bd());
    expect(soloArte.datos.map((t) => t.codigo)).toEqual(['bordado']);
    expect(soloArte.datos[0]?.usaPuntadas).toBe(true);
  });

  it('un GESTOR (sin admin total) SÍ puede fijar y cambiar esArte/usaPuntadas', async () => {
    const creado = await crearTipoProceso(
      sesionGestor(),
      { codigo: 'embosado', nombre: 'Embosado', esArte: true, usaPuntadas: false },
      bd(),
    );
    // A diferencia de `generaEntradaPt`, que el servidor le descarta por no ser admin total.
    expect(creado).toMatchObject({ esArte: true, usaPuntadas: false, generaEntradaPt: false });

    const editado = await actualizarTipoProceso(
      sesionGestor(),
      { id: creado.id, usaPuntadas: true },
      bd(),
    );
    expect(editado.usaPuntadas).toBe(true);

    // Y el cambio queda en la bitácora con su de→a (A7).
    const bitacora = await cliente.bitacora.findFirstOrThrow({
      where: { entidad: 'TipoProceso', idEntidad: String(creado.id), accion: 'MODIFICAR' },
      orderBy: { id: 'desc' },
    });
    expect(bitacora.datos).toMatchObject({ usaPuntadas: { de: false, a: true } });
  });

  it('`codigoRolProveedor` sale del rol ACTIVO homónimo, y es null si no lo hay', async () => {
    await cliente.rolProveedor.create({ data: { codigo: 'bordado', nombre: 'Bordador' } });
    await cliente.rolProveedor.create({
      data: { codigo: 'lavado', nombre: 'Lavandería', activo: false },
    });
    const bordado = await crearTipoProceso(
      sesionAdmin(),
      { codigo: 'bordado', nombre: 'Bordado', esArte: true },
      bd(),
    );
    const lavado = await crearTipoProceso(
      sesionAdmin(),
      { codigo: 'lavado', nombre: 'Lavado', esArte: true },
      bd(),
    );
    const raro = await crearTipoProceso(
      sesionAdmin(),
      { codigo: 'embosado', nombre: 'Embosado', esArte: true },
      bd(),
    );

    // Con rol homónimo ACTIVO: el selector de proveedores del arte se acota a ese rol.
    expect(bordado.codigoRolProveedor).toBe('bordado');
    // Rol homónimo DESACTIVADO: no acota (acotar a un rol apagado dejaría la lista vacía).
    expect(lavado.codigoRolProveedor).toBeNull();
    // Proceso raro sin rol propio: degrada con gracia — se ofrecen TODOS los proveedores.
    expect(raro.codigoRolProveedor).toBeNull();

    // Y el listado lo resuelve igual (una sola consulta para toda la página, no N+1).
    const pagina = await listarTiposProceso(sesionAdmin(), { soloArte: true }, bd());
    expect(Object.fromEntries(pagina.datos.map((t) => [t.codigo, t.codigoRolProveedor]))).toEqual({
      bordado: 'bordado',
      lavado: null,
      embosado: null,
    });
    expect(await obtenerTipoProceso(sesionAdmin(), bordado.id, bd())).toMatchObject({
      codigoRolProveedor: 'bordado',
    });
  });
});
