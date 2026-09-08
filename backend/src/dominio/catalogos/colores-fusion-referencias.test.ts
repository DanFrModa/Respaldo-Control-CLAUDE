/**
 * Tests UNIT de la CLASIFICACIÓN de lo que cuelga de un color (fila 0.159, §Post-F9.222).
 *
 * ⭐ La prueba que de verdad importa es la PRIMERA: lee `prisma/schema.prisma` y exige que la lista
 * del dominio cubra **todas** las relaciones entrantes de `model Color` menos `absorbidos`. Se
 * enumeraron estas referencias tres veces y las tres se enumeraron mal; esta prueba convierte el
 * cuarto olvido en un rojo de CI en vez de un hueco silencioso.
 *
 * ⚠️ Y ahora vigila una cosa más que antes: que cada relación diga **qué se hace con ella**. Antes
 * bastaba con nombrarla (todas bloqueaban igual); desde que la fusión repunta unas y deja otras con
 * rastro, una relación nueva mal clasificada no bloquea nada — se lleva o se deja un dato en
 * silencio. Por eso `repuntar` y `trato` se verifican como pareja obligatoria.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { REFERENCIAS_DE_COLOR } from './colores-fusion-referencias.js';

/** Tipos ESCALARES de Prisma: llevan inicial mayúscula pero no son una relación. */
const ESCALARES = new Set([
  'String',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'Boolean',
  'DateTime',
  'Json',
  'Bytes',
]);

/** Los `enum` declarados en el esquema: tampoco son relaciones aunque empiecen en mayúscula. */
function enumsDelEsquema(esquema: string): Set<string> {
  return new Set([...esquema.matchAll(/^enum ([A-Za-z0-9]+) \{/gm)].map((m) => m[1]!));
}

/** Nombres de las relaciones declaradas dentro de `model Color` en el esquema de Prisma. */
function relacionesDeModeloColor(): string[] {
  const ruta = fileURLToPath(new URL('../../../prisma/schema.prisma', import.meta.url));
  const esquema = readFileSync(ruta, 'utf8');
  const bloque = /^model Color \{$([\s\S]*?)^\}$/m.exec(esquema);
  if (bloque === null) throw new Error('No se encontró `model Color` en prisma/schema.prisma');
  const relaciones: string[] = [];
  for (const linea of bloque[1]!.split('\n')) {
    // ⭐ ronda 2 — se casan las DOS formas de una relación de vuelta: la de LISTA
    // (`nombre OtroModelo[]`, 1:N) y la OPCIONAL (`nombre OtroModelo?`, que es como se declara una
    // 1:1). Antes sólo la primera, así que una back-relation 1:1 futura se habría colado sin rojo —
    // el hueco que el reviewer señaló. Hoy no existe ninguna, y por eso ampliarlo no cambia el
    // resultado: es la red la que se ensancha, no la lista.
    //
    // 🔴 Y se DESCARTA el lado que declara `fields:`: ése es la llave foránea SALIENTE, no una
    // referencia entrante. Sin este filtro, `fusionadoEn Color? @relation(… fields: [idFusionadoEn]…)`
    // —el propio rastro de la fusión— entraría en la lista y la prueba exigiría clasificarlo, que
    // es justo lo contrario de lo que significa.
    if (linea.includes('fields:')) continue;
    const m = /^\s{2}([a-zA-Z][a-zA-Z0-9]*)\s+([A-Z][A-Za-z0-9]*)(\[\]|\?)/.exec(linea);
    if (m === null) continue;
    // Un `?` no basta para saber que es una relación: `idFusionadoEn Int?` y `creadoPorId String?`
    // casan igual. Se descartan los ESCALARES de Prisma y los ENUM declarados en el propio esquema,
    // que es lo único que puede aparecer con inicial mayúscula sin ser un modelo.
    if (ESCALARES.has(m[2]!) || enumsDelEsquema(esquema).has(m[2]!)) continue;
    relaciones.push(m[1]!);
  }
  return relaciones;
}

/**
 * La ÚNICA relación entrante de `Color` que a propósito no se clasifica: `absorbidos` (V1-E8s,
 * §Post-F9.143). No es un USO del color: es la contabilidad de la propia fusión (los colores que
 * ÉSTE se llevó). Repuntarla aplanaría la cadena reescribiendo un hecho histórico.
 *
 * ⚠️ Vive AQUÍ y no en el dominio a propósito: ampliar la excepción obliga a **editar la prueba**,
 * un acto visible en el diff. Si viviera junto a la lista, saltarse la red sería agregar una palabra
 * en el mismo archivo que el desarrollador ya está editando.
 */
const SIN_CLASIFICAR = ['absorbidos'];

describe('REFERENCIAS_DE_COLOR', () => {
  it('clasifica TODAS las relaciones entrantes de `model Color` menos la reflexiva de la fusión', () => {
    const enElEsquema = relacionesDeModeloColor();
    // Red de seguridad de la propia prueba: si el regex dejara de casar, esto lo delata. Y si un día
    // se quitara la relación reflexiva de la fusión, la exclusión dejaría de ser vacía sin avisar.
    expect(enElEsquema).toContain('telas');
    expect(enElEsquema).toContain('absorbidos');
    expect(enElEsquema).toContain('ordenLineas');
    expect(enElEsquema.length).toBeGreaterThan(5);

    const debenEstar = enElEsquema.filter((r) => !SIN_CLASIFICAR.includes(r)).sort();
    const cubiertas = REFERENCIAS_DE_COLOR.map((r) => r.relacion).sort();

    expect(cubiertas).toEqual(debenEstar);
  });

  it('no repite relaciones ni clasifica la reflexiva de la fusión', () => {
    const nombres = REFERENCIAS_DE_COLOR.map((r) => r.relacion);
    expect(new Set(nombres).size).toBe(nombres.length);
    for (const excluida of SIN_CLASIFICAR) {
      expect(nombres).not.toContain(excluida);
    }
  });

  it('cada referencia trae una etiqueta legible', () => {
    for (const r of REFERENCIAS_DE_COLOR) {
      expect(r.etiqueta.trim().length).toBeGreaterThan(3);
    }
  });

  it('`trato` y `repuntar` van SIEMPRE en pareja: repuntar sin función es un dato que se queda atrás', () => {
    for (const r of REFERENCIAS_DE_COLOR) {
      if (r.trato === 'repuntar') {
        expect(r.repuntar, `"${r.relacion}" dice repuntar pero no sabe cómo`).toBeTypeOf(
          'function',
        );
      } else {
        expect(r.repuntar, `"${r.relacion}" se queda con rastro pero trae repunte`).toBeUndefined();
      }
    }
  });

  it('las CUATRO que se repuntan son las de catálogo y amarres derivados, y ninguna más', () => {
    // Se fija la lista a propósito: agregar aquí una tabla de DOCUMENTOS (una línea de OC, la matriz
    // de la orden, un movimiento de kardex) significaría reescribir un hecho asentado, y eso tiene
    // que costar editar esta prueba y explicarlo.
    const repuntadas = REFERENCIAS_DE_COLOR.filter((r) => r.trato === 'repuntar').map(
      (r) => r.relacion,
    );
    expect(repuntadas.sort()).toEqual(
      ['modelosPorColor', 'ordenTelaColores', 'telaProveedorColores', 'telas'].sort(),
    );
  });

  it('la matriz de la orden y los movimientos asentados se quedan con RASTRO (D3/D7)', () => {
    const porRelacion = new Map(REFERENCIAS_DE_COLOR.map((r) => [r.relacion, r]));
    for (const relacion of [
      'ordenLineas',
      'etapasMovimientoDet',
      'movimientosDetPt',
      'cierresMaquilaDet',
      'ordenCompraLineasTalla',
      'ordenCompraLineasAvio',
      'inventarioCiclicoDet',
      'lotes',
    ]) {
      expect(porRelacion.get(relacion)?.trato, relacion).toBe('rastro');
    }
  });
});
