/**
 * Tests de INTEGRACIÓN de los avíos FAVORITOS de la receta del modelo (V1-E3v, §Post-F9.90).
 * Contra Postgres efímero: qué se sugiere y qué no, que la cantidad sea la del CATÁLOGO
 * (`Avio.cantFav`) y no un número inventado, que UN acto los acepte todos sin duplicar ni pisar lo
 * que ya estaba, la auditoría (A7) y la acotación a la empresa activa (A9). Corre en CI (NUNCA
 * Docker local, regla §7 de CLAUDE.md).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ErrorNoEncontrado, ErrorPermiso } from '../../comun/errores.js';
import type { ClavePermiso } from '../../contrato/index.js';
import type { Empresa, PrismaClient } from '../../datos/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';

import { aceptarAviosFavoritos, sugerirAviosFavoritos } from './avios-favoritos.js';

let cliente: PrismaClient;
let empresa: Empresa;

const PERMISOS: ClavePermiso[] = ['modelos.ver', 'modelos.administrar'];
const sesion = () => sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: PERMISOS });
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
});

/**
 * Catálogo de la etapa: DOS favoritos con cantidad (etiqueta de lavado a 1 pza, etiqueta de marca a
 * 2 pzas — cantidades DISTINTAS a propósito: si alguien cableara un 1, la de marca lo delataría) y
 * un avío NORMAL que no debe aparecer nunca.
 */
async function sembrarCatalogo() {
  const lavado = await cliente.avio.create({
    data: {
      clave: 'ETQ-LAV',
      descripcion: 'Etiqueta de lavado',
      unidad: 'pza',
      favorito: true,
      cantFav: 1,
      precioReferencia: 0.5,
    },
  });
  const marca = await cliente.avio.create({
    data: {
      clave: 'ETQ-MAR',
      descripcion: 'Etiqueta de marca',
      unidad: 'pza',
      favorito: true,
      cantFav: 2,
      precioReferencia: 0.8,
    },
  });
  const normal = await cliente.avio.create({
    data: { clave: 'ZZZ-BOT', descripcion: 'Botón', unidad: 'pza', precioReferencia: 0.1 },
  });
  return { lavado, marca, normal };
}

/** Un modelo sin receta de avíos. */
async function crearModelo(codigo = 'MOD-FAV') {
  return cliente.modelo.create({ data: { codigo } });
}

describe('sugerirAviosFavoritos (A1: quién es favorito lo dice el servidor)', () => {
  it('sugiere SOLO los favoritos, con la cantidad del catálogo (`cantFav`), en orden de clave', async () => {
    const { lavado, marca, normal } = await sembrarCatalogo();
    const modelo = await crearModelo();

    const s = await sugerirAviosFavoritos(sesion(), modelo.id, bd());

    expect(s.sugeridos.map((a) => a.clave)).toEqual(['ETQ-LAV', 'ETQ-MAR']);
    // 🔴 El avío NO favorito no se sugiere jamás.
    expect(s.sugeridos.map((a) => a.idAvio)).not.toContain(normal.id);
    // 🔴 La cantidad es la de CADA avío, no una constante: 1 para lavado, 2 para marca.
    expect(s.sugeridos.find((a) => a.idAvio === lavado.id)?.cantidadSugerida).toBe(1);
    expect(s.sugeridos.find((a) => a.idAvio === marca.id)?.cantidadSugerida).toBe(2);
    expect(s.sugeridos[0]?.unidad).toBe('pza');
    expect(s.yaEnLaReceta).toEqual([]);
    expect(s.sinCantidad).toEqual([]);
  });

  it('un favorito DADO DE BAJA (inactivo) no se sugiere', async () => {
    const { lavado } = await sembrarCatalogo();
    await cliente.avio.update({ where: { id: lavado.id }, data: { activo: false } });
    const modelo = await crearModelo();

    const s = await sugerirAviosFavoritos(sesion(), modelo.id, bd());

    expect(s.sugeridos.map((a) => a.clave)).toEqual(['ETQ-MAR']);
  });

  it('un favorito que YA está en la receta sale por `yaEnLaReceta` — y el resto se sigue ofreciendo', async () => {
    const { lavado } = await sembrarCatalogo();
    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'MOD-MEDIO-ARMADO',
        avios: { create: [{ idAvio: lavado.id, consumoPorPrenda: 7 }] },
      },
    });

    const s = await sugerirAviosFavoritos(sesion(), modelo.id, bd());

    expect(s.yaEnLaReceta.map((a) => a.clave)).toEqual(['ETQ-LAV']);
    // La sugerencia NO se apaga porque la receta ya tenga renglones (decisión de la etapa).
    expect(s.sugeridos.map((a) => a.clave)).toEqual(['ETQ-MAR']);
  });

  it('un favorito SIN cantidad preestablecida no se sugiere, pero se DICE', async () => {
    const sinCant = await cliente.avio.create({
      data: { clave: 'AAA-SIN', descripcion: 'Favorito sin cantidad', favorito: true },
    });
    const ceroCant = await cliente.avio.create({
      data: { clave: 'AAB-CERO', descripcion: 'Favorito con 0', favorito: true, cantFav: 0 },
    });
    await sembrarCatalogo();
    const modelo = await crearModelo();

    const s = await sugerirAviosFavoritos(sesion(), modelo.id, bd());

    expect(s.sinCantidad.map((a) => a.idAvio).sort()).toEqual([sinCant.id, ceroCant.id].sort());
    expect(s.sugeridos.map((a) => a.clave)).toEqual(['ETQ-LAV', 'ETQ-MAR']);
  });

  it('sin favoritos marcados en el catálogo, no hay sugerencia (y eso es correcto)', async () => {
    await cliente.avio.create({
      data: { clave: 'BOT', descripcion: 'Botón', precioReferencia: 0.1 },
    });
    const modelo = await crearModelo();

    const s = await sugerirAviosFavoritos(sesion(), modelo.id, bd());

    expect(s).toEqual({ sugeridos: [], yaEnLaReceta: [], sinCantidad: [] });
  });

  it('un modelo inexistente es 404, no una lista vacía', async () => {
    await expect(sugerirAviosFavoritos(sesion(), 999_999, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });

  it('sin permiso `modelos.ver` no se puede consultar', async () => {
    const modelo = await crearModelo();
    const sinPermiso = sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: [] });
    await expect(sugerirAviosFavoritos(sinPermiso, modelo.id, bd())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });
});

describe('aceptarAviosFavoritos (UN acto los acepta todos)', () => {
  it('un solo acto agrega TODOS los favoritos, con `cantFav` como consumo', async () => {
    const { lavado, marca, normal } = await sembrarCatalogo();
    const modelo = await crearModelo();

    const r = await aceptarAviosFavoritos(sesion(), modelo.id, bd());

    expect(r.agregados).toBe(2);
    expect(r.clavesAgregadas).toEqual(['ETQ-LAV', 'ETQ-MAR']);
    // Un solo acto: la receta quedó con los dos, sin pasar por el PUT set-completo.
    const filas = await cliente.modeloAvio.findMany({
      where: { idModelo: modelo.id },
      orderBy: { idAvio: 'asc' },
    });
    expect(filas).toHaveLength(2);
    // 🔴 La cantidad guardada es la del catálogo, y son DISTINTAS entre sí.
    expect(filas.find((f) => f.idAvio === lavado.id)?.consumoPorPrenda.toNumber()).toBe(1);
    expect(filas.find((f) => f.idAvio === marca.id)?.consumoPorPrenda.toNumber()).toBe(2);
    expect(filas.map((f) => f.idAvio)).not.toContain(normal.id);
    // Las tres banderas 🔑 nacen en true, como en el alta a mano.
    expect(filas.every((f) => f.paraPreCosto && f.paraProduccion && f.paraCosto)).toBe(true);
    // Devuelve la receta resultante para que la pantalla se repinte con la verdad del servidor.
    expect(r.avios.map((a) => a.clave)).toEqual(['ETQ-LAV', 'ETQ-MAR']);
  });

  it('aceptar dos veces NO duplica: la segunda no agrega nada', async () => {
    await sembrarCatalogo();
    const modelo = await crearModelo();

    await aceptarAviosFavoritos(sesion(), modelo.id, bd());
    const segunda = await aceptarAviosFavoritos(sesion(), modelo.id, bd());

    expect(segunda.agregados).toBe(0);
    expect(segunda.clavesAgregadas).toEqual([]);
    expect(await cliente.modeloAvio.count({ where: { idModelo: modelo.id } })).toBe(2);
  });

  it('NO pisa el renglón de un favorito que ya estaba (ni su consumo ni sus banderas)', async () => {
    const { lavado } = await sembrarCatalogo();
    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'MOD-CON-AJUSTE',
        avios: {
          create: [{ idAvio: lavado.id, consumoPorPrenda: 7, paraCosto: false }],
        },
      },
    });

    const r = await aceptarAviosFavoritos(sesion(), modelo.id, bd());

    expect(r.agregados).toBe(1);
    expect(r.clavesAgregadas).toEqual(['ETQ-MAR']);
    const yaEstaba = await cliente.modeloAvio.findUniqueOrThrow({
      where: { idModelo_idAvio: { idModelo: modelo.id, idAvio: lavado.id } },
    });
    // El consumo ajustado a mano SIGUE en 7 (no lo regresó a `cantFav` = 1) y la bandera aguanta.
    expect(yaEstaba.consumoPorPrenda.toNumber()).toBe(7);
    expect(yaEstaba.paraCosto).toBe(false);
  });

  it('no toca los renglones de OTROS avíos ni borra nada (D3)', async () => {
    const { normal } = await sembrarCatalogo();
    const modelo = await cliente.modelo.create({
      data: {
        codigo: 'MOD-CON-NORMAL',
        avios: { create: [{ idAvio: normal.id, consumoPorPrenda: 4 }] },
      },
    });

    await aceptarAviosFavoritos(sesion(), modelo.id, bd());

    const filas = await cliente.modeloAvio.findMany({ where: { idModelo: modelo.id } });
    expect(filas).toHaveLength(3);
    expect(filas.find((f) => f.idAvio === normal.id)?.consumoPorPrenda.toNumber()).toBe(4);
  });

  it('deja huella en la bitácora (A7) y toca el modelo; si no agrega nada, no ensucia', async () => {
    await sembrarCatalogo();
    const modelo = await crearModelo();

    await aceptarAviosFavoritos(sesion(), modelo.id, bd());
    const conCambio = await cliente.bitacora.count({
      where: { entidad: 'Modelo', idEntidad: String(modelo.id) },
    });
    expect(conCambio).toBe(1);

    await aceptarAviosFavoritos(sesion(), modelo.id, bd());
    const sinCambio = await cliente.bitacora.count({
      where: { entidad: 'Modelo', idEntidad: String(modelo.id) },
    });
    expect(sinCambio).toBe(1);
  });

  it('sin permiso `modelos.administrar` no se puede aceptar (y nada se escribe)', async () => {
    await sembrarCatalogo();
    const modelo = await crearModelo();
    const soloVer = sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: ['modelos.ver'] });

    await expect(aceptarAviosFavoritos(soloVer, modelo.id, bd())).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
    expect(await cliente.modeloAvio.count({ where: { idModelo: modelo.id } })).toBe(0);
  });

  it('un modelo inexistente es 404', async () => {
    await sembrarCatalogo();
    await expect(aceptarAviosFavoritos(sesion(), 999_999, bd())).rejects.toBeInstanceOf(
      ErrorNoEncontrado,
    );
  });

  it('A9 — el precio del renglón aceptado sale de la EMPRESA ACTIVA, no de la de al lado', async () => {
    const { lavado } = await sembrarCatalogo();
    const otra = await crearEmpresaPrueba(cliente, 'Otra empresa');
    const prov = await cliente.proveedor.create({ data: { nombre: 'Insumos SA' } });
    // Una compra REAL de la etiqueta… pero en la OTRA empresa. Para esta sesión no existe.
    await cliente.ordenCompra.create({
      data: {
        numCompra: BigInt(1),
        idEmpresa: otra.id,
        idProveedor: prov.id,
        estatus: 'autorizada',
        fecha: new Date('2026-08-01T00:00:00.000Z'),
        lineas: { create: [{ idAvio: lavado.id, cantidad: 100, precio: 99 }] },
      },
    });
    const modelo = await crearModelo();

    const r = await aceptarAviosFavoritos(sesion(), modelo.id, bd());

    const renglon = r.avios.find((a) => a.idAvio === lavado.id);
    // 🔴 Si la lectura usara una empresa ajena, aquí saldría 99 / 'ultimo-precio-compra'.
    expect(renglon?.precioCosteo).toBe(0.5);
    expect(renglon?.origenPrecio).toBe('referencia');
  });

  it('A9 — con la compra en la empresa ACTIVA, ese precio SÍ manda (el control de la prueba de arriba)', async () => {
    const { lavado } = await sembrarCatalogo();
    const prov = await cliente.proveedor.create({ data: { nombre: 'Insumos SA' } });
    await cliente.ordenCompra.create({
      data: {
        numCompra: BigInt(1),
        idEmpresa: empresa.id,
        idProveedor: prov.id,
        estatus: 'autorizada',
        fecha: new Date('2026-08-01T00:00:00.000Z'),
        lineas: { create: [{ idAvio: lavado.id, cantidad: 100, precio: 99 }] },
      },
    });
    const modelo = await crearModelo();

    const r = await aceptarAviosFavoritos(sesion(), modelo.id, bd());

    const renglon = r.avios.find((a) => a.idAvio === lavado.id);
    expect(renglon?.precioCosteo).toBe(99);
    expect(renglon?.origenPrecio).toBe('ultimo-precio-compra');
  });
});
