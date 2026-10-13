(() => {
  const clock = document.createElement("div");
  clock.id = "test-time-clock";
  clock.setAttribute("role", "status");
  clock.setAttribute("aria-live", "polite");
  Object.assign(clock.style, {
    position: "fixed",
    top: "74px",
    right: "12px",
    zIndex: "20",
    padding: "7px 10px",
    border: "1px solid #e4e4dd",
    borderRadius: "9px",
    color: "#52534c",
    background: "rgba(255,255,255,.96)",
    boxShadow: "0 2px 10px rgba(39,37,31,.08)",
    font: '12px/1.4 "Segoe UI", system-ui, sans-serif'
  });

  const updateClock = () => {
    clock.textContent = `ساعت محلی: ${new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(new Date())}`;
  };

  document.body.appendChild(clock);
  updateClock();
  window.setInterval(updateClock, 1000);
})();
