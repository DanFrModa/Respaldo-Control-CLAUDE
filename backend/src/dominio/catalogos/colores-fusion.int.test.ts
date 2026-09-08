import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient } from '../../datos/index.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  colorCanonico,
  crearColor,
  desactivarColor,
  fusionarColores,
  reactivarColor,
} from './colores.js';
import { crearTela } from './telas.js';

/**
 * Integración de la FUSIÓN de colores duplicados (F1-E6) contra Postgres efímero
 * (testcontainers). Cubre lo que el unit no puede: que las referencias `TelaColor`
 * sobrevivan reasignadas al destino, la COLISIÓN de PK `[idTela, idColor]` (el destino
 * ya tenía esa tela), el borrado suave de los orígenes, la bitácora (A7) y el permiso.
 *
 * ⭐ V1-E8s (§Post-F9.143) — y que la fusión deje RASTRO de a dónde se fue cada absorbido
 * (`Color.idFusionadoEn`), que `colorCanonico` sepa seguir esa cadena, y que reactivar a mano lo
 * borre: de ese rastro depende que el importador de OC no resucite un color fusionado.
 *
 * ⭐ §Post-F9.129 — y que la fusión SE NIEGUE cuando el origen ya se usa fuera de las telas. Aquí se
 * prueba con un `Lote` porque es la referencia más barata de fabricar (clave + color, sin cadena de
 * fixture que se pueda romper); **qué relaciones entran en la guarda** no se verifica a mano aquí sino
 * en el unit `colores-fusion-referencias.test.ts`, que las deriva de `prisma/schema.prisma` — una lista
 * escrita a mano ya se equivocó tres veces.
 */

let cliente: PrismaClient;

const sesionAdmin = () => sesionDePrueba({ permisos: ['colores.ver', 'colores.administrar'] });
const sesionTelas = () =>
  sesionDePrueba({ permisos: ['telas.ver', 'telas.administrar', 'colores.ver'] });
const bd = () => ({ cliente });

let idCategoria: number;
let idProveedor: number;
let empresa: Empresa;
let idClienteNegocio: number;
let idTalla: number;
/** Folio correlativo de las órdenes que fabrican las pruebas (la columna es única por empresa). */
let folioOrden = 0n;

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  const felpa = await cliente.telaCategoria.create({ data: { nombre: 'Felpa' } });
  idCategoria = felpa.id;
  // El alta de tela ahora exige el proveedor DUEÑO (§Post-F9.11).
  const proveedor = await cliente.proveedor.create({ data: { nombre: 'Alsatex' } });
  idProveedor = proveedor.id;
  // ⭐ fila 0.159 — mínimo indispensable para poder meter un color en una ORDEN y en un MODELO,
  // que es justo lo que antes hacía imposible fusionarlo.
  empresa = await crearEmpresaPrueba(cliente);
  idClienteNegocio = (await cliente.cliente.create({ data: { nombre: 'C&A' } })).id;
  idTalla = (await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } })).id;
});

/**
 * Crea una tela vía dominio y le cuelga colores con LIGA LEGACY `idColor` — así quedan las
 * filas MIGRADAS del ETL de F1-E6 (§Post-F9.11: los colores nuevos nacen SIN liga y la
 * fusión no los toca; solo las ligadas participan).
 */
async function telaConLigas(
  nombre: string,
  ligas: {
    nombre: string;
    idColor: number;
    precio?: number;
    pantone?: string;
    precioComplemento?: number;
  }[],
): Promise<{ id: number }> {
  const tela = await crearTela(
    sesionTelas(),
    { nombre, unidadMedida: 'KG', idCategoria, idProveedor, colores: [] },
    { cliente },
  );
  for (const liga of ligas) {
    await cliente.telaColor.create({
      data: {
        idTela: tela.id,
        nombre: liga.nombre,
        idColor: liga.idColor,
        precio: liga.precio ?? null,
        pantone: liga.pantone ?? null,
        precioComplemento: liga.precioComplemento ?? null,
      },
    });
  }
  return tela;
}

/**
 * ⭐ fila 0.159 — una ORDEN con matriz color×talla en los colores dados. Es la referencia que
 * §Post-F9.129 usaba para NEGAR la fusión, así que es la que tiene que dejar de estorbar.
 */
async function ordenConColores(idsColor: number[]): Promise<{ idOrden: number }> {
  const modelo = await cliente.modelo.create({
    data: { codigo: `MOD-ORD-${String(++folioOrden)}`, origen: 'produccion' },
  });
  const orden = await cliente.orden.create({
    data: {
      folio: folioOrden,
      idEmpresa: empresa.id,
      idModelo: modelo.id,
      idCliente: idClienteNegocio,
      lineas: {
        create: idsColor.map((idColor) => ({
          idColor,
          tallas: { create: [{ idTalla, cantidad: 10 }] },
        })),
      },
    },
  });
  return { idOrden: orden.id };
}

/** Un modelo de DESARROLLO con un hijo de PRODUCCIÓN nacido de `idColor` (la llave del linaje). */
async function desarrolloConHijoDeColor(
  idColor: number,
  codigo: string,
  numeroProduccion: number,
): Promise<{ idPadre: number; idHijo: number }> {
  const padre = await cliente.modelo.create({
    data: { codigo: `${codigo}-DES`, origen: 'desarrollo', codigoDesarrollo: `${codigo}-DES` },
  });
  const hijo = await cliente.modelo.create({
    data: {
      codigo,
      origen: 'produccion',
      idModeloDesarrollo: padre.id,
      idColor,
      numeroProduccion,
    },
  });
  return { idPadre: padre.id, idHijo: hijo.id };
}

describe('Fusión de colores duplicados (F1-E6)', () => {
  describe('permisos en servidor (PLANMAESTRO §9.2)', () => {
    it('sin colores.administrar no se puede fusionar', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      const soloVer = sesionDePrueba({ permisos: ['colores.ver'] });
      await expect(
        fusionarColores(soloVer, { idDestino: destino.id, origenes: [origen.id] }, bd()),
      ).rejects.toBeInstanceOf(ErrorPermiso);
    });
  });

  describe('validación de entrada (Zod)', () => {
    it('rechaza fusionar un color consigo mismo', async () => {
      const c = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      await expect(
        fusionarColores(sesionAdmin(), { idDestino: c.id, origenes: [c.id] }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza una lista de orígenes vacía', async () => {
      const c = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      await expect(
        fusionarColores(sesionAdmin(), { idDestino: c.id, origenes: [] }, bd()),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });

    it('rechaza orígenes repetidos', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      await expect(
        fusionarColores(
          sesionAdmin(),
          { idDestino: destino.id, origenes: [origen.id, origen.id] },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });
  });

  describe('color inexistente', () => {
    it('lanza ErrorNoEncontrado si el destino no existe', async () => {
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      await expect(
        fusionarColores(sesionAdmin(), { idDestino: 9999, origenes: [origen.id] }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });

    it('lanza ErrorNoEncontrado si un origen no existe', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      await expect(
        fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [9999] }, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  describe('reasignación de referencias TelaColor', () => {
    it('mueve las telas del origen al destino (sin colisión) y desactiva el origen', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());

      // Una tela MIGRADA ligada SOLO al color origen.
      const tela = await telaConLigas('Felpa lisa', [
        { nombre: 'Negro A', idColor: origen.id, precio: 50 },
      ]);

      const sobreviviente = await fusionarColores(
        sesionAdmin(),
        { idDestino: destino.id, origenes: [origen.id] },
        bd(),
      );

      expect(sobreviviente.id).toBe(destino.id);
      expect(sobreviviente.activo).toBe(true);

      // La LIGA se reasignó: ya no apunta al origen, apunta al destino. El color de la
      // tela conserva su nombre propio y su precio (solo cambió la liga legacy).
      expect(await cliente.telaColor.count({ where: { idColor: origen.id } })).toBe(0);
      const reasignada = await cliente.telaColor.findFirstOrThrow({
        where: { idTela: tela.id, idColor: destino.id },
      });
      expect(reasignada.precio?.toNumber()).toBe(50);
      expect(reasignada.nombre).toBe('Negro A');

      // El origen quedó desactivado (borrado suave: sigue existiendo).
      const origenTras = await cliente.color.findUniqueOrThrow({ where: { id: origen.id } });
      expect(origenTras.activo).toBe(false);
    });

    it('resuelve la COLISIÓN de PK: gana el destino, pero rellena su precio nulo desde el origen', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());

      // La MISMA tela está ligada a ambos: destino SIN precio, origen CON precio → colisión.
      const tela = await telaConLigas('Felpa colisión', [
        { nombre: 'Negro', idColor: destino.id },
        { nombre: 'Negro A', idColor: origen.id, precio: 77 },
      ]);

      await fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [origen.id] }, bd());

      // Queda UN solo renglón para esa tela (el del destino); el del origen se eliminó.
      expect(await cliente.telaColor.count({ where: { idTela: tela.id } })).toBe(1);
      expect(await cliente.telaColor.count({ where: { idColor: origen.id } })).toBe(0);

      // El destino tenía precio nulo → toma el del origen (no se pierde el dato).
      const final = await cliente.telaColor.findFirstOrThrow({
        where: { idTela: tela.id, idColor: destino.id },
      });
      expect(final.precio?.toNumber()).toBe(77);
    });

    // §Post-F9.11: el relleno-si-nulo del duplicado cubre TODOS los datos del color de
    // tela — pantone y precio del complemento por igual (extensión pedida en la ronda 2).
    it('en colisión también rellena pantone y precioComplemento nulos desde el origen', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      const tela = await telaConLigas('Felpa relleno', [
        { nombre: 'Negro', idColor: destino.id, precio: 100 },
        {
          nombre: 'Negro A',
          idColor: origen.id,
          precio: 200,
          pantone: '19-4005 TCX',
          precioComplemento: 60,
        },
      ]);

      await fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [origen.id] }, bd());

      const final = await cliente.telaColor.findFirstOrThrow({
        where: { idTela: tela.id, idColor: destino.id },
      });
      // El precio del destino GANA (no era nulo); pantone y precioComplemento estaban
      // nulos → se rellenan del origen antes de eliminar el duplicado.
      expect(final.precio?.toNumber()).toBe(100);
      expect(final.pantone).toBe('19-4005 TCX');
      expect(final.precioComplemento?.toNumber()).toBe(60);
      expect(await cliente.telaColor.count({ where: { idTela: tela.id } })).toBe(1);
    });

    it('en colisión con AMBOS precios, conserva el del destino (gana el canónico)', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      const tela = await telaConLigas('Felpa ambos precios', [
        { nombre: 'Negro', idColor: destino.id, precio: 100 },
        { nombre: 'Negro A', idColor: origen.id, precio: 200 },
      ]);

      await fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [origen.id] }, bd());

      const final = await cliente.telaColor.findFirstOrThrow({
        where: { idTela: tela.id, idColor: destino.id },
      });
      expect(final.precio?.toNumber()).toBe(100);
    });

    it('fusiona VARIOS orígenes de golpe en un solo destino', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const a = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      const b = await crearColor(sesionAdmin(), { nombre: 'NEGRO B' }, bd());

      const telaA = await telaConLigas('Tela A', [{ nombre: 'Negro A', idColor: a.id }]);
      const telaB = await telaConLigas('Tela B', [{ nombre: 'Negro B', idColor: b.id }]);

      await fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [a.id, b.id] }, bd());

      // Las dos telas ahora apuntan al destino; ambos orígenes desactivados.
      expect(await cliente.telaColor.count({ where: { idColor: destino.id } })).toBe(2);
      expect(await cliente.telaColor.count({ where: { idColor: a.id } })).toBe(0);
      expect(await cliente.telaColor.count({ where: { idColor: b.id } })).toBe(0);
      expect((await cliente.color.findUniqueOrThrow({ where: { id: a.id } })).activo).toBe(false);
      expect((await cliente.color.findUniqueOrThrow({ where: { id: b.id } })).activo).toBe(false);
      // Confirma que las telas correctas se re-ligaron.
      await cliente.telaColor.findFirstOrThrow({
        where: { idTela: telaA.id, idColor: destino.id },
      });
      await cliente.telaColor.findFirstOrThrow({
        where: { idTela: telaB.id, idColor: destino.id },
      });
    });

    it('reactiva el destino si estaba desactivado (sobrevive como canónico)', async () => {
      const sesion = sesionAdmin();
      const destino = await crearColor(sesion, { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesion, { nombre: 'NEGRO A' }, bd());
      await cliente.color.update({ where: { id: destino.id }, data: { activo: false } });

      const sobreviviente = await fusionarColores(
        sesion,
        { idDestino: destino.id, origenes: [origen.id] },
        bd(),
      );
      expect(sobreviviente.activo).toBe(true);
    });
  });

  describe('bitácora (A7)', () => {
    it('registra la fusión en el origen (OTRO) y el resumen en el destino (MODIFICAR)', async () => {
      const sesion = sesionAdmin();
      const destino = await crearColor(sesion, { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesion, { nombre: 'NEGRO A' }, bd());
      await telaConLigas('Tela', [{ nombre: 'Negro A', idColor: origen.id }]);

      await fusionarColores(sesion, { idDestino: destino.id, origenes: [origen.id] }, bd());

      const bitOrigen = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Color', idEntidad: String(origen.id), accion: 'OTRO' },
      });
      expect(bitOrigen.idUsuario).toBe(sesion.id);
      expect(bitOrigen.datos).toMatchObject({
        operacion: 'fusionar',
        fusionadoEn: { id: destino.id, nombre: 'NEGRO' },
      });

      const bitDestino = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Color', idEntidad: String(destino.id), accion: 'MODIFICAR' },
      });
      expect(bitDestino.datos).toMatchObject({
        operacion: 'fusionar',
        referenciasReasignadas: 1,
      });
    });
  });

  describe('⭐⭐ fila 0.159 (§Post-F9.222) — YA NO SE NIEGA porque el color esté en uso', () => {
    it('fusiona un color METIDO EN UNA ORDEN: la matriz NO se toca y el origen queda apagado con rastro', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'Blanco Hueso' }, bd());
      const origen = await crearColor(
        sesionAdmin(),
        { nombre: 'Blanco Hueso Pantone 14-0002 Tcx Pumice Stone' },
        bd(),
      );
      const { idOrden } = await ordenConColores([origen.id]);

      const sobreviviente = await fusionarColores(
        sesionAdmin(),
        { idDestino: destino.id, origenes: [origen.id] },
        bd(),
      );

      expect(sobreviviente.id).toBe(destino.id);
      // 🔴 LO QUE EL CLIENTE PIDIÓ NO SE REESCRIBE (D7/D3): la matriz sigue diciendo el color viejo.
      const lineas = await cliente.ordenLinea.findMany({ where: { idOrden } });
      expect(lineas.map((l) => l.idColor)).toEqual([origen.id]);
      // …y el origen queda apagado, con el rastro de a dónde se fue.
      const origenDespues = await cliente.color.findUniqueOrThrow({ where: { id: origen.id } });
      expect(origenDespues.activo).toBe(false);
      expect(origenDespues.idFusionadoEn).toBe(destino.id);
    });

    it('fusiona aunque el color esté en un LOTE, un movimiento o un conteo: nada de eso bloquea', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      await cliente.lote.create({ data: { clave: 'LOTE-NEGRO-A-1', idColor: origen.id } });

      await expect(
        fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [origen.id] }, bd()),
      ).resolves.toMatchObject({ id: destino.id });

      // El lote sigue apuntando al color absorbido: es un hecho asentado, no se reescribe.
      const lote = await cliente.lote.findFirstOrThrow({ where: { clave: 'LOTE-NEGRO-A-1' } });
      expect(lote.idColor).toBe(origen.id);
    });

    it('la BITÁCORA dice qué se quedó colgando del absorbido (no se calla)', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      await cliente.lote.create({ data: { clave: 'LOTE-NEGRO-A-2', idColor: origen.id } });

      await fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [origen.id] }, bd());

      const apunte = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Color', idEntidad: String(origen.id), accion: 'OTRO' },
      });
      expect(apunte.datos).toMatchObject({
        operacion: 'fusionar',
        quedanConRastro: [{ que: 'lotes de tela (legado)', cuantos: 1 }],
      });
    });

    it('REPUNTA el precio por color del proveedor de tela (catálogo, no documento)', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      const tela = await telaConLigas('Felpa lisa', []);
      const proveedorTela = await cliente.telaProveedor.create({
        data: { idTela: tela.id, idProveedor, manejaPrecioPorColor: true },
      });
      await cliente.telaProveedorColor.create({
        data: { idTelaProveedor: proveedorTela.id, idColor: origen.id, precio: 42 },
      });

      await fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [origen.id] }, bd());

      const precios = await cliente.telaProveedorColor.findMany({
        where: { idTelaProveedor: proveedorTela.id },
      });
      expect(precios).toHaveLength(1);
      expect(precios[0]?.idColor).toBe(destino.id);
      expect(Number(precios[0]?.precio)).toBe(42);
    });

    it('en COLISIÓN de precio por color gana el destino, y el descartado queda en la bitácora', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      const tela = await telaConLigas('Felpa lisa', []);
      const proveedorTela = await cliente.telaProveedor.create({
        data: { idTela: tela.id, idProveedor, manejaPrecioPorColor: true },
      });
      await cliente.telaProveedorColor.createMany({
        data: [
          { idTelaProveedor: proveedorTela.id, idColor: destino.id, precio: 10 },
          { idTelaProveedor: proveedorTela.id, idColor: origen.id, precio: 99 },
        ],
      });

      await fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [origen.id] }, bd());

      const precios = await cliente.telaProveedorColor.findMany({
        where: { idTelaProveedor: proveedorTela.id },
      });
      expect(precios).toHaveLength(1);
      expect(Number(precios[0]?.precio)).toBe(10); // gana el canónico
      const apunte = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Color', idEntidad: String(origen.id), accion: 'OTRO' },
      });
      expect(JSON.stringify(apunte.datos)).toContain('"precio":"99"');
    });

    it('REPUNTA el color del que nació un modelo de producción (la llave del linaje)', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      const { idHijo } = await desarrolloConHijoDeColor(origen.id, 'MOD-0159-A', 71001);

      await fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [origen.id] }, bd());

      const hijo = await cliente.modelo.findUniqueOrThrow({ where: { id: idHijo } });
      expect(hijo.idColor).toBe(destino.id);
    });

    it('si el desarrollo YA tiene modelo del canónico, el del duplicado se deja quieto y se anota', async () => {
      const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesionAdmin(), { nombre: 'NEGRO A' }, bd());
      const { idPadre, idHijo } = await desarrolloConHijoDeColor(origen.id, 'MOD-0159-B', 71002);
      const otro = await cliente.modelo.create({
        data: {
          codigo: 'MOD-0159-B-CANON',
          origen: 'produccion',
          idModeloDesarrollo: idPadre,
          idColor: destino.id,
          numeroProduccion: 71003,
        },
      });

      await fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [origen.id] }, bd());

      // El del duplicado conserva su color (y por lo tanto su historia); el canónico sigue en pie.
      expect((await cliente.modelo.findUniqueOrThrow({ where: { id: idHijo } })).idColor).toBe(
        origen.id,
      );
      expect((await cliente.modelo.findUniqueOrThrow({ where: { id: otro.id } })).idColor).toBe(
        destino.id,
      );
      const apunte = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Color', idEntidad: String(origen.id), accion: 'OTRO' },
      });
      expect(JSON.stringify(apunte.datos)).toContain('MOD-0159-B-CANON');
    });
  });

  describe('⭐ V1-E8s (§Post-F9.143) — el RASTRO: a dónde se fue cada color absorbido', () => {
    it('sella en el ORIGEN a quién se lo llevó, y deja al DESTINO sin rastro', async () => {
      const sesion = sesionAdmin();
      const destino = await crearColor(sesion, { nombre: 'NEGRO' }, bd());
      const a = await crearColor(sesion, { nombre: 'NEGRO A' }, bd());
      const b = await crearColor(sesion, { nombre: 'NEGRO B' }, bd());

      await fusionarColores(sesion, { idDestino: destino.id, origenes: [a.id, b.id] }, bd());

      // Cada absorbido apunta al canónico: eso es lo que el importador de OC va a seguir.
      expect((await cliente.color.findUniqueOrThrow({ where: { id: a.id } })).idFusionadoEn).toBe(
        destino.id,
      );
      expect((await cliente.color.findUniqueOrThrow({ where: { id: b.id } })).idFusionadoEn).toBe(
        destino.id,
      );
      // Al canónico no lo absorbió nadie (y así ninguna cadena se cierra en círculo).
      expect(
        (await cliente.color.findUniqueOrThrow({ where: { id: destino.id } })).idFusionadoEn,
      ).toBeNull();
    });

    it('sella el rastro AUNQUE el origen ya estuviera apagado (el dato nuevo es a dónde se fue)', async () => {
      const sesion = sesionAdmin();
      const destino = await crearColor(sesion, { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesion, { nombre: 'NEGRO A' }, bd());
      await cliente.color.update({ where: { id: origen.id }, data: { activo: false } });

      await fusionarColores(sesion, { idDestino: destino.id, origenes: [origen.id] }, bd());

      const despues = await cliente.color.findUniqueOrThrow({ where: { id: origen.id } });
      expect(despues.activo).toBe(false);
      expect(despues.idFusionadoEn).toBe(destino.id);
    });

    it('`colorCanonico` sigue la cadena A→B→C hasta el que de verdad sobrevivió', async () => {
      const sesion = sesionAdmin();
      const c = await crearColor(sesion, { nombre: 'NEGRO' }, bd());
      const b = await crearColor(sesion, { nombre: 'NEGRO B' }, bd());
      const a = await crearColor(sesion, { nombre: 'NEGRO A' }, bd());

      await fusionarColores(sesion, { idDestino: b.id, origenes: [a.id] }, bd());
      await fusionarColores(sesion, { idDestino: c.id, origenes: [b.id] }, bd());

      const canonico = await colorCanonico(cliente, a.id);
      expect(canonico).toMatchObject({ id: c.id, nombre: 'NEGRO', activo: true });
    });

    it('devuelve el MISMO color si nunca lo absorbieron — apagado a mano incluido', async () => {
      const sesion = sesionAdmin();
      const suelto = await crearColor(sesion, { nombre: 'AZUL REY' }, bd());
      await desactivarColor(sesion, suelto.id, bd());

      // Apagado, pero sin rastro: nadie se lo llevó. Quien llama decide si lo reactiva.
      const canonico = await colorCanonico(cliente, suelto.id);
      expect(canonico).toMatchObject({ id: suelto.id, activo: false });
    });

    it('reactivar a mano al absorbido BORRA el rastro (deshacer la fusión se respeta)', async () => {
      const sesion = sesionAdmin();
      const destino = await crearColor(sesion, { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesion, { nombre: 'NEGRO A' }, bd());
      await fusionarColores(sesion, { idDestino: destino.id, origenes: [origen.id] }, bd());

      const reactivado = await reactivarColor(sesion, origen.id, bd());

      expect(reactivado.activo).toBe(true);
      expect(reactivado.idFusionadoEn).toBeNull();
      // …y queda dicho en la bitácora de quién se lo desamarró (A7).
      const bit = await cliente.bitacora.findFirstOrThrow({
        where: { entidad: 'Color', idEntidad: String(origen.id), accion: 'MODIFICAR' },
        orderBy: { id: 'desc' },
      });
      expect(bit.datos).toMatchObject({ operacion: 'reactivar', deshaceFusionDe: destino.id });
      // Y ya no se redirige: el color vive por su cuenta otra vez.
      expect(await colorCanonico(cliente, origen.id)).toMatchObject({ id: origen.id });
    });

    it('un color ACTIVO con rastro colgando se devuelve TAL CUAL (gana lo que se ve)', async () => {
      const sesion = sesionAdmin();
      const destino = await crearColor(sesion, { nombre: 'NEGRO' }, bd());
      const origen = await crearColor(sesion, { nombre: 'NEGRO A' }, bd());
      // Estado imposible por dominio (reactivar limpia el rastro), fabricado a mano como red:
      // si alguna vez quedara uno colgando, el color activo manda sobre la historia.
      await cliente.color.update({
        where: { id: origen.id },
        data: { activo: true, idFusionadoEn: destino.id },
      });

      expect(await colorCanonico(cliente, origen.id)).toMatchObject({
        id: origen.id,
        activo: true,
      });
    });

    it('una cadena en CÍRCULO no cuelga: se corta con un error que dice cómo romperla', async () => {
      const sesion = sesionAdmin();
      const a = await crearColor(sesion, { nombre: 'NEGRO A' }, bd());
      const b = await crearColor(sesion, { nombre: 'NEGRO B' }, bd());
      // El dominio no puede fabricar esto (fusionar limpia el rastro del destino); se arma a mano
      // porque el BACKFILL de `20260829120000_a_donde_se_fue_el_color` SÍ podía dejarlo así —lee la
      // bitácora, que guarda también fusiones ya deshechas—. Esa migración lo rompe ella misma; esto
      // de aquí prueba el PARACAÍDAS, por si otro dato viejo dejara un anillo.
      await cliente.color.update({
        where: { id: a.id },
        data: { activo: false, idFusionadoEn: b.id },
      });
      await cliente.color.update({
        where: { id: b.id },
        data: { activo: false, idFusionadoEn: a.id },
      });

      await expect(colorCanonico(cliente, a.id)).rejects.toBeInstanceOf(ErrorConflicto);
      await expect(colorCanonico(cliente, a.id)).rejects.toThrow(/no termina|círculo/);
    });

    it('fusionar DE VUELTA (A→B y luego B→A) no deja un círculo: el destino pierde su rastro', async () => {
      const sesion = sesionAdmin();
      const a = await crearColor(sesion, { nombre: 'NEGRO' }, bd());
      const b = await crearColor(sesion, { nombre: 'NEGRO A' }, bd());
      // Daniel se equivoca de lado…
      await fusionarColores(sesion, { idDestino: b.id, origenes: [a.id] }, bd());
      // …y lo corrige fusionando al revés. `a` vuelve a ser el canónico y su rastro se borra.
      await fusionarColores(sesion, { idDestino: a.id, origenes: [b.id] }, bd());

      expect(
        (await cliente.color.findUniqueOrThrow({ where: { id: a.id } })).idFusionadoEn,
      ).toBeNull();
      // Si el destino conservara su rastro, `a→b` y `b→a` cerrarían el círculo y esto reventaría.
      expect(await colorCanonico(cliente, b.id)).toMatchObject({ id: a.id, activo: true });
    });

    it('la relación reflexiva NO bloquea la fusión: un canónico se puede volver a fusionar', async () => {
      const sesion = sesionAdmin();
      const b = await crearColor(sesion, { nombre: 'NEGRO B' }, bd());
      const a = await crearColor(sesion, { nombre: 'NEGRO A' }, bd());
      const c = await crearColor(sesion, { nombre: 'NEGRO' }, bd());
      await fusionarColores(sesion, { idDestino: b.id, origenes: [a.id] }, bd());

      // `b` ya absorbió a `a`; eso NO es un uso de `b`, así que puede fusionarse en `c`.
      await expect(
        fusionarColores(sesion, { idDestino: c.id, origenes: [b.id] }, bd()),
      ).resolves.toMatchObject({ id: c.id });
    });
  });
});

// ── ⭐ El LOCK POR DESARROLLO del repunte de `Modelo.idColor` (fila 0.159, ronda 2) ─────────

/**
 * El repunte de `Modelo.idColor` toma el MISMO `pg_advisory_xact_lock(20548, idModeloDesarrollo)`
 * que `obtenerODerivarModeloDeProduccion`, porque el par «¿este desarrollo ya tiene un modelo del
 * canónico?» + «entonces muévelo» tiene que ser un solo hecho serializado: si no, dos operaciones
 * del MISMO desarrollo leen «no hay» a la vez y las dos escriben, chocando contra
 * `modelos_linaje_color_unico` con un P2002 crudo.
 *
 * 🔴 **Esta prueba es el candado del lock**, y nació de una MUTACIÓN QUE SOBREVIVIÓ: quitar la línea
 * del lock dejaba las 117 pruebas de fusión/colores/nomenclatura en verde, porque ninguna corría
 * concurrente. Es el mismo agujero que la prueba del par en `nomenclatura.int.test.ts` vino a tapar
 * —y la misma forma de taparlo—: sin algo que lo ejercite, un lock es una línea que cualquier
 * refactor puede borrar en silencio.
 */
describe('concurrencia: el advisory lock por desarrollo del repunte de `Modelo.idColor`', () => {
  const CONCURRENTES = 4;

  it('N fusiones SIMULTÁNEAS hacia el mismo canónico: ninguna falla, una mueve y las demás se anotan', async () => {
    const destino = await crearColor(sesionAdmin(), { nombre: 'NEGRO' }, bd());
    // UN solo desarrollo con N hijos de producción, cada uno nacido de un duplicado distinto: todos
    // compiten por la misma casilla `[idModeloDesarrollo, idColor=destino]`.
    const padre = await cliente.modelo.create({
      data: {
        codigo: 'MOD-0159-LOCK-DES',
        origen: 'desarrollo',
        codigoDesarrollo: 'MOD-0159-LOCK-DES',
      },
    });
    const origenes: number[] = [];
    for (let i = 0; i < CONCURRENTES; i += 1) {
      const color = await crearColor(sesionAdmin(), { nombre: `NEGRO ${String(i)}` }, bd());
      await cliente.modelo.create({
        data: {
          codigo: `MOD-0159-LOCK-${String(i)}`,
          origen: 'produccion',
          idModeloDesarrollo: padre.id,
          idColor: color.id,
          numeroProduccion: 72_000 + i,
        },
      });
      origenes.push(color.id);
    }

    const resultados = await Promise.allSettled(
      origenes.map((idOrigen) =>
        fusionarColores(sesionAdmin(), { idDestino: destino.id, origenes: [idOrigen] }, bd()),
      ),
    );

    // 1) NINGUNA falla. Sin el lock, las que pierden la carrera revientan contra
    //    `modelos_linaje_color_unico` con un P2002. Se comparan los MENSAJES, no el conteo: si algo
    //    falla, el `expect` lo enseña en el diff en vez de decir "esperaba 0, hubo 3".
    const fallidas = resultados.filter((r) => r.status === 'rejected');
    expect(fallidas.map((r) => String(r.reason))).toEqual([]);

    // 2) EXACTAMENTE UNO se llevó la casilla del canónico (la primera que ganó la carrera).
    const delCanonico = await cliente.modelo.findMany({
      where: { idModeloDesarrollo: padre.id, idColor: destino.id },
      select: { id: true },
    });
    expect(delCanonico).toHaveLength(1);

    // 3) Y los otros N−1 conservan su color absorbido (su historia), como manda el descarte.
    const conservados = await cliente.modelo.count({
      where: { idModeloDesarrollo: padre.id, idColor: { in: origenes } },
    });
    expect(conservados).toBe(CONCURRENTES - 1);

    // 4) Los N colores quedaron absorbidos igual: el descarte es del MODELO, no de la fusión.
    const absorbidos = await cliente.color.count({
      where: { id: { in: origenes }, activo: false, idFusionadoEn: destino.id },
    });
    expect(absorbidos).toBe(CONCURRENTES);
  });
});
