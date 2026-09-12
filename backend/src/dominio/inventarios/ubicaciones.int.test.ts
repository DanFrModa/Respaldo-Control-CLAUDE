/**
 * ⭐⭐ FILA 0.103 — DÓNDE ESTÁ GUARDADO EL MATERIAL. Integración contra Postgres real, que es lo
 * único que puede medir las cuatro cosas que importan:
 *
 *  (a) lo guardado VIAJA PEGADO al renglón de existencia que ya se consulta (no hace falta una
 *      segunda pantalla) — y el almacén donde nadie anotó nada sigue apareciendo, con `null`;
 *  (b) re-fijar ACTUALIZA la misma fila (el `@@unique` artículo×almacén×empresa no admite duplicados);
 *  (c) **VACÍO BORRA**: no se guarda la cadena vacía, se borra la fila, y la consulta vuelve a `null`;
 *  (d) el almacén pasa por la MISMA puerta que los movimientos: tipo correcto (fila 0.137) y
 *      empresa propia o global (A9) — el de otra empresa, para esta sesión, no existe;
 *  (e) ⭐ y en el almacén **GLOBAL** —el que siembra `sembrarAlmacenUnicoGlobal` para TELA y AVÍO, o
 *      sea el caso normal— cada empresa tiene su PROPIA anotación: no se pisan y no se leen. Esto
 *      es lo que la primera versión hacía mal (una sola fila artículo×almacén, última escritura
 *      gana), y es lo que la llave artículo×almacén×EMPRESA arregla.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Almacen, Avio, Empresa, PrismaClient, Tela, TelaColor } from '../../datos/index.js';
import { ErrorNoEncontrado, ErrorValidacion } from '../../comun/errores.js';
import type { ClavePermiso } from '../../contrato/index.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../../pruebas/contexto.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { ajustarInventarioTelaColor, consultarExistenciasTelaColor } from './partidas-telas.js';
import { fijarUbicacionAvio, fijarUbicacionTelaColor } from './ubicaciones.js';
import { ajustarInventarioAvio, consultarExistenciasAvio } from './avios.js';

let cliente: PrismaClient;
let empresa: Empresa;
let otraEmpresa: Empresa;
let telaFelpa: Tela;
let colorMarino: TelaColor;
let avioCierre: Avio;
let almTelaA: Almacen;
let almTelaB: Almacen;
let almAvio: Almacen;
let almPt: Almacen;
let almOtraEmpresa: Almacen;
let idTipoAjusteEntrada: number;

const PERM_TELAS: ClavePermiso[] = ['inventario-telas.ver', 'inventario-telas.mover'];
const PERM_AVIOS: ClavePermiso[] = ['inventario-avios.ver', 'inventario-avios.mover'];

const sesion = (permisos: ClavePermiso[]) =>
  sesionDePrueba({ idEmpresaActiva: empresa.id, permisos });
/** La misma sesión, pero de OTRA empresa: con esto se mide el aislamiento en el almacén global. */
const sesionDe = (idEmpresaActiva: number, permisos: ClavePermiso[]) =>
  sesionDePrueba({ idEmpresaActiva, permisos });
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
  otraEmpresa = await crearEmpresaPrueba(cliente, 'Otra SA');
  telaFelpa = await cliente.tela.create({ data: { nombre: 'Felpa' } });
  colorMarino = await cliente.telaColor.create({
    data: { idTela: telaFelpa.id, nombre: 'Marino' },
  });
  avioCierre = await cliente.avio.create({ data: { clave: 'CIE-01', descripcion: 'Cierre 20cm' } });
  almTelaA = await cliente.almacen.create({ data: { nombre: 'Naucalpan', tipo: 'TELA' } });
  almTelaB = await cliente.almacen.create({ data: { nombre: 'Taller', tipo: 'TELA' } });
  almAvio = await cliente.almacen.create({ data: { nombre: 'Avíos', tipo: 'AVIO' } });
  almPt = await cliente.almacen.create({ data: { nombre: 'Primeras', tipo: 'PT' } });
  almOtraEmpresa = await cliente.almacen.create({
    data: { nombre: 'Bodega ajena', tipo: 'TELA', idEmpresa: otraEmpresa.id },
  });
  const tipos = await cliente.tipoMovimientoInventario.createManyAndReturn({
    data: [{ codigo: 'ajuste-entrada', nombre: 'Ajuste (Entrada)', direccion: 'entrada' }],
  });
  idTipoAjusteEntrada = tipos[0]!.id;
});

/** Mete tela del color en un almacén, para que haya renglón de existencia donde ver la ubicación. */
async function entrarTela(idAlmacen: number, cantidad: number, idEmpresa?: number): Promise<void> {
  await ajustarInventarioTelaColor(
    sesionDe(idEmpresa ?? empresa.id, PERM_TELAS),
    {
      idTipoMov: idTipoAjusteEntrada,
      idAlmacen,
      fecha: '2026-09-01',
      motivo: 'Conteo físico inicial',
      lineas: [{ idTelaColor: colorMarino.id, cantidad }],
    },
    bd(),
  );
}

/** La ubicación del color en un almacén, tal como la ve la pantalla de existencias. */
async function ubicacionEnPantalla(
  idAlmacen: number,
  idEmpresa?: number,
): Promise<string | null | undefined> {
  const lista = await consultarExistenciasTelaColor(
    sesionDe(idEmpresa ?? empresa.id, PERM_TELAS),
    {},
    bd(),
  );
  const color = lista.telas[0]?.colores[0];
  return color?.almacenes.find((a) => a.idAlmacen === idAlmacen)?.ubicacion;
}

describe('Ubicación de TELA — se guarda y se ve donde el almacenista ya trabaja', () => {
  it('(a) la ubicación viaja pegada al renglón de existencia; el almacén sin anotar viene null', async () => {
    await entrarTela(almTelaA.id, 100);
    await entrarTela(almTelaB.id, 20);

    // Antes de anotar nada, los DOS almacenes vienen sin ubicación (y con su existencia intacta).
    expect(await ubicacionEnPantalla(almTelaA.id)).toBeNull();
    expect(await ubicacionEnPantalla(almTelaB.id)).toBeNull();

    const salida = await fijarUbicacionTelaColor(
      sesion(PERM_TELAS),
      { idTelaColor: colorMarino.id, idAlmacen: almTelaA.id, ubicacion: '  Rack 4, nivel 2  ' },
      bd(),
    );
    // Se recorta el espacio sobrante y se contesta lo que quedó GUARDADO (la UI pinta eso, no lo
    // que tecleó el usuario).
    expect(salida).toEqual({ idAlmacen: almTelaA.id, ubicacion: 'Rack 4, nivel 2' });

    expect(await ubicacionEnPantalla(almTelaA.id)).toBe('Rack 4, nivel 2');
    // ⚠️ Lo que el LEFT JOIN tiene que respetar: el OTRO almacén sigue saliendo, sin ubicación.
    expect(await ubicacionEnPantalla(almTelaB.id)).toBeNull();
    // Y la existencia no se tocó: esto NO es un movimiento (D3 intacto).
    const lista = await consultarExistenciasTelaColor(sesion(PERM_TELAS), {}, bd());
    expect(lista.totalCuerpo).toBe(120);
  });

  it('(b) re-fijar ACTUALIZA la misma fila, no duplica (unique artículo×almacén×empresa)', async () => {
    await entrarTela(almTelaA.id, 100);
    const llave = { idTelaColor: colorMarino.id, idAlmacen: almTelaA.id };
    await fijarUbicacionTelaColor(sesion(PERM_TELAS), { ...llave, ubicacion: 'Rack 4' }, bd());
    await fijarUbicacionTelaColor(sesion(PERM_TELAS), { ...llave, ubicacion: 'Rack 9' }, bd());

    expect(await ubicacionEnPantalla(almTelaA.id)).toBe('Rack 9');
    expect(await cliente.ubicacionTelaColor.count()).toBe(1);
    // Rastro completo (A7): el alta y el cambio, con el antes y el después.
    const bitacora = await cliente.bitacora.findMany({
      where: { entidad: 'UbicacionTelaColor' },
      orderBy: { id: 'asc' },
    });
    expect(bitacora.map((b) => b.accion)).toEqual(['CREAR', 'MODIFICAR']);
  });

  it('(c) VACÍO BORRA: no se guarda la cadena vacía y la pantalla vuelve a "no anotada"', async () => {
    await entrarTela(almTelaA.id, 100);
    const llave = { idTelaColor: colorMarino.id, idAlmacen: almTelaA.id };
    await fijarUbicacionTelaColor(sesion(PERM_TELAS), { ...llave, ubicacion: 'Rack 4' }, bd());

    const salida = await fijarUbicacionTelaColor(
      sesion(PERM_TELAS),
      { ...llave, ubicacion: '   ' },
      bd(),
    );
    expect(salida.ubicacion).toBeNull();
    expect(await cliente.ubicacionTelaColor.count()).toBe(0);
    expect(await ubicacionEnPantalla(almTelaA.id)).toBeNull();
    // El renglón de existencia sigue ahí: borrar la nota no borra la mercancía.
    const lista = await consultarExistenciasTelaColor(sesion(PERM_TELAS), {}, bd());
    expect(lista.totalCuerpo).toBe(100);
  });

  it('(c-bis) borrar lo que nunca se anotó no truena ni ensucia la bitácora', async () => {
    const salida = await fijarUbicacionTelaColor(
      sesion(PERM_TELAS),
      { idTelaColor: colorMarino.id, idAlmacen: almTelaA.id, ubicacion: '' },
      bd(),
    );
    expect(salida.ubicacion).toBeNull();
    expect(await cliente.bitacora.count({ where: { entidad: 'UbicacionTelaColor' } })).toBe(0);
  });

  it('(d) rechaza un almacén que NO es de telas (fila 0.137)', async () => {
    await expect(
      fijarUbicacionTelaColor(
        sesion(PERM_TELAS),
        { idTelaColor: colorMarino.id, idAlmacen: almPt.id, ubicacion: 'Rack 4' },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cliente.ubicacionTelaColor.count()).toBe(0);
  });

  it('(d) rechaza el almacén de OTRA empresa (A9)', async () => {
    await expect(
      fijarUbicacionTelaColor(
        sesion(PERM_TELAS),
        { idTelaColor: colorMarino.id, idAlmacen: almOtraEmpresa.id, ubicacion: 'Rack 4' },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cliente.ubicacionTelaColor.count()).toBe(0);
  });

  it('(e) DOS EMPRESAS anotan el MISMO color en el MISMO almacén GLOBAL sin pisarse (A9)', async () => {
    // `almTelaA` NO tiene empresa: es GLOBAL, igual que los que siembra `sembrarAlmacenUnicoGlobal`
    // para TELA y AVÍO. Ése es justo el caso que el argumento «el almacén ya pertenece a una
    // empresa» NO cubría, y por el que la ubicación se compartía entre empresas.
    expect(almTelaA.idEmpresa).toBeNull();
    await entrarTela(almTelaA.id, 100);
    await entrarTela(almTelaA.id, 50, otraEmpresa.id);
    const llave = { idTelaColor: colorMarino.id, idAlmacen: almTelaA.id };

    await fijarUbicacionTelaColor(sesion(PERM_TELAS), { ...llave, ubicacion: 'Rack 4' }, bd());
    await fijarUbicacionTelaColor(
      sesionDe(otraEmpresa.id, PERM_TELAS),
      { ...llave, ubicacion: 'Pasillo Z' },
      bd(),
    );

    // Dos filas, una por empresa: la segunda NO pisó a la primera.
    expect(await cliente.ubicacionTelaColor.count()).toBe(2);
    // Y cada quien ve LA SUYA en su pantalla, no la de la otra.
    expect(await ubicacionEnPantalla(almTelaA.id)).toBe('Rack 4');
    expect(await ubicacionEnPantalla(almTelaA.id, otraEmpresa.id)).toBe('Pasillo Z');
  });

  it('(e) lo que la otra empresa anotó en el almacén global NO se ve desde aquí', async () => {
    await entrarTela(almTelaA.id, 100);
    await entrarTela(almTelaA.id, 50, otraEmpresa.id);
    await fijarUbicacionTelaColor(
      sesionDe(otraEmpresa.id, PERM_TELAS),
      { idTelaColor: colorMarino.id, idAlmacen: almTelaA.id, ubicacion: 'Pasillo Z' },
      bd(),
    );

    // Esta empresa nunca anotó nada: tiene que ver "no anotada", no el estante de la otra.
    expect(await ubicacionEnPantalla(almTelaA.id)).toBeNull();
  });

  it('contesta "no existe" del COLOR, no un error de llave foránea', async () => {
    await expect(
      fijarUbicacionTelaColor(
        sesion(PERM_TELAS),
        { idTelaColor: 99_999, idAlmacen: almTelaA.id, ubicacion: 'Rack 4' },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorNoEncontrado);
  });
});

describe('Ubicación de AVÍO — la gemela', () => {
  it('se guarda, se ve en existencias de avío y el vacío la borra', async () => {
    await ajustarInventarioAvio(
      sesion(PERM_AVIOS),
      {
        idTipoMov: idTipoAjusteEntrada,
        idAlmacen: almAvio.id,
        fecha: '2026-09-01',
        motivo: 'Conteo físico inicial',
        lineas: [{ idAvio: avioCierre.id, cantidad: 500 }],
      },
      bd(),
    );
    const llave = { idAvio: avioCierre.id, idAlmacen: almAvio.id };

    const antes = await consultarExistenciasAvio(sesion(PERM_AVIOS), {}, bd());
    expect(antes.filas).toHaveLength(1);
    expect(antes.filas[0]?.ubicacion).toBeNull();

    await fijarUbicacionAvio(
      sesion(PERM_AVIOS),
      { ...llave, ubicacion: 'Pasillo B, caja 3' },
      bd(),
    );
    const conUbicacion = await consultarExistenciasAvio(sesion(PERM_AVIOS), {}, bd());
    expect(conUbicacion.filas[0]?.ubicacion).toBe('Pasillo B, caja 3');
    expect(conUbicacion.filas[0]?.existencia).toBe(500);

    await fijarUbicacionAvio(sesion(PERM_AVIOS), { ...llave, ubicacion: '' }, bd());
    const despues = await consultarExistenciasAvio(sesion(PERM_AVIOS), {}, bd());
    expect(despues.filas).toHaveLength(1);
    expect(despues.filas[0]?.ubicacion).toBeNull();
  });

  it('rechaza un almacén que NO es de avíos (fila 0.137)', async () => {
    await expect(
      fijarUbicacionAvio(
        sesion(PERM_AVIOS),
        { idAvio: avioCierre.id, idAlmacen: almTelaA.id, ubicacion: 'Pasillo B' },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('rechaza el almacén de OTRA empresa (A9) — la gemela de telas, que faltaba', async () => {
    await expect(
      fijarUbicacionAvio(
        sesion(PERM_AVIOS),
        { idAvio: avioCierre.id, idAlmacen: almOtraEmpresa.id, ubicacion: 'Pasillo B' },
        bd(),
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(await cliente.ubicacionAvio.count()).toBe(0);
  });

  it('(e) dos empresas anotan el MISMO avío en el MISMO almacén global sin pisarse ni verse', async () => {
    expect(almAvio.idEmpresa).toBeNull();
    const entrar = async (idEmpresaActiva: number, cantidad: number) => {
      await ajustarInventarioAvio(
        sesionDe(idEmpresaActiva, PERM_AVIOS),
        {
          idTipoMov: idTipoAjusteEntrada,
          idAlmacen: almAvio.id,
          fecha: '2026-09-01',
          motivo: 'Conteo físico inicial',
          lineas: [{ idAvio: avioCierre.id, cantidad }],
        },
        bd(),
      );
    };
    await entrar(empresa.id, 500);
    await entrar(otraEmpresa.id, 300);
    const llave = { idAvio: avioCierre.id, idAlmacen: almAvio.id };

    await fijarUbicacionAvio(sesion(PERM_AVIOS), { ...llave, ubicacion: 'Caja 3' }, bd());
    await fijarUbicacionAvio(
      sesionDe(otraEmpresa.id, PERM_AVIOS),
      { ...llave, ubicacion: 'Caja 9' },
      bd(),
    );

    expect(await cliente.ubicacionAvio.count()).toBe(2);
    const mia = await consultarExistenciasAvio(sesion(PERM_AVIOS), {}, bd());
    expect(mia.filas[0]?.ubicacion).toBe('Caja 3');
    const suya = await consultarExistenciasAvio(sesionDe(otraEmpresa.id, PERM_AVIOS), {}, bd());
    expect(suya.filas[0]?.ubicacion).toBe('Caja 9');
  });
});
