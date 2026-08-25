/**
 * ABREVIATURA de cliente para los e2e — el «CYA» de `CYA-26-71-001`.
 *
 * Vive en su propio módulo, y SIN NI UN IMPORT, por una razón concreta: así lo pueden usar las dos
 * cosas que tienen que estar de acuerdo — el spec de Playwright (`pedidos.spec.ts`) y la prueba
 * unitaria que lo valida contra el contrato real (`src/abreviatura-e2e.test.ts`). Si estuviera
 * dentro del spec habría que copiarlo, y una copia es exactamente como nacen las divergencias.
 * (`ayudas.ts` no sirve de casa: importa `@playwright/test`, que Vitest no debe cargar.)
 *
 * ⚠️ **La regla es EXACTAMENTE 3 LETRAS A–Z** (§Post-F9.112, V1-E7b). Antes eran 2–6 letras o
 * dígitos, y de ahí venía el generador viejo —`E` + 5 caracteres en base 36— que producía cosas
 * como `E4K7M2`. Con la regla nueva eso se RECHAZA: el alta del cliente no pasa, y en el e2e se
 * cae el flujo entero detrás (el aviso «Cliente … creado.» nunca aparece). Lo cazó el CI.
 *
 * ⚠️ **Por qué sale del RELOJ y no de un texto fijo.** `Cliente.abreviatura` es `@unique`: dos
 * corridas que elijan la misma no producen un nombre feo, producen un **409**. Por eso se deriva
 * del milisegundo actual, en base 26 sobre el alfabeto A–Z.
 *
 * ⚠️ **Y aquí el margen ENCOGIÓ, que es lo que no hay que callar.** Con 5 caracteres en base 36
 * había ~17 h antes de repetirse; con 3 letras hay 26³ = **17,576** valores, o sea que a
 * resolución de milisegundo el ciclo se cierra en **~17.6 segundos**. Sigue bastando aquí, y el
 * porqué es lo que lo sostiene —no la corazonada—:
 *
 *   • cada corrida de CI arranca con **base de datos nueva**, así que no hereda clientes;
 *   • este spec da de alta **UN SOLO cliente**, no una tanda;
 *   • y el **seed no siembra ninguna abreviatura** (`grep abreviatura backend/prisma/seed.ts` → 0),
 *     así que no hay con qué chocar de salida.
 *
 * 🔴 Si algún día un spec crea VARIOS clientes, o dos specs con cliente propio corren en paralelo
 * contra la MISMA base, estos 17.6 s dejan de ser holgura y hay que sortearlo de otra forma
 * (p. ej. mezclar el índice del worker de Playwright). Queda dicho antes de que muerda.
 */

/** Las 26 letras, que son los «dígitos» de la base en la que se escribe la abreviatura. */
const ALFABETO_LONGITUD = 26;
const CODIGO_A = 65;

/** Cuántas letras pide el contrato. Cambiar esto NO cambia la regla: la regla vive en el backend. */
export const LETRAS_ABREVIATURA = 3;

/**
 * Devuelve una abreviatura de EXACTAMENTE 3 letras A–Z derivada del reloj.
 *
 * `ahora` se puede inyectar —y por eso existe el parámetro— para que la prueba unitaria la
 * compruebe sobre MUCHOS instantes distintos, en vez de sobre el único que le tocó al correr.
 */
export function generarAbreviaturaCliente(ahora: number = Date.now()): string {
  let restante = Math.abs(Math.trunc(ahora));
  let abreviatura = '';
  for (let i = 0; i < LETRAS_ABREVIATURA; i += 1) {
    abreviatura = String.fromCharCode(CODIGO_A + (restante % ALFABETO_LONGITUD)) + abreviatura;
    restante = Math.floor(restante / ALFABETO_LONGITUD);
  }
  return abreviatura;
}
