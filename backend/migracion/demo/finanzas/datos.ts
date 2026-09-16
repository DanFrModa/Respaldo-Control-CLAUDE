/**
 * DATOS FICTICIOS del sembrador de FINANZAS (`migracion/sembrar-demo-finanzas.ts`).
 *
 * Aquí sólo vive el CATÁLOGO de lo que se va a sembrar (listas planas). Nada toca la base: quien
 * escribe es `demo/finanzas/sembrar.ts`, y siempre **por el dominio** (A1) — nunca `prisma.create`
 * de un catálogo, de un movimiento de cuenta corriente ni de un pago.
 *
 * 🔴 TODO LO DE ESTE ARCHIVO ES INVENTADO. El repositorio es PÚBLICO: ni un nombre, RFC, dirección,
 * teléfono ni número de cuenta de una persona o empresa real, ni siquiera «de ejemplo». Los RFC
 * tienen la FORMA que exige `esRfcValido` (3 letras + AAMMDD + homoclave) pero su raíz empieza por
 * `DF` («demo finanzas») y su fecha es 20-01-01 para que se lean como lo que son. Los teléfonos usan
 * el prefijo 555-02-xx (reservado para ficción) y las CLABE llevan el banco **999**, que no existe:
 * su dígito de control sí se calcula bien ({@link clabeDemo}) porque el catálogo lo exige, pero el
 * número no le pertenece a nadie.
 *
 * 🏷️ LA MARCA. Todo lo sembrado empieza por {@link PREFIJO_DEMO_FIN} en su nombre, y además queda
 * anotado en `mapeo_migracion` bajo las entidades `Demo:Fin:*` — que es lo que permite borrarlo de
 * un golpe con `--limpiar` sin adivinar por texto, y lo que lo mantiene **separado del sembrador de
 * inventarios** (que usa `Demo:*` a secas): cada uno se limpia sin tocar al otro.
 */

/** Prefijo con el que nace TODO lo sembrado (nombres). Es la marca visible. */
export const PREFIJO_DEMO_FIN = 'DEMO-FIN ';

/**
 * Claves de `mapeo_migracion` que usa el sembrador de finanzas (todas empiezan por `Demo:Fin:`).
 *
 * ⚠️ NINGUNA coincide con las `Demo:*` del sembrador de INVENTARIOS: ése borra `Object.values` de su
 * propio mapa y éste del suyo, así que correr `--limpiar` de uno **jamás** toca lo del otro.
 */
export const ENTIDAD_DEMO_FIN = {
  proveedor: 'Demo:Fin:Proveedor',
  cuentaPago: 'Demo:Fin:ProveedorCuentaPago',
  cliente: 'Demo:Fin:Cliente',
  conceptoPago: 'Demo:Fin:ConceptoPago',
  /** Movimientos del MOTOR de terceros (cargos, facturas, pagos, abonos… de CxP y CxC). */
  movimientoTercero: 'Demo:Fin:MovimientoTercero',
  abonoEsMa: 'Demo:Fin:AbonoMaquilero',
  descuentoEsMa: 'Demo:Fin:DescuentoMaquilero',
  /** Pagos de EsMa que nacieron DENTRO del dominio al ejecutar una corrida. */
  pagoEsMa: 'Demo:Fin:PagoMaquilero',
  corrida: 'Demo:Fin:CorridaPago',
} as const;

/** Una entidad de mapeo del sembrador de finanzas. */
export type EntidadDemoFin = (typeof ENTIDAD_DEMO_FIN)[keyof typeof ENTIDAD_DEMO_FIN];

// ── CLABE ficticia pero bien formada ─────────────────────────────────────────────────────────────

/**
 * Completa una CLABE ficticia: recibe los 17 primeros dígitos y le calcula el DÍGITO DE CONTROL de
 * Banxico (pesos 3-7-1), que es lo que `motivoCuentaInvalida` exige para dejar capturar la cuenta.
 *
 * ⚠️ No es «generar una CLABE real»: el banco va en **999**, que Banxico no tiene asignado, así que
 * el número no puede pertenecerle a nadie. El dígito se calcula sólo para que el catálogo la acepte
 * — si se pusiera a ojo, el alta se rechazaría y el sembrador moriría a la mitad.
 */
export function clabeDemo(primeros17: string): string {
  if (!/^\d{17}$/.test(primeros17)) {
    throw new Error(`CLABE demo mal formada (se esperaban 17 dígitos): ${primeros17}`);
  }
  const PESOS = [3, 7, 1];
  let suma = 0;
  for (let i = 0; i < 17; i += 1) {
    const cifra = Number(primeros17.charAt(i));
    const peso = PESOS[i % 3] ?? 1;
    suma += (cifra * peso) % 10;
  }
  return `${primeros17}${String((10 - (suma % 10)) % 10)}`;
}

// ── Proveedores ──────────────────────────────────────────────────────────────────────────────────

/** Una cuenta de pago ficticia de un proveedor (destino del depósito). */
export interface CuentaDemo {
  /** Clave del sembrador (idempotencia); no es un dato del negocio. */
  clave: string;
  beneficiario: string;
  banco: string;
  tipoCuenta: 'clabe' | 'tarjeta';
  /** CLABE de 18 dígitos (ya con control) o número de tarjeta de 15–19 dígitos. */
  cuenta: string;
  alias: string;
  /** ⭐ A una cuenta FISCAL puede salir un pago de la relación CON factura. */
  esFiscal: boolean;
}

/** Un proveedor ficticio de finanzas. `roles` son CÓDIGOS de `RolProveedor` (los siembra el seed). */
export interface ProveedorDemoFin {
  clave: string;
  nombre: string;
  nombreCorto: string;
  rfc: string;
  regimenFiscalSat: string;
  /** Base del aging de CxP: el vencimiento del cargo es `fecha + diasCredito` (D15d). */
  diasCredito: number;
  modalidadFacturacion: 'solo_con' | 'solo_sin' | 'ambos';
  roles: string[];
  email: string;
  telefono: string;
  direccion: string;
  cuentas: CuentaDemo[];
}

/**
 * Los 6 proveedores ficticios. La mezcla está elegida para que las pantallas de Finanzas tengan de
 * todo, no sólo el camino feliz:
 *  • **tres maquileros** (`maquila-costura`, `estampado` y `lavado` son roles de maquila ⇒ rubro
 *    «Maquileros» y cuenta corriente de EsMa) para ver el FOLD de EsMa dentro del estado de cuenta
 *    de CxP;
 *  • uno que factura **siempre**, uno que **nunca** y dos **de las dos formas** (`ambos`), que es el
 *    caso en el que el segmento con/sin factura hay que decirlo a mano;
 *  • días de crédito distintos (0/15/30/45) para que el aging reparta en varias cubetas.
 */
export const PROVEEDORES_DEMO_FIN: ProveedorDemoFin[] = [
  {
    clave: 'FPROV-01',
    nombre: `${PREFIJO_DEMO_FIN}Maquilas del Valle`,
    nombreCorto: `${PREFIJO_DEMO_FIN}MVALLE`,
    rfc: 'DFA200101A01',
    regimenFiscalSat: '601',
    diasCredito: 0,
    modalidadFacturacion: 'solo_con',
    roles: ['maquila-costura'],
    email: 'cobranza@demo-fin-mvalle.invalid',
    telefono: '55-5502-0001',
    direccion: 'Calle Ficticia 11, Col. Demo, Ciudad de Prueba',
    cuentas: [
      {
        clave: 'FCTA-01',
        beneficiario: `${PREFIJO_DEMO_FIN}Maquilas del Valle SA de CV`,
        banco: 'Banco Ficticio',
        tipoCuenta: 'clabe',
        cuenta: clabeDemo('99918000000000001'),
        alias: 'La fiscal',
        esFiscal: true,
      },
    ],
  },
  {
    clave: 'FPROV-02',
    nombre: `${PREFIJO_DEMO_FIN}Estampados Aurora`,
    nombreCorto: `${PREFIJO_DEMO_FIN}AURORA`,
    rfc: 'DFB200101A02',
    regimenFiscalSat: '626',
    diasCredito: 0,
    modalidadFacturacion: 'solo_sin',
    roles: ['estampado'],
    email: 'contacto@demo-fin-aurora.invalid',
    telefono: '55-5502-0002',
    direccion: 'Calle Ficticia 12, Col. Demo, Ciudad de Prueba',
    cuentas: [
      {
        clave: 'FCTA-02',
        beneficiario: `${PREFIJO_DEMO_FIN}Beneficiario Aurora`,
        banco: 'Banco Ficticio',
        tipoCuenta: 'tarjeta',
        cuenta: '4000000000000002',
        alias: 'La 1',
        esFiscal: false,
      },
    ],
  },
  {
    clave: 'FPROV-03',
    nombre: `${PREFIJO_DEMO_FIN}Servicios Logísticos Bruma`,
    nombreCorto: `${PREFIJO_DEMO_FIN}BRUMA`,
    rfc: 'DFC200101A03',
    regimenFiscalSat: '601',
    diasCredito: 30,
    modalidadFacturacion: 'solo_con',
    roles: ['otros-servicios'],
    email: 'cobranza@demo-fin-bruma.invalid',
    telefono: '55-5502-0003',
    direccion: 'Calle Ficticia 13, Col. Demo, Ciudad de Prueba',
    cuentas: [
      {
        clave: 'FCTA-03',
        beneficiario: `${PREFIJO_DEMO_FIN}Servicios Logísticos Bruma SA de CV`,
        banco: 'Banco Ficticio',
        tipoCuenta: 'clabe',
        cuenta: clabeDemo('99918000000000003'),
        alias: 'La de siempre',
        esFiscal: true,
      },
    ],
  },
  {
    clave: 'FPROV-04',
    nombre: `${PREFIJO_DEMO_FIN}Insumos Cardinal`,
    nombreCorto: `${PREFIJO_DEMO_FIN}CARDINAL`,
    rfc: 'DFD200101A04',
    regimenFiscalSat: '626',
    diasCredito: 15,
    modalidadFacturacion: 'ambos',
    roles: ['vende-avios'],
    email: 'ventas@demo-fin-cardinal.invalid',
    telefono: '55-5502-0004',
    direccion: 'Calle Ficticia 14, Col. Demo, Ciudad de Prueba',
    cuentas: [],
  },
  {
    clave: 'FPROV-05',
    nombre: `${PREFIJO_DEMO_FIN}Tintorería Mirasol`,
    nombreCorto: `${PREFIJO_DEMO_FIN}MIRASOL`,
    rfc: 'DFE200101A05',
    regimenFiscalSat: '601',
    diasCredito: 45,
    modalidadFacturacion: 'ambos',
    roles: ['lavado'],
    email: 'cobranza@demo-fin-mirasol.invalid',
    telefono: '55-5502-0005',
    direccion: 'Calle Ficticia 15, Col. Demo, Ciudad de Prueba',
    cuentas: [
      {
        clave: 'FCTA-05A',
        beneficiario: `${PREFIJO_DEMO_FIN}Tintorería Mirasol SA de CV`,
        banco: 'Banco Ficticio',
        tipoCuenta: 'clabe',
        cuenta: clabeDemo('99918000000000005'),
        alias: 'La fiscal',
        esFiscal: true,
      },
      {
        clave: 'FCTA-05B',
        beneficiario: `${PREFIJO_DEMO_FIN}Beneficiario Mirasol`,
        banco: 'Banco Ficticio',
        tipoCuenta: 'tarjeta',
        cuenta: '4000000000000005',
        alias: 'La 2',
        esFiscal: false,
      },
    ],
  },
  {
    clave: 'FPROV-06',
    nombre: `${PREFIJO_DEMO_FIN}Papelería Zafiro`,
    nombreCorto: `${PREFIJO_DEMO_FIN}ZAFIRO`,
    rfc: 'DFF200101A06',
    regimenFiscalSat: '626',
    diasCredito: 0,
    modalidadFacturacion: 'solo_sin',
    roles: ['otros-servicios'],
    email: 'contacto@demo-fin-zafiro.invalid',
    telefono: '55-5502-0006',
    direccion: 'Calle Ficticia 16, Col. Demo, Ciudad de Prueba',
    cuentas: [],
  },
];

// ── Clientes ─────────────────────────────────────────────────────────────────────────────────────

/** Un cliente ficticio (CxC). */
export interface ClienteDemoFin {
  clave: string;
  nombre: string;
  razonSocial: string;
  /** RFC del receptor del CFDI de venta (F9-E4/R12). `null` = sin capturar, a propósito. */
  rfc: string | null;
  /** Base del aging de CxC (D15d). 0 = contado. */
  diasCredito: number;
  contacto: string;
  telefono: string;
  email: string;
  direccion: string;
}

/**
 * Los 4 clientes ficticios. Días de crédito distintos (0/30/45/60) para repartir el aging de CxC, y
 * uno **SIN RFC** a propósito: es el caso en el que un CFDI de venta no se puede conciliar por
 * receptor, y hay que verlo.
 *
 * ⚠️ NO llevan `abreviatura`: son 3 letras únicas entre TODOS los clientes y el sembrador no tiene
 * por qué competir por ellas con los clientes de verdad de `prueba`. Sin abreviatura el cliente no
 * estrena modelos de desarrollo, que es algo que esta siembra no hace.
 */
export const CLIENTES_DEMO_FIN: ClienteDemoFin[] = [
  {
    clave: 'FCLI-01',
    nombre: `${PREFIJO_DEMO_FIN}Tiendas Altaluz`,
    razonSocial: `${PREFIJO_DEMO_FIN}Tiendas Altaluz SA de CV`,
    rfc: 'DFG200101C01',
    diasCredito: 30,
    contacto: 'Contacto de prueba',
    telefono: '55-5502-1001',
    email: 'pagos@demo-fin-altaluz.invalid',
    direccion: 'Avenida Ficticia 101, Col. Demo, Ciudad de Prueba',
  },
  {
    clave: 'FCLI-02',
    nombre: `${PREFIJO_DEMO_FIN}Almacenes Bruna`,
    razonSocial: `${PREFIJO_DEMO_FIN}Almacenes Bruna SA de CV`,
    rfc: 'DFH200101C02',
    diasCredito: 60,
    contacto: 'Contacto de prueba',
    telefono: '55-5502-1002',
    email: 'pagos@demo-fin-bruna.invalid',
    direccion: 'Avenida Ficticia 102, Col. Demo, Ciudad de Prueba',
  },
  {
    clave: 'FCLI-03',
    nombre: `${PREFIJO_DEMO_FIN}Boutique Candil`,
    razonSocial: `${PREFIJO_DEMO_FIN}Boutique Candil SA de CV`,
    rfc: 'DFI200101C03',
    diasCredito: 0,
    contacto: 'Contacto de prueba',
    telefono: '55-5502-1003',
    email: 'pagos@demo-fin-candil.invalid',
    direccion: 'Avenida Ficticia 103, Col. Demo, Ciudad de Prueba',
  },
  {
    clave: 'FCLI-04',
    nombre: `${PREFIJO_DEMO_FIN}Mayoreo Delta`,
    razonSocial: `${PREFIJO_DEMO_FIN}Mayoreo Delta SA de CV`,
    rfc: null,
    diasCredito: 45,
    contacto: 'Contacto de prueba',
    telefono: '55-5502-1004',
    email: 'pagos@demo-fin-delta.invalid',
    direccion: 'Avenida Ficticia 104, Col. Demo, Ciudad de Prueba',
  },
];

// ── Conceptos de pago (lo que se paga y NO es un proveedor) ──────────────────────────────────────

/** Un concepto de pago ficticio (caja chica, nómina por fuera…). */
export interface ConceptoDemoFin {
  clave: string;
  nombre: string;
  rubro: 'nomina' | 'servicios' | 'caja_chica' | 'otros';
  formaPagoPreferida: 'efectivo' | 'transferencia';
}

/**
 * Los conceptos ficticios. **Ninguno es `predeterminado`**, y es a propósito: un predeterminado se
 * carga SOLO en cada corrida nueva, así que un concepto de prueba marcado así se le colaría a Daniel
 * en todas las relaciones de verdad que arme después. Se capturan a mano en la corrida ficticia.
 */
export const CONCEPTOS_DEMO_FIN: ConceptoDemoFin[] = [
  {
    clave: 'FCON-01',
    nombre: `${PREFIJO_DEMO_FIN}Caja chica`,
    rubro: 'caja_chica',
    formaPagoPreferida: 'efectivo',
  },
  {
    clave: 'FCON-02',
    nombre: `${PREFIJO_DEMO_FIN}Nómina por fuera`,
    rubro: 'nomina',
    formaPagoPreferida: 'efectivo',
  },
];

// ── Movimientos de cuenta corriente ──────────────────────────────────────────────────────────────

/**
 * Un movimiento ficticio del MOTOR de terceros. `dias` es el desplazamiento en días respecto de HOY
 * (negativo = al pasado): de ahí sale el vencimiento (`fecha + díasCrédito`) y, con él, la CUBETA
 * de antigüedad. Si todo naciera hoy, el reporte de aging saldría vacío y no habría qué revisar.
 */
export interface MovimientoDemoFin {
  clave: string;
  /** Clave del proveedor o del cliente al que pertenece. */
  tercero: string;
  dias: number;
  origen:
    | 'entrada_sin_factura'
    | 'factura_proveedor'
    | 'factura_cliente'
    | 'nota_credito'
    | 'pago'
    | 'abono'
    | 'descuento';
  importe: number;
  /** Sólo cuando el tercero factura «de las dos formas» (ahí nadie más puede decidirlo). */
  esFiscal?: boolean;
  /** UUID ficticio del CFDI (exige `esFiscal`). */
  uuidCfdi?: string;
  observaciones: string;
  /** Si viene, el movimiento se CANCELA acto seguido con este motivo (inverso auditado, D3). */
  cancelarCon?: string;
}

/**
 * CxP — los movimientos de los proveedores, repartidos por antigüedad a propósito.
 *
 * Con los límites de aging por omisión (30/60 días) las cubetas quedan así:
 *  • **+60**: FPROV-03 (−140 d, 30 de crédito ⇒ 110 de atraso) y FPROV-06 (−95 d, contado).
 *  • **31–60**: FPROV-03 (−85 ⇒ 55) y FPROV-04 (−70 + 15 ⇒ 55).
 *  • **1–30**: FPROV-03 (−50 ⇒ 20), FPROV-04 (−20 + 15 ⇒ 5) y FPROV-06 (−3).
 *  • **por vencer**: FPROV-03 (−10 + 30 ⇒ vence en 20) y FPROV-05 (−20 + 45 ⇒ vence en 25).
 * Los abonos dejan saldos PARCIALES (ni cero ni el cargo entero), que es lo que hay que poder mirar.
 */
export const MOVIMIENTOS_CXP_DEMO: MovimientoDemoFin[] = [
  {
    clave: 'FMOV-CXP-01',
    tercero: 'FPROV-03',
    dias: -140,
    origen: 'entrada_sin_factura',
    importe: 48_500,
    observaciones: 'Fletes de la temporada pasada (dato de prueba) — el más atrasado.',
  },
  {
    clave: 'FMOV-CXP-02',
    tercero: 'FPROV-03',
    dias: -85,
    origen: 'entrada_sin_factura',
    importe: 23_200,
    observaciones: 'Fletes foráneos (dato de prueba).',
  },
  {
    clave: 'FMOV-CXP-03',
    tercero: 'FPROV-03',
    dias: -50,
    origen: 'entrada_sin_factura',
    importe: 15_750,
    observaciones: 'Maniobras de descarga (dato de prueba).',
  },
  {
    clave: 'FMOV-CXP-04',
    tercero: 'FPROV-03',
    dias: -10,
    origen: 'entrada_sin_factura',
    importe: 31_000,
    observaciones: 'Fletes de la semana (dato de prueba) — todavía no vence.',
  },
  {
    clave: 'FMOV-CXP-05',
    tercero: 'FPROV-03',
    dias: -30,
    origen: 'pago',
    importe: 20_000,
    observaciones: 'Abono a cuenta: deja el saldo PARCIAL, no en cero (dato de prueba).',
  },
  {
    clave: 'FMOV-CXP-06',
    tercero: 'FPROV-04',
    dias: -70,
    origen: 'entrada_sin_factura',
    importe: 12_300,
    observaciones:
      'Avíos recibidos sin factura todavía (dato de prueba) — proveedor que factura de las dos formas.',
  },
  {
    clave: 'FMOV-CXP-07',
    tercero: 'FPROV-04',
    dias: -20,
    origen: 'entrada_sin_factura',
    importe: 9_800,
    observaciones: 'Segunda remisión de avíos, más reciente (dato de prueba).',
  },
  {
    clave: 'FMOV-CXP-08',
    tercero: 'FPROV-04',
    dias: -12,
    origen: 'nota_credito',
    importe: 1_500,
    esFiscal: true,
    observaciones: 'Nota de crédito por material devuelto (dato de prueba).',
  },
  {
    clave: 'FMOV-CXP-09',
    tercero: 'FPROV-04',
    dias: -40,
    origen: 'entrada_sin_factura',
    importe: 6_666,
    observaciones: 'Cargo capturado con el importe equivocado (dato de prueba).',
    cancelarCon:
      'Se capturó con el importe equivocado; se cancela con su inverso (dato de prueba).',
  },
  {
    clave: 'FMOV-CXP-10',
    tercero: 'FPROV-06',
    dias: -95,
    origen: 'entrada_sin_factura',
    importe: 4_300,
    observaciones: 'Papelería de oficina, sin factura (dato de prueba) — muy atrasado.',
  },
  {
    clave: 'FMOV-CXP-11',
    tercero: 'FPROV-06',
    dias: -3,
    origen: 'entrada_sin_factura',
    importe: 2_150,
    observaciones: 'Papelería de la semana (dato de prueba).',
  },
  {
    clave: 'FMOV-CXP-12',
    tercero: 'FPROV-06',
    dias: -2,
    origen: 'pago',
    importe: 1_800,
    observaciones: 'Pago parcial en efectivo (dato de prueba).',
  },
  {
    clave: 'FMOV-CXP-13',
    tercero: 'FPROV-05',
    dias: -20,
    origen: 'entrada_sin_factura',
    importe: 7_450,
    observaciones: 'Lavado de una partida, sin factura (dato de prueba) — todavía no vence.',
  },
];

/**
 * CxC — los movimientos de los clientes. Mismo criterio: antigüedades repartidas, cobros PARCIALES y
 * un cliente muy atrasado. Las facturas de venta (`factura_cliente`) nacen FISCALES con su UUID,
 * porque en la aplicación ese cargo lo pone el parser de CFDI de ventas y así se ve igual.
 */
export const MOVIMIENTOS_CXC_DEMO: MovimientoDemoFin[] = [
  {
    clave: 'FMOV-CXC-01',
    tercero: 'FCLI-01',
    dias: -100,
    origen: 'factura_cliente',
    importe: 128_400,
    esFiscal: true,
    uuidCfdi: 'DFC10001-0000-4000-8000-000000000101',
    observaciones: 'Factura de venta de la temporada pasada (dato de prueba).',
  },
  {
    clave: 'FMOV-CXC-02',
    tercero: 'FCLI-01',
    dias: -40,
    origen: 'factura_cliente',
    importe: 96_000,
    esFiscal: true,
    uuidCfdi: 'DFC10002-0000-4000-8000-000000000102',
    observaciones: 'Factura de venta del mes (dato de prueba).',
  },
  {
    clave: 'FMOV-CXC-03',
    tercero: 'FCLI-01',
    dias: -25,
    origen: 'pago',
    importe: 50_000,
    observaciones: 'Cobro parcial: el saldo queda a medias, no en cero (dato de prueba).',
  },
  {
    clave: 'FMOV-CXC-04',
    tercero: 'FCLI-02',
    dias: -150,
    origen: 'factura_cliente',
    importe: 210_000,
    esFiscal: true,
    uuidCfdi: 'DFC10003-0000-4000-8000-000000000103',
    observaciones: 'Factura vieja sin cobrar (dato de prueba) — el cliente más atrasado.',
  },
  {
    clave: 'FMOV-CXC-05',
    tercero: 'FCLI-02',
    dias: -50,
    origen: 'entrada_sin_factura',
    importe: 34_500,
    observaciones: 'Cargo de venta todavía sin facturar (dato de prueba).',
  },
  {
    clave: 'FMOV-CXC-06',
    tercero: 'FCLI-02',
    dias: -30,
    origen: 'nota_credito',
    importe: 8_000,
    observaciones: 'Nota de crédito por prendas devueltas (dato de prueba).',
  },
  {
    clave: 'FMOV-CXC-07',
    tercero: 'FCLI-03',
    dias: -7,
    origen: 'factura_cliente',
    importe: 18_750,
    esFiscal: true,
    uuidCfdi: 'DFC10004-0000-4000-8000-000000000104',
    observaciones: 'Venta de contado (dato de prueba): vence el mismo día.',
  },
  {
    clave: 'FMOV-CXC-08',
    tercero: 'FCLI-03',
    dias: -6,
    origen: 'pago',
    importe: 15_000,
    observaciones: 'Cobro casi completo (dato de prueba): quedan 3,750.',
  },
  {
    clave: 'FMOV-CXC-09',
    tercero: 'FCLI-04',
    dias: -20,
    origen: 'entrada_sin_factura',
    importe: 62_300,
    observaciones: 'Cargo de venta a 45 días (dato de prueba) — todavía no vence.',
  },
  {
    clave: 'FMOV-CXC-10',
    tercero: 'FCLI-04',
    dias: -15,
    origen: 'descuento',
    importe: 2_300,
    observaciones: 'Descuento por volumen (dato de prueba).',
  },
];

// ── EsMa (el FOLD del maquilero dentro de CxP) ───────────────────────────────────────────────────

/** Un movimiento ficticio de EsMa (abono o descuento a la cuenta del maquilero). */
export interface MovimientoEsMaDemoFin {
  clave: string;
  /** Clave del proveedor maquilero. */
  maquilero: string;
  tipo: 'abono' | 'descuento';
  dias: number;
  importe: number;
  /** Sólo si el maquilero factura «de las dos formas». */
  conFactura?: boolean;
  /**
   * ⭐ ¿Se REVISA después de capturarlo? En EsMa **sólo lo revisado suma al saldo** (fila 0.115):
   * un abono capturado y sin revisar aparece en el estado de cuenta con el importe VACÍO y se
   * cuenta aparte, en «maquila por revisar». Los dos estados se siembran a propósito — el que no
   * se revisa es justo el renglón que Daniel tiene que ir a validar.
   */
  revisar: boolean;
  observaciones: string;
}

/**
 * Los movimientos de EsMa. Existen para que el **fold** se vea: el estado de cuenta de CxP de un
 * maquilero trae SUS renglones de EsMa (fuente `esma`) mezclados con los del motor, y su saldo los
 * incluye. Sin ellos, «CxP con el fold de EsMa representado» sería una promesa sin nada detrás.
 *
 * ⚠️ En EsMa el **abono SUBE** lo que se le debe al maquilero y el **descuento lo BAJA** (convención
 * propia de F6, distinta de la del motor). Los importes de aquí están elegidos para dejar saldo.
 *
 * ⚠️ Y sólo lo **REVISADO** suma (fila 0.115): de los cuatro, dos nacen revisados —cuentan al
 * saldo— y dos se quedan CAPTURADOS, que es como se ve un renglón que espera el visto bueno de
 * Daniel (sale en el estado de cuenta con el importe vacío y en el contador «por revisar» de la
 * bandeja de CxP). Sembrar sólo revisados escondería justo esa mitad de la pantalla.
 *
 * ⛔ Lo que NO se siembra son los **cargos de EsMa** (`EsMaCargo`): nacen del RECIBO de maquila de
 * producción (F3-E4), no de un servicio de Finanzas — ver la nota del reporte.
 */
export const MOVIMIENTOS_ESMA_DEMO: MovimientoEsMaDemoFin[] = [
  {
    clave: 'FESMA-01',
    maquilero: 'FPROV-01',
    tipo: 'abono',
    dias: -35,
    importe: 6_400,
    revisar: true,
    observaciones: 'Cargo extra de maquila, ya revisado (dato de prueba): SÍ suma al saldo.',
  },
  {
    clave: 'FESMA-02',
    maquilero: 'FPROV-01',
    tipo: 'descuento',
    dias: -18,
    importe: 1_200,
    revisar: false,
    observaciones:
      'Descuento por prendas de segunda, SIN revisar (dato de prueba): sale en «por revisar» y todavía no suma.',
  },
  {
    clave: 'FESMA-03',
    maquilero: 'FPROV-05',
    tipo: 'abono',
    dias: -28,
    importe: 3_900,
    conFactura: true,
    revisar: true,
    observaciones: 'Lavado extra con factura, ya revisado (dato de prueba): SÍ suma al saldo.',
  },
  {
    clave: 'FESMA-04',
    maquilero: 'FPROV-05',
    tipo: 'descuento',
    dias: -9,
    importe: 500,
    conFactura: false, // segmento: no particiona — es el VALOR del movimiento ficticio, no un filtro
    revisar: false,
    observaciones:
      'Descuento por reproceso, SIN revisar (dato de prueba): espera el visto bueno para contar.',
  },
];

// ── Corridas semanales de pago ───────────────────────────────────────────────────────────────────

/** Un renglón ficticio de una corrida: a quién, cuánto, por dónde y por qué. */
export interface RenglonCorridaDemoFin {
  /** Clave del proveedor, o `null` si el renglón es de un concepto. */
  proveedor: string | null;
  /** Clave del concepto, o `null` si el renglón es de un proveedor. */
  concepto: string | null;
  monto: number;
  formaPago: 'efectivo' | 'transferencia';
  /** Clave de la cuenta destino (obligatoria en transferencia, `null` en efectivo). */
  cuenta: string | null;
  /** La explicación del pago (la primera columna que se lee en la relación). */
  texto: string;
  referencia?: string;
}

/** Cómo termina una corrida ficticia. */
export type EstadoCorridaDemo = 'borrador' | 'ejecutada';

/** Una corrida semanal ficticia. */
export interface CorridaDemoFin {
  clave: string;
  /** Semanas hacia atrás desde hoy (se normaliza al lunes). */
  semanasAtras: number;
  conFactura: boolean;
  estado: EstadoCorridaDemo;
  notas: string;
  renglones: RenglonCorridaDemoFin[];
}

/**
 * Las tres corridas ficticias:
 *  • **CON factura, ejecutada** — reparte FOLIOS DE DOCUMENTO (los que el maquilero cita en su
 *    factura) y crea los pagos reales. Es la que hace posible el COTEJO.
 *  • **SIN factura, ejecutada** — con efectivo y con los conceptos del catálogo, para ver la otra
 *    relación y sus secciones.
 *  • **CON factura, en BORRADOR** — una relación a medio armar, que es como se ve la pantalla el
 *    lunes por la mañana.
 *
 * ⚠️ En la relación CON factura todo renglón con monto tiene que salir a una cuenta **fiscal**
 * (§Post-F9.189(d)): por eso ahí sólo van proveedores que tienen una, y el efectivo y los conceptos
 * se quedan en la corrida SIN factura.
 */
export const CORRIDAS_DEMO_FIN: CorridaDemoFin[] = [
  {
    clave: 'FCOR-01',
    semanasAtras: 3,
    conFactura: true,
    estado: 'ejecutada',
    notas: `${PREFIJO_DEMO_FIN}relación CON factura (datos de prueba).`,
    renglones: [
      {
        proveedor: 'FPROV-01',
        concepto: null,
        monto: 45_000,
        formaPago: 'transferencia',
        cuenta: 'FCTA-01',
        texto: 'Maquila de costura de la semana (dato de prueba)',
        referencia: 'R-1001 y R-1002',
      },
      {
        proveedor: 'FPROV-05',
        concepto: null,
        monto: 18_600,
        formaPago: 'transferencia',
        cuenta: 'FCTA-05A',
        texto: 'Lavado de la semana (dato de prueba)',
        referencia: 'R-1010',
      },
      {
        proveedor: 'FPROV-03',
        concepto: null,
        monto: 20_000,
        formaPago: 'transferencia',
        cuenta: 'FCTA-03',
        texto: 'Fletes de la semana (dato de prueba)',
        referencia: 'F-770 y F-771',
      },
    ],
  },
  {
    clave: 'FCOR-02',
    semanasAtras: 2,
    conFactura: false, // segmento: no particiona — es el VALOR de la corrida ficticia (la relación SIN factura), no un filtro
    estado: 'ejecutada',
    notas: `${PREFIJO_DEMO_FIN}relación SIN factura (datos de prueba).`,
    renglones: [
      {
        proveedor: 'FPROV-02',
        concepto: null,
        monto: 12_400,
        formaPago: 'transferencia',
        cuenta: 'FCTA-02',
        texto: 'Estampado de la semana (dato de prueba)',
        referencia: 'E-320',
      },
      {
        proveedor: 'FPROV-06',
        concepto: null,
        monto: 3_800,
        formaPago: 'efectivo',
        cuenta: null,
        texto: 'Papelería pagada en efectivo (dato de prueba)',
      },
      {
        proveedor: null,
        concepto: 'FCON-01',
        monto: 2_500,
        formaPago: 'efectivo',
        cuenta: null,
        texto: 'Caja chica de la semana (dato de prueba)',
      },
      {
        proveedor: null,
        concepto: 'FCON-02',
        monto: 9_000,
        formaPago: 'efectivo',
        cuenta: null,
        texto: 'Nómina por fuera de la semana (dato de prueba)',
      },
    ],
  },
  {
    clave: 'FCOR-03',
    semanasAtras: 1,
    conFactura: true,
    estado: 'borrador',
    notas: `${PREFIJO_DEMO_FIN}relación a medio armar (datos de prueba).`,
    renglones: [
      {
        proveedor: 'FPROV-01',
        concepto: null,
        monto: 25_000,
        formaPago: 'transferencia',
        cuenta: 'FCTA-01',
        texto: 'Maquila de costura, pendiente de cerrar (dato de prueba)',
      },
    ],
  },
];

// ── Facturas de proveedor y su COTEJO contra el documento que emitimos ───────────────────────────

/**
 * Una factura ficticia de proveedor (origen `factura_proveedor`, sin liga a una compra) y cómo se
 * coteja contra los documentos que FR Moda emitió en la corrida CON factura.
 */
export interface FacturaCotejoDemoFin {
  clave: string;
  /** Clave del proveedor que la emite. */
  proveedor: string;
  dias: number;
  /** Total de la factura, CON IVA (la misma unidad que el documento emitido). */
  importe: number;
  uuidCfdi: string;
  observaciones: string;
  /**
   * Qué documento de la corrida cubre y por cuánto. `null` = no se liga a ninguno (queda en ROJO sin
   * explicación, que es el caso de la factura que llega y nadie sabe de dónde salió).
   */
  aplicaA: { corrida: string; proveedor: string; importe: number } | null;
  /** Si viene, la factura queda ATENDIDA con esta nota (sigue en rojo, pero deja de frenar el pago). */
  atenderCon?: string;
}

/**
 * Las cuatro facturas del cotejo. Están elegidas para que la bandeja tenga los CUATRO estados que
 * Daniel necesita distinguir, no sólo el que cuadra:
 *  1. **Cuadra** — lo que cobra es exactamente lo que le mandamos a cobrar.
 *  2. **En rojo, sin atender** — cobra 2,400 de más sobre el documento. Es la que FRENA el pago.
 *  3. **En rojo, atendida** — cobra 3,500 de más, pero alguien escribió por qué y deja de frenar.
 *  4. **En rojo, sin ninguna liga** — llegó una factura que no corresponde a ningún documento.
 *
 * ⚠️ Ninguna es de `FPROV-01` salvo la que cuadra, y es a propósito: una factura en rojo de un
 * proveedor **impide EJECUTAR** cualquier corrida donde ese proveedor tenga renglón (§Post-F9.232
 * (c)), y la corrida en borrador `FCOR-03` es suya. Si se le colgara una factura en rojo, Daniel no
 * podría ejecutarla y parecería un defecto del sistema en vez de la regla funcionando.
 */
export const FACTURAS_COTEJO_DEMO: FacturaCotejoDemoFin[] = [
  {
    clave: 'FMOV-FAC-01',
    proveedor: 'FPROV-01',
    dias: -18,
    importe: 45_000,
    uuidCfdi: 'DFF10001-0000-4000-8000-000000000201',
    observaciones: 'Factura de maquila que CUADRA con el documento emitido (dato de prueba).',
    aplicaA: { corrida: 'FCOR-01', proveedor: 'FPROV-01', importe: 45_000 },
  },
  {
    clave: 'FMOV-FAC-02',
    proveedor: 'FPROV-05',
    dias: -16,
    importe: 21_000,
    uuidCfdi: 'DFF10002-0000-4000-8000-000000000202',
    observaciones:
      'Factura que cobra 2,400 MÁS que el documento emitido (dato de prueba): queda EN ROJO.',
    aplicaA: { corrida: 'FCOR-01', proveedor: 'FPROV-05', importe: 18_600 },
  },
  {
    clave: 'FMOV-FAC-03',
    proveedor: 'FPROV-03',
    dias: -15,
    importe: 23_500,
    uuidCfdi: 'DFF10003-0000-4000-8000-000000000203',
    observaciones:
      'Factura que cobra 3,500 MÁS que el documento emitido (dato de prueba): en rojo, pero atendida.',
    aplicaA: { corrida: 'FCOR-01', proveedor: 'FPROV-03', importe: 20_000 },
    atenderCon:
      'Diferencia por maniobras extra ya autorizadas; se paga y se regulariza el mes que entra (dato de prueba).',
  },
  {
    clave: 'FMOV-FAC-04',
    proveedor: 'FPROV-05',
    dias: -5,
    importe: 7_900,
    uuidCfdi: 'DFF10004-0000-4000-8000-000000000204',
    observaciones:
      'Factura SIN ningún documento que la ampare (dato de prueba): en rojo y sin explicación.',
    aplicaA: null,
  },
];
