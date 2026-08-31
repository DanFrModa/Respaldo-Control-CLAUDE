/**
 * Tests UNITARIOS de los impresos de la LISTA DE PRECIOS (F8-E4). Sin BD: se inyecta un `obtenerLista`
 * fake. Cubre que el PDF sale (buffer con firma %PDF) y que el Excel sale y CUADRA (el precio impreso
 * = el APROBADO, verificado al re-leer el libro).
 *
 * ⭐ **V1-E8b (§Post-F9.125(c)):** de una lista con renglones SIN APROBAR no sale papel — ni PDF ni
 * Excel. La lista de ejemplo de esta suite tenía a propósito un renglón sin firmar (`MOD-B`), y con
 * ella los dos impresos salían tan campantes con su `precioCalculado`: eso era precisamente el
 * defecto. Hoy la lista base va COMPLETA y el caso a medio firmar tiene su propia prueba, que exige
 * el rechazo.
 */
import ExcelJS from 'exceljs';
import { afterAll, describe, expect, it } from 'vitest';

import type { ListaPreciosDetalle } from '../../../contrato/esquemas/lista-precios.js';
import { sesionDePrueba } from '../../../pruebas/sesiones.js';
import { ErrorConflicto } from '../../../comun/errores.js';
import { cerrarPoolPdf } from '../../../comun/pdf-worker.js';

import { armarDatosImpresoListaPrecios, impresoListaPrecios } from './impreso-lista-precios.js';
import { excelListaPrecios } from './excel-lista-precios.js';

/** Una lista de ejemplo COMPLETAMENTE aprobada (137 y 155): la única de la que sale papel. */
function listaEjemplo(): ListaPreciosDetalle {
  return {
    id: 1,
    folio: 7,
    idCliente: 1,
    nombreCliente: 'C&A',
    idClienteDepartamento: 1,
    nombreDepartamento: 'NIÑOS',
    fecha: '2026-07-06',
    idEstadoLista: 1,
    codigoEstado: 'abierta',
    nombreEstado: 'Abierta',
    margenPct: 50,
    descuentosPct: 10,
    regaliasPct: 5,
    costoVentasPct: 5,
    notas: 'Temporada otoño',
    lineas: [
      {
        id: 10,
        idDesarrollo: 100,
        idPrecosto: 1000,
        versionPrecosto: 1,
        codigoModelo: 'MOD-A',
        descripcionModelo: 'Jogger',
        numeroCliente: 'CA-001',
        costoUnit: 40,
        precioCalculado: 100,
        precioAprobado: 137,
        // ⭐ V1-E8w: el target del cliente. En este renglón SÍ lo dio (≠ null a propósito) y la
        // prueba «el target NO se cuela en el papel» lo exige: con los dos en null, borrar la
        // columna del impreso o añadirla pasarían igual de desapercibidas.
        precioTarget: 130,
        tieneTarget: true,
        aprobado: true,
        aprobadoPorId: 'u1',
        aprobadoEn: '2026-07-06T00:00:00.000Z',
        avisoCostoViejo: null,
        // ⭐ V1-E8x: los dos renglones de la lista base van VIGENTES (`abierto`). El caso dropeado
        // tiene sus propias pruebas más abajo.
        estado: 'abierto' as const,
        nombreEstado: 'Abierto',
        estadoPorId: null,
        estadoEn: null,
      },
      {
        id: 11,
        idDesarrollo: 101,
        idPrecosto: 1001,
        versionPrecosto: 2,
        codigoModelo: 'MOD-B',
        descripcionModelo: null,
        numeroCliente: null,
        costoUnit: 40,
        precioCalculado: 100,
        precioAprobado: 155,
        precioTarget: null, // el otro renglón NO trae target ("si es que nos lo dio")
        tieneTarget: false,
        aprobado: true,
        aprobadoPorId: 'u1',
        aprobadoEn: '2026-07-06T00:00:00.000Z',
        avisoCostoViejo: null,
        estado: 'abierto' as const,
        nombreEstado: 'Abierto',
        estadoPorId: null,
        estadoEn: null,
      },
    ],
    creadoEn: '2026-07-06T00:00:00.000Z',
    creadoPorId: 'u1',
    modificadoEn: '2026-07-06T00:00:00.000Z',
    modificadoPorId: 'u1',
  };
}

/** La MISMA lista, pero con `MOD-B` todavía sin firmar (el caso que hoy se rechaza). */
function listaAMedioFirmar(): ListaPreciosDetalle {
  const lista = listaEjemplo();
  const segunda = lista.lineas[1]!;
  segunda.precioAprobado = null;
  segunda.aprobado = false;
  segunda.aprobadoPorId = null;
  segunda.aprobadoEn = null;
  return lista;
}

/**
 * ⭐⭐ V1-E8x (§Post-F9.155) — la MISMA lista con `MOD-B` **DROPEADO y SIN FIRMAR**: el caso que
 * antes dejaba a la lista sin PDF, sin Excel y sin cotización PARA SIEMPRE (un dropeado nunca se va
 * a aprobar). Que vaya sin firmar es el punto entero de la prueba.
 */
function listaConDropeado(): ListaPreciosDetalle {
  const lista = listaEjemplo();
  const segunda = lista.lineas[1]!;
  segunda.estado = 'dropeado';
  segunda.nombreEstado = 'Dropeado';
  segunda.estadoPorId = 'u1';
  segunda.estadoEn = '2026-07-07T00:00:00.000Z';
  segunda.precioAprobado = null;
  segunda.aprobado = false;
  segunda.aprobadoPorId = null;
  segunda.aprobadoEn = null;
  return lista;
}

/** La lista con TODOS los renglones dropeados: el caso límite (no queda oferta que mandar). */
function listaTodaDropeada(): ListaPreciosDetalle {
  const lista = listaEjemplo();
  for (const linea of lista.lineas) {
    linea.estado = 'dropeado';
    linea.nombreEstado = 'Dropeado';
  }
  return lista;
}

const sesion = sesionDePrueba({ permisos: ['listas.ver', 'consultas.ver-importes'] });
const fakeObtener = () => Promise.resolve(listaEjemplo());
const fakeObtenerAMedias = () => Promise.resolve(listaAMedioFirmar());
const fakeObtenerConDropeado = () => Promise.resolve(listaConDropeado());
const fakeObtenerTodaDropeada = () => Promise.resolve(listaTodaDropeada());

afterAll(async () => {
  await cerrarPoolPdf();
});

describe('impresoListaPrecios (PDF)', () => {
  it('genera un PDF no vacío con la firma %PDF y el folio en el nombre', async () => {
    const { buffer, folio } = await impresoListaPrecios(sesion, 1, undefined, {
      obtenerLista: fakeObtener,
    });
    expect(folio).toBe(7);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

describe('excelListaPrecios (Excel)', () => {
  it('genera un .xlsx cuyo precio es el APROBADO de cada renglón', async () => {
    const { buffer, folio } = await excelListaPrecios(sesion, 1, undefined, {
      obtenerLista: fakeObtener,
    });
    expect(folio).toBe(7);

    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ArrayBuffer);
    const hoja = libro.worksheets[0]!;
    // Fila 1 = encabezado; fila 2 = MOD-A (aprobado 137); fila 3 = MOD-B (calculado 100).
    expect(hoja.getCell('A2').value).toBe('MOD-A');
    expect(Number(hoja.getCell('D2').value)).toBe(137);
    expect(hoja.getCell('E2').value).toBe('Aprobado');
    expect(hoja.getCell('A3').value).toBe('MOD-B');
    expect(Number(hoja.getCell('D3').value)).toBe(155);
    expect(hoja.getCell('E3').value).toBe('Aprobado');
  });

  /**
   * ⭐ **V1-E8w — EL TARGET DEL CLIENTE NO SALE EN EL PAPEL.** `precioTarget` es un número NUESTRO
   * (lo que el cliente dijo que querría pagar, §Post-F9.150) y el impreso es justo lo que se le
   * manda A ÉL: enseñárselo de vuelta sería regalarle la mano. `MOD-A` lo trae en 130 a propósito,
   * así que si alguien agregara la columna —o el `addRow` lo colara— esto se pone rojo.
   */
  it('⭐ el TARGET del cliente no se cuela: mismas cinco columnas y ni rastro del 130', async () => {
    const { buffer } = await excelListaPrecios(sesion, 1, undefined, {
      obtenerLista: fakeObtener,
    });

    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ArrayBuffer);
    const hoja = libro.worksheets[0]!;
    const valoresDe = (fila: number): unknown[] => (hoja.getRow(fila).values as unknown[]).slice(1);

    // Las columnas son EXACTAMENTE las de siempre (ni una de target).
    expect(valoresDe(1)).toEqual(['Modelo', 'Descripción', 'Nº cliente', 'Precio', 'Estado']);
    expect(hoja.columnCount).toBe(5);
    // Y la fila del renglón CON target trae su precio aprobado (137), no el target (130).
    expect(valoresDe(2)).toEqual(['MOD-A', 'Jogger', 'CA-001', 137, 'Aprobado']);
    expect(valoresDe(2)).not.toContain(130);
  });
});

// ── 🔴 V1-E8b (§Post-F9.125(c)): ni un borrador de una lista sin aprobar ──────────────

describe('🔴 Sin aprobación no sale documento, ni borrador (§Post-F9.125(c))', () => {
  it('el PDF se rechaza NOMBRANDO el modelo que falta', async () => {
    await expect(
      impresoListaPrecios(sesion, 1, undefined, { obtenerLista: fakeObtenerAMedias }),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    let mensaje = '';
    try {
      await impresoListaPrecios(sesion, 1, undefined, { obtenerLista: fakeObtenerAMedias });
    } catch (error) {
      mensaje = error instanceof Error ? error.message : '';
    }
    // El que lo pidió necesita saber CUÁL abrir, no un "falta 1".
    expect(mensaje).toContain('MOD-B');
    expect(mensaje).not.toContain('MOD-A');
    expect(mensaje).toContain('bajar el impreso de la lista');
  });

  it('el Excel se rechaza igual: era la ventana al lado de la puerta cerrada', async () => {
    await expect(
      excelListaPrecios(sesion, 1, undefined, { obtenerLista: fakeObtenerAMedias }),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('una lista VACÍA tampoco produce papel (una hoja en blanco no es una oferta)', async () => {
    const vacia = () => Promise.resolve({ ...listaEjemplo(), lineas: [] });
    await expect(
      excelListaPrecios(sesion, 1, undefined, { obtenerLista: vacia }),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});

// ── ⭐⭐ V1-E8x (§Post-F9.155): EL DROPEADO Y EL PAPEL ────────────────────────────────
//
// Daniel: *«El dropeo se hace hasta la negociación. Hay un envío de cotización previa a la
// negociación. Ahí van todos. Después de la negociación solo hay que mandar los que están vigentes.
// Quitar los dropeados»*. UNA regla cubre los dos momentos: **el papel muestra los NO dropeados**.
//
// Lo que se blinda: (a) un dropeado SIN FIRMAR ya no bloquea el papel —era el defecto que habría
// entregado la versión rota—, (b) tampoco se cuela AL papel, y (c) la lista toda-dropeada da un
// error que se entiende, no una hoja en blanco ni un crash.

describe('⭐⭐ V1-E8x — el papel lleva los renglones NO dropeados (§Post-F9.155)', () => {
  it('🔴 un DROPEADO sin firmar YA NO bloquea el papel (era el defecto que rompía la versión)', async () => {
    const datos = await armarDatosImpresoListaPrecios(sesion, 1, undefined, {
      obtenerLista: fakeObtenerConDropeado,
    });
    // Antes de §Post-F9.155 esto tiraba ErrorConflicto por MOD-B y la lista se quedaba sin PDF
    // para siempre: un dropeado nunca se aprueba.
    expect(datos.renglones.map((r) => r.codigoModelo)).toEqual(['MOD-A']);
  });

  it('🔴 y el dropeado NO SE CUELA al PDF: sale sólo el vigente', async () => {
    const datos = await armarDatosImpresoListaPrecios(sesion, 1, undefined, {
      obtenerLista: fakeObtenerConDropeado,
    });
    expect(datos.renglones).toHaveLength(1);
    expect(datos.renglones.map((r) => r.codigoModelo)).not.toContain('MOD-B');
    // Y el PDF de verdad se genera (el guard ya no lo detiene).
    const { buffer } = await impresoListaPrecios(sesion, 1, undefined, {
      obtenerLista: fakeObtenerConDropeado,
    });
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('🔴 tampoco se cuela al EXCEL: una sola fila de datos, y es MOD-A', async () => {
    const { buffer } = await excelListaPrecios(sesion, 1, undefined, {
      obtenerLista: fakeObtenerConDropeado,
    });
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ArrayBuffer);
    const hoja = libro.worksheets[0]!;
    // Fila 1 = encabezado; de datos, UNA sola: MOD-A. MOD-B se dropeó y no está.
    const modelos: unknown[] = [];
    hoja.eachRow((fila, numero) => {
      if (numero > 1) {
        modelos.push(fila.getCell('A').value);
      }
    });
    expect(modelos).toEqual(['MOD-A']);
    expect(hoja.getCell('A2').value).toBe('MOD-A');
  });

  it('un dropeado que SÍ estaba firmado tampoco sale (no es el precio: es el estado)', async () => {
    const firmadoYDropeado = (): Promise<ListaPreciosDetalle> => {
      const lista = listaEjemplo(); // los dos vienen aprobados
      lista.lineas[1]!.estado = 'dropeado';
      lista.lineas[1]!.nombreEstado = 'Dropeado';
      return Promise.resolve(lista);
    };
    const datos = await armarDatosImpresoListaPrecios(sesion, 1, undefined, {
      obtenerLista: firmadoYDropeado,
    });
    expect(datos.renglones.map((r) => r.codigoModelo)).toEqual(['MOD-A']);
  });

  it('⚠️ CASO LÍMITE — con TODOS dropeados no sale hoja en blanco: se rechaza y se dice cómo salir', async () => {
    await expect(
      impresoListaPrecios(sesion, 1, undefined, { obtenerLista: fakeObtenerTodaDropeada }),
    ).rejects.toBeInstanceOf(ErrorConflicto);

    let mensaje = '';
    try {
      await excelListaPrecios(sesion, 1, undefined, { obtenerLista: fakeObtenerTodaDropeada });
    } catch (error) {
      mensaje = error instanceof Error ? error.message : '';
    }
    expect(mensaje).toMatch(/DROPEADOS/i);
    expect(mensaje).toContain('bajar el Excel de la lista');
    // Y dice el remedio, no sólo el problema (§Post-F9.96).
    expect(mensaje).toMatch(/[Rr]evive al menos uno/);
  });

  it('un renglón NO dropeado sin firmar sigue bloqueando (el candado del dueño no se aflojó)', async () => {
    // MOD-B en `en_negociacion` y sin precio: no es dropeado ⇒ el guard de §Post-F9.125(c) manda.
    const enNegociacionSinFirmar = (): Promise<ListaPreciosDetalle> => {
      const lista = listaAMedioFirmar();
      lista.lineas[1]!.estado = 'en_negociacion';
      lista.lineas[1]!.nombreEstado = 'En negociación';
      return Promise.resolve(lista);
    };
    await expect(
      impresoListaPrecios(sesion, 1, undefined, { obtenerLista: enNegociacionSinFirmar }),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });
});
