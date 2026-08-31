import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { cancelarOC, crearOC, listarOC, motivoNoDuplicarOc } from './ordenes-compra.js';

/**
 * Unit del dominio de Órdenes de COMPRA (F4-E2) — SIN Postgres. Cubre lo que NO necesita la base: el
 * guard de permisos (deny-by-default, A4) y la validación de captura por Zod que falla ANTES de
 * tocar la base (cancelar sin motivo, precio/cantidad inválidos). La integridad transaccional real
 * (folio por empresa, XOR, matriz suma=cantidad, autorización, duplicado, total derivado) se prueba
 * contra Postgres en `ordenes-compra.int.test.ts` (CI).
 */

const sesionAdmin = () =>
  sesionDePrueba({ permisos: ['compras.ver', 'compras.administrar', 'compras.cancelar'] });
const sesionSoloVer = () => sesionDePrueba({ permisos: ['compras.ver'] });

/**
 * Encabezado mínimo que TODA OC nueva exige desde §Post-F9.18: fecha de entrega obligatoria y
 * dirección de entrega del catálogo. Aquí los ids son ficticios: estas pruebas fallan por permiso o
 * por Zod ANTES de tocar la base, así que nunca se resuelven contra el catálogo real.
 */
const encabezadoOc = { fechaEntrega: '2026-09-30', idDireccionEntrega: 1 } as const;

describe('OC unit — permisos (A4, deny-by-default)', () => {
  it('crearOC sin compras.administrar lanza ErrorPermiso (antes de la BD)', async () => {
    await expect(
      crearOC(sesionSoloVer(), { ...encabezadoOc, idProveedor: 1, lineas: [] }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('listarOC sin compras.ver lanza ErrorPermiso', async () => {
    await expect(listarOC(sesionDePrueba({ permisos: [] }))).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('cancelarOC sin compras.cancelar lanza ErrorPermiso', async () => {
    await expect(cancelarOC(sesionSoloVer(), 1, { motivo: 'x' })).rejects.toBeInstanceOf(
      ErrorPermiso,
    );
  });
});

describe('OC unit — validación de captura (Zod, antes de la BD)', () => {
  it('cancelarOC sin motivo lanza ErrorValidacion', async () => {
    await expect(
      // @ts-expect-error: motivo es obligatorio; probamos la validación en runtime
      cancelarOC(sesionDePrueba({ permisos: ['compras.cancelar'] }), 1, {}),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('crearOC con precio negativo lanza ErrorValidacion', async () => {
    await expect(
      crearOC(sesionAdmin(), {
        ...encabezadoOc,
        idProveedor: 1,
        lineas: [{ idTela: 1, cantidad: 1, precio: -5 }],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('crearOC con cantidad cero lanza ErrorValidacion', async () => {
    await expect(
      crearOC(sesionAdmin(), {
        ...encabezadoOc,
        idProveedor: 1,
        lineas: [{ idTela: 1, cantidad: 0, precio: 5 }],
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});

/**
 * ⭐⭐ **V1-E4f (§Post-F9.103) — DUPLICAR ERA LA PUERTA QUE QUEDABA ABIERTA.** Daniel: *"tiene que
 * tener fecha de entrega a fuerzas"*. El alta manual y la explosión ya lo cumplían (el contrato
 * exige la fecha en `crearOC`, y `planearCompra` devuelve la falta como bloqueo), pero **duplicar
 * copiaba `fechaEntrega` tal cual**: duplicar una de las 7,978 OC migradas sin fecha paría hoy una
 * OC NUEVA sin fecha. (⚠️ Esas OC migradas **no nacen todas `autorizada`**, como se llegó a escribir
 * aquí: `estatusOCMigrada` reparte **`cancelada` > `autorizada` > `borrador`** — y de esa premisa al
 * revés salió el defecto que el reviewer cazó en la rama `cancelada`.)
 *
 * ⚠️ Esto NO toca a la OC vieja (decisión (e): la regla es prospectiva); sólo impide que su defecto
 * se propague a una nueva. Que `duplicarOC` de verdad lo consulte se prueba contra Postgres en
 * `ordenes-compra.int.test.ts` (aquí no hay base): esto fija LA REGLA y su mensaje.
 */
describe('OC unit — V1-E4f (§Post-F9.103): no se duplica una OC sin fecha de entrega', () => {
  it('🔴 sin fecha de entrega hay motivo para NO duplicar, y dice cómo arreglarlo', () => {
    // En BORRADOR el comprador SÍ puede capturarle la fecha él mismo: el mensaje se queda corto.
    const motivo = motivoNoDuplicarOc({ fechaEntrega: null, estatus: 'borrador' });
    expect(motivo).not.toBeNull();
    // No basta con negarse: el mensaje manda a capturarle la fecha al ORIGINAL y volver a duplicar
    // (si sólo dijera "no se puede", el comprador se queda sin salida).
    expect(motivo).toContain('fecha de entrega');
    expect(motivo).toMatch(/vuelve a duplicarla/i);
    expect(motivo).not.toMatch(/administrador/i);
  });

  it('con fecha, no hay nada que impedir: la copia la hereda', () => {
    expect(
      motivoNoDuplicarOc({ fechaEntrega: new Date('2026-09-30T00:00:00Z'), estatus: 'autorizada' }),
    ).toBeNull();
  });

  /**
   * 🔴🔴 **EL CALLEJÓN SIN SALIDA.** El ETL le hereda a cada OC migrada el estatus que traía del
   * sistema viejo —`estatusOCMigrada`: **`cancelada` > `autorizada` > `borrador`**, en ese orden—,
   * y sobre una OC fuera de `ESTATUS_EDITABLES_NORMAL` `actualizarOC` sólo deja editar al **admin**.
   * O sea que el consejo *"captúrasela primero"* está CERRADO justo para las que lo necesitan: sin
   * esta frase, el comprador da la vuelta completa para toparse con otro "no" — el sistema
   * echándole la culpa de algo que él no podía hacer. Un mensaje que ofrece una salida cerrada es
   * PEOR que uno que no ofrece ninguna.
   */
  it('🔴🔴 si el original ya NO es editable, dice que esa captura la hace un ADMINISTRADOR', () => {
    for (const estatus of ['autorizada', 'recibida_parcial', 'recibida_total']) {
      const motivo = motivoNoDuplicarOc({ fechaEntrega: null, estatus });
      // Sigue diciendo qué falta y qué hacer…
      expect(motivo).toMatch(/vuelve a duplicarla/i);
      // …y además, QUIÉN puede hacerlo (con el estatus que cerró la puerta, para que se entienda).
      expect(motivo).toMatch(/administrador/i);
      expect(motivo).toContain(estatus);
    }
  });

  /**
   * 🔴🔴 **Y LA CANCELADA NO LA EDITA NADIE — TAMPOCO UN ADMINISTRADOR** (hallazgo del reviewer).
   * `actualizarOC` rechaza la cancelada **antes** de mirar quién eres (*"La orden de compra está
   * cancelada; no se puede modificar"*) y `cancelada` es terminal: el dominio no des-cancela. Así
   * que prometer ahí un administrador es **mentir**, y manda al comprador por la misma puerta
   * cerrada que este mensaje existe para evitar.
   *
   * ⚠️ **No es teórico:** `estatusOCMigrada` deja `cancelada` en su PRIMERA rama y el ETL escribe
   * `fechaEntrega: null` con el CSV en blanco; `duplicarOC` no tiene guarda de estatus, así que
   * *"rehacer esa compra que se canceló"* es un flujo legítimo — y era el que acababa en el
   * callejón.
   *
   * ⚠️ **La raíz:** este archivo copió de `actualizarOC` el predicado
   * `!ESTATUS_EDITABLES_NORMAL.includes(estatus)` **sin la guarda de la línea de arriba**, que es la
   * única razón por la que allá significa *"sólo un admin"*. La misma lista, despojada de su guarda.
   */
  it('🔴🔴 la CANCELADA no promete administrador: manda a capturar la orden nueva a mano', () => {
    const motivo = motivoNoDuplicarOc({ fechaEntrega: null, estatus: 'cancelada' });
    expect(motivo).not.toBeNull();
    // Sigue diciendo QUÉ falta…
    expect(motivo).toContain('fecha de entrega');
    // …dice por qué esta vez no hay nada que corregir en el original…
    expect(motivo).toMatch(/cancelada/i);
    // …🔴 y NO promete un administrador (a ésta no la edita nadie) ni manda a «Editar» y volver a
    // duplicar: los dos caminos están cerrados.
    expect(motivo).not.toMatch(/administrador/i);
    expect(motivo).not.toMatch(/vuelve a duplicarla/i);
    // La salida que SÍ existe: levantar la compra a mano.
    expect(motivo).toMatch(/Compras › Nueva/);
  });

  /** Y en `pendiente_autorizacion` tampoco sobra la mención: ahí el comprador todavía puede. */
  it('en pendiente_autorizacion NO se menciona al administrador (el comprador puede)', () => {
    expect(
      motivoNoDuplicarOc({ fechaEntrega: null, estatus: 'pendiente_autorizacion' }),
    ).not.toMatch(/administrador/i);
  });
});

/**
 * ⭐⭐⭐ V1-E8z / H1 — **GUARDIÁN DE COLOCACIÓN DEL CANDADO DE COMPRA** (hallazgo del reviewer).
 *
 * 🔴 EL DEFECTO QUE VIGILA, con nombre y apellido. El candado (§Post-F9.160(a)) empezó viviendo
 * DENTRO de `exigirRecetaLiberada`, y por eso **heredó la exención de `agregaLineas`**: la edición
 * que *"conserva la identidad"* (misma línea, otra cantidad u otro precio) hace `continue` **antes**
 * de llamar a la puerta. Esa exención se justificó para la FIRMA —*"un material que la receta
 * firmada sí incluía"*— y esa razón **no transfiere al candado**, cuya premisa es que esa receta
 * firmada está BAJO CORRECCIÓN. Medido: `cantidad: 100 → 5000` sobre una orden congelada pasaba.
 *
 * ⚠️ **POR QUÉ UN GUARDIÁN ESTRUCTURAL Y NO SÓLO LA PRUEBA DE INTEGRACIÓN.** El caso real vive en
 * `receta-orden.int.test.ts` («SUBIR la cantidad de una línea YA existente»), donde se puede comprar
 * de verdad; pero esa prueba necesita Postgres y **sólo corre en CI**. Este guardián corre en el
 * `test:unit` de cualquiera, es determinista, y falla por la razón EXACTA: alguien volvió a meter el
 * candado dentro del bucle exento. Es el mismo recurso que ya usa el repo cuando el peligro es la
 * FORMA del código y no su resultado (`receta-embudo.test.ts`, y la cuenta de rutas de
 * `receta-orden.rutas.test.ts`).
 */
describe('⭐⭐ V1-E8z (H1) — el candado va FUERA del bucle exento por `agregaLineas`', () => {
  const fuente = readFileSync(new URL('./ordenes-compra.ts', import.meta.url), 'utf8');

  it('el candado se llama sobre TODAS las órdenes ligadas, no orden por orden dentro del bucle', () => {
    const candado = fuente.indexOf(
      'await exigirComprasNoCongeladas(tx, idsOrdenLigada, idEmpresa)',
    );
    const bucleExento = fuente.indexOf('if (!agregaLineas(');

    // Los dos anclajes tienen que existir: si alguno se renombra, esta prueba lo dice en vez de
    // pasar en verde comparando -1 contra -1.
    expect(candado).toBeGreaterThan(-1);
    expect(bucleExento).toBeGreaterThan(-1);
    // 🔴 LA INVARIANTE: el candado ANTES del `continue` que exime a la edición que conserva
    // identidad. Si vuelve adentro, la cantidad se puede subir sin tope con la compra congelada.
    expect(candado).toBeLessThan(bucleExento);
  });

  it('⚠️ y NO se cuela dentro de `exigirRecetaLiberada`: ahí volvería a heredar la exención', () => {
    // La llamada a la puerta de la firma sigue DENTRO del bucle (ahí la exención sí es legítima):
    // lo que no puede es ser el único sitio donde el candado se comprueba.
    const puertaFirma = fuente.indexOf('await exigirRecetaLiberada(tx, idOrden, idEmpresa)');
    const candado = fuente.indexOf(
      'await exigirComprasNoCongeladas(tx, idsOrdenLigada, idEmpresa)',
    );
    expect(puertaFirma).toBeGreaterThan(-1);
    expect(candado).toBeLessThan(puertaFirma);
  });
});
