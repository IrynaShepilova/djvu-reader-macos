import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { BookService, Book } from './services/book.service';
import { Observable } from 'rxjs';


@Component({
  selector: 'app-root',
  imports: [  RouterOutlet ],
  standalone: true,
  templateUrl: './app.html',
  styleUrl: './app.scss',

})
export class AppComponent {
  protected readonly title = signal('angular');
  books$: Observable<Book[]>;

  constructor ( private bookService: BookService ) {
    this.books$ = this.bookService.getBooks();

  }

}
