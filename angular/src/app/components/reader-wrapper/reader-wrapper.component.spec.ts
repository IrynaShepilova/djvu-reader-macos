import { ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { vi } from 'vitest';
import { BookLoadError } from '../../classes/book-load-error';
import { TabsService } from '../../services/tabs.service';
import { ReaderWrapperComponent } from './reader-wrapper.component';

describe('ReaderWrapperComponent', () => {
  function createComponent() {
    const state = {
      loading: false,
      loadingDone: false,
      totalPages: 0,
      currentPage: 1,
    } as any;
    const tabsService = {
      getState: vi.fn().mockReturnValue(state),
      ensureTabState: vi.fn().mockReturnValue(state),
      loadBook: vi.fn().mockResolvedValue(undefined),
      getSavedReadingPosition: vi.fn().mockReturnValue(null),
      getTabInfo: vi.fn().mockReturnValue(undefined),
    };
    const cdr = { detectChanges: vi.fn() };
    const component = new ReaderWrapperComponent(
      {} as ActivatedRoute,
      tabsService as unknown as TabsService,
      cdr as unknown as ChangeDetectorRef,
    );

    component.tabId = 'tab-1';
    return { component, tabsService };
  }

  it('describes an unavailable network volume in the existing error view', () => {
    const { component } = createComponent();

    component['setLoadError'](
      new BookLoadError(
        'The network volume is unavailable.',
        'NETWORK_VOLUME_UNAVAILABLE',
        '/Volumes/Library-NAS',
      ),
    );

    expect(component.loadErrorMessage).toContain('/Volumes/Library-NAS');
  });

  it('retries opening the same book with a forced reload', async () => {
    const { component, tabsService } = createComponent();

    await component.retry();

    expect(tabsService.loadBook).toHaveBeenCalledWith('tab-1', true);
  });
});
