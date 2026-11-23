import {
  buildBankResolutionCache,
  buildExchangePlayerResolutionCache,
  buildPersonResolutionCache,
  resolveBankImportKey,
  resolveExchangePlayerImportKey,
  resolvePersonImportKey,
  type BankImportMaps,
  type BankImportRecord,
  type ExchangePlayerImportMap,
} from "../src/modules/deposit/deposit-import-resolve";

describe("deposit-import-resolve", () => {
  const activeBank: BankImportRecord = {
    id: "bank-1",
    displayName: "Demo Holder - Demo Bank - 7890",
    status: "active",
  };

  const inactiveBank: BankImportRecord = {
    id: "bank-2",
    displayName: "Inactive Holder - Inactive Bank - 1234",
    status: "inactive",
  };

  const emptyLast4 = () => new Map<string, BankImportRecord | "ambiguous">();

  describe("resolveBankImportKey", () => {
    it("resolves by account number", () => {
      const maps: BankImportMaps = {
        bankByAccountMap: new Map([["1234567890", activeBank]]),
        bankByHolderMap: new Map(),
        bankByLast4Map: emptyLast4(),
      };
      expect(
        resolveBankImportKey(
          "1234567890",
          maps.bankByAccountMap,
          maps.bankByHolderMap,
          maps.bankByLast4Map,
        ),
      ).toEqual({
        status: "ok",
        id: "bank-1",
        displayName: activeBank.displayName,
      });
    });

    it("returns not_found when bank is missing", () => {
      const maps: BankImportMaps = {
        bankByAccountMap: new Map(),
        bankByHolderMap: new Map(),
        bankByLast4Map: emptyLast4(),
      };
      expect(
        resolveBankImportKey("missing", maps.bankByAccountMap, maps.bankByHolderMap, maps.bankByLast4Map),
      ).toEqual({
        status: "not_found",
      });
    });

    it("returns ambiguous when multiple banks share holder name", () => {
      const maps: BankImportMaps = {
        bankByAccountMap: new Map(),
        bankByHolderMap: new Map([["demo", "ambiguous"]]),
        bankByLast4Map: emptyLast4(),
      };
      expect(
        resolveBankImportKey("demo", maps.bankByAccountMap, maps.bankByHolderMap, maps.bankByLast4Map),
      ).toEqual({
        status: "ambiguous",
      });
    });

    it("prefers account number over ambiguous holder", () => {
      const maps: BankImportMaps = {
        bankByAccountMap: new Map([["demo", activeBank]]),
        bankByHolderMap: new Map([["demo", "ambiguous"]]),
        bankByLast4Map: emptyLast4(),
      };
      expect(
        resolveBankImportKey("demo", maps.bankByAccountMap, maps.bankByHolderMap, maps.bankByLast4Map),
      ).toEqual({
        status: "ok",
        id: "bank-1",
        displayName: activeBank.displayName,
      });
    });

    it("returns inactive when bank exists but is not active", () => {
      const maps: BankImportMaps = {
        bankByAccountMap: new Map([["inactive-acc", inactiveBank]]),
        bankByHolderMap: new Map(),
        bankByLast4Map: emptyLast4(),
      };
      expect(
        resolveBankImportKey(
          "inactive-acc",
          maps.bankByAccountMap,
          maps.bankByHolderMap,
          maps.bankByLast4Map,
        ),
      ).toEqual({
        status: "inactive",
        displayName: inactiveBank.displayName,
      });
    });

    it("resolves by last 4 digits when exact account/holder miss", () => {
      const maps: BankImportMaps = {
        bankByAccountMap: new Map(),
        bankByHolderMap: new Map(),
        bankByLast4Map: new Map([["7890", activeBank]]),
      };
      expect(
        resolveBankImportKey("7890", maps.bankByAccountMap, maps.bankByHolderMap, maps.bankByLast4Map),
      ).toEqual({
        status: "ok",
        id: "bank-1",
        displayName: activeBank.displayName,
      });
    });

    it("returns inactive when only inactive banks match last 4 digits", () => {
      const maps: BankImportMaps = {
        bankByAccountMap: new Map(),
        bankByHolderMap: new Map(),
        bankByLast4Map: new Map([["1234", inactiveBank]]),
      };
      expect(
        resolveBankImportKey("1234", maps.bankByAccountMap, maps.bankByHolderMap, maps.bankByLast4Map),
      ).toEqual({
        status: "inactive",
        displayName: inactiveBank.displayName,
      });
    });

    it("returns ambiguous when multiple active banks share last 4 digits", () => {
      const maps: BankImportMaps = {
        bankByAccountMap: new Map(),
        bankByHolderMap: new Map(),
        bankByLast4Map: new Map([["4455", "ambiguous"]]),
      };
      expect(
        resolveBankImportKey("4455", maps.bankByAccountMap, maps.bankByHolderMap, maps.bankByLast4Map),
      ).toEqual({
        status: "ambiguous",
      });
    });

    it("prefers exact account number over last 4 map", () => {
      const otherActive: BankImportRecord = {
        id: "bank-9",
        displayName: "Other - Other Bank - 7890",
        status: "active",
      };
      const maps: BankImportMaps = {
        bankByAccountMap: new Map([["7890", activeBank]]),
        bankByHolderMap: new Map(),
        bankByLast4Map: new Map([["7890", otherActive]]),
      };
      expect(
        resolveBankImportKey("7890", maps.bankByAccountMap, maps.bankByHolderMap, maps.bankByLast4Map),
      ).toEqual({
        status: "ok",
        id: "bank-1",
        displayName: activeBank.displayName,
      });
    });
  });

  describe("resolvePersonImportKey", () => {
    const personMap = new Map([
      ["john doe", { id: "person-1", name: "John Doe", isActive: true }],
      ["jane doe", { id: "person-2", name: "Jane Doe", isActive: false }],
    ]);

    it("resolves active person", () => {
      expect(resolvePersonImportKey("john doe", personMap)).toEqual({
        status: "ok",
        id: "person-1",
        name: "John Doe",
      });
    });

    it("returns not_found for unknown person", () => {
      expect(resolvePersonImportKey("unknown", personMap)).toEqual({ status: "not_found" });
    });

    it("returns inactive for inactive person", () => {
      expect(resolvePersonImportKey("jane doe", personMap)).toEqual({
        status: "inactive",
        name: "Jane Doe",
      });
    });
  });

  describe("resolveExchangePlayerImportKey", () => {
    const playerMap: ExchangePlayerImportMap = new Map([
      ["player001", { id: "mongo-1", playerIdLabel: "PLAYER001" }],
    ]);

    it("resolves exchange player id", () => {
      expect(resolveExchangePlayerImportKey("player001", playerMap)).toEqual({
        status: "ok",
        id: "mongo-1",
        playerIdLabel: "PLAYER001",
      });
    });

    it("returns not_found for unknown player id", () => {
      expect(resolveExchangePlayerImportKey("unknown", playerMap)).toEqual({ status: "not_found" });
    });

    it("returns ambiguous when multiple players share playerId", () => {
      const ambiguousMap: ExchangePlayerImportMap = new Map([["player001", "ambiguous"]]);
      expect(resolveExchangePlayerImportKey("player001", ambiguousMap)).toEqual({ status: "ambiguous" });
    });
  });

  describe("resolution caches", () => {
    it("buildBankResolutionCache resolves each unique key once", () => {
      const maps: BankImportMaps = {
        bankByAccountMap: new Map([["demo", activeBank]]),
        bankByHolderMap: new Map(),
        bankByLast4Map: emptyLast4(),
      };
      const cache = buildBankResolutionCache(["demo", "missing"], maps);
      expect(cache.size).toBe(2);
      expect(cache.get("demo")).toEqual({ status: "ok", id: "bank-1", displayName: activeBank.displayName });
      expect(cache.get("missing")).toEqual({ status: "not_found" });
    });

    it("buildBankResolutionCache resolves last 4 digit keys", () => {
      const maps: BankImportMaps = {
        bankByAccountMap: new Map(),
        bankByHolderMap: new Map(),
        bankByLast4Map: new Map([["4455", activeBank]]),
      };
      const cache = buildBankResolutionCache(["4455", "9999"], maps);
      expect(cache.get("4455")).toEqual({
        status: "ok",
        id: "bank-1",
        displayName: activeBank.displayName,
      });
      expect(cache.get("9999")).toEqual({ status: "not_found" });
    });

    it("buildPersonResolutionCache resolves each unique name once", () => {
      const personMap = new Map([["john doe", { id: "person-1", name: "John Doe", isActive: true }]]);
      const cache = buildPersonResolutionCache(["john doe", "unknown"], personMap);
      expect(cache.get("john doe")).toEqual({ status: "ok", id: "person-1", name: "John Doe" });
      expect(cache.get("unknown")).toEqual({ status: "not_found" });
    });

    it("buildExchangePlayerResolutionCache resolves each unique player id once", () => {
      const playerMap: ExchangePlayerImportMap = new Map([
        ["player001", { id: "mongo-1", playerIdLabel: "PLAYER001" }],
      ]);
      const cache = buildExchangePlayerResolutionCache(["player001", "missing"], playerMap);
      expect(cache.get("player001")).toEqual({
        status: "ok",
        id: "mongo-1",
        playerIdLabel: "PLAYER001",
      });
      expect(cache.get("missing")).toEqual({ status: "not_found" });
    });
  });
});
