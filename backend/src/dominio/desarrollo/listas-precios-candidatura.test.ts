/**
 * Tests UNIT de la CANDIDATURA a lista de precios — ⭐ V1-E8f (§Post-F9.128).
 *
 * `motivoNoCandidato` es la regla ENTERA de "¿este desarrollo puede entrar a una lista?" y, cuando no
 * puede, POR QUÉ. Antes esa regla vivía disuelta en un `where` de Prisma: se podía preguntar "¿hay
 * candidatos?" pero jamás "¿y por qué no?" — y por eso Daniel recibía *"no hay desarrollos cotizados
 * disponibles"* sin remedio a la vista.
 *
 * SIN Postgres: la función es pura. El diagnóstico contra base (que trae a TODOS, incluidos los
 * apagados y los ya colocados) va en `listas-precios.int.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { MOTIVOS_NO_CANDIDATO } from '../../contrato/esquemas/lista-precios.js';

import { motivoNoCandidato } from './listas-precios.js';

/** Arma un desarrollo mínimo para clasificar (todo lo demás es irrelevante para la regla). */
function desarrollo(opciones: {
  apagado?: boolean;
  precostos?: readonly { estado: string }[];
  enListas?: number;
}): {
  apagado: boolean;
  precostos: readonly { estado: string }[];
  listaLineas: readonly unknown[];
} {
  return {
    apagado: opciones.apagado ?? false,
    precostos: opciones.precostos ?? [],
    listaLineas: Array.from({ length: opciones.enListas ?? 0 }, () => ({})),
  };
}

describe('motivoNoCandidato (V1-E8f)', () => {
  it('SÍ califica: activo, con un precosto CONGELADO y sin renglón en ninguna lista', () => {
    expect(motivoNoCandidato(desarrollo({ precostos: [{ estado: 'congelado' }] }))).toBeNull();
  });

  it('un precosto congelado basta aunque haya borradores más nuevos encima', () => {
    expect(
      motivoNoCandidato(
        desarrollo({ precostos: [{ estado: 'borrador' }, { estado: 'congelado' }] }),
      ),
    ).toBeNull();
  });

  // ⭐ EL CASO DE DANIEL: el precosto existe pero se quedó en borrador. El aviso tiene que poder
  // decir "congela la versión", no "no hay desarrollos disponibles".
  it('con precosto(s) pero NINGUNO congelado → «precosto-borrador»', () => {
    expect(motivoNoCandidato(desarrollo({ precostos: [{ estado: 'borrador' }] }))).toBe(
      'precosto-borrador',
    );
  });

  it('sin ningún precosto → «sin-precosto» (remedio distinto: primero hay que precostear)', () => {
    expect(motivoNoCandidato(desarrollo({}))).toBe('sin-precosto');
  });

  it('con renglón en una lista → «ya-en-lista» (un desarrollo vive en A LO MÁS UNA)', () => {
    expect(
      motivoNoCandidato(desarrollo({ precostos: [{ estado: 'congelado' }], enListas: 1 })),
    ).toBe('ya-en-lista');
  });

  it('apagado → «apagado», aunque esté congelado y libre (el remedio es reactivarlo)', () => {
    expect(
      motivoNoCandidato(desarrollo({ apagado: true, precostos: [{ estado: 'congelado' }] })),
    ).toBe('apagado');
  });

  // La PRECEDENCIA no es cosmética: decide qué remedio se le ofrece al usuario. Un apagado que
  // además está en una lista se arregla reactivándolo, no yendo a la lista.
  it('la precedencia es apagado > ya-en-lista > lo del precosto', () => {
    expect(motivoNoCandidato(desarrollo({ apagado: true, enListas: 1 }))).toBe('apagado');
    expect(motivoNoCandidato(desarrollo({ enListas: 1 }))).toBe('ya-en-lista');
    expect(motivoNoCandidato(desarrollo({ apagado: true }))).toBe('apagado');
  });

  it('todo motivo que devuelve está en el catálogo del contrato (nada suelto)', () => {
    const casos = [
      desarrollo({ apagado: true }),
      desarrollo({ enListas: 1 }),
      desarrollo({ precostos: [{ estado: 'borrador' }] }),
      desarrollo({}),
    ];
    const motivos = casos.map((c) => motivoNoCandidato(c));
    expect(motivos.every((m) => m !== null && MOTIVOS_NO_CANDIDATO.includes(m))).toBe(true);
    // …y entre los cuatro casos se cubren los CUATRO motivos: el catálogo no tiene letra muerta.
    expect(new Set(motivos)).toEqual(new Set(MOTIVOS_NO_CANDIDATO));
  });
});
