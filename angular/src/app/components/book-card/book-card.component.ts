import {Component, EventEmitter, Input, Output, ChangeDetectionStrategy} from '@angular/core';
import {DatePipe, JsonPipe} from '@angular/common';
import {Book} from '../../interfaces/book';
import {MatIcon, MatIconModule} from '@angular/material/icon';
import {MatButtonModule} from '@angular/material/button';
import {MatMenu, MatMenuModule, MatMenuTrigger} from '@angular/material/menu';
import { getDocumentFormat, getDocumentFormatIcon } from '../../utils/document-format';
import {LibraryViewMode} from '../library-toolbar/library-toolbar.component';

@Component({
  selector: 'app-book-card',
  standalone: true,
  imports: [DatePipe, MatIcon, MatMenu, MatMenuTrigger, JsonPipe],
  templateUrl: './book-card.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './book-card.component.scss',
})
export class BookCardComponent {
  readonly getDocumentFormat = getDocumentFormat;
  readonly getDocumentFormatIcon = getDocumentFormatIcon;
  @Input({ required: true }) book!: Book;
  @Input() previewUrl?: string;
  @Input() viewMode!: LibraryViewMode;

  @Output() open = new EventEmitter<Book>();
  @Output() favoriteToggle = new EventEmitter<Book>();
  @Output() edit = new EventEmitter<Book>();
  @Output() hiddenToggle = new EventEmitter<Book>();
  @Output() remove = new EventEmitter<Book>();
}
