import type { ChatMessage } from './multiplayer';

export class RoomChat {
  private shell = document.querySelector<HTMLElement>('#chat')!;
  private body = document.querySelector<HTMLElement>('#chat-body')!;
  private toggle = document.querySelector<HTMLButtonElement>('#chat-toggle')!;
  private input = document.querySelector<HTMLInputElement>('#chat-input')!;
  private sendButton = document.querySelector<HTMLButtonElement>('#chat-send')!;
  private messages = document.querySelector<HTMLElement>('#chat-messages')!;
  private hint = document.querySelector<HTMLElement>('#chat-hint')!;
  private ready = false;
  private active = false;
  private open = true;
  private unread = 0;
  private sending = false;
  private generation = 0;

  constructor(private send: (text: string) => Promise<string | null>, private releaseMovement: () => void, private focusScene: () => void) {
    this.toggle.addEventListener('click', () => this.setOpen(!this.open));
    this.input.addEventListener('focus', releaseMovement);
    this.shell.addEventListener('keydown', event => {
      if (event.code === 'Escape') {
        event.preventDefault();
        this.input.blur();
        focusScene();
      }
      // Chat keystrokes never become game shortcuts, including WASD/Space.
      event.stopPropagation();
    });
    document.querySelector<HTMLFormElement>('#chat-form')!.addEventListener('submit', async event => {
      event.preventDefault();
      if (!this.ready || this.sending) return;
      const text = this.input.value.trim();
      if (!text) return;
      const generation = this.generation;
      this.sending = true;
      this.sendButton.disabled = true;
      const error = await this.send(text).catch(() => 'Message could not be sent. Please retry.');
      if (generation !== this.generation) return;
      this.sending = false;
      this.sendButton.disabled = !this.ready;
      if (error) { this.hint.textContent = error; return; }
      if (this.input.value.trim() === text) this.input.value = '';
      this.hint.textContent = 'Enter to send · Esc to return to the room';
      this.input.focus();
    });
    window.addEventListener('keydown', event => {
      if (!this.active || event.code !== 'Enter' || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target !== document.querySelector('#scene')) return;
      event.preventDefault();
      this.setOpen(true);
      this.input.focus();
    });
  }

  session(active: boolean) {
    ++this.generation;
    this.active = active;
    this.sending = false;
    this.shell.hidden = !active;
    this.messages.replaceChildren();
    this.input.value = '';
    this.unread = 0;
    this.setOpen(true);
    this.connection(false);
  }

  connection(ready: boolean) {
    this.ready = ready;
    this.sendButton.disabled = !ready || this.sending;
    this.hint.textContent = ready ? 'Enter to send · Esc to return to the room' : 'Chat waits for the room connection…';
  }

  receive(message: ChatMessage) {
    if (!this.active) return;
    const nearBottom = this.messages.scrollHeight - this.messages.scrollTop - this.messages.clientHeight < 40;
    const item = document.createElement('div');
    item.className = `chat-message${message.own ? ' own-message' : ''}`;
    item.dataset.message = message.id;
    const meta = document.createElement('div');
    meta.className = 'chat-meta';
    const author = document.createElement('strong');
    author.textContent = message.own ? `${message.name} (you)` : message.name;
    const time = document.createElement('time');
    time.dateTime = new Date().toISOString();
    time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const text = document.createElement('p');
    text.textContent = message.text;
    meta.append(author, time);
    item.append(meta, text);
    this.messages.append(item);
    if (this.messages.children.length > 100) this.messages.firstElementChild!.remove();
    if (nearBottom || message.own) this.messages.scrollTop = this.messages.scrollHeight;
    if (!this.open && !message.own) { this.unread++; this.updateToggle(); }
  }

  private setOpen(open: boolean) {
    this.open = open;
    this.body.hidden = !open;
    if (open) { this.unread = 0; this.messages.scrollTop = this.messages.scrollHeight; }
    this.updateToggle();
  }

  private updateToggle() {
    this.toggle.textContent = `Room chat${this.unread ? ` (${this.unread} new)` : ''} ${this.open ? '−' : '+'}`;
    this.toggle.setAttribute('aria-expanded', String(this.open));
  }
}
