import { describe, expect, it } from 'vitest';

import { esquemaAlmacenCrear, esquemaAlmacenEditar } from './almacen.js';
import { esquemaEmpresaCrear, esquemaEmpresaEditar } from './empresa.js';
import { esquemaEtiquetaMarcaCrear, esquemaEtiquetaMarcaEditar } from './etiqueta-marca.js';
import { esquemaLogin } from './login.js';
import {
  esquemaProveedorCrear,
  esquemaProveedorEditar,
  esquemaProveedorPatchCuerpo,
} from './proveedor.js';
import { esquemaMovimientoTerceroCrear } from './terceros.js';
import { esquemaUsuarioCrear, esquemaUsuarioEditar } from './usuario.js';

describe('esquemaLogin', () => {
  it('acepta usuario y contraseña, recortando espacios del usuario', () => {
    const datos = esquemaLogin.parse({ username: '  admin  ', password: 'Control.2026!' });
    expect(datos.username).toBe('admin');
  });

  it('rechaza campos vacíos con mensajes en español', () => {
    const resultado = esquemaLogin.safeParse({ username: '', password: '' });
    expect(resultado.success).toBe(false);
    const mensajes = resultado.error?.issues.map((i) => i.message);
    expect(mensajes).toContain('El usuario es obligatorio');
    expect(mensajes).toContain('La contraseña es obligatoria');
  });
});

describe('esquemaAlmacen', () => {
  it('acepta un alta válida con tipo del kardex (PT|TELA|AVIO)', () => {
    const datos = esquemaAlmacenCrear.parse({ nombre: 'Almacén Naucalpan', tipo: 'TELA' });
    expect(datos).toEqual({ nombre: 'Almacén Naucalpan', tipo: 'TELA' });
  });

  it('rechaza tipo fuera del enum y nombre de más de 100 caracteres', () => {
    expect(esquemaAlmacenCrear.safeParse({ nombre: 'X', tipo: 'BODEGA' }).success).toBe(false);
    expect(esquemaAlmacenCrear.safeParse({ nombre: 'a'.repeat(101), tipo: 'PT' }).success).toBe(
      false,
    );
  });

  it('en edición exige id y permite cambios parciales (incluido borrado suave)', () => {
    expect(esquemaAlmacenEditar.safeParse({ activo: false }).success).toBe(false);
    expect(esquemaAlmacenEditar.parse({ id: 3, activo: false })).toEqual({
      id: 3,
      activo: false,
    });
  });
});

describe('esquemaUsuario', () => {
  it('normaliza el username a minúsculas y aplica defaults', () => {
    const datos = esquemaUsuarioCrear.parse({
      username: '  Daniel.Masri ',
      nombre: 'Daniel Masri',
      password: 'Control.2026!',
    });
    expect(datos.username).toBe('daniel.masri');
    expect(datos.esAuditor).toBe(false);
    expect(datos.idsRoles).toEqual([]);
  });

  it('rechaza username con caracteres inválidos y contraseña corta', () => {
    expect(
      esquemaUsuarioCrear.safeParse({
        username: 'daniel masri',
        nombre: 'Daniel',
        password: 'Control.2026!',
      }).success,
    ).toBe(false);
    expect(
      esquemaUsuarioCrear.safeParse({
        username: 'daniel',
        nombre: 'Daniel',
        password: 'corta',
      }).success,
    ).toBe(false);
  });

  it('en edición exige id y descarta campos no editables (username/password)', () => {
    expect(esquemaUsuarioEditar.safeParse({ nombre: 'Otro' }).success).toBe(false);
    const datos = esquemaUsuarioEditar.parse({
      id: 'abc',
      bloqueado: false,
      idsRoles: [1, 2],
      username: 'intruso',
      password: 'NuevaClave123',
    });
    expect(datos).toEqual({ id: 'abc', bloqueado: false, idsRoles: [1, 2] });
  });
});

// REGRESIÓN (bug que cazó el CI): en Zod, `.partial()` NO elimina los `.default()`.
// Un esquema de EDICIÓN parcial debe sobrescribir como `.optional()` los campos que
// tienen `.default()` en el alta; si no, al omitir el campo en una edición, el parse lo
// rellena con su default y PISA el valor real en la BD. Estos tests garantizan que el campo
// omitido quede `undefined` (no presente) en la salida del parse. (El caso original era el
// `tipo` del proveedor, retirado en V1-E3f pieza B; la trampa sigue viva en otros esquemas.)
describe('esquemas de edición: omitir un campo con default NO lo rellena (Zod .partial())', () => {
  it('el alta SÍ aplica el default (control: comprueba que el default existe)', () => {
    expect(esquemaEtiquetaMarcaCrear.parse({ nombre: 'X' }).regalias).toBe(0);
    const empresa = esquemaEmpresaCrear.parse({ nombre: 'X' });
    expect(empresa.favorita).toBe(false);
    expect(empresa.paraIpt).toBe(false);
    expect(empresa.paraEdr).toBe(false);
  });

  it('esquemaProveedorEditar: una edición parcial no inventa campos que no se mandaron', () => {
    const datos = esquemaProveedorEditar.parse({ id: 1, activo: false });
    expect(datos).toEqual({ id: 1, activo: false });
  });

  it('esquemaEtiquetaMarcaEditar: omitir `regalias` lo deja undefined (no rellena 0)', () => {
    const datos = esquemaEtiquetaMarcaEditar.parse({ id: 1, activo: false });
    expect('regalias' in datos).toBe(false);
    expect(datos.regalias).toBeUndefined();
    expect(datos).toEqual({ id: 1, activo: false });
    // si se manda, sigue acotado a 0–100
    expect(esquemaEtiquetaMarcaEditar.parse({ id: 1, regalias: 15 }).regalias).toBe(15);
    expect(esquemaEtiquetaMarcaEditar.safeParse({ id: 1, regalias: 150 }).success).toBe(false);
  });

  it('esquemaEmpresaEditar: omitir las banderas las deja undefined (no rellena false)', () => {
    const datos = esquemaEmpresaEditar.parse({ identificador: 'FRM-01' });
    expect('favorita' in datos).toBe(false);
    expect('paraIpt' in datos).toBe(false);
    expect('paraEdr' in datos).toBe(false);
    expect(datos.favorita).toBeUndefined();
    expect(datos.paraIpt).toBeUndefined();
    expect(datos.paraEdr).toBeUndefined();
    expect(datos).toEqual({ identificador: 'FRM-01' });
    // si se mandan, se respetan
    expect(esquemaEmpresaEditar.parse({ favorita: true }).favorita).toBe(true);
  });

  /**
   * ⭐ EL DEFAULT-TRAP MÁS CARO DEL SISTEMA (fila 0.110, §Post-F9.186(a)).
   *
   * `esquemaMovimientoTerceroCrear.esFiscal` traía `.default(false)`. En un movimiento de PROVEEDOR
   * eso no es una marca cosmética: decide **de dónde sale su pago** —CON factura, del estado de
   * cuenta del banco; SIN factura, de la relación que Daniel define (§Post-F9.184(f))—. Con el
   * default, un alta que no dijera nada nacía en el segundo camino **en silencio**, sin que nadie lo
   * hubiera decidido: exactamente la misma puerta trasera que el `default` de `resolverConFactura`,
   * sólo que en otra pared. (El esquema de CxP ya lo había dejado `.optional()` por este motivo.)
   *
   * Esta prueba defiende el `.optional()`: si alguien le devuelve el `.default(false)`, el `undefined`
   * —la señal de "no lo dije"— deja de existir antes de llegar al dominio, `resolverEsFiscalMotor` no
   * tiene nada que derivar, y la ruta vuelve a parir movimientos sin clasificar.
   */
  it('⭐ esquemaMovimientoTerceroCrear: omitir `esFiscal` lo deja UNDEFINED (no rellena false)', () => {
    const datos = esquemaMovimientoTerceroCrear.parse({
      tipoTercero: 'proveedor',
      idTercero: 1,
      fecha: '2026-09-03',
      origen: 'factura_proveedor',
      importe: 100,
    });
    // Si esto fuera `false`, el "no lo dije" sería indistinguible del "dije que sin factura".
    expect(datos.esFiscal).toBeUndefined();
    expect('esFiscal' in datos).toBe(false);
  });

  it('…y si SÍ se manda, se conserva tal cual (los dos valores)', () => {
    const base = {
      tipoTercero: 'proveedor',
      idTercero: 1,
      fecha: '2026-09-03',
      origen: 'factura_proveedor',
      importe: 100,
    } as const;
    expect(esquemaMovimientoTerceroCrear.parse({ ...base, esFiscal: true }).esFiscal).toBe(true);
    expect(esquemaMovimientoTerceroCrear.parse({ ...base, esFiscal: false }).esFiscal).toBe(false);
  });
});

// ── Proveedor enriquecido (F1-E1B, R15): campos fiscales/pago + roles + regla ──
describe('esquemaProveedor enriquecido (F1-E1B, R15)', () => {
  it('acepta un alta con roles + campos fiscales/comerciales válidos', () => {
    const datos = esquemaProveedorCrear.parse({
      modalidadFacturacion: 'solo_con',
      nombre: 'Maquilas del Norte',
      tipo: 'SERVICIOS',
      roles: [1, 2],
      factura: true,
      rfc: 'abc010101ab1', // se normaliza a mayúsculas
      regimenFiscalSat: '601',
      diasCredito: 30,
      moneda: 'MXN',
      metodoPago: 'PPD',
      clabe: '002010077777777771',
      leadTimeDias: 15,
    });
    expect(datos.rfc).toBe('ABC010101AB1');
    expect(datos.roles).toEqual([1, 2]);
    expect(datos.moneda).toBe('MXN');
  });

  it('regla factura ⇒ exige RFC + régimen (alta)', () => {
    expect(
      esquemaProveedorCrear.safeParse({
        modalidadFacturacion: 'solo_con',
        nombre: 'X',
        factura: true,
      }).success,
    ).toBe(false);
    expect(
      esquemaProveedorCrear.safeParse({
        modalidadFacturacion: 'solo_con',
        nombre: 'X',
        factura: true,
        rfc: 'ABC010101AB1',
      }).success,
    ).toBe(false); // falta régimen
    expect(
      esquemaProveedorCrear.safeParse({
        modalidadFacturacion: 'solo_con',
        nombre: 'X',
        factura: true,
        rfc: 'ABC010101AB1',
        regimenFiscalSat: '601',
      }).success,
    ).toBe(true);
    // factura falso/omitido NO exige nada (filas migradas)
    expect(
      esquemaProveedorCrear.safeParse({ modalidadFacturacion: 'solo_con', nombre: 'X' }).success,
    ).toBe(true);
    expect(
      esquemaProveedorCrear.safeParse({
        modalidadFacturacion: 'solo_con',
        nombre: 'X',
        factura: false,
      }).success,
    ).toBe(true);
  });

  it('regla factura ⇒ RFC también en edición y en el cuerpo del PATCH', () => {
    expect(esquemaProveedorEditar.safeParse({ id: 1, factura: true }).success).toBe(false);
    expect(esquemaProveedorPatchCuerpo.safeParse({ factura: true }).success).toBe(false);
    expect(
      esquemaProveedorPatchCuerpo.safeParse({
        factura: true,
        rfc: 'ABC010101AB1',
        regimenFiscalSat: '601',
      }).success,
    ).toBe(true);
  });

  it('valida CLABE (dígito de control), moneda y método de pago', () => {
    expect(
      esquemaProveedorCrear.safeParse({
        modalidadFacturacion: 'solo_con',
        nombre: 'X',
        clabe: '002010077777777772',
      }).success,
    ).toBe(false); // dígito de control malo
    expect(
      esquemaProveedorCrear.safeParse({
        modalidadFacturacion: 'solo_con',
        nombre: 'X',
        clabe: '123',
      }).success,
    ).toBe(false);
    expect(
      esquemaProveedorCrear.safeParse({
        modalidadFacturacion: 'solo_con',
        nombre: 'X',
        clabe: '002010077777777771',
      }).success,
    ).toBe(true);
    expect(
      esquemaProveedorCrear.safeParse({
        modalidadFacturacion: 'solo_con',
        nombre: 'X',
        moneda: 'EUR',
      }).success,
    ).toBe(false);
    expect(
      esquemaProveedorCrear.safeParse({
        modalidadFacturacion: 'solo_con',
        nombre: 'X',
        metodoPago: 'XXX',
      }).success,
    ).toBe(false);
  });

  it('valida el RFC cuando viene (forma física/moral)', () => {
    expect(
      esquemaProveedorCrear.safeParse({ modalidadFacturacion: 'solo_con', nombre: 'X', rfc: 'NO' })
        .success,
    ).toBe(false);
    expect(
      esquemaProveedorCrear.safeParse({
        modalidadFacturacion: 'solo_con',
        nombre: 'X',
        rfc: 'ABC010101AB1',
      }).success,
    ).toBe(true);
  });

  it('rechaza roles repetidos en el arreglo', () => {
    expect(
      esquemaProveedorCrear.safeParse({
        modalidadFacturacion: 'solo_con',
        nombre: 'X',
        roles: [1, 1, 2],
      }).success,
    ).toBe(false);
  });

  it('edición: omitir `roles` los deja undefined (no toca los existentes)', () => {
    const datos = esquemaProveedorEditar.parse({ id: 1, telefono: '555' });
    expect('roles' in datos).toBe(false);
    expect(datos.roles).toBeUndefined();
    // si se manda [] el esquema lo acepta; el DOMINIO es quien exige ≥1 al reemplazar
    expect(esquemaProveedorEditar.parse({ id: 1, roles: [] }).roles).toEqual([]);
  });

  // M1: en EDICIÓN los opcionales aceptan `null` (vaciar = borrar), distinto de
  // `undefined` (no tocar). El alta NO acepta `null` (omitir = el dominio lo deja null).
  it('edición: los campos opcionales (texto/num/enum) ACEPTAN null para borrarlos', () => {
    const datos = esquemaProveedorEditar.parse({
      id: 1,
      rfc: null,
      regimenFiscalSat: null,
      usoCfdiHabitual: null,
      codigoPostalExpedicion: null,
      email: null,
      direccion: null,
      razonSocial: null,
      telefono: null,
      contacto: null,
      condiciones: null,
      moneda: null,
      formaPago: null,
      metodoPago: null,
      banco: null,
      clabe: null,
      diasCredito: null,
      limiteCredito: null,
      leadTimeDias: null,
      notas: null,
    });
    expect(datos.rfc).toBeNull();
    expect(datos.moneda).toBeNull();
    expect(datos.diasCredito).toBeNull();
    expect(datos.limiteCredito).toBeNull();
    expect(datos.razonSocial).toBeNull();
  });

  it('edición: `null` y `undefined` son distintos (uno borra, el otro no toca)', () => {
    const conNull = esquemaProveedorEditar.parse({ id: 1, telefono: null });
    expect('telefono' in conNull).toBe(true);
    expect(conNull.telefono).toBeNull();

    const sinCampo = esquemaProveedorEditar.parse({ id: 1 });
    expect('telefono' in sinCampo).toBe(false);
    expect(sinCampo.telefono).toBeUndefined();
  });

  it('edición: `nombre` y `tipo` NO aceptan null (clave de negocio / siempre con valor)', () => {
    expect(esquemaProveedorEditar.safeParse({ id: 1, nombre: null }).success).toBe(false);
  });

  // Fusión de terceros (D12/R15): datos de taller. El `corto` se fusionó con `nombreCorto`
  // en V1-E3f pieza B (§Post-F9.57 punto 2): un solo campo corto, y ÚNICO.
  it('alta: acepta nombreCorto/asegurado/obsPago y NO les inyecta default (no son default-trap)', () => {
    const datos = esquemaProveedorCrear.parse({
      modalidadFacturacion: 'solo_con',
      nombre: 'Taller',
      nombreCorto: 'TLR',
      asegurado: true,
      obsPago: 'paga viernes',
    });
    expect(datos.nombreCorto).toBe('TLR');
    expect(datos.asegurado).toBe(true);
    expect(datos.obsPago).toBe('paga viernes');

    // Omitirlos en el alta los deja undefined (sin default que pise valores).
    const sin = esquemaProveedorCrear.parse({ modalidadFacturacion: 'solo_con', nombre: 'Taller' });
    expect('nombreCorto' in sin).toBe(false);
    expect('asegurado' in sin).toBe(false);
    expect('obsPago' in sin).toBe(false);
  });

  it('edición: omitir nombreCorto/asegurado/obsPago los deja undefined (sin default que resetee)', () => {
    const datos = esquemaProveedorEditar.parse({ id: 1, telefono: '555' });
    expect('nombreCorto' in datos).toBe(false);
    expect('asegurado' in datos).toBe(false);
    expect('obsPago' in datos).toBe(false);
    expect(datos.nombreCorto).toBeUndefined();
    expect(datos.asegurado).toBeUndefined();
    expect(datos.obsPago).toBeUndefined();
  });

  it('edición: nombreCorto/obsPago ACEPTAN null para borrarlos (asegurado es bandera, no nullable)', () => {
    const datos = esquemaProveedorEditar.parse({ id: 1, nombreCorto: null, obsPago: null });
    expect(datos.nombreCorto).toBeNull();
    expect(datos.obsPago).toBeNull();
    // `asegurado` es bandera (como factura): omitir = no tocar; null NO es válido.
    expect(esquemaProveedorEditar.safeParse({ id: 1, asegurado: null }).success).toBe(false);
  });

  it('el cuerpo del PATCH también acepta null en los opcionales', () => {
    const cuerpo = esquemaProveedorPatchCuerpo.parse({
      rfc: null,
      diasCredito: null,
      moneda: null,
    });
    expect(cuerpo.rfc).toBeNull();
    expect(cuerpo.diasCredito).toBeNull();
    expect(cuerpo.moneda).toBeNull();
  });

  it('alta: los opcionales NO aceptan null (en el alta se omite, no se manda null)', () => {
    expect(
      esquemaProveedorCrear.safeParse({ modalidadFacturacion: 'solo_con', nombre: 'X', rfc: null })
        .success,
    ).toBe(false);
    expect(
      esquemaProveedorCrear.safeParse({
        modalidadFacturacion: 'solo_con',
        nombre: 'X',
        diasCredito: null,
      }).success,
    ).toBe(false);
  });

  it('edición: si se intenta vaciar el RFC con factura activa, la regla lo rechaza', () => {
    // factura=true + rfc=null (vaciar) ⇒ falla la regla factura ⇒ RFC.
    expect(
      esquemaProveedorEditar.safeParse({ id: 1, factura: true, rfc: null, regimenFiscalSat: '601' })
        .success,
    ).toBe(false);
  });
});
