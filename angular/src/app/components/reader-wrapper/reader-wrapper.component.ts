import { Component, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ReaderImgComponent } from '../reader-img/reader-img.component';
import { TabsService } from '../../services/tabs.service';
import {TabsBarComponent} from '../tabs-bar/tabs-bar.component';
import {TabState} from '../../interfaces/tabState';

@Component({
  selector: 'app-reader-wrapper',
  standalone: true,
  imports: [ReaderImgComponent, TabsBarComponent],
  templateUrl: './reader-wrapper.component.html',
  styleUrl: './reader-wrapper.component.scss',
})

export class ReaderWrapperComponent implements OnInit {

  @ViewChild(ReaderImgComponent)
  readerImg!: ReaderImgComponent;
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

        if (!this.state?.loadingDone && !this.state?.loading) {
          await this.tabsService.loadBook(tabId);
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
