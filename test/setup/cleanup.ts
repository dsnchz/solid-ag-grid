// Unmount everything render() mounted after each test. @solidjs/testing-library only registers
// this itself when `afterEach` is a global, and this config does not enable Vitest globals: a
// test that never unmounts leaks its grids, whose AG Grid timers (FakeHScrollComp's scrollbar
// measurement) can then fire after the environment is torn down and fail the run with an
// unhandled "document is not defined". Unmounting twice is safe (a disposed root's dispose is
// a no-op), so tests that unmount explicitly are unaffected.
import { cleanup } from "@solidjs/testing-library";
import { afterEach } from "vitest";

afterEach(cleanup);
