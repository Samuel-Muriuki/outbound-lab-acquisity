/**
 * Vitest global setup.
 *
 * Stubs `server-only` so server-side modules can be imported in unit
 * tests. The package is normally a build-time guard that throws when
 * imported in client bundles; outside Next.js it would also throw and
 * break our tests.
 */
import { vi } from "vitest";

vi.mock("server-only", () => ({}));
