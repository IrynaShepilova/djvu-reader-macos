import {Component, EventEmitter, Input, Output} from '@angular/core';
import {DatePipe} from '@angular/common';
import {Book} from '../../interfaces/book';

@Component({
  selector: 'app-book-card',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './book-card.component.html',
  styleUrl: './book-card.component.scss',
})
export class BookCardComponent {
  @Input({ required: true }) book!: Book;
  @Input() previewUrl?: string;

  @Output() open = new EventEmitter<Book>();
}
