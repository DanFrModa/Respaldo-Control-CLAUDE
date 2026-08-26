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

  it('⭐ Gerencial SÍ administra modelos: es su trabajo diario, no un catálogo maestro', () => {
    // ⚠️ ESTA PRUEBA AFIRMABA LO CONTRARIO hasta el 26-ago-2026, y se INVIERTE a propósito
    // (§Post-F9.123). No se borró: la afirmación vieja —«Aurora no administra modelos»— era
    // correcta bajo la regla de entonces («administrar catálogos es de Administración/Dirección»)
    // y se conserva su rastro aquí porque explica por qué el sistema llegó a ese estado.
    //
    // Lo que cambió es el criterio, no el código: **un modelo NO es un catálogo como los demás.**
    // Una tela o un color son datos maestros que se dan de alta una vez; un modelo es el TRABAJO
    // DIARIO de Desarrollo. Daniel lo destapó al reportar que Aurora —que lleva Desarrollo
    // entero— no podía dar de alta un modelo, que es justo por donde arranca todo lo demás que
    // ella sí podía hacer (proyectos, precosteo, listas, negociar, emitir cotizaciones).
    const gerencial = permisosDe('Gerencial');
    expect(gerencial).toContain('modelos.aprobar-receta');
    expect(gerencial).toContain('modelos.administrar');
  });

  it('⭐ …pero eso NO le abre los costos REALES ni el estado de resultados', () => {
    // La línea que trazó Daniel: ve **EL PLAN** (lo que va a costar), no **EL RESULTADO**
    // (cómo terminamos). Administrar modelos no puede arrastrar lo de después.
    const gerencial = permisosDe('Gerencial');
    // El plan: sí.
    expect(gerencial).toContain('precostos.consultar');
    expect(gerencial).toContain('consultas.ver-importes');
    // El resultado: no.
    for (const permiso of [
      'costos.ver',
      'costos.capturar',
      'ordenes.ver-costos',
      'edr.ver',
      'edr.capturar',
    ]) {
      expect(gerencial, permiso).not.toContain(permiso);
    }
    // Y el precio sigue siendo del dueño: ella arma y manda la cotización, él lo aprueba.
    expect(gerencial).toContain('listas.negociar');
    expect(gerencial).not.toContain('listas.aprobar');
  });
});
