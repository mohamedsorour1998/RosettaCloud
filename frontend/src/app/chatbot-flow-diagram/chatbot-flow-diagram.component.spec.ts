import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChatbotFlowDiagramComponent } from './chatbot-flow-diagram.component';

describe('ChatbotFlowDiagramComponent', () => {
  let component: ChatbotFlowDiagramComponent;
  let fixture: ComponentFixture<ChatbotFlowDiagramComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatbotFlowDiagramComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ChatbotFlowDiagramComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
