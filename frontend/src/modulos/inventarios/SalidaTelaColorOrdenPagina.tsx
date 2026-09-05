import { TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import { usePreviaSalidaTelaColor, useSalidaTelaColorAOrden } from '@/api/inventario-materiales';
import { useOrden } from '@/api/ordenes';
import type { Orden } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { SelectorOrden } from '@/modulos/produccion/SelectorOrden';
import { useSesion } from '@/sesion/useSesion';

import { AvisoSobreSalidaTela } from './AvisoSobreSalidaTela';
import { CapturaRenglonesTelaColor, type RenglonTelaColor } from './CapturaRenglonesTelaColor';

/** Fecha de hoy en YYYY-MM-DD (zona local). */
function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Lee un id entero positivo de una clave del `state` del deep-link, o null. */
function leerIdDeepLink(state: unknown, clave: string): number | null {
  if (typeof state !== 'object' || state === null || !(clave in state)) {
    return null;
  }
  const id = (state as Record<string, unknown>)[clave];
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * SALIDA DE TELA A UNA ORDEN por TELA+COLOR (inventario NUEVO, etapa A2 — Daniel §Post-F9.9): el
 * consumo EMPAREJA por color, NO por partida (las salidas no obligan a escoger partida), y el
 * cuerpo y el complemento viajan JUNTOS en el mismo renglón. Como puede haber PARTIDAS con tonos
 * distintos del mismo color, la pantalla AVISA el riesgo de tono SIN bloquear (DECISIONES
 * §Post-F9.11 punto 2). Desde la fila 0.101 ese aviso dejó de salir SIEMPRE y el servidor devuelve
 * un estado de TRES valores, que aquí se pintan **con dos pesos distintos a propósito**:
 * `varias-partidas` → **alarma ámbar con la lista** de partidas (hay de dónde escoger: interrumpe);
 * `origen-desconocido` → **línea neutra** que dice que el sistema no sabe de qué partidas es esa
 * tela —lo normal cuando llegó traspasada, y en el almacén del cortador es SIEMPRE— (acompaña, no
 * interrumpe); `sin-riesgo` → nada. Los tres estados y sus límites, en
 * `dominio/inventarios/previa-salida-tela-orden.ts`.
 * En la misma fila entró el aviso de **SOBRE-SALIDA** (Daniel §Post-F9.193 dec. 8): si lo que se
 * saca —contando lo que YA salió antes— pasa de lo que la orden pide, se dice. **Los dos avisos
 * los decide el SERVIDOR** (`usePreviaSalidaTelaColor` → `dominio/inventarios/previa-salida-tela-
 * orden.ts`): la pantalla no compara nada (A1), sólo pinta el veredicto. Ninguno bloquea: el botón
 * de guardar no se apaga jamás por ellos. Conserva el deep-link `state.idOrden` de "Descargar tela" (avance de
 * producción / centro de órdenes) y, desde §Post-F9.13, también `state.idCortador`: con el corte
 * capturado a nombre de un cortador, la salida arranca en SU almacén (el que tiene ligado en el
 * catálogo) sin que haya que buscarlo. El servidor valida no-negativo de AMBOS componentes bajo lock
 * (D3). La salida vieja por lote sigue como "Salida a orden por lote (legado)".
 * `inventario-telas.mover` gobierna la captura.
 */
export function SalidaTelaColorOrdenPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeMover = tienePermiso('inventario-telas.mover');

  // DEEP-LINK desde el avance de producción / centro de órdenes (Daniel, 28-jul-2026): el enlace
  // trae la orden ya puesta. Se consume el `state` en cuanto llega para que un refresh o un
  // "atrás" no lo vuelvan a aplicar (patrón de la pantalla por lote que esta sustituye).
  const location = useLocation();
  const navigate = useNavigate();
  const [idDeepLink] = useState<number | null>(() => leerIdDeepLink(location.state, 'idOrden'));
  // Cortador del corte que se estaba capturando: se traduce a SU almacén en cuanto llega la lista.
  const [idCortadorDeepLink] = useState<number | null>(() =>
    leerIdDeepLink(location.state, 'idCortador'),
  );
  const ordenDeepLink = useOrden(idDeepLink ?? undefined);

  const [orden, setOrden] = useState<Orden | undefined>(undefined);
  const [idAlmacen, setIdAlmacen] = useState<string>('');
  const [fecha, setFecha] = useState(hoy());
  const [observaciones, setObservaciones] = useState('');
  const [renglones, setRenglones] = useState<RenglonTelaColor[]>([]);

  // Solo almacenes de TELA: la salida de tela no puede salir de una bodega de PT ni de avíos.
  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
    tipo: 'TELA',
  });
  const crear = useSalidaTelaColorAOrden();

  // Almacén del cortador que venía en el deep-link (§Post-F9.13). Se resuelve contra la lista ya
  // cargada: la liga vive en el catálogo de almacenes, así que no hace falta otra consulta.
  const listaAlmacenes = almacenes.data?.datos;
  // Se propone UNA sola vez (ref, no dependencia): si el usuario borra el almacén a propósito, no
  // se lo volvemos a poner en el siguiente render.
  const cortadorAtendido = useRef(false);
  useEffect(() => {
    if (idCortadorDeepLink === null || listaAlmacenes === undefined || cortadorAtendido.current) {
      return;
    }
    cortadorAtendido.current = true;
    const suyo = listaAlmacenes.find((a) => a.idCortador === idCortadorDeepLink);
    if (suyo !== undefined) {
      // Solo se propone si el usuario aún no eligió: nunca pisa su elección.
      setIdAlmacen((actual) => (actual === '' ? String(suyo.id) : actual));
    }
  }, [idCortadorDeepLink, listaAlmacenes]);

  // La orden del deep-link se fija SOLO una vez y solo si el usuario no eligió otra a mano.
  const ordenDeepLinkData = ordenDeepLink.data;
  useEffect(() => {
    if (idDeepLink === null) {
      // Sin orden pero CON cortador (§Post-F9.13): el state ya se leyó a estado local al montar,
      // así que se limpia igual para que un refresh o un "atrás" no lo reapliquen.
      if (idCortadorDeepLink !== null) {
        void navigate(location.pathname, { replace: true, state: null });
      }
      return;
    }
    if (ordenDeepLinkData !== undefined) {
      setOrden((actual) => actual ?? ordenDeepLinkData);
    }
    // Se limpia el state aunque la orden falle (404/sin permiso): el deep-link ya se atendió.
    if (ordenDeepLinkData !== undefined || ordenDeepLink.isError) {
      void navigate(location.pathname, { replace: true, state: null });
    }
  }, [
    idDeepLink,
    idCortadorDeepLink,
    ordenDeepLinkData,
    ordenDeepLink.isError,
    location.pathname,
    navigate,
  ]);

  /**
   * Cuerpo de la PREVIA (fila 0.101): la captura en curso, tal cual, para que el SERVIDOR decida si
   * hay sobre-salida y si hay riesgo de tono. Sin orden, sin almacén o sin renglones no hay nada
   * que avisar y la consulta ni se dispara (el almacén es el que acota las partidas del tono).
   */
  const cuerpoPrevia = useMemo(
    () =>
      orden === undefined || idAlmacen === '' || renglones.length === 0
        ? undefined
        : {
            idOrden: orden.id,
            idAlmacen: Number(idAlmacen),
            lineas: renglones.map((r) => ({
              idTelaColor: r.idTelaColor,
              cantidad: r.cantidad,
              ...(r.nombreComplemento !== null
                ? { cantidadComplemento: r.cantidadComplemento }
                : {}),
            })),
          },
    [orden, idAlmacen, renglones],
  );
  const previa = usePreviaSalidaTelaColor(cuerpoPrevia);
  const avisos = previa.data;
  // ⭐⭐ DOS LISTAS, DOS PESOS (fila 0.101, tercera revisión). `varias-partidas` es información
  // accionable y poco frecuente ⇒ alarma. `origen-desconocido` sale en TODAS las capturas de un
  // almacén alimentado por traspaso —el del cortador— ⇒ si gritara, volveríamos al «aviso que sale
  // siempre» que esta fila vino a matar. Es la ausencia de un dato, y se dice como tal.
  const coloresVariasPartidas = (avisos?.colores ?? []).filter(
    (c) => c.estadoTono === 'varias-partidas',
  );
  const coloresSinPartidas = (avisos?.colores ?? []).filter(
    (c) => c.estadoTono === 'origen-desconocido',
  );

  const totalCuerpo = renglones.reduce((s, r) => s + r.cantidad, 0);
  const totalComplemento = renglones.reduce((s, r) => s + r.cantidadComplemento, 0);
  const puedeGuardar =
    puedeMover &&
    orden !== undefined &&
    idAlmacen !== '' &&
    renglones.length > 0 &&
    !crear.isPending;

  function guardar(): void {
    if (orden === undefined || idAlmacen === '') return;
    crear.mutate(
      {
        idOrden: orden.id,
        idAlmacen: Number(idAlmacen),
        fecha,
        ...(observaciones.trim().length > 0 ? { observaciones: observaciones.trim() } : {}),
        lineas: renglones.map((r) => ({
          idTelaColor: r.idTelaColor,
          cantidad: r.cantidad,
          ...(r.nombreComplemento !== null ? { cantidadComplemento: r.cantidadComplemento } : {}),
        })),
      },
      {
        onSuccess: (mov) => {
          toast.success(
            `Salida registrada (folio #${mov.folio}, ligada a la orden #${orden.folio}).`,
          );
          setRenglones([]);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4 md:p-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Salida de tela a orden
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Descuenta tela por color (cuerpo y complemento juntos) ligándola a una orden de
            producción
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Orden</CardTitle>
            <CardDescription>Elige la orden que consume la tela.</CardDescription>
          </CardHeader>
          <CardContent>
            <SelectorOrden idSeleccionada={orden?.id} alSeleccionar={setOrden} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {orden ? `Salida para la orden #${orden.folio}` : 'Datos de la salida'}
            </CardTitle>
            <CardDescription>
              {orden
                ? `${orden.codigoModelo} · ${orden.cliente}`
                : 'Selecciona una orden para capturar su salida de tela.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {orden === undefined ? (
              <p className="text-sm text-muted-foreground">Sin orden seleccionada.</p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="salida-color-almacen">Almacén de origen</FieldLabel>
                    <SelectNativo
                      id="salida-color-almacen"
                      value={idAlmacen}
                      onChange={(e) => setIdAlmacen(e.target.value)}
                      disabled={!puedeMover}
                      data-testid="salida-color-almacen"
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
                    <FieldLabel htmlFor="salida-color-fecha">Fecha</FieldLabel>
                    <Input
                      id="salida-color-fecha"
                      type="date"
                      value={fecha}
                      onChange={(e) => setFecha(e.target.value)}
                      disabled={!puedeMover}
                      data-testid="salida-color-fecha"
                    />
                  </Field>
                </div>

                <Field>
                  <FieldLabel htmlFor="salida-color-obs">Observaciones</FieldLabel>
                  <Input
                    id="salida-color-obs"
                    value={observaciones}
                    onChange={(e) => setObservaciones(e.target.value)}
                    placeholder="Opcional"
                    disabled={!puedeMover}
                  />
                </Field>

                <div>
                  <h3 className="mb-2 text-sm font-medium">Telas a sacar (por color)</h3>
                  <CapturaRenglonesTelaColor
                    renglones={renglones}
                    onChange={setRenglones}
                    soloLectura={!puedeMover}
                  />
                </div>

                {/* ⭐⭐ AVISO (a) — SOBRE-SALIDA (fila 0.101, Daniel §Post-F9.193 dec. 8): el
                    componente lo comparten las DOS pantallas que sacan tela a una orden. */}
                <AvisoSobreSalidaTela datos={avisos} testId="salida-color-aviso-sobre-salida" />

                {/* ⭐⭐ AVISO (b1) — VARIAS PARTIDAS: la ALARMA (Daniel, DECISIONES §Post-F9.11
                    punto 2). Hay más de un lote del mismo color en este almacén, así que hay de
                    dónde escoger y el aviso interrumpe: ámbar, con la lista a la vista. Es lo que
                    Daniel pidió, y es poco frecuente — por eso puede permitirse gritar. */}
                {coloresVariasPartidas.length > 0 ? (
                  <div
                    className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400"
                    role="note"
                    data-testid="salida-color-aviso-tono"
                  >
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <div className="space-y-1">
                      <p>
                        <strong>Riesgo de tono:</strong> la salida empareja por tela y color, no por
                        partida, así que el sistema no elige el rollo. Verifica físicamente que el
                        tono del que sacas case con el resto de la orden. Este aviso no bloquea la
                        salida.
                      </p>
                      <ul className="list-disc space-y-0.5 pl-4">
                        {coloresVariasPartidas.map((c) => (
                          <li
                            key={c.idTelaColor}
                            data-testid={`salida-color-partidas-${String(c.idTelaColor)}`}
                          >
                            <strong>
                              {c.tela} · {c.telaColor}
                            </strong>{' '}
                            — {c.partidas.length} partidas en este almacén:{' '}
                            {c.partidas
                              .map(
                                (par) =>
                                  `#${String(par.folio)}` +
                                  (par.loteProveedor === null
                                    ? ''
                                    : ` (lote ${par.loteProveedor})`) +
                                  (par.fecha === null ? '' : ` del ${par.fecha}`),
                              )
                              .join(' · ')}
                            {/* 🔴 LA LISTA NO SIEMPRE ES TODO LO QUE HAY. Si además entró tela sin
                                partida (traspaso), enseñar sólo los lotes conocidos haría creer que
                                esos son el anaquel entero. No se presenta como completo lo que no lo
                                es. `sinNombrar` lo calcula el dominio; aquí no se resta nada. */}
                            {c.sinNombrar > 0
                              ? `, y hay ${c.sinNombrar.toLocaleString('es-MX')} más cuyo origen no se puede nombrar`
                              : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}

                {/* ⭐⭐ AVISO (b2) — ORIGEN DESCONOCIDO: la LÍNEA NEUTRA, y el tono sobrio es la
                    decisión, no un descuido. En un almacén alimentado por traspaso —el del cortador,
                    que es el caso normal— este estado sale en TODAS las capturas mientras quede
                    tela: la partida no viaja en el traspaso (arreglarlo es fila aparte). Pintarlo en
                    ámbar sería devolverle a Daniel el «aviso que sale siempre» con otro texto, y
                    quemar la alarma de arriba para cuando SÍ hay de dónde escoger. Acompaña, no
                    interrumpe. */}
                {coloresSinPartidas.length > 0 ? (
                  <div
                    className="space-y-0.5 text-xs text-muted-foreground"
                    role="note"
                    data-testid="salida-color-tono-sin-partidas"
                  >
                    <p>
                      El sistema <strong>no sabe de qué partidas</strong> es esta tela: llegó sin
                      partida (normalmente traspasada de otra bodega), así que puede haber varios
                      tonos. Verifícalo físicamente antes de cortar.
                    </p>
                    <ul className="list-disc space-y-0.5 pl-4">
                      {coloresSinPartidas.map((c) => (
                        <li
                          key={c.idTelaColor}
                          data-testid={`salida-color-sin-partidas-${String(c.idTelaColor)}`}
                        >
                          <strong>
                            {c.tela} · {c.telaColor}
                          </strong>{' '}
                          — hay {c.existencia.toLocaleString('es-MX')} en este almacén y sólo se
                          puede nombrar el origen de {c.entradoConocido.toLocaleString('es-MX')}.
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">
                    Total a sacar: <strong>{totalCuerpo.toLocaleString('es-MX')}</strong>
                    {totalComplemento > 0 ? (
                      <>
                        {' '}
                        · complemento: <strong>{totalComplemento.toLocaleString('es-MX')}</strong>
                      </>
                    ) : null}
                  </span>
                  <Button
                    onClick={guardar}
                    disabled={!puedeGuardar}
                    data-testid="salida-color-guardar"
                  >
                    {crear.isPending ? 'Guardando…' : 'Registrar salida'}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
