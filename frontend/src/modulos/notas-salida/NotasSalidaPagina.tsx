import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Layers,
  Pencil,
  Plus,
  Printer,
  Search,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useEmpresas } from '@/api/empresas';
import { imprimirNota, useConfirmarNota, useNotasSalida } from '@/api/notas-salida';
import { useProveedores } from '@/api/proveedores';
import type { NotaSalida, NotasSalidaQuery } from '@/api/tipos';
import { CajonDetalle } from '@/components/dominio/CajonDetalle';
import { ChipsFiltro } from '@/components/dominio/ChipsFiltro';
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
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';
import { useSesion } from '@/sesion/useSesion';

import { DialogoCancelarNota } from './DialogoCancelarNota';
import { DialogoEditarNota } from './DialogoEditarNota';
import { DialogoNotaTela } from './DialogoNotaTela';
import {
  TONO_ESTATUS_NOTA as TONO_NOTA,
  descripcionMaterialNota,
  fechaCortaNota,
  ordenesDeNota,
} from './piezas';

/** Renglones por página del listado (tabla densa). */
const POR_PAGINA = 20;

/** Chips de filtro por estatus (proto: Todas / Borradores / Confirmadas / Canceladas). */
const FILTROS_ESTATUS = [
  { clave: 'todas', etiqueta: 'Todas' },
  { clave: 'borrador', etiqueta: 'Borradores' },
  { clave: 'confirmada', etiqueta: 'Confirmadas' },
  { clave: 'cancelada', etiqueta: 'Canceladas' },
] as const;

type FiltroEstatus = (typeof FILTROS_ESTATUS)[number]['clave'];

/**
 * Pantalla de NOTAS DE SALIDA (F4-E5, re-vestida R9 al proto `vNotasSalida`): page-head + card con
 * chips de estatus/búsqueda + TABLA DENSA (nota, maquilero, empresa, órdenes surtidas, renglones,
 * estatus) y CAJÓN de detalle al elegir un renglón (encabezado, material por orden y acciones según
 * estatus). Crear/editar exigen `notas.administrar`; confirmar también; cancelar `notas.cancelar`.
 * Las acciones de escritura se ocultan sin permiso; la decisión real la toma el backend (A1).
 * Reemplaza Notas / NotasSub.
 */
export function NotasSalidaPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('notas.administrar');
  const puedeCancelar = tienePermiso('notas.cancelar');
  // La nota de TELAS reusa el motor F4 (salida de tela a orden) → permiso propio (§4.6 dec. 2).
  const puedeMoverTela = tienePermiso('inventario-telas.mover');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [filtroEstatus, setFiltroEstatus] = useState<FiltroEstatus>('todas');
  const [idMaquilero, setIdMaquilero] = useState<number | null>(null);
  const [pagina, setPagina] = useState(1);
  const [idSeleccion, setIdSeleccion] = useState<number | null>(null);

  const proveedores = useProveedores({ pagina: 1, porPagina: 100, ordenarPor: 'nombre' });
  // El listado solo trae `idEmpresa`: el nombre sale del catálogo (lookup de presentación).
  const empresas = useEmpresas();
  const nombreEmpresa = useMemo(() => {
    const porId = new Map<number, string>();
    for (const e of empresas.data ?? []) {
      porId.set(e.id, e.nombre);
    }
    return porId;
  }, [empresas.data]);

  const query: NotasSalidaQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'numNota',
    direccion: 'desc',
    // "Todas" y "Canceladas" incluyen las canceladas; Borradores/Confirmadas no las necesitan.
    incluirCanceladas:
      filtroEstatus === 'todas' || filtroEstatus === 'cancelada' ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(idMaquilero !== null ? { idMaquilero } : {}),
    ...(filtroEstatus !== 'todas' ? { estatus: filtroEstatus } : {}),
  };

  const consulta = useNotasSalida(query);
  const confirmar = useConfirmarNota();

  // ── Diálogos ───────────────────────────────────────────────────────────────
  const [editar, setEditar] = useState<{ nota?: NotaSalida; soloLectura: boolean } | null>(null);
  const [aCancelar, setACancelar] = useState<NotaSalida | null>(null);
  const [notaTelaAbierta, setNotaTelaAbierta] = useState(false);

  function alGuardada(idNueva: number): void {
    // La nota recién guardada queda a la vista (folio desc → página 1) y abierta en el cajón.
    setTextoBusqueda('');
    setPagina(1);
    setIdSeleccion(idNueva);
  }

  function confirmarNota(nota: NotaSalida): void {
    confirmar.mutate(nota.id, {
      onSuccess: (guardada) =>
        toast.success(`Nota de salida ${guardada.numNota} confirmada (avíos descontados).`),
      onError: (error) => toast.error(error.message),
    });
  }

  const datos = consulta.data;
  const filas = datos?.datos ?? [];
  const total = datos?.total ?? 0;
  const totalPaginas = datos?.totalPaginas ?? 1;
  const notaSeleccionada = filas.find((n) => n.id === idSeleccion);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 md:p-5">
      {/* ── Encabezado de página (proto `page-head`) ─────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
            Notas de salida
          </h1>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Envío de material (telas y avíos) a maquileros · descuenta el inventario · por orden de
            producción
          </p>
        </div>
        <div className="flex items-center gap-2">
          {puedeMoverTela ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNotaTelaAbierta(true)}
              data-testid="nueva-nota-tela"
            >
              <Layers aria-hidden />
              Nueva nota de telas
            </Button>
          ) : null}
          {puedeAdministrar ? (
            <Button
              size="sm"
              onClick={() => setEditar({ soloLectura: false })}
              data-testid="nuevo-nota"
            >
              <Plus aria-hidden />
              Nueva nota
            </Button>
          ) : null}
        </div>
      </header>

      {/* ── Card: chips de estatus + búsqueda + tabla + paginación ───────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <ChipsFiltro
            etiqueta="Filtrar por estatus"
            opciones={FILTROS_ESTATUS.map((f) => ({
              valor: f.clave,
              etiqueta: f.etiqueta,
              testid: `notas-chip-${f.clave}`,
            }))}
            valor={filtroEstatus}
            alCambiar={(valor) => {
              setFiltroEstatus(valor);
              setPagina(1);
            }}
          />
          <div className="relative w-[200px]">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={textoBusqueda}
              onChange={(e) => {
                setTextoBusqueda(e.target.value);
                setPagina(1);
              }}
              placeholder="Buscar nota, maquilero, orden…"
              className="h-8 pl-8 text-sm"
              aria-label="Buscar notas de salida"
              data-testid="notas-busqueda"
            />
          </div>
          {/* Filtro por maquilero (funcional, se conserva del F4-E5; el proto no lo trae). */}
          <SelectNativo
            className="w-44 h-8 text-sm"
            aria-label="Filtrar por maquilero"
            value={idMaquilero === null ? '' : String(idMaquilero)}
            onChange={(e) => {
              setIdMaquilero(e.target.value === '' ? null : Number(e.target.value));
              setPagina(1);
            }}
            data-testid="filtro-maquilero-nota"
          >
            <option value="">Todos los maquileros</option>
            {(proveedores.data?.datos ?? []).map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.nombre}
              </option>
            ))}
          </SelectNativo>
          <span className="ml-auto text-[12px] text-faint">
            {total.toLocaleString('es-MX')} notas
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {consulta.isPending ? (
            <p className="p-6 text-sm text-muted-foreground">Cargando notas…</p>
          ) : consulta.isError ? (
            <div className="space-y-2 p-6">
              <p className="text-sm text-destructive" role="alert">
                {consulta.error.message}
              </p>
              <Button variant="outline" size="sm" onClick={() => void consulta.refetch()}>
                Reintentar
              </Button>
            </div>
          ) : filas.length === 0 ? (
            <p
              className="m-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
              data-testid="notas-vacio"
            >
              No hay notas de salida que coincidan con la búsqueda.
            </p>
          ) : (
            <TablaDensa data-testid="notas-tabla">
              <TablaDensaEncabezado>
                <TablaDensaFila>
                  <TablaDensaHead>Nota</TablaDensaHead>
                  <TablaDensaHead>Maquilero</TablaDensaHead>
                  <TablaDensaHead>Empresa</TablaDensaHead>
                  <TablaDensaHead>Órdenes surtidas</TablaDensaHead>
                  <TablaDensaHead numerica>Renglones</TablaDensaHead>
                  <TablaDensaHead>Estatus</TablaDensaHead>
                </TablaDensaFila>
              </TablaDensaEncabezado>
              <TablaDensaCuerpo>
                {filas.map((nota) => {
                  const chip = TONO_NOTA[nota.estatus];
                  const ordenes = ordenesDeNota(nota);
                  return (
                    <TablaDensaFila
                      key={nota.id}
                      seleccionada={nota.id === idSeleccion}
                      onClick={() => setIdSeleccion(nota.id)}
                      className="cursor-pointer"
                      data-testid="nota-fila"
                    >
                      <TablaDensaCelda>
                        <span className="flex items-center gap-[9px]">
                          {/* Proto `.thumb`: cuadro 30px verde con "NS". */}
                          <span
                            aria-hidden
                            className="flex size-[30px] shrink-0 items-center justify-center rounded-[7px] bg-linear-150 from-[#7bd6a6] to-[#2f9c66] text-[11px] font-bold text-[#04140c]"
                          >
                            NS
                          </span>
                          <span className="min-w-0">
                            <span className="block font-medium">Nota {nota.numNota}</span>
                            <span className="num block text-[11px] text-faint">
                              {fechaCortaNota(nota.fechaElaboracion)}
                            </span>
                          </span>
                        </span>
                      </TablaDensaCelda>
                      <TablaDensaCelda className="font-medium">{nota.maquilero}</TablaDensaCelda>
                      <TablaDensaCelda>
                        <ChipEstado tono="neutro">
                          {nombreEmpresa.get(nota.idEmpresa) ?? `Empresa ${nota.idEmpresa}`}
                        </ChipEstado>
                      </TablaDensaCelda>
                      <TablaDensaCelda>
                        {/* Proto `opChips`: máx 3 folios + "+N". */}
                        <span className="inline-flex flex-wrap gap-1">
                          {ordenes.slice(0, 3).map((folio) => (
                            <span
                              key={folio}
                              className="num inline-flex h-5 items-center rounded-md bg-primary-soft px-[7px] text-[11.5px] font-semibold text-primary-soft-foreground"
                            >
                              {folio}
                            </span>
                          ))}
                          {ordenes.length > 3 ? (
                            <span className="num inline-flex h-5 items-center rounded-md bg-muted px-[7px] text-[11.5px] font-semibold text-muted-foreground">
                              +{ordenes.length - 3}
                            </span>
                          ) : null}
                          {ordenes.length === 0 ? <span className="text-faint">—</span> : null}
                        </span>
                      </TablaDensaCelda>
                      <TablaDensaCelda numerica>{nota.lineas.length}</TablaDensaCelda>
                      <TablaDensaCelda>
                        <ChipEstado tono={chip.tono}>{chip.texto}</ChipEstado>
                      </TablaDensaCelda>
                    </TablaDensaFila>
                  );
                })}
              </TablaDensaCuerpo>
            </TablaDensa>
          )}
        </div>

        {/* Paginación de servidor. */}
        <div className="flex shrink-0 items-center justify-between border-t px-3 py-1.5 text-xs text-muted-foreground">
          <span>
            Página {pagina} de {totalPaginas} · {total.toLocaleString('es-MX')} notas
          </span>
          <span className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              disabled={pagina <= 1 || consulta.isFetching}
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              aria-label="Página anterior"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={pagina >= totalPaginas || consulta.isFetching}
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              aria-label="Página siguiente"
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </span>
        </div>
      </div>

      {/* ── Cajón de detalle (proto `drawerNotaSalida`) ──────────────────── */}
      <CajonDetalle
        abierto={idSeleccion !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) setIdSeleccion(null);
        }}
        titulo={
          notaSeleccionada !== undefined ? (
            <span className="flex items-center gap-2">
              Nota {notaSeleccionada.numNota}
              <ChipEstado tono={TONO_NOTA[notaSeleccionada.estatus].tono}>
                {TONO_NOTA[notaSeleccionada.estatus].texto}
              </ChipEstado>
            </span>
          ) : (
            'Nota de salida'
          )
        }
        subtitulo={
          notaSeleccionada !== undefined
            ? `${notaSeleccionada.maquilero} · ${
                nombreEmpresa.get(notaSeleccionada.idEmpresa) ?? '—'
              }`
            : undefined
        }
      >
        {notaSeleccionada !== undefined ? (
          <DetalleNota
            nota={notaSeleccionada}
            empresa={nombreEmpresa.get(notaSeleccionada.idEmpresa) ?? '—'}
            puedeAdministrar={puedeAdministrar}
            puedeCancelar={puedeCancelar}
            confirmando={confirmar.isPending}
            alEditar={() => setEditar({ nota: notaSeleccionada, soloLectura: false })}
            alConfirmar={() => confirmarNota(notaSeleccionada)}
            alCancelar={() => setACancelar(notaSeleccionada)}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Cargando nota…</p>
        )}
      </CajonDetalle>

      {editar !== null ? (
        <DialogoEditarNota
          abierto
          alCambiarAbierto={(abierto) => {
            if (!abierto) {
              setEditar(null);
            }
          }}
          nota={editar.nota}
          soloLectura={editar.soloLectura}
          alGuardada={alGuardada}
        />
      ) : null}

      <DialogoCancelarNota
        abierto={aCancelar !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) {
            setACancelar(null);
          }
        }}
        nota={aCancelar ?? undefined}
      />

      <DialogoNotaTela
        abierto={notaTelaAbierta}
        alCambiarAbierto={setNotaTelaAbierta}
        alGuardada={() => void consulta.refetch()}
      />
    </div>
  );
}

/** Campo etiqueta/valor chico del cajón (proto `.field`). */
function Campo({ k, v }: { k: string; v: React.ReactNode }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-medium text-faint">{k}</p>
      <p className="truncate text-xs font-medium">{v}</p>
    </div>
  );
}

/**
 * Cuerpo del cajón (proto `drawerNotaSalida`): encabezado en rejilla, material enviado AGRUPADO por
 * orden (derivación de la propia nota) y las acciones según estatus + permisos al pie.
 */
function DetalleNota({
  nota,
  empresa,
  puedeAdministrar,
  puedeCancelar,
  confirmando,
  alEditar,
  alConfirmar,
  alCancelar,
}: {
  nota: NotaSalida;
  empresa: string;
  puedeAdministrar: boolean;
  puedeCancelar: boolean;
  confirmando: boolean;
  alEditar: () => void;
  alConfirmar: () => void;
  alCancelar: () => void;
}): React.JSX.Element {
  const ordenes = ordenesDeNota(nota);
  const sinOrden = nota.lineas.filter((l) => l.folioOrden === null);

  return (
    <div className="space-y-4" data-testid="detalle-nota">
      <section>
        <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Encabezado
        </h4>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <Campo k="Maquilero" v={nota.maquilero} />
          <Campo k="Empresa" v={empresa} />
          <Campo k="Almacén origen (avíos)" v={nota.almacen} />
          <Campo k="Fecha de elaboración" v={fechaCortaNota(nota.fechaElaboracion)} />
          <Campo
            k="Fecha de envío"
            v={
              nota.fechaEnvio === null ? (
                <span className="text-faint">pendiente</span>
              ) : (
                fechaCortaNota(nota.fechaEnvio)
              )
            }
          />
          <Campo
            k="Renglones"
            v={`${nota.lineas.length.toLocaleString('es-MX')} en ${ordenes.length} orden${
              ordenes.length === 1 ? '' : 'es'
            }`}
          />
        </div>
        {nota.observaciones !== null && nota.observaciones !== '' ? (
          <p className="mt-2 rounded-md bg-panel-2 px-2.5 py-1.5 text-xs text-muted-foreground">
            <b className="text-foreground">Observaciones:</b> {nota.observaciones}
          </p>
        ) : null}
      </section>

      <section>
        <h4 className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Material enviado — por orden
        </h4>
        <div className="space-y-2">
          {ordenes.map((folio) => (
            <GrupoOrden
              key={folio}
              titulo={
                <>
                  Orden <b className="num">{folio}</b>
                </>
              }
              lineas={nota.lineas.filter((l) => l.folioOrden === folio)}
            />
          ))}
          {sinOrden.length > 0 ? <GrupoOrden titulo="Sin orden" lineas={sinOrden} /> : null}
        </div>
      </section>

      {/* Rastro del documento (proto `audit-hint`; el listado no trae el NOMBRE de quién capturó). */}
      {nota.estatus === 'cancelada' ? (
        <p className="rounded-md bg-crit-soft px-2.5 py-1.5 text-xs text-crit" role="note">
          Nota cancelada{nota.motivoCancelacion !== null ? `: ${nota.motivoCancelacion}` : ''} — el
          material se reingresó al inventario con el movimiento inverso.
        </p>
      ) : (
        <p
          className="rounded-md bg-panel-2 px-2.5 py-1.5 text-xs text-muted-foreground"
          role="note"
        >
          {nota.estatus === 'confirmada'
            ? 'Confirmada · material descontado del inventario.'
            : 'Borrador · no se descuenta nada hasta confirmar.'}
        </p>
      )}

      {/* Pie de acciones según estatus (gate visual; el backend re-decide, A1). */}
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        {puedeAdministrar && nota.estatus === 'borrador' ? (
          <Button variant="outline" size="sm" onClick={alEditar} data-testid="editar-nota">
            <Pencil aria-hidden />
            Editar
          </Button>
        ) : null}
        {puedeCancelar && nota.estatus !== 'cancelada' ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-crit hover:text-crit"
            onClick={alCancelar}
            data-testid="cancelar-nota"
          >
            <XCircle aria-hidden />
            Cancelar nota
          </Button>
        ) : null}
        {puedeAdministrar && nota.estatus === 'borrador' ? (
          <Button
            size="sm"
            className="ml-auto"
            onClick={alConfirmar}
            disabled={confirmando}
            data-testid="confirmar-nota-accion"
          >
            <CheckCircle2 aria-hidden />
            Confirmar y descontar
          </Button>
        ) : (
          <Button
            variant={nota.estatus === 'confirmada' ? 'default' : 'outline'}
            size="sm"
            className="ml-auto"
            onClick={() => imprimirNota(nota.id)}
            data-testid="imprimir-nota"
          >
            <Printer aria-hidden />
            Imprimir nota
          </Button>
        )}
      </div>
    </div>
  );
}

/** Un grupo de renglones de la MISMA orden (proto `.nsl-group`). */
function GrupoOrden({
  titulo,
  lineas,
}: {
  titulo: React.ReactNode;
  lineas: NotaSalida['lineas'];
}): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between bg-panel-2 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>{titulo}</span>
        <span>
          {lineas.length} renglón{lineas.length === 1 ? '' : 'es'}
        </span>
      </div>
      {lineas.map((linea) => (
        <div
          key={linea.id}
          className="flex items-center justify-between gap-2 border-t px-3 py-1.5"
          data-testid="nota-renglon"
        >
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium">
              {descripcionMaterialNota(linea)}
            </span>
            <span className="num block text-[11px] text-faint">{trazaRenglon(linea)}</span>
          </span>
          <span className="num shrink-0 text-xs font-semibold">
            {linea.cantidad.toLocaleString('es-MX')}
            {linea.unidad !== null ? ` ${linea.unidad}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Traza al kardex de un renglón (descuento de avío / salida-a-orden de tela). */
function trazaRenglon(linea: NotaSalida['lineas'][number]): string {
  if (linea.tipo === 'avio') {
    return linea.folioMovimientoAvio === null
      ? 'Avío · sin descontar (borrador)'
      : `Avío · descuento #${String(linea.folioMovimientoAvio)}`;
  }
  return linea.folioMovimientoSalidaTela === null
    ? 'Tela · sin salida referenciada'
    : `Tela · salida-a-orden #${String(linea.folioMovimientoSalidaTela)}`;
}
