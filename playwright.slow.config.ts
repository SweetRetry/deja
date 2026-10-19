import base from "./playwright.config";
export default { ...base, timeout: 90_000, expect: { timeout: 20_000 } };
