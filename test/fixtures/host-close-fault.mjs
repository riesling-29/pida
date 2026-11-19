// Test-only actual process fault at the runtime shutdown boundary.
import { PidaRuntime } from '../../dist/runtime.js';
PidaRuntime.prototype.close = async function () {
  if (process.env.PIDA_TEST_CLOSE_FAULT === 'hang') return new Promise(() => {});
  throw Error('SYNTHETIC_RUNTIME_CLOSE_FAILURE');
};
