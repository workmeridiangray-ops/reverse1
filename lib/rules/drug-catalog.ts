/**
 * ============================================================================
 *  CLINICAL PLACEHOLDER - REQUIRES CLINICIAN / PHARMACIST REVIEW
 * ============================================================================
 * A small starter list that maps medicine names to drug classes so allergies
 * can be matched by CLASS, not by name (amoxicillin and penicillin share no
 * letters, but a penicillin-allergic patient must be warned).
 *
 * This is NOT a formulary. It is incomplete by design: any drug not found
 * here is reported as "not checked", never as "safe". A clinician or
 * pharmacist must review the classes and cross-reactions below, and a real
 * deployment should replace this with a maintained drug database.
 * ============================================================================
 */

export const DRUG_CATALOG_REVIEW_REQUIRED = true as const;

export const DRUG_CLASSES = [
  "penicillin",
  "cephalosporin",
  "macrolide",
  "fluoroquinolone",
  "tetracycline",
  "sulfonamide",
  "nsaid",
  "opioid",
  "paracetamol",
  "ace_inhibitor",
  "statin",
  "iron",
  "ppi",
  "biguanide",
  "calcium_channel_blocker",
  "beta_agonist",
] as const;
export type DrugClass = (typeof DRUG_CLASSES)[number];

export const DRUG_CLASS_LABEL: Readonly<Record<DrugClass, string>> = {
  penicillin: "Penicillins",
  cephalosporin: "Cephalosporins",
  macrolide: "Macrolides",
  fluoroquinolone: "Fluoroquinolones",
  tetracycline: "Tetracyclines",
  sulfonamide: "Sulfonamides (sulfa)",
  nsaid: "NSAIDs (incl. aspirin)",
  opioid: "Opioids",
  paracetamol: "Paracetamol",
  ace_inhibitor: "ACE inhibitors",
  statin: "Statins",
  iron: "Iron preparations",
  ppi: "Proton pump inhibitors",
  biguanide: "Biguanides",
  calcium_channel_blocker: "Calcium channel blockers",
  beta_agonist: "Beta-agonists",
};

/** Active ingredient (lowercase, hyphenated) -> class. */
export const INGREDIENT_CLASS: Readonly<Record<string, DrugClass>> = {
  // penicillins
  amoxicillin: "penicillin",
  ampicillin: "penicillin",
  flucloxacillin: "penicillin",
  penicillin: "penicillin",
  phenoxymethylpenicillin: "penicillin",
  benzylpenicillin: "penicillin",
  piperacillin: "penicillin",
  "co-amoxiclav": "penicillin",
  amoxil: "penicillin",
  augmentin: "penicillin",
  // cephalosporins
  cefalexin: "cephalosporin",
  cephalexin: "cephalosporin",
  cefuroxime: "cephalosporin",
  ceftriaxone: "cephalosporin",
  cefixime: "cephalosporin",
  cefazolin: "cephalosporin",
  // macrolides
  azithromycin: "macrolide",
  clarithromycin: "macrolide",
  erythromycin: "macrolide",
  // fluoroquinolones
  ciprofloxacin: "fluoroquinolone",
  levofloxacin: "fluoroquinolone",
  // tetracyclines
  doxycycline: "tetracycline",
  tetracycline: "tetracycline",
  // sulfonamides
  sulfamethoxazole: "sulfonamide",
  "co-trimoxazole": "sulfonamide",
  sulfadiazine: "sulfonamide",
  // NSAIDs
  ibuprofen: "nsaid",
  naproxen: "nsaid",
  diclofenac: "nsaid",
  aspirin: "nsaid",
  ketorolac: "nsaid",
  celecoxib: "nsaid",
  // opioids
  codeine: "opioid",
  morphine: "opioid",
  tramadol: "opioid",
  oxycodone: "opioid",
  // others
  paracetamol: "paracetamol",
  acetaminophen: "paracetamol",
  ramipril: "ace_inhibitor",
  lisinopril: "ace_inhibitor",
  enalapril: "ace_inhibitor",
  atorvastatin: "statin",
  simvastatin: "statin",
  ferrous: "iron",
  omeprazole: "ppi",
  lansoprazole: "ppi",
  metformin: "biguanide",
  amlodipine: "calcium_channel_blocker",
  salbutamol: "beta_agonist",
};

/** Words an allergy might be written as, mapped to a class. */
const CLASS_ALIAS: Readonly<Record<string, DrugClass>> = {
  penicillin: "penicillin",
  penicillins: "penicillin",
  "beta-lactam": "penicillin",
  cephalosporin: "cephalosporin",
  cephalosporins: "cephalosporin",
  macrolide: "macrolide",
  macrolides: "macrolide",
  fluoroquinolone: "fluoroquinolone",
  fluoroquinolones: "fluoroquinolone",
  quinolone: "fluoroquinolone",
  quinolones: "fluoroquinolone",
  tetracycline: "tetracycline",
  tetracyclines: "tetracycline",
  sulfa: "sulfonamide",
  sulpha: "sulfonamide",
  sulfonamide: "sulfonamide",
  sulfonamides: "sulfonamide",
  nsaid: "nsaid",
  nsaids: "nsaid",
  opioid: "opioid",
  opioids: "opioid",
  "ace-inhibitor": "ace_inhibitor",
  "ace-inhibitors": "ace_inhibitor",
  statin: "statin",
  statins: "statin",
  iron: "iron",
};

/**
 * Pairs where an allergy to one class may react with the other. Always a
 * WARNING (written reason required), never a block. PLACEHOLDER: the
 * relationship is directional in reality and depends on the specific drugs.
 */
export const CROSS_REACTIVE: Readonly<Partial<Record<DrugClass, readonly DrugClass[]>>> = {
  penicillin: ["cephalosporin"],
  cephalosporin: ["penicillin"],
};

export function isDrugClass(value: string | null | undefined): value is DrugClass {
  return !!value && (DRUG_CLASSES as readonly string[]).includes(value);
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, " ")
    .split(" ")
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter(Boolean);
}

/**
 * Classes for a medicine name as typed ("Amoxicillin 500mg capsules",
 * "co-amoxiclav", "Ferrous sulfate"). Empty array = not in the catalog, which
 * callers must treat as UNCHECKED, not safe.
 */
export function classesForDrug(name: string): DrugClass[] {
  const found = new Set<DrugClass>();
  for (const t of tokens(name)) {
    const hit = INGREDIENT_CLASS[t];
    if (hit) found.add(hit);
  }
  return [...found];
}

/** Class for an allergy entry such as "Penicillin", "sulfa drugs", "Amoxicillin", "Aspirin". */
export function classForAllergen(text: string): DrugClass | null {
  const toks = tokens(text);
  for (const t of toks) {
    const alias = CLASS_ALIAS[t];
    if (alias) return alias;
  }
  for (const t of toks) {
    const hit = INGREDIENT_CLASS[t];
    if (hit) return hit;
  }
  return null;
}

/** Medicines the prescribing form suggests (free text is still allowed). */
export function suggestedDrugNames(): string[] {
  return Object.keys(INGREDIENT_CLASS)
    .filter((k) => !["amoxil", "augmentin", "acetaminophen", "cephalexin", "ferrous"].includes(k))
    .concat(["ferrous sulfate"])
    .sort();
}
