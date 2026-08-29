import { Loader2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useAsignarColorTela, useColoresDeTela, useFijarPrecioColor } from '@/api/mrp';
import type { ColorDeLaOrden, TelaConColores } from '@/api/tipos';
import {
  DialogoNuevoColorDeTela,
  OPCION_NUEVO_COLOR,
} from '@/modulos/telas/DialogoNuevoColorDeTela';
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
        ) : consulta.data?.sinMatrizColores === true ? (
          /* 🔴 **V1-E8o — sin matriz color×talla no hay NADA que llenar aquí, y se dice UNA VEZ.**
             `OrdenTelaColor` amarra `(idOrdenTela, idColor)`: sin ningún color de PRENDA no es que
             el color de la tela sea difícil de guardar, es **imposible**. Y NO se ofrece el alta —
             dar de alta un color de tela que nadie podría elegir sería mandar a llenar el catálogo
             por gusto.

             ⚠️ Va **arriba y una sola vez**, no dentro de cada bloque de tela: el dato es de la
             ORDEN (`sinMatrizColores` = la orden no tiene líneas), así que repetirlo por cada tela
             de la receta diría diez veces la misma frase. Es como lo dice el renglón de la
             explosión (`exp-color-sin-matriz`), que lo dice una vez por orden. */
          <p className="py-6 text-center text-sm text-warn" data-testid="colores-tela-sin-matriz">
            Esta orden todavía no tiene capturada su <b>matriz de color×talla</b>, así que no hay
            ningún color de prenda al que amarrarle el color de la tela. Captúrala en Producción ›
            Órdenes y vuelve. Mientras tanto, estas telas se compran sin color.
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
  /**
   * ⭐⭐ **V1-E8o — el caso desde el que se está dando de alta el color.**
   *
   * Vive POR TELA (no por diálogo) porque la precarga es del color de PRENDA del renglón que se
   * tocó: el mismo cuadro atiende al «Marino» de una tela y al «Grana» de la otra, y compartir el
   * estado arrastraría la precarga de la anterior — el mismo error que el diálogo del alta ya evita
   * reseteando en cada apertura.
   */
  const [alta, setAlta] = useState<{
    idColor: number;
    colorPrenda: string;
    pantone: string | null;
  } | null>(null);

  /**
   * ¿Se puede dar de alta el color desde aquí? **La MISMA condición que en el renglón de la
   * explosión**: allá el bloque entero se pinta con `puedeDecirColor`, que es literalmente
   * `puedeComprar` = `tienePermiso('compras.administrar')`, y ese mismo booleano llega aquí como
   * `puedeEditar` (`ExplosionMaterialesPagina` lo pasa desde la misma variable). No es una copia
   * reducida de la regla: es el mismo valor.
   *
   * ⚠️ Y por eso mismo **hoy es una guarda PREVENTIVA, no un caso de usuario**: quien no tiene el
   * permiso tampoco puede abrir este diálogo (ver la nota del `<option>` más abajo). Se escribe
   * igual porque `puedeEditar` entra por prop y el próximo mount podría no gobernarla.
   *
   * ⚖️ El permiso es de la COMPRA, no del catálogo (§Post-F9.106, ajuste del 25-ago-2026): quien
   * compra da de alta el color que va a comprar aunque no administre `telas.administrar`. Y el
   * BLOQUEAR de verdad lo hace el servidor (`agregarColorATela` exige `compras.administrar`);
   * esconder la opción es la mitad de §Post-F9.68, no la garantía.
   */
  const puedeDarDeAlta = puedeEditar;

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
      {/* ⭐⭐ **V1-E8o — LA SEGUNDA PUERTA DEL MISMO CALLEJÓN, YA ABIERTA.**
       *
       * Aquí vivía un texto que mandaba a «Catálogos › Telas» —**fuera de la compra**— y que
       * V1-E6b dejó a medias: lo cambió por un *"cierra este cuadro y usa el desplegable del
       * renglón"*. Seguía siendo una puerta que obliga a SALIR, sólo que a una habitación más
       * cerca. La lección de las dos etapas es la misma y por eso se escribe: **cerrar una puerta
       * no cierra su gemela**; esta pantalla se abre a un clic de la del renglón («Ver todos los
       * colores y precios de la orden N») y tenía que ofrecer lo mismo.
       *
       * Ahora la lista de casos se pinta SIEMPRE —con el catálogo vacío también—, y el alta es la
       * última opción del desplegable, exactamente como en el renglón. El aviso ya no manda a
       * ningún lado: dice qué falta y señala la opción que está debajo. */}
      {tela.opciones.length === 0 && tela.colores.length > 0 ? (
        <p
          className="px-3 py-3 text-xs text-muted-foreground"
          data-testid="colores-tela-sin-opciones"
        >
          «{tela.tela}» todavía no tiene colores dados de alta
          {puedeDarDeAlta
            ? ': da de alta el que vas a comprar con «＋ Nuevo color…», la última opción del desplegable.'
            : '. Mientras tanto se compra sin color.'}
        </p>
      ) : null}
      <ul>
        {tela.colores.map((color) => (
          <FilaColor
            key={color.idColor}
            color={color}
            tela={tela}
            idOrden={idOrden}
            puedeEditar={puedeEditar}
            puedeDarDeAlta={puedeDarDeAlta}
            guardando={guardando}
            onAsignar={onAsignar}
            onAltaColor={() => {
              setAlta({
                idColor: color.idColor,
                colorPrenda: color.color,
                pantone: color.pantone,
              });
            }}
          />
        ))}
      </ul>

      {/* ⭐⭐ **V1-E8o — EL ALTA, SIN SALIR DE LA COMPRA (y sin salir ni de este cuadro).** Se monta
          sólo cuando se abre —es una forma completa con react-hook-form + Zod— y viene PRECARGADA
          con el color de prenda de la OP y el pantone que llegó de la OC del cliente.

          🔴 Al crearlo queda **ELEGIDO** para ese caso, con la MISMA escritura de siempre
          (`onAsignar` → `asignarColorTela`), que es lo que hace que la respuesta del servidor
          traiga la lista de `opciones` ya con el color nuevo dentro. Sin esto sólo se habría
          movido el problema: el comprador daría de alta el color y tendría que volver a buscarlo. */}
      {alta !== null ? (
        <DialogoNuevoColorDeTela
          abierto
          alCambiarAbierto={(abierto) => {
            if (!abierto) setAlta(null);
          }}
          idTela={tela.idTela}
          tela={tela.tela}
          nombreComplemento={tela.nombreComplemento}
          nombrePrecargado={alta.colorPrenda}
          pantonePrecargado={alta.pantone}
          alCrear={(creado) => {
            onAsignar(alta.idColor, creado.id);
          }}
        />
      ) : null}
    </section>
  );
}

/** Un color de la MATRIZ de la orden: sus piezas, lo que pide, y de qué color de tela se compra. */
function FilaColor({
  color,
  tela,
  idOrden,
  puedeEditar,
  puedeDarDeAlta,
  guardando,
  onAsignar,
  onAltaColor,
}: {
  color: ColorDeLaOrden;
  tela: TelaConColores;
  idOrden: number;
  puedeEditar: boolean;
  /** ⭐ V1-E8o: ¿se pinta «＋ Nuevo color…»? Es el MISMO booleano que `puedeEditar`. */
  puedeDarDeAlta: boolean;
  guardando: boolean;
  onAsignar: (idColor: number, idTelaColor: number | null) => void;
  /** ⭐ V1-E8o: se pidió el alta desde ESTE caso (de él sale la precarga). */
  onAltaColor: () => void;
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
          onChange={(e) => {
            // ⭐⭐ V1-E8o — la ÚLTIMA opción no elige nada: abre el alta. El `value` sigue
            // controlado por `color.idTelaColor`, así que si el diálogo se cancela el desplegable
            // vuelve solo a lo que estaba. Se compara ANTES de `Number(...)` porque
            // `Number('nuevo-color')` sería un `NaN` viajando como `idTelaColor`.
            if (e.target.value === OPCION_NUEVO_COLOR) {
              onAltaColor();
              return;
            }
            onAsignar(color.idColor, e.target.value === '' ? null : Number(e.target.value));
          }}
        >
          <option value="">— sin decir —</option>
          {tela.opciones.map((o) => (
            <option key={o.idTelaColor} value={o.idTelaColor}>
              {o.nombre}
              {o.pantone === null ? '' : ` (${o.pantone})`}
            </option>
          ))}
          {/* ⭐⭐ **V1-E8o — «＋ Nuevo color…»: AL FINAL, SEPARADA, y con guarda PREVENTIVA.**

              🔴 **Seamos exactos sobre qué es esta guarda, porque la primera redacción mintió:**
              HOY NO HAY CAMINO que abra este diálogo sin `compras.administrar`. Tiene **un solo
              mount de producción** (`ExplosionMaterialesPagina`, `puedeEditar={puedeComprar}`), que
              se abre **únicamente** por `onVerTodosLosColores`, botón que sólo se pinta dentro del
              bloque gobernado por `puedeDecirColor` —o sea el MISMO `compras.administrar`—. Así que
              `puedeDarDeAlta === false` **no es un camino de usuario**: hoy sólo lo produce una
              prueba.

              Se conserva igual, y no por simetría: este componente recibe `puedeEditar` **como
              prop**, y nada garantiza que el próximo mount (una pantalla de consulta, un cajón de
              solo lectura) la respete. Es defensa en profundidad — la misma razón por la que el
              atajo «Usar la propuesta» repite la guarda del desplegable aquí abajo. El BLOQUEAR de
              verdad lo hace el servidor (`agregarColorATela` exige `compras.administrar`). */}
          {puedeDarDeAlta ? (
            <>
              {tela.opciones.length > 0 ? (
                <option disabled data-testid="colores-tela-separador">
                  ──────────
                </option>
              ) : null}
              <option value={OPCION_NUEVO_COLOR} data-testid="colores-tela-alta-color">
                ＋ Nuevo color…
              </option>
            </>
          ) : null}
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
