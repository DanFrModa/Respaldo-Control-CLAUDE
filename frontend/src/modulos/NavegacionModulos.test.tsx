import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { renderConProveedores } from '@/pruebas/utilidades';

import type { GrupoMenu } from './catalogo';
import { NavegacionModulos } from './NavegacionModulos';

/**
 * Pruebas de `<NavegacionModulos>` (riel, fidelidad R9). La central es la
 * REGRESIÓN del bug del 9-jul-2026: las hojas del riel pasaban a NavLink un
 * `className` FUNCIÓN a través de `<TooltipTrigger asChild>`, y el Slot de
 * Radix la coersionaba a su código fuente con `join(' ')` — el <a> quedaba con
 * clases basura (sin `gap-[11px]`, sin padding vertical, sin resaltado activo)
 * y el riel se veía con los iconos pegados al texto. Aquí se asierta sobre el
 * atributo `class` REAL del <a> renderizado (lo que ve el navegador).
 */
const GRUPOS: readonly GrupoMenu[] = [
  {
    clave: 'inicio',
    titulo: null,
    entradas: [
      {
        clave: 'resumen',
        titulo: 'Resumen',
        descripcion: 'Resumen operativo',
        ruta: '/',
        icono: 'inicio',
        permisos: 'autenticado',
      },
      {
        clave: 'pedidos',
        titulo: 'Pedidos',
        descripcion: 'Pedidos del cliente',
        ruta: '/pedidos',
        icono: 'carrito',
        permisos: ['pedidos.ver'],
      },
    ],
  },
];

function montar(rutaInicial: string): void {
  renderConProveedores(
    <TooltipProvider>
      <NavegacionModulos grupos={GRUPOS} />
    </TooltipProvider>,
    { rutaInicial },
  );
}

describe('<NavegacionModulos>', () => {
  it('las HOJAS reciben las clases del proto como STRING (no la función coersionada por el Slot)', () => {
    montar('/');
    const hoja = screen.getByRole('link', { name: 'Resumen' });
    const clases = hoja.getAttribute('class') ?? '';
    // Si el Slot de Radix vuelve a recibir una función, el atributo trae su
    // código fuente ("({ isActive }) =>…") y las clases del layout se pierden.
    expect(clases).not.toContain('=>');
    expect(clases).toContain('gap-[11px]');
    expect(clases).toContain('py-[7px]');
  });

  it('la hoja de la ruta actual lleva el resaltado activo y las demás no', () => {
    montar('/pedidos');
    const activa = screen.getByRole('link', { name: 'Pedidos' });
    expect(activa.getAttribute('class')).toContain('bg-rail-active');
    const inactiva = screen.getByRole('link', { name: 'Resumen' });
    expect(inactiva.getAttribute('class')).not.toContain('bg-rail-active');
  });
});
