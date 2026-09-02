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

/**
 * ⭐ V1-E9p — la META en vivo. El doble **no puede pasar por construcción**: entrega el número sólo
 * si le preguntan por EL modelo que se está firmando y sólo si la consulta viene HABILITADA (el
 * diálogo abierto y en «aprobar»). Si alguien desconecta el id o deja la consulta corriendo al
 * rechazar, esto se pone rojo en vez de devolver el número cómodo.
 */
const metaPrometida = { valor: null as number | null };
vi.mock('@/api/modelos', () => ({
  useAprobarRevisionModelo: () => ({ mutate: aprobarMutate, isPending: false }),
  useRechazarRevisionModelo: () => ({ mutate: rechazarMutate, isPending: false }),
  useMetaPrometida: (id: number | undefined, habilitada: boolean) => ({
    data: id === 9 && habilitada ? { costoPrometido: metaPrometida.valor } : undefined,
  }),
}));

function version(): Modelo {
  return {
    id: 9,
    codigo: 'CYA-26-71-001-01',
    codigoDesarrollo: 'CYA-26-71-001-01',
  } as unknown as Modelo;
}

/** Abre el diálogo en la acción indicada y devuelve el texto de su descripción. */
function abrir(accion: 'aprobar' | 'rechazar', costoPrometido: number | null = null): string {
  metaPrometida.valor = costoPrometido;
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

/**
 * ⭐⭐ V1-E9p (§Post-F9.144(b)) — **EL SEGUNDO FINAL, en el diálogo donde se declara.**
 *
 * Daniel: *«todo eso se intentará hacer así, pero **no es seguro que se consiga**»*. Lo que estas
 * pruebas cementan, en este orden de importancia:
 *
 *  1. 🔴 **Que NO contestar siga firmando exactamente como antes** — el modo de fallo realista de
 *     esta etapa es *«añadí lo nuevo y dejé lo viejo debajo»*, y su gemelo es *«añadí lo nuevo y lo
 *     volví obligatorio sin querer»*.
 *  2. 🔴 **Que el «no se consiguió» NO sea un rechazo**: se manda por la mutación de APROBAR.
 *  3. Que el «no» exija sus dos datos, que son los que lo vuelven información.
 */
describe('<DialogoRevisionModelo> — «¿se logró lo prometido?» (V1-E9p)', () => {
  beforeEach(() => {
    aprobarMutate.mockReset();
    rechazarMutate.mockReset();
  });

  it('⭐⭐ SIN contestar la pregunta, la firma es la de siempre: no viaja ningún desenlace', async () => {
    const usuario = userEvent.setup();
    abrir('aprobar');

    await usuario.click(screen.getByTestId('confirmar-revision-modelo'));

    // `toHaveBeenCalledWith` con el objeto EXACTO: si se colara un `meta` (aunque fuera
    // `{ lograda: true }` «por defecto»), esto se pone rojo. Asumir el «sí» por no contestar sería
    // volver a convertir un incumplimiento en un silencio.
    expect(aprobarMutate).toHaveBeenCalledWith({ id: 9, texto: '' }, expect.anything());
  });

  it('⭐⭐ «NO se consiguió» viaja por APROBAR, no por rechazar — no es un rechazo', async () => {
    const usuario = userEvent.setup();
    abrir('aprobar');

    await usuario.click(screen.getByTestId('meta-no'));
    await usuario.type(screen.getByTestId('meta-conseguido'), '45');
    await usuario.type(screen.getByTestId('meta-porque'), 'ninguna maquila bajó de $18');
    await usuario.click(screen.getByTestId('confirmar-revision-modelo'));

    expect(aprobarMutate).toHaveBeenCalledWith(
      {
        id: 9,
        texto: '',
        meta: { lograda: false, costoConseguido: 45, nota: 'ninguna maquila bajó de $18' },
      },
      expect.anything(),
    );
    // 🔴 Y la mutación de RECHAZO no se toca: la receta está bien, no hay nada que corregir.
    expect(rechazarMutate).not.toHaveBeenCalled();
  });

  it('⭐ el «NO» exige el número conseguido: sin él el botón no manda nada', async () => {
    const usuario = userEvent.setup();
    abrir('aprobar');

    await usuario.click(screen.getByTestId('meta-no'));
    await usuario.type(screen.getByTestId('meta-porque'), 'ninguna maquila bajó de $18');
    await usuario.click(screen.getByTestId('confirmar-revision-modelo'));
    expect(aprobarMutate).not.toHaveBeenCalled();
  });

  it('⭐ el «NO» exige el porqué: sin él el botón no manda nada', async () => {
    const usuario = userEvent.setup();
    abrir('aprobar');

    await usuario.click(screen.getByTestId('meta-no'));
    await usuario.type(screen.getByTestId('meta-conseguido'), '45');
    await usuario.click(screen.getByTestId('confirmar-revision-modelo'));
    expect(aprobarMutate).not.toHaveBeenCalled();
  });

  it('el «SÍ» no exige nada: se manda con un clic', async () => {
    // La rama gemela del «no». Si las dos exigieran lo mismo, la prueba de arriba pasaría con una
    // regla equivocada (exigir siempre) y confirmar una promesa cumplida costaría un trámite.
    const usuario = userEvent.setup();
    abrir('aprobar');

    await usuario.click(screen.getByTestId('meta-si'));
    await usuario.click(screen.getByTestId('confirmar-revision-modelo'));

    expect(aprobarMutate).toHaveBeenCalledWith(
      { id: 9, texto: '', meta: { lograda: true } },
      expect.anything(),
    );
  });

  it('⭐ enseña LA META cuando se conoce, que es contra lo que se contesta', () => {
    expect(abrir('aprobar', 43)).toContain('Se vendió con un costo de $43.00');
  });

  it('⭐ y no inventa un costo cuando NO se conoce (REGLA 0-B): la pregunta se hace igual', () => {
    const texto = abrir('aprobar', null);
    expect(texto).toContain('¿Se logró lo que se prometió en la negociación?');
    expect(texto).not.toContain('Se vendió con un costo de');
  });

  it('🔴 dice que el «no» NO rechaza ni detiene nada (avisar no es bloquear)', () => {
    // El texto que la persona lee EN EL SEGUNDO EN QUE DECIDE. Si prometiera un freno, alguien
    // declararía el «no» creyendo que con eso paró algo — la misma cicatriz que obligó a aseverar
    // la copia de este diálogo la primera vez.
    expect(abrir('aprobar')).toContain('no rechaza nada');
  });

  it('el bloque del desenlace NO aparece al rechazar', () => {
    // Asimetría DELIBERADA: el desenlace habla de una receta ya cuadrada, y un rechazo dice que
    // todavía no lo está.
    abrir('rechazar');
    expect(screen.queryByTestId('bloque-meta')).toBeNull();
  });
});
