import { Types } from "mongoose";
import { env } from "../../config/env";
import { AppError } from "../../shared/errors/AppError";
import type { SupportedCurrency } from "../../shared/constants/currencies";
import { SUPPORTED_CURRENCIES } from "../../shared/constants/currencies";
import { DepositModel } from "../deposit/deposit.model";
import { WithdrawalModel } from "../withdrawal/withdrawal.model";
import { ExpenseModel } from "../expense/expense.model";
import { LiabilityEntryModel } from "../liability/liability-entry.model";
import { LiabilityPersonModel } from "../liability/liability-person.model";
import { BankModel } from "../bank/bank.model";
import { ExchangeModel } from "../exchange/exchange.model";
import { ExchangeTopupModel } from "../exchange-topup/exchange-topup.model";
import { PLATFORM_SETTINGS_KEY, PlatformSettingsModel } from "./settings.model";

export type PlatformSettingsView = {
  platformCurrency: SupportedCurrency;
  currencyLockedAt: string | null;
  currencyLockedBy: string | null;
  isLocked: boolean;
  currencyConversionEnabled: boolean;
  supportedCurrencies: readonly SupportedCurrency[];
  /** When false, liability module and person settlement are off for this deploy. */
  liabilityModuleEnabled: boolean;
};

async function ensureSingleton() {
  let doc = await PlatformSettingsModel.findOne({ key: PLATFORM_SETTINGS_KEY }).exec();
  if (!doc) {
    doc = await PlatformSettingsModel.create({ key: PLATFORM_SETTINGS_KEY });
  }
  return doc;
}

/**
 * Seed platform currency from env when DB has none.
 * Does not override an already-locked DB value.
 */
async function ensurePlatformCurrencySeeded() {
  const doc = await ensureSingleton();
  if (doc.platformCurrency) return doc;

  doc.platformCurrency = env.platformCurrency;
  doc.currencyLockedAt = new Date();
  // Env seed has no user — leave currencyLockedBy unset
  await doc.save();
  await backfillExistingMoneyFx(env.platformCurrency);
  return doc;
}

function toView(doc: Awaited<ReturnType<typeof ensureSingleton>>): PlatformSettingsView {
  const currency = (doc.platformCurrency ?? env.platformCurrency) as SupportedCurrency;
  const conversionEnabled = env.currencyConversionEnabled;
  return {
    platformCurrency: currency,
    currencyLockedAt: doc.currencyLockedAt ? doc.currencyLockedAt.toISOString() : null,
    currencyLockedBy: doc.currencyLockedBy ? String(doc.currencyLockedBy) : null,
    isLocked: Boolean(doc.platformCurrency),
    currencyConversionEnabled: conversionEnabled,
    supportedCurrencies: conversionEnabled ? SUPPORTED_CURRENCIES : [currency],
    liabilityModuleEnabled: env.liabilityModuleEnabled,
  };
}

export async function getPlatformSettings(): Promise<PlatformSettingsView> {
  const doc = await ensurePlatformCurrencySeeded();
  return toView(doc);
}

/** True when multi-currency FX is allowed for this deploy. */
export function isCurrencyConversionEnabled(): boolean {
  return env.currencyConversionEnabled;
}

/**
 * Reject FX master/lookup when conversion is disabled for this deploy.
 */
export function assertCurrencyConversionEnabled(): void {
  if (!env.currencyConversionEnabled) {
    throw new AppError(
      "currency_conversion_disabled",
      "Currency conversion is disabled for this deployment. All amounts use the platform currency only.",
      403,
    );
  }
}

/** True when liability persons / person settlement are allowed for this deploy. */
export function isLiabilityModuleEnabled(): boolean {
  return env.liabilityModuleEnabled;
}

/**
 * Reject liability module routes and person settlement when disabled for this deploy.
 */
export function assertLiabilityModuleEnabled(): void {
  if (!env.liabilityModuleEnabled) {
    throw new AppError(
      "liability_module_disabled",
      "Liability module is disabled for this deployment. Settlements use bank accounts only.",
      403,
    );
  }
}

/**
 * Returns configured platform currency (auto-seeds from PLATFORM_CURRENCY env when unset).
 * Call from every money create/update path.
 */
export async function requirePlatformCurrency(): Promise<SupportedCurrency> {
  const doc = await ensurePlatformCurrencySeeded();
  if (!doc.platformCurrency) {
    // Should be unreachable after seed; keep defensive guard
    throw new AppError(
      "platform_currency_required",
      "Platform currency is not configured.",
      400,
    );
  }
  return doc.platformCurrency;
}

export async function getPlatformCurrencyOrNull(): Promise<SupportedCurrency | null> {
  const doc = await ensurePlatformCurrencySeeded();
  return doc.platformCurrency ?? null;
}

/**
 * Lock platform currency forever and backfill FX reference fields on existing money rows.
 * Disabled when CURRENCY_CONVERSION_ENABLED=false (currency comes from env).
 */
export async function setPlatformCurrency(
  currency: SupportedCurrency,
  lockedByUserId: string,
): Promise<PlatformSettingsView> {
  if (!env.currencyConversionEnabled) {
    throw new AppError(
      "currency_conversion_disabled",
      "Platform currency is fixed by PLATFORM_CURRENCY env and cannot be changed while currency conversion is disabled.",
      403,
    );
  }

  const doc = await ensureSingleton();

  if (doc.platformCurrency) {
    throw new AppError(
      "platform_currency_locked",
      `Platform currency is already set to ${doc.platformCurrency} and cannot be changed.`,
      409,
    );
  }

  doc.platformCurrency = currency;
  doc.currencyLockedAt = new Date();
  doc.currencyLockedBy = new Types.ObjectId(lockedByUserId);
  await doc.save();

  await backfillExistingMoneyFx(currency);

  return getPlatformSettings();
}

/**
 * Existing amounts are treated as already in platform currency.
 * Backfill operatedCurrency / operatedAmount / exchangeRate where missing.
 */
async function backfillExistingMoneyFx(platformCurrency: SupportedCurrency) {
  const fxUnset = {
    $or: [
      { operatedCurrency: { $exists: false } },
      { operatedCurrency: null },
      { operatedCurrency: "" },
    ],
  };

  const pipelineOpts = { updatePipeline: true as const };

  await Promise.all([
    DepositModel.updateMany(
      fxUnset,
      [
        {
          $set: {
            operatedCurrency: platformCurrency,
            operatedAmount: "$amount",
            exchangeRate: 1,
          },
        },
      ],
      pipelineOpts,
    ),
    WithdrawalModel.updateMany(
      fxUnset,
      [
        {
          $set: {
            operatedCurrency: platformCurrency,
            operatedAmount: "$amount",
            exchangeRate: 1,
          },
        },
      ],
      pipelineOpts,
    ),
    ExpenseModel.updateMany(
      fxUnset,
      [
        {
          $set: {
            operatedCurrency: platformCurrency,
            operatedAmount: "$amount",
            exchangeRate: 1,
          },
        },
      ],
      pipelineOpts,
    ),
    LiabilityEntryModel.updateMany(
      fxUnset,
      [
        {
          $set: {
            operatedCurrency: platformCurrency,
            operatedAmount: "$amount",
            exchangeRate: 1,
          },
        },
      ],
      pipelineOpts,
    ),
    LiabilityPersonModel.updateMany(
      {
        $or: [
          { openingOperatedCurrency: { $exists: false } },
          { openingOperatedCurrency: null },
          { openingOperatedCurrency: "" },
        ],
      },
      [
        {
          $set: {
            openingOperatedCurrency: platformCurrency,
            openingOperatedAmount: { $abs: "$openingBalance" },
            openingExchangeRate: 1,
          },
        },
      ],
      pipelineOpts,
    ),
    BankModel.updateMany(
      {
        $or: [
          { openingOperatedCurrency: { $exists: false } },
          { openingOperatedCurrency: null },
          { openingOperatedCurrency: "" },
        ],
      },
      [
        {
          $set: {
            openingOperatedCurrency: platformCurrency,
            openingOperatedAmount: "$openingBalance",
            openingExchangeRate: 1,
          },
        },
      ],
      pipelineOpts,
    ),
    ExchangeModel.updateMany(
      {
        $or: [
          { openingOperatedCurrency: { $exists: false } },
          { openingOperatedCurrency: null },
          { openingOperatedCurrency: "" },
        ],
      },
      [
        {
          $set: {
            openingOperatedCurrency: platformCurrency,
            openingOperatedAmount: "$openingBalance",
            openingExchangeRate: 1,
          },
        },
      ],
      pipelineOpts,
    ),
    ExchangeTopupModel.updateMany(
      fxUnset,
      [
        {
          $set: {
            operatedCurrency: platformCurrency,
            operatedAmount: "$amount",
            exchangeRate: 1,
          },
        },
      ],
      pipelineOpts,
    ),
  ]);
}
