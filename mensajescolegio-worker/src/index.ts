import { Hono } from "hono";
import type { Env } from "./types";

// Re-export DO class so wrangler finds it
export { SieWebSession } from "./sieweb-session";

// ---------------------------------------------------------------------------
// Hono app
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Middleware: X-API-Key validation
// ---------------------------------------------------------------------------

app.use("*", async (c, next) => {
  // Skip API key check for OPTIONS (CORS preflight)
  if (c.req.method === "OPTIONS") {
    return next();
  }

  const apiKey = c.req.header("X-API-Key");
  if (!apiKey || apiKey !== c.env.HERMES_API_KEY) {
    return c.json({ detail: "Invalid API Key" }, 403);
  }

  return next();
});

// ---------------------------------------------------------------------------
// Helper: get DO stub
// ---------------------------------------------------------------------------

function getStub(env: Env) {
  return env.SIEWEB_SESSION.getByName(env.SIEWEB_SCHOOL);
}

// ---------------------------------------------------------------------------
// GET /status
// ---------------------------------------------------------------------------

app.get("/status", async (c) => {
  const stub = getStub(c.env);
  const status = await stub.getStatus();
  return c.json(status);
});

// ---------------------------------------------------------------------------
// GET /mensajes?limit=20&folder_id=1&only_unread=false
// ---------------------------------------------------------------------------

app.get("/mensajes", async (c) => {
  const limit = Number(c.req.query("limit") ?? "20");
  const folderId = Number(c.req.query("folder_id") ?? "1");
  const onlyUnread = c.req.query("only_unread") === "true";

  const stub = getStub(c.env);

  try {
    const mensajes = await stub.getMensajes(limit, folderId, onlyUnread);
    return c.json(mensajes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ detail: message }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /mensajes/:id?folder_id=1
// ---------------------------------------------------------------------------

app.get("/mensajes/:id", async (c) => {
  const messageId = Number(c.req.param("id"));
  const folderId = Number(c.req.query("folder_id") ?? "1");

  const stub = getStub(c.env);
  const detail = await stub.getMensajeDetalle(messageId, folderId);

  if (!detail) {
    return c.json({ detail: "Message not found" }, 404);
  }

  return c.json(detail);
});

// ---------------------------------------------------------------------------
// GET /mensajes/:id/adjuntos/:attachment_id
// ---------------------------------------------------------------------------

app.get("/mensajes/:id/adjuntos/:attachment_id", async (c) => {
  const messageId = Number(c.req.param("id"));
  const attachmentId = Number(c.req.param("attachment_id"));

  const stub = getStub(c.env);

  // First get message detail to find the filename (same as original Python)
  const detail = await stub.getMensajeDetalle(messageId, 1);
  let filename = "attachment";
  if (detail?.adjuntos) {
    const match = detail.adjuntos.find((a) => a.id_adjunto === attachmentId);
    if (match) {
      filename = match.nombre;
    }
  }

  try {
    const response = await stub.downloadAttachment(attachmentId);
    const body = await response.arrayBuffer();

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ detail: `Download failed: ${message}` }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /mensajes/:id/leer?folder_id=1&original_folder_id=1&read=true
// ---------------------------------------------------------------------------

app.post("/mensajes/:id/leer", async (c) => {
  const messageId = Number(c.req.param("id"));
  const folderId = Number(c.req.query("folder_id") ?? "1");
  const originalFolderId = Number(c.req.query("original_folder_id") ?? "1");
  const read = c.req.query("read") !== "false";

  const stub = getStub(c.env);
  const success = await stub.marcarLeido(messageId, folderId, originalFolderId, read);

  if (!success) {
    return c.json(
      { detail: "Failed to update message status on SieWeb" },
      500
    );
  }

  return c.json({ message: "Status updated successfully" });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export default app;
