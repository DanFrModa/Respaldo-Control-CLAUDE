/**
 * Pruebas de la RED que sostiene a todas las demás: `limpiarBaseDatos` (`contexto.ts`).
 *
 * Existen porque el borrado por `DELETE` + `session_replication_role = replica` (fila 0.208) puede
 * romper dos garantías **en silencio**, y un fallo silencioso aquí convierte la suite entera en
 * adorno:
 *
 *  1. **Las secuencias.** Si no se reinician, un id que aislado sale `1` sale `68` en la corrida
 *     completa: la prueba pasa sola y falla en CI. Ya pasó una vez.
 *  2. **`session_replication_role`.** Si la sesión se queda en `replica`, las pruebas siguientes
 *     **dejan de comprobar las claves foráneas** y nadie se entera.
 *
 * Cada prueba ataca UNA de las condiciones del código: quitarle la condición al arreglo tiene que
 * ponerlas rojas (`CLAUDE.md` §8, la cicatriz del 17-sep-2026).
 */
import { clientePruebas, crearEmpresaPrueba, limpiarBaseDatos } from './contexto.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const bd = clientePruebas();

afterAll(async () => {
  await bd.$disconnect();
});

beforeEach(async () => {
  await limpiarBaseDatos(bd);
});

describe('limpiarBaseDatos — reinicia las secuencias', () => {
  it('reinicia la secuencia de una columna autoincremental (el id vuelve a ser el mismo)', async () => {
    const primera = await crearEmpresaPrueba(bd, 'Empresa 1');
    await crearEmpresaPrueba(bd, 'Empresa 2');
    await crearEmpresaPrueba(bd, 'Empresa 3');

    await limpiarBaseDatos(bd);

    const despues = await crearEmpresaPrueba(bd, 'Empresa 1');
    expect(despues.id).toBe(primera.id);
  });

  it('reinicia también una secuencia INDEPENDIENTE (`CREATE SEQUENCE` + `nextval`)', async () => {
    // El `TRUNCATE … RESTART IDENTITY` de antes NO alcanzaba a éstas: es justo el defecto que
    // `contexto.ts` documenta haber sufrido. Hoy el esquema no tiene ninguna, así que la prueba se
    // crea la suya para que la garantía quede comprobada y no sólo escrita.
    await bd.$executeRawUnsafe('CREATE SEQUENCE IF NOT EXISTS zz_prueba_secuencia_suelta');
    try {
      const antes = await bd.$queryRawUnsafe<{ v: bigint }[]>(
        `SELECT nextval('zz_prueba_secuencia_suelta') AS v`,
      );
      await bd.$queryRawUnsafe(`SELECT nextval('zz_prueba_secuencia_suelta')`);
      await bd.$queryRawUnsafe(`SELECT nextval('zz_prueba_secuencia_suelta')`);

      await limpiarBaseDatos(bd);

      const despues = await bd.$queryRawUnsafe<{ v: bigint }[]>(
        `SELECT nextval('zz_prueba_secuencia_suelta') AS v`,
      );
      expect(Number(despues[0]!.v)).toBe(Number(antes[0]!.v));
    } finally {
      await bd.$executeRawUnsafe('DROP SEQUENCE IF EXISTS zz_prueba_secuencia_suelta');
    }
  });
});

describe('limpiarBaseDatos — `session_replication_role` vuelve a su sitio', () => {
  /** Lee el ajuste en 12 conexiones A LA VEZ: así no se mide sólo la que el pool tenga a mano. */
  async function rolEnTodoElPool(): Promise<string[]> {
    const lecturas = await Promise.all(
      Array.from({ length: 12 }, () =>
        bd.$queryRawUnsafe<{ rol: string }[]>(
          `SELECT current_setting('session_replication_role') AS rol`,
        ),
      ),
    );
    return lecturas.map((l) => l[0]!.rol);
  }

  /** La comprobación que de verdad importa: ¿siguen vivas las claves foráneas? */
  async function lasClavesForaneasSeSiguenComprobando(): Promise<boolean> {
    try {
      await bd.clienteDepartamento.create({ data: { idCliente: 999_999, nombre: 'huérfano' } });
      return false;
    } catch {
      return true;
    }
  }

  it('tras una limpieza NORMAL la sesión queda en `origin` y las FK siguen vivas', async () => {
    await limpiarBaseDatos(bd);

    expect(await rolEnTodoElPool()).toEqual(Array.from({ length: 12 }, () => 'origin'));
    expect(await lasClavesForaneasSeSiguenComprobando()).toBe(true);
  });

  it('aunque el borrado REVIENTE a media lista, la sesión queda en `origin` y las FK siguen vivas', async () => {
    // Una tabla que hace explotar el `DELETE` de verdad: el disparador va `ENABLE ALWAYS`, que es
    // la única forma de que se dispare aun con `session_replication_role = replica`. Con eso,
    // `limpiarBaseDatos` falla A MITAD del lote, con el rol ya cambiado — el escenario peligroso.
    await bd.$executeRawUnsafe(`CREATE TABLE zz_prueba_revienta (id integer PRIMARY KEY)`);
    try {
      await bd.$executeRawUnsafe(`
        CREATE FUNCTION zz_prueba_revienta_fn() RETURNS trigger LANGUAGE plpgsql AS $fn$
        BEGIN RAISE EXCEPTION 'revienta a propósito'; END $fn$`);
      await bd.$executeRawUnsafe(`
        CREATE TRIGGER zz_prueba_revienta_tg BEFORE DELETE ON zz_prueba_revienta
        FOR EACH ROW EXECUTE FUNCTION zz_prueba_revienta_fn()`);
      await bd.$executeRawUnsafe(
        `ALTER TABLE zz_prueba_revienta ENABLE ALWAYS TRIGGER zz_prueba_revienta_tg`,
      );
      await bd.$executeRawUnsafe(`INSERT INTO zz_prueba_revienta VALUES (1)`);

      await expect(limpiarBaseDatos(bd)).rejects.toThrow();

      expect(await rolEnTodoElPool()).toEqual(Array.from({ length: 12 }, () => 'origin'));
      expect(await lasClavesForaneasSeSiguenComprobando()).toBe(true);
    } finally {
      await bd.$executeRawUnsafe(`DROP TABLE IF EXISTS zz_prueba_revienta`);
      await bd.$executeRawUnsafe(`DROP FUNCTION IF EXISTS zz_prueba_revienta_fn()`);
    }
  });
});

describe('limpiarBaseDatos — borra sin que las claves foráneas le estorben', () => {
  it('vacía dos tablas que se apuntan entre sí, le toque a la que le toque primero', async () => {
    // Esto es lo que compra `session_replication_role = replica`: poder borrar las 178 tablas en el
    // orden ARBITRARIO del catálogo, sin ordenarlas por sus claves foráneas. Sin él, la limpieza
    // truena con un 23503 en cuanto una tabla con hijos le toca primero (medido el 18-sep-2026:
    // quitar esa línea deja 429 pruebas rojas en cinco archivos del dominio).
    //
    // ⚠️ El par se apunta MUTUAMENTE a propósito. Un padre y un hijo normales sólo valdrían si el
    // catálogo devolviera al padre primero, y **no lo garantiza** (se comprobó: devuelve el hijo
    // antes) ⇒ la prueba pasaría por el orden y no por el ajuste, o sea, no mediría nada. Con el
    // ciclo, el borrado truena en las DOS direcciones y el único modo de que salga bien es que las
    // claves foráneas estén saltadas.
    await bd.$executeRawUnsafe(`CREATE TABLE zz_prueba_a (id integer PRIMARY KEY, id_b integer)`);
    try {
      await bd.$executeRawUnsafe(`CREATE TABLE zz_prueba_b (id integer PRIMARY KEY, id_a integer)`);
      await bd.$executeRawUnsafe(
        `ALTER TABLE zz_prueba_a ADD CONSTRAINT zz_prueba_a_fk FOREIGN KEY (id_b) REFERENCES zz_prueba_b (id)`,
      );
      await bd.$executeRawUnsafe(
        `ALTER TABLE zz_prueba_b ADD CONSTRAINT zz_prueba_b_fk FOREIGN KEY (id_a) REFERENCES zz_prueba_a (id)`,
      );
      await bd.$executeRawUnsafe(`INSERT INTO zz_prueba_a VALUES (1, NULL)`);
      await bd.$executeRawUnsafe(`INSERT INTO zz_prueba_b VALUES (1, 1)`);
      await bd.$executeRawUnsafe(`UPDATE zz_prueba_a SET id_b = 1 WHERE id = 1`);

      await limpiarBaseDatos(bd);

      const quedan = await bd.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT (SELECT count(*) FROM zz_prueba_a) + (SELECT count(*) FROM zz_prueba_b) AS n`,
      );
      expect(Number(quedan[0]!.n)).toBe(0);
    } finally {
      await bd.$executeRawUnsafe(`DROP TABLE IF EXISTS zz_prueba_a, zz_prueba_b`);
    }
  });
});
