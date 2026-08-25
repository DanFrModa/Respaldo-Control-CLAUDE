import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useAsignarColorTela, useColoresDeTela, useFijarPrecioColor } from '@/api/mrp';
import type { ColorDeLaOrden, TelaConColores } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ChipEstado } from '@/components/dominio/ChipEstado';

/**
 * ⭐⭐ **DE QUÉ COLOR SE COMPRA CADA TELA** (V1-E3u, `DECISIONES.md` §Post-F9.89).
 *
 * Daniel: *"cuando se hace la receta no lleva el color, solo lleva la tela. Pero al pedir la tela…
 * tengo que pedir el color en cada modelo"*. Aquí se dice, color por color de la matriz de la OP.
 *
 * Lo que esta pantalla NO hace, a propósito:
 *  • **no calcula** cuánta tela pide cada color — eso viene del servidor (A1);
 *  • **no acepta la propuesta sola**: la propuesta se ve al lado y hay que confirmarla. Es la misma
 *    regla que Daniel pidió para las cantidades (*"que compras capture"*), aplicada al color.
 *
 * ⚠️ Y el precio, que es lo que hay que leer despacio: corregirlo aquí **cambia el catálogo para
 * todos** (decisión (b)). Por eso el campo lo dice con letras y la pantalla enseña de cuánto a
 * cuánto quedó — el cambio no puede ocurrir callado.
 */
export function DialogoColoresDeTela({
  abierto,
  alCambiarAbierto,
  idOrden,
  folioOrden,
  puedeEditar,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  idOrden: number | undefined;
  folioOrden: number | undefined;
  /** ¿Esta sesión puede escribir (`compras.administrar`)? §Post-F9.68: esconder Y bloquear. */
  puedeEditar: boolean;
}): React.JSX.Element {
  const consulta = useColoresDeTela(abierto ? idOrden : undefined);
  const asignar = useAsignarColorTela();

  const telas = (consulta.data?.telas ?? []).filter((t) => !t.excluido);

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            De qué color se compra la tela
            {folioOrden === undefined ? '' : ` · orden ${String(folioOrden)}`}
          </DialogTitle>
          <DialogDescription>
            El modelo define la <b>tela</b>; el <b>color</b> es de cada pedido. Di qué color de la
            tela le toca a cada color de la orden: es lo que hace que la OC pida por color y que
            quien recibe no tenga que adivinar la correspondencia.
          </DialogDescription>
        </DialogHeader>

        {consulta.isPending ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            <Loader2Icon className="mr-2 inline size-4 animate-spin" aria-hidden />
            Cargando…
          </p>
        ) : telas.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Esta orden no lleva telas en su receta.
          </p>
        ) : (
          <div className="space-y-4" data-testid="colores-tela-lista">
            {telas.map((tela) => (
              <BloqueTela
                key={tela.idOrdenTela}
                tela={tela}
                idOrden={idOrden as number}
                puedeEditar={puedeEditar}
                guardando={asignar.isPending}
                onAsignar={(idColor, idTelaColor) => {
                  asignar.mutate(
                    {
                      idOrden: idOrden as number,
                      cuerpo: { idTela: tela.idTela, idColor, idTelaColor },
                    },
                    { onError: (error) => toast.error(error.message) },
                  );
                }}
              />
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => alCambiarAbierto(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Un renglón de TELA de la receta con sus colores de la orden. */
function BloqueTela({
  tela,
  idOrden,
  puedeEditar,
  guardando,
  onAsignar,
}: {
  tela: TelaConColores;
  idOrden: number;
  puedeEditar: boolean;
  guardando: boolean;
  onAsignar: (idColor: number, idTelaColor: number | null) => void;
}): React.JSX.Element {
  return (
    <section className="rounded-md border" data-testid="colores-tela-bloque">
      <header className="flex flex-wrap items-center gap-2 border-b bg-primary-soft px-3 py-2">
        <h3 className="font-medium">{tela.tela}</h3>
        <span className="text-xs text-muted-foreground">
          {tela.consumoPorPrenda}
          {tela.unidad === null ? '' : ` ${tela.unidad}`} por prenda
        </span>
        {tela.liberado ? null : (
          <ChipEstado tono="warn" sinPunto>
            Sin liberar
          </ChipEstado>
        )}
      </header>
      {tela.opciones.length === 0 ? (
        /* ⭐⭐ **V1-E6b (§Post-F9.106) — LA SEGUNDA PUERTA DEL MISMO CALLEJÓN.**
         *
         * Este texto mandaba a «Catálogos › Telas», o sea **fuera de la compra**: el defecto exacto
         * que esta etapa vino a matar, a un clic del que ya se cerró (se llega desde «Ver todos los
         * colores y precios de la orden N», en el mismo bloque del renglón). Que siguiera aquí hacía
         * que la frase de la 0.025 —*"antes te mandaba a Catálogos › Telas… ahora es la última
         * opción del desplegable"*— fuera cierta **sólo en una de las dos puertas**, y esa frase la
         * lee Daniel.
         *
         * Se arregla **apuntando a la puerta que sí existe**, no repitiéndola aquí.
         *
         * ⬜ **LO QUE FALTA, dicho y no escondido:** dar de alta el color **desde este diálogo**
         * (montar `DialogoNuevoColorDeTela` y elegir el creado, como en el renglón). Son ~40 líneas
         * y NO entran antes del arranque; mientras tanto el camino no queda cerrado —dice en una
         * línea a dónde ir y ese destino está en la MISMA pantalla, no en otra—. */
        <p className="px-3 py-3 text-xs text-warn" data-testid="colores-tela-sin-opciones">
          Esta tela todavía no tiene colores dados de alta. Puedes darlos de alta sin salir de la
          compra: cierra este cuadro y usa «Decir de qué color se compra» en el renglón de la tela —
          la última opción del desplegable es «＋ Nuevo color…». Mientras tanto se compra sin color.
        </p>
      ) : (
        <ul>
          {tela.colores.map((color) => (
            <FilaColor
              key={color.idColor}
              color={color}
              tela={tela}
              idOrden={idOrden}
              puedeEditar={puedeEditar}
              guardando={guardando}
              onAsignar={onAsignar}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Un color de la MATRIZ de la orden: sus piezas, lo que pide, y de qué color de tela se compra. */
function FilaColor({
  color,
  tela,
  idOrden,
  puedeEditar,
  guardando,
  onAsignar,
}: {
  color: ColorDeLaOrden;
  tela: TelaConColores;
  idOrden: number;
  puedeEditar: boolean;
  guardando: boolean;
  onAsignar: (idColor: number, idTelaColor: number | null) => void;
}): React.JSX.Element {
  const elegido = tela.opciones.find((o) => o.idTelaColor === color.idTelaColor) ?? null;
  return (
    <li className="border-t px-3 py-2 first:border-t-0" data-testid="colores-tela-fila">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{color.color}</span>
        {color.pantone === null ? null : (
          <span className="text-xs text-muted-foreground">pantone {color.pantone}</span>
        )}
        <span className="text-xs text-muted-foreground">
          {color.piezas} pzas →{' '}
          {color.cantidadRequerida.toLocaleString('es-MX', {
            maximumFractionDigits: 4,
          })}
          {tela.unidad === null ? '' : ` ${tela.unidad}`}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <select
          className="h-8 min-w-56 rounded-md border bg-background px-2 text-sm"
          value={color.idTelaColor === null ? '' : String(color.idTelaColor)}
          // ⭐⭐ V1-E4c — **Y LA REGLA DE HASTA CUÁNDO SE PUEDE CAMBIAR, TAMBIÉN AQUÍ.**
          // 🔴 Esta pantalla llegó a la etapa sin mirar `puedeCambiar`, y la etapa la volvió
          // incoherente consigo misma: el renglón de la explosión pintaba el campo GRIS con su
          // motivo y este diálogo —al que se llega desde ESE mismo renglón, con el enlace que la
          // etapa agregó— lo enseñaba ABIERTO. Cambiarlo se comía un 409 que la pantalla anterior
          // ya sabía predecir. El dato viajaba en la misma respuesta: sólo faltaba leerlo.
          disabled={!puedeEditar || guardando || !color.puedeCambiar}
          aria-label={`Color de tela para ${color.color}`}
          data-testid="colores-tela-select"
          onChange={(e) =>
            onAsignar(color.idColor, e.target.value === '' ? null : Number(e.target.value))
          }
        >
          <option value="">— sin decir —</option>
          {tela.opciones.map((o) => (
            <option key={o.idTelaColor} value={o.idTelaColor}>
              {o.nombre}
              {o.pantone === null ? '' : ` (${o.pantone})`}
            </option>
          ))}
        </select>

        {/* La PROPUESTA se ve al lado; no se aplica sola (§Post-F9.89(a)). */}
        {color.idTelaColor === null && color.propuestaIdTelaColor !== null ? (
          <button
            type="button"
            className="text-xs underline disabled:opacity-50"
            // ⭐⭐ V1-E4c: la MISMA guarda que el desplegable — un atajo que escribe lo que el
            // desplegable tiene prohibido escribir sería la misma incoherencia por la puerta de al
            // lado. (En la práctica un color bloqueado ya tiene amarre y no enseña propuesta; se
            // pone igual porque una guarda que depende de otra condición para no hacer daño no es
            // una guarda.)
            disabled={!puedeEditar || guardando || !color.puedeCambiar}
            onClick={() => onAsignar(color.idColor, color.propuestaIdTelaColor)}
            data-testid="colores-tela-usar-propuesta"
          >
            Usar «{color.propuestaTelaColor}» ({etiquetaOrigen(color.origenPropuesta)})
          </button>
        ) : null}
      </div>

      {/* La regla la REDACTA el servidor (A1); aquí sólo se pinta, con las mismas palabras que el
          renglón de la explosión y que el rechazo del `PUT`. */}
      {color.motivoNoCambiar === null ? null : (
        <p className="mt-1 text-xs text-warn" data-testid="colores-tela-bloqueado">
          {color.motivoNoCambiar}
        </p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-2">
        {elegido === null ? null : (
          <PrecioDelColor
            idTelaColor={elegido.idTelaColor}
            nombre={elegido.nombre}
            precio={elegido.precio}
            idOrden={idOrden}
            puedeEditar={puedeEditar}
          />
        )}
      </div>
    </li>
  );
}

/** Cómo se llegó a la propuesta, dicho en el idioma del comprador. */
function etiquetaOrigen(origen: ColorDeLaOrden['origenPropuesta']): string {
  switch (origen) {
    case 'liga-catalogo':
      return 'ya venía amarrado en el catálogo';
    case 'mismo-pantone':
      return 'mismo pantone';
    case 'mismo-nombre':
      return 'mismo nombre';
    case 'unico-color':
      return 'el único color de esta tela';
    case 'sin-propuesta':
      return '';
  }
}

/**
 * ⚠️ El precio del color — **y corregirlo aquí cambia el CATÁLOGO** (decisión (b) de Daniel).
 * Por eso: el campo lo advierte, sólo se guarda al pulsar, y al guardar se dice de cuánto a cuánto
 * quedó. Un cambio de catálogo que ocurre callado es lo que D3 prohíbe.
 */
function PrecioDelColor({
  idTelaColor,
  nombre,
  precio,
  idOrden,
  puedeEditar,
}: {
  idTelaColor: number;
  nombre: string;
  precio: number | null;
  idOrden: number;
  puedeEditar: boolean;
}): React.JSX.Element {
  const fijar = useFijarPrecioColor();
  const [valor, setValor] = useState(precio === null ? '' : String(precio));

  useEffect(() => {
    setValor(precio === null ? '' : String(precio));
  }, [precio, idTelaColor]);

  const numero = Number(valor);
  const cambio = valor.trim() !== '' && Number.isFinite(numero) && numero !== (precio ?? NaN);

  return (
    <span className="flex items-center gap-1 text-xs">
      <span className="text-muted-foreground">Precio</span>
      <Input
        className="h-8 w-24"
        inputMode="decimal"
        value={valor}
        disabled={!puedeEditar}
        aria-label={`Precio de ${nombre}`}
        data-testid="colores-tela-precio"
        onChange={(e) => setValor(e.target.value)}
      />
      {cambio && puedeEditar ? (
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={fijar.isPending}
          data-testid="colores-tela-guardar-precio"
          onClick={() =>
            fijar.mutate(
              { idTelaColor, idOrden, cuerpo: { precio: numero, idOrden } },
              {
                onSuccess: (r) =>
                  toast.success(
                    `Precio de «${r.color}» actualizado EN EL CATÁLOGO: ` +
                      `${r.precioAnterior === null ? 'sin precio' : String(r.precioAnterior)} → ` +
                      `${r.precio === null ? 'sin precio' : String(r.precio)}. ` +
                      `Aplica a todas las compras futuras de ese color.`,
                  ),
                onError: (error) => toast.error(error.message),
              },
            )
          }
        >
          Guardar en el catálogo
        </Button>
      ) : null}
    </span>
  );
}
