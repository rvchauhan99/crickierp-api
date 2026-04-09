export const PERMISSIONS = {
  DASHBOARD_VIEW: "dashboard.view",

  SUB_ADMIN_ADD: "sub_admin.add",
  SUB_ADMIN_LIST: "sub_admin.list",
  SUB_ADMIN_EDIT: "sub_admin.edit",

  EXCHANGE_ADD: "exchange.add",
  EXCHANGE_LIST: "exchange.list",
  EXCHANGE_EDIT: "exchange.edit",

  PLAYER_ADD: "player.add",
  PLAYER_LIST: "player.list",
  PLAYER_EDIT: "player.edit",

  BANK_ADD: "bank.add",
  BANK_LIST: "bank.list",
  BANK_EDIT: "bank.edit",
  BANK_STATEMENT: "bank.statement",

  DEPOSIT_BANKER: "deposit.banker",
  DEPOSIT_BANKER_EDIT: "deposit.banker_edit",
  DEPOSIT_BANKER_LIST: "deposit.banker_list",
  DEPOSIT_EXCHANGE: "deposit.exchange",
  DEPOSIT_FINAL_VIEW: "deposit.final_view",
  DEPOSIT_FINAL_EDIT: "deposit.final_edit",

  WITHDRAWAL_EXCHANGE: "withdrawal.exchange",
  WITHDRAWAL_EXCHANGE_EDIT: "withdrawal.exchange_edit",
  WITHDRAWAL_EXCHANGE_LIST: "withdrawal.exchange_list",
  WITHDRAWAL_BANKER: "withdrawal.banker",
  WITHDRAWAL_BANKER_LIST: "withdrawal.banker_list",
  WITHDRAWAL_FINAL_VIEW: "withdrawal.final_view",
  WITHDRAWAL_FINAL_EDIT: "withdrawal.final_edit",

  REPORTS_TRANSACTION_HISTORY: "reports.transaction_history",
  USER_HISTORY_VIEW: "user_history.view",
  EXPENSE_MASTER_LIST: "expense.master_list",
  EXPENSE_ADD: "expense.add",
  EXPENSE_EDIT: "expense.edit",
  EXPENSE_LIST: "expense.list",
} as const;

export const DEFAULT_ADMIN_PERMISSIONS = Object.values(PERMISSIONS);
