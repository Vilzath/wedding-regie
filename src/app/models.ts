export type Role = "ADMIN" | "USER";

export interface User {
  id: string;
  username: string;
  role: Role;
}

export interface Category {
  id: string;
  name: string;
  sortOrder: number;
}

export interface MusicButton {
  id: string;
  name: string;
  tag: string;
  description: string;
  sortOrder: number;
  categoryId: string;
  categoryName: string;
  audioAssetId: string;
  audioName: string;
  audioUrl: string;
  imageAssetId: string | null;
  imageUrl: string | null;
}

export interface BootstrapData {
  user: User;
  categories: Category[];
  buttons: MusicButton[];
  script: {content: string; updatedAt: string | null};
}

export type ScriptSegment =
  | {type: "text"; content: string}
  | {
      type: "button";
      button: MusicButton;
      startSeconds: number;
      endSeconds: number | null;
    };
