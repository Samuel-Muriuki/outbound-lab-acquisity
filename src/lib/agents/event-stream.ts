import type { StreamEvent } from "./stream-events";

/**
 * Producer-consumer event stream for the orchestrator.
 *
 * The agents accept a synchronous `emit(event)` callback (because that's
 * the natural pattern when a tool finishes mid-loop). The orchestrator
 * needs to expose those events as an async iterator so the route handler
 * can pipe them straight into a ReadableStream as SSE frames — without
 * waiting for an entire agent to finish before any event ships.
 *
 * This helper bridges the two:
 *   - emit(event)  — synchronous; queues the event and wakes any waiting consumer
 *   - close()      — signals end-of-stream
 *   - Symbol.asyncIterator — for-await yields events as they arrive
 *
 * Usage in the orchestrator:
 *
 *   const stream = createEventStream();
 *   const work = (async () => {
 *     try { ... agents call stream.emit(e) ... }
 *     finally { stream.close(); }
 *   })();
 *   for await (const event of stream) yield event;
 *   await work;  // surface any error from the agent work
 */
export function createEventStream() {
  const queue: StreamEvent[] = [];
  let pendingResolve: ((v: IteratorResult<StreamEvent>) => void) | null = null;
  let pendingReject: ((err: unknown) => void) | null = null;
  let closed = false;
  let error: unknown = null;

  return {
    emit(event: StreamEvent): void {
      if (closed) return;
      if (pendingResolve) {
        const resolve = pendingResolve;
        pendingResolve = null;
        pendingReject = null;
        resolve({ value: event, done: false });
      } else {
        queue.push(event);
      }
    },

    close(): void {
      if (closed) return;
      closed = true;
      if (pendingResolve) {
        const resolve = pendingResolve;
        pendingResolve = null;
        pendingReject = null;
        resolve({ value: undefined as unknown as StreamEvent, done: true });
      }
    },

    /** Aborts the stream with an error — surfaces on the next iterator pull. */
    abort(err: unknown): void {
      if (closed) return;
      closed = true;
      error = err;
      if (pendingReject) {
        const reject = pendingReject;
        pendingResolve = null;
        pendingReject = null;
        reject(err);
      }
    },

    [Symbol.asyncIterator](): AsyncIterableIterator<StreamEvent> {
      const self = this;
      return {
        next: (): Promise<IteratorResult<StreamEvent>> => {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }
          if (error !== null) {
            const captured = error;
            error = null;
            return Promise.reject(captured);
          }
          if (closed) {
            return Promise.resolve({
              value: undefined as unknown as StreamEvent,
              done: true,
            });
          }
          return new Promise<IteratorResult<StreamEvent>>((resolve, reject) => {
            pendingResolve = resolve;
            pendingReject = reject;
          });
        },
        [Symbol.asyncIterator]() {
          return self[Symbol.asyncIterator]();
        },
      };
    },
  };
}

export type EventStream = ReturnType<typeof createEventStream>;
