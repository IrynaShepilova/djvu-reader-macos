import {Component, EventEmitter, Input, Output} from '@angular/core';
import {DatePipe} from '@angular/common';
import {Book} from '../../interfaces/book';
import {MatIcon, MatIconModule} from '@angular/material/icon';
import {MatButtonModule} from '@angular/material/button';
import {MatMenu, MatMenuModule, MatMenuTrigger} from '@angular/material/menu';

@Component({
  selector: 'app-book-card',
  standalone: true,
  imports: [DatePipe, MatIcon, MatMenu, MatMenuTrigger],
  templateUrl: './book-card.component.html',
  styleUrl: './book-card.component.scss',
})
export class BookCardComponent {
  @Input({ required: true }) book!: Book;
  @Input() previewUrl?: string;

  @Output() open = new EventEmitter<Book>();
  @Output() favoriteToggle = new EventEmitter<Book>();
  @Output() edit = new EventEmitter<Book>();
}
