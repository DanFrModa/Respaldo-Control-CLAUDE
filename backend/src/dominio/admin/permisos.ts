/**
 * Catálogo de permisos agrupado por módulo (para el árbol de la pantalla de
 * administración de roles). Es un catálogo de CÓDIGO (`src/contrato`, A4): NO
 * toca la base de datos, solo proyecta el catálogo tipado a una forma cómoda
 * para la UI (módulos con su etiqueta + sus permisos).
 *
 * La autorización (`roles.administrar`) la aplica la ruta que lo expone: este
 * helper es puro y determinista (mismo resultado siempre), así que no recibe
 * sesión ni cliente de BD.
 */
import { MODULOS_PERMISO, permisosPorModulo } from '../../contrato/index.js';

/** Un permiso del catálogo tal como lo consume la UI. */
export interface PermisoCatalogoDto {
  clave: string;
  descripcion: string;
  modulo: string;
}

/** Un módulo funcional con los permisos que agrupa. */
export interface ModuloPermisosDto {
  modulo: string;
  etiqueta: string;
  permisos: PermisoCatalogoDto[];
}

/**
 * Devuelve el catálogo completo de permisos agrupado por módulo (en el orden en
 * que aparecen en el catálogo), con la etiqueta de cada módulo para la UI.
 */
export function listarCatalogoPermisos(): ModuloPermisosDto[] {
  const grupos = permisosPorModulo();
  const resultado: ModuloPermisosDto[] = [];
  for (const [modulo, permisos] of grupos) {
    resultado.push({
      modulo,
      etiqueta: MODULOS_PERMISO[modulo],
      permisos: permisos.map((p) => ({
        clave: p.clave,
        descripcion: p.descripcion,
        modulo: p.modulo,
      })),
    });
  }
  return resultado;
}
