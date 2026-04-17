import "dotenv/config";
import mongoose, { Types } from "mongoose";
import { connectDb } from "../shared/db/connect";
import { logger } from "../shared/logger";
import { BankModel } from "../modules/bank/bank.model";
import { DepositModel } from "../modules/deposit/deposit.model";
import { WithdrawalModel } from "../modules/withdrawal/withdrawal.model";
import { ExpenseModel } from "../modules/expense/expense.model";
import { LiabilityEntryModel } from "../modules/liability/liability-entry.model";

type ReconcileRow = {
  bankId: string;
  accountNumber: string;
  bankName: string;
  holderName: string;
  previousCurrentBalance: number;
  closingBalanceActual: number;
  delta: number;
  changed: boolean;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const onlyChanged = args.includes("--only-changed");
  return { apply, onlyChanged };
}

async function computeClosingBalanceActualByBankIds(bankIds: Types.ObjectId[]): Promise<Map<string, number>> {
  const [banks, deposits, withdrawals, expenses, liabilities] = await Promise.all([
    BankModel.find({ _id: { $in: bankIds } })
      .select({ _id: 1, openingBalance: 1 })
      .lean(),
    DepositModel.find({ bankId: { $in: bankIds }, status: "verified" })
      .select({ bankId: 1, amount: 1 })
      .lean(),
    WithdrawalModel.find({ payoutBankId: { $in: bankIds }, status: "approved" })
      .select({ payoutBankId: 1, amount: 1, payableAmount: 1 })
      .lean(),
    ExpenseModel.find({ bankId: { $in: bankIds }, status: "approved" })
      .select({ bankId: 1, amount: 1 })
      .lean(),
    LiabilityEntryModel.find({
      $or: [
        { fromAccountType: "bank", fromAccountId: { $in: bankIds } },
        { toAccountType: "bank", toAccountId: { $in: bankIds } },
      ],
    })
      .select({ fromAccountType: 1, fromAccountId: 1, toAccountType: 1, toAccountId: 1, amount: 1 })
      .lean(),
  ]);

  const totals = new Map<string, number>();
  for (const b of banks) {
    totals.set(String(b._id), Number(b.openingBalance ?? 0));
  }
  for (const d of deposits) {
    const id = String(d.bankId);
    totals.set(id, (totals.get(id) ?? 0) + Number(d.amount ?? 0));
  }
  for (const w of withdrawals) {
    const id = String(w.payoutBankId);
    totals.set(id, (totals.get(id) ?? 0) - Number(w.payableAmount ?? w.amount ?? 0));
  }
  for (const e of expenses) {
    const id = String(e.bankId);
    totals.set(id, (totals.get(id) ?? 0) - Number(e.amount ?? 0));
  }
  for (const le of liabilities) {
    const amt = Number(le.amount ?? 0);
    if (le.fromAccountType === "bank" && le.fromAccountId) {
      const id = String(le.fromAccountId);
      totals.set(id, (totals.get(id) ?? 0) - amt);
    }
    if (le.toAccountType === "bank" && le.toAccountId) {
      const id = String(le.toAccountId);
      totals.set(id, (totals.get(id) ?? 0) + amt);
    }
  }
  return totals;
}

async function main() {
  const { apply, onlyChanged } = parseArgs();
  await connectDb();

  const banks = await BankModel.find({})
    .select({ _id: 1, accountNumber: 1, bankName: 1, holderName: 1, openingBalance: 1, currentBalance: 1 })
    .lean();
  const bankIds = banks.map((bank) => new Types.ObjectId(String(bank._id)));
  const closingByBankId = await computeClosingBalanceActualByBankIds(bankIds);

  const report: ReconcileRow[] = banks.map((bank) => {
    const bankId = String(bank._id);
    const previousCurrentBalance = Number(bank.currentBalance ?? bank.openingBalance ?? 0);
    const closingBalanceActual = Number(closingByBankId.get(bankId) ?? bank.openingBalance ?? 0);
    const delta = closingBalanceActual - previousCurrentBalance;
    return {
      bankId,
      accountNumber: bank.accountNumber,
      bankName: bank.bankName,
      holderName: bank.holderName,
      previousCurrentBalance,
      closingBalanceActual,
      delta,
      changed: Math.abs(delta) > 0.000001,
    };
  });

  const rowsToShow = onlyChanged ? report.filter((row) => row.changed) : report;
  logger.info(
    {
      mode: apply ? "apply" : "dry-run",
      totalBanks: report.length,
      changedBanks: report.filter((row) => row.changed).length,
      unchangedBanks: report.filter((row) => !row.changed).length,
    },
    "bank balance reconciliation summary",
  );

  for (const row of rowsToShow) {
    logger.info(
      {
        bankId: row.bankId,
        accountNumber: row.accountNumber,
        bankName: row.bankName,
        holderName: row.holderName,
        previousCurrentBalance: row.previousCurrentBalance,
        closingBalanceActual: row.closingBalanceActual,
        delta: row.delta,
      },
      "bank balance reconciliation row",
    );
  }

  if (apply) {
    const changedRows = report.filter((row) => row.changed);
    for (const row of changedRows) {
      await BankModel.updateOne(
        { _id: new Types.ObjectId(row.bankId) },
        { $set: { currentBalance: row.closingBalanceActual } },
      );
    }
    logger.info({ updatedCount: changedRows.length }, "bank currentBalance sync complete");
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  logger.error({ error }, "bank balance reconciliation failed");
  await mongoose.disconnect();
  process.exit(1);
});
