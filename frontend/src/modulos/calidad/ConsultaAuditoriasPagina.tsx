import {
  Calendar,
  ClipboardCheck,
  FileEdit,
  Medal,
  Printer,
  UserRound,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { imprimirAuditoria, useAuditorias } from '@/api/calidad';
import {
  ETIQUETAS_RESULTADO_AUDITORIA,
  ETIQUETAS_TIPO_AUDITORIA,
  RESULTADOS_AUDITORIA,
  TIPOS_AUDITORIA,
} from '@/api/esquemas';
import { useProveedores } from '@/api/proveedores';
import type {
  AuditoriaResumen,
  AuditoriasQuery,
  ResultadoAuditoria,
  TipoAuditoria,
} from '@/api/tipos';
import { Avatar } from '@/components/dominio/visuales';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';
import { ListaDetalle, type PaginacionListaDetalle } from '@/modulos/ListaDetalle';
import { CampoDetalle, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoCancelarAuditoria } from './DialogoCancelarAuditoria';
import { DialogoModificarAuditoria } from './DialogoModificarAuditoria';

/** Renglones por página del listado. */
const POR_PAGINA = 10;

/** Badge del resultado (aprobado=verde / reprobado=rojo / sin calificar=gris). */
export function ResultadoBadge({
  resultado,
}: {
  resultado: ResultadoAuditoria;
}): React.JSX.Element {
  const variante =
    resultado === 'aprobado' ? 'default' : resultado === 'reprobado' ? 'destructive' : 'secondary';
  return <Badge variant={variante}>{ETIQUETAS_RESULTADO_AUDITORIA[resultado]}</Badge>;
}

/**
 * CONSULTA DE AUDITORÍAS (F6-E3): listado LIGERO de auditorías con su encabezado, resultado, PDF
 * (R9) y las acciones de MODIFICAR / CANCELAR (borrado suave), gateadas por
 * `calidad.modificar-auditorias`. La búsqueda por folio de orden, los filtros (maquilero, resultado,
 * tipo, fechas, incluir canceladas) y la paginación las hace el SERVIDOR. Detalle enlaza a la captura.
 */
export function ConsultaAuditoriasPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeModificar = tienePermiso('calidad.modificar-auditorias');

  const [textoFolio, setTextoFolio] = useState('');
  const folioDebounce = useDebounce(textoFolio.trim(), 300);
  const [idMaquilero, setIdMaquilero] = useState<number | null>(null);
  const [resultado, setResultado] = useState<ResultadoAuditoria | ''>('');
  const [tipo, setTipo] = useState<TipoAuditoria | ''>('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [incluirCanceladas, setIncluirCanceladas] = useState(false);
  const [pagina, setPagina] = useState(1);

  const [modificar, setModificar] = useState<AuditoriaResumen | null>(null);
  const [cancelar, setCancelar] = useState<AuditoriaResumen | null>(null);

  const proveedores = useProveedores({ pagina: 1, porPagina: 100, ordenarPor: 'nombre' });

  const folioNum = Number(folioDebounce);
  const query: AuditoriasQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'numAuditoria',
    direccion: 'desc',
    incluirCanceladas: incluirCanceladas ? 'true' : 'false',
    ...(folioDebounce !== '' && Number.isFinite(folioNum) && folioNum > 0
      ? { folioOrden: folioNum }
      : {}),
    ...(idMaquilero !== null ? { idMaquilero } : {}),
    ...(resultado !== '' ? { resultado } : {}),
    ...(tipo !== '' ? { tipoAuditoria: tipo } : {}),
    ...(desde !== '' ? { desde } : {}),
    ...(hasta !== '' ? { hasta } : {}),
  };

  const consulta = useAuditorias(query);
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

  function alBuscar(valor: string): void {
    setTextoFolio(valor);
    setPagina(1);
  }
  function alAlternarCanceladas(): void {
    setIncluirCanceladas((v) => !v);
    setPagina(1);
  }

  const filtros = (
    <div className="space-y-2">
      <SelectNativo
        aria-label="Filtrar por maquilero"
        value={idMaquilero === null ? '' : String(idMaquilero)}
        onChange={(e) => {
          setIdMaquilero(e.target.value === '' ? null : Number(e.target.value));
          setPagina(1);
        }}
        data-testid="filtro-maquilero-auditoria"
      >
        <option value="">Todos los maquileros</option>
        {(proveedores.data?.datos ?? []).map((p) => (
          <option key={p.id} value={String(p.id)}>
            {p.nombre}
          </option>
        ))}
      </SelectNativo>
      <div className="grid grid-cols-2 gap-2">
        <SelectNativo
          aria-label="Filtrar por resultado"
          value={resultado}
          onChange={(e) => {
            setResultado(e.target.value as ResultadoAuditoria | '');
            setPagina(1);
          }}
          data-testid="filtro-resultado-auditoria"
        >
          <option value="">Todo resultado</option>
          {RESULTADOS_AUDITORIA.map((r) => (
            <option key={r} value={r}>
              {ETIQUETAS_RESULTADO_AUDITORIA[r]}
            </option>
          ))}
        </SelectNativo>
        <SelectNativo
          aria-label="Filtrar por tipo"
          value={tipo}
          onChange={(e) => {
            setTipo(e.target.value as TipoAuditoria | '');
            setPagina(1);
          }}
          data-testid="filtro-tipo-auditoria"
        >
          <option value="">Todo tipo</option>
          {TIPOS_AUDITORIA.map((t) => (
            <option key={t} value={t}>
              {ETIQUETAS_TIPO_AUDITORIA[t]}
            </option>
          ))}
        </SelectNativo>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="date"
          aria-label="Desde (fecha de auditoría)"
          value={desde}
          onChange={(e) => {
            setDesde(e.target.value);
            setPagina(1);
          }}
          data-testid="filtro-desde-auditoria"
        />
        <Input
          type="date"
          aria-label="Hasta (fecha de auditoría)"
          value={hasta}
          onChange={(e) => {
            setHasta(e.target.value);
            setPagina(1);
          }}
          data-testid="filtro-hasta-auditoria"
        />
      </div>
    </div>
  );

  return (
    <>
      <ListaDetalle<AuditoriaResumen>
        testid="consulta-auditoria"
        titulo="Consulta de auditorías"
        descripcion="Auditorías de calidad con su resultado, impreso y modificar/cancelar."
        icono={ClipboardCheck}
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(a) => a.id}
        obtenerTitulo={(a) => `Auditoría #${a.numAuditoria}`}
        obtenerActivo={(a) => !a.cancelada}
        obtenerSecundaria={(a) =>
          `Orden #${a.folioOrden ?? '—'} · ${a.maquilero ?? 'sin maquilero'} · ${a.fechaAuditoria}`
        }
        renderAvatarLista={(a) => <Avatar nombre={a.maquilero ?? '?'} tono="neutro" tamano="sm" />}
        busqueda={textoFolio}
        alBuscar={alBuscar}
        filtros={filtros}
        incluirInactivos={incluirCanceladas}
        alAlternarInactivos={alAlternarCanceladas}
        textoVacio="No hay auditorías que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={false}
        alNuevo={() => undefined}
        textoNuevo="Nueva auditoría"
        alEditar={() => undefined}
        alDesactivar={() => undefined}
        alReactivar={() => undefined}
        renderAvatarDetalle={(a) => (
          <Avatar nombre={a.maquilero ?? '?'} tono="neutro" tamano="lg" />
        )}
        renderMeta={(a) => (
          <span className="flex flex-wrap items-center gap-2">
            <ResultadoBadge resultado={a.resultado} />
            <Badge variant="outline">{ETIQUETAS_TIPO_AUDITORIA[a.tipoAuditoria]}</Badge>
          </span>
        )}
        ocultarAccionesBase
        renderDetalle={(a) => (
          <DetalleAuditoria
            auditoria={a}
            puedeModificar={puedeModificar}
            alImprimir={() => imprimirAuditoria(a.id)}
            alModificar={() => setModificar(a)}
            alCancelar={() => setCancelar(a)}
          />
        )}
      />

      <DialogoModificarAuditoria
        idAuditoria={modificar?.id}
        abierto={modificar !== null}
        alCambiarAbierto={(v) => {
          if (!v) setModificar(null);
        }}
      />
      <DialogoCancelarAuditoria
        idAuditoria={cancelar?.id}
        numAuditoria={cancelar?.numAuditoria}
        abierto={cancelar !== null}
        alCambiarAbierto={(v) => {
          if (!v) setCancelar(null);
        }}
      />
    </>
  );
}

/** Panel de DETALLE de una auditoría: acciones (PDF + capturar + modificar/cancelar) + encabezado. */
function DetalleAuditoria({
  auditoria,
  puedeModificar,
  alImprimir,
  alModificar,
  alCancelar,
}: {
  auditoria: AuditoriaResumen;
  puedeModificar: boolean;
  alImprimir: () => void;
  alModificar: () => void;
  alCancelar: () => void;
}): React.JSX.Element {
  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link
            to={`/calidad/auditorias/${String(auditoria.id)}`}
            data-testid="ver-capturar-auditoria"
          >
            <ClipboardCheck aria-hidden />
            Ver / capturar
          </Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={alImprimir}
          data-testid="imprimir-consulta-auditoria"
        >
          <Printer aria-hidden />
          Imprimir PDF
        </Button>
        {puedeModificar && !auditoria.cancelada ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={alModificar}
              data-testid="modificar-consulta-auditoria"
            >
              <FileEdit aria-hidden />
              Modificar
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={alCancelar}
              data-testid="cancelar-consulta-auditoria"
            >
              <XCircle aria-hidden />
              Cancelar
            </Button>
          </>
        ) : null}
      </div>

      <SeccionDetalle titulo="Datos de la auditoría" icono={Medal}>
        <RejillaCampos>
          <CampoDetalle icono={ClipboardCheck} etiqueta="Orden">
            {auditoria.folioOrden === null ? '—' : `#${auditoria.folioOrden}`}
          </CampoDetalle>
          <CampoDetalle icono={Medal} etiqueta="Modelo">
            {auditoria.codigoModelo ?? '—'}
          </CampoDetalle>
          <CampoDetalle icono={UserRound} etiqueta="Maquilero">
            {auditoria.maquilero ?? '—'}
          </CampoDetalle>
          <CampoDetalle icono={Calendar} etiqueta="Fecha de auditoría">
            {auditoria.fechaAuditoria}
          </CampoDetalle>
          <CampoDetalle icono={ClipboardCheck} etiqueta="Resultado">
            <ResultadoBadge resultado={auditoria.resultado} />
          </CampoDetalle>
          <CampoDetalle icono={ClipboardCheck} etiqueta="Muestra / fallas">
            {auditoria.tamanoMuestra} muestra · {auditoria.totalFallas} fallas
          </CampoDetalle>
        </RejillaCampos>
      </SeccionDetalle>
    </>
  );
}
