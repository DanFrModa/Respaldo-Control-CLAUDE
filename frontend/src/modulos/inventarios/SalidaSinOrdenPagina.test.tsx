import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { SalidaSinOrdenPagina } from './SalidaSinOrdenPagina';
import type { RenglonAvio } from './CapturaRenglonesAvio';
import type { RenglonTelaColor } from './CapturaRenglonesTelaColor';

const salidaTela = vi.fn();
const salidaAvio = vi.fn();

/**
 * ⚠️ **POR QUÉ ESTOS MOCKS SABEN EMITIR RENGLONES (3ª ronda del reviewer).**
 *
 * Antes eran `<div/>` vacíos. Como el botón sólo se enciende con `hayRenglones`, y sin captura de
 * verdad `renglones.length` era **siempre 0**, el botón estaba deshabilitado pasara lo que pasara:
 * la prueba llamada *«sin motivo el botón no se enciende»* pasaba **sin medir el motivo jamás**, y
 * `guardar()` —el acto central de la pantalla: a QUÉ endpoint va, con qué líneas y con qué
 * motivo— se quedó **sin una sola línea de cobertura**, con los `vi.fn()` declarados haciendo
 * creer lo contrario. Tres mutaciones sobrevivían con todo en verde: quitar `motivoOk`, mandar
 * TODA salida de tela al endpoint de AVÍOS, y vaciar el motivo al enviar.
 *
 * El mock sigue siendo tonto (no reimplementa la captura real): sólo expone un botón que empuja
 * renglones conocidos por el MISMO `onChange` que usa el componente de verdad. Con eso el
 * formulario se puede completar y `guardar()` queda medible.
 */
const RENGLONES_TELA: RenglonTelaColor[] = [
  // CON complemento: su `cantidadComplemento` tiene que viajar…
  {
    idTelaColor: 41,
    tela: 'Felpa Suiza',
    color: 'Marino',
    nombreComplemento: 'Cardigan',
    cantidad: 12.5,
    cantidadComplemento: 3.25,
  },
  // …y SIN complemento NO debe viajar (la pantalla lo decide por `nombreComplemento`).
  {
    idTelaColor: 42,
    tela: 'Jersey',
    color: 'Blanco',
    nombreComplemento: null,
    cantidad: 8,
    cantidadComplemento: 0,
  },
];
const RENGLONES_AVIO: RenglonAvio[] = [
  { idAvio: 91, avio: 'CIE-01', descripcion: 'Cierre 20cm', cantidad: 40 },
];

vi.mock('@/api/inventario-materiales', () => ({
  useSalidaTelaColorSinOrden: () => ({ mutate: salidaTela, isPending: false }),
  useSalidaAvioSinOrden: () => ({ mutate: salidaAvio, isPending: false }),
}));
vi.mock('@/api/almacenes', () => ({
  useAlmacenes: () => ({ data: { datos: [{ id: 7, nombre: 'Bodega Naucalpan' }] } }),
}));
vi.mock('./CapturaRenglonesTelaColor', () => ({
  CapturaRenglonesTelaColor: ({
    renglones,
    onChange,
  }: {
    renglones: RenglonTelaColor[];
    onChange: (r: RenglonTelaColor[]) => void;
  }) => (
    <div data-testid="captura-renglones-tela-color">
      <button
        type="button"
        data-testid="mock-agregar-renglones-tela"
        onClick={() => onChange([...renglones, ...RENGLONES_TELA])}
      />
    </div>
  ),
}));
vi.mock('./CapturaRenglonesAvio', () => ({
  CapturaRenglonesAvio: ({
    renglones,
    onChange,
  }: {
    renglones: RenglonAvio[];
    onChange: (r: RenglonAvio[]) => void;
  }) => (
    <div data-testid="captura-renglones-avio">
      <button
        type="button"
        data-testid="mock-agregar-renglones-avio"
        onClick={() => onChange([...renglones, ...RENGLONES_AVIO])}
      />
    </div>
  ),
}));

/** Deja el formulario listo para guardar: almacén, motivo y renglones de la dimensión pedida. */
function llenarFormulario(
  dimension: 'tela' | 'avio',
  motivo = '  Se devuelve al proveedor  ',
): void {
  if (dimension === 'avio') fireEvent.click(screen.getByTestId('salida-sin-orden-dim-avio'));
  fireEvent.change(screen.getByTestId('salida-sin-orden-almacen'), { target: { value: '7' } });
  fireEvent.change(screen.getByTestId('salida-sin-orden-fecha'), {
    target: { value: '2026-09-05' },
  });
  fireEvent.change(screen.getByTestId('salida-sin-orden-motivo'), { target: { value: motivo } });
  fireEvent.click(screen.getByTestId(`mock-agregar-renglones-${dimension}`));
}

/**
 * ⭐ LA SALIDA QUE NO ES POR OP (fila 0.104) — pantalla.
 *
 * Lo que se mide aquí es lo de la PANTALLA: que a quien no tiene la llave del dueño no se le
 * ofrezca (cortesía, A4 — la guarda de verdad vive en el dominio), que las dos dimensiones estén
 * y que el botón no se encienda sin lo obligatorio.
 */
describe('SalidaSinOrdenPagina', () => {
  beforeEach(() => {
    salidaTela.mockReset();
    salidaAvio.mockReset();
  });

  it('⭐ sin `salida-material.registrar` NO se ofrece la captura, aunque se pueda mover inventario', () => {
    renderConProveedores(<SalidaSinOrdenPagina />, {
      sesion: estadoSesionDePrueba(['inventario-telas.mover', 'inventario-avios.mover']),
    });
    expect(screen.getByTestId('salida-sin-orden-sin-permiso')).toBeInTheDocument();
    expect(screen.queryByTestId('salida-sin-orden-guardar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('salida-sin-orden-motivo')).not.toBeInTheDocument();
  });

  it('con la llave del dueño ofrece los tres conceptos y arranca en Telas', () => {
    renderConProveedores(<SalidaSinOrdenPagina />, {
      sesion: estadoSesionDePrueba(['salida-material.registrar']),
    });
    expect(screen.getByTestId('captura-renglones-tela-color')).toBeInTheDocument();
    const concepto = screen.getByTestId<HTMLSelectElement>('salida-sin-orden-concepto');
    expect([...concepto.options].map((o) => o.value)).toEqual([
      'devolucion-proveedor',
      'venta',
      'otro',
    ]);
  });

  it('la pestaña de Avíos cambia la captura (las dos dimensiones viven aquí)', () => {
    renderConProveedores(<SalidaSinOrdenPagina />, {
      sesion: estadoSesionDePrueba(['salida-material.registrar']),
    });
    fireEvent.click(screen.getByTestId('salida-sin-orden-dim-avio'));
    expect(screen.getByTestId('captura-renglones-avio')).toBeInTheDocument();
    expect(screen.queryByTestId('captura-renglones-tela-color')).not.toBeInTheDocument();
  });

  it('cambiar de dimensión VACÍA el almacén (una bodega de telas no sirve para avíos)', () => {
    renderConProveedores(<SalidaSinOrdenPagina />, {
      sesion: estadoSesionDePrueba(['salida-material.registrar']),
    });
    const almacen = screen.getByTestId<HTMLSelectElement>('salida-sin-orden-almacen');
    fireEvent.change(almacen, { target: { value: '7' } });
    expect(almacen.value).toBe('7');
    fireEvent.click(screen.getByTestId('salida-sin-orden-dim-avio'));
    expect(screen.getByTestId<HTMLSelectElement>('salida-sin-orden-almacen').value).toBe('');
  });

  it('sin renglones el botón no se enciende (aunque haya almacén y motivo)', () => {
    renderConProveedores(<SalidaSinOrdenPagina />, {
      sesion: estadoSesionDePrueba(['salida-material.registrar']),
    });
    expect(screen.getByTestId('salida-sin-orden-guardar')).toBeDisabled();
    fireEvent.change(screen.getByTestId('salida-sin-orden-almacen'), { target: { value: '7' } });
    fireEvent.change(screen.getByTestId('salida-sin-orden-motivo'), {
      target: { value: 'Devolución al proveedor' },
    });
    expect(screen.getByTestId('salida-sin-orden-guardar')).toBeDisabled();
  });

  it('🔴 lo ÚNICO que falta es el MOTIVO: el botón sigue apagado hasta escribirlo', () => {
    // ⚠️ La prueba vieja decía medir esto y NO lo medía: sin renglones el botón está apagado por
    // otra razón, así que quitar `motivoOk` de `puedeGuardar` no rompía nada. Aquí el formulario
    // está COMPLETO salvo el motivo, de modo que el motivo es lo único que puede estar
    // apagándolo.
    renderConProveedores(<SalidaSinOrdenPagina />, {
      sesion: estadoSesionDePrueba(['salida-material.registrar']),
    });
    llenarFormulario('tela', '');
    expect(
      screen.getByTestId('salida-sin-orden-guardar'),
      'con renglones y almacén pero SIN motivo, sigue apagado',
    ).toBeDisabled();

    // Y un motivo de relleno tampoco basta: se piden ≥3 caracteres con contenido.
    fireEvent.change(screen.getByTestId('salida-sin-orden-motivo'), { target: { value: '  ' } });
    expect(screen.getByTestId('salida-sin-orden-guardar')).toBeDisabled();

    fireEvent.change(screen.getByTestId('salida-sin-orden-motivo'), {
      target: { value: 'Devolución al proveedor' },
    });
    expect(
      screen.getByTestId('salida-sin-orden-guardar'),
      'con el motivo puesto, ya se puede guardar',
    ).toBeEnabled();
  });

  it('⭐ TELA: guarda por el endpoint de TELAS, con sus líneas y el motivo recortado', () => {
    renderConProveedores(<SalidaSinOrdenPagina />, {
      sesion: estadoSesionDePrueba(['salida-material.registrar']),
    });
    fireEvent.change(screen.getByTestId('salida-sin-orden-concepto'), {
      target: { value: 'venta' },
    });
    llenarFormulario('tela');
    fireEvent.click(screen.getByTestId('salida-sin-orden-guardar'));

    // 🔴 El endpoint es la mitad del acto: una salida de TELA que se fuera por el de avíos movería
    // el inventario equivocado. Por eso se afirma también que el OTRO no se llamó.
    expect(
      salidaAvio,
      'una salida de TELA no puede irse por el endpoint de avíos',
    ).not.toHaveBeenCalled();
    expect(salidaTela).toHaveBeenCalledTimes(1);
    expect(salidaTela.mock.calls[0]?.[0]).toEqual({
      concepto: 'venta',
      idAlmacen: 7,
      fecha: '2026-09-05',
      // Recortado: se capturó con espacios a los lados.
      motivo: 'Se devuelve al proveedor',
      lineas: [
        // La tela CON complemento lo manda…
        { idTelaColor: 41, cantidad: 12.5, cantidadComplemento: 3.25 },
        // …y la que no lo lleva NO manda la clave (no es lo mismo que mandarla en 0).
        { idTelaColor: 42, cantidad: 8 },
      ],
    });
  });

  it('⭐ AVÍO: guarda por el endpoint de AVÍOS, con su línea', () => {
    renderConProveedores(<SalidaSinOrdenPagina />, {
      sesion: estadoSesionDePrueba(['salida-material.registrar']),
    });
    llenarFormulario('avio');
    fireEvent.click(screen.getByTestId('salida-sin-orden-guardar'));

    expect(salidaTela).not.toHaveBeenCalled();
    expect(salidaAvio).toHaveBeenCalledTimes(1);
    expect(salidaAvio.mock.calls[0]?.[0]).toEqual({
      concepto: 'devolucion-proveedor',
      idAlmacen: 7,
      fecha: '2026-09-05',
      motivo: 'Se devuelve al proveedor',
      lineas: [{ idAvio: 91, cantidad: 40 }],
    });
  });
});
