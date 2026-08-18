import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorNoEncontrado } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type {
  Almacen,
  Avio,
  Color,
  Empresa,
  PrismaClient,
  Proveedor,
  Talla,
} from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sembrarRecetaDeOrden } from '../../pruebas/receta.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { habilitacionOrden } from './habilitacion-orden.js';

/**
 * Integración del dominio de HABILITACIÓN / SURTIDO de avíos por orden (rediseño R6, B13) contra
 * Postgres efímero (testcontainers; SOLO CI). Cubre lo que sólo la base valida:
 *  • REQUERIDO = consumo × piezas de la orden (R18: por prenda y por talla).
 *  • ENVIADO = Σ de renglones de notas CONFIRMADAS (NO borrador ni cancelada) por orden×avío.
 *  • FALTA + estado por avío (completo / parcial / pendiente / sobre-surtido / extra) y % global.
 *  • EXTRAS: avíos enviados fuera de la receta.
 *  • RBAC: sin `ordenes.habilitacion` → 403; otra empresa → 404 (A9).
 */

let cliente: PrismaClient;
let empresa: Empresa;
let maquilero: Proveedor;
let clienteNegocioId: number;
let modeloId: number;
let ordenId: number;
let colorRojo: Color;
let almacen: Almacen;
let tallaCH: Talla;
let tallaM: Talla;
let avioBoton: Avio;
let avioHilo: Avio;
let avioCierre: Avio;

const PERM: ClavePermiso[] = ['ordenes.habilitacion'];

function sesion(permisos: ClavePermiso[], idEmpresaActiva = empresa.id): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva, permisos });
}

const bd = () => ({ cliente });

/** Crea una nota (con su renglón) directa en BD, con el estatus dado (para probar la agregación). */
async function crearNota(
  idAvio: number,
  cantidad: number,
  estatus: 'borrador' | 'confirmada' | 'cancelada',
  numNota: bigint,
): Promise<void> {
  await cliente.notaSalida.create({
    data: {
      numNota,
      idEmpresa: empresa.id,
      idMaquilero: maquilero.id,
      idAlmacen: almacen.id,
      fechaElaboracion: new Date('2026-07-06T00:00:00.000Z'),
      estatus,
      creadoPorId: 'usuario-prueba',
      modificadoPorId: 'usuario-prueba',
      lineas: {
        create: [
          {
            idOrden: ordenId,
            idAvio,
            cantidad,
            unidad: 'pza',
            creadoPorId: 'usuario-prueba',
            modificadoPorId: 'usuario-prueba',
          },
        ],
      },
    },
  });
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
  maquilero = await cliente.proveedor.create({ data: { nombre: 'Maquila del Sur' } });
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  clienteNegocioId = clienteNegocio.id;
  colorRojo = await cliente.color.create({ data: { nombre: 'Rojo' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  almacen = await cliente.almacen.create({ data: { nombre: 'Bodega', tipo: 'AVIO' } });
  avioBoton = await cliente.avio.create({
    data: { clave: 'BOT-01', descripcion: 'Botón', unidad: 'pza' },
  });
  avioHilo = await cliente.avio.create({
    data: { clave: 'HIL-01', descripcion: 'Hilo', unidad: 'm', esGenerico: true },
  });
  avioCierre = await cliente.avio.create({
    data: { clave: 'CIE-01', descripcion: 'Cierre', unidad: 'pza' },
  });

  const modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  modeloId = modelo.id;
  // BOM (receta): botón 6 pza/prenda, hilo 2 m/prenda. El cierre NO va en la receta (será extra).
  await cliente.modeloAvio.createMany({
    data: [
      { idModelo: modeloId, idAvio: avioBoton.id, consumoPorPrenda: 6 },
      { idModelo: modeloId, idAvio: avioHilo.id, consumoPorPrenda: 2 },
    ],
  });

  // Orden de 30 piezas (Rojo: CH 10 + M 20). Requerido: botón 180, hilo 60.
  const orden = await cliente.orden.create({
    data: {
      folio: 1n,
      idEmpresa: empresa.id,
      idModelo: modeloId,
      idCliente: clienteNegocioId,
      idMaquilero: maquilero.id,
      estado: 'completa',
      fechaCompletada: new Date(),
      lineas: {
        create: [
          {
            idColor: colorRojo.id,
            tallas: {
              create: [
                { idTalla: tallaCH.id, cantidad: 10 },
                { idTalla: tallaM.id, cantidad: 20 },
              ],
            },
          },
        ],
      },
    },
  });
  ordenId = orden.id;
  // V1-E3d: la habilitación lee la RECETA DE LA ORDEN. La orden se crea aquí directo (sin pasar por
  // `crearOrden`, que es quien copia la receta), así que se siembra igual que lo hace el alta.
  await sembrarRecetaDeOrden(cliente, ordenId, modeloId);
});

describe('Habilitación (B13) — requerido vs. enviado por avío (R6)', () => {
  it('sin notas: todo pendiente; requerido = consumo × piezas; % global 0', async () => {
    const h = await habilitacionOrden(sesion(PERM), ordenId, bd());
    expect(h.totalPiezas).toBe(30);
    expect(h.maquilero).toBe('Maquila del Sur');
    expect(h.avios).toHaveLength(2);
    const boton = h.avios.find((a) => a.idAvio === avioBoton.id)!;
    expect(boton.requerido).toBe(180);
    expect(boton.enviado).toBe(0);
    expect(boton.falta).toBe(180);
    expect(boton.estado).toBe('pendiente');
    expect(h.porcentajeGlobal).toBe(0);
    expect(h.pendientes).toBe(2);
    expect(h.faltanAvios).toBe(2);
  });

  it('solo las notas CONFIRMADAS cuentan como enviado (borrador/cancelada no)', async () => {
    await crearNota(avioBoton.id, 100, 'confirmada', 1n);
    await crearNota(avioBoton.id, 50, 'borrador', 2n);
    await crearNota(avioBoton.id, 30, 'cancelada', 3n);

    const h = await habilitacionOrden(sesion(PERM), ordenId, bd());
    const boton = h.avios.find((a) => a.idAvio === avioBoton.id)!;
    expect(boton.enviado).toBe(100);
    expect(boton.falta).toBe(80);
    expect(boton.estado).toBe('parcial');
    expect(boton.porcentaje).toBeCloseTo((100 / 180) * 100);
  });

  it('completo cuando enviado = requerido', async () => {
    await crearNota(avioBoton.id, 180, 'confirmada', 1n);
    const h = await habilitacionOrden(sesion(PERM), ordenId, bd());
    const boton = h.avios.find((a) => a.idAvio === avioBoton.id)!;
    expect(boton.falta).toBe(0);
    expect(boton.estado).toBe('completo');
    expect(boton.porcentaje).toBe(100);
  });

  it('SOBRE-SURTIDO (>100%) es un estado válido, no un error', async () => {
    await crearNota(avioBoton.id, 200, 'confirmada', 1n);
    const h = await habilitacionOrden(sesion(PERM), ordenId, bd());
    const boton = h.avios.find((a) => a.idAvio === avioBoton.id)!;
    expect(boton.enviado).toBe(200);
    expect(boton.falta).toBe(0);
    expect(boton.estado).toBe('sobre-surtido');
    expect(boton.porcentaje).toBeCloseTo((200 / 180) * 100);
    // El sobre-surtido cuenta como completo en el resumen (falta ≤ 0), no infla el total enviado.
    expect(boton.enviado).toBeGreaterThan(boton.requerido);
  });

  it('EXTRA: un avío enviado fuera de la receta aparece marcado extra', async () => {
    await crearNota(avioCierre.id, 15, 'confirmada', 1n);
    const h = await habilitacionOrden(sesion(PERM), ordenId, bd());
    expect(h.avios).toHaveLength(3); // 2 de receta + 1 extra
    const cierre = h.avios.find((a) => a.idAvio === avioCierre.id)!;
    expect(cierre.esExtra).toBe(true);
    expect(cierre.estado).toBe('extra');
    expect(cierre.requerido).toBe(0);
    expect(cierre.enviado).toBe(15);
  });

  it('REQUERIDO por talla (R18): usa la medida por talla cuando el avío la maneja', async () => {
    // Hilo por talla EN LA RECETA DE LA ORDEN: CH 3, M 4 → requerido = 3×10 + 4×20 = 110
    // (en vez de 2×30 = 60). V1-E3d: la medida que manda es la de la ORDEN.
    const renglon = await cliente.ordenAvio.update({
      where: { idOrden_idAvio: { idOrden: ordenId, idAvio: avioHilo.id } },
      data: { consumoPorTalla: true },
      select: { id: true },
    });
    await cliente.ordenAvioTalla.createMany({
      data: [
        { idOrdenAvio: renglon.id, idTalla: tallaCH.id, consumo: 3 },
        { idOrdenAvio: renglon.id, idTalla: tallaM.id, consumo: 4 },
      ],
    });
    const h = await habilitacionOrden(sesion(PERM), ordenId, bd());
    const hilo = h.avios.find((a) => a.idAvio === avioHilo.id)!;
    expect(hilo.requerido).toBe(110);
  });

  /**
   * ⭐ §Post-F9.64 — el AVISO de tallas sin medida. El mecanismo (`tallasSinMedida`) existía desde
   * F8 pero aquí se tiraba: sólo el MRP lo pintaba, y la habilitación —la pantalla de quien surte—
   * se quedaba callada. **Avisa, NO bloquea**: el requerido se calcula igual (cae al consumo por
   * prenda) y la orden se puede surtir.
   */
  describe('aviso de tallas SIN MEDIDA (§Post-F9.64)', () => {
    /** Deja el hilo "por talla" con las medidas dadas (las que no se den quedan SIN capturar). */
    async function hiloPorTalla(medidas: { idTalla: number; consumo: number }[]): Promise<void> {
      const renglon = await cliente.ordenAvio.update({
        where: { idOrden_idAvio: { idOrden: ordenId, idAvio: avioHilo.id } },
        data: { consumoPorTalla: true },
        select: { id: true },
      });
      if (medidas.length > 0) {
        await cliente.ordenAvioTalla.createMany({
          data: medidas.map((m) => ({
            idOrdenAvio: renglon.id,
            idTalla: m.idTalla,
            consumo: m.consumo,
          })),
        });
      }
    }

    it('nombra las tallas SIN capturar EN ORDEN CANÓNICO y las cuenta en el resumen', async () => {
      // Se agrega la G al FINAL de la matriz pero con orden 3: el aviso debe salir "M, G" y no en
      // el orden en que cayeron las filas.
      const tallaG = await cliente.talla.create({ data: { etiqueta: 'G', orden: 3 } });
      const linea = await cliente.ordenLinea.findFirstOrThrow({ where: { idOrden: ordenId } });
      await cliente.ordenLineaTalla.create({
        data: { idOrdenLinea: linea.id, idTalla: tallaG.id, cantidad: 5 },
      });
      await hiloPorTalla([{ idTalla: tallaCH.id, consumo: 3 }]); // faltan M y G
      const h = await habilitacionOrden(sesion(PERM), ordenId, bd());
      const hilo = h.avios.find((a) => a.idAvio === avioHilo.id)!;
      expect(hilo.consumoPorTalla).toBe(true);
      expect(hilo.tallasSinMedida).toEqual(['M', 'G']);
      expect(hilo.requerido).toBe(80); // 3×10 + 2×20 + 2×5 (M y G caen al consumo por prenda)
      expect(h.aviosSinMedida).toBe(1);
      // AVISA, NO BLOQUEA: el tablero responde normal y el resto de los avíos ni se entera.
      expect(h.avios.find((a) => a.idAvio === avioBoton.id)?.tallasSinMedida).toEqual([]);
    });

    it('un CERO capturado NO es un olvido: no aparece en el aviso', async () => {
      await hiloPorTalla([
        { idTalla: tallaCH.id, consumo: 3 },
        { idTalla: tallaM.id, consumo: 0 },
      ]);
      const h = await habilitacionOrden(sesion(PERM), ordenId, bd());
      const hilo = h.avios.find((a) => a.idAvio === avioHilo.id)!;
      expect(hilo.tallasSinMedida).toEqual([]);
      expect(hilo.requerido).toBe(30); // 3×10 + 0×20
      expect(h.aviosSinMedida).toBe(0);
    });

    it('los avíos de consumo PLANO nunca entran al aviso (serían ruido)', async () => {
      const h = await habilitacionOrden(sesion(PERM), ordenId, bd());
      expect(h.avios.every((a) => a.tallasSinMedida.length === 0)).toBe(true);
      expect(h.avios.every((a) => !a.consumoPorTalla)).toBe(true);
      expect(h.aviosSinMedida).toBe(0);
    });

    it('una talla con CERO PIEZAS en la matriz no "falta" (D4): no se va a producir', async () => {
      const tallaG = await cliente.talla.create({ data: { etiqueta: 'G', orden: 3 } });
      const linea = await cliente.ordenLinea.findFirstOrThrow({ where: { idOrden: ordenId } });
      await cliente.ordenLineaTalla.create({
        data: { idOrdenLinea: linea.id, idTalla: tallaG.id, cantidad: 0 },
      });
      await hiloPorTalla([
        { idTalla: tallaCH.id, consumo: 3 },
        { idTalla: tallaM.id, consumo: 4 },
      ]);
      const h = await habilitacionOrden(sesion(PERM), ordenId, bd());
      const hilo = h.avios.find((a) => a.idAvio === avioHilo.id)!;
      expect(hilo.tallasSinMedida).toEqual([]); // la G NO se señala
      expect(hilo.requerido).toBe(110);
    });
  });

  it('⭐ V1-E3d: cambiar el BOM del MODELO ya NO cambia lo que surte una orden viva', async () => {
    // El modelo duplica el consumo del botón y le agrega el cierre. La orden está congelada: sigue
    // pidiendo 180 botones y NO conoce el cierre. Antes de esta etapa las dos cosas la alcanzaban.
    await cliente.modeloAvio.update({
      where: { idModelo_idAvio: { idModelo: modeloId, idAvio: avioBoton.id } },
      data: { consumoPorPrenda: 12 },
    });
    await cliente.modeloAvio.create({
      data: { idModelo: modeloId, idAvio: avioCierre.id, consumoPorPrenda: 1 },
    });

    const h = await habilitacionOrden(sesion(PERM), ordenId, bd());
    expect(h.avios.find((a) => a.idAvio === avioBoton.id)?.requerido).toBe(180);
    expect(h.avios.find((a) => a.idAvio === avioCierre.id)).toBeUndefined();
  });

  it('⭐ EL CASO DE LA JARETA: el renglón EXCLUIDO no se surte ni sale como faltante', async () => {
    await cliente.ordenAvio.update({
      where: { idOrden_idAvio: { idOrden: ordenId, idAvio: avioHilo.id } },
      data: { excluido: true, estado: 'ajustado' },
    });
    const h = await habilitacionOrden(sesion(PERM), ordenId, bd());
    expect(h.avios.find((a) => a.idAvio === avioHilo.id)).toBeUndefined();
    expect(h.avios).toHaveLength(1);
  });

  it('% global capa el enviado al requerido por avío', async () => {
    // Botón sobre-surtido (200 > 180) + hilo pendiente (0). El global usa min(200,180)=180 sobre
    // el total requerido 240 → 75%, no 200/240.
    await crearNota(avioBoton.id, 200, 'confirmada', 1n);
    const h = await habilitacionOrden(sesion(PERM), ordenId, bd());
    expect(h.totalRequerido).toBe(240);
    expect(h.totalEnviado).toBe(180);
    expect(h.porcentajeGlobal).toBe(75);
  });
});

describe('Habilitación (B13) — RBAC y aislamiento por empresa (A9)', () => {
  it('sin permiso `ordenes.habilitacion` → 403', async () => {
    await expect(habilitacionOrden(sesion([]), ordenId, bd())).rejects.toThrow();
  });

  it('orden de otra empresa → 404 (A9)', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Otra SA');
    await expect(habilitacionOrden(sesion(PERM, otra.id), ordenId, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });

  it('una nota de OTRA empresa que referencia la misma orden NO cuenta en enviado (A9 a nivel de nota)', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Empresa B');
    // Nota CONFIRMADA de la empresa B, pero su renglón referencia la orden (que es de la empresa A):
    // el filtro `notaSalida.idEmpresa` de la habilitación debe excluirla del "enviado".
    await cliente.notaSalida.create({
      data: {
        numNota: 1n,
        idEmpresa: otra.id,
        idMaquilero: maquilero.id,
        idAlmacen: almacen.id,
        fechaElaboracion: new Date('2026-07-06T00:00:00.000Z'),
        estatus: 'confirmada',
        creadoPorId: 'usuario-prueba',
        modificadoPorId: 'usuario-prueba',
        lineas: {
          create: [
            {
              idOrden: ordenId,
              idAvio: avioBoton.id,
              cantidad: 500,
              unidad: 'pza',
              creadoPorId: 'usuario-prueba',
              modificadoPorId: 'usuario-prueba',
            },
          ],
        },
      },
    });
    // Una nota CONFIRMADA de la empresa A (dueña de la orden): esta SÍ cuenta.
    await crearNota(avioBoton.id, 100, 'confirmada', 1n);

    const h = await habilitacionOrden(sesion(PERM), ordenId, bd());
    const boton = h.avios.find((a) => a.idAvio === avioBoton.id)!;
    // Solo las 100 de la empresa A; las 500 de la empresa B se ignoran (A9).
    expect(boton.enviado).toBe(100);
    expect(boton.falta).toBe(80);
  });
});
