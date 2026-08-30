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
import {
  clientePruebas,
  crearEmpresaPrueba,
  crearTipoArtePrueba,
  limpiarBaseDatos,
} from '../../pruebas/contexto.js';
import { redondear2 } from '../costos/decimales.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { crearDesarrollo } from './desarrollos.js';
import { obtenerProyecto, crearProyecto } from './proyectos.js';
import {
  agregarLineaManual,
  congelarVersion,
  editarLinea,
  eliminarLinea,
  generarPrecosto,
  listarPrecostosDeDesarrollo,
  obtenerPrecosto,
  recalcularDesdeBom,
  restaurarLineaBom,
} from './precostos.js';

let cliente: PrismaClient;
/** Id del tipo de arte «bordado» del catálogo único (V1-E3f): el arte no existe sin él. */
let idTipoArte: number;
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
    { codigo: 'corte', nombre: 'Corte', orden: 8, fijo: true },
    // ⭐ V1-E8w: EMPAQUE, la tercera ancla fija — sin él `generarPrecosto` truena.
    { codigo: 'empaque', nombre: 'Empaque', orden: 9, fijo: true },
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
  idTipoArte = await crearTipoArtePrueba(cliente);
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
    // 1.5×25 (amarre) + 2×5 (amarre caro) + 8 maquila + 2.20 de EMPAQUE (V1-E8w, la tercera ancla
    // fija: nace en TODO precosto nuevo con el default de la empresa) = 57.70.
    expect(precosto.costoTotal).toBe(57.7);

    const tTela = precosto.lineas.find((l) => l.conceptoCodigo === 'tela');
    expect(tTela?.importe).toBe(37.5);
    expect(tTela?.idTelaProveedor).toBe(telaProv.id);
    expect(tTela?.editable).toBe(true); // R5/B12: cualquier renglón del borrador es editable
    expect(tTela?.eliminable).toBe(true); // BOM: se puede quitar (reaparece al recalcular)
    expect(tTela?.ajustado).toBe(false); // aún no se ha tocado a mano

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

  it('el PROMEDIO por talla NO TERMINANTE se guarda redondeado a 4 y el importe sale de ESE número', async () => {
    // Mismo defecto que el del precio, un campo más allá: `consumo` es `Decimal(12,4)`, pero el
    // promedio de R18 no tiene por qué caber ahí ((1+1+2)/3 = 1.33333…). Si se guardara redondeado
    // por Postgres (que redondea, NO trunca) pero el importe se calculara con el crudo,
    // (1.3333) y el importe se calculara con el promedio completo, la fila rompería la invariante
    // `importe = redondear2(consumo × precio)`: con un avío de $50 daría 66.67 cuando el consumo
    // guardado × el precio da 66.66.
    const avio: Avio = await cliente.avio.create({
      data: { clave: 'APL', descripcion: 'Aplicación bordada', precioReferencia: 50 },
    });
    const tallas: Talla[] = [];
    for (const [i, etiqueta] of ['CH', 'M', 'G'].entries()) {
      tallas.push(await cliente.talla.create({ data: { etiqueta, orden: i + 1 } }));
    }
    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'PROMEDIO-INFINITO',
        maquilaBase: 0,
        avios: { create: [{ idAvio: avio.id, consumoPorPrenda: 1, consumoPorTalla: true }] },
      },
    });
    await cliente.modeloAvioTalla.createMany({
      data: [
        { idModelo: modelo.id, idAvio: avio.id, idTalla: tallas[0]!.id, consumo: 1 },
        { idModelo: modelo.id, idAvio: avio.id, idTalla: tallas[1]!.id, consumo: 1 },
        { idModelo: modelo.id, idAvio: avio.id, idTalla: tallas[2]!.id, consumo: 2 },
      ],
    });

    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());

    const linea = precosto.lineas.find((l) => l.conceptoCodigo === 'avios');
    expect(linea?.consumo).toBe(1.3333); // (1+1+2)/3 = 1.33333… → 4 decimales, la escala de la columna
    expect(linea?.importe).toBe(66.66); // 1.3333 × 50 — NO 66.67 (que sale del promedio crudo)
    // La invariante, explícita: lo que se guarda y lo que multiplica son EL MISMO número.
    expect(linea?.importe).toBe(redondear2((linea?.consumo ?? 0) * (linea?.precioUnit ?? 0)));
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

  it('avío "por medida" usa el PROMEDIO SIMPLE de los precios de las medidas (R5, B11)', async () => {
    const avio: Avio = await cliente.avio.create({
      data: {
        clave: 'CIE-5',
        descripcion: 'Cierre #5 metálico',
        precioReferencia: 99, // NO se usa: gana el promedio de medidas
        medidas: {
          create: [
            { medida: '15 cm', precio: 5.8 },
            { medida: '18 cm', precio: 6.2 },
            { medida: '22 cm', precio: 6.8 },
            { medida: 'vieja', precio: 100, activo: false }, // inactiva: fuera del promedio
          ],
        },
      },
    });
    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'POR-MEDIDA',
        maquilaBase: 0,
        avios: { create: [{ idAvio: avio.id, consumoPorPrenda: 1 }] },
      },
    });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());

    const linea = precosto.lineas.find((l) => l.conceptoCodigo === 'avios');
    // promedio (5.8+6.2+6.8)/3 = 6.27 (redondeado a 2); la medida inactiva NO cuenta.
    expect(linea?.precioUnit).toBe(6.27);
    expect(linea?.importe).toBe(6.27); // 1 × 6.27
    expect(linea?.idAvioProveedor).toBeNull(); // el precio salió de las medidas, no de un proveedor
  });

  it('un precio de COLA LARGA no descuadra precio e importe (el promedio de medidas DIVIDE)', async () => {
    // ⚠️ §Post-F9.97 — De dónde sale hoy la cola larga. Este caso se escribió para el «factor de
    // conversión» ($100 la caja de 144 = 0.694444…), que se retiró en V1-E8a: todos los precios de
    // proveedor son `Decimal(12,2)` y la cascada ya no divide por nada. El divisor que SÍ queda vivo
    // es el PROMEDIO de las medidas del avío "por medida" (R5/B11), y el riesgo es el mismo: el
    // precio se guarda en `Decimal(12,2)`, así que el importe TIENE que calcularse con el precio YA
    // redondeado. (1 + 1 + 1.10) / 3 = 1.033333… → 1.03; con consumo 6 el importe es 6.18. Si se
    // calculara con el crudo daría 6.20 y la fila mostraría 1.03 al lado de 6.20 — dos centavos que
    // entran al `costoTotal` que se persiste al congelar y de ahí al precio del cliente.
    const avio: Avio = await cliente.avio.create({
      data: {
        clave: 'BOT-COLA',
        descripcion: 'Botón por medida',
        medidas: {
          create: [
            { medida: 'ch', precio: 1 },
            { medida: 'md', precio: 1 },
            { medida: 'gd', precio: 1.1 },
          ],
        },
      },
    });
    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'COLA-LARGA',
        maquilaBase: 0,
        avios: { create: [{ idAvio: avio.id, consumoPorPrenda: 6 }] },
      },
    });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());

    const linea = precosto.lineas.find((l) => l.conceptoCodigo === 'avios');
    expect(linea?.precioUnit).toBe(1.03); // 3.10 ÷ 3 = 1.033333… → 1.03
    expect(linea?.importe).toBe(6.18); // 6 × 1.03 — NO 6.20 (que sale del precio crudo)
    expect(linea?.importe).toBe(redondear2((linea?.consumo ?? 0) * (linea?.precioUnit ?? 0)));
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

describe('renglón manual LIGADO a un avío del catálogo (Daniel, ago-2026)', () => {
  /** Modelo pelón + su precosto borrador (sin BOM: sólo corte + maquila). */
  async function borradorPelon(codigo: string): Promise<number> {
    const modelo = await cliente.modelo.create({ data: { codigo, maquilaBase: 5 } });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());
    return precosto.id;
  }

  async function conceptoAvios(): Promise<number> {
    const c = await cliente.conceptoCosto.findFirstOrThrow({ where: { codigo: 'avios' } });
    return c.id;
  }

  it('resuelve descripción y PRECIO del catálogo (más barato) y deja el renglón LIGADO al avío', async () => {
    const avio: Avio = await cliente.avio.create({
      data: { clave: 'BOT', descripcion: 'Botón 4 hoyos', precioReferencia: 9 },
    });
    const caro = await cliente.proveedor.create({ data: { nombre: 'Caros' } });
    const barato = await cliente.proveedor.create({ data: { nombre: 'Baratos' } });
    await cliente.avioProveedor.create({
      data: { idAvio: avio.id, idProveedor: caro.id, precio: 5 },
    });
    await cliente.avioProveedor.create({
      data: { idAvio: avio.id, idProveedor: barato.id, precio: 2 },
    });

    const idPrecosto = await borradorPelon('AVIO-CAT');
    const precosto = await agregarLineaManual(
      sesion(),
      idPrecosto,
      { idConceptoCosto: await conceptoAvios(), idAvio: avio.id, consumo: 3 },
      bd(),
    );

    const linea = precosto.lineas.find((l) => l.idAvio === avio.id)!;
    // La MISMA cascada del BOM: sin amarre gana el más barato (2), no la referencia (9).
    expect(linea.precioUnit).toBe(2);
    expect(linea.importe).toBe(6); // 3 × 2
    expect(linea.descripcion).toBe('BOT — Botón 4 hoyos');
    // LIGADO (no sólo el nombre copiado) + traza del proveedor cuyo precio se usó.
    expect(linea.idAvioProveedor).toBe(barato.id);
    // Sigue siendo MANUAL: sobrevive al recalcular y se puede quitar.
    expect(linea.origen).toBe('manual');
    expect(linea.eliminable).toBe(true);
  });

  it('el precio TECLEADO manda sobre el del catálogo, y el renglón queda editable después', async () => {
    const avio: Avio = await cliente.avio.create({
      data: { clave: 'ELA', descripcion: 'Elástico', precioReferencia: 7 },
    });
    const idPrecosto = await borradorPelon('AVIO-PRECIO');
    let precosto = await agregarLineaManual(
      sesion(),
      idPrecosto,
      { idConceptoCosto: await conceptoAvios(), idAvio: avio.id, precioUnit: 1.25 },
      bd(),
    );
    let linea = precosto.lineas.find((l) => l.idAvio === avio.id)!;
    expect(linea.precioUnit).toBe(1.25);

    // El precio RESUELTO no queda fijo: se edita como cualquier renglón manual.
    precosto = await editarLinea(sesion(), idPrecosto, linea.id, { precioUnit: 4 }, bd());
    linea = precosto.lineas.find((l) => l.idAvio === avio.id)!;
    expect(linea.precioUnit).toBe(4);
    expect(linea.idAvio).toBe(avio.id); // la liga se conserva
  });

  it('el renglón NUNCA queda con precio e importe descuadrados por el redondeo (1.005)', async () => {
    // La columna es `Decimal(12,2)` y Postgres redondea half-up al guardar (1.005 → 1.01), mientras
    // que en JS `redondear2(1.005)` da 1.00 (1.005×100 = 100.4999…). Si el importe se calculara con
    // el precio CRUDO, la misma fila mostraría precio 1.01 e importe 1.00 — y ese importe entra al
    // `costoTotal` que se persiste al congelar. Se fija en el ALTA y en la EDICIÓN, que es
    // justamente lo que se hace al ajustar un precio a mano.
    const idPrecosto = await borradorPelon('CENTAVO');
    const idConcepto = await conceptoAvios();

    let precosto = await agregarLineaManual(
      sesion(),
      idPrecosto,
      { idConceptoCosto: idConcepto, descripcion: 'Cinta', precioUnit: 1.005 },
      bd(),
    );
    let linea = precosto.lineas.find((l) => l.descripcion === 'Cinta')!;
    expect(linea.importe).toBe(linea.precioUnit);

    // EDICIÓN (el hueco que quedaba): precio con 3 decimales + consumo.
    precosto = await editarLinea(
      sesion(),
      idPrecosto,
      linea.id,
      { precioUnit: 1.005, consumo: 2 },
      bd(),
    );
    linea = precosto.lineas.find((l) => l.id === linea.id)!;
    // El precio guardado es el redondeado a 2 y el importe se calcula con ESE mismo precio.
    expect(linea.precioUnit).toBe(1);
    expect(linea.importe).toBe(2);
  });

  it('un avío POR MEDIDA se valúa con el PROMEDIO de sus medidas activas (misma regla del BOM, B11)', async () => {
    const avio: Avio = await cliente.avio.create({
      data: { clave: 'CIN', descripcion: 'Cinta', precioReferencia: 50 },
    });
    await cliente.avioMedida.createMany({
      data: [
        { idAvio: avio.id, medida: 'S', precio: 2 },
        { idAvio: avio.id, medida: 'M', precio: 4 },
        { idAvio: avio.id, medida: 'XL', precio: 99, activo: false },
      ],
    });

    const idPrecosto = await borradorPelon('AVIO-MEDIDA');
    const precosto = await agregarLineaManual(
      sesion(),
      idPrecosto,
      { idConceptoCosto: await conceptoAvios(), idAvio: avio.id },
      bd(),
    );
    const linea = precosto.lineas.find((l) => l.idAvio === avio.id)!;
    expect(linea.precioUnit).toBe(3); // (2+4)/2, la inactiva NO cuenta
    expect(linea.idAvioProveedor).toBeNull(); // el precio no salió de un proveedor
  });

  it('rechaza un avío inexistente o DESACTIVADO', async () => {
    const idPrecosto = await borradorPelon('AVIO-MALO');
    const idConcepto = await conceptoAvios();
    await expect(
      agregarLineaManual(
        sesion(),
        idPrecosto,
        { idConceptoCosto: idConcepto, idAvio: 99999 },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);

    const apagado: Avio = await cliente.avio.create({
      data: { clave: 'OFF', descripcion: 'Retirado', precioReferencia: 1, activo: false },
    });
    await expect(
      agregarLineaManual(
        sesion(),
        idPrecosto,
        { idConceptoCosto: idConcepto, idAvio: apagado.id },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
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
    expect(precosto.costoTotal).toBe(28.2); // 2×10 tela + 6 maquila + 2.20 empaque (V1-E8w)

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
    expect(precosto.costoTotal).toBe(32.2); // 28.20 + 4 del estampado manual

    // Edita la maquila (renglón fijo, editable).
    const maquila = precosto.lineas.find((l) => l.conceptoCodigo === 'maquila');
    precosto = await editarLinea(sesion(), precosto.id, maquila!.id, { precioUnit: 9 }, bd());
    expect(precosto.lineas.find((l) => l.conceptoCodigo === 'maquila')?.importe).toBe(9);
    expect(precosto.costoTotal).toBe(35.2); // 20 tela + 9 maquila + 4 estampado + 2.20 empaque

    // Sube el precio de la tela en catálogo y RECALCULA: el BOM cambia, los manuales sobreviven.
    await cliente.tela.update({ where: { id: tela.id }, data: { precioSugerido: 15 } });
    precosto = await recalcularDesdeBom(sesion(), precosto.id, bd());
    expect(precosto.lineas.find((l) => l.conceptoCodigo === 'tela')?.importe).toBe(30); // 2×15
    expect(precosto.lineas.find((l) => l.conceptoCodigo === 'maquila')?.importe).toBe(9); // NO pisado
    expect(precosto.lineas.find((l) => l.conceptoCodigo === 'estampado')?.importe).toBe(4); // NO pisado
    // ⭐ V1-E8w: el ancla de EMPAQUE es `manual`, así que recalcular tampoco la pisa.
    expect(precosto.lineas.find((l) => l.conceptoCodigo === 'empaque')?.importe).toBe(2.2);
    expect(precosto.costoTotal).toBe(45.2); // 30 + 9 + 4 + 2.20

    // Quita el manual (no ancla).
    precosto = await eliminarLinea(sesion(), precosto.id, manual!.id, bd());
    expect(precosto.lineas.some((l) => l.conceptoCodigo === 'estampado')).toBe(false);
    expect(precosto.costoTotal).toBe(41.2);
  });

  it('rechaza agregar un manual bajo un concepto ANCLA (maquila/corte/empaque); tela/avíos SÍ se pueden (B12)', async () => {
    const modelo = await cliente.modelo.create({ data: { codigo: 'B1', maquilaBase: 5 } });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());

    // Los anclas (maquila/corte) YA tienen su renglón fijo por prenda → no se duplican.
    const conceptoMaquila = await cliente.conceptoCosto.findFirstOrThrow({
      where: { codigo: 'maquila' },
    });
    const conceptoCorte = await cliente.conceptoCosto.findFirstOrThrow({
      where: { codigo: 'corte' },
    });
    await expect(
      agregarLineaManual(
        sesion(),
        precosto.id,
        { idConceptoCosto: conceptoMaquila.id, precioUnit: 10 },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    await expect(
      agregarLineaManual(
        sesion(),
        precosto.id,
        { idConceptoCosto: conceptoCorte.id, precioUnit: 10 },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    // ⭐ V1-E8w: EMPAQUE es la TERCERA ancla y se comporta igual que sus dos hermanas.
    const conceptoEmpaque = await cliente.conceptoCosto.findFirstOrThrow({
      where: { codigo: 'empaque' },
    });
    await expect(
      agregarLineaManual(
        sesion(),
        precosto.id,
        { idConceptoCosto: conceptoEmpaque.id, precioUnit: 3 },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    // R5/B12: un renglón de tela SÍ se puede agregar a mano en la calculadora (scratch), y es quitable.
    const conceptoTela = await cliente.conceptoCosto.findFirstOrThrow({
      where: { codigo: 'tela' },
    });
    const conManualTela = await agregarLineaManual(
      sesion(),
      precosto.id,
      { idConceptoCosto: conceptoTela.id, descripcion: 'Tela extra', precioUnit: 10 },
      bd(),
    );
    const manualTela = conManualTela.lineas.find(
      (l) => l.conceptoCodigo === 'tela' && l.origen === 'manual',
    );
    expect(manualTela?.eliminable).toBe(true);

    // El estampado (no fijo) también.
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

  it('no permite eliminar los anclas maquila/corte, pero SÍ editar/quitar/restaurar un BOM (B8/B12)', async () => {
    const tela: Tela = await cliente.tela.create({
      data: { nombre: 'Jersey', precioSugerido: 10 },
    });
    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'REGLAS',
        maquilaBase: 6,
        corteBase: 4,
        telas: { create: [{ idTela: tela.id, consumoPorPrenda: 2 }] },
      },
    });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    let precosto = await generarPrecosto(sesion(), desarrollo.id, bd());

    // B8: el renglón de corte nació con el corteBase del modelo.
    const corte = precosto.lineas.find((l) => l.conceptoCodigo === 'corte')!;
    expect(corte.importe).toBe(4);
    expect(corte.eliminable).toBe(false); // ancla fija

    // Los anclas maquila/corte NO se eliminan.
    const maquila = precosto.lineas.find((l) => l.conceptoCodigo === 'maquila')!;
    await expect(eliminarLinea(sesion(), precosto.id, maquila.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
    await expect(eliminarLinea(sesion(), precosto.id, corte.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );

    // B12: editar un renglón BOM AHORA se permite y lo marca `ajustado` (traza).
    const telaLinea = precosto.lineas.find((l) => l.conceptoCodigo === 'tela')!;
    precosto = await editarLinea(sesion(), precosto.id, telaLinea.id, { precioUnit: 99 }, bd());
    const ajustada = precosto.lineas.find((l) => l.conceptoCodigo === 'tela')!;
    expect(ajustada.ajustado).toBe(true);
    expect(ajustada.importe).toBe(198); // 2 × 99

    // Recalcular NO pisa el renglón ajustado (respeta el ajuste de la mesa).
    await cliente.tela.update({ where: { id: tela.id }, data: { precioSugerido: 50 } });
    precosto = await recalcularDesdeBom(sesion(), precosto.id, bd());
    expect(precosto.lineas.find((l) => l.conceptoCodigo === 'tela')?.importe).toBe(198); // sigue ajustado
    expect(precosto.lineas.filter((l) => l.conceptoCodigo === 'tela')).toHaveLength(1); // sin duplicar

    // Restaurar lo devuelve al valor del BOM (2 × 50) y limpia `ajustado`.
    precosto = await restaurarLineaBom(sesion(), precosto.id, ajustada.id, bd());
    const restaurada = precosto.lineas.find((l) => l.conceptoCodigo === 'tela')!;
    expect(restaurada.ajustado).toBe(false);
    expect(restaurada.importe).toBe(100); // 2 × 50 (sugerido vigente)
  });

  it('un ARTE ajustado que perdió su traza NO se duplica al recalcular (se reconoce por su texto)', async () => {
    // V1-E3d: el arte es HIJO del modelo, así que borrarlo pone `idModeloArte` del renglón en NULL
    // (SetNull). Si el modelo vuelve a tener un arte con la MISMA descripción —recapturado, o
    // re-apuntado por la migración—, el renglón ajustado huérfano ya no casa por id y el arte
    // entraría DOS veces en el borrador. Con el catálogo viejo no pasaba (el id sobrevivía).
    // V1-E3f: el texto que se compara es la `descripcion` (el `nombre` se retiró).
    const modelo = await cliente.modelo.create({ data: { codigo: 'ARTE-HUERFANO' } });
    const arte = await cliente.modeloArte.create({
      data: { idModelo: modelo.id, descripcion: 'Escudo', idTipoArte, precio: 20 },
    });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    let precosto = await generarPrecosto(sesion(), desarrollo.id, bd());

    // Se ajusta a mano el renglón del arte (B12: queda `ajustado`, recalcular ya no lo pisa).
    const lineaArte = precosto.lineas.find((l) => l.conceptoCodigo === 'bordado')!;
    precosto = await editarLinea(sesion(), precosto.id, lineaArte.id, { precioUnit: 35 }, bd());
    expect(precosto.lineas.find((l) => l.conceptoCodigo === 'bordado')?.ajustado).toBe(true);

    // El arte se borra del modelo (la traza del renglón cae a NULL) y se recaptura con la MISMA
    // descripción: id nuevo, misma identidad de negocio.
    await cliente.modeloArte.delete({ where: { id: arte.id } });
    await cliente.modeloArte.create({
      data: { idModelo: modelo.id, descripcion: 'Escudo', idTipoArte, precio: 20 },
    });
    expect(
      (await cliente.precostoLinea.findUniqueOrThrow({ where: { id: lineaArte.id } })).idModeloArte,
    ).toBeNull();

    precosto = await recalcularDesdeBom(sesion(), precosto.id, bd());

    const artes = precosto.lineas.filter((l) => l.conceptoCodigo === 'bordado');
    expect(artes).toHaveLength(1); // SIN duplicar
    expect(artes[0]?.importe).toBe(35); // y gana el ajuste de la mesa
  });
});

/**
 * ⭐⭐ V1-E8w (§Post-F9.153) — EL COSTO DE EMPAQUE, la TERCERA ancla fija. Daniel, textual:
 *
 * > *«nos falto meter el costo del empaque. Es un campo adicional…. como si fuera corte»*
 * > *«el empaque no es de catalogo…. es simplemente un campo que casi siempre es el mismo costo»*
 * > *«Ponle 2.20 pesos por default, y ya si cambia, que se pueda modificar»*
 *
 * Lo que estas pruebas fijan, y que es lo que se le dijo a Daniel: el 2.20 **NO está clavado en el
 * código** (vive en `ConfiguracionEmpresa`, se cambia sin deploy), y **cambiarlo NO toca ninguna
 * receta ya hecha** — ni un borrador anterior ni, muchísimo menos, un congelado.
 */
describe('⭐ el ancla de EMPAQUE (V1-E8w, §Post-F9.153)', () => {
  /** Fija (o crea) el costo de empaque de la empresa de pruebas. */
  async function fijarEmpaqueDeEmpresa(valor: number): Promise<void> {
    await cliente.configuracionEmpresa.upsert({
      where: { idEmpresa: empresa.id },
      create: { idEmpresa: empresa.id, costoEmpaqueBase: valor },
      update: { costoEmpaqueBase: valor },
    });
  }

  it('todo precosto NUEVO nace con su renglón de empaque, editable pero NO eliminable', async () => {
    const modelo = await cliente.modelo.create({ data: { codigo: 'EMP-1', maquilaBase: 10 } });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());

    const empaque = precosto.lineas.find((l) => l.conceptoCodigo === 'empaque');
    expect(empaque).toBeDefined();
    expect(empaque?.origen).toBe('manual');
    expect(empaque?.descripcion).toBe('Empaque');
    expect(empaque?.consumo).toBeNull();
    // Sin fila de configuración manda el default de respaldo, que ES el de la migración.
    expect(empaque?.importe).toBe(2.2);
    // Editable pero NO eliminable: exactamente el trato de maquila y corte.
    expect(empaque?.editable).toBe(true);
    expect(empaque?.eliminable).toBe(false);
    await expect(eliminarLinea(sesion(), precosto.id, empaque!.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );

    // Y sí se edita ("y ya si cambia, que se pueda modificar").
    const editado = await editarLinea(
      sesion(),
      precosto.id,
      empaque!.id,
      { precioUnit: 3.5 },
      bd(),
    );
    expect(editado.lineas.find((l) => l.conceptoCodigo === 'empaque')?.importe).toBe(3.5);
  });

  /**
   * 🔴 **EL 2.20 NO ESTÁ CLAVADO EN EL CÓDIGO.** Si lo estuviera, mover la configuración no cambiaría
   * nada y esta prueba moriría — que es justo el defecto que se prometió que no existiría.
   */
  it('🔴 el default sale de `ConfiguracionEmpresa`, NO del código: se cambia sin deploy', async () => {
    await fijarEmpaqueDeEmpresa(2.5);
    const modelo = await cliente.modelo.create({ data: { codigo: 'EMP-2', maquilaBase: 10 } });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());

    expect(precosto.lineas.find((l) => l.conceptoCodigo === 'empaque')?.importe).toBe(2.5);
    expect(precosto.costoTotal).toBe(12.5); // 10 de maquila + 2.50 de empaque
  });

  /**
   * 🔴🔴 **CAMBIAR EL DEFAULT NO TOCA NINGUNA RECETA YA HECHA.** Es la promesa exacta que se le hizo
   * a Daniel, y la que más caro costaría romper: un precosto CONGELADO es la foto de lo que se
   * cotizó (D3), y un borrador anterior es trabajo en curso que nadie pidió reescribir. Se prueba
   * con las dos —congelado y borrador— y además con un `recalcularDesdeBom` de por medio, que es
   * justo la operación que uno sospecharía capaz de pisarlo.
   */
  it('🔴 subir el empaque NO mueve un precosto congelado NI un borrador anterior', async () => {
    await fijarEmpaqueDeEmpresa(2.2);
    const tela = await cliente.tela.create({ data: { nombre: 'Felpa EMP', precioSugerido: 10 } });
    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'EMP-3',
        maquilaBase: 10,
        telas: { create: [{ idTela: tela.id, consumoPorPrenda: 2 }] },
      },
    });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());

    // v1 CONGELADA con el empaque de $2.20 → 20 + 10 + 2.20 = 32.20.
    const v1 = await congelarVersion(
      sesion(),
      (await generarPrecosto(sesion(), desarrollo.id, bd())).id,
      bd(),
    );
    expect(v1.costoTotal).toBe(32.2);

    // v2 en BORRADOR, también con $2.20.
    const v2 = await generarPrecosto(sesion(), desarrollo.id, bd());
    expect(v2.lineas.find((l) => l.conceptoCodigo === 'empaque')?.importe).toBe(2.2);

    // El empaque SUBE a $2.50 (Daniel lo cambia en Administración › Empresas, sin deploy).
    await fijarEmpaqueDeEmpresa(2.5);

    // La v1 congelada: intacta, en la BD y en lo que lee el API.
    const v1EnBd = await cliente.precosto.findUniqueOrThrow({ where: { id: v1.id } });
    expect(v1EnBd.costoTotal?.toNumber()).toBe(32.2);
    expect((await obtenerPrecosto(sesion(), v1.id, bd())).costoTotal).toBe(32.2);

    // El borrador v2: tampoco se mueve, ni siquiera recalculando desde el BOM (el recalcular
    // regenera los renglones de BOM y NUNCA toca los `manual`, que es donde vive el empaque).
    const v2Recalculado = await recalcularDesdeBom(sesion(), v2.id, bd());
    expect(v2Recalculado.lineas.find((l) => l.conceptoCodigo === 'empaque')?.importe).toBe(2.2);
    expect(v2Recalculado.costoTotal).toBe(32.2);

    // Sólo la receta NUEVA estrena el precio nuevo.
    await congelarVersion(sesion(), v2.id, bd());
    const v3 = await generarPrecosto(sesion(), desarrollo.id, bd());
    expect(v3.lineas.find((l) => l.conceptoCodigo === 'empaque')?.importe).toBe(2.5);
  });

  /**
   * 🔴 **Un borrador que NACIÓ SIN EMPAQUE tiene que poder ponérselo.** Es el caso real de todos los
   * borradores anteriores a esta versión: la regla vieja vetaba el CONCEPTO, no el duplicado, así
   * que los habría dejado sin salida (recalcular tampoco los toca). La regla real es "ÚNICO por
   * precosto", y con ella el hueco se llena y el duplicado se sigue rechazando.
   */
  it('🔴 un borrador SIN el ancla puede recibirla a mano; una SEGUNDA se rechaza', async () => {
    const modelo = await cliente.modelo.create({ data: { codigo: 'EMP-4', maquilaBase: 10 } });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());
    const concepto = await cliente.conceptoCosto.findFirstOrThrow({ where: { codigo: 'empaque' } });

    // Se simula el borrador viejo: se borra su renglón de empaque directo en BD (por dominio no se
    // puede — es ancla, y eso es justo lo que garantiza que este caso sólo venga del pasado).
    const empaque = precosto.lineas.find((l) => l.conceptoCodigo === 'empaque')!;
    await cliente.precostoLinea.delete({ where: { id: empaque.id } });

    const conEmpaque = await agregarLineaManual(
      sesion(),
      precosto.id,
      { idConceptoCosto: concepto.id, descripcion: 'Empaque', precioUnit: 2.2 },
      bd(),
    );
    expect(conEmpaque.lineas.filter((l) => l.conceptoCodigo === 'empaque')).toHaveLength(1);

    // Y la SEGUNDA se sigue rechazando: la regla es ÚNICO por precosto, no "manga ancha".
    await expect(
      agregarLineaManual(
        sesion(),
        precosto.id,
        { idConceptoCosto: concepto.id, precioUnit: 2.2 },
        bd(),
      ),
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
    expect(congelado.costoTotal).toBe(9.2); // + 2.20 del ancla de EMPAQUE (V1-E8w)

    // Persistió en BD.
    const enBd = await cliente.precosto.findUniqueOrThrow({ where: { id: borrador.id } });
    expect(enBd.costoTotal?.toNumber()).toBe(9.2);

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
    await expect(eliminarLinea(sesion(), borrador.id, maquila.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );
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

  /**
   * ⭐ V1-E4 (punto 2). El caso que se colaba: modelo SIN receta y sin costo de maquila → el
   * precosto sí trae renglones (las anclas maquila/corte), así que la guarda de "≥1 renglón" lo
   * dejaba pasar y la versión quedaba congelada —INMUTABLE— en $0.00. De ahí sale el `costoUnit`
   * del renglón de lista y el precio que se le cotiza al cliente.
   */
  it('⭐ NO congela un precosto que suma CERO (versión inmutable que acabaría de precio al cliente)', async () => {
    const modelo = await cliente.modelo.create({ data: { codigo: 'SIN-RECETA', maquilaBase: 0 } });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const borrador = await generarPrecosto(sesion(), desarrollo.id, bd());
    // ⭐ V1-E8w: el ancla de EMPAQUE nace con el default de la empresa (2.20), así que un modelo sin
    // receta ya NO suma cero por sí solo. Se pone a mano en 0 para reproducir el caso que la guarda
    // tiene que atajar — que es lo que se está probando, no el default del empaque.
    const empaque = borrador.lineas.find((l) => l.conceptoCodigo === 'empaque')!;
    await editarLinea(sesion(), borrador.id, empaque.id, { precioUnit: 0 }, bd());
    const enCero = await obtenerPrecosto(sesion(), borrador.id, bd());
    // Tiene renglones (las anclas) pero todos en 0: la guarda vieja lo dejaba pasar.
    expect(enCero.lineas.length).toBeGreaterThan(0);
    expect(enCero.lineas.every((l) => l.importe === 0)).toBe(true);

    await expect(congelarVersion(sesion(), borrador.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );

    // Sigue siendo BORRADOR: no quedó nada sellado a medias.
    const enBd = await cliente.precosto.findUniqueOrThrow({ where: { id: borrador.id } });
    expect(enBd.estado).toBe('borrador');
    expect(enBd.congeladoEn).toBeNull();
  });

  it('con el costo capturado (aunque sea un centavo), el mismo precosto SÍ congela', async () => {
    const modelo = await cliente.modelo.create({ data: { codigo: 'CON-MAQUILA', maquilaBase: 0 } });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const borrador = await generarPrecosto(sesion(), desarrollo.id, bd());
    const maquila = borrador.lineas.find((l) => l.conceptoCodigo === 'maquila')!;
    await editarLinea(sesion(), borrador.id, maquila.id, { precioUnit: 0.01 }, bd());

    const congelado = await congelarVersion(sesion(), borrador.id, bd());

    expect(congelado.estado).toBe('congelado');
    expect(congelado.costoTotal).toBe(2.21); // 0.01 de maquila + 2.20 del ancla de EMPAQUE
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

// ── V1-E3e · UN SOLO COSTO: manda el precio REAL de compra (§Post-F9.48) ──────────────────────────

describe('V1-E3e — el precosto valúa con la ÚLTIMA COMPRA REAL (§Post-F9.48)', () => {
  let folioOc = 0;

  /** Crea una OC de un renglón (fecha explícita: es la que decide cuál es la "última compra"). */
  async function compra(opciones: {
    idProveedor: number;
    fecha: string;
    precio: number;
    idTela?: number;
    idAvio?: number;
    estatus?: 'borrador' | 'autorizada' | 'cancelada';
    idEmpresa?: number;
  }): Promise<void> {
    folioOc += 1;
    await cliente.ordenCompra.create({
      data: {
        numCompra: BigInt(folioOc),
        idEmpresa: opciones.idEmpresa ?? empresa.id,
        idProveedor: opciones.idProveedor,
        estatus: opciones.estatus ?? 'autorizada',
        fecha: new Date(`${opciones.fecha}T00:00:00.000Z`),
        lineas: {
          create: [
            {
              idTela: opciones.idTela ?? null,
              idAvio: opciones.idAvio ?? null,
              cantidad: 100,
              precio: opciones.precio,
            },
          ],
        },
      },
    });
  }

  beforeEach(() => {
    folioOc = 0;
  });

  it('sin amarre: la compra REAL manda sobre el catálogo (tela y avío)', async () => {
    const tela: Tela = await cliente.tela.create({ data: { nombre: 'Felpa', precioSugerido: 20 } });
    const avio: Avio = await cliente.avio.create({
      data: { clave: 'BOT', descripcion: 'Botón', precioReferencia: 3 },
    });
    const prov: Proveedor = await cliente.proveedor.create({ data: { nombre: 'Insumos SA' } });
    // Compra vieja y compra nueva: manda la NUEVA (aunque sea más cara que el catálogo).
    await compra({ idProveedor: prov.id, fecha: '2026-01-01', precio: 18, idTela: tela.id });
    await compra({ idProveedor: prov.id, fecha: '2026-07-01', precio: 30, idTela: tela.id });
    await compra({ idProveedor: prov.id, fecha: '2026-07-02', precio: 5, idAvio: avio.id });

    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'REAL-SIN-AMARRE',
        maquilaBase: 0,
        telas: { create: [{ idTela: tela.id, consumoPorPrenda: 2 }] },
        avios: { create: [{ idAvio: avio.id, consumoPorPrenda: 3 }] },
      },
    });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());

    expect(precosto.lineas.find((l) => l.conceptoCodigo === 'tela')?.importe).toBe(60); // 2 × 30
    expect(precosto.lineas.find((l) => l.conceptoCodigo === 'avios')?.importe).toBe(15); // 3 × 5
  });

  it('⭐ el AMARRE elige el proveedor; el precio es el de la última compra A ESE proveedor', async () => {
    const tela: Tela = await cliente.tela.create({ data: { nombre: 'Rib', precioSugerido: 20 } });
    const amarrado: Proveedor = await cliente.proveedor.create({ data: { nombre: 'Amarrado' } });
    const otro: Proveedor = await cliente.proveedor.create({ data: { nombre: 'Otro' } });
    const telaProv = await cliente.telaProveedor.create({
      data: { idTela: tela.id, idProveedor: amarrado.id, precio: 25 }, // precio NEGOCIADO
    });
    // Al amarrado se le compró en mayo a $28; a OTRO, más reciente (julio) y más barato ($15).
    await compra({ idProveedor: amarrado.id, fecha: '2026-05-01', precio: 28, idTela: tela.id });
    await compra({ idProveedor: otro.id, fecha: '2026-07-01', precio: 15, idTela: tela.id });

    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'REAL-CON-AMARRE',
        maquilaBase: 0,
        telas: {
          create: [{ idTela: tela.id, consumoPorPrenda: 1, idTelaProveedor: telaProv.id }],
        },
      },
    });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());

    const linea = precosto.lineas.find((l) => l.conceptoCodigo === 'tela');
    // Ni los $25 negociados ni los $15 del otro proveedor: los $28 que de verdad se le pagaron a ÉL.
    expect(linea?.precioUnit).toBe(28);
    // Y el renglón sigue acreditando al proveedor amarrado (el precio SALIÓ de él).
    expect(linea?.idTelaProveedor).toBe(telaProv.id);
  });

  it('al proveedor amarrado nunca se le compró → manda su precio NEGOCIADO', async () => {
    const tela: Tela = await cliente.tela.create({ data: { nombre: 'Jersey', precioSugerido: 9 } });
    const amarrado: Proveedor = await cliente.proveedor.create({ data: { nombre: 'Nuevo' } });
    const otro: Proveedor = await cliente.proveedor.create({ data: { nombre: 'Viejo' } });
    const telaProv = await cliente.telaProveedor.create({
      data: { idTela: tela.id, idProveedor: amarrado.id, precio: 25 },
    });
    await compra({ idProveedor: otro.id, fecha: '2026-07-01', precio: 15, idTela: tela.id });

    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'AMARRE-SIN-COMPRA',
        maquilaBase: 0,
        telas: {
          create: [{ idTela: tela.id, consumoPorPrenda: 1, idTelaProveedor: telaProv.id }],
        },
      },
    });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());
    expect(precosto.lineas.find((l) => l.conceptoCodigo === 'tela')?.precioUnit).toBe(25);
  });

  it('una OC en borrador o cancelada NO es una compra: manda el catálogo', async () => {
    const tela: Tela = await cliente.tela.create({ data: { nombre: 'Polar', precioSugerido: 20 } });
    const prov: Proveedor = await cliente.proveedor.create({ data: { nombre: 'X' } });
    await compra({
      idProveedor: prov.id,
      fecha: '2026-08-01',
      precio: 999,
      idTela: tela.id,
      estatus: 'borrador',
    });
    await compra({
      idProveedor: prov.id,
      fecha: '2026-08-02',
      precio: 888,
      idTela: tela.id,
      estatus: 'cancelada',
    });

    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'NO-COMPRADO',
        maquilaBase: 0,
        telas: { create: [{ idTela: tela.id, consumoPorPrenda: 1 }] },
      },
    });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());
    expect(precosto.lineas.find((l) => l.conceptoCodigo === 'tela')?.precioUnit).toBe(20);
  });

  it('⭐ NO-REGRESIÓN: un precosto CONGELADO no se mueve aunque después cambie el precio de compra', async () => {
    const tela: Tela = await cliente.tela.create({ data: { nombre: 'Felpa', precioSugerido: 20 } });
    const prov: Proveedor = await cliente.proveedor.create({ data: { nombre: 'Insumos SA' } });
    await compra({ idProveedor: prov.id, fecha: '2026-01-01', precio: 30, idTela: tela.id });

    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'CONGELADO-FIRME',
        maquilaBase: 10,
        telas: { create: [{ idTela: tela.id, consumoPorPrenda: 2 }] },
      },
    });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const borrador = await generarPrecosto(sesion(), desarrollo.id, bd());
    const congelado = await congelarVersion(sesion(), borrador.id, bd());
    expect(congelado.costoTotal).toBe(72.2); // 2 × 30 + 10 de maquila + 2.20 de empaque

    // Pasa el tiempo y la tela SUBE: nueva compra autorizada, mucho más cara.
    await compra({ idProveedor: prov.id, fecha: '2026-09-09', precio: 55, idTela: tela.id });

    // La FOTO no se mueve: ni el total persistido, ni el renglón, ni lo que se lee del API.
    const releido = await obtenerPrecosto(sesion(), borrador.id, bd());
    expect(releido.costoTotal).toBe(72.2);
    expect(releido.lineas.find((l) => l.conceptoCodigo === 'tela')?.precioUnit).toBe(30);
    expect(releido.lineas.find((l) => l.conceptoCodigo === 'tela')?.importe).toBe(60);
    const enBd = await cliente.precosto.findUniqueOrThrow({ where: { id: borrador.id } });
    expect(enBd.costoTotal?.toNumber()).toBe(72.2);
    // Y sigue siendo inmutable (D3): recalcularlo con el precio nuevo es imposible.
    await expect(recalcularDesdeBom(sesion(), borrador.id, bd())).rejects.toBeInstanceOf(
      ErrorConflicto,
    );

    // La versión NUEVA sí toma el precio nuevo: es exactamente lo que Daniel pidió.
    const v2 = await generarPrecosto(sesion(), desarrollo.id, bd());
    expect(v2.costoTotal).toBe(122.2); // 2 × 55 + 10 + 2.20 de empaque
  });

  it('A9: una compra de OTRA empresa no cambia el precosto de ésta', async () => {
    const tela: Tela = await cliente.tela.create({ data: { nombre: 'Lino', precioSugerido: 20 } });
    const prov: Proveedor = await cliente.proveedor.create({ data: { nombre: 'Y' } });
    const otraEmpresa: Empresa = await crearEmpresaPrueba(cliente, 'Empresa vecina');
    await compra({
      idProveedor: prov.id,
      fecha: '2026-08-01',
      precio: 77,
      idTela: tela.id,
      idEmpresa: otraEmpresa.id,
    });

    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'A9-COMPRAS',
        maquilaBase: 0,
        telas: { create: [{ idTela: tela.id, consumoPorPrenda: 1 }] },
      },
    });
    const idProyecto = await proyectoNuevo();
    const desarrollo = await crearDesarrollo(sesion(), idProyecto, { idModelo: modelo.id }, bd());
    const precosto = await generarPrecosto(sesion(), desarrollo.id, bd());
    expect(precosto.lineas.find((l) => l.conceptoCodigo === 'tela')?.precioUnit).toBe(20);
  });
});
