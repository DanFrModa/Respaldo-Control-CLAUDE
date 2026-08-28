/**
 * Tests de integración de los AGREGADOS del LISTADO de modelos (rediseño R9, proto `vModelos`)
 * contra Postgres efímero (testcontainers; corre en CI):
 *  (a) `telaPrincipal` = la tela del PRIMER renglón del BOM por nombre (mismo orden que la
 *      ficha); `null` sin BOM.
 *  (b) `stockPt` = Σ existencia PT del modelo (Σ de movimientos, D3) a través de almacenes,
 *      SOLO de la empresa activa (A9); 0 sin movimientos.
 *  (c) `costoActual` = costo UNITARIO del ÚLTIMO costeo (F7): `costoTotal / cantidadDeBase`
 *      (criterio de la Lista de costos); el costeo modificado MÁS RECIENTE gana; `null` sin
 *      costeo, con base 0 o sin el candado de COSTO REAL de §Post-F9.137 —que exige `costos.ver`
 *      **y** `consultas.ver-importes`, no sólo el segundo—.
 *  (d) el rollup `porColorTalla` de existencias (`agrupar=color-talla`) suma a través de
 *      almacenes EN SERVIDOR y exige `idModelo`.
 * Todas las sumas del expect están hechas A MANO en el arreglo del test.
 */
// Credenciales R2 FALSAS, fijadas ANTES de llamar al dominio: `listarModelos` construye el
// servicio de archivos (para la foto principal) aunque aquí ningún modelo tiene fotos.
process.env.R2_ACCOUNT_ID ??= 'cuenta-fake';
process.env.R2_ACCESS_KEY_ID ??= 'llave-fake';
process.env.R2_SECRET_ACCESS_KEY ??= 'secreto-fake';
process.env.R2_BUCKET ??= 'control-v2-prueba';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorValidacion } from '../../comun/errores.js';
import type {
  Almacen,
  Color,
  Empresa,
  Modelo,
  PrismaClient,
  Talla,
  TipoMovimientoInventario,
} from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { consultarExistenciasPt, registrarMovimientoPt } from '../inventarios/movimientos-pt.js';
import { listarModelos } from './modelos.js';

let cliente: PrismaClient;
let empresa: Empresa;
let modelo: Modelo;
let colorRojo: Color;
let colorAzul: Color;
let tallaCH: Talla;
let tallaM: Talla;
let almPrimeras: Almacen;
let almSegundas: Almacen;
let tEntradaInicial: TipoMovimientoInventario;
let tSalida: TipoMovimientoInventario;

// §Post-F9.137 — ver el COSTO REAL del listado pide los DOS permisos, no sólo el de importes.
const PERM_LISTADO: ClavePermiso[] = ['modelos.ver', 'costos.ver', 'consultas.ver-importes'];
/** Lo que tiene GERENCIAL (el rol de Aurora): importes sí, costo real no. */
const PERM_GERENCIAL: ClavePermiso[] = ['modelos.ver', 'consultas.ver-importes'];
const PERM_MOVER: ClavePermiso[] = ['inventario-pt.ver', 'inventario-pt.mover'];

const sesion = (permisos: ClavePermiso[] = PERM_LISTADO, idEmpresaActiva = empresa.id) =>
  sesionDePrueba({ idEmpresaActiva, permisos });
const bd = () => ({ cliente });

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
  colorAzul = await cliente.color.create({ data: { nombre: 'Azul' } });
  tallaCH = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  tallaM = await cliente.talla.create({ data: { etiqueta: 'M', orden: 2 } });
  almPrimeras = await cliente.almacen.create({ data: { nombre: 'Primeras', tipo: 'PT' } });
  almSegundas = await cliente.almacen.create({ data: { nombre: 'Segundas', tipo: 'PT' } });
  tEntradaInicial = await cliente.tipoMovimientoInventario.create({
    data: { codigo: 'inventario-inicial', nombre: 'Inventario Inicial', direccion: 'entrada' },
  });
  tSalida = await cliente.tipoMovimientoInventario.create({
    data: { codigo: 'entrega-cliente', nombre: 'Entrega a Cliente', direccion: 'salida' },
  });
});

/** Mueve PT del modelo (entrada o salida) en el almacén dado, para armar existencias a mano. */
async function mover(
  idTipoMov: number,
  idAlmacen: number,
  cantidad: number,
  opciones: { idColor?: number; idTalla?: number; idEmpresaActiva?: number } = {},
): Promise<void> {
  await registrarMovimientoPt(
    sesion(PERM_MOVER, opciones.idEmpresaActiva ?? empresa.id),
    {
      idTipoMov,
      idAlmacen,
      idModelo: modelo.id,
      fecha: '2026-07-01',
      lineas: [
        {
          idColor: opciones.idColor ?? colorRojo.id,
          tallas: [{ idTalla: opciones.idTalla ?? tallaCH.id, cantidad }],
        },
      ],
    },
    bd(),
  );
}

/** Crea una orden del modelo con su corte (base del prorrateo) y su costeo guardado. */
async function crearOrdenCosteada(
  folio: number,
  costoTotal: number,
  cortado: number,
): Promise<number> {
  const clienteNegocio = await cliente.cliente.findFirst({ where: { nombre: 'Liverpool' } });
  const idCliente =
    clienteNegocio?.id ?? (await cliente.cliente.create({ data: { nombre: 'Liverpool' } })).id;
  const orden = await cliente.orden.create({
    data: {
      folio: BigInt(folio),
      idEmpresa: empresa.id,
      idModelo: modelo.id,
      idCliente,
      estado: 'completa',
      fechaCompletada: new Date(),
    },
  });
  // Corte VIVO de la orden (Σ EtapaMovimientoDet tipo corte = `cortado`, base default D2).
  await cliente.etapaMovimiento.create({
    data: {
      folio: BigInt(folio),
      idEmpresa: empresa.id,
      idOrden: orden.id,
      tipo: 'corte',
      fecha: new Date('2026-07-01T00:00:00.000Z'),
      detalles: {
        create: [{ idColor: colorRojo.id, idTalla: tallaCH.id, cantidad: cortado }],
      },
    },
  });
  await cliente.costoOrden.create({
    data: {
      idOrden: orden.id,
      idEmpresa: empresa.id,
      costoTotal,
      baseProrrateo: 'cortado',
    },
  });
  return orden.id;
}

/** El renglón del modelo de prueba en la primera página del listado. */
async function filaListado(permisos: ClavePermiso[] = PERM_LISTADO) {
  const pagina = await listarModelos(sesion(permisos), {}, bd());
  const fila = pagina.datos.find((m) => m.id === modelo.id);
  expect(fila).toBeDefined();
  return fila as NonNullable<typeof fila>;
}

describe('Listado de modelos — telaPrincipal (R9)', () => {
  it('(a) devuelve la tela del PRIMER renglón del BOM por nombre; null sin BOM', async () => {
    // Sin BOM todavía → null.
    expect((await filaListado()).telaPrincipal).toBeNull();

    // Dos telas: por nombre asc, "Algodón" va ANTES que "Popelina" (aunque se capture después).
    const popelina = await cliente.tela.create({ data: { nombre: 'Popelina', unidadMedida: 'M' } });
    const algodon = await cliente.tela.create({ data: { nombre: 'Algodón', unidadMedida: 'KG' } });
    await cliente.modeloTela.createMany({
      data: [
        { idModelo: modelo.id, idTela: popelina.id, consumoPorPrenda: 0.5 },
        { idModelo: modelo.id, idTela: algodon.id, consumoPorPrenda: 0.3 },
      ],
    });
    expect((await filaListado()).telaPrincipal).toBe('Algodón');
  });
});

describe('Listado de modelos — stockPt (R9, D3/A9)', () => {
  it('(b) suma la existencia del modelo a través de almacenes; 0 sin movimientos', async () => {
    expect((await filaListado()).stockPt).toBe(0);

    // A mano: +30 CH Primeras, +20 M Segundas, −10 CH Primeras = 40.
    await mover(tEntradaInicial.id, almPrimeras.id, 30);
    await mover(tEntradaInicial.id, almSegundas.id, 20, { idTalla: tallaM.id });
    await mover(tSalida.id, almPrimeras.id, 10);
    expect((await filaListado()).stockPt).toBe(40);
  });

  it('(b) NO suma movimientos de OTRA empresa (A9)', async () => {
    const otra = await crearEmpresaPrueba(cliente, 'Otra Empresa');
    await mover(tEntradaInicial.id, almPrimeras.id, 30);
    await mover(tEntradaInicial.id, almPrimeras.id, 99, { idEmpresaActiva: otra.id });
    expect((await filaListado()).stockPt).toBe(30);
  });
});

describe('Listado de modelos — costoActual (R9, criterio F7)', () => {
  it('(c) costoTotal / cortado del ÚLTIMO costeo; null sin costeo', async () => {
    expect((await filaListado()).costoActual).toBeNull();

    // A mano: 900 / 300 cortadas = 3.00 por prenda.
    await crearOrdenCosteada(1, 900, 300);
    expect((await filaListado()).costoActual).toBe(3);

    // Un costeo MÁS RECIENTE (otra orden del mismo modelo) lo reemplaza: 500 / 100 = 5.00.
    await crearOrdenCosteada(2, 500, 100);
    expect((await filaListado()).costoActual).toBe(5);
  });

  it('(c) sin base de prorrateo (cortado 0) → null (mismo criterio que la Lista de costos)', async () => {
    await crearOrdenCosteada(1, 900, 0);
    expect((await filaListado()).costoActual).toBeNull();
  });

  /**
   * ⚠️ Esta prueba EXISTÍA con el título *«SIN `consultas.ver-importes` el costo viene null (candado
   * de importes de F7)»*, que nombraba el candado que §Post-F9.137 RETIRÓ. Era cierta bajo la regla
   * de entonces; hoy pasa por otra razón —le faltan LOS DOS permisos, no uno—, así que se invierte
   * el título en vez de conservarlo mintiendo (mismo criterio que §Post-F9.123 con la prueba que
   * afirmaba lo contrario sobre Aurora). Y se deja escrito por qué no bastaba: **no ejercitaba el
   * caso de Aurora**, que sí tiene `consultas.ver-importes`.
   */
  it('(c) con SÓLO `modelos.ver` (ninguno de los dos permisos) el costo viene null', async () => {
    await crearOrdenCosteada(1, 900, 300);
    const fila = await filaListado(['modelos.ver']);
    expect(fila.costoActual).toBeNull();
    // Los otros agregados NO se candan: no son importes.
    expect(fila.stockPt).toBe(0);
  });

  /**
   * ⭐ §Post-F9.137 (DANIEL, 28-ago-2026) — *«Escóndesela»*.
   *
   * ⚠️ ESTE es el caso que el candado viejo dejaba pasar y por el que Aurora veía el costo real:
   * `consultas.ver-importes` PUESTO (Gerencial lo tiene) y `costos.ver` ausente. La prueba que ya
   * existía arriba no lo alcanzaba porque quitaba el permiso de importes —que Aurora sí tiene—, así
   * que pasaba en verde con el hueco abierto. Se prueba en las DOS direcciones: sin el permiso NO
   * se ve, y con él SÍ (si no, un `costoActual` siempre-null también pasaría en verde).
   */
  it('(c) ⭐ con `consultas.ver-importes` pero SIN `costos.ver` (= GERENCIAL/Aurora) el costo real NO viaja', async () => {
    await crearOrdenCosteada(1, 900, 300);

    const aurora = await filaListado(PERM_GERENCIAL);
    expect(aurora.costoActual).toBeNull();
    // Lo demás del listado le sigue llegando entero: se esconde el costo, no se le rompe la vista.
    expect(aurora.stockPt).toBe(0);
    expect(aurora.codigo).toBe('A-100');

    // Y con el permiso de costo real SÍ se ve — el mismo dato, la misma consulta: 900 / 300 = 3.
    expect((await filaListado()).costoActual).toBe(3);
  });

  it('(c) `costos.ver` SIN `consultas.ver-importes` tampoco basta: es dinero, y pide los dos', async () => {
    await crearOrdenCosteada(1, 900, 300);
    expect((await filaListado(['modelos.ver', 'costos.ver'])).costoActual).toBeNull();
  });
});

describe('Existencias PT — rollup porColorTalla (agrupar=color-talla, R9)', () => {
  it('(d) suma cada color×talla A TRAVÉS de almacenes en servidor', async () => {
    // A mano: Rojo/CH = 30 (Primeras) + 20 (Segundas) = 50; Rojo/M = 5; Azul/CH = 7.
    await mover(tEntradaInicial.id, almPrimeras.id, 30);
    await mover(tEntradaInicial.id, almSegundas.id, 20);
    await mover(tEntradaInicial.id, almPrimeras.id, 5, { idTalla: tallaM.id });
    await mover(tEntradaInicial.id, almPrimeras.id, 7, { idColor: colorAzul.id });

    const salida = await consultarExistenciasPt(
      sesion(PERM_MOVER),
      { idModelo: modelo.id, agrupar: 'color-talla' },
      bd(),
    );
    // Las filas por almacén siguen viniendo (4) y el total no cambia.
    expect(salida.filas).toHaveLength(4);
    expect(salida.totalExistencia).toBe(62);
    // El rollup ya viene sumado por color×talla (orden: color asc, talla por su orden).
    expect(salida.porColorTalla).toEqual([
      {
        idColor: colorAzul.id,
        color: 'Azul',
        idTalla: tallaCH.id,
        etiquetaTalla: 'CH',
        ordenTalla: 1,
        existencia: 7,
      },
      {
        idColor: colorRojo.id,
        color: 'Rojo',
        idTalla: tallaCH.id,
        etiquetaTalla: 'CH',
        ordenTalla: 1,
        existencia: 50,
      },
      {
        idColor: colorRojo.id,
        color: 'Rojo',
        idTalla: tallaM.id,
        etiquetaTalla: 'M',
        ordenTalla: 2,
        existencia: 5,
      },
    ]);
  });

  it('(d) sin `agrupar` el rollup NO viene; con `agrupar` sin `idModelo` es rechazo claro', async () => {
    await mover(tEntradaInicial.id, almPrimeras.id, 3);
    const sinRollup = await consultarExistenciasPt(sesion(PERM_MOVER), {}, bd());
    expect(sinRollup.porColorTalla).toBeUndefined();

    await expect(
      consultarExistenciasPt(sesion(PERM_MOVER), { agrupar: 'color-talla' }, bd()),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
