(function () {
  "use strict";
  const $ = function (id) { return document.getElementById(id); };
  function on(id, type, handler) {
    const element = $(id);
    if (element) element.addEventListener(type, handler);
    return element;
  }
  const fileInput = $("file-input"), dropzone = $("dropzone"), filmstrip = $("filmstrip");
  const frameCount = $("frame-count"), btnMake = $("btn-make"), progress = $("progress");
  const progressBar = $("progress-bar"), progressText = $("progress-text"), download = $("download");
  const resultGif = $("result-gif"), videoRange = $("video-range");
  // Recover gracefully if an older/cached HTML page is missing the video element.
  let sourceVideo = $("source-video");
  if (!sourceVideo && videoRange) {
    sourceVideo = document.createElement("video");
    sourceVideo.id = "source-video";
    sourceVideo.controls = true;
    sourceVideo.playsInline = true;
    sourceVideo.preload = "metadata";
    const rangeFields = videoRange.querySelector(".range-fields");
    videoRange.insertBefore(sourceVideo, rangeFields || null);
  }
  const frames = [];
  let dragFrom = null, previewTimer = 0, objectUrl = "", activeVideoUrl = "", selectedFrameIndex = 0;
  let activeVideoDuration = 0, videoPreviewFrames = [], videoPreviewIndex = 0, videoPreviewDelay = 120, videoPreviewReady = false;
  let pendingAddVideoFile = null, pendingAddVideoDuration = 0, ffmpegInstance = null, gifuctModulePromise = null, editSpeedFactor = 1;

  function uid() { return Math.random().toString(36).slice(2); }
  function formatTime(seconds) {
    const total = Math.max(0, Math.floor((Number(seconds) || 0) + 0.0001));
    const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), secs = total % 60;
    return [hours, minutes, secs].map(function (v) { return String(v).padStart(2, "0"); }).join(":");
  }
  function parseTime(value) {
    const text = String(value || "").trim();
    if (!text) return NaN;
    if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
    const parts = text.split(":");
    if (parts.length < 2 || parts.length > 3 || parts.some(function (part) { return part === "" || !/^\d+(\.\d+)?$/.test(part); })) return NaN;
    return parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  }
  function updateCount() {
    const count = activeVideoUrl ? "영상 구간 선택" : "프레임 " + frames.length;
    frameCount.textContent = count;
    btnMake.disabled = activeVideoUrl ? (!validVideoRange() || (videoPreviewReady && videoPreviewFrames.length < 2)) : frames.length < 2;
    const previewButton = $("btn-preview-gif");
    if (previewButton) {
      previewButton.hidden = !activeVideoUrl;
      previewButton.disabled = !validVideoRange();
    }
  }
  function validVideoRange() {
    const start = parseTime($("range-start").value), end = parseTime($("range-end").value);
    return !!activeVideoUrl && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= activeVideoDuration && end > start;
  }
  function syncRange(source) {
    if (!activeVideoUrl) return;
    let start = parseTime($("range-start").value), end = parseTime($("range-end").value);
    if (!Number.isFinite(start)) start = 0;
    if (!Number.isFinite(end)) end = activeVideoDuration;
    if (source === "start-slider") start = Number($("range-start-slider").value);
    if (source === "end-slider") end = Number($("range-end-slider").value);
    start = Math.max(0, Math.min(start, Math.max(0, activeVideoDuration - 0.1)));
    end = Math.max(0.1, Math.min(end, activeVideoDuration));
    if (end <= start) {
      if (source === "range-start" || source === "start-slider") end = Math.min(activeVideoDuration, start + 0.1);
      else start = Math.max(0, end - 0.1);
    }
    videoPreviewFrames = [];
    videoPreviewReady = false;
    $("video-frame-preview").hidden = true;
    const videoStrip = $("video-frame-strip");
    if (videoStrip) videoStrip.innerHTML = "";
    $("range-start").value = formatTime(start);
    $("range-end").value = formatTime(end);
    $("range-start-slider").value = start;
    $("range-end-slider").value = end;
    $("range-summary").textContent = "선택 구간 " + (end - start).toFixed(1) + "초 · " + formatTime(start) + "–" + formatTime(end);
    updateCount();
  }
  function renderStrip() {
    filmstrip.innerHTML = "";
    frames.forEach(function (frame, index) {
      const card = document.createElement("article");
      card.className = "frame-card" + (index === selectedFrameIndex ? " active" : ""); card.draggable = true; card.dataset.id = frame.id;
      card.setAttribute("role", "listitem");
      const img = document.createElement("img"); img.src = frame.thumb; img.alt = "프레임 " + (index + 1); card.appendChild(img);
      const meta = document.createElement("div"); meta.className = "meta";
      meta.innerHTML = "<span>#" + (index + 1) + "</span><span>" + (index === selectedFrameIndex ? "선택됨" : "선택 · 드래그") + "</span>"; card.appendChild(meta);
      card.addEventListener("click", function (event) { if (event.target === remove) return; selectedFrameIndex = index; updateTextEditor(); renderStrip(); });
      const remove = document.createElement("button"); remove.type = "button"; remove.setAttribute("aria-label", "삭제"); remove.textContent = "×";
      remove.addEventListener("click", function () {
        const i = frames.findIndex(function (f) { return f.id === frame.id; });
        if (i >= 0) { if (frame.revokeThumb) URL.revokeObjectURL(frame.thumb); frames.splice(i, 1); selectedFrameIndex = Math.min(selectedFrameIndex, Math.max(0, frames.length - 1)); renderStrip(); updateTextEditor(); restartPreview(); }
      });
      card.appendChild(remove);
      card.addEventListener("dragstart", function () { dragFrom = frame.id; });
      card.addEventListener("dragover", function (event) { event.preventDefault(); });
      card.addEventListener("drop", function (event) {
        event.preventDefault(); if (!dragFrom || dragFrom === frame.id) return;
        const from = frames.findIndex(function (f) { return f.id === dragFrom; });
        const to = frames.findIndex(function (f) { return f.id === frame.id; });
        const moved = frames.splice(from, 1)[0]; frames.splice(to, 0, moved); selectedFrameIndex = to; renderStrip(); updateTextEditor(); restartPreview();
      });
      filmstrip.appendChild(card);
    });
    updateCount();
    updateTextEditor();
  }
  function drawTextOverlay(ctx, overlay, width, height) {
    if (!overlay || !overlay.text) return;
    const fontSize = Math.max(10, Math.min(160, Number(overlay.fontSize) || 36));
    const position = overlay.position || "bottom";
    const y = position === "top" ? fontSize + 12 : position === "center" ? height / 2 : height - fontSize - 14;
    ctx.save();
    ctx.font = "700 " + fontSize + "px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineJoin = "round"; ctx.lineWidth = Math.max(2, fontSize * 0.12);
    ctx.strokeStyle = "rgba(0,0,0,.82)"; ctx.fillStyle = overlay.color || "#ffffff";
    String(overlay.text).split(/\r?\n/).slice(0, 4).forEach(function (line, index, lines) {
      const lineY = y + (index - (lines.length - 1) / 2) * fontSize * 1.2;
      ctx.strokeText(line, width / 2, lineY, width * 0.92);
      ctx.fillText(line, width / 2, lineY, width * 0.92);
    });
    ctx.restore();
  }
  function bakeTextOnFrame(frame, isVideo, overlay, videoIndex) {
    if (isVideo) {
      const base = frame.textBaseData || new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);
      const canvas = document.createElement("canvas"); canvas.width = base.width; canvas.height = base.height;
      const ctx = canvas.getContext("2d"); ctx.putImageData(base, 0, 0);
      drawTextOverlay(ctx, overlay, canvas.width, canvas.height);
      const baked = ctx.getImageData(0, 0, canvas.width, canvas.height);
      baked.textBaseData = base;
      videoPreviewFrames[videoIndex] = baked;
      return baked;
    }
    const base = frame.textBaseSource || frame.source;
    const width = base.videoWidth || base.naturalWidth || base.width;
    const height = base.videoHeight || base.naturalHeight || base.height;
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d"); ctx.drawImage(base, 0, 0, width, height);
    const targetWidth = outputSize(base).width;
    const scaled = Object.assign({}, overlay, { fontSize: Math.max(10, Number(overlay.fontSize) * width / targetWidth) });
    drawTextOverlay(ctx, scaled, width, height);
    frame.textBaseSource = base;
    frame.source = canvas;
    frame.thumb = canvas.toDataURL("image/png");
    frame.textOverlay = overlay;
    return frame;
  }
  function rotateFrameImage(frame, isVideo) {
    if (isVideo) {
      const width = frame.width, height = frame.height;
      const baseCanvas = document.createElement("canvas");
      baseCanvas.width = width; baseCanvas.height = height;
      baseCanvas.getContext("2d").putImageData(frame, 0, 0);
      const rotated = document.createElement("canvas");
      rotated.width = height; rotated.height = width;
      const ctx = rotated.getContext("2d");
      ctx.translate(rotated.width / 2, rotated.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(baseCanvas, -width / 2, -height / 2);
      const result = ctx.getImageData(0, 0, rotated.width, rotated.height);
      // 회전 결과를 기준 이미지로 삼아 이후 텍스트 편집과 회전을 이어간다.
      return result;
    }
    const source = frame.source;
    const width = source.videoWidth || source.naturalWidth || source.width;
    const height = source.videoHeight || source.naturalHeight || source.height;
    const rotated = document.createElement("canvas");
    rotated.width = height; rotated.height = width;
    const ctx = rotated.getContext("2d");
    ctx.translate(rotated.width / 2, rotated.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(source, -width / 2, -height / 2);
    frame.source = rotated;
    frame.thumb = rotated.toDataURL("image/png");
    frame.textBaseSource = null;
    frame.textOverlay = null;
    return frame;
  }
  function rotateVideoImageData(imageData, direction, preserveBase) {
    const width = imageData.width, height = imageData.height;
    const source = document.createElement("canvas");
    source.width = width; source.height = height;
    source.getContext("2d").putImageData(imageData, 0, 0);

    // Keep every video frame on the same canvas size. A 90-degree rotation
    // swaps the source aspect ratio, so fit it into the original frame bounds
    // instead of exporting a mixture of portrait and landscape ImageData.
    const turned = document.createElement("canvas");
    turned.width = height; turned.height = width;
    const turnedCtx = turned.getContext("2d");
    turnedCtx.translate(turned.width / 2, turned.height / 2);
    turnedCtx.rotate(direction * Math.PI / 2);
    turnedCtx.drawImage(source, -width / 2, -height / 2);

    const output = document.createElement("canvas");
    output.width = width; output.height = height;
    const ctx = output.getContext("2d");
    ctx.fillStyle = $("opt-bg").value || "#111111";
    ctx.fillRect(0, 0, width, height);
    const scale = Math.min(width / turned.width, height / turned.height);
    const drawWidth = turned.width * scale, drawHeight = turned.height * scale;
    ctx.drawImage(turned, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);

    const result = ctx.getImageData(0, 0, width, height);
    if (preserveBase !== false && imageData.textBaseData) {
      result.textBaseData = rotateVideoImageData(imageData.textBaseData, direction, false);
    }
    return result;
  }

  function transformFrameCanvas(source, rotation, flipX, flipY) {
    const sw=source.videoWidth||source.naturalWidth||source.width, sh=source.videoHeight||source.naturalHeight||source.height;
    const swap=Math.abs(rotation)%180===90, canvas=document.createElement("canvas");
    canvas.width=swap?sh:sw; canvas.height=swap?sw:sh;
    const ctx=canvas.getContext("2d"); ctx.translate(canvas.width/2,canvas.height/2);
    ctx.rotate(rotation*Math.PI/180); ctx.scale(flipX?-1:1,flipY?-1:1);
    ctx.drawImage(source,-sw/2,-sh/2); return canvas;
  }
  function transformSelectedFrames(rotation,flipX,flipY) {
    const scope=$("rotate-scope").value;
    const indexes=scope==="all"?frames.map((_,i)=>i):[selectedFrameIndex];
    indexes.forEach(i=>{const f=frames[i];if(!f)return;const canvas=transformFrameCanvas(f.source,rotation||0,!!flipX,!!flipY);f.source=canvas;f.thumb=canvas.toDataURL("image/png");f.textBaseSource=null;f.textOverlay=null;});
    renderStrip(); restartPreview(); updateTextEditor();
    updateEditToolsStatus("변환 적용 완료 · "+(scope==="all"?"전체 프레임":"선택 프레임"));
  }
  function rotateSelectedFrames(direction) { transformSelectedFrames(direction*90,false,false); }
  function updateTextEditor() {
    const label = $("text-frame-label");
    if (!label) return;
    const isVideo = !!activeVideoUrl;
    const total = isVideo ? videoPreviewFrames.length : frames.length;
    const index = isVideo ? videoPreviewIndex : selectedFrameIndex;
    const frame = isVideo ? videoPreviewFrames[index] : frames[index];
    label.textContent = total ? "선택 프레임: " + (index + 1) + " / " + total : "프레임을 먼저 추가해 주세요.";
    const overlay = frame && frame.textOverlay;
    $("frame-text").value = overlay ? overlay.text : "";
    $("frame-text-size").value = overlay ? overlay.fontSize : 36;
    $("frame-text-color").value = overlay ? overlay.color : "#ffffff";
    $("frame-text-position").value = overlay ? overlay.position : "bottom";
    $("btn-text-apply").textContent = overlay ? "텍스트 수정 적용" : "선택 프레임에 적용";
    // 영상은 미리보기 프레임을 아직 추출하지 않았어도 구간이 준비되면
    // 텍스트 적용 버튼을 사용할 수 있도록 한다.
    $("btn-text-apply").disabled = isVideo
      ? !(activeVideoDuration > 0 && validVideoRange())
      : !frame;
    $("btn-text-clear").disabled = !frame || !overlay;
    const hasFrames = isVideo ? videoPreviewFrames.length > 0 : frames.length > 0;
    $("btn-rotate-left").disabled = !hasFrames;
    $("btn-rotate-right").disabled = !hasFrames;
  }
  function clearVideo() {
    if (activeVideoUrl) URL.revokeObjectURL(activeVideoUrl);
    activeVideoUrl = ""; activeVideoDuration = 0;
    if (sourceVideo) {
      sourceVideo.pause();
      sourceVideo.removeAttribute("src");
      sourceVideo.load();
    }
    if (videoRange) videoRange.hidden = true;
    videoPreviewFrames = [];
    const framePreview = $("video-frame-preview");
    if (framePreview) framePreview.hidden = true;
  }
  function clearFrames() {
    frames.forEach(function (frame) { if (frame.revokeThumb) URL.revokeObjectURL(frame.thumb); });
    frames.splice(0, frames.length);
    selectedFrameIndex = 0;
    renderStrip();
    updateTextEditor();
  }
  function loadImageFile(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { resolve({ id: uid(), source: img, thumb: url, kind: "image", revokeThumb: true }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("이미지를 불러오지 못했습니다.")); };
      img.src = url;
    });
  }
  function loadVideoFile(file) {
    return new Promise(function (resolve, reject) {
      clearVideo(); clearFrames();
      activeVideoUrl = URL.createObjectURL(file);
      sourceVideo.onloadedmetadata = function () {
        activeVideoDuration = sourceVideo.duration;
        if (!Number.isFinite(activeVideoDuration) || activeVideoDuration <= 0) { reject(new Error("영상 길이를 확인할 수 없습니다.")); return; }
        $("video-duration-label").textContent = "전체 " + formatTime(activeVideoDuration);
        ["range-start", "range-start-slider"].forEach(function (id) { $(id).max = activeVideoDuration; });
        ["range-end", "range-end-slider"].forEach(function (id) { $(id).max = activeVideoDuration; });
        $("range-start").value = "00:00:00"; $("range-start-slider").value = "0";
        $("range-end").value = formatTime(activeVideoDuration); $("range-end-slider").value = activeVideoDuration;
        videoRange.hidden = false; syncRange("init"); restartPreview(); resolve();
      };
      sourceVideo.onerror = function () { reject(new Error("이 파일의 영상을 열 수 없습니다. MP4 등 브라우저에서 지원하는 형식인지 확인하세요.")); };
      sourceVideo.src = activeVideoUrl;
      sourceVideo.load();
    });
  }
  async function addFiles(fileList) {
    const list = Array.from(fileList);
    try {
      const videoFile = list.find(function (file) { return file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(file.name); });
      if (videoFile) { await loadVideoFile(videoFile); if ($("btn-sample")) $("btn-sample").hidden = true; return; }
      clearVideo();
      for (const file of list) {
        if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)) frames.push(await loadImageFile(file));
      }
      renderStrip(); restartPreview();
      if (frames.length && $("btn-sample")) $("btn-sample").hidden = true;
    } catch (error) { alert(error.message || "파일을 불러오지 못했습니다."); }
  }
  function outputSize(source) {
    const width = Math.max(16, Math.min(1280, Number($("opt-width").value) || 480));
    if (!source) return { width: width, height: Math.round(width * 0.66) };
    const sw = source.videoWidth || source.naturalWidth || source.width;
    const sh = source.videoHeight || source.naturalHeight || source.height;
    return { width: width, height: Math.max(16, Math.round((width * sh) / sw) || Math.round(width * 0.66)) };
  }
  function drawFitted(ctx, source, width, height, fit, bg) {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
    const sw = source.videoWidth || source.naturalWidth || source.width;
    const sh = source.videoHeight || source.naturalHeight || source.height;
    if (!sw || !sh) return;
    if (fit === "stretch") { ctx.drawImage(source, 0, 0, width, height); return; }
    const scale = fit === "cover" ? Math.max(width / sw, height / sh) : Math.min(width / sw, height / sh);
    const dw = sw * scale, dh = sh * scale;
    ctx.drawImage(source, (width - dw) / 2, (height - dh) / 2, dw, dh);
  }
  function restartPreview() {
    clearInterval(previewTimer);
    if (activeVideoUrl && sourceVideo) {
      const start = parseTime($("range-start").value) || 0;
      const end = parseTime($("range-end").value);
      if (sourceVideo.currentTime < start || sourceVideo.currentTime > end) sourceVideo.currentTime = start;
    }
  }
  async function waitForVideoFrame() {
    // The video is paused during extraction, so requestVideoFrameCallback can
    // wait forever for a playback frame. Two paint cycles let the seeked frame
    // become available to drawImage without requiring playback.
    await new Promise(function (resolve) {
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
    });
  }
  async function seekVideo(time) {
    if (Math.abs(sourceVideo.currentTime - time) >= 0.015) {
      await new Promise(function (resolve, reject) {
        let timer = 0;
        const cleanup = function () {
          clearTimeout(timer);
          sourceVideo.removeEventListener("seeked", done);
          sourceVideo.removeEventListener("error", fail);
        };
        const done = function () { cleanup(); resolve(); };
        const fail = function () { cleanup(); reject(new Error("영상 프레임을 읽지 못했습니다.")); };
        sourceVideo.addEventListener("seeked", done, { once: true });
        sourceVideo.addEventListener("error", fail, { once: true });
        timer = setTimeout(function () {
          cleanup();
          reject(new Error("영상 탐색 시간이 초과되었습니다. 영상 형식을 확인해 주세요."));
        }, 10000);
        sourceVideo.currentTime = time;
      });
    }
    await waitForVideoFrame();
  }
  async function extractFramesFromFile(file, width, height, selectedStart, selectedEnd) {
    const url = URL.createObjectURL(file), video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.preload = "auto"; video.src = url;
    try {
      await new Promise(function (resolve, reject) {
        video.onloadedmetadata = resolve;
        video.onerror = function () { reject(new Error("추가할 영상 파일을 읽을 수 없습니다.")); };
      });
      if (video.readyState < 2) {
        await new Promise(function (resolve, reject) {
          video.addEventListener("loadeddata", resolve, { once: true });
          video.addEventListener("error", function () { reject(new Error("영상 데이터를 읽을 수 없습니다.")); }, { once: true });
        });
      }
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("영상 길이를 확인할 수 없습니다.");
      const start = Number.isFinite(selectedStart) ? selectedStart : 0;
      const end = Number.isFinite(selectedEnd) ? selectedEnd : duration;
      if (start < 0 || end > duration || end <= start) throw new Error("추가 영상의 시작·종료 시간을 확인해 주세요.");
      const clipDuration = end - start;
      const delay = Math.max(20, Number($("opt-delay").value) || 120);
      const count = Math.max(2, Math.min(180, Math.ceil(clipDuration * 1000 / delay)));
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true }), output = [];
      for (let i = 0; i < count; i++) {
        const time = Math.min(end - 0.001, start + clipDuration * i / count);
        if (Math.abs(video.currentTime - time) >= 0.015) {
          await new Promise(function (resolve, reject) {
            let timer;
            const done = function () { clearTimeout(timer); resolve(); };
            timer = setTimeout(function () { video.removeEventListener("seeked", done); reject(new Error("추가 영상 프레임 추출 시간이 초과되었습니다.")); }, 10000);
            video.addEventListener("seeked", done, { once: true }); video.currentTime = time;
          });
        }
        await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
        drawFitted(ctx, video, width, height, $("opt-fit").value, $("opt-bg").value);
        output.push(ctx.getImageData(0, 0, width, height));
      }
      return output;
    } finally { video.pause(); video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); }
  }
  async function extractVideoFrames() {
    const start = parseTime($("range-start").value), end = parseTime($("range-end").value);
    if (!validVideoRange()) throw new Error("시작 시간과 종료 시간을 올바르게 설정하세요.");
    sourceVideo.pause();
    const targetDelay = Math.max(20, Number($("opt-delay").value) || 120);
    const durationMs = (end - start) * 1000;
    const count = Math.max(2, Math.min(180, Math.ceil(durationMs / targetDelay)));
    // Keep the exported GIF duration aligned with the selected video interval,
    // including when the 180-frame safety limit is reached.
    const frameDelay = Math.max(20, Math.round(durationMs / count));
    const size = outputSize(sourceVideo), canvas = document.createElement("canvas");
    canvas.width = size.width; canvas.height = size.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true }), data = [];
    for (let i = 0; i < count; i++) {
      const time = start + (end - start) * i / count;
      await seekVideo(Math.min(time, end - 0.001));
      drawFitted(ctx, sourceVideo, size.width, size.height, $("opt-fit").value, $("opt-bg").value);
      data.push(ctx.getImageData(0, 0, size.width, size.height));
      progressBar.style.width = Math.round((i + 1) / count * 35) + "%";
      progressText.textContent = "영상 프레임 추출 " + (i + 1) + " / " + count;
    }
    return { imageDatas: data, size: size, delay: frameDelay };
  }
  ["opt-width", "opt-delay", "opt-fit", "opt-bg"].forEach(function (id) {
    on(id, "input", function () { videoPreviewFrames = []; videoPreviewReady = false; $("video-frame-preview").hidden = true; });
    on(id, "change", function () { videoPreviewFrames = []; videoPreviewReady = false; $("video-frame-preview").hidden = true; });
  });
  on("btn-add", "click", function () { const input = $("frame-add-input"); if (input) input.click(); });
  on("btn-sample", "click", async function () {
    clearVideo();
    const colors = ["#e8a45a", "#c46a3a", "#7d9a6f", "#d7c4a3", "#3d6b8a", "#f4efe6"], words = ["FRAME", "LAB", "MAKE", "A", "GIF", "NOW"];
    for (let i = 0; i < colors.length; i++) {
      const canvas = document.createElement("canvas"); canvas.width = 480; canvas.height = 320;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#14110e"; ctx.fillRect(0, 0, 480, 320);
      ctx.fillStyle = colors[i]; ctx.beginPath(); ctx.arc(140 + i * 28, 160, 70, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#f4efe6"; ctx.font = "italic 54px 'Instrument Serif', serif"; ctx.fillText(words[i], 230, 175);
      const img = new Image(), dataUrl = canvas.toDataURL("image/png");
      await new Promise(function (done) { img.onload = done; img.src = dataUrl; });
      frames.push({ id: uid(), source: img, thumb: dataUrl, kind: "sample" });
    }
    renderStrip(); restartPreview();
  });
  if (fileInput) on("file-input", "change", function () { addFiles(fileInput.files); fileInput.value = ""; });
  on("frame-add-input", "change", async function () {
    const input = $("frame-add-input"), files = Array.from(input.files || []);
    input.value = "";
    if (!files.length) return;
    try {
      for (const file of files) {
        if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)) {
          if (activeVideoUrl) {
            if (!videoPreviewReady) {
              const extracted = await extractVideoFrames();
              videoPreviewFrames = extracted.imageDatas; videoPreviewDelay = extracted.delay; videoPreviewReady = true;
            }
            const loaded = await loadImageFile(file);
            const width = videoPreviewFrames[0].width, height = videoPreviewFrames[0].height;
            const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            drawFitted(ctx, loaded.source, width, height, $("opt-fit").value, $("opt-bg").value);
            videoPreviewFrames.push(ctx.getImageData(0, 0, width, height));
            if (loaded.revokeThumb) URL.revokeObjectURL(loaded.thumb);
          } else frames.push(await loadImageFile(file));
        } else if (file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(file.name)) {
          pendingAddVideoFile = file;
          const video = $("add-video-source"), url = URL.createObjectURL(file);
          if (video.dataset.objectUrl) URL.revokeObjectURL(video.dataset.objectUrl);
          video.dataset.objectUrl = url; video.src = url; video.load();
          $("add-video-range").hidden = false;
          await new Promise(function (resolve, reject) {
            video.onloadedmetadata = function () {
              pendingAddVideoDuration = video.duration;
              $("add-video-duration").textContent = "전체 " + formatTime(video.duration);
              $("add-range-start").value = "00:00:00";
              $("add-range-end").value = formatTime(video.duration);
              $("add-range-start-slider").min = 0; $("add-range-start-slider").max = video.duration; $("add-range-start-slider").step = Math.max(0.01, video.duration / 1000); $("add-range-start-slider").value = 0;
              $("add-range-end-slider").min = 0; $("add-range-end-slider").max = video.duration; $("add-range-end-slider").step = Math.max(0.01, video.duration / 1000); $("add-range-end-slider").value = video.duration;
              syncAddVideoRange("init");
              resolve();
            };
            video.onerror = function () { reject(new Error("추가할 영상 파일을 읽을 수 없습니다.")); };
          });
          return;
        }
      }
      if (activeVideoUrl) {
        $("video-frame-preview").hidden = false;
        videoPreviewIndex = videoPreviewFrames.length - 1; showVideoPreviewFrame(); updateCount();
      } else {
        renderStrip(); restartPreview();
        if (frames.length && $("btn-sample")) $("btn-sample").hidden = true;
      }
    } catch (error) { alert("프레임을 추가하지 못했습니다: " + error.message); }
  });
  function syncAddVideoRange(source) {
    if (!pendingAddVideoFile || !Number.isFinite(pendingAddVideoDuration)) return;
    let start = parseTime($("add-range-start").value), end = parseTime($("add-range-end").value);
    if (!Number.isFinite(start)) start = 0;
    if (!Number.isFinite(end)) end = pendingAddVideoDuration;
    if (source === "start-slider") start = Number($("add-range-start-slider").value);
    if (source === "end-slider") end = Number($("add-range-end-slider").value);
    start = Math.max(0, Math.min(start, Math.max(0, pendingAddVideoDuration - 0.05)));
    end = Math.max(0.05, Math.min(end, pendingAddVideoDuration));
    if (end <= start) {
      if (source === "start-slider" || source === "add-range-start") end = Math.min(pendingAddVideoDuration, start + 0.05);
      else start = Math.max(0, end - 0.05);
    }
    $("add-range-start").value = formatTime(start);
    $("add-range-end").value = formatTime(end);
    $("add-range-start-slider").value = start;
    $("add-range-end-slider").value = end;
    $("add-range-summary").textContent = "선택 구간 " + (end - start).toFixed(2) + "초 · " + formatTime(start) + "–" + formatTime(end);
    $("btn-add-video-confirm").disabled = !(end > start && end <= pendingAddVideoDuration);
  }
  ["add-range-start", "add-range-end"].forEach(function (id) {
    on(id, "change", function () { syncAddVideoRange(id); });
    on(id, "keydown", function (event) { if (event.key === "Enter") { event.preventDefault(); syncAddVideoRange(id); } });
  });
  on("add-range-start-slider", "input", function () { syncAddVideoRange("start-slider"); });
  on("add-range-end-slider", "input", function () { syncAddVideoRange("end-slider"); });

  on("btn-add-video-cancel", "click", function () {
    const video = $("add-video-source");
    if (video.dataset.objectUrl) URL.revokeObjectURL(video.dataset.objectUrl);
    video.pause(); video.removeAttribute("src"); video.load();
    $("add-video-range").hidden = true; pendingAddVideoFile = null; pendingAddVideoDuration = 0;
  });
  on("btn-add-video-confirm", "click", async function () {
    if (!pendingAddVideoFile) return;
    const start = parseTime($("add-range-start").value), end = parseTime($("add-range-end").value);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > pendingAddVideoDuration || end <= start) {
      alert("추가 영상의 시작·종료 시간을 올바르게 입력해 주세요."); return;
    }
    const button = $("btn-add-video-confirm");
    button.disabled = true; button.textContent = "프레임 추출 중…";
    try {
      let width, height;
      if (activeVideoUrl) {
        if (!videoPreviewReady) {
          const baseFrames = await extractVideoFrames();
          videoPreviewFrames = baseFrames.imageDatas; videoPreviewDelay = baseFrames.delay; videoPreviewReady = true;
        }
        width = videoPreviewFrames[0].width; height = videoPreviewFrames[0].height;
      } else {
        const base = frames.length ? outputSize(frames[0].source) : { width: Math.max(16, Number($("opt-width").value) || 480), height: 320 };
        width = base.width; height = base.height;
      }
      const added = await extractFramesFromFile(pendingAddVideoFile, width, height, start, end);
      if (activeVideoUrl) {
        videoPreviewFrames.push.apply(videoPreviewFrames, added);
        videoPreviewIndex = videoPreviewFrames.length - 1;
        $("video-frame-preview").hidden = false; showVideoPreviewFrame(); updateCount();
      } else {
        added.forEach(function (imageData) {
          const canvas = document.createElement("canvas"); canvas.width = imageData.width; canvas.height = imageData.height;
          const previewCtx = canvas.getContext("2d"); previewCtx.putImageData(imageData, 0, 0);
    drawTextOverlay(previewCtx, imageData.textOverlay, imageData.width, imageData.height);
    updateTextEditor();
          frames.push({ id: uid(), source: canvas, thumb: canvas.toDataURL("image/png"), kind: "video-frame" });
        });
        renderStrip(); restartPreview();
        if ($("btn-sample")) $("btn-sample").hidden = true;
      }
      const video = $("add-video-source");
      if (video.dataset.objectUrl) URL.revokeObjectURL(video.dataset.objectUrl);
      video.pause(); video.removeAttribute("src"); video.load();
      $("add-video-range").hidden = true; pendingAddVideoFile = null;
    } catch (error) { alert("영상 구간을 추가하지 못했습니다: " + error.message); }
    finally { button.disabled = false; button.textContent = "선택 구간 프레임 추가"; }
  });
  if (dropzone) {
    ["dragenter", "dragover"].forEach(function (type) {
      dropzone.addEventListener(type, function (event) { event.preventDefault(); dropzone.classList.add("dragover"); });
    });
    ["dragleave", "drop"].forEach(function (type) {
      dropzone.addEventListener(type, function (event) { event.preventDefault(); dropzone.classList.remove("dragover"); });
    });
    dropzone.addEventListener("drop", function (event) { if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files); });
  }
  on("btn-reverse", "click", async function () {
    if (activeVideoUrl) {
      try {
        if (!videoPreviewReady) {
          const extracted = await extractVideoFrames();
          videoPreviewFrames = extracted.imageDatas; videoPreviewDelay = extracted.delay; videoPreviewReady = true;
        }
        videoPreviewFrames.reverse(); videoPreviewIndex = 0;
        $("video-frame-preview").hidden = false; showVideoPreviewFrame(); updateCount();
      } catch (error) { alert("영상 프레임 순서를 뒤집지 못했습니다: " + error.message); }
      return;
    }
    frames.reverse(); renderStrip(); restartPreview();
  });
  on("btn-clear", "click", function () {
    clearInterval(previewTimer); clearVideo(); clearFrames();
    if ($("btn-sample")) $("btn-sample").hidden = false;
    if (download) download.hidden = true;
    if (resultGif) resultGif.hidden = true;
    updateCount(); restartPreview();
  });
  ["range-start", "range-end"].forEach(function (id) {
    on(id, "change", function () { syncRange(id); });
    on(id, "keydown", function (event) { if (event.key === "Enter") { event.preventDefault(); syncRange(id); } });
  });
  on("range-start-slider", "input", function () { syncRange("start-slider"); });
  on("range-end-slider", "input", function () { syncRange("end-slider"); });
  on("btn-preview-range", "click", async function () {
    if (!validVideoRange() || !sourceVideo) return;
    sourceVideo.pause(); await seekVideo(parseTime($("range-start").value)); sourceVideo.play();
    const stopAt = parseTime($("range-end").value);
    const check = function () { if (sourceVideo.currentTime >= stopAt) { sourceVideo.pause(); sourceVideo.currentTime = parseTime($("range-start").value); sourceVideo.removeEventListener("timeupdate", check); } };
    sourceVideo.addEventListener("timeupdate", check);
  });
  async function downloadEditedOutput(gifBlob, imageDatas) {
    const format=$("edit-format").value;
    if(format==="gif") return false;
    if(format==="jpg") {
      if(!window.JSZip) throw new Error("JPG ZIP 변환 라이브러리를 불러오지 못했습니다.");
      const zip=new JSZip();
      for(let i=0;i<imageDatas.length;i++){
        const d=imageDatas[i],cv=document.createElement("canvas");cv.width=d.width;cv.height=d.height;
        cv.getContext("2d").putImageData(d,0,0);
        const blob=await new Promise(resolve=>cv.toBlob(resolve,"image/jpeg",0.92));
        if(!blob)throw new Error("JPG 프레임 변환에 실패했습니다.");
        zip.file("frame-"+String(i+1).padStart(4,"0")+".jpg",blob);
      }
      const zipBlob=await zip.generateAsync({type:"blob"});
      triggerBlobDownload(zipBlob,"frame-lab-jpg-frames.zip");
      updateEditToolsStatus("JPG 변환 완료 · "+imageDatas.length+"개 프레임을 ZIP으로 저장했습니다.");
      return true;
    }
    if(format==="mp4") {
      if(!window.FFmpeg||!window.FFmpeg.createFFmpeg)throw new Error("MP4 변환 엔진을 불러오지 못했습니다.");
      if(!ffmpegInstance){
        ffmpegInstance=window.FFmpeg.createFFmpeg({log:false,mainName:"main",corePath:"https://unpkg.com/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js"});
        await ffmpegInstance.load();
      }
      const input="edited-"+Date.now()+".gif",output="edited-"+Date.now()+".mp4";
      ffmpegInstance.FS("writeFile",input,new Uint8Array(await gifBlob.arrayBuffer()));
      await ffmpegInstance.run("-i",input,"-an","-movflags","+faststart","-vf","pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p","-preset","ultrafast","-crf","25",output);
      const bytes=ffmpegInstance.FS("readFile",output);
      const mp4=new Blob([new Uint8Array(bytes)],{type:"video/mp4"});
      triggerBlobDownload(mp4,"frame-lab.mp4");
      try{ffmpegInstance.FS("unlink",input);ffmpegInstance.FS("unlink",output);}catch(_){}
      updateEditToolsStatus("MP4 변환 완료 · "+Math.round(mp4.size/1024)+" KB");
      return true;
    }
    return false;
  }
  async function generateGif(makeDownload) {
    if (activeVideoUrl ? (!validVideoRange() || (videoPreviewReady && videoPreviewFrames.length < 2)) : frames.length < 2) return;
    const previewButton = $("btn-preview-gif");
    btnMake.disabled = true;
    if (previewButton) previewButton.disabled = true;
    progress.hidden = false;
    if (makeDownload) download.hidden = true;
    resultGif.hidden = true;
    progressBar.style.width = "0%";
    progressText.textContent = makeDownload ? "GIF 생성 준비 중" : "미리보기 생성 중";
    try {
      let imageDatas, size, exportDelay = Number($("opt-delay").value) || 120;
      if (activeVideoUrl) {
        if (videoPreviewReady) {
          imageDatas = videoPreviewFrames;
          size = { width: imageDatas[0].width, height: imageDatas[0].height };
          exportDelay = videoPreviewDelay;
        } else {
          const extracted = await extractVideoFrames();
          imageDatas = extracted.imageDatas; size = extracted.size; exportDelay = extracted.delay;
        }
      } else {
        size = outputSize(frames[0].source);
        const fit = $("opt-fit").value, bg = $("opt-bg").value;
        const canvas = document.createElement("canvas"); canvas.width = size.width; canvas.height = size.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true }); imageDatas = [];
        for (let i = 0; i < frames.length; i++) {
          drawFitted(ctx, frames[i].source, size.width, size.height, fit, bg);
          imageDatas.push(ctx.getImageData(0, 0, size.width, size.height));
        }
      }
      if (currentMode === "edit" && editSpeedFactor !== 1) exportDelay = Math.max(20, Math.round(exportDelay / editSpeedFactor));
      const blob = await window.GifLab.encodeGif(imageDatas, {
        width: size.width, height: size.height, delay: exportDelay,
        loop: Number($("opt-loop").value), dither: $("opt-dither").checked
      }, function (ratio) {
        const offset = activeVideoUrl ? 0.35 : 0;
        progressBar.style.width = Math.round((offset + ratio * (1 - offset)) * 100) + "%";
        progressText.textContent = (makeDownload ? "GIF 인코딩 " : "미리보기 인코딩 ") + Math.round(ratio * 100) + "%";
      });
      if (makeDownload && currentMode === "edit" && await downloadEditedOutput(blob,imageDatas)) { resultGif.hidden=true; download.hidden=true; progressText.textContent="변환 및 다운로드 완료"; return; }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      resultGif.src = objectUrl; resultGif.hidden = false;
      if (makeDownload) {
        download.href = objectUrl; download.download = "frame-lab.gif"; download.hidden = false;
        progressText.textContent = "완료 · " + Math.round(blob.size / 1024) + " KB";
      } else {
        download.hidden = true;
        progressText.textContent = "미리보기 완료 · " + Math.round(blob.size / 1024) + " KB";
      }
    } catch (error) { progressText.textContent = "실패: " + error.message; }
    finally { updateCount(); }
  }
  function showVideoPreviewFrame() {
    if (!videoPreviewFrames.length) return;
    const canvas = $("video-preview-canvas");
    const imageData = videoPreviewFrames[videoPreviewIndex];
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const previewCtx = canvas.getContext("2d"); previewCtx.putImageData(imageData, 0, 0);
    updateTextEditor();
    $("video-frame-count").textContent = (videoPreviewIndex + 1) + " / " + videoPreviewFrames.length;
    const start = parseTime($("range-start").value);
    $("video-frame-time").textContent = formatTime(start + videoPreviewIndex * videoPreviewDelay / 1000);
    $("btn-frame-prev").disabled = videoPreviewIndex === 0;
    $("btn-frame-next").disabled = videoPreviewIndex >= videoPreviewFrames.length - 1;
    renderVideoFrameStrip();
  }
  function renderVideoFrameStrip() {
    const strip = $("video-frame-strip");
    if (!strip) return;
    strip.innerHTML = "";
    videoPreviewFrames.forEach(function (imageData, index) {
      const item = document.createElement("div");
      item.className = "video-frame-thumb" + (index === videoPreviewIndex ? " active" : "");
      item.draggable = true;
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 112 / imageData.width, 72 / imageData.height);
      canvas.width = Math.max(1, Math.round(imageData.width * scale));
      canvas.height = Math.max(1, Math.round(imageData.height * scale));
      const ctx = canvas.getContext("2d");
      const temp = document.createElement("canvas");
      temp.width = imageData.width; temp.height = imageData.height;
      temp.getContext("2d").putImageData(imageData, 0, 0);
      ctx.drawImage(temp, 0, 0, canvas.width, canvas.height);
      const label = document.createElement("span");
      label.textContent = "프레임 " + (index + 1);
      const remove = document.createElement("button");
      remove.type = "button"; remove.className = "remove-video-frame";
      remove.textContent = "×"; remove.setAttribute("aria-label", "프레임 " + (index + 1) + " 삭제");
      remove.addEventListener("click", function (event) {
        event.stopPropagation();
        videoPreviewFrames.splice(index, 1);
        if (videoPreviewIndex >= videoPreviewFrames.length) videoPreviewIndex = Math.max(0, videoPreviewFrames.length - 1);
        if (!videoPreviewFrames.length) {
          $("video-frame-preview").hidden = true;
          strip.innerHTML = "";
        } else showVideoPreviewFrame();
        updateCount();
      });
      item.addEventListener("click", function () { videoPreviewIndex = index; showVideoPreviewFrame(); });
      item.addEventListener("dragstart", function (event) {
        event.dataTransfer.setData("text/plain", String(index));
        event.dataTransfer.effectAllowed = "move";
      });
      item.addEventListener("dragover", function (event) { event.preventDefault(); item.classList.add("drag-target"); });
      item.addEventListener("dragleave", function () { item.classList.remove("drag-target"); });
      item.addEventListener("drop", function (event) {
        event.preventDefault(); item.classList.remove("drag-target");
        const from = Number(event.dataTransfer.getData("text/plain")), to = index;
        if (!Number.isInteger(from) || from === to || from < 0 || from >= videoPreviewFrames.length) return;
        const moved = videoPreviewFrames.splice(from, 1)[0];
        videoPreviewFrames.splice(to, 0, moved);
        videoPreviewIndex = to; showVideoPreviewFrame();
      });
      item.appendChild(canvas); item.appendChild(label); item.appendChild(remove);
      strip.appendChild(item);
    });
    const active = strip.querySelector(".video-frame-thumb.active");
    if (active) active.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }
  on("btn-frame-prev", "click", function () {
    if (videoPreviewIndex > 0) { videoPreviewIndex--; showVideoPreviewFrame(); }
  });
  on("btn-frame-next", "click", function () {
    if (videoPreviewIndex < videoPreviewFrames.length - 1) { videoPreviewIndex++; showVideoPreviewFrame(); }
  });
  on("btn-rotate-left", "click", function () { rotateSelectedFrames(-1); });
  on("btn-rotate-right", "click", function () { rotateSelectedFrames(1); });
  on("btn-text-apply", "click", async function () {
    const button = $("btn-text-apply");
    const isVideo = !!activeVideoUrl;
    const value = $("frame-text").value.trim();
    if (!value) { alert("추가할 문구를 입력해 주세요."); return; }
    const overlay = { text: value, fontSize: Number($("frame-text-size").value) || 36, color: $("frame-text-color").value, position: $("frame-text-position").value };
    if (isVideo && !videoPreviewFrames.length) {
      if (!(activeVideoDuration > 0 && validVideoRange())) {
        alert("영상의 시작 시간과 종료 시간을 먼저 확인해 주세요.");
        return;
      }
      button.disabled = true;
      button.textContent = "영상 프레임 준비 중...";
      try {
        const extracted = await extractVideoFrames();
        videoPreviewFrames = extracted.imageDatas;
        videoPreviewDelay = extracted.delay;
        videoPreviewReady = true;
        videoPreviewIndex = 0;
        $("video-frame-preview").hidden = false;
        // 프레임 표시 함수는 편집 입력값을 갱신하므로 텍스트를 먼저 적용한 뒤 표시한다.
      } catch (error) {
        alert("영상 프레임을 준비하지 못했습니다: " + error.message);
        updateTextEditor();
        return;
      } finally {
        button.textContent = "선택 프레임에 적용";
      }
    }
    const index = isVideo ? videoPreviewIndex : selectedFrameIndex;
    const frame = isVideo ? videoPreviewFrames[index] : frames[index];
    if (!frame) { updateTextEditor(); return; }
    if (isVideo) { bakeTextOnFrame(frame, true, overlay, index); showVideoPreviewFrame(); }
    else { bakeTextOnFrame(frame, false, overlay, index); renderStrip(); }
    updateTextEditor();
  });
  on("btn-text-clear", "click", function () {
    const isVideo = !!activeVideoUrl;
    const index = isVideo ? videoPreviewIndex : selectedFrameIndex;
    const frame = isVideo ? videoPreviewFrames[index] : frames[index];
    if (!frame) return;
    if (isVideo) {
      if (frame.textBaseData) videoPreviewFrames[index] = frame.textBaseData;
    } else if (frame.textBaseSource) {
      const source = frame.textBaseSource;
      const canvas = document.createElement("canvas"); canvas.width = source.videoWidth || source.naturalWidth || source.width; canvas.height = source.videoHeight || source.naturalHeight || source.height;
      canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
      frame.thumb = canvas.toDataURL("image/png");
      frame.source = source;
      delete frame.textBaseSource;
    }
    delete frame.textOverlay;
    if (isVideo) showVideoPreviewFrame(); else renderStrip();
    updateTextEditor();
  });
  on("btn-preview-gif", "click", async function () {
    if (!validVideoRange()) return;
    const button = $("btn-preview-gif");
    button.disabled = true;
    progress.hidden = false;
    progressBar.style.width = "0%";
    progressText.textContent = "미리보기 프레임 추출 준비 중";
    try {
      const extracted = await extractVideoFrames();
      videoPreviewFrames = extracted.imageDatas;
      videoPreviewReady = true;
      videoPreviewDelay = extracted.delay;
      videoPreviewIndex = 0;
      $("video-frame-preview").hidden = false;
      showVideoPreviewFrame();
      progressBar.style.width = "100%";
      progressText.textContent = "프레임 미리보기 준비 완료 · " + videoPreviewFrames.length + "장";
    } catch (error) {
      progressText.textContent = "미리보기 실패: " + error.message;
    } finally {
      updateCount();
    }
  });

  on("convert-gif-input", "change", function () {
    const file = this.files && this.files[0];
    $("btn-gif-jpg").disabled = !file; $("btn-gif-mp4").disabled = !file;
    $("converter-status").textContent = file ? file.name + " 선택됨 · 변환 방식을 선택하세요." : "GIF 파일을 선택해 주세요.";
  });
  async function loadGifuct() {
    if (window.gifuct && window.gifuct.parseGIF && window.gifuct.decompressFrames) return window.gifuct;
    if (!gifuctModulePromise) {
      gifuctModulePromise = import("https://cdn.jsdelivr.net/npm/gifuct-js@2.1.2/+esm").then(function (mod) {
        const api = { parseGIF: mod.parseGIF, decompressFrames: mod.decompressFrames };
        if (!api.parseGIF || !api.decompressFrames) throw new Error("GIF 디코더 모듈의 함수를 찾을 수 없습니다.");
        return api;
      }).catch(function (error) {
        gifuctModulePromise = null;
        throw new Error("GIF 디코더를 불러오지 못했습니다: " + (error.message || error));
      });
    }
    return gifuctModulePromise;
  }
  function triggerBlobDownload(blob, filename) {
    if (!blob || !blob.size) throw new Error("변환 결과 파일이 비어 있습니다.");
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = filename; link.style.display = "none";
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  async function convertGifToJpg() {
    const file = $("convert-gif-input").files[0]; if (!file) return;
    const status = $("converter-status"), button = $("btn-gif-jpg");
    button.disabled = true; $("btn-gif-mp4").disabled = true;
    let worker = null;
    try {
      if (!("Worker" in window) || !("OffscreenCanvas" in window)) {
        throw new Error("현재 브라우저가 백그라운드 이미지 변환을 지원하지 않습니다. 최신 Chrome 또는 Edge에서 다시 시도해 주세요.");
      }
      status.textContent = "GIF 데이터를 백그라운드 변환 작업으로 전달 중…";
      const buffer = await file.arrayBuffer();
      const workerUrl = new URL("./gif-jpg-worker.js?v=20261125-1", window.location.href);
      const result = await new Promise(function (resolve, reject) {
        worker = new Worker(workerUrl);
        worker.onmessage = function (event) {
          const data = event.data || {};
          if (data.type === "status") status.textContent = data.message;
          else if (data.type === "progress") status.textContent = "JPG 프레임 변환 중 · " + data.current + " / " + data.total;
          else if (data.type === "done") resolve(data);
          else if (data.type === "error") reject(new Error(data.message || "GIF 변환에 실패했습니다."));
        };
        worker.onerror = function (event) { reject(new Error(event.message || "백그라운드 변환 작업을 실행하지 못했습니다.")); };
        worker.postMessage(buffer, [buffer]);
      });
      triggerBlobDownload(result.blob, file.name.replace(/\.gif$/i, "") + "-jpg-frames.zip");
      status.textContent = "완료 · " + result.count + "개 프레임을 JPG ZIP 파일로 저장했습니다.";
    } catch (error) {
      status.textContent = "JPG 변환 실패: " + (error.message || error);
    } finally {
      if (worker) worker.terminate();
      button.disabled = false;
      $("btn-gif-mp4").disabled = !$("convert-gif-input").files.length;
    }
  }
  async function convertGifToMp4() {
    const file = $("convert-gif-input").files[0]; if (!file) return;
    const status = $("converter-status"), button = $("btn-gif-mp4");
    button.disabled = true; $("btn-gif-jpg").disabled = true;
    try {
      if (!window.FFmpeg || !window.FFmpeg.createFFmpeg) throw new Error("MP4 변환 엔진을 불러오지 못했습니다. CDN 연결을 확인한 뒤 새로고침해 주세요.");
      if (typeof SharedArrayBuffer === "undefined") status.textContent = "현재 호스팅 환경에서는 SharedArrayBuffer를 사용할 수 없어 단일 스레드 변환 엔진으로 실행합니다.";
      if (!ffmpegInstance) {
        status.textContent = "MP4 변환 엔진 준비 중… 처음 실행할 때 다운로드에 시간이 걸릴 수 있습니다.";
        ffmpegInstance = window.FFmpeg.createFFmpeg({
          log: false,
          mainName: "main",
          corePath: "https://unpkg.com/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js"
        });
        ffmpegInstance.setProgress(function (progressInfo) {
          const ratio = progressInfo && Number(progressInfo.ratio);
          if (Number.isFinite(ratio) && ratio >= 0) {
            status.textContent = "MP4 변환 중 · " + Math.min(99, Math.round(ratio * 100)) + "%";
          }
        });
        await ffmpegInstance.load();
      }
      status.textContent = "GIF 데이터를 변환 엔진으로 전달 중…";
      await new Promise(function (resolve) { setTimeout(resolve, 30); });
      const inputName = "input-" + Date.now() + ".gif";
      const outputName = "output-" + Date.now() + ".mp4";
      const inputBuffer = await file.arrayBuffer();
      ffmpegInstance.FS("writeFile", inputName, new Uint8Array(inputBuffer));
      status.textContent = "GIF를 MP4로 변환 중…";
      await ffmpegInstance.run(
        "-i", inputName, "-an", "-movflags", "+faststart",
        "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p",
        "-preset", "ultrafast", "-crf", "28",
        outputName
      );
      const data = ffmpegInstance.FS("readFile", outputName);
      const blob = new Blob([new Uint8Array(data)], { type: "video/mp4" });
      triggerBlobDownload(blob, file.name.replace(/\.gif$/i, "") + ".mp4");
      try { ffmpegInstance.FS("unlink", inputName); ffmpegInstance.FS("unlink", outputName); } catch (_) {}
      status.textContent = "MP4 변환 완료 · " + Math.round(blob.size / 1024) + " KB";
    } catch (error) {
      status.textContent = "MP4 변환 실패: " + (error.message || error) + " · GIF 용량이 매우 크면 메모리 한계에 도달할 수 있습니다.";
      try { if (ffmpegInstance) ffmpegInstance.exit(); } catch (_) {}
      ffmpegInstance = null;
    } finally { button.disabled = false; $("btn-gif-jpg").disabled = !$("convert-gif-input").files.length; }
  }
  on("btn-gif-jpg", "click", convertGifToJpg);
  on("btn-gif-mp4", "click", convertGifToMp4);


  let currentMode = "create";
  function setMode(mode) {
    currentMode = mode;
    $("generator-source-panel").hidden = mode !== "create";
    $("editor-upload-panel").hidden = mode !== "edit";
    $("editor-tools").hidden = mode !== "edit" || frames.length === 0;
    $("tab-create").classList.toggle("active", mode === "create");
    $("tab-edit").classList.toggle("active", mode === "edit");
    $("tab-create").setAttribute("aria-pressed", String(mode === "create"));
    $("tab-edit").setAttribute("aria-pressed", String(mode === "edit"));
    $("btn-make").textContent = mode === "edit" ? "편집한 GIF 저장" : "GIF 만들기";
    $("frame-workspace").hidden = mode === "edit" && frames.length === 0;
    if (mode === "edit") {
      clearVideo();
      if ($("btn-sample")) $("btn-sample").hidden = true;
      $("edit-gif-status").textContent = frames.length ? "불러온 GIF 프레임을 편집할 수 있습니다." : "GIF 파일을 선택하면 프레임별 편집을 시작할 수 있습니다.";
    } else {
      $("frame-workspace").hidden = false;
    }
  }
  on("tab-create", "click", function () { setMode("create"); });
  on("tab-edit", "click", function () { setMode("edit"); });
  async function loadGifForEditing(file) {
    if (!file) return;
    const status = $("edit-gif-status");
    status.textContent = "GIF 프레임을 분석하고 있습니다…";
    $("edit-gif-input").disabled = true;
    try {
      const api = await loadGifuct();
      const parsed = api.parseGIF(await file.arrayBuffer());
      const decoded = api.decompressFrames(parsed, true);
      if (!decoded || !decoded.length) throw new Error("GIF에서 프레임을 찾지 못했습니다.");
      const width = parsed.lsd.width, height = parsed.lsd.height;
      if (!width || !height) throw new Error("GIF 이미지 크기를 확인할 수 없습니다.");
      clearVideo();
      clearFrames();
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      let previousCanvas = null, totalDelay = 0;
      for (let i = 0; i < decoded.length; i++) {
        const frame = decoded[i];
        if (frame.disposalType === 3 && !previousCanvas) previousCanvas = ctx.getImageData(0, 0, width, height);
        const patch = new ImageData(new Uint8ClampedArray(frame.patch), frame.dims.width, frame.dims.height);
        ctx.putImageData(patch, frame.dims.left, frame.dims.top);
        const snapshot = document.createElement("canvas");
        snapshot.width = width; snapshot.height = height;
        snapshot.getContext("2d").drawImage(canvas, 0, 0);
        const delay = Math.max(20, Number(frame.delay) || 100);
        totalDelay += delay;
        frames.push({ id: uid(), source: snapshot, thumb: snapshot.toDataURL("image/png"), kind: "gif-frame", delay: delay });
        if (frame.disposalType === 2) {
          ctx.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
        } else if (frame.disposalType === 3 && previousCanvas) {
          ctx.putImageData(previousCanvas, 0, 0);
          previousCanvas = null;
        }
      }
      $("opt-width").value = Math.min(1280, width);
      $("opt-delay").value = Math.max(20, Math.round(totalDelay / decoded.length));
      selectedFrameIndex = 0;
      $("frame-workspace").hidden = false;
      $("editor-tools").hidden = false;
      renderStrip();
      restartPreview();
      status.textContent = file.name + " · " + decoded.length + "개 프레임 · " + width + " × " + height + "px · 편집할 프레임을 선택하세요.";
    } catch (error) {
      status.textContent = "GIF 업로드 실패: " + (error.message || error);
    } finally {
      $("edit-gif-input").disabled = false;
    }
  }
  on("edit-gif-input", "change", function () {
    const file = this.files && this.files[0];
    if (file) loadGifForEditing(file);
    this.value = "";
  });

  function updateEditToolsStatus(message) {
    const el = $("edit-tools-status");
    if (el) el.textContent = message;
  }
  function cropAllFrames() {
    if(!frames.length||activeVideoUrl)return;
    const ratio=$("crop-ratio").value, mode=$("crop-fill-mode").value, color=$("crop-fill-color").value;
    frames.forEach(frame=>{
      const src=frame.source,sw=src.naturalWidth||src.width,sh=src.naturalHeight||src.height;
      let rw=sw,rh=sh;
      if(ratio!=="original"){const p=ratio.split(":").map(Number);if(sw/sh>p[0]/p[1])rw=sh*p[0]/p[1];else rh=sw*p[1]/p[0];}
      const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(rw));canvas.height=Math.max(1,Math.round(rh));
      const ctx=canvas.getContext("2d");
      if(mode==="solid"){ctx.fillStyle=color;ctx.fillRect(0,0,canvas.width,canvas.height);const scale=Math.min(canvas.width/sw,canvas.height/sh);const dw=sw*scale,dh=sh*scale;ctx.drawImage(src,(canvas.width-dw)/2,(canvas.height-dh)/2,dw,dh);}
      else {const scale=Math.max(canvas.width/sw,canvas.height/sh);const dw=sw*scale,dh=sh*scale;ctx.drawImage(src,(canvas.width-dw)/2,(canvas.height-dh)/2,dw,dh);}
      frame.source=canvas;frame.thumb=canvas.toDataURL("image/png");frame.textBaseSource=null;frame.textOverlay=null;
    });
    renderStrip();restartPreview();updateEditToolsStatus("Crop 적용 완료 · "+ratio+" · "+(mode==="solid"?"단색 배경":"확대 채우기"));
  }
  function applyDownsizing() {
    if(!frames.length)return;
    if($("downsize-frames").checked){
      const step=Number($("downsize-frame-step").value)||2;
      const kept=frames.filter((_,i)=>i%step===0);
      frames.splice(0,frames.length,...kept);
    }
    const sizeScale=$("downsize-size").checked?(Number($("edit-downsize").value)||1):1;
    const resolutionScale=$("downsize-resolution").checked?(Number($("downsize-resolution-scale").value)||1):1;
    if(sizeScale!==1||resolutionScale!==1){
      const factor=sizeScale*resolutionScale;
      frames.forEach(f=>{
        const src=f.source,sw=src.naturalWidth||src.width,sh=src.naturalHeight||src.height;
        const cv=document.createElement("canvas");cv.width=Math.max(1,Math.round(sw*factor));cv.height=Math.max(1,Math.round(sh*factor));
        cv.getContext("2d").drawImage(src,0,0,cv.width,cv.height);f.source=cv;f.thumb=cv.toDataURL("image/png");
      });
    }
    selectedFrameIndex=Math.min(selectedFrameIndex,Math.max(0,frames.length-1));
    renderStrip();restartPreview();
    updateEditToolsStatus("Downsizing 적용 완료 · 현재 "+frames.length+"개 프레임");
  }
  function cutFrames() {
    if (frames.length < 2) return;
    const start=Math.max(1,Math.floor(Number($("cut-start").value)||1));
    const end=Math.min(frames.length,Math.floor(Number($("cut-end").value)||frames.length));
    if (start>end) { updateEditToolsStatus("Cut 시작 프레임은 종료 프레임보다 작거나 같아야 합니다."); return; }
    const kept=frames.slice(start-1,end);
    frames.splice(0,frames.length,...kept); selectedFrameIndex=0;
    $("cut-start").value=1; $("cut-end").value=frames.length;
    renderStrip(); restartPreview();
    updateEditToolsStatus("Cut 완료 · " + start + "–" + end + "번 프레임, 총 " + frames.length + "개를 남겼습니다.");
  }
  function reverseEditFrames() {
    if (frames.length<2) return;
    frames.reverse(); selectedFrameIndex=0; renderStrip(); restartPreview();
    updateEditToolsStatus("Reverse 완료 · 프레임 순서를 반대로 변경했습니다.");
  }
  function optimizeEditFrames() {
    if (frames.length<2) return;
    const before=frames.length, seen=new Set();
    for (let i=frames.length-1;i>=0;i--) {
      const f=frames[i], src=f.source, w=src.naturalWidth||src.width, h=src.naturalHeight||src.height;
      const cv=document.createElement("canvas"); cv.width=w; cv.height=h;
      const cx=cv.getContext("2d"); cx.drawImage(src,0,0,w,h);
      const data=cx.getImageData(0,0,w,h).data;
      let hash=w+"x"+h+":", step=Math.max(4,Math.floor(data.length/2048/4)*4);
      for(let p=0;p<data.length;p+=step) hash+=data[p]+","+data[p+1]+","+data[p+2]+";";
      if(seen.has(hash)) { frames.splice(i,1); } else seen.add(hash);
    }
    selectedFrameIndex=Math.min(selectedFrameIndex,Math.max(0,frames.length-1));
    renderStrip(); restartPreview();
    updateEditToolsStatus("Optimize 완료 · 완전히 동일한 이미지 프레임 " + (before-frames.length) + "개를 정리했습니다. 색상 재인코딩 과정에서 미세한 차이가 생길 수 있습니다.");
  }
  async function convertEditedFrames() {
    const format=$("edit-format").value;
    if(format==="gif") { await generateGif(true); return; }
    if(!window.JSZip) { updateEditToolsStatus("ZIP 변환 라이브러리를 불러오지 못했습니다."); return; }
    if(!frames.length) return;
    const zip=new JSZip();
    const scale=Number($("edit-downsize").value)||1;
    const targetW=Math.max(16,Math.round((Number($("edit-resize-width").value)||480)*scale));
    const targetHInput=Number($("edit-resize-height").value)||0;
    const src0=frames[0].source, baseW=src0.naturalWidth||src0.width, baseH=src0.naturalHeight||src0.height;
    const targetH=Math.max(16,Math.round((targetHInput||targetW*baseH/baseW)*scale));
    updateEditToolsStatus(format.toUpperCase()+" 프레임을 ZIP으로 변환하고 있습니다…");
    for(let i=0;i<frames.length;i++){
      const src=frames[i].source, sw=src.naturalWidth||src.width, sh=src.naturalHeight||src.height;
      const cv=document.createElement("canvas"); cv.width=targetW; cv.height=targetH;
      const cx=cv.getContext("2d"); cx.fillStyle=$("opt-bg").value; cx.fillRect(0,0,targetW,targetH);
      const scaleFit=Math.min(targetW/sw,targetH/sh), dw=sw*scaleFit, dh=sh*scaleFit;
      cx.drawImage(src,(targetW-dw)/2,(targetH-dh)/2,dw,dh);
      const mime=format==="webp"?"image/webp":"image/png";
      const blob=await new Promise(resolve=>cv.toBlob(resolve,mime,0.9));
      if(!blob) throw new Error(format+" 변환을 지원하지 않는 브라우저입니다.");
      zip.file("frame-"+String(i+1).padStart(4,"0")+"."+format,blob);
    }
    const blob=await zip.generateAsync({type:"blob"});
    if(objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl=URL.createObjectURL(blob); download.href=objectUrl;
    download.download="frame-lab-"+format+"-frames.zip"; download.textContent=format.toUpperCase()+" 프레임 ZIP 다운로드"; download.hidden=false;
    resultGif.hidden=true;
    updateEditToolsStatus("변환 완료 · " + frames.length + "개 프레임 · " + Math.round(blob.size/1024) + " KB");
  }
  on("btn-crop-apply","click",cropAllFrames);
  on("btn-downsize","click",applyDownsizing);
  on("btn-rotate-90","click",()=>transformSelectedFrames(90,false,false));
  on("btn-rotate-180","click",()=>transformSelectedFrames(180,false,false));
  on("btn-rotate-270","click",()=>transformSelectedFrames(270,false,false));
  on("btn-flip-horizontal","click",()=>transformSelectedFrames(0,true,false));
  on("btn-flip-vertical","click",()=>transformSelectedFrames(0,false,true));
  on("btn-cut-apply","click",cutFrames);
  on("btn-edit-reverse","click",reverseEditFrames);
  on("btn-optimize","click",optimizeEditFrames);
  on("btn-edit-speed","click",function(){
    editSpeedFactor=Number($("edit-speed").value)||1;
    const base=Math.max(20,Number($("opt-delay").value)||120);
    $("opt-delay").value=Math.max(20,Math.min(2000,Math.round(base/editSpeedFactor)));
    updateEditToolsStatus("Speed 적용 완료 · "+editSpeedFactor+"배 · 프레임 간격 "+$("opt-delay").value+"ms");
  });
  on("btn-make", "click", function () { if(currentMode==="edit" && $("edit-format").value!=="gif") convertEditedFrames().catch(e=>updateEditToolsStatus("변환 실패: "+e.message)); else generateGif(true); });
  updateTextEditor();
  updateCount();
  setMode("create");
})();