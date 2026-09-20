import {describe, expect, it} from "vitest";
import {normalizeTag, removeScriptTag, replaceScriptTag} from "./text-utils.js";

describe("balises musicales", () => {
  it("normalise un nom français en balise stable", () => {
    expect(normalizeTag("  @Entrée des mariés ! ")).toBe("entree-des-maries");
  });

  it("renomme uniquement la balise exacte", () => {
    expect(replaceScriptTag("@entree puis @entree-longue", "entree", "arrivee")).toBe(
      "@arrivee puis @entree-longue",
    );
  });

  it("conserve le minutage lors du renommage", () => {
    expect(replaceScriptTag("Lancer @entree[0:30-1:15]", "entree", "arrivee")).toBe(
      "Lancer @arrivee[0:30-1:15]",
    );
  });

  it("retire la balise supprimée du conducteur", () => {
    expect(removeScriptTag("Bienvenue @entree à tous", "entree")).toBe("Bienvenue  à tous");
  });

  it("retire également le minutage de la balise supprimée", () => {
    expect(removeScriptTag("Bienvenue @entree[0:30-1:15] à tous", "entree")).toBe(
      "Bienvenue  à tous",
    );
  });
});
