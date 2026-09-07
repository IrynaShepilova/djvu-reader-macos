import { ChangeDetectionStrategy, Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { Book } from '../../interfaces/book';

export type MissingBooksDialogData = {
  books: Book[];
};

export type MissingBooksAction = 'remove' | 'hide';

@Component({
  selector: 'app-missing-books-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
  ],
  templateUrl: './missing-books-dialog.component.html',
  styleUrl: './missing-books-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MissingBooksDialogComponent {
  constructor(
    @Inject(MAT_DIALOG_DATA)
    public data: MissingBooksDialogData,
  ) {}
}
