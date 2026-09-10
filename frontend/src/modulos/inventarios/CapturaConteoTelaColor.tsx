import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { useSaldosTelaColor } from '@/api/inventario-materiales';
import type { SaldoTelaColor } from '@/api/tipos';
import { etiquetaUnidadTela, type Tela } from '@/api/telas';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { SelectorTela } from './SelectorTela';

/** Un renglón CONTADO: lo que se vio en el anaquel. Nunca una diferencia. */
export interface RenglonConteoTelaColor {
  idTelaColor: number;
  tela: string;
  color: string;
  /** null = la tela NO lleva complemento (no se cuenta esa cantidad). */
  nombreComplemento: string | null;
  /** Unidad de la tela, ya en su etiqueta corta ("kg"/"m"). */
  unidad: string;
  contadoCuerpo: number;
  contadoComplemento: number;
  /** Lote del proveedor de la partida que se cree si el conteo da de ALTA (faltante). */
  loteProveedor?: string;
}

/** Formatea una cantidad con separador local. */
function num(valor: number): string {
  return valor.toLocaleString('es-MX');
}

/** Escribe una diferencia con su signo explícito (y "—" cuando cuadra). */
function conSigno(valor: number): string {
  if (valor === 0) return '—';
  return valor > 0 ? `+${num(valor)}` : `−${num(Math.abs(valor))}`;
}

/** Color de la diferencia: verde si falta (entra), ámbar si sobra (sale), neutro si cuadra. */
function tonoDiferencia(valor: number): string {
  if (valor === 0) return 'text-muted-foreground';
  return valor > 0 ? 'text-primary' : 'text-warn';
}

/**
 * CAPTURA DE UN CONTEO FÍSICO por TELA+COLOR (fila 0.098 — Daniel: «capturar lo contado, con el
 * saldo del sistema a la vista, y que el sistema calcule y aplique la diferencia»).
 *
 * 🔴 Lo que se teclea aquí es **LO QUE HAY**, no la resta. Hasta v0.097 «Ajuste de telas por color»
 * pedía una entrada o una salida con su cantidad y NO enseñaba la existencia: para ajustar había
 * que ir a otra pantalla, ver el saldo, restar de cabeza y volver con el signo correcto. Es la
 * pantalla con la que se va a INICIALIZAR todo el inventario de telas el día del arranque.
 *
 * El SALDO que se pinta (y la diferencia que se anticipa) sale de `GET .../telas/color/saldo`, que
 * el backend calcula por Σ de movimientos BAJO LOCK — nunca la vista `existencia_tela_color`. Es la
 * MISMA cuenta que hace el servidor al aplicar, así que lo que se ve y lo que se aplica no divergen
 * por leer de dos fuentes. Aun así la diferencia de esta pantalla es una PREVISIÓN: la de verdad la
 * recalcula el servidor bajo lock en el instante de guardar (si alguien más movió la tela mientras
 * se contaba, manda la del servidor). Presentación pura (A1).
 */
export function CapturaConteoTelaColor({
  idAlmacen,
  renglones,
  onChange,
  soloLectura = false,
}: {
  /** Almacén contra el que se pide el saldo. `undefined` = todavía no se elige (no hay saldo). */
  idAlmacen: number | undefined;
  renglones: RenglonConteoTelaColor[];
  onChange: (renglones: RenglonConteoTelaColor[]) => void;
  soloLectura?: boolean;
}): React.JSX.Element {
  const [tela, setTela] = useState<Tela | undefined>(undefined);
  const [idTelaColor, setIdTelaColor] = useState<string>('');
  const [contadoCuerpo, setContadoCuerpo] = useState<string>('');
  const [contadoComplemento, setContadoComplemento] = useState<string>('');
  const [loteProveedor, setLoteProveedor] = useState<string>('');

  const llevaComplemento = tela !== undefined && tela.nombreComplemento !== null;
  const colorElegido = tela?.colores.find((c) => String(c.id) === idTelaColor);

  // UNA sola consulta para TODOS los colores de la pantalla (los ya capturados + el que se está
  // eligiendo). Antes había un hook POR RENGLÓN: cargar el inventario del arranque eran cientos de
  // GET. El `Map` de abajo reparte el resultado por color.
  const idsColores = [
    ...new Set([
      ...renglones.map((r) => r.idTelaColor),
      ...(colorElegido === undefined ? [] : [colorElegido.id]),
    ]),
  ].sort((a, b) => a - b);
  const consultaSaldos = useSaldosTelaColor(
    idAlmacen !== undefined && idsColores.length > 0
      ? { idAlmacen, idTelaColor: idsColores.join(',') }
      : undefined,
  );
  const saldosPorColor = new Map(
    (consultaSaldos.data?.saldos ?? []).map((s) => [s.idTelaColor, s]),
  );
  const saldoElegido = colorElegido === undefined ? undefined : saldosPorColor.get(colorElegido.id);

  const cuerpoNum = contadoCuerpo === '' ? 0 : Number(contadoCuerpo);
  const complementoNum = contadoComplemento === '' ? 0 : Number(contadoComplemento);
  // ⚠️ Contar CERO es un conteo legítimo ("no quedó nada"), y es justo el que más falta hacía: con
  // el sistema en 100, un contado de 0 saca 100. Por eso NO se exige cantidad > 0 (a diferencia de
  // la captura de ajuste/salida, donde la cantidad ES el movimiento).
  const cantidadesValidas =
    Number.isFinite(cuerpoNum) &&
    cuerpoNum >= 0 &&
    Number.isFinite(complementoNum) &&
    complementoNum >= 0;
  const yaCapturado =
    colorElegido !== undefined && renglones.some((r) => r.idTelaColor === colorElegido.id);
  const puedeAgregar =
    !soloLectura && idAlmacen !== undefined && colorElegido !== undefined && cantidadesValidas;

  function elegirTela(t: Tela): void {
    setTela(t);
    setIdTelaColor('');
    setContadoCuerpo('');
    setContadoComplemento('');
  }

  function agregar(): void {
    if (tela === undefined || colorElegido === undefined || !cantidadesValidas) return;
    const nuevo: RenglonConteoTelaColor = {
      idTelaColor: colorElegido.id,
      tela: tela.nombre,
      color: colorElegido.nombre,
      nombreComplemento: tela.nombreComplemento,
      unidad: etiquetaUnidadTela(tela.unidadMedida),
      contadoCuerpo: cuerpoNum,
      contadoComplemento: llevaComplemento ? complementoNum : 0,
      ...(loteProveedor.trim().length > 0 ? { loteProveedor: loteProveedor.trim() } : {}),
    };
    // Un color se cuenta UNA vez por almacén (el backend rechaza el repetido: dos renglones
    // restarían dos veces contra el MISMO saldo). Re-capturarlo REEMPLAZA lo contado —es un
    // conteo, no una suma— y se avisa antes de pulsar.
    const sinDuplicado = renglones.filter((r) => r.idTelaColor !== colorElegido.id);
    onChange([...sinDuplicado, nuevo]);
    setContadoCuerpo('');
    setContadoComplemento('');
    setLoteProveedor('');
  }

  function quitar(idTelaColorQuitar: number): void {
    onChange(renglones.filter((r) => r.idTelaColor !== idTelaColorQuitar));
  }

  const hayComplementoEnTabla = renglones.some((r) => r.nombreComplemento !== null);

  return (
    <div className="space-y-4" data-testid="captura-conteo-tela-color">
      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">Agregar renglón (tela → color → lo contado)</p>
        {/* Igual que la captura hermana: el buscador de tela va SUELTO (no en un `Field`), porque
            su `FieldLabel htmlFor` apuntaría a un input que el combobox no expone con ese id. */}
        <SelectorTela
          idSeleccionado={tela?.id}
          etiquetaSeleccion={tela?.nombre}
          alSeleccionar={elegirTela}
          testid="conteo-tela"
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tela !== undefined ? (
            <Field>
              <FieldLabel htmlFor="conteo-color">Color</FieldLabel>
              <SelectNativo
                id="conteo-color"
                value={idTelaColor}
                onChange={(e) => setIdTelaColor(e.target.value)}
                disabled={soloLectura}
                data-testid="conteo-color"
              >
                <option value="">
                  {tela.colores.length === 0 ? 'Esta tela no tiene colores' : 'Elige el color…'}
                </option>
                {tela.colores.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.nombre}
                    {c.pantone !== null ? ` · ${c.pantone}` : ''}
                  </option>
                ))}
              </SelectNativo>
              {tela.colores.length === 0 ? (
                <p className="text-xs text-warn" data-testid="conteo-sin-colores">
                  «{tela.nombre}» no tiene colores capturados, así que no se puede contar por color.
                  Dalos de alta en <b>Catálogos › Telas</b> y vuelve.
                </p>
              ) : null}
            </Field>
          ) : null}
          {colorElegido !== undefined ? (
            <Field>
              <FieldLabel htmlFor="conteo-contado-cuerpo">
                Contado — {tela?.nombreCuerpo ?? 'cuerpo'}
              </FieldLabel>
              <Input
                id="conteo-contado-cuerpo"
                type="number"
                min={0}
                step="any"
                value={contadoCuerpo}
                onChange={(e) => setContadoCuerpo(e.target.value)}
                placeholder="Lo que hay"
                disabled={soloLectura}
                data-testid="conteo-contado-cuerpo"
              />
            </Field>
          ) : null}
          {colorElegido !== undefined && llevaComplemento ? (
            <Field>
              <FieldLabel htmlFor="conteo-contado-complemento">
                Contado — {tela?.nombreComplemento}
              </FieldLabel>
              <Input
                id="conteo-contado-complemento"
                type="number"
                min={0}
                step="any"
                value={contadoComplemento}
                onChange={(e) => setContadoComplemento(e.target.value)}
                placeholder="Lo que hay"
                disabled={soloLectura}
                data-testid="conteo-contado-complemento"
              />
            </Field>
          ) : null}
          {colorElegido !== undefined ? (
            <Field>
              <FieldLabel htmlFor="conteo-lote-prov">Lote del proveedor</FieldLabel>
              <Input
                id="conteo-lote-prov"
                value={loteProveedor}
                onChange={(e) => setLoteProveedor(e.target.value)}
                placeholder="Opcional (si el conteo da de alta)"
                disabled={soloLectura}
                data-testid="conteo-lote-prov"
              />
            </Field>
          ) : null}
        </div>

        {/* ⭐ EL SALDO DEL SISTEMA, A LA VISTA. Es lo que la pantalla no enseñaba: sin él había que
            ir a «Inventario de telas», mirar la existencia, restar de cabeza y volver. */}
        {colorElegido !== undefined ? (
          <div className="mt-3 text-sm" data-testid="conteo-saldo">
            {idAlmacen === undefined ? (
              <p className="text-warn">Elige primero el almacén para ver qué tiene el sistema.</p>
            ) : consultaSaldos.isError ? (
              <p className="text-destructive" role="alert">
                No se pudo leer el saldo del sistema: {consultaSaldos.error.message}
              </p>
            ) : saldoElegido === undefined ? (
              <p className="text-muted-foreground">Leyendo el saldo del sistema…</p>
            ) : (
              <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-muted-foreground">
                  El sistema tiene{' '}
                  <b className="num text-foreground" data-testid="conteo-saldo-cuerpo">
                    {num(saldoElegido.cuerpo)}
                  </b>{' '}
                  {tela === undefined ? '' : etiquetaUnidadTela(tela.unidadMedida)} de{' '}
                  {tela?.nombreCuerpo ?? 'cuerpo'}
                  {llevaComplemento ? (
                    <>
                      {' '}
                      y{' '}
                      <b className="num text-foreground" data-testid="conteo-saldo-complemento">
                        {num(saldoElegido.complemento)}
                      </b>{' '}
                      de {tela?.nombreComplemento}
                    </>
                  ) : null}
                </span>
                <span className={tonoDiferencia(cuerpoNum - saldoElegido.cuerpo)}>
                  Diferencia:{' '}
                  <b className="num" data-testid="conteo-diferencia-previa">
                    {conSigno(cuerpoNum - saldoElegido.cuerpo)}
                  </b>
                  {llevaComplemento
                    ? ` · ${conSigno(complementoNum - saldoElegido.complemento)} de ${
                        tela?.nombreComplemento ?? 'complemento'
                      }`
                    : ''}
                </span>
              </p>
            )}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={agregar}
            disabled={!puedeAgregar}
            data-testid="conteo-agregar"
          >
            <Plus className="size-4" aria-hidden /> {yaCapturado ? 'Reemplazar' : 'Agregar'} renglón
          </Button>
          {yaCapturado ? (
            <span className="text-xs text-muted-foreground" data-testid="conteo-ya-capturado">
              Este color ya está capturado: se reemplaza lo contado (un color se cuenta una vez).
            </span>
          ) : null}
        </div>
      </div>

      {renglones.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="conteo-sin-renglones">
          Captura lo que contaste. El sistema calculará y aplicará la diferencia contra su saldo.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table data-testid="conteo-tabla">
            <TableHeader>
              <TableRow>
                <TableHead>Tela</TableHead>
                <TableHead>Color</TableHead>
                <TableHead className="text-right">Sistema</TableHead>
                <TableHead className="text-right">Contado</TableHead>
                <TableHead className="text-right">Diferencia</TableHead>
                {hayComplementoEnTabla ? (
                  <>
                    <TableHead className="text-right">Sistema (compl.)</TableHead>
                    <TableHead className="text-right">Contado (compl.)</TableHead>
                    <TableHead className="text-right">Dif. (compl.)</TableHead>
                  </>
                ) : null}
                <TableHead>Lote prov.</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {renglones.map((r) => (
                <RenglonCapturado
                  key={r.idTelaColor}
                  renglon={r}
                  saldo={saldosPorColor.get(r.idTelaColor)}
                  conColumnasComplemento={hayComplementoEnTabla}
                  soloLectura={soloLectura}
                  alQuitar={() => quitar(r.idTelaColor)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/**
 * Un renglón ya capturado, con SU saldo del sistema al lado.
 *
 * ⚠️ El saldo llega POR PROP, no por un hook propio. Tenía uno por fila y eso convertía la carga
 * del inventario del arranque en cientos de GET; ahora el padre pide todos los colores en UNA
 * consulta y reparte. `saldo === undefined` = todavía no llegó (se pinta "…"), NO "vale cero" — en
 * el arranque «sin dato» y «cero» no son lo mismo.
 */
function RenglonCapturado({
  renglon,
  saldo,
  conColumnasComplemento,
  soloLectura,
  alQuitar,
}: {
  renglon: RenglonConteoTelaColor;
  saldo: SaldoTelaColor | undefined;
  conColumnasComplemento: boolean;
  soloLectura: boolean;
  alQuitar: () => void;
}): React.JSX.Element {
  const llevaComplemento = renglon.nombreComplemento !== null;
  const teoricoCuerpo = saldo?.cuerpo;
  const teoricoComplemento = saldo?.complemento;

  return (
    <TableRow data-testid={`conteo-fila-${renglon.idTelaColor}`}>
      <TableCell>{renglon.tela}</TableCell>
      <TableCell>{renglon.color}</TableCell>
      <TableCell className="num text-right text-muted-foreground">
        {teoricoCuerpo === undefined ? '…' : num(teoricoCuerpo)}
      </TableCell>
      <TableCell className="num text-right">
        {num(renglon.contadoCuerpo)} {renglon.unidad}
      </TableCell>
      <TableCell
        className={`num text-right font-medium ${
          teoricoCuerpo === undefined ? '' : tonoDiferencia(renglon.contadoCuerpo - teoricoCuerpo)
        }`}
      >
        {teoricoCuerpo === undefined ? '…' : conSigno(renglon.contadoCuerpo - teoricoCuerpo)}
      </TableCell>
      {/* ⚠️ «—» y «…» NO son lo mismo, y estas columnas los confundían: pintaban «—» tanto cuando la
          tela NO LLEVA complemento como cuando el saldo AÚN NO HA LLEGADO, mientras la columna de
          cuerpo sí los distinguía. Es el mismo principio que este componente enuncia arriba para el
          0 —«sin dato» y «cero» no son lo mismo— aplicado al otro hueco. Ahora: «—» = no lleva,
          «…» = todavía no llega. */}
      {conColumnasComplemento ? (
        <>
          <TableCell className="num text-right text-muted-foreground">
            {!llevaComplemento
              ? '—'
              : teoricoComplemento === undefined
                ? '…'
                : num(teoricoComplemento)}
          </TableCell>
          <TableCell className="num text-right">
            {llevaComplemento ? num(renglon.contadoComplemento) : '—'}
          </TableCell>
          <TableCell
            className={`num text-right font-medium ${
              !llevaComplemento || teoricoComplemento === undefined
                ? ''
                : tonoDiferencia(renglon.contadoComplemento - teoricoComplemento)
            }`}
          >
            {!llevaComplemento
              ? '—'
              : teoricoComplemento === undefined
                ? '…'
                : conSigno(renglon.contadoComplemento - teoricoComplemento)}
          </TableCell>
        </>
      ) : null}
      <TableCell className="text-xs text-muted-foreground">
        {renglon.loteProveedor ?? '—'}
      </TableCell>
      <TableCell className="text-right">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={alQuitar}
          disabled={soloLectura}
          aria-label={`Quitar ${renglon.tela} ${renglon.color}`}
          data-testid={`conteo-quitar-${renglon.idTelaColor}`}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </TableCell>
    </TableRow>
  );
}
