/** commit/full 门 registry 建议超时（总项与子项均未配时使用） */
export {
  REGISTRY_COMMIT_TIMEOUT_MS as COMMIT_GATE_TIMEOUT_MS,
  REGISTRY_FULL_TIMEOUT_MS as FULL_GATE_TIMEOUT_MS,
} from './gate-registry.js';

export { formatGateTimeoutLabel, gateTimeoutMessage, getGateNodeTimeout } from './gate-config.js';
