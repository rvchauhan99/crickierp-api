import { BankModel } from "../bank/bank.model";
import { LiabilityPersonModel } from "../liability/liability-person.model";
import { PlayerModel } from "../player/player.model";

export type BankImportRecord = { id: string; displayName: string; status: string };

export type BankImportMaps = {
  bankByAccountMap: Map<string, BankImportRecord>;
  bankByHolderMap: Map<string, BankImportRecord | "ambiguous">;
  /** Keys are exactly 4 digits; value is active bank, inactive-only hit, or ambiguous among actives. */
  bankByLast4Map: Map<string, BankImportRecord | "ambiguous">;
};

const BANK_IMPORT_LAST4_KEY = /^\d{4}$/;

export function isBankImportLast4Key(key: string): boolean {
  return BANK_IMPORT_LAST4_KEY.test(key);
}

export type BankImportResolution =
  | { status: "ok"; id: string; displayName: string }
  | { status: "not_found" }
  | { status: "ambiguous" }
  | { status: "inactive"; displayName: string };

export type PersonImportRecord = { id: string; name: string; isActive: boolean };

export type PersonImportResolution =
  | { status: "ok"; id: string; name: string }
  | { status: "not_found" }
  | { status: "inactive"; name: string };

export type ExchangePlayerImportRecord = { id: string; playerIdLabel: string };

export type ExchangePlayerImportMap = Map<string, ExchangePlayerImportRecord | "ambiguous">;

export type ExchangePlayerImportResolution =
  | { status: "ok"; id: string; playerIdLabel: string }
  | { status: "not_found" }
  | { status: "ambiguous" };

function bankDisplayName(b: { holderName: string; bankName: string; accountNumber: string }): string {
  const last4 = b.accountNumber.length >= 4 ? b.accountNumber.slice(-4) : b.accountNumber;
  return `${b.holderName} - ${b.bankName} - ${last4}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function loadBanksForImportIdentifiers(uniqueKeys: string[]): Promise<BankImportMaps> {
  const bankByAccountMap = new Map<string, BankImportRecord>();
  const bankByHolderMap = new Map<string, BankImportRecord | "ambiguous">();
  const bankByLast4Map = new Map<string, BankImportRecord | "ambiguous">();

  if (uniqueKeys.length === 0) {
    return { bankByAccountMap, bankByHolderMap, bankByLast4Map };
  }

  const regexPatterns = uniqueKeys.map((n) => new RegExp(`^${escapeRegex(n)}$`, "i"));
  const banks = await BankModel.find({
    $or: [{ accountNumber: { $in: regexPatterns } }, { holderName: { $in: regexPatterns } }],
  }).lean();

  for (const b of banks) {
    const record: BankImportRecord = {
      id: b._id.toString(),
      displayName: bankDisplayName(b),
      status: b.status,
    };
    bankByAccountMap.set(b.accountNumber.trim().toLowerCase(), record);
    const holderKey = b.holderName.trim().toLowerCase();
    if (bankByHolderMap.has(holderKey)) {
      bankByHolderMap.set(holderKey, "ambiguous");
    } else {
      bankByHolderMap.set(holderKey, record);
    }
  }

  const last4Keys = [...new Set(uniqueKeys.filter((k) => isBankImportLast4Key(k)))];
  if (last4Keys.length > 0) {
    const last4KeySet = new Set(last4Keys);
    const suffixPatterns = last4Keys.map((n) => new RegExp(`${escapeRegex(n)}$`));
    const suffixBanks = await BankModel.find({
      accountNumber: { $in: suffixPatterns },
    }).lean();

    const grouped = new Map<string, BankImportRecord[]>();
    for (const b of suffixBanks) {
      const accountNumber = b.accountNumber.trim();
      if (accountNumber.length < 4) continue;
      const last4 = accountNumber.slice(-4);
      if (!last4KeySet.has(last4)) continue;
      const record: BankImportRecord = {
        id: b._id.toString(),
        displayName: bankDisplayName(b),
        status: b.status,
      };
      const list = grouped.get(last4) ?? [];
      list.push(record);
      grouped.set(last4, list);
    }

    for (const [last4, records] of grouped) {
      const active = records.filter((r) => r.status === "active");
      if (active.length === 1) {
        bankByLast4Map.set(last4, active[0]!);
      } else if (active.length > 1) {
        bankByLast4Map.set(last4, "ambiguous");
      } else if (records[0]) {
        bankByLast4Map.set(last4, records[0]);
      }
    }
  }

  return { bankByAccountMap, bankByHolderMap, bankByLast4Map };
}

export async function loadLiabilityPersonsForImportNames(
  uniqueKeys: string[],
): Promise<Map<string, PersonImportRecord>> {
  const personMap = new Map<string, PersonImportRecord>();
  if (uniqueKeys.length === 0) return personMap;

  const regexPatterns = uniqueKeys.map((n) => new RegExp(`^${escapeRegex(n)}$`, "i"));
  const persons = await LiabilityPersonModel.find({ name: { $in: regexPatterns } }).lean();
  for (const p of persons) {
    personMap.set(p.name.trim().toLowerCase(), {
      id: p._id.toString(),
      name: p.name.trim(),
      isActive: p.isActive,
    });
  }
  return personMap;
}

export function resolveBankImportKey(
  key: string,
  bankByAccountMap: Map<string, BankImportRecord>,
  bankByHolderMap: Map<string, BankImportRecord | "ambiguous">,
  bankByLast4Map: Map<string, BankImportRecord | "ambiguous"> = new Map(),
): BankImportResolution {
  const bankByAcc = bankByAccountMap.get(key);
  const bankByHolder = bankByHolderMap.get(key);

  if (bankByHolder === "ambiguous" && !bankByAcc) {
    return { status: "ambiguous" };
  }

  const bankInfo =
    bankByAcc || (bankByHolder !== "ambiguous" && bankByHolder ? bankByHolder : undefined);

  if (bankInfo) {
    if (bankInfo.status !== "active") {
      return { status: "inactive", displayName: bankInfo.displayName };
    }
    return { status: "ok", id: bankInfo.id, displayName: bankInfo.displayName };
  }

  if (isBankImportLast4Key(key)) {
    const byLast4 = bankByLast4Map.get(key);
    if (byLast4 === "ambiguous") {
      return { status: "ambiguous" };
    }
    if (byLast4) {
      if (byLast4.status !== "active") {
        return { status: "inactive", displayName: byLast4.displayName };
      }
      return { status: "ok", id: byLast4.id, displayName: byLast4.displayName };
    }
  }

  return { status: "not_found" };
}

export function resolvePersonImportKey(
  key: string,
  personMap: Map<string, PersonImportRecord>,
): PersonImportResolution {
  const personInfo = personMap.get(key);
  if (!personInfo) {
    return { status: "not_found" };
  }
  if (!personInfo.isActive) {
    return { status: "inactive", name: personInfo.name };
  }
  return { status: "ok", id: personInfo.id, name: personInfo.name };
}

export function buildBankResolutionCache(
  uniqueKeys: string[],
  maps: BankImportMaps,
): Map<string, BankImportResolution> {
  const cache = new Map<string, BankImportResolution>();
  for (const key of uniqueKeys) {
    cache.set(
      key,
      resolveBankImportKey(key, maps.bankByAccountMap, maps.bankByHolderMap, maps.bankByLast4Map),
    );
  }
  return cache;
}

export function buildPersonResolutionCache(
  uniqueKeys: string[],
  personMap: Map<string, PersonImportRecord>,
): Map<string, PersonImportResolution> {
  const cache = new Map<string, PersonImportResolution>();
  for (const key of uniqueKeys) {
    cache.set(key, resolvePersonImportKey(key, personMap));
  }
  return cache;
}

export async function loadPlayersForImportPlayerIds(uniqueKeys: string[]): Promise<ExchangePlayerImportMap> {
  const playerMap: ExchangePlayerImportMap = new Map();
  if (uniqueKeys.length === 0) return playerMap;

  const regexPatterns = uniqueKeys.map((n) => new RegExp(`^${escapeRegex(n)}$`, "i"));
  const players = await PlayerModel.find({ playerId: { $in: regexPatterns } })
    .select({ playerId: 1 })
    .lean();

  for (const p of players) {
    const key = p.playerId.trim().toLowerCase();
    const record: ExchangePlayerImportRecord = {
      id: p._id.toString(),
      playerIdLabel: p.playerId.trim(),
    };
    if (playerMap.has(key)) {
      playerMap.set(key, "ambiguous");
    } else {
      playerMap.set(key, record);
    }
  }
  return playerMap;
}

export function resolveExchangePlayerImportKey(
  key: string,
  playerMap: ExchangePlayerImportMap,
): ExchangePlayerImportResolution {
  const entry = playerMap.get(key);
  if (entry === "ambiguous") {
    return { status: "ambiguous" };
  }
  if (!entry) {
    return { status: "not_found" };
  }
  return { status: "ok", id: entry.id, playerIdLabel: entry.playerIdLabel };
}

export function buildExchangePlayerResolutionCache(
  uniqueKeys: string[],
  playerMap: ExchangePlayerImportMap,
): Map<string, ExchangePlayerImportResolution> {
  const cache = new Map<string, ExchangePlayerImportResolution>();
  for (const key of uniqueKeys) {
    cache.set(key, resolveExchangePlayerImportKey(key, playerMap));
  }
  return cache;
}
