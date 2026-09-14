/**
 * DATOS FICTICIOS del sembrador de INVENTARIOS (`migracion/sembrar-demo-inventarios.ts`).
 *
 * Aquí sólo vive el CATÁLOGO de lo que se va a sembrar (listas planas). Nada toca la base: quien
 * escribe es `demo/sembrar.ts`, y siempre **por el dominio** (A1) — nunca `prisma.create` de un
 * catálogo o de un movimiento.
 *
 * 🔴 TODO LO DE ESTE ARCHIVO ES INVENTADO. El repositorio es PÚBLICO: ni un nombre, RFC, dirección
 * o teléfono de una persona o empresa real, ni siquiera «de ejemplo». Los RFC tienen la FORMA que
 * exige `esRfcValido` (3 letras + AAMMDD + homoclave) pero su raíz empieza por `DM` («demo») y su
 * fecha es 20-01-01 para que se lean como lo que son. Los teléfonos usan el prefijo 555-01-xx, que
 * es el reservado para ficción.
 *
 * 🏷️ LA MARCA. Todo lo sembrado empieza por {@link PREFIJO_DEMO} en su nombre/clave, y además queda
 * anotado en `mapeo_migracion` bajo las entidades `Demo:*` — que es lo que permite borrarlo de un
 * golpe con `--limpiar` sin adivinar por texto.
 */

/** Prefijo con el que nace TODO lo sembrado (nombres y claves). Es la marca visible. */
export const PREFIJO_DEMO = 'DEMO-';

/** Claves de `mapeo_migracion` que usa el sembrador (todas empiezan por `Demo:`). */
export const ENTIDAD_DEMO = {
  proveedor: 'Demo:Proveedor',
  almacen: 'Demo:Almacen',
  direccionEntrega: 'Demo:DireccionEntrega',
  tela: 'Demo:Tela',
  telaColor: 'Demo:TelaColor',
  avio: 'Demo:Avio',
  ordenCompra: 'Demo:OrdenCompra',
  entradaTela: 'Demo:EntradaTela',
  recepcion: 'Demo:RecepcionCompra',
  movimiento: 'Demo:Movimiento',
  /** Partidas (lotes de entrada) que nacieron DENTRO del dominio al confirmar una entrada/ajuste. */
  partida: 'Demo:PartidaTela',
  /** Cargos/abonos de CxP que nacieron DENTRO del dominio al recibir o confirmar. */
  movimientoTercero: 'Demo:MovimientoTercero',
} as const;

/** Una entidad de mapeo del sembrador. */
export type EntidadDemo = (typeof ENTIDAD_DEMO)[keyof typeof ENTIDAD_DEMO];

// ── Proveedores ──────────────────────────────────────────────────────────────────────────────────

/** Un proveedor ficticio. `roles` son CÓDIGOS de `RolProveedor` (los siembra el seed base). */
export interface ProveedorDemo {
  clave: string;
  nombre: string;
  nombreCorto: string;
  rfc: string;
  regimenFiscalSat: string;
  diasCredito: number;
  modalidadFacturacion: 'solo_con' | 'solo_sin' | 'ambos';
  roles: string[];
  email: string;
  telefono: string;
  direccion: string;
}

/** Los 8 proveedores ficticios: 4 de telas, 3 de avíos y 1 que vende de las dos cosas. */
export const PROVEEDORES_DEMO: ProveedorDemo[] = [
  {
    clave: 'PROV-01',
    nombre: `${PREFIJO_DEMO}Telas del Bajío`,
    nombreCorto: `${PREFIJO_DEMO}TBAJIO`,
    rfc: 'DMA200101A01',
    regimenFiscalSat: '601',
    diasCredito: 30,
    modalidadFacturacion: 'solo_con',
    roles: ['vende-telas'],
    email: 'ventas@demo-telasbajio.invalid',
    telefono: '55-5501-0001',
    direccion: 'Calle Ficticia 1, Col. Demo, Ciudad de Prueba',
  },
  {
    clave: 'PROV-02',
    nombre: `${PREFIJO_DEMO}Tejidos Altamar`,
    nombreCorto: `${PREFIJO_DEMO}ALTAMAR`,
    rfc: 'DMB200101A02',
    regimenFiscalSat: '601',
    diasCredito: 45,
    modalidadFacturacion: 'solo_con',
    roles: ['vende-telas'],
    email: 'ventas@demo-altamar.invalid',
    telefono: '55-5501-0002',
    direccion: 'Calle Ficticia 2, Col. Demo, Ciudad de Prueba',
  },
  {
    clave: 'PROV-03',
    nombre: `${PREFIJO_DEMO}Punto y Felpa`,
    nombreCorto: `${PREFIJO_DEMO}PUNTOF`,
    rfc: 'DMC200101A03',
    regimenFiscalSat: '626',
    diasCredito: 15,
    modalidadFacturacion: 'ambos',
    roles: ['vende-telas'],
    email: 'ventas@demo-puntoyfelpa.invalid',
    telefono: '55-5501-0003',
    direccion: 'Calle Ficticia 3, Col. Demo, Ciudad de Prueba',
  },
  {
    clave: 'PROV-04',
    nombre: `${PREFIJO_DEMO}Textiles Poniente`,
    nombreCorto: `${PREFIJO_DEMO}TPONIEN`,
    rfc: 'DMD200101A04',
    regimenFiscalSat: '601',
    diasCredito: 0,
    modalidadFacturacion: 'solo_con',
    roles: ['vende-telas'],
    email: 'ventas@demo-tpoiente.invalid',
    telefono: '55-5501-0004',
    direccion: 'Calle Ficticia 4, Col. Demo, Ciudad de Prueba',
  },
  {
    clave: 'PROV-05',
    nombre: `${PREFIJO_DEMO}Avíos del Centro`,
    nombreCorto: `${PREFIJO_DEMO}AVCENTR`,
    rfc: 'DME200101A05',
    regimenFiscalSat: '601',
    diasCredito: 30,
    modalidadFacturacion: 'solo_con',
    roles: ['vende-avios'],
    email: 'ventas@demo-aviocentro.invalid',
    telefono: '55-5501-0005',
    direccion: 'Calle Ficticia 5, Col. Demo, Ciudad de Prueba',
  },
  {
    clave: 'PROV-06',
    nombre: `${PREFIJO_DEMO}Cierres y Botones Nogal`,
    nombreCorto: `${PREFIJO_DEMO}NOGAL`,
    rfc: 'DMF200101A06',
    regimenFiscalSat: '626',
    diasCredito: 15,
    modalidadFacturacion: 'ambos',
    roles: ['vende-avios'],
    email: 'ventas@demo-nogal.invalid',
    telefono: '55-5501-0006',
    direccion: 'Calle Ficticia 6, Col. Demo, Ciudad de Prueba',
  },
  {
    clave: 'PROV-07',
    nombre: `${PREFIJO_DEMO}Etiquetas Marbete`,
    nombreCorto: `${PREFIJO_DEMO}MARBETE`,
    rfc: 'DMG200101A07',
    regimenFiscalSat: '612',
    diasCredito: 0,
    modalidadFacturacion: 'solo_sin',
    roles: ['vende-avios'],
    email: 'ventas@demo-marbete.invalid',
    telefono: '55-5501-0007',
    direccion: 'Calle Ficticia 7, Col. Demo, Ciudad de Prueba',
  },
  {
    clave: 'PROV-08',
    nombre: `${PREFIJO_DEMO}Surtidora Integral`,
    nombreCorto: `${PREFIJO_DEMO}SURTINT`,
    rfc: 'DMH200101A08',
    regimenFiscalSat: '601',
    diasCredito: 60,
    modalidadFacturacion: 'ambos',
    roles: ['vende-telas', 'vende-avios'],
    email: 'ventas@demo-surtintegral.invalid',
    telefono: '55-5501-0008',
    direccion: 'Calle Ficticia 8, Col. Demo, Ciudad de Prueba',
  },
];

// ── Almacenes y dirección de entrega ─────────────────────────────────────────────────────────────

/** Un almacén ficticio (de EMPRESA, no global: los globales son piso del catálogo y no se tocan). */
export interface AlmacenDemo {
  clave: string;
  nombre: string;
  tipo: 'TELA' | 'AVIO';
}

/** Dos de telas y dos de avíos: con dos de cada tipo hay traspasos y existencia repartida. */
export const ALMACENES_DEMO: AlmacenDemo[] = [
  { clave: 'ALM-TELA-N', nombre: `${PREFIJO_DEMO}Telas Norte`, tipo: 'TELA' },
  { clave: 'ALM-TELA-S', nombre: `${PREFIJO_DEMO}Telas Sur`, tipo: 'TELA' },
  { clave: 'ALM-AVIO-N', nombre: `${PREFIJO_DEMO}Avíos Norte`, tipo: 'AVIO' },
  { clave: 'ALM-AVIO-S', nombre: `${PREFIJO_DEMO}Avíos Sur`, tipo: 'AVIO' },
];

/** La dirección de entrega de las OC sembradas (el catálogo la exige desde §Post-F9.18). */
export const DIRECCION_DEMO = {
  clave: 'DIR-01',
  nombre: `${PREFIJO_DEMO}Planta de prueba`,
  direccion: 'Av. Ficticia 100, Parque Industrial Demo, Ciudad de Prueba, C.P. 00000',
  contacto: 'Almacén (datos de prueba)',
  telefono: '55-5501-0100',
};

// ── Telas ────────────────────────────────────────────────────────────────────────────────────────

/** Una tela ficticia con sus colores. `complemento` declarado = se ve el cárdigan. */
export interface TelaDemo {
  clave: string;
  nombre: string;
  proveedor: string;
  unidadMedida: 'KG' | 'M';
  precioSugerido: number;
  nombreCuerpo: string;
  /** Nombre del complemento (cárdigan). `null` = esta tela NO lleva complemento. */
  nombreComplemento: string | null;
  precioSugeridoComplemento?: number;
  colores: { nombre: string; pantone: string; precio: number; precioComplemento?: number }[];
}

/** Colores base reutilizados (el nombre del color de tela es libre y vive dentro de la tela). */
function colores(
  precio: number,
  precioComplemento: number | null,
  nombres: [string, string][],
): TelaDemo['colores'] {
  return nombres.map(([nombre, pantone]) => ({
    nombre,
    pantone,
    precio,
    ...(precioComplemento === null ? {} : { precioComplemento }),
  }));
}

/** Las 20 telas ficticias (5 de ellas con complemento declarado). */
export const TELAS_DEMO: TelaDemo[] = [
  {
    clave: 'TELA-01',
    nombre: `${PREFIJO_DEMO}Felpa perchada 280`,
    proveedor: 'PROV-01',
    unidadMedida: 'KG',
    precioSugerido: 148,
    nombreCuerpo: 'Felpa',
    nombreComplemento: 'Cardigan',
    precioSugeridoComplemento: 162,
    colores: colores(148, 162, [
      ['Negro demo', 'PT-19-0303'],
      ['Marino demo', 'PT-19-4025'],
      ['Jaspe demo', 'PT-17-0000'],
    ]),
  },
  {
    clave: 'TELA-02',
    nombre: `${PREFIJO_DEMO}Jersey algodón 180`,
    proveedor: 'PROV-01',
    unidadMedida: 'KG',
    precioSugerido: 126,
    nombreCuerpo: 'Jersey',
    nombreComplemento: null,
    colores: colores(126, null, [
      ['Blanco demo', 'PT-11-0601'],
      ['Rojo demo', 'PT-18-1664'],
    ]),
  },
  {
    clave: 'TELA-03',
    nombre: `${PREFIJO_DEMO}Rib 1x1 220`,
    proveedor: 'PROV-01',
    unidadMedida: 'KG',
    precioSugerido: 139,
    nombreCuerpo: 'Rib',
    nombreComplemento: null,
    colores: colores(139, null, [
      ['Negro demo', 'PT-19-0303'],
      ['Gris demo', 'PT-17-0000'],
    ]),
  },
  {
    clave: 'TELA-04',
    nombre: `${PREFIJO_DEMO}French terry 240`,
    proveedor: 'PROV-01',
    unidadMedida: 'KG',
    precioSugerido: 154,
    nombreCuerpo: 'French terry',
    nombreComplemento: 'Cardigan',
    precioSugeridoComplemento: 168,
    colores: colores(154, 168, [
      ['Arena demo', 'PT-13-1012'],
      ['Verde demo', 'PT-18-0135'],
    ]),
  },
  {
    clave: 'TELA-05',
    nombre: `${PREFIJO_DEMO}Popelina lisa`,
    proveedor: 'PROV-02',
    unidadMedida: 'M',
    precioSugerido: 42,
    nombreCuerpo: 'Popelina',
    nombreComplemento: null,
    colores: colores(42, null, [
      ['Blanco demo', 'PT-11-0601'],
      ['Celeste demo', 'PT-14-4318'],
      ['Negro demo', 'PT-19-0303'],
    ]),
  },
  {
    clave: 'TELA-06',
    nombre: `${PREFIJO_DEMO}Gabardina stretch`,
    proveedor: 'PROV-02',
    unidadMedida: 'M',
    precioSugerido: 68,
    nombreCuerpo: 'Gabardina',
    nombreComplemento: null,
    colores: colores(68, null, [
      ['Caqui demo', 'PT-16-1235'],
      ['Marino demo', 'PT-19-4025'],
    ]),
  },
  {
    clave: 'TELA-07',
    nombre: `${PREFIJO_DEMO}Mezclilla 10 oz`,
    proveedor: 'PROV-02',
    unidadMedida: 'M',
    precioSugerido: 89,
    nombreCuerpo: 'Mezclilla',
    nombreComplemento: null,
    colores: colores(89, null, [
      ['Índigo demo', 'PT-19-4028'],
      ['Negro demo', 'PT-19-0303'],
    ]),
  },
  {
    clave: 'TELA-08',
    nombre: `${PREFIJO_DEMO}Interlock 200`,
    proveedor: 'PROV-02',
    unidadMedida: 'KG',
    precioSugerido: 131,
    nombreCuerpo: 'Interlock',
    nombreComplemento: 'Cardigan',
    precioSugeridoComplemento: 145,
    colores: colores(131, 145, [
      ['Rosa demo', 'PT-15-1717'],
      ['Blanco demo', 'PT-11-0601'],
    ]),
  },
  {
    clave: 'TELA-09',
    nombre: `${PREFIJO_DEMO}Piqué 210`,
    proveedor: 'PROV-03',
    unidadMedida: 'KG',
    precioSugerido: 144,
    nombreCuerpo: 'Piqué',
    nombreComplemento: null,
    colores: colores(144, null, [
      ['Blanco demo', 'PT-11-0601'],
      ['Marino demo', 'PT-19-4025'],
      ['Vino demo', 'PT-19-1528'],
    ]),
  },
  {
    clave: 'TELA-10',
    nombre: `${PREFIJO_DEMO}Polar antipilling`,
    proveedor: 'PROV-03',
    unidadMedida: 'M',
    precioSugerido: 74,
    nombreCuerpo: 'Polar',
    nombreComplemento: null,
    colores: colores(74, null, [
      ['Gris demo', 'PT-17-0000'],
      ['Negro demo', 'PT-19-0303'],
    ]),
  },
  {
    clave: 'TELA-11',
    nombre: `${PREFIJO_DEMO}Punto Roma`,
    proveedor: 'PROV-03',
    unidadMedida: 'KG',
    precioSugerido: 158,
    nombreCuerpo: 'Punto Roma',
    nombreComplemento: 'Cardigan',
    precioSugeridoComplemento: 171,
    colores: colores(158, 171, [
      ['Negro demo', 'PT-19-0303'],
      ['Camel demo', 'PT-16-1341'],
    ]),
  },
  {
    clave: 'TELA-12',
    nombre: `${PREFIJO_DEMO}Lino mezcla`,
    proveedor: 'PROV-03',
    unidadMedida: 'M',
    precioSugerido: 96,
    nombreCuerpo: 'Lino',
    nombreComplemento: null,
    colores: colores(96, null, [
      ['Crudo demo', 'PT-12-0704'],
      ['Olivo demo', 'PT-18-0430'],
    ]),
  },
  {
    clave: 'TELA-13',
    nombre: `${PREFIJO_DEMO}Micro polar`,
    proveedor: 'PROV-04',
    unidadMedida: 'M',
    precioSugerido: 61,
    nombreCuerpo: 'Micro polar',
    nombreComplemento: null,
    colores: colores(61, null, [
      ['Azul demo', 'PT-18-4051'],
      ['Negro demo', 'PT-19-0303'],
    ]),
  },
  {
    clave: 'TELA-14',
    nombre: `${PREFIJO_DEMO}Rib 2x2 240`,
    proveedor: 'PROV-04',
    unidadMedida: 'KG',
    precioSugerido: 142,
    nombreCuerpo: 'Rib',
    nombreComplemento: null,
    colores: colores(142, null, [
      ['Negro demo', 'PT-19-0303'],
      ['Blanco demo', 'PT-11-0601'],
    ]),
  },
  {
    clave: 'TELA-15',
    nombre: `${PREFIJO_DEMO}Sudadera perchada 320`,
    proveedor: 'PROV-04',
    unidadMedida: 'KG',
    precioSugerido: 166,
    nombreCuerpo: 'Sudadera',
    nombreComplemento: 'Cardigan',
    precioSugeridoComplemento: 179,
    colores: colores(166, 179, [
      ['Gris demo', 'PT-17-0000'],
      ['Vino demo', 'PT-19-1528'],
      ['Negro demo', 'PT-19-0303'],
    ]),
  },
  {
    clave: 'TELA-16',
    nombre: `${PREFIJO_DEMO}Tafeta forro`,
    proveedor: 'PROV-04',
    unidadMedida: 'M',
    precioSugerido: 28,
    nombreCuerpo: 'Tafeta',
    nombreComplemento: null,
    colores: colores(28, null, [
      ['Negro demo', 'PT-19-0303'],
      ['Plata demo', 'PT-14-4102'],
    ]),
  },
  {
    clave: 'TELA-17',
    nombre: `${PREFIJO_DEMO}Malla deportiva`,
    proveedor: 'PROV-08',
    unidadMedida: 'M',
    precioSugerido: 37,
    nombreCuerpo: 'Malla',
    nombreComplemento: null,
    colores: colores(37, null, [
      ['Blanco demo', 'PT-11-0601'],
      ['Negro demo', 'PT-19-0303'],
    ]),
  },
  {
    clave: 'TELA-18',
    nombre: `${PREFIJO_DEMO}Elastano liso 200`,
    proveedor: 'PROV-08',
    unidadMedida: 'KG',
    precioSugerido: 173,
    nombreCuerpo: 'Elastano',
    nombreComplemento: null,
    colores: colores(173, null, [
      ['Negro demo', 'PT-19-0303'],
      ['Turquesa demo', 'PT-16-4535'],
    ]),
  },
  {
    clave: 'TELA-19',
    nombre: `${PREFIJO_DEMO}Chalís estampado`,
    proveedor: 'PROV-01',
    unidadMedida: 'M',
    precioSugerido: 52,
    nombreCuerpo: 'Chalís',
    nombreComplemento: null,
    colores: colores(52, null, [
      ['Floral demo', 'PT-13-2807'],
      ['Geométrico demo', 'PT-15-3919'],
    ]),
  },
  {
    clave: 'TELA-20',
    nombre: `${PREFIJO_DEMO}Canguro 300`,
    proveedor: 'PROV-02',
    unidadMedida: 'KG',
    precioSugerido: 159,
    nombreCuerpo: 'Canguro',
    nombreComplemento: null,
    colores: colores(159, null, [
      ['Negro demo', 'PT-19-0303'],
      ['Gris demo', 'PT-17-0000'],
    ]),
  },
];

// ── Avíos ────────────────────────────────────────────────────────────────────────────────────────

/** Un avío ficticio. `proveedor` = quien lo surte (queda como su proveedor HABITUAL). */
export interface AvioDemo {
  clave: string;
  descripcion: string;
  unidad: string;
  presentacion: string;
  precio: number;
  proveedor: string;
  esGenerico?: boolean;
  seCompraSinColor?: boolean;
}

/** Los 30 avíos ficticios, repartidos entre los 4 proveedores que venden avíos. */
export const AVIOS_DEMO: AvioDemo[] = [
  ['Cierre metálico 18 cm', 'pza', 'caja', 6.4, 'PROV-06'],
  ['Cierre metálico 20 cm', 'pza', 'caja', 6.9, 'PROV-06'],
  ['Cierre nylon 53 cm', 'pza', 'caja', 11.2, 'PROV-06'],
  ['Cierre nylon 60 cm', 'pza', 'caja', 12.5, 'PROV-06'],
  ['Botón 4 hoyos 18L', 'pza', 'bolsa', 0.85, 'PROV-06'],
  ['Botón 4 hoyos 24L', 'pza', 'bolsa', 1.1, 'PROV-06'],
  ['Broche de presión 15L', 'pza', 'bolsa', 1.35, 'PROV-06'],
  ['Ojillo metálico 5 mm', 'pza', 'bolsa', 0.42, 'PROV-06'],
  ['Resorte 2 cm', 'm', 'rollo', 3.1, 'PROV-05'],
  ['Resorte 4 cm', 'm', 'rollo', 5.4, 'PROV-05'],
  ['Cinta palmita 1 cm', 'm', 'rollo', 2.2, 'PROV-05'],
  ['Cordón redondo 5 mm', 'm', 'rollo', 2.9, 'PROV-05'],
  ['Jareta plana 2 cm', 'm', 'rollo', 3.8, 'PROV-05'],
  ['Hilo poliéster 40/2', 'cono', 'caja', 28, 'PROV-05', true],
  ['Hilo overlock 120', 'cono', 'caja', 24, 'PROV-05', true],
  ['Entretela fusionable', 'm', 'rollo', 9.6, 'PROV-05'],
  ['Velcro 2 cm', 'm', 'rollo', 4.7, 'PROV-05'],
  ['Cinta reflejante 1 cm', 'm', 'rollo', 8.3, 'PROV-05'],
  ['Etiqueta de marca tejida', 'pza', 'bolsa', 1.15, 'PROV-07'],
  ['Etiqueta de talla', 'pza', 'bolsa', 0.55, 'PROV-07', false, true],
  ['Etiqueta de lavado', 'pza', 'bolsa', 0.48, 'PROV-07', false, true],
  ['Etiqueta de composición', 'pza', 'bolsa', 0.51, 'PROV-07', false, true],
  ['Hangtag cartón', 'pza', 'caja', 1.9, 'PROV-07'],
  ['Cinta de seguridad', 'pza', 'bolsa', 0.72, 'PROV-07'],
  ['Bolsa polietileno chica', 'pza', 'caja', 0.66, 'PROV-08', true],
  ['Bolsa polietileno grande', 'pza', 'caja', 0.94, 'PROV-08', true],
  ['Caja de empaque mediana', 'pza', 'paquete', 14.5, 'PROV-08', true],
  ['Gancho de plástico', 'pza', 'caja', 2.4, 'PROV-08'],
  ['Separador de talla', 'pza', 'bolsa', 0.63, 'PROV-08'],
  ['Cinta adhesiva de empaque', 'pza', 'caja', 13.2, 'PROV-08', true],
].map(
  (fila, i): AvioDemo => ({
    clave: `${PREFIJO_DEMO}AV-${String(i + 1).padStart(3, '0')}`,
    descripcion: `${PREFIJO_DEMO}${String(fila[0])}`,
    unidad: String(fila[1]),
    presentacion: String(fila[2]),
    precio: Number(fila[3]),
    proveedor: String(fila[4]),
    ...(fila[5] === true ? { esGenerico: true } : {}),
    ...(fila[6] === true ? { seCompraSinColor: true } : {}),
  }),
);

// ── Órdenes de compra ────────────────────────────────────────────────────────────────────────────

/** Qué se hace con la OC después de crearla. */
export type PlanRecepcion = 'completa' | 'parcial' | 'ninguna' | 'borrador';

/** Un renglón de una OC ficticia: material (tela o avío) por su clave + cantidad. */
export interface LineaOcDemo {
  /** Clave de `TELAS_DEMO` o de `AVIOS_DEMO`. */
  material: string;
  /** Índice del color de la tela (0-based). Se ignora en avíos. */
  color?: number;
  cantidad: number;
  /** Cantidad de complemento (sólo telas que lo declaran; el dominio la EXIGE en esas). */
  cantidadComplemento?: number;
}

/** Una OC ficticia. */
export interface OcDemo {
  clave: string;
  proveedor: string;
  tipo: 'tela' | 'avio';
  /** Clave del almacén destino (de `ALMACENES_DEMO`). */
  almacen: string;
  /** Días a futuro de la fecha de entrega, contados desde la fecha base de la corrida. */
  diasEntrega: number;
  plan: PlanRecepcion;
  lineas: LineaOcDemo[];
}

/**
 * Las 15 OC ficticias: 6 recibidas completas, 4 parciales, 3 autorizadas sin recibir y 2 en
 * borrador; repartidas entre los cuatro almacenes para que la existencia quede en más de uno.
 *
 * ⚠️ Tela y avío se reciben por caminos DISTINTOS, y no es una preferencia del sembrador: desde
 * §Post-F9.14 la tela **ya no se recibe** con `recibirCompra` (lo rechaza renglón por renglón), se
 * recibe con el documento de ENTRADA DE TELA por factura/remisión.
 */
export const ORDENES_COMPRA_DEMO: OcDemo[] = [
  {
    clave: 'OC-01',
    proveedor: 'PROV-01',
    tipo: 'tela',
    almacen: 'ALM-TELA-N',
    diasEntrega: 10,
    plan: 'completa',
    lineas: [
      { material: 'TELA-01', color: 0, cantidad: 320, cantidadComplemento: 45 },
      { material: 'TELA-02', color: 0, cantidad: 180 },
    ],
  },
  {
    clave: 'OC-02',
    proveedor: 'PROV-01',
    tipo: 'tela',
    almacen: 'ALM-TELA-N',
    diasEntrega: 14,
    plan: 'parcial',
    lineas: [{ material: 'TELA-03', color: 0, cantidad: 240 }],
  },
  {
    clave: 'OC-03',
    proveedor: 'PROV-02',
    tipo: 'tela',
    almacen: 'ALM-TELA-N',
    diasEntrega: 7,
    plan: 'completa',
    lineas: [
      { material: 'TELA-05', color: 1, cantidad: 600 },
      { material: 'TELA-06', color: 0, cantidad: 420 },
    ],
  },
  {
    clave: 'OC-04',
    proveedor: 'PROV-02',
    tipo: 'tela',
    almacen: 'ALM-TELA-N',
    diasEntrega: 21,
    plan: 'ninguna',
    lineas: [{ material: 'TELA-07', color: 0, cantidad: 500 }],
  },
  {
    clave: 'OC-05',
    proveedor: 'PROV-03',
    tipo: 'tela',
    almacen: 'ALM-TELA-S',
    diasEntrega: 12,
    plan: 'parcial',
    lineas: [
      { material: 'TELA-09', color: 0, cantidad: 280 },
      { material: 'TELA-11', color: 0, cantidad: 150, cantidadComplemento: 22 },
    ],
  },
  {
    clave: 'OC-06',
    proveedor: 'PROV-03',
    tipo: 'tela',
    almacen: 'ALM-TELA-S',
    diasEntrega: 30,
    plan: 'borrador',
    lineas: [{ material: 'TELA-10', color: 0, cantidad: 350 }],
  },
  {
    clave: 'OC-07',
    proveedor: 'PROV-04',
    tipo: 'tela',
    almacen: 'ALM-TELA-S',
    diasEntrega: 9,
    plan: 'completa',
    lineas: [
      { material: 'TELA-15', color: 0, cantidad: 400, cantidadComplemento: 55 },
      { material: 'TELA-16', color: 0, cantidad: 900 },
    ],
  },
  {
    clave: 'OC-08',
    proveedor: 'PROV-04',
    tipo: 'tela',
    almacen: 'ALM-TELA-S',
    diasEntrega: 25,
    plan: 'ninguna',
    lineas: [{ material: 'TELA-14', color: 0, cantidad: 260 }],
  },
  {
    clave: 'OC-09',
    proveedor: 'PROV-05',
    tipo: 'avio',
    almacen: 'ALM-AVIO-N',
    diasEntrega: 8,
    plan: 'completa',
    lineas: [
      { material: `${PREFIJO_DEMO}AV-009`, cantidad: 2400 },
      { material: `${PREFIJO_DEMO}AV-011`, cantidad: 1800 },
      { material: `${PREFIJO_DEMO}AV-014`, cantidad: 60 },
    ],
  },
  {
    clave: 'OC-10',
    proveedor: 'PROV-05',
    tipo: 'avio',
    almacen: 'ALM-AVIO-N',
    diasEntrega: 16,
    plan: 'parcial',
    lineas: [
      { material: `${PREFIJO_DEMO}AV-010`, cantidad: 1500 },
      { material: `${PREFIJO_DEMO}AV-016`, cantidad: 900 },
    ],
  },
  {
    clave: 'OC-11',
    proveedor: 'PROV-06',
    tipo: 'avio',
    almacen: 'ALM-AVIO-N',
    diasEntrega: 6,
    plan: 'completa',
    lineas: [
      { material: `${PREFIJO_DEMO}AV-001`, cantidad: 3200 },
      { material: `${PREFIJO_DEMO}AV-005`, cantidad: 8000 },
      { material: `${PREFIJO_DEMO}AV-007`, cantidad: 4000 },
    ],
  },
  {
    clave: 'OC-12',
    proveedor: 'PROV-06',
    tipo: 'avio',
    almacen: 'ALM-AVIO-N',
    diasEntrega: 20,
    plan: 'ninguna',
    lineas: [
      { material: `${PREFIJO_DEMO}AV-003`, cantidad: 1200 },
      { material: `${PREFIJO_DEMO}AV-004`, cantidad: 900 },
    ],
  },
  {
    clave: 'OC-13',
    proveedor: 'PROV-07',
    tipo: 'avio',
    almacen: 'ALM-AVIO-S',
    diasEntrega: 11,
    plan: 'parcial',
    lineas: [
      { material: `${PREFIJO_DEMO}AV-019`, cantidad: 12000 },
      { material: `${PREFIJO_DEMO}AV-020`, cantidad: 12000 },
      { material: `${PREFIJO_DEMO}AV-021`, cantidad: 12000 },
    ],
  },
  {
    clave: 'OC-14',
    proveedor: 'PROV-07',
    tipo: 'avio',
    almacen: 'ALM-AVIO-S',
    diasEntrega: 28,
    plan: 'borrador',
    lineas: [
      { material: `${PREFIJO_DEMO}AV-023`, cantidad: 5000 },
      { material: `${PREFIJO_DEMO}AV-024`, cantidad: 5000 },
    ],
  },
  {
    clave: 'OC-15',
    proveedor: 'PROV-08',
    tipo: 'avio',
    almacen: 'ALM-AVIO-S',
    diasEntrega: 5,
    plan: 'completa',
    lineas: [
      { material: `${PREFIJO_DEMO}AV-025`, cantidad: 10000 },
      { material: `${PREFIJO_DEMO}AV-030`, cantidad: 240 },
    ],
  },
];

/** Cuánto se recibe en una recepción PARCIAL (60% de lo pedido, redondeado). */
export const FRACCION_PARCIAL = 0.6;
