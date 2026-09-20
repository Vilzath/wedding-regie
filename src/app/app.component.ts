import {HttpErrorResponse} from "@angular/common/http";
import {CommonModule} from "@angular/common";
import {Component, computed, ElementRef, inject, OnInit, signal, ViewChild} from "@angular/core";
import {FormBuilder, ReactiveFormsModule, Validators} from "@angular/forms";
import {ApiService} from "./api.service";
import {AudioService} from "./audio.service";
import {normalizeTagInput} from "./form-utils";
import type {Category, MusicButton, ScriptSegment, User} from "./models";
import {
  buildMusicToken,
  formatTimecode,
  parseScriptSegments,
  parseTimecode,
} from "./script-music";
import {WakeLockService} from "./wake-lock.service";

type View = "buttons" | "script" | "admin";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: "./app.component.html",
})
export class AppComponent implements OnInit {
  @ViewChild("audioInput") private audioInput?: ElementRef<HTMLInputElement>;
  @ViewChild("imageInput") private imageInput?: ElementRef<HTMLInputElement>;

  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder).nonNullable;
  readonly audio = inject(AudioService);
  readonly wakeLock = inject(WakeLockService);

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly user = signal<User | null>(null);
  readonly categories = signal<Category[]>([]);
  readonly buttons = signal<MusicButton[]>([]);
  readonly scriptContent = signal("");
  readonly activeView = signal<View>("buttons");
  readonly editingScript = signal(false);
  readonly error = signal("");
  readonly notice = signal("");
  readonly editingCategoryId = signal<string | null>(null);
  readonly editingButtonId = signal<string | null>(null);
  readonly audioFileName = signal("");
  readonly imageFileName = signal("");
  readonly removeImage = signal(false);
  readonly buttonSaveAttempted = signal(false);
  readonly pendingScriptButton = signal<MusicButton | null>(null);
  readonly scriptRangeError = signal("");
  private audioFile: File | null = null;
  private imageFile: File | null = null;
  private scriptField: HTMLTextAreaElement | null = null;
  private scriptInsertionStart = 0;
  private scriptInsertionEnd = 0;

  readonly isAdmin = computed(() => this.user()?.role === "ADMIN");
  readonly groupedButtons = computed(() =>
    this.categories().map((category) => ({
      category,
      buttons: this.buttons().filter((button) => button.categoryId === category.id),
    })),
  );
  readonly scriptSegments = computed<ScriptSegment[]>(() =>
    parseScriptSegments(this.scriptContent(), this.buttons()),
  );

  readonly loginForm = this.fb.group({
    username: ["", [Validators.required, Validators.maxLength(80)]],
    password: ["", [Validators.required, Validators.maxLength(200)]],
  });
  readonly categoryForm = this.fb.group({
    name: ["", [Validators.required, Validators.maxLength(100)]],
    sortOrder: [10, [Validators.required, Validators.min(0)]],
  });
  readonly buttonForm = this.fb.group({
    name: ["", [Validators.required, Validators.maxLength(120)]],
    tag: ["", [Validators.required, Validators.maxLength(80), Validators.pattern(/^[a-z0-9][a-z0-9_-]*$/)]],
    description: ["", [Validators.maxLength(300)]],
    categoryId: ["", [Validators.required]],
    sortOrder: [10, [Validators.required, Validators.min(0)]],
  });
  readonly scriptForm = this.fb.group({content: ["", [Validators.maxLength(100_000)]]});
  readonly scriptRangeForm = this.fb.group({
    start: ["0:00", [Validators.required]],
    end: ["", [Validators.required]],
  });

  ngOnInit(): void {
    void this.loadData();
  }

  async login(): Promise<void> {
    if (this.loginForm.invalid || this.busy()) return;
    this.busy.set(true);
    this.clearMessages();
    try {
      const {username, password} = this.loginForm.getRawValue();
      await this.api.login(username, password);
      this.loginForm.controls.password.setValue("");
      await this.loadData(false);
      await this.wakeLock.enable();
    } catch (error) {
      this.error.set(this.messageFrom(error));
    } finally {
      this.busy.set(false);
    }
  }

  async logout(): Promise<void> {
    this.audio.stop();
    await this.api.logout().catch(() => undefined);
    this.user.set(null);
    this.categories.set([]);
    this.buttons.set([]);
    this.scriptContent.set("");
    this.activeView.set("buttons");
  }

  setView(view: View): void {
    if (view === "admin" && !this.isAdmin()) return;
    this.activeView.set(view);
    this.clearMessages();
    void this.wakeLock.enable();
  }

  async toggleMusic(
    button: MusicButton,
    startSeconds = 0,
    endSeconds: number | null = null,
  ): Promise<void> {
    await this.wakeLock.enable();
    await this.audio.toggle(button, startSeconds, endSeconds);
  }

  async toggleActiveMusic(): Promise<void> {
    await this.wakeLock.enable();
    await this.audio.toggleActive();
  }

  isMusicPlaying(button: MusicButton, startSeconds = 0, endSeconds: number | null = null): boolean {
    return this.audio.playing() && this.audio.isActive(button, startSeconds, endSeconds);
  }

  async saveCategory(): Promise<void> {
    if (this.busy()) return;
    if (this.categoryForm.invalid) {
      this.categoryForm.markAllAsTouched();
      this.error.set("Indique un nom et un ordre valides pour la catégorie.");
      return;
    }
    this.busy.set(true);
    this.clearMessages();
    try {
      const data = this.categoryForm.getRawValue();
      const id = this.editingCategoryId();
      if (id) await this.api.updateCategory(id, data);
      else await this.api.createCategory(data);
      await this.loadData(false);
      this.resetCategoryForm();
      this.notice.set(id ? "Catégorie modifiée." : "Catégorie ajoutée.");
    } catch (error) {
      this.error.set(this.messageFrom(error));
    } finally {
      this.busy.set(false);
    }
  }

  editCategory(category: Category): void {
    this.editingCategoryId.set(category.id);
    this.categoryForm.setValue({name: category.name, sortOrder: category.sortOrder});
  }

  resetCategoryForm(): void {
    this.editingCategoryId.set(null);
    this.categoryForm.reset({name: "", sortOrder: 10});
  }

  async deleteCategory(category: Category): Promise<void> {
    if (!window.confirm(`Supprimer la catégorie « ${category.name} » ?`)) return;
    this.clearMessages();
    try {
      await this.api.deleteCategory(category.id);
      await this.loadData(false);
      this.notice.set("Catégorie supprimée.");
    } catch (error) {
      this.error.set(this.messageFrom(error));
    }
  }

  suggestTag(): void {
    if (this.editingButtonId() || this.buttonForm.controls.tag.dirty) return;
    this.buttonForm.controls.tag.setValue(normalizeTagInput(this.buttonForm.controls.name.value));
  }

  normalizeButtonTag(): void {
    const control = this.buttonForm.controls.tag;
    control.setValue(normalizeTagInput(control.value || this.buttonForm.controls.name.value));
    control.updateValueAndValidity();
  }

  chooseAudio(event: Event): void {
    this.audioFile = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.audioFileName.set(this.audioFile?.name ?? "");
  }

  chooseImage(event: Event): void {
    this.imageFile = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.imageFileName.set(this.imageFile?.name ?? "");
    if (this.imageFile) this.removeImage.set(false);
  }

  async saveButton(): Promise<void> {
    this.buttonSaveAttempted.set(true);
    this.normalizeButtonTag();
    const editingId = this.editingButtonId();
    if (this.buttonForm.invalid || (!editingId && !this.audioFile) || this.busy()) {
      this.buttonForm.markAllAsTouched();
      if (!editingId && !this.audioFile) this.error.set("Choisis la musique du bouton.");
      else this.error.set("Vérifie les champs indiqués avant d’enregistrer.");
      return;
    }
    this.busy.set(true);
    this.clearMessages();
    const payload = new FormData();
    const values = this.buttonForm.getRawValue();
    payload.set("name", values.name);
    payload.set("tag", values.tag);
    payload.set("description", values.description);
    payload.set("categoryId", values.categoryId);
    payload.set("sortOrder", String(values.sortOrder));
    payload.set("removeImage", String(this.removeImage()));
    if (this.audioFile) payload.set("audio", this.audioFile);
    if (this.imageFile) payload.set("image", this.imageFile);

    try {
      if (editingId) await this.api.updateButton(editingId, payload);
      else await this.api.createButton(payload);
      await this.loadData(false);
      this.resetButtonForm();
      this.notice.set(editingId ? "Bouton modifié." : "Bouton ajouté.");
    } catch (error) {
      this.error.set(this.messageFrom(error));
    } finally {
      this.busy.set(false);
    }
  }

  editButton(button: MusicButton): void {
    this.editingButtonId.set(button.id);
    this.buttonForm.setValue({
      name: button.name,
      tag: button.tag,
      description: button.description,
      categoryId: button.categoryId,
      sortOrder: button.sortOrder,
    });
    this.audioFile = null;
    this.imageFile = null;
    this.clearFileInputs();
    this.audioFileName.set(button.audioName);
    this.imageFileName.set(button.imageAssetId ? "Image actuelle" : "");
    this.removeImage.set(false);
    this.buttonSaveAttempted.set(false);
    window.scrollTo({top: 0, behavior: "smooth"});
  }

  resetButtonForm(): void {
    this.editingButtonId.set(null);
    this.buttonForm.reset({
      name: "",
      tag: "",
      description: "",
      categoryId: this.categories()[0]?.id ?? "",
      sortOrder: 10,
    });
    this.audioFile = null;
    this.imageFile = null;
    this.clearFileInputs();
    this.audioFileName.set("");
    this.imageFileName.set("");
    this.removeImage.set(false);
    this.buttonSaveAttempted.set(false);
  }

  async deleteButton(button: MusicButton): Promise<void> {
    if (!window.confirm(`Supprimer « ${button.name} » et sa balise @${button.tag} du conducteur ?`)) return;
    this.clearMessages();
    try {
      if (this.audio.activeButton()?.id === button.id) this.audio.stop();
      await this.api.deleteButton(button.id);
      await this.loadData(false);
      this.notice.set("Bouton et balise supprimés.");
    } catch (error) {
      this.error.set(this.messageFrom(error));
    }
  }

  beginScriptEdit(): void {
    this.scriptForm.setValue({content: this.scriptContent()});
    this.cancelMusicInsert();
    this.editingScript.set(true);
  }

  cancelScriptEdit(): void {
    this.cancelMusicInsert();
    this.editingScript.set(false);
  }

  prepareMusicInsert(button: MusicButton, field: HTMLTextAreaElement): void {
    const content = this.scriptForm.controls.content.value;
    this.scriptField = field;
    this.scriptInsertionStart = field.selectionStart ?? content.length;
    this.scriptInsertionEnd = field.selectionEnd ?? this.scriptInsertionStart;
    this.pendingScriptButton.set(button);
    this.scriptRangeForm.reset({start: "0:00", end: ""});
    this.scriptRangeError.set("");
  }

  insertFullMusic(): void {
    const button = this.pendingScriptButton();
    if (button) this.commitMusicToken(buildMusicToken(button.tag));
  }

  insertMusicExcerpt(): void {
    const button = this.pendingScriptButton();
    if (!button) return;
    this.scriptRangeForm.markAllAsTouched();
    const startSeconds = parseTimecode(this.scriptRangeForm.controls.start.value);
    const endSeconds = parseTimecode(this.scriptRangeForm.controls.end.value);
    if (startSeconds === null || endSeconds === null) {
      this.scriptRangeError.set("Utilise un minutage comme 0:30 ou 1:15.");
      return;
    }
    if (endSeconds <= startSeconds) {
      this.scriptRangeError.set("La fin doit être après le début.");
      return;
    }
    this.commitMusicToken(buildMusicToken(button.tag, startSeconds, endSeconds));
  }

  cancelMusicInsert(): void {
    this.pendingScriptButton.set(null);
    this.scriptRangeError.set("");
    this.scriptField = null;
  }

  private commitMusicToken(token: string): void {
    const content = this.scriptForm.controls.content.value;
    const start = this.scriptInsertionStart;
    const end = this.scriptInsertionEnd;
    this.scriptForm.controls.content.setValue(`${content.slice(0, start)}${token}${content.slice(end)}`);
    const field = this.scriptField;
    this.cancelMusicInsert();
    queueMicrotask(() => {
      field?.focus();
      field?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async saveScript(): Promise<void> {
    if (this.busy()) return;
    if (this.scriptForm.invalid) {
      this.scriptForm.markAllAsTouched();
      this.error.set("Le conducteur dépasse la longueur maximale autorisée.");
      return;
    }
    this.busy.set(true);
    this.clearMessages();
    try {
      const result = await this.api.saveScript(this.scriptForm.controls.content.value);
      this.scriptContent.set(result.content);
      this.editingScript.set(false);
      this.notice.set("Conducteur sauvegardé.");
    } catch (error) {
      this.error.set(this.messageFrom(error));
    } finally {
      this.busy.set(false);
    }
  }

  seek(event: Event): void {
    this.audio.seek(Number((event.target as HTMLInputElement).value));
  }

  formatTime(seconds: number): string {
    return formatTimecode(seconds);
  }

  private async loadData(showLoading = true): Promise<void> {
    if (showLoading) this.loading.set(true);
    try {
      const data = await this.api.bootstrap();
      this.user.set(data.user);
      this.categories.set(data.categories);
      this.buttons.set(data.buttons);
      this.scriptContent.set(data.script.content);
      if (!this.buttonForm.controls.categoryId.value && data.categories[0]) {
        this.buttonForm.controls.categoryId.setValue(data.categories[0].id);
      }
      void this.wakeLock.enable();
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 401) this.user.set(null);
      else this.error.set(this.messageFrom(error));
    } finally {
      this.loading.set(false);
    }
  }

  private clearMessages(): void {
    this.error.set("");
    this.notice.set("");
  }

  private clearFileInputs(): void {
    if (this.audioInput) this.audioInput.nativeElement.value = "";
    if (this.imageInput) this.imageInput.nativeElement.value = "";
  }

  private messageFrom(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      return (error.error as {message?: string} | null)?.message ?? "Impossible de joindre l’application.";
    }
    return "Une erreur inattendue est survenue.";
  }

}
