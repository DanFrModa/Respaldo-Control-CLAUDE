import { Loader2Icon, SparklesIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useTiposProductoActivos } from '@/api/calidad';
import { useCliente } from '@/api/clientes';
import {
  useAgregarLineasLista,
  useCandidatosLista,
  useCrearModeloEnLista,
  type DescartadoLista,
  type ModeloNuevoCreado,
} from '@/api/listas-precios';
import { useGeneros } from '@/api/modelos';
import { useProyectos } from '@/api/proyectos';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import { formatearMoneda } from '@/lib/formato';
import { SelectorModelo } from '@/modulos/inventarios/SelectorModelo';

import { agruparDescartados, etiquetaDescartado } from './motivos-candidatura';

/** Valor del selector de proyecto que significa «crear uno nuevo con este nombre». */
const PROYECTO_NUEVO = 'nuevo';

/**
 * Cuántos descartados se enumeran por motivo antes de resumir con «…y otros X».
 *
 * ⚠️ **No es cosmética.** La cubeta `ya-en-lista` es *«todo lo que alguna vez se le cotizó a este
 * cliente»* y **crece monótonamente** (lo dice el propio `diagnosticoCandidatosLista`): sin tope,
 * un cliente con 200 desarrollos colocados pinta 200 renglones dentro del diálogo. El conteo
 * completo sigue a la vista en el título del grupo, que es el dato que importa.
 */
const TOPE_DESCARTADOS = 8;

/** Lo que la mesa sabe de su lista (lo trae el detalle que ya está en pantalla). */
export interface MesaDeLaLista {
  id: number;
  idCliente: number;
  idClienteDepartamento: number;
  nombreCliente: string;
  nombreDepartamento: string;
}

/**
 * ⭐⭐ V1-E8y (§Post-F9.152) — **AGREGAR MODELOS A LA LISTA QUE SE ESTÁ NEGOCIANDO**, por los dos
 * caminos que pidió Daniel:
 *
 *  • **«Ya cotizados»** — modelos del mismo cliente+departamento con su precosto congelado. Hasta
 *    esta etapa una lista nacía con sus modelos y **no admitía ni uno más**.
 *  • **«Modelo nuevo»** — *«a veces estando en la cita, me piden cotizar algún modelo que no
 *    tengamos en muestrario… Necesito armarlo desde cero estimando cosas. O bien podría copiar
 *    algún modelo de los que ya tenemos desarrollados y cambiarle cosas.»*
 *
 * ⚠️ **El modelo nuevo NO entra a la lista de inmediato, y la pantalla lo dice.** Un renglón necesita
 * un precosto CONGELADO, y uno recién nacido desde cero todavía no tiene nada costeado. Así que el
 * alta devuelve el desarrollo con su **precosto borrador** y la mesa lleva a estimarlo; cuando se
 * congela, se agrega desde la pestaña de al lado. Son dos actos visibles en vez de uno que a veces
 * funciona.
 *
 * ⚠️ **Se MONTA sólo mientras está abierto** (la página lo renderiza condicionalmente), y por eso no
 * lleva un efecto que limpie el formulario al cerrar: el estado muere con el componente. La razón no es
 * de estilo — este diálogo dispara **cinco consultas** (candidatos, cliente, tipos, géneros y proyectos)
 * y `useProyectos` no admite `enabled`, así que montado siempre las pagaría **cada vez que se abre una
 * lista**, incluso sin tocar el botón. El diagnóstico de candidatos, además, **crece monótonamente** por
 * cliente (nota de `diagnosticoCandidatosLista`): es justo la consulta que no conviene disparar de más.
 *
 * ⚠️ **La ABREVIATURA del cliente se comprueba ANTES de teclear nada.** Sin ella el código
 * (`CYA-26-71-001`) no se puede armar y el servidor rechaza el alta — en plena cita, después de
 * llenar el formulario. Aquí se avisa arriba y se apaga el botón: el error existe igual en el
 * servidor (A1), pero no se llega a él con el cliente enfrente.
 */
export function DialogoAgregarModelos({
  abierto,
  alCambiarAbierto,
  mesa,
  alCrearModeloNuevo,
}: {
  abierto: boolean;
  alCambiarAbierto: (abierto: boolean) => void;
  mesa: MesaDeLaLista;
  /** Se llama con el modelo recién creado, para que la página ofrezca costearlo. */
  alCrearModeloNuevo: (creado: ModeloNuevoCreado) => void;
}): React.JSX.Element {
  const [modo, setModo] = useState<'cotizados' | 'nuevo'>('cotizados');

  // ── Pestaña «ya cotizados» ────────────────────────────────────────────────
  const candidatos = useCandidatosLista(mesa.idCliente, mesa.idClienteDepartamento);
  const agregar = useAgregarLineasLista();
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());

  // ── Pestaña «modelo nuevo» ────────────────────────────────────────────────
  const cliente = useCliente(mesa.idCliente);
  const tipos = useTiposProductoActivos();
  const generos = useGeneros();
  const proyectos = useProyectos({
    pagina: 1,
    porPagina: 50,
    idCliente: mesa.idCliente,
    idClienteDepartamento: mesa.idClienteDepartamento,
    ordenarPor: 'folio',
    direccion: 'desc',
  });
  const crearModelo = useCrearModeloEnLista();

  const [copiar, setCopiar] = useState(false);
  const [idModeloOrigen, setIdModeloOrigen] = useState<number | undefined>(undefined);
  const [anio, setAnio] = useState(String(new Date().getFullYear()));
  const [idTipo, setIdTipo] = useState('');
  const [idGenero, setIdGenero] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [numeroCliente, setNumeroCliente] = useState('');
  const [idProyecto, setIdProyecto] = useState('');
  const [nombreProyecto, setNombreProyecto] = useState('');
  const [error, setError] = useState<string | null>(null);

  const listaCandidatos = candidatos.data?.datos ?? [];
  const descartados = candidatos.data?.descartados ?? [];
  const proyectosVivos = (proyectos.data?.datos ?? []).filter((p) => !p.archivado);
  // ⭐ La comprobación que evita que truene enfrente del cliente (ver el encabezado).
  // ⚠️ Se compara contra la CADENA VACÍA además del null: el dominio rechaza las dos
  // (`nomenclatura.ts`, «no tiene ABREVIATURA capturada»). Hoy la columna nunca guarda '' —el Zod
  // del alta exige 3 letras—, pero depender de esa invariante para que el aviso aparezca sale
  // gratis evitarlo, y el día que alguien la afloje la pantalla no se queda callada.
  const faltaAbreviatura =
    cliente.data !== undefined && (cliente.data.abreviatura ?? '').trim() === '';

  function alternar(id: number): void {
    setSeleccion((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });
  }

  function agregarSeleccionados(): void {
    agregar.mutate(
      { id: mesa.id, cuerpo: { idsDesarrollo: [...seleccion] } },
      {
        onSuccess: () => {
          toast.success(
            seleccion.size === 1
              ? 'Modelo agregado a la lista.'
              : `${String(seleccion.size)} modelos agregados a la lista.`,
          );
          alCambiarAbierto(false);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  function crear(): void {
    if (copiar && idModeloOrigen === undefined) {
      setError('Elige el modelo del que se copia.');
      return;
    }
    if (!copiar && (idTipo === '' || idGenero === '')) {
      setError(
        'Desde cero hacen falta el tipo de prenda y el género (dan los dos dígitos del código).',
      );
      return;
    }
    if (idProyecto === '') {
      setError('Elige el proyecto donde nace el modelo (o crea uno nuevo).');
      return;
    }
    if (idProyecto === PROYECTO_NUEVO && nombreProyecto.trim() === '') {
      setError('Escribe el nombre del proyecto nuevo.');
      return;
    }
    setError(null);
    crearModelo.mutate(
      {
        id: mesa.id,
        cuerpo: {
          anioEntrega: Number.parseInt(anio, 10),
          ...(copiar && idModeloOrigen !== undefined ? { idModeloOrigen } : {}),
          ...(idTipo === '' ? {} : { idTipoProducto: Number.parseInt(idTipo, 10) }),
          ...(idGenero === '' ? {} : { idGenero: Number.parseInt(idGenero, 10) }),
          ...(descripcion.trim() === '' ? {} : { descripcion: descripcion.trim() }),
          ...(numeroCliente.trim() === '' ? {} : { numeroCliente: numeroCliente.trim() }),
          ...(idProyecto === PROYECTO_NUEVO
            ? { nombreProyectoNuevo: nombreProyecto.trim() }
            : { idProyecto: Number.parseInt(idProyecto, 10) }),
        },
      },
      {
        onSuccess: (creado) => {
          toast.success(`Modelo ${creado.codigoModelo} creado. Ahora ponle sus costos estimados.`);
          alCambiarAbierto(false);
          alCrearModeloNuevo(creado);
        },
        onError: (e) => setError(e.message),
      },
    );
  }

  const ocupado = agregar.isPending || crearModelo.isPending;

  return (
    <Dialog open={abierto} onOpenChange={alCambiarAbierto}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Agregar modelos a la lista</DialogTitle>
          <DialogDescription>
            {mesa.nombreCliente} / {mesa.nombreDepartamento}. Mete los que ya están cotizados, o
            crea aquí mismo uno que no exista todavía.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2" role="tablist" data-testid="modo-agregar">
          <Button
            type="button"
            role="tab"
            aria-selected={modo === 'cotizados'}
            variant={modo === 'cotizados' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setModo('cotizados')}
            data-testid="modo-cotizados"
          >
            Ya cotizados
          </Button>
          <Button
            type="button"
            role="tab"
            aria-selected={modo === 'nuevo'}
            variant={modo === 'nuevo' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setModo('nuevo')}
            data-testid="modo-modelo-nuevo"
          >
            <SparklesIcon aria-hidden />
            Modelo nuevo
          </Button>
        </div>

        {modo === 'cotizados' ? (
          <div className="space-y-2" data-testid="panel-cotizados">
            {candidatos.isPending ? (
              <p className="text-sm text-muted-foreground">Cargando modelos…</p>
            ) : listaCandidatos.length === 0 ? (
              <SinCandidatosParaAgregar descartados={descartados} />
            ) : (
              <ul className="space-y-1.5">
                {listaCandidatos.map((c) => (
                  <li
                    key={c.idDesarrollo}
                    className="flex items-center gap-2 rounded-lg border p-2"
                    data-testid="fila-candidato-agregar"
                  >
                    <input
                      type="checkbox"
                      id={`agregar-${String(c.idDesarrollo)}`}
                      checked={seleccion.has(c.idDesarrollo)}
                      onChange={() => alternar(c.idDesarrollo)}
                      className="size-4 accent-primary"
                    />
                    <label htmlFor={`agregar-${String(c.idDesarrollo)}`} className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {c.codigoModelo}
                        {c.numeroCliente === null ? '' : ` · ${c.numeroCliente}`}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Proyecto #{c.folioProyecto} · v{c.versionPrecosto}
                        {c.costoTotal === null ? '' : ` · costo ${formatearMoneda(c.costoTotal)}`}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-3" data-testid="panel-modelo-nuevo">
            {faltaAbreviatura ? (
              <p
                className="rounded-lg border border-warn/40 bg-warn-soft p-3 text-sm"
                role="status"
                data-testid="aviso-sin-abreviatura"
              >
                <b>{mesa.nombreCliente}</b> no tiene <b>abreviatura</b> capturada, y de ella sale el
                código del modelo (el «CYA» de CYA-26-71-001). Captúrala en su ficha y vuelve: sin
                ella no se puede dar de alta un modelo para este cliente.
              </p>
            ) : null}

            <Field orientation="horizontal">
              <input
                id="agregar-copiar"
                type="checkbox"
                className="size-4 rounded border-input accent-primary"
                checked={copiar}
                disabled={ocupado}
                onChange={(e) => {
                  setCopiar(e.target.checked);
                  if (!e.target.checked) setIdModeloOrigen(undefined);
                }}
                data-testid="agregar-copiar"
              />
              <FieldLabel htmlFor="agregar-copiar" className="font-normal">
                Copiar un modelo que ya tenemos (se lleva su receta y sus costos)
              </FieldLabel>
            </Field>

            {copiar ? (
              <Field>
                <FieldLabel htmlFor="agregar-modelo-origen">Modelo a copiar</FieldLabel>
                <SelectorModelo
                  idInput="agregar-modelo-origen"
                  idSeleccionado={idModeloOrigen}
                  alSeleccionar={(m) => setIdModeloOrigen(m.id)}
                  alLimpiar={() => setIdModeloOrigen(undefined)}
                  testid="agregar-selector-modelo"
                />
                <FieldDescription>
                  Se copian la receta (telas, avíos, arte) y la ficha de costos (maquila, corte,
                  operaciones, composición). El modelo original NO se toca.
                </FieldDescription>
              </Field>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="agregar-tipo" required={!copiar}>
                  Tipo de prenda
                </FieldLabel>
                <SelectNativo
                  id="agregar-tipo"
                  value={idTipo}
                  disabled={ocupado}
                  onChange={(e) => setIdTipo(e.target.value)}
                  data-testid="agregar-tipo"
                >
                  <option value="">{copiar ? '(se hereda del copiado)' : 'Elige…'}</option>
                  {(tipos.data?.datos ?? []).map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.nombre}
                    </option>
                  ))}
                </SelectNativo>
                <FieldDescription>Da el 1er dígito del código.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="agregar-genero" required={!copiar}>
                  Género
                </FieldLabel>
                <SelectNativo
                  id="agregar-genero"
                  value={idGenero}
                  disabled={ocupado}
                  onChange={(e) => setIdGenero(e.target.value)}
                  data-testid="agregar-genero"
                >
                  <option value="">{copiar ? '(se hereda del copiado)' : 'Elige…'}</option>
                  {(generos.data ?? []).map((g) => (
                    <option key={g.id} value={String(g.id)}>
                      {g.nombre}
                    </option>
                  ))}
                </SelectNativo>
                <FieldDescription>Da el 2º dígito del código.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="agregar-anio" required>
                  Año de entrega
                </FieldLabel>
                <Input
                  id="agregar-anio"
                  inputMode="numeric"
                  maxLength={4}
                  className="mono w-28"
                  value={anio}
                  disabled={ocupado}
                  onChange={(e) => setAnio(e.target.value)}
                  data-testid="agregar-anio"
                />
                <FieldDescription>Se congela en el código.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="agregar-numero-cliente">Número del cliente</FieldLabel>
                <Input
                  id="agregar-numero-cliente"
                  value={numeroCliente}
                  disabled={ocupado}
                  onChange={(e) => setNumeroCliente(e.target.value)}
                  data-testid="agregar-numero-cliente"
                />
                <FieldDescription>El que le da el cliente, si lo trae.</FieldDescription>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="agregar-descripcion">Descripción</FieldLabel>
              <Input
                id="agregar-descripcion"
                placeholder="Ej. Sudadera con jareta"
                value={descripcion}
                disabled={ocupado}
                onChange={(e) => setDescripcion(e.target.value)}
                data-testid="agregar-descripcion"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="agregar-proyecto" required>
                Proyecto
              </FieldLabel>
              <SelectNativo
                id="agregar-proyecto"
                value={idProyecto}
                disabled={ocupado}
                onChange={(e) => setIdProyecto(e.target.value)}
                data-testid="agregar-proyecto"
              >
                <option value="">Elige…</option>
                {proyectosVivos.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    #{p.folio} · {p.nombre}
                  </option>
                ))}
                <option value={PROYECTO_NUEVO}>➕ Proyecto nuevo…</option>
              </SelectNativo>
              <FieldDescription>
                Todo modelo vive en un proyecto de este cliente y departamento. Si no hay uno que
                sirva, se crea aquí mismo (en la misma operación).
              </FieldDescription>
            </Field>

            {idProyecto === PROYECTO_NUEVO ? (
              <Field>
                <FieldLabel htmlFor="agregar-proyecto-nombre" required>
                  Nombre del proyecto nuevo
                </FieldLabel>
                <Input
                  id="agregar-proyecto-nombre"
                  placeholder="Ej. Cita septiembre"
                  value={nombreProyecto}
                  disabled={ocupado}
                  onChange={(e) => setNombreProyecto(e.target.value)}
                  data-testid="agregar-proyecto-nombre"
                />
              </Field>
            ) : null}

            <FieldError errors={error === null ? [] : [{ message: error }]} />

            <p className="text-xs text-muted-foreground">
              Se crea el modelo con su <b>precosto en borrador</b>. Todavía no entra a la lista:
              primero se le ponen los costos estimados y se congela: entonces se agrega desde «Ya
              cotizados».
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => alCambiarAbierto(false)}
            disabled={ocupado}
          >
            Cancelar
          </Button>
          {modo === 'cotizados' ? (
            <Button
              type="button"
              onClick={agregarSeleccionados}
              disabled={ocupado || seleccion.size === 0}
              data-testid="confirmar-agregar-lineas"
            >
              {agregar.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Agregar ({seleccion.size})
            </Button>
          ) : (
            <Button
              type="button"
              onClick={crear}
              disabled={ocupado || faltaAbreviatura}
              data-testid="confirmar-modelo-nuevo"
            >
              {crearModelo.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
              Crear y costear
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Cero candidatos para AGREGAR: se dice por qué, modelo por modelo, con el mismo criterio del
 * diálogo de crear la lista (`motivos-candidatura.ts`, §Post-F9.128). Sin esto el usuario ve un
 * hueco y no sabe si le falta congelar un precosto o si de plano no hay modelos.
 */
function SinCandidatosParaAgregar({
  descartados,
}: {
  descartados: readonly DescartadoLista[];
}): React.JSX.Element {
  if (descartados.length === 0) {
    return (
      <p
        className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground"
        data-testid="sin-candidatos-agregar"
      >
        Este cliente y departamento no tienen más modelos cotizados. Crea uno en «Modelo nuevo», o
        congela el precosto del que quieras meter.
      </p>
    );
  }
  return (
    <div
      className="space-y-2.5 rounded-lg border border-dashed p-3"
      data-testid="sin-candidatos-agregar"
    >
      <p className="text-sm">
        Ningún modelo más puede entrar a esta lista ahora mismo. Esto es lo que le falta a cada uno:
      </p>
      {agruparDescartados(descartados).map((g) => (
        <div key={g.motivo} data-testid={`motivo-agregar-${g.motivo}`}>
          <p className="text-sm font-medium">
            {g.titulo} ({g.modelos.length})
          </p>
          <ul className="mt-0.5 ml-4 list-disc text-sm text-muted-foreground">
            {g.modelos.slice(0, TOPE_DESCARTADOS).map((d) => (
              <li key={d.idDesarrollo}>{etiquetaDescartado(d)}</li>
            ))}
          </ul>
          {g.modelos.length > TOPE_DESCARTADOS ? (
            <p
              className="mt-0.5 ml-4 text-xs text-muted-foreground"
              data-testid="descartados-de-mas"
            >
              …y otros {g.modelos.length - TOPE_DESCARTADOS}.
            </p>
          ) : null}
          <p className="mt-0.5 text-xs text-muted-foreground">{g.remedio}</p>
        </div>
      ))}
    </div>
  );
}
