/**
 * Error de datos: el archivo que subieron esta mal, no el modulo.
 *
 * Existe para que la API responda 400 y no 500. Antes se distinguia por el
 * texto del mensaje, lo que amarraba el ruteo al idioma de la interfaz: al
 * traducir los mensajes al ingles, un archivo malo empezo a responder 500.
 */
export class ErrorDeDatos extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorDeDatos';
  }
}
