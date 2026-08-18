/**
 * Pruebas del lector de la Constancia de Situación Fiscal (§Post-F9.55).
 *
 * ⚠️ SOBRE LOS FIXTURES: los dos PDF reales (uno personal) **NO se comitean** — son documentos
 * fiscales. Lo que hay aquí es el TEXTO que `unpdf` saca de ELLOS, con la **estructura intacta** y
 * los **datos cambiados** (RFC, CURP, nombres, calle, colonia, CP y municipio inventados).
 *
 * Esto NO es una reconstrucción: la primera versión de estas pruebas SÍ lo era, y por eso dejó
 * pasar el defecto del municipio —el fixture inventado usaba `Municipio o Delegación:`, forma que
 * el SAT ya no imprime; el papel real dice `Nombre del Municipio o Demarcación Territorial:`—.
 * Cambiar el fixture por el texto real es lo que lo destapó.
 */
import { describe, expect, it } from 'vitest';

import {
  etiquetaColada,
  parsearRegimenes,
  parsearTextoConstancia,
  valorEntreEtiquetas,
} from './constancia-fiscal.js';

/**
 * Persona FÍSICA — **estructura EXACTA de la constancia real** (los datos van anonimizados: RFC,
 * CURP, nombre, calle, colonia, CP y municipio son inventados; el LAYOUT no se tocó). Trampas que
 * reproduce, todas verificadas contra el PDF real:
 *  • `Tipo de Vialidad:` viene VACÍO y cierra la línea, pegado a `Nombre de Vialidad:`.
 *  • ⭐ `Nombre de la Localidad:` viene VACÍO y queda pegado a la etiqueta LARGA
 *    `Nombre del Municipio o Demarcación Territorial:` — el defecto que se coló en la primera
 *    entrega, porque el fixture reconstruido usaba la forma corta que el SAT ya no imprime.
 *  • `Código Postal:11000` y `Número Interior:3ER PISO` SIN espacio tras los dos puntos.
 *  • Varias etiquetas por línea.
 *  • `Entre Calle:` cierra la página 1 y `Y Calle:` abre la 2.
 *  • Bloque `Actividades Económicas:` entre el domicilio y los regímenes.
 *  • DOS regímenes.
 */
const FISICA_PAGINAS = [
  [
    'Página [1] de [3]',
    'CÉDULA DE IDENTIFICACIÓN FISCAL',
    'GORL850214J38',
    'Registro Federal de Contribuyentes',
    'LAURA GOMEZ RIVAS',
    'Nombre, denominación o razón',
    'social',
    'idCIF: 10000000001',
    'VALIDA TU INFORMACIÓN',
    'FISCAL',
    'CONSTANCIA DE SITUACIÓN FISCAL',
    'Lugar y Fecha de Emisión',
    'BENITO JUAREZ , CIUDAD DE MEXICO A 06 DE',
    'MAYO DE 2026',
    'GORL850214J38',
    'Datos de Identificación del Contribuyente:',
    'RFC: GORL850214J38',
    'CURP: GORL850214MDFMVR09',
    'Nombre (s): LAURA',
    'Primer Apellido: GOMEZ',
    'Segundo Apellido: RIVAS',
    'Fecha inicio de operaciones: 01 DE JULIO DE 2005',
    'Estatus en el padrón: ACTIVO',
    'Fecha de último cambio de estado: 01 DE JULIO DE 2005',
    'Nombre Comercial:',
    'Datos del domicilio registrado',
    'Código Postal:11000 Tipo de Vialidad:',
    'Nombre de Vialidad: ALMENDROS Número Exterior: 118',
    'Número Interior:3ER PISO Nombre de la Colonia: LOMAS VERDES',
    'Nombre de la Localidad: Nombre del Municipio o Demarcación Territorial: BENITO JUAREZ',
    'Nombre de la Entidad Federativa: CIUDAD DE MEXICO Entre Calle:',
  ].join('\n'),
  [
    'Página [2] de [3]',
    'Y Calle:',
    'Actividades Económicas:',
    'Orden Actividad Económica Porcentaje Fecha Inicio Fecha Fin',
    '1 Socio o accionista 60 31/05/2015',
    '2 Asalariado 40 13/07/2015',
    'Regímenes:',
    'Régimen Fecha Inicio Fecha Fin',
    'Régimen de Ingresos por Dividendos (socios y accionistas) 01/07/2005',
    'Régimen de Sueldos y Salarios e Ingresos Asimilados a Salarios 13/07/2015',
    'Obligaciones:',
    'Descripción de la Obligación Descripción Vencimiento Fecha Inicio Fecha Fin',
    'Declaración informativa de IVA con la anual de ISR Conjuntamente con la declaración anual del',
    'ejercicio.',
    '13/05/2013',
  ].join('\n'),
  'Página [3] de [3]',
];

/**
 * Persona MORAL — **estructura EXACTA de la constancia real**, anonimizada. Trampas propias:
 *  • `Número Interior:` VACÍO pegado a `Nombre de la Colonia:` en la misma línea.
 *  • ⭐ El valor del municipio viene PARTIDO en dos líneas ("TLALNEPANTLA DE" / "BAZ").
 *  • Localidad y municipio traen EL MISMO texto (el domicilio no debe repetirlo).
 *  • `Denominación/Razón Social`, `Régimen Capital` y `Nombre Comercial` CON valor.
 *  • UN solo régimen.
 */
const MORAL_PAGINAS = [
  [
    'Página [1] de [2]',
    'CÉDULA DE IDENTIFICACIÓN FISCAL',
    'TDV010203AB1',
    'Registro Federal de Contribuyentes',
    'TEXTILES DEL VALLE',
    'Nombre, denominación o razón',
    'social',
    'idCIF: 20000000002',
    'VALIDA TU INFORMACIÓN',
    'FISCAL',
    'CONSTANCIA DE SITUACIÓN FISCAL',
    'Lugar y Fecha de Emisión',
    'TLALNEPANTLA DE BAZ , MEXICO A 06 DE MAYO',
    'DE 2026',
    'TDV010203AB1',
    'Datos de Identificación del Contribuyente:',
    'RFC: TDV010203AB1',
    'Denominación/Razón Social: TEXTILES DEL VALLE',
    'Régimen Capital: SOCIEDAD ANONIMA DE CAPITAL VARIABLE',
    'Nombre Comercial: TEXTILES DEL VALLE',
    'Fecha inicio de operaciones: 03 DE FEBRERO DE 2001',
    'Estatus en el padrón: ACTIVO',
    'Fecha de último cambio de estado: 03 DE FEBRERO DE 2001',
    'Datos del domicilio registrado',
    'Código Postal:54080 Tipo de Vialidad: CALLE',
    'Nombre de Vialidad: LERDO DE TEJADA Número Exterior: 27',
    'Número Interior: Nombre de la Colonia: CENTRO INDUSTRIAL',
    'Nombre de la Localidad: TLALNEPANTLA DE BAZ Nombre del Municipio o Demarcación Territorial: TLALNEPANTLA DE',
    'BAZ',
    'Nombre de la Entidad Federativa: MEXICO Entre Calle: PONIENTE 8',
    'Y Calle: NORTE 3',
    'Actividades Económicas:',
  ].join('\n'),
  [
    'Página [2] de [2]',
    'Orden Actividad Económica Porcentaje Fecha Inicio Fecha Fin',
    '1 Comercio al por mayor de ropa 100 03/02/2001',
    'Regímenes:',
    'Régimen Fecha Inicio Fecha Fin',
    'Régimen General de Ley Personas Morales 03/02/2001',
    'Obligaciones:',
    'Descripción de la Obligación Descripción Vencimiento Fecha Inicio Fecha Fin',
    'Pago definitivo mensual de IVA. A más tardar el día 17 del mes inmediato',
    'posterior al periodo que corresponda.',
    '03/02/2001',
  ].join('\n'),
];

describe('valorEntreEtiquetas — el corte va en la SIGUIENTE etiqueta, no en el fin de línea', () => {
  const texto = FISICA_PAGINAS.join('\n');

  it('⭐ un campo etiquetado VACÍO devuelve vacío, NO el texto de la etiqueta de al lado', () => {
    // Éste es EL defecto invisible: cortar por fin de línea daría 'Nombre de Vialidad: ALMENDROS'.
    expect(valorEntreEtiquetas(texto, 'Tipo de Vialidad')).toBe('');
    expect(valorEntreEtiquetas(texto, 'Nombre de Vialidad')).toBe('ALMENDROS');
  });

  it('⭐ la localidad VACÍA no se traga la etiqueta LARGA del municipio (el defecto real)', () => {
    expect(valorEntreEtiquetas(texto, 'Nombre de la Localidad')).toBe('');
    expect(valorEntreEtiquetas(texto, 'Nombre del Municipio o Demarcaci[oó]n Territorial')).toBe(
      'BENITO JUAREZ',
    );
  });

  it('en la moral lee el régimen capital y el nombre comercial sin arrastrar la etiqueta vecina', () => {
    const moral = MORAL_PAGINAS.join('\n');
    expect(valorEntreEtiquetas(moral, 'R[eé]gimen Capital')).toBe(
      'SOCIEDAD ANONIMA DE CAPITAL VARIABLE',
    );
    expect(valorEntreEtiquetas(moral, 'Nombre Comercial')).toBe('TEXTILES DEL VALLE');
  });

  it('⭐ el `Nombre Comercial` VACÍO de la física no se come el encabezado de sección siguiente', () => {
    // `Datos del domicilio registrado` NO lleva dos puntos en el papel real: si no se le reconoce
    // como corte, el nombre comercial se lo traga.
    expect(valorEntreEtiquetas(texto, 'Nombre Comercial')).toBe('');
  });

  it('⭐ un campo PARTIDO entre páginas se lee (todo el documento se concatena antes de recortar)', () => {
    // `Entre Calle:` cierra la página 1 y `Y Calle:` abre la 2 — en el papel real los dos vienen
    // VACÍOS. Parsear página por página dejaría `Entre Calle` sin freno y se tragaría la página
    // entera; cortar por fin de línea metería el encabezado de la sección siguiente en `Y Calle`.
    expect(valorEntreEtiquetas(texto, 'Entre Calle')).toBe('');
    expect(valorEntreEtiquetas(texto, 'Y Calle')).toBe('');
  });

  it('en la MORAL, `Entre Calle` y `Y Calle` sí traen valor y no se pisan', () => {
    const moral = MORAL_PAGINAS.join('\n');
    expect(valorEntreEtiquetas(moral, 'Entre Calle')).toBe('PONIENTE 8');
    expect(valorEntreEtiquetas(moral, 'Y Calle')).toBe('NORTE 3');
  });

  it('⭐ el valor PARTIDO en dos líneas se recompone (municipio de la moral)', () => {
    const moral = MORAL_PAGINAS.join('\n');
    expect(valorEntreEtiquetas(moral, 'Nombre del Municipio o Demarcaci[oó]n Territorial')).toBe(
      'TLALNEPANTLA DE BAZ',
    );
  });

  it('una etiqueta que no está devuelve vacío (no truena)', () => {
    expect(valorEntreEtiquetas(texto, 'Tipo de Inmueble')).toBe('');
  });
});

describe('parsearTextoConstancia — persona FÍSICA (estructura del PDF real)', () => {
  const r = parsearTextoConstancia(FISICA_PAGINAS);

  it('la reconoce como física por el CURP', () => {
    expect(r.tipoPersona).toBe('fisica');
    expect(r.curp).toBe('GORL850214MDFMVR09');
  });

  it('lee el RFC (el de la cédula y el del bloque de identificación son el mismo)', () => {
    expect(r.rfc).toBe('GORL850214J38');
  });

  it('COMPONE la razón social con nombre y apellidos (el SAT no la imprime)', () => {
    expect(r.razonSocial).toBe('LAURA GOMEZ RIVAS');
  });

  it('⭐ arma el domicilio SIN que se cuele la etiqueta del municipio', () => {
    expect(r.direccion).toBe(
      'ALMENDROS No. 118 Int. 3ER PISO, Col. LOMAS VERDES, BENITO JUAREZ, CIUDAD DE MEXICO, ' +
        'C.P. 11000',
    );
    // La regresión, dicha con todas sus letras: éste es el texto que salía antes.
    expect(r.direccion).not.toContain('Nombre del Municipio');
    expect(r.direccion).not.toContain('Demarcación Territorial');
    expect(r.direccion).not.toContain('Nombre de Vialidad');
  });

  it('lee el código postal aunque venga SIN espacio tras los dos puntos', () => {
    expect(r.codigoPostalExpedicion).toBe('11000');
  });

  it('⭐ propone LOS DOS regímenes (no toma el primero en silencio) y avisa', () => {
    expect(r.regimenes).toEqual([
      { clave: '605', descripcion: 'Sueldos y Salarios e Ingresos Asimilados a Salarios' },
      { clave: '611', descripcion: 'Ingresos por Dividendos (socios y accionistas)' },
    ]);
    expect(r.advertencias.some((a) => a.includes('2 regímenes'))).toBe(true);
  });

  it('no avisa de ninguna etiqueta colada: el corte fue limpio en todos los campos', () => {
    expect(r.advertencias.filter((a) => a.includes('se coló la etiqueta'))).toEqual([]);
  });
});

describe('parsearTextoConstancia — persona MORAL (estructura del PDF real)', () => {
  const r = parsearTextoConstancia(MORAL_PAGINAS);

  it('la reconoce como moral (sin CURP) y lee la denominación tal cual', () => {
    expect(r.tipoPersona).toBe('moral');
    expect(r.curp).toBe('');
    expect(r.razonSocial).toBe('TEXTILES DEL VALLE');
  });

  it('⭐ arma el domicilio con el municipio PARTIDO en dos líneas, sin repetir la localidad', () => {
    expect(r.rfc).toBe('TDV010203AB1');
    expect(r.codigoPostalExpedicion).toBe('54080');
    expect(r.direccion).toBe(
      'CALLE LERDO DE TEJADA No. 27, Col. CENTRO INDUSTRIAL, TLALNEPANTLA DE BAZ, MEXICO, ' +
        'C.P. 54080',
    );
    expect(r.direccion).not.toContain('Nombre del Municipio');
  });

  it('el número interior VACÍO no arrastra la colonia de al lado', () => {
    expect(r.direccion).not.toContain('Int.');
    expect(r.direccion).toContain('Col. CENTRO INDUSTRIAL');
  });

  it('mapea el régimen 601 y NO avisa de nada', () => {
    expect(r.regimenes).toEqual([{ clave: '601', descripcion: 'General de Ley Personas Morales' }]);
    expect(r.advertencias).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⭐ LA RED: ningún valor puede llevar dentro el texto de otra etiqueta conocida
// ─────────────────────────────────────────────────────────────────────────────
//
// Vale más que la lista de etiquetas: cubre incluso los formatos que hoy no conocemos. Si el corte
// falla, el valor se recorta y se AVISA — nunca se guarda basura en silencio.
describe('red de seguridad: una etiqueta colada se detecta y se avisa', () => {
  it('etiquetaColada encuentra la etiqueta metida en un valor', () => {
    expect(etiquetaColada('MIGUEL HIDALGO')).toBeNull();
    expect(
      etiquetaColada('TLALNEPANTLA Nombre del Municipio o Demarcación Territorial: TLALNEPANTLA'),
    ).not.toBeNull();
  });

  it('NO se dispara con un texto que sólo PARECE etiqueta (sin dos puntos)', () => {
    // Una razón social o una calle pueden llevar la palabra sin ser una etiqueta.
    expect(etiquetaColada('INMOBILIARIA RFC DEL BAJIO SA')).toBeNull();
    expect(etiquetaColada('CALLE REGIMEN 12')).toBeNull();
  });

  it('⭐ ante una etiqueta que el lector NO conoce, recorta y AVISA en vez de guardar basura', () => {
    // `Nombre de la Sub-Localidad:` es inventada: simula un formato nuevo del SAT. El corte
    // principal no la conoce, así que el valor de la colonia se la traga… y la red lo caza porque
    // ARRASTRA además una etiqueta que sí conocemos.
    const raro = [
      'Código Postal:11000 Tipo de Vialidad:',
      'Nombre de Vialidad: ALMENDROS Número Exterior: 118',
      'Nombre de la Colonia: LOMAS VERDES Nombre de la Sub-Localidad: Nombre de la Entidad Federativa: CIUDAD DE MEXICO',
      'Regímenes:',
      'Régimen General de Ley Personas Morales 01/01/2020',
      'Obligaciones:',
    ].join('\n');
    const r = parsearTextoConstancia([raro]);

    const aviso = r.advertencias.find((a) => a.includes('se coló la etiqueta'));
    expect(aviso).toBeDefined();
    expect(aviso).toContain('colonia');
    // Y lo importante: la etiqueta NO acabó dentro del domicilio.
    expect(r.direccion).not.toContain('Nombre de la Entidad Federativa');
    expect(r.direccion).toContain('Col. LOMAS VERDES');
  });
});

describe('degradar con gracia (nunca bloquear el alta)', () => {
  it('un documento sin regímenes reconocibles devuelve el texto crudo y avisa', () => {
    const raro = [
      'RFC: XAXX010101000',
      'Denominación/Razón Social: LO QUE SEA SA',
      'Código Postal: 11000',
      'Nombre de Vialidad: REFORMA',
      'Regímenes:',
      'Régimen Fecha Inicio Fecha Fin',
      'Régimen Marciano de Nueva Creación 01/01/2030',
      'Obligaciones:',
    ].join('\n');
    const r = parsearTextoConstancia([raro]);
    expect(r.regimenes).toHaveLength(1);
    expect(r.regimenes[0]?.clave).toBe('');
    expect(r.regimenes[0]?.descripcion).toContain('Marciano');
    expect(r.advertencias.some((a) => a.includes('catálogo del SAT'))).toBe(true);
  });

  it('un texto sin nada de constancia devuelve vacíos y advertencias, no una excepción', () => {
    const r = parsearTextoConstancia(['Esto es una factura cualquiera. Total: $1,234.00']);
    expect(r.rfc).toBe('');
    expect(r.razonSocial).toBe('');
    expect(r.advertencias.length).toBeGreaterThanOrEqual(3);
  });

  it('sin bloque de regímenes devuelve lista vacía', () => {
    expect(parsearRegimenes('RFC: XAXX010101000')).toEqual([]);
  });
});

describe('el catálogo del SAT no se confunde entre regímenes parecidos', () => {
  it('«Plataformas Tecnológicas» es 625, no 612', () => {
    const t =
      'Regímenes: Régimen de las Actividades Empresariales con ingresos a través de ' +
      'Plataformas Tecnológicas 01/01/2020 Obligaciones:';
    expect(parsearRegimenes(t)).toEqual([
      {
        clave: '625',
        descripcion: 'Actividades Empresariales con ingresos a través de Plataformas Tecnológicas',
      },
    ]);
  });

  it('reconoce el régimen aunque el papel venga sin acentos', () => {
    const t = 'Regimenes: Regimen Simplificado de Confianza 01/01/2022 Obligaciones:';
    expect(parsearRegimenes(t)).toEqual([
      { clave: '626', descripcion: 'Régimen Simplificado de Confianza' },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Un dato fiscal DUDOSO se avisa, nunca se guarda callado (§Post-F9.55)
// ─────────────────────────────────────────────────────────────────────────────
describe('el CP y el RFC dudosos avisan en vez de colarse', () => {
  /** Arma un documento mínimo legible con el CP y el RFC que se le pidan. */
  function conFiscales(rfc: string, cp: string): string {
    return [
      `RFC: ${rfc}`,
      'Denominación/Razón Social: TEXTILES DEL VALLE',
      `Código Postal:${cp} Tipo de Vialidad: CALLE`,
      'Nombre de Vialidad: LERDO DE TEJADA Número Exterior: 27',
      'Regímenes:',
      'Régimen General de Ley Personas Morales 01/01/2020',
      'Obligaciones:',
    ].join('\n');
  }

  it('⭐ un CP con MÁS de 5 dígitos avisa (antes se recortaba en silencio a 5)', () => {
    const r = parsearTextoConstancia([conFiscales('TDV010203AB1', '540001')]);
    expect(r.advertencias.some((a) => a.includes('no tiene 5 dígitos'))).toBe(true);
  });

  it('⭐ un CP con basura entre los dígitos avisa (no se "limpia" a un CP que nadie escribió)', () => {
    const r = parsearTextoConstancia([conFiscales('TDV010203AB1', '04-5400-9')]);
    expect(r.advertencias.some((a) => a.includes('no tiene 5 dígitos'))).toBe(true);
  });

  it('un CP correcto de 5 dígitos NO avisa', () => {
    const r = parsearTextoConstancia([conFiscales('TDV010203AB1', '54080')]);
    expect(r.codigoPostalExpedicion).toBe('54080');
    expect(r.advertencias.filter((a) => a.includes('código postal'))).toEqual([]);
  });

  it('⭐ un RFC con texto pegado avisa (el corte se llevó algo de más)', () => {
    const r = parsearTextoConstancia([conFiscales('TDV010203AB1VIGENTEDESDE2001', '54080')]);
    expect(r.advertencias.some((a) => a.includes('no tiene la forma esperada'))).toBe(true);
  });

  it('los RFC válidos de moral (12) y de física (13) NO avisan', () => {
    for (const rfc of ['TDV010203AB1', 'GORL850214J38']) {
      const r = parsearTextoConstancia([conFiscales(rfc, '54080')]);
      expect(r.advertencias.filter((a) => a.includes('forma esperada'))).toEqual([]);
    }
  });
});
