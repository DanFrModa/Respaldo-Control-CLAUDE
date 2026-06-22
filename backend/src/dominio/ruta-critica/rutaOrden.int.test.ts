/**
 * Tests de INTEGRACIÓN del motor de la RUTA VIVA por orden (F5-E3). Postgres efímero
 * (testcontainers). Cubre:
 *  • generación desde la plantilla aplicable (por artículo y por familia),
 *  • OMISIÓN de procesos condicionales (`soloSiLlevaAplicacion`) cuando la orden no lleva
 *    aplicación, RECONECTANDO los sucesores a los antecesores TRANSITIVOS reales,
 *  • RESURTIDO (procesos esResurtido → duración 0 auto-completados),
 *  • duración 0 auto-completado (estado completado + fechaReal = inicio),
 *  • RE-GENERACIÓN conservando las fechas reales ya capturadas,
 *  • AJUSTE de la ruta (agregar/quitar/dependencias) SIN tocar la plantilla, con rechazo de ciclos,
 *  • permisos (A4) y bitácora (A7).
 *
 * El motor de jobs (pg-boss) está INACTIVO en estos tests (no se llama `iniciarMotorJobs`): el
 * `encolarJob` post-commit es un NO-OP que devuelve null; el cálculo de fechas es E4.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Prisma, PrismaClient } from '../../datos/index.js';
import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { ajustarRutaOrden, generarRutaOrden, obtenerRutaOrden } from './rutaOrden.js';

let cliente: PrismaClient;
let idEmpresa: number;
let idModelo: number;
let idClienteNegocio: number;
let idColor: number;
let idTallaCH: number;

const sesionProg = () => sesionDePrueba({ permisos: ['rc.programar', 'rc.ruta-ver'] });
const bd = () => ({ cliente });

beforeAll(() => {
  cliente = clientePruebas();
});
afterAll(async () => {
  await cliente.$disconnect();
});

/** Crea un proceso del catálogo con sus banderas y, opcionalmente, un ítem de checklist. */
async function crearProceso(
  codigo: string,
  opciones: Partial<{
    critico: boolean;
    ultimoProceso: boolean;
    esResurtido: boolean;
    condicionAplicabilidad: 'ninguna' | 'soloSiLlevaAplicacion';
    tipoDuracion: 'fija' | 'porCantidad' | 'porTipoTela' | 'porAplicacion';
    checklist: string[];
  }> = {},
): Promise<number> {
  const p = await cliente.procesoDef.create({
    data: {
      codigo,
      nombre: codigo.toUpperCase(),
      critico: opciones.critico ?? false,
      ultimoProceso: opciones.ultimoProceso ?? false,
      esResurtido: opciones.esResurtido ?? false,
      condicionAplicabilidad: opciones.condicionAplicabilidad ?? 'ninguna',
      tipoDuracion: opciones.tipoDuracion ?? 'fija',
      ...(opciones.checklist && opciones.checklist.length > 0
        ? {
            checklist: { create: opciones.checklist.map((d, i) => ({ descripcion: d, orden: i })) },
          }
        : {}),
    },
  });
  return p.id;
}

/**
 * Crea una plantilla con renglones `{ idProcesoDef, tiempoEstandar, antecesores: idProcesoDef[] }`.
 * Crea los renglones, luego las aristas (en términos de renglones).
 */
async function crearPlantilla(
  encabezado: { idArticulo?: number; idFamiliaArticulo?: number },
  renglones: { idProcesoDef: number; tiempoEstandar: number; antecesores?: number[] }[],
): Promise<number> {
  const plantilla = await cliente.plantillaRuta.create({
    data: {
      nombre: `Plantilla ${String(Date.now())}-${String(Math.random())}`,
      ...(encabezado.idArticulo === undefined ? {} : { idArticuloRC: encabezado.idArticulo }),
      ...(encabezado.idFamiliaArticulo === undefined
        ? {}
        : { idFamiliaArticulo: encabezado.idFamiliaArticulo }),
    },
  });
  const idRenglonPorProceso = new Map<number, number>();
  for (const [i, r] of renglones.entries()) {
    const creado = await cliente.plantillaRutaProceso.create({
      data: {
        idPlantillaRuta: plantilla.id,
        idProcesoDef: r.idProcesoDef,
        tiempoEstandar: r.tiempoEstandar,
        orden: i,
      },
    });
    idRenglonPorProceso.set(r.idProcesoDef, creado.id);
  }
  const aristas: Prisma.PlantillaRutaDepCreateManyInput[] = [];
  for (const r of renglones) {
    const idRenglon = idRenglonPorProceso.get(r.idProcesoDef);
    if (idRenglon === undefined) continue;
    for (const ant of r.antecesores ?? []) {
      const idAnt = idRenglonPorProceso.get(ant);
      if (idAnt !== undefined) {
        aristas.push({ idPlantillaRutaProceso: idRenglon, idAntecesor: idAnt });
      }
    }
  }
  if (aristas.length > 0) {
    await cliente.plantillaRutaDep.createMany({ data: aristas });
  }
  return plantilla.id;
}

/** Crea una familia + artículo RC y devuelve ambos ids. */
async function crearArticulo(): Promise<{ idFamilia: number; idArticulo: number }> {
  const familia = await cliente.familiaArticulo.create({
    data: { nombre: `Fam ${String(Date.now())}` },
  });
  const articulo = await cliente.articuloRC.create({
    data: { nombre: 'SENCILLO 1/6', idFamiliaArticulo: familia.id },
  });
  return { idFamilia: familia.id, idArticulo: articulo.id };
}

/** Crea factores por cantidad (los relevantes). */
async function crearFactores(): Promise<void> {
  await cliente.factorCantidad.createMany({
    data: [
      { deCant: 1, aCant: 500, factor: 0.6 },
      { deCant: 501, aCant: 999, factor: 0.8 },
      { deCant: 1000, aCant: 1500, factor: 1.0 },
      { deCant: 4001, aCant: 5000, factor: 2.0 },
    ],
  });
}

/** Crea tela ("Importación Oriente", 40 días) + aplicaciones (Sin Aplicación 0; 2 Bordados 6). */
async function crearReglas(): Promise<{ idTela: number; idSinAplic: number; idConAplic: number }> {
  const tela = await cliente.duracionPorTipoTela.create({
    data: { nombre: 'Importacion Oriente', dias: 40, factorTela: 2.3 },
  });
  const sin = await cliente.duracionPorAplicacion.create({
    data: { nombre: 'Sin Aplicacion', clave: 'A0', dias: 0 },
  });
  const con = await cliente.duracionPorAplicacion.create({
    data: { nombre: '2 Bordados', clave: 'A5', dias: 6 },
  });
  return { idTela: tela.id, idSinAplic: sin.id, idConAplic: con.id };
}

/** Crea una orden con matriz de `cantidad` piezas (Rojo/CH). Devuelve su id. */
async function crearOrden(cantidad: number): Promise<number> {
  const orden = await cliente.orden.create({
    data: {
      folio: BigInt(Math.floor(Math.random() * 1_000_000)),
      idEmpresa,
      idModelo,
      idCliente: idClienteNegocio,
      estado: 'completa',
      lineas: {
        create: [{ idColor: idColor, tallas: { create: [{ idTalla: idTallaCH, cantidad }] } }],
      },
    },
  });
  return orden.id;
}

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  const empresa = await crearEmpresaPrueba(cliente);
  idEmpresa = empresa.id;
  // Colchón de costura 2 días para la empresa.
  await cliente.configuracionEmpresa.create({ data: { idEmpresa, colchonCostura: 2 } });
  const clienteNegocio = await cliente.cliente.create({ data: { nombre: 'Liverpool' } });
  idClienteNegocio = clienteNegocio.id;
  const modelo = await cliente.modelo.create({ data: { codigo: 'A-100', descripcion: 'Playera' } });
  idModelo = modelo.id;
  const color = await cliente.color.create({ data: { nombre: 'Rojo' } });
  idColor = color.id;
  const ch = await cliente.talla.create({ data: { etiqueta: 'CH', orden: 1 } });
  idTallaCH = ch.id;
  await crearFactores();
});

describe('generarRutaOrden (F5-E3)', () => {
  it('sin permiso no programa ni consulta', async () => {
    const sin = sesionDePrueba();
    const { idArticulo } = await crearArticulo();
    const { idTela, idConAplic } = await crearReglas();
    const idOrden = await crearOrden(1200);
    await expect(
      generarRutaOrden(
        sin,
        {
          idOrden,
          idArticuloRC: idArticulo,
          fechaEntregaRC: new Date('2026-07-01T00:00:00Z'),
          idTipoTela: idTela,
          idAplicacion: idConAplic,
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(obtenerRutaOrden(sin, idOrden, bd())).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('genera la ruta desde la plantilla por artículo, calcula duraciones y escribe bitácora', async () => {
    const { idArticulo } = await crearArticulo();
    const { idTela, idConAplic } = await crearReglas();
    // a (fija 3), b (porCantidad 5), c (porTipoTela 5), d (porAplicacion -)
    const a = await crearProceso('a', { tipoDuracion: 'fija', checklist: ['Revisar molde'] });
    const b = await crearProceso('b', { tipoDuracion: 'porCantidad' });
    const c = await crearProceso('c', { tipoDuracion: 'porTipoTela' });
    const d = await crearProceso('d', { tipoDuracion: 'porAplicacion', ultimoProceso: true });
    await crearPlantilla({ idArticulo }, [
      { idProcesoDef: a, tiempoEstandar: 3 },
      { idProcesoDef: b, tiempoEstandar: 5, antecesores: [a] },
      { idProcesoDef: c, tiempoEstandar: 5, antecesores: [b] },
      { idProcesoDef: d, tiempoEstandar: 0, antecesores: [c] },
    ]);
    const idOrden = await crearOrden(1200); // factor 1.00, colchón 2

    const ruta = await generarRutaOrden(
      sesionProg(),
      {
        idOrden,
        idArticuloRC: idArticulo,
        fechaEntregaRC: new Date('2026-07-01T00:00:00Z'),
        idTipoTela: idTela,
        idAplicacion: idConAplic, // 2 Bordados, 6 días
        fechaInicioRC: new Date('2026-06-22T00:00:00Z'),
      },
      bd(),
    );

    expect(ruta.rcActiva).toBe(true);
    // Tras programar, el CPM aún no ha fechado (job encolado; en tests el motor está inactivo): los
    // procesos no tienen fechaPlaneadaVigente todavía → estado 'recalculando' (lo que E5 muestra como
    // "recalculando…"). El tri-estado de E4 reemplazó el 'pendiente-de-calculo' de E3.
    expect(ruta.estadoRecalculo).toBe('recalculando');
    const porCodigo = new Map(ruta.procesos.map((p) => [p.codigoProceso, p]));
    expect(porCodigo.get('a')!.duracionDias).toBe(3); // fija
    expect(porCodigo.get('b')!.duracionDias).toBe(7); // round(5×1.0 + 2)
    expect(porCodigo.get('c')!.duracionDias).toBe(40); // días de tela directos
    expect(porCodigo.get('d')!.duracionDias).toBe(6); // 6 × factor 1.0
    // Snapshot del checklist del proceso a.
    expect(porCodigo.get('a')!.checklist.map((i) => i.descripcion)).toEqual(['Revisar molde']);
    // Dependencias snapshot.
    expect(porCodigo.get('b')!.idsAntecesores).toEqual([a]);
    expect(porCodigo.get('c')!.idsAntecesores).toEqual([b]);

    const bit = await cliente.bitacora.findFirst({
      where: { entidad: 'Orden', idEntidad: String(idOrden) },
    });
    expect(bit).not.toBeNull();
  });

  it('resuelve la plantilla por FAMILIA cuando no hay una por artículo', async () => {
    const { idFamilia, idArticulo } = await crearArticulo();
    const { idTela, idConAplic } = await crearReglas();
    const a = await crearProceso('a');
    await crearPlantilla({ idFamiliaArticulo: idFamilia }, [
      { idProcesoDef: a, tiempoEstandar: 2 },
    ]);
    const idOrden = await crearOrden(1200);
    const ruta = await generarRutaOrden(
      sesionProg(),
      {
        idOrden,
        idArticuloRC: idArticulo,
        fechaEntregaRC: new Date('2026-07-01T00:00:00Z'),
        idTipoTela: idTela,
        idAplicacion: idConAplic,
      },
      bd(),
    );
    expect(ruta.procesos).toHaveLength(1);
    expect(ruta.procesos[0]!.codigoProceso).toBe('a');
  });

  it('OMITE los condicionales sin aplicación y RECONECTA transitivamente (a→[B]→c ⇒ a→c)', async () => {
    const { idArticulo } = await crearArticulo();
    const { idTela, idSinAplic } = await crearReglas();
    const a = await crearProceso('a');
    const bCond = await crearProceso('b', { condicionAplicabilidad: 'soloSiLlevaAplicacion' });
    const c = await crearProceso('c');
    // a → b → c (cadena). b es condicional.
    await crearPlantilla({ idArticulo }, [
      { idProcesoDef: a, tiempoEstandar: 1 },
      { idProcesoDef: bCond, tiempoEstandar: 1, antecesores: [a] },
      { idProcesoDef: c, tiempoEstandar: 1, antecesores: [bCond] },
    ]);
    const idOrden = await crearOrden(1200);
    const ruta = await generarRutaOrden(
      sesionProg(),
      {
        idOrden,
        idArticuloRC: idArticulo,
        fechaEntregaRC: new Date('2026-07-01T00:00:00Z'),
        idTipoTela: idTela,
        idAplicacion: idSinAplic, // Sin Aplicación → b se omite
      },
      bd(),
    );
    const codigos = ruta.procesos.map((p) => p.codigoProceso);
    expect(codigos).toEqual(['a', 'c']); // b omitido
    const c2 = ruta.procesos.find((p) => p.codigoProceso === 'c')!;
    // c ahora depende de a (antecesor transitivo real), no de b (omitido).
    expect(c2.idsAntecesores).toEqual([a]);
  });

  it('RESURTIDO: los procesos esResurtido quedan en duración 0 y auto-completados', async () => {
    const { idArticulo } = await crearArticulo();
    const { idTela, idConAplic } = await crearReglas();
    const ficha = await crearProceso('ficha', { esResurtido: true, tipoDuracion: 'fija' });
    const corte = await crearProceso('corte', { tipoDuracion: 'fija' });
    await crearPlantilla({ idArticulo }, [
      { idProcesoDef: ficha, tiempoEstandar: 4 },
      { idProcesoDef: corte, tiempoEstandar: 3, antecesores: [ficha] },
    ]);
    const idOrden = await crearOrden(1200);
    const ruta = await generarRutaOrden(
      sesionProg(),
      {
        idOrden,
        idArticuloRC: idArticulo,
        fechaEntregaRC: new Date('2026-07-01T00:00:00Z'),
        idTipoTela: idTela,
        idAplicacion: idConAplic,
        esResurtido: true,
        fechaInicioRC: new Date('2026-06-22T00:00:00Z'),
      },
      bd(),
    );
    const fichaR = ruta.procesos.find((p) => p.codigoProceso === 'ficha')!;
    expect(fichaR.duracionDias).toBe(0);
    expect(fichaR.estado).toBe('completado');
    expect(fichaR.origenCaptura).toBe('evento');
    expect(fichaR.fechaReal).not.toBeNull();
    // El que NO es de resurtido conserva su duración y queda pendiente.
    const corteR = ruta.procesos.find((p) => p.codigoProceso === 'corte')!;
    expect(corteR.duracionDias).toBe(3);
    expect(corteR.estado).toBe('pendiente');
  });

  it('duración 0 (Sin Aplicación) auto-completa el proceso porAplicacion', async () => {
    const { idArticulo } = await crearArticulo();
    const { idTela, idSinAplic } = await crearReglas();
    const estampado = await crearProceso('estampado', { tipoDuracion: 'porAplicacion' });
    await crearPlantilla({ idArticulo }, [{ idProcesoDef: estampado, tiempoEstandar: 0 }]);
    const idOrden = await crearOrden(1200);
    const ruta = await generarRutaOrden(
      sesionProg(),
      {
        idOrden,
        idArticuloRC: idArticulo,
        fechaEntregaRC: new Date('2026-07-01T00:00:00Z'),
        idTipoTela: idTela,
        idAplicacion: idSinAplic, // 0 días
        fechaInicioRC: new Date('2026-06-22T00:00:00Z'),
      },
      bd(),
    );
    const e = ruta.procesos.find((p) => p.codigoProceso === 'estampado')!;
    expect(e.duracionDias).toBe(0);
    expect(e.estado).toBe('completado');
  });

  it('RE-GENERAR conserva las fechas reales ya capturadas', async () => {
    const { idArticulo } = await crearArticulo();
    const { idTela, idConAplic } = await crearReglas();
    const a = await crearProceso('a', { tipoDuracion: 'fija' });
    const b = await crearProceso('b', { tipoDuracion: 'fija' });
    await crearPlantilla({ idArticulo }, [
      { idProcesoDef: a, tiempoEstandar: 2 },
      { idProcesoDef: b, tiempoEstandar: 3, antecesores: [a] },
    ]);
    const idOrden = await crearOrden(1200);
    const datos = {
      idOrden,
      idArticuloRC: idArticulo,
      fechaEntregaRC: new Date('2026-07-01T00:00:00Z'),
      idTipoTela: idTela,
      idAplicacion: idConAplic,
    };
    await generarRutaOrden(sesionProg(), datos, bd());
    // Captura la fecha real del proceso a (simula cumplimiento manual).
    const filaA = await cliente.rutaOrden.findFirst({
      where: { idOrden, procesoDef: { codigo: 'a' } },
    });
    await cliente.rutaOrden.update({
      where: { id: filaA!.id },
      data: {
        fechaReal: new Date('2026-06-25T00:00:00Z'),
        estado: 'completado',
        origenCaptura: 'manual',
        capturadoPorId: 'usuario-prueba',
      },
    });
    // Re-genera: la fecha real de 'a' debe conservarse.
    const ruta2 = await generarRutaOrden(sesionProg(), datos, bd());
    const a2 = ruta2.procesos.find((p) => p.codigoProceso === 'a')!;
    expect(a2.fechaReal).not.toBeNull();
    expect(a2.estado).toBe('completado');
    expect(a2.origenCaptura).toBe('manual');
  });

  it('exige artículo + tela + aplicación válidos (error claro si no existen)', async () => {
    const { idArticulo } = await crearArticulo();
    const { idTela } = await crearReglas();
    const a = await crearProceso('a');
    await crearPlantilla({ idArticulo }, [{ idProcesoDef: a, tiempoEstandar: 1 }]);
    const idOrden = await crearOrden(1200);
    await expect(
      generarRutaOrden(
        sesionProg(),
        {
          idOrden,
          idArticuloRC: idArticulo,
          fechaEntregaRC: new Date('2026-07-01T00:00:00Z'),
          idTipoTela: idTela,
          idAplicacion: 999999, // no existe
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('error claro si no hay plantilla aplicable', async () => {
    const { idArticulo } = await crearArticulo();
    const { idTela, idConAplic } = await crearReglas();
    const idOrden = await crearOrden(1200);
    await expect(
      generarRutaOrden(
        sesionProg(),
        {
          idOrden,
          idArticuloRC: idArticulo,
          fechaEntregaRC: new Date('2026-07-01T00:00:00Z'),
          idTipoTela: idTela,
          idAplicacion: idConAplic,
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

describe('ajustarRutaOrden (F5-E3, sin tocar la plantilla)', () => {
  async function programarBasica(): Promise<{ idOrden: number; a: number; b: number }> {
    const { idArticulo } = await crearArticulo();
    const { idTela, idConAplic } = await crearReglas();
    const a = await crearProceso('a', { tipoDuracion: 'fija' });
    const b = await crearProceso('b', { tipoDuracion: 'fija' });
    await crearPlantilla({ idArticulo }, [
      { idProcesoDef: a, tiempoEstandar: 2 },
      { idProcesoDef: b, tiempoEstandar: 3, antecesores: [a] },
    ]);
    const idOrden = await crearOrden(1200);
    await generarRutaOrden(
      sesionProg(),
      {
        idOrden,
        idArticuloRC: idArticulo,
        fechaEntregaRC: new Date('2026-07-01T00:00:00Z'),
        idTipoTela: idTela,
        idAplicacion: idConAplic,
      },
      bd(),
    );
    return { idOrden, a, b };
  }

  it('agrega un proceso a la ruta SIN tocar la plantilla', async () => {
    const { idOrden, b } = await programarBasica();
    const c = await crearProceso('c');
    const ruta = await ajustarRutaOrden(
      sesionProg(),
      { idOrden, agregar: [{ idProcesoDef: c, duracionDias: 4, idsAntecesores: [b] }] },
      bd(),
    );
    expect(ruta.procesos.map((p) => p.codigoProceso).sort()).toEqual(['a', 'b', 'c']);
    const c2 = ruta.procesos.find((p) => p.codigoProceso === 'c')!;
    expect(c2.duracionDias).toBe(4);
    expect(c2.idsAntecesores).toEqual([b]);
    // La PLANTILLA sigue con 2 renglones (no se tocó).
    const renglonesPlantilla = await cliente.plantillaRutaProceso.count();
    expect(renglonesPlantilla).toBe(2);
  });

  it('quita un proceso de la ruta', async () => {
    const { idOrden, b } = await programarBasica();
    const ruta = await ajustarRutaOrden(sesionProg(), { idOrden, quitar: [b] }, bd());
    expect(ruta.procesos.map((p) => p.codigoProceso)).toEqual(['a']);
  });

  it('rechaza un ajuste que formaría un ciclo', async () => {
    const { idOrden, a, b } = await programarBasica();
    // b ya depende de a; pedir que a dependa de b cierra un ciclo.
    await expect(
      ajustarRutaOrden(
        sesionProg(),
        { idOrden, dependencias: [{ idProcesoDef: a, idsAntecesores: [b] }] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('rechaza un CICLO CRUZADO formado entre dos redefiniciones del MISMO PATCH (a→[b] y b→[a])', async () => {
    // Ruta con dos procesos INDEPENDIENTES (sin arista entre ellos): cada redefinición por separado
    // es válida, pero JUNTAS cierran a↔b. Un único PATCH no debe colar el ciclo (validación acumulativa).
    const { idArticulo } = await crearArticulo();
    const { idTela, idConAplic } = await crearReglas();
    const a = await crearProceso('a', { tipoDuracion: 'fija' });
    const b = await crearProceso('b', { tipoDuracion: 'fija' });
    // Sin antecesores en la plantilla → a y b quedan sueltos en la ruta.
    await crearPlantilla({ idArticulo }, [
      { idProcesoDef: a, tiempoEstandar: 2 },
      { idProcesoDef: b, tiempoEstandar: 3 },
    ]);
    const idOrden = await crearOrden(1200);
    await generarRutaOrden(
      sesionProg(),
      {
        idOrden,
        idArticuloRC: idArticulo,
        fechaEntregaRC: new Date('2026-07-01T00:00:00Z'),
        idTipoTela: idTela,
        idAplicacion: idConAplic,
      },
      bd(),
    );

    await expect(
      ajustarRutaOrden(
        sesionProg(),
        {
          idOrden,
          dependencias: [
            { idProcesoDef: a, idsAntecesores: [b] },
            { idProcesoDef: b, idsAntecesores: [a] },
          ],
        },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);

    // Y NINGUNA de las dos aristas debe haber quedado persistida (la tx hizo rollback).
    const deps = await cliente.rutaOrdenDep.count({ where: { rutaOrden: { idOrden } } });
    expect(deps).toBe(0);
  });

  it('rechaza ajustar una orden sin ruta generada', async () => {
    const idOrden = await crearOrden(1200);
    const c = await crearProceso('c');
    await expect(
      ajustarRutaOrden(
        sesionProg(),
        { idOrden, agregar: [{ idProcesoDef: c, duracionDias: 1 }] },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
