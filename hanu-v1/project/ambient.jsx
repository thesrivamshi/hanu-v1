/* Ambient background layer — soft shader-like gradient orbs.
   Uses CSS but adds a subtle canvas noise for premium depth. */

function Ambient() {
  const canvasRef = React.useRef(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
    };
    resize();
    window.addEventListener("resize", resize);

    // 4 slow drifting orbs
    const orbs = [
      { x: 0.8, y: 0.1, r: 0.4, color: [240, 168, 104], speed: 0.00006, phase: 0 },
      { x: 0.15, y: 0.85, r: 0.45, color: [138, 123, 255], speed: 0.00005, phase: 2 },
      { x: 0.6, y: 0.6, r: 0.35, color: [95, 212, 199], speed: 0.00008, phase: 4 },
      { x: 0.4, y: 0.3, r: 0.3, color: [255, 158, 192], speed: 0.00004, phase: 1 },
    ];

    const draw = (t) => {
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      orbs.forEach((o, i) => {
        const dx = Math.sin(t * o.speed + o.phase) * 0.18;
        const dy = Math.cos(t * o.speed * 1.3 + o.phase) * 0.14;
        const cx = (o.x + dx) * w;
        const cy = (o.y + dy) * h;
        const rad = o.r * Math.min(w, h);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        const [r, g, b] = o.color;
        grad.addColorStop(0, `rgba(${r},${g},${b},0.22)`);
        grad.addColorStop(0.4, `rgba(${r},${g},${b},0.08)`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fill();
      });

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <React.Fragment>
      <div className="ambient">
        <div className="orb-3"></div>
      </div>
      <canvas ref={canvasRef} className="ambient-canvas" style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", mixBlendMode: "screen", opacity: 0.65 }} />
      <div className="grain"></div>
      <div className="vignette"></div>
    </React.Fragment>
  );
}

window.Ambient = Ambient;
