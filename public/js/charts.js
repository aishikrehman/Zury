// Renders [data-chart] elements with ApexCharts using Tabler's chart defaults.
// ApexCharts is only downloaded on pages that actually contain a chart.
(function () {
  const nodes = document.querySelectorAll('[data-chart]');
  if (!nodes.length) return;

  const color = (name) => (name.startsWith('#') || name.startsWith('var(') ? name : `var(--tblr-${name})`);

  function build(spec) {
    const sparkline = Boolean(spec.sparkline);
    const config = {
      chart: {
        type: spec.type,
        height: spec.height || 240,
        fontFamily: 'inherit',
        parentHeightOffset: 0,
        toolbar: { show: false },
        sparkline: { enabled: sparkline },
        animations: { enabled: !window.matchMedia('(prefers-reduced-motion: reduce)').matches, speed: 600 },
      },
      series: spec.series,
      colors: (spec.colors || ['primary']).map(color),
      dataLabels: { enabled: false },
      legend: { show: Boolean(spec.legend), position: 'bottom', offsetY: 8, markers: { width: 10, height: 10, radius: 100 }, itemMargin: { horizontal: 8, vertical: 6 } },
      tooltip: { theme: 'dark', fillSeriesColor: false },
      grid: { strokeDashArray: 4, padding: sparkline ? {} : { top: -20, right: 0, left: -4, bottom: -4 } },
    };

    if (spec.type === 'area' || spec.type === 'line') {
      config.stroke = { width: 2, lineCap: 'round', curve: 'smooth' };
      if (spec.type === 'area') config.fill = { opacity: 0.16, type: 'solid' };
      config.xaxis = { type: 'datetime', categories: spec.labels, labels: { padding: 0 }, tooltip: { enabled: false }, axisBorder: { show: false } };
      config.yaxis = { min: 0, forceNiceScale: true, labels: { padding: 4, formatter: (v) => (Number.isInteger(v) ? v : '') } };
    }
    if (spec.type === 'bar') {
      config.plotOptions = { bar: { columnWidth: (spec.labels || []).length < 4 ? '22%' : '50%', borderRadius: 4, horizontal: Boolean(spec.horizontal), distributed: Boolean(spec.distributed) } };
      config.xaxis = { categories: spec.labels, labels: { padding: 0 }, tooltip: { enabled: false }, axisBorder: { show: false } };
      config.yaxis = { min: 0, forceNiceScale: true, labels: { padding: 4, formatter: (v) => (Number.isInteger(v) ? v : '') } };
      if (spec.distributed) config.legend.show = false;
    }
    if (spec.type === 'donut' || spec.type === 'pie') {
      config.labels = spec.labels;
      config.stroke = { width: 0 };
      config.plotOptions = { pie: { donut: { size: '72%', labels: { show: true, total: { show: true, label: spec.totalLabel || 'Total', fontWeight: 500 } } } } };
      config.legend.show = spec.legend !== false;
    }
    if (spec.type === 'radialBar') {
      config.plotOptions = {
        radialBar: {
          hollow: { size: '62%' },
          track: { background: 'var(--tblr-gray-200)' },
          dataLabels: { name: { show: Boolean(spec.label), offsetY: 20 }, value: { offsetY: -8, fontSize: '1.5rem', fontWeight: 600, formatter: (v) => `${v}%` } },
        },
      };
      config.labels = [spec.label || ''];
      config.stroke = { lineCap: 'round' };
    }
    return config;
  }

  function render() {
    nodes.forEach((el) => {
      try {
        const chart = new window.ApexCharts(el, build(JSON.parse(el.dataset.chart)));
        chart.render();
      } catch (err) {
        el.textContent = 'Chart could not be displayed.';
        console.error(err);
      }
    });
  }

  if (window.ApexCharts) return render();
  const script = document.createElement('script');
  script.src = '/vendor/apexcharts/apexcharts.min.js';
  script.onload = render;
  document.head.appendChild(script);
})();
