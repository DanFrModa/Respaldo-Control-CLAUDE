import {
  Building2,
  Calendar,
  CheckCircle2,
  FileText,
  Pencil,
  Printer,
  Send,
  Truck,
  UserRound,
  Warehouse,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { imprimirNota, useConfirmarNota, useNotasSalida } from '@/api/notas-salida';
import { useProveedores } from '@/api/proveedores';
import type { EstatusNotaSalida, NotaSalida, NotasSalidaQuery } from '@/api/tipos';
import { Avatar } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DetalleRenglonesNota } from './DetalleRenglonesNota';
import { DialogoCancelarNota } from './DialogoCancelarNota';
import { DialogoEditarNota } from './DialogoEditarNota';
import { ETIQUETA_ESTATUS_NOTA, EstatusNotaBadge, fechaCortaNota } from './piezas';

/** Renglones por página del listado. */
const POR_PAGINA = 10;

/** Estatus para el filtro (todos los del enum). */
const ESTATUS_FILTRO: readonly EstatusNotaSalida[] = ['borrador', 'confirmada', 'cancelada'];

/**
 * Pantalla de NOTAS DE SALIDA (F4-E5) sobre el motor LISTA + DETALLE. La lista busca (folio /
 * maquilero) con paginación de servidor y filtros (maquilero, estatus); el detalle muestra el
 * encabezado, los renglones (avío/tela con su traza al kardex) y las acciones. Crear/editar exigen
 * `notas.administrar`; confirmar también; cancelar `notas.cancelar`. Las acciones de escritura se
 * ocultan sin permiso; la decisión real la toma el backend (A1). Reemplaza Notas / NotasSub.
 */
export function NotasSalidaPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('notas.administrar');
  const puedeCancelar = tienePermiso('notas.cancelar');

  // ── Estado de la vista ─────────────────────────────────────────────────────
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirCanceladas, setIncluirCanceladas] = useState(false);
  const [idMaquilero, setIdMaquilero] = useState<number | null>(null);
  const [estatus, setEstatus] = useState<EstatusNotaSalida | ''>('');
  const [pagina, setPagina] = useState(1);

  const proveedores = useProveedores({ pagina: 1, porPagina: 100, ordenarPor: 'nombre' });

  const query: NotasSalidaQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'numNota',
    direccion: 'desc',
    incluirCanceladas: incluirCanceladas ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(idMaquilero !== null ? { idMaquilero } : {}),
    ...(estatus !== '' ? { estatus } : {}),
  };

  const consulta = useNotasSalida(query);
  const confirmar = useConfirmarNota();

  // ── Diálogos ───────────────────────────────────────────────────────────────
  const [editar, setEditar] = useState<{ nota?: NotaSalida; soloLectura: boolean } | null>(null);
  const [aCancelar, setACancelar] = useState<NotaSalida | null>(null);
  const [idAEnfocar, setIdAEnfocar] = useState<number | null>(null);

  function alGuardada(idNueva: number): void {
    setTextoBusqueda('');
    setPagina(1);
    setIdAEnfocar(idNueva);
  }

  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
    setPagina(1);
  }
  function alAlternarCanceladas(): void {
    setIncluirCanceladas((v) => !v);
    setPagina(1);
  }

  function confirmarNota(nota: NotaSalida): void {
    confirmar.mutate(nota.id, {
      onSuccess: (guardada) =>
        toast.success(`Nota de salida ${guardada.numNota} confirmada (avíos descontados).`),
      onError: (error) => toast.error(error.message),
    });
  }

  const datos = consulta.data;
  const totalPaginas = datos?.totalPaginas ?? 0;
  const paginacion: PaginacionListaDetalle | undefined = datos
    ? {
        total: datos.total,
        pagina: datos.pagina,
        totalPaginas,
        ocupado: consulta.isFetching,
        alAnterior: () => setPagina((p) => Math.max(1, p - 1)),
        alSiguiente: () => setPagina((p) => Math.min(totalPaginas, p + 1)),
      }
    : undefined;

  const filtros = (
    <div className="space-y-2">
      <SelectNativo
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
      <SelectNativo
        aria-label="Filtrar por estatus"
        value={estatus}
        onChange={(e) => {
          setEstatus(e.target.value as EstatusNotaSalida | '');
          setPagina(1);
        }}
        data-testid="filtro-estatus-nota"
      >
        <option value="">Todos los estatus</option>
        {ESTATUS_FILTRO.map((s) => (
          <option key={s} value={s}>
            {ETIQUETA_ESTATUS_NOTA[s]}
          </option>
        ))}
      </SelectNativo>
    </div>
  );

  return (
    <>
      <ListaDetalle<NotaSalida>
        testid="nota"
        titulo="Notas de salida"
        descripcion="Envío de material (telas y avíos) a maquileros contra una orden."
        icono={Send}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(n) => n.id}
        obtenerTitulo={(n) => `Nota ${n.numNota}`}
        obtenerActivo={(n) => n.estatus !== 'cancelada'}
        obtenerSecundaria={(n) => `${n.maquilero} · ${fechaCortaNota(n.fechaElaboracion)}`}
        renderAvatarLista={(n) => <Avatar nombre={n.maquilero} tono="neutro" tamano="sm" />}
        busqueda={textoBusqueda}
        alBuscar={alBuscar}
        filtros={filtros}
        incluirInactivos={incluirCanceladas}
        alAlternarInactivos={alAlternarCanceladas}
        textoVacio="No hay notas de salida que coincidan con la búsqueda."
        paginacion={paginacion}
        seleccionInicialId={idAEnfocar}
        puedeAdministrar={puedeAdministrar}
        alNuevo={() => setEditar({ soloLectura: false })}
        textoNuevo="Nueva nota"
        alEditar={() => undefined}
        alDesactivar={() => undefined}
        alReactivar={() => undefined}
        renderAvatarDetalle={(n) => <Avatar nombre={n.maquilero} tono="neutro" tamano="lg" />}
        renderMeta={(n) => (
          <span className="flex flex-wrap items-center gap-2">
            <EstatusNotaBadge estatus={n.estatus} />
            <span className="text-sm text-muted-foreground">{n.maquilero}</span>
          </span>
        )}
        ocultarAccionesBase
        accionesExtra={(n) => (
          <span className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => imprimirNota(n.id)}
              data-testid="imprimir-nota"
            >
              <Printer aria-hidden />
              Imprimir
            </Button>
            {puedeAdministrar && n.estatus === 'borrador' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditar({ nota: n, soloLectura: false })}
                data-testid="editar-nota"
              >
                <Pencil aria-hidden />
                Editar
              </Button>
            ) : puedeAdministrar ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditar({ nota: n, soloLectura: true })}
                data-testid="ver-nota"
              >
                <FileText aria-hidden />
                Ver
              </Button>
            ) : null}
            {puedeAdministrar && n.estatus === 'borrador' ? (
              <Button
                size="sm"
                onClick={() => confirmarNota(n)}
                disabled={confirmar.isPending}
                data-testid="confirmar-nota-accion"
              >
                <CheckCircle2 aria-hidden />
                Confirmar
              </Button>
            ) : null}
            {puedeCancelar && n.estatus !== 'cancelada' ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setACancelar(n)}
                data-testid="cancelar-nota"
              >
                <XCircle aria-hidden />
                Cancelar
              </Button>
            ) : null}
          </span>
        )}
        renderDetalle={(n) => <DetalleNota nota={n} />}
      />

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
    </>
  );
}

/** Panel de DETALLE de una nota: encabezado, renglones y traza al kardex. */
function DetalleNota({ nota }: { nota: NotaSalida }): React.JSX.Element {
  return (
    <>
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => imprimirNota(nota.id)}
          data-testid="imprimir-nota-detalle"
        >
          <Printer aria-hidden />
          Imprimir PDF
        </Button>
      </div>

      <SeccionDetalle titulo="Datos de la nota" icono={Send}>
        <RejillaCampos>
          <CampoDetalle icono={UserRound} etiqueta="Maquilero">
            <span className="font-medium">{nota.maquilero}</span>
          </CampoDetalle>
          <CampoDetalle icono={Building2} etiqueta="Estatus">
            <EstatusNotaBadge estatus={nota.estatus} />
          </CampoDetalle>
          <CampoDetalle icono={Warehouse} etiqueta="Almacén origen">
            {nota.almacen}
          </CampoDetalle>
          <CampoDetalle icono={Calendar} etiqueta="Elaboración">
            {fechaCortaNota(nota.fechaElaboracion)}
          </CampoDetalle>
          <CampoDetalle icono={Truck} etiqueta="Envío">
            {fechaCortaNota(nota.fechaEnvio)}
          </CampoDetalle>
        </RejillaCampos>

        {nota.observaciones ? (
          <p className="rounded-md border bg-muted/30 p-3 text-sm">{nota.observaciones}</p>
        ) : null}

        {nota.estatus === 'cancelada' && nota.motivoCancelacion ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <span className="font-medium text-destructive">Cancelada:</span>{' '}
            {nota.motivoCancelacion}
          </p>
        ) : null}
      </SeccionDetalle>

      <SeccionDetalle titulo="Renglones" icono={Send}>
        <DetalleRenglonesNota nota={nota} />
      </SeccionDetalle>

      <Historial creadoEn={nota.creadoEn} modificadoEn={nota.modificadoEn} />
    </>
  );
}
