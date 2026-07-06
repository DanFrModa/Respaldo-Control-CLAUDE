import {
  Building2,
  CalendarRange,
  CheckIcon,
  FileDown,
  FileText,
  MessagesSquareIcon,
  Percent,
  PencilIcon,
  ScrollText,
  UserRound,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useClientes, useDepartamentosCliente } from '@/api/clientes';
import { useEstadosLista } from '@/api/estados-lista';
import {
  descargarListaExcel,
  imprimirListaPdf,
  useAjustarPrecioLinea,
  useAprobarLinea,
  useListaPrecios,
  useListasPrecios,
  type ListaLinea,
  type ListaResumen,
  type ListasQuery,
} from '@/api/listas-precios';
import { Avatar } from '@/components/dominio/visuales';
import { Badge } from '@/components/ui/badge';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatearMoneda } from '@/lib/formato';
import { ListaDetalle } from '@/modulos/ListaDetalle';
import { CampoDetalle, Historial, RejillaCampos, SeccionDetalle } from '@/modulos/detalle';
import { useSesion } from '@/sesion/useSesion';

import { DialogoCrearLista } from './DialogoCrearLista';
import { DialogoEditarFactoresLista } from './DialogoEditarFactoresLista';
import { DialogoNegociacionRenglon } from './DialogoNegociacionRenglon';
import { SelectorEstadoLista } from './SelectorEstadoLista';

/** Tope alto para los selectores de filtro. */
const QUERY_CATALOGO = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'nombre',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;

/** Query de estados (para el filtro): ordenados por su `orden`. */
const QUERY_ESTADOS = {
  pagina: 1,
  porPagina: 100,
  ordenarPor: 'orden',
  direccion: 'asc',
  incluirInactivos: 'false',
} as const;

/**
 * Módulo "Listas de precios" (F8-E4) — lista + detalle (teal). La lista muestra las listas por
 * Cliente+Departamento con filtros; el detalle es la VISTA DE APROBACIÓN del dueño (renglón por
 * renglón: precio calculado → Aprobar / teclear otro), pensada también para móvil. `listas.ver`
 * gobierna el acceso; `listas.administrar` crea/edita factores; `listas.aprobar` aprueba/teclea (el
 * backend re-verifica, A1).
 */
export function ListasPreciosPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('listas.administrar');

  const [idClienteFiltro, setIdClienteFiltro] = useState('');
  const [idDepartamentoFiltro, setIdDepartamentoFiltro] = useState('');
  const [idEstadoFiltro, setIdEstadoFiltro] = useState('');
  const [crearAbierto, setCrearAbierto] = useState(false);
  const [seleccionForzada, setSeleccionForzada] = useState<number | null>(null);

  const clientes = useClientes(QUERY_CATALOGO);
  const estados = useEstadosLista(QUERY_ESTADOS);
  const departamentosFiltro = useDepartamentosCliente(
    idClienteFiltro === '' ? undefined : Number(idClienteFiltro),
  );

  const query: ListasQuery = {
    ...(idClienteFiltro === '' ? {} : { idCliente: Number(idClienteFiltro) }),
    ...(idDepartamentoFiltro === '' ? {} : { idClienteDepartamento: Number(idDepartamentoFiltro) }),
    ...(idEstadoFiltro === '' ? {} : { idEstadoLista: Number(idEstadoFiltro) }),
  };

  const consulta = useListasPrecios(query);
  const listas = consulta.data ?? [];

  // Búsqueda local por folio o cliente (el listado no pagina en servidor: es acotado por empresa).
  const [busqueda, setBusqueda] = useState('');
  const filtradas = busqueda.trim()
    ? listas.filter(
        (l) =>
          String(l.folio).includes(busqueda.trim()) ||
          l.nombreCliente.toLowerCase().includes(busqueda.trim().toLowerCase()),
      )
    : listas;

  function cambiarClienteFiltro(valor: string): void {
    setIdClienteFiltro(valor);
    setIdDepartamentoFiltro('');
  }

  const filtros = (
    <div className="space-y-2" data-testid="filtros-listas">
      <SelectNativo
        aria-label="Filtrar por cliente"
        value={idClienteFiltro}
        onChange={(e) => cambiarClienteFiltro(e.target.value)}
      >
        <option value="">Todos los clientes</option>
        {(clientes.data?.datos ?? []).map((c) => (
          <option key={c.id} value={String(c.id)}>
            {c.nombre}
          </option>
        ))}
      </SelectNativo>
      <SelectNativo
        aria-label="Filtrar por departamento"
        value={idDepartamentoFiltro}
        disabled={idClienteFiltro === ''}
        onChange={(e) => setIdDepartamentoFiltro(e.target.value)}
      >
        <option value="">Todos los departamentos</option>
        {(departamentosFiltro.data ?? [])
          .filter((d) => d.activo)
          .map((d) => (
            <option key={d.id} value={String(d.id)}>
              {d.nombre}
            </option>
          ))}
      </SelectNativo>
      <SelectNativo
        aria-label="Filtrar por estado"
        value={idEstadoFiltro}
        onChange={(e) => setIdEstadoFiltro(e.target.value)}
      >
        <option value="">Todos los estados</option>
        {(estados.data?.datos ?? []).map((e) => (
          <option key={e.id} value={String(e.id)}>
            {e.nombre}
          </option>
        ))}
      </SelectNativo>
    </div>
  );

  return (
    <>
      <ListaDetalle<ListaResumen>
        testid="lista-precios"
        titulo="Listas de precios"
        descripcion="Listas de precios por cliente y departamento, con aprobación del dueño renglón por renglón."
        icono={ScrollText}
        registros={filtradas}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(l) => l.id}
        obtenerTitulo={(l) => `Lista #${String(l.folio)} · ${l.nombreCliente}`}
        obtenerActivo={() => true}
        obtenerSecundaria={(l) =>
          `${l.nombreDepartamento} · ${l.nombreEstado} · ${String(l.renglonesAprobados)}/${String(l.totalRenglones)} aprobados`
        }
        renderAvatarLista={(l) => <Avatar nombre={l.nombreCliente} tono="pt" tamano="sm" />}
        busqueda={busqueda}
        alBuscar={setBusqueda}
        filtros={filtros}
        incluirInactivos={false}
        alAlternarInactivos={() => undefined}
        textoVacio="No hay listas de precios que coincidan."
        seleccionInicialId={seleccionForzada}
        puedeAdministrar={puedeAdministrar}
        alNuevo={() => setCrearAbierto(true)}
        textoNuevo="Nueva lista"
        // La lista no se edita/desactiva como un CRUD: sus acciones viven en el detalle.
        ocultarAccionesBase
        alEditar={() => undefined}
        alDesactivar={() => undefined}
        alReactivar={() => undefined}
        renderAvatarDetalle={(l) => <Avatar nombre={l.nombreCliente} tono="pt" tamano="lg" />}
        renderMeta={(l) => <Badge variant="outline">{l.nombreEstado}</Badge>}
        renderDetalle={(l) => <DetalleLista idLista={l.id} resumen={l} />}
      />

      <DialogoCrearLista
        abierto={crearAbierto}
        alCambiarAbierto={setCrearAbierto}
        alCreada={(id) => {
          setSeleccionForzada(id);
          void consulta.refetch();
        }}
      />
    </>
  );
}

/** Panel de DETALLE de una lista: encabezado, factores snapshot, toolbar de export y tabla de aprobación. */
function DetalleLista({
  idLista,
  resumen,
}: {
  idLista: number;
  resumen: ListaResumen;
}): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const verImportes = tienePermiso('consultas.ver-importes');
  const puedeAprobar = tienePermiso('listas.aprobar');
  const puedeAdministrar = tienePermiso('listas.administrar');
  const puedeNegociar = tienePermiso('listas.negociar');

  const consulta = useListaPrecios(idLista);
  const [editarFactoresAbierto, setEditarFactoresAbierto] = useState(false);

  const lista = consulta.data;

  if (consulta.isPending) {
    return <p className="text-sm text-muted-foreground">Cargando lista…</p>;
  }
  if (consulta.isError || lista === undefined) {
    return (
      <p className="text-sm text-destructive">
        {consulta.error?.message ?? 'No se pudo cargar la lista.'}
      </p>
    );
  }

  return (
    <>
      <SeccionDetalle titulo="Datos de la lista" icono={FileText}>
        <RejillaCampos>
          <CampoDetalle icono={UserRound} etiqueta="Cliente">
            {lista.nombreCliente}
          </CampoDetalle>
          <CampoDetalle icono={Building2} etiqueta="Departamento">
            {lista.nombreDepartamento}
          </CampoDetalle>
          <CampoDetalle icono={CalendarRange} etiqueta="Fecha">
            {lista.fecha}
          </CampoDetalle>
          <CampoDetalle icono={ScrollText} etiqueta="Estado">
            {lista.nombreEstado}
          </CampoDetalle>
          {lista.notas ? (
            <CampoDetalle icono={FileText} etiqueta="Notas" anchoCompleto>
              {lista.notas}
            </CampoDetalle>
          ) : null}
        </RejillaCampos>
        {puedeNegociar ? (
          <div className="mt-3 border-t pt-3">
            <SelectorEstadoLista lista={lista} />
          </div>
        ) : null}
      </SeccionDetalle>

      {verImportes ? (
        <SeccionDetalle titulo="Factores (snapshot)" icono={Percent}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">
              Margen {String(lista.margenPct)}% · Descuentos {String(lista.descuentosPct)}% ·
              Regalías {String(lista.regaliasPct)}% · Costo de ventas {String(lista.costoVentasPct)}
              %
            </span>
            {puedeAdministrar ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditarFactoresAbierto(true)}
                data-testid="editar-factores-lista"
              >
                <PencilIcon aria-hidden />
                Editar factores
              </Button>
            ) : null}
          </div>
        </SeccionDetalle>
      ) : null}

      <SeccionDetalle titulo="Renglones" icono={ScrollText}>
        {verImportes ? (
          <div className="mb-2 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => imprimirListaPdf(lista.id)}
              data-testid="descargar-lista-pdf"
            >
              <FileText aria-hidden />
              Descargar PDF
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => descargarListaExcel(lista.id)}
              data-testid="descargar-lista-excel"
            >
              <FileDown aria-hidden />
              Excel
            </Button>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Modelo</TableHead>
                <TableHead>Nº cliente</TableHead>
                <TableHead className="text-right">Costo</TableHead>
                <TableHead className="text-right">Calculado</TableHead>
                <TableHead className="text-right">Aprobado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.lineas.map((linea) => (
                <FilaRenglon
                  key={linea.id}
                  linea={linea}
                  verImportes={verImportes}
                  puedeAprobar={puedeAprobar}
                  puedeNegociar={puedeNegociar}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </SeccionDetalle>

      <Historial creadoEn={resumen.creadoEn} modificadoEn={lista.modificadoEn} />

      <DialogoEditarFactoresLista
        abierto={editarFactoresAbierto}
        alCambiarAbierto={setEditarFactoresAbierto}
        lista={lista}
      />
    </>
  );
}

/** Un renglón de la tabla de aprobación (modelo, precios, aprobar/teclear y negociación). */
function FilaRenglon({
  linea,
  verImportes,
  puedeAprobar,
  puedeNegociar,
}: {
  linea: ListaLinea;
  verImportes: boolean;
  puedeAprobar: boolean;
  puedeNegociar: boolean;
}): React.JSX.Element {
  const aprobar = useAprobarLinea();
  const [tecleoAbierto, setTecleoAbierto] = useState(false);
  const [negociacionAbierta, setNegociacionAbierta] = useState(false);

  function alAprobar(): void {
    aprobar.mutate(linea.id, {
      onSuccess: () => toast.success(`Renglón "${linea.codigoModelo}" aprobado.`),
      onError: (error) => toast.error(error.message),
    });
  }

  return (
    <TableRow data-testid="fila-renglon-lista" data-aprobado={linea.aprobado}>
      <TableCell>
        <span className="font-medium">{linea.codigoModelo}</span>
        {linea.descripcionModelo ? (
          <span className="block text-xs text-muted-foreground">{linea.descripcionModelo}</span>
        ) : null}
      </TableCell>
      <TableCell>{linea.numeroCliente ?? '—'}</TableCell>
      <TableCell className="text-right">
        {verImportes ? formatearMoneda(linea.costoUnit) : '—'}
      </TableCell>
      <TableCell className="text-right">
        {verImportes ? formatearMoneda(linea.precioCalculado) : '—'}
      </TableCell>
      <TableCell className="text-right">
        {linea.aprobado ? (
          <Badge variant="default" data-testid="precio-aprobado">
            {verImportes ? formatearMoneda(linea.precioAprobado) : 'Aprobado'}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          {puedeAprobar ? (
            <>
              <Button
                type="button"
                size="sm"
                onClick={alAprobar}
                disabled={aprobar.isPending}
                data-testid="aprobar-renglon"
              >
                <CheckIcon aria-hidden />
                Aprobar
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setTecleoAbierto(true)}
                data-testid="teclear-precio"
              >
                Teclear
              </Button>
            </>
          ) : null}
          {/* La negociación (historial + comparador) la ve cualquiera con `listas.ver`; las acciones
              de negociar dentro del panel se gobiernan por `listas.negociar`. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setNegociacionAbierta(true)}
            data-testid="abrir-negociacion"
          >
            <MessagesSquareIcon aria-hidden />
            Negociación
          </Button>
        </div>
        <DialogoAjustarPrecio
          abierto={tecleoAbierto}
          alCambiarAbierto={setTecleoAbierto}
          linea={linea}
        />
        <DialogoNegociacionRenglon
          abierto={negociacionAbierta}
          alCambiarAbierto={setNegociacionAbierta}
          linea={linea}
          verImportes={verImportes}
          puedeNegociar={puedeNegociar}
        />
      </TableCell>
    </TableRow>
  );
}

/** Diálogo para teclear el precio aprobado de un renglón. */
function DialogoAjustarPrecio({
  abierto,
  alCambiarAbierto,
  linea,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  linea: ListaLinea;
}): React.JSX.Element {
  const ajustar = useAjustarPrecioLinea();
  const [valor, setValor] = useState('');

  function guardar(): void {
    const precio = Number(valor);
    if (!Number.isFinite(precio) || precio <= 0) {
      toast.error('Captura un precio mayor a cero.');
      return;
    }
    ajustar.mutate(
      { idLinea: linea.id, cuerpo: { precio } },
      {
        onSuccess: () => {
          toast.success(`Precio de "${linea.codigoModelo}" actualizado.`);
          alCambiarAbierto(false);
          setValor('');
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Precio de {linea.codigoModelo}</DialogTitle>
          <DialogDescription>Teclea el precio aprobado para este renglón.</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Field>
            <FieldLabel htmlFor="teclear-precio-valor">Precio</FieldLabel>
            <Input
              id="teclear-precio-valor"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              autoFocus
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              data-testid="input-precio-teclear"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={ajustar.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={guardar}
            disabled={ajustar.isPending}
            data-testid="guardar-precio-teclear"
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
