import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FeedbackFlowDiagramComponent } from './feedback-flow-diagram.component';

describe('FeedbackFlowDiagramComponent', () => {
  let component: FeedbackFlowDiagramComponent;
  let fixture: ComponentFixture<FeedbackFlowDiagramComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeedbackFlowDiagramComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FeedbackFlowDiagramComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
