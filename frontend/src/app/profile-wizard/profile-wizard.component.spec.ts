import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProfileWizardComponent } from './profile-wizard.component';

describe('ProfileWizardComponent', () => {
  let component: ProfileWizardComponent;
  let fixture: ComponentFixture<ProfileWizardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProfileWizardComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ProfileWizardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
