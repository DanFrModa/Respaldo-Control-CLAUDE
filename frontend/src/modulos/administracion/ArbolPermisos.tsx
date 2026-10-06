import type { CatalogoPermisos } from '@/api/roles';

/**
 * Árbol de permisos agrupado por módulo (checkboxes). Componente de PRESENTACIÓN: no guarda nada,
 * sólo pinta lo marcado y avisa qué casilla se alternó. Lo comparten el editor del detalle de un rol
 * (`EditorPermisos` en `RolesPagina`) y el alta por DUPLICADO (`DialogoRol`, fila 0.248), para que
 * las dos pantallas pinten exactamente el mismo árbol.
 */
export function ArbolPermisos({
  catalogo,
  seleccion,
  alAlternar,
  deshabilitado,
}: {
  catalogo: CatalogoPermisos;
  /** Claves marcadas. */
  seleccion: ReadonlySet<string>;
  alAlternar: (clave: string) => void;
  deshabilitado: boolean;
}): React.JSX.Element {
  return (
    // Rejilla FLUIDA al ancho del contenedor (auto-fit): 1 columna en móvil, 2-3 en
    // amplio/máximo. `min(100%,…)` evita que la columna mínima desborde cuando el
    // contenedor es más angosto que 15rem — así las secciones nunca se enciman.
    <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))]">
      {catalogo.map((grupo) => {
        const marcadosModulo = grupo.permisos.filter((p) => seleccion.has(p.clave)).length;
        return (
          <fieldset
            key={grupo.modulo}
            // `min-w-0`: un <fieldset> trae `min-inline-size: min-content` de fábrica y, sin
            // esto, se niega a encoger a su columna del grid y DESBORDA sobre la de al lado
            // (era el encimado de las secciones de Finanzas).
            className="min-w-0 rounded-xl ring-1 ring-foreground/10 p-3"
            data-testid="grupo-permisos"
          >
            <legend className="flex items-center gap-2 px-1 text-sm font-medium">
              {grupo.etiqueta}
              <span className="text-xs text-muted-foreground">
                {marcadosModulo}/{grupo.permisos.length}
              </span>
            </legend>
            <ul className="mt-1 space-y-1.5">
              {grupo.permisos.map((permiso) => (
                <li key={permiso.clave}>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-1.5 py-1 hover:bg-muted">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                      checked={seleccion.has(permiso.clave)}
                      disabled={deshabilitado}
                      onChange={() => alAlternar(permiso.clave)}
                      data-testid="permiso-checkbox"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm leading-tight">{permiso.descripcion}</span>
                      <span className="block font-mono text-[11px] break-words text-muted-foreground">
                        {permiso.clave}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}
