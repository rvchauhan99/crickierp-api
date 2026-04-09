export const PERMISSIONS = {
  EXCHANGE_ADD: "exchange.add",
  EXCHANGE_LIST: "exchange.list",
  EXCHANGE_EDIT: "exchange.edit",
} as const;

export const DEFAULT_ADMIN_PERMISSIONS = Object.values(PERMISSIONS);
