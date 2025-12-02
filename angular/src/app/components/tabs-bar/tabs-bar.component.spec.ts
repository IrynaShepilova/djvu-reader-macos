import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TabsBarComponent } from './tabs-bar.component';

describe('TabsBarComponent', () => {
  let component: TabsBarComponent;
  let fixture: ComponentFixture<TabsBarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TabsBarComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TabsBarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
