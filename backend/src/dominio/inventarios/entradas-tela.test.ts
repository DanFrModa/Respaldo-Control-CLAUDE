import { describe, expect, it } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import type { ContextoBd } from '../../comun/transaccion.js';
import {
  actualizarEntradaTela,
  confirmarEntradaTela,
  crearEntradaTela,
  exigirRenglonesConOrdenDeCompra,
} from './entradas-tela.js';

/**
 * Unit de la ENTRADA DE TELA — **§Post-F9.159(a): NO SE RECIBE TELA SIN ORDEN DE COMPRA**. Sin
 * Postgres: todo lo que esta prueba ejercita ocurre ANTES de tocar la base (la guarda pura y la
 * validación del contrato), que es justo lo que la hace valiosa — el rechazo llega antes de que
 * exista nada que deshacer.
 *
 * Daniel, textual: *«es imposible. Porque sin OC no podemos recibir tela. ¿De quién recibiríamos
 * sin OC? No puede suceder»*. ⇒ **bloqueo, no aviso.**
 *
 * Lo que NO se puede probar aquí y vive en `entradas-tela.int.test.ts` (lo corre CI): que CONFIRMAR
 * un borrador viejo con renglones sueltos también se rechaza — eso exige leer el documento de la
 * base, así que necesita Postgres.
 */

const sesionMover = () =>
  sesionDePrueba({ permisos: ['inventario-telas.ver', 'inventario-telas.mover'] });

/** Cabecera válida; lo único que cambia entre casos son los renglones. */
const cabecera = {
  tipoDocumento: 'factura' as const,
  numeroDocumento: 'A-1001',
  idProveedor: 7,
  fecha: '2026-08-06',
  idAlmacen: 3,
};

describe('exigirRenglonesConOrdenDeCompra — la guarda del embudo (§Post-F9.159(a))', () => {
  it('deja pasar los renglones que SÍ apuntan a una orden de compra', () => {
    expect(() =>
      exigirRenglonesConOrdenDeCompra([
        { idOrdenCompraLinea: 500 },
        { idOrdenCompraLinea: 501 },
        { idOrdenCompraLinea: 500 }, // el MISMO renglón de OC dos veces sigue siendo válido
      ]),
    ).not.toThrow();
  });

  it('una captura SIN renglones no es asunto suyo (de eso se queja el contrato)', () => {
    expect(() => exigirRenglonesConOrdenDeCompra([])).not.toThrow();
  });

  it('🔴 un renglón con `null` se RECHAZA, y el mensaje nombra LA CAUSA, no el campo', () => {
    let mensaje = '';
    try {
      exigirRenglonesConOrdenDeCompra([{ idOrdenCompraLinea: null }]);
      expect.unreachable('debió rechazar el renglón sin orden de compra');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorValidacion);
      mensaje = (error as Error).message;
    }
    // La causa, con las palabras de Daniel: no se recibe lo que no se compró.
    expect(mensaje).toContain('No se puede recibir tela que no se haya comprado');
    expect(mensaje).toContain('el renglón 1');
    expect(mensaje).toContain('orden de compra');
    // Y NO le echa a quien captura un nombre de columna encima.
    expect(mensaje).not.toContain('idOrdenCompraLinea');
  });

  it('🔴 FALLA CERRADA: el campo AUSENTE se trata igual que el `null`', () => {
    // Un llamador nuevo que arme el renglón sin la propiedad NO se cuela por el hueco de
    // `=== null`: si el valor no es un número, no hay orden de compra que valga.
    expect(() => exigirRenglonesConOrdenDeCompra([{}])).toThrow(ErrorValidacion);
    expect(() => exigirRenglonesConOrdenDeCompra([{ idOrdenCompraLinea: undefined }])).toThrow(
      ErrorValidacion,
    );
  });

  it('señala TODOS los renglones sueltos, no solo el primero', () => {
    try {
      exigirRenglonesConOrdenDeCompra([
        { idOrdenCompraLinea: 500 },
        { idOrdenCompraLinea: null },
        { idOrdenCompraLinea: 501 },
        { idOrdenCompraLinea: null },
      ]);
      expect.unreachable('debió rechazar');
    } catch (error) {
      // Posiciones 1-based, como se ven en la pantalla: el 2 y el 4.
      expect((error as Error).message).toContain('los renglones 2 y 4');
      expect((error as Error).message).toContain('apuntan');
    }
  });

  it('con UN solo suelto conjuga en singular (el mensaje se lee, no se descifra)', () => {
    try {
      exigirRenglonesConOrdenDeCompra([{ idOrdenCompraLinea: 500 }, { idOrdenCompraLinea: null }]);
      expect.unreachable('debió rechazar');
    } catch (error) {
      expect((error as Error).message).toContain('el renglón 2 no apunta');
    }
  });
});

describe('crearEntradaTela / actualizarEntradaTela — el rechazo llega ANTES de la base', () => {
  it('🔴 capturar un renglón sin orden de compra se rechaza (y ni se conecta a Postgres)', async () => {
    await expect(
      crearEntradaTela(sesionMover(), {
        ...cabecera,
        // Así se veía una captura válida hasta §Post-F9.159(a): "tela suelta".
        lineas: [{ idTelaColor: 11, cantidad: 100, precioUnit: 12 }],
      } as unknown as Parameters<typeof crearEntradaTela>[1]),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('🔴 EDITAR un borrador con un renglón sin orden de compra también se rechaza', async () => {
    // La rama gemela: arreglar el alta y dejar abierta la edición es el defecto característico.
    await expect(
      actualizarEntradaTela(sesionMover(), 1, {
        ...cabecera,
        lineas: [{ idTelaColor: 11, cantidad: 100 }],
      } as unknown as Parameters<typeof actualizarEntradaTela>[2]),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('mandar `null` explícito tampoco pasa el contrato', async () => {
    await expect(
      crearEntradaTela(sesionMover(), {
        ...cabecera,
        lineas: [{ idTelaColor: 11, cantidad: 100, idOrdenCompraLinea: null }],
      } as unknown as Parameters<typeof crearEntradaTela>[1]),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('el PERMISO sigue mandando primero (A4): sin `.mover` no se llega ni a la regla', async () => {
    await expect(
      crearEntradaTela(sesionDePrueba({ permisos: ['inventario-telas.ver'] }), {
        ...cabecera,
        lineas: [{ idTelaColor: 11, cantidad: 100 }],
      } as unknown as Parameters<typeof crearEntradaTela>[1]),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

/**
 * ⭐ **CONFIRMAR TAMBIÉN VALIDA — el borrador de ayer no entra por la puerta de atrás.**
 *
 * Es el caso que de verdad importa: los borradores capturados ANTES de §Post-F9.159(a) siguen ahí,
 * con renglones sueltos, y confirmarlos metería al almacén tela que nadie compró. La guarda vive en
 * `validarCabeceraYLineas`, por donde pasa TAMBIÉN el confirmar — y esto lo demuestra sin Postgres,
 * uniéndose a una transacción FALSA (`bd.tx`): el documento se lee del `tx` de mentira y la guarda
 * truena antes de tocar nada más.
 *
 * Si alguien borrara la llamada a la guarda dentro del embudo, ESTA prueba se pone roja (las de
 * arriba no: a ellas las frena el contrato antes de llegar al dominio).
 */
function txConBorrador(idOrdenCompraLinea: number | null): ContextoBd {
  const documento = {
    id: 1,
    folio: 1n,
    fecha: new Date('2026-08-06T00:00:00.000Z'),
    idAlmacen: 3,
    idProveedor: 7,
    numeroDocumento: 'A-1001',
    tipoDocumento: 'factura',
    estatus: 'borrador',
    uuidCfdi: null,
    totalCfdi: null,
    rfcCfdi: null,
    idArchivoCfdi: null,
    proveedor: { nombre: 'Textiles del Norte', rfc: null, factura: null },
    lineas: [
      {
        id: 10,
        idTelaColor: 11,
        cantidad: 100,
        cantidadComplemento: null,
        precioUnit: null,
        precioUnitComplemento: null,
        loteProveedor: null,
        idOrdenCompraLinea,
      },
    ],
  };
  return {
    tx: {
      entradaTela: {
        findFirst: () => Promise.resolve(documento),
        findUniqueOrThrow: () => Promise.resolve(documento),
      },
      // Sólo se llega aquí si la guarda DEJÓ PASAR: el bloqueo de las OCs va justo después.
      ordenCompraLinea: { findMany: () => Promise.resolve([]) },
      // Con el renglón suelto no se llega hasta aquí; con OC sí, y devolver `null` hace que la
      // prueba de control falle por OTRA razón (proveedor inexistente), que es justo lo que se
      // quiere distinguir.
      proveedor: { findUnique: () => Promise.resolve(null) },
    },
  } as unknown as ContextoBd;
}

describe('confirmarEntradaTela — el borrador VIEJO con renglones sueltos tampoco se confirma', () => {
  it('🔴 confirmar un borrador cuyo renglón no tiene OC se rechaza en el embudo', async () => {
    let mensaje = '';
    try {
      await confirmarEntradaTela(sesionMover(), 1, txConBorrador(null));
      expect.unreachable('debió rechazar el borrador con el renglón suelto');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorValidacion);
      mensaje = (error as Error).message;
    }
    expect(mensaje).toContain('No se puede recibir tela que no se haya comprado');
    expect(mensaje).toContain('el renglón 1');
  });

  it('CONTROL: con su renglón de OC, la guarda deja pasar y el rechazo viene de otro lado', async () => {
    // Mismo camino, mismo `tx` falso, único cambio: el renglón SÍ apunta a una OC. Si esta prueba
    // fallara con el mensaje de "sin orden de compra", la de arriba no probaría nada.
    await expect(confirmarEntradaTela(sesionMover(), 1, txConBorrador(500))).rejects.toThrow(
      /Proveedor/,
    );
  });
});
