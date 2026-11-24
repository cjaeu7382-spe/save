(function () {
  "use strict";
  const $ = function (id) { return document.getElementById(id); };
  const fileInput = $("file-input"), dropzone = $("dropzone"), filmstrip = $("filmstrip");
  const frameCount = $("frame-count"), previewCanvas = $("preview-canvas"), previewEmpty = $("preview-empty");
  const previewStatus = $("preview-status"), btnMake = $("btn-make"), progress = $("progress");
  const progressBar = $("progress-bar"), progressText = $("progress-text"), download = $("download");
  const resultGif = $("result-gif"), videoRange = $("video-range"), sourceVideo = $("source-video");
  const frames = [];
  let dragFrom = null, previewTimer = 0, previewIndex = 0, objectUrl = "", activeVideoUrl = "";
  let activeVideoDuration = 0;

  function uid() { return Math.random().toString(36).slice(2); }
  function formatTime(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(value / 60);
    const secs = (value % 60).toFixed(1).padStart(4, "0");
    return String(minutes).padStart(2, "0") + ":" + secs;
  }
  function updateCount() {
    const count = activeVideoUrl ? "영상 구간 선택" : "프레임 " + frames.length;
    frameCount.textContent = count;
    btnMake.disabled = activeVideoUrl ? !validVideoRange() : frames.length < 2;
    previewEmpty.style.display = (activeVideoUrl || frames.length) ? "none" : "block";
    previewCanvas.style.display = frames.length && !activeVideoUrl ? "block" : "none";
  }
  function validVideoRange() {
    const start = Number($("range-start").value), end = Number($("range-end").value);
    return !!activeVideoUrl && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= activeVideoDuration && end > start;
  }
  function syncRange(source) {
    if (!activeVideoUrl) return;
    let start = Number($("range-start").value) || 0;
    let end = Number($("range-end").value) || activeVideoDuration;
    if (source === "start-slider") start = Number($("range-start-slider").value);
    if (source === "end-slider") end = Number($("range-end-slider").value);
    start = Math.max(0, Math.min(start, Math.max(0, activeVideoDuration - 0.1)));
    end = Math.max(0.1, Math.min(end, activeVideoDuration));
    if (end <= start) {
      if (source.indexOf("start") === 0) end = Math.min(activeVideoDuration, start + 0.1);
      else start = Math.max(0, end - 0.1);
    }
    $("range-start").value = start.toFixed(1);
    $("range-end").value = end.toFixed(1);
    $("range-start-slider").value = start;
    $("range-end-slider").value = end;
    $("range-summary").textContent = "선택 구간 " + (end - start).toFixed(1) + "초 · " + formatTime(start) + "–" + formatTime(end);
    updateCount();
  }
  function renderStrip() {
    filmstrip.innerHTML = "";
    frames.forEach(function (frame, index) {
      const card = document.createElement("article");
      card.className = "frame-card"; card.draggable = true; card.dataset.id = frame.id;
      card.setAttribute("role", "listitem");
      const img = document.createElement("img"); img.src = frame.thumb; img.alt = "프레임 " + (index + 1); card.appendChild(img);
      const meta = document.createElement("div"); meta.className = "meta";
      meta.innerHTML = "<span>#" + (index + 1) + "</span><span>드래그로 이동</span>"; card.appendChild(meta);
      const remove = document.createElement("button"); remove.type = "button"; remove.setAttribute("aria-label", "삭제"); remove.textContent = "×";
      remove.addEventListener("click", function () {
        const i = frames.findIndex(function (f) { return f.id === frame.id; });
        if (i >= 0) { if (frame.revokeThumb) URL.revokeObjectURL(frame.thumb); frames.splice(i, 1); renderStrip(); restartPreview(); }
      });
      card.appendChild(remove);
      card.addEventListener("dragstart", function () { dragFrom = frame.id; });
      card.addEventListener("dragover", function (event) { event.preventDefault(); });
      card.addEventListener("drop", function (event) {
        event.preventDefault(); if (!dragFrom || dragFrom === frame.id) return;
        const from = frames.findIndex(function (f) { return f.id === dragFrom; });
        const to = frames.findIndex(function (f) { return f.id === frame.id; });
        const moved = frames.splice(from, 1)[0]; frames.splice(to, 0, moved); renderStrip(); restartPreview();
      });
      filmstrip.appendChild(card);
    });
    updateCount();
  }
  function clearVideo() {
    if (activeVideoUrl) URL.revokeObjectURL(activeVideoUrl);
    activeVideoUrl = ""; activeVideoDuration = 0;
    sourceVideo.pause(); sourceVideo.removeAttribute("src"); sourceVideo.load();
    videoRange.hidden = true;
  }
  function clearFrames() {
    frames.forEach(function (frame) { if (frame.revokeThumb) URL.revokeObjectURL(frame.thumb); });
    frames.splice(0, frames.length);
    renderStrip();
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
      sourceVideo.src = activeVideoUrl;
      sourceVideo.onloadedmetadata = function () {
        activeVideoDuration = sourceVideo.duration;
        if (!Number.isFinite(activeVideoDuration) || activeVideoDuration <= 0) { reject(new Error("영상 길이를 확인할 수 없습니다.")); return; }
        $("video-duration-label").textContent = "전체 " + formatTime(activeVideoDuration);
        ["range-start", "range-start-slider"].forEach(function (id) { $(id).max = activeVideoDuration; });
        ["range-end", "range-end-slider"].forEach(function (id) { $(id).max = activeVideoDuration; });
        $("range-start").value = "0"; $("range-start-slider").value = "0";
        $("range-end").value = activeVideoDuration.toFixed(1); $("range-end-slider").value = activeVideoDuration;
        videoRange.hidden = false; syncRange("init"); restartPreview(); resolve();
      };
      sourceVideo.onerror = function () { reject(new Error("이 파일의 영상을 열 수 없습니다. MP4 등 브라우저에서 지원하는 형식인지 확인하세요.")); };
    });
  }
  async function addFiles(fileList) {
    const list = Array.from(fileList);
    try {
      const videoFile = list.find(function (file) { return file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(file.name); });
      if (videoFile) { await loadVideoFile(videoFile); return; }
      clearVideo();
      for (const file of list) {
        if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)) frames.push(await loadImageFile(file));
      }
      renderStrip(); restartPreview();
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
    if (activeVideoUrl) {
      previewCanvas.style.display = "none"; previewEmpty.style.display = "none";
      previewStatus.textContent = "영상 구간 선택";
      const start = Number($("range-start").value) || 0;
      if (sourceVideo.currentTime < start || sourceVideo.currentTime > Number($("range-end").value)) sourceVideo.currentTime = start;
      return;
    }
    if (!frames.length) { previewStatus.textContent = "대기"; updateCount(); return; }
    const size = outputSize(frames[0].source);
    previewCanvas.width = size.width; previewCanvas.height = size.height;
    previewIndex = 0;
    const delay = Number($("opt-delay").value) || 120, ctx = previewCanvas.getContext("2d");
    const paint = function () {
      drawFitted(ctx, frames[previewIndex].source, size.width, size.height, $("opt-fit").value, $("opt-bg").value);
      previewStatus.textContent = (previewIndex + 1) + " / " + frames.length;
      previewIndex = (previewIndex + 1) % frames.length;
    };
    paint(); previewTimer = setInterval(paint, delay);
  }
  function seekVideo(time) {
    return new Promise(function (resolve, reject) {
      if (Math.abs(sourceVideo.currentTime - time) < 0.015) { resolve(); return; }
      const done = function () { cleanup(); resolve(); };
      const fail = function () { cleanup(); reject(new Error("영상 프레임을 읽지 못했습니다.")); };
      const cleanup = function () { sourceVideo.removeEventListener("seeked", done); sourceVideo.removeEventListener("error", fail); };
      sourceVideo.addEventListener("seeked", done, { once: true });
      sourceVideo.addEventListener("error", fail, { once: true });
      sourceVideo.currentTime = time;
    });
  }
  async function extractVideoFrames() {
    const start = Number($("range-start").value), end = Number($("range-end").value);
    if (!validVideoRange()) throw new Error("시작 시간과 종료 시간을 올바르게 설정하세요.");
    sourceVideo.pause();
    const delay = Math.max(20, Number($("opt-delay").value) || 120);
    const count = Math.max(2, Math.min(180, Math.ceil((end - start) * 1000 / delay)));
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
    return { imageDatas: data, size: size };
  }
  ["opt-width", "opt-delay", "opt-fit", "opt-bg"].forEach(function (id) {
    $(id).addEventListener("input", restartPreview); $(id).addEventListener("change", restartPreview);
  });
  $("btn-add").addEventListener("click", function () { fileInput.click(); });
  $("btn-sample").addEventListener("click", async function () {
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
  fileInput.addEventListener("change", function () { addFiles(fileInput.files); fileInput.value = ""; });
  ["dragenter", "dragover"].forEach(function (type) { dropzone.addEventListener(type, function (event) { event.preventDefault(); dropzone.classList.add("dragover"); }); });
  ["dragleave", "drop"].forEach(function (type) { dropzone.addEventListener(type, function (event) { event.preventDefault(); dropzone.classList.remove("dragover"); }); });
  dropzone.addEventListener("drop", function (event) { if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files); });
  $("btn-reverse").addEventListener("click", function () { if (activeVideoUrl) return; frames.reverse(); renderStrip(); restartPreview(); });
  $("btn-clear").addEventListener("click", function () {
    clearInterval(previewTimer); clearVideo(); clearFrames(); previewStatus.textContent = "대기";
    download.hidden = true; resultGif.hidden = true; updateCount(); restartPreview();
  });
  ["range-start", "range-end"].forEach(function (id) { $(id).addEventListener("input", function () { syncRange(id); }); });
  $("range-start-slider").addEventListener("input", function () { syncRange("start-slider"); });
  $("range-end-slider").addEventListener("input", function () { syncRange("end-slider"); });
  $("btn-preview-range").addEventListener("click", async function () {
    if (!validVideoRange()) return;
    sourceVideo.pause(); await seekVideo(Number($("range-start").value)); sourceVideo.play();
    const stopAt = Number($("range-end").value);
    const check = function () { if (sourceVideo.currentTime >= stopAt) { sourceVideo.pause(); sourceVideo.currentTime = Number($("range-start").value); sourceVideo.removeEventListener("timeupdate", check); } };
    sourceVideo.addEventListener("timeupdate", check);
  });
  $("btn-make").addEventListener("click", async function () {
    if (activeVideoUrl ? !validVideoRange() : frames.length < 2) return;
    btnMake.disabled = true; progress.hidden = false; download.hidden = true; resultGif.hidden = true;
    progressBar.style.width = "0%"; progressText.textContent = "캔버스 준비 중";
    try {
      let imageDatas, size;
      if (activeVideoUrl) {
        const extracted = await extractVideoFrames(); imageDatas = extracted.imageDatas; size = extracted.size;
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
      const blob = await window.GifLab.encodeGif(imageDatas, {
        width: size.width, height: size.height, delay: Number($("opt-delay").value) || 120,
        loop: Number($("opt-loop").value), dither: $("opt-dither").checked
      }, function (ratio) {
        const offset = activeVideoUrl ? 0.35 : 0;
        progressBar.style.width = Math.round((offset + ratio * (1 - offset)) * 100) + "%";
        progressText.textContent = "GIF 인코딩 " + Math.round(ratio * 100) + "%";
      });
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob); download.href = objectUrl; download.download = "frame-lab.gif";
      download.hidden = false; resultGif.src = objectUrl; resultGif.hidden = false;
      progressText.textContent = "완료 · " + Math.round(blob.size / 1024) + " KB";
    } catch (error) { progressText.textContent = "실패: " + error.message; }
    finally { updateCount(); }
  });
  updateCount();
})();