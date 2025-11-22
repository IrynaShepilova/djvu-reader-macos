import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NgFor, AsyncPipe } from '@angular/common';
import { BookService, Book } from './services/book.service';
import { Observable } from 'rxjs';
import { ReaderComponent } from './components/reader/reader.component';


@Component({
  selector: 'app-root',
  imports: [ AsyncPipe, ReaderComponent],
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
