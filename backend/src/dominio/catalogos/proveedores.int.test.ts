import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import type { ServicioArchivos } from '../../comun/archivos.js';
import type { EntradaCrearProveedor } from './proveedores.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarContactoProveedor,
  actualizarProveedor,
  agregarAdjuntoProveedor,
  asignarAvioProveedor,
  crearContactoProveedor,
  crearProveedor,
  crearProveedorMigrado,
  desactivarProveedor,
  listarAdjuntosProveedor,
  listarAviosDeProveedor,
  listarContactosProveedor,
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
    subirContenido() {
      throw new Error(
        'Este flujo usa solicitarSubida (presigned), no subirContenido (server-side).',
      );
    },
    urlDescarga(key) {
      return Promise.resolve(`https://r2.fake/get/${key}`);
    },
    descargarContenido(key) {
      // El fake no guarda bytes: solo cumple el contrato del servicio (nadie lo usa aquí).
      return Promise.resolve(Buffer.from(`contenido-falso:${key}`, 'utf8'));
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
        crearProveedor(
          sinPermisos,
          { modalidadFacturacion: 'solo_con', nombre: 'X', roles: [rolMaquila] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarProveedores(sinPermisos, {}, bd())).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(listarRolesProveedor(sinPermisos, {}, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
    });

    it('con solo lectura no se puede escribir', async () => {
      const soloVer = sesionDePrueba({ permisos: ['proveedores.ver'] });
      await expect(
        crearProveedor(
          soloVer,
          { modalidadFacturacion: 'solo_con', nombre: 'X', roles: [rolMaquila] },
          bd(),
        ),
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
          modalidadFacturacion: 'solo_con',
          nombre: 'Maquilas del Norte',
          telefono: '555-1234',
          roles: [rolMaquila, rolCorte],
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

    // A1.1 (Daniel, 6-ago) + V1-E3f pieza B (§Post-F9.57/.58): el campo corto es UNO SOLO y ÚNICO.
    it('guarda el campo corto en alta, lo edita, lo vacía — y SÍ exige unicidad', async () => {
      const sesion = sesionAdmin();
      const bloom = await crearProveedor(
        sesion,
        {
          modalidadFacturacion: 'solo_con',
          nombre: 'BLOOM TEXTIL',
          roles: [rolMaquila],
          nombreCorto: 'Bloom',
        },
        bd(),
      );
      expect(bloom.nombreCorto).toBe('Bloom');

      // ⭐ Daniel: *"sí debe de ser único"*. Otro proveedor NO puede repetirlo — ni cambiándole
      // las mayúsculas (la clave es la que la gente teclea, no la que el índice compara).
      await expect(
        crearProveedor(
          sesion,
          {
            modalidadFacturacion: 'solo_con',
            nombre: 'BLOOM SUR',
            roles: [rolMaquila],
            nombreCorto: 'Bloom',
          },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorConflicto);
      await expect(
        crearProveedor(
          sesion,
          {
            modalidadFacturacion: 'solo_con',
            nombre: 'BLOOM SUR',
            roles: [rolMaquila],
            nombreCorto: 'bLoOm',
          },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorConflicto);

      // Editar lo cambia; `null` lo borra (M1); omitirlo no lo toca.
      const editado = await actualizarProveedor(sesion, { id: bloom.id, nombreCorto: 'Blm' }, bd());
      expect(editado.nombreCorto).toBe('Blm');
      const sinTocar = await actualizarProveedor(sesion, { id: bloom.id, notas: 'x' }, bd());
      expect(sinTocar.nombreCorto).toBe('Blm');
      const vaciado = await actualizarProveedor(sesion, { id: bloom.id, nombreCorto: null }, bd());
      expect(vaciado.nombreCorto).toBeNull();

      // Ya libre: otro proveedor SÍ lo puede tomar.
      const otro = await crearProveedor(
        sesion,
        {
          modalidadFacturacion: 'solo_con',
          nombre: 'BLOOM SUR',
          roles: [rolMaquila],
          nombreCorto: 'Blm',
        },
        bd(),
      );
      expect(otro.nombreCorto).toBe('Blm');

      // Y editar a un corto ya usado por OTRO también choca.
      await expect(
        actualizarProveedor(sesion, { id: bloom.id, nombreCorto: 'Blm' }, bd()),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });

    it('exige al menos un rol (R15): alta sin roles → ErrorValidacion', async () => {
      await expect(
        crearProveedor(
          sesionAdmin(),
          { modalidadFacturacion: 'solo_con', nombre: 'Sin rol' },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      await expect(
        crearProveedor(
          sesionAdmin(),
          { modalidadFacturacion: 'solo_con', nombre: 'Sin rol', roles: [] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    // ── ⭐ Fila 0.110: la modalidad de facturación es OBLIGATORIA ────────────────────────────
    it('⭐ un alta SIN modalidad de facturación → ErrorValidacion (y NO crea nada, A2)', async () => {
      // El `as` es a propósito y vale la pena explicarlo: el TIPO del contrato ya exige la
      // modalidad, así que TypeScript solo rechaza esta llamada —media defensa, y gratis—. Pero un
      // cliente HTTP no compila con TypeScript: el cuerpo puede llegar sin el campo. El cast fuerza
      // ese caso para medir la otra mitad, la que de verdad protege: que el SERVIDOR lo rechace en
      // tiempo de ejecución (A1, el backend es la autoridad).
      await expect(
        crearProveedor(
          sesionAdmin(),
          { nombre: 'Sin clasificar', roles: [rolMaquila] } as EntradaCrearProveedor,
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      expect(await cliente.proveedor.count({ where: { nombre: 'Sin clasificar' } })).toBe(0);
    });

    it('⭐ el ETL SÍ puede crearlo sin modalidad, y queda legible (REGLA 0-B)', async () => {
      // Access nunca hizo la pregunta: el histórico llega con el hueco A PROPÓSITO. El proveedor
      // migrado se crea, se lee y se lista con normalidad; lo que no se puede es capturarle un
      // movimiento nuevo hasta definirle la modalidad (eso lo corta `resolverConFactura`).
      const migrado = await crearProveedorMigrado(
        sesionAdmin(),
        { nombre: 'Viejo de Access', roles: [rolMaquila] },
        bd(),
      );
      expect(migrado.modalidadFacturacion).toBeNull();

      const leido = await obtenerProveedor(sesionAdmin(), migrado.id, bd());
      expect(leido.nombre).toBe('Viejo de Access');
      expect(leido.modalidadFacturacion).toBeNull();
    });

    // ⭐ Fila 0.124: la regla `factura ⇒ RFC + régimen` colgaba de la casilla `factura`, que se
    // retiró del contrato de escritura. NO se remapeó a la modalidad A PROPÓSITO: habría bloqueado
    // justo el trabajo que abrió la 0.110 —ponerle la modalidad a los proveedores MIGRADOS, que
    // llegan sin RFC A PROPÓSITO (REGLA 0-B: lo que falta se tolera, no se compensa)—. El RFC se
    // sigue exigiendo donde decide dinero: al capturar un CFDI a su nombre (`exigirRfcDelProveedor`).
    it('⭐ el que factura se puede dar de alta SIN RFC, y la columna vieja no se escribe', async () => {
      const p = await crearProveedor(
        sesionAdmin(),
        { modalidadFacturacion: 'solo_con', nombre: 'Factura sin RFC', roles: [rolMaquila] },
        bd(),
      );
      expect(p.modalidadFacturacion).toBe('solo_con');
      expect(p.rfc).toBeNull();
      // La única respuesta a "¿factura?" vive en la modalidad: el alta NO toca la columna histórica.
      expect(p.factura).toBeNull();
    });

    it('rechaza un rol inexistente → ErrorValidacion (y NO crea el proveedor: A2)', async () => {
      await expect(
        crearProveedor(
          sesionAdmin(),
          { modalidadFacturacion: 'solo_con', nombre: 'Rol fantasma', roles: [999999] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
      expect(await cliente.proveedor.count({ where: { nombre: 'Rol fantasma' } })).toBe(0);
    });

    it('no se puede asignar un rol DESACTIVADO → ErrorValidacion', async () => {
      await cliente.rolProveedor.update({ where: { id: rolEstampado }, data: { activo: false } });
      await expect(
        crearProveedor(
          sesionAdmin(),
          { modalidadFacturacion: 'solo_con', nombre: 'Con rol inactivo', roles: [rolEstampado] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza nombre duplicado, sin importar mayúsculas → ErrorConflicto', async () => {
      await crearProveedor(
        sesionAdmin(),
        { modalidadFacturacion: 'solo_con', nombre: 'Textiles SA', roles: [rolMaquila] },
        bd(),
      );
      await expect(
        crearProveedor(
          sesionAdmin(),
          { modalidadFacturacion: 'solo_con', nombre: 'textiles sa', roles: [rolMaquila] },
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
        { modalidadFacturacion: 'solo_con', nombre: 'Taller', roles: [rolMaquila] },
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
        { modalidadFacturacion: 'solo_con', nombre: 'Taller', roles: [rolMaquila] },
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
        { modalidadFacturacion: 'solo_con', nombre: 'Taller', roles: [rolMaquila, rolCorte] },
        bd(),
      );
      await actualizarProveedor(sesion, { id: proveedor.id, telefono: '555' }, bd());
      expect(await cliente.proveedorRol.count({ where: { idProveedor: proveedor.id } })).toBe(2);
    });

    it('cambia campos enriquecidos con bitácora del detalle', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        { modalidadFacturacion: 'solo_con', nombre: 'Prov', roles: [rolMaquila], diasCredito: 0 },
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

    // ⭐ Fila 0.124: la edición ya no captura `factura` —salió del contrato— y tampoco la repara.
    it('⭐ editar la modalidad no toca la columna histórica `factura` (REGLA 0-B)', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        { modalidadFacturacion: 'solo_sin', nombre: 'Prov', roles: [rolMaquila] },
        bd(),
      );
      // Un registro con el valor viejo ya cargado, como los que hay en `prueba`.
      await cliente.proveedor.update({ where: { id: proveedor.id }, data: { factura: false } });

      const editado = await actualizarProveedor(
        sesion,
        { id: proveedor.id, modalidadFacturacion: 'solo_con' },
        bd(),
      );

      expect(editado.modalidadFacturacion).toBe('solo_con');
      // Ni se pisa ni se "arregla": el dato viejo se queda donde está y nadie lo lee.
      expect(editado.factura).toBe(false);
    });

    // M1: en edición, mandar `null` en un campo opcional ya capturado lo BORRA
    // (lo pone a null). Omitirlo NO lo toca. Nunca se guarda ''.
    it('vaciar un campo opcional (null) en edición lo BORRA; omitirlo no lo toca', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        {
          modalidadFacturacion: 'solo_con',
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
        {
          modalidadFacturacion: 'solo_con',
          nombre: 'Prov vacío',
          roles: [rolMaquila],
          banco: 'BBVA',
        },
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
        { modalidadFacturacion: 'solo_con', nombre: 'Prov', roles: [rolMaquila] },
        bd(),
      );
      const antes = await cliente.bitacora.count();
      await actualizarProveedor(sesion, { id: proveedor.id, nombre: 'Prov' }, bd());
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
      const proveedor = await crearProveedor(
        sesion,
        { modalidadFacturacion: 'solo_con', nombre: 'Prov', roles: [rolMaquila] },
        bd(),
      );

      const desactivado = await desactivarProveedor(sesion, proveedor.id, bd());
      expect(desactivado.activo).toBe(false);
      expect(await cliente.proveedor.count()).toBe(1);

      await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Proveedor', idEntidad: String(proveedor.id), accion: 'DESACTIVAR' },
      });
    });

    it('desactivar dos veces → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        { modalidadFacturacion: 'solo_con', nombre: 'Prov', roles: [rolMaquila] },
        bd(),
      );
      await desactivarProveedor(sesion, proveedor.id, bd());
      await expect(desactivarProveedor(sesion, proveedor.id, bd())).rejects.toBeInstanceOf(
        ErrorConflicto,
      );
    });

    it('reactivar un proveedor desactivado funciona', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        { modalidadFacturacion: 'solo_con', nombre: 'Prov', roles: [rolMaquila] },
        bd(),
      );
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
        { modalidadFacturacion: 'solo_con', nombre: 'Prov', roles: [rolMaquila, rolCorte] },
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

  describe('listar (búsqueda + filtro por rol + paginación)', () => {
    it('filtra por rol (el único clasificador desde que se retiró el tipo, §Post-F9.56 punto 3)', async () => {
      const sesion = sesionAdmin();
      await crearProveedor(
        sesion,
        { modalidadFacturacion: 'solo_con', nombre: 'Telas con maquila', roles: [rolMaquila] },
        bd(),
      );
      await crearProveedor(
        sesion,
        { modalidadFacturacion: 'solo_con', nombre: 'Solo corte', roles: [rolCorte] },
        bd(),
      );
      await crearProveedor(
        sesion,
        { modalidadFacturacion: 'solo_con', nombre: 'Avíos y estampado', roles: [rolEstampado] },
        bd(),
      );

      expect((await listarProveedores(sesion, { rol: rolCorte }, bd())).total).toBe(1);
      expect((await listarProveedores(sesion, { rol: rolMaquila }, bd())).total).toBe(1);
      expect((await listarProveedores(sesion, { rol: rolEstampado }, bd())).total).toBe(1);
      expect((await listarProveedores(sesion, {}, bd())).total).toBe(3);
    });

    it('cada proveedor del listado trae sus roles', async () => {
      const sesion = sesionAdmin();
      await crearProveedor(
        sesion,
        {
          modalidadFacturacion: 'solo_con',
          nombre: 'Multi',
          roles: [rolMaquila, rolCorte, rolEstampado],
        },
        bd(),
      );
      const pagina = await listarProveedores(sesion, {}, bd());
      expect(pagina.datos[0]?.roles).toHaveLength(3);
    });

    it('la busqueda ignora ACENTOS y mayusculas (R2 §4.4.1: "oscar" encuentra a "Oscar")', async () => {
      const sesion = sesionAdmin();
      await crearProveedor(
        sesion,
        { modalidadFacturacion: 'solo_con', nombre: 'Óscar Jiménez', roles: [rolMaquila] },
        bd(),
      );
      await crearProveedor(
        sesion,
        { modalidadFacturacion: 'solo_con', nombre: 'Óscar Hernández', roles: [rolMaquila] },
        bd(),
      );
      await crearProveedor(
        sesion,
        { modalidadFacturacion: 'solo_con', nombre: 'Rima Textil', roles: [rolMaquila] },
        bd(),
      );

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
      await crearProveedor(
        sesion,
        { modalidadFacturacion: 'solo_con', nombre: 'Activo', roles: [rolMaquila] },
        bd(),
      );
      const inactivo = await crearProveedor(
        sesion,
        { modalidadFacturacion: 'solo_con', nombre: 'Inactivo', roles: [rolMaquila] },
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

  describe('datos de taller (fusión de terceros, D12/R15): campo corto / asegurado / obsPago', () => {
    it('crea un proveedor con campo corto, asegurado y obsPago', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        {
          modalidadFacturacion: 'solo_con',
          nombre: 'Taller con datos',
          roles: [rolMaquila],
          nombreCorto: 'TCD',
          asegurado: true,
          obsPago: 'Paga los viernes',
        },
        bd(),
      );

      expect(proveedor).toMatchObject({
        nombreCorto: 'TCD',
        asegurado: true,
        obsPago: 'Paga los viernes',
      });

      // Verificación directa en BD.
      const enBd = await cliente.proveedor.findUniqueOrThrow({ where: { id: proveedor.id } });
      expect(enBd).toMatchObject({
        nombreCorto: 'TCD',
        asegurado: true,
        obsPago: 'Paga los viernes',
      });
    });

    it('los datos de taller son opcionales: alta sin ellos quedan en null', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        { modalidadFacturacion: 'solo_con', nombre: 'Sin datos de taller', roles: [rolMaquila] },
        bd(),
      );
      expect(proveedor.nombreCorto).toBeNull();
      expect(proveedor.asegurado).toBeNull();
      expect(proveedor.obsPago).toBeNull();
    });

    it('edita corto, asegurado y obsPago con bitácora del detalle', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        {
          modalidadFacturacion: 'solo_con',
          nombre: 'Taller',
          roles: [rolMaquila],
          nombreCorto: 'OLD',
          asegurado: false,
        },
        bd(),
      );

      const actualizado = await actualizarProveedor(
        sesion,
        { id: proveedor.id, nombreCorto: 'NEW', asegurado: true, obsPago: 'Transferencia' },
        bd(),
      );
      expect(actualizado).toMatchObject({
        nombreCorto: 'NEW',
        asegurado: true,
        obsPago: 'Transferencia',
      });

      const bitacora = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Proveedor', idEntidad: String(proveedor.id), accion: 'MODIFICAR' },
        orderBy: { fecha: 'desc' },
      });
      expect(bitacora.datos).toMatchObject({
        nombreCorto: { de: 'OLD', a: 'NEW' },
        asegurado: { de: false, a: true },
      });
    });

    it('vaciar corto/obsPago en edición (null) los BORRA; "" se normaliza a null', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        {
          modalidadFacturacion: 'solo_con',
          nombre: 'Taller a vaciar',
          roles: [rolMaquila],
          nombreCorto: 'XYZ',
          asegurado: true,
          obsPago: 'algo',
        },
        bd(),
      );

      // null vacía corto; "" vacía obsPago (el dominio normaliza '' a null).
      const actualizado = await actualizarProveedor(
        sesion,
        { id: proveedor.id, nombreCorto: null, obsPago: '' },
        bd(),
      );
      expect(actualizado.nombreCorto).toBeNull();
      expect(actualizado.obsPago).toBeNull();

      const enBd = await cliente.proveedor.findUniqueOrThrow({ where: { id: proveedor.id } });
      expect(enBd.nombreCorto).toBeNull();
      expect(enBd.obsPago).toBeNull();
    });

    // Blindaje del bug histórico de F1-E1 (`.partial()` + `.default()` reseteaba campos):
    // editar OTRO campo NO debe tocar los datos de taller ya capturados.
    it('editar otro campo NO resetea corto/asegurado/obsPago', async () => {
      const sesion = sesionAdmin();
      const proveedor = await crearProveedor(
        sesion,
        {
          modalidadFacturacion: 'solo_con',
          nombre: 'Taller intacto',
          roles: [rolMaquila],
          nombreCorto: 'INT',
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
      expect(actualizado.nombreCorto).toBe('INT');
      expect(actualizado.asegurado).toBe(true);
      expect(actualizado.obsPago).toBe('no me toques');
    });

    it('dos proveedores con corto null NO chocan (unicidad nullable)', async () => {
      const sesion = sesionAdmin();
      // Ambos sin nombreCorto: el índice único nullable trata los null como distintos.
      await crearProveedor(
        sesion,
        { modalidadFacturacion: 'solo_con', nombre: 'Sin corto A', roles: [rolMaquila] },
        bd(),
      );
      await expect(
        crearProveedor(
          sesion,
          { modalidadFacturacion: 'solo_con', nombre: 'Sin corto B', roles: [rolMaquila] },
          bd(),
        ),
      ).resolves.toBeTruthy();
    });

    it('⭐ la BASE bloquea la carrera con distinta caja, no solo el dominio', async () => {
      // La validación del dominio es insensible a mayúsculas, pero DOS transacciones simultáneas
      // no se ven entre sí: la red final tiene que ser la base. El `@unique` de Prisma es EXACTO
      // y por sí solo dejaría pasar "TCD" y "tcd"; por eso la migración crea además el índice
      // funcional `unique(lower(nombre_corto))`. Aquí se escribe SALTÁNDOSE el dominio, que es la
      // única forma de comprobar que el índice existe de verdad.
      await crearProveedor(
        sesionAdmin(),
        {
          modalidadFacturacion: 'solo_con',
          nombre: 'Taller caja',
          roles: [rolMaquila],
          nombreCorto: 'TCD',
        },
        bd(),
      );

      // Misma caja → lo caza el índice exacto.
      await expect(
        cliente.proveedor.create({ data: { nombre: 'Otro exacto', nombreCorto: 'TCD' } }),
      ).rejects.toMatchObject({ code: 'P2002' });

      // ⭐ Distinta caja → lo caza el índice funcional (antes de esta etapa, PASABA).
      await expect(
        cliente.proveedor.create({ data: { nombre: 'Otro caja', nombreCorto: 'tcd' } }),
      ).rejects.toMatchObject({ code: 'P2002' });

      // Y los acentos SÍ distinguen: "Kañon" y "Kanon" son claves distintas, no un choque.
      await expect(
        cliente.proveedor.create({ data: { nombre: 'Con eñe', nombreCorto: 'KAÑON' } }),
      ).resolves.toBeTruthy();
      await expect(
        cliente.proveedor.create({ data: { nombre: 'Sin eñe', nombreCorto: 'KANON' } }),
      ).resolves.toBeTruthy();
    });

    it('dos proveedores con el MISMO corto SÍ chocan → ErrorConflicto', async () => {
      const sesion = sesionAdmin();
      await crearProveedor(
        sesion,
        {
          modalidadFacturacion: 'solo_con',
          nombre: 'Taller uno',
          roles: [rolMaquila],
          nombreCorto: 'DUP',
        },
        bd(),
      );
      await expect(
        crearProveedor(
          sesion,
          {
            modalidadFacturacion: 'solo_con',
            nombre: 'Taller dos',
            roles: [rolMaquila],
            nombreCorto: 'DUP',
          },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorConflicto);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CONTACTOS del proveedor (V1-E3f pieza B — §Post-F9.56 punto 1 / §Post-F9.57 punto 1)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('contactos del proveedor (N por proveedor, puesto en TEXTO LIBRE)', () => {
    /** Crea un proveedor de prueba y devuelve su id. */
    async function prov(nombre = 'Taller con gente'): Promise<number> {
      const p = await crearProveedor(
        sesionAdmin(),
        { modalidadFacturacion: 'solo_con', nombre, roles: [rolMaquila] },
        bd(),
      );
      return p.id;
    }

    it('agrega VARIOS contactos con puestos distintos y los devuelve ordenados', async () => {
      const sesion = sesionAdmin();
      const id = await prov();
      // Los cuatro puestos que nombró Daniel: texto libre, sin catálogo que los valide.
      await crearContactoProveedor(sesion, id, { nombre: 'Rosa', puesto: 'supervisora' }, bd());
      await crearContactoProveedor(
        sesion,
        id,
        { nombre: 'Beto', puesto: 'crédito y cobranza', telefono: '555-2', email: 'b@x.mx' },
        bd(),
      );
      await crearContactoProveedor(sesion, id, { nombre: 'Ana', puesto: 'vendedor' }, bd());

      const contactos = await listarContactosProveedor(sesion, id, false, bd());
      expect(contactos.map((c) => c.nombre)).toEqual(['Ana', 'Beto', 'Rosa']);
      expect(contactos.map((c) => c.puesto)).toEqual([
        'vendedor',
        'crédito y cobranza',
        'supervisora',
      ]);
      expect(contactos[1]).toMatchObject({ telefono: '555-2', email: 'b@x.mx', activo: true });
    });

    it('el puesto es OPCIONAL (queda null) y el nombre es obligatorio', async () => {
      const sesion = sesionAdmin();
      const id = await prov();
      const c = await crearContactoProveedor(sesion, id, { nombre: 'Sin puesto' }, bd());
      expect(c.puesto).toBeNull();
      await expect(
        crearContactoProveedor(sesion, id, { nombre: '  ' }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('viajan dentro de la ficha del proveedor (solo los ACTIVOS)', async () => {
      const sesion = sesionAdmin();
      const id = await prov();
      const ana = await crearContactoProveedor(sesion, id, { nombre: 'Ana' }, bd());
      await crearContactoProveedor(sesion, id, { nombre: 'Beto' }, bd());

      expect((await obtenerProveedor(sesion, id, bd())).contactos.map((c) => c.nombre)).toEqual([
        'Ana',
        'Beto',
      ]);

      await actualizarContactoProveedor(sesion, id, ana.id, { activo: false }, bd());
      expect((await obtenerProveedor(sesion, id, bd())).contactos.map((c) => c.nombre)).toEqual([
        'Beto',
      ]);
    });

    it('archivar es borrado SUAVE (D3): sigue en la lista con incluirInactivos y se puede revivir', async () => {
      const sesion = sesionAdmin();
      const id = await prov();
      const ana = await crearContactoProveedor(sesion, id, { nombre: 'Ana' }, bd());

      const archivada = await actualizarContactoProveedor(
        sesion,
        id,
        ana.id,
        { activo: false },
        bd(),
      );
      expect(archivada.activo).toBe(false);
      expect(await listarContactosProveedor(sesion, id, false, bd())).toHaveLength(0);
      expect(await listarContactosProveedor(sesion, id, true, bd())).toHaveLength(1);

      // El renglón NUNCA se borra de la base.
      expect(await cliente.proveedorContacto.count({ where: { id: ana.id } })).toBe(1);

      const revivida = await actualizarContactoProveedor(
        sesion,
        id,
        ana.id,
        { activo: true },
        bd(),
      );
      expect(revivida.activo).toBe(true);
    });

    it('archivar deja bitácora DESACTIVAR; editar deja MODIFICAR con el detalle', async () => {
      const sesion = sesionAdmin();
      const id = await prov();
      const ana = await crearContactoProveedor(
        sesion,
        id,
        { nombre: 'Ana', puesto: 'vendedor' },
        bd(),
      );

      await actualizarContactoProveedor(sesion, id, ana.id, { puesto: 'gerente' }, bd());
      await actualizarContactoProveedor(sesion, id, ana.id, { activo: false }, bd());

      const bitacora = await cliente.bitacora.findMany({
        where: { entidad: 'ProveedorContacto', idEntidad: String(ana.id) },
        orderBy: { id: 'asc' },
      });
      expect(bitacora.map((b) => b.accion)).toEqual(['CREAR', 'MODIFICAR', 'DESACTIVAR']);
      expect(bitacora[1]?.datos).toMatchObject({ puesto: { de: 'vendedor', a: 'gerente' } });
      expect(bitacora[2]?.datos).toMatchObject({ operacion: 'archivar', nombre: 'Ana' });
    });

    it('editar sin cambios reales NO escribe bitácora', async () => {
      const sesion = sesionAdmin();
      const id = await prov();
      const ana = await crearContactoProveedor(
        sesion,
        id,
        { nombre: 'Ana', puesto: 'vendedor' },
        bd(),
      );
      await actualizarContactoProveedor(sesion, id, ana.id, { puesto: 'vendedor' }, bd());
      expect(
        await cliente.bitacora.count({
          where: { entidad: 'ProveedorContacto', idEntidad: String(ana.id), accion: 'MODIFICAR' },
        }),
      ).toBe(0);
    });

    it('vaciar el puesto con null lo BORRA; el nombre NO se puede vaciar', async () => {
      const sesion = sesionAdmin();
      const id = await prov();
      const ana = await crearContactoProveedor(
        sesion,
        id,
        { nombre: 'Ana', puesto: 'vendedor' },
        bd(),
      );
      expect(
        (await actualizarContactoProveedor(sesion, id, ana.id, { puesto: null }, bd())).puesto,
      ).toBeNull();
      await expect(
        actualizarContactoProveedor(sesion, id, ana.id, { nombre: '' }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('⭐ A9: un contacto de OTRO proveedor responde 404, no lo edita', async () => {
      const sesion = sesionAdmin();
      const unoId = await prov('Taller uno');
      const dosId = await prov('Taller dos');
      const ajeno = await crearContactoProveedor(sesion, dosId, { nombre: 'Ajeno' }, bd());

      await expect(
        actualizarContactoProveedor(sesion, unoId, ajeno.id, { nombre: 'Pisado' }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
      // Y NO se tocó.
      expect(
        (await cliente.proveedorContacto.findUniqueOrThrow({ where: { id: ajeno.id } })).nombre,
      ).toBe('Ajeno');
    });

    it('un proveedor inexistente responde 404 al listar y al agregar', async () => {
      const sesion = sesionAdmin();
      await expect(listarContactosProveedor(sesion, 999_999, false, bd())).rejects.toBeInstanceOf(
        ErrorNoEncontrado,
      );
      await expect(
        crearContactoProveedor(sesion, 999_999, { nombre: 'X' }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });

    it('exige permiso: solo-ver no agrega ni edita (A4)', async () => {
      const sesion = sesionAdmin();
      const id = await prov();
      const ana = await crearContactoProveedor(sesion, id, { nombre: 'Ana' }, bd());
      const soloVer = sesionDePrueba({ permisos: ['proveedores.ver'] });
      await expect(
        crearContactoProveedor(soloVer, id, { nombre: 'Otro' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      await expect(
        actualizarContactoProveedor(soloVer, id, ana.id, { nombre: 'Otro' }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
      const sinNada = sesionDePrueba({ permisos: [] });
      await expect(listarContactosProveedor(sinNada, id, false, bd())).rejects.toBeInstanceOf(
        ErrorPermiso,
      );
    });
  });

  describe('adjuntos en R2 (R15 §4, con servicio de archivos FALSO inyectado)', () => {
    it('agrega un adjunto en una transacción: crea Archivo + ProveedorArchivo + bitácora', async () => {
      const sesion = sesionAdmin();
      const archivos = archivosFalsos();
      const proveedor = await crearProveedor(
        sesion,
        { modalidadFacturacion: 'solo_con', nombre: 'Con docs', roles: [rolMaquila] },
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
        { modalidadFacturacion: 'solo_con', nombre: 'Con docs', roles: [rolMaquila] },
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
        { modalidadFacturacion: 'solo_con', nombre: 'Con docs', roles: [rolMaquila] },
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
      const a = await crearProveedor(
        sesion,
        { modalidadFacturacion: 'solo_con', nombre: 'A', roles: [rolMaquila] },
        bd(),
      );
      const b = await crearProveedor(
        sesion,
        { modalidadFacturacion: 'solo_con', nombre: 'B', roles: [rolMaquila] },
        bd(),
      );
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
        { modalidadFacturacion: 'solo_con', nombre, roles: [rolMaquila] },
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
