/**
 * Integración de las CUENTAS / DESTINOS DE PAGO del proveedor (0.112).
 *
 * Lo que estas pruebas sostienen, y por qué cada una existe:
 *  • **Una sola default por proveedor** — incluso si dos personas promueven a la vez. Se prueba por
 *    los dos lados: por el dominio (dos promociones concurrentes) y por LA BASE (un INSERT/UPDATE
 *    directo, sin pasar por el dominio, tiene que rebotar con P2002).
 *  • **Retirar NO borra**: la cuenta sigue ahí, sale en el historial y se puede revivir (D3).
 *  • **Un proveedor sin cuentas funciona** — es el estado de todos los migrados (REGLA 0-B).
 *  • **La marca fiscal se guarda y se lee** (la usará la guarda de "pago con factura → cuenta
 *    fiscal", que construye otra fila).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../datos/index.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import { clientePruebas, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarCuentaPagoProveedor,
  crearCuentaPagoProveedor,
  listarCuentasPagoProveedor,
} from './proveedor-cuentas-pago.js';
import { obtenerProveedor } from './proveedores.js';

let cliente: PrismaClient;

const sesionAdmin = () =>
  sesionDePrueba({ permisos: ['proveedores.ver', 'proveedores.administrar'] });
const sesionSoloVer = () => sesionDePrueba({ permisos: ['proveedores.ver'] });

const bd = () => ({ cliente });

/** CLABEs con dígito de control válido (las tres, distintas entre sí). */
const CLABE_A = '002010077777777771';
const CLABE_B = '012180001234567899';
const CLABE_C = '014180001234567897';
/** Tarjeta de 16 dígitos. */
const TARJETA = '4152313312345678';

beforeAll(() => {
  cliente = clientePruebas();
});

afterAll(async () => {
  await cliente.$disconnect();
});

/** Id del proveedor sembrado en cada prueba. */
let idProveedor: number;
/** Id de un SEGUNDO proveedor, para comprobar que nada se cruza entre fichas. */
let idOtroProveedor: number;

beforeEach(async () => {
  await limpiarBaseDatos(cliente);
  const uno = await cliente.proveedor.create({ data: { nombre: 'Taller Norte' } });
  const dos = await cliente.proveedor.create({ data: { nombre: 'Taller Poniente' } });
  idProveedor = uno.id;
  idOtroProveedor = dos.id;
});

/** Alta rápida de una cuenta con lo mínimo (el beneficiario y su número). */
async function alta(
  beneficiario: string,
  cuenta: string,
  extra: Record<string, unknown> = {},
  proveedor = idProveedor,
) {
  return crearCuentaPagoProveedor(
    sesionAdmin(),
    proveedor,
    { beneficiario, tipoCuenta: 'clabe', cuenta, ...extra },
    bd(),
  );
}

/** Cuántas cuentas de ese proveedor están marcadas como default EN LA BASE. */
async function cuantasDefault(proveedor = idProveedor): Promise<number> {
  return cliente.proveedorCuentaPago.count({
    where: { idProveedor: proveedor, esDefault: true },
  });
}

describe('cuentas de pago del proveedor', () => {
  // ── El proveedor SIN cuentas: el estado normal de todo lo migrado (REGLA 0-B) ──────────────
  describe('un proveedor sin cuentas', () => {
    it('lista vacío sin romperse', async () => {
      await expect(
        listarCuentasPagoProveedor(sesionAdmin(), idProveedor, false, bd()),
      ).resolves.toEqual([]);
    });

    it('su ficha trae `cuentasPago: []` (no null, no falta la llave)', async () => {
      const ficha = await obtenerProveedor(sesionAdmin(), idProveedor, bd());
      expect(ficha.cuentasPago).toEqual([]);
    });

    it('un proveedor que no existe responde 404 al listar sus cuentas', async () => {
      await expect(
        listarCuentasPagoProveedor(sesionAdmin(), 999_999, false, bd()),
      ).rejects.toBeInstanceOf(ErrorNoEncontrado);
    });
  });

  // ── El beneficiario: el hallazgo del Excel ────────────────────────────────────────────────
  it('guarda el BENEFICIARIO, que casi nunca es el nombre del proveedor', async () => {
    const cuenta = await alta('María Fernanda Ruiz', CLABE_A, { alias: '1', banco: 'BBVA' });
    expect(cuenta.beneficiario).toBe('María Fernanda Ruiz');
    expect(cuenta.alias).toBe('1');
    expect(cuenta.banco).toBe('BBVA');
    const proveedor = await cliente.proveedor.findUniqueOrThrow({ where: { id: idProveedor } });
    expect(proveedor.nombre).not.toBe(cuenta.beneficiario);
  });

  it('exige beneficiario y valida el número contra el tipo declarado', async () => {
    await expect(alta('   ', CLABE_A)).rejects.toBeInstanceOf(ErrorValidacion);
    await expect(alta('Quien sea', '002010077777777772')).rejects.toBeInstanceOf(ErrorValidacion);
    // La misma tira de 18 dígitos SÍ vale como tarjeta: son reglas distintas.
    await expect(
      alta('Quien sea', '002010077777777772', { tipoCuenta: 'tarjeta' }),
    ).resolves.toMatchObject({ tipoCuenta: 'tarjeta' });
  });

  it('normaliza el número a puros dígitos (el banco lo entrega con espacios)', async () => {
    const cuenta = await alta('Fulana de Tal', '0020 1007 7777 7777 71');
    expect(cuenta.cuenta).toBe(CLABE_A);
  });

  it('no deja capturar dos veces la misma cuenta en el mismo proveedor…', async () => {
    await alta('Fulana de Tal', CLABE_A);
    await expect(alta('Otro nombre', CLABE_A)).rejects.toBeInstanceOf(ErrorConflicto);
  });

  it('…pero sí la misma cuenta en proveedores distintos (dos talleres, un beneficiario)', async () => {
    await alta('Fulana de Tal', CLABE_A);
    await expect(alta('Fulana de Tal', CLABE_A, {}, idOtroProveedor)).resolves.toMatchObject({
      idProveedor: idOtroProveedor,
    });
  });

  // ── ⭐ UNA SOLA DEFAULT POR PROVEEDOR ──────────────────────────────────────────────────────
  describe('la cuenta por omisión', () => {
    it('la PRIMERA cuenta nace como default; las siguientes no', async () => {
      const primera = await alta('Fulana de Tal', CLABE_A);
      const segunda = await alta('Su esposa', CLABE_B);
      expect(primera.esDefault).toBe(true);
      expect(segunda.esDefault).toBeNull();
      expect(await cuantasDefault()).toBe(1);
    });

    it('promover otra APAGA la anterior (nunca hay dos)', async () => {
      const primera = await alta('Fulana de Tal', CLABE_A);
      const segunda = await alta('Su esposa', CLABE_B);

      const promovida = await actualizarCuentaPagoProveedor(
        sesionAdmin(),
        idProveedor,
        segunda.id,
        { esDefault: true },
        bd(),
      );

      expect(promovida.esDefault).toBe(true);
      expect(await cuantasDefault()).toBe(1);
      const antes = await cliente.proveedorCuentaPago.findUniqueOrThrow({
        where: { id: primera.id },
      });
      expect(antes.esDefault).toBeNull();
    });

    it('⭐ A7: la cuenta DEGRADADA lleva su sello de auditoría y su renglón de bitácora', async () => {
      // La da de alta una persona…
      const primera = await alta('Fulana de Tal', CLABE_A);
      const segunda = await alta('Zutano de Tal', CLABE_B);
      expect(primera.modificadoPorId).toBe('usuario-prueba');

      // …y OTRA promueve la segunda, degradando la primera.
      const otra = sesionDePrueba({
        id: 'otra-persona',
        permisos: ['proveedores.ver', 'proveedores.administrar'],
      });
      await actualizarCuentaPagoProveedor(otra, idProveedor, segunda.id, { esDefault: true }, bd());

      // El sello de la degradada apunta a quien REALMENTE la tocó, no al de la vez anterior.
      const degradada = await cliente.proveedorCuentaPago.findUniqueOrThrow({
        where: { id: primera.id },
      });
      expect(degradada.esDefault).toBeNull();
      expect(degradada.modificadoPorId).toBe('otra-persona');

      // Y la degradación deja su propio renglón de bitácora (no es un efecto invisible).
      const renglones = await cliente.bitacora.findMany({
        where: { entidad: 'ProveedorCuentaPago', idEntidad: String(primera.id) },
        orderBy: { id: 'asc' },
      });
      const quitarDefault = renglones.filter(
        (r) => JSON.stringify(r.datos).includes('quitar-default') && r.idUsuario === 'otra-persona',
      );
      expect(quitarDefault).toHaveLength(1);
    });

    it('quitar la marca deja al proveedor SIN default (no promueve a nadie sola)', async () => {
      const primera = await alta('Fulana de Tal', CLABE_A);
      await alta('Su esposa', CLABE_B);

      await actualizarCuentaPagoProveedor(
        sesionAdmin(),
        idProveedor,
        primera.id,
        { esDefault: false },
        bd(),
      );

      expect(await cuantasDefault()).toBe(0);
    });

    it('⭐ una cuenta NUEVA no se queda la default cuando ya hay otras activas sin marca', async () => {
      const primera = await alta('Fulana de Tal', CLABE_A);
      await alta('Zutano de Tal', CLABE_B);
      // Alguien quita la marca: el proveedor se queda con dos activas y NINGUNA por omisión.
      await actualizarCuentaPagoProveedor(
        sesionAdmin(),
        idProveedor,
        primera.id,
        { esDefault: false },
        bd(),
      );
      expect(await cuantasDefault()).toBe(0);

      // La tercera NO se cuela como default: sería absurdo que la recién capturada le ganara el
      // lugar a dos que llevan meses ahí, y peor que se supiera el día del pago.
      const tercera = await alta('Mengana de Tal', CLABE_C);
      expect(tercera.esDefault).toBeNull();
      expect(await cuantasDefault()).toBe(0);
    });

    it('pero si NO queda ninguna activa, la siguiente sí nace default', async () => {
      const unica = await alta('Fulana de Tal', CLABE_A);
      await actualizarCuentaPagoProveedor(
        sesionAdmin(),
        idProveedor,
        unica.id,
        { activo: false },
        bd(),
      );
      expect(await cuantasDefault()).toBe(0);

      const nueva = await alta('Zutano de Tal', CLABE_B);
      expect(nueva.esDefault).toBe(true);
      expect(await cuantasDefault()).toBe(1);
    });

    it('la default de un proveedor NO estorba a la de otro', async () => {
      await alta('Fulana de Tal', CLABE_A);
      await alta('Zutano de Tal', CLABE_A, {}, idOtroProveedor);
      expect(await cuantasDefault()).toBe(1);
      expect(await cuantasDefault(idOtroProveedor)).toBe(1);
    });

    it('⭐ dos promociones CONCURRENTES no dejan dos defaults', async () => {
      await alta('Fulana de Tal', CLABE_A);
      const segunda = await alta('Su esposa', CLABE_B);
      const tercera = await alta('Su hijo', CLABE_C);

      // Las dos salen a la vez; el advisory lock las serializa y el unique de la base es la red.
      const resultados = await Promise.allSettled([
        actualizarCuentaPagoProveedor(
          sesionAdmin(),
          idProveedor,
          segunda.id,
          { esDefault: true },
          bd(),
        ),
        actualizarCuentaPagoProveedor(
          sesionAdmin(),
          idProveedor,
          tercera.id,
          { esDefault: true },
          bd(),
        ),
      ]);

      // Pase lo que pase con cada intento, la INVARIANTE se sostiene: nunca dos defaults.
      expect(await cuantasDefault()).toBe(1);
      // Y si alguno falló, falló con un error de negocio legible (no con un P2002 crudo).
      for (const r of resultados) {
        if (r.status === 'rejected') {
          expect(r.reason).toBeInstanceOf(ErrorConflicto);
        }
      }
    });

    it('⭐ LA BASE lo impide aunque alguien se salte el dominio (unique parcial vía NULL)', async () => {
      const primera = await alta('Fulana de Tal', CLABE_A);
      const segunda = await alta('Su esposa', CLABE_B);
      expect(primera.esDefault).toBe(true);

      // Escritura DIRECTA con Prisma, sin pasar por el dominio: tiene que rebotar.
      await expect(
        cliente.proveedorCuentaPago.update({
          where: { id: segunda.id },
          data: { esDefault: true },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      expect(await cuantasDefault()).toBe(1);
    });

    it('la ficha del proveedor trae la default PRIMERO', async () => {
      await alta('Fulana de Tal', CLABE_A);
      const segunda = await alta('Su esposa', CLABE_B);
      await actualizarCuentaPagoProveedor(
        sesionAdmin(),
        idProveedor,
        segunda.id,
        { esDefault: true },
        bd(),
      );

      const ficha = await obtenerProveedor(sesionAdmin(), idProveedor, bd());
      expect(ficha.cuentasPago.map((c) => c.id)).toEqual([
        segunda.id,
        ...ficha.cuentasPago.filter((c) => c.id !== segunda.id).map((c) => c.id),
      ]);
      expect(ficha.cuentasPago[0]?.esDefault).toBe(true);
    });
  });

  // ── ⭐ RETIRAR NO BORRA: historial reutilizable (D3) ───────────────────────────────────────
  describe('retirar una cuenta', () => {
    it('la conserva como historial y la saca de la ficha, sin borrarla', async () => {
      const cuenta = await alta('Fulana de Tal', CLABE_A);

      await actualizarCuentaPagoProveedor(
        sesionAdmin(),
        idProveedor,
        cuenta.id,
        { activo: false },
        bd(),
      );

      // Sigue EXISTIENDO en la base.
      const enBd = await cliente.proveedorCuentaPago.findUnique({ where: { id: cuenta.id } });
      expect(enBd).not.toBeNull();
      expect(enBd?.activo).toBe(false);
      expect(enBd?.beneficiario).toBe('Fulana de Tal');
      // No sale por omisión, pero sí en el historial.
      await expect(
        listarCuentasPagoProveedor(sesionAdmin(), idProveedor, false, bd()),
      ).resolves.toEqual([]);
      const historial = await listarCuentasPagoProveedor(sesionAdmin(), idProveedor, true, bd());
      expect(historial.map((c) => c.id)).toEqual([cuenta.id]);
      // Y tampoco viaja en la ficha del proveedor.
      const ficha = await obtenerProveedor(sesionAdmin(), idProveedor, bd());
      expect(ficha.cuentasPago).toEqual([]);
    });

    it('retirar la DEFAULT le quita la marca (una cuenta retirada no es "la de siempre")', async () => {
      const cuenta = await alta('Fulana de Tal', CLABE_A);
      expect(cuenta.esDefault).toBe(true);

      const retirada = await actualizarCuentaPagoProveedor(
        sesionAdmin(),
        idProveedor,
        cuenta.id,
        { activo: false },
        bd(),
      );

      expect(retirada.activo).toBe(false);
      expect(retirada.esDefault).toBeNull();
      expect(await cuantasDefault()).toBe(0);
    });

    it('se puede REVIVIR, y vuelve sin robarle la default a la que manda hoy', async () => {
      const primera = await alta('Fulana de Tal', CLABE_A);
      const segunda = await alta('Su esposa', CLABE_B);
      // Retiro la default y promuevo la otra.
      await actualizarCuentaPagoProveedor(
        sesionAdmin(),
        idProveedor,
        primera.id,
        { activo: false },
        bd(),
      );
      await actualizarCuentaPagoProveedor(
        sesionAdmin(),
        idProveedor,
        segunda.id,
        { esDefault: true },
        bd(),
      );

      const revivida = await actualizarCuentaPagoProveedor(
        sesionAdmin(),
        idProveedor,
        primera.id,
        { activo: true },
        bd(),
      );

      expect(revivida.activo).toBe(true);
      expect(revivida.esDefault).toBeNull();
      expect(await cuantasDefault()).toBe(1);
    });

    it('recapturar una cuenta retirada avisa que se puede REACTIVAR (no la duplica)', async () => {
      const cuenta = await alta('Fulana de Tal', CLABE_A);
      await actualizarCuentaPagoProveedor(
        sesionAdmin(),
        idProveedor,
        cuenta.id,
        { activo: false },
        bd(),
      );

      await expect(alta('Fulana de Tal', CLABE_A)).rejects.toThrow(/retirada|reactivarla/i);
      expect(await cliente.proveedorCuentaPago.count({ where: { idProveedor } })).toBe(1);
    });

    it('no se puede dejar por omisión una cuenta retirada', async () => {
      const cuenta = await alta('Fulana de Tal', CLABE_A);
      await actualizarCuentaPagoProveedor(
        sesionAdmin(),
        idProveedor,
        cuenta.id,
        { activo: false },
        bd(),
      );

      await expect(
        actualizarCuentaPagoProveedor(
          sesionAdmin(),
          idProveedor,
          cuenta.id,
          { esDefault: true },
          bd(),
        ),
      ).rejects.toBeInstanceOf(ErrorValidacion);
    });
  });

  // ── ⭐ LA MARCA FISCAL ────────────────────────────────────────────────────────────────────
  describe('la marca fiscal', () => {
    it('se guarda al capturarla y se lee tal cual', async () => {
      const fiscal = await alta('Taller Norte SA de CV', CLABE_A, { esFiscal: true });
      expect(fiscal.esFiscal).toBe(true);
      const [leida] = await listarCuentasPagoProveedor(sesionAdmin(), idProveedor, false, bd());
      expect(leida?.esFiscal).toBe(true);
      const ficha = await obtenerProveedor(sesionAdmin(), idProveedor, bd());
      expect(ficha.cuentasPago[0]?.esFiscal).toBe(true);
    });

    it('por omisión una cuenta NO es fiscal (lo informal es la regla en esta relación)', async () => {
      const cuenta = await alta('Su esposa', CLABE_B);
      expect(cuenta.esFiscal).toBe(false);
    });

    it('se puede prender y apagar después', async () => {
      const cuenta = await alta('Su esposa', CLABE_B);
      const prendida = await actualizarCuentaPagoProveedor(
        sesionAdmin(),
        idProveedor,
        cuenta.id,
        { esFiscal: true },
        bd(),
      );
      expect(prendida.esFiscal).toBe(true);
      const apagada = await actualizarCuentaPagoProveedor(
        sesionAdmin(),
        idProveedor,
        cuenta.id,
        { esFiscal: false },
        bd(),
      );
      expect(apagada.esFiscal).toBe(false);
    });

    it('un proveedor puede tener UNA fiscal y VARIAS no fiscales a la vez', async () => {
      await alta('Taller Norte SA de CV', CLABE_A, { esFiscal: true });
      await alta('Su esposa', CLABE_B);
      await alta('Su hijo', CLABE_C);
      const cuentas = await listarCuentasPagoProveedor(sesionAdmin(), idProveedor, false, bd());
      expect(cuentas.filter((c) => c.esFiscal)).toHaveLength(1);
      expect(cuentas.filter((c) => !c.esFiscal)).toHaveLength(2);
    });
  });

  // ── Edición del par (tipo, número) ────────────────────────────────────────────────────────
  it('al cambiar SÓLO el tipo revalida contra el número guardado', async () => {
    const cuenta = await alta('Fulana de Tal', TARJETA, { tipoCuenta: 'tarjeta' });
    // 16 dígitos no son una CLABE: cambiar el tipo a solas tiene que rebotar.
    await expect(
      actualizarCuentaPagoProveedor(
        sesionAdmin(),
        idProveedor,
        cuenta.id,
        { tipoCuenta: 'clabe' },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  /**
   * ⭐ EL IDA Y VUELTA DEL PATCH PARCIAL, hasta la COLUMNA.
   *
   * Es el punto donde este patrón falla en silencio: si el dominio tradujera `null` a "no tocar"
   * (o el esquema lo rechazara), el usuario vaciaría el banco en pantalla, vería el toast de
   * guardado y el dato seguiría ahí. Por eso se comprueba contra la BASE, no contra el retorno.
   */
  describe('el PATCH parcial de los opcionales', () => {
    it('`null` VACÍA la columna de verdad (banco, alias y notas)', async () => {
      const cuenta = await alta('Fulana de Tal', CLABE_A, {
        banco: 'BBVA',
        alias: '1',
        notas: 'la de siempre',
      });
      expect(cuenta.banco).toBe('BBVA');

      const actualizada = await actualizarCuentaPagoProveedor(
        sesionAdmin(),
        idProveedor,
        cuenta.id,
        { banco: null, alias: null, notas: null },
        bd(),
      );

      expect(actualizada.banco).toBeNull();
      expect(actualizada.alias).toBeNull();
      expect(actualizada.notas).toBeNull();
      const enBd = await cliente.proveedorCuentaPago.findUniqueOrThrow({
        where: { id: cuenta.id },
      });
      expect(enBd.banco).toBeNull();
      expect(enBd.alias).toBeNull();
      expect(enBd.notas).toBeNull();
    });

    it('la cadena vacía vale lo mismo que `null` (el input manda "" cuando se borra)', async () => {
      const cuenta = await alta('Fulana de Tal', CLABE_A, { banco: 'BBVA' });
      await actualizarCuentaPagoProveedor(
        sesionAdmin(),
        idProveedor,
        cuenta.id,
        { banco: '' },
        bd(),
      );
      const enBd = await cliente.proveedorCuentaPago.findUniqueOrThrow({
        where: { id: cuenta.id },
      });
      expect(enBd.banco).toBeNull();
    });

    it('OMITIR un campo NO lo toca (es la otra mitad de la semántica)', async () => {
      const cuenta = await alta('Fulana de Tal', CLABE_A, {
        banco: 'BBVA',
        alias: '1',
        notas: 'la de siempre',
      });

      // Sólo se edita el beneficiario: lo demás ni se menciona.
      const actualizada = await actualizarCuentaPagoProveedor(
        sesionAdmin(),
        idProveedor,
        cuenta.id,
        { beneficiario: 'Zutano de Tal' },
        bd(),
      );

      expect(actualizada.beneficiario).toBe('Zutano de Tal');
      expect(actualizada.banco).toBe('BBVA');
      expect(actualizada.alias).toBe('1');
      expect(actualizada.notas).toBe('la de siempre');

      // Y la bitácora NO inventa cambios: si dijera que tocó el banco, la auditoría estaría
      // mintiendo aunque la columna siguiera bien (A7). Lo omitido no se toca NI se registra.
      const [renglon] = await cliente.bitacora.findMany({
        where: {
          entidad: 'ProveedorCuentaPago',
          idEntidad: String(cuenta.id),
          accion: 'MODIFICAR',
        },
        orderBy: { id: 'desc' },
        take: 1,
      });
      const detalle = renglon?.datos as Record<string, unknown>;
      expect(detalle).toHaveProperty('beneficiario');
      expect(detalle).not.toHaveProperty('banco');
      expect(detalle).not.toHaveProperty('alias');
      expect(detalle).not.toHaveProperty('notas');
    });
  });

  /**
   * ⭐ LA BITÁCORA NO INVENTA CAMBIOS (A7) — y un PATCH que no cambia nada, no escribe nada.
   *
   * El editor de la pantalla manda SIEMPRE los siete campos al editar (para poder vaciar los
   * opcionales), así que "corregir sólo las notas" llega aquí como un PATCH con beneficiario, banco,
   * tipo y número IGUALES a los guardados. Si el dominio no comparara contra lo que hay en la base,
   * cada edición dejaría un renglón afirmando que se cambió lo que nadie tocó
   * (`beneficiario: { de: X, a: X }`), y un PATCH idéntico dejaría un renglón vacío con el sello de
   * quien no cambió nada. Una auditoría que registra fantasmas no sirve para lo único que existe:
   * saber quién cambió QUÉ. (Un mutante que quitaba la comparación sobrevivía a las demás pruebas de
   * este archivo: éstas dos lo matan.)
   */
  describe('un PATCH sin cambios reales', () => {
    it('mandar los campos IGUALES a los guardados no registra cambios fantasma', async () => {
      const cuenta = await alta('Fulana de Tal', CLABE_A, { banco: 'BBVA', alias: '1' });

      // Como lo manda la pantalla: los siete campos, pero sólo las notas cambian de verdad.
      const actualizada = await actualizarCuentaPagoProveedor(
        sesionAdmin(),
        idProveedor,
        cuenta.id,
        {
          beneficiario: 'Fulana de Tal',
          banco: 'BBVA',
          tipoCuenta: 'clabe',
          cuenta: CLABE_A,
          esFiscal: false,
          alias: '1',
          notas: 'sólo hasta el día 15',
        },
        bd(),
      );
      expect(actualizada.notas).toBe('sólo hasta el día 15');

      const renglones = await cliente.bitacora.findMany({
        where: {
          entidad: 'ProveedorCuentaPago',
          idEntidad: String(cuenta.id),
          accion: 'MODIFICAR',
        },
      });
      expect(renglones).toHaveLength(1);
      // EXACTAMENTE lo que cambió, y nada más: ni beneficiario, ni banco, ni alias, ni tipo, ni
      // número, ni marca fiscal — todos llegaron iguales a lo guardado.
      expect(renglones[0]?.datos).toEqual({
        idProveedor,
        notas: { de: null, a: 'sólo hasta el día 15' },
      });
    });

    it('un PATCH IDÉNTICO no escribe nada: ni renglón de bitácora ni sello de modificación', async () => {
      const cuenta = await alta('Fulana de Tal', CLABE_A, {
        banco: 'BBVA',
        alias: '1',
        notas: 'x',
      });
      const antes = await cliente.proveedorCuentaPago.findUniqueOrThrow({
        where: { id: cuenta.id },
      });

      // Lo manda OTRA persona: si algo se escribiera, el sello la delataría.
      const otra = sesionDePrueba({
        id: 'otra-persona',
        permisos: ['proveedores.ver', 'proveedores.administrar'],
      });
      const resultado = await actualizarCuentaPagoProveedor(
        otra,
        idProveedor,
        cuenta.id,
        {
          beneficiario: 'Fulana de Tal',
          banco: 'BBVA',
          tipoCuenta: 'clabe',
          // Con espacios, como lo pega el banco: normalizado es el MISMO número, no un cambio.
          cuenta: '0020 1007 7777 7777 71',
          esFiscal: false,
          alias: '1',
          notas: 'x',
          // Ya era la default y ya estaba activa: pedirlo otra vez no es un cambio.
          esDefault: true,
          activo: true,
        },
        bd(),
      );

      // La fila está IDÉNTICA (fecha y autor de modificación incluidos) y se devolvió tal cual.
      const despues = await cliente.proveedorCuentaPago.findUniqueOrThrow({
        where: { id: cuenta.id },
      });
      expect(despues).toEqual(antes);
      expect(resultado).toEqual(antes);
      expect(despues.modificadoPorId).toBe('usuario-prueba');

      await expect(
        cliente.bitacora.count({
          where: { entidad: 'ProveedorCuentaPago', idEntidad: String(cuenta.id) },
        }),
      ).resolves.toBe(1); // sólo el CREAR del alta
    });
  });

  it('cambiar el número por uno ya usado en el mismo proveedor rebota', async () => {
    await alta('Fulana de Tal', CLABE_A);
    const otra = await alta('Su esposa', CLABE_B);
    await expect(
      actualizarCuentaPagoProveedor(sesionAdmin(), idProveedor, otra.id, { cuenta: CLABE_A }, bd()),
    ).rejects.toBeInstanceOf(ErrorConflicto);
  });

  // ── Permisos y pertenencia ────────────────────────────────────────────────────────────────
  it('leer exige `proveedores.ver` y escribir exige `proveedores.administrar`', async () => {
    const cuenta = await alta('Fulana de Tal', CLABE_A);
    await expect(
      listarCuentasPagoProveedor(sesionDePrueba(), idProveedor, false, bd()),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(
      crearCuentaPagoProveedor(
        sesionSoloVer(),
        idProveedor,
        { beneficiario: 'X', tipoCuenta: 'clabe', cuenta: CLABE_B },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(
      actualizarCuentaPagoProveedor(
        sesionSoloVer(),
        idProveedor,
        cuenta.id,
        { activo: false },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('una cuenta de OTRO proveedor responde 404 (nunca se opera sobre lo ajeno)', async () => {
    const ajena = await alta('Zutano de Tal', CLABE_A, {}, idOtroProveedor);
    await expect(
      actualizarCuentaPagoProveedor(
        sesionAdmin(),
        idProveedor,
        ajena.id,
        { beneficiario: 'Otro' },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });

  // ── Auditoría (A7) ────────────────────────────────────────────────────────────────────────
  it('deja bitácora del alta y del retiro, sin copiar el número de cuenta', async () => {
    const cuenta = await alta('Fulana de Tal', CLABE_A);
    await actualizarCuentaPagoProveedor(
      sesionAdmin(),
      idProveedor,
      cuenta.id,
      { cuenta: CLABE_B },
      bd(),
    );
    await actualizarCuentaPagoProveedor(
      sesionAdmin(),
      idProveedor,
      cuenta.id,
      { activo: false },
      bd(),
    );

    const renglones = await cliente.bitacora.findMany({
      where: { entidad: 'ProveedorCuentaPago', idEntidad: String(cuenta.id) },
      orderBy: { id: 'asc' },
    });
    expect(renglones.map((r) => r.accion)).toEqual(['CREAR', 'MODIFICAR', 'DESACTIVAR']);
    // El número NO se copia a la bitácora: basta con saber que cambió.
    const datos = JSON.stringify(renglones.map((r) => r.datos));
    expect(datos).not.toContain(CLABE_A);
    expect(datos).not.toContain(CLABE_B);
  });
});
