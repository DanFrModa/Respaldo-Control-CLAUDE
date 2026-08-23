import { Grid3x3, Trash2Icon } from 'lucide-react';

import type { Avio } from '@/api/avios';
import { etiquetaUnidadTela, type Tela } from '@/api/telas';
import type { Color, OrdenLigera, Talla } from '@/api/tipos';
import {
  MatrizColorTalla,
  type MatrizColorOpcion,
  type MatrizLinea,
  type MatrizTalla,
} from '@/componentes/matriz-color-talla/MatrizColorTalla';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { formatearMoneda } from '@/lib/formato';

import {
  importeRenglon,
  renglonVacio,
  totalCaptura,
  totalMatrizRenglon,
  type RenglonOcCaptura,
  type TipoMaterialOc,
} from './captura';

/**
 * EDITOR DE RENGLONES de una OC (F4-E2): cada renglón elige el tipo de material (tela del catálogo /
 * avío / línea libre); si es avío, un selector de proveedor/precio rellena el precio desde el
 * AvioProveedor (R1). Captura cantidad, unidad, precio y liga a una orden de producción POR LÍNEA.
 * Un botón opcional abre la matriz talla×color NATIVA (decisión c, suma = cantidad). Presentación
 * pura (A1): no valida reglas de negocio; el backend re-valida (XOR material, Σ matriz = cantidad).
 */
export function EditorLineasOc({
  renglones,
  alCambiar,
  telas,
  mensajeSinTelas,
  avios,
  ordenes,
  colores,
  tallas,
  soloLectura = false,
}: {
  renglones: RenglonOcCaptura[];
  alCambiar: (renglones: RenglonOcCaptura[]) => void;
  telas: readonly Tela[];
  /** Qué decir cuando no hay telas que ofrecer (sin proveedor / proveedor sin telas). */
  mensajeSinTelas: string;
  avios: readonly Avio[];
  ordenes: readonly OrdenLigera[];
  colores: readonly Color[];
  tallas: readonly Talla[];
  soloLectura?: boolean;
}): React.JSX.Element {
  const coloresOpc: MatrizColorOpcion[] = colores.map((c) => ({ id: c.id, nombre: c.nombre }));
  const tallasOpc: MatrizTalla[] = tallas.map((t) => ({ idTalla: t.id, etiqueta: t.etiqueta }));

  function actualizar(clave: string, cambios: Partial<RenglonOcCaptura>): void {
    alCambiar(renglones.map((r) => (r.clave === clave ? { ...r, ...cambios } : r)));
  }

  function quitar(clave: string): void {
    alCambiar(renglones.filter((r) => r.clave !== clave));
  }

  function agregar(): void {
    alCambiar([...renglones, renglonVacio()]);
  }

  /** Cambia el tipo de material y limpia los campos del tipo anterior. */
  function cambiarTipo(clave: string, tipo: TipoMaterialOc): void {
    actualizar(clave, {
      tipo,
      idTela: null,
      idAvio: null,
      idAvioProveedor: null,
      descripcionLibre: '',
      // ⭐⭐ V1-E3u (§Post-F9.89): el COLOR es de la TELA. Al dejar de ser un renglón de tela deja
      // de significar nada, y el dominio lo RECHAZA ("no es de tela; no puede llevar color").
      idTelaColor: null,
      telaColor: null,
    });
  }

  /**
   * Al elegir una TELA (§Post-F9.18): la UNIDAD la manda la tela (kg o m), nunca se teclea — *"no
   * puede ser una tela que se compra en kilos y en la OC la unidad sea piezas"*. Y si esa tela lleva
   * COMPLEMENTO (Cardigan), el renglón abre su campo; si no lo lleva, se limpia lo que hubiera.
   */
  function elegirTela(clave: string, idTela: number | null): void {
    const tela = telas.find((t) => t.id === idTela);
    const renglon = renglones.find((r) => r.clave === clave);
    // ⭐⭐ V1-E3u (§Post-F9.89) — 🔴 **CAMBIAR DE TELA SUELTA EL COLOR.** Un `TelaColor` cuelga de
    // SU tela: el "Marino Alsa" de la felpa no existe en el cardigan. Si se conservara, el cerrojo
    // del dominio rechazaría el guardado con *"el color «Marino Alsa» es de la tela «Felpa 280», no
    // de «Cardigan»"* y el usuario **no tendría ningún control aquí para corregirlo** — un error sin
    // salida. Se suelta al cambiar de tela y se DICE (abajo, junto al selector).
    // ⚠️ Se conserva sólo si la tela no cambió (re-elegir la misma no debe perder el dato).
    const mismaTela = renglon !== undefined && renglon.idTela === idTela;
    actualizar(clave, {
      idTela,
      unidad: tela === undefined ? '' : etiquetaUnidadTela(tela.unidadMedida),
      ...(mismaTela ? {} : { idTelaColor: null, telaColor: null }),
      ...(tela?.nombreComplemento == null
        ? { cantidadComplemento: '', precioComplemento: '' }
        : {}),
    });
  }

  /** Al elegir un avío, precarga su precio de referencia si tiene un único proveedor (R1). */
  function elegirAvio(clave: string, idAvio: number | null): void {
    const avio = avios.find((a) => a.id === idAvio);
    const cambios: Partial<RenglonOcCaptura> = { idAvio, idAvioProveedor: null };
    if (avio && avio.proveedores.length === 1) {
      const prov = avio.proveedores[0];
      if (prov) {
        cambios.idAvioProveedor = prov.idProveedor;
        if (prov.precio !== null && prov.precio !== undefined) {
          cambios.precio = String(prov.precio);
        }
      }
    }
    actualizar(clave, cambios);
  }

  /** Al elegir un proveedor del avío, rellena el precio desde ese AvioProveedor (R1). */
  function elegirProveedorAvio(clave: string, idAvio: number | null, idProveedor: number): void {
    const avio = avios.find((a) => a.id === idAvio);
    const prov = avio?.proveedores.find((p) => p.idProveedor === idProveedor);
    const cambios: Partial<RenglonOcCaptura> = { idAvioProveedor: idProveedor };
    if (prov && prov.precio !== null && prov.precio !== undefined) {
      cambios.precio = String(prov.precio);
    }
    actualizar(clave, cambios);
  }

  /**
   * Bloque del COMPLEMENTO de un renglón de tela (§Post-F9.18). Se pinta SOLO cuando la tela
   * elegida define complemento (`nombreComplemento`), y entonces su cantidad es obligatoria: el
   * servidor no deja autorizar la OC sin ella. El precio es opcional (vacío = el del cuerpo).
   */
  function renglonComplemento(renglon: RenglonOcCaptura, indice: number): React.JSX.Element | null {
    const tela = telas.find((t) => t.id === renglon.idTela);
    const complemento = tela?.nombreComplemento ?? null;
    if (complemento === null) {
      return null;
    }
    return (
      <div className="mt-2 rounded-md bg-primary-soft p-2" data-testid="complemento-oc">
        <p className="text-xs text-muted-foreground">
          Esta tela se compra junto con su <strong>{complemento}</strong>.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="text-xs text-muted-foreground">
            Cantidad de {complemento}
            <Input
              className="mt-1"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              aria-label={`Cantidad de ${complemento} del renglón ${indice + 1}`}
              disabled={soloLectura}
              value={renglon.cantidadComplemento}
              onChange={(e) => actualizar(renglon.clave, { cantidadComplemento: e.target.value })}
              data-testid="cantidad-complemento-oc"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Precio de {complemento}
            <Input
              className="mt-1"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              aria-label={`Precio de ${complemento} del renglón ${indice + 1}`}
              disabled={soloLectura}
              placeholder="Igual que el cuerpo"
              value={renglon.precioComplemento}
              onChange={(e) => actualizar(renglon.clave, { precioComplemento: e.target.value })}
              data-testid="precio-complemento-oc"
            />
          </label>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="editor-lineas-oc">
      {renglones.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          {soloLectura
            ? 'Esta orden de compra no tiene renglones.'
            : 'Agrega un renglón para empezar.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {renglones.map((renglon, indice) => (
            <li key={renglon.clave} className="rounded-lg border p-3" data-testid="renglon-oc">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium text-muted-foreground">
                  Renglón {indice + 1}
                </span>
                {!soloLectura ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-destructive"
                    onClick={() => quitar(renglon.clave)}
                    aria-label={`Quitar renglón ${indice + 1}`}
                    data-testid="quitar-renglon-oc"
                  >
                    <Trash2Icon className="size-4" aria-hidden />
                  </Button>
                ) : null}
              </div>

              {/* Tipo de material + selector según el tipo. */}
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr]">
                <label className="text-xs text-muted-foreground">
                  Tipo de material
                  <SelectNativo
                    className="mt-1"
                    aria-label={`Tipo de material del renglón ${indice + 1}`}
                    disabled={soloLectura}
                    value={renglon.tipo}
                    onChange={(e) => cambiarTipo(renglon.clave, e.target.value as TipoMaterialOc)}
                    data-testid="tipo-material-oc"
                  >
                    <option value="tela">Tela</option>
                    <option value="avio">Avío</option>
                    <option value="libre">Línea libre</option>
                  </SelectNativo>
                </label>

                <label className="text-xs text-muted-foreground">
                  Material
                  {renglon.tipo === 'tela' ? (
                    <SelectNativo
                      className="mt-1"
                      aria-label={`Tela del renglón ${indice + 1}`}
                      disabled={soloLectura}
                      value={renglon.idTela === null ? '' : String(renglon.idTela)}
                      onChange={(e) =>
                        elegirTela(
                          renglon.clave,
                          e.target.value === '' ? null : Number(e.target.value),
                        )
                      }
                      data-testid="selector-tela-oc"
                    >
                      <option value="">
                        {/* §Post-F9.15: la lista sale VACÍA cuando aún no hay proveedor o cuando
                            ese proveedor no tiene telas dadas de alta. Decirlo evita el "combo
                            vacío sin explicación". */}
                        {telas.length === 0 ? mensajeSinTelas : 'Elige una tela…'}
                      </option>
                      {telas.map((t) => (
                        <option key={t.id} value={String(t.id)}>
                          {t.nombre}
                        </option>
                      ))}
                    </SelectNativo>
                  ) : renglon.tipo === 'avio' ? (
                    <SelectNativo
                      className="mt-1"
                      aria-label={`Avío del renglón ${indice + 1}`}
                      disabled={soloLectura}
                      value={renglon.idAvio === null ? '' : String(renglon.idAvio)}
                      onChange={(e) =>
                        elegirAvio(
                          renglon.clave,
                          e.target.value === '' ? null : Number(e.target.value),
                        )
                      }
                      data-testid="selector-avio-oc"
                    >
                      <option value="">Elige un avío…</option>
                      {avios.map((a) => (
                        <option key={a.id} value={String(a.id)}>
                          {a.clave} — {a.descripcion}
                        </option>
                      ))}
                    </SelectNativo>
                  ) : (
                    <Input
                      className="mt-1"
                      aria-label={`Descripción libre del renglón ${indice + 1}`}
                      disabled={soloLectura}
                      placeholder="Descripción del material/servicio"
                      value={renglon.descripcionLibre}
                      onChange={(e) =>
                        actualizar(renglon.clave, { descripcionLibre: e.target.value })
                      }
                      data-testid="descripcion-libre-oc"
                    />
                  )}
                  {/* ⭐⭐ V1-E3u (§Post-F9.89) — EL COLOR QUE PIDE ESTE RENGLÓN, a la vista.
                      Antes viajaba invisible: se conservaba al guardar y el usuario no tenía forma
                      de saber que estaba ahí. Aquí no se ELIGE (eso vive en «De qué color se compra
                      la tela», sobre la matriz de la OP); aquí se VE, y se puede quitar. */}
                  {renglon.tipo === 'tela' && renglon.telaColor !== null ? (
                    <span
                      className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
                      data-testid="color-renglon-oc"
                    >
                      Color: <b className="text-foreground">{renglon.telaColor}</b>
                      {soloLectura ? null : (
                        <button
                          type="button"
                          className="underline"
                          onClick={() =>
                            actualizar(renglon.clave, { idTelaColor: null, telaColor: null })
                          }
                          data-testid="quitar-color-renglon-oc"
                        >
                          quitar
                        </button>
                      )}
                    </span>
                  ) : null}
                </label>
              </div>

              {/* Proveedor del avío (R1): rellena el precio desde el AvioProveedor. */}
              {renglon.tipo === 'avio' && renglon.idAvio !== null ? (
                <label className="mt-2 block text-xs text-muted-foreground">
                  Proveedor del avío (precio R1)
                  <SelectNativo
                    className="mt-1"
                    aria-label={`Proveedor del avío del renglón ${indice + 1}`}
                    disabled={soloLectura}
                    value={renglon.idAvioProveedor === null ? '' : String(renglon.idAvioProveedor)}
                    onChange={(e) =>
                      elegirProveedorAvio(renglon.clave, renglon.idAvio, Number(e.target.value))
                    }
                    data-testid="selector-proveedor-avio-oc"
                  >
                    <option value="">Sin proveedor (precio manual)</option>
                    {(avios.find((a) => a.id === renglon.idAvio)?.proveedores ?? []).map((p) => (
                      <option key={p.idProveedor} value={String(p.idProveedor)}>
                        {p.nombreProveedor}
                        {p.precio !== null && p.precio !== undefined
                          ? ` — ${formatearMoneda(p.precio)}`
                          : ''}
                      </option>
                    ))}
                  </SelectNativo>
                </label>
              ) : null}

              {/* Cantidad / unidad / precio / orden ligada. */}
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="text-xs text-muted-foreground">
                  Cantidad
                  <Input
                    className="mt-1"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    aria-label={`Cantidad del renglón ${indice + 1}`}
                    disabled={soloLectura || renglon.usaMatriz}
                    value={
                      renglon.usaMatriz
                        ? String(totalMatrizRenglon(renglon.matriz))
                        : renglon.cantidad
                    }
                    onChange={(e) => actualizar(renglon.clave, { cantidad: e.target.value })}
                    data-testid="cantidad-oc"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Unidad
                  <Input
                    className="mt-1"
                    aria-label={`Unidad del renglón ${indice + 1}`}
                    // §Post-F9.18: en TELA la unidad la manda la tela — se muestra, no se teclea.
                    disabled={soloLectura || renglon.tipo === 'tela'}
                    readOnly={renglon.tipo === 'tela'}
                    placeholder={renglon.tipo === 'tela' ? 'La pone la tela' : 'rollo, m, pza…'}
                    value={renglon.unidad}
                    onChange={(e) => actualizar(renglon.clave, { unidad: e.target.value })}
                    data-testid="unidad-oc"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Precio
                  <Input
                    className="mt-1"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    aria-label={`Precio del renglón ${indice + 1}`}
                    disabled={soloLectura}
                    placeholder="0.00"
                    value={renglon.precio}
                    onChange={(e) => actualizar(renglon.clave, { precio: e.target.value })}
                    data-testid="precio-oc"
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Orden ligada (R7)
                  <SelectNativo
                    className="mt-1"
                    aria-label={`Orden de producción ligada del renglón ${indice + 1}`}
                    disabled={soloLectura}
                    value={renglon.idOrden === null ? '' : String(renglon.idOrden)}
                    onChange={(e) =>
                      actualizar(renglon.clave, {
                        idOrden: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    data-testid="selector-orden-oc"
                  >
                    <option value="">Sin ligar</option>
                    {ordenes.map((o) => (
                      <option key={o.id} value={String(o.id)}>
                        Orden {o.folio} · {o.codigoModelo}
                      </option>
                    ))}
                  </SelectNativo>
                </label>
              </div>

              {/* COMPLEMENTO de la tela (§Post-F9.18). Solo aparece si la tela elegida lo define:
                  esa tela SE COMPRA junto con su Cardigan, en el mismo renglón. */}
              {renglon.tipo === 'tela' ? renglonComplemento(renglon, indice) : null}

              {/* Detalle por talla×color (decisión c). */}
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Grid3x3 className="size-3.5" aria-hidden />
                    Detalle por talla × color (opcional)
                  </span>
                  {!soloLectura ? (
                    <Button
                      type="button"
                      variant={renglon.usaMatriz ? 'secondary' : 'outline'}
                      size="sm"
                      onClick={() => actualizar(renglon.clave, { usaMatriz: !renglon.usaMatriz })}
                      aria-pressed={renglon.usaMatriz}
                      data-testid="alternar-matriz-oc"
                    >
                      {renglon.usaMatriz ? 'Quitar detalle' : 'Capturar por talla × color'}
                    </Button>
                  ) : null}
                </div>

                {renglon.usaMatriz ? (
                  <MatrizColorTalla
                    testid={`matriz-oc-${String(indice)}`}
                    tallas={tallasOpc}
                    lineas={renglon.matriz}
                    coloresDisponibles={coloresOpc}
                    tallasDisponibles={tallasOpc}
                    soloLectura={soloLectura}
                    onLineasChange={(matriz: MatrizLinea[]) =>
                      actualizar(renglon.clave, { matriz })
                    }
                    onTallasChange={() => undefined}
                  />
                ) : null}
              </div>

              {/* Importe derivado del renglón (solo UX). */}
              <p className="mt-3 text-right text-sm">
                <span className="text-muted-foreground">Importe: </span>
                <span className="font-medium tabular-nums" data-testid="importe-renglon-oc">
                  {formatearMoneda(importeRenglon(renglon))}
                </span>
              </p>
            </li>
          ))}
        </ul>
      )}

      {!soloLectura ? (
        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            onClick={agregar}
            data-testid="agregar-renglon-oc"
          >
            Agregar renglón
          </Button>
          {/* Daniel (§Post-F9.18): *"una OC puede ir ligada a varias OP"*. Ya se puede —la liga es
              POR RENGLÓN—, pero no se veía; decirlo aquí evita capturar dos órdenes de compra. */}
          <p className="text-xs text-muted-foreground" data-testid="ayuda-varias-ordenes-oc">
            Cada renglón se liga a su propia orden de producción: una misma orden de compra puede
            surtir varias OP.
          </p>
        </div>
      ) : null}

      <p className="text-right text-base font-semibold">
        <span className="text-muted-foreground">Total: </span>
        <span className="tabular-nums" data-testid="total-captura-oc">
          {formatearMoneda(totalCaptura(renglones))}
        </span>
      </p>
    </div>
  );
}
