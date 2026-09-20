import {describe, expect, it} from "vitest";
import type {MusicButton} from "./models";
import {buildMusicToken, formatTimecode, parseScriptSegments, parseTimecode} from "./script-music";

const button: MusicButton = {
  id: "button-1",
  name: "Entrée",
  tag: "entree",
  description: "",
  sortOrder: 10,
  categoryId: "category-1",
  categoryName: "Cérémonie",
  audioAssetId: "audio-1",
  audioName: "entree.mp3",
  audioUrl: "/api/media/audio-1",
  imageAssetId: null,
  imageUrl: null,
};

describe("minutage des musiques du conducteur", () => {
  it.each([
    ["30", 30],
    ["1:05", 65],
    ["1:02:03", 3723],
    ["1:72", null],
    ["abc", null],
  ])("convertit %s", (value, expected) => {
    expect(parseTimecode(value)).toBe(expected);
  });

  it("construit une balise d’extrait lisible", () => {
    expect(buildMusicToken("entree", 30, 75)).toBe("@entree[0:30-1:15]");
    expect(formatTimecode(75)).toBe("1:15");
  });

  it("conserve les anciennes balises de morceau entier", () => {
    expect(parseScriptSegments("Bienvenue @entree !", [button])).toEqual([
      {type: "text", content: "Bienvenue "},
      {type: "button", button, startSeconds: 0, endSeconds: null},
      {type: "text", content: " !"},
    ]);
  });

  it("extrait le début et la fin d’une balise minutée", () => {
    expect(parseScriptSegments("Lancer @entree[0:30-1:15].", [button])).toEqual([
      {type: "text", content: "Lancer "},
      {type: "button", button, startSeconds: 30, endSeconds: 75},
      {type: "text", content: "."},
    ]);
  });

  it("laisse visible un minutage manuel incohérent", () => {
    expect(parseScriptSegments("Lancer @entree[1:15-0:30].", [button])).toEqual([
      {type: "text", content: "Lancer @entree[1:15-0:30]."},
    ]);
  });
});
