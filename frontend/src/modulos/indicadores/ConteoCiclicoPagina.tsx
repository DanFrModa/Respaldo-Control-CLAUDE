import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import {
  useAgregarRenglonCiclico,
  useCapturarConteo,
  useConteoCiclico,
} from '@/api/inventario-ciclico';
import { useColores } from '@/api/colores';
import { useTallasActivas } from '@/api/tallas';
import { useTela } from '@/api/telas';
import type { CiclicoRenglonAgregar, ConteoCiclico, ConteoCiclicoRenglon } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { SelectorAvio } from '@/modulos/inventarios/SelectorAvio';
import { SelectorModelo } from '@/modulos/inventarios/SelectorModelo';
import { SelectorTela } from '@/modulos/inventarios/SelectorTela';

/**
 * CONTEO de un inventario cíclico (F7-E5; extendido a telas y avíos en la fila 0.099). Móvil
 * primero: el capturista anota LO CONTADO, nunca una diferencia.
 *
 *  • En PRODUCTO TERMINADO el conteo es CIEGO (D6): el servidor ni siquiera manda el teórico, así
 *    que aquí no hay nada que ocultar — si `cantTeorica` no viene, la columna «Sistema» no existe.
 *  • En TELAS y AVÍOS se captura CON EL SALDO DEL SISTEMA A LA VISTA (§Post-F9.193 punto 4), y el
 *    renglón anticipa la diferencia que el sistema va a aplicar.
 *  • Una tela con COMPLEMENTO (D5) se cuenta con DOS números: cuerpo y cardigan van juntos.
 *  • Se puede AGREGAR un artículo que la hoja no trajo — mercancía que el sistema cree que no tiene.
 *
 * Permiso `indicadores.ciclicos-conteo` (el backend re-verifica, A1).
 */
export function ConteoCiclicoPagina(): React.JSX.Element {
  const { id: idParam } = useParams<{ id: string }>();
  const id = Number(idParam);
  const consulta = useConteoCiclico(Number.isNaN(id) ? null : id);
  const capturar = useCapturarConteo();
  const [valores, setValores] = useState<Record<number, string>>({});
  const [complementos, setComplementos] = useState<Record<number, string>>({});
  const [filtro, setFiltro] = useState('');
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [agregando, setAgregando] = useState(false);

  const renglones = useMemo(() => consulta.data?.renglones ?? [], [consulta.data]);

  // Inicializa/sincroniza los campos con el servidor (tras guardar, refleja lo capturado).
  useEffect(() => {
    const inicial: Record<number, string> = {};
    const inicialComp: Record<number, string> = {};
    for (const r of renglones) {
      inicial[r.idDet] = r.cantReal === null ? '' : String(r.cantReal);
      inicialComp[r.idDet] = r.cantRealComplemento === null ? '' : String(r.cantRealComplemento);
    }
    setValores(inicial);
    setComplementos(inicialComp);
  }, [renglones]);

  const cerrado = consulta.data?.estado === 'cerrado' || consulta.data?.estado === 'cancelado';

  // Filtro de PRESENTACIÓN: la hoja del arranque son cientos de renglones y hay que poder llegar a
  // uno sin recorrerlos todos con el dedo.
  const visibles = useMemo(() => {
    const texto = filtro.trim().toLocaleLowerCase('es-MX');
    return renglones.filter((r) => {
      if (soloPendientes && r.contado) return false;
      if (texto === '') return true;
      return `${r.titulo} ${r.subtitulo ?? ''}`.toLocaleLowerCase('es-MX').includes(texto);
    });
  }, [renglones, filtro, soloPendientes]);

  function guardar(): void {
    const capturados = renglones
      .filter((r) => (valores[r.idDet] ?? '') !== '')
      .map((r) => ({
        idDet: r.idDet,
        cantReal: Number(valores[r.idDet]),
        ...(r.nombreComplemento === null
          ? {}
          : { cantRealComplemento: Number(complementos[r.idDet] ?? '') }),
      }));
    if (capturados.length === 0) {
      toast.error('Captura al menos una cantidad.');
      return;
    }
    if (capturados.some((c) => !Number.isFinite(c.cantReal) || c.cantReal < 0)) {
      toast.error('Las cantidades deben ser números ≥ 0.');
      return;
    }
    if (
      capturados.some(
        (c) =>
          c.cantRealComplemento !== undefined &&
          (!Number.isFinite(c.cantRealComplemento) || c.cantRealComplemento < 0),
      )
    ) {
      toast.error('Captura también lo contado del segundo componente (número ≥ 0).');
      return;
    }
    capturar.mutate(
      { id, cuerpo: { renglones: capturados } },
      {
        onSuccess: () => toast.success('Conteo guardado.'),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <div className="h-full overflow-y-auto space-y-6 p-4 md:p-6" data-testid="ciclico-conteo">
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Conteo cíclico{consulta.data ? ` #${consulta.data.folio}` : ''}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {consulta.data
              ? `${etiquetaDimension(consulta.data.dimension)} · Almacén: ${consulta.data.almacen}`
              : 'Captura la cantidad física.'}
          </p>
        </div>
        {consulta.data !== undefined && !cerrado && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAgregando(true)}
            data-testid="cc-agregar"
          >
            Agregar artículo
          </Button>
        )}
        <Button asChild variant="outline" size="sm">
          <Link to="/indicadores/ciclicos">Volver</Link>
        </Button>
      </header>

      {consulta.isPending ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : consulta.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {consulta.error.message}
        </p>
      ) : cerrado ? (
        <p className="text-sm text-muted-foreground">
          Este inventario ya está {consulta.data?.estado} y no admite más conteo.
        </p>
      ) : (
        <>
          {renglones.length > 8 && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-8 w-full max-w-xs text-sm"
                placeholder="Buscar en la hoja…"
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                data-testid="cc-filtro"
              />
              <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={soloPendientes}
                  onChange={(e) => setSoloPendientes(e.target.checked)}
                  data-testid="cc-solo-pendientes"
                />
                Solo lo que falta
              </label>
              <span className="ml-auto text-[12px] text-faint">
                {visibles.length.toLocaleString('es-MX')} de{' '}
                {renglones.length.toLocaleString('es-MX')} renglones
              </span>
            </div>
          )}

          <div className="space-y-3">
            {visibles.map((r) => (
              <RenglonConteo
                key={r.idDet}
                renglon={r}
                valor={valores[r.idDet] ?? ''}
                complemento={complementos[r.idDet] ?? ''}
                alCambiar={(v) => setValores((prev) => ({ ...prev, [r.idDet]: v }))}
                alCambiarComplemento={(v) => setComplementos((prev) => ({ ...prev, [r.idDet]: v }))}
              />
            ))}
            {renglones.length === 0 && (
              <p className="text-sm text-muted-foreground">
                La hoja está vacía: agrega los artículos que encuentres en el almacén.
              </p>
            )}
            {renglones.length > 0 && visibles.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Ningún renglón coincide con el filtro.
              </p>
            )}
          </div>

          {renglones.length > 0 && (
            <div className="sticky bottom-0 flex justify-end gap-3 border-t bg-background/95 py-3 backdrop-blur">
              <Button
                type="button"
                onClick={guardar}
                disabled={capturar.isPending}
                data-testid="cc-guardar"
              >
                Guardar conteo
              </Button>
            </div>
          )}
        </>
      )}

      {consulta.data !== undefined && (
        <DialogoAgregar
          abierto={agregando}
          alCerrar={() => setAgregando(false)}
          idCiclico={id}
          dimension={consulta.data.dimension}
        />
      )}
    </div>
  );
}

/** Cómo se le dice al usuario qué cuenta esta hoja. */
function etiquetaDimension(dimension: ConteoCiclico['dimension']): string {
  if (dimension === 'TELA') return 'Telas';
  if (dimension === 'AVIO') return 'Avíos';
  return 'Producto terminado';
}

/** Número con su unidad, o `—` si no hay dato. */
function conUnidad(valor: number | undefined, unidad: string | null): string {
  if (valor === undefined) return '—';
  return unidad === null
    ? valor.toLocaleString('es-MX')
    : `${valor.toLocaleString('es-MX')} ${unidad}`;
}

/**
 * Un renglón de la hoja. Enseña el SALDO DEL SISTEMA cuando el conteo no es ciego, y anticipa la
 * diferencia que se va a aplicar — el número que el capturista antes tenía que sacar de cabeza.
 */
function RenglonConteo({
  renglon,
  valor,
  complemento,
  alCambiar,
  alCambiarComplemento,
}: {
  renglon: ConteoCiclicoRenglon;
  valor: string;
  complemento: string;
  alCambiar: (v: string) => void;
  alCambiarComplemento: (v: string) => void;
}): React.JSX.Element {
  const ciego = renglon.cantTeorica === undefined;
  const diferencia =
    ciego || valor.trim() === '' || !Number.isFinite(Number(valor))
      ? null
      : Number(valor) - (renglon.cantTeorica ?? 0);
  const difComplemento =
    ciego ||
    renglon.nombreComplemento === null ||
    complemento.trim() === '' ||
    !Number.isFinite(Number(complemento))
      ? null
      : Number(complemento) - (renglon.cantTeoricaComplemento ?? 0);

  return (
    <Card data-testid={`cc-fila-${renglon.idDet}`}>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{renglon.titulo}</p>
          {renglon.subtitulo !== null && (
            <p className="truncate text-sm text-muted-foreground">{renglon.subtitulo}</p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-4">
          {!ciego && (
            <div className="text-right" data-testid={`cc-saldo-${renglon.idDet}`}>
              <p className="text-[11px] tracking-wide text-faint uppercase">Sistema</p>
              <p className="text-sm font-medium">
                {conUnidad(renglon.cantTeorica, renglon.unidad)}
              </p>
              {diferencia !== null && diferencia !== 0 && (
                <p className={diferencia > 0 ? 'text-xs text-ok' : 'text-xs text-crit'}>
                  {diferencia > 0 ? '+' : ''}
                  {diferencia.toLocaleString('es-MX')}
                </p>
              )}
            </div>
          )}
          <div>
            <p className="text-[11px] tracking-wide text-faint uppercase">Contado</p>
            <Input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              className="w-24"
              aria-label={`Cantidad contada de ${renglon.titulo} ${renglon.subtitulo ?? ''}`}
              value={valor}
              onChange={(e) => alCambiar(e.target.value)}
              data-testid={`cc-cant-${renglon.idDet}`}
            />
          </div>
          {renglon.nombreComplemento !== null && (
            <div>
              <p className="max-w-24 truncate text-[11px] tracking-wide text-faint uppercase">
                {renglon.nombreComplemento}
              </p>
              {!ciego && (
                <p className="text-[11px] text-muted-foreground">
                  Sistema: {conUnidad(renglon.cantTeoricaComplemento, renglon.unidad)}
                  {difComplemento !== null && difComplemento !== 0
                    ? ` · ${difComplemento > 0 ? '+' : ''}${difComplemento.toLocaleString('es-MX')}`
                    : ''}
                </p>
              )}
              <Input
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                className="w-24"
                aria-label={`Cantidad contada de ${renglon.nombreComplemento} de ${renglon.titulo}`}
                value={complemento}
                onChange={(e) => alCambiarComplemento(e.target.value)}
                data-testid={`cc-comp-${renglon.idDet}`}
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Agrega a la hoja un artículo que la enumeración NO trajo — es decir, mercancía que el sistema cree
 * que no tiene (§Post-F9.193). El formulario cambia con la dimensión de la hoja porque cambia la
 * llave del artículo; el servidor rechaza cualquier combinación que no sea la suya.
 */
function DialogoAgregar({
  abierto,
  alCerrar,
  idCiclico,
  dimension,
}: {
  abierto: boolean;
  alCerrar: () => void;
  idCiclico: number;
  dimension: ConteoCiclico['dimension'];
}): React.JSX.Element {
  const agregar = useAgregarRenglonCiclico();
  const [idModelo, setIdModelo] = useState<number | undefined>(undefined);
  const [etiquetaModelo, setEtiquetaModelo] = useState('');
  const [idColor, setIdColor] = useState('');
  const [idTalla, setIdTalla] = useState('');
  const [idTela, setIdTela] = useState<number | undefined>(undefined);
  const [etiquetaTela, setEtiquetaTela] = useState('');
  const [idTelaColor, setIdTelaColor] = useState('');
  const [idAvio, setIdAvio] = useState<number | undefined>(undefined);
  const [etiquetaAvio, setEtiquetaAvio] = useState('');

  const colores = useColores({ pagina: 1, porPagina: 200, ordenarPor: 'nombre', direccion: 'asc' });
  const tallas = useTallasActivas();
  const tela = useTela(dimension === 'TELA' ? idTela : undefined);

  function limpiar(): void {
    setIdModelo(undefined);
    setEtiquetaModelo('');
    setIdColor('');
    setIdTalla('');
    setIdTela(undefined);
    setEtiquetaTela('');
    setIdTelaColor('');
    setIdAvio(undefined);
    setEtiquetaAvio('');
  }

  function guardar(e: React.FormEvent): void {
    e.preventDefault();
    let cuerpo: CiclicoRenglonAgregar;
    if (dimension === 'PT') {
      if (idModelo === undefined || idColor === '' || idTalla === '') {
        toast.error('Elige modelo, color y talla.');
        return;
      }
      cuerpo = { idModelo, idColor: Number(idColor), idTalla: Number(idTalla) };
    } else if (dimension === 'TELA') {
      if (idTelaColor === '') {
        toast.error('Elige la tela y su color.');
        return;
      }
      cuerpo = { idTelaColor: Number(idTelaColor) };
    } else {
      if (idAvio === undefined) {
        toast.error('Elige el avío.');
        return;
      }
      cuerpo = { idAvio };
    }
    agregar.mutate(
      { id: idCiclico, cuerpo },
      {
        onSuccess: () => {
          toast.success('Artículo agregado a la hoja.');
          limpiar();
          alCerrar();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && alCerrar()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <form onSubmit={guardar}>
          <DialogHeader>
            <DialogTitle>Agregar artículo a la hoja</DialogTitle>
            <DialogDescription>
              Para anotar lo que encontraste en el almacén aunque el sistema crea que no tiene nada.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {dimension === 'PT' && (
              <>
                <Field>
                  <FieldLabel>Modelo</FieldLabel>
                  <SelectorModelo
                    idSeleccionado={idModelo}
                    alSeleccionar={(m) => {
                      setIdModelo(m.id);
                      setEtiquetaModelo(m.codigo);
                    }}
                    testid="cc-ag-modelo"
                  />
                  {etiquetaModelo !== '' && (
                    <p className="text-xs text-muted-foreground">{etiquetaModelo}</p>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="cc-ag-color">Color</FieldLabel>
                  <SelectNativo
                    id="cc-ag-color"
                    value={idColor}
                    onChange={(e) => setIdColor(e.target.value)}
                    data-testid="cc-ag-color"
                  >
                    <option value="">Selecciona…</option>
                    {(colores.data?.datos ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </SelectNativo>
                </Field>
                <Field>
                  <FieldLabel htmlFor="cc-ag-talla">Talla</FieldLabel>
                  <SelectNativo
                    id="cc-ag-talla"
                    value={idTalla}
                    onChange={(e) => setIdTalla(e.target.value)}
                    data-testid="cc-ag-talla"
                  >
                    <option value="">Selecciona…</option>
                    {(tallas.data?.datos ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.etiqueta}
                      </option>
                    ))}
                  </SelectNativo>
                </Field>
              </>
            )}
            {dimension === 'TELA' && (
              <>
                <Field>
                  <FieldLabel>Tela</FieldLabel>
                  <SelectorTela
                    idSeleccionado={idTela}
                    etiquetaSeleccion={etiquetaTela}
                    alSeleccionar={(t) => {
                      setIdTela(t.id);
                      setEtiquetaTela(t.nombre);
                      setIdTelaColor('');
                    }}
                    testid="cc-ag-tela"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="cc-ag-tela-color">Color de la tela</FieldLabel>
                  <SelectNativo
                    id="cc-ag-tela-color"
                    value={idTelaColor}
                    onChange={(e) => setIdTelaColor(e.target.value)}
                    data-testid="cc-ag-tela-color"
                  >
                    <option value="">Selecciona…</option>
                    {(tela.data?.colores ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </SelectNativo>
                </Field>
              </>
            )}
            {dimension === 'AVIO' && (
              <Field>
                <FieldLabel>Avío</FieldLabel>
                <SelectorAvio
                  idSeleccionado={idAvio}
                  etiquetaSeleccion={etiquetaAvio}
                  alSeleccionar={(a) => {
                    setIdAvio(a.id);
                    setEtiquetaAvio(a.clave);
                  }}
                  testid="cc-ag-avio"
                />
              </Field>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={agregar.isPending} data-testid="cc-ag-guardar">
              Agregar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
