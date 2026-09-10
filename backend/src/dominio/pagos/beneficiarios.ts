/**
 * QUIÉN PUEDE COBRAR EN UNA CORRIDA (fila 0.113): el universo de beneficiarios y sus cuentas.
 *
 * Tres tipos, y los tres caben en la MISMA relación (§Post-F9.189(e): *«misma relación pero separada
 * por rubro. Así como mi archivo de Excel»*):
 *
 *  • **maquileros** — el monto nace de una ORDEN (EsMa). Referencia: saldo + lo que espera revisión
 *    + lo recibido esta semana.
 *  • **proveedores** (transportistas y demás) — el monto nace de un ESTADO DE CUENTA (CxP).
 *    Referencia: saldo + vencido.
 *  • **conceptos del catálogo** (0.125) — nómina por fuera, servicios, caja chica. Sin referencia:
 *    nacen en cero.
 *
 * ⚠️ La referencia NUNCA es el número que se paga. Daniel: *«yo voy decidiendo los montos a pagar de
 * cada uno. Manualmente.»*
 */
import { Prisma, type PrismaClient } from '../../datos/index.js';
import type {
  CuentaDestinoSalida,
  FormaDePagoClave,
  RubroPagoClave,
} from '../../contrato/index.js';

import type { Tx } from '../../comun/transaccion.js';
import { ROLES_MAQUILA_ESMA } from '../esma/maquileros.js';

/** Una cuenta destino tal como la necesita la pantalla y el congelado del renglón. */
export interface CuentaElegible {
  id: number;
  beneficiario: string;
  banco: string | null;
  tipoCuenta: 'clabe' | 'tarjeta';
  /** El número COMPLETO (sólo dígitos): la pantalla enseña 4, la relación ejecutable los usa todos. */
  cuenta: string;
  alias: string | null;
  esFiscal: boolean;
  esDefault: boolean;
}

/** Los últimos 4 dígitos de una cuenta (lo único que la pantalla necesita para distinguirlas). */
export function ultimos4(cuenta: string): string {
  return cuenta.slice(-4);
}

/** Proyecta una cuenta elegible al contrato (SIN el número completo). */
export function proyectarCuentaDestino(c: CuentaElegible): CuentaDestinoSalida {
  return {
    id: c.id,
    beneficiario: c.beneficiario,
    banco: c.banco,
    tipoCuenta: c.tipoCuenta,
    ultimos4: ultimos4(c.cuenta),
    alias: c.alias,
    esFiscal: c.esFiscal,
    esDefault: c.esDefault,
  };
}

/**
 * ⭐ LA FORMA DE PAGO SUGERIDA de un beneficiario (§Post-F9.189(c)).
 *
 * Daniel: *«podemos dejarlo como default de cada proveedor, pero con opción a cambiarlo — de pronto
 * un maquilero me pide que le pague una semana en efectivo»*. O sea: la preferencia guardada MANDA
 * sobre la deducción, y el renglón manda sobre las dos.
 *
 * Sin preferencia guardada se deduce de la realidad: **con cuenta activa ⇒ transferencia; sin
 * cuenta ⇒ efectivo** (y ahí el beneficiario es el proveedor mismo). Es una sugerencia, no una
 * regla: el renglón la cambia siempre.
 */
export function formaPagoSugerida(
  preferida: FormaDePagoClave | null,
  tieneCuentas: boolean,
): FormaDePagoClave {
  if (preferida !== null) {
    return preferida;
  }
  return tieneCuentas ? 'transferencia' : 'efectivo';
}

/**
 * El RUBRO de un proveedor: `maquila` si presta algún servicio de maquila, `proveedores` si no.
 *
 * Es la frontera que corrigió Daniel (§Post-F9.185(b)): *«corte es parte de maquilas, no de
 * proveedores … transportistas y demás proveedores sí salen del estado de cuenta»*. Se DERIVA de
 * sus roles y se COPIA al renglón: los roles cambian, y una corrida cerrada no puede cambiar de
 * forma después.
 */
export function rubroDeProveedor(codigosDeRol: readonly string[]): RubroPagoClave {
  const maquila = new Set<string>(ROLES_MAQUILA_ESMA);
  return codigosDeRol.some((c) => maquila.has(c)) ? 'maquila' : 'proveedores';
}

/** Datos de un proveedor que la corrida necesita para armar (o congelar) un renglón. */
export interface ProveedorParaPago {
  id: number;
  nombre: string;
  nombreCorto: string | null;
  activo: boolean;
  rubro: RubroPagoClave;
  formaPagoPreferida: FormaDePagoClave | null;
  modalidadFacturacion: 'solo_con' | 'solo_sin' | 'ambos' | null;
  cuentas: CuentaElegible[];
}

/** Fila cruda del rol (se agrega en memoria: son pocos roles por proveedor). */
interface FilaRol {
  idProveedor: number;
  codigo: string;
}

/**
 * Trae, para los proveedores pedidos, lo que la corrida necesita: nombre, rubro (por sus roles),
 * preferencia de pago, modalidad de facturación y sus CUENTAS ACTIVAS.
 *
 * En DOS consultas y nunca N+1 (Daniel tiene ~150 beneficiarios: una consulta por cada uno haría
 * inusable la pantalla más importante del sistema). Con la lista vacía no consulta nada.
 */
export async function proveedoresParaPago(
  cliente: Tx | PrismaClient,
  ids: readonly number[],
): Promise<Map<number, ProveedorParaPago>> {
  const mapa = new Map<number, ProveedorParaPago>();
  if (ids.length === 0) {
    return mapa;
  }

  const proveedores = await cliente.proveedor.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true,
      nombre: true,
      nombreCorto: true,
      activo: true,
      formaPagoPreferida: true,
      modalidadFacturacion: true,
      cuentasPago: {
        where: { activo: true },
        orderBy: [
          { esDefault: { sort: 'desc', nulls: 'last' } },
          { id: 'asc' },
        ] satisfies Prisma.ProveedorCuentaPagoOrderByWithRelationInput[],
        select: {
          id: true,
          beneficiario: true,
          banco: true,
          tipoCuenta: true,
          cuenta: true,
          alias: true,
          esFiscal: true,
          esDefault: true,
        },
      },
    },
  });

  // Los roles en UNA consulta aparte (el `include` anidado de N:N traería una fila por rol y
  // multiplicaría las cuentas): se agregan aquí.
  const roles = await cliente.$queryRaw<FilaRol[]>(Prisma.sql`
    SELECT pr."id_proveedor" AS "idProveedor", rp."codigo" AS "codigo"
    FROM "proveedor_rol" pr
    JOIN "roles_proveedor" rp ON rp."id" = pr."id_rol_proveedor"
    WHERE pr."id_proveedor" IN (${Prisma.join([...ids])})
  `);
  const rolesPorProveedor = new Map<number, string[]>();
  for (const r of roles) {
    const lista = rolesPorProveedor.get(r.idProveedor);
    if (lista === undefined) {
      rolesPorProveedor.set(r.idProveedor, [r.codigo]);
    } else {
      lista.push(r.codigo);
    }
  }

  for (const p of proveedores) {
    mapa.set(p.id, {
      id: p.id,
      nombre: p.nombre,
      nombreCorto: p.nombreCorto,
      activo: p.activo,
      rubro: rubroDeProveedor(rolesPorProveedor.get(p.id) ?? []),
      formaPagoPreferida: p.formaPagoPreferida,
      modalidadFacturacion: p.modalidadFacturacion,
      cuentas: p.cuentasPago.map((c) => ({
        id: c.id,
        beneficiario: c.beneficiario,
        banco: c.banco,
        tipoCuenta: c.tipoCuenta,
        cuenta: c.cuenta,
        alias: c.alias,
        esFiscal: c.esFiscal,
        esDefault: c.esDefault === true,
      })),
    });
  }
  return mapa;
}

/** Datos de un concepto del catálogo que la corrida necesita. */
export interface ConceptoParaPago {
  id: number;
  nombre: string;
  activo: boolean;
  rubro: RubroPagoClave;
  formaPagoPreferida: FormaDePagoClave | null;
  cuentas: CuentaElegible[];
}

/**
 * Trae los conceptos pedidos con sus cuentas activas (una sola consulta). Con `soloPredeterminados`
 * trae los que se cargan solos en cada corrida nueva (*«caja chica, nómina por fuera … no quiero
 * que se me vaya a olvidar»*); con `ids`, exactamente ésos.
 */
export async function conceptosParaPago(
  cliente: Tx | PrismaClient,
  filtro: { ids?: readonly number[]; soloPredeterminados?: boolean },
): Promise<Map<number, ConceptoParaPago>> {
  const mapa = new Map<number, ConceptoParaPago>();
  const where: Prisma.ConceptoPagoWhereInput = {
    ...(filtro.ids === undefined ? {} : { id: { in: [...filtro.ids] } }),
    ...(filtro.soloPredeterminados === true ? { predeterminado: true, activo: true } : {}),
  };
  if (filtro.ids !== undefined && filtro.ids.length === 0) {
    return mapa;
  }

  const conceptos = await cliente.conceptoPago.findMany({
    where,
    orderBy: [{ rubro: 'asc' }, { nombre: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      nombre: true,
      activo: true,
      rubro: true,
      formaPagoPreferida: true,
      cuentas: {
        where: { activo: true },
        orderBy: [
          { esDefault: { sort: 'desc', nulls: 'last' } },
          { id: 'asc' },
        ] satisfies Prisma.ConceptoPagoCuentaOrderByWithRelationInput[],
        select: {
          id: true,
          beneficiario: true,
          banco: true,
          tipoCuenta: true,
          cuenta: true,
          alias: true,
          esFiscal: true,
          esDefault: true,
        },
      },
    },
  });

  for (const c of conceptos) {
    mapa.set(c.id, {
      id: c.id,
      nombre: c.nombre,
      activo: c.activo,
      rubro: c.rubro,
      formaPagoPreferida: c.formaPagoPreferida,
      cuentas: c.cuentas.map((cu) => ({
        id: cu.id,
        beneficiario: cu.beneficiario,
        banco: cu.banco,
        tipoCuenta: cu.tipoCuenta,
        cuenta: cu.cuenta,
        alias: cu.alias,
        esFiscal: cu.esFiscal,
        esDefault: cu.esDefault === true,
      })),
    });
  }
  return mapa;
}

/** Lo recibido de un maquilero en la semana (referencia de la sección de maquileros). */
export interface RecibosDeLaSemana {
  cantidad: number;
  importe: number;
}

/** Fila cruda del agregado de recibos de la semana. */
interface FilaRecibos {
  idTercero: number;
  cantidad: number;
  importe: Prisma.Decimal;
}

/**
 * ⭐ LO RECIBIDO ESTA SEMANA por maquilero, valuado a `precioPactado` — la referencia que Daniel
 * mira al lado del campo de captura (§Post-F9.185(f): *«ver la lista de maquileros que entregaron
 * esa semana … validar él lo que realmente se paga»*).
 *
 * UN agregado sobre `EtapaMovimiento` (los recibos vivos de F3), NUNCA N+1. **No es dinero de EsMa**
 * —no toca `esma_cargo` ni los movimientos planos—: es cuánto entregó, para que él decida.
 *
 * ⚠️ Las fechas se comparan con un cast EXPLÍCITO a `date` y no pasando un `Date` de JS: la columna
 * es `@db.Date` y un parámetro `timestamptz` obligaría a Postgres a convertir la columna, metiendo
 * el corrimiento de zona horaria justo en el corte de la semana — un recibo del lunes acabaría
 * contado en la semana anterior.
 *
 * ⚠️ Los recibos con `precio_pactado` NULL suman CANTIDAD pero no importe: es lo honesto (sin precio
 * no hay importe que enseñar) y evita inventar un número al lado de una decisión de dinero.
 */
export async function recibosDeLaSemanaPorMaquilero(
  cliente: Tx | PrismaClient,
  idEmpresa: number,
  desde: string,
  hasta: string,
): Promise<Map<number, RecibosDeLaSemana>> {
  const filas = await cliente.$queryRaw<FilaRecibos[]>(Prisma.sql`
    SELECT
      e."id_tercero" AS "idTercero",
      COALESCE(SUM(d."cantidad"), 0)::int AS "cantidad",
      COALESCE(SUM(d."cantidad" * e."precio_pactado"), 0)::numeric AS "importe"
    FROM "etapa_movimiento" e
    JOIN "etapa_movimiento_det" d ON d."id_etapa_mov" = e."id"
    WHERE e."id_empresa" = ${idEmpresa}
      AND e."tipo" = 'recibo_maquila'::"tipo_etapa_movimiento"
      AND e."cancelado_en" IS NULL
      AND e."id_tercero" IS NOT NULL
      AND e."fecha" >= ${desde}::date
      AND e."fecha" <= ${hasta}::date
    GROUP BY e."id_tercero"
  `);
  const mapa = new Map<number, RecibosDeLaSemana>();
  for (const f of filas) {
    mapa.set(f.idTercero, {
      cantidad: f.cantidad,
      importe: Math.round(f.importe.toNumber() * 100) / 100,
    });
  }
  return mapa;
}
