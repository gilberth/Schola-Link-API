import type {
  Mensaje,
  MensajeDetalle,
  Destinatario,
  Adjunto,
  RawMensaje,
  RawMensajeDetalle,
  RawDestinatario,
  RawAdjunto,
} from "./types";

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

export function buildBaseUrl(school: string): string {
  return `https://${school.trim().toLowerCase()}.sieweb.com.pe/lms`;
}

// ---------------------------------------------------------------------------
// Request payload builders
// ---------------------------------------------------------------------------

export function buildLoginPayload(user: string, pass: string) {
  return { user, pass, token: "", isMobil: false };
}

export function buildRefreshPayload(refreshToken: string) {
  return { token: refreshToken, modulo: "intranet", isMobil: false };
}

export function buildMarkReadPayload(
  messageId: number,
  folderId: number,
  originalFolderId: number,
  read: boolean
) {
  return {
    idMensaje: messageId,
    idActual: folderId,
    idOri: originalFolderId,
    lectura: read,
  };
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Content-Type": "application/json",
  Accept: "application/json, text/plain, */*",
};

export function buildSiewebHeaders(
  token: string,
  usucod: string
): Record<string, string> {
  return {
    ...DEFAULT_HEADERS,
    "sie-token": token,
    "x-usucod": usucod,
  };
}

export function buildUnauthHeaders(): Record<string, string> {
  return { ...DEFAULT_HEADERS };
}

// ---------------------------------------------------------------------------
// SieWeb endpoint URLs
// ---------------------------------------------------------------------------

export function loginUrl(baseUrl: string): string {
  return `${baseUrl}/api/login/Ingresar`;
}

export function refreshUrl(baseUrl: string): string {
  return `${baseUrl}/api/login/refresh`;
}

export function mensajesUrl(baseUrl: string): string {
  return `${baseUrl}/api/HyoMensajeria/obtMensajes`;
}

export function detalleUrl(baseUrl: string): string {
  return `${baseUrl}/api/HyoMensajeria/obtDetalle`;
}

export function adjuntoUrl(
  baseUrl: string,
  attachmentId: number,
  token: string
): string {
  return `${baseUrl}/api/HyoMsjAdjunto/archivo/${attachmentId}?access_token=${token}`;
}

export function marcarLecturaUrl(baseUrl: string): string {
  return `${baseUrl}/api/HyoMsjusuariotipo/cambiarLectura`;
}

// ---------------------------------------------------------------------------
// Query string builder (for GET requests with params)
// ---------------------------------------------------------------------------

export function buildMensajesQueryString(
  folderId: number,
  segment: number,
  onlyUnread: boolean
): string {
  const params = new URLSearchParams();
  params.set("idCarpeta", String(folderId));
  if (segment > 0) {
    params.set("segmento", String(segment));
  }
  if (onlyUnread) {
    params.set("filter", JSON.stringify({ lectura: "noLeido" }));
  }
  return params.toString();
}

export function buildDetalleQueryString(
  folderId: number,
  messageId: number
): string {
  const params = new URLSearchParams();
  params.set("carpeta", String(folderId));
  params.set("idMensaje", String(messageId));
  return params.toString();
}

// ---------------------------------------------------------------------------
// Response parsers
// ---------------------------------------------------------------------------

export function parseMensaje(raw: RawMensaje): Mensaje {
  return {
    id_mensaje: raw.ID_MENSAJERIA,
    id_msj_carpeta_usuario: raw.ID_MSJ_CARPETA_USUARIO,
    asunto: raw.ASUNTO,
    fecha_envio: raw.FH_ENVIO,
    leido: raw.LECTURA === 1,
    emisor_nombre: raw.EMISORNOM,
    emisor_codigo: raw.USUCOD,
    tiene_adjunto: raw.ADJUNTO === 1,
    original_folder_id: raw.ID_MSJ_CARPETA_ORI,
  };
}

export function parseDestinatario(raw: RawDestinatario): Destinatario {
  return {
    usuario_codigo: raw.USUCOD,
    tipo: raw.TIPO,
    usuario_nombre: raw.USUNOM,
    leido: raw.LECTURA === 1,
    fecha_lectura: raw.FH_LECTURA ?? null,
  };
}

export function parseAdjunto(raw: RawAdjunto): Adjunto {
  return {
    id_adjunto: raw.ID_MSJ_ADJUNTO,
    nombre: raw.NOMBRE,
    extension: raw.EXTENSION,
    url_relativa: raw.ADJUNTO,
    es_enlace: raw.esEnlace ?? false,
  };
}

export function parseMensajeDetalle(
  mensajeData: RawMensajeDetalle,
  destinatariosList: RawDestinatario[]
): MensajeDetalle {
  const adjuntosRaw = mensajeData.ADJUNTO;
  const adjuntos: Adjunto[] = Array.isArray(adjuntosRaw)
    ? adjuntosRaw.map(parseAdjunto)
    : [];

  return {
    id_mensaje: mensajeData.ID_MENSAJERIA,
    asunto: mensajeData.ASUNTO,
    fecha_envio: mensajeData.FH_ENVIO,
    emisor_nombre: mensajeData.USUNOM,
    emisor_codigo: mensajeData.USUCOD,
    contenido_html: mensajeData.MENSAJE,
    referencia_alumno: mensajeData.REFERENCIA_ALUMNO ?? null,
    destinatarios: destinatariosList.map(parseDestinatario),
    adjuntos,
  };
}
