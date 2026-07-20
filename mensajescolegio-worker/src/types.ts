import type { SieWebSession } from "./sieweb-session";

// ---------------------------------------------------------------------------
// Cloudflare Worker environment bindings
// ---------------------------------------------------------------------------
export interface Env {
  SIEWEB_SESSION: DurableObjectNamespace<SieWebSession>;
  SIEWEB_SCHOOL: string;
  SIEWEB_USER: string;
  SIEWEB_PASS: string;
  HERMES_API_KEY: string;
}

// ---------------------------------------------------------------------------
// SieWeb session state (kept in-memory inside the Durable Object)
// ---------------------------------------------------------------------------
export interface SessionState {
  token: string | null;
  refreshToken: string | null;
  usucod: string | null;
}

// ---------------------------------------------------------------------------
// API response models — field names match the original Python API exactly
// (snake_case) so Hermes doesn't need any changes.
// ---------------------------------------------------------------------------

export interface Mensaje {
  id_mensaje: number;
  id_msj_carpeta_usuario: number;
  asunto: string;
  fecha_envio: string;
  leido: boolean;
  emisor_nombre: string;
  emisor_codigo: string;
  tiene_adjunto: boolean;
  original_folder_id: number;
}

export interface Destinatario {
  usuario_codigo: string;
  tipo: string;
  usuario_nombre: string;
  leido: boolean;
  fecha_lectura: string | null;
}

export interface Adjunto {
  id_adjunto: number;
  nombre: string;
  extension: string;
  url_relativa: string;
  es_enlace: boolean;
}

export interface MensajeDetalle {
  id_mensaje: number;
  asunto: string;
  fecha_envio: string;
  emisor_nombre: string;
  emisor_codigo: string;
  contenido_html: string;
  referencia_alumno: string | null;
  destinatarios: Destinatario[];
  adjuntos: Adjunto[];
}

// ---------------------------------------------------------------------------
// Raw SieWeb API shapes (UPPER_CASE keys as returned by the portal)
// ---------------------------------------------------------------------------

export interface RawMensaje {
  ID_MENSAJERIA: number;
  ID_MSJ_CARPETA_USUARIO: number;
  ASUNTO: string;
  FH_ENVIO: string;
  LECTURA: number | null;
  EMISORNOM: string;
  USUCOD: string;
  ADJUNTO: number | null;
  ID_MSJ_CARPETA_ORI: number;
}

export interface RawDestinatario {
  USUCOD: string;
  TIPO: string;
  USUNOM: string;
  LECTURA: number | null;
  FH_LECTURA: string | null;
}

export interface RawAdjunto {
  ID_MSJ_ADJUNTO: number;
  NOMBRE: string;
  EXTENSION: string;
  ADJUNTO: string;
  esEnlace?: boolean;
}

export interface RawMensajeDetalle {
  ID_MENSAJERIA: number;
  ASUNTO: string;
  FH_ENVIO: string;
  USUNOM: string;
  USUCOD: string;
  MENSAJE: string;
  REFERENCIA_ALUMNO?: string | null;
  ADJUNTO?: RawAdjunto[] | number | null;
}
