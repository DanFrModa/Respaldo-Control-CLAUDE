/**
 * CFDI 4.0 FICTICIOS del sembrador de FINANZAS.
 *
 * 🔴 100 % INVENTADOS. El repositorio es PÚBLICO: aquí no hay —ni puede haber— el RFC, el nombre o
 * el domicilio de una persona o empresa real. El XML lo arma {@link construirCfdiDemo}, el MISMO
 * constructor del sembrador de inventarios (no se duplica el esqueleto del comprobante), y el
 * sello/timbre es un UUID de relleno: **no están timbrados por ningún PAC**, sólo tienen la FORMA
 * que el parser de v2 exige.
 *
 * ## Para qué sirven (y por qué son archivos y no filas)
 *
 * Estos comprobantes **no se importan aquí**: se dejan en disco para que Daniel pruebe A MANO las
 * dos importaciones de Finanzas, que es justo lo que no se puede probar sin un XML:
 *
 *  • **CFDI de PROVEEDOR** (`Finanzas › CxP › importar CFDI`): al importarse nace una
 *    `factura_proveedor` en la cuenta corriente del proveedor y —si no va ligada a una compra—
 *    entra a la **bandeja de cotejo**, donde se liga contra el documento que FR Moda emitió.
 *  • **CFDI de VENTAS** (`Finanzas › CxC › importar CFDI`): nace el cargo `factura_cliente` del
 *    cliente receptor.
 *
 * Por eso sus UUID son DISTINTOS de los de los movimientos que el sembrador ya escribió: el UUID es
 * único global, y repetirlo haría que la importación se rechazara a sí misma.
 *
 * ## Los dos RFC que dependen de la base
 *
 *  • En los de PROVEEDOR el **receptor** es la empresa activa. Si todavía no tiene RFC capturado se
 *    usa `XAXX010101000` (el genérico del público en general) y el importador sólo avisa; si la
 *    empresa SÍ tiene RFC y el archivo trae otro, el importador **rechaza** el comprobante a
 *    propósito.
 *  • En los de VENTAS es al revés: el **emisor** tiene que ser la empresa (si no, se rechaza), y el
 *    receptor es el cliente ficticio.
 *
 * Como los dos dependen de la empresa de ESA base, los archivos se **reescriben en cada corrida**
 * del sembrador.
 */
import type { CfdiDemo } from '../cfdi.js';

import { CLIENTES_DEMO_FIN, PREFIJO_DEMO_FIN, PROVEEDORES_DEMO_FIN } from './datos.js';

/** Un CFDI ficticio de finanzas: el comprobante más a quién le toca ser el receptor. */
export interface CfdiDemoFin extends CfdiDemo {
  /**
   * Lado del comprobante:
   *  • `proveedor` — lo emite un proveedor ficticio y lo recibe la EMPRESA.
   *  • `venta` — lo emite la EMPRESA y lo recibe un cliente ficticio (su RFC va en `receptorRfc`).
   */
  lado: 'proveedor' | 'venta';
  /** RFC del receptor cuando `lado === 'venta'`; `null` = la empresa activa (lado proveedor). */
  receptorRfc: string | null;
  /** Nombre del receptor cuando `lado === 'venta'`. */
  receptorNombre: string | null;
}

/** El proveedor ficticio de una clave (lanza si el catálogo cambió y ya no está). */
function proveedor(clave: string): { rfc: string; nombre: string } {
  const p = PROVEEDORES_DEMO_FIN.find((x) => x.clave === clave);
  if (p === undefined) throw new Error(`CFDI demo: no existe el proveedor ${clave}.`);
  return { rfc: p.rfc, nombre: p.nombre };
}

/** El cliente ficticio de una clave, con su RFC (lanza si no lo tiene: sin RFC no hay receptor). */
function cliente(clave: string): { rfc: string; nombre: string } {
  const c = CLIENTES_DEMO_FIN.find((x) => x.clave === clave);
  if (c === undefined) throw new Error(`CFDI demo: no existe el cliente ${clave}.`);
  if (c.rfc === null) throw new Error(`CFDI demo: el cliente ${clave} no tiene RFC capturado.`);
  return { rfc: c.rfc, nombre: c.nombre };
}

/**
 * Los comprobantes ficticios, con su caso incómodo de cada lado: uno que el importador **no va a
 * poder colocar** porque el emisor no está dado de alta, y otro cuyo **receptor no es ningún
 * cliente**. Son los que enseñan qué hace el sistema cuando el papel no casa, que es lo que hay que
 * juzgar antes de confiar en la importación.
 *
 * @param fecha  desplaza la fecha del comprobante en días respecto de hoy (la misma función que usa
 *               la siembra, para que los comprobantes queden en el mismo horizonte que los saldos).
 */
export function catalogoCfdiFinanzas(fecha: (dias: number) => string): CfdiDemoFin[] {
  const p01 = proveedor('FPROV-01');
  const p03 = proveedor('FPROV-03');
  const c01 = cliente('FCLI-01');
  const c02 = cliente('FCLI-02');
  return [
    {
      lado: 'proveedor',
      receptorRfc: null,
      receptorNombre: null,
      archivo: 'demo-fin-cfdi-proveedor-maquila.xml',
      uuid: 'DFX10001-0000-4000-8000-000000000301',
      tipo: 'I',
      emisorRfc: p01.rfc,
      emisorNombre: p01.nombre,
      fecha: fecha(-4),
      subtotal: 10_344.83,
      concepto: 'Maquila de costura (datos de prueba)',
      nota:
        'CxP: al importarlo nace una factura del proveedor de maquila y ENTRA a la bandeja de ' +
        'cotejo en ROJO (no trae documento que la ampare). ⚠️ Mientras siga en rojo y sin ' +
        'atender FRENA la ejecución de la corrida en borrador de ese mismo proveedor: no es un ' +
        'defecto, es la regla del cotejo funcionando — lígala o atiéndela y se destraba.',
    },
    {
      lado: 'proveedor',
      receptorRfc: null,
      receptorNombre: null,
      archivo: 'demo-fin-cfdi-proveedor-servicios.xml',
      uuid: 'DFX10002-0000-4000-8000-000000000302',
      tipo: 'I',
      emisorRfc: p03.rfc,
      emisorNombre: p03.nombre,
      fecha: fecha(-3),
      subtotal: 6_896.55,
      concepto: 'Servicios de flete (datos de prueba)',
      nota: 'CxP: factura de un proveedor de servicios, para probar la importación normal.',
    },
    {
      lado: 'proveedor',
      receptorRfc: null,
      receptorNombre: null,
      archivo: 'demo-fin-cfdi-proveedor-desconocido.xml',
      uuid: 'DFX10003-0000-4000-8000-000000000303',
      tipo: 'I',
      emisorRfc: 'DFZ200101A99',
      emisorNombre: `${PREFIJO_DEMO_FIN}Proveedor que no está dado de alta`,
      fecha: fecha(-2),
      subtotal: 4_500,
      concepto: 'Servicio sin proveedor en el catálogo (datos de prueba)',
      nota: '🔴 NO CASA: el EMISOR no existe en el catálogo de proveedores.',
    },
    {
      lado: 'venta',
      receptorRfc: c01.rfc,
      receptorNombre: c01.nombre,
      archivo: 'demo-fin-cfdi-venta-altaluz.xml',
      uuid: 'DFX10004-0000-4000-8000-000000000304',
      tipo: 'I',
      // El emisor de una venta es la EMPRESA: su RFC se pone al escribir el archivo (depende de la
      // base). Estos dos valores son sólo el hueco que ahí se rellena.
      emisorRfc: '',
      emisorNombre: '',
      fecha: fecha(-6),
      subtotal: 43_103.45,
      concepto: 'Venta de prendas (datos de prueba)',
      nota: 'CxC: al importarlo nace el cargo por venta del cliente receptor.',
    },
    {
      lado: 'venta',
      receptorRfc: c02.rfc,
      receptorNombre: c02.nombre,
      archivo: 'demo-fin-cfdi-venta-bruna.xml',
      uuid: 'DFX10005-0000-4000-8000-000000000305',
      tipo: 'I',
      emisorRfc: '',
      emisorNombre: '',
      fecha: fecha(-5),
      subtotal: 25_862.07,
      concepto: 'Venta de prendas (datos de prueba)',
      nota: 'CxC: segunda venta, a otro cliente y con otro plazo de crédito.',
    },
    {
      lado: 'venta',
      receptorRfc: 'DFZ200101C99',
      receptorNombre: `${PREFIJO_DEMO_FIN}Cliente que no está dado de alta`,
      archivo: 'demo-fin-cfdi-venta-receptor-desconocido.xml',
      uuid: 'DFX10006-0000-4000-8000-000000000306',
      tipo: 'I',
      emisorRfc: '',
      emisorNombre: '',
      fecha: fecha(-1),
      subtotal: 13_000,
      concepto: 'Venta de prendas (datos de prueba)',
      nota: '🔴 NO CASA: el RECEPTOR no existe en el catálogo de clientes.',
    },
  ];
}
