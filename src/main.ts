import {provideHttpClient, withInterceptors} from "@angular/common/http";
import {bootstrapApplication} from "@angular/platform-browser";
import {catchError, throwError} from "rxjs";
import {AppComponent} from "./app/app.component";

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(
      withInterceptors([
        (request, next) =>
          next(request).pipe(
            catchError((error: unknown) => throwError(() => error)),
          ),
      ]),
    ),
  ],
}).catch((error) => console.error(error));
