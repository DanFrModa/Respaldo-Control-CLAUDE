import type { NotaSalida } from '@/api/tipos';

/**
 * Fixtures de notas de salida para las pruebas de componente del módulo (F4-E5). Construye una nota
 * con valores por defecto razonables (un renglón de avío + uno de tela), sobrescribibles por prueba.
 * {@link renglonMigradoDePrueba} arma el tercer caso: el renglón MIGRADO del sistema anterior, que
 * solo trae texto libre (§Post-F9.38 / V1-E3b).
 */
export function notaDePrueba(sobrescribir: Partial<NotaSalida> = {}): NotaSalida {
  return {
    id: 1,
    numNota: 77,
    idEmpresa: 1,
    estatus: 'borrador',
    idMaquilero: 9,
    maquilero: 'Costuras del Bajío',
    idAlmacen: 2,
    almacen: 'Almacén central',
    fechaElaboracion: '2026-06-20',
    fechaEnvio: '2026-06-21',
    observaciones: null,
    confirmadaEn: null,
    confirmadaPorId: null,
    canceladaEn: null,
    canceladaPorId: null,
    motivoCancelacion: null,
    lineas: [
      {
        id: 10,
        idOrden: 50,
        folioOrden: 1001,
        tipo: 'avio',
        idAvio: 3,
        avio: 'BOT-01 — Botón',
        idTela: null,
        tela: null,
        idLote: null,
        loteClave: null,
        idMovimientoSalidaTela: null,
        folioMovimientoSalidaTela: null,
        idMovimientoAvio: null,
        folioMovimientoAvio: null,
        cantidad: 120,
        unidad: 'pza',
        descripcionLegacy: null,
      },
      {
        id: 11,
        idOrden: 50,
        folioOrden: 1001,
        tipo: 'tela',
        idAvio: null,
        avio: null,
        idTela: 7,
        tela: 'Felpa francesa',
        idLote: 11,
        loteClave: 'L-2026-09',
        idMovimientoSalidaTela: 300,
        folioMovimientoSalidaTela: 300,
        idMovimientoAvio: null,
        folioMovimientoAvio: null,
        cantidad: 30,
        unidad: 'm',
        descripcionLegacy: null,
      },
    ],
    creadoEn: '2026-06-20T10:00:00.000Z',
    creadoPorId: 'u1',
    modificadoEn: '2026-06-20T10:00:00.000Z',
    modificadoPorId: 'u1',
    ...sobrescribir,
  };
}

/**
 * Un renglón MIGRADO del sistema anterior: sin avío ni tela y con `cantidad = 0` (el viejo no
 * desglosaba cantidad por renglón), su único contenido es `descripcionLegacy`.
 */
export function renglonMigradoDePrueba(
  sobrescribir: Partial<NotaSalida['lineas'][number]> = {},
): NotaSalida['lineas'][number] {
  return {
    id: 12,
    idOrden: 50,
    folioOrden: 1001,
    tipo: 'historico',
    idAvio: null,
    avio: null,
    idTela: null,
    tela: null,
    idLote: null,
    loteClave: null,
    idMovimientoSalidaTela: null,
    folioMovimientoSalidaTela: null,
    idMovimientoAvio: null,
    folioMovimientoAvio: null,
    cantidad: 0,
    unidad: null,
    descripcionLegacy: '3 conos hilo negro y etiquetas',
    ...sobrescribir,
  };
}
