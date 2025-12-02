import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ReaderWrapperComponent } from './reader-wrapper.component';

describe('ReaderWrapperComponent', () => {
  let component: ReaderWrapperComponent;
  let fixture: ComponentFixture<ReaderWrapperComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReaderWrapperComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ReaderWrapperComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
