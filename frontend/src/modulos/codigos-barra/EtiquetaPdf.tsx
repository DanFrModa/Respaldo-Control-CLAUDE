import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';

import type { ModeloCodigosBarra } from '@/api/modelos';

import { aPngDataUrl } from './bwip';

/**
 * Impreso PDF de la etiqueta de códigos de barra de un modelo (F1-E5, R9 — el PRIMER
 * impreso del sistema, decisión de Gabriel). Es un PDF de `@react-pdf/renderer` (stack v4):
 * los códigos de barra se incrustan como imágenes PNG (bwip-js → data-URL → `<Image>`), porque
 * react-pdf no dibuja barras por sí solo. Una página por etiqueta, con el nombre de la empresa,
 * el modelo y los dos códigos (EAN-13 y DUN-14) con su número legible.
 *
 * El PNG se genera en el momento de construir el documento (puro, sin red): el botón de la
 * pantalla pasa los `datos` ya resueltos del backend.
 */

const estilos = StyleSheet.create({
  pagina: {
    paddingVertical: 36,
    paddingHorizontal: 48,
    fontFamily: 'Helvetica',
    fontSize: 11,
    color: '#0f172a',
  },
  encabezado: {
    borderBottomWidth: 1,
    borderBottomColor: '#0d9488',
    paddingBottom: 8,
    marginBottom: 20,
  },
  empresa: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#0d9488' },
  subtitulo: { fontSize: 9, color: '#64748b', marginTop: 2 },
  filaDatos: { flexDirection: 'row', marginBottom: 16 },
  campo: { marginRight: 32 },
  etiquetaCampo: { fontSize: 8, color: '#64748b', textTransform: 'uppercase' },
  valorCampo: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  bloqueCodigo: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 6,
    padding: 16,
    alignItems: 'center',
  },
  tituloCodigo: {
    fontSize: 9,
    color: '#64748b',
    textTransform: 'uppercase',
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  imagenEan: { width: 220, height: 120, objectFit: 'contain' },
  imagenDun: { width: 300, height: 110, objectFit: 'contain' },
  pie: { marginTop: 28, fontSize: 7, color: '#94a3b8', textAlign: 'center' },
});

/** Props del documento PDF. */
interface EtiquetaPdfProps {
  datos: ModeloCodigosBarra;
}

/**
 * Documento PDF de la etiqueta. Se entrega a `pdf(<EtiquetaPdf datos=… />)` para descargar.
 * Las imágenes de barras se generan aquí (síncrono): EAN-13 e ITF-14 vía bwip-js.
 */
export function EtiquetaPdf({ datos }: EtiquetaPdfProps): React.JSX.Element {
  const pngEan = aPngDataUrl('ean13', datos.ean13, { escala: 4, altura: 14 });
  const pngDun = aPngDataUrl('itf14', datos.dun14, { escala: 4, altura: 12 });

  return (
    <Document
      title={`Códigos de barra ${datos.codigoModelo}`}
      author={datos.nombreEmpresa}
      subject="Etiqueta de códigos de barra"
    >
      <Page size="A4" style={estilos.pagina}>
        <View style={estilos.encabezado}>
          <Text style={estilos.empresa}>{datos.nombreEmpresa}</Text>
          <Text style={estilos.subtitulo}>Etiqueta de códigos de barra — CONTROL v2</Text>
        </View>

        <View style={estilos.filaDatos}>
          <View style={estilos.campo}>
            <Text style={estilos.etiquetaCampo}>Modelo</Text>
            <Text style={estilos.valorCampo}>{datos.codigoModelo}</Text>
          </View>
          <View style={estilos.campo}>
            <Text style={estilos.etiquetaCampo}>Prefijo UPC</Text>
            <Text style={estilos.valorCampo}>{datos.prefijo}</Text>
          </View>
        </View>

        <View style={estilos.bloqueCodigo}>
          <Text style={estilos.tituloCodigo}>EAN-13 (pieza)</Text>
          <Image style={estilos.imagenEan} src={pngEan} />
        </View>

        <View style={estilos.bloqueCodigo}>
          <Text style={estilos.tituloCodigo}>DUN-14 (caja)</Text>
          <Image style={estilos.imagenDun} src={pngDun} />
        </View>

        <Text style={estilos.pie}>
          Generado por CONTROL v2 · Prefijo de empresa {datos.prefijo} · EAN-13 {datos.ean13} ·
          DUN-14 {datos.dun14}
        </Text>
      </Page>
    </Document>
  );
}
