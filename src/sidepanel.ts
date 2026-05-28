import { UIRenderer } from './ui-renderer';

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('app-root');
  if (!container) return;

  const renderer = new UIRenderer(container, 'sidepanel');

  // 1. Initial render of saved or welcoming state
  void renderer.loadAndRender();

  // 2. Listen for push updates from background Sw when the agent outputs a new UI
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'ui-state-updated' && msg.ui) {
      renderer.render(msg.ui);
    }
  });

  // 3. Notify the background service worker that sidepanel is open to trigger agent execution
  void chrome.runtime.sendMessage({ type: 'ui-opened', view: 'sidepanel' });
});
