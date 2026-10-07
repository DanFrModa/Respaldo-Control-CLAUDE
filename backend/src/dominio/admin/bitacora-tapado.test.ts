/**
 * ⭐ El TAPADO de la bitácora al leerla (fila 0.249 parte D + fila 0.255), en pruebas puras.
 *
 *  1. Desde el propio mapa: para cada (entidad, clave, regla) y cada rol SEMBRADO que lee la
 *     bitácora, el valor llega tapado si el rol no cumple la regla e intacto si la cumple.
 *  2. Las decisiones del dueño, rol por rol, contra el seed real: Gerencial deja de ver el EDR, el
 *     costo de la orden y los factores; la corrida se tapa con su llave; etc.
 *  3. La mecánica: profundidad, arreglos, `{de,a}`, `null` sin tapar, el default por nombre, los
 *     falsos positivos declarados, los ids, y que nunca muta lo guardado.
 */
import { describe, expect, it } from 'vitest';

import { CATALOGO_PERMISOS, type ClavePermiso } from '../../contrato/index.js';
import { definirRoles, PERFILES_EDITABLES } from '../../../prisma/seed.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  MAPA_BITACORA,
  NO_ES_DINERO,
  OCULTO,
  PARECE_DINERO,
  REGLAS_BITACORA,
  REGLA_FACTOR_DESCONOCIDO,
  REGLAS_POR_NOMBRE,
  reglaDeClave,
  taparDatosBitacora,
  type ReglaBitacora,
} from './bitacora-tapado.js';

const sesion = (permisos: readonly string[]) =>
  sesionDePrueba({ permisos: [...permisos] as ClavePermiso[] });

/** Los roles sembrados (de sistema y perfiles editables) que leen la bitácora. */
const LECTORES = [
  ...definirRoles().map((r) => ({ nombre: r.nombre, permisos: r.permisos })),
  ...PERFILES_EDITABLES.map((p) => ({ nombre: p.nombre, permisos: p.permisos })),
].filter((r) => r.permisos.includes('admin.ver-bitacora'));

/** El rol sembrado por nombre (falla si desaparece: la prueba no puede medir en vacío). */
function rol(nombre: string): readonly string[] {
  const r = LECTORES.find((x) => x.nombre === nombre);
  if (r === undefined) throw new Error(`El rol «${nombre}» ya no lee la bitácora en el seed.`);
  return r.permisos;
}

/** Una sesión con TODAS las llaves que piden las reglas. */
const TODO = sesion([
  'consultas.ver-importes',
  'modelos.administrar',
  'ordenes.ver-precio-real-maquila',
  'compras.ver',
  'costos.ver',
  'edr.ver',
  'listas.aprobar',
  'pagos.corrida-ver',
  'proveedores.ver',
  'etiquetas-marca.ver',
]);

/** Las reglas que un rol NO cumple. */
function reglasNegadas(permisos: readonly string[]): ReglaBitacora[] {
  const s = sesion(permisos);
  return (Object.keys(REGLAS_BITACORA) as ReglaBitacora[]).filter((r) => !REGLAS_BITACORA[r](s));
}

describe('el mapa, rol por rol (data-driven desde MAPA_BITACORA y el seed)', () => {
  it('hay lectores de bitácora que revisar, y la sesión de control lo ve todo', () => {
    expect(LECTORES.length).toBeGreaterThan(4);
    expect(reglasNegadas([...TODO.permisos])).toEqual([]);
  });

  const casos = Object.entries(MAPA_BITACORA).flatMap(([entidad, claves]) =>
    Object.entries(claves).map(([clave, regla]) => ({ entidad, clave, regla })),
  );

  it.each(LECTORES.map((l) => [l.nombre, l.permisos] as const))(
    '%s: cada clave del mapa llega tapada si no cumple su regla, e intacta si la cumple',
    (_nombre, permisos) => {
      const s = sesion(permisos);
      for (const { entidad, clave, regla } of casos) {
        const valor = { de: 987654.31, a: 123456.78 };
        const t = taparDatosBitacora(s, entidad, { otraCosa: 'x', anidado: { [clave]: valor } });
        const ve = REGLAS_BITACORA[regla](s);
        const esperado = ve ? valor : OCULTO;
        expect(
          (t.datos as { anidado: Record<string, unknown> }).anidado[clave],
          `${entidad}.${clave}`,
        ).toEqual(esperado);
        expect((t.datos as { otraCosa: string }).otraCosa).toBe('x');
        expect(t.datosOcultos, `${entidad}.${clave}`).toBe(ve ? 0 : 1);
      }
    },
  );
});

describe('las decisiones, contra el seed real', () => {
  it('Administrador, AdministracionDireccion, Directivo y Director General lo ven TODO', () => {
    for (const nombre of [
      'Administrador',
      'AdministracionDireccion',
      'Directivo',
      'Director General',
    ]) {
      expect(reglasNegadas(rol(nombre)), nombre).toEqual([]);
    }
  });

  it('Gerencial deja de ver el EDR, el costo de la orden y los factores — como en sus pantallas', () => {
    expect(reglasNegadas(rol('Gerencial')).sort()).toEqual(
      ['costos', 'edr', 'factores', 'ventaEdr'].sort(),
    );
    const s = sesion(rol('Gerencial'));
    expect(taparDatosBitacora(s, 'Edr', { gastos: 10 }).datos).toEqual({ gastos: OCULTO });
    expect(taparDatosBitacora(s, 'CostoOrden', { telaCost: 10 }).datos).toEqual({
      telaCost: OCULTO,
    });
    expect(
      taparDatosBitacora(s, 'ListaPrecios', {
        operacion: 'eliminar-lista',
        antes: { margenPct: 30, precio: 99, lineas: [{ precioAprobado: 120 }] },
      }).datos,
    ).toEqual({
      operacion: 'eliminar-lista',
      antes: { margenPct: OCULTO, precio: 99, lineas: [{ precioAprobado: 120 }] },
    });
  });

  it('Ventas no ve el dinero del modelo ni los importes, pero sí la maquila de referencia', () => {
    const negadas = reglasNegadas(rol('Ventas'));
    expect(negadas).toContain('precioModelo');
    expect(negadas).toContain('importes');
    expect(negadas).toContain('corrida');
    expect(negadas).not.toContain('maquilaReferencia');
    expect(negadas).not.toContain('maquilaReal');
  });

  it.each(['Logistica', 'Asistente', 'Secretarial'])(
    '%s no ve modelo, orden, maquila, importes, costos, EDR, factores ni corrida',
    (nombre) => {
      expect(reglasNegadas(rol(nombre)).sort()).toEqual(
        [
          'precioModelo',
          'maquilaReferencia',
          'precioOrden',
          'maquilaReal',
          'importes',
          'costos',
          'edr',
          'ventaEdr',
          'factores',
          'corrida',
          'corridaMonto',
          'metaPrometida',
          'metaConseguida',
          'configEmpresa',
        ].sort(),
      );
    },
  );

  it('el límite de crédito y las regalías se ven con la llave de su ficha (no con ver-importes)', () => {
    const s = sesion(['proveedores.ver', 'etiquetas-marca.ver']);
    expect(taparDatosBitacora(s, 'Proveedor', { limiteCredito: { de: 1, a: 2 } }).datos).toEqual({
      limiteCredito: { de: 1, a: 2 },
    });
    expect(taparDatosBitacora(s, 'EtiquetaMarca', { regalias: 5 }).datos).toEqual({ regalias: 5 });
    // Y sin la llave de la ficha, tapados (no quedan libres).
    const sinFicha = sesion(['consultas.ver-importes']);
    expect(taparDatosBitacora(sinFicha, 'Proveedor', { limiteCredito: 9 }).datos).toEqual({
      limiteCredito: OCULTO,
    });
    expect(taparDatosBitacora(sinFicha, 'EtiquetaMarca', { regalias: 5 }).datos).toEqual({
      regalias: OCULTO,
    });
  });
});

describe('la corrida (fila 0.255)', () => {
  const renglon = {
    corrida: 7,
    nombre: 'Maquilas Pérez',
    monto: 15000,
    montoAnterior: 14000,
    formaPago: 'transferencia',
    beneficiario: 'Juan Pérez',
    cuentaEsFiscal: true,
  };

  it('sin llave de la corrida: ni a quién ni cuánto (lo demás, en claro)', () => {
    const t = taparDatosBitacora(sesion(['consultas.ver-importes']), 'RenglonCorridaPago', renglon);
    expect(t.datos).toEqual({
      ...renglon,
      nombre: OCULTO,
      beneficiario: OCULTO,
      monto: OCULTO,
      montoAnterior: OCULTO,
    });
    expect(t.datosOcultos).toBe(4);
  });

  it('con la llave de la corrida sin ver importes: a quién SÍ, cuánto NO (como su pantalla)', () => {
    for (const llave of ['pagos.corrida-ver', 'pagos.corrida-armar']) {
      const t = taparDatosBitacora(sesion([llave]), 'RenglonCorridaPago', renglon);
      expect(t.datos, llave).toEqual({ ...renglon, monto: OCULTO, montoAnterior: OCULTO });
    }
    expect(
      taparDatosBitacora(sesion(['pagos.corrida-ver']), 'CorridaPago', {
        total: 99,
        renglonesConMonto: 3,
      }).datos,
    ).toEqual({ total: OCULTO, renglonesConMonto: 3 });
  });

  it('con la llave de la corrida Y ver importes: todo', () => {
    const t = taparDatosBitacora(
      sesion(['pagos.corrida-ver', 'consultas.ver-importes']),
      'RenglonCorridaPago',
      renglon,
    );
    expect(t).toEqual({ datos: renglon, datosOcultos: 0 });
  });
});

describe('la meta de costo del modelo', () => {
  const datos = {
    metaCostoPrometido: 43,
    metaCostoConseguido: 45,
    metaCostoPrometidoAnterior: 40,
    metaCostoConseguidoAnterior: 41,
  };

  it('quien firma sin ver importes ve lo conseguido, no lo prometido', () => {
    expect(taparDatosBitacora(sesion(['modelos.aprobar-receta']), 'Modelo', datos).datos).toEqual({
      metaCostoPrometido: OCULTO,
      metaCostoConseguido: 45,
      metaCostoPrometidoAnterior: OCULTO,
      metaCostoConseguidoAnterior: 41,
    });
  });

  it('con ver importes, las dos', () => {
    expect(taparDatosBitacora(sesion(['consultas.ver-importes']), 'Modelo', datos).datos).toEqual(
      datos,
    );
  });
});

describe('la mecánica del recorrido', () => {
  const nadie = sesion(['admin.ver-bitacora']);

  it('a cualquier profundidad, dentro de arreglos, y `{de,a}` se tapa entero', () => {
    const t = taparDatosBitacora(nadie, 'Tela', {
      colores: [
        { nombre: 'Rojo', precio: 10 },
        { nombre: 'Azul', precio: 11 },
      ],
      cambios: { precioSugerido: { de: 1, a: 2 }, nombre: 'Felpa' },
    });
    expect(t.datos).toEqual({
      colores: [
        { nombre: 'Rojo', precio: OCULTO },
        { nombre: 'Azul', precio: OCULTO },
      ],
      cambios: { precioSugerido: OCULTO, nombre: 'Felpa' },
    });
    expect(t.datosOcultos).toBe(3);
  });

  it('un valor null NO se tapa ni cuenta (vacío no revela un importe)', () => {
    const t = taparDatosBitacora(nadie, 'Orden', { anterior: null, nuevo: 18 });
    expect(t.datos).toEqual({ anterior: null, nuevo: OCULTO });
    expect(t.datosOcultos).toBe(1);
  });

  it('la clave genérica es dinero SÓLO en su entidad (`anterior` de una OC es un estatus)', () => {
    expect(taparDatosBitacora(nadie, 'OrdenCompra', { anterior: 'autorizada' }).datos).toEqual({
      anterior: 'autorizada',
    });
    expect(taparDatosBitacora(nadie, 'ProcesoDef', { total: 3 }).datos).toEqual({ total: 3 });
    expect(taparDatosBitacora(nadie, 'CorridaPago', { total: 3 }).datos).toEqual({
      total: OCULTO,
    });
  });

  it('DEFAULT: una clave no declarada que suena a dinero se tapa con ver-importes, en cualquier entidad', () => {
    const datos = { costoNuevoDeEmpaque: 3, saldoPendiente: 4, descripcion: 'a' };
    expect(taparDatosBitacora(nadie, 'EntidadQueNoExiste', datos).datos).toEqual({
      costoNuevoDeEmpaque: OCULTO,
      saldoPendiente: OCULTO,
      descripcion: 'a',
    });
    expect(reglaDeClave('EntidadQueNoExiste', 'costoNuevoDeEmpaque')).toBe('importes');
    // Y con ver-importes pasa.
    expect(
      taparDatosBitacora(sesion(['consultas.ver-importes']), 'EntidadQueNoExiste', datos).datos,
    ).toEqual(datos);
  });

  it('NO_ES_DINERO pasa en claro, sólo en su entidad', () => {
    for (const [entidad, claves] of Object.entries(NO_ES_DINERO)) {
      for (const clave of Object.keys(claves)) {
        expect(taparDatosBitacora(nadie, entidad, { [clave]: true }).datos, clave).toEqual({
          [clave]: true,
        });
      }
    }
    // En otra entidad, la misma clave se tapa por el default.
    expect(taparDatosBitacora(nadie, 'Otra', { paraCosto: true }).datos).toEqual({
      paraCosto: OCULTO,
    });
  });

  it('los ids nunca se tapan aunque suenen a dinero, ni `costura` (no es `costo`)', () => {
    expect(
      taparDatosBitacora(nadie, 'Precosto', { idPrecostoNuevo: 4, diasCostura: 5 }).datos,
    ).toEqual({ idPrecostoNuevo: 4, diasCostura: 5 });
  });

  it('atajo: con todas las llaves devuelve el MISMO objeto y 0 ocultos', () => {
    const datos = { precio: 1, antes: { monto: 2 } };
    const t = taparDatosBitacora(TODO, 'ListaPrecios', datos);
    expect(t.datos).toBe(datos);
    expect(t.datosOcultos).toBe(0);
  });

  it('nunca muta lo que recibe (lo guardado queda completo)', () => {
    const datos = { antes: { precio: 5 }, lista: [{ precio: 6 }] };
    const copia = structuredClone(datos);
    taparDatosBitacora(nadie, 'RecetaOrden', datos);
    expect(datos).toEqual(copia);
  });

  it('datos null, primitivos y vacíos pasan sin tapar', () => {
    expect(taparDatosBitacora(nadie, 'Orden', null)).toEqual({ datos: null, datosOcultos: 0 });
    expect(taparDatosBitacora(nadie, 'Orden', 'texto')).toEqual({
      datos: 'texto',
      datosOcultos: 0,
    });
    expect(taparDatosBitacora(nadie, 'Orden', {})).toEqual({ datos: {}, datosOcultos: 0 });
  });

  it('una clave `__proto__` en el JSON guardado no cambia el prototipo del resultado', () => {
    const datos = JSON.parse('{"__proto__": {"precio": 1}, "nombre": "x"}') as unknown;
    const t = taparDatosBitacora(nadie, 'Tela', datos);
    expect(Object.getPrototypeOf(t.datos)).toBe(Object.prototype);
    expect(JSON.stringify(t.datos)).toBe('{"__proto__":{"precio":{"oculto":true}},"nombre":"x"}');
  });
});

describe('claves que chocan con el prototipo', () => {
  it('`constructor` / `toString` en el JSON guardado no se toman por una regla del mapa', () => {
    const nadie = sesion(['admin.ver-bitacora']);
    const datos = JSON.parse('{"constructor": "x", "toString": 1, "hasOwnProperty": 2}') as unknown;
    expect(taparDatosBitacora(nadie, 'Tela', datos).datos).toEqual(datos);
    expect(taparDatosBitacora(nadie, 'constructor', { precio: 1 }).datos).toEqual({
      precio: OCULTO,
    });
  });
});

/**
 * ⭐⭐ H3 (revisión de la 0.249 D) — EL CONTENIDO DEL MAPA, ESCRITO A MANO. Las pruebas de arriba
 * derivan sus expectativas del propio mapa, así que cambiarle la regla a una clave (p. ej.
 * `RecetaOrden.precio` → `precioTela`) las dejaba en verde. Esta tabla es la DECISIÓN: cambiar una
 * regla obliga a cambiarla aquí, a propósito y con su razón.
 */
const ESPERADO_POR_ENTIDAD: Readonly<Record<string, ReglaBitacora>> = {
  'Modelo.maquilaBase': 'maquilaReferencia',
  'Modelo.corteBase': 'precioModelo',
  'Modelo.precio': 'precioModelo',
  'Modelo.metaCostoPrometido': 'metaPrometida',
  'Modelo.metaCostoPrometidoAnterior': 'metaPrometida',
  'Modelo.metaCostoConseguido': 'metaConseguida',
  'Modelo.metaCostoConseguidoAnterior': 'metaConseguida',
  'ModeloArte.precio': 'precioModelo',
  'RecetaOrden.precio': 'precioOrden',
  'Orden.precio': 'maquilaReal',
  'Orden.anterior': 'maquilaReal',
  'Orden.nuevo': 'maquilaReal',
  'Orden.precioAnterior': 'precioCompra',
  'Orden.precioNuevo': 'precioCompra',
  'Orden.costoUnitarioCongelado': 'costos',
  'TelaColor.precioAnterior': 'precioTela',
  'TelaColor.precioNuevo': 'precioTela',
  'TelaColor.precioComplementoAnterior': 'precioTela',
  'TelaColor.precioComplementoNuevo': 'precioTela',
  'Tela.precio': 'precioTela',
  'Tela.precioComplemento': 'precioTela',
  'Tela.precioSugerido': 'precioTela',
  'Tela.precioSugeridoComplemento': 'precioTela',
  'TelaProveedor.precio': 'precioTela',
  'Avio.precioReferencia': 'precioAvio',
  'Avio.precio': 'precioAvio',
  'Proveedor.precio': 'precioAvio',
  'Proveedor.limiteCredito': 'fichaProveedor',
  'ProveedorContacto.limiteCredito': 'fichaProveedor',
  'EtiquetaMarca.regalias': 'etiquetaMarca',
  'RecepcionCompra.importe': 'precioRecepcion',
  'RecepcionCompra.preciosCorregidos': 'precioRecepcion',
  'RecepcionCompra.precioOc': 'precioRecepcion',
  'RecepcionCompra.recibido': 'precioRecepcion',
  'CostoOrden.telaCost': 'costos',
  'CostoOrden.procesosCost': 'costos',
  'CostoOrden.aviosCost': 'costos',
  'CostoOrden.otros': 'costos',
  'CostoOrden.costoTotal': 'costos',
  'CostoOrden.telaReal': 'costos',
  'CostoOrden.aviosReal': 'costos',
  'EtapaMovimiento.precioPactado': 'maquilaReal',
  'CierreMaquilaOrden.precio': 'maquilaReal',
  'DescuentoMaquilero.precio': 'maquilaReal',
  'DescuentoMaquilero.monto': 'importes',
  'AbonoMaquilero.monto': 'importes',
  'PagoMaquilero.monto': 'importes',
  'EsMaCargo.precioReal': 'importes',
  'MovimientoTercero.monto': 'importes',
  'MovimientoTercero.importe': 'importes',
  'CorridaPago.total': 'corridaMonto',
  'RenglonCorridaPago.nombre': 'corrida',
  'RenglonCorridaPago.beneficiario': 'corrida',
  'RenglonCorridaPago.monto': 'corridaMonto',
  'RenglonCorridaPago.montoAnterior': 'corridaMonto',
  'ListaPrecios.precio': 'importes',
  'ListaPrecios.precioTarget': 'importes',
  'ListaPrecios.costoEstimado': 'importes',
  'ListaPrecios.costoUnit': 'importes',
  'ListaPrecios.precioCalculado': 'importes',
  'ListaPrecios.precioAprobado': 'importes',
  'ListaPrecios.precioAprobadoAnterior': 'importes',
  'ListaPrecios.precioAnterior': 'importes',
  'ListaPrecios.precioNuevo': 'importes',
  'ListaPrecios.precioUnit': 'importes',
  'ListaPrecios.importe': 'importes',
  'ListaPrecios.margenPct': 'factores',
  'ListaPrecios.descuentosPct': 'factores',
  'ListaPrecios.regaliasPct': 'factores',
  'ListaPrecios.costoVentasPct': 'factores',
  'Cotizacion.precioUnit': 'importes',
  'Precosto.costoTotal': 'importes',
  'Edr.gastos': 'edr',
  'Edr.intereses': 'edr',
  'Edr.bonificaciones': 'edr',
  'Edr.otros': 'edr',
  'EdrLinea.precioVenta': 'ventaEdr',
  'Cliente.margenPct': 'factores',
  'Cliente.descuentosPct': 'factores',
  'Cliente.regaliasPct': 'factores',
  'Cliente.costoVentasPct': 'factores',
  'Color.precio': 'precioTela',
  'ConfiguracionEmpresa.utilidadSugerida': 'configEmpresa',
  'ConfiguracionEmpresa.regaliasBase': 'configEmpresa',
  'ConfiguracionEmpresa.costoEmpaqueBase': 'configEmpresa',
};

/** La tabla global por nombre (H1), escrita a mano. */
const ESPERADO_POR_NOMBRE: Readonly<Record<string, ReglaBitacora>> = {
  margenPct: 'factores',
  descuentosPct: 'factores',
  regaliasPct: 'factores',
  costoVentasPct: 'factores',
};

describe('H3 · el CONTENIDO del mapa es exactamente la decisión escrita', () => {
  it('MAPA_BITACORA = la tabla escrita a mano (entidad.clave → regla)', () => {
    const mapa = Object.fromEntries(
      Object.entries(MAPA_BITACORA).flatMap(([entidad, claves]) =>
        Object.entries(claves).map(([clave, regla]) => [`${entidad}.${clave}`, regla]),
      ),
    );
    expect(mapa).toEqual(ESPERADO_POR_ENTIDAD);
  });

  it('REGLAS_POR_NOMBRE = la tabla escrita a mano', () => {
    expect(REGLAS_POR_NOMBRE).toEqual(ESPERADO_POR_NOMBRE);
  });

  it('y `reglaDeClave` resuelve cada fila como dice la tabla', () => {
    for (const [entidadClave, regla] of Object.entries(ESPERADO_POR_ENTIDAD)) {
      const [entidad, clave] = entidadClave.split('.') as [string, string];
      expect(reglaDeClave(entidad, clave), entidadClave).toBe(regla);
    }
    for (const [clave, regla] of Object.entries(ESPERADO_POR_NOMBRE)) {
      expect(reglaDeClave('CualquierEntidad', clave), clave).toBe(regla);
    }
  });
});

describe('H1 · los factores se tapan con su llave en CUALQUIER entidad', () => {
  it('la fusión de departamentos (entidad Cliente): Gerencial NO ve los factores descartados', () => {
    const s = sesion(rol('Gerencial'));
    const datos = {
      departamento: 'fusionar',
      descartados: [
        { margenPct: 30, descuentosPct: 5, regaliasPct: 10, costoVentasPct: 3, porQue: 'x' },
      ],
    };
    expect(taparDatosBitacora(s, 'Cliente', datos).datos).toEqual({
      departamento: 'fusionar',
      descartados: [
        {
          margenPct: OCULTO,
          descuentosPct: OCULTO,
          regaliasPct: OCULTO,
          costoVentasPct: OCULTO,
          porQue: 'x',
        },
      ],
    });
    // En una entidad que nadie declaró, igual (regla fija por nombre, no el default).
    expect(taparDatosBitacora(s, 'OtraEntidad', { margenPct: 30 }).datos).toEqual({
      margenPct: OCULTO,
    });
    // Control: con `listas.aprobar` se ven.
    expect(
      taparDatosBitacora(sesion(['listas.aprobar']), 'OtraEntidad', { margenPct: 30 }).datos,
    ).toEqual({ margenPct: 30 });
  });

  it('la fusión de colores (entidad Color): el precio descartado va con la llave de la tela', () => {
    const datos = { descartados: [{ que: 'precio por color', precio: '12.50' }] };
    expect(taparDatosBitacora(sesion(['telas.administrar']), 'Color', datos).datos).toEqual(datos);
    expect(taparDatosBitacora(sesion(['telas.ver']), 'Color', datos).datos).toEqual({
      descartados: [{ que: 'precio por color', precio: OCULTO }],
    });
  });
});

describe('H2 · la configuración de la empresa y las raíces nuevas de «suena a dinero»', () => {
  const config = {
    utilidadSugerida: 50,
    regaliasBase: 10,
    costoEmpaqueBase: 2.2,
    colchonCostura: 3,
    pctDesvioCompra: 5,
  };

  it.each(['Ventas', 'Logistica', 'Asistente', 'Secretarial'])(
    '%s no ve la utilidad sugerida ni las regalías ni el empaque base (sí los días y la tolerancia)',
    (nombre) => {
      expect(taparDatosBitacora(sesion(rol(nombre)), 'ConfiguracionEmpresa', config).datos).toEqual(
        {
          utilidadSugerida: OCULTO,
          regaliasBase: OCULTO,
          costoEmpaqueBase: OCULTO,
          colchonCostura: 3,
          pctDesvioCompra: 5,
        },
      );
    },
  );

  it('con ver importes, o con la llave de quien la teclea (empresas.administrar), se ve', () => {
    for (const llave of ['consultas.ver-importes', 'empresas.administrar']) {
      expect(
        taparDatosBitacora(sesion([llave]), 'ConfiguracionEmpresa', config).datos,
        llave,
      ).toEqual(config);
    }
  });

  it.each([
    'utilidadBruta',
    'factorDeVenta',
    'descuentoCliente',
    'bonificacion',
    'regaliasBase',
    'comisionVendedor',
    'tarifaFlete',
    'fleteExtra',
    'saldoPendiente',
    'pagoAnticipado',
    'creditoDisponible',
    'subtotal',
    'iva',
    'montoIva',
    'ivaTrasladado',
  ])('«%s» suena a dinero', (clave) => {
    expect(PARECE_DINERO.test(clave)).toBe(true);
  });

  it.each(['activados', 'desactivadas', 'derivado', 'diasCostura', 'nombre', 'totalPiezas'])(
    '«%s» NO suena a dinero (iva dentro de «activa», costura no es costo)',
    (clave) => {
      expect(PARECE_DINERO.test(clave)).toBe(false);
    },
  );

  it('los falsos positivos medidos pasan en claro (formaPago, diasCredito, retieneIva…)', () => {
    const nadie = sesion(['admin.ver-bitacora']);
    const datos = {
      formaPago: { de: '01', a: '03' },
      diasCredito: { de: 15, a: 30 },
      retieneIva: { de: false, a: true },
    };
    expect(taparDatosBitacora(nadie, 'Proveedor', datos).datos).toEqual(datos);
  });
});

/**
 * ⭐⭐ H3′ (revisión de la 0.249 D) — QUÉ LLAVES PIDE CADA REGLA, escrito a mano. Cada regla es una
 * disyunción de conjunciones: `[[a], [b, c]]` = «a, o b y c a la vez». Se compara contra la función
 * real con TODAS las llaves del catálogo sueltas y TODOS los pares: agregar una llave a una regla,
 * quitarle una, o cambiarle la función (p. ej. la recepción usando la regla de compra) la pone roja.
 */
const IMP: ClavePermiso = 'consultas.ver-importes';
const LLAVES_POR_REGLA: Readonly<Record<ReglaBitacora, readonly (readonly ClavePermiso[])[]>> = {
  precioModelo: [[IMP], ['modelos.administrar']],
  maquilaReferencia: [
    [IMP],
    ['modelos.administrar'],
    ['ordenes.precio-maquila'],
    ['ordenes.ver-precio-real-maquila'],
  ],
  precioOrden: [[IMP], ['modelos.administrar'], ['desarrollo.administrar']],
  maquilaReal: [['ordenes.ver-precio-real-maquila']],
  precioTela: [[IMP], ['telas.administrar'], ['compras.administrar'], ['modelos.administrar']],
  precioAvio: [
    [IMP],
    ['avios.administrar'],
    ['compras.administrar'],
    ['proveedores.administrar'],
    ['modelos.administrar'],
  ],
  precioCompra: [['compras.ver'], ['compras.administrar']],
  precioRecepcion: [['compras.ver'], ['compras.administrar'], ['compras.recibir']],
  importes: [[IMP]],
  costos: [['costos.ver', IMP]],
  edr: [['edr.ver']],
  ventaEdr: [['edr.ver'], ['ventas.ver']],
  factores: [['listas.aprobar']],
  corrida: [['pagos.corrida-ver'], ['pagos.corrida-armar']],
  corridaMonto: [
    ['pagos.corrida-ver', IMP],
    ['pagos.corrida-armar', IMP],
  ],
  metaPrometida: [[IMP]],
  metaConseguida: [[IMP], ['modelos.aprobar-receta']],
  fichaProveedor: [['proveedores.ver'], ['proveedores.administrar']],
  etiquetaMarca: [['etiquetas-marca.ver'], ['etiquetas-marca.administrar']],
  configEmpresa: [[IMP], ['empresas.administrar']],
};

/** Lo que la tabla dice para un conjunto de llaves. */
function abrePorTabla(regla: ReglaBitacora, llaves: readonly ClavePermiso[]): boolean {
  return LLAVES_POR_REGLA[regla].some((conjuncion) => conjuncion.every((l) => llaves.includes(l)));
}

describe('H3′ · qué llaves pide cada regla (tabla escrita a mano)', () => {
  const catalogo = CATALOGO_PERMISOS.map((p) => p.clave);
  const reglas = Object.keys(REGLAS_BITACORA) as ReglaBitacora[];

  it('la tabla cubre EXACTAMENTE las reglas que existen', () => {
    expect(reglas.sort()).toEqual((Object.keys(LLAVES_POR_REGLA) as ReglaBitacora[]).sort());
  });

  it.each(Object.keys(LLAVES_POR_REGLA) as ReglaBitacora[])(
    '%s: sin llaves cierra; con cada llave suelta y cada PAR del catálogo abre sólo si la tabla lo dice',
    (regla) => {
      expect(REGLAS_BITACORA[regla](sesion([])), 'sin llaves').toBe(false);
      const fallas: string[] = [];
      for (let i = 0; i < catalogo.length; i += 1) {
        const a = catalogo[i]!;
        if (REGLAS_BITACORA[regla](sesion([a])) !== abrePorTabla(regla, [a])) fallas.push(a);
        for (let j = i + 1; j < catalogo.length; j += 1) {
          const par = [a, catalogo[j]!];
          if (REGLAS_BITACORA[regla](sesion(par)) !== abrePorTabla(regla, par)) {
            fallas.push(par.join(' + '));
          }
        }
      }
      expect(fallas).toEqual([]);
    },
  );

  it('cada conjunción de la tabla abre por sí sola (la tabla no promete llaves imposibles)', () => {
    for (const regla of reglas) {
      for (const conjuncion of LLAVES_POR_REGLA[regla]) {
        expect(
          REGLAS_BITACORA[regla](sesion(conjuncion)),
          `${regla}: ${conjuncion.join('+')}`,
        ).toBe(true);
      }
    }
  });
});

describe('opcional (4) · un FACTOR desconocido cae en `factores`, no en `importes`', () => {
  it('`factorDeVenta` en una entidad que nadie declaró: regla factores', () => {
    expect(REGLA_FACTOR_DESCONOCIDO).toBe('factores');
    expect(reglaDeClave('EntidadNueva', 'factorDeVenta')).toBe('factores');
    expect(reglaDeClave('EntidadNueva', 'precioNuevo')).toBe('importes');
    // Gerencial (ve importes, no factores) no lo ve; con `listas.aprobar` sí.
    expect(
      taparDatosBitacora(sesion(rol('Gerencial')), 'EntidadNueva', { factorDeVenta: 2.1 }).datos,
    ).toEqual({ factorDeVenta: OCULTO });
    expect(
      taparDatosBitacora(sesion(['listas.aprobar']), 'EntidadNueva', { factorDeVenta: 2.1 }).datos,
    ).toEqual({ factorDeVenta: 2.1 });
  });

  it('los factores declarados como «no es dinero» siguen en claro', () => {
    expect(reglaDeClave('Cliente', 'factores')).toBeUndefined();
    expect(reglaDeClave('FactorCantidad', 'factor')).toBeUndefined();
  });
});
