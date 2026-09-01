import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Modelo } from '@/api/modelos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DialogoRevisionModelo } from './DialogoRevisionModelo';

/**
 * ⭐⭐ V1-E9c (§Post-F9.169) — **LO QUE ESTE DIÁLOGO PROMETE, ASEVERADO.**
 *
 * 🔴 **Por qué este archivo nace ahora.** Al disolverse la compuerta de la revisión, se
 * actualizaron los toasts de este componente y **se quedó sin tocar la `DialogDescription` veinte
 * líneas más abajo** — que es justamente el texto que la persona lee **en el segundo en que
 * decide**. Seguía diciendo que rechazar impedía producir y que aprobar dejaba la versión *"lista
 * para mandarse a producir"*. Pudo quedarse ahí porque **no existía ninguna prueba sobre esta
 * copia**: ni unitaria ni e2e.
 *
 * 🔑 **El escenario que esto evita, en concreto.** Aurora abre «Rechazar revisión», lee que
 * rechazar frena la producción, **rechaza confiando en eso** — y la OP se genera igual esa misma
 * tarde (`backend/src/dominio/produccion/salida-produccion.test.ts`: *"una versión RECHAZADA también
 * genera su OP"*). Un texto que promete un freno inexistente **sustituye la decisión real** —ir a
 * frenar el gasto en la receta de la ORDEN, renglón por renglón— por la sensación de haberla
 * tomado. Es peor que no decir nada.
 *
 * ⚠️ **Se asevera la FRASE, no una palabra suelta.** Buscar sólo *"no detiene"* pasaría con el
 * texto viejo mutilado a medias; lo que hay que fijar es **qué promete y qué niega**. Por eso cada
 * prueba exige el trozo que afirma y, además, que **NO** aparezca la promesa retirada.
 */
const aprobarMutate = vi.fn();
const rechazarMutate = vi.fn();

vi.mock('@/api/modelos', () => ({
  useAprobarRevisionModelo: () => ({ mutate: aprobarMutate, isPending: false }),
  useRechazarRevisionModelo: () => ({ mutate: rechazarMutate, isPending: false }),
}));

function version(): Modelo {
  return {
    id: 9,
    codigo: 'CYA-26-71-001-01',
    codigoDesarrollo: 'CYA-26-71-001-01',
  } as unknown as Modelo;
}

/** Abre el diálogo en la acción indicada y devuelve el texto de su descripción. */
function abrir(accion: 'aprobar' | 'rechazar'): string {
  renderConProveedores(
    <DialogoRevisionModelo
      abierto
      alCambiarAbierto={() => {}}
      modelo={version()}
      accion={accion}
    />,
    { sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.aprobar-receta']) },
  );
  return screen.getByTestId('dialogo-revision-modelo').textContent ?? '';
}

describe('<DialogoRevisionModelo> — lo que le promete a quien firma', () => {
  beforeEach(() => {
    aprobarMutate.mockReset();
    rechazarMutate.mockReset();
  });

  it('⭐⭐ RECHAZAR dice explícitamente que NO detiene la producción, y dónde sí se frena el gasto', () => {
    const texto = abrir('rechazar');

    // Lo que la persona necesita saber para no equivocarse de acto: esto NO es el freno.
    expect(texto).toContain('rechazarla NO detiene su producción');
    // Y a dónde ir de verdad si lo que quiere es frenar el dinero (la firma POR RENGLÓN).
    expect(texto).toContain('lo que Desarrollo no libera, no se compra');
    // Lo que sí hace: se conserva y vuelve a la cola.
    expect(texto).toContain('Recetas por revisar');

    // 🔴 LA PROMESA RETIRADA, aseverada en negativo. Sin esta línea, el texto viejo —*"no podrá
    // mandarse a producir"*— pasaría con sólo añadirle las frases nuevas al final.
    expect(texto).not.toContain('no podrá mandarse a producir');
  });

  it('⭐⭐ APROBAR no promete que habilite producir: dice que es CONSTANCIA, y que se cae si la receta cambia', () => {
    const texto = abrir('aprobar');

    expect(texto).toContain('Queda constancia de que revisaste la receta de CYA-26-71-001-01');
    expect(texto).toContain('no habilita ni bloquea nada por sí sola');
    // La invalidación de §Post-F9.116, que es lo que mantiene honesta la firma.
    expect(texto).toContain('mueve la receta después');

    // 🔴 La promesa retirada: aprobar NO deja la versión "lista para mandarse a producir".
    expect(texto).not.toContain('lista para mandarse a producir');
  });

  it('el rechazo exige MOTIVO: sin él el botón no manda nada (el backend lo vuelve a exigir)', async () => {
    const usuario = userEvent.setup();
    abrir('rechazar');

    await usuario.click(screen.getByTestId('confirmar-revision-modelo'));
    expect(rechazarMutate).not.toHaveBeenCalled();

    await usuario.type(screen.getByTestId('modelo-revision-texto'), 'la tela no la surte nadie');
    await usuario.click(screen.getByTestId('confirmar-revision-modelo'));
    expect(rechazarMutate).toHaveBeenCalledWith(
      { id: 9, texto: 'la tela no la surte nadie' },
      expect.anything(),
    );
  });
});
