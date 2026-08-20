import { X } from 'lucide-react';
import { useState } from 'react';

import type { Proveedor } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { SelectorProveedor } from '@/modulos/cxp/SelectorProveedor';

/**
 * Un renglon de proveedor del avio EN CAPTURA: a que proveedor se le compra y a que
 * precio/condiciones (R1). `precio` se captura como TEXTO (igual que todo numerico opcional
 * en formularios: `<input type="number">` siempre entrega string; vacio = sin precio). La
 * conversion a number la hace el dialogo al armar el cuerpo del API.
 */
export interface RenglonProveedorAvio {
  idProveedor: number;
  /** Precio como texto (vacio = sin precio). El dialogo lo convierte a number al enviar. */
  precio: string;
  condiciones: string;
  /**
   * ⭐ V1-E3m (§Post-F9.82) — ¿es el proveedor HABITUAL del avío? Daniel: *"tener avíos sin
   * proveedor asignado está generando más problemas que beneficios"*. Es el que la explosión del
   * MRP va a proponer, por encima del "más barato" de F4. **Uno por avío**: marcarlo desmarca al
   * anterior (por eso se comporta como radio y no como casilla suelta).
   */
  habitual: boolean;
}

/**
 * SELECTOR DE PROVEEDORES DE UN AVIO (F1-E3, R1): a diferencia del `SelectorRolesProveedor`
 * (checkboxes sin datos) o el `ArmadorCurva` (orden sin datos), aqui cada proveedor
 * elegido lleva DATOS propios — precio y condiciones — porque el mismo avio se compra a
 * varios proveedores a precios distintos (insight del dueño). El usuario:
 *   - elige un proveedor del catalogo (`/api/proveedores`, solo activos) y lo agrega;
 *   - captura su precio y condiciones en el renglon;
 *   - quita renglones.
 * Impide elegir un proveedor ya agregado (no se repite). Un avio PUEDE quedar sin
 * proveedores (≥0): puede ser generico o costearse por su precio de referencia.
 *
 * El estado vive en el dialogo padre (`renglones` + `alCambiar`), que los envia INLINE en
 * el cuerpo del API. El backend valida (proveedores activos, sin repetidos) y es la
 * autoridad (A1).
 *
 * ⚠️ **V1-E3f (§Post-F9.52 punto 7):** el desplegable nativo con tope de 100 se cambió por el
 * `SelectorProveedor` (combobox con BÚSQUEDA en el servidor). Con más de cien proveedores el
 * `<select>` simplemente no mostraba al que se buscaba, y era la cuarta vez que ese mismo defecto
 * aparecía en el proyecto — Daniel: *"Habíamos acordado que siempre que se busque un proveedor
 * debe de buscar en todas las palabras"*. La prop `proveedores` SIGUE llegando (ya no para elegir,
 * sino para poner NOMBRE a los renglones que ya venían capturados); los que se eligen ahora se
 * recuerdan aparte, porque pueden venir de fuera de esa primera página.
 */
export function SelectorProveedoresAvio({
  proveedores,
  cargando,
  error,
  renglones,
  alCambiar,
  deshabilitado = false,
}: {
  /** Catalogo de proveedores (solo para RESOLVER el nombre de los renglones ya capturados). */
  proveedores: readonly Proveedor[];
  cargando: boolean;
  /** Mensaje de error al cargar el catalogo de proveedores, o `null` si cargo bien. */
  error: string | null;
  /** Renglones elegidos (proveedor + precio/condiciones). */
  renglones: RenglonProveedorAvio[];
  alCambiar: (renglones: RenglonProveedorAvio[]) => void;
  deshabilitado?: boolean;
}): React.JSX.Element {
  /**
   * Nombres de los proveedores elegidos DESDE el buscador en esta sesión de captura: el catálogo
   * de la prop solo trae la primera página, así que uno buscado en el servidor puede no estar ahí.
   */
  const [nombresElegidos, setNombresElegidos] = useState<Record<number, string>>({});
  /** Mapa id → nombre para pintar los renglones (catálogo + lo elegido en el buscador). */
  const nombrePorId = new Map<number, string>([
    ...proveedores.map((proveedor) => [proveedor.id, proveedor.nombre] as const),
    ...Object.entries(nombresElegidos).map(([id, nombre]) => [Number(id), nombre] as const),
  ]);
  /** Ids ya elegidos (para no repetir). */
  const elegidos = new Set(renglones.map((renglon) => renglon.idProveedor));

  function agregar(proveedor: Proveedor): void {
    if (elegidos.has(proveedor.id)) {
      return;
    }
    setNombresElegidos((previo) => ({ ...previo, [proveedor.id]: proveedor.nombre }));
    alCambiar([
      ...renglones,
      // El PRIMER proveedor de un avío nace como habitual: es lo que el usuario quiere el 90 % de
      // las veces (un avío con un solo proveedor no tiene dilema) y evita que la explosión se quede
      // sin a quién comprarle por no haber marcado nada — el atorón que esta etapa vino a quitar.
      { idProveedor: proveedor.id, precio: '', condiciones: '', habitual: renglones.length === 0 },
    ]);
  }

  function quitar(id: number): void {
    const quedan = renglones.filter((renglon) => renglon.idProveedor !== id);
    // Si se fue el habitual y queda alguien, el PRIMERO toma el relevo: dejar el avío sin habitual
    // por un borrado lo devolvería en silencio a la regla del "más barato".
    const sinHabitual = quedan.length > 0 && !quedan.some((renglon) => renglon.habitual);
    alCambiar(
      sinHabitual
        ? quedan.map((renglon, i) => (i === 0 ? { ...renglon, habitual: true } : renglon))
        : quedan,
    );
  }

  /** Marca UNO como habitual (y desmarca al resto: es uno por avío). */
  function marcarHabitual(id: number): void {
    alCambiar(renglones.map((renglon) => ({ ...renglon, habitual: renglon.idProveedor === id })));
  }

  /**
   * QUITA el habitual del avío (sin poner otro). El backend, el contrato y la base lo soportan —un
   * avío puede no tener habitual, y entonces la explosión vuelve a la regla del "más barato" de F4—
   * y la UI no lo permitía: con radios solo se podía MOVER. Es la acción que el propio dominio
   * describe como legítima, así que aquí está.
   *
   * ⚠️ No se contradice con el relevo automático de {@link quitar}: aquel evita que el avío se quede
   * sin habitual **de rebote**, por borrar un renglón; esto es una decisión EXPLÍCITA de una persona
   * que sabe lo que hace. La diferencia entre un efecto colateral silencioso y una elección.
   */
  function quitarHabitual(): void {
    alCambiar(renglones.map((renglon) => ({ ...renglon, habitual: false })));
  }

  function cambiarCampo(id: number, campo: 'precio' | 'condiciones', valor: string): void {
    alCambiar(
      renglones.map((renglon) =>
        renglon.idProveedor === id ? { ...renglon, [campo]: valor } : renglon,
      ),
    );
  }

  return (
    <Field role="group" aria-labelledby="selector-proveedores-avio-titulo">
      <FieldLabel id="selector-proveedores-avio-titulo" asChild>
        <span>Proveedores y precios</span>
      </FieldLabel>
      <FieldDescription>
        A quién se le compra este avío y a qué precio. Marca el <b>habitual</b>: es el que la
        explosión de compras va a proponer (antes proponía el más barato, §Post-F9.82).
      </FieldDescription>

      {/* ⚠️ El buscador va SIEMPRE montado, fuera del `cargando`/`error` del catálogo. Ese catálogo
          ya no alimenta la elección (el combobox busca en el servidor por su cuenta): solo resuelve
          el NOMBRE de los renglones ya capturados. Dejarlo gobernando el bloque —como cuando era un
          `<select>`— haría que un tropiezo suyo impidiera agregar proveedores sin razón. */}
      <div className="space-y-3" data-testid="selector-proveedores-avio">
        {/* Agregar un proveedor (no repetible), con BÚSQUEDA en el servidor. */}
        <SelectorProveedor
          idSeleccionado={undefined}
          alSeleccionar={agregar}
          excluirIds={elegidos}
          testid="agregar-proveedor-avio"
        />

        {cargando ? (
          <div className="flex flex-col gap-2" data-testid="proveedores-avio-cargando">
            <Skeleton className="h-9 w-full" />
          </div>
        ) : error !== null ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}

        {/* Renglones elegidos (proveedor + precio + condiciones). */}
        {renglones.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
            Aún no hay proveedores. Agrégalos arriba (opcional).
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="proveedores-avio-elegidos">
            {renglones.map((renglon) => {
              const nombre =
                nombrePorId.get(renglon.idProveedor) ?? `#${String(renglon.idProveedor)}`;
              return (
                <li
                  key={renglon.idProveedor}
                  className="rounded-lg border p-3"
                  data-testid={`proveedor-avio-${renglon.idProveedor}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{nombre}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-destructive"
                      disabled={deshabilitado}
                      onClick={() => quitar(renglon.idProveedor)}
                      aria-label={`Quitar ${nombre}`}
                      data-testid={`quitar-proveedor-avio-${renglon.idProveedor}`}
                    >
                      <X className="size-4" aria-hidden />
                    </Button>
                  </div>
                  {/* ⭐ V1-E3m: el HABITUAL. Radio (no casilla) porque es UNO por avío: marcar a
                      otro desmarca al anterior, que es exactamente lo que hace el backend. */}
                  <label className="mt-1 flex items-center gap-2 text-xs">
                    <input
                      type="radio"
                      className="size-3.5"
                      name="proveedor-habitual-avio"
                      checked={renglon.habitual}
                      disabled={deshabilitado}
                      onChange={() => marcarHabitual(renglon.idProveedor)}
                      data-testid={`habitual-proveedor-avio-${renglon.idProveedor}`}
                    />
                    <span className={renglon.habitual ? 'font-medium' : 'text-muted-foreground'}>
                      Proveedor habitual (es el que propone la explosión de compras)
                    </span>
                    {renglon.habitual ? (
                      <button
                        type="button"
                        className="underline"
                        disabled={deshabilitado}
                        onClick={quitarHabitual}
                        data-testid="quitar-habitual-avio"
                      >
                        quitar
                      </button>
                    ) : null}
                  </label>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[8rem_1fr]">
                    <div>
                      <label
                        htmlFor={`precio-proveedor-${renglon.idProveedor}`}
                        className="text-xs text-muted-foreground"
                      >
                        Precio
                      </label>
                      <Input
                        id={`precio-proveedor-${renglon.idProveedor}`}
                        type="number"
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        placeholder="0.00"
                        disabled={deshabilitado}
                        value={renglon.precio}
                        onChange={(e) =>
                          cambiarCampo(renglon.idProveedor, 'precio', e.target.value)
                        }
                        data-testid={`precio-proveedor-avio-${renglon.idProveedor}`}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`condiciones-proveedor-${renglon.idProveedor}`}
                        className="text-xs text-muted-foreground"
                      >
                        Condiciones
                      </label>
                      <Input
                        id={`condiciones-proveedor-${renglon.idProveedor}`}
                        type="text"
                        placeholder="p. ej. contado, mín. 1 caja…"
                        disabled={deshabilitado}
                        value={renglon.condiciones}
                        onChange={(e) =>
                          cambiarCampo(renglon.idProveedor, 'condiciones', e.target.value)
                        }
                        data-testid={`condiciones-proveedor-avio-${renglon.idProveedor}`}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <FieldError errors={[]} />
    </Field>
  );
}
