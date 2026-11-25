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
  let dragFrom = null, previewTimer = 0, objectUrl = "", activeVideoUrl = "";
  let activeVideoDuration = 0, videoPreviewFrames = [], videoPreviewIndex = 0;

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
    btnMake.disabled = activeVideoUrl ? !validVideoRange() : frames.length < 2;
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
    $("video-frame-preview").hidden = true;
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
    on(id, "input", function () { videoPreviewFrames = []; $("video-frame-preview").hidden = true; });
    on(id, "change", function () { videoPreviewFrames = []; $("video-frame-preview").hidden = true; });
  });
  on("btn-add", "click", function () { if (fileInput) fileInput.click(); });
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
  if (dropzone) {
    ["dragenter", "dragover"].forEach(function (type) {
      dropzone.addEventListener(type, function (event) { event.preventDefault(); dropzone.classList.add("dragover"); });
    });
    ["dragleave", "drop"].forEach(function (type) {
      dropzone.addEventListener(type, function (event) { event.preventDefault(); dropzone.classList.remove("dragover"); });
    });
    dropzone.addEventListener("drop", function (event) { if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files); });
  }
  on("btn-reverse", "click", function () { if (activeVideoUrl) return; frames.reverse(); renderStrip(); restartPreview(); });
  on("btn-clear", "click", function () {
    clearInterval(previewTimer); clearVideo(); clearFrames();
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
  async function generateGif(makeDownload) {
    if (activeVideoUrl ? !validVideoRange() : frames.length < 2) return;
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
        const extracted = await extractVideoFrames();
        imageDatas = extracted.imageDatas; size = extracted.size; exportDelay = extracted.delay;
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
        width: size.width, height: size.height, delay: exportDelay,
        loop: Number($("opt-loop").value), dither: $("opt-dither").checked
      }, function (ratio) {
        const offset = activeVideoUrl ? 0.35 : 0;
        progressBar.style.width = Math.round((offset + ratio * (1 - offset)) * 100) + "%";
        progressText.textContent = (makeDownload ? "GIF 인코딩 " : "미리보기 인코딩 ") + Math.round(ratio * 100) + "%";
      });
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
    canvas.getContext("2d").putImageData(imageData, 0, 0);
    $("video-frame-count").textContent = (videoPreviewIndex + 1) + " / " + videoPreviewFrames.length;
    const start = parseTime($("range-start").value);
    const delay = Math.max(20, Number($("opt-delay").value) || 120);
    $("video-frame-time").textContent = formatTime(start + videoPreviewIndex * delay / 1000);
    $("btn-frame-prev").disabled = videoPreviewIndex === 0;
    $("btn-frame-next").disabled = videoPreviewIndex >= videoPreviewFrames.length - 1;
  }
  on("btn-frame-prev", "click", function () {
    if (videoPreviewIndex > 0) { videoPreviewIndex--; showVideoPreviewFrame(); }
  });
  on("btn-frame-next", "click", function () {
    if (videoPreviewIndex < videoPreviewFrames.length - 1) { videoPreviewIndex++; showVideoPreviewFrame(); }
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
  on("btn-make", "click", function () { generateGif(true); });
  updateCount();
})();