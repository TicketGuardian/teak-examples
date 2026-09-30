// A stand-in for teak.js, used by the browser tests in place of the real widget.
// It follows the widget's public API: queued commands, configure, clearSession, get,
// isProtected, and the callbacks. It renders two buttons in <teak-widget> for the choice.
// Set window.__teakSessionPrefix before it loads to control the mock API's outcome.
(function () {
  const queued = (window.teak && window.teak.q) || [];
  let options = null;
  let protectedChoice = null;
  let session = null;
  let count = 0;

  const quote = () => (options ? (options.items.length * 3.25).toFixed(2) : null);
  const context = () => ({ isProtected: protectedChoice, isFormComplete: protectedChoice !== null });

  function render() {
    const element = document.querySelector('teak-widget');
    if (!element || !options) return;
    element.innerHTML = `
      <div data-testid="fake-teak">
        <p>Refund protection: $${quote()}</p>
        <button type="button" data-testid="teak-opt-in">Yes, protect my order</button>
        <button type="button" data-testid="teak-opt-out">No thanks</button>
      </div>`;
    element.querySelector('[data-testid="teak-opt-in"]').onclick = () => choose(true);
    element.querySelector('[data-testid="teak-opt-out"]').onclick = () => choose(false);
  }

  function choose(value) {
    protectedChoice = value;
    (value ? options.optInCb : options.optOutCb)?.(context());
  }

  function run(command, opts) {
    switch (String(command).toLowerCase()) {
      case 'configure': {
        const first = !options;
        options = { ...(options || {}), ...opts };
        if (!session) session = `${window.__teakSessionPrefix || 'sess-'}${Date.now()}-${++count}`;
        render();
        if (first) options.loadedCb?.(context());
        else options.updatedCb?.(context());
        break;
      }
      case 'clearsession':
        options = null;
        protectedChoice = null;
        session = null;
        break;
    }
  }

  const teak = (command, opts) => run(command, opts);
  teak.get = (key) => (key === 'token' ? session : key === 'quote' ? quote() : undefined);
  teak.isProtected = () => protectedChoice === true;
  teak.isFormComplete = () => protectedChoice !== null;
  window.teak = teak;
  queued.forEach((args) => run(...args));
})();
