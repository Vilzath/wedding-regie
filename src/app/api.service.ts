import {HttpClient} from "@angular/common/http";
import {inject, Injectable} from "@angular/core";
import {firstValueFrom} from "rxjs";
import type {BootstrapData, Category, MusicButton, User} from "./models";

@Injectable({providedIn: "root"})
export class ApiService {
  private readonly http = inject(HttpClient);

  login(username: string, password: string): Promise<{user: User}> {
    return firstValueFrom(this.http.post<{user: User}>("/api/auth/login", {username, password}));
  }

  logout(): Promise<void> {
    return firstValueFrom(this.http.post<void>("/api/auth/logout", {}));
  }

  bootstrap(): Promise<BootstrapData> {
    return firstValueFrom(this.http.get<BootstrapData>("/api/bootstrap"));
  }

  createCategory(data: Pick<Category, "name" | "sortOrder">): Promise<Category> {
    return firstValueFrom(this.http.post<Category>("/api/categories", data));
  }

  updateCategory(id: string, data: Pick<Category, "name" | "sortOrder">): Promise<Category> {
    return firstValueFrom(this.http.put<Category>(`/api/categories/${id}`, data));
  }

  deleteCategory(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/categories/${id}`));
  }

  createButton(data: FormData): Promise<MusicButton> {
    return firstValueFrom(this.http.post<MusicButton>("/api/buttons", data));
  }

  updateButton(id: string, data: FormData): Promise<MusicButton> {
    return firstValueFrom(this.http.put<MusicButton>(`/api/buttons/${id}`, data));
  }

  deleteButton(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/buttons/${id}`));
  }

  saveScript(content: string): Promise<{content: string; updatedAt: string}> {
    return firstValueFrom(
      this.http.put<{content: string; updatedAt: string}>("/api/script", {content}),
    );
  }
}
