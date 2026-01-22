import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TabsService } from '../../services/tabs.service';
import { Observable } from 'rxjs';
import { Tab } from '../../interfaces/tab';
import { filter, map, startWith } from 'rxjs';
import { NavigationEnd } from '@angular/router';

@Component({
  selector: 'app-tabs-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tabs-bar.component.html',
  styleUrl: './tabs-bar.component.scss'
})
export class TabsBarComponent implements OnInit {

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

    const wasActive = this.tabsService.activeTabId === tabId;

    this.tabsService.closeTab(tabId);

    if (wasActive) {
      const next = this.tabsService.activeTabId;
      if (next) {
        this.router.navigate(['/reader', next]);
      } else {
        this.goHome();
      }
    }
  }

  goHome() {
    this.tabsService.setHomeActive();
    this.router.navigate(['/library']);
  }

}
