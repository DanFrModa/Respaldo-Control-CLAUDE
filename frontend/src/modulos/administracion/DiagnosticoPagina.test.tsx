import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Diagnostico } from '@/api/tipos';
import { estadoSesionDePrueba, renderConProveedores } from '@/pruebas/utilidades';

import { DiagnosticoPagina } from './DiagnosticoPagina';

/**
 * Lo que esta pantalla tiene que lograr no es "pintar datos": es que alguien atascado —sin acceso a
 * Cloudflare y sin saber qué es CORS— salga sabiendo qué tocar. Por eso se prueba que el ARREGLO de
 * cada prueba fallida se vea, y que la política CORS esté a la mano.
 */

let diagnostico: Diagnostico | undefined;

vi.mock('@/api/diagnostico', () => ({
  useDiagnostico: () => ({
    data: diagnostico,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  usePedirRespaldo: () => ({ mutate: vi.fn(), isPending: false }),
}));

function crearDiagnostico(): Diagnostico {
  return {
    hora: '2026-08-18T10:00:00Z',
    almacenamiento: {
      bucket: 'control-v2-prueba',
      cuenta: 'abc123… (32 caracteres)',
      accessKeyId: 'a1b2… (32 caracteres)',
      origenProbado: 'https://prueba-control.up.railway.app',
      corsActual: null,
      corsSugerido: '[\n  { "AllowedMethods": ["GET", "PUT", "HEAD"] }\n]',
      puedeSubirFotos: false,
      veredicto: 'Las credenciales están BIEN: lo que falla es la política CORS del bucket.',
      pruebas: [
        {
          clave: 'escritura',
          titulo: 'El servidor puede GUARDAR en el bucket',
          estado: 'ok',
          detalle: 'Objeto de prueba escrito.',
        },
        {
          clave: 'cors-preflight',
          titulo: 'El navegador puede subir',
          estado: 'falla',
          detalle: 'R2 respondió sin la cabecera access-control-allow-origin.',
          sugerencia: 'Pega la política sugerida en Cloudflare.',
        },
      ],
    },
    respaldo: {
      estado: 'sin-configurar',
      mensaje: 'Falta RESPALDO_LLAVE.',
      cron: '(sin programar)',
      cuando: '(sin programar)',
      retencion: 0,
      ultimasCorridas: [],
      veredicto: 'NO hay segundo respaldo: falta configuración en el servidor.',
    },
  };
}

describe('DiagnosticoPagina', () => {
  it('pone el veredicto y el arreglo de la prueba que falló a la vista', () => {
    diagnostico = crearDiagnostico();
    renderConProveedores(<DiagnosticoPagina />, {
      sesion: estadoSesionDePrueba(['admin.ver-bitacora']),
    });

    expect(screen.getByText(/lo que falla es la política CORS/i)).toBeInTheDocument();
    expect(screen.getByText(/Pega la política sugerida en Cloudflare/i)).toBeInTheDocument();
    expect(screen.getByTestId('diagnostico-copiar-cors')).toBeInTheDocument();
  });

  it('avisa que NO hay segundo respaldo cuando falta configuración', () => {
    diagnostico = crearDiagnostico();
    renderConProveedores(<DiagnosticoPagina />, {
      sesion: estadoSesionDePrueba(['admin.ver-bitacora']),
    });

    expect(screen.getByText(/NO hay segundo respaldo/i)).toBeInTheDocument();
    expect(screen.getByText(/Todavía no hay ninguna corrida registrada/i)).toBeInTheDocument();
  });

  it('esconde «Respaldar ahora» a quien no tiene el permiso de ejecutarlo', () => {
    diagnostico = crearDiagnostico();
    renderConProveedores(<DiagnosticoPagina />, {
      sesion: estadoSesionDePrueba(['admin.ver-bitacora']),
    });

    expect(screen.queryByTestId('diagnostico-respaldar')).not.toBeInTheDocument();
  });

  it('se lo muestra a quien sí lo tiene', () => {
    diagnostico = crearDiagnostico();
    renderConProveedores(<DiagnosticoPagina />, {
      sesion: estadoSesionDePrueba(['admin.ver-bitacora', 'admin.respaldo-ejecutar']),
    });

    expect(screen.getByTestId('diagnostico-respaldar')).toBeInTheDocument();
  });
});
