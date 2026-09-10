import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { useAlmacenes } from '@/api/almacenes';
import {
  useCancelarCiclico,
  useCrearCiclico,
  useInventariosCiclicos,
} from '@/api/inventario-ciclico';
import type { Modelo } from '@/api/modelos';
import type { InventarioCiclicoResumen, InventariosCiclicosQuery } from '@/api/tipos';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { Button } from '@/components/ui/button';
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
import { SelectorModelo } from '@/modulos/inventarios/SelectorModelo';

type EstadoFiltro = '' | 'abierto' | 'contado' | 'cerrado' | 'cancelado';
type DimensionFiltro = '' | 'PT' | 'TELA' | 'AVIO';

/** Cómo se le dice al usuario qué cuenta cada hoja. */
function etiquetaDimension(dimension: InventarioCiclicoResumen['dimension']): string {
  if (dimension === 'TELA') return 'Telas';
  if (dimension === 'AVIO') return 'Avíos';
  return 'Producto terminado';
}

/**
 * INVENTARIOS CÍCLICOS — lista + alta (F7-E5; doc 05 §Almacén; re-vestida R9 a TABLA-FIRST;
 * extendida a telas y avíos en la fila 0.099). El ALTA congela el teórico (D6); el conteo va en otra
 * pantalla y el ajuste se aplica como MOVIMIENTO de kardex (D3). page-head + toolbar (estado +
 * dimensión) + TABLA DENSA. Bajo `indicadores.ciclicos-*` (el backend re-verifica cada acción, A1).
 *
 * ⭐ **QUÉ se cuenta lo decide el ALMACÉN, no el usuario.** En el alta se elige el almacén —de
 * cualquiera de los tres tipos— y el servidor deriva de su tipo si la hoja cuenta producto
 * terminado, telas o avíos. Por eso el diálogo no tiene un desplegable de "tipo de conteo": tenerlo
 * sería ofrecer combinaciones que el servidor va a rechazar.
 */
export function InventariosCiclicosPagina(): React.JSX.Element {
  const [estado, setEstado] = useState<EstadoFiltro>('');
  const [dimension, setDimension] = useState<DimensionFiltro>('');
  const query: InventariosCiclicosQuery = {
    porPagina: 100,
    ...(estado === '' ? {} : { estado }),
    ...(dimension === '' ? {} : { dimension }),
  };
  const consulta = useInventariosCiclicos(query);
  const [alta, setAlta] = useState(false);
  const cancelar = useCancelarCiclico();

  const filas = consulta.data?.datos ?? [];

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 md:p-5 lg:overflow-visible"
      data-testid="ciclicos"
    >
      {/* ── Encabezado ─────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Inventarios cíclicos
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Conteo físico contra el kardex: el alta congela el teórico y el ajuste es un movimiento
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => setAlta(true)} data-testid="ic-nuevo">
          Nuevo inventario
        </Button>
      </header>

      {/* ── Card: filtros + tabla ───────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border bg-card lg:min-h-0 lg:flex-1 lg:shrink">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <SelectNativo
            className="h-8 w-auto text-sm"
            value={estado}
            onChange={(e) => setEstado(e.target.value as EstadoFiltro)}
            aria-label="Filtrar por estado"
            data-testid="ic-estado"
          >
            <option value="">Todos</option>
            <option value="abierto">Abiertos</option>
            <option value="contado">Contados</option>
            <option value="cerrado">Cerrados</option>
            <option value="cancelado">Cancelados</option>
          </SelectNativo>
          <SelectNativo
            className="h-8 w-auto text-sm"
            value={dimension}
            onChange={(e) => setDimension(e.target.value as DimensionFiltro)}
            aria-label="Filtrar por qué se cuenta"
            data-testid="ic-dimension"
          >
            <option value="">Todo</option>
            <option value="PT">Producto terminado</option>
            <option value="TELA">Telas</option>
            <option value="AVIO">Avíos</option>
          </SelectNativo>
          <div className="ml-auto">
            <span className="text-[12px] text-faint">
              {filas.length.toLocaleString('es-MX')} inventarios
            </span>
          </div>
        </div>

        <div className="overflow-auto lg:min-h-0 lg:flex-1">
          {consulta.isPending ? (
            <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
          ) : filas.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Sin inventarios cíclicos.</p>
          ) : (
            <TablaDensa>
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Folio</TablaDensaHead>
                  <TablaDensaHead>Cuenta</TablaDensaHead>
                  <TablaDensaHead>Almacén</TablaDensaHead>
                  <TablaDensaHead>Fecha</TablaDensaHead>
                  <TablaDensaHead>Estado</TablaDensaHead>
                  <TablaDensaHead numerica>Avance</TablaDensaHead>
                  <TablaDensaHead className="text-right">Acciones</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filas.map((c) => (
                  <TablaDensaFila key={c.id} data-testid={`ic-fila-${c.id}`}>
                    <TablaDensaCelda className="font-medium">#{c.folio}</TablaDensaCelda>
                    <TablaDensaCelda>{etiquetaDimension(c.dimension)}</TablaDensaCelda>
                    <TablaDensaCelda>{c.almacen}</TablaDensaCelda>
                    <TablaDensaCelda className="text-muted-foreground">{c.fecha}</TablaDensaCelda>
                    <TablaDensaCelda>
                      <EstadoBadge estado={c.estado} />
                    </TablaDensaCelda>
                    <TablaDensaCelda numerica>
                      {c.renglonesContados}/{c.totalRenglones}
                    </TablaDensaCelda>
                    <TablaDensaCelda className="text-right">
                      <Acciones
                        ciclico={c}
                        onCancelar={(motivo) =>
                          cancelar.mutate(
                            { id: c.id, motivo },
                            {
                              onSuccess: () => toast.success('Inventario cíclico cancelado.'),
                              onError: (err) => toast.error(err.message),
                            },
                          )
                        }
                      />
                    </TablaDensaCelda>
                  </TablaDensaFila>
                ))}
              </TablaDensaCuerpo>
            </TablaDensa>
          )}
        </div>
      </div>

      <DialogoAlta abierto={alta} alCerrar={() => setAlta(false)} />
    </div>
  );
}

function EstadoBadge({
  estado,
}: {
  estado: InventarioCiclicoResumen['estado'];
}): React.JSX.Element {
  if (estado === 'cancelado') return <ChipEstado tono="crit">Cancelado</ChipEstado>;
  if (estado === 'cerrado') return <ChipEstado tono="ok">Cerrado (ajustado)</ChipEstado>;
  if (estado === 'contado') return <ChipEstado tono="warn">Contado</ChipEstado>;
  return <ChipEstado tono="neutro">Abierto</ChipEstado>;
}

function Acciones({
  ciclico,
  onCancelar,
}: {
  ciclico: InventarioCiclicoResumen;
  onCancelar: (motivo: string) => void;
}): React.JSX.Element {
  const vivo = ciclico.estado === 'abierto' || ciclico.estado === 'contado';
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {ciclico.estado !== 'cancelado' && (
        <Button asChild variant="ghost" size="sm">
          <Link
            to={`/indicadores/ciclicos/${ciclico.id}/exactitud`}
            data-testid={`ic-exactitud-${ciclico.id}`}
          >
            Exactitud
          </Link>
        </Button>
      )}
      {vivo && (
        <>
          <Button asChild variant="ghost" size="sm">
            <Link
              to={`/indicadores/ciclicos/${ciclico.id}/conteo`}
              data-testid={`ic-conteo-${ciclico.id}`}
            >
              Conteo
            </Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              window.open(
                `/api/indicadores/ciclicos/${ciclico.id}/hoja-conteo`,
                '_blank',
                'noopener',
              )
            }
          >
            Hoja PDF
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const motivo = window.prompt('Motivo de la cancelación:');
              if (motivo === null || motivo.trim().length < 3) return;
              onCancelar(motivo.trim());
            }}
          >
            Cancelar
          </Button>
        </>
      )}
    </div>
  );
}

function DialogoAlta({
  abierto,
  alCerrar,
}: {
  abierto: boolean;
  alCerrar: () => void;
}): React.JSX.Element {
  const crear = useCrearCiclico();
  // TODOS los almacenes: el cíclico ya cuenta las tres dimensiones (fila 0.099) y es el TIPO del
  // almacén elegido el que decide cuál. Filtrarlos a `PT` aquí volvería a esconder las otras dos.
  const almacenes = useAlmacenes({
    pagina: 1,
    porPagina: 100,
    ordenarPor: 'nombre',
    direccion: 'asc',
  });
  const [idAlmacen, setIdAlmacen] = useState('');
  const [modelo, setModelo] = useState<Modelo | null>(null);
  const [observaciones, setObservaciones] = useState('');

  const elegido = (almacenes.data?.datos ?? []).find((a) => String(a.id) === idAlmacen);
  // El alcance por MODELO sólo existe en producto terminado; en telas y avíos el servidor rechaza
  // esa lista (sería un filtro que no filtra). Ofrecerlo sería invitar a un error.
  const conAlcanceModelo = elegido?.tipo === 'PT';

  function guardar(e: React.FormEvent): void {
    e.preventDefault();
    if (idAlmacen === '') {
      toast.error('El almacén es obligatorio.');
      return;
    }
    crear.mutate(
      {
        idAlmacen: Number(idAlmacen),
        ...(modelo === null || !conAlcanceModelo ? {} : { idsModelo: [modelo.id] }),
        ...(observaciones.trim() === '' ? {} : { observaciones: observaciones.trim() }),
      },
      {
        onSuccess: (inv) => {
          toast.success(
            `Inventario cíclico #${inv.folio} creado (${inv.totalRenglones} artículos).`,
          );
          setIdAlmacen('');
          setModelo(null);
          setObservaciones('');
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
            <DialogTitle>Nuevo inventario cíclico</DialogTitle>
            <DialogDescription>
              El alta congela el teórico ahora mismo. Elige el almacén: lo que se cuenta (producto
              terminado, telas o avíos) lo dice su tipo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Field>
              <FieldLabel htmlFor="ic-almacen">Almacén</FieldLabel>
              <SelectNativo
                id="ic-almacen"
                value={idAlmacen}
                onChange={(e) => {
                  setIdAlmacen(e.target.value);
                  setModelo(null);
                }}
                data-testid="ic-almacen"
              >
                <option value="">Selecciona…</option>
                {(almacenes.data?.datos ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre} · {etiquetaDimension(a.tipo)}
                  </option>
                ))}
              </SelectNativo>
            </Field>
            {conAlcanceModelo && (
              <Field>
                <FieldLabel>Alcance (modelo)</FieldLabel>
                {modelo === null ? (
                  <SelectorModelo
                    idSeleccionado={undefined}
                    alSeleccionar={(m) => setModelo(m)}
                    testid="ic-selector-modelo"
                  />
                ) : (
                  <div className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm">
                    <span className="font-medium">{modelo.codigo}</span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setModelo(null)}>
                      Quitar (todo el almacén)
                    </Button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Sin modelo = todo el almacén (artículos con existencia).
                </p>
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="ic-obs">Observaciones</FieldLabel>
              <Input
                id="ic-obs"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={crear.isPending} data-testid="ic-guardar">
              Dar de alta
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
