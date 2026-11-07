// Review-only fault injection, not a product change.
import {PidaRuntime} from './dist/runtime.js';
PidaRuntime.prototype.close=async function(){throw Error('REVIEW_RUNTIME_CLOSE_FAILURE');};
