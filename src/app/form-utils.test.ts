import {describe, expect, it} from "vitest";
import {normalizeTagInput} from "./form-utils";

describe("normalizeTagInput", () => {
  it.each([
    ["Entrée des Mariés", "entree-des-maries"],
    ["  Première danse !  ", "premiere-danse"],
    ["jeu__surprise", "jeu__surprise"],
    ["---FIN---", "fin"],
  ])("normalise %s en une balise enregistrable", (input, expected) => {
    expect(normalizeTagInput(input)).toBe(expected);
  });
});
