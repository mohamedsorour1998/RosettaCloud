import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { AttachAddon } from '@xterm/addon-attach';

@Component({
  selector: 'app-lab',
  templateUrl: './lab.component.html',
  styleUrls: ['./lab.component.scss']
})
export class LabComponent implements AfterViewInit, OnDestroy {
  @ViewChild('termHost', { static: true }) termHost!: ElementRef<HTMLDivElement>;

  private terminal!: Terminal;
  private fitAddon!: FitAddon;
  private socket!: WebSocket;

  ngAfterViewInit(): void {
    // 1. Create xterm.js terminal and addons
    this.terminal = new Terminal({
      cols: 90,
      rows: 24,
      cursorBlink: true,
      theme: {
        background: '#1e1e1e',
        foreground: '#ffffff'
      }
    });
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    // 2. Open terminal into our <div>
    this.terminal.open(this.termHost.nativeElement);
    this.fitAddon.fit();

    // 3. Connect to backend WebSocket (which proxies to your Linux SSH)
    this.socket = new WebSocket('ws://localhost:3000/terminal');
    this.socket.onopen = () => {
      // Attach terminal I/O to websocket
      const attachAddon = new AttachAddon(this.socket);
      this.terminal.loadAddon(attachAddon);
    };
    this.socket.onerror = err => console.error('WebSocket error', err);

    // 4. Resize handling
    window.addEventListener('resize', () => this.fitAddon.fit());
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', () => this.fitAddon.fit());
    this.socket.close();
    this.terminal.dispose();
  }
}
