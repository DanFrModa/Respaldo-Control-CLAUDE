/**
 * ⭐ V1-E7b — EL REPARTO de `modelos.aprobar-receta`, y su TENSIÓN con `listas.aprobar`.
 *
 * Daniel dejó dos aprobaciones que se parecen y NO son la misma, y avisó de lo que pasa si se
 * juntan por descuido (§Post-F9.110 (b)):
 *
 * | Aprobación | Qué compromete | Quién |
 * |---|---|---|
 * | La **RECETA** (`modelos.aprobar-receta`) | que el modelo quede técnicamente bien | Daniel **y Aurora** |
 * | El **PRECIO** (`listas.aprobar`, F8-E4 (h)) | lo que se le cobra al cliente | **sólo el dueño** |
 *
 * *"Si se juntaran por descuido, Aurora acabaría aprobando precios sin que nadie lo hubiera
 * decidido."* Aurora es **Gerencial**.
 *
 * ⚠️ Por qué esta prueba existe aparte de `seed.int.test.ts`: aquélla comprueba que la CASCADA de
 * conteos baja (Ventas ⊂ Gerencial ⊂ Directivo…), y una cascada de conteos **no ve** que un
 * permiso se mueva de un escalón a otro — los dos conteos se compensan y todo sigue "bajando".
 * Lo que Daniel fijó es QUÉ escalón corta CUÁL permiso, y eso hay que nombrarlo. Además es PURA
 * (`definirRoles` no toca la base), así que corre en el proyecto `unit` sin Docker.
 */
import { describe, expect, it } from 'vitest';

import { definirRoles } from '../../prisma/seed.js';

/** Los permisos de un rol por su nombre (falla claro si el rol se renombra). */
function permisosDe(nombre: string): string[] {
  const rol = definirRoles().find((r) => r.nombre === nombre);
  expect(rol, `no existe el rol "${nombre}" en el seed`).toBeDefined();
  return rol?.permisos ?? [];
}

describe('reparto de las DOS aprobaciones (§Post-F9.110 (b) + F8-E4 (h))', () => {
  it('⭐ GERENCIAL aprueba la RECETA pero NO los precios (es toda la decisión de Daniel)', () => {
    const gerencial = permisosDe('Gerencial');
    expect(gerencial).toContain('modelos.aprobar-receta');
    // La otra mitad, y la que duele si alguien "unifica" los dos permisos:
    expect(gerencial).not.toContain('listas.aprobar');
  });

  it('⭐ VENTAS no aprueba recetas: ahí se corta', () => {
    expect(permisosDe('Ventas')).not.toContain('modelos.aprobar-receta');
  });

  it('el dueño y la dirección sí aprueban receta (y también precios)', () => {
    for (const rol of ['Administrador', 'AdministracionDireccion', 'Directivo']) {
      expect(permisosDe(rol), rol).toContain('modelos.aprobar-receta');
      expect(permisosDe(rol), rol).toContain('listas.aprobar');
    }
  });

  it('⭐ aprobar la receta NO arrastra administrar el catálogo (Aurora no administra modelos)', () => {
    // `modelos.administrar` se corta en Directivo. Si crear la versión lo exigiera además,
    // Aurora quedaría fuera de justo lo que Daniel le encargó.
    const gerencial = permisosDe('Gerencial');
    expect(gerencial).toContain('modelos.aprobar-receta');
    expect(gerencial).not.toContain('modelos.administrar');
  });
});
