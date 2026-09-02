import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrdenArteConFotos, OrdenArteFoto } from '@/api/fotos-arte-orden';
import { renderConProveedores } from '@/pruebas/utilidades';

import { FotosArteOrden } from './FotosArteOrden';

/**
 * ⭐ §Post-F9.177 — pruebas de `<FotosArteOrden>`: la tira de fotos de UN renglón de arte de la OP.
 * Daniel: *"un modelo de desarrollo que se va a usar para 4 órdenes diferentes no puede usar la misma
 * foto ni del modelo ni de arte para todas las OP… aplica para fotos de la prenda pero también del
 * arte"*.
 *
 * Lo que se fija aquí, y sobre todo lo que se fija EN NEGATIVO:
 *  • una foto HEREDADA nunca ofrece «borrar»: sólo «quitar de esta orden» (D3);
 *  • una foto PROPIA nunca ofrece «quitar de esta orden»: se borra de verdad;
 *  • quien NO administra ni siquiera ve las apagadas (para él la OP no lleva esa foto), y no tiene
 *    un solo botón;
 *  • la estrella no se transfiere: una principal apagada se la lleva consigo.
 *
 * La capa de datos va simulada (sin red): este componente no decide qué se hereda — eso lo resolvió
 * el servidor (A1).
 */
const subirMutate = vi.fn();
const quitarMutate = vi.fn();
const ocultarMutate = vi.fn();
const mostrarMutate = vi.fn();

vi.mock('@/api/fotos-arte-orden', () => ({
  useSubirFotoArteOrden: () => ({ mutate: subirMutate, isPending: false }),
  useQuitarFotoArteOrden: () => ({ mutate: quitarMutate, isPending: false }),
  useOcultarFotoArteOrden: () => ({ mutate: ocultarMutate, isPending: false }),
  useMostrarFotoArteOrden: () => ({ mutate: mostrarMutate, isPending: false }),
}));

/** Una foto HEREDADA del arte del modelo. */
function heredada(idModeloArteFoto: number, extra: Partial<OrdenArteFoto> = {}): OrdenArteFoto {
  return {
    origen: 'modelo',
    idModeloArteFoto,
    idFoto: null,
    urlDescarga: `https://ej.test/m${String(idModeloArteFoto)}.jpg`,
    nombreOriginal: `m${String(idModeloArteFoto)}.jpg`,
    oculta: false,
    principal: false,
    ...extra,
  };
}

/** Una foto SUBIDA a esta OP. */
function propia(idFoto: number): OrdenArteFoto {
  return {
    origen: 'orden',
    idModeloArteFoto: null,
    idFoto,
    urlDescarga: `https://ej.test/o${String(idFoto)}.jpg`,
    nombreOriginal: `o${String(idFoto)}.jpg`,
    oculta: false,
    principal: false,
  };
}

function arteCon(fotos: OrdenArteFoto[], agregadoAMano = false): OrdenArteConFotos {
  return { idOrdenArte: 7, descripcion: 'Logo pecho', agregadoAMano, fotos };
}

describe('<FotosArteOrden>', () => {
  beforeEach(() => {
    subirMutate.mockReset();
    quitarMutate.mockReset();
    ocultarMutate.mockReset();
    mostrarMutate.mockReset();
  });

  it('no pinta nada sin fotos y sin permiso', () => {
    const { container } = renderConProveedores(
      <FotosArteOrden idOrden={9} arte={arteCon([])} puedeAdministrar={false} />,
    );
    expect(screen.queryByTestId('fotos-arte-orden')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('sin fotos pero con permiso muestra SOLO el tile de subir', () => {
    renderConProveedores(<FotosArteOrden idOrden={9} arte={arteCon([])} puedeAdministrar />);
    expect(screen.getByTestId('subir-foto-arte-orden')).toBeInTheDocument();
    expect(screen.queryAllByTestId('foto-arte-orden')).toHaveLength(0);
  });

  it('mientras la consulta carga (sin `arte`) no pinta miniaturas ni ofrece subir', () => {
    // Sin renglón no se sabe a qué arte colgarle la foto: el tile no puede aparecer.
    renderConProveedores(<FotosArteOrden idOrden={9} arte={undefined} puedeAdministrar />);
    expect(screen.queryAllByTestId('foto-arte-orden')).toHaveLength(0);
    expect(screen.queryByTestId('subir-foto-arte-orden')).not.toBeInTheDocument();
  });

  it('pinta las HEREDADAS primero y las PROPIAS después, con su origen', () => {
    renderConProveedores(
      <FotosArteOrden
        idOrden={9}
        arte={arteCon([heredada(100, { principal: true }), propia(900)])}
        puedeAdministrar={false}
      />,
    );
    const tira = screen.getAllByTestId('foto-arte-orden');
    expect(tira).toHaveLength(2);
    expect(tira[0]).toHaveAttribute('data-origen', 'modelo');
    expect(tira[1]).toHaveAttribute('data-origen', 'orden');
    expect(screen.getByTestId('foto-arte-orden-principal')).toBeInTheDocument();
  });

  it('🔴 quien NO administra no ve las apagadas ni tiene un solo botón', () => {
    renderConProveedores(
      <FotosArteOrden
        idOrden={9}
        arte={arteCon([heredada(100, { oculta: true }), heredada(101)])}
        puedeAdministrar={false}
      />,
    );
    // Sólo la que la OP sí enseña.
    expect(screen.getAllByTestId('foto-arte-orden')).toHaveLength(1);
    expect(screen.queryByTestId('ocultar-foto-arte-orden')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mostrar-foto-arte-orden')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quitar-foto-arte-orden')).not.toBeInTheDocument();
    expect(screen.queryByTestId('subir-foto-arte-orden')).not.toBeInTheDocument();
  });

  it('⭐ quien administra SÍ ve la apagada, marcada y con el botón de traerla de vuelta', () => {
    renderConProveedores(
      <FotosArteOrden
        idOrden={9}
        arte={arteCon([heredada(100, { oculta: true, principal: true })])}
        puedeAdministrar
      />,
    );
    expect(screen.getAllByTestId('foto-arte-orden')).toHaveLength(1);
    expect(screen.getByTestId('foto-arte-orden-oculta')).toBeInTheDocument();
    expect(screen.getByTestId('mostrar-foto-arte-orden')).toBeInTheDocument();
    // Y NO el de apagarla: nunca los dos a la vez.
    expect(screen.queryByTestId('ocultar-foto-arte-orden')).not.toBeInTheDocument();
    // ⭐ La estrella se queda CON ella: ser principal no es un puesto que se transfiera.
    expect(screen.getByTestId('foto-arte-orden-principal')).toBeInTheDocument();
  });

  it('🔴 una HEREDADA nunca ofrece «borrar» — sólo quitarla de esta orden (D3)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <FotosArteOrden idOrden={9} arte={arteCon([heredada(100)])} puedeAdministrar />,
    );
    // El botón destructivo NO existe para una heredada: borrar la foto del modelo no es una opción
    // que esta pantalla pueda ofrecer.
    expect(screen.queryByTestId('quitar-foto-arte-orden')).not.toBeInTheDocument();

    await usuario.click(screen.getByTestId('ocultar-foto-arte-orden'));
    expect(ocultarMutate).toHaveBeenCalledTimes(1);
    expect(ocultarMutate.mock.calls[0]?.[0]).toEqual({
      idOrden: 9,
      idOrdenArte: 7,
      idModeloArteFoto: 100,
    });
    // Y no se llamó a la mutación que sí borra.
    expect(quitarMutate).not.toHaveBeenCalled();
  });

  it('🔴 una PROPIA nunca ofrece «quitar de esta orden» — se borra de verdad', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <FotosArteOrden idOrden={9} arte={arteCon([propia(900)])} puedeAdministrar />,
    );
    expect(screen.queryByTestId('ocultar-foto-arte-orden')).not.toBeInTheDocument();

    await usuario.click(screen.getByTestId('quitar-foto-arte-orden'));
    expect(quitarMutate).toHaveBeenCalledTimes(1);
    expect(quitarMutate.mock.calls[0]?.[0]).toEqual({ idOrden: 9, idOrdenArte: 7, idFoto: 900 });
    expect(ocultarMutate).not.toHaveBeenCalled();
  });

  it('traer de vuelta manda la foto del MODELO, no la de la orden', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <FotosArteOrden
        idOrden={9}
        arte={arteCon([heredada(101, { oculta: true })])}
        puedeAdministrar
      />,
    );
    await usuario.click(screen.getByTestId('mostrar-foto-arte-orden'));
    expect(mostrarMutate.mock.calls[0]?.[0]).toEqual({
      idOrden: 9,
      idOrdenArte: 7,
      idModeloArteFoto: 101,
    });
  });

  it('⭐ el arte AGREGADO A MANO no hereda nada pero SÍ puede subir la suya', () => {
    renderConProveedores(
      <FotosArteOrden idOrden={9} arte={arteCon([propia(900)], true)} puedeAdministrar />,
    );
    const tira = screen.getAllByTestId('foto-arte-orden');
    expect(tira).toHaveLength(1);
    expect(tira[0]).toHaveAttribute('data-origen', 'orden');
    expect(screen.getByTestId('subir-foto-arte-orden')).toBeInTheDocument();
  });

  it('clic en una miniatura abre el visor y se NAVEGA entre todas', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <FotosArteOrden
        idOrden={9}
        arte={arteCon([heredada(100), propia(900)])}
        puedeAdministrar={false}
      />,
    );
    await usuario.click(screen.getAllByTestId('foto-arte-orden')[0] as HTMLElement);
    expect(await screen.findByText('1 / 2')).toBeInTheDocument();
  });

  it('rechaza en el cliente un archivo que no es imagen (sin gastar una llamada)', async () => {
    // ⚠️ `applyAccept: false` NO es adorno: por omisión `userEvent.upload` respeta el `accept` del
    // input y **descarta el PDF antes de tocar el componente** — la prueba pasaría en verde con la
    // guarda del componente borrada, sin probar nada. Con esto el archivo sí llega y la guarda es
    // la que lo rechaza. (El `accept` sigue siendo la primera barrera en el navegador real; el
    // servidor la re-decide con su Zod, A1.)
    const usuario = userEvent.setup({ applyAccept: false });
    renderConProveedores(<FotosArteOrden idOrden={9} arte={arteCon([])} puedeAdministrar />);
    const input = screen.getByTestId('foto-arte-orden-archivo');
    await usuario.upload(input, new File(['x'], 'ficha.pdf', { type: 'application/pdf' }));
    expect(subirMutate).not.toHaveBeenCalled();
  });

  it('rechaza en el cliente una imagen de más de 50 MB (sin gastar una llamada)', async () => {
    const usuario = userEvent.setup({ applyAccept: false });
    renderConProveedores(<FotosArteOrden idOrden={9} arte={arteCon([])} puedeAdministrar />);
    const enorme = new File(['x'], 'gigante.jpg', { type: 'image/jpeg' });
    Object.defineProperty(enorme, 'size', { value: 50 * 1024 * 1024 + 1 });
    await usuario.upload(screen.getByTestId('foto-arte-orden-archivo'), enorme);
    expect(subirMutate).not.toHaveBeenCalled();
  });

  it('sube la imagen elegida al renglón correcto', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(<FotosArteOrden idOrden={9} arte={arteCon([])} puedeAdministrar />);
    const archivo = new File(['x'], 'logo.png', { type: 'image/png' });
    await usuario.upload(screen.getByTestId('foto-arte-orden-archivo'), archivo);
    expect(subirMutate).toHaveBeenCalledTimes(1);
    expect(subirMutate.mock.calls[0]?.[0]).toMatchObject({ idOrden: 9, idOrdenArte: 7, archivo });
  });

  it('con la fila OCUPADA los botones quedan deshabilitados (no se dispara nada a medias)', async () => {
    const usuario = userEvent.setup();
    renderConProveedores(
      <FotosArteOrden idOrden={9} arte={arteCon([heredada(100)])} puedeAdministrar ocupado />,
    );
    const boton = screen.getByTestId('ocultar-foto-arte-orden');
    expect(boton).toBeDisabled();
    await usuario.click(boton);
    expect(ocultarMutate).not.toHaveBeenCalled();
  });
});
