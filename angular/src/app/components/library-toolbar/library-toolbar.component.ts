import {Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild} from '@angular/core';
import {MatIcon} from '@angular/material/icon';

export type LibraryViewMode = 'tile' | 'list';
export type SortMode = 'default' | 'lastOpened' | 'byDirectory' | 'title' | 'category';

export type SortOption = {
  value: SortMode;
  label: string;
};

@Component({
  selector: 'app-library-toolbar',
  standalone: true,
  imports: [
    MatIcon
  ],
  templateUrl: './library-toolbar.component.html',
  styleUrl: './library-toolbar.component.scss',
})
export class LibraryToolbarComponent {
  @ViewChild('sortDropdownRoot', { static: true })
  sortDropdownRoot!: ElementRef<HTMLElement>;

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.sortMenuOpen) return;
    const target = event.target as Node | null;
    if (!target) return;

    const clickedInside = this.sortDropdownRoot.nativeElement.contains(target);

    if (!clickedInside) {
      this.sortMenuOpen =false;
    }
  }

  @Input({ required: true }) booksCount = 0;
  @Input({ required: true }) isScanning = false;
  @Input({ required: true }) viewMode: LibraryViewMode = 'tile';
  @Input({ required: true }) sortLabel = 'Default';
  @Input({ required: true }) sortOptions: SortOption[] = [];
  @Input({ required: true }) sortMenuOpen = false;
  @Input() searchOpen = false;
  @Input() searchQuery = '';

  @Output() toggleSortMenu = new EventEmitter<void>();
  @Output() sortModeChange = new EventEmitter<SortMode>();
  @Output() toggleViewMode = new EventEmitter<void>();
  @Output() refresh = new EventEmitter<void>();
  @Output() scan = new EventEmitter<void>();
  @Output() openFolders = new EventEmitter<void>();
  @Output() toggleSearch = new EventEmitter<void>();
  @Output() searchQueryChange = new EventEmitter<string>();
  @Output() clearSearch = new EventEmitter<void>();
}
