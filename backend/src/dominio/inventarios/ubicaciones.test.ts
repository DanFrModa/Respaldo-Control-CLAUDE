import { describe, expect, it } from 'vitest';

import { ErrorPermiso, ErrorValidacion } from '../../comun/errores.js';
import { sesionDePrueba } from '../../pruebas/sesiones.js';
import { fijarUbicacionAvio, fijarUbicacionTelaColor } from './ubicaciones.js';

/**
 * Unit de DÓNDE ESTÁ GUARDADO EL MATERIAL (fila 0.103) — SIN Postgres: sólo lo que se decide antes
 * de tocar la base, que es el guard de permisos (A4) y el tope del texto. La regla de verdad
 * —vacío borra, con texto crea/actualiza, y el almacén tiene que ser del tipo y de la empresa— vive
 * en `ubicaciones.int.test.ts`, que es donde hay base contra la cual medirla.
 *
 * ⚠️ El orden IMPORTA y por eso se prueba: el permiso se verifica ANTES de validar la entrada. Si
 * fuera al revés, quien no tiene la llave sabría —por el mensaje de validación— que el endpoint
 * existe y qué campos pide.
 */
const soloVerTelas = () => sesionDePrueba({ permisos: ['inventario-telas.ver'] });
const soloVerAvios = () => sesionDePrueba({ permisos: ['inventario-avios.ver'] });
const moverTelas = () => sesionDePrueba({ permisos: ['inventario-telas.mover'] });
const moverAvios = () => sesionDePrueba({ permisos: ['inventario-avios.mover'] });

describe('Ubicación del material — permisos (A4, deny-by-default)', () => {
  it('rechaza fijar la ubicación de una tela sin inventario-telas.mover (ver NO alcanza)', async () => {
    await expect(
      fijarUbicacionTelaColor(soloVerTelas(), {
        idTelaColor: 1,
        idAlmacen: 1,
        ubicacion: 'Rack 4',
      }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('rechaza fijar la ubicación de un avío sin inventario-avios.mover (ver NO alcanza)', async () => {
    await expect(
      fijarUbicacionAvio(soloVerAvios(), { idAvio: 1, idAlmacen: 1, ubicacion: 'Pasillo B' }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });

  it('el permiso se verifica ANTES que la entrada: una captura inválida sin llave da ErrorPermiso', async () => {
    // Texto que pasa del tope Y sin permiso: si validara primero, saldría ErrorValidacion.
    await expect(
      fijarUbicacionTelaColor(soloVerTelas(), {
        idTelaColor: 1,
        idAlmacen: 1,
        ubicacion: 'x'.repeat(500),
      }),
    ).rejects.toBeInstanceOf(ErrorPermiso);
  });
});

describe('Ubicación del material — captura (texto libre, con techo)', () => {
  it('rechaza un texto más largo que el tope del contrato', async () => {
    await expect(
      fijarUbicacionTelaColor(moverTelas(), {
        idTelaColor: 1,
        idAlmacen: 1,
        ubicacion: 'x'.repeat(121),
      }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });

  it('rechaza ids que no son ids (el 0 no identifica a nadie)', async () => {
    await expect(
      fijarUbicacionAvio(moverAvios(), { idAvio: 0, idAlmacen: 1, ubicacion: 'Rack 1' }),
    ).rejects.toBeInstanceOf(ErrorValidacion);
  });
});
