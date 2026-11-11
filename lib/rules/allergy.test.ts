import { describe, expect, it } from "vitest";
import { checkAllergies, allergyRecordState, storedAllergyStatus, validateOverrideReason, type AllergyRecord } from "./allergy";
import { classesForDrug, classForAllergen, DRUG_CLASSES, INGREDIENT_CLASS, isDrugClass } from "./drug-catalog";

const allergy = (over: Partial<AllergyRecord> = {}): AllergyRecord => ({
  id: "a1", kind: "allergy", allergen: "Penicillin", allergenClass: "penicillin", severity: "severe", reaction: "Facial swelling", removed: false, ...over,
});
const nkda: AllergyRecord = { id: "n1", kind: "nkda", allergen: null, allergenClass: null, severity: null, reaction: null, removed: false };

describe("drug catalog", () => {
  it("every ingredient maps to a known class", () => {
    for (const [name, cls] of Object.entries(INGREDIENT_CLASS)) expect(isDrugClass(cls), name).toBe(true);
    expect(new Set(Object.values(INGREDIENT_CLASS)).size).toBeLessThanOrEqual(DRUG_CLASSES.length);
  });
  it("finds the class from messy typed names", () => {
    expect(classesForDrug("Amoxicillin 500mg capsules")).toEqual(["penicillin"]);
    expect(classesForDrug("  CO-AMOXICLAV  625 ")).toEqual(["penicillin"]);
    expect(classesForDrug("Ferrous sulfate 200 mg")).toEqual(["iron"]);
    expect(classesForDrug("Ibuprofen + paracetamol")).toEqual(["nsaid", "paracetamol"]);
  });
  it("returns nothing for unknown medicines rather than guessing", () => {
    expect(classesForDrug("Zorblax")).toEqual([]);
    expect(classesForDrug("")).toEqual([]);
  });
  it("reads an allergy entry as a class", () => {
    expect(classForAllergen("Penicillin")).toBe("penicillin");
    expect(classForAllergen("penicillins (rash)")).toBe("penicillin");
    expect(classForAllergen("Amoxicillin")).toBe("penicillin");
    expect(classForAllergen("Sulfa drugs")).toBe("sulfonamide");
    expect(classForAllergen("Aspirin")).toBe("nsaid");
    expect(classForAllergen("Peanuts")).toBeNull();
    expect(classForAllergen("Latex")).toBeNull();
  });
});

describe("allergy check", () => {
  it("catches amoxicillin for a penicillin-allergic patient: a class match, not a name match", () => {
    expect("amoxicillin".includes("penicillin")).toBe(false); // the words share no substring
    const c = checkAllergies("Amoxicillin 500 mg", [allergy()]);
    expect(c).toMatchObject({ status: "conflict", requiresReason: true, hasDirectConflict: true, drugClasses: ["penicillin"] });
    expect(c.findings[0]).toMatchObject({ match: "direct", allergen: "Penicillin", severity: "severe" });
    expect(c.findings[0]?.message).toContain("Facial swelling");
  });
  it("warns about cross-reactive classes, also requiring a reason", () => {
    const c = checkAllergies("Cefalexin", [allergy()]);
    expect(c).toMatchObject({ status: "cross_reactive", requiresReason: true, hasDirectConflict: false });
    expect(c.findings[0]?.match).toBe("cross");
  });
  it("is clear for an unrelated drug when allergies are recorded", () => {
    expect(checkAllergies("Paracetamol 500 mg", [allergy()])).toMatchObject({ status: "clear", requiresReason: false, findings: [] });
  });
  it("says 'unchecked', never 'clear', for a drug it cannot classify", () => {
    const c = checkAllergies("Zorblax", [allergy()]);
    expect(c).toMatchObject({ status: "unchecked", requiresReason: false });
  });
  it("lets the prescriber classify an unknown drug manually", () => {
    expect(checkAllergies("Zorblax", [allergy()], ["penicillin"])).toMatchObject({ status: "conflict" });
    expect(checkAllergies("Zorblax", [allergy()], ["not-a-class"])).toMatchObject({ status: "unchecked" });
  });
  it("says 'no allergy record' when nothing has been recorded, which is not the same as no allergies", () => {
    expect(checkAllergies("Paracetamol", [])).toMatchObject({ status: "no_allergy_record", recordState: "not_recorded" });
    expect(checkAllergies("Paracetamol", [nkda])).toMatchObject({ status: "clear", recordState: "no_known_allergies" });
  });
  it("ignores removed allergies", () => {
    expect(checkAllergies("Amoxicillin", [allergy({ removed: true })]).status).toBe("no_allergy_record");
  });
  it("matches any of several allergies and a multi-class product", () => {
    const rs = [allergy(), allergy({ id: "a2", allergen: "Aspirin", allergenClass: "nsaid", severity: "mild", reaction: null })];
    expect(checkAllergies("Ibuprofen", rs).findings.map((f) => f.allergen)).toEqual(["Aspirin"]);
    expect(checkAllergies("Amoxicillin + ibuprofen", rs).findings).toHaveLength(2);
  });
  it("lists recorded allergies it cannot match automatically", () => {
    const rs = [allergy(), allergy({ id: "p", allergen: "Peanuts", allergenClass: null })];
    expect(checkAllergies("Paracetamol", rs).unmatchable).toEqual(["Peanuts"]);
  });
  it("reports the state of the allergy record", () => {
    expect(allergyRecordState([])).toBe("not_recorded");
    expect(allergyRecordState([nkda])).toBe("no_known_allergies");
    expect(allergyRecordState([nkda, allergy()])).toBe("has_allergies");
    expect(allergyRecordState([allergy({ removed: true })])).toBe("not_recorded");
  });
});

describe("override reason", () => {
  const needs = { requiresReason: true };
  it("requires a real written reason when there is a finding", () => {
    expect(validateOverrideReason(needs, "")).toMatch(/at least 10/);
    expect(validateOverrideReason(needs, "ok")).not.toBeNull();
    expect(validateOverrideReason(needs, "          ")).not.toBeNull();
    expect(validateOverrideReason(needs, "Tolerated before; allergy clinic advised.")).toBeNull();
  });
  it("asks for nothing when there is no finding", () => {
    expect(validateOverrideReason({ requiresReason: false }, "")).toBeNull();
  });
  it("never blocks: a valid reason always allows the prescription", () => {
    const check = checkAllergies("Amoxicillin", [allergy()]);
    expect(validateOverrideReason(check, "Culture-proven infection, no alternative; patient counselled.")).toBeNull();
  });
});

describe("stored status (mirrors the database)", () => {
  it("overridden when a direct conflict or any reason is given", () => {
    expect(storedAllergyStatus(checkAllergies("Amoxicillin", [allergy()]), "Counselled and monitored")).toBe("overridden");
    expect(storedAllergyStatus(checkAllergies("Paracetamol", [allergy()]), "just because")).toBe("overridden");
  });
  it("otherwise unchecked / no_allergy_record / clear", () => {
    expect(storedAllergyStatus(checkAllergies("Zorblax", [allergy()]), null)).toBe("unchecked");
    expect(storedAllergyStatus(checkAllergies("Paracetamol", []), null)).toBe("no_allergy_record");
    expect(storedAllergyStatus(checkAllergies("Paracetamol", [allergy()]), "  ")).toBe("clear");
  });
});
