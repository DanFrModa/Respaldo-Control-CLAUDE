import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { useAjustarTelaColor, useRegistrarConteoTelaColor } from '@/api/inventario-materiales';
import { useTiposMovimiento } from '@/api/inventarios';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useSesion } from '@/sesion/useSesion';

import { CapturaConteoTelaColor, type RenglonConteoTelaColor } from './CapturaConteoTelaColor';
import { CapturaRenglonesTelaColor, type RenglonTelaColor } from './CapturaRenglonesTelaColor';
import { PestanasSegmentadas } from './PestanasSegmentadas';

/**
 * Los tres modos de la pantalla. `conteo` es el PRINCIPAL y el que arranca (fila 0.098): se captura
 * lo contado y el sistema aplica la diferencia. `entrada`/`salida` siguen para lo que NO es un
 * conteo —una merma, una corrección puntual—, donde la cantidad ES el movimiento y pedirla como
 * "cuánto queda" obligaría a la resta al revés.
 */
type Modo = 'conteo' | 'entrada' | 'salida';

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * CONTEO FÍSICO / AJUSTE del inventario de telas NUEVO por COLOR (etapa A2 — la puerta del arranque
 * desde cero, Daniel §Post-F9.9). Toda corrección es un MOVIMIENTO auditado (D3), nunca una edición
 * de la existencia; el motivo es OBLIGATORIO (A7). El cuerpo y el complemento se capturan JUNTOS en
 * el mismo renglón. Permiso `inventario-telas.mover`.
 *
 * 🔴 MODO «CONTEO», el principal y el que arranca (fila 0.098 — Daniel: «capturar lo contado, con
 * el saldo del sistema a la vista, y que el sistema calcule y aplique la diferencia»). Hasta v0.097
 * esta pantalla —la que va a INICIALIZAR todo el inventario de telas el día del arranque— sólo
 * sabía pedir LA RESTA: una entrada o una salida con su cantidad, sin enseñar cuánto había. Para
 * ajustar tocaba ir a «Inventario de telas», mirar la existencia, restar de cabeza y volver a
 * capturar la diferencia con el signo correcto. Ahora se teclea LO QUE HAY, con el saldo del
 * sistema al lado, y el servidor calcula la diferencia bajo lock y la aplica como movimiento de
 * kardex (patrón del conteo cíclico de PT, `indicadores/inventario-ciclico.ts`).
 *
 * Los modos «Entrada» y «Salida» siguen para lo que NO es un conteo (una merma, una corrección
 * puntual): ahí la cantidad ES el movimiento y pedirla como "cuánto queda" obligaría a la resta al
 * revés. Una ENTRADA crea UNA PARTIDA por renglón (folio propio por empresa + lote del proveedor
 * opcional + factura del encabezado); una SALIDA valida no-negativo de AMBOS componentes bajo lock
 * (el backend es la autoridad).
 *
 * Es la ÚNICA pantalla que ajusta tela: el ajuste del flujo viejo POR LOTE se quedó sin UI el
 * 13-ago-2026 (vivía como pestaña de «Ajuste de materiales», hoy «Ajuste de avíos» y solo-avíos) —
 * grababa `id_tela_color = NULL` y la vista `existencia_tela_color` lo excluye, así que ni movía
 * las existencias que se ven aquí. El endpoint legado sigue vivo en el backend; para tocarlo hay
 * que llamarlo a mano.
 */
export function AjusteTelaColorPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeMover = tienePermiso('inventario-telas.mover');

  const [modo, setModo] = useState<Modo>('conteo');
  const [idAlmacen, setIdAlmacen] = useState<string>('');
  const [fecha, setFecha] = useState(hoy());
  const [motivo, setMotivo] = useState('');
  const [factura, setFactura] = useState('');
  const [renglones, setRenglones] = useState<RenglonTelaColor[]>([]);
  const [contados, setContados] = useState<RenglonConteoTelaColor[]>([]);

  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  const tiposMov = useTiposMovimiento();
  const ajustar = useAjustarTelaColor();
  const contar = useRegistrarConteoTelaColor();

  const esConteo = modo === 'conteo';
  const esEntrada = modo === 'entrada';

  // En CONTEO el tipo de movimiento lo decide el SERVIDOR (uno por signo de la diferencia): la
  // pantalla no lo manda — no sabe todavía si va a entrar o a salir.
  const idTipoMov = useMemo(() => {
    if (esConteo) return undefined;
    const codigo = esEntrada ? 'ajuste-entrada' : 'ajuste-salida';
    return tiposMov.data?.datos.find((t) => t.codigo === codigo)?.id;
  }, [tiposMov.data, esConteo, esEntrada]);

  const motivoOk = motivo.trim().length >= 3;
  const cargando = ajustar.isPending || contar.isPending;
  const hayRenglones = esConteo ? contados.length > 0 : renglones.length > 0;
  const puedeGuardar =
    puedeMover &&
    idAlmacen !== '' &&
    motivoOk &&
    (esConteo || idTipoMov !== undefined) &&
    hayRenglones &&
    !cargando;

  /**
   * 🔴 CAMBIAR DE ALMACÉN TIRA LO CAPTURADO. Lo contado sólo significa algo CONTRA UN ALMACÉN: con
   * 80 colores capturados en Bodega A, tocar este select y pulsar «Aplicar conteo» habría escrito
   * esas 80 cantidades contra Bodega B —sobrescribiéndola con lo de A y dejando A intacta—. La
   * columna «Diferencia» se recalculaba, sí, pero con 80 renglones eso no es un aviso.
   *
   * Se tira TAMBIÉN lo del modo ajuste: la misma trampa, con cantidades que ya no son de ese
   * almacén. Vaciar es la salida honesta: lo que se contó en A no dice NADA de B.
   */
  function cambiarAlmacen(valor: string): void {
    if (valor === idAlmacen) return;
    setIdAlmacen(valor);
    if (contados.length > 0 || renglones.length > 0) {
      setContados([]);
      setRenglones([]);
      toast.info('Cambiaste de almacén: se vació lo capturado (lo contado es de un solo almacén).');
    }
  }

  function limpiar(): void {
    setRenglones([]);
    setContados([]);
    setMotivo('');
    setFactura('');
  }

  function guardarConteo(): void {
    if (idAlmacen === '') return;
    contar.mutate(
      {
        idAlmacen: Number(idAlmacen),
        fecha,
        motivo: motivo.trim(),
        ...(factura.trim().length > 0 ? { factura: factura.trim() } : {}),
        lineas: contados.map((r) => ({
          idTelaColor: r.idTelaColor,
          contadoCuerpo: r.contadoCuerpo,
          ...(r.nombreComplemento !== null ? { contadoComplemento: r.contadoComplemento } : {}),
          ...(r.loteProveedor !== undefined ? { loteProveedor: r.loteProveedor } : {}),
        })),
      },
      {
        onSuccess: (c) => {
          // Un conteo que cuadra en todo NO escribe movimiento: decirlo es parte del resultado
          // (callar sería dejar creer que "no se guardó").
          if (c.sinDiferencias) {
            toast.success('El conteo cuadró: no hubo diferencias que aplicar.');
          } else {
            const partes = [
              c.entrada === null ? null : `entrada #${String(c.entrada.folio)}`,
              c.salida === null ? null : `salida #${String(c.salida.folio)}`,
            ].filter((p): p is string => p !== null);
            toast.success(`Conteo aplicado (${partes.join(' + ')}).`);
          }
          limpiar();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function guardarAjuste(): void {
    if (idAlmacen === '' || idTipoMov === undefined) return;
    ajustar.mutate(
      {
        idTipoMov,
        idAlmacen: Number(idAlmacen),
        fecha,
        motivo: motivo.trim(),
        ...(esEntrada && factura.trim().length > 0 ? { factura: factura.trim() } : {}),
        lineas: renglones.map((r) => ({
          idTelaColor: r.idTelaColor,
          cantidad: r.cantidad,
          ...(r.nombreComplemento !== null ? { cantidadComplemento: r.cantidadComplemento } : {}),
          ...(esEntrada && r.loteProveedor !== undefined ? { loteProveedor: r.loteProveedor } : {}),
        })),
      },
      {
        onSuccess: (m) => {
          toast.success(
            esEntrada
              ? `Entrada registrada (folio #${m.folio}); se crearon ${m.renglones.length} partida(s).`
              : `Salida de ajuste registrada (folio #${m.folio}).`,
          );
          limpiar();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function guardar(): void {
    if (esConteo) guardarConteo();
    else guardarAjuste();
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4 md:p-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          {/* El título se queda igual que la entrada del menú y que el puntero de «Ajuste de
              avíos» (renombrar la pantalla es otra conversación): lo que cambió es CÓMO se captura,
              y eso lo dicen el subtítulo y la pestaña «Conteo». */}
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Ajuste de telas por color
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Conteo físico / arranque desde cero: captura <b>lo que hay</b> y el sistema aplica la
            diferencia · el motivo es obligatorio
          </p>
        </div>
      </header>

      <PestanasSegmentadas<Modo>
        opciones={[
          { valor: 'conteo', etiqueta: 'Conteo', testid: 'ajuste-color-modo-conteo' },
          { valor: 'entrada', etiqueta: 'Entrada', testid: 'ajuste-color-dir-entrada' },
          { valor: 'salida', etiqueta: 'Salida', testid: 'ajuste-color-dir-salida' },
        ]}
        valor={modo}
        alCambiar={setModo}
        etiqueta="Cómo se captura"
      />

      <Card>
        <CardHeader>
          <CardTitle>{esConteo ? 'Datos del conteo' : 'Datos del ajuste'}</CardTitle>
          <CardDescription>
            {esConteo
              ? 'Conteo por color: se captura LO CONTADO con el saldo del sistema a la vista; el servidor calcula la diferencia y la aplica como movimiento de kardex (nunca edita la existencia).'
              : esEntrada
                ? 'Entrada por color: cada renglón crea su PARTIDA (folio propio + lote del proveedor opcional).'
                : 'Salida por color: valida que ni el cuerpo ni el complemento queden en negativo.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="ajuste-color-almacen">Almacén</FieldLabel>
              <SelectNativo
                id="ajuste-color-almacen"
                value={idAlmacen}
                onChange={(e) => cambiarAlmacen(e.target.value)}
                disabled={!puedeMover}
                data-testid="ajuste-color-almacen"
              >
                <option value="">Elige el almacén…</option>
                {(almacenes.data?.datos ?? []).map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.nombre}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            <Field>
              <FieldLabel htmlFor="ajuste-color-fecha">Fecha</FieldLabel>
              <Input
                id="ajuste-color-fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                disabled={!puedeMover}
                data-testid="ajuste-color-fecha"
              />
            </Field>
            {/* La factura ampara las PARTIDAS, y en conteo también puede haberlas: si el conteo
                encuentra MÁS de lo que el sistema sabía, la pata de entrada crea su partida. */}
            {esEntrada || esConteo ? (
              <Field>
                <FieldLabel htmlFor="ajuste-color-factura">Factura (opcional)</FieldLabel>
                <Input
                  id="ajuste-color-factura"
                  value={factura}
                  onChange={(e) => setFactura(e.target.value)}
                  placeholder="Factura/remisión de las partidas"
                  disabled={!puedeMover}
                  data-testid="ajuste-color-factura"
                />
              </Field>
            ) : null}
          </div>

          <Field data-invalid={!motivoOk}>
            <FieldLabel htmlFor="ajuste-color-motivo">Motivo (obligatorio)</FieldLabel>
            <Input
              id="ajuste-color-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por qué se ajusta (conteo físico, merma, corrección…)"
              disabled={!puedeMover}
              data-testid="ajuste-color-motivo"
            />
          </Field>

          {esConteo ? (
            <CapturaConteoTelaColor
              idAlmacen={idAlmacen === '' ? undefined : Number(idAlmacen)}
              renglones={contados}
              onChange={setContados}
              soloLectura={!puedeMover}
            />
          ) : (
            <CapturaRenglonesTelaColor
              renglones={renglones}
              onChange={setRenglones}
              soloLectura={!puedeMover}
              conLoteProveedor={esEntrada}
            />
          )}

          <div className="flex items-center justify-end gap-3">
            <Button onClick={guardar} disabled={!puedeGuardar} data-testid="ajuste-color-guardar">
              {cargando ? 'Guardando…' : esConteo ? 'Aplicar conteo' : 'Registrar ajuste'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
