/**
 * 🔴 LA SEGURIDAD DEL REINTENTO DE `asegurar` — la pieza más peligrosa del sembrador.
 *
 * `asegurar` son TRES viajes separados a la base, no una unidad atómica:
 *
 *     leerDemo(mapeo)  →  crear()  →  anotarDemo(mapeo)
 *
 * Si el reintento de conexión envuelve los tres, hay dos ventanas en las que el error llega **con
 * el trabajo ya escrito**, y el reintento vuelve a llamar a `crear()`:
 *
 *  • **W1 — dentro de `crear()`, DESPUÉS de su commit.** Los servicios de movimientos
 *    (`ajustarInventarioTelaColor`, `traspasarTelaColor`, `ajustarInventarioAvio`, `traspasarAvio`)
 *    cierran su transacción y *después* leen lo creado para devolverlo (`obtenerMovimiento…`), una
 *    lectura FUERA de la transacción. Un `P2037`/`P2028` ahí llega con el movimiento ya guardado.
 *  • **W2 — en `anotarDemo`**, con `crear()` ya devuelto y el mapeo todavía sin escribir.
 *
 * En las dos, un reintento re-lee el mapeo, lo encuentra vacío y **crea otra vez**.
 *
 * ## Por qué esto es GRAVE y no una rareza
 *
 * Los cinco catálogos se salvan por su **llave única en la clave natural** (`Proveedor.nombre`,
 * `Tela.nombre`, `Avio.clave`, `Almacen @@unique([idEmpresa, nombre])`, `DireccionEntrega.nombre`):
 * el segundo `crear()` revienta con P2002 y se oye. **Los seis movimientos no tienen nada de eso**:
 * `Movimiento` es único sólo por `@@unique([idEmpresa, folio])` y el folio sale de la secuencia
 * atómica (A3), así que **cada reintento acuña uno nuevo** y el kardex cuenta la existencia dos
 * veces — en silencio, con el usuario viendo «Reintento en 2 s…» y un final feliz.
 *
 * ⇒ **La regla que fijan estas pruebas: el reintento NUNCA puede ejecutar `crear()` dos veces.**
 * Se reintentan sólo las LECTURAS (`leerDemo`/`sigueViva`), que no pueden escribir nada.
 * Si alguien vuelve a meter `crear()` dentro del reintento, estas pruebas se ponen rojas.
 */
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../../src/datos/index.js';

import { Marcador, asegurar } from './sembrar.js';
import { ENTIDAD_DEMO } from './datos.js';

/** Un error de conexión de los que SÍ reintenta `conReintentoConexion`. */
function errorConexion(code = 'P2037'): Error {
  return Object.assign(new Error(`fallo ${code}`), { code });
}

/**
 * Cliente falso con el mínimo que usa `asegurar`: `leerDemo` (findUnique) y `anotarDemo` (upsert).
 * `findUnique` devuelve siempre «no mapeado» salvo que se diga otra cosa.
 */
function clienteFalso(opciones?: {
  findUnique?: () => Promise<{ idNuevo: string } | null>;
  upsert?: () => Promise<unknown>;
}): PrismaClient {
  return {
    mapeoMigracion: {
      findUnique: vi.fn(opciones?.findUnique ?? (() => Promise.resolve(null))),
      upsert: vi.fn(opciones?.upsert ?? (() => Promise.resolve({}))),
    },
  } as unknown as PrismaClient;
}

const nuncaViva = (): Promise<boolean> => Promise.resolve(false);

describe('asegurar: el reintento no puede duplicar una creación', () => {
  it('🔴 W1 — si `crear()` falla por conexión (p. ej. tras su COMMIT), NO se le vuelve a llamar', async () => {
    // Esto imita a `ajustarInventarioTelaColor`: el movimiento YA se guardó y el error viene de la
    // lectura posterior. Re-crear aquí acuñaría un segundo folio y duplicaría la existencia.
    const crear = vi.fn(() => Promise.reject(errorConexion()));
    await expect(
      asegurar(clienteFalso(), ENTIDAD_DEMO.movimiento, 'MOV-01', nuncaViva, crear, new Marcador()),
    ).rejects.toMatchObject({ code: 'P2037' });
    expect(crear).toHaveBeenCalledTimes(1);
  });

  it('🔴 W2 — si `anotarDemo` falla por conexión, NO se vuelve a crear', async () => {
    const crear = vi.fn(() => Promise.resolve(101));
    const cliente = clienteFalso({ upsert: () => Promise.reject(errorConexion('P2028')) });
    await expect(
      asegurar(cliente, ENTIDAD_DEMO.movimiento, 'MOV-02', nuncaViva, crear, new Marcador()),
    ).rejects.toMatchObject({ code: 'P2028' });
    expect(crear).toHaveBeenCalledTimes(1);
  });

  it('🔴 tampoco se duplica cuando `sigueViva` falla DESPUÉS de haber creado en un intento previo', async () => {
    // `sigueViva` sólo se consulta cuando el mapeo ya existe; si truena, el reintento re-lee el
    // mapeo — pero jamás debe acabar llamando a `crear()` más de una vez.
    const crear = vi.fn(() => Promise.resolve(7));
    const cliente = clienteFalso({ findUnique: () => Promise.resolve({ idNuevo: '7' }) });
    const sigueViva = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(errorConexion())
      .mockResolvedValue(true);
    const m = new Marcador();
    await expect(
      asegurar(cliente, ENTIDAD_DEMO.movimiento, 'MOV-03', sigueViva, crear, m),
    ).resolves.toBe(7);
    expect(crear).not.toHaveBeenCalled();
    expect(m.existentes).toBe(1);
  });
});

describe('asegurar: lo que SÍ se reintenta son las lecturas', () => {
  it('reintenta `leerDemo` ante un tropiezo de conexión y sigue adelante', async () => {
    const findUnique = vi
      .fn<() => Promise<{ idNuevo: string } | null>>()
      .mockRejectedValueOnce(errorConexion())
      .mockResolvedValue(null);
    const crear = vi.fn(() => Promise.resolve(55));
    const m = new Marcador();
    await expect(
      asegurar(
        clienteFalso({ findUnique }),
        ENTIDAD_DEMO.proveedor,
        'PROV-01',
        nuncaViva,
        crear,
        m,
      ),
    ).resolves.toBe(55);
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(crear).toHaveBeenCalledTimes(1);
    expect(m.creados).toBe(1);
  });

  it('reintenta `sigueViva` ante un tropiezo de conexión', async () => {
    const sigueViva = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(errorConexion())
      .mockResolvedValue(true);
    const crear = vi.fn(() => Promise.resolve(0));
    await expect(
      asegurar(
        clienteFalso({ findUnique: () => Promise.resolve({ idNuevo: '9' }) }),
        ENTIDAD_DEMO.tela,
        'TELA-01',
        sigueViva,
        crear,
        new Marcador(),
      ),
    ).resolves.toBe(9);
    expect(sigueViva).toHaveBeenCalledTimes(2);
    expect(crear).not.toHaveBeenCalled();
  });

  it('reintenta `anotarDemo` (es un upsert idempotente) SIN volver a crear', async () => {
    // Cierra parte de W2: si crear() salió bien y el enlace tropieza al anotar, el reintento deja
    // el mapeo escrito en vez de abandonar la fila creada sin marca. Y NO re-crea.
    const upsert = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(errorConexion())
      .mockResolvedValue({});
    const crear = vi.fn(() => Promise.resolve(77));
    const m = new Marcador();
    await expect(
      asegurar(clienteFalso({ upsert }), ENTIDAD_DEMO.movimiento, 'MOV-04', nuncaViva, crear, m),
    ).resolves.toBe(77);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(crear).toHaveBeenCalledTimes(1);
    expect(m.creados).toBe(1);
  });

  it('un error de NEGOCIO sale a la primera, sin reintentos', async () => {
    const crear = vi.fn(() => Promise.reject(new Error('El proveedor debe tener al menos un rol')));
    await expect(
      asegurar(clienteFalso(), ENTIDAD_DEMO.proveedor, 'PROV-02', nuncaViva, crear, new Marcador()),
    ).rejects.toThrow(/al menos un rol/);
    expect(crear).toHaveBeenCalledTimes(1);
  });

  it('cuenta una sola vez aunque haya habido reintentos de lectura', async () => {
    const findUnique = vi
      .fn<() => Promise<{ idNuevo: string } | null>>()
      .mockRejectedValueOnce(errorConexion())
      .mockRejectedValueOnce(errorConexion())
      .mockResolvedValue(null);
    const m = new Marcador();
    await asegurar(
      clienteFalso({ findUnique }),
      ENTIDAD_DEMO.avio,
      'AVIO-01',
      nuncaViva,
      () => Promise.resolve(3),
      m,
    );
    expect(m.creados).toBe(1);
    expect(m.existentes).toBe(0);
  });
});
