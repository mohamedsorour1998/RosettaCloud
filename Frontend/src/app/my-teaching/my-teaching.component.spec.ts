import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MyTeachingComponent } from './my-teaching.component';

describe('MyTeachingComponent', () => {
  let component: MyTeachingComponent;
  let fixture: ComponentFixture<MyTeachingComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MyTeachingComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MyTeachingComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
