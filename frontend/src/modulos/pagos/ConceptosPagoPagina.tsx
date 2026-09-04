import { Plus, Star } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useConceptosPago,
  useCrearConceptoPago,
  useCrearCuentaConcepto,
  useEditarConceptoPago,
  useEditarCuentaConcepto,
} from '@/api/pagos';
import type { ConceptoPago } from '@/api/tipos';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNativo } from '@/components/ui/native-select';
import {
  TablaDensa,
  TablaDensaCelda,
  TablaDensaCuerpo,
  TablaDensaEncabezado,
  TablaDensaFila,
  TablaDensaHead,
} from '@/components/dominio/TablaDensa';
import { ChipEstado } from '@/components/dominio/ChipEstado';
import { useSesion } from '@/sesion/useSesion';

import { ETIQUETA_FORMA, ETIQUETA_RUBRO } from './comun';

/**
 * ⭐ CATÁLOGO DE CONCEPTOS DE PAGO QUE **NO** SON PROVEEDORES (fila 0.125; §Post-F9.189(c)).
 *
 * Daniel: *«quiero dejar pagos para cosas que no necesariamente están dadas de alta como proveedores
 * (nóminas por fuera, gratificaciones, pago de algún servicio como agua, o cualquier otra cosa)»* —
 * y *«que sean un catálogo aparte, no proveedores»*.
 *
 * ⭐ **`Predeterminado`** es lo que hace que no se le olvide: *«algunos … quiero que se carguen por
 * default en la relación … para que siempre se carguen EN CERO para que yo le ponga la cantidad»*.
 *
 * Las CUENTAS tienen la misma forma que las del proveedor (0.112): beneficiario, banco, CLABE o
 * tarjeta, alias, la marca fiscal y una por omisión. Cero lógica de negocio aquí (A1).
 */
export function ConceptosPagoPagina(): React.JSX.Element {
  const { tienePermiso } = useSesion();
  const puedeAdministrar = tienePermiso('conceptos-pago.administrar');

  const [busqueda, setBusqueda] = useState('');
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [abierto, setAbierto] = useState<number | null>(null);

  const consulta = useConceptosPago({
    pagina: 1,
    porPagina: 100,
    incluirInactivos,
    ...(busqueda.trim() === '' ? {} : { busqueda: busqueda.trim() }),
  });
  const conceptos = consulta.data?.datos ?? [];

  const crear = useCrearConceptoPago();
  const editar = useEditarConceptoPago();

  return (
    <div className="h-full overflow-y-auto space-y-6 p-4 md:p-6" data-testid="conceptos-pago">
      <header>
        <h1 className="text-[21px] leading-tight font-semibold tracking-tight">
          Conceptos de pago
        </h1>
        <p className="text-[12.5px] text-muted-foreground">
          Lo que se paga cada semana y no es un proveedor: nómina por fuera, servicios, caja chica.
          Los marcados como <strong>predeterminado</strong> se cargan solos, en cero, en cada
          corrida.
        </p>
      </header>

      {puedeAdministrar ? (
        <FormaNuevoConcepto
          guardando={crear.isPending}
          onCrear={(datos) =>
            crear.mutate(datos, {
              onSuccess: (c) => toast.success(`"${c.nombre}" dado de alta.`),
              onError: (e) => toast.error(e.message),
            })
          }
        />
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>El catálogo</CardTitle>
              <CardDescription>{String(consulta.data?.total ?? 0)} concepto(s).</CardDescription>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field className="w-56">
                <FieldLabel htmlFor="conceptos-buscar">Buscar</FieldLabel>
                <Input
                  id="conceptos-buscar"
                  className="h-9"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Nombre del concepto"
                  data-testid="conceptos-buscar"
                />
              </Field>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={incluirInactivos}
                  onChange={(e) => setIncluirInactivos(e.target.checked)}
                  data-testid="conceptos-inactivos"
                />
                Ver retirados
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {consulta.isPending ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : consulta.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {consulta.error.message}
            </p>
          ) : conceptos.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Todavía no hay conceptos. Da de alta el primero (caja chica, nómina por fuera…).
            </p>
          ) : (
            <div className="overflow-x-auto">
              <TablaDensa data-testid="conceptos-tabla">
                <TablaDensaEncabezado>
                  <TablaDensaFila>
                    <TablaDensaHead>Concepto</TablaDensaHead>
                    <TablaDensaHead>Rubro</TablaDensaHead>
                    <TablaDensaHead>Forma de pago</TablaDensaHead>
                    <TablaDensaHead>Cuentas</TablaDensaHead>
                    <TablaDensaHead>Estado</TablaDensaHead>
                    <TablaDensaHead />
                  </TablaDensaFila>
                </TablaDensaEncabezado>
                <TablaDensaCuerpo>
                  {conceptos.map((c) => (
                    <TablaDensaFila key={c.id} data-testid="conceptos-fila">
                      <TablaDensaCelda className="font-medium">
                        {c.predeterminado ? (
                          <Star
                            className="mr-1 inline size-3.5 text-ok"
                            aria-label="Se carga solo en cada corrida"
                          />
                        ) : null}
                        {c.nombre}
                      </TablaDensaCelda>
                      <TablaDensaCelda>{ETIQUETA_RUBRO[c.rubro] ?? c.rubro}</TablaDensaCelda>
                      <TablaDensaCelda>
                        {c.formaPagoPreferida === null
                          ? '—'
                          : (ETIQUETA_FORMA[c.formaPagoPreferida] ?? c.formaPagoPreferida)}
                      </TablaDensaCelda>
                      <TablaDensaCelda>{String(c.cuentas.length)}</TablaDensaCelda>
                      <TablaDensaCelda>
                        <ChipEstado tono={c.activo ? 'ok' : 'neutro'}>
                          {c.activo ? 'Activo' : 'Retirado'}
                        </ChipEstado>
                      </TablaDensaCelda>
                      <TablaDensaCelda>
                        {puedeAdministrar ? (
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setAbierto(abierto === c.id ? null : c.id)}
                              data-testid="conceptos-cuentas"
                            >
                              Cuentas
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={editar.isPending}
                              onClick={() =>
                                editar.mutate(
                                  { id: c.id, cuerpo: { predeterminado: !c.predeterminado } },
                                  { onError: (e) => toast.error(e.message) },
                                )
                              }
                              data-testid="conceptos-predeterminado"
                            >
                              {c.predeterminado ? 'Quitar de la corrida' : 'Cargar siempre'}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={editar.isPending}
                              onClick={() =>
                                editar.mutate(
                                  { id: c.id, cuerpo: { activo: !c.activo } },
                                  { onError: (e) => toast.error(e.message) },
                                )
                              }
                              data-testid="conceptos-retirar"
                            >
                              {c.activo ? 'Retirar' : 'Reactivar'}
                            </Button>
                          </div>
                        ) : null}
                      </TablaDensaCelda>
                    </TablaDensaFila>
                  ))}
                </TablaDensaCuerpo>
              </TablaDensa>
            </div>
          )}

          {abierto !== null && puedeAdministrar ? (
            <CuentasDelConcepto
              concepto={conceptos.find((c) => c.id === abierto) ?? null}
              onCerrar={() => setAbierto(null)}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

/** Alta de un concepto. Los rubros que se pueden elegir son los que NO derivan de un proveedor. */
function FormaNuevoConcepto({
  guardando,
  onCrear,
}: {
  guardando: boolean;
  onCrear: (datos: {
    nombre: string;
    rubro: 'nomina' | 'servicios' | 'caja_chica' | 'otros';
    formaPagoPreferida: 'efectivo' | 'transferencia' | null;
    predeterminado: boolean;
  }) => void;
}): React.JSX.Element {
  const [nombre, setNombre] = useState('');
  const [rubro, setRubro] = useState<'nomina' | 'servicios' | 'caja_chica' | 'otros'>('otros');
  const [forma, setForma] = useState<'' | 'efectivo' | 'transferencia'>('');
  const [predeterminado, setPredeterminado] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dar de alta un concepto</CardTitle>
        <CardDescription>El rubro decide en qué sección de la relación aparece.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end gap-3">
          <Field className="w-64">
            <FieldLabel htmlFor="concepto-nombre">Nombre</FieldLabel>
            <Input
              id="concepto-nombre"
              className="h-9"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="p. ej. Caja chica"
              data-testid="concepto-nombre"
            />
          </Field>
          <Field className="w-48">
            <FieldLabel htmlFor="concepto-rubro">Rubro</FieldLabel>
            <SelectNativo
              id="concepto-rubro"
              value={rubro}
              onChange={(e) =>
                setRubro(e.target.value as 'nomina' | 'servicios' | 'caja_chica' | 'otros')
              }
              data-testid="concepto-rubro"
            >
              <option value="nomina">Nómina por fuera</option>
              <option value="servicios">Servicios</option>
              <option value="caja_chica">Caja chica</option>
              <option value="otros">Otros</option>
            </SelectNativo>
          </Field>
          <Field className="w-48">
            <FieldLabel htmlFor="concepto-forma">Forma de pago</FieldLabel>
            <SelectNativo
              id="concepto-forma"
              value={forma}
              onChange={(e) => setForma(e.target.value as '' | 'efectivo' | 'transferencia')}
              data-testid="concepto-forma"
            >
              <option value="">Sin preferencia</option>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
            </SelectNativo>
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={predeterminado}
              onChange={(e) => setPredeterminado(e.target.checked)}
              data-testid="concepto-predeterminado"
            />
            Cargarlo siempre en la corrida (en cero)
          </label>
          <Button
            type="button"
            size="sm"
            disabled={guardando || nombre.trim() === ''}
            onClick={() => {
              onCrear({
                nombre: nombre.trim(),
                rubro,
                formaPagoPreferida: forma === '' ? null : forma,
                predeterminado,
              });
              setNombre('');
              setPredeterminado(false);
            }}
            data-testid="concepto-guardar"
          >
            <Plus className="size-4" /> Dar de alta
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Las cuentas de un concepto: misma forma que las del proveedor (0.112). */
function CuentasDelConcepto({
  concepto,
  onCerrar,
}: {
  concepto: ConceptoPago | null;
  onCerrar: () => void;
}): React.JSX.Element | null {
  const crear = useCrearCuentaConcepto();
  const editar = useEditarCuentaConcepto();
  const [beneficiario, setBeneficiario] = useState('');
  const [banco, setBanco] = useState('');
  const [tipoCuenta, setTipoCuenta] = useState<'clabe' | 'tarjeta'>('clabe');
  const [cuenta, setCuenta] = useState('');
  const [alias, setAlias] = useState('');
  const [esFiscal, setEsFiscal] = useState(false);

  if (concepto === null) {
    return null;
  }

  return (
    <div className="mt-4 rounded-md border p-3" data-testid="concepto-cuentas">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[14px] font-semibold">Cuentas de {concepto.nombre}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onCerrar}>
          Cerrar
        </Button>
      </div>

      {concepto.cuentas.length === 0 ? (
        <p className="mb-3 text-sm text-muted-foreground">
          Todavía no tiene cuentas: se le paga en efectivo.
        </p>
      ) : (
        <ul className="mb-3 space-y-1 text-sm">
          {concepto.cuentas.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <span className="font-medium">{c.beneficiario}</span>
              <span className="text-muted-foreground">
                {[c.banco, c.alias, `•••${c.cuenta.slice(-4)}`].filter((x) => x).join(' · ')}
              </span>
              {c.esFiscal ? <ChipEstado tono="info">Fiscal</ChipEstado> : null}
              {c.esDefault ? <ChipEstado tono="ok">Por omisión</ChipEstado> : null}
              {!c.esDefault ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={editar.isPending}
                  onClick={() =>
                    editar.mutate(
                      { id: concepto.id, idCuenta: c.id, cuerpo: { esDefault: true } },
                      { onError: (e) => toast.error(e.message) },
                    )
                  }
                >
                  Dejar por omisión
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-3 border-t pt-3">
        <Field className="w-56">
          <FieldLabel htmlFor="cuenta-beneficiario">Beneficiario</FieldLabel>
          <Input
            id="cuenta-beneficiario"
            className="h-9"
            value={beneficiario}
            onChange={(e) => setBeneficiario(e.target.value)}
            placeholder="A nombre de quién va el depósito"
            data-testid="cuenta-beneficiario"
          />
        </Field>
        <Field className="w-40">
          <FieldLabel htmlFor="cuenta-banco">Banco</FieldLabel>
          <Input
            id="cuenta-banco"
            className="h-9"
            value={banco}
            onChange={(e) => setBanco(e.target.value)}
          />
        </Field>
        <Field className="w-36">
          <FieldLabel htmlFor="cuenta-tipo">Tipo</FieldLabel>
          <SelectNativo
            id="cuenta-tipo"
            value={tipoCuenta}
            onChange={(e) => setTipoCuenta(e.target.value as 'clabe' | 'tarjeta')}
          >
            <option value="clabe">CLABE</option>
            <option value="tarjeta">Tarjeta</option>
          </SelectNativo>
        </Field>
        <Field className="w-56">
          <FieldLabel htmlFor="cuenta-numero">Número</FieldLabel>
          <Input
            id="cuenta-numero"
            className="h-9"
            value={cuenta}
            onChange={(e) => setCuenta(e.target.value)}
            data-testid="cuenta-numero"
          />
        </Field>
        <Field className="w-28">
          <FieldLabel htmlFor="cuenta-alias">Alias</FieldLabel>
          <Input
            id="cuenta-alias"
            className="h-9"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={esFiscal}
            onChange={(e) => setEsFiscal(e.target.checked)}
            data-testid="cuenta-fiscal"
          />
          Es la cuenta fiscal
        </label>
        <Button
          type="button"
          size="sm"
          disabled={crear.isPending || beneficiario.trim() === '' || cuenta.trim() === ''}
          onClick={() =>
            crear.mutate(
              {
                id: concepto.id,
                cuerpo: {
                  beneficiario: beneficiario.trim(),
                  banco: banco.trim(),
                  tipoCuenta,
                  cuenta: cuenta.trim(),
                  alias: alias.trim(),
                  esFiscal,
                },
              },
              {
                onSuccess: () => {
                  setBeneficiario('');
                  setBanco('');
                  setCuenta('');
                  setAlias('');
                  setEsFiscal(false);
                  toast.success('Cuenta agregada.');
                },
                onError: (e) => toast.error(e.message),
              },
            )
          }
          data-testid="cuenta-guardar"
        >
          <Plus className="size-4" /> Agregar cuenta
        </Button>
      </div>
    </div>
  );
}
