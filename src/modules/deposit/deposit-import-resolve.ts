import { BankModel } from "../bank/bank.model";
import { LiabilityPersonModel } from "../liability/liability-person.model";

export type BankImportRecord = { id: string; displayName: string; status: string };

export type BankImportMaps = {
  bankByAccountMap: Map<string, BankImportRecord>;
  bankByHolderMap: Map<string, BankImportRecord | "ambiguous">;
};

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

  if (uniqueKeys.length === 0) {
    return { bankByAccountMap, bankByHolderMap };
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

  return { bankByAccountMap, bankByHolderMap };
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
): BankImportResolution {
  const bankByAcc = bankByAccountMap.get(key);
  const bankByHolder = bankByHolderMap.get(key);

  if (bankByHolder === "ambiguous" && !bankByAcc) {
    return { status: "ambiguous" };
  }

  const bankInfo =
    bankByAcc || (bankByHolder !== "ambiguous" && bankByHolder ? bankByHolder : undefined);

  if (!bankInfo) {
    return { status: "not_found" };
  }
  if (bankInfo.status !== "active") {
    return { status: "inactive", displayName: bankInfo.displayName };
  }
  return { status: "ok", id: bankInfo.id, displayName: bankInfo.displayName };
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
    cache.set(key, resolveBankImportKey(key, maps.bankByAccountMap, maps.bankByHolderMap));
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
