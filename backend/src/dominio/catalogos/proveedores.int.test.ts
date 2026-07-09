import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import type { ServicioArchivos } from '../../comun/archivos.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarProveedor,
  agregarAdjuntoProveedor,
  asignarAvioProveedor,
  crearProveedor,
  desactivarProveedor,
  listarAdjuntosProveedor,
  listarAviosDeProveedor,
  listarProveedores,
  listarRolesProveedor,
  obtenerProveedor,
  quitarAdjuntoProveedor,
  quitarAvioProveedor,
  reactivarProveedor,
} from './proveedores.js';

let cliente: PrismaClient;

const sesionAdmin = () =>
  sesionDePrueba({ permisos: ['proveedores.ver', 'proveedores.administrar'] });

const bd = () => ({ cliente });

// Ids de roles sembrados en cada test (se rellenan en beforeEach).
let rolMaquila: number;
let rolCorte: number;
let rolEstampado: number;

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  // Roles de proveedor base (los necesita el alta: el dominio exige ≥1).
  const maquila = await cliente.rolProveedor.create({
    data: { codigo: 'maquila-costura', nombre: 'Maquila (costura)' },
  });
  const corte = await cliente.rolProveedor.create({ data: { codigo: 'corte', nombre: 'Corte' } });
  const estampado = await cliente.rolProveedor.create({
    data: { codigo: 'estampado-aplicacion', nombre: 'Estampado / aplicación' },
  });
  rolMaquila = maquila.id;
  rolCorte = corte.id;
  rolEstampado = estampado.id;
});

/**
 * Fake del servicio de archivos: NO toca R2, pero SÍ crea el registro `Archivo` en
 * la transacción (igual que el real) para que `ProveedorArchivo` tenga su FK. Las
 * URLs son ficticias. Reemplaza al `servicioArchivos()` real en los tests.
 */
function archivosFalsos(): ServicioArchivos {
  return {
    async solicitarSubida(tx, sesion, solicitud) {
      const key = `proveedores/fake/${solicitud.nombreOriginal}`;
      const archivo = await tx.archivo.create({
        data: {
          bucket: 'control-v2-prueba',
          key,
          nombreOriginal: solicitud.nombreOriginal,
          tipoMime: solicitud.tipoMime,
          tamanoBytes: solicitud.tamanoBytes,
          subidoPorId: sesion.id,
        },
        select: {
          id: true,
          bucket: true,
          key: true,
          nombreOriginal: true,
          tipoMime: true,
          tamanoBytes: true,
        },
      });
      return { archivo, urlSubida: `https://r2.fake/put/${key}`, expiraEnSegundos: 900 };
    },
    urlDescarga(key) {
      return Promise.resolve(`https://r2.fake/get/${key}`);
    },
    eliminarObjeto() {
      return Promise.resolve();
    },
  };
}

describe('Catálogo Proveedores enriquecido (F1-E1B, R15 — global ADR-0007)', () => {
  describe('permisos en servidor (PLANMAESTRO §9.2)', () => {
    it('sin permiso no se puede ni leer ni escribir', async () => {
      const sinPermisos = sesionDePrueba();
      await expect(
        crearProveedor(sinPermisos, { nombre: 'X', tipo: 'TELAS', roles: [rolMaquila] }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarProveedores(sinPermisos, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarRolesProveedor(sinPermisos, {}, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({ permisos: ['proveedores.ver'] });
      await expect(
        crearProveedor(soloVer, { nombre: 'X', tipo: 'TELAS', roles: [rolMaquila] }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarProveedores(soloVer, {}, bd())).resolves.toBeTruthy();
      await expect(listarRolesProveedor(soloVer, {}, bd())).resolves.toBeTruthy();
    });
  });

  describe('crear (con roles y campos enriquecidos, transacción A2)', () => {
    it('crea con roles, campos fiscales/comerciales, auditoría y bitácora (A7)', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        {
          nombre: 'Maquilas del Norte',
          tipo: 'SERVICIOS',
          telefono: '555-1234',
          roles: [rolMaquila, rolCorte],
          factura: true,
          rfc: 'MNO010101AB1',
          regimenFiscalSat: '601',
          usoCfdiHabitual: 'G03',
          codigoPostalExpedicion: '54000',
          retieneIva: true,
          email: 'compras@maquilas.mx',
          diasCredito: 30,
          moneda: 'MXN',
          metodoPago: 'PPD',
          clabe: '002010077777777771',
          limiteCredito: 50000,
          leadTimeDias: 12,
        },
        bd(),
      );

      expect(proveedor).toMatchObject({
        nombre: 'Maquilas del Norte',
        tipo: 'SERVICIOS',
        factura: true,
        rfc: 'MNO010101AB1',
        regimenFiscalSat: '601',
        diasCredito: 30,
        moneda: 'MXN',
        metodoPago: 'PPD',
        leadTimeDias: 12,
        activo: true,
        creadoPorId: sesion.id,
      });
      expect(Number(proveedor.limiteCredito)).toBe(50000);
      expect(proveedor.roles.map((r) => r.rol.codigo).sort()).toEqual(['corte', 'maquila-costura']);
      expect(proveedor._count.archivos).toBe(0);

      // El renglón puente ProveedorRol existe (transacción A2: o todo o nada).
      expect(await cliente.proveedorRol.count({ where: { idProveedor: proveedor.id } })).toBe(2);

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Proveedor', idEntidad: String(proveedor.id), accion: 'CREAR' },
      });
      expect(bitacora.idUsuario).toBe(sesion.id);
    });

    it('exige al menos un rol (R15): alta sin roles → ErrorValidacion', async () => {
      await expect(
        crearProveedor(sesionAdmin(), { nombre: 'Sin rol', tipo: 'TELAS' }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      await expect(
        crearProveedor(sesionAdmin(), { nombre: 'Sin rol', tipo: 'TELAS', roles: [] }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('regla factura ⇒ RFC + régimen (regla de captura): falta RFC → ErrorValidacion', async () => {
      await expect(
        crearProveedor(
          sesionAdmin(),
          { nombre: 'Factura sin RFC', roles: [rolMaquila], factura: true },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza un rol inexistente → ErrorValidacion (y NO crea el proveedor: A2)', async () => {
      await expect(
        crearProveedor(sesionAdmin(), { nombre: 'Rol fantasma', roles: [999999] }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      expect(await cliente.proveedor.count({ where: { nombre: 'Rol fantasma' } })).toBe(0);
    });

    it('no se puede asignar un rol DESACTIVADO → ErrorValidacion', async () => {
      await cliente.rolProveedor.update({ where: { id: rolEstampado }, data: { activo: false } });
      await expect(
        crearProveedor(sesionAdmin(), { nombre: 'Con rol inactivo', roles: [rolEstampado] }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza nombre duplicado, sin importar mayúsculas → ErrorConflicto', async () => {
      await crearProveedor(
        sesionAdmin(),
        { nombre: 'Textiles SA', tipo: 'TELAS', roles: [rolMaquila] },
        bd(),
      );
      await expect(
        crearProveedor(
          sesionAdmin(),
          { nombre: 'textiles sa', tipo: 'AVIOS', roles: [rolMaquila] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });
  });

  describe('actualizar (roles + campos enriquecidos en una transacción)', () => {
    it('reemplaza el set de roles (diff) en la misma transacción', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        { nombre: 'Taller', roles: [rolMaquila] },
        bd(),
      );

      const actualizado = await actualizarProveedor(
        sesion,
        { id: proveedor.id, roles: [rolCorte, rolEstampado] },
        bd(),
      );
      expect(actualizado.roles.map((r) => r.rol.codigo).sort()).toEqual([
        'corte',
        'estampado-aplicacion',
      ]);
      // El de maquila se quitó, los otros dos se agregaron.
      expect(await cliente.proveedorRol.count({ where: { idProveedor: proveedor.id } })).toBe(2);
    });

    it('en edición los roles no pueden quedar en 0 → ErrorValidacion', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        { nombre: 'Taller', roles: [rolMaquila] },
        bd(),
      );
      await expect(
        actualizarProveedor(sesion, { id: proveedor.id, roles: [] }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      // sigue con su rol original (no se vació)
      expect(await cliente.proveedorRol.count({ where: { idProveedor: proveedor.id } })).toBe(1);
    });

    it('omitir `roles` NO toca los roles existentes', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        { nombre: 'Taller', roles: [rolMaquila, rolCorte] },
        bd(),
      );
      await actualizarProveedor(sesion, { id: proveedor.id, telefono: '555' }, bd());
      expect(await cliente.proveedorRol.count({ where: { idProveedor: proveedor.id } })).toBe(2);
    });

    it('cambia campos enriquecidos con bitácora del detalle', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        { nombre: 'Prov', roles: [rolMaquila], diasCredito: 0 },
        bd(),
      );

      const actualizado = await actualizarProveedor(
        sesion,
        { id: proveedor.id, diasCredito: 45, moneda: 'USD', leadTimeDias: 20 },
        bd(),
      );
      expect(actualizado).toMatchObject({ diasCredito: 45, moneda: 'USD', leadTimeDias: 20 });

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Proveedor', idEntidad: String(proveedor.id), accion: 'MODIFICAR' },
      });
      expect(bitacora.datos).toMatchObject({ diasCredito: { de: 0, a: 45 } });
    });

    it('factura ⇒ RFC también aplica en edición', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(sesion, { nombre: 'Prov', roles: [rolMaquila] }, bd());
      await expect(
        actualizarProveedor(sesion, { id: proveedor.id, factura: true }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    // M1: en edición, mandar `null` en un campo opcional ya capturado lo BORRA
    // (lo pone a null). Omitirlo NO lo toca. Nunca se guarda ''.
    it('vaciar un campo opcional (null) en edición lo BORRA; omitirlo no lo toca', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        {
          nombre: 'Con datos',
          roles: [rolMaquila],
          telefono: '555-1234',
          rfc: 'CDA010101AB1',
          diasCredito: 30,
          limiteCredito: 50000,
          moneda: 'MXN',
          notas: 'una nota',
        },
        bd(),
      );

      // Vaciar telefono y diasCredito (null), y NO mandar rfc (omitir = no tocar).
      const actualizado = await actualizarProveedor(
        sesion,
        { id: proveedor.id, telefono: null, diasCredito: null, limiteCredito: null, moneda: null },
        bd(),
      );

      expect(actualizado.telefono).toBeNull();
      expect(actualizado.diasCredito).toBeNull();
      expect(actualizado.limiteCredito).toBeNull();
      expect(actualizado.moneda).toBeNull();
      // rfc y notas NO se tocaron (se omitieron).
      expect(actualizado.rfc).toBe('CDA010101AB1');
      expect(actualizado.notas).toBe('una nota');

      // La bitácora registra el borrado (de: valor, a: null).
      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Proveedor', idEntidad: String(proveedor.id), accion: 'MODIFICAR' },
        orderBy: { fecha: 'desc' },
      });
      expect(bitacora.datos).toMatchObject({ telefono: { de: '555-1234', a: null } });
    });

    it('un texto opcional que llega vacío ("") se normaliza a null (nunca se guarda "")', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        { nombre: 'Prov vacío', roles: [rolMaquila], banco: 'BBVA' },
        bd(),
      );

      // El cuerpo del PATCH acepta '' (texto vacío); el dominio lo guarda como null.
      const actualizado = await actualizarProveedor(sesion, { id: proveedor.id, banco: '' }, bd());
      expect(actualizado.banco).toBeNull();

      // Verificación directa en BD: el valor es null, no ''.
      const enBd = await cliente.proveedor.findUniqueOrThrow({ where: { id: proveedor.id } });
      expect(enBd.banco).toBeNull();
    });

    it('sin cambio real es idempotente: no escribe bitácora', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        { nombre: 'Prov', tipo: 'TELAS', roles: [rolMaquila] },
        bd(),
      );
      const antes = await cliente.bitacora.count();
      await actualizarProveedor(sesion, { id: proveedor.id, nombre: 'Prov', tipo: 'TELAS' }, bd());
      expect(await cliente.bitacora.count()).toBe(antes);
    });

    it('un id inexistente → ErrorNoEncontrado', async () => {
      await expect(
        actualizarProveedor(sesionAdmin(), { id: 9999, nombre: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  describe('desactivar / reactivar (borrado suave, PLANMAESTRO §4)', () => {
    it('desactiva con bitácora DESACTIVAR; el registro sigue existiendo', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(sesion, { nombre: 'Prov', roles: [rolMaquila] }, bd());

      const desactivado = await desactivarProveedor(sesion, proveedor.id, bd());
      expect(desactivado.activo).toBe(false);
      expect(await cliente.proveedor.count()).toBe(1);

      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Proveedor', idEntidad: String(proveedor.id), accion: 'DESACTIVAR' },
      });
    });

    it('desactivar dos veces → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(sesion, { nombre: 'Prov', roles: [rolMaquila] }, bd());
      await desactivarProveedor(sesion, proveedor.id, bd());
      await expect(desactivarProveedor(sesion, proveedor.id, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
    });

    it('reactivar un proveedor desactivado funciona', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(sesion, { nombre: 'Prov', roles: [rolMaquila] }, bd());
      await desactivarProveedor(sesion, proveedor.id, bd());
      const reactivado = await reactivarProveedor(sesion, proveedor.id, bd());
      expect(reactivado.activo).toBe(true);
    });
  });

  describe('obtener', () => {
    it('devuelve el proveedor con sus roles y conteo de adjuntos', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        { nombre: 'Prov', roles: [rolMaquila, rolCorte] },
        bd(),
      );
      const obtenido = await obtenerProveedor(sesion, proveedor.id, bd());
      expect(obtenido.id).toBe(proveedor.id);
      expect(obtenido.roles).toHaveLength(2);
      expect(obtenido._count.archivos).toBe(0);
    });

    it('un id inexistente → ErrorNoEncontrado', async () => {
      await expect(obtenerProveedor(sesionAdmin(), 9999, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
    });
  });

  describe('listar (búsqueda + filtro por tipo Y por rol + paginación)', () => {
    it('filtra por tipo y por rol (ambos coexisten, R15)', async () => {
      const sesion = sesionAdmin();
      await crearProveedor(
        sesion,
        { nombre: 'Telas con maquila', tipo: 'TELAS', roles: [rolMaquila] },
        bd(),
      );
      await crearProveedor(
        sesion,
        { nombre: 'Solo corte', tipo: 'SERVICIOS', roles: [rolCorte] },
        bd(),
      );
      await crearProveedor(
        sesion,
        { nombre: 'Avíos y estampado', tipo: 'AVIOS', roles: [rolEstampado] },
        bd(),
      );

      // Filtro por rol
      expect((await listarProveedores(sesion, { rol: rolCorte }, bd())).total).toBe(1);
      expect((await listarProveedores(sesion, { rol: rolMaquila }, bd())).total).toBe(1);
      // Filtro por tipo (de E1)
      expect((await listarProveedores(sesion, { tipo: 'AVIOS' }, bd())).total).toBe(1);
      // Ambos a la vez: TELAS + rol maquila → 1; SERVICIOS + rol maquila → 0
      expect(
        (await listarProveedores(sesion, { tipo: 'TELAS', rol: rolMaquila }, bd())).total,
      ).toBe(1);
      expect(
        (await listarProveedores(sesion, { tipo: 'SERVICIOS', rol: rolMaquila }, bd())).total,
      ).toBe(0);
    });

    it('cada proveedor del listado trae sus roles', async () => {
      const sesion = sesionAdmin();
      await crearProveedor(
        sesion,
        { nombre: 'Multi', roles: [rolMaquila, rolCorte, rolEstampado] },
        bd(),
      );
      const pagina = await listarProveedores(sesion, {}, bd());
      expect(pagina.datos[0]?.roles).toHaveLength(3);
    });

    it('la busqueda ignora ACENTOS y mayusculas (R2 §4.4.1: "oscar" encuentra a "Oscar")', async () => {
      const sesion = sesionAdmin();
      await crearProveedor(sesion, { nombre: 'Óscar Jiménez', roles: [rolMaquila] }, bd());
      await crearProveedor(sesion, { nombre: 'Óscar Hernández', roles: [rolMaquila] }, bd());
      await crearProveedor(sesion, { nombre: 'Rima Textil', roles: [rolMaquila] }, bd());

      // Sin acento encuentra a los acentuados; con acento también; y el filtro por rol coexiste.
      const sinAcento = await listarProveedores(sesion, { busqueda: 'oscar' }, bd());
      expect(sinAcento.datos.map((p) => p.nombre).sort()).toEqual([
        'Óscar Hernández',
        'Óscar Jiménez',
      ]);
      const conAcento = await listarProveedores(sesion, { busqueda: 'óscar' }, bd());
      expect(conAcento.total).toBe(2);
      // "her" → solo Hernández (el requisito literal de Daniel).
      const her = await listarProveedores(sesion, { busqueda: 'her' }, bd());
      expect(her.datos.map((p) => p.nombre)).toEqual(['Óscar Hernández']);
      // Sin coincidencias → página vacía limpia.
      expect((await listarProveedores(sesion, { busqueda: 'zzz' }, bd())).total).toBe(0);
    });

    it('excluye inactivos por defecto', async () => {
      const sesion = sesionAdmin();
      await crearProveedor(sesion, { nombre: 'Activo', roles: [rolMaquila] }, bd());
      const inactivo = await crearProveedor(
        sesion,
        { nombre: 'Inactivo', roles: [rolMaquila] },
        bd(),
      );
      await desactivarProveedor(sesion, inactivo.id, bd());

      expect((await listarProveedores(sesion, {}, bd())).total).toBe(1);
      expect((await listarProveedores(sesion, { incluirInactivos: true }, bd())).total).toBe(2);
    });
  });

  describe('roles de proveedor (selector R15)', () => {
    it('lista solo los activos por defecto', async () => {
      const sesion = sesionAdmin();
      await cliente.rolProveedor.update({ where: { id: rolEstampado }, data: { activo: false } });
      const activos = await listarRolesProveedor(sesion, {}, bd());
      expect(activos.map((r) => r.codigo)).not.toContain('estampado-aplicacion');
      const todos = await listarRolesProveedor(sesion, { incluirInactivos: true }, bd());
      expect(todos.map((r) => r.codigo)).toContain('estampado-aplicacion');
    });
  });

  describe('datos de taller (fusión de terceros, D12/R15): corto / asegurado / obsPago', () => {
    it('crea un proveedor con corto, asegurado y obsPago', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        {
          nombre: 'Taller con datos',
          tipo: 'SERVICIOS',
          roles: [rolMaquila],
          corto: 'TCD',
          asegurado: true,
          obsPago: 'Paga los viernes',
        },
        bd(),
      );

      expect(proveedor).toMatchObject({
        corto: 'TCD',
        asegurado: true,
        obsPago: 'Paga los viernes',
      });

      // Verificación directa en BD.
      const enBd = await cliente.proveedor.findUniqueOrThrow({ where: { id: proveedor.id } });
      expect(enBd).toMatchObject({ corto: 'TCD', asegurado: true, obsPago: 'Paga los viernes' });
    });

    it('los datos de taller son opcionales: alta sin ellos quedan en null', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        { nombre: 'Sin datos de taller', roles: [rolMaquila] },
        bd(),
      );
      expect(proveedor.corto).toBeNull();
      expect(proveedor.asegurado).toBeNull();
      expect(proveedor.obsPago).toBeNull();
    });

    it('edita corto, asegurado y obsPago con bitácora del detalle', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        { nombre: 'Taller', roles: [rolMaquila], corto: 'OLD', asegurado: false },
        bd(),
      );

      const actualizado = await actualizarProveedor(
        sesion,
        { id: proveedor.id, corto: 'NEW', asegurado: true, obsPago: 'Transferencia' },
        bd(),
      );
      expect(actualizado).toMatchObject({
        corto: 'NEW',
        asegurado: true,
        obsPago: 'Transferencia',
      });

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Proveedor', idEntidad: String(proveedor.id), accion: 'MODIFICAR' },
        orderBy: { fecha: 'desc' },
      });
      expect(bitacora.datos).toMatchObject({
        corto: { de: 'OLD', a: 'NEW' },
        asegurado: { de: false, a: true },
      });
    });

    it('vaciar corto/obsPago en edición (null) los BORRA; "" se normaliza a null', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        {
          nombre: 'Taller a vaciar',
          roles: [rolMaquila],
          corto: 'XYZ',
          asegurado: true,
          obsPago: 'algo',
        },
        bd(),
      );

      // null vacía corto; "" vacía obsPago (el dominio normaliza '' a null).
      const actualizado = await actualizarProveedor(
        sesion,
        { id: proveedor.id, corto: null, obsPago: '' },
        bd(),
      );
      expect(actualizado.corto).toBeNull();
      expect(actualizado.obsPago).toBeNull();

      const enBd = await cliente.proveedor.findUniqueOrThrow({ where: { id: proveedor.id } });
      expect(enBd.corto).toBeNull();
      expect(enBd.obsPago).toBeNull();
    });

    // Blindaje del bug histórico de F1-E1 (`.partial()` + `.default()` reseteaba campos):
    // editar OTRO campo NO debe tocar los datos de taller ya capturados.
    it('editar otro campo NO resetea corto/asegurado/obsPago', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        {
          nombre: 'Taller intacto',
          roles: [rolMaquila],
          corto: 'INT',
          asegurado: true,
          obsPago: 'no me toques',
        },
        bd(),
      );

      // Se edita solo el teléfono; los datos de taller se OMITEN del PATCH.
      const actualizado = await actualizarProveedor(
        sesion,
        { id: proveedor.id, telefono: '555-9999' },
        bd(),
      );
      expect(actualizado.telefono).toBe('555-9999');
      expect(actualizado.corto).toBe('INT');
      expect(actualizado.asegurado).toBe(true);
      expect(actualizado.obsPago).toBe('no me toques');
    });

    it('dos proveedores con corto null NO chocan (unicidad nullable)', async () => {
      const sesion = sesionAdmin();
      // Ambos sin corto: el índice único nullable trata los null como distintos.
      await crearProveedor(sesion, { nombre: 'Sin corto A', roles: [rolMaquila] }, bd());
      await expect(
        crearProveedor(sesion, { nombre: 'Sin corto B', roles: [rolMaquila] }, bd()),
      ).resolves.toBeTruthy();
    });

    it('dos proveedores con el MISMO corto SÍ chocan → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      await crearProveedor(
        sesion,
        { nombre: 'Taller uno', roles: [rolMaquila], corto: 'DUP' },
        bd(),
      );
      await expect(
        crearProveedor(sesion, { nombre: 'Taller dos', roles: [rolMaquila], corto: 'DUP' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });
  });

  describe('adjuntos en R2 (R15 §4, con servicio de archivos FALSO inyectado)', () => {
    it('agrega un adjunto en una transacción: crea Archivo + ProveedorArchivo + bitácora', async () => {
      const sesion = sesionAdmin();
      const archivos = archivosFalsos();
      const proveedor = await crearProveedor(
        sesion,
        { nombre: 'Con docs', roles: [rolMaquila] },
        bd(),
      );

      const subida = await agregarAdjuntoProveedor(
        sesion,
        proveedor.id,
        {
          tipo: 'CONSTANCIA',
          nombreOriginal: 'constancia.pdf',
          tipoMime: 'application/pdf',
          tamanoBytes: 2048,
        },
        bd(),
        archivos,
      );

      expect(subida.idArchivo).toBeTruthy();
      expect(subida.urlSubida).toContain('r2.fake');
      expect(subida.tipo).toBe('CONSTANCIA');

      // Registro Archivo + puente creados.
      expect(await cliente.archivo.count()).toBe(1);
      expect(await cliente.proveedorArchivo.count({ where: { idProveedor: proveedor.id } })).toBe(
        1,
      );

      // El conteo de adjuntos del proveedor refleja el adjunto.
      const recargado = await obtenerProveedor(sesion, proveedor.id, bd());
      expect(recargado._count.archivos).toBe(1);

      // La key se ordena por id del proveedor (carpeta proveedores/<id>), no por nombre.
      const archivo = await cliente.archivo.findFirstOrThrow();
      expect(archivo.key).toContain('constancia.pdf');
    });

    it('lista los adjuntos con su URL de descarga', async () => {
      const sesion = sesionAdmin();
      const archivos = archivosFalsos();
      const proveedor = await crearProveedor(
        sesion,
        { nombre: 'Con docs', roles: [rolMaquila] },
        bd(),
      );
      await agregarAdjuntoProveedor(
        sesion,
        proveedor.id,
        {
          tipo: 'CONTRATO',
          nombreOriginal: 'contrato.pdf',
          tipoMime: 'application/pdf',
          tamanoBytes: 10,
        },
        bd(),
        archivos,
      );

      const lista = await listarAdjuntosProveedor(sesion, proveedor.id, bd(), archivos);
      expect(lista).toHaveLength(1);
      expect(lista[0]).toMatchObject({ tipo: 'CONTRATO', nombreOriginal: 'contrato.pdf' });
      expect(lista[0]?.urlDescarga).toContain('r2.fake/get');
    });

    it('quita un adjunto: borra el ProveedorArchivo y el Archivo', async () => {
      const sesion = sesionAdmin();
      const archivos = archivosFalsos();
      const proveedor = await crearProveedor(
        sesion,
        { nombre: 'Con docs', roles: [rolMaquila] },
        bd(),
      );
      const subida = await agregarAdjuntoProveedor(
        sesion,
        proveedor.id,
        { tipo: 'OTRO', nombreOriginal: 'x.pdf', tipoMime: 'application/pdf', tamanoBytes: 10 },
        bd(),
        archivos,
      );

      await quitarAdjuntoProveedor(sesion, proveedor.id, subida.idArchivo, bd());
      expect(await cliente.proveedorArchivo.count()).toBe(0);
      expect(await cliente.archivo.count()).toBe(0);
    });

    it('quitar un adjunto que no es del proveedor → ErrorNoEncontrado', async () => {
      const sesion = sesionAdmin();
      const archivos = archivosFalsos();
      const a = await crearProveedor(sesion, { nombre: 'A', roles: [rolMaquila] }, bd());
      const b = await crearProveedor(sesion, { nombre: 'B', roles: [rolMaquila] }, bd());
      const subida = await agregarAdjuntoProveedor(
        sesion,
        a.id,
        { tipo: 'OTRO', nombreOriginal: 'x.pdf', tipoMime: 'application/pdf', tamanoBytes: 10 },
        bd(),
        archivos,
      );
      await expect(
        quitarAdjuntoProveedor(sesion, b.id, subida.idArchivo, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });

    it('agregar adjunto a un proveedor inexistente → ErrorNoEncontrado', async () => {
      await expect(
        agregarAdjuntoProveedor(
          sesionAdmin(),
          999999,
          { tipo: 'OTRO', nombreOriginal: 'x.pdf', tipoMime: 'application/pdf', tamanoBytes: 10 },
          bd(),
          archivosFalsos(),
        ),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  // ── B17: avíos que surte el proveedor (lado proveedor de AvioProveedor, R9) ──
  describe('avíos que surte el proveedor (B17, R9)', () => {
    /** Crea un proveedor de prueba y devuelve su id. */
    async function crearProv(nombre = 'Etiquetas Sol'): Promise<number> {
      const p = await crearProveedor(
        sesionAdmin(),
        { nombre, tipo: 'AVIOS', roles: [rolMaquila] },
        bd(),
      );
      return p.id;
    }

    /** Crea un avío de catálogo y devuelve su id. */
    async function crearAvio(clave: string, activo = true): Promise<number> {
      const a = await cliente.avio.create({
        data: { clave, descripcion: `Avío ${clave}`, activo },
      });
      return a.id;
    }

    it('sin permiso de administrar no se puede asignar ni quitar', async () => {
      const idProv = await crearProv();
      const idAvio = await crearAvio('BTN-01');
      const soloVer = sesionDePrueba({ permisos: ['proveedores.ver'] });
      await expect(asignarAvioProveedor(soloVer, idProv, { idAvio }, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
      await expect(quitarAvioProveedor(soloVer, idProv, idAvio, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
      // Leer sí puede.
      await expect(listarAviosDeProveedor(soloVer, idProv, bd())).resolves.toEqual([]);
    });

    it('sin ningún permiso no se puede ni listar', async () => {
      const idProv = await crearProv();
      await expect(listarAviosDeProveedor(sesionDePrueba(), idProv, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
    });

    it('asigna un avío con su precio y lo lista con clave/descripcion embebidas', async () => {
      const idProv = await crearProv();
      const idAvio = await crearAvio('BTN-01');

      const lista = await asignarAvioProveedor(
        sesionAdmin(),
        idProv,
        { idAvio, precio: 1.25, condiciones: 'mínimo 1 millar' },
        bd(),
      );
      expect(lista).toHaveLength(1);
      expect(lista[0]).toMatchObject({
        idAvio,
        clave: 'BTN-01',
        descripcion: 'Avío BTN-01',
        precio: 1.25,
        condiciones: 'mínimo 1 millar',
      });

      const releida = await listarAviosDeProveedor(sesionAdmin(), idProv, bd());
      expect(releida).toEqual(lista);

      // El vínculo se ve TAMBIÉN desde el lado del avío (misma tabla AvioProveedor).
      const desdeAvio = await cliente.avioProveedor.findUnique({
        where: { idAvio_idProveedor: { idAvio, idProveedor: idProv } },
      });
      expect(desdeAvio?.precio?.toString()).toBe('1.25');
    });

    it('asignar sin precio deja el precio en null', async () => {
      const idProv = await crearProv();
      const idAvio = await crearAvio('BTN-02');
      const lista = await asignarAvioProveedor(sesionAdmin(), idProv, { idAvio }, bd());
      expect(lista).toHaveLength(1);
      expect(lista[0]?.precio).toBeNull();
      expect(lista[0]?.condiciones).toBeNull();
    });

    it('asignar dos veces el mismo avío → ErrorConflicto', async () => {
      const idProv = await crearProv();
      const idAvio = await crearAvio('BTN-03');
      await asignarAvioProveedor(sesionAdmin(), idProv, { idAvio }, bd());
      await expect(
        asignarAvioProveedor(sesionAdmin(), idProv, { idAvio }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('no se puede asignar un avío desactivado → ErrorValidacion', async () => {
      const idProv = await crearProv();
      const idAvio = await crearAvio('BTN-04', false);
      await expect(
        asignarAvioProveedor(sesionAdmin(), idProv, { idAvio }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('asignar a proveedor o avío inexistente → ErrorNoEncontrado', async () => {
      const idProv = await crearProv();
      await expect(
        asignarAvioProveedor(sesionAdmin(), idProv, { idAvio: 999999 }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
      const idAvio = await crearAvio('BTN-05');
      await expect(
        asignarAvioProveedor(sesionAdmin(), 999999, { idAvio }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });

    it('quita un avío que surte y actualiza la lista', async () => {
      const idProv = await crearProv();
      const idA = await crearAvio('BTN-06');
      const idB = await crearAvio('BTN-07');
      await asignarAvioProveedor(sesionAdmin(), idProv, { idAvio: idA }, bd());
      await asignarAvioProveedor(sesionAdmin(), idProv, { idAvio: idB }, bd());

      const tras = await quitarAvioProveedor(sesionAdmin(), idProv, idA, bd());
      expect(tras).toHaveLength(1);
      expect(tras[0]?.idAvio).toBe(idB);
    });

    it('quitar un avío que el proveedor no surte → ErrorNoEncontrado', async () => {
      const idProv = await crearProv();
      const idAvio = await crearAvio('BTN-08');
      await expect(quitarAvioProveedor(sesionAdmin(), idProv, idAvio, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
    });

    it('la lista sale ordenada por clave del avío', async () => {
      const idProv = await crearProv();
      const idZ = await crearAvio('ZZZ-01');
      const idA = await crearAvio('AAA-01');
      await asignarAvioProveedor(sesionAdmin(), idProv, { idAvio: idZ }, bd());
      await asignarAvioProveedor(sesionAdmin(), idProv, { idAvio: idA }, bd());
      const lista = await listarAviosDeProveedor(sesionAdmin(), idProv, bd());
      expect(lista.map((x) => x.clave)).toEqual(['AAA-01', 'ZZZ-01']);
    });
  });
});
