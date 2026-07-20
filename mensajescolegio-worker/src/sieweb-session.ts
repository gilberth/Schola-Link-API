import { DurableObject } from "cloudflare:workers";
import type { Env, SessionState, Mensaje, MensajeDetalle } from "./types";
import {
  buildBaseUrl,
  buildLoginPayload,
  buildRefreshPayload,
  buildSiewebHeaders,
  buildUnauthHeaders,
  buildMensajesQueryString,
  buildDetalleQueryString,
  buildMarkReadPayload,
  loginUrl,
  refreshUrl,
  mensajesUrl,
  detalleUrl,
  adjuntoUrl,
  marcarLecturaUrl,
  parseMensaje,
  parseMensajeDetalle,
} from "./sieweb-client";
import type { RawMensaje, RawDestinatario, RawMensajeDetalle } from "./types";

/**
 * SieWebSession Durable Object
 *
 * Manages the SieWeb authentication session (token, refreshToken, usucod)
 * with strong consistency. All authenticated requests to SieWeb are routed
 * through this DO so that concurrent token refreshes are serialized.
 *
 * State is kept in-memory only — if the DO evicts, the next request triggers
 * a fresh login (matching original Python behavior on process restart).
 */
export class SieWebSession extends DurableObject<Env> {
  private state: SessionState = {
    token: null,
    refreshToken: null,
    usucod: null,
  };

  // -------------------------------------------------------------------------
  // RPC: Authentication
  // -------------------------------------------------------------------------

  /**
   * Performs a full login against SieWeb, updating internal session state.
   * Returns true on success.
   */
  async login(): Promise<boolean> {
    const baseUrl = buildBaseUrl(this.env.SIEWEB_SCHOOL);
    const url = loginUrl(baseUrl);
    const payload = buildLoginPayload(this.env.SIEWEB_USER, this.env.SIEWEB_PASS);

    console.log(`[SieWebSession] Attempting login for user: ${this.env.SIEWEB_USER}`);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: buildUnauthHeaders(),
        body: JSON.stringify(payload),
      });

      if (res.status !== 200) {
        console.error(`[SieWebSession] Login failed with status: ${res.status}`);
        return false;
      }

      const data = (await res.json()) as { json?: Record<string, unknown> };
      const json = data.json ?? {};

      if ("error" in json) {
        const msg = (json.message as string) ?? "Unknown error";
        console.error(`[SieWebSession] Authentication failed: ${msg}`);
        return false;
      }

      const token = json.token as string | undefined;
      const refreshToken = json.refreshToken as string | undefined;
      const infoColegio = json.infoColegio as Record<string, unknown> | undefined;
      const usucod = infoColegio?.usucod as string | undefined;

      if (!token || !usucod) {
        console.error("[SieWebSession] Login succeeded but token or usucod missing");
        return false;
      }

      this.state = { token, refreshToken: refreshToken ?? null, usucod };
      console.log("[SieWebSession] Login successful");
      return true;
    } catch (err) {
      console.error(`[SieWebSession] Login error: ${err}`);
      return false;
    }
  }

  /**
   * Attempts to refresh the current token using the refresh token.
   * Returns true on success.
   */
  async refreshSession(): Promise<boolean> {
    if (!this.state.refreshToken) {
      console.warn("[SieWebSession] No refresh token available");
      return false;
    }

    const baseUrl = buildBaseUrl(this.env.SIEWEB_SCHOOL);
    const url = refreshUrl(baseUrl);
    const payload = buildRefreshPayload(this.state.refreshToken);

    console.log("[SieWebSession] Refreshing session token...");

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: buildSiewebHeaders(this.state.token!, this.state.usucod!),
        body: JSON.stringify(payload),
      });

      if (res.status !== 200) {
        console.warn(`[SieWebSession] Token refresh failed with status: ${res.status}`);
        return false;
      }

      const data = (await res.json()) as { json?: Record<string, unknown> };
      const json = data.json ?? {};

      const token = json.token as string | undefined;
      const refreshToken = json.refreshToken as string | undefined;

      if (!token) {
        console.warn("[SieWebSession] Refresh succeeded but no token returned");
        return false;
      }

      this.state.token = token;
      if (refreshToken) {
        this.state.refreshToken = refreshToken;
      }

      console.log("[SieWebSession] Token refreshed successfully");
      return true;
    } catch (err) {
      console.error(`[SieWebSession] Refresh error: ${err}`);
      return false;
    }
  }

  /**
   * Ensures the session is authenticated (lazy login).
   * Throws if authentication fails.
   */
  async ensureAuthenticated(): Promise<void> {
    if (!this.state.token) {
      console.log("[SieWebSession] No active token. Initiating login...");
      const ok = await this.login();
      if (!ok) {
        throw new Error("Authentication with SieWeb portal failed. Check server credentials.");
      }
    }
  }

  // -------------------------------------------------------------------------
  // RPC: Authenticated fetch with retry
  // -------------------------------------------------------------------------

  /**
   * Makes an authenticated fetch to SieWeb with automatic retry on 401/403.
   * Replicates the original _request_with_retry flow:
   *   1. Make request
   *   2. If 401/403 → try refresh, retry
   *   3. If refresh fails → try full login, retry
   *   4. If login fails → return the unauthorized response
   */
  private async authenticatedFetchRaw(
    method: string,
    url: string,
    body?: string
  ): Promise<Response> {
    await this.ensureAuthenticated();

    const makeRequest = (): Promise<Response> => {
      const headers = buildSiewebHeaders(this.state.token!, this.state.usucod!);
      const init: RequestInit = { method, headers };
      if (body) {
        init.body = body;
      }
      return fetch(url, init);
    };

    let response = await makeRequest();

    if (response.status === 401 || response.status === 403) {
      console.log("[SieWebSession] Got 401/403. Attempting token refresh...");

      if (await this.refreshSession()) {
        console.log("[SieWebSession] Retrying with refreshed token...");
        response = await makeRequest();
      } else {
        console.log("[SieWebSession] Refresh failed. Attempting full re-login...");
        if (await this.login()) {
          console.log("[SieWebSession] Retrying after full re-login...");
          response = await makeRequest();
        } else {
          console.error("[SieWebSession] Auto re-login failed.");
        }
      }
    }

    return response;
  }

  // -------------------------------------------------------------------------
  // RPC: High-level API methods
  // -------------------------------------------------------------------------

  /**
   * Returns current session status info.
   */
  async getStatus(): Promise<{ status: string; school: string; username: string }> {
    return {
      status: "online",
      school: this.env.SIEWEB_SCHOOL,
      username: this.env.SIEWEB_USER ?? "Not configured",
    };
  }

  /**
   * Fetches messages with pagination by segment, replicating get_mensajes logic.
   */
  async getMensajes(
    limit: number,
    folderId: number,
    onlyUnread: boolean
  ): Promise<Mensaje[]> {
    const baseUrl = buildBaseUrl(this.env.SIEWEB_SCHOOL);
    const base = mensajesUrl(baseUrl);
    const retrieved: Mensaje[] = [];
    let segment = 0;

    while (retrieved.length < limit) {
      const qs = buildMensajesQueryString(folderId, segment, onlyUnread);
      const url = `${base}?${qs}`;

      console.log(
        `[SieWebSession] Fetching messages segment ${segment} (so far: ${retrieved.length})`
      );

      const res = await this.authenticatedFetchRaw("GET", url);

      if (res.status !== 200) {
        console.error(`[SieWebSession] Failed to fetch messages (status: ${res.status})`);
        break;
      }

      const data = (await res.json()) as { json?: RawMensaje[] };
      const messagesList = data.json ?? [];

      if (messagesList.length === 0) {
        break;
      }

      for (const raw of messagesList) {
        try {
          retrieved.push(parseMensaje(raw));
        } catch (err) {
          console.warn(`[SieWebSession] Error parsing message: ${err}`);
        }
        if (retrieved.length >= limit) {
          break;
        }
      }

      segment++;
    }

    return retrieved.slice(0, limit);
  }

  /**
   * Fetches complete message detail.
   */
  async getMensajeDetalle(
    messageId: number,
    folderId: number
  ): Promise<MensajeDetalle | null> {
    const baseUrl = buildBaseUrl(this.env.SIEWEB_SCHOOL);
    const base = detalleUrl(baseUrl);
    const qs = buildDetalleQueryString(folderId, messageId);
    const url = `${base}?${qs}`;

    console.log(`[SieWebSession] Fetching detail for message ID: ${messageId}`);

    const res = await this.authenticatedFetchRaw("GET", url);

    if (res.status !== 200) {
      console.error(`[SieWebSession] Failed to fetch message detail (status: ${res.status})`);
      return null;
    }

    const data = (await res.json()) as {
      mensaje?: RawMensajeDetalle;
      destinatarios?: RawDestinatario[];
    };

    if (!data.mensaje) {
      console.error(`[SieWebSession] No message data returned for ID: ${messageId}`);
      return null;
    }

    try {
      return parseMensajeDetalle(data.mensaje, data.destinatarios ?? []);
    } catch (err) {
      console.error(`[SieWebSession] Error compiling message detail: ${err}`);
      return null;
    }
  }

  /**
   * Downloads an attachment binary. Returns the Response directly
   * so the Worker can stream it to the client.
   */
  async downloadAttachment(attachmentId: number): Promise<Response> {
    await this.ensureAuthenticated();
    const baseUrl = buildBaseUrl(this.env.SIEWEB_SCHOOL);
    const url = adjuntoUrl(baseUrl, attachmentId, this.state.token!);

    console.log(`[SieWebSession] Downloading attachment ID: ${attachmentId}`);

    const res = await this.authenticatedFetchRaw("GET", url);

    if (res.status !== 200) {
      throw new Error(
        `Failed to download attachment ID ${attachmentId} (status: ${res.status})`
      );
    }

    return res;
  }

  /**
   * Marks a message as read or unread.
   */
  async marcarLeido(
    messageId: number,
    folderId: number,
    originalFolderId: number,
    read: boolean
  ): Promise<boolean> {
    const baseUrl = buildBaseUrl(this.env.SIEWEB_SCHOOL);
    const url = marcarLecturaUrl(baseUrl);
    const payload = buildMarkReadPayload(messageId, folderId, originalFolderId, read);

    console.log(
      `[SieWebSession] Marking message ${messageId} as ${read ? "read" : "unread"}`
    );

    const res = await this.authenticatedFetchRaw("POST", url, JSON.stringify(payload));

    if (res.status === 200) {
      const data = (await res.json()) as { json?: { mensaje?: string } };
      if (data.json?.mensaje === "m0001") {
        return true;
      }
    }

    console.warn(`[SieWebSession] Failed to update message read status`);
    return false;
  }
}
