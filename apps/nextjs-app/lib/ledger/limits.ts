export const LEDGER_ROW_LIMIT = 50000;
export const LEDGER_RECORD_LIMIT = 10000;
export const LEDGER_SOURCE_BYTE_LIMIT = 32 * 1024 * 1024;
export class LedgerLimitError extends Error {}
