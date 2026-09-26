import { Component, Inject, OnInit, ChangeDetectionStrategy } from '@angular/core';

import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatIcon } from '@angular/material/icon';

import { Book } from '../../interfaces/book';
import { BookService } from '../../services/book.service';
import {DatePipe} from '@angular/common';

type EditBookDialogData = {
  book: Book;
  coverUrl?: string;
};

@Component({
  selector: 'app-edit-book-dialog',
  standalone: true,
  templateUrl: './edit-book-dialog.component.html',
  imports: [
    MatDialogModule,
    MatButtonModule,
    ReactiveFormsModule,
    MatCheckbox,
    MatIcon,
    DatePipe
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './edit-book-dialog.component.scss',
})
export class EditBookDialogComponent implements OnInit {
  form: FormGroup;

  selectedCoverFile: File | null = null;
  coverPreviewUrl: string | null = null;
  removeCoverRequested = false;
  loadingCoverPreview = false;
  showInFinderError: string | null = null;
  readonly isElectron = !!window.electronAPI?.showItemInFolder;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: EditBookDialogData,
    private dialogRef: MatDialogRef<EditBookDialogComponent>,
    private fb: FormBuilder,
    private bookService: BookService,
  ) {
    this.form = this.fb.nonNullable.group({
      title: [''],
      author: [''],
      favorite: [false],
    });
  }

  ngOnInit() {
    this.form.setValue({
      title: this.data.book.title ?? '',
      author: this.data.book.author ?? '',
      favorite: !!this.data.book.favorite,
    });
  }

  async removeCover() {
    this.selectedCoverFile = null;
    this.removeCoverRequested = true;
    this.loadingCoverPreview = true;

    try {
      this.coverPreviewUrl = await this.bookService.buildPreview(this.data.book, false);
    } catch (e) {
      console.error('Failed to build first page preview', e);
      this.coverPreviewUrl = null;
    } finally {
      this.loadingCoverPreview = false;
    }
  }

  onCoverSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    this.selectedCoverFile = file;
    this.removeCoverRequested = false;
    this.coverPreviewUrl = URL.createObjectURL(file);

    input.value = '';
  }

  async showInFinder() {
    const filePath = this.data.book.fullPath;

    if (!filePath || !window.electronAPI?.showItemInFolder) return;

    this.showInFinderError = null;
    const result = await window.electronAPI.showItemInFolder(filePath);

    if (result.ok) return;

    this.showInFinderError = result.code === 'NETWORK_VOLUME_UNAVAILABLE'
      ? `The network volume is unavailable: ${result.volumePath ?? filePath}. Reconnect it, then try again.`
      : 'The book file is not available.';
  }

  save() {
    const value = this.form.getRawValue();

    this.dialogRef.close({
      book: this.data.book,
      patch: {
        title: value.title.trim(),
        author: value.author.trim() || '',
        favorite: value.favorite,
      },
      coverFile: this.selectedCoverFile,
      removeCover: this.removeCoverRequested,
    });
  }

  close() {
    this.dialogRef.close();
  }
}
