import { Building2, Calendar, Printer, Send, Truck, UserRound, Warehouse } from 'lucide-react';
import { useState } from 'react';

import { imprimirNota, useNotasSalida } from '@/api/notas-salida';
import { useProveedores } from '@/api/proveedores';
import type { EstatusNotaSalida, NotaSalida, NotasSalidaQuery } from '@/api/tipos';
import { Avatar } from '@/components/dominio/visuales';
import { Button } from '@/components/ui/button';
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';

import { DetalleRenglonesNota } from './DetalleRenglonesNota';
import { ETIQUETA_ESTATUS_NOTA, EstatusNotaBadge, fechaCortaNota } from './piezas';

/** Renglones por página del listado. */
const POR_PAGINA = 10;

/** Estatus para el filtro (todos los del enum). */
const ESTATUS_FILTRO: readonly EstatusNotaSalida[] = ['borrador', 'confirmada', 'cancelada'];

/**
 * CONSULTA POR NOTA (F4-E5): vista de SOLO LECTURA de las notas de salida con su encabezado,
 * renglones y estatus, y el botón de descargar PDF. No captura ni edita (`notas.ver`). Reemplaza
 * NotasVer / NotasVerSub del sistema viejo. La búsqueda/filtros y la paginación las hace el SERVIDOR.
 */
export function ConsultaNotasPagina(): React.JSX.Element {
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [incluirCanceladas, setIncluirCanceladas] = useState(false);
  const [idMaquilero, setIdMaquilero] = useState<number | null>(null);
  const [estatus, setEstatus] = useState<EstatusNotaSalida | ''>('');
  const [pagina, setPagina] = useState(1);

  const proveedores = useProveedores({ pagina: 1, porPagina: 200, ordenarPor: 'nombre' });

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

  function alBuscar(valor: string): void {
    setTextoBusqueda(valor);
    setPagina(1);
  }
  function alAlternarCanceladas(): void {
    setIncluirCanceladas((v) => !v);
    setPagina(1);
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
        data-testid="filtro-maquilero-consulta-nota"
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
        data-testid="filtro-estatus-consulta-nota"
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
    <ListaDetalle<NotaSalida>
      testid="consulta-nota"
      titulo="Consulta de notas"
      descripcion="Notas de salida con su encabezado, renglones y estatus (solo lectura)."
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
      puedeAdministrar={false}
      alNuevo={() => undefined}
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
        <Button
          variant="outline"
          size="sm"
          onClick={() => imprimirNota(n.id)}
          data-testid="imprimir-consulta-nota"
        >
          <Printer aria-hidden />
          Imprimir PDF
        </Button>
      )}
      renderDetalle={(n) => <DetalleConsultaNota nota={n} />}
    />
  );
}

/** Panel de DETALLE (solo lectura) de una nota: encabezado + renglones + PDF. */
function DetalleConsultaNota({ nota }: { nota: NotaSalida }): React.JSX.Element {
  return (
    <>
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => imprimirNota(nota.id)}
          data-testid="imprimir-consulta-nota-detalle"
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
