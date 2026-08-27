/**
 * ⭐ V1-E8d (§Post-F9.127) — **EL AVISO DE QUE EL COSTO DEBAJO DEL PRECIO QUEDÓ VIEJO.**
 *
 * Daniel, 26-ago-2026, después de que se le explicara el hueco (*"tu precio aprobado se queda
 * parado sobre un costo que ya no existe. El sistema no avisa"*):
 *
 * > *"Si. Ok. **Que me avise.**"*
 *
 * ⚠️ **EL HUECO, tal como se midió en V1-E8b.** Un renglón de lista de precios guarda dos cosas:
 * el id de un **precosto CONGELADO** y una **copia** de su costo. Las versiones congeladas son
 * INMUTABLES por diseño (D3) — y eso está bien, es lo que hace que un precio firmado se pueda
 * auditar años después. La consecuencia es que **cambiar la receta del modelo no mueve nada del
 * renglón**: hay que congelar una versión nueva Y registrar una ronda, las dos a mano. Si se olvida
 * cualquiera de las dos, el precio aprobado sigue en pie sobre un costo que ya no corresponde a la
 * receta de hoy.
 *
 * ⚠️ **POR QUÉ ESTO ES UN AVISO Y NO UNA FIRMA QUE SE CAE** — y por qué eso NO es un tercer
 * criterio, aunque los hermanos §Post-F9.116 y §Post-F9.125(d) sí tumben la firma. La regla que
 * este proyecto adoptó es *«cambiar aquello sobre lo que se firmó tumba la firma»*, y la palabra
 * que hace el trabajo es **aquello**:
 *
 *  • En §Post-F9.116 se firmó **la receta del modelo**, y lo que cambia es la receta del modelo:
 *    misma fila, mismo acto.
 *  • En §Post-F9.125(d) se firmó **un precio calculado con esos factores**, y lo que cambia son
 *    esos factores: misma lista, misma transacción.
 *  • Aquí se firmó **un precio calculado sobre el precosto congelado v3**, y el precosto congelado
 *    v3 **no ha cambiado ni puede cambiar**. Lo que cambió es el modelo del que ese precosto salió.
 *    El precio sigue siendo exactamente coherente con lo que se firmó; lo que ya no se sabe es si
 *    lo que se firmó sigue describiendo lo que se va a fabricar.
 *
 * *No es la misma clase de hecho, y por eso no pide la misma clase de respuesta.* Un cambio de
 * receta puede no mover el costo ni un peso (se corrigió el archivo del arte, se ajustó una medida
 * por talla) y el sistema **no tiene forma de saberlo** sin volver a costear: sólo el humano que
 * congela la versión nueva puede decirlo. Tumbar aquí cancelaría precios firmados —y ya
 * comunicados al cliente en una cotización— por hechos que a lo mejor no los tocan.
 *
 * 🔴 **EL HUECO QUE ESTE AVISO DEJA, dicho y no callado.** Un aviso se puede ignorar: con el
 * desfase a la vista, la cotización, el PDF y el Excel **siguen saliendo** con ese precio aprobado.
 * Cerrarlo del todo sería **bloquear** el papel mientras el costo esté viejo, y eso es MÁS de lo
 * que Daniel pidió — es él quien tiene que decidirlo, no el código. Queda anotado en
 * §Post-F9.127 y en `docs/hoja-de-ruta/V1-etapas.md` §V1-E8d.
 *
 * ⚠️ **LO QUE NO DETECTA (y es estructural, no un olvido).** La señal es `Modelo.recetaTocadaEn`,
 * que nace en NULL para todo el catálogo y sólo la escribe el embudo de la receta a partir del
 * despliegue. Un desfase que YA existía ese día **no se ve**; se ve el primer cambio de receta
 * posterior. La alternativa —rellenar la columna con `modificadoEn`— era precisamente la mentira
 * que esta etapa descartó (ver el encabezado de la migración `20260827160000_aviso_costo_viejo`).
 */
import { fechaDelActo } from '../../comun/fecha-negocio.js';
import { textoDelCambioDeReceta } from '../modelos/revision-modelo.js';

/** Lo que el criterio necesita mirar de un renglón de lista. Estructural: es probable sin base. */
export interface RenglonParaAvisoDeCosto {
  /** Cuándo se CONGELÓ el precosto que el renglón usa. Null = no se sabe (ver abajo). */
  congeladoEn: Date | null;
  /** Nº de versión de ese precosto, para que el aviso diga de cuál habla. */
  versionPrecosto: number;
  /** Cuándo se tocó por última vez la RECETA del modelo. Null = no se sabe. */
  recetaTocadaEn: Date | null;
  /** Qué parte de la receta se tocó (código de `CambioDeReceta`), o null. */
  recetaTocadaCambio: string | null;
  /** ¿El renglón tiene precio APROBADO? Cambia la gravedad de la frase, no el criterio. */
  aprobado: boolean;
}

/**
 * ⭐ **EL CRITERIO, UNO SOLO.** Devuelve la FRASE que hay que enseñar, o `null` si no hay nada que
 * avisar. Es una función pura: mismas entradas, misma salida, sin base de datos.
 *
 * Devuelve la frase armada —y no un booleano— a propósito, por la cicatriz de este proyecto: *«la
 * frase del servidor nunca llega a la pantalla»*. Con el texto hecho aquí, la pantalla no puede
 * degradarlo a un semáforo mudo ni inventar una segunda redacción que se desincronice, y el aviso
 * dice **QUÉ** cambió y **CUÁNDO** — que es lo que le sirve a quien tiene que decidir si recostea.
 *
 * ⚠️ **`congeladoEn` en NULL no avisa**, y es deliberado. Un renglón siempre apunta a un precosto
 * `congelado` (el dominio lo exige al crear el renglón y en cada ronda) y congelar sella la fecha en
 * la misma escritura, así que en la práctica no ocurre. Si ocurriera, no habría contra qué comparar:
 * avisar siempre sería una alarma sin hecho detrás, que es justo lo que esta etapa evita.
 */
export function avisoDeCostoViejo(renglon: RenglonParaAvisoDeCosto): string | null {
  const { congeladoEn, recetaTocadaEn } = renglon;
  if (congeladoEn === null || recetaTocadaEn === null) {
    return null;
  }
  // ESTRICTAMENTE después: una receta tocada en el MISMO instante del congelado es el congelado
  // recogiéndola, no un cambio posterior.
  if (recetaTocadaEn.getTime() <= congeladoEn.getTime()) {
    return null;
  }

  const queCambio = textoDelCambioDeReceta(renglon.recetaTocadaCambio);
  const cierre = renglon.aprobado
    ? 'El precio APROBADO sigue en pie sobre ese costo. Si el cambio mueve el costo, congela una ' +
      'versión nueva del precosto, regístrala como ronda y vuelve a aprobar el precio.'
    : 'Si el cambio mueve el costo, congela una versión nueva del precosto y regístrala como ' +
      'ronda antes de aprobar el precio.';

  return (
    `Cambió ${queCambio} de este modelo el ${fechaDelActo(recetaTocadaEn)}, DESPUÉS de congelarse ` +
    `el costo con el que está calculado (v${String(renglon.versionPrecosto)}, del ` +
    `${fechaDelActo(congeladoEn)}). ${cierre}`
  );
}
