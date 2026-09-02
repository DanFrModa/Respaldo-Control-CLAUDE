import { AlertTriangle, Download, Maximize2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useRecetaOrden } from '@/api/receta-orden';
import { Button } from '@/components/ui/button';

import { ChipHermanas } from './AvisoHermanas';
import { BadgeFirmaReceta, faltantesDelModelo } from './receta-piezas';

/**
 * ⭐ V1-E3j — **EL RESUMEN de la receta en el detalle de la OP**, y el botón que lleva a la pantalla
 * completa.
 *
 * POR QUÉ UN RESUMEN Y NO EL PANEL ENTERO. Daniel, probando la 0.005: *"ahí mismo, en el cuadrito
 * chiquito, no se ve toda la información"*. El cajón de detalle de la OP nunca iba a alcanzar para
 * una receta completa (telas, avíos con medidas por talla, arte, consumos, precios, proveedores, dos
 * estados por renglón y los avisos de desalineación); apretarlo ahí fue justo lo que escondió el
 * botón que resolvía su problema. Pero el VISTAZO desde la OP sí vale: quien abre una orden tiene que
 * poder ver de un golpe si su material está firmado, sin navegar. Eso es lo que queda aquí.
 *
 * CÓMO SE EVITA LA SEGUNDA COPIA (y por qué no basta con decirlo). Los números que enseña
 * —`resumen.total`, `resumen.porLiberar`, `todoLiberado`, `puedeComprar`, la desalineación— los
 * **agrega el servidor** (A1) en la MISMA consulta que lee la pantalla completa (`useRecetaOrden`,
 * misma clave de TanStack Query: una sola petición, un solo caché).
 *
 * ⚠️ Pero eso NO alcanzaba, y el reviewer de V1-E3j lo demostró: **la primera versión de este
 * archivo repetía dos predicados de LECTURA** —qué cuenta como faltante y qué cuenta como "liberada
 * en parte"— escritos otra vez a mano. Coincidían por casualidad; relajando **solo** esta copia, las
 * 7 pruebas del resumen seguían verdes, y el día que cambiara la regla la insignia de la OP y la
 * pantalla habrían dicho números distintos de la misma cosa. Por eso los dos viven ahora en
 * `receta-piezas.tsx`, en una sola copia que consumen los dos lados.
 *
 * ⚠️ Aquí NO se firma ni se edita: el trabajo se hace donde se ve. Lo único que este bloque ofrece
 * es el camino.
 */
export function ResumenRecetaOrden({ idOrden }: { idOrden: number }): React.JSX.Element {
  const navigate = useNavigate();
  const consulta = useRecetaOrden(idOrden);

  if (consulta.isPending) {
    return <p className="text-sm text-muted-foreground">Cargando la receta de la orden…</p>;
  }
  if (consulta.isError) {
    return <p className="text-sm text-destructive">{consulta.error.message}</p>;
  }

  const d = consulta.data;
  const r = d.resumen;
  // ⚠️ El estado de firma y qué cuenta como FALTANTE se leen de `receta-piezas`, la MISMA copia que
  // usa la pantalla completa. Escribir aquí el predicado otra vez —como estaba— hace que el día que
  // cambie la regla, la insignia de la OP y la pantalla digan números distintos de lo mismo.
  const faltantes = faltantesDelModelo(d).length;

  return (
    <div className="space-y-2 rounded-lg border p-3" data-testid="receta-resumen">
      <div className="flex flex-wrap items-center gap-2">
        <BadgeFirmaReceta receta={d} />
        <span className="text-xs text-muted-foreground" data-testid="receta-resumen-conteo">
          {r.total === 0
            ? 'sin materiales todavía'
            : `${r.total} renglones · ${r.porLiberar} por firmar`}
        </span>
      </div>

      {/* ⭐ Lo que falta traer del modelo se anuncia TAMBIÉN aquí: es la razón nº 1 por la que hay
          que entrar, y en la 0.005 fue lo que nadie vio. El botón de traerlo vive en la pantalla
          completa (una sola copia de la acción). */}
      {faltantes > 0 ? (
        <p
          className="flex items-center gap-1.5 text-xs font-medium text-primary"
          data-testid="receta-resumen-faltantes"
        >
          <Download className="size-3.5" aria-hidden />
          El modelo lleva {faltantes} {faltantes === 1 ? 'material' : 'materiales'} que esta orden
          no tiene
        </p>
      ) : null}

      {/* ⭐⭐ fila 0.068 (a): que esta OP no vaya igual que sus hermanas se asoma TAMBIÉN aquí, que
          es el sitio desde el que se abre la OP. El detalle (material por material) vive en la
          pantalla completa; el chip lo lleva en su `title`. Mismo componente que el Centro: una
          sola copia del texto para las tres superficies. */}
      <ChipHermanas frenteAlGrupo={d.frenteAlGrupo} className="text-xs" />

      {/* El aviso ROJO (el modelo se movió y ya hay OC) sí se asoma: es dinero comprometido. */}
      {d.desalineacion.critico ? (
        <p
          className="flex items-center gap-1.5 text-xs font-medium text-destructive"
          data-testid="receta-resumen-critico"
        >
          <AlertTriangle className="size-3.5" aria-hidden />
          El modelo cambió después de que esta orden ya tiene compras
        </p>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => void navigate(`/produccion/ordenes/${String(idOrden)}/receta`)}
        data-testid="receta-abrir-pantalla"
      >
        <Maximize2 aria-hidden /> Ver y liberar la receta
      </Button>
    </div>
  );
}
