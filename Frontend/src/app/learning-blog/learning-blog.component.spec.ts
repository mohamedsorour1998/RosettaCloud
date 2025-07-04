import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LearningBlogComponent } from './learning-blog.component';

describe('LearningBlogComponent', () => {
  let component: LearningBlogComponent;
  let fixture: ComponentFixture<LearningBlogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LearningBlogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(LearningBlogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
