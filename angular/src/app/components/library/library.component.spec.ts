import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { BookService } from '../../services/book.service';
import { ScanFoldersFacade } from '../../services/scan-folders-facade';
import { ScanFoldersService } from '../../services/scan-folders.service';
import { TabsService } from '../../services/tabs.service';
import { LibraryComponent } from './library.component';

describe('LibraryComponent search state', () => {
  let component: LibraryComponent;

  beforeEach(async () => {
    sessionStorage.clear();

    await TestBed.configureTestingModule({
      imports: [LibraryComponent],
      providers: [
        { provide: HttpClient, useValue: { get: vi.fn().mockReturnValue(of([])) } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: TabsService, useValue: { restoreLastPage: vi.fn().mockReturnValue(null) } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: ScanFoldersService, useValue: {} },
        { provide: BookService, useValue: {} },
        {
          provide: ScanFoldersFacade,
          useValue: {
            scanFolders: signal([]),
            loadFolders: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compileComponents();

    component = TestBed.createComponent(LibraryComponent).componentInstance;
  });

  it('clears the query and persisted filter when search is closed', () => {
    component.searchOpen.set(true);
    component.setSearchQuery('algebra');
    sessionStorage.setItem('djvu.library.searchQuery.v1', 'algebra');

    component.toggleSearch();

    expect(component.searchOpen()).toBe(false);
    expect(component.searchQuery()).toBe('');
    expect(sessionStorage.getItem('djvu.library.searchQuery.v1')).toBeNull();
  });

  it('does not restore a search after it has been cleared', () => {
    component.searchOpen.set(true);
    component.setSearchQuery('algebra');
    sessionStorage.setItem('djvu.library.searchQuery.v1', 'algebra');

    component.clearSearch();
    const returnedComponent = TestBed.createComponent(LibraryComponent).componentInstance;
    returnedComponent['restoreSearchQuery']();

    expect(returnedComponent.searchOpen()).toBe(false);
    expect(returnedComponent.searchQuery()).toBe('');
  });

  it('reopens search with an empty input after it was closed', () => {
    component.searchOpen.set(true);
    component.setSearchQuery('algebra');

    component.toggleSearch();
    component.toggleSearch();

    expect(component.searchOpen()).toBe(true);
    expect(component.searchQuery()).toBe('');
  });
});
