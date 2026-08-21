/**
 * EL INTERRUPTOR de módulos apagados (V1-E3t — `DECISIONES.md §Post-F9.36 punto 1`).
 *
 * Daniel decidió el 13-ago-2026 que la **Ruta Crítica arranca APAGADA** en la primera versión
 * (*"Sí podemos arrancar sin ruta crítica. Hoy honestamente no lo estamos ocupando en Control.
 * Podríamos empezar sin eso sin problema. Y lo vamos construyendo."*) y lo ratificó el 21-ago
 * (*"sigue apagada, déjala que se apague bien"*).
 *
 * ⚠️ APAGAR **NO ES DEMOLER**. El módulo, sus tablas, sus datos y sus ~181 rutas históricas se
 * quedan intactos (D3: nada se borra en silencio). Esto es un INTERRUPTOR: se enciende de nuevo
 * vaciando {@link MODULOS_APAGADOS} y re-sembrando (procedimiento exacto en
 * `docs/modulos/ruta-critica.md` §"Cómo se vuelve a encender").
 *
 * ── POR QUÉ AQUÍ Y NO EN UNA VARIABLE DE ENTORNO ──────────────────────────────────────────────
 * El RBAC de CONTROL v2 tiene una sola fuente de verdad y vive EN CÓDIGO (A4: *"el catálogo vive
 * en código y la base de datos se sincroniza desde aquí"*). Un `RC_ACTIVA` de Railway partiría esa
 * verdad en dos —la BD diría una cosa y el código otra—, sería invisible en `git` y un dedazo en el
 * panel encendería medio módulo sin que quede rastro. Como constante, el interruptor se revisa en
 * un PR, se prueba en CI y su historia queda en el log.
 *
 * ── QUÉ APAGA, EXACTAMENTE ────────────────────────────────────────────────────────────────────
 * Un módulo apagado tiene DOS efectos, y los dos cuelgan de esta constante:
 *
 *  1. **Sus permisos dejan de existir para cualquier sesión.** `cargarPermisosDeUsuario`
 *     (`comun/permisos.ts`) los filtra al armar la sesión, así que `verificarPermiso` y los guards
 *     `conPermiso`/`conAlgunPermiso` responden **403 desde el SERVIDOR** por más que la fila
 *     `RolPermiso` siga en la base (rol a la medida, permiso suelto, caché viejo: da igual). Y como
 *     el frontend pinta menú y ruta con esos MISMOS permisos, las tres capas de §Post-F9.68
 *     —esconder el menú, cerrar la ruta y bloquear el servidor— caen de un solo golpe.
 *     El seed (`prisma/seed.ts`) además los resta de los roles de sistema, para que la base no
 *     cargue concesiones muertas.
 *  2. **Sus procesos de fondo no corren.** La generación automática de la RC al nacer la OP
 *     (`dominio/ruta-critica/rcAutomatica.ts`) se OMITE con bitácora; el consumidor de la cola
 *     sigue vivo y DRENANDO (el outbox y pg-boss nunca se acumulan).
 */
import { MODULOS_PERMISO, type ClavePermiso, type ModuloPermiso } from './permisos.js';

/**
 * Módulos APAGADOS en esta versión del sistema. **Vaciar este arreglo vuelve a encender lo que
 * contenga** (y re-sembrar devuelve los permisos a los roles de sistema).
 *
 * `rc` — Ruta Crítica (Módulo 8, F5). Apagada por decisión de Daniel para la v1.
 */
export const MODULOS_APAGADOS: readonly ModuloPermiso[] = ['rc'];

/** ¿Ese módulo está apagado en esta versión? */
export function moduloApagado(modulo: ModuloPermiso): boolean {
  return MODULOS_APAGADOS.includes(modulo);
}

/**
 * ¿Ese permiso pertenece a un módulo apagado? El módulo es SIEMPRE el prefijo de la clave
 * (`modulo.accion`, invariante del catálogo), así que se resuelve por prefijo sin buscar en la
 * tabla — barato y sin dependencias, que es lo que quiere el camino caliente de cada petición.
 */
export function permisoApagado(clave: ClavePermiso): boolean {
  const modulo = clave.slice(0, clave.indexOf('.'));
  return (
    modulo in MODULOS_PERMISO && moduloApagado(modulo as ModuloPermiso)
  );
}

/** Quita de una lista de permisos los que pertenezcan a módulos apagados. */
export function sinPermisosApagados(claves: readonly ClavePermiso[]): ClavePermiso[] {
  return claves.filter((clave) => !permisoApagado(clave));
}
