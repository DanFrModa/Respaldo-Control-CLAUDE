import { describe, expect, it, vi } from 'vitest';

import { ErrorConflicto, ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import type { ContextoBd, Tx } from '../../comun/transaccion.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import {
  actualizarTela,
  agregarColorATela,
  crearTela,
  crearTelaCategoria,
  crearTelaMigracion,
  desactivarTela,
  listarTelas,
  listarTelasCategorias,
} from './telas.js';

/**
 * Unit del dominio de Telas (F1-E3) — SIN Postgres. Cubre lo que NO necesita la base: el
 * guard de permisos (deny-by-default, §9.2) y la validación de captura que se rechaza
 * ANTES de tocar la base (Zod dentro de `validarEntrada`: nombre vacío, precio negativo,
 * NOMBRE de color repetido en la misma tela — §Post-F9.11: los colores son HIJOS de la
 * tela, no catálogo global). La integridad transaccional real (tela+colores todo-o-nada,
 * unicidad de nombre, idCategoria inexistente/inactiva, diff por nombre, borrado suave,
 * categoría en uso) se prueba contra Postgres en `telas.int.test.ts` (CI).
 *
 * Para las rutas que llegan a la base con permiso correcto, se usa un `tx` STUB envuelto
 * en `ContextoBd` (igual que el unit de Bordados): así se verifica la regla sin Postgres.
 */

const sesionAdmin = () => sesionDePrueba({ permisos: ['telas.ver', 'telas.administrar'] });
const sesionSoloVer = () => sesionDePrueba({ permisos: ['telas.ver'] });
const sesionSinPermisos = () => sesionDePrueba();

describe('dominio Telas — permisos (deny-by-default, §9.2)', () => {
  it('crear tela sin permiso administrar → ErrorPermiso (no toca la base)', async () => {
    await expect(
      crearTela(
        sesionSoloVer(),
        { nombre: 'Felpa', unidadMedida: 'KG', idProveedor: 1, colores: [] },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('sin ningún permiso no se puede ni listar telas ni categorías', async () => {
    await expect(listarTelas(sesionSinPermisos(), {}, {})).rejects.toBeInstanceOf(ErrorPermiso);
    await expect(listarTelasCategorias(sesionSinPermisos(), {}, {})).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });

  it('crear categoría de tela sin permiso administrar → ErrorPermiso', async () => {
    await expect(
      crearTelaCategoria(sesionSoloVer(), { nombre: 'Felpa' }, {}),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('desactivar tela sin permiso administrar → ErrorPermiso', async () => {
    await expect(desactivarTela(sesionSoloVer(), 1, {})).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('dominio Telas — validación de captura (rechazada antes de tocar la base)', () => {
  // `validarEntrada` corre ANTES de abrir transacción: estas entradas inválidas lanzan
  // ErrorValidacion sin que el `bd` (ausente) se use jamás.
  it('crear tela con nombre vacío → ErrorValidacion', async () => {
    await expect(
      crearTela(sesionAdmin(), { unidadMedida: 'KG', nombre: '   ', idProveedor: 1 }, {}),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('crear tela con NOMBRE de color repetido (aun cambiando mayúsculas) → ErrorValidacion', async () => {
    await expect(
      crearTela(
        sesionAdmin(),
        {
          nombre: 'Repe',
          unidadMedida: 'KG',
          idProveedor: 1,
          colores: [
            { nombre: 'Negro', precio: 1 },
            { nombre: 'NEGRO', precio: 2 },
          ],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('crear tela con precio de color negativo o nombre de color vacío → ErrorValidacion', async () => {
    await expect(
      crearTela(
        sesionAdmin(),
        {
          nombre: 'X',
          unidadMedida: 'KG',
          idProveedor: 1,
          colores: [{ nombre: 'Negro', precio: -5 }],
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    await expect(
      crearTela(
        sesionAdmin(),
        { nombre: 'X', unidadMedida: 'KG', idProveedor: 1, colores: [{ nombre: '   ' }] },
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('crear tela SIN proveedor → ErrorValidacion (el contrato lo exige, §Post-F9.11)', async () => {
    await expect(
      // El TIPO estricto ya lo caza (H8); se fuerza para probar el rechazo en runtime.
      crearTela(
        sesionAdmin(),
        { nombre: 'Sin dueño', unidadMedida: 'KG', colores: [] } as never,
        {},
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  // A1.1 (ronda de corrección): sin tope, un peso/ancho ≥ 1,000,000 desbordaría el
  // DECIMAL(8,2) de la base y daría un 500 opaco; el contrato lo corta con un 400 cuyo
  // `detalles.fieldErrors` trae el mensaje LEGIBLE por campo (formato de `validarEntrada`).
  it('crear tela con peso o ancho que desbordan el DECIMAL(8,2) → ErrorValidacion legible', async () => {
    const errorPeso: unknown = await crearTela(
      sesionAdmin(),
      { nombre: 'Pesada', unidadMedida: 'KG', idProveedor: 1, peso: 1_000_000 },
      {},
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(errorPeso).toBeInstanceOf(ErrorValidacion);
    expect((errorPeso as ErrorValidacion).detalles).toMatchObject({
      fieldErrors: { peso: ['El peso no puede ser más de 99,999.99 gr/m²'] },
    });

    const errorAncho: unknown = await crearTela(
      sesionAdmin(),
      { nombre: 'Ancha', unidadMedida: 'KG', idProveedor: 1, ancho: 100_000 },
      {},
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(errorAncho).toBeInstanceOf(ErrorValidacion);
    expect((errorAncho as ErrorValidacion).detalles).toMatchObject({
      fieldErrors: { ancho: ['El ancho no puede ser más de 99,999.99 m'] },
    });

    // Y en EDICIÓN el mismo tope aplica (el PATCH valida antes de tocar la base).
    await expect(
      actualizarTela(sesionAdmin(), { id: 1, peso: 1_000_000 }, {}),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('crear categoría con nombre vacío → ErrorValidacion', async () => {
    await expect(crearTelaCategoria(sesionAdmin(), { nombre: '  ' }, {})).rejects.toBeInstanceOf(
      ErrorValidacion,
    );
  });
});

describe('dominio Telas — invariantes con tx stub (sin Postgres)', () => {
  /**
   * Stub mínimo de transacción para un ALTA de tela: nombre libre, sin categoría, proveedor
   * activo. `bd` envuelve el `tx` para que `enTransaccion` lo reutilice (no abre una real).
   */
  function bdParaAlta(): { bd: ContextoBd; telaCreate: ReturnType<typeof vi.fn> } {
    const telaCreate = vi.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 1, nombreComplemento: null, ...args.data }),
    );
    const tx = {
      tela: {
        findFirst: vi.fn(() => Promise.resolve(null)), // nombre libre
        create: telaCreate,
        findUniqueOrThrow: vi.fn(() =>
          Promise.resolve({
            id: 1,
            colores: [],
            categoria: null,
            composicion: null,
            proveedor: null,
          }),
        ),
      },
      proveedor: {
        findUnique: vi.fn(() => Promise.resolve({ nombre: 'Alsatex', activo: true })),
      },
      telaColor: { findMany: vi.fn(() => Promise.resolve([])), createMany: vi.fn() },
      bitacora: { create: vi.fn(() => Promise.resolve({})) },
    } as unknown as Tx;
    return { bd: { tx }, telaCreate };
  }

  // H2 (invariante A1): el precio del complemento SOLO existe si la tela lo lleva.
  it('rechaza precio de complemento en el ALTA si la tela NO lleva complemento', async () => {
    const { bd, telaCreate } = bdParaAlta();
    await expect(
      crearTela(
        sesionAdmin(),
        {
          nombre: 'Lisa',
          unidadMedida: 'KG',
          idProveedor: 7,
          colores: [{ nombre: 'Negro', precioComplemento: 55 }],
        },
        bd,
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    // El rechazo es ANTES de crear nada (la coherencia se valida primero).
    expect(telaCreate).not.toHaveBeenCalled();
  });

  it('con el complemento DECLARADO, el precio del complemento sí pasa', async () => {
    const { bd, telaCreate } = bdParaAlta();
    await expect(
      crearTela(
        sesionAdmin(),
        {
          nombre: 'Felpa',
          unidadMedida: 'KG',
          idProveedor: 7,
          nombreComplemento: 'Cardigan',
          colores: [{ nombre: 'Negro', precioComplemento: 55 }],
        },
        bd,
      ),
    ).resolves.toBeTruthy();
    expect(telaCreate).toHaveBeenCalledTimes(1);
  });

  it('el modo MIGRACIÓN (`crearTelaMigracion`) permite omitir el proveedor (ETL)', async () => {
    const { bd, telaCreate } = bdParaAlta();
    await expect(
      crearTelaMigracion(
        sesionAdmin(),
        { nombre: 'FelpaAlsa100', unidadMedida: 'KG', colores: [] },
        bd,
      ),
    ).resolves.toBeTruthy();
    expect(telaCreate).toHaveBeenCalledTimes(1);
  });
});

/**
 * ⭐⭐ **V1-E6b (§Post-F9.106) — AGREGAR UN COLOR A UNA TELA, DESDE LA COMPRA.**
 *
 * 🔴🔴 **La prueba que de verdad importa es que NO BORRE.** La gestión de colores de una tela es
 * SET-COMPLETO (`sincronizarColores`: lo que no viene en la lista, se borra), así que reusar ese
 * camino con el único color que el comprador acaba de teclear habría **borrado los demás colores
 * de esa tela**. Este bloque monta un `tx` STUB (sin Postgres) y vigila los espías de `deleteMany`
 * y `update`: si alguien "simplifica" esta función para que delegue en el grid, se ponen rojos.
 *
 * Lo transaccional de verdad (unique `[idTela, nombre]`, el advisory lock serializando dos altas
 * simultáneas, la bitácora escrita) se prueba contra Postgres en `telas.int.test.ts` (CI).
 */
describe('dominio Telas — agregar UN color (aditivo, §Post-F9.106)', () => {
  /**
   * ⚖️ **Quien da de alta el color es QUIEN COMPRA** (`compras.administrar`), no quien administra
   * el catálogo. Por eso estas sesiones son distintas de las del resto del archivo: la del
   * comprador NO trae `telas.administrar` —Aurora, rol Gerencial, no lo tiene— y aun así tiene que
   * poder; y la del administrador de catálogo SIN `compras.administrar` tiene que ser rechazada.
   */
  const sesionComprador = () => sesionDePrueba({ permisos: ['compras.administrar'] });
  const sesionSoloCatalogo = () => sesionDePrueba({ permisos: ['telas.ver', 'telas.administrar'] });

  /** Un decimal de Prisma de mentiras: lo único que el dominio le pide es `toNumber()`. */
  const decimal = (valor: number): { toNumber: () => number } => ({ toNumber: () => valor });

  /**
   * Stub de una tela que YA TIENE dos colores (los que no se pueden perder). `nombreComplemento`
   * decide si el precio de complemento es coherente.
   */
  function bdParaAgregar(opciones?: { nombreComplemento?: string | null }) {
    const telaColorCreate = vi.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: 501,
        nombre: args.data.nombre as string,
        pantone: (args.data.pantone as string | undefined) ?? null,
        precio: args.data.precio === undefined ? null : decimal(args.data.precio as number),
        precioComplemento:
          args.data.precioComplemento === undefined
            ? null
            : decimal(args.data.precioComplemento as number),
        idColor: null,
      }),
    );
    const telaColorDeleteMany = vi.fn(() => Promise.resolve({ count: 0 }));
    const telaColorUpdate = vi.fn(() => Promise.resolve({}));
    const telaColorCreateMany = vi.fn(() => Promise.resolve({ count: 0 }));
    const telaColorFindMany = vi.fn(() =>
      Promise.resolve([
        { id: 77, nombre: 'Grana 7700' },
        { id: 78, nombre: 'Marino Alsa 3040' },
      ]),
    );
    const bloqueo = vi.fn(() => Promise.resolve(1));
    const bitacoraCreate = vi.fn(() => Promise.resolve({}));
    const tx = {
      $executeRaw: bloqueo,
      tela: {
        findUnique: vi.fn(() =>
          Promise.resolve({
            id: 4,
            nombre: 'Felpa Suiza',
            nombreComplemento: opciones?.nombreComplemento ?? null,
          }),
        ),
      },
      telaColor: {
        findMany: telaColorFindMany,
        create: telaColorCreate,
        createMany: telaColorCreateMany,
        deleteMany: telaColorDeleteMany,
        update: telaColorUpdate,
      },
      bitacora: { create: bitacoraCreate },
    } as unknown as Tx;
    return {
      bd: { tx } as ContextoBd,
      telaColorCreate,
      telaColorDeleteMany,
      telaColorUpdate,
      telaColorCreateMany,
      bloqueo,
      bitacoraCreate,
    };
  }

  // 🔴🔴 LA TRAMPA DE LA ETAPA, EN UNA ASERCIÓN.
  it('🔴 NO borra ni reescribe los colores que la tela ya tenía: sólo crea el nuevo', async () => {
    const { bd, telaColorCreate, telaColorDeleteMany, telaColorUpdate, telaColorCreateMany } =
      bdParaAgregar();

    const creado = await agregarColorATela(
      sesionComprador(),
      4,
      { nombre: 'Verde Bandera', pantone: '19-4027' },
      bd,
    );

    expect(telaColorDeleteMany).not.toHaveBeenCalled();
    expect(telaColorUpdate).not.toHaveBeenCalled();
    expect(telaColorCreateMany).not.toHaveBeenCalled();
    expect(telaColorCreate).toHaveBeenCalledTimes(1);
    const [args] = telaColorCreate.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(args.data.idTela).toBe(4);
    expect(args.data.nombre).toBe('Verde Bandera');
    expect(args.data.pantone).toBe('19-4027');
    // §Post-F9.11: el color de tela NO cuelga del catálogo de prenda, ni siquiera cuando su nombre
    // vino precargado del color de la OP.
    expect(args.data.idColor).toBeUndefined();
    expect(creado.id).toBe(501);
  });

  it('serializa contra el grid: toma el bloqueo POR TELA antes de leer y escribir', async () => {
    const { bd, bloqueo } = bdParaAgregar();
    await agregarColorATela(sesionComprador(), 4, { nombre: 'Verde Bandera' }, bd);
    expect(bloqueo).toHaveBeenCalledTimes(1);
  });

  it('el precio y el precio de complemento NO son obligatorios (§Post-F9.106)', async () => {
    const { bd, telaColorCreate } = bdParaAgregar();
    await expect(
      agregarColorATela(sesionComprador(), 4, { nombre: 'Verde Bandera' }, bd),
    ).resolves.toBeTruthy();
    const [args] = telaColorCreate.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(args.data.precio).toBeUndefined();
    expect(args.data.precioComplemento).toBeUndefined();
  });

  it('el pantone vacío se guarda como NULL, nunca como cadena vacía', async () => {
    const { bd, telaColorCreate } = bdParaAgregar();
    await agregarColorATela(sesionComprador(), 4, { nombre: 'Verde Bandera', pantone: '' }, bd);
    const [args] = telaColorCreate.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(args.data.pantone).toBeUndefined();
  });

  // El nombre repetido NO se sobrescribe ni se devuelve en silencio: se dice (409) para que lo que
  // el comprador acaba de teclear no se pierda creyendo que se guardó.
  it('nombre repetido en la MISMA tela (aunque cambien mayúsculas y espacios) → ErrorConflicto', async () => {
    const { bd, telaColorCreate } = bdParaAgregar();
    await expect(
      agregarColorATela(sesionComprador(), 4, { nombre: '  marino alsa 3040 ' }, bd),
    ).rejects.toBeInstanceOf(ErrorConflicto);
    expect(telaColorCreate).not.toHaveBeenCalled();
  });

  it('precio de complemento en una tela que NO lleva complemento → ErrorValidacion (no crea nada)', async () => {
    const { bd, telaColorCreate } = bdParaAgregar({ nombreComplemento: null });
    await expect(
      agregarColorATela(
        sesionComprador(),
        4,
        { nombre: 'Verde Bandera', precioComplemento: 55 },
        bd,
      ),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(telaColorCreate).not.toHaveBeenCalled();
  });

  it('con el complemento declarado, su precio sí pasa', async () => {
    const { bd, telaColorCreate } = bdParaAgregar({ nombreComplemento: 'Cardigan' });
    await expect(
      agregarColorATela(
        sesionComprador(),
        4,
        { nombre: 'Verde Bandera', precioComplemento: 55 },
        bd,
      ),
    ).resolves.toBeTruthy();
    expect(telaColorCreate).toHaveBeenCalledTimes(1);
  });

  it('nombre vacío → ErrorValidacion ANTES de tocar la base', async () => {
    const { bd, bloqueo, telaColorCreate } = bdParaAgregar();
    await expect(
      agregarColorATela(sesionComprador(), 4, { nombre: '   ' }, bd),
    ).rejects.toBeInstanceOf(ErrorValidacion);
    expect(bloqueo).not.toHaveBeenCalled();
    expect(telaColorCreate).not.toHaveBeenCalled();
  });

  // §Post-F9.68 — esconder Y bloquear: la UI no pinta la opción, y el servidor la rechaza igual.
  it('sin `compras.administrar` → ErrorPermiso (el `telas.ver` no alcanza)', async () => {
    const { bd, bloqueo, telaColorCreate } = bdParaAgregar();
    await expect(
      agregarColorATela(sesionSoloVer(), 4, { nombre: 'Verde Bandera' }, bd),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    expect(bloqueo).not.toHaveBeenCalled();
    expect(telaColorCreate).not.toHaveBeenCalled();
  });

  /**
   * ⚖️⚖️ **LA PRUEBA QUE FIJA EL GIRO DEL 25-AGO-2026, EN LOS DOS SENTIDOS.**
   *
   * 🔴 Si alguien "corrige" el permiso de vuelta a `telas.administrar` por simetría con el resto
   * del catálogo, estas dos aserciones se ponen rojas y dicen por qué no: **quien compra tiene que
   * poder** (Aurora, rol Gerencial, NO tiene `telas.administrar`) y **administrar el catálogo NO
   * basta por sí solo** para esta puerta, que es de la compra.
   */
  it('⚖️ lo abre COMPRAS: el comprador sin `telas.administrar` SÍ puede; el catálogo solo, NO', async () => {
    const conCompras = bdParaAgregar();
    await expect(
      agregarColorATela(sesionComprador(), 4, { nombre: 'Verde Bandera' }, conCompras.bd),
    ).resolves.toBeTruthy();
    expect(conCompras.telaColorCreate).toHaveBeenCalledTimes(1);

    const soloCatalogo = bdParaAgregar();
    await expect(
      agregarColorATela(sesionSoloCatalogo(), 4, { nombre: 'Verde Bandera' }, soloCatalogo.bd),
    ).rejects.toBeInstanceOf(ErrorPermiso);
    expect(soloCatalogo.telaColorCreate).not.toHaveBeenCalled();
  });
});
