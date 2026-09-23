import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { cancelarOC, crearOC, listarOC } from './ordenes-compra.js';

/**
 * Unit del dominio de Órdenes de COMPRA (F4-E2) — SIN Postgres. Cubre lo que NO necesita la base: el
 * guard de permisos (deny-by-default, A4) y la validación de captura por Zod que falla ANTES de
 * tocar la base (cancelar sin motivo, precio/cantidad inválidos). La integridad transaccional real
 * (folio por empresa, XOR, matriz suma=cantidad, autorización, total derivado) se prueba
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
