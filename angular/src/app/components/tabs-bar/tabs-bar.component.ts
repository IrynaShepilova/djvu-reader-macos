import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { Router } from '@angular/router';
import { TabsService } from '../../services/tabs.service';
import { Observable } from 'rxjs';
import { Tab } from '../../interfaces/tab';
import { filter, map, startWith } from 'rxjs';
import { NavigationEnd } from '@angular/router';
import { getDocumentFormat, getDocumentFormatIcon } from '../../utils/document-format';

@Component({
  selector: 'app-tabs-bar',
  standalone: true,
  imports: [CommonModule, DragDropModule],
  templateUrl: './tabs-bar.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './tabs-bar.component.scss'
})
export class TabsBarComponent implements OnInit {

  readonly getDocumentFormat = getDocumentFormat;
  readonly getDocumentFormatIcon = getDocumentFormatIcon;

  tabs$!: Observable<Tab[]>;
  activeId$!: Observable<string | null>;
  isHomeActive$!: Observable<boolean>;

  constructor(
    private tabsService: TabsService,
    private router: Router
  ) {}

  ngOnInit() {
    this.tabs$ = this.tabsService.tabs$;
    this.activeId$ = this.tabsService.activeTabId$;


    this.isHomeActive$ = this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      startWith(null),
      map(() => this.router.url.startsWith('/library'))
    );

    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd)
    ).subscribe(() => {
      if (this.router.url.startsWith('/library')) {
        this.tabsService.setHomeActive();
      }
    });

  }

  onActivate(tabId: string) {
    this.tabsService.setActive(tabId);
    this.router.navigate(['/reader', tabId]);
  }

  onClose(tabId: string, event: MouseEvent) {
    event.stopPropagation();

    this.tabsService.closeTab(tabId);

    this.goHome();
  }

  onDrop(event: CdkDragDrop<Tab[]>) {
    if (event.previousIndex === event.currentIndex) return;

    this.tabsService.reorderTabs(
      event.previousIndex,
      event.currentIndex,
    );
  }

  goHome() {
    this.tabsService.setHomeActive();
    this.router.navigate(['/library']);
  }

}
