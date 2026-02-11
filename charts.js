// ============================================
// MyLife v2 — Charts Engine
// Wraps Chart.js + custom Canvas drawings
// ============================================

const Charts = (() => {
  const instances = {};

  function destroy(canvasId) {
    if (instances[canvasId]) {
      instances[canvasId].destroy();
      delete instances[canvasId];
    }
  }

  // ---- Health Score Ring (Canvas 2D) ----
  function healthScore(canvasId, score, maxScore = 10) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const cx = size / 2, cy = size / 2;
    const radius = size / 2 - 16;
    const lineWidth = 14;
    const pct = Math.min(score / maxScore, 1);

    // Color based on score
    let color;
    if (score >= 8) color = '#34d399';      // green
    else if (score >= 6) color = '#4facfe'; // blue
    else if (score >= 4) color = '#fbbf24'; // yellow
    else color = '#f87171';                  // red

    ctx.clearRect(0, 0, size, size);

    // Background ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Score arc (animated via CSS or re-draw)
    if (pct > 0) {
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + (Math.PI * 2 * pct);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';

      // Glow effect
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Score text
    ctx.fillStyle = '#e8e8f0';
    ctx.font = `bold ${size / 3.5}px 'Tajawal', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(score.toFixed(1), cx, cy - 4);

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `${size / 10}px 'Tajawal', sans-serif`;
    ctx.fillText('Health Score', cx, cy + size / 5);
  }

  // ---- Sparkline (tiny inline chart, Canvas 2D) ----
  function sparkline(canvasId, data, color = '#4facfe') {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !data || data.length < 2) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const pad = 2;

    ctx.clearRect(0, 0, w, h);

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const stepX = (w - pad * 2) / (data.length - 1);

    // Gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, color + '40');
    gradient.addColorStop(1, color + '00');

    // Line path
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = pad + i * stepX;
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    // Stroke
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Fill area
    const lastX = pad + (data.length - 1) * stepX;
    ctx.lineTo(lastX, h);
    ctx.lineTo(pad, h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Last point dot
    const lastY = h - pad - ((data[data.length - 1] - min) / range) * (h - pad * 2);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // ---- Line Chart (Chart.js) ----
  function line(canvasId, labels, datasets, options = {}) {
    destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const defaultColors = ['#4facfe', '#34d399', '#a855f7', '#fb923c', '#f87171'];

    const chartDatasets = (Array.isArray(datasets[0]) ? datasets : [datasets]).map((data, i) => ({
      data,
      label: options.labels?.[i] || `Series ${i + 1}`,
      borderColor: options.colors?.[i] || defaultColors[i % defaultColors.length],
      backgroundColor: (options.colors?.[i] || defaultColors[i % defaultColors.length]) + '20',
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.3,
      fill: i === 0
    }));

    instances[canvasId] = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets: chartDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: chartDatasets.length > 1,
            labels: { color: '#a0a0b8', font: { family: "'Tajawal', sans-serif" } }
          },
          tooltip: {
            backgroundColor: '#1a1a2e',
            titleColor: '#e8e8f0',
            bodyColor: '#a0a0b8',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            cornerRadius: 8,
            padding: 10
          }
        },
        scales: {
          x: {
            ticks: { color: '#6a6a82', maxRotation: 45, font: { size: 11 } },
            grid: { color: 'rgba(255,255,255,0.04)' }
          },
          y: {
            ticks: { color: '#6a6a82', font: { size: 11 } },
            grid: { color: 'rgba(255,255,255,0.04)' },
            beginAtZero: options.beginAtZero ?? false
          }
        }
      }
    });
  }

  // ---- Bar Chart (Chart.js) ----
  function bar(canvasId, labels, data, options = {}) {
    destroy(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const color = options.color || '#4facfe';

    instances[canvasId] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: color + '80',
          borderColor: color,
          borderWidth: 1,
          borderRadius: 6,
          label: options.label || ''
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a1a2e',
            titleColor: '#e8e8f0',
            bodyColor: '#a0a0b8',
            cornerRadius: 8
          }
        },
        scales: {
          x: {
            ticks: { color: '#6a6a82', font: { size: 11 } },
            grid: { display: false }
          },
          y: {
            ticks: { color: '#6a6a82', font: { size: 11 } },
            grid: { color: 'rgba(255,255,255,0.04)' },
            beginAtZero: true
          }
        }
      }
    });
  }

  return { healthScore, sparkline, line, bar, destroy };
})();
