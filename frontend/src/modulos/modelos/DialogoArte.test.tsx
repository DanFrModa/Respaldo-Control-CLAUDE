import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Arte } from '@/api/artes';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DialogoArte } from './DialogoArte';

/**
 * Pruebas del diálogo del ARTE del modelo — lo que V1-E3f cambió en la CAPTURA (§Post-F9.52):
 *
 *  • **Ya no se pide NOMBRE**: la `descripcion` es el campo visible y obligatorio (punto 1).
 *  • Las **PUNTADAS se atan al TIPO** (punto 6, Daniel: *"Las puntadas solo aplica para bordados"*
 *    y sobre atarlo al tipo *"Ok como tú lo dices"*): el campo aparece si el tipo elegido las usa
 *    y DESAPARECE si no. El dato no se borró de la base — solo deja de estorbar en pantalla.
 *  • Al perderse la unicidad del nombre, dos artes pueden describirse igual: la pantalla **AVISA
 *    sin bloquear** (Daniel aceptó perder esa red; repetir texto suele ser un descuido).
 *
 * La capa de datos va simulada (sin red).
 */
const crearMutate = vi.fn();

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** Los tipos del catálogo ÚNICO: bordado USA puntadas, estampado NO (como el seed real). */
const TIPOS_ARTE = [
  {
    id: 9,
    codigo: 'bordado',
    nombre: 'Bordado',
    esArte: true,
    usaPuntadas: true,
    codigoRolProveedor: 'bordado',
    generaEntradaPt: false,
    activo: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
  },
  {
    id: 10,
    codigo: 'estampado',
    nombre: 'Estampado',
    esArte: true,
    usaPuntadas: false,
    codigoRolProveedor: 'estampado',
    generaEntradaPt: false,
    activo: true,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
  },
];

/** Un arte del modelo con lo mínimo para sembrar el formulario en EDICIÓN. */
function arte(over: Partial<Arte> = {}): Arte {
  return {
    id: 1,
    idModelo: 3,
    descripcion: 'Águila bordada',
    posicion: 'frente',
    puntadas: null,
    precio: null,
    idTipoArte: 9,
    tipoArte: 'Bordado',
    codigoTipoArte: 'bordado',
    usaPuntadas: true,
    idProveedor: null,
    proveedor: null,
    fotos: [],
    orden: 0,
    creadoEn: '2026-01-01T00:00:00.000Z',
    creadoPorId: null,
    modificadoEn: '2026-01-01T00:00:00.000Z',
    modificadoPorId: null,
    ...over,
  };
}

/** El arte que YA tiene el modelo (para el aviso de descripción repetida). */
let artesDelModelo: Arte[] = [];

vi.mock('@/api/artes', () => ({
  useCrearArte: () => ({ mutate: crearMutate, isPending: false }),
  useActualizarArte: () => ({ mutate: vi.fn(), isPending: false }),
  useArtesModelo: () => ({ data: { datos: artesDelModelo }, isPending: false, isError: false }),
  useFotosArte: () => ({ data: { datos: [] }, isPending: false, isError: false }),
  useSubirFotoArte: () => ({ mutate: vi.fn(), isPending: false }),
  useQuitarFotoArte: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/api/tipos-proceso', () => ({
  useTiposArte: () => ({ data: { datos: TIPOS_ARTE }, isPending: false, isError: false }),
}));

vi.mock('@/api/proveedores', () => ({
  useProveedores: () => ({ data: { datos: [] }, isPending: false }),
  useProveedoresPorRol: () => ({ data: { datos: [] }, isPending: false, isError: false }),
  useRolesProveedor: () => ({ data: [], isPending: false }),
}));

/** Monta el diálogo en ALTA (sin arte) o en EDICIÓN (con arte). */
function pintar(conArte?: Arte): void {
  renderConProveedores(
    <DialogoArte
      abierto
      alCambiarAbierto={vi.fn()}
      idModelo={3}
      {...(conArte === undefined ? {} : { arte: conArte })}
    />,
    { sesion: estadoSesionDePrueba(['modelos.ver', 'modelos.administrar']) },
  );
}

describe('<DialogoArte> — la captura del arte (V1-E3f)', () => {
  beforeEach(() => {
    crearMutate.mockReset();
    artesDelModelo = [];
  });

  it('pide DESCRIPCIÓN y POSICIÓN, y ya no existe el campo de nombre', () => {
    pintar();

    expect(screen.getByTestId('arte-descripcion')).toBeInTheDocument();
    expect(screen.getByTestId('arte-posicion')).toBeInTheDocument();
    // El nombre se retiró: Daniel — *"Es completamente irrelevante el nombre del estampado"*.
    expect(screen.queryByTestId('arte-nombre')).not.toBeInTheDocument();
  });

  it('las PUNTADAS solo se piden si el TIPO elegido las usa', async () => {
    const usuario = userEvent.setup();
    pintar();

    // Sin tipo elegido no hay puntadas que capturar.
    expect(screen.queryByTestId('arte-puntadas')).not.toBeInTheDocument();

    // Bordado SÍ las usa.
    await usuario.selectOptions(screen.getByTestId('arte-tipo'), '9');
    expect(screen.getByTestId('arte-puntadas')).toBeInTheDocument();

    // Estampado NO: el campo desaparece (el dato guardado no se toca, solo deja de estorbar).
    await usuario.selectOptions(screen.getByTestId('arte-tipo'), '10');
    expect(screen.queryByTestId('arte-puntadas')).not.toBeInTheDocument();
  });

  it('el alta manda descripción, posición y el id del TIPO del catálogo', async () => {
    const usuario = userEvent.setup();
    pintar();

    await usuario.type(screen.getByTestId('arte-descripcion'), 'Águila bordada');
    await usuario.type(screen.getByTestId('arte-posicion'), 'espalda');
    await usuario.selectOptions(screen.getByTestId('arte-tipo'), '9');
    await usuario.type(screen.getByTestId('arte-precio'), '45');
    await usuario.click(screen.getByTestId('guardar-arte'));

    expect(crearMutate).toHaveBeenCalledTimes(1);
    expect(crearMutate.mock.calls[0]?.[0]).toEqual({
      idModelo: 3,
      cuerpo: {
        descripcion: 'Águila bordada',
        posicion: 'espalda',
        idTipoArte: 9,
        precio: 45,
      },
    });
  });

  it('sin descripción o sin tipo NO se envía nada (los dos son obligatorios)', async () => {
    const usuario = userEvent.setup();
    pintar();

    // Solo el tipo: falta la descripción.
    await usuario.selectOptions(screen.getByTestId('arte-tipo'), '9');
    await usuario.click(screen.getByTestId('guardar-arte'));
    expect(crearMutate).not.toHaveBeenCalled();
  });

  it('AVISA (sin bloquear) si otro arte del modelo ya tiene esa descripción', async () => {
    const usuario = userEvent.setup();
    artesDelModelo = [arte({ id: 77, descripcion: 'Águila bordada' })];
    pintar();

    expect(screen.queryByTestId('arte-descripcion-repetida')).not.toBeInTheDocument();

    // Se teclea la MISMA descripción (con otra caja y espacios: la comparación normaliza).
    await usuario.type(screen.getByTestId('arte-descripcion'), '  águila BORDADA  ');
    expect(screen.getByTestId('arte-descripcion-repetida')).toBeInTheDocument();

    // Es un AVISO: el guardado sigue permitido (Daniel aceptó perder la unicidad del nombre).
    await usuario.selectOptions(screen.getByTestId('arte-tipo'), '9');
    await usuario.click(screen.getByTestId('guardar-arte'));
    expect(crearMutate).toHaveBeenCalledTimes(1);
  });

  it('⭐ un TIPO retirado del catálogo NO se pierde al editar: se inyecta como opción', async () => {
    // Un admin desactiva un tipo (o le quita `esArte`): el catálogo deja de traerlo. Sin inyectar
    // el tipo del arte, el selector abriría en «Elige el tipo…» y guardar lo RE-TIPIFICARÍA con
    // otra cosa — un dato que nadie tocó, cambiado en silencio.
    //
    // ⚠️ El tipo retirado del fixture USA PUNTADAS **a propósito**: es lo único que distingue
    // "la bandera se toma del arte" de "la bandera se da por apagada porque el tipo ya no está en
    // el catálogo". Con un tipo retirado que no las use, las dos ramas coinciden y la prueba pasa
    // igual con el código bueno y con el roto (hallazgo del reviewer, 2ª ronda).
    const usuario = userEvent.setup();
    const conTipoRetirado = arte({
      id: 55,
      idTipoArte: 77,
      tipoArte: 'Bordado a mano',
      codigoTipoArte: 'bordado-a-mano',
      usaPuntadas: true,
      puntadas: 4200,
      descripcion: 'Escudo a mano',
    });
    pintar(conTipoRetirado);

    const selector = screen.getByTestId<HTMLSelectElement>('arte-tipo');
    // Sigue seleccionado SU tipo (no cayó al vacío), y la opción dice por qué no está en la lista.
    expect(selector.value).toBe('77');
    expect(
      screen.getByRole('option', { name: /Bordado a mano \(ya no disponible\)/ }),
    ).toBeInTheDocument();
    // Y su bandera de PUNTADAS se respeta aunque el tipo ya no venga del catálogo: viaja en el
    // propio arte. El campo se muestra, con el valor capturado.
    expect(screen.getByTestId<HTMLInputElement>('arte-puntadas').value).toBe('4200');

    // Cambiar a un tipo vigente sigue funcionando (la inyección no estorba) y manda la bandera del
    // NUEVO tipo: «Estampado» no usa puntadas, así que el campo se va.
    await usuario.selectOptions(selector, '10');
    expect(screen.queryByTestId('arte-puntadas')).not.toBeInTheDocument();
  });

  it('el tipo VIGENTE no se duplica en la lista al editar', () => {
    pintar(arte({ idTipoArte: 9 }));

    expect(screen.getAllByRole('option', { name: 'Bordado' })).toHaveLength(1);
    expect(screen.queryByRole('option', { name: /ya no disponible/ })).not.toBeInTheDocument();
  });

  it('editando el PROPIO arte no se avisa de repetición contra sí mismo', () => {
    const elEditado = arte({ id: 77, descripcion: 'Águila bordada' });
    artesDelModelo = [elEditado];
    pintar(elEditado);

    expect(screen.queryByTestId('arte-descripcion-repetida')).not.toBeInTheDocument();
  });
});
