/**
 * Integración del PRECOSTO PERSISTIDO (F8-E3) contra el Postgres efímero (testcontainers). Cubre el
 * corazón de la fase: generar desde el BOM con amarres (tela por proveedor, avío por proveedor),
 * PROMEDIO de medidas por talla (R18), conceptos manuales, `recalcularDesdeBom` que NO pisa manuales,
 * congelado INMUTABLE, un solo borrador por desarrollo, y que el desarrollo pase a "cotizado" al
 * congelar la v1. NO corre en local (usa Docker): el CI.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import { ErrorConflicto, ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import type {
  Avio,
  Cliente,
  ClienteDepartamento,
  Empresa,
  PrismaClient,
  Proveedor,
  Talla,
  Tela,
} from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { crearDesarrollo } from './desarrollos.js';
import { obtenerProyecto, crearProyecto } from './proyectos.js';
import {
  agregarLineaManual,
  congelarVersion,
  editarLinea,
  eliminarLineaManual,
  generarPrecosto,
  listarPrecostosDeDesarrollo,
  obtenerPrecosto,
  recalcularDesdeBom,
} from './precostos.js';

let cliente: PrismaClient;
let empresa: Empresa;
let clienteNegocio: Cliente;
let departamento: ClienteDepartamento;

const PERM: ClavePermiso[] = [
  'desarrollo.ver',
  'desarrollo.administrar',
  'desarrollo.precostear',
  'consultas.ver-importes',
];
const bd = () => ({ cliente });
function sesion(permisos: ClavePermiso[] = PERM): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
}

/** Siembra los conceptos base que el precosto necesita (los del seed de F8-E1). */
async function sembrarConceptos(): Promise<void> {
  const base = [
    { codigo: 'tela', nombre: 'Tela', orden: 1, fijo: true },
    { codigo: 'avios', nombre: 'Avíos', orden: 2, fijo: true },
    { codigo: 'maquila', nombre: 'Maquila', orden: 3, fijo: true },
    { codigo: 'estampado', nombre: 'Estampado', orden: 4, fijo: false },
    { codigo: 'bordado', nombre: 'Bordado', orden: 5, fijo: false },
  ];
  for (const c of base) {
    await cliente.conceptoCosto.create({ data: c });
  }
}

async function proyectoNuevo(): Promise<number> {
  const p = await crearProyecto(
    sesion(),
    { idCliente: clienteNegocio.id, idClienteDepartamento: departamento.id, nombre: 'Joggers' },
    bd(),
  );
  return p.id;
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
  clienteNegocio = await cliente.cliente.create({ data: { nombre: 'C&A' } });
  departamento = await cliente.clienteDepartamento.create({
    data: { idCliente: clienteNegocio.id, nombre: 'NIÑOS' },
  });
  await sembrarConceptos();
});

describe('generarPrecosto — desde el BOM con amarres (R17)', () => {
  it('valúa tela y avío con el proveedor AMARRADO (aunque haya uno más barato) + maquila', async () => {
    const tela: Tela = await cliente.tela.create({ data: { nombre: 'Felpa', precioSugerido: 20 } });
    const provTela: Proveedor = await cliente.proveedor.create({ data: { nombre: 'Telas SA' } });
    const telaProv = await cliente.telaProveedor.create({
      data: { idTela: tela.id, idProveedor: provTela.id, precio: 25 },
    });

    const avio: Avio = await cliente.avio.create({
      data: { clave: 'BOT', descripcion: 'Botón', precioReferencia: 3 },
    });
    const provCaro = await cliente.proveedor.create({ data: { nombre: 'Botones Caros' } });
    const provBarato = await cliente.proveedor.create({ data: { nombre: 'Botones Baratos' } });
    await cliente.avioProveedor.create({
      data: { idAvio: avio.id, idProveedor: provCaro.id, precio: 5 },
    });
    await cliente.avioProveedor.create({
      data: { idAvio: avio.id, idProveedor: provBarato.id, precio: 2 },
    });

    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'CON-AMARRE',
        maquilaBase: 8,
        telas: {
          create: [{ idTela: tela.id, consumoPorPrenda: 1.5, idTelaProveedor: telaProv.id }],
        },
        avios: { create: [{ idAvio: avio.id, consumoPorPrenda: 2, idAvioProveedor: provCaro.id }] },
      },
    });

    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());

    expect(precosto.estado).toBe('borrador');
    expect(precosto.version).toBe(1);
    // 1.5×25 (amarre) + 2×5 (amarre caro) + 8 maquila = 55.5
    expect(precosto.costoTotal).toBe(55.5);

    const tTela = precosto.lineas.find((l) => l.conceptoCodigo === 'tela');
    expect(tTela?.importe).toBe(37.5);
    expect(tTela?.idTelaProveedor).toBe(telaProv.id);
    expect(tTela?.editable).toBe(false); // BOM: no editable a mano

    const tAvio = precosto.lineas.find((l) => l.conceptoCodigo === 'avios');
    expect(tAvio?.importe).toBe(10);
    expect(tAvio?.idAvioProveedor).toBe(provCaro.id); // el proveedor realmente usado (amarre)

    const tMaq = precosto.lineas.find((l) => l.conceptoCodigo === 'maquila');
    expect(tMaq?.importe).toBe(8);
    expect(tMaq?.origen).toBe('manual');
    expect(tMaq?.editable).toBe(true);
    expect(tMaq?.eliminable).toBe(false); // fijo: se edita pero no se borra
  });

  it('traza de tela FIEL: si el amarre NO tiene precio y cae a sugerido, idTelaProveedor = null', async () => {
    const tela: Tela = await cliente.tela.create({ data: { nombre: 'Rib', precioSugerido: 12 } });
    const prov: Proveedor = await cliente.proveedor.create({ data: { nombre: 'Telas X' } });
    // Amarre SIN precio base (proveedor por color, aquí sin color) → la cascada cae a `sugerido`.
    const telaProv = await cliente.telaProveedor.create({
      data: { idTela: tela.id, idProveedor: prov.id, precio: null, manejaPrecioPorColor: true },
    });
    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'TRAZA',
        maquilaBase: 0,
        telas: { create: [{ idTela: tela.id, consumoPorPrenda: 2, idTelaProveedor: telaProv.id }] },
      },
    });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());

    const t = precosto.lineas.find((l) => l.conceptoCodigo === 'tela');
    expect(t?.importe).toBe(24); // 2 × 12 (sugerido)
    expect(t?.idTelaProveedor).toBeNull(); // NO se acredita al proveedor: el precio salió del sugerido
  });

  it('avío por talla usa el PROMEDIO SIMPLE de las medidas capturadas (R18, decisión g)', async () => {
    const avio: Avio = await cliente.avio.create({
      data: { clave: 'CIE', descripcion: 'Cierre', precioReferencia: 10 },
    });
    const tCh: Talla = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
    const tG: Talla = await cliente.talla.create({ data: { etiqueta: 'G', orden: 2 } });

    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'POR-TALLA',
        maquilaBase: 0,
        avios: {
          create: [
            {
              idAvio: avio.id,
              consumoPorPrenda: 1, // se IGNORA porque consumoPorTalla
              consumoPorTalla: true,
            },
          ],
        },
      },
    });
    // Medidas por talla (FK compuesta) — se crean explícitas para no depender de un nested create.
    await cliente.modeloAvioTalla.createMany({
      data: [
        { idModelo: modelo.id, idAvio: avio.id, idTalla: tCh.id, consumo: 2 },
        { idModelo: modelo.id, idAvio: avio.id, idTalla: tG.id, consumo: 4 },
      ],
    });

    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());

    const linea = precosto.lineas.find((l) => l.conceptoCodigo === 'avios');
    expect(linea?.consumo).toBe(3); // promedio (2+4)/2
    expect(linea?.importe).toBe(30); // 3 × 10 (referencia, sin amarre)
  });

  it('consumoPorTalla=true SIN medidas capturadas cae a consumoPorPrenda (sin división por cero)', async () => {
    const avio: Avio = await cliente.avio.create({
      data: { clave: 'ELA', descripcion: 'Elástico', precioReferencia: 5 },
    });
    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'SIN-MEDIDAS',
        maquilaBase: 0,
        avios: {
          create: [{ idAvio: avio.id, consumoPorPrenda: 1.5, consumoPorTalla: true }],
        },
      },
    });
    // NO se capturan ModeloAvioTalla → debe usar consumoPorPrenda.
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());

    const linea = precosto.lineas.find((l) => l.conceptoCodigo === 'avios');
    expect(linea?.consumo).toBe(1.5); // fallback a consumoPorPrenda
    expect(linea?.importe).toBe(7.5); // 1.5 × 5
  });
});

describe('un solo borrador por desarrollo + versiones', () => {
  it('rechaza generar un SEGUNDO borrador → ErrorConflicto; tras congelar, genera la v2', async () => {
    const modelo = await cliente.modelo.create({ data: { codigo: 'M1', maquilaBase: 5 } });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());

    const v1 = await generarPrecosto(sesion(), desarrollo.id, bd());
    await expect(generarPrecosto(sesion(), desarrollo.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );

    await congelarVersion(sesion(), v1.id, bd());
    const v2 = await generarPrecosto(sesion(), desarrollo.id, bd());
    expect(v2.version).toBe(2);
    expect(v2.estado).toBe('borrador');

    const historial = await listarPrecostosDeDesarrollo(sesion(), desarrollo.id, bd());
    expect(historial.map((p) => p.version)).toEqual([2, 1]); // más nuevo primero
    expect(historial.find((p) => p.version === 1)?.congelado).toBe(true);
  });
});

describe('conceptos manuales + recalcular respeta manuales', () => {
  it('agrega, edita y elimina renglones manuales; recalcular NO los pisa', async () => {
    const tela: Tela = await cliente.tela.create({
      data: { nombre: 'Jersey', precioSugerido: 10 },
    });
    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'MANUAL',
        maquilaBase: 6,
        telas: { create: [{ idTela: tela.id, consumoPorPrenda: 2 }] },
      },
    });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const estampado = await cliente.conceptoCosto.findFirstOrThrow({
      where: { codigo: 'estampado' },
    });

    let precosto = await generarPrecosto(sesion(), desarrollo.id, bd());
    expect(precosto.costoTotal).toBe(26); // 2×10 tela + 6 maquila

    // Agrega un manual (estampado) con consumo → importe = consumo × precio.
    precosto = await agregarLineaManual(
      sesion(),
      precosto.id,
      { idConceptoCosto: estampado.id, consumo: 1, precioUnit: 4 },
      bd(),
    );
    const manual = precosto.lineas.find((l) => l.conceptoCodigo === 'estampado');
    expect(manual?.importe).toBe(4);
    expect(manual?.eliminable).toBe(true);
    expect(precosto.costoTotal).toBe(30);

    // Edita la maquila (renglón fijo, editable).
    const maquila = precosto.lineas.find((l) => l.conceptoCodigo === 'maquila');
    precosto = await editarLinea(sesion(), precosto.id, maquila!.id, { precioUnit: 9 }, bd());
    expect(precosto.lineas.find((l) => l.conceptoCodigo === 'maquila')?.importe).toBe(9);
    expect(precosto.costoTotal).toBe(33); // 20 tela + 9 maquila + 4 estampado

    // Sube el precio de la tela en catálogo y RECALCULA: el BOM cambia, los manuales sobreviven.
    await cliente.tela.update({ where: { id: tela.id }, data: { precioSugerido: 15 } });
    precosto = await recalcularDesdeBom(sesion(), precosto.id, bd());
    expect(precosto.lineas.find((l) => l.conceptoCodigo === 'tela')?.importe).toBe(30); // 2×15
    expect(precosto.lineas.find((l) => l.conceptoCodigo === 'maquila')?.importe).toBe(9); // NO pisado
    expect(precosto.lineas.find((l) => l.conceptoCodigo === 'estampado')?.importe).toBe(4); // NO pisado
    expect(precosto.costoTotal).toBe(43); // 30 + 9 + 4

    // Elimina el manual (no fijo).
    precosto = await eliminarLineaManual(sesion(), precosto.id, manual!.id, bd());
    expect(precosto.lineas.some((l) => l.conceptoCodigo === 'estampado')).toBe(false);
    expect(precosto.costoTotal).toBe(39);
  });

  it('rechaza agregar un renglón manual bajo un concepto FIJO (tela/avíos/maquila/bordado)', async () => {
    const modelo = await cliente.modelo.create({ data: { codigo: 'B1', maquilaBase: 5 } });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());

    const conceptoTela = await cliente.conceptoCosto.findFirstOrThrow({
      where: { codigo: 'tela' },
    });
    await expect(
      agregarLineaManual(
        sesion(),
        precosto.id,
        { idConceptoCosto: conceptoTela.id, precioUnit: 10 },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    // El estampado (no fijo) SÍ se agrega.
    const estampado = await cliente.conceptoCosto.findFirstOrThrow({
      where: { codigo: 'estampado' },
    });
    await expect(
      agregarLineaManual(
        sesion(),
        precosto.id,
        { idConceptoCosto: estampado.id, precioUnit: 3 },
        bd(),
      ),
    ).resolves.toMatchObject({ estado: 'borrador' });
  });

  it('no permite eliminar la maquila (fijo) ni editar un renglón BOM', async () => {
    const tela: Tela = await cliente.tela.create({
      data: { nombre: 'Jersey', precioSugerido: 10 },
    });
    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'REGLAS',
        maquilaBase: 6,
        telas: { create: [{ idTela: tela.id, consumoPorPrenda: 2 }] },
      },
    });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());

    const maquila = precosto.lineas.find((l) => l.conceptoCodigo === 'maquila')!;
    await expect(
      eliminarLineaManual(sesion(), precosto.id, maquila.id, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    const telaLinea = precosto.lineas.find((l) => l.conceptoCodigo === 'tela')!;
    await expect(
      editarLinea(sesion(), precosto.id, telaLinea.id, { precioUnit: 99 }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

describe('congelado inmutable + estado del desarrollo', () => {
  it('congelar persiste el costoTotal y bloquea todo cambio posterior; el desarrollo pasa a "cotizado"', async () => {
    const modelo = await cliente.modelo.create({ data: { codigo: 'FRIO', maquilaBase: 7 } });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const estampado = await cliente.conceptoCosto.findFirstOrThrow({
      where: { codigo: 'estampado' },
    });

    const borrador = await generarPrecosto(sesion(), desarrollo.id, bd());
    const congelado = await congelarVersion(sesion(), borrador.id, bd());
    expect(congelado.estado).toBe('congelado');
    expect(congelado.congelado).toBe(true);
    expect(congelado.congeladoEn).not.toBeNull();
    expect(congelado.congeladoPorId).toBe('usuario-prueba');
    expect(congelado.costoTotal).toBe(7);

    // Persistió en BD.
    const enBd = await cliente.precosto.findUniqueOrThrow({ where: { id: borrador.id } });
    expect(enBd.costoTotal?.toNumber()).toBe(7);

    // Inmutable: recalcular/editar/agregar/eliminar/congelar de nuevo → ErrorConflicto (los 5).
    const maquila = congelado.lineas.find((l) => l.conceptoCodigo === 'maquila')!;
    await expect(recalcularDesdeBom(sesion(), borrador.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
    await expect(
      agregarLineaManual(
        sesion(),
        borrador.id,
        { idConceptoCosto: estampado.id, precioUnit: 1 },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    await expect(
      editarLinea(sesion(), borrador.id, maquila.id, { precioUnit: 99 }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    await expect(
      eliminarLineaManual(sesion(), borrador.id, maquila.id, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    await expect(congelarVersion(sesion(), borrador.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );

    // El desarrollo ahora es "cotizado" (estado derivado, E2).
    const proyecto = await obtenerProyecto(sesion(), idProyecto, bd());
    expect(proyecto.desarrollos.find((d) => d.id === desarrollo.id)?.estado).toBe('cotizado');
  });

  it('no congela un precosto SIN renglones', async () => {
    const modelo = await cliente.modelo.create({ data: { codigo: 'VACIO', maquilaBase: 0 } });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());
    // Un modelo sin BOM y maquila 0 igual genera el renglón de maquila (importe 0) → hay ≥1 renglón.
    // Lo eliminamos NO se puede (fijo); en su lugar validamos un precosto realmente vacío borrando su
    // única línea directo en BD para probar la guarda de congelar.
    await cliente.precostoLinea.deleteMany({ where: { idPrecosto: precosto.id } });
    await expect(congelarVersion(sesion(), precosto.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
  });
});

describe('permisos + aislamiento por empresa (A9)', () => {
  it('sin desarrollo.precostear no se genera; sin ver-importes los importes salen null', async () => {
    const tela: Tela = await cliente.tela.create({ data: { nombre: 'Felpa', precioSugerido: 20 } });
    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'PERM',
        maquilaBase: 5,
        telas: { create: [{ idTela: tela.id, consumoPorPrenda: 1 }] },
      },
    });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());

    await expect(
      generarPrecosto(sesion(['desarrollo.ver']), desarrollo.id, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);

    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());
    // Sin ver-importes: precios/importes ocultos, consumo visible.
    const sinImportes = await obtenerPrecosto(sesion(['desarrollo.ver']), precosto.id, bd());
    expect(sinImportes.costoTotal).toBeNull();
    const t = sinImportes.lineas.find((l) => l.conceptoCodigo === 'tela');
    expect(t?.importe).toBeNull();
    expect(t?.precioUnit).toBeNull();
    expect(t?.consumo).toBe(1);
  });

  it('generar un precosto para un desarrollo de OTRA empresa → ErrorNoEncontrado (A9)', async () => {
    const modelo = await cliente.modelo.create({ data: { codigo: 'CROSS', maquilaBase: 5 } });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());

    const otra = await crearEmpresaPrueba(cliente, 'Empresa ajena');
    const sesionOtra = sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERM });
    await expect(generarPrecosto(sesionOtra, desarrollo.id, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
    await expect(
      listarPrecostosDeDesarrollo(sesionOtra, desarrollo.id, bd()),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  it('un precosto de OTRA empresa no se ve ni se muta → ErrorNoEncontrado', async () => {
    const modelo = await cliente.modelo.create({ data: { codigo: 'AJENO', maquilaBase: 5 } });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());

    const otra = await crearEmpresaPrueba(cliente, 'Otra empresa');
    const sesionOtra = sesionDePrueba({ idEmpresaActiva: otra.id, permisos: PERM });

    await expect(obtenerPrecosto(sesionOtra, precosto.id, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
    await expect(congelarVersion(sesionOtra, precosto.id, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });
});
