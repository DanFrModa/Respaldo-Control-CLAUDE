/**
 * Integración de la separación DESARROLLO / PRODUCCIÓN de modelos (§Post-F9.34 + §Post-F9.46,
 * V1-E3n) contra Postgres real. Aquí vive lo que sólo la base puede demostrar:
 *
 *  (a) la propuesta del consecutivo es el **hueco libre más bajo** del par, no `max + 1` — que es
 *      lo único que sirve sobre 30 años de numeración hueca y ya topada (el par `51` del Access
 *      tiene 535 de 999 usados **y el 999 ocupado**);
 *  (b) el encadenamiento de series del GÉNERO (Caballero `x1` → `x5`) y el aviso de tope;
 *  (c) la promoción: el código cambia al de 5 dígitos, el de desarrollo **se conserva** y nada de
 *      lo que cuelga del modelo se mueve (D3);
 *  (d) el consecutivo de DESARROLLO por secuencia atómica (A3), que corre por **cliente+año** y
 *      reinicia cada año (§Post-F9.108 «✅ RESUELTO», V1-E7a: sustituye al criterio por par de
 *      §Post-F9.34/.46) y **arranca sobre el piso del catálogo** (V1-E7h: el defecto que reportó
 *      Daniel — 001/002/008 donde iban 008/009/010), incluyendo lo que sólo la base demuestra —
 *      que dos altas SIMULTÁNEAS de pares distintos no repiten número, que el `GREATEST` de la
 *      secuencia adelanta pero nunca retrocede, y que un código heredado del criterio viejo se
 *      salta solo, sin renumerar nada;
 *  (e) el filtro de origen y la búsqueda por los DOS números.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ClavePermiso } from '../../contrato/index.js';
import {
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorPermiso,
  ErrorValidacion,
} from '../../comun/errores.js';
import type { SesionUsuario } from '../../comun/permisos.js';
import { enTransaccion } from '../../comun/transaccion.js';
import type { Cliente, Empresa, Genero, PrismaClient, TipoProducto } from '../../datos/index.js';
import {
  clientePruebas,
  crearEmpresaPrueba,
  crearTipoArtePrueba,
  limpiarBaseDatos,
} from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { crearDesarrolloConModeloNuevo } from '../desarrollo/desarrollos.js';
import { crearModeloMigrado } from './migracion.js';
import { actualizarModelo, crearModelo, listarModelos, pasarModeloAProduccion } from './modelos.js';
import {
  consultarPropuestaProduccion,
  digitosDelModelo,
  leerSerie,
  mintearCodigoDesarrollo,
  proponerNumeroProduccion,
} from './nomenclatura.js';

// El listado construye el servicio de archivos (foto principal) aunque no haya fotos.
process.env.R2_ACCOUNT_ID ??= 'cuenta-fake';
process.env.R2_ACCESS_KEY_ID ??= 'llave-fake';
process.env.R2_SECRET_ACCESS_KEY ??= 'secreto-fake';
process.env.R2_BUCKET ??= 'control-v2-prueba';

let cliente: PrismaClient;
let empresa: Empresa;
let clienteCyA: Cliente;
let pantalon: TipoProducto;
let caballero: Genero;

const PERM: ClavePermiso[] = ['modelos.ver', 'modelos.administrar'];
const PERM_DESARROLLO: ClavePermiso[] = [
  'modelos.ver',
  'modelos.administrar',
  'desarrollo.ver',
  'desarrollo.administrar',
];

function sesion(permisos: ClavePermiso[] = PERM): SesionUsuario {
  return sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
}
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
  clienteCyA = await cliente.cliente.create({ data: { nombre: 'C&A', abreviatura: 'CYA' } });
  // Dígitos de la tabla de Daniel (los mismos que siembra el seed real).
  pantalon = await cliente.tipoProducto.create({
    data: { nombre: 'Pantalón', digitoConcepto: 7 },
  });
  caballero = await cliente.genero.create({
    data: { nombre: 'Caballero', digitoNomenclatura: 1, digitoAlterno: 5 },
  });
});

/** Siembra modelos de PRODUCCIÓN con los códigos dados (como los deja la migración del Access). */
async function sembrarProduccion(codigos: string[]): Promise<void> {
  await cliente.modelo.createMany({
    data: codigos.map((codigo) => ({
      codigo,
      origen: 'produccion' as const,
      numeroProduccion: /^\d{5}$/.test(codigo) ? Number(codigo) : null,
    })),
  });
}

/** Crea un modelo de DESARROLLO listo para promover (código armado a mano, como el minteo). */
async function crearModeloDesarrollo(
  codigo: string,
  idTipoProducto = pantalon.id,
  idGenero = caballero.id,
): Promise<number> {
  const modelo = await cliente.modelo.create({
    data: {
      codigo,
      codigoDesarrollo: codigo,
      origen: 'desarrollo',
      idTipoProducto,
      idGenero,
    },
    select: { id: true },
  });
  return modelo.id;
}

/**
 * Alta por el CATÁLOGO (el camino de `crearModelo`), con sus DOS DÍGITOS.
 *
 * ⭐ V1-E8j: desde §Post-F9.134 el alta EXIGE tipo de prenda y género — son los dígitos con los que
 * se le arma el nº de producción, y sin ellos el modelo no se podría promover. Se pasan de verdad
 * (Pantalón 7 + Caballero 1 → serie 71), no un valor cualquiera para callar al validador: varias de
 * estas pruebas promueven después el modelo y esperan `71xxx`.
 */
async function altaDeCatalogo(codigo: string) {
  return crearModelo(
    sesion(),
    { codigo, idTipoProducto: pantalon.id, idGenero: caballero.id },
    bd(),
  );
}

/** Corre algo del motor de nomenclatura dentro de una transacción (necesita `Tx`). */
async function enTx<T>(fn: (tx: Parameters<Parameters<typeof enTransaccion>[0]>[0]) => Promise<T>) {
  return enTransaccion(fn, bd());
}

// ── (a) La propuesta es el HUECO LIBRE MÁS BAJO, no max+1 ──────────────────────────

describe('proponerNumeroProduccion', () => {
  it('propone el hueco libre MÁS BAJO del par, no el que sigue al máximo', async () => {
    // Ocupación con hueco en 003 y el TOPE (999) tomado — el caso real del par 51 del Access.
    await sembrarProduccion(['71001', '71002', '71004', '71999']);

    const propuesta = await enTx((tx) =>
      proponerNumeroProduccion(tx, {
        concepto: 7,
        genero: 1,
        generoAlterno: 5,
        fuente: 'catalogo',
      }),
    );

    // 71003 es el hueco. Un generador por secuencia/`max+1` daría 72000 (fuera del par) y uno
    // que sólo mirara el conteo daría 71005: los dos rojos con este arreglo.
    expect(propuesta.numero).toBe(71_003);
    expect(propuesta.codigo).toBe('71003');
    expect(propuesta.serie.par).toBe('71');
    expect(propuesta.serie.usados).toBe(4);
    expect(propuesta.serie.libres).toBe(995);
    expect(propuesta.serieContinuada).toBe(false);
    expect(propuesta.avisos).toEqual([]);
  });

  it('cuenta como ocupado el código de un modelo aunque su columna numérica esté vacía', async () => {
    // Un modelo renombrado a mano a 5 dígitos SIN poblar `numero_produccion`: el número está
    // tomado igual, y proponerlo chocaría contra el unique de `codigo`.
    await cliente.modelo.create({
      data: { codigo: '71001', origen: 'produccion', numeroProduccion: null },
    });

    const propuesta = await enTx((tx) =>
      proponerNumeroProduccion(tx, {
        concepto: 7,
        genero: 1,
        generoAlterno: null,
        fuente: 'catalogo',
      }),
    );
    expect(propuesta.numero).toBe(71_002);
  });

  it('no confunde series: lo ocupado en 71 no estorba en 72 ni en 51', async () => {
    await sembrarProduccion(['71001', '71002', '71003']);

    const damaPantalon = await enTx((tx) =>
      proponerNumeroProduccion(tx, {
        concepto: 7,
        genero: 2,
        generoAlterno: null,
        fuente: 'catalogo',
      }),
    );
    expect(damaPantalon.numero).toBe(72_001);

    const playeraCaballero = await enTx((tx) =>
      proponerNumeroProduccion(tx, {
        concepto: 5,
        genero: 1,
        generoAlterno: 5,
        fuente: 'catalogo',
      }),
    );
    // §Post-F9.46: en el CONCEPTO no se encadena nada — 5 (playera) es su propia serie de 999.
    expect(playeraCaballero.numero).toBe(51_001);
  });

  it('ignora los códigos históricos que no son 5 dígitos (no ocupan consecutivo)', async () => {
    await sembrarProduccion(['71001a', '71002-1', 'M-18']);
    const propuesta = await enTx((tx) =>
      proponerNumeroProduccion(tx, {
        concepto: 7,
        genero: 1,
        generoAlterno: null,
        fuente: 'catalogo',
      }),
    );
    expect(propuesta.numero).toBe(71_001);
  });

  it('avisa cuando la serie se acerca al tope, diciendo cuántos quedan', async () => {
    // 960 usados → 39 libres, por debajo del umbral de 50.
    await sembrarProduccion(
      Array.from({ length: 960 }, (_, i) => `71${String(i + 1).padStart(3, '0')}`),
    );

    const propuesta = await enTx((tx) =>
      proponerNumeroProduccion(tx, {
        concepto: 7,
        genero: 1,
        generoAlterno: 5,
        fuente: 'catalogo',
      }),
    );
    expect(propuesta.numero).toBe(71_961);
    expect(propuesta.serie.libres).toBe(39);
    expect(propuesta.avisos).toHaveLength(1);
    // El aviso tiene que traer el NÚMERO de libres: "se acerca al tope" a secas no sirve.
    expect(propuesta.avisos[0]).toContain('39');
    expect(propuesta.avisos[0]).toContain('serie 71');
  });

  it('agotada la serie del género, CONTINÚA en la de ampliación (Caballero 1 → 5)', async () => {
    await sembrarProduccion(
      Array.from({ length: 999 }, (_, i) => `71${String(i + 1).padStart(3, '0')}`),
    );
    await sembrarProduccion(['75001']); // la serie de continuación ya tiene su primero

    const propuesta = await enTx((tx) =>
      proponerNumeroProduccion(tx, {
        concepto: 7,
        genero: 1,
        generoAlterno: 5,
        fuente: 'catalogo',
      }),
    );
    expect(propuesta.serieContinuada).toBe(true);
    expect(propuesta.serie.par).toBe('75');
    expect(propuesta.numero).toBe(75_002);
    expect(propuesta.avisos.some((a) => a.includes('se agotó') && a.includes('75'))).toBe(true);
  });

  it('sin serie de continuación, una serie llena NO propone número y lo dice', async () => {
    await sembrarProduccion(
      Array.from({ length: 999 }, (_, i) => `72${String(i + 1).padStart(3, '0')}`),
    );

    const propuesta = await enTx((tx) =>
      proponerNumeroProduccion(tx, {
        concepto: 7,
        genero: 2,
        generoAlterno: null,
        fuente: 'catalogo',
      }),
    );
    expect(propuesta.numero).toBeNull();
    expect(propuesta.codigo).toBeNull();
    expect(propuesta.avisos.some((a) => a.includes('LLENA'))).toBe(true);
  });
});

describe('leerSerie', () => {
  it('el consecutivo 000 no cuenta como usado (las series arrancan en 001)', async () => {
    await sembrarProduccion(['71000']);
    const serie = await enTx((tx) => leerSerie(tx, 7, 1));
    expect(serie.usados).toBe(0);
    expect(serie.libre).toBe(1);
  });
});

// ── (b) Los dígitos del modelo ─────────────────────────────────────────────────────

describe('digitosDelModelo', () => {
  it('manda el CATÁLOGO (tipo de prenda + género) sobre el código de desarrollo', async () => {
    // El código dice 52 (playera/dama) pero el catálogo dice pantalón/caballero: gana el catálogo.
    const id = await crearModeloDesarrollo('CYA-26-52-001', pantalon.id, caballero.id);
    const modelo = await cliente.modelo.findUniqueOrThrow({ where: { id } });
    const digitos = await enTx((tx) => digitosDelModelo(tx, modelo));
    expect(digitos).toEqual({ concepto: 7, genero: 1, generoAlterno: 5, fuente: 'catalogo' });
  });

  it('sin tipo/género en el modelo, cae al código de desarrollo', async () => {
    const modelo = await cliente.modelo.create({
      data: { codigo: 'CYA-26-52-001', codigoDesarrollo: 'CYA-26-52-001', origen: 'desarrollo' },
    });
    const digitos = await enTx((tx) => digitosDelModelo(tx, modelo));
    expect(digitos).toEqual({
      concepto: 5,
      genero: 2,
      generoAlterno: null,
      fuente: 'codigo-desarrollo',
    });
  });

  it('sin ninguna de las dos fuentes, dice QUÉ falta capturar', async () => {
    const modelo = await cliente.modelo.create({ data: { codigo: 'SUELTO-1' } });
    await expect(enTx((tx) => digitosDelModelo(tx, modelo))).rejects.toThrow(ErrorValidacion);
    await expect(enTx((tx) => digitosDelModelo(tx, modelo))).rejects.toThrow(
      /tipo de producto del modelo y el género del modelo/,
    );
  });

  it('con el género capturado pero SIN dígito en su catálogo, nombra ese género', async () => {
    const sinDigito = await cliente.genero.create({ data: { nombre: 'Unisex' } });
    const modelo = await cliente.modelo.create({
      data: { codigo: 'SUELTO-2', idTipoProducto: pantalon.id, idGenero: sinDigito.id },
    });
    await expect(enTx((tx) => digitosDelModelo(tx, modelo))).rejects.toThrow(/"Unisex"/);
  });
});

// ── (c) Pasar a producción ─────────────────────────────────────────────────────────

describe('pasarModeloAProduccion', () => {
  it('asigna el número propuesto, cambia el código y CONSERVA el de desarrollo', async () => {
    await sembrarProduccion(['71001', '71002']);
    const id = await crearModeloDesarrollo('CYA-26-71-004');

    const promovido = await pasarModeloAProduccion(sesion(), id, {}, bd());

    expect(promovido.numeroProduccion).toBe(71_003);
    expect(promovido.numeroCapturado).toBe(false);
    const modelo = await cliente.modelo.findUniqueOrThrow({ where: { id } });
    expect(modelo.codigo).toBe('71003');
    expect(modelo.numeroProduccion).toBe(71_003);
    expect(modelo.origen).toBe('produccion');
    // Lo que Daniel pidió expresamente: el nº de desarrollo NO se borra (D3).
    expect(modelo.codigoDesarrollo).toBe('CYA-26-71-004');
  });

  it('respeta el número CAPTURADO aunque no sea el propuesto', async () => {
    const id = await crearModeloDesarrollo('CYA-26-71-001');
    const promovido = await pasarModeloAProduccion(
      sesion(),
      id,
      { numeroProduccion: 71_777 },
      bd(),
    );
    expect(promovido.numeroProduccion).toBe(71_777);
    expect(promovido.numeroCapturado).toBe(true);
    const modelo = await cliente.modelo.findUniqueOrThrow({ where: { id } });
    expect(modelo.codigo).toBe('71777');
  });

  it('con dígitos que no cuadran AVISA pero NO bloquea (la excepción es de Daniel)', async () => {
    const id = await crearModeloDesarrollo('CYA-26-71-001', pantalon.id, caballero.id);
    // 52xxx = playera/dama, contra el pantalón/caballero del modelo.
    const promovido = await pasarModeloAProduccion(
      sesion(),
      id,
      { numeroProduccion: 52_010 },
      bd(),
    );
    expect(promovido.numeroProduccion).toBe(52_010);
    expect(promovido.avisos).toHaveLength(1);
    expect(promovido.avisos[0]).toContain('(52)');
    expect(promovido.avisos[0]).toContain('(71)');
    // Y de verdad se guardó: el aviso no revirtió nada.
    const modelo = await cliente.modelo.findUniqueOrThrow({ where: { id } });
    expect(modelo.codigo).toBe('52010');
  });

  it('BLOQUEA el número repetido, diciendo de quién es', async () => {
    await sembrarProduccion(['71005']);
    const id = await crearModeloDesarrollo('CYA-26-71-001');
    await expect(
      pasarModeloAProduccion(sesion(), id, { numeroProduccion: 71_005 }, bd()),
    ).rejects.toThrow(ErrorConflicto);
    // Y el modelo NO se movió.
    const modelo = await cliente.modelo.findUniqueOrThrow({ where: { id } });
    expect(modelo.origen).toBe('desarrollo');
    expect(modelo.codigo).toBe('CYA-26-71-001');
  });

  it('sin `modelos.administrar` no se puede promover (§Post-F9.68: esconder Y bloquear)', async () => {
    const id = await crearModeloDesarrollo('CYA-26-71-001');
    const soloVer = sesionDePrueba({ idEmpresaActiva: empresa.id, permisos: ['modelos.ver'] });
    await expect(pasarModeloAProduccion(soloVer, id, {}, bd())).rejects.toThrow(ErrorPermiso);
    const modelo = await cliente.modelo.findUniqueOrThrow({ where: { id } });
    expect(modelo.origen).toBe('desarrollo');
  });

  it('un modelo que ya está en producción no se promueve dos veces', async () => {
    await sembrarProduccion(['71005']);
    const modelo = await cliente.modelo.findFirstOrThrow({ where: { codigo: '71005' } });
    await expect(pasarModeloAProduccion(sesion(), modelo.id, {}, bd())).rejects.toThrow(
      ErrorConflicto,
    );
  });

  it('rechaza un número que no tiene 5 dígitos', async () => {
    const id = await crearModeloDesarrollo('CYA-26-71-001');
    await expect(
      pasarModeloAProduccion(sesion(), id, { numeroProduccion: 7100 }, bd()),
    ).rejects.toThrow();
    await expect(
      pasarModeloAProduccion(sesion(), id, { numeroProduccion: 710_001 }, bd()),
    ).rejects.toThrow();
  });

  it('NO REGRESIÓN: la receta, el arte, las fotos y las órdenes del modelo sobreviven', async () => {
    const id = await crearModeloDesarrollo('CYA-26-71-001');

    // Receta (telas + avíos).
    const tela = await cliente.tela.create({ data: { nombre: 'Felpa' } });
    await cliente.modeloTela.create({
      data: { idModelo: id, idTela: tela.id, consumoPorPrenda: 1.5 },
    });
    const avio = await cliente.avio.create({
      data: { clave: 'RES-1', descripcion: 'Resorte', unidad: 'm' },
    });
    await cliente.modeloAvio.create({
      data: { idModelo: id, idAvio: avio.id, consumoPorPrenda: 2 },
    });

    // Arte (hijo del modelo desde V1-E3d) con su precio, que es el que viaja a la OP.
    const tipoArte = await crearTipoArtePrueba(cliente);
    await cliente.modeloArte.create({
      data: { idModelo: id, descripcion: 'Logo frente', idTipoArte: tipoArte, precio: 12.5 },
    });

    // Foto en R2.
    const archivo = await cliente.archivo.create({
      data: {
        bucket: 'control-v2-prueba',
        key: 'modelos/prueba-v1e3n.jpg',
        nombreOriginal: 'frente.jpg',
        tipoMime: 'image/jpeg',
        tamanoBytes: 1024,
      },
    });
    await cliente.modeloFoto.create({ data: { idModelo: id, idArchivo: archivo.id } });

    // Una ORDEN ya creada con el modelo cuando todavía era de desarrollo.
    const orden = await cliente.orden.create({
      data: {
        folio: 5558n,
        idEmpresa: empresa.id,
        idModelo: id,
        idCliente: clienteCyA.id,
        fecha: new Date('2026-08-20T00:00:00.000Z'),
      },
      select: { id: true },
    });

    await pasarModeloAProduccion(sesion(), id, { numeroProduccion: 71_009 }, bd());

    // Todo cuelga del `id` del modelo, que NO cambia: la promoción no puede tocarlo.
    const conTodo = await cliente.modelo.findUniqueOrThrow({
      where: { id },
      include: { telas: true, avios: true, artes: true, fotos: true, ordenes: true },
    });
    expect(conTodo.telas).toHaveLength(1);
    expect(conTodo.telas[0]?.idTela).toBe(tela.id);
    expect(conTodo.telas[0]?.consumoPorPrenda.toString()).toBe('1.5');
    expect(conTodo.avios).toHaveLength(1);
    expect(conTodo.avios[0]?.idAvio).toBe(avio.id);
    expect(conTodo.artes).toHaveLength(1);
    expect(conTodo.artes[0]?.descripcion).toBe('Logo frente');
    // El precio del arte es INVARIANTE (§Post-F9.35): viaja a la OP y la promoción no lo mueve.
    expect(conTodo.artes[0]?.precio?.toString()).toBe('12.5');
    expect(conTodo.fotos).toHaveLength(1);
    expect(conTodo.fotos[0]?.idArchivo).toBe(archivo.id);
    // La orden sigue apuntando al MISMO modelo (la FK es por id, no por código).
    expect(conTodo.ordenes.map((o) => o.id)).toEqual([orden.id]);
  });

  /**
   * La orden NO guarda copia del código: lo lee del modelo (`orden.modelo.codigo`). Al promover,
   * las órdenes ya existentes pasan a enseñar el número de producción — que es correcto (es el
   * mismo modelo) pero conviene tenerlo fijado, porque es un cambio VISIBLE en documentos viejos.
   */
  it('las órdenes existentes enseñan el nuevo código (no hay copia congelada del código)', async () => {
    const id = await crearModeloDesarrollo('CYA-26-71-001');
    await cliente.orden.create({
      data: {
        folio: 5558n,
        idEmpresa: empresa.id,
        idModelo: id,
        idCliente: clienteCyA.id,
        fecha: new Date('2026-08-20T00:00:00.000Z'),
      },
    });

    await pasarModeloAProduccion(sesion(), id, { numeroProduccion: 71_009 }, bd());

    const orden = await cliente.orden.findFirstOrThrow({
      where: { folio: 5558n },
      include: { modelo: { select: { codigo: true, codigoDesarrollo: true } } },
    });
    expect(orden.modelo.codigo).toBe('71009');
    expect(orden.modelo.codigoDesarrollo).toBe('CYA-26-71-001');
  });

  it('deja la promoción en la bitácora con el código de antes y el de después', async () => {
    const id = await crearModeloDesarrollo('CYA-26-71-001');
    await pasarModeloAProduccion(sesion(), id, { numeroProduccion: 71_009 }, bd());

    const bitacora = await cliente.bitacora.findFirst({
      where: { entidad: 'Modelo', idEntidad: String(id) },
      orderBy: { id: 'desc' },
    });
    expect(bitacora).not.toBeNull();
    const datos = bitacora?.datos as Record<string, unknown>;
    expect(datos.operacion).toBe('pasar-a-produccion');
    expect(datos.codigo).toEqual({ de: 'CYA-26-71-001', a: '71009' });
    expect(datos.numeroProduccion).toBe(71_009);
  });
});

describe('consultarPropuestaProduccion', () => {
  it('devuelve la propuesta sin escribir nada', async () => {
    await sembrarProduccion(['71001']);
    const id = await crearModeloDesarrollo('CYA-26-71-001');

    const propuesta = await consultarPropuestaProduccion(sesion(), id, bd());
    expect(propuesta.numero).toBe(71_002);
    expect(propuesta.yaEnProduccion).toBe(false);

    // Consultarla NO promueve ni reserva: el modelo sigue igual y la segunda consulta da lo mismo.
    const modelo = await cliente.modelo.findUniqueOrThrow({ where: { id } });
    expect(modelo.origen).toBe('desarrollo');
    const otraVez = await consultarPropuestaProduccion(sesion(), id, bd());
    expect(otraVez.numero).toBe(71_002);
  });
});

// ── (d) El consecutivo de DESARROLLO ───────────────────────────────────────────────

describe('mintearCodigoDesarrollo', () => {
  it('arranca en 001 y avanza de uno en uno dentro del mismo cliente+año', async () => {
    const primero = await enTx((tx) =>
      mintearCodigoDesarrollo(tx, {
        idCliente: clienteCyA.id,
        anioEntrega: 2026,
        concepto: 7,
        genero: 1,
      }),
    );
    const segundo = await enTx((tx) =>
      mintearCodigoDesarrollo(tx, {
        idCliente: clienteCyA.id,
        anioEntrega: 2026,
        concepto: 7,
        genero: 1,
      }),
    );
    expect(primero.codigo).toBe('CYA-26-71-001');
    expect(segundo.codigo).toBe('CYA-26-71-002');
  });

  it('reinicia al cambiar el AÑO o el CLIENTE — pero NO al cambiar el par', async () => {
    await enTx((tx) =>
      mintearCodigoDesarrollo(tx, {
        idCliente: clienteCyA.id,
        anioEntrega: 2026,
        concepto: 7,
        genero: 1,
      }),
    );

    const otroAnio = await enTx((tx) =>
      mintearCodigoDesarrollo(tx, {
        idCliente: clienteCyA.id,
        anioEntrega: 2027,
        concepto: 7,
        genero: 1,
      }),
    );
    expect(otroAnio.codigo).toBe('CYA-27-71-001');

    // ⭐ Daniel, 25-ago-2026: *"Me gusta solo por cliente por año. O sea 71-001 y el siguiente
    // 72-002"*. El jogger de DAMA CONTINÚA la serie del cliente+año: hereda el 002 del de
    // caballero en vez de arrancar en 001 (§Post-F9.108 «✅ RESUELTO»; antes, con el contador por
    // par de §Post-F9.34/.46, aquí se esperaba `CYA-26-72-001`).
    const otroGenero = await enTx((tx) =>
      mintearCodigoDesarrollo(tx, {
        idCliente: clienteCyA.id,
        anioEntrega: 2026,
        concepto: 7,
        genero: 2,
      }),
    );
    expect(otroGenero.codigo).toBe('CYA-26-72-002');

    const otroCliente = await cliente.cliente.create({
      data: { nombre: 'Liverpool', abreviatura: 'LIV' },
    });
    const deOtroCliente = await enTx((tx) =>
      mintearCodigoDesarrollo(tx, {
        idCliente: otroCliente.id,
        anioEntrega: 2026,
        concepto: 7,
        genero: 1,
      }),
    );
    expect(deOtroCliente.codigo).toBe('LIV-26-71-001');
  });

  it('sin abreviatura del cliente NO inventa nada: dice que hay que capturarla', async () => {
    const sinAbrev = await cliente.cliente.create({ data: { nombre: 'Sin Abreviatura' } });
    await expect(
      enTx((tx) =>
        mintearCodigoDesarrollo(tx, {
          idCliente: sinAbrev.id,
          anioEntrega: 2026,
          concepto: 7,
          genero: 1,
        }),
      ),
    ).rejects.toThrow(/ABREVIATURA/);
  });

  it('el contador sigue el ID del cliente, no su abreviatura: renombrarla no lo reinicia', async () => {
    await enTx((tx) =>
      mintearCodigoDesarrollo(tx, {
        idCliente: clienteCyA.id,
        anioEntrega: 2026,
        concepto: 7,
        genero: 1,
      }),
    );
    await cliente.cliente.update({ where: { id: clienteCyA.id }, data: { abreviatura: 'CYA2' } });
    const siguiente = await enTx((tx) =>
      mintearCodigoDesarrollo(tx, {
        idCliente: clienteCyA.id,
        anioEntrega: 2026,
        concepto: 7,
        genero: 1,
      }),
    );
    // Cambia el prefijo (el código nuevo lleva la abreviatura nueva) pero el consecutivo AVANZA.
    expect(siguiente.codigo).toBe('CYA2-26-71-002');
  });

  /**
   * ⭐⭐ **EL DEFECTO QUE REPORTÓ DANIEL** (25-ago-2026), contra la base de verdad: un cliente+año
   * cuyos modelos ya llegaban al `007`; mete dos sudaderas y un jogger. Antes de V1-E7h salían
   * **001, 002 y 008** —el contador nacía en 1 y el centinela sólo choca dentro del MISMO par, así
   * que las sudaderas se llevaban números viejos sin enterarse—; ahora la serie arranca sobre el
   * piso del catálogo y salen **008, 009 y 010**, de corrido y sin importar la prenda.
   *
   * Aquí se ejercita lo que la prueba unitaria NO puede: el `startsWith … mode: 'insensitive'` de
   * verdad contra Postgres, y el `GREATEST(valor, piso) + 1` de verdad de la secuencia global.
   */
  it('⭐ el caso de Daniel: con el catálogo en 007, dos sudaderas y un jogger dan 008, 009 y 010', async () => {
    for (let i = 1; i <= 7; i += 1) {
      await crearModeloDesarrollo(`CYA-26-72-${String(i).padStart(3, '0')}`);
    }

    const codigos: string[] = [];
    for (const genero of [1, 1, 2]) {
      const minteado = await enTx((tx) =>
        mintearCodigoDesarrollo(tx, {
          idCliente: clienteCyA.id,
          anioEntrega: 2026,
          concepto: 7,
          genero,
        }),
      );
      codigos.push(minteado.codigo);
    }

    expect(codigos).toEqual(['CYA-26-71-008', 'CYA-26-71-009', 'CYA-26-72-010']);
  });

  /**
   * ⭐ El estado REAL en que quedó `prueba` al reportarse el defecto: el contador de ese cliente+año
   * ya había avanzado (3 altas) mientras el catálogo iba en 007. La regla es **la secuencia nunca
   * retrocede, pero sí adelanta**: el piso se recalcula en cada alta, así que ese cliente se corrige
   * SOLO en su siguiente modelo — sin script de reparación ni SQL a mano.
   */
  it('un cliente+año cuyo contador ya avanzó con el criterio viejo se corrige solo en el siguiente alta', async () => {
    for (let i = 1; i <= 7; i += 1) {
      await crearModeloDesarrollo(`CYA-26-72-${String(i).padStart(3, '0')}`);
    }
    // Los tres códigos que ya se entregaron mal (001, 002 del par 71 y el 008 del par 72): el
    // contador quedó en 3 y los modelos existen. No se renumeran — el arreglo es PROSPECTIVO.
    await crearModeloDesarrollo('CYA-26-71-001');
    await crearModeloDesarrollo('CYA-26-71-002');
    await crearModeloDesarrollo('CYA-26-72-008');
    await cliente.secuenciaGlobal.create({
      data: { clave: `modelo-desarrollo-${String(clienteCyA.id)}-2026`, valor: 3n },
    });

    const siguiente = await enTx((tx) =>
      mintearCodigoDesarrollo(tx, {
        idCliente: clienteCyA.id,
        anioEntrega: 2026,
        concepto: 7,
        genero: 1,
      }),
    );
    // Ni el 004 (seguir el contador a media asta) ni el 001: el 009, que es donde va el catálogo.
    expect(siguiente.codigo).toBe('CYA-26-71-009');
    expect(await cliente.modelo.count({ where: { codigo: 'CYA-26-71-001' } })).toBe(1);
  });

  /**
   * La otra mitad de la regla, y la que protege A3 contra la base: si el contador va POR DELANTE del
   * catálogo (números entregados a altas que no comitearon, modelos descontinuados) el piso NO lo
   * baja. Un `GREATEST` cambiado por un `SET valor = piso + 1` re-repartiría números ya dados.
   */
  it('la secuencia NUNCA retrocede: si el contador va por delante del catálogo, manda el contador', async () => {
    await crearModeloDesarrollo('CYA-26-71-002');
    await cliente.secuenciaGlobal.create({
      data: { clave: `modelo-desarrollo-${String(clienteCyA.id)}-2026`, valor: 20n },
    });

    const siguiente = await enTx((tx) =>
      mintearCodigoDesarrollo(tx, {
        idCliente: clienteCyA.id,
        anioEntrega: 2026,
        concepto: 7,
        genero: 1,
      }),
    );
    expect(siguiente.codigo).toBe('CYA-26-71-021');
  });

  /**
   * El sufijo de VERSIÓN (V1-E7b) no quema consecutivo: cuenta el de su raíz. Leer "los últimos
   * dígitos" del texto daría `2` y hundiría el piso de toda la serie.
   */
  it('una VERSIÓN no infla ni hunde el piso: cuenta el consecutivo de su raíz', async () => {
    await crearModeloDesarrollo('CYA-26-71-045');
    await crearModeloDesarrollo('CYA-26-71-045-02');

    const siguiente = await enTx((tx) =>
      mintearCodigoDesarrollo(tx, {
        idCliente: clienteCyA.id,
        anioEntrega: 2026,
        concepto: 7,
        genero: 1,
      }),
    );
    expect(siguiente.codigo).toBe('CYA-26-71-046');
  });

  /**
   * El catálogo tiene códigos capturados a mano y migrados del Access que NO siguen el patrón.
   * Ninguno puede tumbar un alta ni disparar el piso: se ignoran. El `…-99999999999` es el caso
   * feo — si contara, este cliente+año se quedaría sin poder dar de alta nada.
   */
  it('los códigos fuera del patrón no mueven el piso ni revientan el alta', async () => {
    await crearModeloDesarrollo('CYA-26-71-003');
    await crearModeloDesarrollo('CYA-26-M18');
    await crearModeloDesarrollo('CYA-26-71-99999999999');

    const siguiente = await enTx((tx) =>
      mintearCodigoDesarrollo(tx, {
        idCliente: clienteCyA.id,
        anioEntrega: 2026,
        concepto: 7,
        genero: 1,
      }),
    );
    expect(siguiente.codigo).toBe('CYA-26-71-004');
  });

  /** El piso cuenta los códigos guardados con OTRA caja (en la base conviven `CYA-` y `cya-`). */
  it('el piso cuenta un código guardado en minúsculas', async () => {
    await crearModeloDesarrollo('cya-26-72-007');

    const siguiente = await enTx((tx) =>
      mintearCodigoDesarrollo(tx, {
        idCliente: clienteCyA.id,
        anioEntrega: 2026,
        concepto: 7,
        genero: 1,
      }),
    );
    expect(siguiente.codigo).toBe('CYA-26-71-008');
  });

  /**
   * ⭐ Lo que hace SEGURO el cambio de criterio sin migración ni renumeración: un cliente+año que YA
   * tiene modelos del criterio viejo. Con el piso, la serie arranca DESPUÉS del mayor consecutivo
   * que ya existe; el centinela del bucle queda de última red, y aquí se ve contra la base de
   * verdad, con el `@unique` de por medio.
   */
  it('se salta los códigos que dejó el criterio VIEJO en ese cliente+año', async () => {
    // Como quedó el catálogo con el criterio por par: 71-001/002 de caballero y 72-001 de dama.
    await crearModeloDesarrollo('CYA-26-71-001');
    await crearModeloDesarrollo('CYA-26-71-002');
    await crearModeloDesarrollo('CYA-26-72-001');

    // El mayor consecutivo del cliente+año es el 2, así que la serie arranca en el 3.
    const primero = await enTx((tx) =>
      mintearCodigoDesarrollo(tx, {
        idCliente: clienteCyA.id,
        anioEntrega: 2026,
        concepto: 7,
        genero: 1,
      }),
    );
    expect(primero.codigo).toBe('CYA-26-71-003');

    // Y el 72-001 viejo se queda como está: nada se renumera (es PROSPECTIVO).
    const dama = await enTx((tx) =>
      mintearCodigoDesarrollo(tx, {
        idCliente: clienteCyA.id,
        anioEntrega: 2026,
        concepto: 7,
        genero: 2,
      }),
    );
    expect(dama.codigo).toBe('CYA-26-72-004');
    expect(await cliente.modelo.count({ where: { codigo: 'CYA-26-72-001' } })).toBe(1);
  });

  /**
   * ⭐ El caso MÁS probable de los códigos viejos, y la rama del centinela que nadie sostenía: un
   * modelo del criterio anterior **ya promovido a producción**. Su `codigo` es el de 5 dígitos y el
   * `CYA-26-71-001` sobrevive SÓLO en `codigoDesarrollo` (D3: el nº de desarrollo se conserva). Si
   * el minteo no mirara esa columna entregaría un duplicado, el `@unique` lo reventaría con P2002 y
   * **se abortaría la transacción entera del alta** — lo contrario de "se absorbe solo".
   */
  it('se salta el código de un modelo YA PROMOVIDO, que sólo vive en `codigoDesarrollo`', async () => {
    await cliente.modelo.create({
      data: {
        codigo: '71001',
        numeroProduccion: 71_001,
        codigoDesarrollo: 'CYA-26-71-001',
        origen: 'produccion',
      },
    });

    const minteado = await enTx((tx) =>
      mintearCodigoDesarrollo(tx, {
        idCliente: clienteCyA.id,
        anioEntrega: 2026,
        concepto: 7,
        genero: 1,
      }),
    );
    expect(minteado.codigo).toBe('CYA-26-71-002');

    // Y el promovido no se tocó: sigue con sus DOS números (D3).
    const promovido = await cliente.modelo.findUniqueOrThrow({ where: { codigo: '71001' } });
    expect(promovido.codigoDesarrollo).toBe('CYA-26-71-001');
  });

  /**
   * A3 con la clave nueva: ahora los pares COMPARTEN la fila de la secuencia, así que dos altas de
   * prendas distintas del mismo cliente+año compiten por el MISMO contador — cosa que con el
   * criterio por par no pasaba nunca. Sólo Postgres puede demostrar que no se repiten.
   */
  it('altas SIMULTÁNEAS de pares distintos sacan consecutivos distintos y sin huecos', async () => {
    const pares = [
      { concepto: 7, genero: 1 },
      { concepto: 7, genero: 2 },
      { concepto: 8, genero: 1 },
      { concepto: 9, genero: 1 },
      { concepto: 2, genero: 0 },
    ];

    const resultados = await Promise.all(
      pares.map((par) =>
        enTx((tx) =>
          mintearCodigoDesarrollo(tx, {
            idCliente: clienteCyA.id,
            anioEntrega: 2026,
            ...par,
          }),
        ),
      ),
    );

    // Los 5 primeros consecutivos, uno por alta: ni repetidos (los colapsaría el `Set`) ni huecos.
    const consecutivos = resultados.map((r) => r.consecutivo).sort((a, b) => a - b);
    expect(consecutivos).toEqual([1, 2, 3, 4, 5]);

    // Y cada código conserva SU par: el consecutivo es compartido, los dos dígitos no.
    const prefijos = resultados.map((r) => r.codigo.slice(0, 9)).sort();
    expect(prefijos).toEqual(['CYA-26-20', 'CYA-26-71', 'CYA-26-72', 'CYA-26-81', 'CYA-26-91']);
  });
});

// ── El alta de desarrollo con modelo nuevo ─────────────────────────────────────────

describe('crearDesarrolloConModeloNuevo', () => {
  async function proyectoDePrueba(): Promise<number> {
    const departamento = await cliente.clienteDepartamento.create({
      data: { idCliente: clienteCyA.id, nombre: 'NIÑOS' },
    });
    const proyecto = await cliente.proyecto.create({
      data: {
        folio: 1n,
        idEmpresa: empresa.id,
        idCliente: clienteCyA.id,
        idClienteDepartamento: departamento.id,
        nombre: 'Joggers PV26',
      },
    });
    return proyecto.id;
  }

  it('crea el modelo con su código ARMADO y marcado como de desarrollo', async () => {
    const idProyecto = await proyectoDePrueba();

    const desarrollo = await crearDesarrolloConModeloNuevo(
      sesion(PERM_DESARROLLO),
      idProyecto,
      {
        anioEntrega: 2026,
        idTipoProducto: pantalon.id,
        idGenero: caballero.id,
        descripcion: 'Jogger felpa',
      },
      bd(),
    );

    expect(desarrollo.codigoModelo).toBe('CYA-26-71-001');
    const modelo = await cliente.modelo.findUniqueOrThrow({
      where: { id: desarrollo.idModelo },
    });
    expect(modelo.origen).toBe('desarrollo');
    expect(modelo.codigoDesarrollo).toBe('CYA-26-71-001');
    // Un modelo de desarrollo NO consume número de la serie de producción (§Post-F9.34 punto 3).
    expect(modelo.numeroProduccion).toBeNull();
    expect(modelo.idTipoProducto).toBe(pantalon.id);
    expect(modelo.idGenero).toBe(caballero.id);
  });

  it('si el desarrollo falla, el modelo TAMPOCO queda (una sola transacción)', async () => {
    const idProyecto = await proyectoDePrueba();
    await crearDesarrolloConModeloNuevo(
      sesion(PERM_DESARROLLO),
      idProyecto,
      { anioEntrega: 2026, idTipoProducto: pantalon.id, idGenero: caballero.id },
      bd(),
    );
    const antes = await cliente.modelo.count();

    // Se archiva el proyecto: el alta debe abortar ANTES de crear nada.
    await cliente.proyecto.update({ where: { id: idProyecto }, data: { archivado: true } });
    await expect(
      crearDesarrolloConModeloNuevo(
        sesion(PERM_DESARROLLO),
        idProyecto,
        { anioEntrega: 2026, idTipoProducto: pantalon.id, idGenero: caballero.id },
        bd(),
      ),
    ).rejects.toThrow(ErrorConflicto);
    expect(await cliente.modelo.count()).toBe(antes);
  });

  /** A9: un proyecto de OTRA empresa, para esta sesión, no existe. */
  it('un proyecto de otra empresa da NO ENCONTRADO y no crea nada', async () => {
    const idProyecto = await proyectoDePrueba();
    const otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra Empresa');
    const ajena = sesionDePrueba({
      idEmpresaActiva: otraEmpresa.id,
      permisos: [...PERM_DESARROLLO],
    });

    await expect(
      crearDesarrolloConModeloNuevo(
        ajena,
        idProyecto,
        { anioEntrega: 2026, idTipoProducto: pantalon.id, idGenero: caballero.id },
        bd(),
      ),
    ).rejects.toThrow(ErrorNoEncontrado);
    expect(await cliente.modelo.count()).toBe(0);
  });

  /** §Post-F9.68 — esconder Y bloquear: crea un MODELO, así que exige también `modelos.administrar`. */
  it('sin `modelos.administrar` no se puede, aunque se tenga `desarrollo.administrar`', async () => {
    const idProyecto = await proyectoDePrueba();
    const soloDesarrollo = sesionDePrueba({
      idEmpresaActiva: empresa.id,
      permisos: ['desarrollo.ver', 'desarrollo.administrar'],
    });

    await expect(
      crearDesarrolloConModeloNuevo(
        soloDesarrollo,
        idProyecto,
        { anioEntrega: 2026, idTipoProducto: pantalon.id, idGenero: caballero.id },
        bd(),
      ),
    ).rejects.toThrow(ErrorPermiso);
    expect(await cliente.modelo.count()).toBe(0);
  });

  /**
   * ⭐ El camino que la etapa dejaba roto en la primera vuelta: **Chamarra (concepto 8) y Gorra (9)
   * no existían como tipo de producto** —356 y 73 modelos en el Access, el 9 % del catálogo—, así
   * que no había nada que elegir para desarrollarlas. Los siembra la migración y el seed; esta
   * prueba fija que el código sale con el par correcto de punta a punta.
   */
  it('desarrolla una CHAMARRA (concepto 8) y una GORRA (9): el código sale con su par', async () => {
    const idProyecto = await proyectoDePrueba();
    const chamarra = await cliente.tipoProducto.create({
      data: { nombre: 'Chamarra', digitoConcepto: 8 },
    });
    const gorra = await cliente.tipoProducto.create({
      data: { nombre: 'Gorra', digitoConcepto: 9 },
    });

    const laChamarra = await crearDesarrolloConModeloNuevo(
      sesion(PERM_DESARROLLO),
      idProyecto,
      { anioEntrega: 2026, idTipoProducto: chamarra.id, idGenero: caballero.id },
      bd(),
    );
    expect(laChamarra.codigoModelo).toBe('CYA-26-81-001');

    const laGorra = await crearDesarrolloConModeloNuevo(
      sesion(PERM_DESARROLLO),
      idProyecto,
      { anioEntrega: 2026, idTipoProducto: gorra.id, idGenero: caballero.id },
      bd(),
    );
    // Una sola serie por cliente+año: la gorra SÍ hereda el 002 de la chamarra (§Post-F9.108
    // «✅ RESUELTO»; con el criterio por par esto daba `CYA-26-91-001`). Lo que cada par conserva
    // es su significado en el CÓDIGO —91 = gorra de caballero—, no una numeración propia.
    expect(laGorra.codigoModelo).toBe('CYA-26-91-002');

    // Y al pasarlas a producción heredan su par: 81xxx y 91xxx.
    const promovida = await pasarModeloAProduccion(sesion(), laChamarra.idModelo, {}, bd());
    expect(promovida.numeroProduccion).toBe(81_001);
  });

  it('sin dígito en el tipo de prenda, no crea nada y dice cuál falta', async () => {
    const idProyecto = await proyectoDePrueba();
    const ropaInterior = await cliente.tipoProducto.create({ data: { nombre: 'Ropa interior' } });
    await expect(
      crearDesarrolloConModeloNuevo(
        sesion(PERM_DESARROLLO),
        idProyecto,
        { anioEntrega: 2026, idTipoProducto: ropaInterior.id, idGenero: caballero.id },
        bd(),
      ),
    ).rejects.toThrow(/"Ropa interior"/);
    expect(await cliente.modelo.count()).toBe(0);
  });
});

// ── (e) Catálogo: filtro de origen y búsqueda por los DOS números ──────────────────

describe('listarModelos con la separación de catálogos', () => {
  beforeEach(async () => {
    await sembrarProduccion(['71001', '71002']);
    await crearModeloDesarrollo('CYA-26-71-003');
  });

  /**
   * ⭐ V1-E8j (§Post-F9.134) — el default del filtro pasó de `produccion` a `todos`. Junto con que
   * todo modelo nace en desarrollo, el default viejo escondía por omisión justo lo recién creado
   * (*"generé dos modelos en precosteo… y no los veo en modelos"*). Ésta es la puerta del DOMINIO:
   * la que se aplica cuando se llama a `listarModelos` sin filtro (el ETL, otro servicio, un test).
   */
  it('por default los enseña TODOS, con el de desarrollo incluido', async () => {
    const pagina = await listarModelos(sesion(), {}, bd());
    expect(pagina.datos.map((m) => m.codigo).sort()).toEqual(['71001', '71002', 'CYA-26-71-003']);
  });

  it('los filtros `produccion` y `desarrollo` siguen acotando a una sola cara', async () => {
    const soloProduccion = await listarModelos(sesion(), { origen: 'produccion' }, bd());
    expect(soloProduccion.datos.map((m) => m.codigo).sort()).toEqual(['71001', '71002']);

    const soloDesarrollo = await listarModelos(sesion(), { origen: 'desarrollo' }, bd());
    expect(soloDesarrollo.datos.map((m) => m.codigo)).toEqual(['CYA-26-71-003']);

    const todos = await listarModelos(sesion(), { origen: 'todos' }, bd());
    expect(todos.total).toBe(3);
  });

  it('un modelo promovido se encuentra por su nº de desarrollo Y por el de producción', async () => {
    const modelo = await cliente.modelo.findFirstOrThrow({ where: { codigo: 'CYA-26-71-003' } });
    await pasarModeloAProduccion(sesion(), modelo.id, { numeroProduccion: 71_050 }, bd());

    const porDesarrollo = await listarModelos(sesion(), { busqueda: 'CYA-26-71-003' }, bd());
    expect(porDesarrollo.datos.map((m) => m.id)).toEqual([modelo.id]);
    // Y el código que enseña ya es el de producción.
    expect(porDesarrollo.datos[0]?.codigo).toBe('71050');

    const porProduccion = await listarModelos(sesion(), { busqueda: '71050' }, bd());
    expect(porProduccion.datos.map((m) => m.id)).toEqual([modelo.id]);
  });
});

// ── ⭐ El LOCK: lo que sustituye a la secuencia atómica de A3 ──────────────────────

/**
 * A3 exige folios por secuencia atómica y el consecutivo de PRODUCCIÓN no puede salir de una (las
 * series del Access están huecas y ya topadas — ver el encabezado de `nomenclatura.ts`). Lo que
 * ocupa su lugar es el `pg_advisory_xact_lock` del par: dentro de él, ELEGIR el hueco y ESCRIBIRLO
 * son un solo hecho serializado.
 *
 * Sin una prueba que lo ejercite, ese lock es una línea que un refactor puede borrar en silencio:
 * el resto de la suite sigue en verde porque nada más corre concurrente. Esta prueba es su candado.
 */
describe('concurrencia: el advisory lock del par (sustituto de A3)', () => {
  const CONCURRENTES = 20;

  it('N promociones SIMULTÁNEAS del mismo par sacan N números DISTINTOS y consecutivos, sin conflictos', async () => {
    // N modelos de desarrollo del MISMO par (71) compitiendo por la misma serie vacía.
    const ids: number[] = [];
    for (let i = 0; i < CONCURRENTES; i += 1) {
      ids.push(await crearModeloDesarrollo(`CYA-26-71-${String(i + 1).padStart(3, '0')}`));
    }

    const resultados = await Promise.allSettled(
      ids.map((id) => pasarModeloAProduccion(sesion(), id, {}, bd())),
    );

    // 1) NINGUNA falla. Sin el lock, las que pierden la carrera chocan contra el `@unique` y
    //    revientan: el reviewer midió 2 éxitos y 18 conflictos con el lock quitado.
    const fallidas = resultados.filter((r) => r.status === 'rejected');
    // Se comparan los MENSAJES, no el conteo: si algo falla, el `expect` lo enseña en el diff.
    expect(fallidas.map((r) => String(r.reason))).toEqual([]);

    // 2) N números DISTINTOS (no "N números": si dos coincidieran, `new Set` los colapsa).
    const numeros = resultados
      .filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof pasarModeloAProduccion>>> =>
          r.status === 'fulfilled',
      )
      .map((r) => r.value.numeroProduccion)
      .sort((a, b) => a - b);
    expect(new Set(numeros).size).toBe(CONCURRENTES);

    // 3) Y son EXACTAMENTE los N primeros de la serie 71, sin huecos ni saltos: 71001…71020.
    //    Nombrar los valores es lo que distingue "no se repitieron" de "llenaron bien la serie".
    expect(numeros).toEqual(Array.from({ length: CONCURRENTES }, (_, i) => 71_000 + i + 1));

    // 4) La base coincide con lo que devolvió el dominio (no basta con el valor de retorno).
    const enBd = (
      await cliente.modelo.findMany({
        where: { origen: 'produccion' },
        select: { codigo: true, numeroProduccion: true },
        orderBy: { numeroProduccion: 'asc' },
      })
    ).map((m) => m.numeroProduccion);
    expect(enBd).toEqual(numeros);
  });

  it('con la serie HUECA, las simultáneas rellenan los huecos que hay (no arrancan tras el máximo)', async () => {
    // Serie con 71001, 71003 y 71999 ocupados → los huecos bajos son 002, 004, 005…
    await sembrarProduccion(['71001', '71003', '71999']);
    const ids: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push(await crearModeloDesarrollo(`CYA-26-71-9${String(i)}`));
    }

    const resultados = await Promise.all(
      ids.map((id) => pasarModeloAProduccion(sesion(), id, {}, bd())),
    );
    const numeros = resultados.map((r) => r.numeroProduccion).sort((a, b) => a - b);

    // 002, 004 y 005: los tres huecos más bajos. Un generador por `max+1` habría dado 71000+1000…
    expect(numeros).toEqual([71_002, 71_004, 71_005]);
  });
});

// ── Unicidad con DOS números por modelo ───────────────────────────────────────────

describe('unicidad de los códigos con un modelo promovido', () => {
  /**
   * `codigo` y `codigoDesarrollo` son columnas DISTINTAS, así que sus `@unique` no se estorban:
   * sin la comprobación cruzada del dominio se podrían dar de alta dos modelos que responden al
   * mismo texto, y la búsqueda —que mira las dos columnas— devolvería dos sin desempate.
   */
  it('no deja crear un modelo cuyo código sea el nº de DESARROLLO de otro', async () => {
    const id = await crearModeloDesarrollo('CYA-26-71-003');
    await pasarModeloAProduccion(sesion(), id, { numeroProduccion: 71_050 }, bd());

    await expect(altaDeCatalogo('CYA-26-71-003')).rejects.toThrow(ErrorConflicto);
    // El mensaje tiene que decir DÓNDE está ocupado; si sólo dijera "ya existe" nadie lo hallaría.
    await expect(altaDeCatalogo('CYA-26-71-003')).rejects.toThrow(
      /nº de desarrollo del modelo "71050"/,
    );
    expect(await cliente.modelo.count()).toBe(1);
  });

  it('el modelo promovido SÍ puede re-editarse a su propio código sin chocar consigo mismo', async () => {
    const id = await crearModeloDesarrollo('CYA-26-71-003');
    await pasarModeloAProduccion(sesion(), id, { numeroProduccion: 71_050 }, bd());
    // Editar otra cosa (misma llave de código) no debe disparar el conflicto contra sí mismo.
    const editado = await actualizarModelo(sesion(), { id, descripcion: 'Jogger' }, bd());
    expect(editado.codigo).toBe('71050');
    expect(editado.descripcion).toBe('Jogger');
  });

  it('renombrar un modelo a un código de 5 dígitos lo hace OCUPAR ese consecutivo', async () => {
    const modelo = await altaDeCatalogo('TEMP-1');
    expect(modelo.numeroProduccion).toBeNull();

    await actualizarModelo(sesion(), { id: modelo.id, codigo: '71001' }, bd());
    const tras = await cliente.modelo.findUniqueOrThrow({ where: { id: modelo.id } });
    // ⚠️ V1-E8j: el modelo nació en DESARROLLO, y ahí `numero_produccion` DEBE quedarse en null (lo
    // exige el CHECK de la base; su número lo estrena la promoción). El consecutivo lo ocupa igual,
    // por el CÓDIGO — que es lo que este caso mide, y lo prueba la propuesta de abajo.
    expect(tras.numeroProduccion).toBeNull();
    // Y el nº de desarrollo VIAJA con el código mientras el modelo vive en desarrollo: si se
    // quedara en 'TEMP-1', el modelo tendría dos códigos buscables y sólo uno visible.
    expect(tras.codigoDesarrollo).toBe('71001');

    const propuesta = await enTx((tx) =>
      proponerNumeroProduccion(tx, {
        concepto: 7,
        genero: 1,
        generoAlterno: null,
        fuente: 'catalogo',
      }),
    );
    expect(propuesta.numero).toBe(71_002);
  });
});

// ── ⭐ V1-E8j — EL ALTA DEL CATÁLOGO YA NO FABRICA MODELOS DE PRODUCCIÓN (§Post-F9.134) ───────
//
// Daniel: *"nunca va a pasar que dé de alta un modelo de producción si no tiene ya una orden
// asignada. No tendría sentido poner ahí una puerta. Mejor siempre desde producción."* El catálogo
// de producción se llena por «pasar a producción», y esta puerta se cerró: antes `crearModelo`
// dejaba el modelo EN PRODUCCIÓN con su nº derivado del código.

describe('crearModelo: el modelo NACE EN DESARROLLO', () => {
  it('nace marcado desarrollo, sin nº de producción y conservando su código como nº de desarrollo', async () => {
    const modelo = await altaDeCatalogo('CYA-26-71-009');

    const enBd = await cliente.modelo.findUniqueOrThrow({ where: { id: modelo.id } });
    expect(enBd.origen).toBe('desarrollo');
    expect(enBd.numeroProduccion).toBeNull();
    // El código vigente y el de desarrollo valen lo mismo mientras vive ahí (§Post-F9.34 punto 5):
    // así, cuando la promoción lo sustituya por el número, el tecleado NO se pierde (D3).
    expect(enBd.codigoDesarrollo).toBe('CYA-26-71-009');
  });

  it('ni siquiera tecleando un código de 5 dígitos entra a producción — pero SÍ ocupa el número', async () => {
    const modelo = await altaDeCatalogo('71001');

    const enBd = await cliente.modelo.findUniqueOrThrow({ where: { id: modelo.id } });
    expect(enBd.origen).toBe('desarrollo');
    expect(enBd.numeroProduccion).toBeNull();

    // Y el consecutivo queda OCUPADO igual: la ocupación se lee también del CÓDIGO, no sólo de la
    // columna numérica. Sin esto, la promoción siguiente propondría 71001 y chocaría con el unique.
    const propuesta = await enTx((tx) =>
      proponerNumeroProduccion(tx, {
        concepto: 7,
        genero: 1,
        generoAlterno: null,
        fuente: 'catalogo',
      }),
    );
    expect(propuesta.numero).toBe(71_002);
  });

  it('y el modelo que nace aquí SÍ se puede pasar a producción (es el camino que queda)', async () => {
    const modelo = await altaDeCatalogo('MUESTRA-1');

    const resultado = await pasarModeloAProduccion(sesion(), modelo.id, {}, bd());

    expect(resultado.numeroProduccion).toBe(71_001);
    const enBd = await cliente.modelo.findUniqueOrThrow({ where: { id: modelo.id } });
    expect(enBd.origen).toBe('produccion');
    expect(enBd.codigo).toBe('71001');
    // El código con el que se dio de alta se CONSERVA y sigue buscable (D3).
    expect(enBd.codigoDesarrollo).toBe('MUESTRA-1');
    const porElViejo = await listarModelos(sesion(), { busqueda: 'MUESTRA-1' }, bd());
    expect(porElViejo.datos.map((m) => m.id)).toEqual([modelo.id]);
  });
});

// ── El MODO MIGRACIÓN: el histórico del Access sí nace en producción ───────────────

describe('crearModeloMigrado (modo migración del ETL)', () => {
  it('deja el modelo EN PRODUCCIÓN, con su nº derivado del código y sin nº de desarrollo', async () => {
    // ⚠️ SIN tipo de prenda ni género, a propósito: el histórico del Access no los trae (el CSV ni
    // siquiera tiene la columna de género) y el modo migración entra POR DEBAJO de esa exigencia.
    const modelo = await crearModeloMigrado(sesion(), { codigo: '71001' }, bd());

    const enBd = await cliente.modelo.findUniqueOrThrow({ where: { id: modelo.id } });
    expect(enBd.origen).toBe('produccion');
    expect(enBd.numeroProduccion).toBe(71_001);
    // Nunca fue de desarrollo: inventarle un nº de desarrollo haría que su código apareciera DOS
    // veces en la búsqueda por texto.
    expect(enBd.codigoDesarrollo).toBeNull();

    // Y OCUPA su consecutivo, que es lo que el ETL necesita para que el generador no lo reproponga.
    const propuesta = await enTx((tx) =>
      proponerNumeroProduccion(tx, {
        concepto: 7,
        genero: 1,
        generoAlterno: null,
        fuente: 'catalogo',
      }),
    );
    expect(propuesta.numero).toBe(71_002);
  });

  it('un código histórico NO numérico (`M-18`, `51783a`) se queda sin número', async () => {
    const modelo = await crearModeloMigrado(sesion(), { codigo: '71001a' }, bd());

    const enBd = await cliente.modelo.findUniqueOrThrow({ where: { id: modelo.id } });
    expect(enBd.origen).toBe('produccion');
    expect(enBd.numeroProduccion).toBeNull();
    expect(enBd.codigoDesarrollo).toBeNull();
  });
});
