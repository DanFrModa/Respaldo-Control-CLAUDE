import { CheckCircle2, CircleDashed, Lock } from 'lucide-react';

import type { CambioReceta, RecetaOrden } from '@/api/tipos';
import { Badge } from '@/components/ui/badge';

/**
 * PIEZAS COMPARTIDAS de la receta de la orden — lo que la PANTALLA COMPLETA
 * (`PanelRecetaOrden`) y el RESUMEN del detalle de la OP (`ResumenRecetaOrden`) tienen que decir
 * IGUAL, en UNA sola copia.
 *
 * ⚠️ POR QUÉ EXISTE ESTE ARCHIVO (hallazgo del reviewer de V1-E3j). Al partir la receta en dos
 * vistas, el predicado de "qué cuenta como FALTANTE del modelo" y el de "liberada EN PARTE"
 * quedaron **escritos dos veces**, uno en cada archivo. Coincidían por casualidad: el día que
 * cambie qué cuenta como faltante —o qué cuenta como firmado—, la insignia de la OP y la pantalla
 * dirían **números distintos de la misma cosa**, y nadie lo notaría porque cada archivo tiene sus
 * propias pruebas verdes. El reviewer lo comprobó relajando SOLO la copia del resumen: las 7
 * pruebas siguieron pasando.
 *
 * A1: aquí no se decide NADA de negocio. Todo sale ya resuelto del servidor (`desalineacion`,
 * `puedeComprar`, `todoLiberado`, `resumen`); estas funciones solo lo LEEN de una única manera.
 */

/**
 * Los cambios del modelo que «traer del modelo» sí puede resolver: los que el modelo tiene y esta
 * orden no (`agregado`) **y** traen la traza al BOM (`idMaterialModelo`).
 *
 * Los demás cambios ya tienen renglón en la orden y su camino es «Restaurar», que sí pisa y por eso
 * es de uno en uno. Un `agregado` SIN traza no se puede pedir: no hay material que mandarle al
 * servidor (se informa, pero no se ofrece).
 */
export function faltantesDelModelo(receta: RecetaOrden): readonly CambioReceta[] {
  return receta.desalineacion.cambios.filter(
    (c) => c.que === 'agregado' && c.idMaterialModelo !== null,
  );
}

/**
 * ⭐ V1-E3h: la firma tiene TRES estados, no dos, y los decide el SERVIDOR. ⭐⭐ V1-E8z le suma un
 * CUARTO, que va PRIMERO porque manda sobre los otros tres:
 *  • `en-correccion` — la receta está ABIERTA (§Post-F9.160(a)): **la compra de la orden está
 *                      congelada**, sin importar cuántas firmas haya. Va primero a propósito: como
 *                      reabrir NO desfirma, `todoLiberado` sigue en `true` y sin este caso la
 *                      insignia diría «Receta liberada» mientras el servidor rechaza toda compra —
 *                      el letrero mintiendo justo sobre lo único que importa.
 *  • `liberada`      — no queda ningún renglón vivo sin firmar.
 *  • `en-parte`      — hay algo firmado (se puede comprar) y algo pendiente. El estado que la etapa
 *                      vino a hacer posible, y el que hay que ver de un vistazo: quien abre la orden
 *                      tiene que saber si el comprador está esperando su firma para algo.
 *  • `sin-liberar`   — nadie ha firmado nada: no hay qué comprar.
 */
export function estadoFirmaReceta(
  receta: RecetaOrden,
): 'en-correccion' | 'liberada' | 'en-parte' | 'sin-liberar' {
  if (receta.abiertaEn !== null) return 'en-correccion';
  if (receta.todoLiberado) return 'liberada';
  return receta.puedeComprar ? 'en-parte' : 'sin-liberar';
}

/**
 * La INSIGNIA del estado de firma, idéntica en la pantalla completa y en el resumen de la OP —
 * mismos textos y mismos `data-testid`, porque es el mismo dato leído en dos lugares.
 */
export function BadgeFirmaReceta({ receta }: { receta: RecetaOrden }): React.JSX.Element {
  const estado = estadoFirmaReceta(receta);
  if (estado === 'en-correccion') {
    return (
      <Badge variant="outline" className="border-crit text-crit" data-testid="receta-en-correccion">
        <Lock className="size-3.5" aria-hidden /> En corrección · compra congelada
      </Badge>
    );
  }
  if (estado === 'liberada') {
    return (
      <Badge variant="default" data-testid="receta-liberada">
        <CheckCircle2 className="size-3.5" aria-hidden /> Receta liberada
      </Badge>
    );
  }
  if (estado === 'en-parte') {
    return (
      <Badge variant="outline" className="border-warn text-warn" data-testid="receta-en-parte">
        <CircleDashed className="size-3.5" aria-hidden /> Liberada en parte ·{' '}
        {receta.resumen.porLiberar} por firmar
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" data-testid="receta-sin-liberar">
      <CircleDashed className="size-3.5" aria-hidden /> Sin liberar
    </Badge>
  );
}
