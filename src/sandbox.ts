// Listen for messages from the parent window or opener.
window.addEventListener('message', (event) => {
  // In a sandbox, the origin is null, so we can't easily check event.origin
  // against a specific value without passing it in or relying on other methods.
  // However, since this page has no access to sensitive APIs, the risk is low.

  const data = event.data;
  if (data && data.type === 'render' && typeof data.html === 'string') {
    const contentDiv = document.getElementById('content');
    if (contentDiv) {
      contentDiv.innerHTML = data.html;
    }
  }
});
