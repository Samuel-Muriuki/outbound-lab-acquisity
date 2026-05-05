import { NextResponse, type NextRequest } from "next/server";
import { getSessionId } from "@/lib/session/cookie";
import { deleteRun } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/research/[id]
 *
 * Lets the *original creator* of a run delete it without logging in.
 * Ownership is established via the `outboundlab_sid` HttpOnly cookie
 * that's set on POST /api/research and stored on each row's
 * `creator_session_id` column.
 *
 * Contract:
 *   204 → run deleted
 *   400 → bad UUID shape in the path
 *   401 → no session cookie present (visitor never created any run)
 *   403 → cookie present but doesn't match this row's creator
 *   404 → no row with that id
 *   500 → DB / config error
 *
 * The lookup-then-delete in `deleteRun` is racy in the abstract but
 * fine here: the only mutation path on `creator_session_id` is the
 * insert (it's never updated), so a concurrent change is impossible.
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    return NextResponse.json({ error: "Invalid run id." }, { status: 400 });
  }

  const sessionId = await getSessionId();
  if (!sessionId) {
    return NextResponse.json(
      { error: "No session — you can only delete runs you created in this browser." },
      { status: 401 }
    );
  }

  let result;
  try {
    result = await deleteRun(id, sessionId);
  } catch (err) {
    console.error(
      "[DELETE /api/research/[id]] deleteRun threw:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "Could not delete this run. Try again." },
      { status: 500 }
    );
  }

  if (result === "not_found") {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }
  if (result === "forbidden") {
    return NextResponse.json(
      { error: "You can only delete runs you created." },
      { status: 403 }
    );
  }

  return new NextResponse(null, { status: 204 });
}
