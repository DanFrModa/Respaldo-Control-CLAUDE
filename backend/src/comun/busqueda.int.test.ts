/**
 * ⭐ **Fila 0.205 — «ambar» tiene que encontrar «Ámbar», en los SEIS catálogos que buscan en el
 * servidor.** Integración contra Postgres real: la extensión `unaccent` es parte de la garantía
 * —sin ella la consulta ni corre— así que esto NO se puede medir con una prueba pura.
 *
 * El defecto que cierra: `contains mode: 'insensitive'` de Prisma es ILIKE, que ignora mayúsculas
 * pero NO acentos. Proveedores y clientes ya iban por `unaccent` desde R2; colores, telas, avíos y
 * modelos no, y el reporte de Daniel del 26-sep-2026 fue justo ese: teclear `ambar` no encontraba
 * «Ámbar». En `SelectorColor` el síntoma era doble, porque las dos mitades de la MISMA lista no
 * coincidían: los colores retirados con mercancía se filtran en cliente con `filtrarOpciones`
 * (`ComboboxBuscable.tsx`), que sí normaliza acentos ⇒ el mismo texto encontraba al retirado y no
 * al activo. Aquí se fija la mitad del servidor; la del cliente la fija
 * `frontend/src/components/dominio/ComboboxBuscable.test.tsx`.
 *
 * Cada catálogo lleva su GEMELA de lo-que-NO-debe-encontrar: sin ella, un pre-filtro que
 * devolviera "todos los ids" pasaría el caso central y dejaría la búsqueda sin filtrar nada.
 */
// Credenciales R2 FALSAS, fijadas ANTES de llamar al dominio: `listarModelos` construye el
// servicio de archivos (para la foto principal) aunque aquí ningún modelo tenga fotos.
process.env.R2_ACCOUNT_ID ??= 'cuenta-fake';
process.env.R2_ACCESS_KEY_ID ??= 'llave-fake';
process.env.R2_SECRET_ACCESS_KEY ??= 'secreto-fake';
process.env.R2_BUCKET ??= 'control-v2-prueba';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Empresa, PrismaClient } from '../datos/index.js';
import { listarAvios } from '../dominio/catalogos/avios.js';
import { listarClientes } from '../dominio/catalogos/clientes.js';
import { listarColores } from '../dominio/catalogos/colores.js';
import { listarProveedores } from '../dominio/catalogos/proveedores.js';
import { listarTelas } from '../dominio/catalogos/telas.js';
import { listarModelos } from '../dominio/modelos/modelos.js';
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from '../pruebas/contexto.js';
import { sesionDePrueba } from '../pruebas/sesiones.js';

let cliente: PrismaClient;
let empresa: Empresa;

const bd = () => ({ cliente });
const sesion = () =>
  sesionDePrueba({
    idEmpresaActiva: empresa.id,
    permisos: [
      'colores.ver',
      'telas.ver',
      'avios.ver',
      'modelos.ver',
      'proveedores.ver',
      'clientes.ver',
    ],
  });

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

describe('Búsqueda sin acentos — COLORES (el caso que reportó Daniel)', () => {
  beforeEach(async () => {
    await cliente.color.createMany({
      data: [{ nombre: 'ÁMBAR' }, { nombre: 'AZUL MARINO' }, { nombre: 'VERDE LIMÓN' }],
    });
  });

  it('⭐ "ambar" (sin acento) ENCUENTRA «ÁMBAR»', async () => {
    const pagina = await listarColores(sesion(), { busqueda: 'ambar' }, bd());
    expect(pagina.total).toBe(1);
    expect(pagina.datos.map((c) => c.nombre)).toEqual(['ÁMBAR']);
  });

  it('GEMELA: "ambar" NO arrastra los otros colores (el pre-filtro sí filtra)', async () => {
    // Sin esta gemela, un pre-filtro que devolviera TODOS los ids pasaría la prueba de arriba.
    expect((await listarColores(sesion(), { busqueda: 'azul' }, bd())).total).toBe(1);
    expect((await listarColores(sesion(), { busqueda: 'zzz' }, bd())).total).toBe(0);
    // Y "amba" tampoco pesca a «AZUL MARINO» por llevar las mismas letras desordenadas.
    expect((await listarColores(sesion(), { busqueda: 'amba' }, bd())).total).toBe(1);
  });

  it('funciona en las DOS direcciones: con acento encuentra lo escrito sin acento', async () => {
    await cliente.color.create({ data: { nombre: 'AMBAR CLARO' } });
    const conAcento = await listarColores(sesion(), { busqueda: 'ámbar' }, bd());
    expect(conAcento.datos.map((c) => c.nombre).sort()).toEqual(['AMBAR CLARO', 'ÁMBAR']);
  });

  it('el filtro de activos y la paginación siguen mandando sobre la búsqueda', async () => {
    const ambar = await cliente.color.findFirstOrThrow({ where: { nombre: 'ÁMBAR' } });
    await cliente.color.update({ where: { id: ambar.id }, data: { activo: false } });
    // Por default sólo activos: el retirado NO sale aunque el texto case.
    expect((await listarColores(sesion(), { busqueda: 'ambar' }, bd())).total).toBe(0);
    expect(
      (await listarColores(sesion(), { busqueda: 'ambar', incluirInactivos: true }, bd())).total,
    ).toBe(1);
  });
});

describe('Búsqueda sin acentos — AVÍOS (clave O descripción)', () => {
  beforeEach(async () => {
    await cliente.avio.createMany({
      data: [
        { clave: 'HIL-09', descripcion: 'Hilo poliéster' },
        { clave: 'BTN-01', descripcion: 'Botón redondo' },
      ],
    });
  });

  it('⭐ "poliester" (sin acento) encuentra «Hilo poliéster»', async () => {
    const pagina = await listarAvios(sesion(), { busqueda: 'poliester' }, bd());
    expect(pagina.total).toBe(1);
    expect(pagina.datos[0]?.clave).toBe('HIL-09');
  });

  it('la CLAVE sigue siendo buscable (esta fila no quita campos)', async () => {
    expect((await listarAvios(sesion(), { busqueda: 'btn' }, bd())).total).toBe(1);
    expect((await listarAvios(sesion(), { busqueda: 'boton' }, bd())).total).toBe(1);
  });

  it('GEMELA: no encuentra lo que no debe, y el filtro esGenerico sigue vivo', async () => {
    expect((await listarAvios(sesion(), { busqueda: 'zzz' }, bd())).total).toBe(0);
    // `esGenerico` se compone con AND: ningún avío de arriba es genérico.
    expect(
      (await listarAvios(sesion(), { busqueda: 'poliester', esGenerico: true }, bd())).total,
    ).toBe(0);
  });
});

describe('Búsqueda sin acentos — MODELOS (código, código de desarrollo, descripción)', () => {
  beforeEach(async () => {
    await cliente.modelo.createMany({
      data: [
        { codigo: '71001', codigoDesarrollo: 'CYA-26-71-001', descripcion: 'Sudadera niño' },
        { codigo: '71002', descripcion: 'Playera dama' },
      ],
    });
  });

  it('⭐ "nino" encuentra «Sudadera niño» (la ñ también se dobla)', async () => {
    const pagina = await listarModelos(sesion(), { busqueda: 'nino' }, bd());
    expect(pagina.total).toBe(1);
    expect(pagina.datos[0]?.codigo).toBe('71001');
  });

  it('los DOS números del modelo promovido siguen buscables (§Post-F9.34 punto 5)', async () => {
    expect((await listarModelos(sesion(), { busqueda: 'CYA-26-71-001' }, bd())).total).toBe(1);
    expect((await listarModelos(sesion(), { busqueda: '71001' }, bd())).total).toBe(1);
  });

  it('GEMELA: "nina" NO encuentra «niño» (dobla el acento, no adivina la palabra)', async () => {
    expect((await listarModelos(sesion(), { busqueda: 'nina' }, bd())).total).toBe(0);
    expect((await listarModelos(sesion(), { busqueda: 'zzz' }, bd())).total).toBe(0);
  });
});

describe('Búsqueda sin acentos — TELAS (5 columnas, tres en tablas vecinas)', () => {
  beforeEach(async () => {
    const montano = await cliente.proveedor.create({ data: { nombre: 'Hilazas Montaño' } });
    await cliente.tela.create({
      data: {
        nombre: 'Algodón peinado',
        unidadMedida: 'KG',
        idProveedor: montano.id,
        nombreProveedor: 'Félpa Suiza',
        colores: {
          create: [
            { nombre: 'Añil', pantone: '19-4005 TCX' },
            { nombre: 'Marrón', pantone: '18-1142 TCX' },
          ],
        },
      },
    });
    await cliente.tela.create({ data: { nombre: 'Jersey liviano', unidadMedida: 'M' } });
  });

  it('⭐ "algodon" encuentra «Algodón peinado» (columna propia)', async () => {
    const pagina = await listarTelas(sesion(), { busqueda: 'algodon' }, bd());
    expect(pagina.total).toBe(1);
    expect(pagina.datos[0]?.nombre).toBe('Algodón peinado');
  });

  it('también sin acento por el PROVEEDOR, su nombre de tela, el COLOR y el pantone', async () => {
    for (const texto of ['montano', 'felpa', 'anil', '19-4005']) {
      const pagina = await listarTelas(sesion(), { busqueda: texto }, bd());
      expect(pagina.total, `buscando "${texto}"`).toBe(1);
      expect(pagina.datos[0]?.nombre, `buscando "${texto}"`).toBe('Algodón peinado');
    }
  });

  it('una tela cuyos DOS colores casan sale UNA vez en la página', async () => {
    // "TCX" está en los dos pantones de la MISMA tela. Esto fija lo que VE el usuario; la forma
    // del SQL (vecinos por `EXISTS`, sin ids repetidos) la fija `busqueda.test.ts`, porque el
    // `id IN (…)` de Prisma deduplicaría la lista y aquí no se notaría la diferencia.
    const pagina = await listarTelas(sesion(), { busqueda: 'tcx' }, bd());
    expect(pagina.total).toBe(1);
    expect(pagina.datos).toHaveLength(1);
  });

  it('GEMELA: no encuentra lo que no debe, y los filtros duros siguen encima', async () => {
    expect((await listarTelas(sesion(), { busqueda: 'zzz' }, bd())).total).toBe(0);
    expect((await listarTelas(sesion(), { busqueda: 'jersey' }, bd())).total).toBe(1);
    // `idProveedor` se compone con AND: la tela de «algodon» no es del proveedor 999.
    expect(
      (await listarTelas(sesion(), { busqueda: 'algodon', idProveedor: 999_999 }, bd())).total,
    ).toBe(0);
  });
});

describe('Búsqueda sin acentos — PROVEEDORES y CLIENTES (regresión de R2)', () => {
  it('siguen encontrando «Óscar» tecleando "oscar" (el molde no se rompió al generalizarlo)', async () => {
    await cliente.proveedor.create({ data: { nombre: 'Óscar Jiménez' } });
    await cliente.cliente.create({ data: { nombre: 'Almacenes Óscar' } });

    expect((await listarProveedores(sesion(), { busqueda: 'oscar' }, bd())).total).toBe(1);
    expect((await listarClientes(sesion(), { busqueda: 'oscar' }, bd())).total).toBe(1);
    expect((await listarProveedores(sesion(), { busqueda: 'zzz' }, bd())).total).toBe(0);
    expect((await listarClientes(sesion(), { busqueda: 'zzz' }, bd())).total).toBe(0);
  });
});

describe('Búsqueda sin acentos — el texto del usuario nunca es SQL', () => {
  it('los comodines de LIKE del usuario se tratan como texto, no como comodín', async () => {
    await cliente.color.createMany({ data: [{ nombre: 'ROJO 100%' }, { nombre: 'ROJO CEREZA' }] });
    // "100%" es texto: casa con «ROJO 100%» y NO con todo lo que empiece por 100.
    const pagina = await listarColores(sesion(), { busqueda: '100%' }, bd());
    expect(pagina.total).toBe(1);
    expect(pagina.datos[0]?.nombre).toBe('ROJO 100%');
    // "_" tampoco es "cualquier carácter".
    expect((await listarColores(sesion(), { busqueda: 'ROJO_' }, bd())).total).toBe(0);
  });

  it('un texto con comilla y punto y coma es sólo texto (no rompe ni ejecuta nada)', async () => {
    await cliente.color.create({ data: { nombre: 'NEGRO' } });
    const pagina = await listarColores(sesion(), { busqueda: "x'; DROP TABLE colores; --" }, bd());
    expect(pagina.total).toBe(0);
    // La tabla sigue ahí y con su color.
    expect(await cliente.color.count()).toBe(1);
  });
});
