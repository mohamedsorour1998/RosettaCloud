import { Component } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-lab',
  templateUrl: './lab.component.html',
  styleUrls: ['./lab.component.scss']
})
export class LabComponent {
  codeServerUrl: SafeResourceUrl;

  constructor(private sanitizer: DomSanitizer) {
    const rawUrl = 'http://127.0.0.1:8080'; // point to your mapped port
    this.codeServerUrl = this.sanitizer.bypassSecurityTrustResourceUrl(rawUrl);
  }
}
