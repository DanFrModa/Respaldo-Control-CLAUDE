/**
 * ⭐ LA RED CONTRA LA PODREDUMBRE de la fusión de departamentos (§Post-F9.122(a)).
 *
 * Esta prueba **lee `prisma/schema.prisma`**, recorta `model ClienteDepartamento`, saca sus
 * relaciones de vuelta y exige que `REFERENCIAS_A_REPUNTAR` las cubra **TODAS**, con igualdad exacta
 * (faltar es rojo, y **sobrar también**).
 *
 * 🔴 **Por qué existe.** La fusión repunta al canónico lo que colgaba de los absorbidos. Si mañana
 * alguien le cuelga una **quinta** tabla al departamento —un módulo nuevo, una tabla de empaque, lo
 * que sea— y no la agrega a la lista, la fusión seguiría en verde repuntando cuatro de cinco, y esa
 * quinta se quedaría **apuntando a un departamento apagado**, en silencio. Eso es exactamente el
 * estado prohibido que esta etapa viene a impedir. Aquí ese olvido se convierte en un rojo de CI.
 *
 * Es la misma red que se puso en los colores (`colores-fusion-referencias.test.ts`) después de que
 * aquella lista se enumerara mal TRES veces. La diferencia: allá la lista es de «relaciones que
 * BLOQUEAN» y excluye la única que se mueve; aquí **todas** se mueven, así que la igualdad es contra
 * el conjunto completo.
 *
 * ⚠️ **Y se protege de sí misma:** antes de comparar afirma que el regex encontró relaciones
 * CONOCIDAS y que hay al menos cuatro. Sin eso, un reformateo del esquema que rompiera el regex
 * dejaría la prueba pasando **en vacío** — verde, y sin verificar nada.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  REFERENCIAS_A_REPUNTAR,
  RELACIONES_FUERA_DE_LA_FUSION,
} from './cliente-departamentos-fusion-referencias.js';

/** Nombres de las relaciones de vuelta declaradas en `model ClienteDepartamento` del esquema. */
function relacionesDeModeloClienteDepartamento(): string[] {
  const ruta = fileURLToPath(new URL('../../../prisma/schema.prisma', import.meta.url));
  const esquema = readFileSync(ruta, 'utf8');
  const bloque = /^model ClienteDepartamento \{$([\s\S]*?)^\}$/m.exec(esquema);
  if (bloque === null) {
    throw new Error('No se encontró `model ClienteDepartamento` en prisma/schema.prisma');
  }
  const relaciones: string[] = [];
  for (const linea of bloque[1]!.split('\n')) {
    // Una relación de vuelta se declara `nombre  OtroModelo[]` (lista, sin `@relation` de FK).
    const m = /^\s{2}([a-zA-Z][a-zA-Z0-9]*)\s+[A-Z][A-Za-z0-9]*\[\]/.exec(linea);
    if (m !== null) relaciones.push(m[1]!);
  }
  return relaciones;
}

describe('REFERENCIAS_A_REPUNTAR', () => {
  it('⭐ cubre TODAS las relaciones entrantes de `model ClienteDepartamento` (ninguna se queda colgando)', () => {
    const enElEsquema = relacionesDeModeloClienteDepartamento();

    // Red de seguridad de la propia prueba: si el regex dejara de casar, esto lo delata en vez de
    // dejar pasar una comparación de dos listas vacías.
    expect(enElEsquema).toContain('proyectos');
    expect(enElEsquema).toContain('factores');
    expect(enElEsquema.length).toBeGreaterThanOrEqual(4);

    // Las EXCLUIDAS a propósito se restan aquí y en ningún otro lado: la igualdad sigue siendo
    // exacta, y una exclusión nueva obliga a declararla en `RELACIONES_FUERA_DE_LA_FUSION` con su
    // porqué. Sin esto, `absorbidos` (§Post-F9.172(a)) habría puesto la prueba en rojo o —peor— se
    // habría colado a la lista de repunte, aplanando la cadena de fusiones.
    const repuntables = enElEsquema.filter((r) => !RELACIONES_FUERA_DE_LA_FUSION.includes(r));
    const cubiertas = REFERENCIAS_A_REPUNTAR.map((r) => r.relacion).sort();
    expect(cubiertas).toEqual([...repuntables].sort());
  });

  it('⭐ cada relación EXCLUIDA existe de verdad en el esquema (una exclusión muerta no protege nada)', () => {
    const enElEsquema = relacionesDeModeloClienteDepartamento();
    expect(RELACIONES_FUERA_DE_LA_FUSION.length).toBeGreaterThan(0);
    for (const excluida of RELACIONES_FUERA_DE_LA_FUSION) {
      expect(enElEsquema).toContain(excluida);
    }
  });

  it('⭐ ninguna relación está a la vez repuntada y excluida (la lista no se contradice)', () => {
    for (const r of REFERENCIAS_A_REPUNTAR) {
      expect(RELACIONES_FUERA_DE_LA_FUSION).not.toContain(r.relacion);
    }
  });

  it('no repite relaciones', () => {
    const nombres = REFERENCIAS_A_REPUNTAR.map((r) => r.relacion);
    expect(new Set(nombres).size).toBe(nombres.length);
  });

  it('cada referencia trae una etiqueta legible para la vista previa', () => {
    for (const r of REFERENCIAS_A_REPUNTAR) {
      expect(r.etiqueta.trim().length).toBeGreaterThan(3);
    }
  });

  it('los FACTORES están en la lista: son la única con colisión posible y no se pueden olvidar', () => {
    const factores = REFERENCIAS_A_REPUNTAR.find((r) => r.relacion === 'factores');
    expect(factores).toBeDefined();
    expect(factores?.etiqueta).toContain('factores');
  });
});
