const $ = id => document.getElementById(id);
const apiBaseUrl = (window.AIGC_CONFIG?.apiBaseUrl || '').replace(/\/+$/, '');
const state = { source: null, image: null, version: 0, paint: 0, controller: null, timer: null,
  baseScore: null, tiles: [], heatmap: true, transform: { jpeg: 100, crop: 1, scale: 1 } };
const canvas = $('image-canvas'), ctx = canvas.getContext('2d');
const heat = $('heatmap-canvas'), heatCtx = heat.getContext('2d');

function pendingResult() {
  $('verdict').textContent = '等待检测';
  $('verdict').style.color = 'var(--muted)';
  ['score-value', 'stress-score', 'stress-delta', 'latency'].forEach(id => $(id).textContent = '—');
  $('score-ring').style.background = '#e9efeb';
  $('confidence-bar-fill').style.width = '0%';
  $('score-description').textContent = '正在准备模型输入。';
}
function resetControls() {
  $('jpeg-range').value = '100'; $('crop-select').value = '1';
  $('scale-select').value = '1'; $('combo-select').value = 'none';
  state.transform = { jpeg: 100, crop: 1, scale: 1 };
}
function fit() {
  if (!state.image) return null;
  const scale = Math.min((canvas.width - 32) / state.image.width, (canvas.height - 32) / state.image.height);
  const w = state.image.width * scale, h = state.image.height * scale;
  return { x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w, h };
}
function drawHeatmap() {
  heatCtx.clearRect(0, 0, heat.width, heat.height);
  const f = fit();
  if (!f || !state.heatmap) return;
  for (const tile of state.tiles) {
    const score = tile.score;
    heatCtx.fillStyle = score >= .7 ? 'rgba(236,110,84,.42)' : score >= .5 ? 'rgba(240,182,75,.36)' : 'rgba(71,182,146,.32)';
    heatCtx.fillRect(f.x + tile.col * f.w / tile.grid + 1, f.y + tile.row * f.h / tile.grid + 1,
      f.w / tile.grid - 2, f.h / tile.grid - 2);
  }
}
function resizeCanvas() {
  const box = $('image-wrap').getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
  canvas.width = heat.width = Math.round(box.width * ratio);
  canvas.height = heat.height = Math.round(box.height * ratio);
  const f = fit();
  if (f) ctx.drawImage(state.image, f.x, f.y, f.w, f.h);
  drawHeatmap();
}
function showScore(data, original) {
  const score = data.score, percent = score * 100;
  if (original) state.baseScore = score;
  $('score-value').textContent = percent.toFixed(2);
  $('stress-score').textContent = percent.toFixed(2);
  const ai = score >= data.threshold, color = ai ? 'var(--coral)' : 'var(--teal)';
  $('verdict').textContent = ai ? '疑似 AI 生成' : '未发现显著 AI 信号';
  $('verdict').style.color = color;
  $('score-ring').style.background = `conic-gradient(${color} ${percent}%, #e9efeb 0)`;
  $('confidence-bar-fill').style.width = `${percent}%`;
  $('confidence-bar-fill').style.background = color;
  $('latency').textContent = `${data.seconds.toFixed(2)} s`;
  $('score-description').textContent = '已完成全图检测；区域颜色由各裁剪块独立检测得到。';
  $('dimensions').textContent = `标准化输入 ${data.width} × ${data.height} · RGB`;
  if (state.baseScore !== null) $('stress-delta').textContent = ((score - state.baseScore) * 100).toFixed(2);
}
async function infer(blob, version, original) {
  if (version !== state.version) return;
  const controller = new AbortController(); state.controller = controller;
  $('analysis-state').textContent = '全图检测中';
  try {
    const form = new FormData(); form.append('image', blob, 'input.png');
    if (!apiBaseUrl && location.hostname.endsWith('.github.io')) {
      throw new Error('尚未配置模型服务地址，请联系网站管理员。');
    }
    const response = await fetch(`${apiBaseUrl}/api/predict`, { method: 'POST', body: form, signal: controller.signal });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || `检测服务返回 ${response.status}`);
    }
    if (!response.body) throw new Error('检测服务未返回结果流');
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', finished = false;
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line || version !== state.version) continue;
        const data = JSON.parse(line);
        if (data.type === 'global') { showScore(data, original); $('analysis-state').textContent = '全图完成 · 分块分析 0/16'; }
        if (data.type === 'tile') { state.tiles.push(data); drawHeatmap(); $('analysis-state').textContent = `分块分析 ${data.completed}/${data.total}`; }
        if (data.type === 'done') { finished = true; $('analysis-state').textContent = `检测完成 · ${data.seconds.toFixed(2)} s`; }
        if (data.type === 'error') throw new Error(data.message);
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const data = JSON.parse(buffer);
      if (data.type === 'done') { finished = true; $('analysis-state').textContent = `检测完成 · ${data.seconds.toFixed(2)} s`; }
      if (data.type === 'error') throw new Error(data.message);
    }
    if (!finished && version === state.version) throw new Error('检测流提前结束，请重试');
  } catch (error) {
    if (version === state.version && error.name !== 'AbortError') {
      $('analysis-state').textContent = error.message;
      $('score-description').textContent = '检测未完成，请确认推理服务已启动后重试。';
    }
  }
}
async function applyStress() {
  const version = ++state.version;
  clearTimeout(state.timer); state.controller?.abort();
  if (!state.source) return;
  const combo = $('combo-select').value;
  let t = { jpeg: +$('jpeg-range').value, crop: +$('crop-select').value, scale: +$('scale-select').value };
  if (combo === 'light') t = { jpeg: 70, crop: .75, scale: .5 };
  if (combo === 'heavy') t = { jpeg: 50, crop: .5, scale: .25 };
  state.transform = t;
  $('jpeg-range').value = t.jpeg; $('jpeg-output').textContent = t.jpeg;
  $('crop-select').value = t.crop; $('scale-select').value = t.scale;
  state.tiles = []; state.image = null; pendingResult(); resizeCanvas();
  const original = t.jpeg === 100 && t.crop === 1 && t.scale === 1;
  $('view-label').textContent = original ? '原始预览' : '处理后预览';
  const image = state.source, factor = Math.sqrt(t.crop);
  const sw = Math.max(1, Math.round(image.width * factor)), sh = Math.max(1, Math.round(image.height * factor));
  const processed = document.createElement('canvas');
  processed.width = Math.max(1, Math.round(sw * t.scale)); processed.height = Math.max(1, Math.round(sh * t.scale));
  processed.getContext('2d').drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, 0, 0, processed.width, processed.height);
  const blob = await new Promise(resolve => processed.toBlob(resolve, t.jpeg < 100 ? 'image/jpeg' : 'image/png', t.jpeg / 100));
  if (version !== state.version || !blob) return;
  const preview = await createImageBitmap(blob);
  if (version !== state.version) { preview.close(); return; }
  state.image = preview; resizeCanvas();
  $('stress-size').textContent = `${preview.width} × ${preview.height}`;
  state.timer = setTimeout(() => infer(blob, version, original), 350);
}
function loadImage(src, label, button = null) {
  const version = ++state.version;
  clearTimeout(state.timer); state.controller?.abort();
  const image = new Image(); $('analysis-state').textContent = '图片加载中';
  image.onload = () => {
    if (version !== state.version) return;
    state.source = image; state.baseScore = null; resetControls();
    $('sample-name').textContent = label;
    document.querySelectorAll('.sample-chip').forEach(item => item.classList.toggle('selected', item === button));
    $('empty-image').style.display = 'none'; applyStress();
  };
  image.onerror = () => { if (version === state.version) $('analysis-state').textContent = '图片加载失败，请重新选择'; };
  image.src = src;
}
function loadFile(file) {
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
    $('analysis-state').textContent = '请选择 10 MB 以内的 PNG、JPG 或 WEBP 图片'; return;
  }
  const reader = new FileReader(); reader.onload = () => loadImage(reader.result, file.name); reader.readAsDataURL(file);
}
$('file-input').addEventListener('change', event => loadFile(event.target.files[0]));
$('dropzone').addEventListener('dragover', event => { event.preventDefault(); $('dropzone').classList.add('dragover'); });
$('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('dragover'));
$('dropzone').addEventListener('drop', event => { event.preventDefault(); $('dropzone').classList.remove('dragover'); loadFile(event.dataTransfer.files[0]); });
document.querySelectorAll('.sample-chip').forEach(button => button.addEventListener('click', () => loadImage(button.dataset.src, button.dataset.label, button)));
['jpeg-range', 'crop-select', 'scale-select'].forEach(id => $(id).addEventListener('input', () => { $('combo-select').value = 'none'; applyStress(); }));
$('combo-select').addEventListener('change', applyStress);
$('reset-stress').addEventListener('click', () => { resetControls(); applyStress(); });
$('toggle-heatmap').addEventListener('click', () => {
  state.heatmap = !state.heatmap; $('toggle-heatmap').setAttribute('aria-pressed', state.heatmap);
  $('toggle-heatmap').querySelector('.toggle-pill').classList.toggle('on', state.heatmap); drawHeatmap();
});
window.addEventListener('resize', resizeCanvas);
pendingResult();
const firstSample = document.querySelector('.sample-chip');
loadImage(firstSample.dataset.src, firstSample.dataset.label, firstSample);
