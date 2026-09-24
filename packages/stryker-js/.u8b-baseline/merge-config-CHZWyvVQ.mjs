import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
//#region src/config/merge-config.ts
const usable = (value, key) => key !== "__proto__" && value !== void 0;
const isConfigRecord = (value) => Predicate.isObject(value);
const copyRecord = (source) => Record.filter(source, usable);
const mergeNested = (base, override) => isConfigRecord(override) ? mergeRecords(base, override) : override;
const mergeKeyInto = (merged, key, override) => {
	const base = merged[key];
	merged[key] = isConfigRecord(base) ? mergeNested(base, override) : override;
};
const mergeRecords = (base, overrides) => {
	const merged = copyRecord(base);
	for (const [key, override] of Object.entries(Record.filter(overrides, usable))) mergeKeyInto(merged, key, override);
	return merged;
};
const mergeConfig = (defaults, overrides) => mergeRecords(defaults, overrides);
//#endregion
export { mergeConfig as t };
