/**
 * Tests UNIT de la guarda que impide fusionar un color YA EN USO (§Post-F9.129).
 *
 * ⭐ La prueba que de verdad importa es la PRIMERA: lee `prisma/schema.prisma` y exige que la lista
 * del dominio cubra **todas** las relaciones entrantes de `model Color` menos `telas`. Se enumeraron
 * estas referencias tres veces y las tres se enumeraron mal; esta prueba convierte el cuarto olvido
 * en un rojo de CI en vez de un hueco silencioso.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  REFERENCIAS_QUE_BLOQUEAN_FUSION,
  mensajeFusionBloqueada,
} from './colores-fusion-referencias.js';

/** Nombres de las relaciones declaradas dentro de `model Color` en el esquema de Prisma. */
function relacionesDeModeloColor(): string[] {
  const ruta = fileURLToPath(new URL('../../../prisma/schema.prisma', import.meta.url));
  const esquema = readFileSync(ruta, 'utf8');
  const bloque = /^model Color \{$([\s\S]*?)^\}$/m.exec(esquema);
  if (bloque === null) throw new Error('No se encontró `model Color` en prisma/schema.prisma');
  const relaciones: string[] = [];
  for (const linea of bloque[1]!.split('\n')) {
    // Una relación de vuelta se declara `nombre  OtroModelo[]` (lista, sin `@relation` de FK).
    const m = /^\s{2}([a-zA-Z][a-zA-Z0-9]*)\s+[A-Z][A-Za-z0-9]*\[\]/.exec(linea);
    if (m !== null) relaciones.push(m[1]!);
  }
  return relaciones;
}

/**
 * Las relaciones entrantes de `Color` que a propósito NO bloquean la fusión:
 *  • `telas` (`TelaColor`) — la única que la fusión SÍ sabe reasignar al destino.
 *  • `absorbidos` (V1-E8s, §Post-F9.143) — no es un USO del color: es la contabilidad de la propia
 *    fusión (los colores que ÉSTE se llevó). Bloquear por ella impediría encadenar «A→B» y luego
 *    «B→C», que es legítimo y que `colorCanonico` sabe recorrer.
 */
const NO_BLOQUEAN = ['telas', 'absorbidos'];

describe('REFERENCIAS_QUE_BLOQUEAN_FUSION', () => {
  it('cubre TODAS las relaciones entrantes de `model Color` menos las que a propósito no bloquean', () => {
    const enElEsquema = relacionesDeModeloColor();
    // Red de seguridad de la propia prueba: si el regex dejara de casar, esto lo delata. Y si un día
    // se quitara la relación reflexiva de la fusión, la exclusión dejaría de ser vacía sin avisar.
    expect(enElEsquema).toContain('telas');
    expect(enElEsquema).toContain('absorbidos');
    expect(enElEsquema).toContain('ordenLineas');
    expect(enElEsquema.length).toBeGreaterThan(5);

    const debenBloquear = enElEsquema.filter((r) => !NO_BLOQUEAN.includes(r)).sort();
    const cubiertas = REFERENCIAS_QUE_BLOQUEAN_FUSION.map((r) => r.relacion).sort();

    expect(cubiertas).toEqual(debenBloquear);
  });

  it('no repite relaciones ni incluye las que la fusión sí sabe manejar', () => {
    const nombres = REFERENCIAS_QUE_BLOQUEAN_FUSION.map((r) => r.relacion);
    expect(new Set(nombres).size).toBe(nombres.length);
    for (const excluida of NO_BLOQUEAN) {
      expect(nombres).not.toContain(excluida);
    }
  });

  it('cada referencia trae una etiqueta legible para el mensaje', () => {
    for (const r of REFERENCIAS_QUE_BLOQUEAN_FUSION) {
      expect(r.etiqueta.trim().length).toBeGreaterThan(3);
    }
  });
});

describe('mensajeFusionBloqueada', () => {
  it('nombra el color, cada uso con su cuenta, y el camino de salida', () => {
    const mensaje = mensajeFusionBloqueada('Negro A', [
      { etiqueta: 'órdenes de producción', cuenta: 3 },
      { etiqueta: 'movimientos de inventario de producto terminado', cuenta: 12 },
    ]);

    expect(mensaje).toContain('"Negro A"');
    expect(mensaje).toContain('3 órdenes de producción');
    expect(mensaje).toContain('12 movimientos de inventario de producto terminado');
    // El camino de salida: por qué no se puede y a dónde ir.
    expect(mensaje).toContain('color apagado');
    expect(mensaje).toContain('§Post-F9.129');
  });

  it('con un solo uso no deja una lista colgando de comas', () => {
    const mensaje = mensajeFusionBloqueada('Blanco B', [
      { etiqueta: 'lotes de tela (legado)', cuenta: 1 },
    ]);
    expect(mensaje).toContain('(1 lotes de tela (legado))');
    expect(mensaje).not.toContain(', ,');
  });
});
