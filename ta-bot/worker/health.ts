export type StatusProvider = () => Record<string, unknown>;

/** Tiny HTTP server for Fly health checks and quick ops introspection. */
export function startHealthServer(port: number, status: StatusProvider): Deno.HttpServer {
  return Deno.serve({ port, hostname: "0.0.0.0", onListen: () => {} }, (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/health" || url.pathname === "/") {
      const body = status();
      const healthy = body.healthy !== false;
      return Response.json(body, { status: healthy ? 200 : 503 });
    }
    return new Response("not found", { status: 404 });
  });
}
