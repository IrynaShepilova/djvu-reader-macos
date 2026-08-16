import { Component, OnInit, ViewChild, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ReaderComponent } from '../reader/reader.component';
import { TabsService } from '../../services/tabs.service';
import {TabsBarComponent} from '../tabs-bar/tabs-bar.component';
import {ReadingPosition, TabState} from '../../interfaces/tabState';
import {Tab} from '../../interfaces/tab';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-reader-wrapper',
  standalone: true,
  imports: [ReaderComponent, TabsBarComponent],
  templateUrl: './reader-wrapper.component.html',
  styleUrl: './reader-wrapper.component.scss',
})

export class ReaderWrapperComponent implements OnInit {

  @ViewChild(ReaderComponent)
  readerImg!: ReaderComponent;
  state: TabState | null = null;
  tabId!: string;
  loadError: Error | null = null;
  errorBookInfo: Tab | undefined = undefined;
  errorCoverUrl: string | null = null;
  savedReadingPosition: ReadingPosition | null = null;

  constructor(
    private route: ActivatedRoute,
    private tabsService: TabsService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.route.paramMap.subscribe(async params => {
      const tabId = params.get('id');
      if (!tabId) return;

      if (this.tabId !== tabId) {
        this.tabId = tabId;
        await this.loadCurrentTab();
      }
    });
  }

  private async loadCurrentTab(forceReload = false) {
    this.resetLoadError();

    this.state = this.tabsService.getState(this.tabId);

    if (!this.state) {
      this.tabsService.ensureTabState(this.tabId);
      this.state = this.tabsService.getState(this.tabId);
    }

    if (forceReload || (!this.state?.loadingDone && !this.state?.loading)) {
      await this.loadCurrentBook(forceReload);
    }

    if (!this.loadError) {
      this.restorePosition();
      this.cdr.detectChanges();
      if (this.savedReadingPosition) {
        this.readerImg?.restoreReadingPosition(
          this.savedReadingPosition.offsetRatio
        );
      } else {
        this.readerImg?.focusCurrentPage();
      }
    }

  }

  private resolveCoverUrl(cover?: string | null): string | null {
    if (!cover) return null;

    if (
      cover.startsWith('http://') ||
      cover.startsWith('https://') ||
      cover.startsWith('blob:') ||
      cover.startsWith('data:')
    ) {
      return cover;
    }

    return `${environment.apiBase}${cover.startsWith('/') ? '' : '/'}${cover}`;
  }

  async retry() {
    await this.loadCurrentTab(true);
  }

  private async loadCurrentBook(forceReload = false) {
    await this.tabsService
      .loadBook(this.tabId, forceReload)
      .catch(err => this.setLoadError(err));
  }

  private setLoadError(err: Error) {
    this.loadError = err;
    this.errorBookInfo = this.tabsService.getTabInfo(this.tabId);
    this.errorCoverUrl = this.resolveCoverUrl(
      this.errorBookInfo?.book.cover
    );
  }

  private resetLoadError() {
    this.loadError = null;
    this.errorBookInfo = undefined;
    this.errorCoverUrl = null;
  }

  private restorePosition() {
    const saved = this.tabsService.getSavedReadingPosition(this.tabId);
    this.savedReadingPosition = saved;

    if (!this.state || !saved) return;

    const max = this.state.totalPages || 1;

    this.state.currentPage = Math.min(
      Math.max(1, saved.page),
      max
    );
  }

}
