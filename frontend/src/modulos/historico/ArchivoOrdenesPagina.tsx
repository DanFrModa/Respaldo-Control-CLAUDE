import { useState } from 'react';

import { useTiposProductoActivos } from '@/api/calidad';
import { useHistoricoOrden, useHistoricoOrdenes } from '@/api/historico-ordenes';
import type { HistoricoOrdenesQuery, HistoricoOrdenResumen } from '@/api/tipos';
import { CajonDetalle } from '@/components/dominio/CajonDetalle';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { useDebounce } from '@/lib/useDebounce';
import {
  TablaCatalogo,
  type ColumnaCatalogo,
  type PaginacionCatalogo,
} from '@/modulos/TablaCatalogo';

/** Renglones por página. Alto: es una consulta, se recorre con la vista. */
const POR_PAGINA = 25;

/** Nombre legible de cada etapa del archivo. */
const NOMBRE_PROCESO: Record<string, string> = {
  corte: 'Corte',
  envio_maquila: 'Envío a maquila',
  recibo_maquila: 'Recibo de maquila',
  envio_estampado: 'Envío a estampado',
  recibo_estampado: 'Recibo de estampado',
};

/**
 * ARCHIVO HISTÓRICO DE ÓRDENES del sistema viejo (§Post-F9.26).
 *
 * Daniel (10-ago-2026): *"me gustaría tenerlas también como archivo histórico de órdenes. Normalmente
 * cuando queremos consultar algo de información, lo hacemos más desde las órdenes de producción que
 * del catálogo de modelos. Para poder buscar por cliente, número de modelo, tipo de prenda, fecha de
 * producción, maquilero, etc."*
 *
 * Son las 5,451 órdenes del sistema viejo — TODAS, incluidas las de las empresas que ya no existen
 * (§Post-F9.29: se rescataron colgadas de la empresa principal y la ficha dice de cuál eran). La
 * pantalla es de CONSULTA PURA: no hay «Nuevo», ni editar, ni desactivar — no porque falten, sino porque este
 * archivo no se toca. El número de orden abre el cajón con la ficha.
 *
 * Permiso: `ordenes.ver` (el backend es la autoridad, A1).
 */
export function ArchivoOrdenesPagina(): React.JSX.Element {
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const busqueda = useDebounce(textoBusqueda.trim(), 300);
  const [textoCliente, setTextoCliente] = useState('');
  const cliente = useDebounce(textoCliente.trim(), 300);
  const [textoMaquilero, setTextoMaquilero] = useState('');
  const maquilero = useDebounce(textoMaquilero.trim(), 300);
  const [idTipoProducto, setIdTipoProducto] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [incluirCanceladas, setIncluirCanceladas] = useState(true);
  const [pagina, setPagina] = useState(1);
  const [idAbierta, setIdAbierta] = useState<number | null>(null);

  const tipos = useTiposProductoActivos();

  const query: HistoricoOrdenesQuery = {
    pagina,
    porPagina: POR_PAGINA,
    ordenarPor: 'fecha',
    direccion: 'desc',
    incluirCanceladas: incluirCanceladas ? 'true' : 'false',
    ...(busqueda.length > 0 ? { busqueda } : {}),
    ...(cliente.length > 0 ? { cliente } : {}),
    ...(maquilero.length > 0 ? { maquilero } : {}),
    ...(idTipoProducto === '' ? {} : { idTipoProducto: Number(idTipoProducto) }),
    ...(desde === '' ? {} : { desde }),
    ...(hasta === '' ? {} : { hasta }),
  };

  const consulta = useHistoricoOrdenes(query);
  const detalle = useHistoricoOrden(idAbierta);

  /** Cualquier cambio de filtro vuelve a la página 1: si no, se cae en un vacío engañoso. */
  function cambiarFiltro(aplicar: () => void): void {
    aplicar();
    setPagina(1);
  }

  const datos = consulta.data;
  const totalPaginas = datos === undefined ? 0 : Math.ceil(datos.total / datos.porPagina);
  const paginacion: PaginacionCatalogo | undefined = datos
    ? {
        total: datos.total,
        pagina: datos.pagina,
        totalPaginas,
        ocupado: consulta.isFetching,
        alAnterior: () => setPagina((p) => Math.max(1, p - 1)),
        alSiguiente: () => setPagina((p) => Math.min(totalPaginas, p + 1)),
      }
    : undefined;

  const columnas: ColumnaCatalogo<HistoricoOrdenResumen>[] = [
    {
      encabezado: 'Orden',
      render: (o) => (
        <button
          type="button"
          className="font-semibold text-primary underline-offset-2 hover:underline"
          onClick={() => setIdAbierta(o.id)}
          data-testid="abrir-orden-historica"
        >
          {o.numero}
        </button>
      ),
    },
    { encabezado: 'Fecha', render: (o) => o.fecha ?? '—' },
    {
      encabezado: 'Modelo',
      render: (o) => (
        <span className="flex flex-col">
          <span className="font-medium">{o.modelo ?? '—'}</span>
          {o.descripcionModelo === null ? null : (
            <span className="text-xs text-muted-foreground">{o.descripcionModelo}</span>
          )}
        </span>
      ),
    },
    {
      encabezado: 'Tipo',
      render: (o) => <span className="text-muted-foreground">{o.tipoProducto ?? '—'}</span>,
    },
    { encabezado: 'Cliente', render: (o) => o.cliente ?? '—' },
    {
      // §Post-F9.27 — Daniel: *"es importante que vayan todos. Y no solo el primero."* Se muestran
      // los talleres de COSTURA (que es lo que se busca a diario); el corte y el estampado están en
      // la ficha. Si no hubo movimientos, se cae al asignado en la cabecera.
      encabezado: 'Talleres',
      render: (o) => (
        <span className="text-muted-foreground">{o.maquileros ?? o.maquilero ?? '—'}</span>
      ),
    },
    { encabezado: 'Piezas', numerica: true, render: (o) => o.totalPiezas.toLocaleString('es-MX') },
    {
      encabezado: '',
      render: (o) =>
        o.cancelada ? (
          <ChipEstado tono="crit" sinPunto>
            Cancelada
          </ChipEstado>
        ) : null,
    },
  ];

  const filtros = (
    <>
      <Field className="w-40">
        <FieldLabel htmlFor="hist-cliente">Cliente</FieldLabel>
        <Input
          id="hist-cliente"
          value={textoCliente}
          onChange={(e) => cambiarFiltro(() => setTextoCliente(e.target.value))}
          placeholder="Todos"
          data-testid="hist-cliente"
        />
      </Field>
      <Field className="w-40">
        <FieldLabel htmlFor="hist-maquilero">Taller</FieldLabel>
        <Input
          id="hist-maquilero"
          value={textoMaquilero}
          onChange={(e) => cambiarFiltro(() => setTextoMaquilero(e.target.value))}
          placeholder="Corte, costura o estampado"
          data-testid="hist-maquilero"
        />
      </Field>
      <Field className="w-44">
        <FieldLabel htmlFor="hist-tipo">Tipo de prenda</FieldLabel>
        <SelectNativo
          id="hist-tipo"
          value={idTipoProducto}
          onChange={(e) => cambiarFiltro(() => setIdTipoProducto(e.target.value))}
          data-testid="hist-tipo"
        >
          <option value="">Todos</option>
          {(tipos.data?.datos ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
            </option>
          ))}
        </SelectNativo>
      </Field>
      <Field className="w-36">
        <FieldLabel htmlFor="hist-desde">Desde</FieldLabel>
        <Input
          id="hist-desde"
          type="date"
          value={desde}
          onChange={(e) => cambiarFiltro(() => setDesde(e.target.value))}
          data-testid="hist-desde"
        />
      </Field>
      <Field className="w-36">
        <FieldLabel htmlFor="hist-hasta">Hasta</FieldLabel>
        <Input
          id="hist-hasta"
          type="date"
          value={hasta}
          onChange={(e) => cambiarFiltro(() => setHasta(e.target.value))}
          data-testid="hist-hasta"
        />
      </Field>
    </>
  );

  const d = detalle.data;

  return (
    <>
      <TablaCatalogo<HistoricoOrdenResumen>
        testid="orden-historica"
        titulo="Archivo de órdenes"
        descripcion="Producción del sistema anterior · solo consulta"
        unidad="órdenes"
        registros={datos?.datos ?? []}
        cargando={consulta.isPending}
        error={consulta.isError ? consulta.error.message : null}
        alReintentar={() => void consulta.refetch()}
        obtenerId={(o) => o.id}
        // El archivo no tiene borrado suave: todo renglón cuenta como "activo".
        obtenerActivo={() => true}
        ocultarEstado
        columnas={columnas}
        busqueda={textoBusqueda}
        alBuscar={(v) => cambiarFiltro(() => setTextoBusqueda(v))}
        filtros={filtros}
        // El toggle de la barra se reusa para las canceladas: es el mismo gesto de "mostrar todo".
        incluirInactivos={incluirCanceladas}
        alAlternarInactivos={() => cambiarFiltro(() => setIncluirCanceladas((v) => !v))}
        textoVacio="No hay órdenes que coincidan con la búsqueda."
        paginacion={paginacion}
        puedeAdministrar={false}
        textoNuevo=""
      />

      <CajonDetalle
        abierto={idAbierta !== null}
        alCambiarAbierto={(abierto) => {
          if (!abierto) setIdAbierta(null);
        }}
        titulo={d === undefined ? 'Orden histórica' : `Orden ${d.numero}`}
        subtitulo={
          d === undefined
            ? undefined
            : `${d.fecha ?? 'sin fecha'} · ${d.cliente ?? 'sin cliente'} · ${String(d.totalPiezas)} piezas`
        }
        ancho="amplio"
      >
        {detalle.isPending ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : d === undefined ? (
          <p className="text-sm text-muted-foreground">No se pudo cargar la orden.</p>
        ) : (
          <div className="space-y-6">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <Dato etiqueta="Modelo" valor={d.modelo} />
              <Dato etiqueta="Descripción" valor={d.descripcionModelo} />
              <Dato etiqueta="Tipo de prenda" valor={d.tipoProducto} />
              <Dato etiqueta="Género" valor={d.genero} />
              <Dato etiqueta="Marca" valor={d.etiquetaMarca} />
              <Dato etiqueta="Taller asignado" valor={d.maquilero} />
              <Dato etiqueta="Tela" valor={d.tela} />
              <Dato etiqueta="Composición" valor={d.composicion} />
              <Dato etiqueta="Entrega" valor={d.fechaEntrega} />
              {/* §Post-F9.29 — de qué empresa del sistema viejo era. Las de las 6 empresas que ya
                  no existen se rescataron colgadas de la empresa principal, así que este texto es
                  lo único que dice de quién eran. En la FICHA y no en el listado: solo importa al
                  mirar una orden concreta, y el listado ya lleva 8 columnas. Se busca desde la caja
                  de búsqueda libre. */}
              <Dato etiqueta="Empresa (Control viejo)" valor={d.empresaV1} />
            </dl>

            {d.cancelada ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <span className="font-medium">Orden cancelada.</span>{' '}
                {d.motivoCancelada ?? 'Sin motivo capturado.'}
              </p>
            ) : null}

            {/* §Post-F9.27 — TODOS los que la trabajaron, de un vistazo y sin abrir la tabla. */}
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <Dato etiqueta="Cortaron" valor={d.cortadores} />
              <Dato etiqueta="Cosieron" valor={d.maquileros} />
              <Dato etiqueta="Estamparon" valor={d.estampadores} />
            </dl>

            <section>
              <h3 className="mb-2 text-sm font-semibold">Colores y tallas</h3>
              {d.lineas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin detalle capturado.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="py-1 pr-4">Color</th>
                        <th className="py-1 pr-4">Talla</th>
                        <th className="py-1 text-right">Cantidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.lineas.map((l, i) => (
                        <tr key={`${l.color}-${l.talla}-${String(i)}`} className="border-t">
                          <td className="py-1 pr-4">{l.color}</td>
                          <td className="py-1 pr-4">{l.talla}</td>
                          <td className="py-1 text-right tabular-nums">{l.cantidad}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold">Quién la trabajó</h3>
              {d.procesos.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hay movimientos de producción registrados para esta orden.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="py-1 pr-4">Etapa</th>
                        <th className="py-1 pr-4">Fecha</th>
                        <th className="py-1 pr-4">Taller</th>
                        <th className="py-1 text-right">Cantidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.procesos.map((p, i) => (
                        <tr key={`${p.tipo}-${String(i)}`} className="border-t">
                          <td className="py-1 pr-4">{NOMBRE_PROCESO[p.tipo] ?? p.tipo}</td>
                          <td className="py-1 pr-4">{p.fecha ?? '—'}</td>
                          <td className="py-1 pr-4">{p.tercero ?? '—'}</td>
                          <td className="py-1 text-right tabular-nums">{p.cantidad}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {d.observaciones === null ? null : (
              <section>
                <h3 className="mb-1 text-sm font-semibold">Observaciones</h3>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {d.observaciones}
                </p>
              </section>
            )}

            <p className="text-xs text-muted-foreground">
              Orden {d.idOrdenV1} del sistema anterior. Este archivo es solo de consulta.
            </p>
          </div>
        )}
      </CajonDetalle>
    </>
  );
}

/** Un dato del encabezado del cajón (etiqueta arriba, valor abajo). */
function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | null }): React.JSX.Element {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className="font-medium">{valor ?? '—'}</dd>
    </div>
  );
}
