import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ReaderImgComponent } from './reader-img.component';

describe('ReaderImgComponent', () => {
  let component: ReaderImgComponent;
  let fixture: ComponentFixture<ReaderImgComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReaderImgComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ReaderImgComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
