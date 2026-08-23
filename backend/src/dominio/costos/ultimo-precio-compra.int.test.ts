/**
 * Integración del lector del ÚLTIMO PRECIO DE COMPRA REAL (V1-E3e — `DECISIONES.md` §Post-F9.48)
 * contra el Postgres efímero (testcontainers). Es la pieza con SQL propio (`DISTINCT ON`), así que
 * su contrato se fija aquí, contra la base de verdad, y no solo por tipos.
 *
 * Verifica:
 *  (a) "comprado" = OC **autorizada / recibida_parcial / recibida_total** (regla 1 de §Post-F9.5);
 *      `borrador`, `pendiente_autorizacion` y `cancelada` NO cuentan;
 *  (b) "más reciente" = fecha de la OC DESC (las OC **sin fecha** al final) → folio DESC → renglón
 *      DESC, el mismo desempate determinista de §Post-F9.5;
 *  (c) el mapa **por material** trae el ganador global y el mapa **por material+proveedor** el
 *      ganador de cada proveedor (lo que necesita el amarre de Desarrollo);
 *  (d) A9: las OC de OTRA empresa no existen para esta sesión;
 *  (e) R1: el precio se devuelve POR UNIDAD DE CONSUMO (÷ factor del `AvioProveedor`, si no del
 *      `Avio`, si no 1) y el `factor` viaja para que el llamador pueda avisar cuando es ≠ 1;
 *  (f) telas y avíos se piden en la MISMA llamada sin cruzarse, y una lista vacía no consulta nada.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';

import {
  claveMaterial,
  claveMaterialProveedor,
  leerUltimosPreciosCompra,
} from './ultimo-precio-compra.js';

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;
let idTela: number;
let idAvio: number;
let provA: number;
let provB: number;
let folio = 0;

type Estatus =
  | 'borrador'
  | 'pendiente_autorizacion'
  | 'autorizada'
  | 'recibida_parcial'
  | 'recibida_total'
  | 'cancelada';

/** Crea una OC de un solo renglón. `fecha: null` prueba el `NULLS LAST` del desempate. */
async function crearOc(opciones: {
  estatus: Estatus;
  idProveedor: number;
  fecha: string | null;
  linea: { idTela?: number; idAvio?: number; precio: number; cantidad?: number };
  idEmpresa?: number;
}): Promise<void> {
  folio += 1;
  await cliente.ordenCompra.create({
    data: {
      numCompra: BigInt(folio),
      idEmpresa: opciones.idEmpresa ?? empresa.id,
      idProveedor: opciones.idProveedor,
      estatus: opciones.estatus,
      fecha: opciones.fecha === null ? null : new Date(`${opciones.fecha}T00:00:00.000Z`),
      lineas: {
        create: [
          {
            idTela: opciones.linea.idTela ?? null,
            idAvio: opciones.linea.idAvio ?? null,
            cantidad: opciones.linea.cantidad ?? 10,
            precio: opciones.linea.precio,
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
  folio = 0;
  empresa = await crearEmpresaPrueba(cliente);
  otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra Empresa');
  const a = await cliente.proveedor.create({ data: { nombre: 'Proveedor A' } });
  const b = await cliente.proveedor.create({ data: { nombre: 'Proveedor B' } });
  provA = a.id;
  provB = b.id;
  const tela = await cliente.tela.create({ data: { nombre: 'Felpa', precioSugerido: 20 } });
  idTela = tela.id;
  const avio = await cliente.avio.create({
    data: { clave: 'BOT', descripcion: 'Botón', precioReferencia: 3 },
  });
  idAvio = avio.id;
});

describe('leerUltimosPreciosCompra — qué cuenta como COMPRADO (regla 1)', () => {
  it('solo cuentan autorizada / recibida_parcial / recibida_total', async () => {
    await crearOc({
      estatus: 'borrador',
      idProveedor: provA,
      fecha: '2026-08-10',
      linea: { idTela, precio: 999 },
    });
    await crearOc({
      estatus: 'pendiente_autorizacion',
      idProveedor: provA,
      fecha: '2026-08-09',
      linea: { idTela, precio: 888 },
    });
    await crearOc({
      estatus: 'cancelada',
      idProveedor: provA,
      fecha: '2026-08-08',
      linea: { idTela, precio: 777 },
    });
    await crearOc({
      estatus: 'autorizada',
      idProveedor: provA,
      fecha: '2026-01-01',
      linea: { idTela, precio: 31 },
    });

    const r = await leerUltimosPreciosCompra(cliente, empresa.id, { telas: [idTela] });
    // La autorizada es la MÁS VIEJA de todas y aun así gana: las otras no son compras.
    expect(r.porMaterial.get(claveMaterial('tela', idTela))?.precio).toBe(31);
  });

  it('recibida_parcial y recibida_total también cuentan', async () => {
    await crearOc({
      estatus: 'recibida_parcial',
      idProveedor: provA,
      fecha: '2026-03-01',
      linea: { idTela, precio: 40 },
    });
    await crearOc({
      estatus: 'recibida_total',
      idProveedor: provB,
      fecha: '2026-04-01',
      linea: { idTela, precio: 45 },
    });
    const r = await leerUltimosPreciosCompra(cliente, empresa.id, { telas: [idTela] });
    expect(r.porMaterial.get(claveMaterial('tela', idTela))?.precio).toBe(45);
    expect(r.porMaterialProveedor.get(claveMaterialProveedor('tela', idTela, provA))?.precio).toBe(
      40,
    );
  });

  it('un material que NUNCA se ha comprado no aparece en ningún mapa', async () => {
    const r = await leerUltimosPreciosCompra(cliente, empresa.id, { telas: [idTela] });
    expect(r.porMaterial.size).toBe(0);
    expect(r.porMaterialProveedor.size).toBe(0);
  });
});

describe('leerUltimosPreciosCompra — cuál es la MÁS RECIENTE (desempate)', () => {
  it('manda la FECHA de la OC, no el orden de captura', async () => {
    await crearOc({
      estatus: 'autorizada',
      idProveedor: provA,
      fecha: '2026-07-01',
      linea: { idTela, precio: 50 },
    });
    // Capturada DESPUÉS pero con fecha ANTERIOR: no debe ganar.
    await crearOc({
      estatus: 'autorizada',
      idProveedor: provA,
      fecha: '2026-02-01',
      linea: { idTela, precio: 18 },
    });
    const r = await leerUltimosPreciosCompra(cliente, empresa.id, { telas: [idTela] });
    expect(r.porMaterial.get(claveMaterial('tela', idTela))?.precio).toBe(50);
  });

  it('las OC SIN fecha van al FINAL: una con fecha siempre les gana (mismo proveedor)', async () => {
    await crearOc({
      estatus: 'autorizada',
      idProveedor: provA,
      fecha: null,
      linea: { idTela, precio: 99 },
    });
    await crearOc({
      estatus: 'autorizada',
      idProveedor: provA,
      fecha: '2020-01-01',
      linea: { idTela, precio: 12 },
    });
    const r = await leerUltimosPreciosCompra(cliente, empresa.id, { telas: [idTela] });
    expect(r.porMaterial.get(claveMaterial('tela', idTela))?.precio).toBe(12);
  });

  it('las OC SIN fecha van al FINAL también ENTRE PROVEEDORES distintos', async () => {
    // Caso DISCRIMINANTE del desempate GLOBAL: la sin-fecha es del proveedor con id MENOR, así que
    // "quedarse con el primero que devuelve el DISTINCT ON" la elegiría. Debe ganar la fechada.
    await crearOc({
      estatus: 'autorizada',
      idProveedor: provA,
      fecha: null,
      linea: { idTela, precio: 99 },
    });
    await crearOc({
      estatus: 'autorizada',
      idProveedor: provB,
      fecha: '2020-01-01',
      linea: { idTela, precio: 12 },
    });
    const r = await leerUltimosPreciosCompra(cliente, empresa.id, { telas: [idTela] });
    expect(r.porMaterial.get(claveMaterial('tela', idTela))?.idProveedor).toBe(provB);
    expect(r.porMaterial.get(claveMaterial('tela', idTela))?.precio).toBe(12);
  });

  it('el ganador GLOBAL no es el del proveedor con id más chico, es el MÁS RECIENTE', async () => {
    // `DISTINCT ON` devuelve un representante por (material, proveedor) ORDENADO POR LAS CLAVES DEL
    // GRUPO, no por fecha: sin comparar explícitamente, el "global" saldría del proveedor A.
    await crearOc({
      estatus: 'autorizada',
      idProveedor: provA,
      fecha: '2026-01-01',
      linea: { idTela, precio: 10 },
    });
    await crearOc({
      estatus: 'autorizada',
      idProveedor: provB,
      fecha: '2026-12-01',
      linea: { idTela, precio: 90 },
    });
    const u = (await leerUltimosPreciosCompra(cliente, empresa.id, { telas: [idTela] }))
      .porMaterial;
    expect(u.get(claveMaterial('tela', idTela))?.idProveedor).toBe(provB);
    expect(u.get(claveMaterial('tela', idTela))?.precio).toBe(90);
  });

  it('a igualdad de fecha gana el FOLIO mayor (determinista, nunca al azar)', async () => {
    await crearOc({
      estatus: 'autorizada',
      idProveedor: provA,
      fecha: '2026-05-05',
      linea: { idTela, precio: 21 },
    });
    await crearOc({
      estatus: 'autorizada',
      idProveedor: provA,
      fecha: '2026-05-05',
      linea: { idTela, precio: 22 },
    });
    const r = await leerUltimosPreciosCompra(cliente, empresa.id, { telas: [idTela] });
    expect(r.porMaterial.get(claveMaterial('tela', idTela))?.precio).toBe(22);
  });
});

describe('leerUltimosPreciosCompra — por material vs. por material+proveedor', () => {
  it('⭐ el mapa por PROVEEDOR trae el último de CADA UNO (lo que el amarre necesita)', async () => {
    await crearOc({
      estatus: 'autorizada',
      idProveedor: provA,
      fecha: '2026-01-10',
      linea: { idTela, precio: 30 },
    });
    await crearOc({
      estatus: 'autorizada',
      idProveedor: provA,
      fecha: '2026-02-10',
      linea: { idTela, precio: 33 },
    });
    await crearOc({
      estatus: 'autorizada',
      idProveedor: provB,
      fecha: '2026-03-10',
      linea: { idTela, precio: 27 },
    });

    const r = await leerUltimosPreciosCompra(cliente, empresa.id, { telas: [idTela] });
    // Global: la más reciente de todas (B, marzo).
    const global = r.porMaterial.get(claveMaterial('tela', idTela));
    expect(global?.precio).toBe(27);
    expect(global?.idProveedor).toBe(provB);
    expect(global?.proveedor).toBe('Proveedor B');
    // Por proveedor: el último de A es el de febrero, NO el de enero ni el de B.
    expect(r.porMaterialProveedor.get(claveMaterialProveedor('tela', idTela, provA))?.precio).toBe(
      33,
    );
    expect(r.porMaterialProveedor.get(claveMaterialProveedor('tela', idTela, provB))?.precio).toBe(
      27,
    );
  });

  it('la traza apunta a la OC de la que salió el precio', async () => {
    await crearOc({
      estatus: 'autorizada',
      idProveedor: provA,
      fecha: '2026-06-15',
      linea: { idTela, precio: 44 },
    });
    const r = await leerUltimosPreciosCompra(cliente, empresa.id, { telas: [idTela] });
    const u = r.porMaterial.get(claveMaterial('tela', idTela));
    expect(u?.compra.numCompra).toBe(1);
    expect(u?.compra.estatus).toBe('autorizada');
    expect(u?.compra.fecha).toBe('2026-06-15');
    expect(u?.compra.proveedor).toBe('Proveedor A');
  });
});

describe('leerUltimosPreciosCompra — A9, unidades (R1) y bordes', () => {
  it('A9: una compra de OTRA empresa no existe para esta sesión', async () => {
    await crearOc({
      estatus: 'autorizada',
      idProveedor: provA,
      fecha: '2026-08-01',
      linea: { idTela, precio: 60 },
      idEmpresa: otraEmpresa.id,
    });
    const r = await leerUltimosPreciosCompra(cliente, empresa.id, { telas: [idTela] });
    expect(r.porMaterial.size).toBe(0);
  });

  it('R1: el precio del avío se devuelve ÷ factor del AvioProveedor (unidad de consumo)', async () => {
    await cliente.avio.update({ where: { id: idAvio }, data: { factorConversion: 10 } });
    await cliente.avioProveedor.create({
      data: { idAvio, idProveedor: provA, precio: 200, factorConversion: 100 },
    });
    await crearOc({
      estatus: 'autorizada',
      idProveedor: provA,
      fecha: '2026-04-04',
      linea: { idAvio, precio: 500 },
    });
    const r = await leerUltimosPreciosCompra(cliente, empresa.id, { avios: [idAvio] });
    const u = r.porMaterial.get(claveMaterial('avio', idAvio));
    // Manda el factor del PAR avío–proveedor (100), no el del avío (10).
    expect(u?.precio).toBe(5);
    expect(u?.factor).toBe(100);
  });

  it('R1: sin par avío–proveedor cae al factor del AVÍO, y sin él a 1', async () => {
    await cliente.avio.update({ where: { id: idAvio }, data: { factorConversion: 4 } });
    await crearOc({
      estatus: 'autorizada',
      idProveedor: provA,
      fecha: '2026-04-04',
      linea: { idAvio, precio: 8 },
    });
    const r = await leerUltimosPreciosCompra(cliente, empresa.id, { avios: [idAvio] });
    expect(r.porMaterial.get(claveMaterial('avio', idAvio))?.precio).toBe(2);

    // La TELA nunca convierte: factor 1 siempre (su OC ya va en unidad de uso).
    await crearOc({
      estatus: 'autorizada',
      idProveedor: provA,
      fecha: '2026-04-05',
      linea: { idTela, precio: 37 },
    });
    const r2 = await leerUltimosPreciosCompra(cliente, empresa.id, { telas: [idTela] });
    expect(r2.porMaterial.get(claveMaterial('tela', idTela))?.precio).toBe(37);
    expect(r2.porMaterial.get(claveMaterial('tela', idTela))?.factor).toBe(1);
  });

  it('telas y avíos en la MISMA llamada no se cruzan', async () => {
    await crearOc({
      estatus: 'autorizada',
      idProveedor: provA,
      fecha: '2026-05-01',
      linea: { idTela, precio: 25 },
    });
    await crearOc({
      estatus: 'autorizada',
      idProveedor: provA,
      fecha: '2026-05-02',
      linea: { idAvio, precio: 7 },
    });
    const r = await leerUltimosPreciosCompra(cliente, empresa.id, {
      telas: [idTela],
      avios: [idAvio],
    });
    expect(r.porMaterial.get(claveMaterial('tela', idTela))?.precio).toBe(25);
    expect(r.porMaterial.get(claveMaterial('avio', idAvio))?.precio).toBe(7);
    expect(r.porMaterial.size).toBe(2);
  });

  it('sin materiales que consultar devuelve mapas vacíos (y no consulta nada)', async () => {
    const r = await leerUltimosPreciosCompra(cliente, empresa.id, { telas: [], avios: [] });
    expect(r.porMaterial.size).toBe(0);
    expect(r.porMaterialProveedor.size).toBe(0);
  });

  it('una línea LIBRE (sin material de catálogo) no ensucia ningún mapa', async () => {
    folio += 1;
    await cliente.ordenCompra.create({
      data: {
        numCompra: BigInt(folio),
        idEmpresa: empresa.id,
        idProveedor: provA,
        estatus: 'autorizada',
        fecha: new Date('2026-09-09T00:00:00.000Z'),
        lineas: {
          create: [{ descripcionLibre: 'Flete', cantidad: 1, precio: 1500 }],
        },
      },
    });
    const r = await leerUltimosPreciosCompra(cliente, empresa.id, {
      telas: [idTela],
      avios: [idAvio],
    });
    expect(r.porMaterial.size).toBe(0);
  });
});
