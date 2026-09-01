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
 * aquella lista se enumerara mal TRES veces.
 *
 * 🔴 **LA EXCEPCIÓN VA AQUÍ, COMO LITERAL, Y NO EN PRODUCCIÓN — no es un detalle de estilo.**
 * `absorbidos` (§Post-F9.172(a)) es la única relación entrante que la fusión no repunta, y su nombre
 * está escrito **a mano dentro de la aserción**, no en una lista configurable que producción
 * exporte. La primera versión de esta etapa sí exportó esa lista desde
 * `cliente-departamentos-fusion-referencias.ts`, y **aflojó la red**: se pudo sacar `contactos` de
 * `REFERENCIAS_A_REPUNTAR` —o sea, dejar de repuntar la compradora del departamento, el estado
 * prohibido exacto— declararlo excluido, y la prueba quedó **VERDE**. La aserción se derivaba del
 * mismo módulo que debía vigilar, y el escape era **una palabra en el archivo que el desarrollador
 * ya estaba editando**.
 *
 * Con el literal no hay lista que crecer: para tapar un olvido hay que **editar esta prueba y
 * escribir el nombre de la relación en la aserción** — un acto deliberado y visible en el diff.
 * (Es lo que hace `NO_BLOQUEAN` en la prueba de colores: vive en la PRUEBA, nunca en producción.)
 *
 * 🔑 **Y la red no existe para la quinta relación, sino para la SEXTA** —la que nadie ha escrito— que
 * por definición no va a tener su propia prueba de integración. Para ésa, el camino de menor
 * resistencia («se puso roja → la excluyo») tiene que costar caro.
 *
 * ⚠️ **Se protege de sí misma:** antes de comparar afirma que el regex encontró relaciones CONOCIDAS
 * y que hay al menos cuatro. Sin eso, un reformateo del esquema que rompiera el regex dejaría la
 * prueba pasando **en vacío** — verde, y sin verificar nada.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { REFERENCIAS_A_REPUNTAR } from './cliente-departamentos-fusion-referencias.js';

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
    // dejar pasar una comparación de dos listas vacías. `absorbidos` va aquí para que, si algún día
    // se quitara la relación reflexiva de la fusión, la excepción de abajo no quede muerta en
    // silencio (misma protección que en la prueba de colores).
    expect(enElEsquema).toContain('proyectos');
    expect(enElEsquema).toContain('factores');
    expect(enElEsquema).toContain('absorbidos');
    expect(enElEsquema.length).toBeGreaterThanOrEqual(4);

    const cubiertas = REFERENCIAS_A_REPUNTAR.map((r) => r.relacion).sort();

    // 🔴 LA PUERTA CERRADA. Lo que el esquema tiene y la fusión NO repunta debe ser EXACTAMENTE
    // `absorbidos` — el nombre escrito a mano aquí, sin lista intermedia que ampliar. Si alguien
    // deja de repuntar `contactos` (o cualquier relación futura), aparece en este arreglo y la
    // prueba se pone ROJA: la única salida es repuntarla o escribir su nombre en esta línea.
    const sinRepuntar = enElEsquema.filter((r) => !cubiertas.includes(r)).sort();
    expect(sinRepuntar).toEqual(['absorbidos']);

    // Y en el otro sentido: SOBRAR también es rojo (una entrada que el esquema ya no tiene).
    expect(cubiertas).toEqual(enElEsquema.filter((r) => r !== 'absorbidos').sort());
  });

  it('⭐ `absorbidos` NO está en la lista de repunte (aplanaría la cadena de fusiones)', () => {
    expect(REFERENCIAS_A_REPUNTAR.map((r) => r.relacion)).not.toContain('absorbidos');
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
