/**
 * VERSIÓN DEL SISTEMA — la fuente única en el frontend.
 *
 * Se pinta en la topbar, junto a «Control v2» (`CascaronSistema`), para que
 * Daniel pueda decir «estoy viendo la 0.007 y me pasó esto» sin adivinar.
 *
 * REGLA (Daniel, 19-ago-2026): **la versión sube CADA VEZ que se actualiza
 * `prueba`**, y el número es UNO SOLO que viaja de `prueba` a producción. La
 * numeración es `0.xxx` mientras nada esté en producción; el día del arranque
 * se rebautiza `1.000`. El relato de cada versión vive en
 * `HISTORIAL-DE-VERSIONES.md` (raíz del repo).
 *
 * ⚠️ **Este número y el historial NO pueden divergir.** Cuando se agregue una
 * entrada nueva al historial hay que subir esta constante en el MISMO commit;
 * `version.test.ts` compara las dos y se pone rojo en CI si no coinciden — una
 * versión que miente en pantalla es peor que no tener versión.
 */
export const VERSION = '0.013';
