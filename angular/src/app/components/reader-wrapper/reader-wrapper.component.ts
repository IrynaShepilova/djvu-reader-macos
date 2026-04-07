import { Component, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ReaderComponent } from '../reader/reader.component';
import { TabsService } from '../../services/tabs.service';
import {TabsBarComponent} from '../tabs-bar/tabs-bar.component';
import {TabState} from '../../interfaces/tabState';

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


  constructor(
    private route: ActivatedRoute,
    private tabsService: TabsService,
  ) {}

  ngOnInit() {
    this.route.paramMap.subscribe(async params => {
      const tabId = params.get('id');
      if (!tabId) return;

      if (this.tabId !== tabId) {
        this.tabId = tabId;
        this.state = this.tabsService.getState(tabId);
        if (!this.state) {
          this.tabsService.ensureTabState(tabId);
          this.state = this.tabsService.getState(tabId);
        }

        if (!this.state?.loadingDone && !this.state?.loading) {
          await this.tabsService.loadBook(tabId);
        }

        const saved = this.tabsService.getSavedPageForTab(tabId);
        if (this.state && saved) {
          const max = this.state.totalPages || 1;
          this.state.currentPage = Math.min(Math.max(1, saved), max);
        }

        queueMicrotask(() => {
          if (this.readerImg && this.state) {
            this.readerImg.focusCurrentPage();
          }
        });
      }
    });
  }

}
